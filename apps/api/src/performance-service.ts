import { normalizeHyperliquidAddress } from "@chaincopy/blockchain-adapters";
import {
  analyzeTrustedTradeHistory,
  buildPositionCycles,
  classifyCashFlowInput,
  classifyStoredCashFlowInput,
  type CalculationCoverage,
  type CashFlowInput,
  type FillInput,
  type FundingInput,
} from "@chaincopy/analytics";
import {
  type MetricCalculationStatus,
  type PerformanceHistoryCompleteness,
  type PerformanceMetricStatus,
  type PerformancePrecision,
  type PositionCycleStatus,
  Prisma,
  type PrismaClient,
} from "@chaincopy/database";
import {
  createPerformanceJobFingerprint,
  hyperliquidJobPriorities,
  performanceCalculationVersion,
  performanceJobNames,
  type PerformanceJobData,
} from "@chaincopy/domain";
import { type Queue } from "bullmq";

import { AddressNotFoundError } from "./address-service.js";
import {
  assertPerformanceRunTrustConsistency,
  findCurrentTrustedPerformanceRunId,
  performanceRunTrustSelect,
  PerformanceRunTrustInconsistentError,
} from "./performance-run-trust.js";

export interface CalculationRunDto {
  readonly runId: string;
  readonly status: MetricCalculationStatus;
  readonly calculationVersion: string;
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly historyCompleteness: PerformanceHistoryCompleteness;
  readonly precision: PerformancePrecision | null;
  readonly warningCount: number;
  readonly warningCodes: ReadonlyArray<string>;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly inputFingerprint: string;
  readonly inputFingerprintShort: string;
  readonly trustRevision: number;
  readonly trustState: "TRUSTED" | "QUARANTINED";
  readonly latestTrustTransition: {
    readonly actor: string;
    readonly createdAt: string;
    readonly fromState: "TRUSTED" | "QUARANTINED";
    readonly incidentRef: string | null;
    readonly reasonCode: string;
    readonly reasonDetail: string | null;
    readonly revision: number;
    readonly toState: "TRUSTED" | "QUARANTINED";
  } | null;
}

export interface MetricDto {
  readonly metricKey: string;
  readonly metricValue: string;
  readonly precision: PerformancePrecision;
  readonly status: PerformanceMetricStatus;
  readonly warningCodes: ReadonlyArray<string>;
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly metricVersion: string;
}

export interface DailyNavDto {
  readonly id: string;
  readonly runId: string;
  readonly date: string;
  readonly nav: string;
  readonly cashBalance: string | null;
  readonly unrealizedPnl: string | null;
  readonly realizedPnl: string | null;
  readonly funding: string | null;
  readonly fees: string | null;
  readonly externalCashFlow: string | null;
  readonly precision: PerformancePrecision;
  readonly historyCompleteness: PerformanceHistoryCompleteness;
}

export interface PositionCycleDto {
  readonly id: string;
  readonly runId: string;
  readonly coin: string;
  readonly side: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly averageEntryPrice: string;
  readonly averageExitPrice: string | null;
  readonly entryQuantity: string;
  readonly exitQuantity: string;
  readonly grossRealizedPnl: string;
  readonly fees: string;
  readonly funding: string;
  readonly netRealizedPnl: string;
  readonly fillCount: number;
  readonly status: PositionCycleStatus;
  readonly inputFingerprint: string;
}

export interface PerformanceOverviewDto {
  readonly availability: PerformanceAvailabilityDto;
  readonly calculationDetails: PerformanceCalculationDetailsDto;
  readonly walletAddress: string;
  readonly latestRun: CalculationRunDto | null;
  readonly latestSuccessfulRun: CalculationRunDto | null;
  readonly latestFailedRun: CalculationRunDto | null;
  readonly metrics: Readonly<Record<string, MetricDto>>;
  readonly navSummary: {
    readonly count: number;
    readonly firstDate: string | null;
    readonly lastDate: string | null;
    readonly firstNav: string | null;
    readonly lastNav: string | null;
    readonly minNav: string | null;
    readonly maxNav: string | null;
  };
  readonly cycleSummary: {
    readonly total: number;
    readonly open: number;
    readonly closed: number;
    readonly profitable: number;
    readonly losing: number;
  };
}

export type MetricAvailabilityStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export interface MetricGroupAvailabilityDto {
  readonly from: string | null;
  readonly reasons: ReadonlyArray<string>;
  readonly status: MetricAvailabilityStatus;
  readonly to: string | null;
}

export interface PerformanceAvailabilityDto {
  readonly exposure: MetricGroupAvailabilityDto;
  readonly return: MetricGroupAvailabilityDto;
  readonly trade: MetricGroupAvailabilityDto;
}

export interface TradePrefixDto {
  readonly coin: string;
  readonly skippedFillCount: number;
  readonly skippedFrom: string;
  readonly trustedFrom: string | null;
}

export interface PerformanceCalculationDetailsDto {
  readonly excludedFillCount: number;
  readonly excludedFundingCount: number;
  readonly navGapCount: number;
  readonly tradePrefixes: ReadonlyArray<TradePrefixDto>;
  readonly trustedClosedCycleCount: number;
  readonly unknownCashFlowCount: number;
}

export interface PerformancePage<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}

export interface PerformanceCalculationRequestDto {
  readonly jobId: string;
  readonly status: "QUEUED";
  readonly force: boolean;
  readonly walletAddress: string;
  readonly calculationVersion: string;
}

export interface PerformancePageQuery {
  readonly cursor?: string;
  readonly limit: number;
}

export interface PerformanceRunPageQuery extends PerformancePageQuery {
  readonly runId?: string;
}

export interface PerformanceService {
  calculate(address: string): Promise<PerformanceCalculationRequestDto>;
  recalculate(address: string): Promise<PerformanceCalculationRequestDto>;
  getOverview(address: string): Promise<PerformanceOverviewDto>;
  listRuns(
    address: string,
    query: PerformancePageQuery,
  ): Promise<PerformancePage<CalculationRunDto>>;
  getRun(address: string, runId: string): Promise<CalculationRunDto>;
  listNav(address: string, query: PerformanceRunPageQuery): Promise<PerformancePage<DailyNavDto>>;
  listCycles(
    address: string,
    query: PerformanceRunPageQuery,
  ): Promise<PerformancePage<PositionCycleDto>>;
}

export class PerformanceRunNotFoundError extends Error {
  public constructor(runId: string) {
    super(`Performance calculation run ${runId} was not found.`);
    this.name = "PerformanceRunNotFoundError";
  }
}

export class PerformanceCursorError extends Error {
  public constructor() {
    super("The pagination cursor is invalid for this resource.");
    this.name = "PerformanceCursorError";
  }
}

export class PerformanceCalculationConflictError extends Error {
  public constructor() {
    super("A performance calculation is already pending or running for this address and period.");
    this.name = "PerformanceCalculationConflictError";
  }
}

const runSelect = {
  calculationFrom: true,
  calculationTo: true,
  calculationVersion: true,
  completedAt: true,
  errorCode: true,
  errorMessage: true,
  historyCompleteness: true,
  id: true,
  inputFingerprint: true,
  precision: true,
  requestedAt: true,
  startedAt: true,
  status: true,
  warningCodes: true,
  warningCount: true,
  ...performanceRunTrustSelect,
} satisfies Prisma.MetricCalculationRunSelect;

const PERFORMANCE_FALLBACK_VERSION = "performance-v2";
const PERFORMANCE_READ_VERSION_PRIORITY = [
  performanceCalculationVersion,
  PERFORMANCE_FALLBACK_VERSION,
] as const;

type RunRow = Prisma.MetricCalculationRunGetPayload<{ select: typeof runSelect }>;

interface CalculationDetailsInput {
  readonly cashFlows: readonly CashFlowInput[];
  readonly fills: readonly FillInput[];
  readonly funding: readonly FundingInput[];
  readonly navDates: readonly string[];
}

export class PrismaPerformanceService implements PerformanceService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly queue: Queue<PerformanceJobData>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public calculate(address: string): Promise<PerformanceCalculationRequestDto> {
    return this.enqueueCalculation(address, false);
  }

  public recalculate(address: string): Promise<PerformanceCalculationRequestDto> {
    return this.enqueueCalculation(address, true);
  }

  public async getOverview(addressInput: string): Promise<PerformanceOverviewDto> {
    const address = normalizeHyperliquidAddress(addressInput);
    const wallet = await this.findAddress(address);
    const [latestRun, latestSuccessfulRun, latestFailedRun] = await Promise.all([
      this.findLatestRun(wallet.id),
      this.findLatestRun(wallet.id, "SUCCEEDED"),
      this.findLatestRun(wallet.id, "FAILED"),
    ]);

    if (!latestSuccessfulRun) {
      return {
        availability: emptyAvailability(latestRun?.warningCodes ?? []),
        calculationDetails: emptyCalculationDetails(),
        walletAddress: address,
        latestRun: latestRun ? toCalculationRunDto(latestRun) : null,
        latestSuccessfulRun: null,
        latestFailedRun: latestFailedRun ? toCalculationRunDto(latestFailedRun) : null,
        metrics: {},
        navSummary: emptyNavSummary(),
        cycleSummary: emptyCycleSummary(),
      };
    }

    const runId = latestSuccessfulRun.id;
    const zero = new Prisma.Decimal("0");
    const [
      metrics,
      navAggregate,
      firstNav,
      lastNav,
      totalCycles,
      openCycles,
      closedCycles,
      profitableCycles,
      losingCycles,
      calculationInputs,
    ] = await Promise.all([
      this.database.addressPerformanceMetric.findMany({
        orderBy: { metricKey: "asc" },
        where: {
          calculationRunId: runId,
          walletAddressId: wallet.id,
        },
      }),
      this.database.dailyNav.aggregate({
        _count: true,
        _max: { nav: true },
        _min: { nav: true },
        where: {
          calculationRunId: runId,
          walletAddressId: wallet.id,
        },
      }),
      this.database.dailyNav.findFirst({
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: { date: true, nav: true },
        where: {
          calculationRunId: runId,
          walletAddressId: wallet.id,
        },
      }),
      this.database.dailyNav.findFirst({
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: { date: true, nav: true },
        where: {
          calculationRunId: runId,
          walletAddressId: wallet.id,
        },
      }),
      this.database.positionCycle.count({
        where: {
          calculationRunId: runId,
          walletAddressId: wallet.id,
        },
      }),
      this.database.positionCycle.count({
        where: {
          calculationRunId: runId,
          status: "OPEN",
          walletAddressId: wallet.id,
        },
      }),
      this.database.positionCycle.count({
        where: {
          calculationRunId: runId,
          status: "CLOSED",
          walletAddressId: wallet.id,
        },
      }),
      this.database.positionCycle.count({
        where: {
          calculationRunId: runId,
          netRealizedPnl: { gt: zero },
          status: "CLOSED",
          walletAddressId: wallet.id,
        },
      }),
      this.database.positionCycle.count({
        where: {
          calculationRunId: runId,
          netRealizedPnl: { lt: zero },
          status: "CLOSED",
          walletAddressId: wallet.id,
        },
      }),
      this.loadCalculationDetailsInput(wallet.id, address, latestSuccessfulRun),
    ]);

    const metricDtos = metrics.map(toMetricDto);
    const availability = deriveAvailability(metricDtos, latestSuccessfulRun);
    const calculationDetails = deriveCalculationDetails(
      calculationInputs,
      latestSuccessfulRun,
      closedCycles,
    );

    return {
      availability,
      calculationDetails,
      walletAddress: address,
      latestRun: latestRun ? toCalculationRunDto(latestRun) : null,
      latestSuccessfulRun: toCalculationRunDto(latestSuccessfulRun),
      latestFailedRun: latestFailedRun ? toCalculationRunDto(latestFailedRun) : null,
      metrics: Object.fromEntries(metricDtos.map((metric) => [metric.metricKey, metric])),
      navSummary: {
        count: navAggregate._count,
        firstDate: firstNav?.date.toISOString() ?? null,
        lastDate: lastNav?.date.toISOString() ?? null,
        firstNav: firstNav?.nav.toString() ?? null,
        lastNav: lastNav?.nav.toString() ?? null,
        minNav: navAggregate._min.nav?.toString() ?? null,
        maxNav: navAggregate._max.nav?.toString() ?? null,
      },
      cycleSummary: {
        total: totalCycles,
        open: openCycles,
        closed: closedCycles,
        profitable: profitableCycles,
        losing: losingCycles,
      },
    };
  }

  public async listRuns(
    addressInput: string,
    query: PerformancePageQuery,
  ): Promise<PerformancePage<CalculationRunDto>> {
    const wallet = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    if (query.cursor) {
      await this.assertRunCursor(wallet.id, query.cursor);
    }
    const rows = await this.database.metricCalculationRun.findMany({
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      select: runSelect,
      take: query.limit + 1,
      where: { walletAddressId: wallet.id },
    });
    return toPage(rows, query.limit, toCalculationRunDto);
  }

  public async getRun(addressInput: string, runId: string): Promise<CalculationRunDto> {
    const wallet = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const run = await this.database.metricCalculationRun.findFirst({
      select: runSelect,
      where: {
        id: runId,
        walletAddressId: wallet.id,
      },
    });
    if (!run) {
      throw new PerformanceRunNotFoundError(runId);
    }
    return toCalculationRunDto(run);
  }

  public async listNav(
    addressInput: string,
    query: PerformanceRunPageQuery,
  ): Promise<PerformancePage<DailyNavDto>> {
    const wallet = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const run = await this.resolveRun(wallet.id, query.runId);
    if (!run) {
      return { items: [], nextCursor: null };
    }
    if (query.cursor) {
      const cursor = await this.database.dailyNav.findFirst({
        select: { id: true },
        where: {
          calculationRunId: run.id,
          id: query.cursor,
          walletAddressId: wallet.id,
        },
      });
      if (!cursor) {
        throw new PerformanceCursorError();
      }
    }
    const rows = await this.database.dailyNav.findMany({
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ date: "asc" }, { id: "asc" }],
      take: query.limit + 1,
      where: {
        calculationRunId: run.id,
        walletAddressId: wallet.id,
      },
    });
    return toPage(rows, query.limit, toDailyNavDto);
  }

  public async listCycles(
    addressInput: string,
    query: PerformanceRunPageQuery,
  ): Promise<PerformancePage<PositionCycleDto>> {
    const wallet = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const run = await this.resolveRun(wallet.id, query.runId);
    if (!run) {
      return { items: [], nextCursor: null };
    }
    if (query.cursor) {
      const cursor = await this.database.positionCycle.findFirst({
        select: { id: true },
        where: {
          calculationRunId: run.id,
          id: query.cursor,
          walletAddressId: wallet.id,
        },
      });
      if (!cursor) {
        throw new PerformanceCursorError();
      }
    }
    const rows = await this.database.positionCycle.findMany({
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ openedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      where: {
        calculationRunId: run.id,
        walletAddressId: wallet.id,
      },
    });
    return toPage(rows, query.limit, toPositionCycleDto);
  }

  private async loadCalculationDetailsInput(
    walletAddressId: string,
    walletAddress: string,
    run: RunRow,
  ): Promise<CalculationDetailsInput> {
    const range = { gte: run.calculationFrom, lte: run.calculationTo };
    const [fills, funding, cashFlows, navSnapshots] = await Promise.all([
      this.database.normalizedTrade.findMany({
        orderBy: [{ occurredAt: "asc" }, { externalTradeId: "asc" }],
        select: {
          closedPnl: true,
          coin: true,
          externalTradeId: true,
          fee: true,
          occurredAt: true,
          price: true,
          side: true,
          size: true,
          startPosition: true,
        },
        where: { occurredAt: range, walletAddressId },
      }),
      this.database.fundingPayment.findMany({
        orderBy: [{ occurredAt: "asc" }, { externalPaymentId: "asc" }],
        select: {
          amount: true,
          coin: true,
          externalPaymentId: true,
          occurredAt: true,
        },
        where: { occurredAt: range, walletAddressId },
      }),
      this.database.cashFlow.findMany({
        orderBy: [{ occurredAt: "asc" }, { externalFlowId: "asc" }],
        select: {
          amount: true,
          externalFlowId: true,
          flowType: true,
          occurredAt: true,
          rawPayload: true,
          usdValue: true,
        },
        where: { occurredAt: range, walletAddressId },
      }),
      this.database.portfolioSnapshot.findMany({
        orderBy: [{ capturedAt: "asc" }, { fingerprint: "asc" }],
        select: { accountValue: true, capturedAt: true },
        where: { accountValue: { not: null }, capturedAt: range, walletAddressId },
      }),
    ]);
    return {
      cashFlows: cashFlows.map((flow) => {
        const classified = classifyStoredCashFlowInput({
          amount: flow.usdValue?.toString() ?? flow.amount?.toString() ?? null,
          rawPayload: flow.rawPayload,
          type: flow.flowType,
          walletAddress,
        });
        return {
          amount: classified.amount,
          boundary: classified.boundary,
          externalId: flow.externalFlowId,
          occurredAt: flow.occurredAt.toISOString(),
          type: flow.flowType,
        };
      }),
      fills: fills.map((fill) => ({
        closedPnl: fill.closedPnl.toString(),
        coin: fill.coin,
        externalId: fill.externalTradeId,
        fee: fill.fee.toString(),
        occurredAt: fill.occurredAt.toISOString(),
        price: fill.price.toString(),
        side: fill.side,
        size: fill.size.toString(),
        startPosition: fill.startPosition.toString(),
      })),
      funding: funding.map((item) => ({
        amount: item.amount.toString(),
        coin: item.coin,
        externalId: item.externalPaymentId,
        occurredAt: item.occurredAt.toISOString(),
      })),
      navDates: navSnapshots.map((snapshot) => snapshot.capturedAt.toISOString().slice(0, 10)),
    };
  }

  private async enqueueCalculation(
    addressInput: string,
    force: boolean,
  ): Promise<PerformanceCalculationRequestDto> {
    const address = normalizeHyperliquidAddress(addressInput);
    const wallet = await this.database.walletAddress.findFirst({
      select: { createdAt: true, id: true },
      where: {
        address,
        isWatched: true,
        source: { kind: "HYPERLIQUID" },
      },
    });
    if (!wallet) {
      throw new AddressNotFoundError(address);
    }
    const range = await resolvePerformanceCalculationRange(
      this.database,
      wallet.id,
      wallet.createdAt,
    );
    const calculationFrom = range.calculationFrom.toISOString();
    const calculationTo = range.calculationTo.toISOString();
    const existingRun = await this.database.metricCalculationRun.findFirst({
      select: { id: true },
      where: {
        calculationFrom: range.calculationFrom,
        calculationTo: range.calculationTo,
        calculationVersion: performanceCalculationVersion,
        status: { in: ["PENDING", "RUNNING"] },
        walletAddressId: wallet.id,
      },
    });
    const queuedJobs = await this.queue.getJobs(
      ["active", "waiting", "delayed", "prioritized"],
      0,
      100,
      true,
    );
    if (
      existingRun ||
      queuedJobs.some(
        (job) =>
          job.data.walletAddressId === wallet.id &&
          job.data.calculationFrom === calculationFrom &&
          job.data.calculationTo === calculationTo &&
          job.data.calculationVersion === performanceCalculationVersion,
      )
    ) {
      throw new PerformanceCalculationConflictError();
    }

    const requestedAt = this.now().toISOString();
    const data: PerformanceJobData = {
      calculationFrom,
      calculationTo,
      calculationVersion: performanceCalculationVersion,
      force,
      requestedAt,
      requestedBy: "admin-api",
      walletAddressId: wallet.id,
    };
    const name = force ? performanceJobNames.recalculate : performanceJobNames.calculate;
    const fingerprint = createPerformanceJobFingerprint({
      calculationFrom,
      calculationTo,
      calculationVersion: performanceCalculationVersion,
      walletAddressId: wallet.id,
      ...(force ? { requestedAt } : {}),
    });
    const jobId = `${name}-${fingerprint}`;
    const job = await this.queue.add(name, data, {
      attempts: 3,
      backoff: { delay: 5_000, type: "exponential" },
      jobId,
      priority: hyperliquidJobPriorities.addressPerformance,
      removeOnComplete: { age: 24 * 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60, count: 2_000 },
    });
    return {
      calculationVersion: performanceCalculationVersion,
      force,
      jobId: job.id ?? jobId,
      status: "QUEUED",
      walletAddress: address,
    };
  }

  private async findAddress(address: string) {
    const wallet = await this.database.walletAddress.findFirst({
      select: { id: true },
      where: {
        address,
        source: { kind: "HYPERLIQUID" },
      },
    });
    if (!wallet) {
      throw new AddressNotFoundError(address);
    }
    return wallet;
  }

  private async findLatestRun(
    walletAddressId: string,
    status?: MetricCalculationStatus,
  ): Promise<RunRow | null> {
    for (const calculationVersion of PERFORMANCE_READ_VERSION_PRIORITY) {
      if (status === "SUCCEEDED") {
        const runId = await findCurrentTrustedPerformanceRunId(this.database, {
          calculationVersion,
          walletAddressId,
        });
        if (!runId) continue;
        const trustedRun = await this.database.metricCalculationRun.findUnique({
          select: runSelect,
          where: { id: runId },
        });
        if (!trustedRun) throw new PerformanceRunTrustInconsistentError(runId);
        assertPerformanceRunTrustConsistency(trustedRun.id, trustedRun);
        if (trustedRun.trustState !== "TRUSTED") {
          throw new PerformanceRunTrustInconsistentError(trustedRun.id);
        }
        return trustedRun;
      }
      const run = await this.database.metricCalculationRun.findFirst({
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        select: runSelect,
        where: { calculationVersion, walletAddressId, ...(status ? { status } : {}) },
      });
      if (run) return run;
    }
    return null;
  }

  private async resolveRun(
    walletAddressId: string,
    runId: string | undefined,
  ): Promise<{ readonly id: string } | null> {
    if (runId) {
      const run = await this.database.metricCalculationRun.findFirst({
        select: { id: true },
        where: { id: runId, walletAddressId },
      });
      if (!run) throw new PerformanceRunNotFoundError(runId);
      return run;
    }

    for (const calculationVersion of PERFORMANCE_READ_VERSION_PRIORITY) {
      const runId = await findCurrentTrustedPerformanceRunId(this.database, {
        calculationVersion,
        walletAddressId,
      });
      if (runId) return { id: runId };
    }
    return null;
  }

  private async assertRunCursor(walletAddressId: string, cursor: string): Promise<void> {
    const row = await this.database.metricCalculationRun.findFirst({
      select: { id: true },
      where: {
        id: cursor,
        walletAddressId,
      },
    });
    if (!row) {
      throw new PerformanceCursorError();
    }
  }
}

async function resolvePerformanceCalculationRange(
  database: PrismaClient,
  walletAddressId: string,
  registeredAt: Date,
): Promise<{ readonly calculationFrom: Date; readonly calculationTo: Date }> {
  const [fills, funding, cashFlows, snapshots, positions, cursors] = await Promise.all([
    database.normalizedTrade.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.fundingPayment.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.cashFlow.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.portfolioSnapshot.aggregate({
      _max: { capturedAt: true },
      _min: { capturedAt: true },
      where: { walletAddressId },
    }),
    database.perpPositionEvent.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.syncCursor.aggregate({
      _max: { lastSuccessfulAt: true, lastTimestamp: true },
      where: { walletAddressId },
    }),
  ]);
  const earliestInput = minimumDate([
    fills._min.occurredAt,
    funding._min.occurredAt,
    cashFlows._min.occurredAt,
    snapshots._min.capturedAt,
    positions._min.occurredAt,
  ]);
  const latestInput = maximumDate([
    fills._max.occurredAt,
    funding._max.occurredAt,
    cashFlows._max.occurredAt,
    snapshots._max.capturedAt,
    positions._max.occurredAt,
  ]);
  const calculationFrom = earliestInput ?? registeredAt;
  const fallbackTo =
    maximumDate([cursors._max.lastTimestamp, cursors._max.lastSuccessfulAt]) ?? calculationFrom;
  const calculationTo = latestInput ?? fallbackTo;
  return {
    calculationFrom,
    calculationTo: calculationTo < calculationFrom ? calculationFrom : calculationTo,
  };
}

function minimumDate(values: ReadonlyArray<Date | null>): Date | null {
  return values.reduce<Date | null>(
    (current, value) => (!value || (current && current <= value) ? current : value),
    null,
  );
}

function maximumDate(values: ReadonlyArray<Date | null>): Date | null {
  return values.reduce<Date | null>(
    (current, value) => (!value || (current && current >= value) ? current : value),
    null,
  );
}

function toCalculationRunDto(run: RunRow): CalculationRunDto {
  const transition = run.trustTransitions[0] ?? null;
  return {
    runId: run.id,
    status: run.status,
    calculationVersion: run.calculationVersion,
    calculationFrom: run.calculationFrom.toISOString(),
    calculationTo: run.calculationTo.toISOString(),
    requestedAt: run.requestedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    historyCompleteness: run.historyCompleteness,
    precision: run.precision,
    warningCount: run.warningCount,
    warningCodes: run.warningCodes,
    errorCode: run.errorCode,
    errorMessage: sanitizeErrorMessage(run.errorMessage),
    inputFingerprint: run.inputFingerprint,
    inputFingerprintShort: run.inputFingerprint.slice(0, 12),
    trustRevision: run.trustRevision,
    trustState: run.trustState,
    latestTrustTransition: transition
      ? {
          actor: transition.actor,
          createdAt: transition.createdAt.toISOString(),
          fromState: transition.fromState,
          incidentRef: transition.incidentRef,
          reasonCode: transition.reasonCode,
          reasonDetail: transition.reasonDetail,
          revision: transition.revision,
          toState: transition.toState,
        }
      : null,
  };
}

function toMetricDto(row: {
  readonly metricKey: string;
  readonly metricValue: Prisma.Decimal;
  readonly precision: PerformancePrecision;
  readonly status: PerformanceMetricStatus;
  readonly warningCodes: ReadonlyArray<string>;
  readonly calculationFrom: Date;
  readonly calculationTo: Date;
  readonly metricVersion: string;
}): MetricDto {
  return {
    metricKey: row.metricKey,
    metricValue: row.metricValue.toString(),
    precision: row.precision,
    status: row.status,
    warningCodes: row.warningCodes,
    calculationFrom: row.calculationFrom.toISOString(),
    calculationTo: row.calculationTo.toISOString(),
    metricVersion: row.metricVersion,
  };
}

function toDailyNavDto(row: {
  readonly id: string;
  readonly calculationRunId: string;
  readonly date: Date;
  readonly nav: Prisma.Decimal;
  readonly cashBalance: Prisma.Decimal | null;
  readonly unrealizedPnl: Prisma.Decimal | null;
  readonly realizedPnl: Prisma.Decimal | null;
  readonly funding: Prisma.Decimal | null;
  readonly fees: Prisma.Decimal | null;
  readonly externalCashFlow: Prisma.Decimal | null;
  readonly precision: PerformancePrecision;
  readonly historyCompleteness: PerformanceHistoryCompleteness;
}): DailyNavDto {
  return {
    id: row.id,
    runId: row.calculationRunId,
    date: row.date.toISOString(),
    nav: row.nav.toString(),
    cashBalance: row.cashBalance?.toString() ?? null,
    unrealizedPnl: row.unrealizedPnl?.toString() ?? null,
    realizedPnl: row.realizedPnl?.toString() ?? null,
    funding: row.funding?.toString() ?? null,
    fees: row.fees?.toString() ?? null,
    externalCashFlow: row.externalCashFlow?.toString() ?? null,
    precision: row.precision,
    historyCompleteness: row.historyCompleteness,
  };
}

function toPositionCycleDto(row: {
  readonly id: string;
  readonly calculationRunId: string;
  readonly coin: string;
  readonly side: string;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly averageEntryPrice: Prisma.Decimal;
  readonly averageExitPrice: Prisma.Decimal | null;
  readonly entryQuantity: Prisma.Decimal;
  readonly exitQuantity: Prisma.Decimal;
  readonly grossRealizedPnl: Prisma.Decimal;
  readonly fees: Prisma.Decimal;
  readonly funding: Prisma.Decimal;
  readonly netRealizedPnl: Prisma.Decimal;
  readonly fillCount: number;
  readonly status: PositionCycleStatus;
  readonly inputFingerprint: string;
}): PositionCycleDto {
  return {
    id: row.id,
    runId: row.calculationRunId,
    coin: row.coin,
    side: row.side,
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    averageEntryPrice: row.averageEntryPrice.toString(),
    averageExitPrice: row.averageExitPrice?.toString() ?? null,
    entryQuantity: row.entryQuantity.toString(),
    exitQuantity: row.exitQuantity.toString(),
    grossRealizedPnl: row.grossRealizedPnl.toString(),
    fees: row.fees.toString(),
    funding: row.funding.toString(),
    netRealizedPnl: row.netRealizedPnl.toString(),
    fillCount: row.fillCount,
    status: row.status,
    inputFingerprint: row.inputFingerprint,
  };
}

function toPage<Row extends { readonly id: string }, Item>(
  rows: ReadonlyArray<Row>,
  limit: number,
  map: (row: Row) => Item,
): PerformancePage<Item> {
  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(map),
    nextCursor: hasNextPage ? (pageRows.at(-1)?.id ?? null) : null,
  };
}

function emptyNavSummary(): PerformanceOverviewDto["navSummary"] {
  return {
    count: 0,
    firstDate: null,
    lastDate: null,
    firstNav: null,
    lastNav: null,
    minNav: null,
    maxNav: null,
  };
}

function emptyCycleSummary(): PerformanceOverviewDto["cycleSummary"] {
  return {
    total: 0,
    open: 0,
    closed: 0,
    profitable: 0,
    losing: 0,
  };
}

const tradeMetricKeys = new Set([
  "averageLoss",
  "averageWin",
  "maxLosingStreak",
  "profitFactor",
  "topTradeContribution",
  "winRate",
]);
const returnMetricKeys = new Set([
  "annualizedReturn",
  "calmarRatio",
  "cumulativeReturn",
  "maxDrawdown",
  "sharpeRatio",
  "sortinoRatio",
  "twr",
  "volatility",
]);
const exposureMetricKeys = new Set([
  "averageLeverage",
  "concentrationIndex",
  "largestCoinShare",
  "maxLeverage",
  "medianLeverage",
  "percentile95Leverage",
]);

function deriveAvailability(
  metrics: readonly MetricDto[],
  run: RunRow,
): PerformanceAvailabilityDto {
  const trade = metrics.filter((metric) => tradeMetricKeys.has(metric.metricKey));
  const returns = metrics.filter((metric) => returnMetricKeys.has(metric.metricKey));
  const exposure = metrics.filter((metric) => exposureMetricKeys.has(metric.metricKey));
  return {
    exposure: groupAvailability(
      exposure,
      exposure.length > 0 && exposure.length < exposureMetricKeys.size ? "PARTIAL" : "AVAILABLE",
      exposure.length === 0 ? relevantReasons(run.warningCodes, exposureReasonCodes) : [],
    ),
    return: groupAvailability(
      returns,
      run.warningCodes.some((code) => returnPartialReasonCodes.has(code)) ? "PARTIAL" : "AVAILABLE",
      relevantReasons(run.warningCodes, returnReasonCodes),
    ),
    trade: groupAvailability(
      trade,
      run.warningCodes.includes("TRADE_HISTORY_PREFIX_SKIPPED") ? "PARTIAL" : "AVAILABLE",
      relevantReasons(
        run.warningCodes,
        trade.length > 0 ? tradeAvailableReasonCodes : tradeReasonCodes,
      ),
    ),
  };
}

function groupAvailability(
  metrics: readonly MetricDto[],
  availableStatus: Extract<MetricAvailabilityStatus, "AVAILABLE" | "PARTIAL">,
  reasons: readonly string[],
): MetricGroupAvailabilityDto {
  if (metrics.length === 0) {
    return { from: null, reasons, status: "UNAVAILABLE", to: null };
  }
  const from = metrics
    .map((metric) => metric.calculationFrom)
    .sort()
    .at(0);
  const to = metrics
    .map((metric) => metric.calculationTo)
    .sort()
    .at(-1);
  return {
    from: from ?? null,
    reasons,
    status: availableStatus,
    to: to ?? null,
  };
}

const tradeReasonCodes = new Set([
  "INSUFFICIENT_HISTORY",
  "POSITION_DISCONTINUITY",
  "TRADE_HISTORY_PREFIX_SKIPPED",
  "UNALLOCATED_FUNDING",
]);
const tradeAvailableReasonCodes = new Set(["TRADE_HISTORY_PREFIX_SKIPPED", "UNALLOCATED_FUNDING"]);
const returnReasonCodes = new Set([
  "CALCULATION_WINDOW_ADJUSTED",
  "DATA_GAP",
  "INSUFFICIENT_HISTORY",
  "MISSING_CASH_FLOW_BOUNDARY_NAV",
  "NON_POSITIVE_NAV",
  "RETURN_PERIOD_TRUNCATED_AT_GAP",
  "UNKNOWN_CASH_FLOW",
]);
const returnPartialReasonCodes = new Set([
  "CALCULATION_WINDOW_ADJUSTED",
  "RETURN_PERIOD_TRUNCATED_AT_GAP",
]);
const exposureReasonCodes = new Set(["INSUFFICIENT_HISTORY", "INVALID_INPUT"]);

function relevantReasons(
  warningCodes: readonly string[],
  accepted: ReadonlySet<string>,
): readonly string[] {
  return [...new Set(warningCodes.filter((code) => accepted.has(code)))].sort();
}

function emptyAvailability(warningCodes: readonly string[]): PerformanceAvailabilityDto {
  return {
    exposure: {
      from: null,
      reasons: relevantReasons(warningCodes, exposureReasonCodes),
      status: "UNAVAILABLE",
      to: null,
    },
    return: {
      from: null,
      reasons: relevantReasons(warningCodes, returnReasonCodes),
      status: "UNAVAILABLE",
      to: null,
    },
    trade: {
      from: null,
      reasons: relevantReasons(warningCodes, tradeReasonCodes),
      status: "UNAVAILABLE",
      to: null,
    },
  };
}

function deriveCalculationDetails(
  input: CalculationDetailsInput,
  run: RunRow,
  trustedClosedCycleCount: number,
): PerformanceCalculationDetailsDto {
  const trusted = analyzeTrustedTradeHistory(input.fills);
  const tradePrefixes = trusted.ok ? trusted.value.prefixes : [];
  const allocatedFills = new Set<string>();
  const allocatedFunding = new Set<string>();
  const coverage: CalculationCoverage = {
    calculationFrom: run.calculationFrom.toISOString(),
    calculationTo: run.calculationTo.toISOString(),
    completeness: run.historyCompleteness === "COMPLETE" ? "COMPLETE" : "PARTIAL",
    initialStateKnown: true,
  };
  for (const coin of [...new Set(input.fills.map((fill) => fill.coin))].sort()) {
    const cycles = buildPositionCycles(
      input.fills.filter((fill) => fill.coin === coin),
      input.funding.filter((item) => item.coin === coin),
      coverage,
    );
    if (!cycles.ok) continue;
    for (const cycle of cycles.value) {
      for (const fill of cycle.fills) {
        allocatedFills.add(fill.externalId);
      }
      for (const funding of cycle.fundingEvents) {
        allocatedFunding.add(funding.externalId);
      }
    }
  }
  const unknownCashFlowCount = input.cashFlows.reduce((count, cashFlow) => {
    try {
      return classifyCashFlowInput(cashFlow).isExternal === null ? count + 1 : count;
    } catch {
      return count + 1;
    }
  }, 0);
  return {
    excludedFillCount: input.fills.filter((fill) => !allocatedFills.has(fill.externalId)).length,
    excludedFundingCount: input.funding.filter(
      (funding) => !allocatedFunding.has(funding.externalId),
    ).length,
    navGapCount: countNavGaps(input.navDates),
    tradePrefixes,
    trustedClosedCycleCount,
    unknownCashFlowCount,
  };
}

function countNavGaps(navDates: readonly string[]): number {
  const dates = [...new Set(navDates)].sort();
  let count = 0;
  for (let index = 1; index < dates.length; index += 1) {
    const previous = dates[index - 1];
    const current = dates[index];
    if (!previous || !current) continue;
    const difference =
      (Date.parse(`${current}T00:00:00.000Z`) - Date.parse(`${previous}T00:00:00.000Z`)) /
      86_400_000;
    if (difference > 1) count += 1;
  }
  return count;
}

function emptyCalculationDetails(): PerformanceCalculationDetailsDto {
  return {
    excludedFillCount: 0,
    excludedFundingCount: 0,
    navGapCount: 0,
    tradePrefixes: [],
    trustedClosedCycleCount: 0,
    unknownCashFlowCount: 0,
  };
}

function sanitizeErrorMessage(message: string | null): string | null {
  const firstLine = message?.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) {
    return null;
  }
  return firstLine
    .replace(/([a-z][a-z0-9+.-]*:\/\/)([^@\s/]+)@/giu, "$1[REDACTED]@")
    .replace(/\b(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/giu, "$1=[REDACTED]")
    .slice(0, 500);
}
