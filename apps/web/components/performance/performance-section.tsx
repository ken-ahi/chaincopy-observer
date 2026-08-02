"use client";

import * as React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { buildReliabilitySummary, selectPrimaryMetrics } from "./performance-display";
import { PerformanceDetailedMetrics } from "./performance-detailed-metrics";
import { formatPerformanceMinute } from "./performance-formatters";
import { PerformanceOverview } from "./performance-overview";
import {
  PERFORMANCE_POLL_INTERVAL_MS,
  PERFORMANCE_POLL_MAX_ATTEMPTS,
  isCurrentPerformanceAddress,
  shouldPollPerformance,
} from "./performance-polling";
import {
  calculateAddressPerformance,
  getAddressPerformance,
  recalculateAddressPerformance,
  type AddressPerformanceDto,
} from "../../lib/performance-api";

export function PerformanceSection({
  address,
  lastUpdatedAt,
}: {
  readonly address: string;
  readonly lastUpdatedAt: string | null;
}) {
  const [data, setData] = useState<AddressPerformanceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionQueued, setActionQueued] = useState(false);
  const [actionSubmitting, setActionSubmitting] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [calculationDetailsOpen, setCalculationDetailsOpen] = useState(false);
  const currentAddress = useRef(address);
  const pollAttempt = useRef(0);

  const loadPerformance = useCallback(async (requestedAddress: string, showLoading: boolean) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(false);
    try {
      const result = await getAddressPerformance(requestedAddress);
      if (!isCurrentPerformanceAddress(requestedAddress, currentAddress.current)) {
        return;
      }
      setData(result);
      if (result.latestRun && !["PENDING", "RUNNING"].includes(result.latestRun.status)) {
        setActionQueued(false);
        pollAttempt.current = 0;
      }
    } catch {
      if (isCurrentPerformanceAddress(requestedAddress, currentAddress.current)) {
        setError(true);
      }
    } finally {
      if (showLoading && isCurrentPerformanceAddress(requestedAddress, currentAddress.current)) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    currentAddress.current = address;
    pollAttempt.current = 0;
    setData(null);
    setActionError(null);
    setActionQueued(false);
    setActionSubmitting(false);
    setDetailsOpen(false);
    setCalculationDetailsOpen(false);
    void loadPerformance(address, true);
    return () => {
      if (currentAddress.current === address) {
        currentAddress.current = "";
      }
    };
  }, [address, loadPerformance]);

  useEffect(() => {
    const status = data?.latestRun?.status ?? null;
    if (!shouldPollPerformance(status, actionQueued, pollAttempt.current)) {
      if (
        pollAttempt.current >= PERFORMANCE_POLL_MAX_ATTEMPTS &&
        (actionQueued || status === "PENDING" || status === "RUNNING")
      ) {
        setActionQueued(false);
        setActionError("状態確認を終了しました。時間をおいて画面を再読み込みしてください。");
      }
      return;
    }
    const requestedAddress = address;
    const timer = window.setTimeout(() => {
      pollAttempt.current += 1;
      void loadPerformance(requestedAddress, false);
    }, PERFORMANCE_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [actionQueued, address, data?.latestRun?.status, loadPerformance]);

  async function submitCalculation(): Promise<void> {
    const status = data?.latestRun?.status;
    if (actionSubmitting || actionQueued || status === "PENDING" || status === "RUNNING") {
      return;
    }
    const requestedAddress = address;
    setActionSubmitting(true);
    setActionError(null);
    try {
      if (data?.latestRun) {
        await recalculateAddressPerformance(requestedAddress);
      } else {
        await calculateAddressPerformance(requestedAddress);
      }
      if (!isCurrentPerformanceAddress(requestedAddress, currentAddress.current)) {
        return;
      }
      pollAttempt.current = 0;
      setActionQueued(true);
    } catch {
      if (isCurrentPerformanceAddress(requestedAddress, currentAddress.current)) {
        setActionError("運用実績の計算を登録できませんでした。時間をおいて再実行してください。");
      }
    } finally {
      if (isCurrentPerformanceAddress(requestedAddress, currentAddress.current)) {
        setActionSubmitting(false);
      }
    }
  }

  return (
    <>
      <PerformanceOverview
        actionError={actionError}
        actionQueued={actionQueued}
        actionSubmitting={actionSubmitting}
        data={data}
        error={error}
        loading={loading}
        lastUpdatedAt={lastUpdatedAt}
        onAction={() => void submitCalculation()}
      />
      <PerformanceDetailsPanels
        calculationDetailsOpen={calculationDetailsOpen}
        data={data}
        detailsOpen={detailsOpen}
        error={error}
        loading={loading}
        lastUpdatedAt={lastUpdatedAt}
        onCalculationDetailsToggle={() => setCalculationDetailsOpen((open) => !open)}
        onDetailsToggle={() => setDetailsOpen((open) => !open)}
      />
    </>
  );
}

export function PerformanceDetailsPanels({
  calculationDetailsOpen,
  data,
  detailsOpen,
  error,
  loading,
  lastUpdatedAt = null,
  onCalculationDetailsToggle,
  onDetailsToggle,
}: {
  readonly calculationDetailsOpen: boolean;
  readonly data: AddressPerformanceDto | null;
  readonly detailsOpen: boolean;
  readonly error: boolean;
  readonly loading: boolean;
  readonly lastUpdatedAt?: string | null;
  readonly onCalculationDetailsToggle: () => void;
  readonly onDetailsToggle: () => void;
}) {
  const detailsId = `${useId()}-performance-details`;
  const calculationDetailsId = `${useId()}-performance-data-status`;
  if (loading || error || data === null || data.latestRun === null) {
    return null;
  }
  const successfulRun = data.latestSuccessfulRun;

  return (
    <section aria-label="売買成績の詳細" className="mt-6">
      <div className={`grid gap-3 ${successfulRun ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
        {successfulRun ? (
          <DisclosureButton
            controls={detailsId}
            expanded={detailsOpen}
            label="成績をくわしく見る"
            onClick={onDetailsToggle}
          />
        ) : null}
        <DisclosureButton
          controls={calculationDetailsId}
          expanded={calculationDetailsOpen}
          label="データの状態を見る"
          onClick={onCalculationDetailsToggle}
        />
      </div>

      {successfulRun ? (
        <div
          className="mt-5 rounded-2xl border border-white/[0.08] bg-slate-950/20 p-4 sm:p-5"
          hidden={!detailsOpen}
          id={detailsId}
        >
          {detailsOpen ? <PerformanceDetailedMetrics data={data} /> : null}
        </div>
      ) : null}

      <div
        className="mt-5 rounded-2xl border border-white/[0.08] bg-slate-950/20 p-4 sm:p-5"
        hidden={!calculationDetailsOpen}
        id={calculationDetailsId}
      >
        {calculationDetailsOpen ? (
          <PerformanceDataStatus data={data} lastUpdatedAt={lastUpdatedAt} />
        ) : null}
      </div>
    </section>
  );
}

function PerformanceDataStatus({
  data,
  lastUpdatedAt,
}: {
  readonly data: AddressPerformanceDto;
  readonly lastUpdatedAt: string | null;
}) {
  const run = data.latestSuccessfulRun;
  const reliability = buildReliabilitySummary(data);
  const unavailable = selectPrimaryMetrics(data).filter((metric) => metric.unavailable);

  return (
    <div className="grid gap-5 text-sm">
      <div>
        <h3 className="font-semibold text-white">確認できたデータ</h3>
        <p className="mt-2 leading-relaxed text-slate-300">
          {reliability?.text ?? "成績を確認するための履歴がまだ十分にありません。"}
        </p>
      </div>
      <dl className="grid gap-4 sm:grid-cols-2">
        <DataStatusItem label="確認できた期間">
          {run
            ? `${formatPerformanceMinute(run.calculationFrom)} 〜 ${formatPerformanceMinute(run.calculationTo)}`
            : "-"}
        </DataStatusItem>
        <DataStatusItem label="利用できた取引数">
          {run && data.availability.trade.status !== "UNAVAILABLE"
            ? `${String(data.calculationDetails.trustedClosedCycleCount)}件`
            : "-"}
        </DataStatusItem>
        <DataStatusItem label="履歴がそろっているか">
          {run?.historyCompleteness === "COMPLETE" ? "そろっています" : "一部不足しています"}
        </DataStatusItem>
        <DataStatusItem label="最終更新日時">
          {formatPerformanceMinute(lastUpdatedAt ?? run?.completedAt ?? null)}
        </DataStatusItem>
      </dl>
      {unavailable.length > 0 ? (
        <div className="rounded-xl border border-amber-300/20 bg-amber-300/[0.05] p-4 text-amber-50">
          <p className="font-medium">計算できない項目</p>
          <ul className="mt-2 grid gap-2 leading-relaxed">
            {unavailable.map((metric) => (
              <li key={metric.key}>
                {metric.label}: {metric.unavailableReason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DataStatusItem({
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

function DisclosureButton({
  controls,
  expanded,
  label,
  onClick,
}: {
  readonly controls: string;
  readonly expanded: boolean;
  readonly label: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      aria-controls={controls}
      aria-expanded={expanded}
      aria-label={`${label}を${expanded ? "閉じる" : "開く"}`}
      className="flex min-h-11 w-full items-center justify-between rounded-xl border border-white/[0.1] bg-slate-950/30 px-4 py-3 text-left text-sm font-medium text-slate-100 hover:border-cyan-300/30 hover:bg-cyan-300/[0.05] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
      onClick={onClick}
      type="button"
    >
      <span>{label}</span>
      <span aria-hidden="true">{expanded ? "−" : "+"}</span>
    </button>
  );
}
