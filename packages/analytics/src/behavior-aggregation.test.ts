import { describe, expect, it } from "vitest";
import {
  aggregateBehaviorBucket,
  aggregationScope,
  AGGREGATION_SEMANTICS,
  utcBucketStart,
  type AggregationEvent,
} from "./behavior-aggregation.js";
import { behaviorEventFingerprint } from "./behavior-normalization.js";

const start = "2026-09-01T12:00:00.000Z";
const member = {
  walletAddressId: "wallet-1",
  address: `0x${"1".repeat(40)}`,
  selectionRunId: "selection-current",
  performanceRunId: "performance-1",
};
function event(id = "1", overrides: Partial<AggregationEvent> = {}): AggregationEvent {
  const source = { sourceEventId: id, sourceOrdinal: 0 };
  return {
    id,
    ...source,
    fingerprint: behaviorEventFingerprint(source),
    behaviorVersion: "behavior-v1",
    walletAddressId: member.walletAddressId,
    coin: "BTC",
    occurredAt: start,
    eventType: "POSITION_OPEN",
    direction: "LONG",
    notionalDeltaUsd: "0.1",
    normalizationRunId: "normalization-1",
    generationSelectionRunId: "selection-older",
    generationPerformanceRunId: "performance-older",
    ...overrides,
  };
}
const aggregate = (events: AggregationEvent[], issues: string[] = []) =>
  aggregateBehaviorBucket({ coin: "BTC", bucketStart: start, members: [member], events, issues });
describe("behavior-aggregation-v1", () => {
  it("uses half-open UTC intervals independently of local timezone", () => {
    expect(utcBucketStart("2026-09-01T12:14:59.999Z")).toBe(start);
    expect(utcBucketStart("2026-09-01T12:15:00.000Z")).toBe("2026-09-01T12:15:00.000Z");
    expect(aggregate([event()]).status).toBe("VALID");
    expect(aggregate([event("1", { occurredAt: "2026-09-01T12:15:00.000Z" })]).status).toBe(
      "BLOCKED",
    );
    expect(() => utcBucketStart("2026-09-01T21:00:00+09:00")).toThrow();
  });
  it.each(AGGREGATION_SEMANTICS)("maps %s without reinterpreting flips", (semantic) => {
    const [direction, action] = semantic.split("_");
    const result = aggregate([
      event("1", { direction: direction!, eventType: `POSITION_${action}` }),
    ]);
    expect(result.totals?.semantics[semantic]).toMatchObject({
      eventCount: 1,
      uniqueWalletCount: 1,
      notionalUsd: "0.1",
    });
  });
  it("keeps fill counts separate from wallet participation and uses exact Decimal", () => {
    const result = aggregate([
      event(),
      event("2", { notionalDeltaUsd: "0.2" }),
      event("3", { notionalDeltaUsd: "0.000000000000000001", eventType: "POSITION_CLOSE" }),
    ]);
    expect(result.totals).toMatchObject({
      eventCount: 3,
      uniqueWalletCount: 1,
      notionalUsd: "0.300000000000000001",
    });
    expect(result.totals?.semantics.LONG_OPEN.uniqueWalletCount).toBe(1);
    expect(result.totals?.semantics.LONG_CLOSE.uniqueWalletCount).toBe(1);
  });
  it("counts two wallets once each and orders cohort deterministically", () => {
    const other = { ...member, walletAddressId: "wallet-2", address: `0x${"2".repeat(40)}` };
    const events = [event(), event("2", { walletAddressId: other.walletAddressId })];
    const a = aggregateBehaviorBucket({
      coin: "BTC",
      bucketStart: start,
      events,
      members: [member, other],
      issues: [],
    });
    const b = aggregateBehaviorBucket({
      coin: "BTC",
      bucketStart: start,
      events: [...events].reverse(),
      members: [other, member],
      issues: [],
    });
    expect(a).toEqual(b);
    expect(a.totals?.uniqueWalletCount).toBe(2);
  });
  it("deduplicates identical inputs and rejects conflicting identity", () => {
    expect(aggregate([event(), event()])).toEqual(aggregate([event()]));
    expect(aggregate([event(), event("1", { notionalDeltaUsd: "2" })]).status).toBe("BLOCKED");
  });
  it("changes only affected bucket fingerprint on late arrival", () => {
    const a = aggregate([event()]);
    const b = aggregate([event(), event("2")]);
    expect(a.bucketId).toBe(b.bucketId);
    expect(a.inputFingerprint).not.toBe(b.inputFingerprint);
    expect(aggregate([event()])).toEqual(a);
  });
  it.each(["NaN", "Infinity", "-1", "1e20", "0.0000000000000000001"])(
    "blocks invalid financial decimal %s",
    (notionalDeltaUsd) =>
      expect(aggregate([event("1", { notionalDeltaUsd })]).status).toBe("BLOCKED"),
  );
  it("separates empty from blocked and never invents neutral totals", () => {
    expect(aggregate([]).status).toBe("EMPTY");
    expect(aggregate([], ["MISSING_BOUNDARY"]).totals).toBeNull();
    expect(aggregate([event()], ["OPEN_DQ"]).status).toBe("BLOCKED");
  });
  it("fails closed on coin, version, identity and provenance mismatches", () => {
    for (const patch of [
      { coin: "ETH" },
      { behaviorVersion: "future" },
      { generationSelectionRunId: null },
      { fingerprint: "wrong" },
      { sourceOrdinal: 2 },
    ])
      expect(aggregate([event("1", patch)]).status).toBe("BLOCKED");
    expect(() => aggregationScope([{ ...member, performanceRunId: null }])).toThrow();
    expect(() =>
      aggregationScope([member, { ...member, walletAddressId: "2", selectionRunId: "other" }]),
    ).toThrow();
  });
});
