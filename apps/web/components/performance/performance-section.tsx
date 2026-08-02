"use client";

import * as React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { CalculationDetails } from "./calculation-details";
import { NavSection } from "./nav-section";
import { PerformanceDetailedMetrics } from "./performance-detailed-metrics";
import { PerformanceOverview } from "./performance-overview";
import {
  PERFORMANCE_POLL_INTERVAL_MS,
  PERFORMANCE_POLL_MAX_ATTEMPTS,
  isCurrentPerformanceAddress,
  shouldPollPerformance,
} from "./performance-polling";
import { PositionCycleSection } from "./position-cycle-section";
import {
  calculateAddressPerformance,
  getAddressPerformance,
  recalculateAddressPerformance,
  type AddressPerformanceDto,
} from "../../lib/performance-api";

export function PerformanceSection({ address }: { readonly address: string }) {
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
        onAction={() => void submitCalculation()}
      />
      <PerformanceDetailsPanels
        address={address}
        calculationDetailsOpen={calculationDetailsOpen}
        data={data}
        detailsOpen={detailsOpen}
        error={error}
        loading={loading}
        onCalculationDetailsToggle={() => setCalculationDetailsOpen((open) => !open)}
        onDetailsToggle={() => setDetailsOpen((open) => !open)}
      />
    </>
  );
}

export function PerformanceDetailsPanels({
  address,
  calculationDetailsOpen,
  data,
  detailsOpen,
  error,
  loading,
  onCalculationDetailsToggle,
  onDetailsToggle,
}: {
  readonly address: string;
  readonly calculationDetailsOpen: boolean;
  readonly data: AddressPerformanceDto | null;
  readonly detailsOpen: boolean;
  readonly error: boolean;
  readonly loading: boolean;
  readonly onCalculationDetailsToggle: () => void;
  readonly onDetailsToggle: () => void;
}) {
  const detailsId = `${useId()}-performance-details`;
  const calculationDetailsId = `${useId()}-performance-calculation-details`;
  if (loading || error || data === null || data.latestRun === null) {
    return null;
  }
  const successfulRun = data.latestSuccessfulRun;

  return (
    <section aria-label="運用実績の詳細" className="mt-6">
      <div className={`grid gap-3 ${successfulRun ? "sm:grid-cols-2" : "sm:grid-cols-1"}`}>
        {successfulRun ? (
          <DisclosureButton
            controls={detailsId}
            expanded={detailsOpen}
            label="詳細指標"
            onClick={onDetailsToggle}
          />
        ) : null}
        <DisclosureButton
          controls={calculationDetailsId}
          expanded={calculationDetailsOpen}
          label="計算の詳細"
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
          <div className="grid gap-8">
            <CalculationDetails data={data} />

            {successfulRun ? (
              <>
                <NavSection
                  address={address}
                  enabled
                  overviewLoading={false}
                  overviewSummary={data.navSummary}
                  runId={successfulRun.runId}
                />

                <PositionCycleSection
                  address={address}
                  enabled
                  overviewLoading={false}
                  runId={successfulRun.runId}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
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
