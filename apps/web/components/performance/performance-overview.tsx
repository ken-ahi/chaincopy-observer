import * as React from "react";

import { buildReliabilitySummary, selectPrimaryMetrics } from "./performance-display";
import { formatPerformanceMinute } from "./performance-formatters";
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
  lastUpdatedAt = null,
  loading,
  onAction,
}: PerformanceOverviewProps): React.JSX.Element {
  const storedStatus = data?.latestRun?.status ?? null;
  const displayStatus: PerformanceCalculationStatus | null = actionQueued
    ? "PENDING"
    : storedStatus;
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
      {!loading && !error && data ? (
        <PerformanceResult data={data} lastUpdatedAt={lastUpdatedAt} status={displayStatus} />
      ) : null}

      {!loading && !error && data ? (
        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            className="min-h-11 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onClick={onAction}
            type="button"
          >
            {actionSubmitting
              ? "登録中"
              : actionQueued || storedStatus === "PENDING"
                ? "計算待ち"
                : storedStatus === "RUNNING"
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
  lastUpdatedAt,
  status,
}: {
  readonly data: AddressPerformanceDto;
  readonly lastUpdatedAt: string | null;
  readonly status: PerformanceCalculationStatus | null;
}): React.JSX.Element {
  const primaryMetrics = selectPrimaryMetrics(data);
  const showingPreviousResult =
    (status === "FAILED" || status === "INSUFFICIENT_DATA") && data.latestSuccessfulRun !== null;
  const updating = status === "PENDING" || status === "RUNNING";

  return (
    <div className="grid gap-5">
      {updating ? (
        <p
          className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] p-4 text-sm text-cyan-50"
          role="status"
        >
          成績を更新しています。
        </p>
      ) : null}
      {showingPreviousResult ? (
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4" role="alert">
          <p className="text-sm font-medium text-amber-50">最新の更新に失敗しました。</p>
          <p className="mt-1 text-sm text-amber-100/90">
            前回正常に計算できた成績を表示しています。
          </p>
        </div>
      ) : null}
      {status === null ? (
        <p className="rounded-xl border border-white/[0.1] bg-slate-950/30 p-4 text-sm text-slate-300">
          まだ成績を計算していません。計算できない項目は「-」で表示します。
        </p>
      ) : null}
      {!showingPreviousResult && !updating && status === "INSUFFICIENT_DATA" ? (
        <p className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4 text-sm text-amber-50">
          成績の計算に必要な履歴が足りません。計算できる項目だけを表示します。
        </p>
      ) : null}
      {!showingPreviousResult && !updating && status === "FAILED" ? (
        <p
          className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4 text-sm text-amber-50"
          role="alert"
        >
          売買成績を更新できませんでした。時間をおいてもう一度お試しください。
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

      <ReliabilitySection data={data} lastUpdatedAt={lastUpdatedAt} metrics={primaryMetrics} />
    </div>
  );
}

function ReliabilitySection({
  data,
  lastUpdatedAt,
  metrics,
}: {
  readonly data: AddressPerformanceDto;
  readonly lastUpdatedAt: string | null;
  readonly metrics: ReturnType<typeof selectPrimaryMetrics>;
}): React.JSX.Element {
  const summary = buildReliabilitySummary(data);
  const unavailable = metrics.filter((metric) => metric.unavailable);
  const level = reliabilityLevel(summary?.level ?? "低い", unavailable.length);
  const reasons = [...new Set(unavailable.flatMap((metric) => metric.unavailableReason ?? []))];
  const successfulRun = data.latestSuccessfulRun;
  const countAvailable = !metrics.find((metric) => metric.key === "trustedClosedCycleCount")
    ?.unavailable;

  return (
    <section
      aria-labelledby="performance-reliability-title"
      className="rounded-2xl border border-white/[0.08] bg-slate-950/30 p-5"
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-base font-semibold text-white" id="performance-reliability-title">
          この成績の確かさ
        </h3>
        <p className="text-lg font-semibold text-cyan-100">{level}</p>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">
        {summary?.text ?? "成績を確認するための履歴がまだ十分にありません。"}
      </p>
      {unavailable.length > 0 ? (
        <div className="mt-3 text-sm leading-relaxed text-amber-50">
          <p>計算できない項目: {unavailable.map((metric) => metric.label).join("、")}</p>
          {reasons.map((reason) => (
            <p className="mt-1" key={reason}>
              {reason}
            </p>
          ))}
        </div>
      ) : null}
      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
        <ReliabilityItem label="確認できた期間">
          {successfulRun
            ? `${formatPerformanceMinute(successfulRun.calculationFrom)} 〜 ${formatPerformanceMinute(successfulRun.calculationTo)}`
            : "-"}
        </ReliabilityItem>
        <ReliabilityItem label="成績を調べた取引数">
          {countAvailable ? `${String(data.calculationDetails.trustedClosedCycleCount)}件` : "-"}
        </ReliabilityItem>
        <ReliabilityItem label="最終データ更新">
          {formatPerformanceMinute(lastUpdatedAt ?? successfulRun?.completedAt ?? null)}
        </ReliabilityItem>
      </dl>
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

function ReliabilityItem({
  children,
  label,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
}) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 leading-relaxed text-slate-200">{children}</dd>
    </div>
  );
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
