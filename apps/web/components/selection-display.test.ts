import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { type WalletSelectionItem } from "../lib/wallet-selection-api";

import {
  dataCertaintyLabel,
  formatSelectionPercent,
  selectionReasonLabel,
  selectionReasonSummary,
  selectionStatusAnnotations,
  selectionStatusLabels,
  selectionSummary,
  sortSelectionItems,
} from "./selection-display.js";

function item(overrides: Partial<WalletSelectionItem> = {}): WalletSelectionItem {
  return {
    address: "0x1111111111111111111111111111111111111111",
    automaticStatus: "REVIEW",
    effectiveStatus: "REVIEW",
    historyCompleteness: "PARTIAL",
    lastSyncAt: "2026-08-08T00:00:00.000Z",
    manualOverride: "AUTO",
    metrics: {},
    overrideNote: null,
    performanceRunId: "performance-run-1",
    rank: null,
    reasonCodes: ["HISTORY_INCOMPLETE"],
    trustedClosedCycleCount: 10,
    walletAddressId: "wallet-1",
    ...overrides,
  };
}

describe("wallet selection display", () => {
  it("uses beginner-facing Japanese labels for every status and reason", () => {
    expect(selectionStatusLabels).toEqual({
      EXCLUDED: "対象外",
      QUALIFIED: "候補",
      REVIEW: "要確認",
      SELECTED: "参考対象",
    });
    expect(selectionReasonSummary(item())).toBe("履歴不足");
    expect(selectionReasonLabel("HISTORY_INCOMPLETE")).toBe("取引履歴の一部が不足しています");
    expect(selectionReasonLabel("UNKNOWN_FUTURE_REASON")).not.toContain("UNKNOWN_FUTURE_REASON");
    expect(selectionReasonSummary(item({ reasonCodes: ["UNKNOWN_FUTURE_REASON"] }))).not.toContain(
      "UNKNOWN_FUTURE_REASON",
    );
  });

  it("keeps the automatic reason summary next to a manual override", () => {
    expect(
      selectionStatusAnnotations(
        item({
          automaticStatus: "REVIEW",
          effectiveStatus: "SELECTED",
          manualOverride: "INCLUDE",
          reasonCodes: ["HISTORY_INCOMPLETE"],
        }),
      ),
    ).toEqual({ manualLabel: "手動設定", reasonSummary: "履歴不足" });
  });

  it("counts effective states so manual overrides are reflected", () => {
    const summary = selectionSummary([
      item({ effectiveStatus: "SELECTED", manualOverride: "INCLUDE" }),
      item({ effectiveStatus: "REVIEW", walletAddressId: "wallet-2" }),
      item({ effectiveStatus: "EXCLUDED", walletAddressId: "wallet-3" }),
    ]);
    expect(summary.map(({ label, value }) => [label, value])).toEqual([
      ["参考対象", 1],
      ["候補", 0],
      ["要確認", 1],
      ["対象外", 1],
    ]);
  });

  it("sorts by state, rank, annualized return, then address", () => {
    const items = [
      item({ address: "0x03", effectiveStatus: "REVIEW", walletAddressId: "3" }),
      item({
        address: "0x02",
        automaticStatus: "SELECTED",
        effectiveStatus: "SELECTED",
        metrics: { annualizedReturn: "100000000000000000000.1" },
        rank: 2,
        reasonCodes: [],
        walletAddressId: "2",
      }),
      item({
        address: "0x01",
        automaticStatus: "SELECTED",
        effectiveStatus: "SELECTED",
        metrics: { annualizedReturn: "0.2" },
        rank: 1,
        reasonCodes: [],
        walletAddressId: "1",
      }),
    ];
    expect(sortSelectionItems(items).map(({ address }) => address)).toEqual([
      "0x01",
      "0x02",
      "0x03",
    ]);
  });

  it("formats values only at presentation time", () => {
    expect(formatSelectionPercent("0.3412", true)).toBe("+34.12%");
    expect(formatSelectionPercent(undefined)).toBe("-");
  });

  it.each([
    ["SELECTED", "SELECTED", "AUTO", [], "高い"],
    ["QUALIFIED", "QUALIFIED", "AUTO", [], "高い"],
    ["EXCLUDED", "EXCLUDED", "AUTO", ["RETURN_BELOW_MINIMUM"], "高い"],
    ["REVIEW", "REVIEW", "AUTO", ["DATA_STALE"], "確認が必要"],
    ["REVIEW", "REVIEW", "AUTO", ["REQUIRED_METRIC_MISSING"], "確認が必要"],
    ["REVIEW", "SELECTED", "INCLUDE", ["DATA_STALE"], "確認が必要"],
  ] as const)(
    "reports certainty from automatic status %s even when effective status is %s",
    (automaticStatus, effectiveStatus, manualOverride, reasonCodes, expected) => {
      expect(
        dataCertaintyLabel(
          item({
            automaticStatus,
            effectiveStatus,
            historyCompleteness: "COMPLETE",
            manualOverride,
            reasonCodes: [...reasonCodes],
          }),
        ),
      ).toBe(expected);
    },
  );

  it("requires confirmation for partial history and reports missing performance as unconfirmed", () => {
    expect(dataCertaintyLabel(item({ historyCompleteness: "PARTIAL" }))).toBe("確認が必要");
    expect(dataCertaintyLabel(item({ historyCompleteness: null }))).toBe("未確認");
  });

  it("keeps settings collapsed, supports filters and manual actions, and hides technical copy", () => {
    const source = readFileSync(new URL("./selection-client.tsx", import.meta.url), "utf8");
    expect(source).toContain("<details");
    expect(source).toContain("参考状態で絞り込む");
    expect(source).toContain("参考対象にする");
    expect(source).toContain("対象外にする");
    expect(source).toContain("自動判定に戻す");
    expect(source).toContain("理由を見る");
    expect(source).not.toContain("policyVersion");
    expect(source).not.toContain("inputFingerprint");
    expect(source).not.toContain("Performance Run");
  });

  it("adds the authenticated page and safe same-origin API route", () => {
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
