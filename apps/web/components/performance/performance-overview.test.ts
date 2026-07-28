import { readFileSync } from "node:fs";

import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@chaincopy/ui", async () => {
  const { createElement: element } = await import("react");
  const component =
    (tag: string) =>
    ({ children, ...props }: { readonly children?: ReactNode }) =>
      element(tag, props, children);
  return {
    Badge: component("span"),
    Card: component("section"),
    CardContent: component("div"),
    CardHeader: component("header"),
    CardTitle: component("h2"),
  };
});

import { PerformanceMetricCard } from "./performance-metric-card.js";
import { PerformanceOverview } from "./performance-overview.js";
import { formatMetricValue, formatPerformanceDate } from "./performance-formatters.js";
import {
  type AddressPerformanceDto,
  type CalculationRunDto,
  type PerformanceMetricDto,
} from "../../lib/performance-api.js";

const baseRun: CalculationRunDto = {
  runId: "run-20260727",
  status: "SUCCEEDED",
  calculationVersion: "performance-v1",
  calculationFrom: "2026-07-01T00:00:00.000Z",
  calculationTo: "2026-07-27T00:00:00.000Z",
  requestedAt: "2026-07-27T00:01:00.000Z",
  startedAt: "2026-07-27T00:01:01.000Z",
  completedAt: "2026-07-27T00:01:02.000Z",
  historyCompleteness: "COMPLETE",
  precision: "EXACT",
  warningCount: 0,
  warningCodes: [],
  errorCode: null,
  errorMessage: null,
  inputFingerprint: "1234567890abcdef1234567890abcdef",
  inputFingerprintShort: "1234567890ab",
};

const twrMetric: PerformanceMetricDto = {
  metricKey: "twr",
  metricValue: "0.123456789012345678",
  precision: "EXACT",
  status: "AVAILABLE",
  warningCodes: [],
  calculationFrom: baseRun.calculationFrom,
  calculationTo: baseRun.calculationTo,
  metricVersion: "performance-v1",
};

describe("Performance overview", () => {
  it("renders the Performance section and Calculation Details", () => {
    const html = renderPerformance(performance());

    expect(html).toContain("Performance");
    expect(html).toContain("Calculation Details");
    expect(html).toContain("保存済みの計算結果");
  });

  it("renders an explicit loading state", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceOverview, { data: null, error: false, loading: true }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("パフォーマンス情報を読み込み中");
  });

  it("renders the empty state when no calculation run exists", () => {
    const html = renderPerformance({
      ...performance(),
      latestRun: null,
      latestSuccessfulRun: null,
    });

    expect(html).toContain("パフォーマンス計算はまだ実行されていません");
    expect(html).toContain("履歴同期完了後に自動計算されます");
    expect(html).toContain("Performanceを計算");
  });

  it("renders SUCCEEDED with saved metrics", () => {
    const html = renderPerformance(performance({}, { twr: twrMetric }));

    expect(html).toContain("SUCCEEDED · 計算済み");
    expect(html).toContain("TWR");
    expect(html).toContain("12.3456%");
  });

  it("renders INSUFFICIENT_DATA without showing metrics as results", () => {
    const html = renderPerformance(
      performance({
        status: "INSUFFICIENT_DATA",
        precision: "UNAVAILABLE",
        warningCodes: ["MINIMUM_HISTORY_NOT_MET"],
        warningCount: 1,
      }),
    );

    expect(html).toContain("INSUFFICIENT_DATA · データ不足");
    expect(html).toContain("正式評価に必要な履歴が不足しています");
    expect(html).toContain("MINIMUM_HISTORY_NOT_MET");
    expect(html).not.toContain('data-metric-key="twr"');
  });

  it("renders FAILED with a recalculation notice", () => {
    const html = renderPerformance(
      performance({
        status: "FAILED",
        errorCode: "CALCULATION_FAILED",
        errorMessage: "Stored inputs could not be processed.",
      }),
    );

    expect(html).toContain("FAILED · 計算失敗");
    expect(html).toContain("再計算を実行できます");
    expect(html).not.toContain('data-metric-key="twr"');
  });

  it("renders PENDING without showing metrics as results", () => {
    const html = renderPerformance(performance({ status: "PENDING", completedAt: null }));

    expect(html).toContain("PENDING · 計算待ち");
    expect(html).toContain("計算待ちです");
    expect(html).not.toContain('data-metric-key="twr"');
  });

  it("renders RUNNING without showing metrics as results", () => {
    const html = renderPerformance(performance({ status: "RUNNING", completedAt: null }));

    expect(html).toContain("RUNNING · 計算中");
    expect(html).toContain("計算中です");
    expect(html).not.toContain('data-metric-key="twr"');
  });

  it("renders a recalculation action for terminal runs", () => {
    const html = renderPerformance(performance());

    expect(html).toContain("Performanceを再計算");
    expect(html).not.toContain("<button disabled");
  });

  it.each(["PENDING", "RUNNING"] as const)(
    "disables the action while the latest run is %s",
    (status) => {
      const html = renderPerformance(performance({ status, completedAt: null }));

      expect(html).toContain("<button");
      expect(html).toContain("disabled");
      expect(html).toContain(status === "PENDING" ? "計算待ち" : "計算中");
    },
  );

  it("shows an optimistic pending state and a safe action error", () => {
    const pendingHtml = renderToStaticMarkup(
      createElement(PerformanceOverview, {
        actionQueued: true,
        data: { ...performance(), latestRun: null, latestSuccessfulRun: null },
        error: false,
        loading: false,
      }),
    );
    const errorHtml = renderToStaticMarkup(
      createElement(PerformanceOverview, {
        actionError: "Performance計算を登録できませんでした。",
        data: performance(),
        error: false,
        loading: false,
      }),
    );

    expect(pendingHtml).toContain("PENDING · 計算待ち");
    expect(pendingHtml).toContain("disabled");
    expect(errorHtml).toContain("Performance計算を登録できませんでした。");
    expect(errorHtml).not.toContain("INTERNAL_API_SECRET");
  });

  it("renders every required metric group", () => {
    const html = renderPerformance(performance({}, { twr: twrMetric }));

    expect(html).toContain("収益指標");
    expect(html).toContain("リスク調整指標");
    expect(html).toContain("取引指標");
    expect(html).toContain("レバレッジ・集中度");
    expect(html).toContain("単一取引利益依存度");
  });

  it("does not zero-fill a missing metric", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceMetricCard, {
        label: "勝率",
        metric: undefined,
        metricKey: "winRate",
        placeholder: "—",
      }),
    );

    expect(html).toContain("勝率");
    expect(html).toContain("—");
    expect(html).not.toContain(">0<");
  });

  it("keeps large Decimal strings out of JavaScript number conversion", () => {
    expect(formatMetricValue("profitFactor", "12345678901234567890.123456789")).toBe(
      "12345678901234567890.123456",
    );
    expect(formatMetricValue("averageWin", "999999999999999999.000100000")).toBe(
      "$999999999999999999.0001",
    );
  });

  it("formats percentage metrics by shifting the Decimal string", () => {
    expect(formatMetricValue("twr", "0.123456789012345678")).toBe("12.3456%");
    expect(formatMetricValue("volatility", "0.000000001")).toBe("<0.0001%");
  });

  it("formats leverage metrics without converting them to number", () => {
    expect(formatMetricValue("medianLeverage", "2.500000000000000000")).toBe("2.5×");
    expect(formatMetricValue("maxLeverage", "1000000000000000000.5")).toBe(
      "1000000000000000000.5×",
    );
  });

  it("renders precision text and an estimated-value caution", () => {
    const html = renderPerformance(performance({ precision: "ESTIMATED" }));

    expect(html).toContain("ESTIMATED · 推定値");
    expect(html).toContain("精度に注意が必要です");
    expect(html).toContain("正式な評価には利用できない可能性があります");
  });

  it("renders history completeness text and a non-complete caution", () => {
    const html = renderPerformance(performance({ historyCompleteness: "PARTIAL" }));

    expect(html).toContain("PARTIAL · 一部不足");
    expect(html).toContain("履歴が完全ではありません");
  });

  it("renders Warning Codes in the overview and Calculation Details", () => {
    const html = renderPerformance(
      performance({
        warningCount: 2,
        warningCodes: ["NAV_GAP", "PARTIAL_HISTORY"],
      }),
    );

    expect(html).toContain("Warning件数");
    expect(html).toContain("NAV_GAP, PARTIAL_HISTORY");
  });

  it("renders a safe Error Code and Error Message", () => {
    const html = renderPerformance(
      performance({
        status: "FAILED",
        errorCode: "INPUT_DATA_INVALID",
        errorMessage: "Stored input was invalid.",
      }),
    );

    expect(html).toContain("INPUT_DATA_INVALID");
    expect(html).toContain("Stored input was invalid.");
  });

  it("does not render an Internal API Secret or stack detail", () => {
    const html = renderPerformance(
      performance({
        status: "FAILED",
        errorCode: "unsafe/error",
        errorMessage: "internal-secret-value\n at C:\\private\\performance-service.ts:1:1",
      }),
    );

    expect(html).not.toContain("internal-secret-value");
    expect(html).not.toContain("performance-service.ts");
    expect(html).toContain("詳細はサーバーログを確認してください");
  });

  it("renders a safe API failure state without displaying an error payload", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceOverview, { data: null, error: true, loading: false }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("パフォーマンス情報を取得できませんでした");
    expect(html).not.toContain("Internal API");
  });

  it("keeps the existing address detail sections and adds the Performance entry point", () => {
    const source = readFileSync(new URL("../address-detail-client.tsx", import.meta.url), "utf8");

    expect(source).toContain("現在ポジション");
    expect(source).toContain("約定履歴");
    expect(source).toContain("Data Quality Issue");
    expect(source).toContain("<PerformanceSection");
    expect(source).toContain('href="#performance"');
  });

  it("formats ISO dates in JST and safely handles invalid dates", () => {
    expect(formatPerformanceDate("2026-07-27T00:00:00.000Z")).toContain("9:00:00");
    expect(formatPerformanceDate("not-a-date")).toBe("—");
    expect(formatPerformanceDate(null)).toBe("—");
  });
});

function renderPerformance(data: AddressPerformanceDto): string {
  return renderToStaticMarkup(
    createElement(PerformanceOverview, { data, error: false, loading: false }),
  );
}

function performance(
  runOverrides: Partial<CalculationRunDto> = {},
  metrics: Readonly<Record<string, PerformanceMetricDto>> = {},
): AddressPerformanceDto {
  const run: CalculationRunDto = { ...baseRun, ...runOverrides };
  return {
    walletAddress: "0x1111111111111111111111111111111111111111",
    latestRun: run,
    latestSuccessfulRun: run.status === "SUCCEEDED" ? run : null,
    latestFailedRun: run.status === "FAILED" ? run : null,
    metrics,
    navSummary: {
      count: 0,
      firstDate: null,
      lastDate: null,
      firstNav: null,
      lastNav: null,
      minNav: null,
      maxNav: null,
    },
    cycleSummary: {
      total: 0,
      open: 0,
      closed: 0,
      profitable: 0,
      losing: 0,
    },
  };
}
