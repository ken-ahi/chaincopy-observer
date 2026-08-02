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
    CardTitle: component("h3"),
  };
});

import { CalculationDetails } from "./calculation-details.js";
import {
  buildReliabilitySummary,
  canDisplayTrustedClosedCycleCount,
  selectPrimaryMetrics,
} from "./performance-display.js";
import { PerformanceDetailedMetrics } from "./performance-detailed-metrics.js";
import {
  formatMetricValue,
  formatPerformanceDate,
  formatPerformanceMinute,
} from "./performance-formatters.js";
import { PerformanceOverview } from "./performance-overview.js";
import { PerformanceDetailsPanels } from "./performance-section.js";
import { PerformanceWarningSummary } from "./performance-warning-summary.js";
import { buildPerformanceWarnings, normalizeWarningCodes } from "./performance-warnings.js";
import {
  type AddressPerformanceDto,
  type CalculationRunDto,
  type PerformanceMetricDto,
} from "../../lib/performance-api.js";

const baseRun: CalculationRunDto = {
  runId: "run-20260727",
  status: "SUCCEEDED",
  calculationVersion: "performance-v3",
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

describe("Performance overview", () => {
  it("初期表示を初心者向け見出し、主要6指標、確かさ、再計算へ簡素化する", () => {
    const html = renderPerformance(performance({ metrics: primaryMetrics() }));

    expect(html).toContain("このアドレスの売買成績");
    expect(html.match(/data-metric-key=/gu) ?? []).toHaveLength(6);
    expect(html).toContain("この成績の確かさ");
    expect(html).toContain("成績を再計算");
    expect(html).not.toContain("最新の計算試行");
    expect(html).not.toContain("計算完了");
    expect(html).not.toContain("Saved analytics");
    expect(html).not.toContain("performance-v3");
    expect(html).not.toContain("SUCCEEDED");
  });

  it("主要6指標を固定順で表示し、欠損値は計算不能として残す", () => {
    const metrics = {
      cumulativeReturn: metric("cumulativeReturn", "0.0062"),
      winRate: metric("winRate", "0.333333333333"),
      annualizedReturn: metric("annualizedReturn", "0.25"),
    };
    const data = performance({ metrics });
    const selected = selectPrimaryMetrics(data);

    expect(selected.map((item) => item.key)).toEqual([
      "cumulativeReturn",
      "maxDrawdown",
      "profitFactor",
      "winRate",
      "trustedClosedCycleCount",
      "topTradeContribution",
    ]);
    const html = renderPerformance(data);
    expect(html).toContain("0.62%");
    expect(html).toContain("33.3333%");
    expect(html).toContain('data-metric-key="maxDrawdown"');
    expect(html).not.toContain('data-metric-key="annualizedReturn"');
    expect(selected.filter((item) => item.unavailable)).toHaveLength(3);
    expect(html).toContain("一番大きく資産が減った割合は計算できません");
  });

  it("全主要Metric欠損時も6カードと読み上げ可能なハイフンを表示する", () => {
    const data = performance({
      calculationDetails: calculationDetails({ trustedClosedCycleCount: 0 }),
      metrics: {},
    });
    const html = renderPerformance(data);

    expect(html.match(/data-metric-key=/gu) ?? []).toHaveLength(6);
    expect(html.match(/は計算できません/gu)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(html).toContain("0件");
    expect(html).not.toContain("N/A");
    expect(html).not.toContain("UNAVAILABLE");
  });

  it("主要カードからPrecision、Warning、Metric Key、Versionを除く", () => {
    const html = renderPerformance(
      performance({
        metrics: {
          cumulativeReturn: metric("cumulativeReturn", "0.1", {
            metricVersion: "performance-v3",
            precision: "ESTIMATED",
            warningCodes: ["DATA_GAP"],
          }),
        },
      }),
    );
    const card = /data-metric-key="cumulativeReturn"[\s\S]*?<\/section>/u.exec(html)?.[0];

    expect(card).toBeDefined();
    expect(card).not.toContain("ESTIMATED");
    expect(card).not.toContain("DATA_GAP");
    expect(card).not.toContain("performance-v3");
  });

  it("参考値は日本語補足を表示する", () => {
    const html = renderPerformance(
      performance({
        metrics: {
          cumulativeReturn: metric("cumulativeReturn", "0.1", { status: "REFERENCE_ONLY" }),
        },
      }),
    );
    expect(html).toContain("参考値");
  });

  it("主要グリッドをmobile 1列、tablet 2列、desktop 3列に固定する", () => {
    const html = renderPerformance(performance({ metrics: primaryMetrics() }));
    const grid = /class="([^"]+)" data-primary-metric-grid="true"/u.exec(html)?.[1];

    expect(grid).toContain("grid-cols-1");
    expect(grid).toContain("sm:grid-cols-2");
    expect(grid).toContain("lg:grid-cols-3");
    expect(grid).not.toMatch(/grid-cols-[456]/u);
  });

  it("主要6候補の説明と一意なbutton関連付けを初期DOMへ持つ", () => {
    const html = renderPerformance(performance({ metrics: primaryMetrics() }));

    for (const label of [
      "資産がどれくらい増えたか",
      "一番大きく資産が減った割合",
      "利益と損失のバランス",
      "利益になった取引の割合",
      "成績を調べた取引数",
      "一度の大勝ちへの依存",
    ]) {
      expect(html).toContain(`aria-label="${label}の説明"`);
    }
    expect(html).toContain('aria-expanded="false"');
    const controls = [...html.matchAll(/aria-controls="([^"]+-description)"/gu)].map(
      (match) => match[1],
    );
    expect(new Set(controls).size).toBe(6);
    for (const id of controls) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain("最も調子が悪かった時に、資産が何％減ったかを表します。");
  });

  it("評価対象取引数は4条件成立時だけ表示する", () => {
    const valid = performance({ metrics: { winRate: metric("winRate", "0.5") } });
    expect(canDisplayTrustedClosedCycleCount(valid)).toBe(true);
    expect(selectPrimaryMetrics(valid).some((item) => item.key === "trustedClosedCycleCount")).toBe(
      true,
    );
  });

  it("latestSuccessfulRunがなければ評価対象取引数を表示しない", () => {
    const data = performance({
      latestSuccessfulRun: null,
      metrics: { winRate: metric("winRate", "0.5") },
    });
    expect(canDisplayTrustedClosedCycleCount(data)).toBe(false);
  });

  it("Trade Lane unavailableなら評価対象取引数を表示しない", () => {
    const data = performance({
      availability: availability({
        trade: { from: null, reasons: [], status: "UNAVAILABLE", to: null },
      }),
      metrics: { winRate: metric("winRate", "0.5") },
    });
    expect(canDisplayTrustedClosedCycleCount(data)).toBe(false);
  });

  it("trustedClosedCycleCountが0なら0件として表示する", () => {
    const data = performance({
      calculationDetails: calculationDetails({ trustedClosedCycleCount: 0 }),
      metrics: { winRate: metric("winRate", "0.5") },
    });
    expect(canDisplayTrustedClosedCycleCount(data)).toBe(true);
    expect(
      selectPrimaryMetrics(data).find((item) => item.key === "trustedClosedCycleCount")?.value,
    ).toBe("0件");
  });

  it("Trade系Metricがなければ評価対象取引数を表示しない", () => {
    const missing = performance({ metrics: {} });
    const referenceOnly = performance({
      metrics: { winRate: metric("winRate", "0.5", { status: "REFERENCE_ONLY" }) },
    });
    expect(canDisplayTrustedClosedCycleCount(missing)).toBe(false);
    expect(canDisplayTrustedClosedCycleCount(referenceOnly)).toBe(true);
  });

  it.each(["PENDING", "RUNNING", "FAILED", "INSUFFICIENT_DATA"] as const)(
    "%sでも過去成功Runの主要指標と日時を表示する",
    (status) => {
      const latestRun = run({ completedAt: null, runId: `latest-${status}`, status });
      const successfulRun = run({ completedAt: "2026-07-29T01:38:00.000Z", runId: "past-success" });
      const html = renderPerformance(
        performance({ latestRun, latestSuccessfulRun: successfulRun, metrics: primaryMetrics() }),
      );

      if (status === "PENDING" || status === "RUNNING") {
        expect(html).toContain("成績を更新しています。");
      } else {
        expect(html).toContain("最新の更新に失敗しました。");
        expect(html).toContain("前回正常に計算できた成績を表示しています。");
      }
      expect(html).toContain(formatPerformanceMinute(successfulRun.completedAt));
      expect(html).toContain('data-metric-key="cumulativeReturn"');
      expect(html).not.toContain(latestRun.runId);
    },
  );

  it.each(["PENDING", "RUNNING"] as const)("%sは再計算buttonを無効化する", (status) => {
    const html = renderPerformance(
      performance({ latestRun: run({ completedAt: null, status }), latestSuccessfulRun: baseRun }),
    );
    expect(html).toContain("disabled");
  });

  it.each(["FAILED", "INSUFFICIENT_DATA"] as const)(
    "%sは前回結果表示中でも再計算できる",
    (status) => {
      const html = renderPerformance(
        performance({ latestRun: run({ status }), latestSuccessfulRun: baseRun }),
      );
      const button = /<button[^>]*>成績を再計算<\/button>/u.exec(html)?.[0];
      expect(button).toBeDefined();
      expect(button).not.toContain(' disabled=""');
    },
  );

  it.each(["PENDING", "RUNNING", "FAILED", "INSUFFICIENT_DATA"] as const)(
    "%s単独では過去結果を捏造しない",
    (status) => {
      const html = renderPerformance(
        performance({
          latestRun: run({ completedAt: null, status }),
          latestSuccessfulRun: null,
          metrics: primaryMetrics(),
        }),
      );
      expect(html).not.toContain("前回正常に計算できた成績");
      expect(html.match(/data-metric-key=/gu) ?? []).toHaveLength(6);
      expect(html).not.toContain("0.62%");
    },
  );

  it("COMPLETE、PARTIAL、GAP_DETECTEDを履歴状態として信頼性文へ反映する", () => {
    const complete = buildReliabilitySummary(performance())?.text;
    const partial = buildReliabilitySummary(
      performance({ latestSuccessfulRun: run({ historyCompleteness: "PARTIAL" }) }),
    );
    const gap = buildReliabilitySummary(
      performance({ latestSuccessfulRun: run({ historyCompleteness: "GAP_DETECTED" }) }),
    );

    expect(complete).toContain("対象期間の履歴");
    expect(partial?.text).toContain("一部の履歴を評価対象から除外");
    expect(partial?.consumedMeaningKeys).toContain("INCOMPLETE_TRADE_HISTORY");
    expect(gap?.text).toContain("履歴の欠損を跨がず");
    expect(gap?.consumedMeaningKeys).toContain("NAV_HISTORY_GAP");
  });

  it("Warning Codeを固定順の意味キーへ正規化する", () => {
    const warnings = normalizeWarningCodes(
      ["POSITION_DISCONTINUITY", "DATA_GAP", "RETURN_PERIOD_TRUNCATED_AT_GAP"],
      "latest",
    );
    expect(warnings.map((warning) => warning.meaningKey)).toEqual([
      "NAV_HISTORY_GAP",
      "INCOMPLETE_TRADE_HISTORY",
    ]);
  });

  it("正常結果のRun、Metric、Availability、Calculation DetailsをWarning入力にする", () => {
    const successfulRun = run({ warningCodes: ["UNKNOWN_CASH_FLOW"] });
    const data = performance({
      availability: availability({
        return: {
          from: null,
          reasons: ["MISSING_CASH_FLOW_BOUNDARY_NAV"],
          status: "PARTIAL",
          to: null,
        },
      }),
      calculationDetails: calculationDetails({ excludedFundingCount: 1, navGapCount: 1 }),
      latestSuccessfulRun: successfulRun,
      metrics: {
        winRate: metric("winRate", "0.5", { warningCodes: ["POSITION_DISCONTINUITY"] }),
      },
    });
    const model = buildPerformanceWarnings(data);
    const laneKeys = Object.values(model.laneWarnings).flatMap((warnings) =>
      warnings.map((warning) => warning.meaningKey),
    );

    expect(laneKeys).toEqual(
      expect.arrayContaining([
        "UNKNOWN_TRANSFER",
        "MISSING_BOUNDARY_NAV",
        "UNALLOCATED_FUNDING",
        "NAV_HISTORY_GAP",
        "INCOMPLETE_TRADE_HISTORY",
      ]),
    );
  });

  it("同一意味キーはRun間でlatestRunを優先し通常表示を1件にする", () => {
    const latestRun = run({
      runId: "latest-failed",
      status: "FAILED",
      warningCodes: ["POSITION_DISCONTINUITY"],
    });
    const successfulRun = run({
      runId: "past-success",
      warningCodes: ["PARTIAL_HISTORY"],
    });
    const model = buildPerformanceWarnings(
      performance({ latestRun, latestSuccessfulRun: successfulRun }),
    );

    expect(model.visible).toHaveLength(1);
    expect(model.visible[0]).toMatchObject({
      meaningKey: "INCOMPLETE_TRADE_HISTORY",
      source: "latest",
    });
  });

  it("通常Warningは両Run合計で最大3件、残件数は重複排除後に決める", () => {
    const latestRun = run({
      runId: "latest-warning-run",
      status: "FAILED",
      warningCodes: ["UNKNOWN_CASH_FLOW", "DATA_GAP", "TRADE_HISTORY_PREFIX_SKIPPED"],
    });
    const successfulRun = run({ runId: "past-warning-run", warningCodes: ["NEW_WARNING"] });
    const model = buildPerformanceWarnings(
      performance({
        availability: availability({
          exposure: {
            from: baseRun.calculationFrom,
            reasons: ["INVALID_INPUT"],
            status: "PARTIAL",
            to: baseRun.calculationTo,
          },
          return: {
            from: baseRun.calculationFrom,
            reasons: ["INVALID_INPUT"],
            status: "PARTIAL",
            to: baseRun.calculationTo,
          },
        }),
        latestRun,
        latestSuccessfulRun: successfulRun,
      }),
    );
    const html = renderToStaticMarkup(createElement(PerformanceWarningSummary, { model }));

    expect(model.visible).toHaveLength(3);
    expect(model.hidden).toHaveLength(2);
    expect(html).toContain("ほか2件の注意事項");
    expect(html).toContain('aria-expanded="false"');
    expect(model.visible.every((warning) => warning.source === "latest")).toBe(true);
    expect(html).toContain("表示中の正常結果");
    const controls = /aria-controls="([^"]+)"/u.exec(html)?.[1];
    expect(controls).toBeDefined();
    expect(html).toContain(`id="${controls}"`);
  });

  it("計算不能理由を主要カードに具体的な日本語で表示する", () => {
    const data = performance({
      availability: availability({
        return: {
          from: null,
          reasons: ["MISSING_CASH_FLOW_BOUNDARY_NAV"],
          status: "UNAVAILABLE",
          to: null,
        },
      }),
      metrics: { winRate: metric("winRate", "0.5") },
    });
    const overviewHtml = renderPerformance(data);
    expect(overviewHtml).toContain("入出金前後の資産データが足りないため計算できません。");
    expect(overviewHtml).not.toContain("MISSING_CASH_FLOW_BOUNDARY_NAV");
  });

  it("Return Laneだけ利用不能でも主要6指標を固定表示する", () => {
    const data = performance({
      availability: availability({
        return: {
          from: null,
          reasons: ["UNKNOWN_CASH_FLOW"],
          status: "UNAVAILABLE",
          to: null,
        },
      }),
      metrics: primaryMetrics(),
    });
    const selected = selectPrimaryMetrics(data);

    expect(selected).toHaveLength(6);
    expect(selected.filter((item) => item.unavailable).map((item) => item.key)).toEqual([
      "cumulativeReturn",
      "maxDrawdown",
    ]);
  });

  it("Trade Laneだけ利用不能でも主要6指標を固定表示する", () => {
    const data = performance({
      availability: availability({
        trade: {
          from: null,
          reasons: ["INSUFFICIENT_HISTORY"],
          status: "UNAVAILABLE",
          to: null,
        },
      }),
      metrics: primaryMetrics(),
    });
    const selected = selectPrimaryMetrics(data);

    expect(selected).toHaveLength(6);
    expect(selected.filter((item) => item.unavailable).map((item) => item.key)).toEqual([
      "profitFactor",
      "winRate",
      "trustedClosedCycleCount",
      "topTradeContribution",
    ]);
  });

  it("Exposure Laneだけ利用不能なら詳細成績を表示しない", () => {
    const data = performance({
      availability: availability({
        exposure: {
          from: null,
          reasons: ["INSUFFICIENT_HISTORY"],
          status: "UNAVAILABLE",
          to: null,
        },
      }),
      metrics: { maxLeverage: metric("maxLeverage", "4") },
    });
    const overview = renderPerformance(data);
    const details = renderToStaticMarkup(createElement(PerformanceDetailedMetrics, { data }));

    expect(overview).toContain("この成績の確かさ");
    expect(details).not.toContain('data-metric-key="maxLeverage"');
    expect(details).not.toContain("INSUFFICIENT_HISTORY");
  });

  it("複数Laneの内部理由を通常画面へ露出しない", () => {
    const sharedReason = "INVALID_INPUT";
    const data = performance({
      availability: availability({
        exposure: { from: null, reasons: [sharedReason], status: "PARTIAL", to: null },
        return: { from: null, reasons: [sharedReason], status: "PARTIAL", to: null },
      }),
    });
    const html = renderPerformance(data);

    expect(html).not.toContain(sharedReason);
    expect(html).toContain("計算できない項目");
  });

  it("詳細指標はP2 Metricの存在値だけを表示し欠損カードを作らない", () => {
    const data = performance({
      metrics: {
        annualizedReturn: metric("annualizedReturn", "0.25"),
        sharpeRatio: metric("sharpeRatio", "1.5"),
      },
    });
    const html = renderToStaticMarkup(createElement(PerformanceDetailedMetrics, { data }));

    expect(html).toContain('data-metric-key="annualizedReturn"');
    expect(html).toContain('data-metric-key="sharpeRatio"');
    expect(html).not.toContain('data-metric-key="volatility"');
    expect(html).not.toContain(">—<");
  });

  it("詳しい成績とデータ状態を独立した初期閉buttonとして描画する", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceDetailsPanels, {
        calculationDetailsOpen: false,
        data: performance(),
        detailsOpen: false,
        error: false,
        loading: false,
        onCalculationDetailsToggle: vi.fn(),
        onDetailsToggle: vi.fn(),
      }),
    );

    expect(html).toContain("成績をくわしく見る");
    expect(html).toContain("データの状態を見る");
    expect(html.match(/aria-expanded="false"/gu) ?? []).toHaveLength(2);
    expect(html).not.toContain("データ利用状況");
    expect(html).not.toContain("Daily NAV件数");
  });

  it("データの状態を開いても内部ID・Code・生データ表を表示しない", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceDetailsPanels, {
        calculationDetailsOpen: true,
        data: performance({
          metrics: {
            sharpeRatio: metric("sharpeRatio", "1.5"),
          },
        }),
        detailsOpen: false,
        error: false,
        loading: false,
        onCalculationDetailsToggle: vi.fn(),
        onDetailsToggle: vi.fn(),
      }),
    );

    expect(html).toContain("データの状態を見る");
    expect(html).toContain("確認できた期間");
    expect(html).toContain("履歴がそろっているか");
    expect(html).not.toContain("Run ID");
    expect(html).not.toContain("Input Fingerprint");
    expect(html).not.toContain("Warning Codes");
    expect(html).not.toContain("日次NAV");
    expect(html).not.toContain("Position Cycle");
    expect(html).not.toContain('data-metric-key="sharpeRatio"');
  });

  it("詳細指標を開くとP2 Metricだけへ追加開閉なしで到達する", () => {
    const html = renderToStaticMarkup(
      createElement(PerformanceDetailsPanels, {
        calculationDetailsOpen: false,
        data: performance({
          metrics: {
            sharpeRatio: metric("sharpeRatio", "1.5"),
          },
        }),
        detailsOpen: true,
        error: false,
        loading: false,
        onCalculationDetailsToggle: vi.fn(),
        onDetailsToggle: vi.fn(),
      }),
    );

    expect(html).toContain('data-metric-key="sharpeRatio"');
    expect(html).not.toContain("日次評価額");
    expect(html).not.toContain("取引サイクル");
  });

  it("計算の詳細は最新試行と表示中正常結果の生CodeをRun別に保持する", () => {
    const data = performance({
      latestRun: run({
        errorCode: "CALCULATION_FAILED",
        runId: "latest-failed",
        status: "FAILED",
        warningCodes: ["POSITION_DISCONTINUITY"],
      }),
      latestSuccessfulRun: run({
        runId: "past-success",
        warningCodes: ["PARTIAL_HISTORY"],
      }),
      metrics: {
        winRate: metric("winRate", "0.5", { warningCodes: ["TRADE_HISTORY_PREFIX_SKIPPED"] }),
      },
    });
    const html = renderToStaticMarkup(createElement(CalculationDetails, { data }));

    expect(html).toContain("最新の計算試行");
    expect(html).toContain("表示中の正常結果");
    expect(html).toContain("latest-failed");
    expect(html).toContain("past-success");
    expect(html).toContain("POSITION_DISCONTINUITY");
    expect(html).toContain("PARTIAL_HISTORY");
    expect(html).toContain("TRADE_HISTORY_PREFIX_SKIPPED");
    expect(html).toContain("performance-v3");
  });

  it("同一Runの共通診断値を二重表示しない", () => {
    const data = performance();
    const html = renderToStaticMarkup(createElement(CalculationDetails, { data }));

    expect(html.match(new RegExp(`>${baseRun.runId}<`, "gu")) ?? []).toHaveLength(1);
    expect(html).toContain("最新の計算試行（表示中の正常結果）");
    expect(html).toContain("共通するRun情報は上に1回だけ");
  });

  it("正本期間と異なるLane・Metric期間だけを計算の詳細へ追加表示する", () => {
    const returnFrom = "2026-07-03T00:00:00.000Z";
    const metricFrom = "2026-07-05T00:00:00.000Z";
    const data = performance({
      availability: availability({
        return: {
          from: returnFrom,
          reasons: [],
          status: "PARTIAL",
          to: baseRun.calculationTo,
        },
      }),
      metrics: {
        sharpeRatio: metric("sharpeRatio", "1.5", { calculationFrom: metricFrom }),
        winRate: metric("winRate", "0.5"),
      },
    });
    const html = renderToStaticMarkup(createElement(CalculationDetails, { data }));

    expect(html).toContain("Return対象期間");
    expect(html).toContain(formatPerformanceDate(returnFrom));
    expect(html).toContain(formatPerformanceDate(metricFrom));
    expect(html).toContain("Metric metadata");
    expect(html).toContain("sharpeRatio");
  });

  it("Max DrawdownはAPIの保存値をそのままDecimal文字列formatterへ渡す", () => {
    const html = renderPerformance(
      performance({ metrics: { maxDrawdown: metric("maxDrawdown", "-0.3412") } }),
    );
    expect(html).toContain("-34.12%");
  });

  it("Decimal文字列をJavaScript numberへ変換せず既存formatterで表示する", () => {
    expect(formatMetricValue("profitFactor", "12345678901234567890.123456789")).toBe(
      "12345678901234567890.123456",
    );
    expect(formatMetricValue("winRate", "0.333333333333333333")).toBe("33.3333%");
  });

  it("読み込み、未計算、取得失敗を安全な日本語とroleで表示する", () => {
    const loading = renderToStaticMarkup(
      createElement(PerformanceOverview, { data: null, error: false, loading: true }),
    );
    const empty = renderPerformance(performance({ latestRun: null, latestSuccessfulRun: null }));
    const error = renderToStaticMarkup(
      createElement(PerformanceOverview, { data: null, error: true, loading: false }),
    );

    expect(loading).toContain('role="status"');
    expect(loading).toContain("売買成績を読み込んでいます");
    expect(empty).toContain("まだ成績を計算していません");
    expect(error).toContain('role="alert"');
    expect(error).not.toContain("Internal API");
  });

  it("unsafe Errorは通常画面へ出さず計算の詳細でも安全化する", () => {
    const data = performance({
      latestRun: run({
        errorCode: "unsafe/error",
        errorMessage: "internal-secret-value\n at C:\\private\\performance-service.ts:1:1",
        status: "FAILED",
      }),
      latestSuccessfulRun: null,
    });
    const overview = renderPerformance(data);
    const details = renderToStaticMarkup(createElement(CalculationDetails, { data }));

    expect(overview).not.toContain("internal-secret-value");
    expect(details).not.toContain("internal-secret-value");
    expect(details).toContain("詳細はサーバーログを確認してください");
  });

  it("アドレス詳細を投資判断に必要な表示と少数API取得へ絞る", () => {
    const source = readFileSync(new URL("../address-detail-client.tsx", import.meta.url), "utf8");
    expect(source).toContain("現在の先物ポジション");
    expect(source).toContain("最近の動き");
    expect(source).toContain("現在出している注文");
    expect(source).toContain("<PerformanceSection");
    expect(source).toContain('href="#performance"');
    expect(source).not.toContain("limit=100");
    expect(source).not.toContain("/funding?");
    expect(source).not.toContain("/ledger?");
    expect(source).not.toContain("/data-quality?");
    expect(source).not.toContain("/sync-status");
    expect(source).not.toContain("Sync Cursor");
    expect(source).not.toContain("Sync Job");
  });

  it("日時はJSTの既存formatterを使い、前回結果は分単位で表示する", () => {
    expect(formatPerformanceDate("2026-07-27T00:00:00.000Z")).toContain("9:00:00");
    expect(formatPerformanceMinute("2026-07-27T00:00:00.000Z")).toBe("2026/07/27 09:00");
    expect(formatPerformanceDate("not-a-date")).toBe("—");
  });
});

function renderPerformance(data: AddressPerformanceDto): string {
  return renderToStaticMarkup(
    createElement(PerformanceOverview, { data, error: false, loading: false }),
  );
}

function run(overrides: Partial<CalculationRunDto> = {}): CalculationRunDto {
  return { ...baseRun, ...overrides };
}

function metric(
  metricKey: string,
  metricValue: string,
  overrides: Partial<PerformanceMetricDto> = {},
): PerformanceMetricDto {
  return {
    metricKey,
    metricValue,
    precision: "EXACT",
    status: "AVAILABLE",
    warningCodes: [],
    calculationFrom: baseRun.calculationFrom,
    calculationTo: baseRun.calculationTo,
    metricVersion: "performance-v3",
    ...overrides,
  };
}

function primaryMetrics(): Readonly<Record<string, PerformanceMetricDto>> {
  return {
    cumulativeReturn: metric("cumulativeReturn", "0.0062"),
    maxDrawdown: metric("maxDrawdown", "-0.3412"),
    profitFactor: metric("profitFactor", "2.19"),
    topTradeContribution: metric("topTradeContribution", "1"),
    winRate: metric("winRate", "0.333333333333"),
  };
}

function availability(
  overrides: Partial<AddressPerformanceDto["availability"]> = {},
): AddressPerformanceDto["availability"] {
  return {
    exposure: {
      from: baseRun.calculationFrom,
      reasons: [],
      status: "AVAILABLE",
      to: baseRun.calculationTo,
    },
    return: {
      from: baseRun.calculationFrom,
      reasons: [],
      status: "AVAILABLE",
      to: baseRun.calculationTo,
    },
    trade: {
      from: baseRun.calculationFrom,
      reasons: [],
      status: "AVAILABLE",
      to: baseRun.calculationTo,
    },
    ...overrides,
  };
}

function calculationDetails(
  overrides: Partial<AddressPerformanceDto["calculationDetails"]> = {},
): AddressPerformanceDto["calculationDetails"] {
  return {
    excludedFillCount: 0,
    excludedFundingCount: 0,
    navGapCount: 0,
    tradePrefixes: [],
    trustedClosedCycleCount: 3,
    unknownCashFlowCount: 0,
    ...overrides,
  };
}

function performance(overrides: Partial<AddressPerformanceDto> = {}): AddressPerformanceDto {
  return {
    availability: availability(),
    calculationDetails: calculationDetails(),
    walletAddress: "0x1111111111111111111111111111111111111111",
    latestRun: baseRun,
    latestSuccessfulRun: baseRun,
    latestFailedRun: null,
    metrics: { winRate: metric("winRate", "0.5") },
    navSummary: {
      count: 2,
      firstDate: baseRun.calculationFrom,
      lastDate: baseRun.calculationTo,
      firstNav: "1000",
      lastNav: "1100",
      minNav: "900",
      maxNav: "1200",
    },
    cycleSummary: {
      total: 3,
      open: 0,
      closed: 3,
      profitable: 2,
      losing: 1,
    },
    ...overrides,
  };
}
