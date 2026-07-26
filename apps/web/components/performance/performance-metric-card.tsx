import { Badge, Card, CardContent } from "@chaincopy/ui";
import * as React from "react";

import { formatMetricValue } from "./performance-formatters";
import { type PerformanceMetricDto } from "../../lib/performance-api";

export function PerformanceMetricCard({
  label,
  metric,
  metricKey,
  placeholder,
}: {
  readonly label: string;
  readonly metric: PerformanceMetricDto | undefined;
  readonly metricKey: string;
  readonly placeholder: string;
}): React.JSX.Element {
  return (
    <Card className="min-w-0" data-metric-key={metricKey}>
      <CardContent className="p-4">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <p className="text-[11px] leading-relaxed text-slate-500">{label}</p>
          {metric?.status === "REFERENCE_ONLY" ? <Badge variant="warning">参考値</Badge> : null}
        </div>
        <p className="mt-2 break-all text-lg font-semibold text-white">
          {metric ? formatMetricValue(metricKey, metric.metricValue) : placeholder}
        </p>
        {metric ? (
          <p className="mt-2 text-[10px] text-slate-600">
            {metric.precision}
            {metric.warningCodes.length > 0 ? ` · ${metric.warningCodes.join(", ")}` : ""}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
