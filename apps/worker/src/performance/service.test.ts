import type { PerformanceHistoryCompleteness } from "@chaincopy/database";
import type { PerformanceJobData } from "@chaincopy/domain";
import { describe, expect, it } from "vitest";

import { PERFORMANCE_CALCULATION_VERSION } from "./constants.js";
import type { PerformanceRepositoryPort } from "./repository.js";
import { PerformanceCalculationService } from "./service.js";
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

  public constructor(private readonly input: PerformanceCalculationInput) {}

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
  it("persists Daily NAV, Position Cycles, metrics, warnings, and precision", async () => {
    const input = createInput(fixtureAddresses[0]);
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("SUCCEEDED");
    expect(repository.runs[0]?.status).toBe("SUCCEEDED");
    expect(repository.saved).toHaveLength(1);
    expect(repository.saved[0]?.completeness).toBe("COMPLETE");
    expect(repository.saved[0]?.result.dailyNavs).toHaveLength(31);
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

  it.each([
    {
      name: "a detected gap",
      overrides: { openIssueTypes: ["TRADE_HISTORY_GAP"] },
    },
    {
      name: "an unknown cash flow",
      overrides: {
        cashFlows: [
          {
            amount: "1",
            externalId: "cash-unknown",
            occurredAt: "2024-01-10T12:00:00.000Z",
            type: "mystery",
          },
        ],
      },
    },
  ])("records INSUFFICIENT_DATA without formal metrics for $name", async ({ overrides }) => {
    const input = createInput(fixtureAddresses[1], overrides);
    const repository = new FakePerformanceRepository(input);

    const result = await new PerformanceCalculationService(repository).process(createJob(input));

    expect(result.status).toBe("INSUFFICIENT_DATA");
    expect(repository.runs[0]?.status).toBe("INSUFFICIENT_DATA");
    expect(repository.saved).toHaveLength(0);
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
