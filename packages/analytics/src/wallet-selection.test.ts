import { describe, expect, it } from "vitest";

import {
  DEFAULT_WALLET_SELECTION_POLICY,
  effectiveWalletSelectionStatus,
  evaluateWalletSelection,
  type WalletSelectionCandidateInput,
} from "./index.js";

const evaluatedAt = "2026-08-08T00:00:00.000Z";

function candidate(
  address: string,
  overrides: Partial<WalletSelectionCandidateInput> = {},
): WalletSelectionCandidateInput {
  return {
    address,
    lastSyncAt: "2026-08-07T12:00:00.000Z",
    performance: {
      annualizedReturn: "0.2",
      annualizedReturnCalculationFrom: "2026-04-01T00:00:00.000Z",
      annualizedReturnCalculationTo: "2026-08-01T00:00:00.000Z",
      calculationVersion: "performance-v3",
      historyCompleteness: "COMPLETE",
      maxDrawdown: "-0.1",
      runId: `run-${address}`,
      topTradeContribution: "0.2",
      trustedClosedCycleCount: 30,
    },
    walletAddressId: `wallet-${address}`,
    ...overrides,
  };
}

function result(input: WalletSelectionCandidateInput) {
  return evaluateWalletSelection([input], DEFAULT_WALLET_SELECTION_POLICY, evaluatedAt)[0]!;
}

describe("wallet-selection-v1", () => {
  it("reviews a wallet without a performance-v3 run, including a v2-only wallet", () => {
    expect(result(candidate("0x01", { performance: null }))).toMatchObject({
      automaticStatus: "REVIEW",
      reasonCodes: ["NO_PERFORMANCE_V3"],
    });
    expect(
      result(
        candidate("0x02", {
          performance: {
            ...candidate("0x02").performance!,
            calculationVersion: "performance-v2",
          },
        }),
      ),
    ).toMatchObject({ automaticStatus: "REVIEW", reasonCodes: ["NO_PERFORMANCE_V3"] });
  });

  it.each([
    ["historyCompleteness", "PARTIAL", "HISTORY_INCOMPLETE"],
    ["annualizedReturnCalculationFrom", "2026-07-15T00:00:00.000Z", "EVALUATION_PERIOD_TOO_SHORT"],
    ["trustedClosedCycleCount", 19, "TOO_FEW_COMPLETED_TRADES"],
    ["annualizedReturn", null, "REQUIRED_METRIC_MISSING"],
    ["maxDrawdown", null, "REQUIRED_METRIC_MISSING"],
    ["topTradeContribution", null, "REQUIRED_METRIC_MISSING"],
  ])("reviews an input with %s=%s", (field, value, reason) => {
    const base = candidate("0x03");
    expect(
      result(
        candidate("0x03", {
          performance: { ...base.performance!, [field]: value },
        }),
      ),
    ).toMatchObject({ automaticStatus: "REVIEW", reasonCodes: [reason] });
  });

  it("reviews stale or missing synchronization data", () => {
    expect(result(candidate("0x04", { lastSyncAt: "2026-08-06T00:00:00.000Z" }))).toMatchObject({
      automaticStatus: "REVIEW",
      reasonCodes: ["DATA_STALE"],
    });
    expect(result(candidate("0x05", { lastSyncAt: null }))).toMatchObject({
      automaticStatus: "REVIEW",
      reasonCodes: ["DATA_STALE"],
    });
  });

  it.each([
    [null, "2026-08-01T00:00:00.000Z"],
    ["2026-04-01T00:00:00.000Z", null],
    ["invalid", "2026-08-01T00:00:00.000Z"],
    ["2026-08-02T00:00:00.000Z", "2026-08-01T00:00:00.000Z"],
  ])(
    "fails closed when the annualized-return period is %s to %s",
    (annualizedReturnCalculationFrom, annualizedReturnCalculationTo) => {
      const base = candidate("0x-period");
      expect(
        result(
          candidate("0x-period", {
            performance: {
              ...base.performance!,
              annualizedReturnCalculationFrom,
              annualizedReturnCalculationTo,
            },
          }),
        ),
      ).toMatchObject({
        automaticStatus: "REVIEW",
        reasonCodes: ["EVALUATION_PERIOD_TOO_SHORT"],
      });
    },
  );

  it("does not add an evaluation-period reason when annualized return is missing", () => {
    const base = candidate("0x-missing-return");
    expect(
      result(
        candidate("0x-missing-return", {
          performance: {
            ...base.performance!,
            annualizedReturn: null,
            annualizedReturnCalculationFrom: null,
            annualizedReturnCalculationTo: null,
          },
        }),
      ),
    ).toMatchObject({ automaticStatus: "REVIEW", reasonCodes: ["REQUIRED_METRIC_MISSING"] });
  });

  it.each([
    ["annualizedReturn", "-0.01", "RETURN_BELOW_MINIMUM"],
    ["maxDrawdown", "-0.500000000000000001", "DRAWDOWN_TOO_HIGH"],
    ["topTradeContribution", "0.750000000000000001", "PROFIT_TOO_CONCENTRATED"],
  ])("excludes an input with %s=%s", (field, value, reason) => {
    const base = candidate("0x06");
    expect(
      result(
        candidate("0x06", {
          performance: { ...base.performance!, [field]: value },
        }),
      ),
    ).toMatchObject({ automaticStatus: "EXCLUDED", reasonCodes: [reason] });
  });

  it("qualifies every passing wallet and selects only the configured top N", () => {
    const policy = { ...DEFAULT_WALLET_SELECTION_POLICY, maxAutoSelected: 2 };
    const results = evaluateWalletSelection(
      [
        candidate("0x03", {
          performance: { ...candidate("0x03").performance!, annualizedReturn: "0.1" },
        }),
        candidate("0x01", {
          performance: { ...candidate("0x01").performance!, annualizedReturn: "0.3" },
        }),
        candidate("0x02", {
          performance: { ...candidate("0x02").performance!, annualizedReturn: "0.2" },
        }),
      ],
      policy,
      evaluatedAt,
    );
    expect(
      results.map(({ address, automaticStatus, rank }) => [address, automaticStatus, rank]),
    ).toEqual([
      ["0x01", "SELECTED", 1],
      ["0x02", "SELECTED", 2],
      ["0x03", "QUALIFIED", 3],
    ]);
  });

  it("uses drawdown magnitude, completed cycles, then address for deterministic ties", () => {
    const inputs = [
      candidate("0x04", {
        performance: {
          ...candidate("0x04").performance!,
          maxDrawdown: "-0.2",
          trustedClosedCycleCount: 40,
        },
      }),
      candidate("0x03", {
        performance: {
          ...candidate("0x03").performance!,
          maxDrawdown: "-0.1",
          trustedClosedCycleCount: 20,
        },
      }),
      candidate("0x02", {
        performance: {
          ...candidate("0x02").performance!,
          maxDrawdown: "-0.1",
          trustedClosedCycleCount: 30,
        },
      }),
      candidate("0x01", {
        performance: {
          ...candidate("0x01").performance!,
          maxDrawdown: "-0.1",
          trustedClosedCycleCount: 30,
        },
      }),
    ];
    const ranked = evaluateWalletSelection(inputs, DEFAULT_WALLET_SELECTION_POLICY, evaluatedAt);
    expect(
      [...ranked].sort((left, right) => left.rank! - right.rank!).map(({ address }) => address),
    ).toEqual(["0x01", "0x02", "0x03", "0x04"]);
  });

  it("does not pad the selected set when fewer wallets pass", () => {
    const results = evaluateWalletSelection(
      [candidate("0x01"), candidate("0x02", { performance: null })],
      DEFAULT_WALLET_SELECTION_POLICY,
      evaluatedAt,
    );
    expect(results.filter((item) => item.automaticStatus === "SELECTED")).toHaveLength(1);
  });

  it("accepts every exact policy boundary", () => {
    const base = candidate("0x-boundary");
    expect(
      result(
        candidate("0x-boundary", {
          lastSyncAt: "2026-08-07T00:00:00.000Z",
          performance: {
            ...base.performance!,
            annualizedReturn: "0",
            maxDrawdown: "-0.5",
            topTradeContribution: "0.75",
          },
        }),
      ),
    ).toMatchObject({ automaticStatus: "SELECTED", reasonCodes: [] });
  });

  it("selects no wallets when maxAutoSelected is zero", () => {
    const results = evaluateWalletSelection(
      [candidate("0x01"), candidate("0x02")],
      { ...DEFAULT_WALLET_SELECTION_POLICY, maxAutoSelected: 0 },
      evaluatedAt,
    );
    expect(results.filter((item) => item.automaticStatus === "SELECTED")).toHaveLength(0);
    expect(results.every((item) => item.automaticStatus === "QUALIFIED")).toBe(true);
  });

  it("applies manual decisions without erasing the automatic result", () => {
    expect(effectiveWalletSelectionStatus("REVIEW", "AUTO")).toBe("REVIEW");
    expect(effectiveWalletSelectionStatus("REVIEW", "INCLUDE")).toBe("SELECTED");
    expect(effectiveWalletSelectionStatus("SELECTED", "EXCLUDE")).toBe("EXCLUDED");
    expect(effectiveWalletSelectionStatus("REVIEW", "AUTO")).toBe("REVIEW");
  });
});
