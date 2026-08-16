import type { PerformanceHistoryCompleteness } from "@chaincopy/database";
import type { PerformanceJobData } from "@chaincopy/domain";
import * as analytics from "@chaincopy/analytics";
import { describe, expect, it, vi } from "vitest";

import { PERFORMANCE_CALCULATION_VERSION } from "./constants.js";
import type { PerformanceRepositoryPort } from "./repository.js";
import { metricPeriod, PerformanceCalculationService } from "./service.js";
import type {
  CreateRunInput,
  PerformanceCalculationInput,
  PerformanceRunRecord,
  SuccessfulPerformanceResult,
} from "./types.js";

const fixtureAddresses = [
  "0x1111111111111111111111111111111111111111",
  "0x2222222222222222222222222222222222222222",
  "0x831ea8a4a4d7ea2657ba48f8c074d69bdaece05c",
] as const;

class FakePerformanceRepository implements PerformanceRepositoryPort {
  public readonly saved: Array<{
    readonly calculationFrom: Date;
    readonly calculationTo: Date;
    readonly completeness: PerformanceHistoryCompleteness;
    readonly result: SuccessfulPerformanceResult;
    readonly run: PerformanceRunRecord;
  }> = [];
  public readonly runs: PerformanceRunRecord[] = [];
  public failSave = false;

  public constructor(public input: PerformanceCalculationInput) {}

  public async loadInput(): Promise<PerformanceCalculationInput> {
    return this.input;
  }

  public async findReusableRun(
    walletAddressId: string,
    calculationVersion: string,
    inputFingerprint: string,
  ): Promise<PerformanceRunRecord | null> {
    return (
      this.runs.find(
        (run) =>
          run.walletAddressId === walletAddressId &&
          run.calculationVersion === calculationVersion &&
          run.inputFingerprint === inputFingerprint &&
          run.status === "SUCCEEDED",
      ) ?? null
    );
  }

  public async createOrResumeRun(input: CreateRunInput): Promise<PerformanceRunRecord> {
    const existing = this.runs.find((run) => run.deduplicationKey === input.deduplicationKey);
    if (existing) {
      return existing;
    }
    const run: PerformanceRunRecord = {
      calculationVersion: input.calculationVersion,
      deduplicationKey: input.deduplicationKey,
      id: `run-${this.runs.length + 1}`,
      inputFingerprint: input.inputFingerprint,
      status: "PENDING",
      walletAddressId: input.walletAddressId,
    };
    this.runs.push(run);
    return run;
  }

  public async markRunning(runId: string): Promise<void> {
    this.replaceStatus(runId, "RUNNING");
  }

  public async markInsufficient(
    run: PerformanceRunRecord,
    _errorCode: string,
    _errorMessage: string,
    _warningCodes: readonly string[],
  ): Promise<void> {
    this.replaceStatus(run.id, "INSUFFICIENT_DATA");
  }

  public async markFailed(
    run: PerformanceRunRecord,
    _errorCode: string,
    _errorMessage: string,
  ): Promise<void> {
    this.replaceStatus(run.id, "FAILED");
  }

  public async saveSuccessful(
    run: PerformanceRunRecord,
    completeness: PerformanceHistoryCompleteness,
    result: SuccessfulPerformanceResult,
    calculationFrom: Date,
    calculationTo: Date,
  ): Promise<void> {
    if (this.failSave) {
      throw new Error("transaction rolled back");
    }
    this.saved.push({
      calculationFrom,
      calculationTo,
      completeness,
      result,
      run,
    });
    this.replaceStatus(run.id, "SUCCEEDED");
  }

  private replaceStatus(runId: string, status: PerformanceRunRecord["status"]): void {
    const index = this.runs.findIndex((run) => run.id === runId);
    const current = this.runs[index];
    if (!current) {
      throw new Error(`Unknown run ${runId}.`);
    }
    this.runs.splice(index, 1, { ...current, status });
  }
}

function createInput(
  address: string,
  overrides: Partial<PerformanceCalculationInput> = {},
): PerformanceCalculationInput {
  const navSnapshots = Array.from({ length: 31 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const nav = (100n + BigInt(index)).toString();
    return {
      externalId: `nav-${day}`,
      nav,
      occurredAt: `2024-01-${day}T23:59:59.000Z`,
      scope: "PERP" as const,
    };
  });
  const accountSnapshots = navSnapshots.map((snapshot, index) => ({
    equity: snapshot.nav,
    externalId: `account-${snapshot.externalId}`,
    grossNotional: (200n + BigInt(index)).toString(),
    occurredAt: snapshot.occurredAt,
  }));

  return {
    accountSnapshots,
    cashFlows: [],
    fills: [
      {
        closedPnl: "0",
        coin: "BTC",
        externalId: "fill-open",
        fee: "0.1",
        occurredAt: "2024-01-01T12:00:00.000Z",
        price: "100",
        side: "BUY",
        size: "1",
        startPosition: "0",
      },
      {
        closedPnl: "10",
        coin: "BTC",
        externalId: "fill-close",
        fee: "0.1",
        occurredAt: "2024-01-02T12:00:00.000Z",
        price: "110",
        side: "SELL",
        size: "1",
        startPosition: "1",
      },
    ],
    funding: [],
    navSnapshots,
    openIssueTypes: [],
    positionSnapshots: [
      {
        coin: "BTC",
        externalId: "position-btc",
        notional: "60",
        occurredAt: "2024-01-31T23:59:59.000Z",
      },
      {
        coin: "ETH",
        externalId: "position-eth",
        notional: "40",
        occurredAt: "2024-01-31T23:59:59.000Z",
      },
    ],
    syncCursorStatuses: ["SUCCEEDED"],
    walletAddress: address,
    walletAddressId: `wallet-${address.slice(-4)}`,
    ...overrides,
  };
}

function createJob(input: PerformanceCalculationInput): PerformanceJobData {
  return {
    calculationFrom: "2024-01-01T00:00:00.000Z",
    calculationTo: "2024-01-31T23:59:59.999Z",
    calculationVersion: PERFORMANCE_CALCULATION_VERSION,
    force: false,
    requestedAt: "2026-07-26T12:00:00.000Z",
    requestedBy: "phase4c-test",
    walletAddressId: input.walletAddressId,
  };
}

describe("PerformanceCalculationService", () => {
  it("calculates metric periods without argument spreading for very large histories", () => {
    const timestamps = Array.from({ length: 200_000 }, (_, index) =>
      new Date(Date.UTC(2024, 0, 1) + index * 1_000).toISOString(),
    );

    expect(metricPeriod(timestamps, timestamps)).toEqual({
      from: new Date("2024-01-01T00:00:00.000Z"),
      to: new Date(Date.UTC(2024, 0, 1) + 199_999 * 1_000),
    });
  });

  it("persists Daily NAV, Position Cycles, metrics, warnings, and precision", async () => {
    const input = createInput(fixtureAddresses[0]);
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.runs[0]?.status).toBe("SUCCEEDED");
    expect(repository.runs[0]?.calculationVersion).toBe("performance-v3");
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.completeness).toBe("COMPLETE");
    expect(repository.saved[0]?.result.dailyNavs).toHaveLength(31);
    expect(repository.saved[0]?.result.dailyNavs[0]?.nav).toBe("100");
    expect(repository.saved[0]?.result.dailyNavs.at(-1)?.nav).toBe("130");
    expect(repository.saved[0]?.result.cycles).toHaveLength(1);
    expect(repository.saved[0]?.result.precision).toBe("DERIVED");
    expect(repository.saved[0]?.result.warnings.map((warning) => warning.code)).toContain(
      "PERP_ONLY_NAV",
    );
    expect(repository.saved[0]?.result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ metricKey: "twr" }),
        expect.objectContaining({
          metricKey: "annualizedReturn",
          status: "REFERENCE_ONLY",
        }),
        expect.objectContaining({ metricKey: "winRate", metricValue: "1" }),
        expect.objectContaining({
          metricKey: "concentrationIndex",
          metricValue: "0.52",
        }),
      ]),
    );
    expect(
      repository.saved[0]?.result.metrics.every((metric) =>
        /^-?(?:\d+|\d+\.\d+)$/.test(metric.metricValue),
      ),
    ).toBe(true);
    const twr = repository.saved[0]?.result.metrics.find((metric) => metric.metricKey === "twr");
    const cumulativeReturn = repository.saved[0]?.result.metrics.find(
      (metric) => metric.metricKey === "cumulativeReturn",
    );
    const maxDrawdown = repository.saved[0]?.result.metrics.find(
      (metric) => metric.metricKey === "maxDrawdown",
    );
    expect(maxDrawdown).toMatchObject({
      calculationFrom: new Date("2024-01-01T23:59:59.000Z"),
      calculationTo: new Date("2024-01-31T23:59:59.000Z"),
      metricValue: "0",
    });
    expect(maxDrawdown?.warningCodes).toEqual(twr?.warningCodes);
    expect(maxDrawdown?.warningCodes).toEqual(cumulativeReturn?.warningCodes);
  });

  it("passes a TWR wealth index, not raw Daily NAV, into Max Drawdown", async () => {
    const input = createInput(fixtureAddresses[0]);
    const repository = new FakePerformanceRepository(input);
    const drawdownSpy = vi.spyOn(analytics, "calculateMaxDrawdown");

    await new PerformanceCalculationService(repository).process(createJob(input));

    const wealthPoints = drawdownSpy.mock.calls[0]?.[0];
    expect(wealthPoints?.[0]).toEqual({
      externalId: "twr-wealth:0",
      nav: "1",
      occurredAt: "2024-01-01T23:59:59.000Z",
      sequence: 0,
    });
    expect(wealthPoints?.at(-1)).toMatchObject({ nav: "1.3", sequence: 30 });
    drawdownSpy.mockRestore();
  });

  it("reuses a successful run for the same fingerprint", async () => {
    const input = createInput(fixtureAddresses[0]);
    const repository = new FakePerformanceRepository(input);
    const service = new PerformanceCalculationService(repository);
    const job = createJob(input);

    const first = await service.process(job);
    const duplicate = await service.process({
      ...job,
      requestedAt: "2026-07-26T12:05:00.000Z",
    });

    expect(duplicate).toMatchObject({
      calculationRunId: first.calculationRunId,
      reused: true,
      status: "SUCCEEDED",
    });
    expect(repository.runs).toHaveLength(1);
    expect(repository.saved).toHaveLength(1);
  });

  it("creates a new run when force is true", async () => {
    const input = createInput(fixtureAddresses[0]);
    const repository = new FakePerformanceRepository(input);
    const service = new PerformanceCalculationService(repository);
    const job = createJob(input);

    await service.process(job);
    const forced = await service.process({
      ...job,
      force: true,
      requestedAt: "2026-07-26T12:05:00.000Z",
    });

    expect(forced.reused).toBe(false);
    expect(repository.runs).toHaveLength(2);
    expect(repository.saved).toHaveLength(2);
  });

  it("keeps a successful v2 run and creates a separate v3 run", async () => {
    const input = createInput(fixtureAddresses[0]);
    const repository = new FakePerformanceRepository(input);
    repository.runs.push({
      calculationVersion: "performance-v2",
      deduplicationKey: "v2-deduplication-key",
      id: "run-v2",
      inputFingerprint: "v2-input-fingerprint",
      status: "SUCCEEDED",
      walletAddressId: input.walletAddressId,
    });

    await new PerformanceCalculationService(repository).process(createJob(input));

    expect(repository.runs).toEqual([
      expect.objectContaining({ calculationVersion: "performance-v2", id: "run-v2" }),
      expect.objectContaining({ calculationVersion: "performance-v3", id: "run-2" }),
    ]);
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.run.calculationVersion).toBe("performance-v3");
  });

  it("creates a new performance-v3 run after a result-affecting input is added", async () => {
    const input = createInput(fixtureAddresses[0]);
    const repository = new FakePerformanceRepository(input);
    const service = new PerformanceCalculationService(repository);
    const job = createJob(input);

    await service.process(job);
    repository.input = {
      ...input,
      funding: [
        ...input.funding,
        {
          amount: "1",
          coin: "BTC",
          externalId: "new-funding",
          occurredAt: "2024-01-01T18:00:00.000Z",
        },
      ],
    };
    const recalculated = await service.process({
      ...job,
      requestedAt: "2026-07-26T12:10:00.000Z",
    });

    expect(PERFORMANCE_CALCULATION_VERSION).toBe("performance-v3");
    expect(recalculated.reused).toBe(false);
    expect(repository.runs).toHaveLength(2);
    expect(repository.runs[0]?.inputFingerprint).not.toBe(repository.runs[1]?.inputFingerprint);
  });

  it("keeps Trade and Exposure metrics when an unknown cash flow disables Return metrics", async () => {
    const input = createInput(fixtureAddresses[1], {
      cashFlows: [
        {
          amount: "1",
          externalId: "cash-unknown",
          occurredAt: "2024-01-10T12:00:00.000Z",
          type: "mystery",
        },
      ],
    });
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.runs[0]?.status).toBe("SUCCEEDED");
    expect(repository.saved[0]?.result.metrics.map((metric) => metric.metricKey)).toEqual(
      expect.arrayContaining(["winRate", "medianLeverage", "concentrationIndex"]),
    );
    expect(repository.saved[0]?.result.metrics.map((metric) => metric.metricKey)).not.toContain(
      "twr",
    );
    expect(repository.saved[0]?.result.metrics.map((metric) => metric.metricKey)).not.toContain(
      "maxDrawdown",
    );
    expect(repository.saved[0]?.result.cycles).toHaveLength(1);
    expect(
      repository.saved[0]?.result.metrics.find((metric) => metric.metricKey === "winRate")
        ?.metricValue,
    ).toBe("1");
    expect(
      repository.saved[0]?.result.metrics.find((metric) => metric.metricKey === "medianLeverage")
        ?.metricValue,
    ).toBe("1.8695652173913043478260869565217391304347826086956521739130434782608695652173913");
    expect(repository.saved[0]?.result.warnings.map((warning) => warning.code)).toContain(
      "UNKNOWN_CASH_FLOW",
    );
  });

  it("recovers trusted completed cycles after a PARTIAL opening prefix", async () => {
    const input = createInput(fixtureAddresses[1], {
      fills: [
        {
          closedPnl: "1",
          coin: "BTC",
          externalId: "prefix-close",
          fee: "0.1",
          occurredAt: "2024-01-01T08:00:00.000Z",
          price: "100",
          side: "SELL",
          size: "1",
          startPosition: "1",
        },
        {
          closedPnl: "0",
          coin: "BTC",
          externalId: "trusted-open",
          fee: "0.1",
          occurredAt: "2024-01-02T08:00:00.000Z",
          price: "100",
          side: "BUY",
          size: "1",
          startPosition: "0",
        },
        {
          closedPnl: "10",
          coin: "BTC",
          externalId: "trusted-close",
          fee: "0.1",
          occurredAt: "2024-01-03T08:00:00.000Z",
          price: "110",
          side: "SELL",
          size: "1",
          startPosition: "1",
        },
      ],
    });
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.saved[0]?.completeness).toBe("PARTIAL");
    expect(repository.saved[0]?.result.cycles).toHaveLength(1);
    expect(repository.saved[0]?.result.metrics).toEqual(
      expect.arrayContaining([expect.objectContaining({ metricKey: "winRate", metricValue: "1" })]),
    );
    expect(repository.saved[0]?.result.warnings.map((warning) => warning.code)).toContain(
      "TRADE_HISTORY_PREFIX_SKIPPED",
    );
  });

  it("keeps Exposure metrics when Trade and Return inputs are unavailable", async () => {
    const input = createInput(fixtureAddresses[1], {
      cashFlows: [],
      fills: [],
      funding: [],
      navSnapshots: [],
    });
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.saved[0]?.result.metrics.map((metric) => metric.metricKey)).toEqual(
      expect.arrayContaining(["medianLeverage", "concentrationIndex"]),
    );
  });

  it("uses INSUFFICIENT_DATA only when every metric group is unavailable", async () => {
    const input = createInput(fixtureAddresses[1], {
      accountSnapshots: [],
      cashFlows: [],
      fills: [],
      funding: [],
      navSnapshots: [],
      positionSnapshots: [],
    });
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(repository.runs[0]?.status).toBe("INSUFFICIENT_DATA");
    expect(repository.saved).toHaveLength(0);
  });

  it("records an adjusted Return window when the first NAV is later on the requested UTC day", async () => {
    const input = createInput(fixtureAddresses[1]);
    const repository = new FakePerformanceRepository(input);

    await new PerformanceCalculationService(repository).process(createJob(input));

    expect(
      repository.saved[0]?.result.warnings.find(
        (warning) => warning.code === "CALCULATION_WINDOW_ADJUSTED",
      )?.details,
    ).toMatchObject({
      effectiveFrom: "2024-01-01T23:59:59.000Z",
      requestedFrom: "2024-01-01T00:00:00.000Z",
    });
  });

  it("adjusts a late NAV start without blocking other lanes", async () => {
    const original = createInput(fixtureAddresses[1]);
    const input = createInput(fixtureAddresses[1], {
      navSnapshots: original.navSnapshots.slice(1),
    });
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.saved[0]?.result.metrics.map((metric) => metric.metricKey)).toContain("twr");
    expect(repository.saved[0]?.result.warnings.map((warning) => warning.code)).toContain(
      "CALCULATION_WINDOW_ADJUSTED",
    );
    expect(
      repository.saved[0]?.result.metrics.find((metric) => metric.metricKey === "twr")
        ?.calculationFrom,
    ).toEqual(new Date("2024-01-02T23:59:59.000Z"));
  });

  it("stops Return at an initial NAV gap while preserving Trade and Exposure", async () => {
    const original = createInput(fixtureAddresses[1]);
    const input = createInput(fixtureAddresses[1], {
      navSnapshots: original.navSnapshots.filter(
        (snapshot) =>
          snapshot.occurredAt.startsWith("2024-01-01") ||
          snapshot.occurredAt.startsWith("2024-01-03"),
      ),
    });
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.saved[0]?.result.metrics.map((metric) => metric.metricKey)).toContain(
      "winRate",
    );
    expect(repository.saved[0]?.result.metrics.map((metric) => metric.metricKey)).not.toContain(
      "twr",
    );
    expect(repository.saved[0]?.result.warnings.map((warning) => warning.code)).toContain(
      "RETURN_PERIOD_TRUNCATED_AT_GAP",
    );
  });

  it("keeps Trade and Exposure when external cash flow boundary NAV is missing", async () => {
    const input = createInput(fixtureAddresses[1], {
      cashFlows: [
        {
          amount: "10",
          boundary: "EXTERNAL",
          externalId: "deposit",
          occurredAt: "2024-01-10T12:00:00.000Z",
          type: "deposit",
        },
      ],
    });
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.runs[0]?.status).toBe("SUCCEEDED");
    expect(repository.saved).toHaveLength(1);
    const metricKeys = repository.saved[0]?.result.metrics.map((metric) => metric.metricKey) ?? [];
    const returnMetricKeys: readonly string[] = [
      "twr",
      "cumulativeReturn",
      "maxDrawdown",
      "annualizedReturn",
      "volatility",
      "sharpeRatio",
      "sortinoRatio",
      "calmarRatio",
    ];
    expect(metricKeys.filter((metricKey) => returnMetricKeys.includes(metricKey))).toEqual([]);
    expect(metricKeys).not.toContain("maxDrawdown");
    expect(metricKeys).toEqual(
      expect.arrayContaining(["winRate", "medianLeverage", "concentrationIndex"]),
    );
    expect(repository.saved[0]?.result.cycles).toHaveLength(1);
    expect(
      repository.saved[0]?.result.warnings.find(
        (warning) => warning.code === "MISSING_CASH_FLOW_BOUNDARY_NAV",
      ),
    ).toMatchObject({
      code: "MISSING_CASH_FLOW_BOUNDARY_NAV",
      message: "Cash flow deposit requires before/after NAV and an amount.",
    });
    expect(repository.saved[0]?.result.warnings.map((warning) => warning.code)).not.toContain(
      "UNKNOWN_CASH_FLOW",
    );
  });

  it("records FAILED and does not report success when transactional persistence fails", async () => {
    const input = createInput(fixtureAddresses[1]);
    const repository = new FakePerformanceRepository(input);
    repository.failSave = true;

    await expect(
      new PerformanceCalculationService(repository).process(createJob(input)),
    ).rejects.toThrow("transaction rolled back");
    expect(repository.runs[0]?.status).toBe("FAILED");
    expect(repository.saved).toHaveLength(0);
  });

  it("calculates only the two fixed fixtures and the existing public test address", async () => {
    const results = await Promise.all(
      fixtureAddresses.map(async (address) => {
        const input = createInput(address);
        const repository = new FakePerformanceRepository(input);
        const result = await new PerformanceCalculationService(repository).process(
          createJob(input),
        );
        return {
          address,
          dailyNavCount: repository.saved[0]?.result.dailyNavs.length,
          metricCount: result.metricCount,
          positionCycleCount: repository.saved[0]?.result.cycles.length,
          status: result.status,
        };
      }),
    );

    expect(results).toEqual([
      {
        address: fixtureAddresses[0],
        dailyNavCount: 31,
        metricCount: 16,
        positionCycleCount: 1,
        status: "SUCCEEDED",
      },
      {
        address: fixtureAddresses[1],
        dailyNavCount: 31,
        metricCount: 16,
        positionCycleCount: 1,
        status: "SUCCEEDED",
      },
      {
        address: fixtureAddresses[2],
        dailyNavCount: 31,
        metricCount: 16,
        positionCycleCount: 1,
        status: "SUCCEEDED",
      },
    ]);
  });
});
