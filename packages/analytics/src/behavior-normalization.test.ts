import { describe, expect, it } from "vitest";

import {
  canonicalDecimal,
  normalizeTimestampGroup,
  type BehaviorFillInput,
} from "./behavior-normalization.js";

const at = new Date("2026-08-23T00:00:00.123Z");
const market = { quoteAsset: "USDC", usdEquivalent: true } as const;

function fill(
  id: string,
  startPosition: string,
  side: "BUY" | "SELL",
  quantity: string,
  price = "100",
): BehaviorFillInput {
  return {
    coin: "BTC",
    occurredAt: at,
    price,
    quantity,
    side,
    sourceEventId: id,
    sourceTradeId: id.replace("fill-", ""),
    startPosition,
  };
}

describe("behavior-v1 normalization", () => {
  it("canonicalizes Decimal strings without JavaScript number arithmetic", () => {
    expect(canonicalDecimal("+01.2300")).toBe("1.23");
    expect(canonicalDecimal("-0.000")).toBe("0");
    expect(() => canonicalDecimal("NaN")).toThrow();
  });
  it.each([
    ["LONG open", "0", fill("fill-1", "0", "BUY", "2"), "POSITION_OPEN", "LONG", "2"],
    ["LONG increase", "2", fill("fill-1", "2", "BUY", "1"), "POSITION_INCREASE", "LONG", "3"],
    ["LONG partial reduce", "3", fill("fill-1", "3", "SELL", "1"), "POSITION_REDUCE", "LONG", "2"],
    ["LONG close", "2", fill("fill-1", "2", "SELL", "2"), "POSITION_CLOSE", "LONG", "0"],
    ["SHORT open", "0", fill("fill-1", "0", "SELL", "2"), "POSITION_OPEN", "SHORT", "-2"],
    ["SHORT increase", "-2", fill("fill-1", "-2", "SELL", "1"), "POSITION_INCREASE", "SHORT", "-3"],
    ["SHORT reduce", "-3", fill("fill-1", "-3", "BUY", "1"), "POSITION_REDUCE", "SHORT", "-2"],
    ["SHORT close", "-2", fill("fill-1", "-2", "BUY", "2"), "POSITION_CLOSE", "SHORT", "0"],
  ] as const)("normalizes %s", (_name, boundary, input, eventType, direction, after) => {
    const result = normalizeTimestampGroup({ boundaryPosition: boundary, fills: [input], market });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.afterPosition).toBe(after);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      eventType,
      direction,
      notionalDeltaUsd: new Map([
        ["1", "100"],
        ["2", "200"],
      ]).get(input.quantity),
    });
  });

  it.each([
    ["LONG to SHORT", "2", fill("fill-1", "2", "SELL", "5"), ["LONG", "SHORT"], ["-2", "-3"]],
    ["SHORT to LONG", "-2", fill("fill-1", "-2", "BUY", "5"), ["SHORT", "LONG"], ["2", "3"]],
  ] as const)(
    "splits %s into deterministic CLOSE and OPEN",
    (_name, boundary, input, directions, deltas) => {
      const result = normalizeTimestampGroup({
        boundaryPosition: boundary,
        fills: [input],
        market,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.events.map((event) => event.eventType)).toEqual([
        "POSITION_CLOSE",
        "POSITION_OPEN",
      ]);
      expect(result.events.map((event) => event.direction)).toEqual(directions);
      expect(result.events.map((event) => event.quantityDelta)).toEqual(deltas);
      expect(result.events.map((event) => event.sourceOrdinal)).toEqual([0, 1]);
      expect(new Set(result.events.map((event) => event.fingerprint)).size).toBe(2);
    },
  );

  it("recovers the unique causal chain without using tid order", () => {
    const result = normalizeTimestampGroup({
      boundaryPosition: "0",
      fills: [fill("fill-1", "2", "SELL", "1"), fill("fill-99", "0", "BUY", "2")],
      market,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.orderedSourceEventIds).toEqual(["fill-99", "fill-1"]);
  });

  it("fails closed when more than one causal chain is valid", () => {
    const result = normalizeTimestampGroup({
      boundaryPosition: "0",
      fills: [
        fill("fill-1", "0", "BUY", "1"),
        fill("fill-2", "0", "BUY", "2"),
        fill("fill-3", "1", "SELL", "1"),
        fill("fill-4", "2", "SELL", "2"),
      ],
      market,
    });
    expect(result).toMatchObject({ ok: false, reason: "ORDERING_AMBIGUOUS" });
  });

  it("deduplicates an identical source event", () => {
    const duplicate = fill("fill-1", "0", "BUY", "1");
    const result = normalizeTimestampGroup({
      boundaryPosition: "0",
      fills: [duplicate, duplicate],
      market,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.events).toHaveLength(1);
  });

  it("rejects conflicting snapshots for one source identity", () => {
    expect(
      normalizeTimestampGroup({
        boundaryPosition: "0",
        fills: [fill("fill-1", "0", "BUY", "1"), fill("fill-1", "0", "BUY", "2")],
        market,
      }),
    ).toMatchObject({ ok: false, reason: "SOURCE_INCONSISTENT" });
  });

  it("handles a timestamp group larger than the read batch", () => {
    const fills = Array.from({ length: 5_001 }, (_, index) =>
      fill(`fill-${index}`, String(index), "BUY", "1"),
    );
    const result = normalizeTimestampGroup({ boundaryPosition: "0", fills, market });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.afterPosition).toBe("5001");
  });

  it("fails closed without a boundary or proven USD quote", () => {
    expect(
      normalizeTimestampGroup({
        boundaryPosition: null,
        fills: [fill("fill-1", "0", "BUY", "1")],
        market,
      }),
    ).toMatchObject({ ok: false, reason: "MISSING_BOUNDARY" });
    expect(
      normalizeTimestampGroup({
        boundaryPosition: "0",
        fills: [fill("fill-1", "0", "BUY", "1")],
        market: { quoteAsset: "UNKNOWN", usdEquivalent: false },
      }),
    ).toMatchObject({ ok: false, reason: "UNSUPPORTED_QUOTE" });
  });
});
