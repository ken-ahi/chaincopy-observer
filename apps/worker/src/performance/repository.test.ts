import { type PrismaClient } from "@chaincopy/database";
import { describe, expect, it, vi } from "vitest";

import { PerformanceRepository } from "./repository.js";
import type { CreateRunInput, PerformanceRunRecord, SuccessfulPerformanceResult } from "./types.js";

const run: PerformanceRunRecord = {
  calculationVersion: "performance-v1",
  deduplicationKey: "wallet-1:performance-v1:fingerprint-1",
  id: "run-1",
  inputFingerprint: "fingerprint-1",
  status: "RUNNING",
  walletAddressId: "wallet-1",
};

const createRunInput: CreateRunInput = {
  calculationFrom: new Date("2024-01-01T00:00:00.000Z"),
  calculationTo: new Date("2024-01-31T23:59:59.999Z"),
  calculationVersion: "performance-v1",
  deduplicationKey: run.deduplicationKey,
  historyCompleteness: "COMPLETE",
  inputFingerprint: run.inputFingerprint,
  requestedAt: new Date("2026-07-26T12:00:00.000Z"),
  requestedBy: "phase4c-test",
  walletAddressId: run.walletAddressId,
};

const successfulResult: SuccessfulPerformanceResult = {
  cycles: [
    {
      averageEntryPrice: "100.000000000000000001",
      averageExitPrice: "110.000000000000000001",
      closedAt: new Date("2024-01-02T12:00:00.000Z"),
      coin: "BTC",
      entryQuantity: "1.000000000000000001",
      exitQuantity: "1.000000000000000001",
      fees: "0.000000000000000001",
      fillCount: 2,
      funding: "-0.000000000000000001",
      grossRealizedPnl: "10.000000000000000001",
      inputFingerprint: "cycle-fingerprint-1",
      netRealizedPnl: "9.999999999999999999",
      openedAt: new Date("2024-01-01T12:00:00.000Z"),
      side: "LONG",
      status: "CLOSED",
    },
  ],
  dailyNavs: [
    {
      date: new Date("2024-01-01T00:00:00.000Z"),
      externalCashFlow: null,
      fees: null,
      funding: null,
      nav: "10000000000000000000.000000000000000001",
      realizedPnl: null,
      unrealizedPnl: null,
    },
  ],
  metrics: [
    {
      metricKey: "twr",
      metricValue: "0.123456789012345678",
      status: "REFERENCE_ONLY",
      warningCodes: ["REFERENCE_ONLY"],
    },
  ],
  precision: "DERIVED",
  warnings: [
    {
      code: "PERP_ONLY_NAV",
      message: "Perpetuals-only NAV.",
    },
    {
      code: "PERP_ONLY_NAV",
      message: "Duplicate warning is normalized.",
    },
  ],
};

describe("PerformanceRepository", () => {
  it("pushes every time-series range into bounded repository queries", async () => {
    const calculationFrom = new Date("2024-01-01T00:00:00.000Z");
    const calculationTo = new Date("2024-01-31T23:59:59.999Z");
    const normalizedTradeFindMany = vi.fn(async () => []);
    const fundingFindMany = vi.fn(async () => []);
    const cashFlowFindMany = vi.fn(async () => []);
    const portfolioFindMany = vi.fn(async () => []);
    const positionFindFirst = vi.fn(async () => ({
      occurredAt: new Date("2024-01-31T23:00:00.000Z"),
    }));
    const positionFindMany = vi.fn(async () => []);
    const repository = new PerformanceRepository({
      cashFlow: { findMany: cashFlowFindMany },
      dataQualityIssue: { findMany: vi.fn(async () => []) },
      fundingPayment: { findMany: fundingFindMany },
      normalizedTrade: { findMany: normalizedTradeFindMany },
      perpPositionEvent: { findFirst: positionFindFirst, findMany: positionFindMany },
      portfolioSnapshot: { findMany: portfolioFindMany },
      syncCursor: { findMany: vi.fn(async () => []) },
      walletAddress: {
        findUnique: vi.fn(async () => ({
          address: "0x1111111111111111111111111111111111111111",
          id: "wallet-1",
        })),
      },
    } as unknown as PrismaClient);

    await repository.loadInput("wallet-1", calculationFrom, calculationTo);

    const range = { gte: calculationFrom, lte: calculationTo };
    expect(normalizedTradeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5_000,
        where: { occurredAt: range, walletAddressId: "wallet-1" },
      }),
    );
    expect(fundingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5_000,
        where: { occurredAt: range, walletAddressId: "wallet-1" },
      }),
    );
    expect(cashFlowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5_000,
        where: { occurredAt: range, walletAddressId: "wallet-1" },
      }),
    );
    expect(portfolioFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 5_000,
        where: expect.objectContaining({ capturedAt: range, walletAddressId: "wallet-1" }),
      }),
    );
    expect(positionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { occurredAt: range, walletAddressId: "wallet-1" } }),
    );
    expect(positionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1_001,
        where: {
          occurredAt: new Date("2024-01-31T23:00:00.000Z"),
          walletAddressId: "wallet-1",
        },
      }),
    );
  });

  it("loads only one bounded position boundary snapshot when the window has no events", async () => {
    const calculationFrom = new Date("2024-01-01T00:00:00.000Z");
    const calculationTo = new Date("2024-01-31T23:59:59.999Z");
    const boundary = new Date("2023-12-31T23:59:00.000Z");
    const positionFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ occurredAt: boundary });
    const positionFindMany = vi.fn(async () => []);
    const emptyFindMany = vi.fn(async () => []);
    const repository = new PerformanceRepository({
      cashFlow: { findMany: emptyFindMany },
      dataQualityIssue: { findMany: emptyFindMany },
      fundingPayment: { findMany: emptyFindMany },
      normalizedTrade: { findMany: emptyFindMany },
      perpPositionEvent: { findFirst: positionFindFirst, findMany: positionFindMany },
      portfolioSnapshot: { findMany: emptyFindMany },
      syncCursor: { findMany: emptyFindMany },
      walletAddress: {
        findUnique: vi.fn(async () => ({
          address: "0x1111111111111111111111111111111111111111",
          id: "wallet-1",
        })),
      },
    } as unknown as PrismaClient);

    await repository.loadInput("wallet-1", calculationFrom, calculationTo);

    expect(positionFindFirst).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { occurredAt: { lt: calculationFrom }, walletAddressId: "wallet-1" },
      }),
    );
    expect(positionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 1_001,
        where: { occurredAt: boundary, walletAddressId: "wallet-1" },
      }),
    );
  });

  it("creates or resumes a PENDING run by its stable deduplication key", async () => {
    const upsert = vi.fn(async () => ({ ...run, status: "PENDING" as const }));
    const repository = new PerformanceRepository({
      metricCalculationRun: { upsert },
    } as unknown as PrismaClient);

    await expect(repository.createOrResumeRun(createRunInput)).resolves.toMatchObject({
      id: run.id,
      status: "PENDING",
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          deduplicationKey: run.deduplicationKey,
          historyCompleteness: "COMPLETE",
          status: "PENDING",
        }),
        update: {},
        where: { deduplicationKey: run.deduplicationKey },
      }),
    );
  });

  it("requires one PENDING or RUNNING row for the RUNNING transition", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PerformanceRepository({
      metricCalculationRun: { updateMany },
    } as unknown as PrismaClient);

    await expect(repository.markRunning(run.id)).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RUNNING" }),
        where: {
          id: run.id,
          status: { in: ["PENDING", "RUNNING"] },
        },
      }),
    );

    updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.markRunning(run.id)).rejects.toThrow("cannot transition to RUNNING");
  });

  it.each([
    {
      method: "markInsufficient" as const,
      status: "INSUFFICIENT_DATA",
    },
    {
      method: "markFailed" as const,
      status: "FAILED",
    },
  ])(
    "records terminal $status runs and releases their stable dedup key",
    async ({ method, status }) => {
      const update = vi.fn(async () => undefined);
      const repository = new PerformanceRepository({
        metricCalculationRun: { update },
      } as unknown as PrismaClient);

      if (method === "markInsufficient") {
        await repository.markInsufficient(run, "DATA_GAP", "Gap detected.", [
          "DATA_GAP",
          "DATA_GAP",
        ]);
      } else {
        await repository.markFailed(run, "CALCULATION_FAILED", "Failed.");
      }

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            deduplicationKey: expect.stringContaining(`:${status.toLowerCase()}:${run.id}`),
            status,
          }),
          where: { id: run.id },
        }),
      );
    },
  );

  it("stores Decimal strings and commits SUCCEEDED only after all result rows", async () => {
    const dailyNavCreateMany = vi.fn(async () => ({ count: 1 }));
    const positionCycleCreateMany = vi.fn(async () => ({ count: 1 }));
    const metricCreateMany = vi.fn(async () => ({ count: 1 }));
    const runUpdateMany = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      addressPerformanceMetric: { createMany: metricCreateMany },
      dailyNav: { createMany: dailyNavCreateMany },
      metricCalculationRun: { updateMany: runUpdateMany },
      positionCycle: { createMany: positionCycleCreateMany },
    };
    const database = {
      $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<void>) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient;
    const repository = new PerformanceRepository(database);

    await repository.saveSuccessful(
      run,
      "COMPLETE",
      successfulResult,
      createRunInput.calculationFrom,
      createRunInput.calculationTo,
    );

    expect(dailyNavCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          historyCompleteness: "COMPLETE",
          nav: "10000000000000000000.000000000000000001",
          precision: "DERIVED",
        }),
      ],
    });
    expect(positionCycleCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          netRealizedPnl: "9.999999999999999999",
          walletAddressId: run.walletAddressId,
        }),
      ],
    });
    expect(metricCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          metricValue: "0.123456789012345678",
          status: "REFERENCE_ONLY",
          warningCodes: ["REFERENCE_ONLY"],
        }),
      ],
    });
    expect(runUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          precision: "DERIVED",
          status: "SUCCEEDED",
          warningCodes: ["PERP_ONLY_NAV"],
          warningCount: 1,
        }),
        where: { id: run.id, status: "RUNNING" },
      }),
    );
  });

  it("does not mark a run SUCCEEDED when a child write fails", async () => {
    const runUpdateMany = vi.fn(async () => ({ count: 1 }));
    const transaction = {
      addressPerformanceMetric: { createMany: vi.fn(async () => ({ count: 1 })) },
      dailyNav: {
        createMany: vi.fn(async () => {
          throw new Error("daily NAV write failed");
        }),
      },
      metricCalculationRun: { updateMany: runUpdateMany },
      positionCycle: { createMany: vi.fn(async () => ({ count: 1 })) },
    };
    const repository = new PerformanceRepository({
      $transaction: vi.fn(async (callback: (client: typeof transaction) => Promise<void>) =>
        callback(transaction),
      ),
    } as unknown as PrismaClient);

    await expect(
      repository.saveSuccessful(
        run,
        "COMPLETE",
        successfulResult,
        createRunInput.calculationFrom,
        createRunInput.calculationTo,
      ),
    ).rejects.toThrow("daily NAV write failed");
    expect(runUpdateMany).not.toHaveBeenCalled();
  });
});
