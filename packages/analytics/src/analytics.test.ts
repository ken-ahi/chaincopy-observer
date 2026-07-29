import { describe, expect, it } from "vitest";

import {
  analyzeTrustedTradeHistory,
  buildPositionCycles,
  calculateAggregatePnl,
  calculateAnnualizedReturn,
  calculateAverageWinLoss,
  calculateCalmar,
  calculateCoinConcentration,
  calculateCumulativeReturn,
  calculateCyclePnl,
  calculateDailyNav,
  calculateDrawdownSeries,
  calculateEffectiveLeverage,
  calculateLeverageMetrics,
  calculateMaxDrawdown,
  calculateMaxLosingStreak,
  calculateProfitDependency,
  calculateProfitFactor,
  calculateSharpe,
  calculateSortino,
  calculateTradeStatistics,
  calculateTwr,
  calculateVolatility,
  calculateWinRate,
  classifyStoredCashFlowInput,
  normalizeCashFlows,
  splitReturnPeriodsAtCashFlows,
  type CalculationCoverage,
  type FillInput,
  type PositionCycle,
  type ReturnNavPoint,
} from "./index.js";

const from = "2024-01-01T00:00:00.000Z";
const to = "2024-12-31T00:00:00.000Z";
const completeCoverage: CalculationCoverage = {
  calculationFrom: from,
  calculationTo: to,
  completeness: "COMPLETE",
  initialStateKnown: true,
};

function fill(input: Partial<FillInput> & Pick<FillInput, "externalId">): FillInput {
  return {
    closedPnl: "0",
    coin: "BTC",
    fee: "0",
    occurredAt: "2024-01-01T00:00:00.000Z",
    price: "100",
    side: "BUY",
    size: "1",
    startPosition: "0",
    ...input,
  };
}

function build(fills: readonly FillInput[]) {
  return buildPositionCycles(fills, [], completeCoverage);
}

function closedCycle(
  id: string,
  pnl: string,
  openedAt = "2024-01-01T00:00:00.000Z",
  closedAt = "2024-01-02T00:00:00.000Z",
): PositionCycle {
  return {
    averageEntryPrice: "1",
    closedAt,
    coin: "BTC",
    completeness: "COMPLETE",
    fills: [],
    fundingEvents: [],
    id,
    openedAt,
    pnl: {
      fee: "0",
      fillRecomputedPnl: pnl,
      funding: "0",
      grossRealizedPnl: pnl,
      hyperliquidClosedPnl: pnl,
      netRealizedPnl: pnl,
    },
    side: "LONG",
    status: "CLOSED",
    warnings: [],
  };
}

function dateAfter(days: number): string {
  return new Date(Date.parse(from) + days * 86_400_000).toISOString();
}

function dailyReturns(values: readonly string[]) {
  return values.map((value, index) => ({ date: dateAfter(index), value }));
}

describe("position cycles and PnL", () => {
  it("calculates a profitable long cycle", () => {
    const result = build([
      fill({ externalId: "1-open" }),
      fill({
        closedPnl: "20",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "120",
        side: "SELL",
        startPosition: "1",
      }),
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0]?.pnl.netRealizedPnl).toBe("20");
      expect(result.value[0]?.pnl.fillRecomputedPnl).toBe("20");
    }
  });

  it("calculates a losing long cycle", () => {
    const result = build([
      fill({ externalId: "1-open" }),
      fill({
        closedPnl: "-20",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "80",
        side: "SELL",
        startPosition: "1",
      }),
    ]);
    expect(result.ok && result.value[0]?.pnl.netRealizedPnl).toBe("-20");
  });

  it("calculates a profitable short cycle", () => {
    const result = build([
      fill({ externalId: "1-open", side: "SELL" }),
      fill({
        closedPnl: "20",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "80",
        side: "BUY",
        startPosition: "-1",
      }),
    ]);
    expect(result.ok && result.value[0]?.pnl.fillRecomputedPnl).toBe("20");
  });

  it("calculates a losing short cycle", () => {
    const result = build([
      fill({ externalId: "1-open", side: "SELL" }),
      fill({
        closedPnl: "-20",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "120",
        side: "BUY",
        startPosition: "-1",
      }),
    ]);
    expect(result.ok && result.value[0]?.pnl.fillRecomputedPnl).toBe("-20");
  });

  it("keeps partial closes in one cycle", () => {
    const result = build([
      fill({ externalId: "1-open", size: "2" }),
      fill({
        closedPnl: "10",
        externalId: "2-partial",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "110",
        side: "SELL",
        startPosition: "2",
      }),
      fill({
        closedPnl: "20",
        externalId: "3-close",
        occurredAt: "2024-01-03T00:00:00.000Z",
        price: "120",
        side: "SELL",
        startPosition: "1",
      }),
    ]);
    expect(result.ok && result.value).toHaveLength(1);
    expect(result.ok && result.value[0]?.pnl.grossRealizedPnl).toBe("30");
  });

  it("splits a position reversal into two cycles", () => {
    const result = build([
      fill({ externalId: "1-open" }),
      fill({
        closedPnl: "-10",
        externalId: "2-reverse",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "90",
        side: "SELL",
        size: "2",
        startPosition: "1",
      }),
      fill({
        closedPnl: "10",
        externalId: "3-close",
        occurredAt: "2024-01-03T00:00:00.000Z",
        price: "80",
        side: "BUY",
        startPosition: "-1",
      }),
    ]);
    expect(result.ok && result.value.map((cycle) => cycle.pnl.grossRealizedPnl)).toEqual([
      "-10",
      "10",
    ]);
  });

  it("includes paid and received funding separately", () => {
    const fills = [
      fill({ externalId: "1-open" }),
      fill({
        externalId: "2-close",
        occurredAt: "2024-01-03T00:00:00.000Z",
        side: "SELL",
        startPosition: "1",
      }),
    ];
    const paid = buildPositionCycles(
      fills,
      [
        {
          amount: "-2",
          coin: "BTC",
          externalId: "funding",
          occurredAt: "2024-01-02T00:00:00.000Z",
        },
      ],
      completeCoverage,
    );
    const received = buildPositionCycles(
      fills,
      [
        {
          amount: "2",
          coin: "BTC",
          externalId: "funding",
          occurredAt: "2024-01-02T00:00:00.000Z",
        },
      ],
      completeCoverage,
    );
    expect(paid.ok && paid.value[0]?.pnl.netRealizedPnl).toBe("-2");
    expect(received.ok && received.value[0]?.pnl.netRealizedPnl).toBe("2");
  });

  it("deducts fees from official realized PnL", () => {
    const result = build([
      fill({ externalId: "1-open", fee: "1" }),
      fill({
        closedPnl: "20",
        externalId: "2-close",
        fee: "1",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "120",
        side: "SELL",
        startPosition: "1",
      }),
    ]);
    expect(result.ok && result.value[0]?.pnl.netRealizedPnl).toBe("18");
  });

  it("warns when official and reconstructed PnL differ", () => {
    const result = build([
      fill({ externalId: "1-open" }),
      fill({
        closedPnl: "19",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "120",
        side: "SELL",
        startPosition: "1",
      }),
    ]);
    expect(result.ok && result.warnings.some((item) => item.code === "CLOSED_PNL_MISMATCH")).toBe(
      true,
    );
  });

  it("sorts unordered same-time fills by external ID without mutating input", () => {
    const input = Object.freeze([
      Object.freeze(
        fill({
          closedPnl: "10",
          externalId: "b-close",
          price: "110",
          side: "SELL",
          startPosition: "1",
        }),
      ),
      Object.freeze(fill({ externalId: "a-open" })),
    ]);
    const result = build(input);
    expect(result.ok && result.value[0]?.status).toBe("CLOSED");
    expect(input[0]?.externalId).toBe("b-close");
  });

  it("returns an unclosed cycle as open", () => {
    const result = build([fill({ externalId: "open" })]);
    expect(result.ok && result.value[0]?.status).toBe("OPEN");
    expect(result.ok && result.value[0]?.closedAt).toBeNull();
  });

  it("preserves a large Decimal reconstruction", () => {
    const result = build([
      fill({
        externalId: "1-open",
        price: "1.000000000000000001",
        size: "1000000000000000001",
      }),
      fill({
        closedPnl: "1.000000000000000001",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "1.000000000000000002",
        side: "SELL",
        size: "1000000000000000001",
        startPosition: "1000000000000000001",
      }),
    ]);
    expect(result.ok && result.value[0]?.pnl.fillRecomputedPnl).toBe("1.000000000000000001");
  });

  it("preserves a very small Decimal reconstruction", () => {
    const result = build([
      fill({ externalId: "1-open", price: "1", size: "0.000000000000000001" }),
      fill({
        closedPnl: "0.000000000000000001",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "2",
        side: "SELL",
        size: "0.000000000000000001",
        startPosition: "0.000000000000000001",
      }),
    ]);
    expect(result.ok && result.value[0]?.pnl.fillRecomputedPnl).toBe("0.000000000000000001");
  });

  it("exposes cycle and aggregate PnL functions", () => {
    const built = build([
      fill({ externalId: "1-open" }),
      fill({
        closedPnl: "10",
        externalId: "2-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "110",
        side: "SELL",
        startPosition: "1",
      }),
    ]);
    expect(built.ok).toBe(true);
    if (built.ok && built.value[0]) {
      expect(calculateCyclePnl(built.value[0]).ok).toBe(true);
      const aggregate = calculateAggregatePnl(built.value, completeCoverage);
      expect(aggregate.ok && aggregate.value.netRealizedPnl).toBe("10");
    }
  });

  it("skips an unknown opening prefix and builds only cycles after the first trusted flat", () => {
    const fills = [
      fill({ externalId: "1-prefix", side: "SELL", startPosition: "2" }),
      fill({
        externalId: "2-flat",
        occurredAt: "2024-01-02T00:00:00.000Z",
        side: "SELL",
        startPosition: "1",
      }),
      fill({
        externalId: "3-trusted-open",
        occurredAt: "2024-01-03T00:00:00.000Z",
        startPosition: "0",
      }),
      fill({
        closedPnl: "10",
        externalId: "4-trusted-close",
        occurredAt: "2024-01-04T00:00:00.000Z",
        price: "110",
        side: "SELL",
        startPosition: "1",
      }),
    ];
    const analyzed = analyzeTrustedTradeHistory(fills);
    const result = build(fills);

    expect(analyzed.ok && analyzed.value.prefixes).toEqual([
      {
        coin: "BTC",
        skippedFillCount: 2,
        skippedFrom: "2024-01-01T00:00:00.000Z",
        trustedFrom: "2024-01-03T00:00:00.000Z",
      },
    ]);
    expect(result.ok && result.value).toHaveLength(1);
    expect(result.ok && result.value[0]?.fills.map((item) => item.externalId)).toEqual([
      "3-trusted-open",
      "4-trusted-close",
    ]);
    expect(
      result.ok && result.warnings.some((item) => item.code === "TRADE_HISTORY_PREFIX_SKIPPED"),
    ).toBe(true);
  });

  it("does not invent a cycle when an unknown prefix never reaches a trusted flat", () => {
    const result = build([
      fill({ externalId: "1-prefix", side: "SELL", startPosition: "2" }),
      fill({
        externalId: "2-prefix",
        occurredAt: "2024-01-02T00:00:00.000Z",
        side: "SELL",
        startPosition: "1",
      }),
    ]);

    expect(result.ok && result.value).toEqual([]);
    expect(
      result.ok &&
        result.warnings.find((item) => item.code === "TRADE_HISTORY_PREFIX_SKIPPED")?.details,
    ).toMatchObject({ skippedFillCount: 2, trustedFrom: null });
  });

  it("preserves completed trusted cycles when a later position discontinuity is detected", () => {
    const result = build([
      fill({ externalId: "1-trusted-open" }),
      fill({
        closedPnl: "10",
        externalId: "2-trusted-close",
        occurredAt: "2024-01-02T00:00:00.000Z",
        price: "110",
        side: "SELL",
        startPosition: "1",
      }),
      fill({
        externalId: "3-unclosed-open",
        occurredAt: "2024-01-03T00:00:00.000Z",
        startPosition: "0",
      }),
      fill({
        externalId: "4-discontinuity",
        occurredAt: "2024-01-04T00:00:00.000Z",
        startPosition: "0",
      }),
      fill({
        externalId: "5-ignored",
        occurredAt: "2024-01-05T00:00:00.000Z",
        startPosition: "1",
      }),
    ]);

    expect(result.ok && result.value).toHaveLength(1);
    expect(result.ok && result.value[0]?.status).toBe("CLOSED");
    expect(
      result.ok && result.warnings.find((item) => item.code === "POSITION_DISCONTINUITY")?.details,
    ).toMatchObject({
      actualStartPosition: "0",
      coin: "BTC",
      expectedStartPosition: "1",
      externalId: "4-discontinuity",
    });
  });

  it("warns and excludes funding before trusted history or on a cycle boundary", () => {
    const fills = [
      fill({ externalId: "1-prefix", side: "SELL", startPosition: "1" }),
      fill({
        externalId: "2-open",
        occurredAt: "2024-01-03T00:00:00.000Z",
        startPosition: "0",
      }),
      fill({
        externalId: "3-close",
        occurredAt: "2024-01-04T00:00:00.000Z",
        side: "SELL",
        startPosition: "1",
      }),
    ];
    const result = buildPositionCycles(
      fills,
      [
        {
          amount: "1",
          coin: "BTC",
          externalId: "before",
          occurredAt: "2024-01-02T00:00:00.000Z",
        },
        {
          amount: "1",
          coin: "BTC",
          externalId: "boundary",
          occurredAt: "2024-01-03T00:00:00.000Z",
        },
      ],
      completeCoverage,
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.value[0]?.pnl.funding).toBe("0");
    expect(
      result.ok && result.warnings.filter((item) => item.code === "UNALLOCATED_FUNDING"),
    ).toHaveLength(2);
  });
});

describe("NAV, cash flow, and returns", () => {
  it("classifies only explicit stored ledger directions", () => {
    expect(
      classifyStoredCashFlowInput({
        amount: "10",
        rawPayload: '{"delta":{"type":"accountClassTransfer","toPerp":true}}',
        type: "accountClassTransfer",
        walletAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).toEqual({ amount: "10", boundary: "INTERNAL" });
    expect(
      classifyStoredCashFlowInput({
        amount: "10",
        rawPayload:
          '{"delta":{"type":"send","user":"0x1111111111111111111111111111111111111111","destination":"0x2222222222222222222222222222222222222222"}}',
        type: "send",
        walletAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).toEqual({ amount: "-10", boundary: "EXTERNAL" });
    expect(
      classifyStoredCashFlowInput({
        amount: "10",
        rawPayload: '{"delta":{"type":"bridge"}}',
        type: "bridge",
        walletAddress: "0x1111111111111111111111111111111111111111",
      }),
    ).toEqual({ amount: "10", boundary: "UNKNOWN" });
  });
  it("selects the latest same-day snapshot and marks Perp-only precision", () => {
    const result = calculateDailyNav(
      [
        {
          externalId: "first",
          nav: "100",
          occurredAt: "2024-01-01T00:00:00.000Z",
          scope: "PERP",
        },
        {
          externalId: "latest",
          nav: "110",
          occurredAt: "2024-01-01T23:00:00.000Z",
          scope: "PERP",
        },
        {
          externalId: "next",
          nav: "120",
          occurredAt: "2024-01-02T23:00:00.000Z",
          scope: "PERP",
        },
      ],
      completeCoverage,
    );
    expect(result.ok && result.value.map((point) => point.nav)).toEqual(["110", "120"]);
    expect(result.ok && result.value[0]?.navScope).toBe("PERP_ACCOUNT_NAV");
  });

  it.each(["0", "-1"])("rejects non-positive NAV %s", (nav) => {
    const result = calculateDailyNav(
      [{ externalId: "nav", nav, occurredAt: from, scope: "PERP" }],
      completeCoverage,
    );
    expect(!result.ok && result.error.code).toBe("NON_POSITIVE_NAV");
  });

  it("calculates TWR around a deposit", () => {
    const result = twrWithCashFlow("deposit", "100", "110", "210", "231");
    expect(result).toBe("0.21");
  });

  it("calculates TWR around a withdrawal", () => {
    const result = twrWithCashFlow("withdrawal", "-50", "110", "60", "66");
    expect(result).toBe("0.21");
  });

  it("stops formal TWR when a cash flow is unknown", () => {
    const normalized = normalizeCashFlows([
      {
        amount: "10",
        externalId: "unknown",
        occurredAt: "2024-01-02T00:00:00.000Z",
        type: "mystery",
      },
    ]);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      const periods = splitReturnPeriodsAtCashFlows(
        baseNavPoints("110", "210", "231"),
        normalized.value,
        completeCoverage,
      );
      expect(!periods.ok && periods.error.code).toBe("UNKNOWN_CASH_FLOW");
    }
  });

  it.each([
    ["GAP_DETECTED", "DATA_GAP"],
    ["TRUNCATED", "HISTORY_TRUNCATED"],
  ] as const)("stops formal returns for %s coverage", (completeness, code) => {
    const result = calculateTwr(
      [
        {
          beginningNav: "100",
          endingNav: "110",
          from,
          return: "0.1",
          to: dateAfter(1),
        },
      ],
      { ...completeCoverage, completeness },
    );
    expect(!result.ok && result.error.code).toBe(code);
  });

  it("calculates cumulative return from Decimal periods", () => {
    const result = calculateCumulativeReturn(
      [
        { beginningNav: "100", endingNav: "110", from, return: "0.1", to: dateAfter(1) },
        {
          beginningNav: "110",
          endingNav: "121",
          from: dateAfter(1),
          return: "0.1",
          to: dateAfter(2),
        },
      ],
      completeCoverage,
    );
    expect(result.ok && result.value.value).toBe("0.21");
  });

  it("does not annualize fewer than 30 days", () => {
    const result = calculateAnnualizedReturn("0.1", from, dateAfter(29), completeCoverage);
    expect(!result.ok && result.error.code).toBe("INSUFFICIENT_HISTORY");
  });

  it("marks 30 to fewer than 180 days as reference-only", () => {
    const result = calculateAnnualizedReturn("0.1", from, dateAfter(30), completeCoverage);
    expect(result.ok && result.value.evaluation).toBe("REFERENCE_ONLY");
  });

  it("marks 180 days and above as standard", () => {
    const result = calculateAnnualizedReturn("0.1", from, dateAfter(180), completeCoverage);
    expect(result.ok && result.value.evaluation).toBe("STANDARD");
  });
});

describe("drawdown and risk", () => {
  const wealth = ["100", "120", "90", "108", "120"].map((nav, index) => ({
    externalId: `wealth-${index}`,
    nav,
    occurredAt: dateAfter(index),
  }));

  it("calculates maximum drawdown and recovery", () => {
    const result = calculateMaxDrawdown(wealth, completeCoverage);
    expect(result.ok && result.value).toEqual({
      drawdown: "-0.25",
      durationDays: "1",
      peakAt: dateAfter(1),
      peakNav: "120",
      recoveredAt: dateAfter(4),
      recoveryDays: "2",
      troughAt: dateAfter(2),
      troughNav: "90",
    });
  });

  it("returns null recovery for an unrecovered drawdown", () => {
    const result = calculateMaxDrawdown(wealth.slice(0, 4), completeCoverage);
    expect(result.ok && result.value.recoveredAt).toBeNull();
    expect(result.ok && result.value.recoveryDays).toBeNull();
  });

  it("returns the full drawdown series", () => {
    const result = calculateDrawdownSeries(wealth, completeCoverage);
    expect(result.ok && result.value.map((point) => point.drawdown)).toEqual([
      "0",
      "0",
      "-0.25",
      "-0.1",
      "0",
    ]);
  });

  it("returns zero volatility but rejects zero-variance Sharpe", () => {
    const returns = dailyReturns(Array.from({ length: 30 }, () => "0"));
    const volatility = calculateVolatility(returns, completeCoverage);
    const sharpe = calculateSharpe(returns, "0", completeCoverage);
    expect(volatility.ok && volatility.value.value).toBe("0");
    expect(!sharpe.ok && sharpe.error.code).toBe("ZERO_VARIANCE");
  });

  it("rejects zero downside deviation", () => {
    const returns = dailyReturns(Array.from({ length: 30 }, () => "0.01"));
    const result = calculateSortino(returns, "0", completeCoverage);
    expect(!result.ok && result.error.code).toBe("ZERO_DOWNSIDE_DEVIATION");
  });

  it("rejects zero drawdown for Calmar", () => {
    const result = calculateCalmar("0.2", "0", "180", completeCoverage);
    expect(!result.ok && result.error.code).toBe("ZERO_DRAWDOWN");
  });
});

describe("trade statistics, leverage, and concentration", () => {
  it("keeps the performance-v1 closed-cycle trade formulas unchanged", () => {
    const result = calculateTradeStatistics([
      closedCycle("win", "10"),
      closedCycle("loss", "-5", dateAfter(2), dateAfter(3)),
    ]);

    expect(result.ok && result.value).toMatchObject({
      averageLoss: "-5",
      averageWin: "10",
      maxLosingStreak: 1,
      profitFactor: "2",
      singleTradeProfitDependency: "1",
      winRate: "0.5",
    });
  });

  it("handles all-winning cycles without returning infinite Profit Factor", () => {
    const cycles = [closedCycle("a", "10"), closedCycle("b", "5", dateAfter(2), dateAfter(3))];
    const factor = calculateProfitFactor(cycles);
    const winRate = calculateWinRate(cycles);
    const averages = calculateAverageWinLoss(cycles);
    expect(!factor.ok && factor.error.code).toBe("ZERO_GROSS_LOSS");
    expect(winRate.ok && winRate.value.value).toBe("1");
    expect(averages.ok && averages.value.averageWin).toBe("7.5");
    expect(averages.ok && averages.value.averageLoss).toBeNull();
  });

  it("handles all-losing cycles and maximum losing streak", () => {
    const cycles = [closedCycle("a", "-10"), closedCycle("b", "-5", dateAfter(2), dateAfter(3))];
    const factor = calculateProfitFactor(cycles);
    const winRate = calculateWinRate(cycles);
    const averages = calculateAverageWinLoss(cycles);
    const streak = calculateMaxLosingStreak(cycles);
    expect(factor.ok && factor.value.value).toBe("0");
    expect(winRate.ok && winRate.value.value).toBe("0");
    expect(averages.ok && averages.value.averageLoss).toBe("-7.5");
    expect(streak.ok && streak.value.value).toBe(2);
  });

  it("excludes open cycles from trade statistics", () => {
    const open = { ...closedCycle("open", "100"), closedAt: null, status: "OPEN" as const };
    const result = calculateTradeStatistics([closedCycle("closed", "10"), open]);
    expect(result.ok && result.value.completedCycleCount).toBe(1);
  });

  it("calculates single-trade profit dependency", () => {
    const result = calculateProfitDependency([
      closedCycle("a", "8"),
      closedCycle("b", "2", dateAfter(2), dateAfter(3)),
    ]);
    expect(result.ok && result.value.value).toBe("0.8");
  });

  it("rejects effective leverage at zero equity", () => {
    const result = calculateEffectiveLeverage("0", "10");
    expect(!result.ok && result.error.code).toBe("NON_POSITIVE_NAV");
  });

  it("calculates median, p95, maximum, and average leverage", () => {
    const result = calculateLeverageMetrics(
      ["1", "2", "3", "4"].map((grossNotional, index) => ({
        equity: "1",
        externalId: `snapshot-${index}`,
        grossNotional,
        occurredAt: dateAfter(index),
      })),
      completeCoverage,
    );
    expect(result.ok && result.value).toEqual({
      averageLeverage: "2.5",
      maxLeverage: "4",
      medianLeverage: "2.5",
      percentile95Leverage: "3.85",
    });
  });

  it("calculates coin concentration and HHI", () => {
    const result = calculateCoinConcentration([
      { coin: "BTC", notional: "60" },
      { coin: "ETH", notional: "40" },
    ]);
    expect(result.ok && result.value.largestCoinShare).toBe("0.6");
    expect(result.ok && result.value.concentrationIndex).toBe("0.52");
    expect(result.ok && result.value.exposureByCoin.map((item) => item.share)).toEqual([
      "0.6",
      "0.4",
    ]);
  });
});

function baseNavPoints(
  beforeNav: string,
  afterNav: string,
  endingNav: string,
): readonly ReturnNavPoint[] {
  return [
    { externalId: "start", nav: "100", occurredAt: from },
    {
      boundary: "FLOW_BEFORE",
      cashFlowId: "flow",
      externalId: "before",
      nav: beforeNav,
      occurredAt: "2024-01-02T00:00:00.000Z",
    },
    {
      boundary: "FLOW_AFTER",
      cashFlowId: "flow",
      externalId: "after",
      nav: afterNav,
      occurredAt: "2024-01-02T00:00:00.000Z",
    },
    {
      externalId: "end",
      nav: endingNav,
      occurredAt: "2024-01-03T00:00:00.000Z",
    },
  ];
}

function twrWithCashFlow(
  type: "deposit" | "withdrawal",
  amount: string,
  beforeNav: string,
  afterNav: string,
  endingNav: string,
): string | null {
  const normalized = normalizeCashFlows([
    {
      amount,
      externalId: "flow",
      occurredAt: "2024-01-02T00:00:00.000Z",
      type,
    },
  ]);
  if (!normalized.ok) return null;
  const periods = splitReturnPeriodsAtCashFlows(
    baseNavPoints(beforeNav, afterNav, endingNav),
    normalized.value,
    completeCoverage,
  );
  if (!periods.ok) return null;
  const result = calculateTwr(periods.value, completeCoverage);
  return result.ok ? result.value.value : null;
}
