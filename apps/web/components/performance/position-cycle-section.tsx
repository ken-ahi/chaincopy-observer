"use client";

import * as React from "react";
import { useEffect, useReducer, useRef } from "react";

import {
  defaultPositionCycleFilters,
  PositionCycleFilters,
  type PositionCycleFiltersValue,
} from "./position-cycle-filters";
import { PositionCycleTable } from "./position-cycle-table";
import { comparePerformanceDecimals } from "./performance-formatters";
import {
  getAddressPerformanceCycles,
  type PaginatedPositionCyclesDto,
  type PositionCycleDto,
} from "../../lib/performance-api";

export interface PositionCycleState {
  readonly items: ReadonlyArray<PositionCycleDto>;
  readonly nextCursor: string | null;
  readonly initialLoading: boolean;
  readonly loadingMore: boolean;
  readonly initialError: boolean;
  readonly moreError: boolean;
  readonly filters: PositionCycleFiltersValue;
}

export type PositionCycleAction =
  | { readonly type: "RESET"; readonly enabled: boolean }
  | { readonly type: "INITIAL_SUCCESS"; readonly page: PaginatedPositionCyclesDto }
  | { readonly type: "INITIAL_FAILURE" }
  | { readonly type: "MORE_START" }
  | { readonly type: "MORE_SUCCESS"; readonly page: PaginatedPositionCyclesDto }
  | { readonly type: "MORE_FAILURE" }
  | { readonly type: "FILTERS_CHANGE"; readonly filters: PositionCycleFiltersValue };

const initialState: PositionCycleState = {
  items: [],
  nextCursor: null,
  initialLoading: true,
  loadingMore: false,
  initialError: false,
  moreError: false,
  filters: defaultPositionCycleFilters,
};

export function mergePositionCycles(
  current: ReadonlyArray<PositionCycleDto>,
  incoming: ReadonlyArray<PositionCycleDto>,
): ReadonlyArray<PositionCycleDto> {
  const seen = new Set(current.map((item) => item.id));
  return [
    ...current,
    ...incoming.filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }
      seen.add(item.id);
      return true;
    }),
  ];
}

export function positionCycleReducer(
  state: PositionCycleState,
  action: PositionCycleAction,
): PositionCycleState {
  switch (action.type) {
    case "RESET":
      return { ...initialState, initialLoading: action.enabled };
    case "INITIAL_SUCCESS":
      return {
        ...initialState,
        items: mergePositionCycles([], action.page.items),
        nextCursor: action.page.nextCursor,
        initialLoading: false,
      };
    case "INITIAL_FAILURE":
      return { ...initialState, initialLoading: false, initialError: true };
    case "MORE_START":
      return state.loadingMore || state.nextCursor === null
        ? state
        : { ...state, loadingMore: true, moreError: false };
    case "MORE_SUCCESS":
      return {
        ...state,
        items: mergePositionCycles(state.items, action.page.items),
        nextCursor: action.page.nextCursor,
        loadingMore: false,
        moreError: false,
      };
    case "MORE_FAILURE":
      return { ...state, loadingMore: false, moreError: true };
    case "FILTERS_CHANGE":
      return { ...state, filters: action.filters };
  }
}

export function filterPositionCycles(
  items: ReadonlyArray<PositionCycleDto>,
  filters: PositionCycleFiltersValue,
): ReadonlyArray<PositionCycleDto> {
  return items.filter((item) => {
    if (filters.coin !== "ALL" && item.coin !== filters.coin) {
      return false;
    }
    if (filters.side !== "ALL" && item.side !== filters.side) {
      return false;
    }
    if (filters.status !== "ALL" && item.status !== filters.status) {
      return false;
    }
    if (filters.pnl === "ALL") {
      return true;
    }

    const pnl = typeof item.netRealizedPnl === "string" ? item.netRealizedPnl : null;
    if (pnl === null) {
      return false;
    }
    const comparison = comparePerformanceDecimals(pnl, "0");
    if (comparison === null) {
      return false;
    }
    if (filters.pnl === "PROFIT") {
      return comparison > 0;
    }
    if (filters.pnl === "LOSS") {
      return comparison < 0;
    }
    return comparison === 0;
  });
}

export function PositionCycleSection({
  address,
  enabled,
  overviewLoading,
  runId,
}: {
  readonly address: string;
  readonly enabled: boolean;
  readonly overviewLoading: boolean;
  readonly runId: string | null;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(positionCycleReducer, initialState);
  const requestVersion = useRef(0);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const version = requestVersion.current + 1;
    requestVersion.current = version;
    loadingMoreRef.current = false;
    dispatch({ type: "RESET", enabled });
    if (!enabled || runId === null) {
      return;
    }

    void getAddressPerformanceCycles(address, { limit: 50, runId })
      .then((page) => {
        if (requestVersion.current === version) {
          dispatch({ type: "INITIAL_SUCCESS", page });
        }
      })
      .catch(() => {
        if (requestVersion.current === version) {
          dispatch({ type: "INITIAL_FAILURE" });
        }
      });

    return () => {
      if (requestVersion.current === version) {
        requestVersion.current += 1;
      }
    };
  }, [address, enabled, runId]);

  const loadMore = (): void => {
    const cursor = state.nextCursor;
    if (!enabled || runId === null || cursor === null || loadingMoreRef.current) {
      return;
    }
    const version = requestVersion.current;
    loadingMoreRef.current = true;
    dispatch({ type: "MORE_START" });
    void getAddressPerformanceCycles(address, { cursor, limit: 50, runId })
      .then((page) => {
        if (requestVersion.current === version) {
          dispatch({ type: "MORE_SUCCESS", page });
        }
      })
      .catch(() => {
        if (requestVersion.current === version) {
          dispatch({ type: "MORE_FAILURE" });
        }
      })
      .finally(() => {
        if (requestVersion.current === version) {
          loadingMoreRef.current = false;
        }
      });
  };

  return (
    <PositionCycleSectionView
      loading={overviewLoading || state.initialLoading}
      onFiltersChange={(filters) => dispatch({ type: "FILTERS_CHANGE", filters })}
      onLoadMore={loadMore}
      state={state}
    />
  );
}

export function PositionCycleSectionView({
  loading,
  onFiltersChange,
  onLoadMore,
  state,
}: {
  readonly loading: boolean;
  readonly onFiltersChange: (filters: PositionCycleFiltersValue) => void;
  readonly onLoadMore: () => void;
  readonly state: PositionCycleState;
}): React.JSX.Element {
  const filteredItems = filterPositionCycles(state.items, state.filters);

  return (
    <section aria-labelledby="position-cycles-title" className="mt-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white" id="position-cycles-title">
          Position Cycles
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          保存済みのPosition Cycleを開始日時の新しい順に表示します。
        </p>
      </div>

      {loading ? <StateMessage role="status">Position Cycleを読み込んでいます</StateMessage> : null}
      {!loading && state.initialError ? (
        <StateMessage role="alert">
          Position Cycleを取得できませんでした。時間をおいて再読み込みしてください。
        </StateMessage>
      ) : null}
      {!loading && !state.initialError && state.items.length === 0 ? (
        <StateMessage role="status">表示できるPosition Cycleがありません</StateMessage>
      ) : null}
      {!loading && !state.initialError && state.items.length > 0 ? (
        <div className="grid gap-5">
          <PositionCycleFilters
            items={state.items}
            onChange={onFiltersChange}
            value={state.filters}
          />
          {filteredItems.length > 0 ? (
            <PositionCycleTable items={filteredItems} />
          ) : (
            <StateMessage role="status">条件に一致するPosition Cycleがありません</StateMessage>
          )}
          {state.moreError ? (
            <p
              className="rounded-lg border border-rose-300/20 bg-rose-300/[0.05] px-3 py-2 text-xs text-rose-100"
              role="alert"
            >
              追加のPosition Cycleを取得できませんでした。既に表示したデータは保持されています。
            </p>
          ) : null}
          {state.nextCursor !== null ? (
            <div className="flex justify-center">
              <button
                className="rounded-lg border border-cyan-300/30 px-4 py-2 text-sm text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={state.loadingMore}
                onClick={onLoadMore}
                type="button"
              >
                {state.loadingMore ? "追加のPosition Cycleを読み込んでいます" : "さらに表示"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function StateMessage({
  children,
  role,
}: {
  readonly children: string;
  readonly role: "alert" | "status";
}): React.JSX.Element {
  return (
    <div
      className="rounded-2xl border border-dashed border-white/[0.1] bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-400"
      role={role}
    >
      {children}
    </div>
  );
}
