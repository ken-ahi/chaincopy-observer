import * as React from "react";

import {
  formatPerformanceAmount,
  formatPerformanceDate,
  formatPerformancePnl,
} from "./performance-formatters";
import { type PositionCycleDto } from "../../lib/performance-api";

export function PositionCycleTable({
  items,
}: {
  readonly items: ReadonlyArray<PositionCycleDto>;
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="min-w-[112rem] w-full text-left text-xs">
        <caption className="sr-only">Position Cycle一覧</caption>
        <thead className="bg-slate-950/80 text-slate-500">
          <tr>
            {[
              "銘柄",
              "方向",
              "開始日時",
              "終了日時",
              "平均Entry価格",
              "平均Exit価格",
              "Entry数量",
              "Exit数量",
              "Gross Realized PnL",
              "Fee",
              "Funding",
              "Net Realized PnL",
              "Fill数",
              "状態",
            ].map((label) => (
              <th className="whitespace-nowrap px-3 py-2 font-medium" key={label} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {items.map((item) => (
            <tr className="text-slate-300" key={item.id}>
              <Cell>{item.coin || "—"}</Cell>
              <Cell>{formatSide(item.side)}</Cell>
              <Cell>{formatPerformanceDate(item.openedAt)}</Cell>
              <Cell>{formatPerformanceDate(item.closedAt)}</Cell>
              <Cell>{formatPerformanceAmount(item.averageEntryPrice ?? null)}</Cell>
              <Cell>{formatPerformanceAmount(item.averageExitPrice ?? null)}</Cell>
              <Cell>{formatPerformanceAmount(item.entryQuantity ?? null)}</Cell>
              <Cell>{formatPerformanceAmount(item.exitQuantity ?? null)}</Cell>
              <Cell>{formatPerformancePnl(item.grossRealizedPnl ?? null)}</Cell>
              <Cell>{formatPerformanceAmount(item.fees ?? null, { signed: true })}</Cell>
              <Cell>{formatPerformanceAmount(item.funding ?? null, { signed: true })}</Cell>
              <Cell>{formatPerformancePnl(item.netRealizedPnl ?? null)}</Cell>
              <Cell>{Number.isInteger(item.fillCount) ? String(item.fillCount) : "—"}</Cell>
              <Cell>{formatStatus(item.status)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <td className="whitespace-nowrap px-3 py-3 tabular-nums">{children}</td>;
}

function formatSide(side: string): string {
  if (side === "LONG") {
    return "Long";
  }
  if (side === "SHORT") {
    return "Short";
  }
  return "—";
}

function formatStatus(status: PositionCycleDto["status"]): string {
  return status === "OPEN" ? "Open" : "Closed";
}
