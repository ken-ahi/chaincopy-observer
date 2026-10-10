import { isDeepStrictEqual } from "node:util";
import {
  calculateBehaviorSignal,
  SignalInputError,
  WalletWeightInputError,
  utcBucketStart,
} from "@chaincopy/analytics";
import { Prisma, type PrismaClient } from "@chaincopy/database";
import { PrismaBehaviorAggregationService } from "./behavior-aggregation-service.js";
import { PrismaWalletWeightService } from "./wallet-weight-service.js";

type Signal = ReturnType<typeof calculateBehaviorSignal>;
function assertStored(stored: Prisma.BehaviorSignalSnapshotGetPayload<object>, result: Signal) {
  if (
    stored.id !== result.id ||
    stored.signalVersion !== result.signalVersion ||
    stored.aggregationRevisionId !== result.aggregationRevisionId ||
    stored.weightSnapshotId !== result.weightSnapshotId ||
    stored.selectionRunId !== result.selectionRunId ||
    stored.cohortFingerprint !== result.cohortFingerprint ||
    stored.coin !== result.coin ||
    stored.bucketStart.toISOString() !== result.bucketStart ||
    stored.bucketEnd.toISOString() !== result.bucketEnd ||
    stored.inputFingerprint !== result.inputFingerprint ||
    !isDeepStrictEqual(stored.inputSnapshot, result.inputSnapshot) ||
    !isDeepStrictEqual(stored.result, result)
  )
    throw new SignalInputError("SIGNAL_RECEIPT_MISMATCH");
}

export class PrismaBehaviorSignalService {
  public constructor(private readonly database: PrismaClient) {}
  private async calculate(tx: Prisma.TransactionClient, coin: string, start: string) {
    if (!coin || coin.length > 100 || utcBucketStart(start) !== start)
      throw new RangeError("An explicit coin and aligned UTC bucket are required.");
    const weight = await new PrismaWalletWeightService(this.database).verifiedInTransaction(tx);
    if (!weight) return null;
    const aggregation = await new PrismaBehaviorAggregationService(
      this.database,
    ).verifiedInTransaction(tx, coin, start);
    if (!aggregation) throw new SignalInputError("COHORT_CHANGED");
    return calculateBehaviorSignal(aggregation, weight);
  }

  public async preview(coin: string, start: string) {
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return this.calculate(tx, coin, start);
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );
  }

  /** Read-only saved receipt validation inside the caller's coherent transaction. */
  public async verifiedInTransaction(tx: Prisma.TransactionClient, coin: string, start: string) {
    const result = await this.calculate(tx, coin, start);
    if (!result) return null;
    const stored = await tx.behaviorSignalSnapshot.findUnique({ where: { id: result.id } });
    if (!stored) throw new SignalInputError("SIGNAL_NOT_COMPUTED");
    assertStored(stored, result);
    return result;
  }

  public async persist(coin: string, start: string, expectedFingerprint: string) {
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint))
      throw new SignalInputError("EXPECTED_FINGERPRINT_REQUIRED");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const result = await this.calculate(tx, coin, start);
            if (!result) return null;
            if (result.inputFingerprint !== expectedFingerprint)
              throw new SignalInputError("INPUT_CHANGED");
            const existing = await tx.behaviorSignalSnapshot.findUnique({
              where: { id: result.id },
            });
            if (existing) {
              assertStored(existing, result);
              return existing;
            }
            return tx.behaviorSignalSnapshot.create({
              data: {
                id: result.id,
                signalVersion: result.signalVersion,
                aggregationRevisionId: result.aggregationRevisionId,
                weightSnapshotId: result.weightSnapshotId,
                selectionRunId: result.selectionRunId,
                cohortFingerprint: result.cohortFingerprint,
                coin,
                bucketStart: new Date(result.bucketStart),
                bucketEnd: new Date(result.bucketEnd),
                inputFingerprint: result.inputFingerprint,
                inputSnapshot: JSON.parse(
                  JSON.stringify(result.inputSnapshot),
                ) as Prisma.InputJsonValue,
                result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue,
              },
            });
          },
          { isolationLevel: "Serializable", timeout: 30_000, maxWait: 10_000 },
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
          const stored = await tx.behaviorSignalSnapshot.findUnique({ where: { id: result.id } });
          if (!stored) return { status: "NOT_COMPUTED", item: null };
          assertStored(stored, result);
          return {
            status: "CURRENT",
            item: stored.result,
            calculatedAt: stored.calculatedAt.toISOString(),
          };
        },
        { isolationLevel: "RepeatableRead", timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof SignalInputError || error instanceof WalletWeightInputError)
        return { status: "BLOCKED", reason: error.message, item: null };
      throw error;
    }
  }
}
