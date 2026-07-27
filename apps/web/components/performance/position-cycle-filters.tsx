import * as React from "react";

import { type PositionCycleDto } from "../../lib/performance-api";

export type CycleSideFilter = "ALL" | "LONG" | "SHORT";
export type CycleStatusFilter = "ALL" | "OPEN" | "CLOSED";
export type CyclePnlFilter = "ALL" | "PROFIT" | "LOSS" | "BREAK_EVEN";

export interface PositionCycleFiltersValue {
  readonly coin: string;
  readonly side: CycleSideFilter;
  readonly status: CycleStatusFilter;
  readonly pnl: CyclePnlFilter;
}

export const defaultPositionCycleFilters: PositionCycleFiltersValue = {
  coin: "ALL",
  side: "ALL",
  status: "ALL",
  pnl: "ALL",
};

export function PositionCycleFilters({
  items,
  onChange,
  value,
}: {
  readonly items: ReadonlyArray<PositionCycleDto>;
  readonly onChange: (value: PositionCycleFiltersValue) => void;
  readonly value: PositionCycleFiltersValue;
}): React.JSX.Element {
  const coins = [...new Set(items.map((item) => item.coin))].sort((left, right) =>
    left.localeCompare(right),
  );

  return (
    <div className="grid gap-3 rounded-xl border border-white/[0.08] bg-slate-950/40 p-3 sm:grid-cols-2 xl:grid-cols-4">
      <Filter label="Coin">
        <select
          className="mt-1 w-full rounded-lg border border-white/[0.12] bg-slate-950 px-3 py-2 text-sm text-slate-200"
          onChange={(event) => onChange({ ...value, coin: event.target.value })}
          value={value.coin}
        >
          <option value="ALL">All</option>
          {coins.map((coin) => (
            <option key={coin} value={coin}>
              {coin}
            </option>
          ))}
        </select>
      </Filter>
      <Filter label="方向">
        <select
          className="mt-1 w-full rounded-lg border border-white/[0.12] bg-slate-950 px-3 py-2 text-sm text-slate-200"
          onChange={(event) => onChange({ ...value, side: event.target.value as CycleSideFilter })}
          value={value.side}
        >
          <option value="ALL">All</option>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
        </select>
      </Filter>
      <Filter label="状態">
        <select
          className="mt-1 w-full rounded-lg border border-white/[0.12] bg-slate-950 px-3 py-2 text-sm text-slate-200"
          onChange={(event) =>
            onChange({ ...value, status: event.target.value as CycleStatusFilter })
          }
          value={value.status}
        >
          <option value="ALL">All</option>
          <option value="OPEN">Open</option>
          <option value="CLOSED">Closed</option>
        </select>
      </Filter>
      <Filter label="損益">
        <select
          className="mt-1 w-full rounded-lg border border-white/[0.12] bg-slate-950 px-3 py-2 text-sm text-slate-200"
          onChange={(event) => onChange({ ...value, pnl: event.target.value as CyclePnlFilter })}
          value={value.pnl}
        >
          <option value="ALL">All</option>
          <option value="PROFIT">Profit</option>
          <option value="LOSS">Loss</option>
          <option value="BREAK_EVEN">Break-even</option>
        </select>
      </Filter>
    </div>
  );
}

function Filter({
  children,
  label,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
}): React.JSX.Element {
  return (
    <label className="text-xs text-slate-400">
      <span>{label}</span>
      {children}
    </label>
  );
}
