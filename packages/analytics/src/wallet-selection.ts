import { Decimal } from "decimal.js";

export const WALLET_SELECTION_POLICY_VERSION = "wallet-selection-v1" as const;

export const DEFAULT_WALLET_SELECTION_POLICY: WalletSelectionPolicy = {
  policyVersion: WALLET_SELECTION_POLICY_VERSION,
  maxAutoSelected: 100,
  minimumEvaluationDays: 90,
  minimumTrustedClosedCycles: 20,
  minimumAnnualizedReturn: "0",
  maximumDrawdown: "0.5",
  maximumTopTradeContribution: "0.75",
  maximumDataAgeHours: 24,
};

export type WalletSelectionAutomaticStatus = "SELECTED" | "QUALIFIED" | "REVIEW" | "EXCLUDED";

export type WalletSelectionOverrideDecision = "AUTO" | "INCLUDE" | "EXCLUDE";

export type WalletSelectionReasonCode =
  | "NO_PERFORMANCE_V3"
  | "HISTORY_INCOMPLETE"
  | "EVALUATION_PERIOD_TOO_SHORT"
  | "TOO_FEW_COMPLETED_TRADES"
  | "REQUIRED_METRIC_MISSING"
  | "DATA_STALE"
  | "RETURN_BELOW_MINIMUM"
  | "DRAWDOWN_TOO_HIGH"
  | "PROFIT_TOO_CONCENTRATED";

export interface WalletSelectionPolicy {
  readonly policyVersion: typeof WALLET_SELECTION_POLICY_VERSION;
  readonly maxAutoSelected: number;
  readonly minimumEvaluationDays: number;
  readonly minimumTrustedClosedCycles: number;
  readonly minimumAnnualizedReturn: string;
  readonly maximumDrawdown: string;
  readonly maximumTopTradeContribution: string;
  readonly maximumDataAgeHours: number;
}

export interface WalletSelectionPerformanceInput {
  readonly runId: string;
  readonly calculationVersion: string;
  readonly historyCompleteness: string;
  readonly trustedClosedCycleCount: number;
  readonly annualizedReturn: string | null;
  readonly annualizedReturnCalculationFrom: string | null;
  readonly annualizedReturnCalculationTo: string | null;
  readonly cumulativeReturn?: string | null;
  readonly maxDrawdown: string | null;
  readonly profitFactor?: string | null;
  readonly topTradeContribution: string | null;
  readonly winRate?: string | null;
}

export interface WalletSelectionCandidateInput {
  readonly walletAddressId: string;
  readonly address: string;
  readonly lastSyncAt: string | null;
  readonly performance: WalletSelectionPerformanceInput | null;
}

export interface WalletSelectionResult {
  readonly walletAddressId: string;
  readonly address: string;
  readonly performanceRunId: string | null;
  readonly automaticStatus: WalletSelectionAutomaticStatus;
  readonly rank: number | null;
  readonly reasonCodes: readonly WalletSelectionReasonCode[];
}

export class WalletSelectionPolicyError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WalletSelectionPolicyError";
  }
}

const SelectionDecimal = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_EVEN,
});

const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

interface EvaluatedCandidate extends WalletSelectionResult {
  readonly annualizedReturn: Decimal | null;
  readonly maxDrawdownMagnitude: Decimal | null;
  readonly trustedClosedCycleCount: number;
}

export function validateWalletSelectionPolicy(
  policy: WalletSelectionPolicy,
): WalletSelectionPolicy {
  if (policy.policyVersion !== WALLET_SELECTION_POLICY_VERSION) {
    throw new WalletSelectionPolicyError("Unsupported wallet selection policy version.");
  }
  assertNonNegativeInteger(policy.maxAutoSelected, "maxAutoSelected");
  assertNonNegativeInteger(policy.minimumEvaluationDays, "minimumEvaluationDays");
  assertNonNegativeInteger(policy.minimumTrustedClosedCycles, "minimumTrustedClosedCycles");
  assertPositiveInteger(policy.maximumDataAgeHours, "maximumDataAgeHours");

  parsePolicyDecimal(policy.minimumAnnualizedReturn, "minimumAnnualizedReturn");
  const maximumDrawdown = parsePolicyDecimal(policy.maximumDrawdown, "maximumDrawdown");
  const maximumTopTradeContribution = parsePolicyDecimal(
    policy.maximumTopTradeContribution,
    "maximumTopTradeContribution",
  );
  if (maximumDrawdown.isNegative()) {
    throw new WalletSelectionPolicyError("maximumDrawdown must be zero or greater.");
  }
  if (maximumTopTradeContribution.isNegative()) {
    throw new WalletSelectionPolicyError("maximumTopTradeContribution must be zero or greater.");
  }
  return policy;
}

export function evaluateWalletSelection(
  candidates: readonly WalletSelectionCandidateInput[],
  policyInput: WalletSelectionPolicy,
  evaluatedAt: string,
): readonly WalletSelectionResult[] {
  const policy = validateWalletSelectionPolicy(policyInput);
  const evaluatedAtMs = parseDate(evaluatedAt);
  if (evaluatedAtMs === null) {
    throw new TypeError("evaluatedAt must be a valid date-time.");
  }

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
    .map<WalletSelectionResult>((candidate) => {
      const rank = ranks.get(candidate.walletAddressId) ?? null;
      const automaticStatus =
        rank !== null && rank <= policy.maxAutoSelected
          ? ("SELECTED" as const)
          : candidate.automaticStatus;
      return {
        address: candidate.address,
        automaticStatus,
        performanceRunId: candidate.performanceRunId,
        rank,
        reasonCodes: candidate.reasonCodes,
        walletAddressId: candidate.walletAddressId,
      };
    })
    .sort((left, right) => compareText(left.address, right.address));
}

export function effectiveWalletSelectionStatus(
  automaticStatus: WalletSelectionAutomaticStatus,
  decision: WalletSelectionOverrideDecision,
): WalletSelectionAutomaticStatus {
  if (decision === "INCLUDE") return "SELECTED";
  if (decision === "EXCLUDE") return "EXCLUDED";
  return automaticStatus;
}

export function isEffectivelySelected(
  automaticStatus: WalletSelectionAutomaticStatus,
  decision: WalletSelectionOverrideDecision,
): boolean {
  return effectiveWalletSelectionStatus(automaticStatus, decision) === "SELECTED";
}

function evaluateCandidate(
  candidate: WalletSelectionCandidateInput,
  policy: WalletSelectionPolicy,
  evaluatedAtMs: number,
): EvaluatedCandidate {
  const performance = candidate.performance;
  if (!performance || performance.calculationVersion !== "performance-v3") {
    return baseResult(candidate, null, "REVIEW", ["NO_PERFORMANCE_V3"]);
  }

  const annualizedReturn = parseMetricDecimal(performance.annualizedReturn);
  const maxDrawdown = parseMetricDecimal(performance.maxDrawdown);
  const topTradeContribution = parseMetricDecimal(performance.topTradeContribution);
  const reviewReasons: WalletSelectionReasonCode[] = [];

  if (performance.historyCompleteness !== "COMPLETE") {
    reviewReasons.push("HISTORY_INCOMPLETE");
  }
  if (
    annualizedReturn &&
    evaluationDays(
      performance.annualizedReturnCalculationFrom,
      performance.annualizedReturnCalculationTo,
    ) < policy.minimumEvaluationDays
  ) {
    reviewReasons.push("EVALUATION_PERIOD_TOO_SHORT");
  }
  if (performance.trustedClosedCycleCount < policy.minimumTrustedClosedCycles) {
    reviewReasons.push("TOO_FEW_COMPLETED_TRADES");
  }
  if (!annualizedReturn || !maxDrawdown || !topTradeContribution) {
    reviewReasons.push("REQUIRED_METRIC_MISSING");
  }
  if (isStale(candidate.lastSyncAt, policy.maximumDataAgeHours, evaluatedAtMs)) {
    reviewReasons.push("DATA_STALE");
  }

  if (reviewReasons.length > 0) {
    return baseResult(candidate, performance, "REVIEW", reviewReasons, {
      annualizedReturn,
      maxDrawdown,
    });
  }

  // Required metric validation above makes these values non-null.
  const validAnnualizedReturn = annualizedReturn!;
  const validMaxDrawdown = maxDrawdown!;
  const validTopTradeContribution = topTradeContribution!;
  const excludedReasons: WalletSelectionReasonCode[] = [];
  if (
    validAnnualizedReturn.lt(
      parsePolicyDecimal(policy.minimumAnnualizedReturn, "minimumAnnualizedReturn"),
    )
  ) {
    excludedReasons.push("RETURN_BELOW_MINIMUM");
  }
  if (validMaxDrawdown.abs().gt(parsePolicyDecimal(policy.maximumDrawdown, "maximumDrawdown"))) {
    excludedReasons.push("DRAWDOWN_TOO_HIGH");
  }
  if (
    validTopTradeContribution.gt(
      parsePolicyDecimal(policy.maximumTopTradeContribution, "maximumTopTradeContribution"),
    )
  ) {
    excludedReasons.push("PROFIT_TOO_CONCENTRATED");
  }

  return baseResult(
    candidate,
    performance,
    excludedReasons.length > 0 ? "EXCLUDED" : "QUALIFIED",
    excludedReasons,
    { annualizedReturn: validAnnualizedReturn, maxDrawdown: validMaxDrawdown },
  );
}

function baseResult(
  candidate: WalletSelectionCandidateInput,
  performance: WalletSelectionPerformanceInput | null,
  automaticStatus: Extract<WalletSelectionAutomaticStatus, "QUALIFIED" | "REVIEW" | "EXCLUDED">,
  reasonCodes: readonly WalletSelectionReasonCode[],
  metrics: {
    readonly annualizedReturn?: Decimal | null;
    readonly maxDrawdown?: Decimal | null;
  } = {},
): EvaluatedCandidate {
  return {
    address: candidate.address,
    annualizedReturn: metrics.annualizedReturn ?? null,
    automaticStatus,
    maxDrawdownMagnitude: metrics.maxDrawdown?.abs() ?? null,
    performanceRunId: performance?.runId ?? null,
    rank: null,
    reasonCodes,
    trustedClosedCycleCount: performance?.trustedClosedCycleCount ?? 0,
    walletAddressId: candidate.walletAddressId,
  };
}

function compareQualifiedCandidates(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  const returnComparison = right.annualizedReturn!.cmp(left.annualizedReturn!);
  if (returnComparison !== 0) return returnComparison;
  const drawdownComparison = left.maxDrawdownMagnitude!.cmp(right.maxDrawdownMagnitude!);
  if (drawdownComparison !== 0) return drawdownComparison;
  const cycleComparison = right.trustedClosedCycleCount - left.trustedClosedCycleCount;
  if (cycleComparison !== 0) return cycleComparison;
  return compareText(left.address, right.address);
}

function evaluationDays(from: string | null, to: string | null): number {
  const fromMs = parseDate(from);
  const toMs = parseDate(to);
  if (fromMs === null || toMs === null || toMs < fromMs) return -1;
  return Math.floor((toMs - fromMs) / 86_400_000);
}

function isStale(lastSyncAt: string | null, maximumAgeHours: number, nowMs: number): boolean {
  if (!lastSyncAt) return true;
  const lastSyncMs = parseDate(lastSyncAt);
  if (lastSyncMs === null) return true;
  return nowMs - lastSyncMs > maximumAgeHours * 3_600_000;
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
    throw new WalletSelectionPolicyError(`${field} must be a plain decimal string.`);
  }
  try {
    return new SelectionDecimal(value);
  } catch {
    throw new WalletSelectionPolicyError(`${field} must be a plain decimal string.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WalletSelectionPolicyError(`${field} must be a non-negative integer.`);
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new WalletSelectionPolicyError(`${field} must be a positive integer.`);
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
