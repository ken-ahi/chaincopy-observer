import { createHash } from "node:crypto";

import {
  buildPositionCycles,
  buildTwrWealthIndex,
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
  type DailyNavPoint,
  type NavSnapshotInput,
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
  const trade = calculateTradeLane(input, job, completeness);
  const returns = calculateReturnLane(input, job, completeness);
  const exposure = calculateExposureLane(input, job, completeness);
  const metrics = [...trade.metrics, ...returns.metrics, ...exposure.metrics];
  const warnings = [...trade.warnings, ...returns.warnings, ...exposure.warnings];

  if (metrics.length === 0) {
    return {
      errorCode: "INSUFFICIENT_HISTORY",
      errorMessage: "No performance metric group had sufficient trusted input.",
      ok: false,
      warningCodes: uniqueWarningCodes(warnings),
    };
  }

  const result: SuccessfulPerformanceResult = {
    cycles: trade.cycles.map(projectCycle),
    dailyNavs: returns.dailyNav.map((point) => ({
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

interface TradeLaneResult {
  readonly cycles: readonly PositionCycle[];
  readonly metrics: readonly PersistedMetric[];
  readonly warnings: readonly CalculationWarning[];
}

function calculateTradeLane(
  input: PerformanceCalculationInput,
  job: PerformanceJobData,
  completeness: DataCompleteness,
): TradeLaneResult {
  const coverage = laneCoverage(job.calculationFrom, job.calculationTo, completeness);
  const cycles: PositionCycle[] = [];
  const warnings: CalculationWarning[] = [];

  const coins = [...new Set(input.fills.map((fill) => fill.coin))].sort();
  for (const coin of coins) {
    const result = buildPositionCycles(
      input.fills.filter((fill) => fill.coin === coin),
      input.funding.filter((item) => item.coin === coin),
      coverage,
    );
    if (result.ok) {
      cycles.push(...result.value);
      warnings.push(...result.warnings);
    } else {
      warnings.push(asWarning(result));
    }
  }
  cycles.sort(
    (left, right) =>
      new Date(left.openedAt).getTime() - new Date(right.openedAt).getTime() ||
      left.id.localeCompare(right.id),
  );

  const metrics: PersistedMetric[] = [];
  const tradeStatistics = calculateTradeStatistics(cycles);
  if (!tradeStatistics.ok) {
    warnings.push(asWarning(tradeStatistics));
    return { cycles, metrics, warnings };
  }

  warnings.push(...tradeStatistics.warnings);
  const completed = cycles.filter(
    (cycle): cycle is PositionCycle & { readonly closedAt: string } =>
      cycle.status === "CLOSED" && cycle.closedAt !== null,
  );
  const period = metricPeriod(
    completed.map((cycle) => cycle.openedAt),
    completed.map((cycle) => cycle.closedAt),
  );
  if (!period) {
    warnings.push({
      code: "INSUFFICIENT_HISTORY",
      message: "Trade metrics require at least one trusted completed position cycle.",
    });
    return { cycles, metrics, warnings };
  }
  const statisticWarnings = uniqueWarnings([...warnings, ...tradeStatistics.warnings]);
  const statistics = tradeStatistics.value;
  metrics.push(metric("winRate", statistics.winRate, statisticWarnings, period));
  metrics.push(
    metric("maxLosingStreak", String(statistics.maxLosingStreak), statisticWarnings, period),
  );
  if (statistics.profitFactor !== null) {
    metrics.push(metric("profitFactor", statistics.profitFactor, statisticWarnings, period));
  }
  if (statistics.averageWin !== null) {
    metrics.push(metric("averageWin", statistics.averageWin, statisticWarnings, period));
  }
  if (statistics.averageLoss !== null) {
    metrics.push(metric("averageLoss", statistics.averageLoss, statisticWarnings, period));
  }
  if (statistics.singleTradeProfitDependency !== null) {
    metrics.push(
      metric(
        "topTradeContribution",
        statistics.singleTradeProfitDependency,
        statisticWarnings,
        period,
      ),
    );
  }
  return { cycles, metrics, warnings };
}

interface ReturnLaneResult {
  readonly dailyNav: readonly DailyNavPoint[];
  readonly metrics: readonly PersistedMetric[];
  readonly warnings: readonly CalculationWarning[];
}

function calculateReturnLane(
  input: PerformanceCalculationInput,
  job: PerformanceJobData,
  completeness: DataCompleteness,
): ReturnLaneResult {
  const warnings: CalculationWarning[] = [];
  const metrics: PersistedMetric[] = [];
  const window = selectReturnWindow(input.navSnapshots, job, completeness);
  warnings.push(...window.warnings);
  if (window.snapshots.length === 0 || !window.coverage) {
    return { dailyNav: [], metrics, warnings };
  }

  const dailyNav = calculateDailyNav(window.snapshots, window.coverage);
  if (!dailyNav.ok) {
    warnings.push(asWarning(dailyNav));
    return { dailyNav: [], metrics, warnings };
  }
  warnings.push(...dailyNav.warnings);
  const period = metricPeriod(
    dailyNav.value.map((point) => point.occurredAt),
    dailyNav.value.map((point) => point.occurredAt),
  );
  if (!period) {
    warnings.push({
      code: "INSUFFICIENT_HISTORY",
      message: "Daily NAV does not contain an evaluable range.",
    });
    return { dailyNav: dailyNav.value, metrics, warnings };
  }

  const relevantCashFlows = input.cashFlows.filter((cashFlow) => {
    const time = new Date(cashFlow.occurredAt).getTime();
    return time >= period.from.getTime() && time <= period.to.getTime();
  });
  const normalizedCashFlows = normalizeCashFlows(relevantCashFlows);
  if (!normalizedCashFlows.ok) {
    warnings.push(asWarning(normalizedCashFlows));
    return { dailyNav: dailyNav.value, metrics, warnings };
  }
  warnings.push(...normalizedCashFlows.warnings);
  if (normalizedCashFlows.value.some((cashFlow) => cashFlow.isExternal === null)) {
    return { dailyNav: dailyNav.value, metrics, warnings };
  }

  const returnPeriods = splitReturnPeriodsAtCashFlows(
    dailyNav.value.map((point) => ({
      externalId: `daily-nav:${point.date}`,
      nav: point.nav,
      occurredAt: point.occurredAt,
    })),
    normalizedCashFlows.value,
    window.coverage,
  );
  if (!returnPeriods.ok) {
    warnings.push(asWarning(returnPeriods));
    return { dailyNav: dailyNav.value, metrics, warnings };
  }
  warnings.push(...returnPeriods.warnings);

  const wealthIndex = buildTwrWealthIndex(returnPeriods.value, window.coverage);
  const twr = calculateTwr(returnPeriods.value, window.coverage);
  if (!wealthIndex.ok || !twr.ok) {
    if (!wealthIndex.ok) warnings.push(asWarning(wealthIndex));
    if (!twr.ok) warnings.push(asWarning(twr));
    return { dailyNav: dailyNav.value, metrics, warnings };
  }
  const maxDrawdown = calculateMaxDrawdown(wealthIndex.value, window.coverage);
  if (!maxDrawdown.ok) {
    warnings.push(asWarning(maxDrawdown));
    return { dailyNav: dailyNav.value, metrics, warnings };
  }
  warnings.push(...twr.warnings, ...maxDrawdown.warnings);
  const returnWarnings = uniqueWarnings(warnings);
  const firstReturnPeriod = returnPeriods.value[0];
  const lastReturnPeriod = returnPeriods.value.at(-1);
  if (!firstReturnPeriod || !lastReturnPeriod) {
    warnings.push({
      code: "INSUFFICIENT_HISTORY",
      message: "Return periods do not contain an evaluable range.",
    });
    return { dailyNav: dailyNav.value, metrics, warnings };
  }
  const maxDrawdownPeriod = {
    from: new Date(firstReturnPeriod.from),
    to: new Date(lastReturnPeriod.to),
  };
  metrics.push(
    metric("twr", twr.value.value, returnWarnings, period),
    metric("cumulativeReturn", twr.value.value, returnWarnings, period),
    metric("maxDrawdown", maxDrawdown.value.drawdown, returnWarnings, maxDrawdownPeriod),
  );

  const actualFrom = dailyNav.value[0]?.occurredAt;
  const actualTo = dailyNav.value.at(-1)?.occurredAt;
  if (!actualFrom || !actualTo) {
    return { dailyNav: dailyNav.value, metrics: [], warnings };
  }
  const annualized = calculateAnnualizedReturn(
    twr.value.value,
    actualFrom,
    actualTo,
    window.coverage,
  );
  captureMetric(metrics, warnings, "annualizedReturn", annualized, (value) => value.value, period);

  const dailyReturns = returnPeriods.value.map((returnPeriod, index) => ({
    date: `${returnPeriod.to.slice(0, 10)}:${index}`,
    value: returnPeriod.return,
  }));
  captureMetric(
    metrics,
    warnings,
    "volatility",
    calculateVolatility(dailyReturns, window.coverage),
    (value) => value.value,
    period,
  );
  captureMetric(
    metrics,
    warnings,
    "sharpeRatio",
    calculateSharpe(dailyReturns, "0", window.coverage),
    (value) => value.value,
    period,
  );
  captureMetric(
    metrics,
    warnings,
    "sortinoRatio",
    calculateSortino(dailyReturns, "0", window.coverage),
    (value) => value.value,
    period,
  );

  if (annualized.ok) {
    const elapsedDays = String(
      (new Date(actualTo).getTime() - new Date(actualFrom).getTime()) / 86_400_000,
    );
    captureMetric(
      metrics,
      warnings,
      "calmarRatio",
      calculateCalmar(
        annualized.value.value,
        maxDrawdown.value.drawdown,
        elapsedDays,
        window.coverage,
      ),
      (value) => value.value,
      period,
    );
  }
  return { dailyNav: dailyNav.value, metrics, warnings };
}

interface ExposureLaneResult {
  readonly metrics: readonly PersistedMetric[];
  readonly warnings: readonly CalculationWarning[];
}

function calculateExposureLane(
  input: PerformanceCalculationInput,
  job: PerformanceJobData,
  completeness: DataCompleteness,
): ExposureLaneResult {
  const warnings: CalculationWarning[] = [];
  const metrics: PersistedMetric[] = [];

  const accountPeriod = metricPeriod(
    input.accountSnapshots.map((snapshot) => snapshot.occurredAt),
    input.accountSnapshots.map((snapshot) => snapshot.occurredAt),
  );
  if (accountPeriod) {
    const leverage = calculateLeverageMetrics(
      input.accountSnapshots,
      laneCoverage(accountPeriod.from.toISOString(), accountPeriod.to.toISOString(), completeness),
    );
    if (leverage.ok) {
      warnings.push(...leverage.warnings);
      metrics.push(
        metric("medianLeverage", leverage.value.medianLeverage, leverage.warnings, accountPeriod),
        metric(
          "percentile95Leverage",
          leverage.value.percentile95Leverage,
          leverage.warnings,
          accountPeriod,
        ),
        metric("maxLeverage", leverage.value.maxLeverage, leverage.warnings, accountPeriod),
        metric("averageLeverage", leverage.value.averageLeverage, leverage.warnings, accountPeriod),
      );
    } else {
      warnings.push(asWarning(leverage));
    }
  }

  const latestPositions = latestPositionSnapshot(input.positionSnapshots);
  const positionPeriod = metricPeriod(
    latestPositions.map((position) => position.occurredAt),
    latestPositions.map((position) => position.occurredAt),
  );
  if (positionPeriod) {
    const concentration = calculateCoinConcentration(latestPositions);
    if (concentration.ok) {
      warnings.push(...concentration.warnings);
      metrics.push(
        metric(
          "largestCoinShare",
          concentration.value.largestCoinShare,
          concentration.warnings,
          positionPeriod,
        ),
        metric(
          "concentrationIndex",
          concentration.value.concentrationIndex,
          concentration.warnings,
          positionPeriod,
        ),
      );
    } else {
      warnings.push(asWarning(concentration));
    }
  }

  if (metrics.length === 0) {
    warnings.push({
      code: "INSUFFICIENT_HISTORY",
      message: `Exposure metrics have no usable account or position snapshots in ${job.calculationFrom}..${job.calculationTo}.`,
    });
  }
  return { metrics, warnings };
}

interface ReturnWindow {
  readonly coverage: CalculationCoverage | null;
  readonly snapshots: readonly NavSnapshotInput[];
  readonly warnings: readonly CalculationWarning[];
}

function selectReturnWindow(
  snapshots: readonly NavSnapshotInput[],
  job: PerformanceJobData,
  completeness: DataCompleteness,
): ReturnWindow {
  const warnings: CalculationWarning[] = [];
  const sorted = [...snapshots].sort(compareEvents);
  const firstIndex = sorted.findIndex((snapshot) => {
    try {
      return (
        Number.isFinite(new Date(snapshot.occurredAt).getTime()) &&
        parseDecimalString(snapshot.nav).gt(0)
      );
    } catch {
      return false;
    }
  });
  if (firstIndex === -1) {
    return {
      coverage: null,
      snapshots: [],
      warnings: [
        {
          code: "INSUFFICIENT_HISTORY",
          message: "Return metrics require at least two positive dated NAV snapshots.",
        },
      ],
    };
  }

  const usable = sorted.slice(firstIndex);
  const dates = [...new Set(usable.map((snapshot) => snapshot.occurredAt.slice(0, 10)))].sort();
  let lastDate = dates.at(-1) ?? null;
  let gapCount = 0;
  for (let index = 1; index < dates.length; index += 1) {
    const previous = dates[index - 1];
    const current = dates[index];
    if (!previous || !current) continue;
    const dayDifference =
      (Date.parse(`${current}T00:00:00.000Z`) - Date.parse(`${previous}T00:00:00.000Z`)) /
      86_400_000;
    if (dayDifference > 1) {
      gapCount += 1;
      if (gapCount === 1) lastDate = previous;
    }
  }
  const selected = lastDate
    ? usable.filter((snapshot) => snapshot.occurredAt.slice(0, 10) <= lastDate)
    : [];
  const selectedDates = new Set(selected.map((snapshot) => snapshot.occurredAt.slice(0, 10)));
  if (gapCount > 0) {
    warnings.push({
      code: "RETURN_PERIOD_TRUNCATED_AT_GAP",
      details: { gapCount },
      message: "Return metrics stop at the first missing UTC NAV date.",
    });
  }
  if (selectedDates.size < 2) {
    warnings.push({
      code: "INSUFFICIENT_HISTORY",
      message: "The first continuous NAV interval is too short for return metrics.",
    });
    return { coverage: null, snapshots: [], warnings };
  }

  const effectiveFrom = selected[0]?.occurredAt;
  const effectiveTo = selected.at(-1)?.occurredAt;
  if (!effectiveFrom || !effectiveTo) {
    return { coverage: null, snapshots: [], warnings };
  }
  if (
    firstIndex > 0 ||
    new Date(effectiveFrom).getTime() > new Date(job.calculationFrom).getTime()
  ) {
    warnings.push({
      code: "CALCULATION_WINDOW_ADJUSTED",
      details: {
        effectiveFrom,
        effectiveTo,
        excludedBeforeEffectiveFrom: "NO_POSITIVE_DATED_NAV",
        requestedFrom: job.calculationFrom,
      },
      message: "Return metrics start at the first positive dated NAV snapshot.",
    });
  }
  return {
    coverage: laneCoverage(effectiveFrom, effectiveTo, completeness),
    snapshots: selected,
    warnings,
  };
}

interface MetricPeriod {
  readonly from: Date;
  readonly to: Date;
}

function metricPeriod(
  fromValues: readonly string[],
  toValues: readonly string[],
): MetricPeriod | null {
  const from = fromValues
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  const to = toValues
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()));
  if (from.length === 0 || to.length === 0) return null;
  return {
    from: new Date(Math.min(...from.map((value) => value.getTime()))),
    to: new Date(Math.max(...to.map((value) => value.getTime()))),
  };
}

function laneCoverage(
  calculationFrom: string,
  calculationTo: string,
  completeness: DataCompleteness,
): CalculationCoverage {
  return {
    calculationFrom,
    calculationTo,
    completeness: completeness === "COMPLETE" ? "COMPLETE" : "PARTIAL",
    initialStateKnown: true,
  };
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

function captureMetric<T>(
  metrics: PersistedMetric[],
  warnings: CalculationWarning[],
  key: string,
  result: CalculationResult<T>,
  value: (input: T) => string,
  period: MetricPeriod,
): void {
  if (result.ok) {
    warnings.push(...result.warnings);
    metrics.push(metric(key, value(result.value), result.warnings, period));
    return;
  }
  warnings.push(asWarning(result));
}

function metric(
  metricKey: string,
  metricValue: string,
  warnings: readonly CalculationWarning[],
  period: MetricPeriod,
): PersistedMetric {
  const warningCodes = uniqueWarningCodes(warnings);
  return {
    calculationFrom: period.from,
    calculationTo: period.to,
    metricKey,
    metricValue,
    status: warningCodes.includes("REFERENCE_ONLY") ? "REFERENCE_ONLY" : "AVAILABLE",
    warningCodes,
  };
}

function uniqueWarnings(warnings: readonly CalculationWarning[]): readonly CalculationWarning[] {
  const seen = new Set<string>();
  return warnings.filter((item) => {
    const key = `${item.code}:${item.message}:${JSON.stringify(item.details ?? null)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
