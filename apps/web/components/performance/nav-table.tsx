import * as React from "react";

import { formatPerformanceAmount, formatPerformanceDay } from "./performance-formatters";
import { type DailyNavDto } from "../../lib/performance-api";

export function NavTable({
  items,
}: {
  readonly items: ReadonlyArray<DailyNavDto>;
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.08]">
      <table className="min-w-[78rem] w-full text-left text-xs">
        <caption className="sr-only">日次NAV一覧</caption>
        <thead className="bg-slate-950/80 text-slate-500">
          <tr>
            {[
              "日付",
              "NAV",
              "現金残高",
              "含み損益",
              "実現損益",
              "Funding",
              "手数料",
              "外部キャッシュフロー",
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
              <Cell>{formatPerformanceDay(item.date)}</Cell>
              <Cell>{formatPerformanceAmount(item.nav)}</Cell>
              <Cell>{formatPerformanceAmount(item.cashBalance)}</Cell>
              <Cell>{formatPerformanceAmount(item.unrealizedPnl, { signed: true })}</Cell>
              <Cell>{formatPerformanceAmount(item.realizedPnl, { signed: true })}</Cell>
              <Cell>{formatPerformanceAmount(item.funding, { signed: true })}</Cell>
              <Cell>{formatPerformanceAmount(item.fees, { signed: true })}</Cell>
              <Cell>{formatPerformanceAmount(item.externalCashFlow, { signed: true })}</Cell>
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
