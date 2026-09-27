export const ANALYTICS_IMPLEMENTATION_PHASE = 4 as const;

export {
  BEHAVIOR_VERSION,
  behaviorEventFingerprint,
  canonicalDecimal,
  normalizeTimestampGroup,
  signedQuantityDelta,
} from "./behavior-normalization.js";
export type {
  BehaviorDirection,
  BehaviorEventType,
  BehaviorFailureReason,
  BehaviorFillInput,
  BehaviorGroupResult,
  BehaviorMarketProvenance,
  SelectedWalletBehaviorEventValue,
} from "./behavior-normalization.js";

export { parseDecimalString } from "./core.js";
export {
  calculateCoinConcentration,
  calculateEffectiveLeverage,
  calculateLeverageMetrics,
} from "./leverage.js";
export {
  analyzeTrustedTradeHistory,
  buildPositionCycles,
  calculateAggregatePnl,
  calculateCyclePnl,
} from "./position-cycles.js";
export {
  calculateCalmar,
  calculateDrawdownSeries,
  calculateMaxDrawdown,
  calculateSharpe,
  calculateSortino,
  calculateVolatility,
} from "./risk.js";
export {
  buildTwrWealthIndex,
  calculateAnnualizedReturn,
  calculateCumulativeReturn,
  calculateDailyNav,
  calculateTwr,
  classifyCashFlowInput,
  classifyStoredCashFlowInput,
  normalizeCashFlows,
  splitReturnPeriodsAtCashFlows,
} from "./returns.js";
export {
  calculateAverageWinLoss,
  calculateMaxLosingStreak,
  calculateProfitDependency,
  calculateProfitFactor,
  calculateTradeStatistics,
  calculateWinRate,
} from "./trade-statistics.js";
export {
  DEFAULT_WALLET_SELECTION_POLICY,
  effectiveWalletSelectionStatus,
  evaluateWalletSelection,
  isEffectivelySelected,
  validateWalletSelectionPolicy,
  WALLET_SELECTION_POLICY_VERSION,
  WalletSelectionPolicyError,
} from "./wallet-selection.js";
export type {
  WalletSelectionAutomaticStatus,
  WalletSelectionCandidateInput,
  WalletSelectionOverrideDecision,
  WalletSelectionPerformanceInput,
  WalletSelectionPolicy,
  WalletSelectionReasonCode,
  WalletSelectionResult,
} from "./wallet-selection.js";
export {
  DEFAULT_WALLET_SELECTION_V2_POLICY,
  evaluateWalletSelectionV2,
  isEffectivelySelectedV2,
  TRADE_HISTORY_EVALUABILITY_VERSION,
  validateWalletSelectionV2Policy,
  WALLET_SELECTION_V2_POLICY_VERSION,
  WALLET_SELECTION_V2_REQUIRED_METRICS,
  WalletSelectionV2PolicyError,
} from "./wallet-selection-v2.js";
export type {
  WalletSelectionV2CandidateInput,
  WalletSelectionV2PerformanceInput,
  WalletSelectionV2Policy,
  WalletSelectionV2ReasonCode,
  WalletSelectionV2Result,
} from "./wallet-selection-v2.js";
export type * from "./types.js";
export * from "./behavior-aggregation.js";
