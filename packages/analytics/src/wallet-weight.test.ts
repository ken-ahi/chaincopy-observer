import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { calculateWalletWeights, type WalletWeightInput } from "./wallet-weight.js";

function member(id = "1", changes: Partial<WalletWeightInput> = {}): WalletWeightInput {
  return {
    walletAddressId: id,
    address: `0x${id.padStart(40, "0")}`,
    selectionRunId: "selection",
    performanceRunId: `performance-${id}`,
    performanceInputFingerprint: "source",
    trustRevision: 0,
    metricFrom: "2026-01-01T00:00:00.000Z",
    metricTo: "2026-02-01T00:00:00.000Z",
    trustedClosedCycleCount: "30",
    metrics: {
      winRate: "0.6",
      profitFactor: "1",
      topTradeContribution: "0.2",
      averageWin: "1",
      averageLoss: "-1",
      maxLosingStreak: "3",
    },
    ...changes,
  };
}
describe("wallet-weight-v1", () => {
  it("one admitted member naturally has weight 1 with an exact fixed vector", () => {
    expect(calculateWalletWeights([member()]).entries[0]).toMatchObject({
      rawWeight: "0.22",
      normalizedWeight: "1",
      components: {
        profitShare: "0.5",
        quality: "0.55",
        sampleConfidence: "0.5",
        concentration: "0.8",
      },
    });
  });
  it("normalizes two members and deterministically allocates equal-score residuals", () => {
    expect(
      calculateWalletWeights([member(), member("2")]).entries.map((e) => e.normalizedWeight),
    ).toEqual(["0.5", "0.5"]);
    const result = calculateWalletWeights([member("3"), member("1"), member("2")]);
    expect(result.entries.map((e) => e.normalizedWeight)).toEqual([
      "0.333333333333333334",
      "0.333333333333333333",
      "0.333333333333333333",
    ]);
    expect(calculateWalletWeights([member("2"), member("3"), member("1")])).toEqual(result);
  });
  it("increases confidence concavely, not linearly with cycle count", () => {
    const scores = ["1", "30", "60", "928"].map(
      (n) => calculateWalletWeights([member("1", { trustedClosedCycleCount: n })]).entries[0]!,
    );
    expect(scores[1]!.components.sampleConfidence).toBe("0.5");
    for (let i = 1; i < scores.length; i++)
      expect(new Decimal(scores[i]!.rawWeight).gt(scores[i - 1]!.rawWeight)).toBe(true);
    expect(new Decimal(scores[3]!.rawWeight).lt("0.44")).toBe(true);
  });
  it("bounds extreme Profit Factor and win rate without an extra admission gate", () => {
    const result = calculateWalletWeights([
      member("1", {
        metrics: { ...member().metrics, winRate: "1", profitFactor: "99999999999999999999" },
      }),
    ]).entries[0]!;
    expect(new Decimal(result.components.profitShare).lt(1)).toBe(true);
    expect(new Decimal(result.rawWeight).lte(1)).toBe(true);
    expect(() =>
      calculateWalletWeights([member("1", { trustedClosedCycleCount: "2" })]),
    ).not.toThrow();
  });
  it("penalizes concentration, preserves individual zero, fails closed on all zero", () => {
    const zero = member("2", { metrics: { ...member().metrics, topTradeContribution: "1" } });
    expect(calculateWalletWeights([member(), zero]).entries.map((e) => e.normalizedWeight)).toEqual(
      ["1", "0"],
    );
    expect(() => calculateWalletWeights([zero])).toThrow("ZERO_COHORT_WEIGHT");
    expect(
      new Decimal(
        calculateWalletWeights([
          member("1", { metrics: { ...member().metrics, topTradeContribution: "0.5" } }),
        ]).entries[0]!.rawWeight,
      ).lt("0.22"),
    ).toBe(true);
  });
  it("keeps an exact unit sum for uneven Decimal inputs at the cohort bound", () => {
    const result = calculateWalletWeights(
      Array.from({ length: 200 }, (_, i) =>
        member((i + 1).toString(16), {
          trustedClosedCycleCount: (i + 1).toString(),
          metrics: {
            ...member().metrics,
            winRate: "0.555555555555555555",
            profitFactor: "1.000000000000000001",
          },
        }),
      ),
    );
    const D = Decimal.clone({ precision: 80 });
    expect(
      result.entries.reduce((sum, e) => sum.plus(e.normalizedWeight), new D(0)).toFixed(),
    ).toBe("1");
    for (const e of result.entries) {
      expect(new D(e.normalizedWeight).decimalPlaces()).toBeLessThanOrEqual(18);
      expect(new D(e.rawWeight).decimalPlaces()).toBeLessThanOrEqual(36);
    }
  });
  it("changes identity with cohort, Selection, Performance, or metric evidence", () => {
    const original = calculateWalletWeights([member()]);
    for (const input of [
      [member(), member("2")],
      [member("1", { selectionRunId: "new-selection" })],
      [member("1", { performanceRunId: "new-performance" })],
      [member("1", { metrics: { ...member().metrics, profitFactor: "2" } })],
    ])
      expect(calculateWalletWeights(input).id).not.toBe(original.id);
    expect(
      calculateWalletWeights([
        member("1", { metrics: { ...member().metrics, profitFactor: "1.000" } }),
      ]),
    ).toEqual(original);
  });
  it.each(["NaN", "Infinity", "1e2", "", "0.1234567890123456789", "-1", "100000000000000000000"])(
    "rejects invalid PF %s",
    (value) => {
      expect(() =>
        calculateWalletWeights([
          member("1", { metrics: { ...member().metrics, profitFactor: value } }),
        ]),
      ).toThrow();
    },
  );
  it("rejects missing metrics, malformed windows, cycles, and duplicate identities", () => {
    const { profitFactor: _ignored, ...missing } = member().metrics;
    expect(() =>
      calculateWalletWeights([member("1", { metrics: missing as WalletWeightInput["metrics"] })]),
    ).toThrow("INVALID_DECIMAL");
    expect(() =>
      calculateWalletWeights([member("1", { metricTo: "2025-01-01T00:00:00.000Z" })]),
    ).toThrow("INVALID_METRIC_WINDOW");
    expect(() => calculateWalletWeights([member("1", { trustedClosedCycleCount: "0" })])).toThrow(
      "INVALID_CYCLE_COUNT",
    );
    expect(() => calculateWalletWeights([member(), member()])).toThrow();
  });
});
