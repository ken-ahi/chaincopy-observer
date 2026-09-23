import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type WalletRankingItem } from "../lib/wallet-selection-api";

import {
  formatSelectionDate,
  formatSelectionDecimal,
  formatSelectionPercent,
  sortWalletRankingItems,
} from "./selection-display.js";

function item(overrides: Partial<WalletRankingItem> = {}): WalletRankingItem {
  return {
    address: "0x1111111111111111111111111111111111111111",
    automaticStatus: "SELECTED",
    lastSyncAt: "2026-09-23T00:00:00.000Z",
    latestActivityAt: "2026-09-22T23:00:00.000Z",
    metrics: {
      annualizedReturn: "0.2",
      cumulativeReturn: "0.4",
      maxDrawdown: "-0.1",
      profitFactor: "2.5",
      winRate: "0.6",
    },
    performanceRunId: "performance-run-1",
    rank: 1,
    trustedClosedCycleCount: 30,
    walletAddressId: "wallet-1",
    ...overrides,
  };
}

describe("automatic wallet ranking display", () => {
  it("uses the persisted deterministic rank and address as a stable fallback", () => {
    const items = [
      item({ address: "0x03", rank: 2, walletAddressId: "3" }),
      item({ address: "0x02", rank: 1, walletAddressId: "2" }),
      item({ address: "0x01", rank: 1, walletAddressId: "1" }),
    ];

    expect(sortWalletRankingItems(items).map(({ address }) => address)).toEqual([
      "0x01",
      "0x02",
      "0x03",
    ]);
  });

  it("formats stored Decimal strings only at presentation time", () => {
    expect(formatSelectionPercent("0.3412", true)).toBe("+34.12%");
    expect(formatSelectionPercent(undefined)).toBe("-");
    expect(formatSelectionDecimal("2.345")).toBe("2.35");
    expect(formatSelectionDate("invalid")).toBe("-");
  });

  it("uses the eligible-only ranking API and omits review, rejection, and manual inclusion UX", () => {
    const source = readFileSync(new URL("./selection-client.tsx", import.meta.url), "utf8");
    expect(source).toContain("/api/wallet-selection/ranking");
    expect(source).toContain("総合ランキング");
    expect(source).toContain("完了取引");
    expect(source).toContain("勝率");
    expect(source).toContain("Profit Factor");
    expect(source).not.toContain("REVIEW");
    expect(source).not.toContain("EXCLUDED");
    expect(source).not.toContain("理由を見る");
    expect(source).not.toContain("参考対象にする");
    expect(source).not.toContain("再評価");
  });

  it("keeps the authenticated page and safe same-origin API route", () => {
    const page = readFileSync(
      new URL("../app/dashboard/selection/page.tsx", import.meta.url),
      "utf8",
    );
    const route = readFileSync(
      new URL("../app/api/wallet-selection/[[...path]]/route.ts", import.meta.url),
      "utf8",
    );
    expect(page).toContain("requireAdminSession");
    expect(route).toContain("proxyInternalApi");
    expect(route).toContain("safeJsonResponse: true");
    expect(route).not.toContain("API_BASE_URL");
  });
});
