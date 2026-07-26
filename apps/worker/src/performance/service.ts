import { createHash } from "node:crypto";

import {
  buildPositionCycles,
  calculateAnnualizedReturn,
  calculateCalmar,
  calculateCoinConcentration,
  calculateDailyNav,
  calculateLeverageMetrics,
  calculateMaxDrawdown,
  calculateSharpe,
  calculateSortino,
  calculateTradeStatistics,
  calculateTwr,
  calculateVolatility,
  normalizeCashFlows,
  parseDecimalString,
  splitReturnPeriodsAtCashFlows,
  type CalculationCoverage,
  type CalculationResult,
  type CalculationWarning,
  type DataCompleteness,
  type PositionCycle,
} from "@chaincopy/analytics";
import type { PerformanceJobData } from "@chaincopy/domain";

import { PERFORMANCE_CALCULATION_VERSION } from "./constants.js";
import { createPerformanceInputFingerprint } from "./fingerprint.js";
import type { PerformanceRepositoryPort } from "./repository.js";
import type {
  PerformanceCalculationInput,
  PerformanceProcessResult,
  PerformanceRunRecord,
  PersistedMetric,
  PersistedPositionCycle,
  PositionSnapshotInput,
  SuccessfulPerformanceResult,
} from "./types.js";

export class PerformanceCalculationService {
  public constructor(private readonly repository: PerformanceRepositoryPort) {}

  public async process(job: PerformanceJobData): Promise<PerformanceProcessResult> {
    validateJob(job);
    const calculationFrom = new Date(job.calculationFrom);
    const calculationTo = new Date(job.calculationTo);
    const input = await this.repository.loadInput(
      job.walletAddressId,
      calculationFrom,
      calculationTo,
    );
    const completeness = assessHistoryCompleteness(input, job.calculationFrom);
    const inputFingerprint = createPerformanceInputFingerprint({
      calculationFrom: job.calculationFrom,
      calculationTo: job.calculationTo,
      calculationVersion: job.calculationVersion,
      historyCompleteness: completeness,
      input,
    });

    if (!job.force) {
      const reusable = await this.repository.findReusableRun(
        job.walletAddressId,
        job.calculationVersion,
        inputFingerprint,
      );
      if (reusable) {
        return resultForRun(reusable, true, 0);
      }
    }

    const baseDeduplicationKey = [
      job.walletAddressId,
      job.calculationVersion,
      inputFingerprint,
    ].join(":");
    const run = await this.repository.createOrResumeRun({
      calculationFrom,
      calculationTo,
      calculationVersion: job.calculationVersion,
      deduplicationKey: job.force
        ? `${baseDeduplicationKey}:force:${job.requestedAt}`
        : baseDeduplicationKey,
      historyCompleteness: completeness,
      inputFingerprint,
      requestedAt: new Date(job.requestedAt),
      requestedBy: job.requestedBy,
      walletAddressId: job.walletAddressId,
    });
    if (run.status === "SUCCEEDED") {
      return resultForRun(run, true, 0);
    }

    await this.repository.markRunning(run.id);
    try {
      const calculated = calculatePerformance(input, job, completeness);
      if (!calculated.ok) {
        await this.repository.markInsufficient(
          run,
          calculated.errorCode,
          calculated.errorMessage,
          calculated.warningCodes,
        );
        return {
          calculationRunId: run.id,
          inputFingerprint,
          metricCount: 0,
          reused: false,
          status: "INSUFFICIENT_DATA",
        };
      }

      await this.repository.saveSuccessful(
        run,
        completeness,
        calculated.result,
        calculationFrom,
        calculationTo,
      );
      return {
        calculationRunId: run.id,
        inputFingerprint,
        metricCount: calculated.result.metrics.length,
        reused: false,
        status: "SUCCEEDED",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Performance calculation failed.";
      await this.repository.markFailed(run, "CALCULATION_FAILED", message);
      throw error;
    }
  }
}

interface CalculationSuccess {
  readonly ok: true;
  readonly result: SuccessfulPerformanceResult;
}

interface CalculationInsufficient {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly ok: false;
  readonly warningCodes: readonly string[];
}

type PerformanceCalculationOutcome = CalculationSuccess | CalculationInsufficient;

function calculatePerformance(
  input: PerformanceCalculationInput,
  job: PerformanceJobData,
  completeness: DataCompleteness,
): PerformanceCalculationOutcome {
  const coverage: CalculationCoverage = {
    calculationFrom: job.calculationFrom,
    calculationTo: job.calculationTo,
    completeness,
    initialStateKnown: completeness !== "PARTIAL",
  };
  const warnings: CalculationWarning[] = [];

  const normalizedCashFlows = normalizeCashFlows(input.cashFlows);
  if (!normalizedCashFlows.ok) {
    return insufficient(normalizedCashFlows, warnings);
  }
  warnings.push(...normalizedCashFlows.warnings);

  const cycles = buildPositionCycles(input.fills, input.funding, coverage);
  if (!cycles.ok) {
    return insufficient(cycles, warnings);
  }
  warnings.push(...cycles.warnings);

  const dailyNav = calculateDailyNav(input.navSnapshots, coverage);
  if (!dailyNav.ok) {
    return insufficient(dailyNav, warnings);
  }
  warnings.push(...dailyNav.warnings);

  const returnPeriods = splitReturnPeriodsAtCashFlows(
    dailyNav.value.map((point) => ({
      externalId: `daily-nav:${point.date}`,
      nav: point.nav,
      occurredAt: point.occurredAt,
    })),
    normalizedCashFlows.value,
    coverage,
  );
  if (!returnPeriods.ok) {
    return insufficient(returnPeriods, warnings);
  }
  warnings.push(...returnPeriods.warnings);

  const twr = calculateTwr(returnPeriods.value, coverage);
  if (!twr.ok) {
    return insufficient(twr, warnings);
  }
  warnings.push(...twr.warnings);

  const maxDrawdown = calculateMaxDrawdown(
    dailyNav.value.map((point) => ({
      externalId: `daily-nav:${point.date}`,
      nav: point.nav,
      occurredAt: point.occurredAt,
    })),
    coverage,
  );
  if (!maxDrawdown.ok) {
    return insufficient(maxDrawdown, warnings);
  }
  warnings.push(...maxDrawdown.warnings);

  const metrics: PersistedMetric[] = [
    metric("twr", twr.value.value, twr.warnings),
    metric("cumulativeReturn", twr.value.value, twr.warnings),
    metric("maxDrawdown", maxDrawdown.value.drawdown, maxDrawdown.warnings),
  ];

  const actualFrom = dailyNav.value[0]?.occurredAt;
  const actualTo = dailyNav.value.at(-1)?.occurredAt;
  if (!actualFrom || !actualTo) {
    return {
      errorCode: "INSUFFICIENT_HISTORY",
      errorMessage: "Daily NAV does not contain an evaluable range.",
      ok: false,
      warningCodes: uniqueWarningCodes(warnings),
    };
  }

  const annualized = calculateAnnualizedReturn(twr.value.value, actualFrom, actualTo, coverage);
  captureMetric(metrics, warnings, "annualizedReturn", annualized, (value) => value.value);

  const dailyReturns = returnPeriods.value.map((period, index) => ({
    date: `${period.to.slice(0, 10)}:${index}`,
    value: period.return,
  }));
  const volatility = calculateVolatility(dailyReturns, coverage);
  const sharpe = calculateSharpe(dailyReturns, "0", coverage);
  const sortino = calculateSortino(dailyReturns, "0", coverage);
  captureMetric(metrics, warnings, "volatility", volatility, (value) => value.value);
  captureMetric(metrics, warnings, "sharpeRatio", sharpe, (value) => value.value);
  captureMetric(metrics, warnings, "sortinoRatio", sortino, (value) => value.value);

  if (annualized.ok) {
    const elapsedDays = String(
      (new Date(actualTo).getTime() - new Date(actualFrom).getTime()) / 86_400_000,
    );
    const calmar = calculateCalmar(
      annualized.value.value,
      maxDrawdown.value.drawdown,
      elapsedDays,
      coverage,
    );
    captureMetric(metrics, warnings, "calmarRatio", calmar, (value) => value.value);
  }

  const tradeStatistics = calculateTradeStatistics(cycles.value);
  if (tradeStatistics.ok) {
    warnings.push(...tradeStatistics.warnings);
    const statistics = tradeStatistics.value;
    metrics.push(metric("winRate", statistics.winRate, tradeStatistics.warnings));
    metrics.push(
      metric("maxLosingStreak", String(statistics.maxLosingStreak), tradeStatistics.warnings),
    );
    if (statistics.profitFactor !== null) {
      metrics.push(metric("profitFactor", statistics.profitFactor, tradeStatistics.warnings));
    }
    if (statistics.averageWin !== null) {
      metrics.push(metric("averageWin", statistics.averageWin, tradeStatistics.warnings));
    }
    if (statistics.averageLoss !== null) {
      metrics.push(metric("averageLoss", statistics.averageLoss, tradeStatistics.warnings));
    }
    if (statistics.singleTradeProfitDependency !== null) {
      metrics.push(
        metric(
          "topTradeContribution",
          statistics.singleTradeProfitDependency,
          tradeStatistics.warnings,
        ),
      );
    }
  } else {
    warnings.push(asWarning(tradeStatistics));
  }

  if (input.accountSnapshots.length > 0) {
    const leverage = calculateLeverageMetrics(input.accountSnapshots, coverage);
    if (leverage.ok) {
      warnings.push(...leverage.warnings);
      metrics.push(
        metric("medianLeverage", leverage.value.medianLeverage, leverage.warnings),
        metric("percentile95Leverage", leverage.value.percentile95Leverage, leverage.warnings),
        metric("maxLeverage", leverage.value.maxLeverage, leverage.warnings),
        metric("averageLeverage", leverage.value.averageLeverage, leverage.warnings),
      );
    } else {
      warnings.push(asWarning(leverage));
    }
  }

  const latestPositions = latestPositionSnapshot(input.positionSnapshots);
  if (latestPositions.length > 0) {
    const concentration = calculateCoinConcentration(latestPositions);
    if (concentration.ok) {
      warnings.push(...concentration.warnings);
      metrics.push(
        metric("largestCoinShare", concentration.value.largestCoinShare, concentration.warnings),
        metric(
          "concentrationIndex",
          concentration.value.concentrationIndex,
          concentration.warnings,
        ),
      );
    } else {
      warnings.push(asWarning(concentration));
    }
  }

  const result: SuccessfulPerformanceResult = {
    cycles: cycles.value.map(projectCycle),
    dailyNavs: dailyNav.value.map((point) => ({
      date: new Date(`${point.date}T00:00:00.000Z`),
      externalCashFlow: null,
      fees: null,
      funding: null,
      nav: point.nav,
      realizedPnl: null,
      unrealizedPnl: null,
    })),
    metrics,
    precision: "DERIVED",
    warnings,
  };
  return { ok: true, result };
}

export function assessHistoryCompleteness(
  input: PerformanceCalculationInput,
  calculationFrom: string,
): DataCompleteness {
  if (
    input.syncCursorStatuses.includes("GAP_DETECTED") ||
    input.openIssueTypes.some((issue) => issue.includes("GAP"))
  ) {
    return "GAP_DETECTED";
  }
  if (
    input.openIssueTypes.some(
      (issue) =>
        issue.includes("HISTORY_LIMIT") ||
        issue.includes("PAGINATION_LIMIT") ||
        issue.includes("TRUNCAT"),
    )
  ) {
    return "TRUNCATED";
  }
  if (input.fills.length === 0 || input.navSnapshots.length < 2) {
    return "INSUFFICIENT_HISTORY";
  }
  if (
    input.syncCursorStatuses.includes("FAILED") ||
    input.openIssueTypes.some((issue) => issue.includes("INCOMPLETE") || issue.includes("PARTIAL"))
  ) {
    return "PARTIAL";
  }

  const firstPositionByCoin = new Map<string, string>();
  for (const fill of [...input.fills].sort(compareEvents)) {
    if (!firstPositionByCoin.has(fill.coin)) {
      firstPositionByCoin.set(fill.coin, fill.startPosition);
    }
  }
  if (
    [...firstPositionByCoin.values()].some((position) => {
      try {
        return !parseDecimalString(position).isZero();
      } catch {
        return true;
      }
    })
  ) {
    return "PARTIAL";
  }

  const firstNav = [...input.navSnapshots].sort(compareEvents)[0];
  if (!firstNav || firstNav.occurredAt.slice(0, 10) > calculationFrom.slice(0, 10)) {
    return "PARTIAL";
  }
  return "COMPLETE";
}

function validateJob(job: PerformanceJobData): void {
  const calculationFrom = new Date(job.calculationFrom).getTime();
  const calculationTo = new Date(job.calculationTo).getTime();
  const requestedAt = new Date(job.requestedAt).getTime();
  if (
    !Number.isFinite(calculationFrom) ||
    !Number.isFinite(calculationTo) ||
    calculationTo < calculationFrom
  ) {
    throw new RangeError("Performance calculation requires a valid ordered time range.");
  }
  if (!Number.isFinite(requestedAt)) {
    throw new RangeError("Performance calculation requestedAt must be valid.");
  }
  if (job.calculationVersion !== PERFORMANCE_CALCULATION_VERSION) {
    throw new RangeError(
      `Unsupported calculation version ${job.calculationVersion}; expected ${PERFORMANCE_CALCULATION_VERSION}.`,
    );
  }
}

function insufficient<T>(
  result: Extract<CalculationResult<T>, { readonly ok: false }>,
  warnings: readonly CalculationWarning[],
): CalculationInsufficient {
  return {
    errorCode: result.error.code,
    errorMessage: result.error.message,
    ok: false,
    warningCodes: uniqueWarningCodes([...warnings, ...result.warnings]),
  };
}

function captureMetric<T>(
  metrics: PersistedMetric[],
  warnings: CalculationWarning[],
  key: string,
  result: CalculationResult<T>,
  value: (input: T) => string,
): void {
  if (result.ok) {
    warnings.push(...result.warnings);
    metrics.push(metric(key, value(result.value), result.warnings));
    return;
  }
  warnings.push(asWarning(result));
}

function metric(
  metricKey: string,
  metricValue: string,
  warnings: readonly CalculationWarning[],
): PersistedMetric {
  const warningCodes = uniqueWarningCodes(warnings);
  return {
    metricKey,
    metricValue,
    status: warningCodes.includes("REFERENCE_ONLY") ? "REFERENCE_ONLY" : "AVAILABLE",
    warningCodes,
  };
}

function asWarning<T>(
  result: Extract<CalculationResult<T>, { readonly ok: false }>,
): CalculationWarning {
  return {
    code: result.error.code,
    message: result.error.message,
  };
}

function projectCycle(cycle: PositionCycle): PersistedPositionCycle {
  const opening = cycle.fills.filter((fill) => fill.role === "OPEN");
  const closing = cycle.fills.filter((fill) => fill.role === "CLOSE");
  const entryQuantity = sumDecimal(opening.map((fill) => fill.size));
  const exitQuantity = sumDecimal(closing.map((fill) => fill.size));
  const averageExitPrice =
    closing.length === 0 || parseDecimalString(exitQuantity).isZero()
      ? null
      : closing
          .reduce(
            (total, fill) =>
              total.plus(parseDecimalString(fill.price).mul(parseDecimalString(fill.size))),
            parseDecimalString("0"),
          )
          .div(parseDecimalString(exitQuantity))
          .toFixed();
  const inputFingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        cycleId: cycle.id,
        fillIds: [...new Set(cycle.fills.map((fill) => fill.externalId))].sort(),
        fundingIds: cycle.fundingEvents.map((item) => item.externalId).sort(),
      }),
    )
    .digest("hex");
  return {
    averageEntryPrice: cycle.averageEntryPrice,
    averageExitPrice,
    closedAt: cycle.closedAt ? new Date(cycle.closedAt) : null,
    coin: cycle.coin,
    entryQuantity,
    exitQuantity,
    fees: cycle.pnl.fee,
    fillCount: new Set(cycle.fills.map((fill) => fill.externalId)).size,
    funding: cycle.pnl.funding,
    grossRealizedPnl: cycle.pnl.grossRealizedPnl,
    inputFingerprint,
    netRealizedPnl: cycle.pnl.netRealizedPnl,
    openedAt: new Date(cycle.openedAt),
    side: cycle.side,
    status: cycle.status,
  };
}

function sumDecimal(values: readonly string[]): string {
  return values
    .reduce((total, value) => total.plus(parseDecimalString(value)), parseDecimalString("0"))
    .toFixed();
}

function latestPositionSnapshot(
  positions: readonly PositionSnapshotInput[],
): readonly PositionSnapshotInput[] {
  if (positions.length === 0) {
    return [];
  }
  const latestTimestamp = Math.max(
    ...positions.map((position) => new Date(position.occurredAt).getTime()),
  );
  return positions.filter(
    (position) => new Date(position.occurredAt).getTime() === latestTimestamp,
  );
}

function compareEvents(
  left: { readonly externalId: string; readonly occurredAt: string },
  right: { readonly externalId: string; readonly occurredAt: string },
): number {
  return (
    new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime() ||
    left.externalId.localeCompare(right.externalId)
  );
}

function uniqueWarningCodes(warnings: readonly CalculationWarning[]): readonly string[] {
  return [...new Set(warnings.map((item) => item.code))].sort();
}

function resultForRun(
  run: PerformanceRunRecord,
  reused: boolean,
  metricCount: number,
): PerformanceProcessResult {
  return {
    calculationRunId: run.id,
    inputFingerprint: run.inputFingerprint,
    metricCount,
    reused,
    status: run.status,
  };
}
