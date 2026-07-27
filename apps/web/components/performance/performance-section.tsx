"use client";

import { useEffect, useState } from "react";

import { NavSection } from "./nav-section";
import { PerformanceOverview } from "./performance-overview";
import { PositionCycleSection } from "./position-cycle-section";
import { getAddressPerformance, type AddressPerformanceDto } from "../../lib/performance-api";

export function PerformanceSection({ address }: { readonly address: string }) {
  const [data, setData] = useState<AddressPerformanceDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void getAddressPerformance(address)
      .then((result) => {
        if (active) {
          setData(result);
        }
      })
      .catch(() => {
        if (active) {
          setError(true);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [address]);

  const latestSuccessfulRun = data?.latestSuccessfulRun ?? null;

  return (
    <>
      <PerformanceOverview data={data} error={error} loading={loading} />
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
