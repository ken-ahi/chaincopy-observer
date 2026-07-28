"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { NavSection } from "./nav-section";
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
        setActionError("Performance計算を登録できませんでした。時間をおいて再実行してください。");
      }
    } finally {
      if (isCurrentPerformanceAddress(requestedAddress, currentAddress.current)) {
        setActionSubmitting(false);
      }
    }
  }

  const latestSuccessfulRun = data?.latestSuccessfulRun ?? null;

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
      <NavSection
        address={address}
        enabled={!loading && !error && latestSuccessfulRun !== null}
        overviewLoading={loading}
        overviewSummary={data?.navSummary ?? null}
        runId={latestSuccessfulRun?.runId ?? null}
      />
      <PositionCycleSection
        address={address}
        enabled={!loading && !error && latestSuccessfulRun !== null}
        overviewLoading={loading}
        runId={latestSuccessfulRun?.runId ?? null}
      />
    </>
  );
}
