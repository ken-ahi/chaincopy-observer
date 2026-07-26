import { Card, CardContent, CardHeader, CardTitle } from "@chaincopy/ui";
import * as React from "react";

import {
  formatPerformanceDate,
  formatSafeErrorCode,
  formatSafeErrorMessage,
} from "./performance-formatters";
import {
  HistoryCompletenessBadge,
  PerformanceStatusBadge,
  PrecisionBadge,
} from "./performance-status-badge";
import { type CalculationRunDto } from "../../lib/performance-api";

export function CalculationDetails({
  run,
}: {
  readonly run: CalculationRunDto;
}): React.JSX.Element {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Calculation Details</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-x-6 gap-y-4 text-xs sm:grid-cols-2 xl:grid-cols-3">
          <Detail label="Run ID">
            <span className="break-all font-mono text-slate-300">{run.runId}</span>
          </Detail>
          <Detail label="Status">
            <PerformanceStatusBadge status={run.status} />
          </Detail>
          <Detail label="Input Fingerprint">
            <span className="font-mono text-slate-300">{run.inputFingerprintShort}</span>
          </Detail>
          <Detail label="計算要求日時">{formatPerformanceDate(run.requestedAt)}</Detail>
          <Detail label="計算開始日時">{formatPerformanceDate(run.startedAt)}</Detail>
          <Detail label="計算完了日時">{formatPerformanceDate(run.completedAt)}</Detail>
          <Detail label="計算開始期間">{formatPerformanceDate(run.calculationFrom)}</Detail>
          <Detail label="計算終了期間">{formatPerformanceDate(run.calculationTo)}</Detail>
          <Detail label="Calculation Version">{run.calculationVersion}</Detail>
          <Detail label="Warning Codes">
            {run.warningCodes.length > 0 ? (
              <span className="break-words text-amber-200">{run.warningCodes.join(", ")}</span>
            ) : (
              "—"
            )}
          </Detail>
          <Detail label="Error Code">{formatSafeErrorCode(run.errorCode)}</Detail>
          <Detail label="Error Message">{formatSafeErrorMessage(run.errorMessage)}</Detail>
          <Detail label="Precision">
            <PrecisionBadge precision={run.precision} />
          </Detail>
          <Detail label="History Completeness">
            <HistoryCompletenessBadge completeness={run.historyCompleteness} />
          </Detail>
        </dl>
      </CardContent>
    </Card>
  );
}

function Detail({
  children,
  label,
}: {
  readonly children: React.ReactNode;
  readonly label: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-[0.12em] text-slate-600">{label}</dt>
      <dd className="mt-1.5 min-w-0 break-words text-slate-300">{children}</dd>
    </div>
  );
}
