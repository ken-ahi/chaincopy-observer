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
  warning,
} from "./core.js";
import type {
  AverageWinLoss,
  CalculationResult,
  MetricValue,
  PositionCycle,
  TradeStatistics,
} from "./types.js";

export function calculateProfitFactor(
  cycles: readonly PositionCycle[],
): CalculationResult<MetricValue> {
  const context = completedCycleContext(cycles);
  return execute(context.coverage, "DERIVED", () => {
    const { losses, wins } = partitionPnl(context.cycles);
    if (losses.length === 0) {
      throw new CalculationException(
        "ZERO_GROSS_LOSS",
        "Profit Factor is undefined when gross loss is zero.",
      );
    }
    return {
      value: {
        value: canonical(sum(wins).div(sum(losses).abs())),
      },
    };
  });
}

export function calculateWinRate(cycles: readonly PositionCycle[]): CalculationResult<MetricValue> {
  const context = completedCycleContext(cycles);
  return execute(context.coverage, "DERIVED", () => {
    const wins = context.cycles.filter((cycle) =>
      decimal(cycle.pnl.netRealizedPnl, `${cycle.id}.netRealizedPnl`).gt(0),
    ).length;
    return {
      value: {
        value: canonical(new AnalysisDecimal(wins).div(context.cycles.length)),
      },
    };
  });
}

export function calculateAverageWinLoss(
  cycles: readonly PositionCycle[],
): CalculationResult<AverageWinLoss> {
  const context = completedCycleContext(cycles);
  return execute(context.coverage, "DERIVED", () => {
    const { losses, wins } = partitionPnl(context.cycles);
    return {
      value: {
        averageLoss: losses.length === 0 ? null : canonical(sum(losses).div(losses.length)),
        averageWin: wins.length === 0 ? null : canonical(sum(wins).div(wins.length)),
      },
      warnings: [
        ...(wins.length === 0
          ? [warning("NO_WINNING_CYCLES", "There are no winning completed cycles.")]
          : []),
        ...(losses.length === 0
          ? [warning("NO_LOSING_CYCLES", "There are no losing completed cycles.")]
          : []),
      ],
    };
  });
}

export function calculateMaxLosingStreak(
  cycles: readonly PositionCycle[],
): CalculationResult<{ readonly value: number }> {
  const context = completedCycleContext(cycles);
  return execute(context.coverage, "DERIVED", () => {
    let current = 0;
    let maximum = 0;
    for (const cycle of context.cycles) {
      if (decimal(cycle.pnl.netRealizedPnl, `${cycle.id}.netRealizedPnl`).lt(0)) {
        current += 1;
        maximum = Math.max(maximum, current);
      } else {
        current = 0;
      }
    }
    return { value: { value: maximum } };
  });
}

export function calculateProfitDependency(
  cycles: readonly PositionCycle[],
): CalculationResult<MetricValue> {
  const context = completedCycleContext(cycles);
  return execute(context.coverage, "DERIVED", () => {
    const wins = partitionPnl(context.cycles).wins;
    if (wins.length === 0) {
      throw new CalculationException(
        "ZERO_DENOMINATOR",
        "Profit dependency requires at least one profitable completed cycle.",
      );
    }
    const largest = wins.reduce((current, value) => (value.gt(current) ? value : current));
    return {
      value: {
        value: canonical(largest.div(sum(wins))),
      },
    };
  });
}

export function calculateTradeStatistics(
  cycles: readonly PositionCycle[],
): CalculationResult<TradeStatistics> {
  const context = completedCycleContext(cycles);
  return execute(context.coverage, "DERIVED", () => {
    const pnl = context.cycles.map((cycle) =>
      decimal(cycle.pnl.netRealizedPnl, `${cycle.id}.netRealizedPnl`),
    );
    const wins = pnl.filter((value) => value.gt(0));
    const losses = pnl.filter((value) => value.lt(0));
    const breakevenCount = pnl.length - wins.length - losses.length;
    let currentStreak = 0;
    let maxLosingStreak = 0;
    for (const value of pnl) {
      if (value.lt(0)) {
        currentStreak += 1;
        maxLosingStreak = Math.max(maxLosingStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }
    const warnings = [
      ...(wins.length === 0
        ? [warning("NO_WINNING_CYCLES", "There are no winning completed cycles.")]
        : []),
      ...(losses.length === 0
        ? [warning("ZERO_GROSS_LOSS", "Profit Factor is unavailable because gross loss is zero.")]
        : []),
    ];
    return {
      value: {
        averageLoss: losses.length === 0 ? null : canonical(sum(losses).div(losses.length)),
        averageWin: wins.length === 0 ? null : canonical(sum(wins).div(wins.length)),
        breakevenCount,
        completedCycleCount: pnl.length,
        lossCount: losses.length,
        maxLosingStreak,
        profitFactor: losses.length === 0 ? null : canonical(sum(wins).div(sum(losses).abs())),
        singleTradeProfitDependency:
          wins.length === 0
            ? null
            : canonical(
                wins
                  .reduce((current, value) => (value.gt(current) ? value : current))
                  .div(sum(wins)),
              ),
        winCount: wins.length,
        winRate: canonical(new AnalysisDecimal(wins.length).div(pnl.length)),
      },
      warnings,
    };
  });
}

function completedCycleContext(cycles: readonly PositionCycle[]): {
  readonly coverage: ReturnType<typeof coverageFromTimes>;
  readonly cycles: readonly PositionCycle[];
} {
  const completed = cycles
    .filter((cycle) => cycle.status === "CLOSED" && cycle.closedAt !== null)
    .sort(
      (left, right) =>
        parseTime(left.closedAt ?? "", "closedAt") - parseTime(right.closedAt ?? "", "closedAt") ||
        compareText(left.id, right.id),
    );
  if (completed.length === 0) {
    return {
      coverage: coverageFromTimes([], "INSUFFICIENT_HISTORY"),
      cycles: [],
    };
  }
  const completeness = mostSevereCompleteness(completed);
  return {
    coverage: coverageFromTimes(
      completed.flatMap((cycle) => [cycle.openedAt, cycle.closedAt ?? cycle.openedAt]),
      completeness,
    ),
    cycles: completed,
  };
}

function mostSevereCompleteness(cycles: readonly PositionCycle[]): PositionCycle["completeness"] {
  const priority: Readonly<Record<PositionCycle["completeness"], number>> = {
    COMPLETE: 0,
    INSUFFICIENT_HISTORY: 1,
    PARTIAL: 2,
    TRUNCATED: 3,
    GAP_DETECTED: 4,
  };
  return cycles.reduce(
    (current, cycle) =>
      priority[cycle.completeness] > priority[current] ? cycle.completeness : current,
    "COMPLETE" as PositionCycle["completeness"],
  );
}

function partitionPnl(cycles: readonly PositionCycle[]): {
  readonly losses: readonly Decimal[];
  readonly wins: readonly Decimal[];
} {
  const values = cycles.map((cycle) =>
    decimal(cycle.pnl.netRealizedPnl, `${cycle.id}.netRealizedPnl`),
  );
  return {
    losses: values.filter((value) => value.lt(0)),
    wins: values.filter((value) => value.gt(0)),
  };
}

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new AnalysisDecimal(0));
}
