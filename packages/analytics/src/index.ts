export const ANALYTICS_IMPLEMENTATION_PHASE = 4 as const;

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
export type * from "./types.js";
