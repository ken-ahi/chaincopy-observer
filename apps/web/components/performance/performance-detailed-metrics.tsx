import { Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import * as React from "react";

import {
  buildReliabilitySummary,
  selectDetailMetricGroups,
  unavailableMetricLabels,
  type PerformanceLane,
} from "./performance-display";
import { formatPerformanceMinute } from "./performance-formatters";
import { PerformanceMetricCard } from "./performance-metric-card";
import { buildPerformanceWarnings } from "./performance-warnings";
import { type AddressPerformanceDto } from "../../lib/performance-api";

const laneDefinitions: ReadonlyArray<{
  readonly key: PerformanceLane;
  readonly label: string;
}> = [
  { key: "return", label: "収益・リスク" },
  { key: "trade", label: "取引" },
  { key: "exposure", label: "レバレッジ・集中度" },
];

export function PerformanceDetailedMetrics({
  data,
}: {
  readonly data: AddressPerformanceDto;
}): React.JSX.Element {
  const reliability = buildReliabilitySummary(data);
  const warningModel = buildPerformanceWarnings(data, reliability?.consumedMeaningKeys ?? []);
  const groups = selectDetailMetricGroups(data);

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-xs text-slate-500">表示中の正常結果</p>
        <p className="mt-1 text-sm text-slate-200">
          計算日時: {formatPerformanceMinute(data.latestSuccessfulRun?.completedAt ?? null)}
        </p>
      </div>

      <section aria-labelledby="performance-availability-title">
        <h4 className="text-sm font-semibold text-white" id="performance-availability-title">
          データ利用状況
        </h4>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {laneDefinitions.map((lane) => {
            const availability = data.availability[lane.key];
            const missingLabels = unavailableMetricLabels(data, lane.key);
            const reasons = warningModel.laneWarnings[lane.key];
            return (
              <div
                className="rounded-xl border border-white/[0.08] bg-slate-950/30 p-4"
                key={lane.key}
              >
                <p className="text-xs font-medium text-slate-200">{lane.label}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {availabilityLabel(availability.status)}
                </p>
                {reasons.length > 0 ? (
                  <ul className="mt-3 grid gap-2 text-xs leading-relaxed text-amber-100">
                    {reasons.map((reason) => (
                      <li key={reason.meaningKey}>{reason.message}</li>
                    ))}
                  </ul>
                ) : availability.reasons.length === 0 &&
                  (availability.status !== "AVAILABLE" || missingLabels.length > 0) ? (
                  <p className="mt-3 text-xs leading-relaxed text-amber-100">
                    この指標を計算できるデータがありません。
                  </p>
                ) : null}
                {missingLabels.length > 0 ? (
                  <p className="mt-3 text-xs leading-relaxed text-slate-400">
                    対象指標: {missingLabels.join("、")}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {groups.map((group) => (
        <section aria-labelledby={`detail-metric-${group.key}`} key={group.key}>
          <h4 className="text-sm font-semibold text-white" id={`detail-metric-${group.key}`}>
            {group.title}
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.metrics.map((metric) => (
              <PerformanceMetricCard key={metric.key} metric={metric} />
            ))}
          </div>
        </section>
      ))}

      {groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>補助指標</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-400">現在表示できる詳細指標はありません。</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function availabilityLabel(
  status: AddressPerformanceDto["availability"][PerformanceLane]["status"],
): string {
  if (status === "AVAILABLE") return "利用可能な値を表示しています";
  if (status === "PARTIAL") return "一部の値を表示しています";
  return "現在は利用できません";
}
