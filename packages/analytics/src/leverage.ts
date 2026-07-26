import type { Decimal } from "decimal.js";

import {
  AnalysisDecimal,
  CalculationException,
  canonical,
  compareText,
  coverageFromTimes,
  decimal,
  execute,
  parseTime,
} from "./core.js";
import type {
  AccountSnapshotInput,
  CalculationCoverage,
  CalculationResult,
  CoinConcentration,
  CoinExposure,
  LeverageMetrics,
  MetricValue,
  PositionExposureInput,
} from "./types.js";

export function calculateEffectiveLeverage(
  equity: string,
  grossNotional: string,
): CalculationResult<MetricValue> {
  const coverage = coverageFromTimes([]);
  return execute(coverage, "DERIVED", () => {
    const equityValue = decimal(equity, "equity");
    if (equityValue.lte(0)) {
      throw new CalculationException(
        "NON_POSITIVE_NAV",
        "Effective leverage requires positive equity.",
      );
    }
    return {
      value: {
        value: canonical(decimal(grossNotional, "grossNotional").abs().div(equityValue)),
      },
    };
  });
}

export function calculateLeverageMetrics(
  snapshots: readonly AccountSnapshotInput[],
  coverage: CalculationCoverage,
): CalculationResult<LeverageMetrics> {
  return execute(coverage, "DERIVED", () => {
    if (snapshots.length === 0) {
      throw new CalculationException(
        "INSUFFICIENT_HISTORY",
        "At least one account snapshot is required.",
      );
    }
    const ids = new Set<string>();
    const leverages = [...snapshots]
      .sort(
        (left, right) =>
          parseTime(left.occurredAt, `${left.externalId}.occurredAt`) -
            parseTime(right.occurredAt, `${right.externalId}.occurredAt`) ||
          compareText(left.externalId, right.externalId),
      )
      .map((snapshot) => {
        if (ids.has(snapshot.externalId)) {
          throw new CalculationException(
            "DUPLICATE_EVENT",
            `Duplicate account snapshot ${snapshot.externalId}.`,
          );
        }
        ids.add(snapshot.externalId);
        const equity = decimal(snapshot.equity, `${snapshot.externalId}.equity`);
        if (equity.lte(0)) {
          throw new CalculationException(
            "NON_POSITIVE_NAV",
            `Snapshot ${snapshot.externalId} requires positive equity.`,
          );
        }
        return decimal(snapshot.grossNotional, `${snapshot.externalId}.grossNotional`)
          .abs()
          .div(equity);
      })
      .sort((left, right) => left.comparedTo(right));

    const average = leverages
      .reduce((sum, value) => sum.plus(value), new AnalysisDecimal(0))
      .div(leverages.length);
    return {
      value: {
        averageLeverage: canonical(average),
        maxLeverage: canonical(leverages.at(-1) ?? new AnalysisDecimal(0)),
        medianLeverage: canonical(percentile(leverages, "0.5")),
        percentile95Leverage: canonical(percentile(leverages, "0.95")),
      },
    };
  });
}

export function calculateCoinConcentration(
  positions: readonly PositionExposureInput[],
): CalculationResult<CoinConcentration> {
  const coverage = coverageFromTimes([]);
  return execute(coverage, "DERIVED", () => {
    if (positions.length === 0) {
      throw new CalculationException("INSUFFICIENT_HISTORY", "Position exposure is required.");
    }
    const byCoin = new Map<string, Decimal>();
    for (const position of positions) {
      if (position.coin.length === 0) {
        throw new CalculationException("INVALID_INPUT", "Position coin is required.");
      }
      const exposure = decimal(position.notional, `${position.coin}.notional`).abs();
      byCoin.set(
        position.coin,
        (byCoin.get(position.coin) ?? new AnalysisDecimal(0)).plus(exposure),
      );
    }
    const total = [...byCoin.values()].reduce(
      (sum, value) => sum.plus(value),
      new AnalysisDecimal(0),
    );
    if (total.isZero()) {
      throw new CalculationException(
        "ZERO_DENOMINATOR",
        "Coin concentration requires positive gross exposure.",
      );
    }
    const exposureByCoin: CoinExposure[] = [...byCoin.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([coin, exposure]) => ({
        coin,
        exposure: canonical(exposure),
        share: canonical(exposure.div(total)),
      }));
    const shares = exposureByCoin.map((item) => decimal(item.share, `${item.coin}.share`));
    const largest = shares.reduce((current, value) => (value.gt(current) ? value : current));
    const concentration = shares.reduce(
      (sum, value) => sum.plus(value.pow(2)),
      new AnalysisDecimal(0),
    );
    return {
      value: {
        concentrationIndex: canonical(concentration),
        exposureByCoin,
        largestCoinShare: canonical(largest),
      },
    };
  });
}

function percentile(sorted: readonly Decimal[], percentileValue: string): Decimal {
  const lastIndex = sorted.length - 1;
  if (lastIndex === 0) {
    return sorted[0] ?? new AnalysisDecimal(0);
  }
  const rank = new AnalysisDecimal(lastIndex).mul(percentileValue);
  const lower = rank.floor();
  const upper = rank.ceil();
  const lowerIndex = lower.toNumber();
  const upperIndex = upper.toNumber();
  const lowerValue = sorted[lowerIndex];
  const upperValue = sorted[upperIndex];
  if (!lowerValue || !upperValue) {
    throw new CalculationException("INVALID_INPUT", "Percentile rank is outside the input.");
  }
  if (lowerIndex === upperIndex) {
    return lowerValue;
  }
  return lowerValue.plus(upperValue.minus(lowerValue).mul(rank.minus(lower)));
}
