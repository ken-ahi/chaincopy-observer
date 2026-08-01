import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  buildTwrWealthIndex,
  calculateMaxDrawdown,
  calculateTwr,
  normalizeCashFlows,
  splitReturnPeriodsAtCashFlows,
  type CalculationCoverage,
  type CashFlowInput,
  type ReturnNavPoint,
  type ReturnPeriod,
  type WealthPoint,
} from "./index.js";

const coverage: CalculationCoverage = {
  calculationFrom: "2024-01-01T00:00:00.000Z",
  calculationTo: "2024-01-31T00:00:00.000Z",
  completeness: "COMPLETE",
  initialStateKnown: true,
};

function period(
  returnValue: string,
  index: number,
  overrides: Partial<ReturnPeriod> = {},
): ReturnPeriod {
  const from = new Date(Date.UTC(2024, 0, index + 1)).toISOString();
  const to = new Date(Date.UTC(2024, 0, index + 2)).toISOString();
  return {
    beginningNav: "100",
    endingNav: "100",
    from,
    return: returnValue,
    to,
    ...overrides,
  };
}

function buildAndDrawdown(periods: readonly ReturnPeriod[]) {
  const wealth = buildTwrWealthIndex(periods, coverage);
  expect(wealth.ok).toBe(true);
  if (!wealth.ok) throw new Error("Expected wealth index to be available.");
  const drawdown = calculateMaxDrawdown(wealth.value, coverage);
  expect(drawdown.ok).toBe(true);
  if (!drawdown.ok) throw new Error("Expected max drawdown to be available.");
  return { drawdown: drawdown.value, wealth: wealth.value };
}

function cashFlowAdjustedPeriods(input: {
  readonly amount: string;
  readonly before: string;
  readonly after: string;
  readonly end: string;
  readonly start?: string;
  readonly type: "deposit" | "withdrawal";
}): readonly ReturnPeriod[] {
  const cashFlow: CashFlowInput = {
    amount: input.amount,
    externalId: "flow-1",
    occurredAt: "2024-01-02T12:00:00.000Z",
    type: input.type,
  };
  const navPoints: readonly ReturnNavPoint[] = [
    {
      externalId: "start",
      nav: input.start ?? "100",
      occurredAt: "2024-01-01T23:00:00.000Z",
    },
    {
      boundary: "FLOW_BEFORE",
      cashFlowId: "flow-1",
      externalId: "before",
      nav: input.before,
      occurredAt: "2024-01-02T11:59:59.000Z",
    },
    {
      boundary: "FLOW_AFTER",
      cashFlowId: "flow-1",
      externalId: "after",
      nav: input.after,
      occurredAt: "2024-01-02T12:00:01.000Z",
    },
    {
      externalId: "end",
      nav: input.end,
      occurredAt: "2024-01-03T23:00:00.000Z",
    },
  ];
  const normalized = normalizeCashFlows([cashFlow]);
  expect(normalized.ok).toBe(true);
  if (!normalized.ok) throw new Error("Expected cash flow normalization to succeed.");
  const periods = splitReturnPeriodsAtCashFlows(navPoints, normalized.value, coverage);
  expect(periods.ok).toBe(true);
  if (!periods.ok) throw new Error("Expected return-period split to succeed.");
  return periods.value;
}

describe("TWR wealth index Max Drawdown contract", () => {
  it("matches raw NAV drawdown without cash flows for 100 -> 120 -> 90", () => {
    const periods = [
      period("0.2", 0, { beginningNav: "100", endingNav: "120" }),
      period("-0.25", 1, { beginningNav: "120", endingNav: "90" }),
    ];
    const result = buildAndDrawdown(periods);
    expect(result.drawdown.drawdown).toBe("-0.25");
  });

  it("builds 1 -> 1.2 -> 0.9 from +20% and -25%", () => {
    const result = buildTwrWealthIndex([period("0.2", 0), period("-0.25", 1)], coverage);
    expect(result.ok && result.value.map((point) => point.nav)).toEqual(["1", "1.2", "0.9"]);
  });

  it("keeps drawdown at zero for a deposit without investment change", () => {
    const periods = cashFlowAdjustedPeriods({
      after: "150",
      amount: "50",
      before: "100",
      end: "150",
      type: "deposit",
    });
    expect(buildAndDrawdown(periods).drawdown.drawdown).toBe("0");
  });

  it("keeps drawdown at zero for a withdrawal without investment change", () => {
    const periods = cashFlowAdjustedPeriods({
      after: "50",
      amount: "-50",
      before: "100",
      end: "50",
      type: "withdrawal",
    });
    expect(buildAndDrawdown(periods).drawdown.drawdown).toBe("0");
  });

  it("reports -20% after a deposit followed by a 20% loss", () => {
    const periods = cashFlowAdjustedPeriods({
      after: "150",
      amount: "50",
      before: "100",
      end: "120",
      type: "deposit",
    });
    expect(buildAndDrawdown(periods).drawdown.drawdown).toBe("-0.2");
  });

  it("keeps drawdown at zero after a withdrawal followed by a 20% gain", () => {
    const periods = cashFlowAdjustedPeriods({
      after: "50",
      amount: "-50",
      before: "100",
      end: "60",
      type: "withdrawal",
    });
    expect(buildAndDrawdown(periods).drawdown.drawdown).toBe("0");
  });

  it("compounds -10%, a deposit boundary, then -20% to -28%", () => {
    const periods = cashFlowAdjustedPeriods({
      after: "140",
      amount: "50",
      before: "90",
      end: "112",
      type: "deposit",
    });
    const result = buildAndDrawdown(periods);
    expect(result.wealth.map((point) => point.nav)).toEqual(["1", "0.9", "0.72"]);
    expect(result.drawdown.drawdown).toBe("-0.28");
  });

  it("compounds multiple cash-flow-adjusted return periods without a second adjustment", () => {
    const result = buildAndDrawdown([
      period("0", 0),
      period("0.1", 1),
      period("0", 2),
      period("-0.2", 3),
    ]);
    expect(result.wealth.map((point) => point.nav)).toEqual(["1", "1", "1.1", "1.1", "0.88"]);
    expect(result.drawdown.drawdown).toBe("-0.2");
  });

  it("preserves sequence for multiple return periods on the same timestamp", () => {
    const sameTime = "2024-01-02T00:00:00.000Z";
    const result = buildTwrWealthIndex(
      [
        period("-0.5", 0, { from: sameTime, to: sameTime }),
        period("1", 1, { from: sameTime, to: sameTime }),
      ],
      coverage,
    );
    expect(result.ok && result.value).toEqual([
      { externalId: "twr-wealth:0", nav: "1", occurredAt: sameTime, sequence: 0 },
      { externalId: "twr-wealth:1", nav: "0.5", occurredAt: sameTime, sequence: 1 },
      { externalId: "twr-wealth:2", nav: "1", occurredAt: sameTime, sequence: 2 },
    ]);
  });

  it("makes terminal wealth exactly equal to 1 + TWR", () => {
    const periods = [period("0.123456789012345678", 0), period("-0.2", 1)];
    const wealth = buildTwrWealthIndex(periods, coverage);
    const twr = calculateTwr(periods, coverage);
    expect(wealth.ok && wealth.value.at(-1)?.nav).toBe("0.8987654312098765424");
    expect(twr.ok && twr.value.value).toBe("-0.1012345687901234576");
    if (!wealth.ok || !twr.ok) throw new Error("Expected TWR and wealth index.");
    expect(wealth.value.at(-1)?.nav).toBe(new Decimal(twr.value.value).plus(1).toFixed());
  });

  it("rejects zero return periods as insufficient history", () => {
    const result = buildTwrWealthIndex([], coverage);
    expect(!result.ok && result.error.code).toBe("INSUFFICIENT_HISTORY");
  });

  it("supports one negative return period", () => {
    const result = buildAndDrawdown([period("-0.125", 0)]);
    expect(result.wealth.map((point) => point.nav)).toEqual(["1", "0.875"]);
    expect(result.drawdown.drawdown).toBe("-0.125");
  });

  it("supports one positive return period", () => {
    const result = buildAndDrawdown([period("0.125", 0)]);
    expect(result.wealth.map((point) => point.nav)).toEqual(["1", "1.125"]);
    expect(result.drawdown.drawdown).toBe("0");
  });

  it("does not classify an unknown cash flow by inference", () => {
    const normalized = normalizeCashFlows([
      {
        amount: "10",
        externalId: "unknown",
        occurredAt: "2024-01-02T12:00:00.000Z",
        type: "mystery",
      },
    ]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error("Expected normalization result.");
    const split = splitReturnPeriodsAtCashFlows(
      [
        { externalId: "start", nav: "100", occurredAt: "2024-01-01T00:00:00.000Z" },
        { externalId: "end", nav: "100", occurredAt: "2024-01-03T00:00:00.000Z" },
      ],
      normalized.value,
      coverage,
    );
    expect(!split.ok && split.error.code).toBe("UNKNOWN_CASH_FLOW");
  });

  it("does not fill a missing cash-flow boundary NAV", () => {
    const normalized = normalizeCashFlows([
      {
        amount: "50",
        externalId: "flow-1",
        occurredAt: "2024-01-02T12:00:00.000Z",
        type: "deposit",
      },
    ]);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error("Expected normalization result.");
    const split = splitReturnPeriodsAtCashFlows(
      [
        { externalId: "start", nav: "100", occurredAt: "2024-01-01T00:00:00.000Z" },
        { externalId: "end", nav: "150", occurredAt: "2024-01-03T00:00:00.000Z" },
      ],
      normalized.value,
      coverage,
    );
    expect(!split.ok && split.error.code).toBe("MISSING_CASH_FLOW_BOUNDARY_NAV");
  });

  it("does not calculate across GAP_DETECTED coverage", () => {
    const result = buildTwrWealthIndex([period("0.1", 0)], {
      ...coverage,
      completeness: "GAP_DETECTED",
    });
    expect(!result.ok && result.error.code).toBe("DATA_GAP");
  });

  it.each([
    ["beginning", { beginningNav: "0" }],
    ["ending", { endingNav: "-1" }],
  ] as const)("rejects a non-positive %s NAV", (_label, overrides) => {
    const result = buildTwrWealthIndex([period("0", 0, overrides)], coverage);
    expect(!result.ok && result.error.code).toBe("NON_POSITIVE_NAV");
  });

  it.each(["-1", "-2"])("rejects a non-positive wealth factor for return %s", (value) => {
    const result = buildTwrWealthIndex([period(value, 0)], coverage);
    expect(!result.ok && result.error.code).toBe("NON_POSITIVE_NAV");
  });

  it("retains the first equal peak", () => {
    const points: readonly WealthPoint[] = [
      { externalId: "0", nav: "1", occurredAt: "2024-01-01T00:00:00.000Z", sequence: 0 },
      { externalId: "1", nav: "1", occurredAt: "2024-01-02T00:00:00.000Z", sequence: 1 },
      { externalId: "2", nav: "0.8", occurredAt: "2024-01-03T00:00:00.000Z", sequence: 2 },
    ];
    const result = calculateMaxDrawdown(points, coverage);
    expect(result.ok && result.value.peakAt).toBe("2024-01-01T00:00:00.000Z");
  });

  it("retains the first equal trough", () => {
    const points: readonly WealthPoint[] = [
      { externalId: "0", nav: "1", occurredAt: "2024-01-01T00:00:00.000Z", sequence: 0 },
      { externalId: "1", nav: "0.8", occurredAt: "2024-01-02T00:00:00.000Z", sequence: 1 },
      { externalId: "2", nav: "0.8", occurredAt: "2024-01-03T00:00:00.000Z", sequence: 2 },
    ];
    const result = calculateMaxDrawdown(points, coverage);
    expect(result.ok && result.value.troughAt).toBe("2024-01-02T00:00:00.000Z");
  });

  it("uses array sequence even when every timestamp is equal", () => {
    const sameTime = "2024-01-01T00:00:00.000Z";
    const result = buildAndDrawdown([
      period("-0.5", 0, { from: sameTime, to: sameTime }),
      period("1", 1, { from: sameTime, to: sameTime }),
    ]);
    expect(result.drawdown).toMatchObject({
      drawdown: "-0.5",
      recoveredAt: sameTime,
      recoveryDays: "0",
      troughAt: sameTime,
    });
  });

  it("preserves Decimal precision through repeated multiplication", () => {
    const result = buildTwrWealthIndex(
      [period("0.000000000000000001", 0), period("0.000000000000000001", 1)],
      coverage,
    );
    expect(result.ok && result.value.at(-1)?.nav).toBe("1.000000000000000002000000000000000001");
  });

  it("preserves the 18-decimal database drawdown regression value", () => {
    const result = buildAndDrawdown([period("-0.335653778998399217", 0)]);
    expect(result.wealth.at(-1)?.nav).toBe("0.664346221001600783");
    expect(result.drawdown.drawdown).toBe("-0.335653778998399217");
  });

  it("rounds the real-data no-cash-flow regression to the fixed DB18 value", () => {
    const split = splitReturnPeriodsAtCashFlows(
      [
        { externalId: "real-0", nav: "142.318244", occurredAt: "2026-07-28T00:00:00.000Z" },
        { externalId: "real-1", nav: "217.350489", occurredAt: "2026-07-29T00:00:00.000Z" },
        { externalId: "real-2", nav: "144.395976", occurredAt: "2026-07-30T00:00:00.000Z" },
      ],
      [],
      coverage,
    );
    expect(split.ok).toBe(true);
    if (!split.ok) throw new Error("Expected real-data return periods.");

    const result = buildAndDrawdown(split.value);

    expect(result.drawdown.drawdown).toBe(
      "-0.33565377899839921685200349376715687996450746425511837702835810045037441806721674",
    );
    expect(
      new Decimal(result.drawdown.drawdown)
        .toDecimalPlaces(18, Decimal.ROUND_HALF_EVEN)
        .toFixed(18),
    ).toBe("-0.335653778998399217");
  });

  it("is equivalent to the raw NAV method when there is no cash flow", () => {
    const raw: readonly WealthPoint[] = [
      { externalId: "raw-0", nav: "100", occurredAt: "2024-01-01T00:00:00.000Z" },
      { externalId: "raw-1", nav: "120", occurredAt: "2024-01-02T00:00:00.000Z" },
      { externalId: "raw-2", nav: "90", occurredAt: "2024-01-03T00:00:00.000Z" },
    ];
    const rawDrawdown = calculateMaxDrawdown(raw, coverage);
    const adjusted = buildAndDrawdown([period("0.2", 0), period("-0.25", 1)]);
    expect(rawDrawdown.ok && rawDrawdown.value.drawdown).toBe("-0.25");
    expect(adjusted.drawdown.drawdown).toBe("-0.25");
  });

  it("rejects overlapping return periods instead of sorting them", () => {
    const result = buildTwrWealthIndex(
      [
        period("0.1", 0, {
          from: "2024-01-02T00:00:00.000Z",
          to: "2024-01-03T00:00:00.000Z",
        }),
        period("0.1", 1, {
          from: "2024-01-01T00:00:00.000Z",
          to: "2024-01-02T00:00:00.000Z",
        }),
      ],
      coverage,
    );
    expect(!result.ok && result.error.code).toBe("DATA_ORDER_AMBIGUOUS");
  });
});
