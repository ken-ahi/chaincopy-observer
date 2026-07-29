import { Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import * as React from "react";

import { CalculationDetails } from "./calculation-details";
import { formatPerformanceDate, formatSafeErrorCode } from "./performance-formatters";
import { PerformanceMetricCard } from "./performance-metric-card";
import {
  HistoryCompletenessBadge,
  PerformanceStatusBadge,
  PrecisionBadge,
} from "./performance-status-badge";
import {
  type AddressPerformanceDto,
  type CalculationRunDto,
  type MetricGroupAvailabilityDto,
  type PerformanceMetricDto,
} from "../../lib/performance-api";
import { isPerformanceActionDisabled } from "./performance-polling";

const metricGroups = [
  {
    lane: "return",
    title: "収益指標",
    metrics: [
      ["cumulativeReturn", "累積収益率"],
      ["annualizedReturn", "年率換算収益率"],
      ["twr", "TWR"],
      ["maxDrawdown", "最大ドローダウン"],
      ["volatility", "ボラティリティ"],
    ],
  },
  {
    lane: "return",
    title: "リスク調整指標",
    metrics: [
      ["sharpeRatio", "Sharpe Ratio"],
      ["sortinoRatio", "Sortino Ratio"],
      ["calmarRatio", "Calmar Ratio"],
    ],
  },
  {
    lane: "trade",
    title: "取引指標",
    metrics: [
      ["profitFactor", "Profit Factor"],
      ["winRate", "勝率"],
      ["averageWin", "平均利益"],
      ["averageLoss", "平均損失"],
      ["maxLosingStreak", "最大連敗"],
      ["topTradeContribution", "単一取引利益依存度"],
    ],
  },
  {
    lane: "exposure",
    title: "レバレッジ・集中度",
    metrics: [
      ["medianLeverage", "中央レバレッジ"],
      ["percentile95Leverage", "95パーセンタイルレバレッジ"],
      ["maxLeverage", "最大レバレッジ"],
      ["averageLeverage", "平均レバレッジ"],
      ["largestCoinShare", "最大銘柄比率"],
      ["concentrationIndex", "集中度"],
    ],
  },
] as const;

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
  const runStatus = data?.latestRun?.status ?? null;
  const actionDisabled = isPerformanceActionDisabled(runStatus, actionSubmitting, actionQueued);
  const actionLabel = data?.latestRun ? "Performanceを再計算" : "Performanceを計算";
  return (
    <section aria-labelledby="performance-title" className="scroll-mt-5" id="performance">
      <div className="mb-4">
        <p className="text-xs uppercase tracking-[0.18em] text-cyan-300/70">Saved analytics</p>
        <h2 className="mt-1 text-xl font-semibold text-white" id="performance-title">
          Performance
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          保存済みの計算結果を表示します。画面上で金融指標の再計算は行いません。
        </p>
      </div>

      {loading ? <StateMessage role="status">パフォーマンス情報を読み込み中</StateMessage> : null}
      {error ? (
        <StateMessage role="alert">
          パフォーマンス情報を取得できませんでした。時間をおいて再読み込みしてください。
        </StateMessage>
      ) : null}
      {!loading && !error && data && !data.latestRun ? (
        <StateMessage role="status">
          パフォーマンス計算はまだ実行されていません。履歴同期完了後に自動計算されます。すぐに実行する場合は「Performanceを計算」を押してください。
        </StateMessage>
      ) : null}
      {!loading && !error && data?.latestRun ? (
        <PerformanceResult data={data} run={data.latestRun} />
      ) : null}
      {!loading && !error && data ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-medium text-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={actionDisabled}
            onClick={onAction}
            type="button"
          >
            {actionSubmitting
              ? "登録中"
              : actionQueued || runStatus === "PENDING"
                ? "計算待ち"
                : runStatus === "RUNNING"
                  ? "計算中"
                  : actionLabel}
          </button>
          {actionQueued ? (
            <p className="text-xs text-amber-200" role="status">
              PENDING · 計算待ち
            </p>
          ) : null}
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
  run,
}: {
  readonly data: AddressPerformanceDto;
  readonly run: CalculationRunDto;
}) {
  const showMetrics = run.status === "SUCCEEDED";
  return (
    <div className="grid gap-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>計算情報</CardTitle>
            <PerformanceStatusBadge status={run.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 text-xs sm:grid-cols-2 xl:grid-cols-6">
            <Summary label="計算期間">
              {formatPeriod(run.calculationFrom, run.calculationTo)}
            </Summary>
            <Summary label="Calculation Version">{run.calculationVersion}</Summary>
            <Summary label="Precision">
              <PrecisionBadge precision={run.precision} />
            </Summary>
            <Summary label="History Completeness">
              <HistoryCompletenessBadge completeness={run.historyCompleteness} />
            </Summary>
            <Summary label="Warning件数">{String(run.warningCount)}</Summary>
            <Summary label="最終更新日時">{formatLastUpdate(run)}</Summary>
          </div>
          <RunNotice run={run} />
        </CardContent>
      </Card>

      {showMetrics
        ? metricGroups.map((group) => (
            <MetricGroup
              availability={data.availability[group.lane]}
              key={group.title}
              metrics={data.metrics}
              title={group.title}
              values={group.metrics}
            />
          ))
        : null}

      <CalculationDetails data={data} run={run} />
    </div>
  );
}

function MetricGroup({
  availability,
  metrics,
  title,
  values,
}: {
  readonly availability: MetricGroupAvailabilityDto;
  readonly metrics: Readonly<Record<string, PerformanceMetricDto>>;
  readonly title: string;
  readonly values: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold text-slate-300">{title}</h3>
        <span className={availabilityClassName(availability.status)}>
          {availabilityLabel(availability.status)}
        </span>
      </div>
      {availability.reasons.length > 0 ? (
        <p className="mb-2 text-xs leading-relaxed text-amber-200">
          {availability.reasons.map(availabilityReasonLabel).join(" / ")}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {values.map(([metricKey, label]) => (
          <PerformanceMetricCard
            key={metricKey}
            label={label}
            metric={metrics[metricKey]}
            metricKey={metricKey}
            placeholder="—"
          />
        ))}
      </div>
    </div>
  );
}

function RunNotice({ run }: { readonly run: CalculationRunDto }) {
  if (run.status === "PENDING") {
    return <Notice>計算待ちです。保存済みMetricは結果として表示しません。</Notice>;
  }
  if (run.status === "RUNNING") {
    return <Notice>計算中です。完了するまでMetricは結果として表示しません。</Notice>;
  }
  if (run.status === "INSUFFICIENT_DATA") {
    return (
      <Notice>
        Performance計算は実行されましたが、正式評価に必要な履歴が不足しています。
        {run.warningCodes.length > 0 ? ` Warning Codes: ${run.warningCodes.join(", ")}` : ""}
      </Notice>
    );
  }
  if (run.status === "FAILED") {
    return (
      <Notice role="alert">
        {`Performance計算に失敗しました。再計算を実行できます。 Error Code: ${formatSafeErrorCode(run.errorCode)}`}
      </Notice>
    );
  }
  const cautions: Array<string> = [];
  if (run.precision === "ESTIMATED" || run.precision === "UNAVAILABLE") {
    cautions.push("精度に注意が必要です。");
  }
  if (run.historyCompleteness !== "COMPLETE") {
    cautions.push("履歴全体ではなく、信頼できる期間・完了取引のみを対象にしています。");
  }
  if (run.warningCodes.includes("TRADE_HISTORY_PREFIX_SKIPPED")) {
    cautions.push(
      "履歴開始時点で保有中だったポジションを除外し、最初にポジションが0へ戻った後の取引から計算しています。",
    );
  }
  if (run.warningCodes.includes("UNKNOWN_CASH_FLOW")) {
    cautions.push(
      "分類できない入出金履歴があるため、収益率・リスク指標は計算できません。取引指標は信頼できる完了取引のみで計算しています。",
    );
  }
  return cautions.length > 0 ? (
    <Notice>{`${cautions.join(" ")}正式な評価には利用できない可能性があります。`}</Notice>
  ) : null;
}

function availabilityLabel(status: MetricGroupAvailabilityDto["status"]): string {
  if (status === "AVAILABLE") return "計算済み";
  if (status === "PARTIAL") return "一部計算済み";
  return "計算不可";
}

function availabilityClassName(status: MetricGroupAvailabilityDto["status"]): string {
  const color =
    status === "AVAILABLE"
      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
      : status === "PARTIAL"
        ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
        : "border-rose-300/20 bg-rose-300/10 text-rose-100";
  return `rounded-full border px-2 py-0.5 text-[10px] ${color}`;
}

function availabilityReasonLabel(reason: string): string {
  const labels: Readonly<Record<string, string>> = {
    CALCULATION_WINDOW_ADJUSTED: "初期NAV不足のため計算開始日を調整",
    DATA_GAP: "NAV日付Gap",
    INSUFFICIENT_HISTORY: "評価期間不足",
    MISSING_CASH_FLOW_BOUNDARY_NAV: "Cash Flow境界NAV不足",
    NON_POSITIVE_NAV: "有効な初期NAV不足",
    POSITION_DISCONTINUITY: "取引履歴の連続性不足",
    RETURN_PERIOD_TRUNCATED_AT_GAP: "NAV日付Gapで評価期間を短縮",
    TRADE_HISTORY_PREFIX_SKIPPED: "開始時保有ポジションを除外",
    UNALLOCATED_FUNDING: "割当不能Fundingを除外",
    UNKNOWN_CASH_FLOW: "分類不能な入出金履歴",
  };
  return labels[reason] ?? reason;
}

function Notice({
  children,
  role,
}: {
  readonly children: React.ReactNode;
  readonly role?: "alert";
}) {
  return (
    <p
      className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-100"
      role={role}
    >
      {children}
    </p>
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

function Summary({
  children,
  label,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.12em] text-slate-600">{label}</p>
      <div className="mt-1.5 break-words text-slate-300">{children}</div>
    </div>
  );
}

function formatPeriod(from: string, to: string): string {
  return `${formatPerformanceDate(from)} – ${formatPerformanceDate(to)}`;
}

function formatLastUpdate(run: CalculationRunDto): string {
  return formatPerformanceDate(run.completedAt ?? run.startedAt ?? run.requestedAt);
}
