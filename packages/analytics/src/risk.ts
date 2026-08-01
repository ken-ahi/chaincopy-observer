import type { Decimal } from "decimal.js";

import {
  AnalysisDecimal,
  CalculationException,
  canonical,
  compareText,
  decimal,
  execute,
  parseTime,
  warning,
} from "./core.js";
import type {
  CalculationCoverage,
  CalculationResult,
  CalculationWarning,
  DailyReturnInput,
  DrawdownPoint,
  MaxDrawdown,
  MetricValue,
  WealthPoint,
} from "./types.js";

export function calculateDrawdownSeries(
  wealthPoints: readonly WealthPoint[],
  coverage: CalculationCoverage,
): CalculationResult<readonly DrawdownPoint[]> {
  return execute(coverage, "DERIVED", () => ({
    value: buildDrawdownSeries(wealthPoints),
  }));
}

export function calculateMaxDrawdown(
  wealthPoints: readonly WealthPoint[],
  coverage: CalculationCoverage,
): CalculationResult<MaxDrawdown> {
  return execute(coverage, "DERIVED", () => {
    const parsed = parseWealthPoints(wealthPoints);
    const series = buildDrawdownSeriesFromParsed(parsed);
    let trough = series[0];
    let troughIndex = 0;
    for (const [index, point] of series.entries()) {
      if (
        trough === undefined ||
        decimal(point.drawdown, "drawdown").lt(decimal(trough.drawdown, "drawdown"))
      ) {
        trough = point;
        troughIndex = index;
      }
    }
    if (!trough) {
      throw new CalculationException("INSUFFICIENT_HISTORY", "Wealth points are required.");
    }
    const peakTime = parseTime(trough.peakAt, "peakAt");
    const troughTime = parseTime(trough.occurredAt, "troughAt");
    const recovered = parsed
      .slice(troughIndex + 1)
      .find((point) => point.nav.gte(decimal(trough.peakNav, "peakNav")));
    return {
      value: {
        drawdown: trough.drawdown,
        durationDays: canonical(new AnalysisDecimal(String(troughTime - peakTime)).div(86_400_000)),
        peakAt: trough.peakAt,
        peakNav: trough.peakNav,
        recoveredAt: recovered?.input.occurredAt ?? null,
        recoveryDays: recovered
          ? canonical(new AnalysisDecimal(String(recovered.time - troughTime)).div(86_400_000))
          : null,
        troughAt: trough.occurredAt,
        troughNav: trough.nav,
      },
    };
  });
}

export function calculateVolatility(
  dailyReturns: readonly DailyReturnInput[],
  coverage: CalculationCoverage,
): CalculationResult<MetricValue> {
  return execute(coverage, "DERIVED", () => {
    const values = parseDailyReturns(dailyReturns);
    const standardDeviation = sampleStandardDeviation(values);
    return {
      value: {
        value: canonical(standardDeviation.mul(new AnalysisDecimal(365).sqrt())),
      },
      warnings: riskObservationWarnings(values.length),
    };
  });
}

export function calculateSharpe(
  dailyReturns: readonly DailyReturnInput[],
  annualRiskFreeRate: string,
  coverage: CalculationCoverage,
): CalculationResult<MetricValue> {
  return execute(coverage, "DERIVED", () => {
    const values = parseDailyReturns(dailyReturns);
    const standardDeviation = sampleStandardDeviation(values);
    if (standardDeviation.isZero()) {
      throw new CalculationException(
        "ZERO_VARIANCE",
        "Sharpe Ratio is undefined when return variance is zero.",
      );
    }
    const annualRiskFree = decimal(annualRiskFreeRate, "annualRiskFreeRate");
    const riskFreeFactor = annualRiskFree.plus(1);
    if (riskFreeFactor.lte(0)) {
      throw new CalculationException(
        "INVALID_INPUT",
        "Annual risk-free rate must be greater than -1.",
      );
    }
    const dailyRiskFree = riskFreeFactor.pow(new AnalysisDecimal(1).div(365)).minus(1);
    const excessMean = mean(values).minus(dailyRiskFree);
    return {
      value: {
        value: canonical(excessMean.div(standardDeviation).mul(new AnalysisDecimal(365).sqrt())),
      },
      warnings: riskObservationWarnings(values.length),
    };
  });
}

export function calculateSortino(
  dailyReturns: readonly DailyReturnInput[],
  dailyThreshold: string,
  coverage: CalculationCoverage,
): CalculationResult<MetricValue> {
  return execute(coverage, "DERIVED", () => {
    const values = parseDailyReturns(dailyReturns);
    const threshold = decimal(dailyThreshold, "dailyThreshold");
    let downsideSquares = new AnalysisDecimal(0);
    for (const value of values) {
      const difference = value.minus(threshold);
      if (difference.isNegative()) {
        downsideSquares = downsideSquares.plus(difference.pow(2));
      }
    }
    const downsideDeviation = downsideSquares.div(values.length).sqrt();
    if (downsideDeviation.isZero()) {
      throw new CalculationException(
        "ZERO_DOWNSIDE_DEVIATION",
        "Sortino Ratio is undefined when downside deviation is zero.",
      );
    }
    return {
      value: {
        value: canonical(
          mean(values).minus(threshold).div(downsideDeviation).mul(new AnalysisDecimal(365).sqrt()),
        ),
      },
      warnings: riskObservationWarnings(values.length),
    };
  });
}

export function calculateCalmar(
  annualizedReturn: string,
  maxDrawdown: string,
  elapsedDays: string,
  coverage: CalculationCoverage,
): CalculationResult<MetricValue> {
  return execute(coverage, "DERIVED", () => {
    if (decimal(elapsedDays, "elapsedDays").lt(180)) {
      throw new CalculationException(
        "INSUFFICIENT_HISTORY",
        "Calmar Ratio requires at least 180 elapsed days.",
      );
    }
    const drawdown = decimal(maxDrawdown, "maxDrawdown").abs();
    if (drawdown.isZero()) {
      throw new CalculationException(
        "ZERO_DRAWDOWN",
        "Calmar Ratio is undefined when maximum drawdown is zero.",
      );
    }
    return {
      value: {
        value: canonical(decimal(annualizedReturn, "annualizedReturn").div(drawdown)),
      },
    };
  });
}

interface ParsedWealthPoint {
  readonly input: WealthPoint;
  readonly nav: Decimal;
  readonly time: number;
}

function parseWealthPoints(wealthPoints: readonly WealthPoint[]): readonly ParsedWealthPoint[] {
  if (wealthPoints.length === 0) {
    throw new CalculationException("INSUFFICIENT_HISTORY", "Wealth points are required.");
  }
  const ids = new Set<string>();
  const hasSequence = wealthPoints.map((point) => point.sequence !== undefined);
  if (hasSequence.some(Boolean) && !hasSequence.every(Boolean)) {
    throw new CalculationException(
      "INVALID_INPUT",
      "Wealth point sequence must be provided for every point or omitted for every point.",
    );
  }
  const parsed = wealthPoints.map((input, index) => {
    if (ids.has(input.externalId)) {
      throw new CalculationException(
        "DUPLICATE_EVENT",
        `Duplicate wealth externalId ${input.externalId}.`,
      );
    }
    ids.add(input.externalId);
    if (
      input.sequence !== undefined &&
      (!Number.isSafeInteger(input.sequence) || input.sequence !== index)
    ) {
      throw new CalculationException(
        "DATA_ORDER_AMBIGUOUS",
        "Sequenced wealth points must follow contiguous input-array order starting at zero.",
      );
    }
    const nav = decimal(input.nav, `${input.externalId}.nav`);
    if (nav.lte(0)) {
      throw new CalculationException(
        "NON_POSITIVE_NAV",
        `Wealth NAV ${input.externalId} must be positive.`,
      );
    }
    return {
      input,
      nav,
      time: parseTime(input.occurredAt, `${input.externalId}.occurredAt`),
    };
  });
  return hasSequence.every(Boolean)
    ? parsed
    : parsed.toSorted(
        (left, right) =>
          left.time - right.time || compareText(left.input.externalId, right.input.externalId),
      );
}

function buildDrawdownSeries(wealthPoints: readonly WealthPoint[]): readonly DrawdownPoint[] {
  return buildDrawdownSeriesFromParsed(parseWealthPoints(wealthPoints));
}

function buildDrawdownSeriesFromParsed(
  wealthPoints: readonly ParsedWealthPoint[],
): readonly DrawdownPoint[] {
  const first = wealthPoints[0];
  if (!first) {
    throw new CalculationException("INSUFFICIENT_HISTORY", "Wealth points are required.");
  }
  let peakNav = first.nav;
  let peakAt = first.input.occurredAt;
  return wealthPoints.map((point) => {
    if (point.nav.gt(peakNav)) {
      peakNav = point.nav;
      peakAt = point.input.occurredAt;
    }
    return {
      drawdown: canonical(point.nav.div(peakNav).minus(1)),
      nav: canonical(point.nav),
      occurredAt: point.input.occurredAt,
      peakAt,
      peakNav: canonical(peakNav),
    };
  });
}

function parseDailyReturns(dailyReturns: readonly DailyReturnInput[]): readonly Decimal[] {
  if (dailyReturns.length < 30) {
    throw new CalculationException(
      "INSUFFICIENT_HISTORY",
      "Risk metrics require at least 30 daily return observations.",
    );
  }
  const dates = new Set<string>();
  return [...dailyReturns]
    .sort((left, right) => compareText(left.date, right.date))
    .map((item) => {
      if (dates.has(item.date)) {
        throw new CalculationException("DUPLICATE_EVENT", `Duplicate return date ${item.date}.`);
      }
      dates.add(item.date);
      return decimal(item.value, `${item.date}.return`);
    });
}

function mean(values: readonly Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), new AnalysisDecimal(0)).div(values.length);
}

function sampleStandardDeviation(values: readonly Decimal[]): Decimal {
  const average = mean(values);
  const variance = values
    .reduce((sum, value) => sum.plus(value.minus(average).pow(2)), new AnalysisDecimal(0))
    .div(values.length - 1);
  return variance.sqrt();
}

function riskObservationWarnings(count: number): readonly CalculationWarning[] {
  return count < 180
    ? [
        warning(
          "REFERENCE_ONLY",
          "Risk metrics from 30 to fewer than 180 observations are reference values.",
        ),
      ]
    : [];
}
