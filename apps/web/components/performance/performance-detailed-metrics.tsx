import { Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import * as React from "react";

import { selectDetailMetricGroups } from "./performance-display";
import { PerformanceMetricCard } from "./performance-metric-card";
import { type AddressPerformanceDto } from "../../lib/performance-api";

export function PerformanceDetailedMetrics({
  data,
}: {
  readonly data: AddressPerformanceDto;
}): React.JSX.Element {
  const groups = selectDetailMetricGroups(data);

  return (
    <div className="grid gap-6">
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
            <CardTitle>くわしい成績</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-400">現在、追加で表示できる成績はありません。</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
