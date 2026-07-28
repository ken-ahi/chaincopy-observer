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
  type PerformanceMetricDto,
} from "../../lib/performance-api";
import { isPerformanceActionDisabled } from "./performance-polling";

const metricGroups = [
  {
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
    title: "リスク調整指標",
    metrics: [
      ["sharpeRatio", "Sharpe Ratio"],
      ["sortinoRatio", "Sortino Ratio"],
      ["calmarRatio", "Calmar Ratio"],
    ],
  },
  {
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
              key={group.title}
              metrics={data.metrics}
              title={group.title}
              values={group.metrics}
            />
          ))
        : null}

      <CalculationDetails run={run} />
    </div>
  );
}

function MetricGroup({
  metrics,
  title,
  values,
}: {
  readonly metrics: Readonly<Record<string, PerformanceMetricDto>>;
  readonly title: string;
  readonly values: ReadonlyArray<readonly [string, string]>;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-slate-300">{title}</h3>
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
    cautions.push("履歴が完全ではありません。");
  }
  return cautions.length > 0 ? (
    <Notice>{`${cautions.join(" ")}正式な評価には利用できない可能性があります。`}</Notice>
  ) : null;
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
