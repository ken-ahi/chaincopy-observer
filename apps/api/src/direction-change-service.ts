import { isDeepStrictEqual } from "node:util";
import {
  calculateDirectionChange,
  DirectionChangeInputError,
  SignalInputError,
  WalletWeightInputError,
  utcBucketStart,
} from "@chaincopy/analytics";
import { Prisma, type PrismaClient } from "@chaincopy/database";
import { PrismaBehaviorSignalService } from "./behavior-signal-service.js";
import { PerformanceRunTrustInconsistentError } from "./performance-run-trust.js";

type Result = ReturnType<typeof calculateDirectionChange>;
function storedData(r: Result) {
  return {
    id: r.id,
    directionChangeVersion: r.directionChangeVersion,
    signalVersion: r.signalVersion,
    previousSignalId: r.previousSignalId,
    currentSignalId: r.currentSignalId,
    coin: r.coin,
    previousBucket: new Date(r.previousBucket),
    currentBucket: new Date(r.currentBucket),
    previousNetSignal: new Prisma.Decimal(r.previousNetSignal),
    currentNetSignal: new Prisma.Decimal(r.currentNetSignal),
    delta: new Prisma.Decimal(r.delta),
    eventType: r.eventType,
    selectionRunId: r.selectionRunId,
    cohortFingerprint: r.cohortFingerprint,
    weightSnapshotId: r.weightSnapshotId,
    inputFingerprint: r.inputFingerprint,
    inputSnapshot: JSON.parse(JSON.stringify(r.inputSnapshot)) as Prisma.InputJsonValue,
    result: JSON.parse(JSON.stringify(r)) as Prisma.InputJsonValue,
  };
}
function assertStored(row: Prisma.DirectionChangeSnapshotGetPayload<object>, result: Result) {
  const { calculatedAt, ...data } = row;
  if (!Number.isFinite(calculatedAt.getTime()) || !isDeepStrictEqual(data, storedData(result)))
    throw new DirectionChangeInputError("DIRECTION_CHANGE_RECEIPT_MISMATCH");
}
export class PrismaDirectionChangeService {
  public constructor(private readonly database: PrismaClient) {}
  private async calculate(tx: Prisma.TransactionClient, coin: string, start: string) {
    if (!coin || coin.length > 100 || utcBucketStart(start) !== start)
      throw new RangeError("Explicit coin/aligned current bucket required");
    const previous = new Date(Date.parse(start) - 900000).toISOString();
    const signals = new PrismaBehaviorSignalService(this.database);
    // Current first distinguishes no current cohort from a missing predecessor.
    const b = await signals.verifiedInTransaction(tx, coin, start);
    if (!b) return null;
    const a = await signals.verifiedInTransaction(tx, coin, previous);
    if (!a) throw new DirectionChangeInputError("COHORT_CHANGED");
    return calculateDirectionChange(a, b);
  }
  public async preview(coin: string, start: string) {
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return this.calculate(tx, coin, start);
      },
      { isolationLevel: "RepeatableRead", timeout: 60000 },
    );
  }
  public async persist(coin: string, start: string, expectedFingerprint: string) {
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint))
      throw new DirectionChangeInputError("EXPECTED_FINGERPRINT_REQUIRED");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const result = await this.calculate(tx, coin, start);
            if (!result) return null;
            if (result.id !== expectedFingerprint)
              throw new DirectionChangeInputError("INPUT_CHANGED");
            const existing = await tx.directionChangeSnapshot.findUnique({
              where: { id: result.id },
            });
            if (existing) {
              assertStored(existing, result);
              return existing;
            }
            return tx.directionChangeSnapshot.create({ data: storedData(result) });
          },
          { isolationLevel: "Serializable", timeout: 60000, maxWait: 10000 },
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          !["P2034", "P2002"].includes(error.code) ||
          attempt >= 2
        )
          throw error;
      }
    }
  }
  public async read(coin: string, start: string) {
    try {
      return await this.database.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          const result = await this.calculate(tx, coin, start);
          if (!result) return { status: "NO_SELECTED_WALLETS", item: null };
          const row = await tx.directionChangeSnapshot.findUnique({ where: { id: result.id } });
          if (!row) return { status: "NOT_COMPUTED", item: null };
          assertStored(row, result);
          return {
            status: "CURRENT",
            item: row.result,
            calculatedAt: row.calculatedAt.toISOString(),
          };
        },
        { isolationLevel: "RepeatableRead", timeout: 60000 },
      );
    } catch (error) {
      if (error instanceof PerformanceRunTrustInconsistentError)
        return { status: "BLOCKED", reason: "PERFORMANCE_TRUST_INCONSISTENT", item: null };
      if (
        error instanceof DirectionChangeInputError ||
        error instanceof SignalInputError ||
        error instanceof WalletWeightInputError
      )
        return { status: "BLOCKED", reason: error.message, item: null };
      throw error;
    }
  }
}
