import { fillSchema } from "@chaincopy/blockchain-adapters";
import { describe, expect, it } from "vitest";

import {
  countPositionRelatedFills,
  evaluateEnrichedCandidate,
  evaluateLightweightCandidate,
  type DiscoveryFilterSettings,
} from "./filter.js";

const settings: DiscoveryFilterSettings = {
  fullMinimumActiveDays: 180,
  fullMinimumActiveMonths: 6,
  fullMinimumNotionalUsd: "10000",
  fullMinimumTradeCount: 30,
  fullRecentActivityDays: 90,
  minimumObservedNotionalUsd: "10000",
  minimumObservedTradeCount: 10,
  recentActivityHours: 24,
};

describe("candidate lightweight filter", () => {
  it("passes only a recent valid non-system address meeting both thresholds", () => {
    const now = new Date("2026-07-26T00:00:00.000Z");
    expect(
      evaluateLightweightCandidate(
        {
          address: "0x1111111111111111111111111111111111111111",
          enrichmentStatus: "PENDING",
          estimatedNotionalUsd: "10000.000000000000000001",
          lastSeenAt: new Date("2026-07-25T23:00:00.000Z"),
          nextEnrichmentAt: null,
          tradeCount: 10,
        },
        settings,
        {
          alreadyWatched: false,
          knownSystemAddresses: new Set(),
          now,
        },
      ),
    ).toEqual({ eligible: true, reasons: [], status: "LIGHT_ELIGIBLE" });
  });

  it("rejects watched, malformed, stale, low-volume, and system addresses with reasons", () => {
    const result = evaluateLightweightCandidate(
      {
        address: "invalid",
        enrichmentStatus: "PENDING",
        estimatedNotionalUsd: "9999.999999999999999999",
        lastSeenAt: new Date("2026-07-20T00:00:00.000Z"),
        nextEnrichmentAt: null,
        tradeCount: 9,
      },
      settings,
      {
        alreadyWatched: true,
        knownSystemAddresses: new Set(["invalid"]),
        now: new Date("2026-07-26T00:00:00.000Z"),
      },
    );

    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        "INVALID_EVM_ADDRESS",
        "KNOWN_SYSTEM_ADDRESS",
        "ALREADY_WATCHED_ADDRESS",
        "OBSERVED_TRADE_COUNT_BELOW_MINIMUM",
        "OBSERVED_NOTIONAL_BELOW_MINIMUM",
        "LAST_ACTIVITY_OUTSIDE_LIGHT_WINDOW",
      ]),
    );
  });
});

describe("candidate enriched filter", () => {
  it("marks API-limited history as insufficient instead of excluded", () => {
    const fills = [
      makeFill("BTC", "10000", "1", Date.parse("2026-01-01T00:00:00.000Z"), "1"),
      makeFill("ETH", "10000", "1", Date.parse("2026-07-01T00:00:00.000Z"), "2"),
    ];
    const result = evaluateEnrichedCandidate(
      fills,
      true,
      settings,
      new Date("2026-07-26T00:00:00.000Z"),
    );

    expect(result.status).toBe("INSUFFICIENT_HISTORY");
    expect(result.completeness).toBe("PARTIAL");
    expect(result.reasons).toContain("API_HISTORY_LIMIT_REACHED");
  });

  it("applies full history thresholds deterministically with Decimal notionals", () => {
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const fills = Array.from({ length: 30 }, (_, index) =>
      makeFill(
        index % 2 === 0 ? "BTC" : "ETH",
        "1000.000000000000000001",
        "1",
        start + index * 7 * 24 * 60 * 60 * 1_000,
        String(index),
      ),
    );
    const result = evaluateEnrichedCandidate(
      fills,
      false,
      settings,
      new Date("2026-07-26T00:00:00.000Z"),
    );

    expect(result.status).toBe("ELIGIBLE");
    expect(result.completeness).toBe("COMPLETE");
    expect(result.cumulativeNotionalUsd).toBe("30000.00000000000000003");
  });

  it("derives long and short relations from enriched fill directions without side inference", () => {
    const fills = [
      makeFill("BTC", "100", "1", 1, "1", "Open Long"),
      makeFill("BTC", "100", "1", 2, "2", "Close Short"),
      makeFill("BTC", "100", "1", 3, "3", "Long > Short"),
    ];

    expect(countPositionRelatedFills(fills)).toEqual({
      longRelatedCount: 2,
      shortRelatedCount: 2,
    });
  });
});

function makeFill(
  coin: string,
  px: string,
  sz: string,
  time: number,
  tid: string,
  dir = "Open Long",
) {
  return fillSchema.parse({
    closedPnl: "0",
    coin,
    crossed: true,
    dir,
    fee: "0",
    feeToken: "USDC",
    hash: `0x${tid}`,
    oid: tid,
    px,
    side: "B",
    startPosition: "0",
    sz,
    tid,
    time,
  });
}
