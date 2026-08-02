import * as React from "react";

import { buildReliabilitySummary, selectPrimaryMetrics } from "./performance-display";
import { formatPerformanceMinute } from "./performance-formatters";
import { PerformanceMetricCard } from "./performance-metric-card";
import { isPerformanceActionDisabled } from "./performance-polling";
import { PerformanceStatusBadge } from "./performance-status-badge";
import { PerformanceWarningSummary } from "./performance-warning-summary";
import { buildPerformanceWarnings } from "./performance-warnings";
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
  const displayStatus: PerformanceCalculationStatus | null = actionQueued
    ? "PENDING"
    : storedStatus;
  const actionDisabled = isPerformanceActionDisabled(storedStatus, actionSubmitting, actionQueued);
  const actionLabel = data?.latestRun ? "実績を再計算" : "実績を計算";

  return (
    <section aria-labelledby="performance-title" className="scroll-mt-5" id="performance">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-white" id="performance-title">
          運用実績
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          保存済みの計算結果を表示しています。表示値は画面上で再計算しません。
        </p>
      </div>

      {loading ? <StateMessage role="status">運用実績を読み込んでいます</StateMessage> : null}
      {error ? (
        <StateMessage role="alert">
          運用実績を取得できませんでした。時間をおいて再読み込みしてください。
        </StateMessage>
      ) : null}
      {!loading && !error && data && displayStatus === null ? (
        <StateMessage role="status">
          まだ計算されていません。履歴同期の完了後に自動計算されます。すぐに実行する場合は「実績を計算」を押してください。
        </StateMessage>
      ) : null}
      {!loading && !error && data && displayStatus !== null ? (
        <PerformanceResult data={data} status={displayStatus} />
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
            <p className="text-xs text-rose-200" role="alert">
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
  readonly status: PerformanceCalculationStatus;
}): React.JSX.Element {
  const primaryMetrics = selectPrimaryMetrics(data);
  const reliability = buildReliabilitySummary(data);
  const warnings = buildPerformanceWarnings(data, reliability?.consumedMeaningKeys ?? []);
  const showingPreviousResult = status !== "SUCCEEDED" && data.latestSuccessfulRun !== null;

  return (
    <div className="grid gap-5">
      <div className="rounded-xl border border-white/[0.08] bg-slate-950/30 p-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-medium text-slate-300">最新の計算試行</p>
          <PerformanceStatusBadge status={status} />
        </div>
        <StatusDescription hasPreviousResult={showingPreviousResult} status={status} />
      </div>

      {showingPreviousResult ? (
        <div className="rounded-xl border border-cyan-300/20 bg-cyan-300/[0.05] p-4">
          <p className="text-sm font-medium text-cyan-50">前回の正常な計算結果を表示しています</p>
          <p className="mt-1 text-xs text-cyan-100/80">
            計算日時: {formatPerformanceMinute(data.latestSuccessfulRun?.completedAt ?? null)}
          </p>
        </div>
      ) : null}

      {reliability ? (
        <p className="text-sm leading-relaxed text-slate-300">{reliability.text}</p>
      ) : null}

      <PerformanceWarningSummary model={warnings} />

      <section aria-labelledby="primary-metrics-title">
        <h3 className="text-sm font-semibold text-white" id="primary-metrics-title">
          主要指標
        </h3>
        {primaryMetrics.length > 0 ? (
          <div
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            data-primary-metric-grid="true"
          >
            {primaryMetrics.map((metric) => (
              <PerformanceMetricCard key={metric.key} metric={metric} />
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-white/[0.1] bg-slate-950/30 px-4 py-6 text-sm text-slate-400">
            現在表示できる主要指標はありません
          </p>
        )}
      </section>
    </div>
  );
}

function StatusDescription({
  hasPreviousResult,
  status,
}: {
  readonly hasPreviousResult: boolean;
  readonly status: PerformanceCalculationStatus;
}) {
  const content = statusDescription(status, hasPreviousResult);
  const role =
    status === "FAILED"
      ? "alert"
      : status === "PENDING" || status === "RUNNING"
        ? "status"
        : undefined;
  return (
    <p className="mt-3 text-xs leading-relaxed text-slate-400" role={role}>
      {content}
    </p>
  );
}

function statusDescription(
  status: PerformanceCalculationStatus,
  hasPreviousResult: boolean,
): string {
  if (status === "PENDING") {
    return hasPreviousResult
      ? "実績の再計算開始を待っています。"
      : "計算の開始を待っています。完了すると表示が更新されます。";
  }
  if (status === "RUNNING") {
    return hasPreviousResult
      ? "実績を再計算しています。完了すると表示が更新されます。"
      : "運用実績を計算しています。完了すると表示が更新されます。";
  }
  if (status === "FAILED") {
    return hasPreviousResult
      ? "最新の再計算に失敗しました。時間をおいて再計算してください。"
      : "運用実績の計算に失敗しました。時間をおいて再計算してください。";
  }
  if (status === "INSUFFICIENT_DATA") {
    return hasPreviousResult
      ? "最新の再計算では正式な指標に必要な履歴が不足していました。"
      : "正式な運用実績を計算するための履歴が不足しています。";
  }
  return "保存済みの正常な計算結果を表示しています。";
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
