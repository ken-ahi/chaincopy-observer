export type CalculationPrecision = "EXACT" | "DERIVED" | "ESTIMATED" | "UNAVAILABLE";

export type DataCompleteness =
  "COMPLETE" | "PARTIAL" | "TRUNCATED" | "GAP_DETECTED" | "INSUFFICIENT_HISTORY";

export type CalculationErrorCode =
  | "DATA_GAP"
  | "DATA_ORDER_AMBIGUOUS"
  | "DUPLICATE_EVENT"
  | "HISTORY_TRUNCATED"
  | "INSUFFICIENT_HISTORY"
  | "INVALID_DECIMAL"
  | "INVALID_INPUT"
  | "MISSING_CASH_FLOW_BOUNDARY_NAV"
  | "MISSING_INITIAL_STATE"
  | "NON_POSITIVE_NAV"
  | "POSITION_DISCONTINUITY"
  | "UNKNOWN_CASH_FLOW"
  | "ZERO_DENOMINATOR"
  | "ZERO_DOWNSIDE_DEVIATION"
  | "ZERO_DRAWDOWN"
  | "ZERO_GROSS_LOSS"
  | "ZERO_VARIANCE";

export interface CalculationError {
  readonly code: CalculationErrorCode;
  readonly message: string;
}

export interface CalculationWarning {
  readonly code: string;
  readonly details?: Readonly<Record<string, number | string | null>>;
  readonly message: string;
}

export interface CalculationCoverage {
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly completeness: DataCompleteness;
  readonly initialStateKnown?: boolean;
}

interface CalculationMetadata {
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly completeness: DataCompleteness;
  readonly warnings: readonly CalculationWarning[];
}

export interface CalculationSuccess<T> extends CalculationMetadata {
  readonly ok: true;
  readonly precision: Exclude<CalculationPrecision, "ESTIMATED" | "UNAVAILABLE">;
  readonly value: T;
}

export interface CalculationFailureResult extends CalculationMetadata {
  readonly ok: false;
  readonly error: CalculationError;
}

export type CalculationResult<T> = CalculationSuccess<T> | CalculationFailureResult;

export interface MetricValue {
  readonly value: string;
}

export interface FillInput {
  readonly closedPnl: string;
  readonly coin: string;
  readonly externalId: string;
  readonly fee: string;
  readonly occurredAt: string;
  readonly price: string;
  readonly side: "BUY" | "SELL";
  readonly size: string;
  readonly startPosition: string;
}

export interface FundingInput {
  readonly amount: string;
  readonly coin: string;
  readonly externalId: string;
  readonly occurredAt: string;
}

export interface CycleFill {
  readonly closedPnl: string;
  readonly entryPriceForPnl: string | null;
  readonly externalId: string;
  readonly fee: string;
  readonly occurredAt: string;
  readonly price: string;
  readonly role: "OPEN" | "CLOSE";
  readonly side: "BUY" | "SELL";
  readonly size: string;
}

export interface CycleFunding {
  readonly amount: string;
  readonly externalId: string;
  readonly occurredAt: string;
}

export interface CyclePnl {
  readonly fee: string;
  readonly fillRecomputedPnl: string;
  readonly funding: string;
  readonly grossRealizedPnl: string;
  readonly hyperliquidClosedPnl: string;
  readonly netRealizedPnl: string;
}

export interface PositionCycle {
  readonly averageEntryPrice: string;
  readonly closedAt: string | null;
  readonly coin: string;
  readonly completeness: DataCompleteness;
  readonly fills: readonly CycleFill[];
  readonly fundingEvents: readonly CycleFunding[];
  readonly id: string;
  readonly openedAt: string;
  readonly pnl: CyclePnl;
  readonly side: "LONG" | "SHORT";
  readonly status: "OPEN" | "CLOSED";
  readonly warnings: readonly CalculationWarning[];
}

export interface AggregatePnl {
  readonly fee: string;
  readonly fillRecomputedPnl: string;
  readonly funding: string;
  readonly grossRealizedPnl: string;
  readonly hyperliquidClosedPnl: string;
  readonly netRealizedPnl: string;
}

export interface NavSnapshotInput {
  readonly externalId: string;
  readonly nav: string;
  readonly occurredAt: string;
  readonly scope: "PERP" | "TOTAL";
}

export interface DailyNavPoint {
  readonly date: string;
  readonly nav: string;
  readonly navScope: "PERP_ACCOUNT_NAV" | "TOTAL_ACCOUNT_NAV";
  readonly occurredAt: string;
  readonly precision: "DERIVED";
}

export type CashFlowCategory =
  "deposit" | "withdrawal" | "bridge" | "transfer" | "reward" | "liquidation" | "unknown";

export interface CashFlowInput {
  readonly amount: string | null;
  readonly asset?: string | null;
  readonly boundary?: "EXTERNAL" | "INTERNAL" | "UNKNOWN";
  readonly counterparty?: string | null;
  readonly externalId: string;
  readonly fee?: string | null;
  readonly occurredAt: string;
  readonly rawPayload?: string | null;
  readonly type: string;
}

export interface StoredCashFlowInput {
  readonly amount: string | null;
  readonly rawPayload: string | null;
  readonly type: string;
  readonly walletAddress: string;
}

export interface StoredCashFlowClassification {
  readonly amount: string | null;
  readonly boundary: "EXTERNAL" | "INTERNAL" | "UNKNOWN";
}

export interface TradeHistoryPrefix {
  readonly coin: string;
  readonly skippedFillCount: number;
  readonly skippedFrom: string;
  readonly trustedFrom: string | null;
}

export interface TrustedTradeHistory {
  readonly fills: readonly FillInput[];
  readonly prefixes: readonly TradeHistoryPrefix[];
}

export interface NormalizedCashFlow {
  readonly amount: string | null;
  readonly category: CashFlowCategory;
  readonly externalId: string;
  readonly isExternal: boolean | null;
  readonly occurredAt: string;
}

export interface ReturnNavPoint {
  readonly boundary?: "REGULAR" | "FLOW_BEFORE" | "FLOW_AFTER";
  readonly cashFlowId?: string;
  readonly externalId: string;
  readonly nav: string;
  readonly occurredAt: string;
}

export interface ReturnPeriod {
  readonly beginningNav: string;
  readonly endingNav: string;
  readonly from: string;
  readonly return: string;
  readonly to: string;
}

export interface AnnualizedReturn {
  readonly evaluation: "REFERENCE_ONLY" | "STANDARD";
  readonly value: string;
}

export interface WealthPoint {
  readonly externalId: string;
  readonly nav: string;
  readonly occurredAt: string;
  readonly sequence?: number;
}

export interface DrawdownPoint {
  readonly drawdown: string;
  readonly nav: string;
  readonly occurredAt: string;
  readonly peakAt: string;
  readonly peakNav: string;
}

export interface MaxDrawdown {
  readonly drawdown: string;
  readonly durationDays: string;
  readonly peakAt: string;
  readonly peakNav: string;
  readonly recoveredAt: string | null;
  readonly recoveryDays: string | null;
  readonly troughAt: string;
  readonly troughNav: string;
}

export interface DailyReturnInput {
  readonly date: string;
  readonly value: string;
}

export interface AverageWinLoss {
  readonly averageLoss: string | null;
  readonly averageWin: string | null;
}

export interface TradeStatistics extends AverageWinLoss {
  readonly breakevenCount: number;
  readonly completedCycleCount: number;
  readonly lossCount: number;
  readonly maxLosingStreak: number;
  readonly profitFactor: string | null;
  readonly singleTradeProfitDependency: string | null;
  readonly winCount: number;
  readonly winRate: string;
}

export interface AccountSnapshotInput {
  readonly equity: string;
  readonly externalId: string;
  readonly grossNotional: string;
  readonly occurredAt: string;
}

export interface LeverageMetrics {
  readonly averageLeverage: string;
  readonly maxLeverage: string;
  readonly medianLeverage: string;
  readonly percentile95Leverage: string;
}

export interface PositionExposureInput {
  readonly coin: string;
  readonly notional: string;
}

export interface CoinExposure {
  readonly coin: string;
  readonly exposure: string;
  readonly share: string;
}

export interface CoinConcentration {
  readonly concentrationIndex: string;
  readonly exposureByCoin: readonly CoinExposure[];
  readonly largestCoinShare: string;
}
