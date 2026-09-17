import { describe, expect, it } from "vitest";

import {
  buildHistoricalFillPlan,
  estimateHistoricalFillCost,
  parseHistoricalFillLine,
  selectAndDeduplicateHistoricalFills,
  type HistoricalFillObject,
} from "./historical-fills.js";

const wallet = "0x1111111111111111111111111111111111111111";
const otherWallet = "0x2222222222222222222222222222222222222222";
const objectSha256 = "a".repeat(64);
const inventoryManifestSha256 = "b".repeat(64);

function inventoryObject(
  hourStart: string,
  format: HistoricalFillObject["format"] = "NODE_FILLS_BY_BLOCK",
): HistoricalFillObject {
  const suffix = hourStart.replaceAll(/[-:TZ.]/g, "");
  const prefix = format === "NODE_FILLS" ? "node_fills" : "node_fills_by_block";
  return {
    bucket: "hl-mainnet-node-data",
    etag: `etag-${suffix}`,
    format,
    hourStart,
    key: `${prefix}/hourly/${suffix}`,
    lastModified: "2026-08-01T00:00:00.000Z",
    sizeBytes: "1073741824",
  };
}

function fill(
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    closedPnl: "0",
    coin: "BTC",
    crossed: true,
    dir: "Open Long",
    fee: "0.01",
    feeToken: "USDC",
    hash: "0xfill",
    oid: "100",
    px: "100.0",
    side: "B",
    startPosition: "0",
    sz: "1.00",
    tid: "9007199254740993",
    time: 1_775_212_400_000,
    ...overrides,
  };
}

function provenance(format: "NODE_FILLS" | "NODE_FILLS_BY_BLOCK") {
  const prefix = format === "NODE_FILLS" ? "node_fills" : "node_fills_by_block";
  return {
    bucket: "hl-mainnet-node-data" as const,
    etag: "fixture-etag",
    format,
    hourStart: "2026-04-02T10:00:00.000Z",
    inventoryManifestSha256,
    key: `${prefix}/hourly/20260402/10`,
    lastModified: "2026-08-01T00:00:00.000Z",
    lineNumber: 1,
    objectSha256,
    parserVersion: "hyperliquid-official-fills-v1" as const,
    requesterCharged: true as const,
    sizeBytes: "1024",
  };
}

describe("Hyperliquid historical fill inventory", () => {
  it("proves an inclusive hourly range only with one exact official object per hour", () => {
    const plan = buildHistoricalFillPlan(
      {
        bucket: "hl-mainnet-node-data",
        generatedAt: "2026-08-01T00:00:00.000Z",
        objects: [
          inventoryObject("2026-04-02T10:00:00.000Z"),
          inventoryObject("2026-04-02T11:00:00.000Z"),
        ],
        requesterPays: true,
      },
      [
        {
          from: "2026-04-02T10:15:00.000Z",
          to: "2026-04-02T11:45:00.000Z",
          walletAddress: wallet.toUpperCase().replace("0X", "0x"),
          walletAddressId: "wallet-1",
        },
      ],
    );

    expect(plan.complete).toBe(true);
    expect(plan.inventoryManifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.selectedObjects).toHaveLength(2);
    expect(plan.totalBytes).toBe("2147483648");
    expect(plan.targets[0]?.walletAddress).toBe(wallet);
  });

  it("fails coverage closed for missing or format-ambiguous hours", () => {
    const duplicateHour = "2026-04-02T10:00:00.000Z";
    const plan = buildHistoricalFillPlan(
      {
        bucket: "hl-mainnet-node-data",
        generatedAt: "2026-08-01T00:00:00.000Z",
        objects: [inventoryObject(duplicateHour), inventoryObject(duplicateHour, "NODE_FILLS")],
        requesterPays: true,
      },
      [
        {
          from: duplicateHour,
          to: "2026-04-02T11:00:00.000Z",
          walletAddress: wallet,
          walletAddressId: "wallet-1",
        },
      ],
    );

    expect(plan.complete).toBe(false);
    expect(plan.ambiguousHours).toEqual([duplicateHour]);
    expect(plan.missingHours).toEqual(["2026-04-02T11:00:00.000Z"]);
  });

  it("uses Decimal strings and caller-supplied AWS rates for cost estimation", () => {
    const plan = buildHistoricalFillPlan(
      {
        bucket: "hl-mainnet-node-data",
        generatedAt: "2026-08-01T00:00:00.000Z",
        objects: [inventoryObject("2026-04-02T10:00:00.000Z")],
        requesterPays: true,
      },
      [
        {
          from: "2026-04-02T10:00:00.000Z",
          to: "2026-04-02T10:59:59.999Z",
          walletAddress: wallet,
          walletAddressId: "wallet-1",
        },
      ],
    );

    expect(
      estimateHistoricalFillCost(plan, {
        egressUsdPerGib: "0.09",
        getRequestUsdPerThousand: "0.0004",
        inventoryRequestCount: "3",
        inventoryRequestUsdPerThousand: "0.005",
      }),
    ).toEqual({
      downloadGib: "1.000000000",
      egressUsd: "0.090000000",
      getRequestCount: "1",
      getRequestUsd: "0.000000400",
      inventoryRequestCount: "3",
      inventoryRequestUsd: "0.000015000",
      totalUsd: "0.090015400",
    });
  });
});

describe("Hyperliquid historical fill formats and deduplication", () => {
  it("parses the legacy address/fill line without losing a large tid", () => {
    const records = parseHistoricalFillLine(JSON.stringify([wallet, fill()]), {
      ...provenance("NODE_FILLS"),
      lineNumber: 12,
    });

    expect(records).toHaveLength(1);
    expect(records[0]?.fill.tid).toBe("9007199254740993");
    expect(records[0]?.provenance.eventIndex).toBe(0);
  });

  it("parses the by-block envelope and preserves block/event provenance", () => {
    const records = parseHistoricalFillLine(
      JSON.stringify({
        block_number: "12345678901234567890",
        block_time: "2026-04-02T10:20:00.000Z",
        events: [
          [wallet, fill()],
          [otherWallet, fill({ hash: "0xother", tid: "2" })],
        ],
        local_time: "2026-04-02T10:20:01.000Z",
      }),
      {
        ...provenance("NODE_FILLS_BY_BLOCK"),
        lineNumber: 3,
      },
    );

    expect(records).toHaveLength(2);
    expect(records[1]?.provenance).toMatchObject({
      blockNumber: "12345678901234567890",
      eventIndex: 1,
    });
  });

  it("selects exact wallets, collapses equivalent duplicates, and rejects conflicts", () => {
    const source = provenance("NODE_FILLS");
    const first = parseHistoricalFillLine(JSON.stringify([wallet, fill()]), source)[0]!;
    const same = parseHistoricalFillLine(
      JSON.stringify([wallet, fill({ px: "100.000", sz: "1" })]),
      source,
    )[0]!;
    const unrelated = parseHistoricalFillLine(
      JSON.stringify([otherWallet, fill({ hash: "0xother", tid: "2" })]),
      source,
    )[0]!;

    expect(selectAndDeduplicateHistoricalFills([first, same, unrelated], [wallet])).toMatchObject({
      duplicates: 1,
      fills: [first],
    });

    const conflicting = parseHistoricalFillLine(
      JSON.stringify([wallet, fill({ hash: "0xconflict" })]),
      source,
    )[0]!;
    expect(() => selectAndDeduplicateHistoricalFills([first, conflicting], [wallet])).toThrow(
      "Conflicting historical fill payloads",
    );
  });
});
