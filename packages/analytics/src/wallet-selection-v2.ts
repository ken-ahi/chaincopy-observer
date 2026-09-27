import { Decimal } from "decimal.js";

import {
  type WalletSelectionAutomaticStatus,
  type WalletSelectionOverrideDecision,
} from "./wallet-selection.js";

export const WALLET_SELECTION_V2_POLICY_VERSION = "wallet-selection-v2" as const;
export const TRADE_HISTORY_EVALUABILITY_VERSION = "closed-position-cycle-v1" as const;

export const DEFAULT_WALLET_SELECTION_V2_POLICY: WalletSelectionV2Policy = {
  policyVersion: WALLET_SELECTION_V2_POLICY_VERSION,
  tradeHistoryEvaluabilityVersion: TRADE_HISTORY_EVALUABILITY_VERSION,
  maxAutoSelected: 100,
  minimumTrustedClosedCycles: 30,
  minimumWinRate: "0.55",
  minimumProfitFactor: "1",
  maximumTopTradeContribution: "0.5",
  maximumDataAgeHours: 24,
};

export const WALLET_SELECTION_V2_REQUIRED_METRICS = [
  "averageLoss",
  "averageWin",
  "maxLosingStreak",
  "profitFactor",
  "topTradeContribution",
  "winRate",
] as const;

export type WalletSelectionV2ReasonCode =
  | "NO_PERFORMANCE_V3"
  | "TRADE_HISTORY_NOT_EVALUABLE"
  | "TOO_FEW_COMPLETED_TRADES"
  | "REQUIRED_METRIC_MISSING"
  | "REQUIRED_METRIC_INVALID"
  | "DATA_STALE"
  | "WIN_RATE_BELOW_MINIMUM"
  | "PROFIT_FACTOR_BELOW_MINIMUM"
  | "PROFIT_TOO_CONCENTRATED";

export interface WalletSelectionV2Policy {
  readonly policyVersion: typeof WALLET_SELECTION_V2_POLICY_VERSION;
  readonly tradeHistoryEvaluabilityVersion: typeof TRADE_HISTORY_EVALUABILITY_VERSION;
  readonly maxAutoSelected: number;
  readonly minimumTrustedClosedCycles: number;
  readonly minimumWinRate: string;
  readonly minimumProfitFactor: string;
  readonly maximumTopTradeContribution: string;
  readonly maximumDataAgeHours: number;
}

export interface WalletSelectionV2PerformanceInput {
  readonly runId: string;
  readonly calculationVersion: string;
  readonly tradeHistoryEvaluable: boolean;
  readonly trustedClosedCycleCount: number;
  readonly winRate: string | null;
  readonly profitFactor: string | null;
  readonly averageWin: string | null;
  readonly averageLoss: string | null;
  readonly maxLosingStreak: string | null;
  readonly topTradeContribution: string | null;
}

export interface WalletSelectionV2CandidateInput {
  readonly walletAddressId: string;
  readonly address: string;
  readonly lastSyncAt: string | null;
  readonly performance: WalletSelectionV2PerformanceInput | null;
}

export interface WalletSelectionV2Result {
  readonly walletAddressId: string;
  readonly address: string;
  readonly performanceRunId: string | null;
  readonly automaticStatus: WalletSelectionAutomaticStatus;
  readonly rank: number | null;
  readonly reasonCodes: readonly WalletSelectionV2ReasonCode[];
}

export class WalletSelectionV2PolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WalletSelectionV2PolicyError";
  }
}

const SelectionDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

interface EvaluatedCandidate extends WalletSelectionV2Result {
  readonly trustedClosedCycleCount: number;
  readonly winRate: Decimal | null;
  readonly profitFactor: Decimal | null;
  readonly topTradeContribution: Decimal | null;
}

export function validateWalletSelectionV2Policy(
  policy: WalletSelectionV2Policy,
): WalletSelectionV2Policy {
  if (policy.policyVersion !== WALLET_SELECTION_V2_POLICY_VERSION) {
    throw new WalletSelectionV2PolicyError("Unsupported wallet selection v2 policy version.");
  }
  if (policy.tradeHistoryEvaluabilityVersion !== TRADE_HISTORY_EVALUABILITY_VERSION) {
    throw new WalletSelectionV2PolicyError("Unsupported trade-history evaluability version.");
  }
  assertNonNegativeInteger(policy.maxAutoSelected, "maxAutoSelected");
  assertPositiveInteger(policy.minimumTrustedClosedCycles, "minimumTrustedClosedCycles");
  assertPositiveInteger(policy.maximumDataAgeHours, "maximumDataAgeHours");
  const minimumWinRate = parsePolicyDecimal(policy.minimumWinRate, "minimumWinRate");
  const minimumProfitFactor = parsePolicyDecimal(policy.minimumProfitFactor, "minimumProfitFactor");
  const maximumTopTradeContribution = parsePolicyDecimal(
    policy.maximumTopTradeContribution,
    "maximumTopTradeContribution",
  );
  if (minimumWinRate.lt(0) || minimumWinRate.gt(1)) {
    throw new WalletSelectionV2PolicyError("minimumWinRate must be between zero and one.");
  }
  if (minimumProfitFactor.lt(0)) {
    throw new WalletSelectionV2PolicyError("minimumProfitFactor must be zero or greater.");
  }
  if (maximumTopTradeContribution.lt(0) || maximumTopTradeContribution.gt(1)) {
    throw new WalletSelectionV2PolicyError(
      "maximumTopTradeContribution must be between zero and one.",
    );
  }
  return policy;
}

export function evaluateWalletSelectionV2(
  candidates: readonly WalletSelectionV2CandidateInput[],
  policyInput: WalletSelectionV2Policy,
  evaluatedAt: string,
): readonly WalletSelectionV2Result[] {
  const policy = validateWalletSelectionV2Policy(policyInput);
  const evaluatedAtMs = parseDate(evaluatedAt);
  if (evaluatedAtMs === null) throw new TypeError("evaluatedAt must be a valid date-time.");

  const evaluated = candidates.map((candidate) =>
    evaluateCandidate(candidate, policy, evaluatedAtMs),
  );
  const qualified = evaluated
    .filter((candidate) => candidate.automaticStatus === "QUALIFIED")
    .sort(compareQualifiedCandidates);
  const ranks = new Map<string, number>();
  for (const [index, candidate] of qualified.entries()) {
    ranks.set(candidate.walletAddressId, index + 1);
  }

  return evaluated
    .map<WalletSelectionV2Result>((candidate) => {
      const rank = ranks.get(candidate.walletAddressId) ?? null;
      return {
        address: candidate.address,
        automaticStatus:
          rank !== null && rank <= policy.maxAutoSelected
            ? ("SELECTED" as const)
            : candidate.automaticStatus,
        performanceRunId: candidate.performanceRunId,
        rank,
        reasonCodes: candidate.reasonCodes,
        walletAddressId: candidate.walletAddressId,
      };
    })
    .sort((left, right) => compareText(left.address, right.address));
}

export function isEffectivelySelectedV2(
  automaticStatus: WalletSelectionAutomaticStatus,
  decision: WalletSelectionOverrideDecision,
): boolean {
  return automaticStatus === "SELECTED" && decision !== "EXCLUDE";
}

function evaluateCandidate(
  candidate: WalletSelectionV2CandidateInput,
  policy: WalletSelectionV2Policy,
  evaluatedAtMs: number,
): EvaluatedCandidate {
  const performance = candidate.performance;
  if (!performance || performance.calculationVersion !== "performance-v3") {
    return baseResult(candidate, null, "REVIEW", ["NO_PERFORMANCE_V3"]);
  }

  const parsed = parseMetrics(performance);
  const reviewReasons: WalletSelectionV2ReasonCode[] = [];
  if (!performance.tradeHistoryEvaluable) reviewReasons.push("TRADE_HISTORY_NOT_EVALUABLE");
  if (performance.trustedClosedCycleCount < policy.minimumTrustedClosedCycles) {
    reviewReasons.push("TOO_FEW_COMPLETED_TRADES");
  }
  if (parsed.missing) reviewReasons.push("REQUIRED_METRIC_MISSING");
  else if (!parsed.valid) reviewReasons.push("REQUIRED_METRIC_INVALID");
  if (isStale(candidate.lastSyncAt, policy.maximumDataAgeHours, evaluatedAtMs)) {
    reviewReasons.push("DATA_STALE");
  }
  if (reviewReasons.length > 0) {
    return baseResult(candidate, performance, "REVIEW", reviewReasons, parsed);
  }

  const winRate = parsed.winRate!;
  const profitFactor = parsed.profitFactor!;
  const topTradeContribution = parsed.topTradeContribution!;
  const excludedReasons: WalletSelectionV2ReasonCode[] = [];
  if (winRate.lt(parsePolicyDecimal(policy.minimumWinRate, "minimumWinRate"))) {
    excludedReasons.push("WIN_RATE_BELOW_MINIMUM");
  }
  if (profitFactor.lt(parsePolicyDecimal(policy.minimumProfitFactor, "minimumProfitFactor"))) {
    excludedReasons.push("PROFIT_FACTOR_BELOW_MINIMUM");
  }
  if (
    topTradeContribution.gt(
      parsePolicyDecimal(policy.maximumTopTradeContribution, "maximumTopTradeContribution"),
    )
  ) {
    excludedReasons.push("PROFIT_TOO_CONCENTRATED");
  }
  return baseResult(
    candidate,
    performance,
    excludedReasons.length === 0 ? "QUALIFIED" : "EXCLUDED",
    excludedReasons,
    parsed,
  );
}

function parseMetrics(performance: WalletSelectionV2PerformanceInput): {
  readonly averageLoss: Decimal | null;
  readonly averageWin: Decimal | null;
  readonly maxLosingStreak: Decimal | null;
  readonly missing: boolean;
  readonly valid: boolean;
  readonly profitFactor: Decimal | null;
  readonly topTradeContribution: Decimal | null;
  readonly winRate: Decimal | null;
} {
  const values = {
    averageLoss: parseMetricDecimal(performance.averageLoss),
    averageWin: parseMetricDecimal(performance.averageWin),
    maxLosingStreak: parseMetricDecimal(performance.maxLosingStreak),
    profitFactor: parseMetricDecimal(performance.profitFactor),
    topTradeContribution: parseMetricDecimal(performance.topTradeContribution),
    winRate: parseMetricDecimal(performance.winRate),
  };
  const missing = [
    performance.averageLoss,
    performance.averageWin,
    performance.maxLosingStreak,
    performance.profitFactor,
    performance.topTradeContribution,
    performance.winRate,
  ].some((value) => value === null);
  const allParsed = Object.values(values).every((value) => value !== null);
  const valid =
    allParsed &&
    values.averageLoss!.lt(0) &&
    values.averageWin!.gt(0) &&
    values.maxLosingStreak!.isInteger() &&
    values.maxLosingStreak!.gte(0) &&
    values.profitFactor!.gte(0) &&
    values.topTradeContribution!.gte(0) &&
    values.topTradeContribution!.lte(1) &&
    values.winRate!.gte(0) &&
    values.winRate!.lte(1);
  return { ...values, missing, valid };
}

function baseResult(
  candidate: WalletSelectionV2CandidateInput,
  performance: WalletSelectionV2PerformanceInput | null,
  automaticStatus: Extract<WalletSelectionAutomaticStatus, "QUALIFIED" | "REVIEW" | "EXCLUDED">,
  reasonCodes: readonly WalletSelectionV2ReasonCode[],
  metrics: {
    readonly winRate?: Decimal | null;
    readonly profitFactor?: Decimal | null;
    readonly topTradeContribution?: Decimal | null;
  } = {},
): EvaluatedCandidate {
  return {
    address: candidate.address,
    automaticStatus,
    performanceRunId: performance?.runId ?? null,
    profitFactor: metrics.profitFactor ?? null,
    rank: null,
    reasonCodes,
    topTradeContribution: metrics.topTradeContribution ?? null,
    trustedClosedCycleCount: performance?.trustedClosedCycleCount ?? 0,
    walletAddressId: candidate.walletAddressId,
    winRate: metrics.winRate ?? null,
  };
}

function compareQualifiedCandidates(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  const winRateComparison = right.winRate!.cmp(left.winRate!);
  if (winRateComparison !== 0) return winRateComparison;
  const cycleComparison = right.trustedClosedCycleCount - left.trustedClosedCycleCount;
  if (cycleComparison !== 0) return cycleComparison;
  const profitFactorComparison = right.profitFactor!.cmp(left.profitFactor!);
  if (profitFactorComparison !== 0) return profitFactorComparison;
  const concentrationComparison = left.topTradeContribution!.cmp(right.topTradeContribution!);
  if (concentrationComparison !== 0) return concentrationComparison;
  return compareText(left.address, right.address);
}

function isStale(lastSyncAt: string | null, maximumAgeHours: number, nowMs: number): boolean {
  if (!lastSyncAt) return true;
  const lastSyncMs = parseDate(lastSyncAt);
  return (
    lastSyncMs === null || lastSyncMs > nowMs || nowMs - lastSyncMs > maximumAgeHours * 3_600_000
  );
}

function parseDate(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMetricDecimal(value: string | null): Decimal | null {
  if (value === null || !decimalPattern.test(value)) return null;
  try {
    return new SelectionDecimal(value);
  } catch {
    return null;
  }
}

function parsePolicyDecimal(value: string, field: string): Decimal {
  if (!decimalPattern.test(value)) {
    throw new WalletSelectionV2PolicyError(`${field} must be a plain decimal string.`);
  }
  try {
    return new SelectionDecimal(value);
  } catch {
    throw new WalletSelectionV2PolicyError(`${field} must be a plain decimal string.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WalletSelectionV2PolicyError(`${field} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WalletSelectionV2PolicyError(`${field} must be a positive integer.`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
