import * as React from "react";

import { buildReliabilitySummary, selectPrimaryMetrics } from "./performance-display";
import { PerformanceMetricCard } from "./performance-metric-card";
import { isPerformanceActionDisabled } from "./performance-polling";
import {
  type AddressPerformanceDto,
  type PerformanceCalculationStatus,
} from "../../lib/performance-api";

export interface PerformanceOverviewProps {
  readonly actionError?: string | null;
  readonly actionQueued?: boolean;
  readonly actionSubmitting?: boolean;
  readonly data: AddressPerformanceDto | null;
  readonly error: boolean;
  readonly lastUpdatedAt?: string | null;
  readonly loading: boolean;
  readonly onAction?: () => void;
}

export function PerformanceOverview({
  actionError = null,
  actionQueued = false,
  actionSubmitting = false,
  data,
  error,
  loading,
  onAction,
}: PerformanceOverviewProps): React.JSX.Element {
  const storedStatus = data?.latestRun?.status ?? null;
  const displayStatus: PerformanceCalculationStatus | null =
    actionQueued || actionSubmitting ? "PENDING" : storedStatus;
  const actionDisabled = isPerformanceActionDisabled(storedStatus, actionSubmitting, actionQueued);
  const actionLabel = data?.latestRun ? "成績を再計算" : "成績を計算";

  return (
    <section aria-labelledby="performance-title" className="scroll-mt-5" id="performance">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-white" id="performance-title">
          このアドレスの売買成績
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">
          このアドレスが、過去の売買でどれくらいうまく利益を出していたかを表示します。
        </p>
      </div>

      {loading ? <StateMessage role="status">売買成績を読み込んでいます。</StateMessage> : null}
      {error ? (
        <StateMessage role="alert">
          売買成績を取得できませんでした。時間をおいて再読み込みしてください。
        </StateMessage>
      ) : null}
      {!loading && !error && data ? <PerformanceResult data={data} status={displayStatus} /> : null}

      {!loading && !error && data ? (
        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            className="min-h-11 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onClick={onAction}
            type="button"
          >
            {actionSubmitting ||
            actionQueued ||
            storedStatus === "PENDING" ||
            storedStatus === "RUNNING"
              ? "計算中"
              : actionLabel}
          </button>
          {actionError ? (
            <p className="text-sm text-rose-200" role="alert">
              {actionError}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PerformanceResult({
  data,
  status,
}: {
  readonly data: AddressPerformanceDto;
  readonly status: PerformanceCalculationStatus | null;
}): React.JSX.Element {
  const primaryMetrics = selectPrimaryMetrics(data);
  const showingPreviousResult =
    (status === "FAILED" || status === "INSUFFICIENT_DATA") && data.latestSuccessfulRun !== null;
  const updating = status === "PENDING" || status === "RUNNING";
  const partiallyAvailable =
    !updating &&
    !showingPreviousResult &&
    status === "SUCCEEDED" &&
    primaryMetrics.some((metric) => metric.unavailable);

  return (
    <div className="grid gap-5">
      {updating ? (
        <p
          className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] p-4 text-sm text-cyan-50"
          role="status"
        >
          成績を計算中
        </p>
      ) : null}
      {showingPreviousResult ? (
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4" role="alert">
          <p className="text-sm font-medium text-amber-50">最新の計算に失敗しました</p>
          <p className="mt-1 text-sm text-amber-100/90">前回の成績を表示しています</p>
        </div>
      ) : null}
      {status === null ? (
        <p className="rounded-xl border border-white/[0.1] bg-slate-950/30 p-4 text-sm text-slate-300">
          まだ成績を計算していません
        </p>
      ) : null}
      {!showingPreviousResult && !updating && status === "INSUFFICIENT_DATA" ? (
        <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4 text-sm text-amber-50">
          成績を計算できませんでした
        </p>
      ) : null}
      {!showingPreviousResult && !updating && status === "FAILED" ? (
        <p
          className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4 text-sm text-amber-50"
          role="alert"
        >
          成績を計算できませんでした
        </p>
      ) : null}
      {partiallyAvailable ? (
        <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4 text-sm text-amber-50">
          一部の成績だけ表示しています
        </p>
      ) : null}

      <section aria-labelledby="primary-metrics-title">
        <h3 className="sr-only" id="primary-metrics-title">
          売買成績の主な数字
        </h3>
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          data-primary-metric-grid="true"
        >
          {primaryMetrics.map((metric) => (
            <PerformanceMetricCard key={metric.key} metric={metric} />
          ))}
        </div>
      </section>

      {updating || status === "INSUFFICIENT_DATA" || data.latestSuccessfulRun !== null ? (
        <ReliabilitySection data={data} metrics={primaryMetrics} status={status} />
      ) : null}
    </div>
  );
}

function ReliabilitySection({
  data,
  metrics,
  status,
}: {
  readonly data: AddressPerformanceDto;
  readonly metrics: ReturnType<typeof selectPrimaryMetrics>;
  readonly status: PerformanceCalculationStatus | null;
}): React.JSX.Element {
  const updating = status === "PENDING" || status === "RUNNING";
  const summary = buildReliabilitySummary(data);
  const unavailable = metrics.filter((metric) => metric.unavailable);
  const level = updating
    ? "確認中"
    : reliabilityLevel(summary?.level ?? "低い", unavailable.length);

  return (
    <section
      aria-labelledby="performance-reliability-title"
      className="rounded-2xl border border-white/[0.08] bg-slate-950/30 p-5"
    >
      <h3 className="text-base font-semibold text-white" id="performance-reliability-title">
        成績の確かさ：<span className="text-cyan-100">{level}</span>
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-300">
        {updating ? "必要な履歴を確認しています" : (summary?.text ?? "履歴不足のため参考値です")}
      </p>
    </section>
  );
}

function reliabilityLevel(
  base: "高い" | "一部確認が必要" | "低い",
  unavailableCount: number,
): "高い" | "一部確認が必要" | "低い" {
  if (unavailableCount >= 3) return "低い";
  if (unavailableCount > 0 && base === "高い") return "一部確認が必要";
  return base;
}

function StateMessage({
  children,
  role,
}: {
  readonly children: string;
  readonly role: "alert" | "status";
}) {
  return (
    <div
      className="rounded-2xl border border-dashed border-white/[0.1] bg-slate-950/40 px-4 py-10 text-center text-sm text-slate-400"
      role={role}
    >
      {children}
    </div>
  );
}
