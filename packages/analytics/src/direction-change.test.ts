import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { aggregationHash } from "./behavior-aggregation.js";
import { calculateDirectionChange, type DirectionSignal } from "./direction-change.js";
function signal(net: string, index = 0): DirectionSignal {
  const n = new Decimal(net),
    id = aggregationHash([net, index]);
  return {
    id,
    inputFingerprint: id,
    coin: "BTC",
    bucketStart: new Date(Date.UTC(2026, 0, 1, 0, index * 15)).toISOString(),
    bucketEnd: new Date(Date.UTC(2026, 0, 1, 0, (index + 1) * 15)).toISOString(),
    signalVersion: "signal-v1",
    status: "VALID",
    selectionRunId: "selection",
    cohortFingerprint: "c".repeat(64),
    weightSnapshotId: "a".repeat(64),
    weightInputFingerprint: "a".repeat(64),
    weightVersion: "wallet-weight-v1",
    aggregationRevisionId: aggregationHash([index]),
    aggregationInputFingerprint: aggregationHash(["input", index]),
    aggregationVersion: "behavior-aggregation-v1",
    behaviorVersion: "behavior-v1",
    buyStrength: n.isZero() ? "0.5" : n.gt(0) ? n.toFixed() : "0",
    sellStrength: n.isZero() ? "0.5" : n.lt(0) ? n.abs().toFixed() : "0",
    netSignal: net,
    confidence: "0.1",
    participatingWalletCount: 1,
    weightedParticipatingWalletCount: n.isZero() ? "1" : n.abs().toFixed(),
  };
}
describe("direction-change-v1 exact observations", () => {
  it.each([
    ["0.2", "0.3", "BUY_ACCELERATING", "0.1"],
    ["0.3", "0.2", "BUY_WEAKENING", "-0.1"],
    ["-0.2", "-0.3", "SELL_ACCELERATING", "-0.1"],
    ["-0.3", "-0.2", "SELL_WEAKENING", "0.1"],
    ["-1", "1", "BULLISH_REVERSAL", "2"],
    ["1", "-1", "BEARISH_REVERSAL", "-2"],
    ["0", "1", "NONE", "1"],
    ["0", "-1", "NONE", "-1"],
    ["1", "0", "BUY_WEAKENING", "-1"],
    ["-1", "0", "SELL_WEAKENING", "1"],
    ["0", "0", "NONE", "0"],
    ["1", "1", "NONE", "0"],
    ["-1", "-1", "NONE", "0"],
    ["0.1", "0.1000000000000000001", "BUY_ACCELERATING", "0.0000000000000000001"],
  ])("%s → %s = %s", (a, b, eventType, delta) => {
    expect(calculateDirectionChange(signal(a), signal(b, 1))).toMatchObject({ eventType, delta });
  });
  it("confidence-only changes remain NONE with explicit metadata", () => {
    const result = calculateDirectionChange(signal("1"), { ...signal("1", 1), confidence: "0.2" });
    expect(result).toMatchObject({
      eventType: "NONE",
      reason: "UNCHANGED_NET",
      confidence: { delta: "0.1", previousParticipants: 1, currentParticipants: 1 },
    });
  });
  it("emergence is distinguished from unchanged balanced input", () => {
    expect(calculateDirectionChange(signal("0"), signal("1", 1)).reason).toBe(
      "DIRECTION_EMERGED_BUY",
    );
    expect(calculateDirectionChange(signal("0"), signal("-1", 1)).reason).toBe(
      "DIRECTION_EMERGED_SELL",
    );
  });
  it("canonical key order and repeat evaluation preserve identity", () => {
    const a = signal("1"),
      b = signal("-1", 1);
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as DirectionSignal;
    expect(calculateDirectionChange(a, reordered)).toEqual(calculateDirectionChange(a, b));
    expect(() => calculateDirectionChange(b, a)).toThrow("NON_ADJACENT");
  });
  it.each([
    { coin: "ETH" },
    { signalVersion: "signal-v2" },
    { selectionRunId: "other" },
    { cohortFingerprint: "b".repeat(64) },
    { weightSnapshotId: "b".repeat(64), weightInputFingerprint: "b".repeat(64) },
    { weightVersion: "weight-v2" },
    { aggregationVersion: "other" },
    { behaviorVersion: "other" },
    { status: "NO_SIGNAL" },
    { status: "BLOCKED" },
    { status: "NOT_COMPUTED" },
    { netSignal: "NaN" },
    { netSignal: "1.0" },
    { netSignal: "-0" },
    { netSignal: "1e-1" },
    { netSignal: "2" },
    { confidence: "0.0000000000000000001" },
    { participatingWalletCount: 0 },
    { id: "invalid" },
    { buyStrength: "0.1" },
  ])("rejects incompatible or malformed input %j", (patch) => {
    expect(() =>
      calculateDirectionChange(signal("1"), { ...signal("1", 1), ...patch } as DirectionSignal),
    ).toThrow();
  });
  it("requires exact aligned 15m buckets, no interpolation or duplicate timestamps", () => {
    expect(() => calculateDirectionChange(signal("1"), signal("-1", 2))).toThrow("NON_ADJACENT");
    expect(() => calculateDirectionChange(signal("1"), signal("-1", 0))).toThrow("NON_ADJACENT");
    expect(() =>
      calculateDirectionChange(signal("1"), {
        ...signal("1", 1),
        bucketStart: "2026-01-01T00:16:00.000Z",
      }),
    ).toThrow();
  });
});
