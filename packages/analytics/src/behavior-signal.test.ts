import { describe, expect, it } from "vitest";
import {
  aggregateBehaviorBucket,
  AGGREGATION_SEMANTICS,
  type AggregationEvent,
} from "./behavior-aggregation.js";
import { behaviorEventFingerprint } from "./behavior-normalization.js";
import { calculateWalletWeights, type WalletWeightInput } from "./wallet-weight.js";
import { calculateBehaviorSignal } from "./behavior-signal.js";

const start = "2026-01-01T00:00:00.000Z";
function member(id = "1", concentration = "0.2"): WalletWeightInput {
  return {
    walletAddressId: id,
    address: `0x${id.repeat(40)}`,
    selectionRunId: "s",
    performanceRunId: `p${id}`,
    performanceInputFingerprint: `fp${id}`,
    trustRevision: 0,
    metricFrom: start,
    metricTo: start,
    trustedClosedCycleCount: "30",
    metrics: {
      winRate: "0.6",
      profitFactor: "1",
      averageWin: "1",
      averageLoss: "-1",
      maxLosingStreak: "2",
      topTradeContribution: concentration,
    },
  };
}
function event(
  id: string,
  wallet = "1",
  semantic = "LONG_OPEN",
  notional = "0.1",
): AggregationEvent {
  const [direction, action] = semantic.split("_");
  return {
    id,
    sourceEventId: id,
    sourceOrdinal: 0,
    fingerprint: behaviorEventFingerprint({ sourceEventId: id, sourceOrdinal: 0 }),
    walletAddressId: wallet,
    coin: "BTC",
    occurredAt: start,
    behaviorVersion: "behavior-v1",
    direction: direction!,
    eventType: `POSITION_${action}`,
    notionalDeltaUsd: notional,
    normalizationRunId: "n",
    generationSelectionRunId: "old-s",
    generationPerformanceRunId: "old-p",
  };
}
function inputs(events: AggregationEvent[], members = [member()], issues: string[] = []) {
  return [
    aggregateBehaviorBucket({ coin: "BTC", bucketStart: start, members, events, issues }),
    calculateWalletWeights(members),
  ] as const;
}
const score = (events: AggregationEvent[], members = [member()]) =>
  calculateBehaviorSignal(...inputs(events, members));
describe("signal-v1", () => {
  it.each(AGGREGATION_SEMANTICS)("maps %s exactly", (semantic) => {
    const buy = ["LONG_OPEN", "LONG_INCREASE", "SHORT_REDUCE", "SHORT_CLOSE"].includes(semantic);
    expect(score([event("a", "1", semantic)])).toMatchObject({
      buyStrength: buy ? "1" : "0",
      sellStrength: buy ? "0" : "1",
      netSignal: buy ? "1" : "-1",
      confidence: "0.333333333333333333",
      participatingWalletCount: 1,
    });
  });
  it("caps repeated large-notional events at one wallet vote and deduplicates receipts", () => {
    const a = event("a"),
      b = event("b", "1", "LONG_INCREASE", "99999999999999999999.999999999999999999");
    expect(score([a, b, a])).toEqual(score([b, a]));
    expect(score([a, b])).toMatchObject({ buyStrength: "1", participatingWalletCount: 1 });
    expect(score([a, b]).contributions[0]!.buyEventCount).toBe(2);
  });
  it("splits mixed wallet once and preserves exact Decimal notionals", () => {
    const result = score([event("a"), event("b", "1", "LONG_CLOSE", "0.000000000000000001")]);
    expect(result).toMatchObject({
      buyStrength: "0.5",
      sellStrength: "0.5",
      netSignal: "0",
      confidence: "0.166666666666666667",
      mixedWalletCount: 1,
    });
    expect(result.contributions[0]!.sellNotionalUsd).toBe("0.000000000000000001");
  });
  it("equal and unequal weights retain influence without multiplying wallet counts", () => {
    const events = [event("a"), event("b", "2", "SHORT_OPEN")];
    expect(score(events, [member(), member("2")])).toMatchObject({
      buyStrength: "0.5",
      sellStrength: "0.5",
      netSignal: "0",
      confidence: "0.25",
    });
    expect(score(events, [member(), member("2", "0.8")])).toMatchObject({
      buyStrength: "0.8",
      sellStrength: "0.2",
      netSignal: "0.6",
      confidence: "0.4",
    });
  });
  it.each(["LONG_OPEN", "SHORT_OPEN"])("all cohort %s normalizes to one", (semantic) => {
    const result = score(
      [event("a", "1", semantic), event("b", "2", semantic)],
      [member(), member("2")],
    );
    expect([result.buyStrength, result.sellStrength].sort()).toEqual(["0", "1"]);
    expect(result.confidence).toBe("0.5");
  });
  it("partial participation does not renormalize absent wallets", () => {
    expect(score([event("a")], [member(), member("2")])).toMatchObject({
      buyStrength: "0.5",
      weightedParticipatingWalletCount: "0.5",
      confidence: "0.166666666666666667",
    });
  });
  it("valid empty bucket is explicit NO_SIGNAL", () => {
    expect(score([])).toMatchObject({
      status: "NO_SIGNAL",
      buyStrength: "0",
      sellStrength: "0",
      confidence: "0",
      participatingWalletCount: 0,
    });
  });
  it("input and member reorder invariant", () => {
    const events = [event("b", "2"), event("a")],
      members = [member(), member("2")];
    expect(score(events, members)).toEqual(score([...events].reverse(), [...members].reverse()));
  });
  it.each(["NaN", "Infinity", "-1", "1e21"])("invalid Decimal %s fails closed", (amount) => {
    expect(() => score([event("a", "1", "LONG_OPEN", amount)])).toThrow();
  });
  it("OPEN DQ blocks all output", () => {
    expect(() =>
      calculateBehaviorSignal(...inputs([event("a")], [member()], ["BEHAVIOR_DQ:x"])),
    ).toThrow("AGGREGATION_BLOCKED");
  });
  it("missing wallet receipt, version, totals or identity mismatch fails closed", () => {
    const [aggregation, weight] = inputs([event("a")]);
    expect(() =>
      calculateBehaviorSignal(
        { ...aggregation, snapshot: { ...aggregation.snapshot, events: [] } },
        weight,
      ),
    ).toThrow();
    expect(() =>
      calculateBehaviorSignal({ ...aggregation, inputFingerprint: "wrong" }, weight),
    ).toThrow();
    expect(() =>
      calculateBehaviorSignal(aggregation, { ...weight, weightVersion: "other" }),
    ).toThrow();
    expect(() =>
      calculateBehaviorSignal(aggregation, {
        ...weight,
        entries: [{ ...weight.entries[0]!, normalizedWeight: "0" }],
      }),
    ).toThrow();
    expect(() =>
      calculateBehaviorSignal(
        aggregation,
        calculateWalletWeights([{ ...member(), performanceRunId: "new" }]),
      ),
    ).toThrow("COHORT_MISMATCH");
  });
  it("late bucket receipts change identity even when the vote remains unchanged", () => {
    expect(score([event("a")]).id).not.toBe(score([event("a"), event("b")]).id);
  });
});
