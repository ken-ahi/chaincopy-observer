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

import { NavSectionView, type NavPaginationState } from "./nav-section.js";
import {
  defaultPositionCycleFilters,
  type PositionCycleFiltersValue,
} from "./position-cycle-filters.js";
import {
  filterPositionCycles,
  mergePositionCycles,
  PositionCycleSectionView,
  positionCycleReducer,
  type PositionCycleState,
} from "./position-cycle-section.js";
import { PositionCycleTable } from "./position-cycle-table.js";
import { PerformanceOverview } from "./performance-overview.js";
import {
  type PaginatedPositionCyclesDto,
  type PositionCycleDto,
} from "../../lib/performance-api.js";

const cycle = (id: string, overrides: Partial<PositionCycleDto> = {}): PositionCycleDto => ({
  id,
  runId: "run-1",
  coin: "BTC",
  side: "LONG",
  openedAt: "2026-01-01T00:00:00.000Z",
  closedAt: "2026-01-02T00:00:00.000Z",
  averageEntryPrice: "12345678901234567890.123456789012",
  averageExitPrice: "124000.5",
  entryQuantity: "0.000000000001",
  exitQuantity: "0.000000000001",
  grossRealizedPnl: "10.5",
  fees: "-0.5",
  funding: "0.25",
  netRealizedPnl: "10.25",
  fillCount: 3,
  status: "CLOSED",
  inputFingerprint: "fingerprint",
  ...overrides,
});

const state = (overrides: Partial<PositionCycleState> = {}): PositionCycleState => ({
  items: [],
  nextCursor: null,
  initialLoading: false,
  loadingMore: false,
  initialError: false,
  moreError: false,
  filters: defaultPositionCycleFilters,
  ...overrides,
});

const filters = (
  overrides: Partial<PositionCycleFiltersValue> = {},
): PositionCycleFiltersValue => ({
  ...defaultPositionCycleFilters,
  ...overrides,
});

const page = (
  items: ReadonlyArray<PositionCycleDto>,
  nextCursor: string | null,
): PaginatedPositionCyclesDto => ({ items, nextCursor });

function renderView(current: PositionCycleState, loading = false): string {
  return renderToStaticMarkup(
    React.createElement(PositionCycleSectionView, {
      loading,
      onFiltersChange: vi.fn(),
      onLoadMore: vi.fn(),
      state: current,
    }),
  );
}

describe("取引サイクル表示", () => {
  it("取引サイクルセクションを表示する", () => {
    expect(renderView(state())).toContain("取引サイクル");
  });

  it("初回読み込み状態を表示する", () => {
    expect(renderView(state({ initialLoading: true }), true)).toContain(
      "取引サイクルを読み込んでいます",
    );
  });

  it("データ0件の空状態を表示する", () => {
    expect(renderView(state())).toContain("表示できる取引サイクルがありません");
  });

  it("Cycle一覧と全列見出しを表示する", () => {
    const html = renderView(state({ items: [cycle("one")] }));
    for (const label of [
      "銘柄",
      "方向",
      "開始日時",
      "終了日時",
      "平均エントリー価格",
      "平均決済価格",
      "エントリー数量",
      "決済数量",
      "実現損益（手数料前）",
      "手数料",
      "Funding",
      "実現損益（手数料後）",
      "約定数",
      "状態",
    ]) {
      expect(html).toContain(label);
    }
  });

  it("Open Cycleを文字で表示する", () => {
    const html = renderView(
      state({
        items: [
          cycle("open", {
            averageExitPrice: null,
            closedAt: null,
            side: "SHORT",
            status: "OPEN",
          }),
        ],
      }),
    );
    expect(html).toContain("ショート");
    expect(html).toContain("保有中");
  });

  it("Closed Cycleを文字で表示する", () => {
    const html = renderView(state({ items: [cycle("closed")] }));
    expect(html).toContain("ロング");
    expect(html).toContain("完了");
  });

  it("null値を0補完せずダッシュ表示する", () => {
    const html = renderToStaticMarkup(
      React.createElement(PositionCycleTable, {
        items: [
          cycle("open", {
            averageExitPrice: null,
            closedAt: null,
            exitQuantity: null as unknown as string,
          }),
        ],
      }),
    );
    expect((html.match(/—/gu) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("Decimal文字列をnumberへ変換せず維持する", () => {
    const html = renderToStaticMarkup(
      React.createElement(PositionCycleTable, { items: [cycle("one")] }),
    );
    expect(html).toContain("12345678901234567890.123456789012");
    expect(html).toContain("0.000000000001");
    expect(html).toContain("+10.25 · Profit");
  });

  it("日時をJST表示し不正な日時は安全に処理する", () => {
    const html = renderToStaticMarkup(
      React.createElement(PositionCycleTable, {
        items: [cycle("one", { closedAt: "invalid-date" })],
      }),
    );
    expect(html).toContain("9:00:00");
    expect(html).toContain("—");
  });

  it("不正なDecimalを表示してもクラッシュしない", () => {
    const html = renderToStaticMarkup(
      React.createElement(PositionCycleTable, {
        items: [cycle("invalid", { netRealizedPnl: "not-a-decimal" })],
      }),
    );
    expect(html).toContain("—");
    expect(html).not.toContain("NaN");
  });

  it("Coinで取得済みCycleだけを絞り込む", () => {
    const items = [cycle("btc"), cycle("eth", { coin: "ETH" })];
    expect(filterPositionCycles(items, filters({ coin: "ETH" })).map((item) => item.id)).toEqual([
      "eth",
    ]);
  });

  it("LongとShortで絞り込む", () => {
    const items = [cycle("long"), cycle("short", { side: "SHORT" })];
    expect(filterPositionCycles(items, filters({ side: "LONG" }))).toHaveLength(1);
    expect(filterPositionCycles(items, filters({ side: "SHORT" }))[0]?.id).toBe("short");
  });

  it("OpenとClosedで絞り込む", () => {
    const items = [cycle("closed"), cycle("open", { status: "OPEN" })];
    expect(filterPositionCycles(items, filters({ status: "OPEN" }))[0]?.id).toBe("open");
    expect(filterPositionCycles(items, filters({ status: "CLOSED" }))[0]?.id).toBe("closed");
  });

  it("Profitフィルターは正のNet Realized PnLだけを返す", () => {
    const items = [
      cycle("profit", { netRealizedPnl: "0.0000000000001" }),
      cycle("loss", { netRealizedPnl: "-1" }),
    ];
    expect(filterPositionCycles(items, filters({ pnl: "PROFIT" }))[0]?.id).toBe("profit");
  });

  it("Lossフィルターは負のNet Realized PnLだけを返す", () => {
    const items = [
      cycle("profit", { netRealizedPnl: "1" }),
      cycle("loss", { netRealizedPnl: "-0.0000000000001" }),
    ];
    expect(filterPositionCycles(items, filters({ pnl: "LOSS" }))[0]?.id).toBe("loss");
  });

  it("Break-evenフィルターはDecimalの0だけを返す", () => {
    const items = [
      cycle("zero", { netRealizedPnl: "0.000000000000" }),
      cycle("profit", { netRealizedPnl: "0.000000000001" }),
    ];
    expect(filterPositionCycles(items, filters({ pnl: "BREAK_EVEN" }))[0]?.id).toBe("zero");
  });

  it("Net Realized PnL未取得Cycleは損益分類せずAllだけに表示する", () => {
    const item = cycle("open", {
      netRealizedPnl: undefined as unknown as string,
      status: "OPEN",
    });
    expect(filterPositionCycles([item], filters())).toEqual([item]);
    expect(filterPositionCycles([item], filters({ pnl: "PROFIT" }))).toEqual([]);
  });

  it("フィルター結果0件の状態を表示する", () => {
    const html = renderView(
      state({
        filters: filters({ coin: "ETH" }),
        items: [cycle("btc")],
      }),
    );
    expect(html).toContain("条件に一致する取引サイクルがありません");
  });

  it("次ページを既存行へ追加しcursorを更新する", () => {
    const started = positionCycleReducer(state({ items: [cycle("one")], nextCursor: "cursor-1" }), {
      type: "MORE_START",
    });
    const completed = positionCycleReducer(started, {
      type: "MORE_SUCCESS",
      page: page([cycle("two")], "cursor-2"),
    });
    expect(completed.items.map((item) => item.id)).toEqual(["one", "two"]);
    expect(completed.nextCursor).toBe("cursor-2");
  });

  it("nextCursorなしではさらに表示ボタンを表示しない", () => {
    expect(renderView(state({ items: [cycle("one")] }))).not.toContain("さらに表示");
  });

  it("追加読み込み中の二重取得開始を防止する", () => {
    const current = state({
      items: [cycle("one")],
      loadingMore: true,
      nextCursor: "cursor-1",
    });
    expect(positionCycleReducer(current, { type: "MORE_START" })).toBe(current);
  });

  it("ページ間で同じIDを重複表示しない", () => {
    const merged = mergePositionCycles(
      [cycle("one")],
      [cycle("one", { coin: "ETH" }), cycle("two")],
    );
    expect(merged.map((item) => item.id)).toEqual(["one", "two"]);
  });

  it("追加取得失敗時に既存行とcursorを維持する", () => {
    const current = state({
      items: [cycle("one")],
      loadingMore: true,
      nextCursor: "cursor-1",
    });
    const failed = positionCycleReducer(current, { type: "MORE_FAILURE" });
    expect(failed.items).toBe(current.items);
    expect(failed.nextCursor).toBe("cursor-1");
    expect(failed.moreError).toBe(true);
  });

  it("初回取得失敗を安全な文言で表示する", () => {
    const html = renderView(state({ initialError: true }));
    expect(html).toContain("取引サイクルを取得できませんでした");
    expect(html).not.toContain("Stack");
  });

  it("Internal Secret・内部URL・DB接続情報を表示しない", () => {
    const html = renderView(state({ initialError: true, moreError: true }));
    expect(html).not.toMatch(
      /INTERNAL_API_SECRET|postgresql:\/\/|redis:\/\/|localhost|database_url/iu,
    );
  });

  it("既存Performance概要とNAV表示を維持する", () => {
    const overview = renderToStaticMarkup(
      React.createElement(PerformanceOverview, {
        data: null,
        error: false,
        loading: true,
      }),
    );
    const navState: NavPaginationState = {
      items: [],
      nextCursor: null,
      initialLoading: false,
      loadingMore: false,
      initialError: false,
      moreError: false,
    };
    const nav = renderToStaticMarkup(
      React.createElement(NavSectionView, {
        loading: false,
        onLoadMore: vi.fn(),
        overviewSummary: null,
        state: navState,
      }),
    );
    expect(overview).toContain("運用実績");
    expect(nav).toContain("日次評価額");
  });

  it("アドレス変更時のRESETでデータ・cursor・フィルターを初期化する", () => {
    const reset = positionCycleReducer(
      state({
        filters: filters({ coin: "BTC", pnl: "PROFIT" }),
        items: [cycle("old")],
        nextCursor: "old-cursor",
      }),
      { type: "RESET", enabled: true },
    );
    expect(reset.items).toEqual([]);
    expect(reset.nextCursor).toBeNull();
    expect(reset.filters).toEqual(defaultPositionCycleFilters);
  });
});
