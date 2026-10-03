import { isDeepStrictEqual } from "node:util";
import {
  calculateWalletWeights,
  WALLET_WEIGHT_VERSION,
  WEIGHT_METRICS,
  WalletWeightInputError,
  type WalletWeightInput,
  type WeightMetrics,
} from "@chaincopy/analytics";
import { Prisma, type PrismaClient } from "@chaincopy/database";
import {
  PrismaWalletSelectionService,
  isTradeHistoryEvaluable,
} from "./wallet-selection-service.js";
import {
  assertPerformanceRunTrustConsistency,
  findCurrentTrustedPerformanceRunId,
  performanceRunTrustSelect,
} from "./performance-run-trust.js";

function assertStoredSnapshot(
  stored: Prisma.WalletWeightSnapshotGetPayload<{ include: { entries: true } }>,
  current: ReturnType<typeof calculateWalletWeights>,
) {
  if (
    stored.id !== current.id ||
    stored.weightVersion !== current.weightVersion ||
    stored.selectionRunId !== current.selectionRunId ||
    stored.cohortFingerprint !== current.cohortFingerprint ||
    stored.inputFingerprint !== current.inputFingerprint ||
    !isDeepStrictEqual(stored.inputSnapshot, current.inputSnapshot) ||
    stored.entries.length !== current.entries.length ||
    stored.entries.some((e, i) => {
      const expected = current.entries[i]!;
      return (
        e.walletAddressId !== expected.walletAddressId ||
        e.address !== expected.address ||
        e.performanceRunId !== expected.performanceRunId ||
        !e.rawWeight.eq(expected.rawWeight) ||
        !e.normalizedWeight.eq(expected.normalizedWeight) ||
        !isDeepStrictEqual(e.metricInputs, expected)
      );
    })
  )
    throw new WalletWeightInputError("SNAPSHOT_INCONSISTENT");
}

export class PrismaWalletWeightService {
  public constructor(private readonly database: PrismaClient) {}

  private async calculate(tx: Prisma.TransactionClient) {
    const settings = await tx.walletSelectionSettings.findFirst({
      where: { source: { key: "hyperliquid-mainnet" } },
      include: { currentSelectionRun: true },
    });
    if (!settings?.currentSelectionRun) return null;
    if (settings.currentSelectionRun.policyVersion !== "wallet-selection-v2")
      throw new WalletWeightInputError("UNSUPPORTED_SELECTION_VERSION");
    const members = await new PrismaWalletSelectionService(
      tx as PrismaClient,
    ).listEffectiveSelectedWallets();
    if (!members.length) return null;
    if (members.length > 200) throw new WalletWeightInputError("COHORT_BOUND_EXCEEDED");
    const inputs: WalletWeightInput[] = [];
    for (const member of members) {
      if (!member.performanceRunId)
        throw new WalletWeightInputError("MISSING_PERFORMANCE_PROVENANCE");
      const latest = await findCurrentTrustedPerformanceRunId(tx as PrismaClient, {
        walletAddressId: member.walletAddressId,
        calculationVersion: "performance-v3",
      });
      if (latest !== member.performanceRunId)
        throw new WalletWeightInputError("STALE_SELECTION_EVIDENCE");
      const run = await tx.metricCalculationRun.findUniqueOrThrow({
        where: { id: member.performanceRunId },
        select: {
          id: true,
          walletAddressId: true,
          calculationVersion: true,
          status: true,
          inputFingerprint: true,
          ...performanceRunTrustSelect,
          performanceMetrics: {
            where: { metricKey: { in: [...WEIGHT_METRICS] } },
            orderBy: { metricKey: "asc" },
          },
          _count: { select: { positionCycles: { where: { status: "CLOSED" } } } },
        },
      });
      assertPerformanceRunTrustConsistency(run.id, run);
      if (
        run.trustState !== "TRUSTED" ||
        run.status !== "SUCCEEDED" ||
        run.walletAddressId !== member.walletAddressId ||
        run.calculationVersion !== "performance-v3" ||
        !isTradeHistoryEvaluable(run._count.positionCycles, run.performanceMetrics) ||
        run.performanceMetrics.some((m) => m.walletAddressId !== member.walletAddressId)
      )
        throw new WalletWeightInputError("INVALID_PERFORMANCE_EVIDENCE");
      const first = run.performanceMetrics[0]!;
      const metrics = Object.fromEntries(
        run.performanceMetrics.map((m) => [m.metricKey, m.metricValue.toString()]),
      ) as WeightMetrics;
      inputs.push({
        walletAddressId: member.walletAddressId,
        address: member.address,
        selectionRunId: member.selectionRunId,
        performanceRunId: run.id,
        performanceInputFingerprint: run.inputFingerprint,
        trustRevision: run.trustRevision,
        metricFrom: first.calculationFrom.toISOString(),
        metricTo: first.calculationTo.toISOString(),
        trustedClosedCycleCount: run._count.positionCycles.toString(),
        metrics,
      });
    }
    return calculateWalletWeights(inputs);
  }

  public async preview() {
    return this.database.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return this.calculate(tx);
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );
  }

  public async persist(expectedFingerprint: string) {
    if (!/^[0-9a-f]{64}$/.test(expectedFingerprint))
      throw new WalletWeightInputError("EXPECTED_FINGERPRINT_REQUIRED");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const result = await this.calculate(tx);
            if (!result) return null;
            if (result.inputFingerprint !== expectedFingerprint)
              throw new WalletWeightInputError("INPUT_CHANGED");
            const existing = await tx.walletWeightSnapshot.findUnique({
              where: { id: result.id },
              include: { entries: { orderBy: { address: "asc" } } },
            });
            if (existing) {
              assertStoredSnapshot(existing, result);
              return existing;
            }
            return tx.walletWeightSnapshot.create({
              data: {
                id: result.id,
                weightVersion: WALLET_WEIGHT_VERSION,
                selectionRunId: result.selectionRunId,
                cohortFingerprint: result.cohortFingerprint,
                inputFingerprint: result.inputFingerprint,
                inputSnapshot: JSON.parse(
                  JSON.stringify(result.inputSnapshot),
                ) as Prisma.InputJsonValue,
                entries: {
                  create: result.entries.map((e) => ({
                    walletAddressId: e.walletAddressId,
                    address: e.address,
                    performanceRunId: e.performanceRunId,
                    rawWeight: e.rawWeight,
                    normalizedWeight: e.normalizedWeight,
                    metricInputs: JSON.parse(JSON.stringify(e)) as Prisma.InputJsonValue,
                  })),
                },
              },
              include: { entries: { orderBy: { address: "asc" } } },
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

  public async current() {
    try {
      return await this.database.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          const current = await this.calculate(tx);
          if (!current) return { status: "NO_SELECTED_WALLETS", items: [] };
          const stored = await tx.walletWeightSnapshot.findUnique({
            where: { id: current.id },
            include: { entries: { orderBy: { address: "asc" } } },
          });
          if (!stored)
            return {
              status: "NOT_COMPUTED",
              inputFingerprint: current.inputFingerprint,
              items: [],
            };
          assertStoredSnapshot(stored, current);
          return {
            status: "CURRENT",
            snapshotId: stored.id,
            inputFingerprint: current.inputFingerprint,
            cohortFingerprint: current.cohortFingerprint,
            selectionRunId: current.selectionRunId,
            weightVersion: WALLET_WEIGHT_VERSION,
            calculatedAt: stored.calculatedAt.toISOString(),
            items: current.entries,
          };
        },
        { isolationLevel: "RepeatableRead", timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof WalletWeightInputError)
        return { status: "BLOCKED", reason: error.message, items: [] };
      throw error;
    }
  }
}
