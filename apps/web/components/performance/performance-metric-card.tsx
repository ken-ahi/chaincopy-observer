"use client";

import { Badge, Card, CardContent } from "@chaincopy/ui";
import * as React from "react";

import { type DisplayMetric } from "./performance-display";

export function PerformanceMetricCard({
  metric,
}: {
  readonly metric: DisplayMetric;
}): React.JSX.Element {
  const [descriptionOpen, setDescriptionOpen] = React.useState(false);
  const descriptionId = `${React.useId()}-description`;

  return (
    <Card className="min-w-0" data-metric-key={metric.key}>
      <CardContent className="p-4">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <p className="min-w-0 text-[11px] leading-relaxed text-slate-400">{metric.label}</p>
          <div className="flex shrink-0 items-center gap-1">
            {metric.referenceOnly ? <Badge variant="warning">参考値</Badge> : null}
            {metric.description ? (
              <button
                aria-controls={descriptionId}
                aria-expanded={descriptionOpen}
                aria-label={`${metric.label}の説明`}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/[0.12] text-base text-cyan-100 transition-colors hover:border-cyan-300/40 hover:bg-cyan-300/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
                onClick={() => setDescriptionOpen((open) => !open)}
                type="button"
              >
                <span aria-hidden="true">i</span>
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 break-words text-lg font-semibold tabular-nums text-white">
          {metric.value}
        </p>
        {metric.description ? (
          <p
            className="mt-3 border-t border-white/[0.08] pt-3 text-xs leading-relaxed text-slate-300"
            hidden={!descriptionOpen}
            id={descriptionId}
          >
            {metric.description}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
