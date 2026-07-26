import type {
  AccountSnapshotInput,
  CalculationWarning,
  CashFlowInput,
  DailyNavPoint,
  DataCompleteness,
  FillInput,
  FundingInput,
  NavSnapshotInput,
  PositionCycle,
  PositionExposureInput,
} from "@chaincopy/analytics";
import type {
  MetricCalculationStatus,
  PerformanceHistoryCompleteness,
  PerformancePrecision,
} from "@chaincopy/database";

export interface PositionSnapshotInput extends PositionExposureInput {
  readonly externalId: string;
  readonly occurredAt: string;
}

export interface PerformanceCalculationInput {
  readonly accountSnapshots: readonly AccountSnapshotInput[];
  readonly cashFlows: readonly CashFlowInput[];
  readonly fills: readonly FillInput[];
  readonly funding: readonly FundingInput[];
  readonly navSnapshots: readonly NavSnapshotInput[];
  readonly openIssueTypes: readonly string[];
  readonly positionSnapshots: readonly PositionSnapshotInput[];
  readonly syncCursorStatuses: readonly string[];
  readonly walletAddress: string;
  readonly walletAddressId: string;
}

export interface PerformanceRunRecord {
  readonly calculationVersion: string;
  readonly deduplicationKey: string;
  readonly id: string;
  readonly inputFingerprint: string;
  readonly status: MetricCalculationStatus;
  readonly walletAddressId: string;
}

export interface CreateRunInput {
  readonly calculationFrom: Date;
  readonly calculationTo: Date;
  readonly calculationVersion: string;
  readonly deduplicationKey: string;
  readonly historyCompleteness: PerformanceHistoryCompleteness;
  readonly inputFingerprint: string;
  readonly requestedAt: Date;
  readonly requestedBy: string;
  readonly walletAddressId: string;
}

export interface PersistedDailyNav {
  readonly date: Date;
  readonly externalCashFlow: string | null;
  readonly fees: string | null;
  readonly funding: string | null;
  readonly nav: string;
  readonly realizedPnl: string | null;
  readonly unrealizedPnl: string | null;
}

export interface PersistedPositionCycle {
  readonly averageEntryPrice: string;
  readonly averageExitPrice: string | null;
  readonly closedAt: Date | null;
  readonly coin: string;
  readonly entryQuantity: string;
  readonly exitQuantity: string;
  readonly fees: string;
  readonly fillCount: number;
  readonly funding: string;
  readonly grossRealizedPnl: string;
  readonly inputFingerprint: string;
  readonly netRealizedPnl: string;
  readonly openedAt: Date;
  readonly side: "LONG" | "SHORT";
  readonly status: "OPEN" | "CLOSED";
}

export interface PersistedMetric {
  readonly metricKey: string;
  readonly metricValue: string;
  readonly status: "AVAILABLE" | "REFERENCE_ONLY";
  readonly warningCodes: readonly string[];
}

export interface SuccessfulPerformanceResult {
  readonly cycles: readonly PersistedPositionCycle[];
  readonly dailyNavs: readonly PersistedDailyNav[];
  readonly metrics: readonly PersistedMetric[];
  readonly precision: PerformancePrecision;
  readonly warnings: readonly CalculationWarning[];
}

export interface PerformanceProcessResult {
  readonly calculationRunId: string;
  readonly inputFingerprint: string;
  readonly metricCount: number;
  readonly reused: boolean;
  readonly status: MetricCalculationStatus;
}

export interface CalculationMaterial {
  readonly completeness: DataCompleteness;
  readonly cycles: readonly PositionCycle[];
  readonly dailyNav: readonly DailyNavPoint[];
  readonly result: SuccessfulPerformanceResult;
}
