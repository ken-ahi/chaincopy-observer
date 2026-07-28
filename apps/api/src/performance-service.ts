import { normalizeHyperliquidAddress } from "@chaincopy/blockchain-adapters";
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
} satisfies Prisma.MetricCalculationRunSelect;

type RunRow = Prisma.MetricCalculationRunGetPayload<{ select: typeof runSelect }>;

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
    ]);

    return {
      walletAddress: address,
      latestRun: latestRun ? toCalculationRunDto(latestRun) : null,
      latestSuccessfulRun: toCalculationRunDto(latestSuccessfulRun),
      latestFailedRun: latestFailedRun ? toCalculationRunDto(latestFailedRun) : null,
      metrics: Object.fromEntries(metrics.map((metric) => [metric.metricKey, toMetricDto(metric)])),
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
    return this.database.metricCalculationRun.findFirst({
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      select: runSelect,
      where: {
        walletAddressId,
        ...(status ? { status } : {}),
      },
    });
  }

  private async resolveRun(
    walletAddressId: string,
    runId: string | undefined,
  ): Promise<{ readonly id: string } | null> {
    const run = await this.database.metricCalculationRun.findFirst({
      select: { id: true },
      where: {
        walletAddressId,
        ...(runId ? { id: runId } : { status: "SUCCEEDED" }),
      },
      ...(!runId ? { orderBy: [{ requestedAt: "desc" as const }, { id: "desc" as const }] } : {}),
    });
    if (runId && !run) {
      throw new PerformanceRunNotFoundError(runId);
    }
    return run;
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
