import { describe, expect, it } from "vitest";

import {
  DEFAULT_WALLET_SELECTION_V2_POLICY,
  evaluateWalletSelectionV2,
  isEffectivelySelectedV2,
  type WalletSelectionV2CandidateInput,
} from "./wallet-selection-v2.js";

const evaluatedAt = "2026-09-27T00:00:00.000Z";

function candidate(
  address: string,
  overrides: Partial<WalletSelectionV2CandidateInput["performance"]> = {},
): WalletSelectionV2CandidateInput {
  return {
    address,
    lastSyncAt: "2026-09-26T12:00:00.000Z",
    performance: {
      averageLoss: "-10",
      averageWin: "20",
      calculationVersion: "performance-v3",
      maxLosingStreak: "3",
      profitFactor: "1.5",
      runId: `run-${address}`,
      topTradeContribution: "0.2",
      tradeHistoryEvaluable: true,
      trustedClosedCycleCount: 40,
      winRate: "0.6",
      ...overrides,
    },
    walletAddressId: `wallet-${address}`,
  };
}

describe("wallet-selection-v2", () => {
  it("qualifies only a fresh evaluable trade metric set at every hard-gate boundary", () => {
    const [result] = evaluateWalletSelectionV2(
      [
        candidate("0x01", {
          profitFactor: "1",
          topTradeContribution: "0.5",
          trustedClosedCycleCount: 30,
          winRate: "0.55",
        }),
      ],
      DEFAULT_WALLET_SELECTION_V2_POLICY,
      evaluatedAt,
    );

    expect(result).toMatchObject({ automaticStatus: "SELECTED", rank: 1, reasonCodes: [] });
  });

  it.each([
    ["tradeHistoryEvaluable", false, "TRADE_HISTORY_NOT_EVALUABLE"],
    ["trustedClosedCycleCount", 29, "TOO_FEW_COMPLETED_TRADES"],
    ["averageWin", null, "REQUIRED_METRIC_MISSING"],
    ["averageLoss", "0", "REQUIRED_METRIC_INVALID"],
  ] as const)("reviews invalid %s evidence", (field, value, reason) => {
    const [result] = evaluateWalletSelectionV2(
      [candidate("0x01", { [field]: value })],
      DEFAULT_WALLET_SELECTION_V2_POLICY,
      evaluatedAt,
    );

    expect(result).toMatchObject({ automaticStatus: "REVIEW" });
    expect(result?.reasonCodes).toContain(reason);
  });

  it.each(["an unresolved Fill gap", "a truncated or unclosed cycle boundary"])(
    "fails closed before ranking when evaluability reports %s",
    () => {
      const [result] = evaluateWalletSelectionV2(
        [candidate("0x01", { tradeHistoryEvaluable: false })],
        DEFAULT_WALLET_SELECTION_V2_POLICY,
        evaluatedAt,
      );

      expect(result).toMatchObject({
        automaticStatus: "REVIEW",
        rank: null,
        reasonCodes: ["TRADE_HISTORY_NOT_EVALUABLE"],
      });
    },
  );

  it("keeps partial NAV history out of the v2 contract", () => {
    const input = candidate("0x01");
    expect(input.performance).not.toHaveProperty("historyCompleteness");
    expect(
      evaluateWalletSelectionV2([input], DEFAULT_WALLET_SELECTION_V2_POLICY, evaluatedAt)[0],
    ).toMatchObject({ automaticStatus: "SELECTED" });
  });

  it.each([
    ["winRate", "0.549999999999999999", "WIN_RATE_BELOW_MINIMUM"],
    ["profitFactor", "0.999999999999999999", "PROFIT_FACTOR_BELOW_MINIMUM"],
    ["topTradeContribution", "0.500000000000000001", "PROFIT_TOO_CONCENTRATED"],
  ] as const)("excludes a wallet that fails the %s investment gate", (field, value, reason) => {
    const [result] = evaluateWalletSelectionV2(
      [candidate("0x01", { [field]: value })],
      DEFAULT_WALLET_SELECTION_V2_POLICY,
      evaluatedAt,
    );

    expect(result).toMatchObject({ automaticStatus: "EXCLUDED", rank: null });
    expect(result?.reasonCodes).toContain(reason);
  });

  it("uses win rate, cycles, Profit Factor, concentration, then address deterministically", () => {
    const inputs = [
      candidate("0x06", { winRate: "0.6", trustedClosedCycleCount: 50 }),
      candidate("0x05", { winRate: "0.7", trustedClosedCycleCount: 30 }),
      candidate("0x04", { winRate: "0.6", trustedClosedCycleCount: 60 }),
      candidate("0x03", { winRate: "0.6", trustedClosedCycleCount: 50, profitFactor: "2" }),
      candidate("0x02", {
        winRate: "0.6",
        trustedClosedCycleCount: 50,
        profitFactor: "2",
        topTradeContribution: "0.1",
      }),
      candidate("0x01", {
        winRate: "0.6",
        trustedClosedCycleCount: 50,
        profitFactor: "2",
        topTradeContribution: "0.1",
      }),
    ];

    const byRank = evaluateWalletSelectionV2(
      inputs,
      DEFAULT_WALLET_SELECTION_V2_POLICY,
      evaluatedAt,
    )
      .filter((item) => item.rank !== null)
      .sort((left, right) => left.rank! - right.rank!);

    expect(byRank.map((item) => item.address)).toEqual([
      "0x05",
      "0x04",
      "0x01",
      "0x02",
      "0x03",
      "0x06",
    ]);
  });

  it("prevents a high-win-rate small sample from entering ranking", () => {
    const results = evaluateWalletSelectionV2(
      [
        candidate("0x-small", { trustedClosedCycleCount: 5, winRate: "0.99" }),
        candidate("0x-large"),
      ],
      DEFAULT_WALLET_SELECTION_V2_POLICY,
      evaluatedAt,
    );

    expect(results.find((item) => item.address === "0x-small")).toMatchObject({
      automaticStatus: "REVIEW",
      rank: null,
      reasonCodes: ["TOO_FEW_COMPLETED_TRADES"],
    });
    expect(results.find((item) => item.address === "0x-large")?.rank).toBe(1);
  });

  it("reviews stale or missing Performance instead of ranking it", () => {
    const stale = { ...candidate("0x-stale"), lastSyncAt: "2026-09-25T23:59:59.999Z" };
    const missing = { ...candidate("0x-missing"), performance: null };
    const results = evaluateWalletSelectionV2(
      [stale, missing],
      DEFAULT_WALLET_SELECTION_V2_POLICY,
      evaluatedAt,
    );

    expect(results.find((item) => item.address === "0x-stale")?.reasonCodes).toContain(
      "DATA_STALE",
    );
    expect(results.find((item) => item.address === "0x-missing")).toMatchObject({
      automaticStatus: "REVIEW",
      reasonCodes: ["NO_PERFORMANCE_V3"],
    });
  });

  it("rejects a future synchronization timestamp as invalid freshness evidence", () => {
    const input = { ...candidate("0x-future"), lastSyncAt: "2026-09-27T00:00:00.001Z" };

    expect(
      evaluateWalletSelectionV2([input], DEFAULT_WALLET_SELECTION_V2_POLICY, evaluatedAt)[0],
    ).toMatchObject({ automaticStatus: "REVIEW", reasonCodes: ["DATA_STALE"] });
  });

  it("allows only automatic SELECTED status through the v2 administrative denylist", () => {
    expect(isEffectivelySelectedV2("SELECTED", "AUTO")).toBe(true);
    expect(isEffectivelySelectedV2("SELECTED", "EXCLUDE")).toBe(false);
    expect(isEffectivelySelectedV2("REVIEW", "INCLUDE")).toBe(false);
  });
});
