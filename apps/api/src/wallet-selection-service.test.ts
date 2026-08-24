import {
  type WalletSelectionAutomaticStatus,
  type WalletSelectionOverrideDecision,
} from "@chaincopy/analytics";
import { Prisma, type PrismaClient } from "@chaincopy/database";
import { beforeEach, describe, expect, it } from "vitest";

import { PrismaWalletSelectionService } from "./wallet-selection-service.js";

const now = new Date("2026-08-08T00:00:00.000Z");
const walletAddress = "0x1111111111111111111111111111111111111111";

interface MetricFixture {
  readonly calculationFrom: Date;
  readonly calculationTo: Date;
  readonly metricKey: string;
  readonly metricValue: Prisma.Decimal;
}

interface PerformanceFixture {
  readonly _count: { readonly positionCycles: number };
  readonly calculationFrom: Date;
  readonly calculationTo: Date;
  readonly calculationVersion: string;
  readonly historyCompleteness: string;
  readonly id: string;
  readonly performanceMetrics: readonly MetricFixture[];
  readonly trustRevision: number;
  readonly trustState: "TRUSTED" | "QUARANTINED";
  readonly trustTransitions: readonly {
    readonly revision: number;
    readonly toState: "TRUSTED" | "QUARANTINED";
  }[];
}

interface WalletFixture {
  readonly address: string;
  readonly id: string;
  readonly lastSyncAt: Date;
  readonly metricCalculationRuns: readonly PerformanceFixture[];
}

interface StoredResult {
  readonly automaticStatus: WalletSelectionAutomaticStatus;
  readonly performanceRunId: string | null;
  readonly rank: number | null;
  readonly reasonCodes: readonly string[];
  readonly selectionRunId: string;
  readonly walletAddressId: string;
}

interface StoredRun {
  readonly createdAt: Date;
  readonly evaluatedAt: Date;
  readonly excludedCount: number;
  readonly id: string;
  readonly inputFingerprint: string;
  readonly policySnapshot: unknown;
  readonly policyVersion: string;
  readonly qualifiedCount: number;
  readonly results: StoredResult[];
  readonly reviewCount: number;
  readonly selectedCount: number;
  readonly sourceId: string;
  readonly universeCount: number;
}

interface SettingsState {
  currentSelectionRunId: string | null;
  id: string;
  maxAutoSelected: number;
  maximumDataAgeHours: number;
  maximumDrawdown: Prisma.Decimal;
  maximumTopTradeContribution: Prisma.Decimal;
  minimumAnnualizedReturn: Prisma.Decimal;
  minimumEvaluationDays: number;
  minimumTrustedClosedCycles: number;
  sourceId: string;
  updatedAt: Date;
}

interface SettingsUpdateData {
  readonly currentSelectionRunId?: string | null;
  readonly maxAutoSelected?: number;
  readonly maximumDataAgeHours?: number;
  readonly maximumDrawdown?: string;
  readonly maximumTopTradeContribution?: string;
  readonly minimumAnnualizedReturn?: string;
  readonly minimumEvaluationDays?: number;
  readonly minimumTrustedClosedCycles?: number;
}

function performanceFixture(
  annualizedReturnFrom: Date,
  annualizedReturnTo: Date,
): PerformanceFixture {
  return {
    _count: { positionCycles: 20 },
    calculationFrom: new Date("2025-08-01T00:00:00.000Z"),
    calculationTo: new Date("2026-08-01T00:00:00.000Z"),
    calculationVersion: "performance-v3",
    historyCompleteness: "COMPLETE",
    id: "performance-run-1",
    performanceMetrics: [
      metric("annualizedReturn", "0.2", annualizedReturnFrom, annualizedReturnTo),
      metric("maxDrawdown", "-0.1"),
      metric("topTradeContribution", "0.2"),
    ],
    trustRevision: 0,
    trustState: "TRUSTED",
    trustTransitions: [],
  };
}

function metric(
  metricKey: string,
  metricValue: string,
  calculationFrom = new Date("2026-04-01T00:00:00.000Z"),
  calculationTo = new Date("2026-08-01T00:00:00.000Z"),
): MetricFixture {
  return {
    calculationFrom,
    calculationTo,
    metricKey,
    metricValue: new Prisma.Decimal(metricValue),
  };
}

function createHarness(
  performance: PerformanceFixture = performanceFixture(
    new Date("2026-04-01T00:00:00.000Z"),
    new Date("2026-08-01T00:00:00.000Z"),
  ),
) {
  const wallets: readonly WalletFixture[] = [
    {
      address: walletAddress,
      id: "wallet-1",
      lastSyncAt: new Date("2026-08-07T12:00:00.000Z"),
      metricCalculationRuns: [performance],
    },
  ];
  const settings: SettingsState = {
    currentSelectionRunId: null,
    id: "settings-1",
    maxAutoSelected: 100,
    maximumDataAgeHours: 24,
    maximumDrawdown: new Prisma.Decimal("0.5"),
    maximumTopTradeContribution: new Prisma.Decimal("0.75"),
    minimumAnnualizedReturn: new Prisma.Decimal("0"),
    minimumEvaluationDays: 90,
    minimumTrustedClosedCycles: 20,
    sourceId: "source-1",
    updatedAt: now,
  };
  const overrides = new Map<
    string,
    { readonly decision: WalletSelectionOverrideDecision; readonly note: string | null }
  >();
  let runs = new Map<string, StoredRun>();
  let nextRunNumber = 1;
  let failResultPersistence = false;

  function hydratedRun(run: StoredRun | undefined) {
    if (!run) return null;
    return {
      ...run,
      results: run.results.map((result) => {
        const wallet = wallets.find((candidate) => candidate.id === result.walletAddressId)!;
        return {
          ...result,
          performanceRun:
            wallet.metricCalculationRuns.find(
              (candidate) => candidate.id === result.performanceRunId,
            ) ?? null,
          walletAddress: {
            address: wallet.address,
            lastSyncAt: wallet.lastSyncAt,
            walletSelectionOverride: overrides.get(wallet.id) ?? null,
          },
        };
      }),
    };
  }

  const database = {
    $transaction: async (
      callback: (transaction: {
        walletSelectionResult: {
          createMany(input: { readonly data: readonly StoredResult[] }): Promise<unknown>;
        };
        walletSelectionRun: {
          create(input: {
            readonly data: Omit<StoredRun, "createdAt" | "id" | "results">;
          }): Promise<{ readonly id: string }>;
        };
        walletSelectionSettings: {
          update(input: {
            readonly data: { readonly currentSelectionRunId: string };
            readonly where: { readonly id: string };
          }): Promise<unknown>;
        };
      }) => Promise<unknown>,
    ) => {
      const stagedRuns = new Map(runs);
      let stagedCurrentRunId = settings.currentSelectionRunId;
      const transaction = {
        walletSelectionResult: {
          createMany: async (input: { readonly data: readonly StoredResult[] }) => {
            if (failResultPersistence) {
              throw new Error("simulated result persistence failure");
            }
            for (const result of input.data) {
              stagedRuns.get(result.selectionRunId)!.results.push({ ...result });
            }
            return { count: input.data.length };
          },
        },
        walletSelectionRun: {
          create: async (input: {
            readonly data: Omit<StoredRun, "createdAt" | "id" | "results">;
          }) => {
            const id = `selection-run-${nextRunNumber++}`;
            stagedRuns.set(id, {
              ...input.data,
              createdAt: now,
              id,
              results: [],
            });
            return { id };
          },
        },
        walletSelectionSettings: {
          update: async (input: {
            readonly data: { readonly currentSelectionRunId: string };
            readonly where: { readonly id: string };
          }) => {
            expect(input.where.id).toBe(settings.id);
            stagedCurrentRunId = input.data.currentSelectionRunId;
            return { ...settings, currentSelectionRunId: stagedCurrentRunId };
          },
        },
      };
      const result = await callback(transaction);
      runs = stagedRuns;
      settings.currentSelectionRunId = stagedCurrentRunId;
      return result;
    },
    dataSource: {
      upsert: async () => ({ id: "source-1" }),
    },
    walletAddress: {
      findFirst: async () => ({ id: "wallet-1" }),
      findMany: async (input: {
        readonly select?: {
          readonly metricCalculationRuns?: { readonly where?: { readonly trustState?: string } };
        };
      }) =>
        wallets.map((wallet) => ({
          ...wallet,
          metricCalculationRuns: wallet.metricCalculationRuns.filter(
            (run) =>
              input.select?.metricCalculationRuns?.where?.trustState === undefined ||
              run.trustState === input.select.metricCalculationRuns.where.trustState,
          ),
        })),
    },
    walletSelectionOverride: {
      upsert: async (input: {
        readonly create: {
          readonly decision: WalletSelectionOverrideDecision;
          readonly note: string | null;
          readonly walletAddressId: string;
        };
        readonly update: {
          readonly decision: WalletSelectionOverrideDecision;
          readonly note?: string | null;
        };
        readonly where: { readonly walletAddressId: string };
      }) => {
        const current = overrides.get(input.where.walletAddressId);
        const next = current
          ? { ...current, ...input.update }
          : { decision: input.create.decision, note: input.create.note };
        overrides.set(input.where.walletAddressId, next);
        return next;
      },
    },
    walletSelectionRun: {
      findFirst: async (input: {
        readonly where: { readonly id: string; readonly sourceId: string };
      }) => hydratedRun(runs.get(input.where.id)),
      findUnique: async (input: {
        readonly where: {
          readonly sourceId_policyVersion_inputFingerprint: {
            readonly inputFingerprint: string;
          };
        };
      }) => {
        const fingerprint = input.where.sourceId_policyVersion_inputFingerprint.inputFingerprint;
        return hydratedRun([...runs.values()].find((run) => run.inputFingerprint === fingerprint));
      },
    },
    walletSelectionSettings: {
      update: async (input: {
        readonly data: SettingsUpdateData;
        readonly where: { readonly id: string };
      }) => {
        expect(input.where.id).toBe(settings.id);
        if (input.data.maximumDrawdown !== undefined) {
          settings.maximumDrawdown = new Prisma.Decimal(input.data.maximumDrawdown);
        }
        if (input.data.maximumTopTradeContribution !== undefined) {
          settings.maximumTopTradeContribution = new Prisma.Decimal(
            input.data.maximumTopTradeContribution,
          );
        }
        if (input.data.minimumAnnualizedReturn !== undefined) {
          settings.minimumAnnualizedReturn = new Prisma.Decimal(input.data.minimumAnnualizedReturn);
        }
        if (input.data.currentSelectionRunId !== undefined) {
          settings.currentSelectionRunId = input.data.currentSelectionRunId;
        }
        if (input.data.maxAutoSelected !== undefined) {
          settings.maxAutoSelected = input.data.maxAutoSelected;
        }
        if (input.data.maximumDataAgeHours !== undefined) {
          settings.maximumDataAgeHours = input.data.maximumDataAgeHours;
        }
        if (input.data.minimumEvaluationDays !== undefined) {
          settings.minimumEvaluationDays = input.data.minimumEvaluationDays;
        }
        if (input.data.minimumTrustedClosedCycles !== undefined) {
          settings.minimumTrustedClosedCycles = input.data.minimumTrustedClosedCycles;
        }
        return { ...settings };
      },
      upsert: async () => ({ ...settings }),
    },
  };

  return {
    currentRunId: () => settings.currentSelectionRunId,
    failNextResultPersistence: () => {
      failResultPersistence = true;
    },
    service: new PrismaWalletSelectionService(database as unknown as PrismaClient, () => now),
  };
}

describe("PrismaWalletSelectionService evaluation period", () => {
  it("never consumes a quarantined SUCCEEDED run", async () => {
    const trusted = performanceFixture(
      new Date("2026-05-03T00:00:00.000Z"),
      new Date("2026-08-01T00:00:00.000Z"),
    );
    const harness = createHarness({
      ...trusted,
      trustRevision: 1,
      trustState: "QUARANTINED",
      trustTransitions: [{ revision: 1, toState: "QUARANTINED" }],
    });

    const evaluated = await harness.service.evaluate();

    expect(evaluated.items[0]).toMatchObject({
      performanceRunId: null,
    });
    expect(evaluated.items[0]?.automaticStatus).not.toBe("SELECTED");
  });

  it("reviews a 365-day run when the annualized-return metric covers only 60 days", async () => {
    const harness = createHarness(
      performanceFixture(
        new Date("2026-06-02T00:00:00.000Z"),
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    );

    const evaluated = await harness.service.evaluate();

    expect(evaluated.items[0]).toMatchObject({
      automaticStatus: "REVIEW",
      reasonCodes: ["EVALUATION_PERIOD_TOO_SHORT"],
    });
  });

  it("passes the evaluation-period condition at exactly 90 metric days", async () => {
    const harness = createHarness(
      performanceFixture(
        new Date("2026-05-03T00:00:00.000Z"),
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    );

    const evaluated = await harness.service.evaluate();

    expect(evaluated.items[0]).toMatchObject({ automaticStatus: "SELECTED", reasonCodes: [] });
  });

  it("fails closed when the annualized-return metric period is reversed", async () => {
    const harness = createHarness(
      performanceFixture(
        new Date("2026-08-02T00:00:00.000Z"),
        new Date("2026-08-01T00:00:00.000Z"),
      ),
    );

    const evaluated = await harness.service.evaluate();

    expect(evaluated.items[0]).toMatchObject({
      automaticStatus: "REVIEW",
      reasonCodes: ["EVALUATION_PERIOD_TOO_SHORT"],
    });
  });
});

describe("PrismaWalletSelectionService current run", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it("reactivates run A after evaluating A, B, then A", async () => {
    const runA = await harness.service.evaluate();
    await harness.service.updateSettings({ minimumAnnualizedReturn: "0.3" });
    const runB = await harness.service.evaluate();
    await harness.service.updateSettings({ minimumAnnualizedReturn: "0" });
    const reusedA = await harness.service.evaluate();

    expect(runA.run?.id).not.toBe(runB.run?.id);
    expect(reusedA).toMatchObject({ reused: true, run: { id: runA.run?.id } });
    await expect(harness.service.getCurrentSelection()).resolves.toMatchObject({
      run: { id: runA.run?.id },
    });
    await expect(harness.service.listEffectiveSelectedWallets()).resolves.toEqual([
      expect.objectContaining({ selectionRunId: runA.run?.id, walletAddressId: "wallet-1" }),
    ]);
  });

  it("returns the current run item after setting an override", async () => {
    const runA = await harness.service.evaluate();
    await harness.service.updateSettings({ minimumAnnualizedReturn: "0.3" });
    await harness.service.evaluate();
    await harness.service.updateSettings({ minimumAnnualizedReturn: "0" });
    await harness.service.evaluate();

    const item = await harness.service.setOverride(walletAddress, "EXCLUDE", "reviewed");

    expect(item).toMatchObject({
      automaticStatus: "SELECTED",
      effectiveStatus: "EXCLUDED",
      overrideNote: "reviewed",
      walletAddressId: "wallet-1",
    });
    expect(harness.currentRunId()).toBe(runA.run?.id);
  });

  it("does not switch the current pointer when new result persistence fails", async () => {
    const runA = await harness.service.evaluate();
    await harness.service.updateSettings({ minimumAnnualizedReturn: "0.3" });
    harness.failNextResultPersistence();

    await expect(harness.service.evaluate()).rejects.toThrow(
      "simulated result persistence failure",
    );
    expect(harness.currentRunId()).toBe(runA.run?.id);
    await expect(harness.service.getCurrentSelection()).resolves.toMatchObject({
      run: { id: runA.run?.id },
    });
  });
});

describe("PrismaWalletSelectionService settings initialization", () => {
  it("recovers when a concurrent settings upsert wins the unique race", async () => {
    const settings = {
      currentSelectionRunId: null,
      id: "settings-1",
      maxAutoSelected: 100,
      maximumDataAgeHours: 24,
      maximumDrawdown: new Prisma.Decimal("0.5"),
      maximumTopTradeContribution: new Prisma.Decimal("0.75"),
      minimumAnnualizedReturn: new Prisma.Decimal("0"),
      minimumEvaluationDays: 90,
      minimumTrustedClosedCycles: 20,
      sourceId: "source-1",
      updatedAt: now,
    };
    const database = {
      dataSource: { upsert: async () => ({ id: "source-1" }) },
      walletSelectionSettings: {
        findUniqueOrThrow: async () => settings,
        upsert: async () => {
          throw new Prisma.PrismaClientKnownRequestError("settings race", {
            clientVersion: "6.19.3",
            code: "P2002",
            meta: { target: ["source_id"] },
          });
        },
      },
    };
    const service = new PrismaWalletSelectionService(
      database as unknown as PrismaClient,
      () => now,
    );

    await expect(service.getSettings()).resolves.toMatchObject({
      maxAutoSelected: 100,
      policyVersion: "wallet-selection-v1",
    });
  });
});
