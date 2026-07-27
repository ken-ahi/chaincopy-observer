import * as React from "react";

import { formatPerformanceAmount, formatPerformanceDay } from "./performance-formatters";
import { type DailyNavDto } from "../../lib/performance-api";

const WIDTH = 720;
const HEIGHT = 240;
const PADDING_X = 42;
const PADDING_Y = 28;

interface ChartPoint {
  readonly x: number;
  readonly y: number;
  readonly item: DailyNavDto;
}

export function createNavChartPoints(
  items: ReadonlyArray<DailyNavDto>,
): ReadonlyArray<ChartPoint> | null {
  if (items.length === 0) {
    return [];
  }
  const values = items.map((item) => Number(item.nav));
  if (values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(span)) {
    return null;
  }

  return items
    .map((item, index) => {
      const value = values[index] ?? 0;
      const x =
        items.length === 1
          ? WIDTH / 2
          : PADDING_X + (index / (items.length - 1)) * (WIDTH - PADDING_X * 2);
      const y =
        span === 0 ? HEIGHT / 2 : PADDING_Y + ((max - value) / span) * (HEIGHT - PADDING_Y * 2);
      return Number.isFinite(x) && Number.isFinite(y) ? { x, y, item } : null;
    })
    .filter((point): point is ChartPoint => point !== null);
}

export function NavChart({
  items,
}: {
  readonly items: ReadonlyArray<DailyNavDto>;
}): React.JSX.Element | null {
  if (items.length === 0) {
    return null;
  }
  const points = createNavChartPoints(items);
  if (points === null || points.length !== items.length) {
    return (
      <p className="text-xs text-slate-500" role="status">
        数値範囲外のためNAVチャートを表示できません。日次NAV一覧は確認できます。
      </p>
    );
  }

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) {
    return null;
  }

  return (
    <figure className="overflow-hidden rounded-xl border border-white/[0.08] bg-slate-950/40 p-3">
      <svg
        aria-label="日付順の日次NAV推移"
        className="h-auto min-w-[36rem] w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title>日次NAV推移</title>
        <line
          stroke="rgb(51 65 85)"
          strokeWidth="1"
          x1={PADDING_X}
          x2={WIDTH - PADDING_X}
          y1={HEIGHT - PADDING_Y}
          y2={HEIGHT - PADDING_Y}
        />
        <polyline
          fill="none"
          points={points.map((point) => `${point.x},${point.y}`).join(" ")}
          stroke="rgb(34 211 238)"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <circle cx={first.x} cy={first.y} fill="rgb(165 243 252)" r="4" />
        <circle cx={last.x} cy={last.y} fill="rgb(165 243 252)" r="4" />
        <text fill="rgb(203 213 225)" fontSize="11" x={PADDING_X} y={HEIGHT - 8}>
          {formatPerformanceDay(first.item.date)}
        </text>
        <text
          fill="rgb(203 213 225)"
          fontSize="11"
          textAnchor="end"
          x={WIDTH - PADDING_X}
          y={HEIGHT - 8}
        >
          {formatPerformanceDay(last.item.date)}
        </text>
        <text fill="rgb(226 232 240)" fontSize="11" x={first.x} y={Math.max(14, first.y - 10)}>
          {formatPerformanceAmount(first.item.nav)}
        </text>
        <text
          fill="rgb(226 232 240)"
          fontSize="11"
          textAnchor="end"
          x={last.x}
          y={Math.max(14, last.y - 10)}
        >
          {formatPerformanceAmount(last.item.nav)}
        </text>
      </svg>
    </figure>
  );
}
