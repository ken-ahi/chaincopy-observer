import { Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import * as React from "react";

import { metricLane, type PerformanceLane } from "./performance-display";
import {
  formatPerformanceDate,
  formatSafeErrorCode,
  formatSafeErrorMessage,
} from "./performance-formatters";
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

export function CalculationDetails({
  data,
}: {
  readonly data: AddressPerformanceDto;
}): React.JSX.Element {
  const latestRun = data.latestRun;
  const successfulRun = data.latestSuccessfulRun;
  const sameRun =
    latestRun !== null && successfulRun !== null && latestRun.runId === successfulRun.runId;

  return (
    <Card>
      <CardHeader>
        <CardTitle>計算の詳細</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-8">
          {latestRun ? (
            <RunDetails
              run={latestRun}
              title={sameRun ? "最新の計算試行（表示中の正常結果）" : "最新の計算試行"}
            />
          ) : (
            <p className="text-xs text-slate-400">最新の計算試行はありません。</p>
          )}

          {successfulRun ? (
            <SuccessfulResultDetails data={data} includeRunDetails={!sameRun} run={successfulRun} />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function RunDetails({
  run,
  title,
}: {
  readonly run: CalculationRunDto;
  readonly title: string;
}): React.JSX.Element {
  return (
    <section aria-labelledby={`run-detail-${run.runId}`}>
      <h4 className="text-sm font-semibold text-white" id={`run-detail-${run.runId}`}>
        {title}
      </h4>
      <dl className="mt-4 grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 xl:grid-cols-3">
        <Detail label="Run ID">
          <span className="break-all font-mono text-slate-300">{run.runId}</span>
        </Detail>
        <Detail label="Status">
          <PerformanceStatusBadge diagnostic status={run.status} />
        </Detail>
        <Detail label="Calculation Version">{run.calculationVersion}</Detail>
        <Detail label="Input Fingerprint">
          <span className="break-all font-mono text-slate-300">{run.inputFingerprint}</span>
        </Detail>
        <Detail label="Precision">
          <PrecisionBadge precision={run.precision} />
        </Detail>
        <Detail label="History Completeness">
          <HistoryCompletenessBadge completeness={run.historyCompleteness} />
        </Detail>
        <Detail label="Warning件数">{String(run.warningCount)}</Detail>
        <Detail label="Warning Codes">
          <RawCodes codes={run.warningCodes} />
        </Detail>
        <Detail label="Error Code">{formatSafeErrorCode(run.errorCode)}</Detail>
        <Detail label="Error Message">{formatSafeErrorMessage(run.errorMessage)}</Detail>
        <Detail label="計算要求日時">{formatPerformanceDate(run.requestedAt)}</Detail>
        <Detail label="計算開始日時">{formatPerformanceDate(run.startedAt)}</Detail>
        <Detail label="計算完了日時">{formatPerformanceDate(run.completedAt)}</Detail>
        <Detail label="計算対象期間">{formatPeriod(run.calculationFrom, run.calculationTo)}</Detail>
      </dl>
    </section>
  );
}

function SuccessfulResultDetails({
  data,
  includeRunDetails,
  run,
}: {
  readonly data: AddressPerformanceDto;
  readonly includeRunDetails: boolean;
  readonly run: CalculationRunDto;
}): React.JSX.Element {
  return (
    <section aria-labelledby="successful-result-details">
      <h4 className="text-sm font-semibold text-white" id="successful-result-details">
        表示中の正常結果
      </h4>
      {includeRunDetails ? (
        <dl className="mt-4 grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 xl:grid-cols-3">
          <Detail label="Run ID">
            <span className="break-all font-mono text-slate-300">{run.runId}</span>
          </Detail>
          <Detail label="Performance Version">{run.calculationVersion}</Detail>
          <Detail label="Calculation completedAt">{formatPerformanceDate(run.completedAt)}</Detail>
          <Detail label="Input Fingerprint">
            <span className="break-all font-mono text-slate-300">{run.inputFingerprint}</span>
          </Detail>
          <Detail label="Precision">
            <PrecisionBadge precision={run.precision} />
          </Detail>
          <Detail label="History Completeness">
            <HistoryCompletenessBadge completeness={run.historyCompleteness} />
          </Detail>
          <Detail label="Warning件数">{String(run.warningCount)}</Detail>
          <Detail label="Run Warning Codes">
            <RawCodes codes={run.warningCodes} />
          </Detail>
          <Detail label="正常結果の計算対象期間">
            {formatPeriod(run.calculationFrom, run.calculationTo)}
          </Detail>
        </dl>
      ) : (
        <p className="mt-2 text-xs text-slate-400">
          最新の計算試行が、現在表示している正常結果です。共通するRun情報は上に1回だけ表示しています。
        </p>
      )}

      <h5 className="mt-6 text-xs font-semibold text-slate-200">Lane Availability</h5>
      <dl className="mt-3 grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 xl:grid-cols-3">
        {(["return", "trade", "exposure"] as const).flatMap((lane) => {
          const availability = data.availability[lane];
          const differs = periodDiffers(availability, run.calculationFrom, run.calculationTo);
          return [
            <Detail key={`${lane}-availability`} label={`${laneLabel(lane)} Availability`}>
              {availability.status}
            </Detail>,
            <Detail key={`${lane}-reasons`} label={`${laneLabel(lane)} reasons`}>
              <RawCodes codes={availability.reasons} />
            </Detail>,
            ...(differs
              ? [
                  <Detail key={`${lane}-period`} label={`${laneLabel(lane)}対象期間`}>
                    {availabilityPeriod(availability)}
                  </Detail>,
                ]
              : []),
          ];
        })}
      </dl>

      <h5 className="mt-6 text-xs font-semibold text-slate-200">Calculation Details</h5>
      <dl className="mt-3 grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 xl:grid-cols-3">
        <Detail label="除外Fill件数">{String(data.calculationDetails.excludedFillCount)}</Detail>
        <Detail label="除外Funding件数">
          {String(data.calculationDetails.excludedFundingCount)}
        </Detail>
        <Detail label="信頼済み完了Cycle件数">
          {String(data.calculationDetails.trustedClosedCycleCount)}
        </Detail>
        <Detail label="UNKNOWN_CASH_FLOW件数">
          {String(data.calculationDetails.unknownCashFlowCount)}
        </Detail>
        <Detail label="NAV Gap件数">{String(data.calculationDetails.navGapCount)}</Detail>
        <Detail label="取引履歴Prefix">
          {data.calculationDetails.tradePrefixes.length > 0
            ? data.calculationDetails.tradePrefixes
                .map(
                  (prefix) =>
                    `${prefix.coin}: ${String(prefix.skippedFillCount)}件除外 (${formatPerformanceDate(prefix.skippedFrom)} → ${formatPerformanceDate(prefix.trustedFrom)})`,
                )
                .join(" / ")
            : "—"}
        </Detail>
      </dl>

      <MetricMetadata data={data} />

      <h5 className="mt-6 text-xs font-semibold text-slate-200">保存済み明細</h5>
      <dl className="mt-3 grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 xl:grid-cols-3">
        <Detail label="Daily NAV件数">{String(data.navSummary.count)}</Detail>
        <Detail label="Daily NAV期間">
          {data.navSummary.firstDate && data.navSummary.lastDate
            ? formatPeriod(data.navSummary.firstDate, data.navSummary.lastDate)
            : "—"}
        </Detail>
        <Detail label="Position Cycle件数">{String(data.cycleSummary.total)}</Detail>
        <Detail label="完了Position Cycle件数">{String(data.cycleSummary.closed)}</Detail>
      </dl>
      <p className="mt-3 text-xs leading-relaxed text-slate-400">
        日次評価額はraw Portfolio
        Snapshot由来の表示・監査用系列です。最大下落率はperformance-v3が保存したTWR Wealth
        Index由来の値であり、この日次評価額から画面上で再計算していません。
      </p>
    </section>
  );
}

function MetricMetadata({ data }: { readonly data: AddressPerformanceDto }): React.JSX.Element {
  const metrics = Object.values(data.metrics).sort((left, right) =>
    left.metricKey.localeCompare(right.metricKey),
  );
  if (metrics.length === 0) {
    return (
      <div className="mt-6">
        <h5 className="text-xs font-semibold text-slate-200">Metric metadata</h5>
        <p className="mt-2 text-xs text-slate-400">保存済みMetricはありません。</p>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <h5 className="text-xs font-semibold text-slate-200">Metric metadata</h5>
      <div className="mt-3 overflow-x-auto rounded-xl border border-white/[0.08]">
        <table className="min-w-[52rem] w-full text-left text-xs">
          <caption className="sr-only">Metric metadata一覧</caption>
          <thead className="bg-slate-950/80 text-slate-500">
            <tr>
              {["Metric Key", "Version", "Status", "Precision", "Warning Codes", "固有期間"].map(
                (label) => (
                  <th className="whitespace-nowrap px-3 py-2 font-medium" key={label} scope="col">
                    {label}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {metrics.map((metric) => (
              <tr className="text-slate-300" key={metric.metricKey}>
                <Cell>{metric.metricKey}</Cell>
                <Cell>{metric.metricVersion}</Cell>
                <Cell>{metric.status}</Cell>
                <Cell>{metric.precision}</Cell>
                <Cell>{metric.warningCodes.length > 0 ? metric.warningCodes.join(", ") : "—"}</Cell>
                <Cell>{metricSpecificPeriod(data, metric)}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function metricSpecificPeriod(data: AddressPerformanceDto, metric: PerformanceMetricDto): string {
  const lane = metricLane(metric.metricKey);
  const comparisonPeriod = lane ? data.availability[lane] : null;
  if (
    comparisonPeriod &&
    metric.calculationFrom === comparisonPeriod.from &&
    metric.calculationTo === comparisonPeriod.to
  ) {
    return "—";
  }
  if (
    data.latestSuccessfulRun &&
    metric.calculationFrom === data.latestSuccessfulRun.calculationFrom &&
    metric.calculationTo === data.latestSuccessfulRun.calculationTo
  ) {
    return "—";
  }
  return formatPeriod(metric.calculationFrom, metric.calculationTo);
}

function periodDiffers(
  availability: MetricGroupAvailabilityDto,
  from: string,
  to: string,
): boolean {
  return (
    availability.from !== null &&
    availability.to !== null &&
    (availability.from !== from || availability.to !== to)
  );
}

function availabilityPeriod(availability: MetricGroupAvailabilityDto): string {
  if (!availability.from || !availability.to) return "—";
  return formatPeriod(availability.from, availability.to);
}

function laneLabel(lane: PerformanceLane): string {
  if (lane === "return") return "Return";
  if (lane === "trade") return "Trade";
  return "Exposure";
}

function RawCodes({ codes }: { readonly codes: ReadonlyArray<string> }): React.JSX.Element {
  return codes.length > 0 ? (
    <span className="break-words font-mono text-amber-200">{codes.join(", ")}</span>
  ) : (
    <>—</>
  );
}

function Detail({
  children,
  label,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-600">{label}</dt>
      <dd className="mt-1.5 min-w-0 break-words text-slate-300">{children}</dd>
    </div>
  );
}

function Cell({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <td className="whitespace-nowrap px-3 py-3 align-top">{children}</td>;
}

function formatPeriod(from: string, to: string): string {
  return `${formatPerformanceDate(from)} – ${formatPerformanceDate(to)}`;
}
