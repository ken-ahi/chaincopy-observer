import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@chaincopy/ui", async () => {
  const react = await import("react");
  const component =
    (tag: string) =>
    ({ children }: { readonly children?: React.ReactNode }) =>
      react.createElement(tag, null, children);
  return {
    Badge: component("span"),
    Card: component("article"),
    CardContent: component("div"),
    CardHeader: component("header"),
    CardTitle: component("h3"),
  };
});

import { NavChart, createNavChartPoints } from "./nav-chart.js";
import {
  NavSectionView,
  mergeNavItems,
  navPaginationReducer,
  type NavPaginationState,
} from "./nav-section.js";
import { summarizeNavRows } from "./nav-summary.js";
import { NavTable } from "./nav-table.js";
import { formatPerformanceAmount, formatPerformanceDay } from "./performance-formatters.js";
import { PerformanceOverview } from "./performance-overview.js";
import {
  type AddressPerformanceDto,
  type DailyNavDto,
  type PaginatedDailyNavDto,
} from "../../lib/performance-api.js";

const nav = (id: string, overrides: Partial<DailyNavDto> = {}): DailyNavDto => ({
  id,
  runId: "run-1",
  date: "2026-01-01T00:00:00.000Z",
  nav: "1000.123456789012",
  cashBalance: "900.5",
  unrealizedPnl: "100.123456789012",
  realizedPnl: "-2.5",
  funding: "0.000000000001",
  fees: "-0.5",
  externalCashFlow: null,
  precision: "EXACT",
  historyCompleteness: "COMPLETE",
  ...overrides,
});

const state = (overrides: Partial<NavPaginationState> = {}): NavPaginationState => ({
  items: [],
  nextCursor: null,
  initialLoading: false,
  loadingMore: false,
  initialError: false,
  moreError: false,
  ...overrides,
});

const page = (
  items: ReadonlyArray<DailyNavDto>,
  nextCursor: string | null,
): PaginatedDailyNavDto => ({ items, nextCursor });

function renderView(
  current: NavPaginationState,
  loading = false,
  overviewSummary: AddressPerformanceDto["navSummary"] | null = null,
): string {
  return renderToStaticMarkup(
    React.createElement(NavSectionView, {
      loading,
      onLoadMore: vi.fn(),
      overviewSummary,
      state: current,
    }),
  );
}

describe("日次NAV表示", () => {
  it("NAVセクションを表示する", () => {
    expect(renderView(state())).toContain("日次NAV");
  });

  it("初回読み込み状態を表示する", () => {
    expect(renderView(state({ initialLoading: true }), true)).toContain("NAVを読み込んでいます");
  });

  it("NAVデータ0件の空状態を表示する", () => {
    expect(renderView(state())).toContain("表示できる日次NAVデータがありません");
  });

  it("NAV一覧と全列見出しを表示する", () => {
    const html = renderView(state({ items: [nav("nav-1")] }));
    for (const label of [
      "日付",
      "NAV",
      "現金残高",
      "含み損益",
      "実現損益",
      "Funding",
      "手数料",
      "外部キャッシュフロー",
      "精度区分",
      "履歴完全性",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("Decimal文字列をnumberへ丸めず表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTable, {
        items: [nav("nav-1", { nav: "12345678901234567890.123456789012" })],
      }),
    );
    expect(html).toContain("12345678901234567890.123456789012");
  });

  it("null値を0表示せずダッシュ表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavTable, {
        items: [
          nav("nav-1", {
            cashBalance: null,
            externalCashFlow: null,
            fees: null,
            funding: null,
            realizedPnl: null,
            unrealizedPnl: null,
          }),
        ],
      }),
    );
    expect((html.match(/—/gu) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("日付をJSTで表示する", () => {
    expect(formatPerformanceDay("2026-01-01T18:00:00.000Z")).toBe("2026/01/02");
  });

  it("Precisionをコードと日本語で表示する", () => {
    const html = renderView(state({ items: [nav("nav-1", { precision: "DERIVED" })] }));
    expect(html).toContain("DERIVED · 算出値");
  });

  it("History Completenessをコードと日本語で表示する", () => {
    const html = renderView(
      state({ items: [nav("nav-1", { historyCompleteness: "GAP_DETECTED" })] }),
    );
    expect(html).toContain("GAP_DETECTED · 履歴欠損");
  });

  it("複数点のNAVチャートを表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(NavChart, {
        items: [nav("one"), nav("two", { nav: "1100" })],
      }),
    );
    expect(html).toContain("<svg");
    expect(html).toContain("日付順の日次NAV推移");
    expect(html).not.toMatch(/NaN|Infinity/u);
  });

  it("1件だけでもチャート座標を生成する", () => {
    const points = createNavChartPoints([nav("one")]);
    expect(points).toHaveLength(1);
    expect(points?.[0]).toMatchObject({ x: 360, y: 120 });
  });

  it("全NAVが同じでも有限なチャートを表示する", () => {
    const points = createNavChartPoints([nav("one", { nav: "10" }), nav("two", { nav: "10" })]);
    expect(points?.every((point) => Number.isFinite(point.y))).toBe(true);
    expect(points?.[0]?.y).toBe(points?.[1]?.y);
  });

  it("負のNAVを含んでも有限なチャートを表示する", () => {
    const points = createNavChartPoints([nav("one", { nav: "-100" }), nav("two", { nav: "50" })]);
    expect(points?.every((point) => Number.isFinite(point.y))).toBe(true);
  });

  it("不正Decimalでもクラッシュせずチャートだけを省略する", () => {
    const item = nav("bad", { nav: "not-a-decimal" });
    const chart = renderToStaticMarkup(React.createElement(NavChart, { items: [item] }));
    const table = renderToStaticMarkup(React.createElement(NavTable, { items: [item] }));
    expect(chart).toContain("NAVチャートを表示できません");
    expect(table).toContain("無効な値");
  });

  it("次ページを取得済み行へ追加しcursorを更新する", () => {
    const started = navPaginationReducer(state({ items: [nav("one")], nextCursor: "cursor-1" }), {
      type: "MORE_START",
    });
    const completed = navPaginationReducer(started, {
      type: "MORE_SUCCESS",
      page: page([nav("two")], "cursor-2"),
    });
    expect(completed.items.map((item) => item.id)).toEqual(["one", "two"]);
    expect(completed.nextCursor).toBe("cursor-2");
  });

  it("nextCursorなしではさらに表示ボタンを表示しない", () => {
    expect(renderView(state({ items: [nav("one")], nextCursor: null }))).not.toContain(
      "さらに表示",
    );
  });

  it("読み込み中の二重取得開始を防止する", () => {
    const current = state({
      items: [nav("one")],
      loadingMore: true,
      nextCursor: "cursor-1",
    });
    expect(navPaginationReducer(current, { type: "MORE_START" })).toBe(current);
  });

  it("ページ間で同じIDを重複表示しない", () => {
    const merged = mergeNavItems([nav("one")], [nav("one", { nav: "999" }), nav("two")]);
    expect(merged.map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("追加取得失敗時に既存行とcursorを維持する", () => {
    const current = state({
      items: [nav("one")],
      loadingMore: true,
      nextCursor: "cursor-1",
    });
    const failed = navPaginationReducer(current, { type: "MORE_FAILURE" });
    expect(failed.items).toBe(current.items);
    expect(failed.nextCursor).toBe("cursor-1");
    expect(failed.moreError).toBe(true);
  });

  it("初回取得失敗を安全な文言で表示する", () => {
    const html = renderView(state({ initialError: true }));
    expect(html).toContain("日次NAVを取得できませんでした");
    expect(html).not.toContain("Stack");
  });

  it("Internal API Secretや内部URLをエラー表示へ含めない", () => {
    const html = renderView(state({ initialError: true, moreError: true }));
    expect(html).not.toMatch(/INTERNAL_API_SECRET|postgresql:\/\/|redis:\/\/|localhost/iu);
  });

  it("既存Performance概要を表示できる", () => {
    const html = renderToStaticMarkup(
      React.createElement(PerformanceOverview, {
        data: null,
        error: false,
        loading: true,
      }),
    );
    expect(html).toContain("Performance");
    expect(html).toContain("パフォーマンス情報を読み込み中");
  });

  it("アドレスまたはRun変更時のRESETで行とcursorを消去する", () => {
    const reset = navPaginationReducer(state({ items: [nav("old")], nextCursor: "old-cursor" }), {
      type: "RESET",
      enabled: true,
    });
    expect(reset.items).toEqual([]);
    expect(reset.nextCursor).toBeNull();
    expect(reset.initialLoading).toBe(true);
  });

  it("桁あふれ時はチャートを省略して表の元Decimalを維持する", () => {
    const huge = "9".repeat(400);
    const item = nav("huge", { nav: huge });
    expect(createNavChartPoints([item])).toBeNull();
    expect(renderToStaticMarkup(React.createElement(NavTable, { items: [item] }))).toContain(huge);
  });

  it("概要の最小・最大はDecimal文字列として比較する", () => {
    const summary = summarizeNavRows([
      nav("one", { nav: "999999999999999999999.9" }),
      nav("two", { nav: "-0.0000000000001" }),
      nav("three", { nav: "1000000000000000000000" }),
    ]);
    expect(summary.minNav).toBe("-0.0000000000001");
    expect(summary.maxNav).toBe("1000000000000000000000");
  });

  it("非常に小さい非0値を0と表示しない", () => {
    expect(formatPerformanceAmount("0.0000000000000001")).not.toBe("0");
    expect(formatPerformanceAmount("-0.0000000000000001")).not.toBe("0");
  });
});
