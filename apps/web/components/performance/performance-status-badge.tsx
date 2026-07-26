import { Badge } from "@chaincopy/ui";
import * as React from "react";

import {
  type PerformanceCalculationStatus,
  type PerformanceHistoryCompleteness,
  type PerformancePrecision,
} from "../../lib/performance-api";

const statusLabels: Record<PerformanceCalculationStatus, string> = {
  PENDING: "PENDING · 計算待ち",
  RUNNING: "RUNNING · 計算中",
  SUCCEEDED: "SUCCEEDED · 計算済み",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA · データ不足",
  FAILED: "FAILED · 計算失敗",
};

const precisionLabels: Record<PerformancePrecision, string> = {
  EXACT: "EXACT · 正確",
  DERIVED: "DERIVED · 算出値",
  ESTIMATED: "ESTIMATED · 推定値",
  UNAVAILABLE: "UNAVAILABLE · 算出不可",
};

const completenessLabels: Record<PerformanceHistoryCompleteness, string> = {
  COMPLETE: "COMPLETE · 完全",
  PARTIAL: "PARTIAL · 一部不足",
  TRUNCATED: "TRUNCATED · 履歴打切り",
  GAP_DETECTED: "GAP_DETECTED · 履歴欠損",
  INSUFFICIENT_HISTORY: "INSUFFICIENT_HISTORY · 履歴不足",
};

export function PerformanceStatusBadge({
  status,
}: {
  readonly status: PerformanceCalculationStatus;
}): React.JSX.Element {
  const variant =
    status === "SUCCEEDED"
      ? "success"
      : status === "RUNNING"
        ? "info"
        : status === "FAILED" || status === "INSUFFICIENT_DATA"
          ? "warning"
          : "neutral";
  return <Badge variant={variant}>{statusLabels[status]}</Badge>;
}

export function PrecisionBadge({
  precision,
}: {
  readonly precision: PerformancePrecision | null;
}): React.JSX.Element {
  if (!precision) {
    return <Badge variant="neutral">— · 未設定</Badge>;
  }
  const variant =
    precision === "EXACT" ? "success" : precision === "UNAVAILABLE" ? "warning" : "info";
  return <Badge variant={variant}>{precisionLabels[precision]}</Badge>;
}

export function HistoryCompletenessBadge({
  completeness,
}: {
  readonly completeness: PerformanceHistoryCompleteness;
}): React.JSX.Element {
  return (
    <Badge variant={completeness === "COMPLETE" ? "success" : "warning"}>
      {completenessLabels[completeness]}
    </Badge>
  );
}
