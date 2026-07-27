"use client";

import * as React from "react";
import { useEffect, useReducer, useRef } from "react";

import { NavChart } from "./nav-chart";
import { NavSummary, type NavSummaryDto } from "./nav-summary";
import { NavTable } from "./nav-table";
import {
  getAddressPerformanceNav,
  type DailyNavDto,
  type PaginatedDailyNavDto,
} from "../../lib/performance-api";

export interface NavPaginationState {
  readonly items: ReadonlyArray<DailyNavDto>;
  readonly nextCursor: string | null;
  readonly initialLoading: boolean;
  readonly loadingMore: boolean;
  readonly initialError: boolean;
  readonly moreError: boolean;
}

export type NavPaginationAction =
  | { readonly type: "RESET"; readonly enabled: boolean }
  | { readonly type: "INITIAL_SUCCESS"; readonly page: PaginatedDailyNavDto }
  | { readonly type: "INITIAL_FAILURE" }
  | { readonly type: "MORE_START" }
  | { readonly type: "MORE_SUCCESS"; readonly page: PaginatedDailyNavDto }
  | { readonly type: "MORE_FAILURE" };

const initialState: NavPaginationState = {
  items: [],
  nextCursor: null,
  initialLoading: true,
  loadingMore: false,
  initialError: false,
  moreError: false,
};

export function mergeNavItems(
  current: ReadonlyArray<DailyNavDto>,
  incoming: ReadonlyArray<DailyNavDto>,
): ReadonlyArray<DailyNavDto> {
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

export function navPaginationReducer(
  state: NavPaginationState,
  action: NavPaginationAction,
): NavPaginationState {
  switch (action.type) {
    case "RESET":
      return { ...initialState, initialLoading: action.enabled };
    case "INITIAL_SUCCESS":
      return {
        ...initialState,
        items: mergeNavItems([], action.page.items),
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
        items: mergeNavItems(state.items, action.page.items),
        nextCursor: action.page.nextCursor,
        loadingMore: false,
        moreError: false,
      };
    case "MORE_FAILURE":
      return { ...state, loadingMore: false, moreError: true };
  }
}

export function NavSection({
  address,
  enabled,
  overviewLoading,
  overviewSummary,
  runId,
}: {
  readonly address: string;
  readonly enabled: boolean;
  readonly overviewLoading: boolean;
  readonly overviewSummary: NavSummaryDto | null;
  readonly runId: string | null;
}): React.JSX.Element {
  const [state, dispatch] = useReducer(navPaginationReducer, initialState);
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

    void getAddressPerformanceNav(address, { limit: 100, runId })
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
    void getAddressPerformanceNav(address, { cursor, limit: 100, runId })
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
    <NavSectionView
      loading={overviewLoading || state.initialLoading}
      onLoadMore={loadMore}
      overviewSummary={overviewSummary}
      state={state}
    />
  );
}

export function NavSectionView({
  loading,
  onLoadMore,
  overviewSummary,
  state,
}: {
  readonly loading: boolean;
  readonly onLoadMore: () => void;
  readonly overviewSummary: NavSummaryDto | null;
  readonly state: NavPaginationState;
}): React.JSX.Element {
  return (
    <section aria-labelledby="daily-nav-title" className="mt-8">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-white" id="daily-nav-title">
          日次NAV
        </h2>
        <p className="mt-1 text-xs text-slate-500">保存済みの日次評価額を日付順に表示します。</p>
      </div>

      {loading ? <StateMessage role="status">NAVを読み込んでいます</StateMessage> : null}
      {!loading && state.initialError ? (
        <StateMessage role="alert">
          日次NAVを取得できませんでした。時間をおいて再読み込みしてください。
        </StateMessage>
      ) : null}
      {!loading && !state.initialError && state.items.length === 0 ? (
        <StateMessage role="status">表示できる日次NAVデータがありません</StateMessage>
      ) : null}
      {!loading && !state.initialError && state.items.length > 0 ? (
        <div className="grid gap-5">
          <NavSummary items={state.items} overviewSummary={overviewSummary} />
          <NavChart items={state.items} />
          <NavTable items={state.items} />
          {state.moreError ? (
            <p
              className="rounded-lg border border-rose-300/20 bg-rose-300/[0.05] px-3 py-2 text-xs text-rose-100"
              role="alert"
            >
              追加のNAVを取得できませんでした。既に表示したデータは保持されています。
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
                {state.loadingMore ? "追加のNAVを読み込んでいます" : "さらに表示"}
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
