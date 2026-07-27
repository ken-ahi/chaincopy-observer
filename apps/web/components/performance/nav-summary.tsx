import { Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import * as React from "react";

import {
  comparePerformanceDecimals,
  formatPerformanceAmount,
  formatPerformanceDay,
} from "./performance-formatters";
import { type AddressPerformanceDto, type DailyNavDto } from "../../lib/performance-api";

export type NavSummaryDto = AddressPerformanceDto["navSummary"];

export function summarizeNavRows(items: ReadonlyArray<DailyNavDto>): NavSummaryDto {
  if (items.length === 0) {
    return {
      count: 0,
      firstDate: null,
      lastDate: null,
      firstNav: null,
      lastNav: null,
      minNav: null,
      maxNav: null,
    };
  }

  let minNav = items[0]?.nav ?? null;
  let maxNav = minNav;
  for (const item of items.slice(1)) {
    if (minNav !== null) {
      const comparison = comparePerformanceDecimals(item.nav, minNav);
      if (comparison !== null && comparison < 0) {
        minNav = item.nav;
      }
    }
    if (maxNav !== null) {
      const comparison = comparePerformanceDecimals(item.nav, maxNav);
      if (comparison !== null && comparison > 0) {
        maxNav = item.nav;
      }
    }
  }

  return {
    count: items.length,
    firstDate: items[0]?.date ?? null,
    lastDate: items.at(-1)?.date ?? null,
    firstNav: items[0]?.nav ?? null,
    lastNav: items.at(-1)?.nav ?? null,
    minNav,
    maxNav,
  };
}

export function NavSummary({
  items,
  overviewSummary,
}: {
  readonly items: ReadonlyArray<DailyNavDto>;
  readonly overviewSummary: NavSummaryDto | null;
}): React.JSX.Element {
  const visibleSummary = summarizeNavRows(items);
  const summary = overviewSummary && overviewSummary.count > 0 ? overviewSummary : visibleSummary;

  return (
    <Card>
      <CardHeader>
        <CardTitle>日次NAV概要</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <Summary label="表示期間の開始日" value={formatPerformanceDay(summary.firstDate)} />
          <Summary label="表示期間の終了日" value={formatPerformanceDay(summary.lastDate)} />
          <Summary label="最初のNAV" value={formatPerformanceAmount(summary.firstNav)} />
          <Summary label="最後のNAV" value={formatPerformanceAmount(summary.lastNav)} />
          <Summary label="最小NAV" value={formatPerformanceAmount(summary.minNav)} />
          <Summary label="最大NAV" value={formatPerformanceAmount(summary.maxNav)} />
          <Summary label="表示件数" value={String(summary.count)} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Summary({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-600">{label}</dt>
      <dd className="mt-1.5 break-words text-slate-300">{value}</dd>
    </div>
  );
}
