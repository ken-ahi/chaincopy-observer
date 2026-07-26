import { isHyperliquidAddress, type HyperliquidFill } from "@chaincopy/blockchain-adapters";
import { Prisma } from "@chaincopy/database";

const FinancialDecimal = Prisma.Decimal.clone({ precision: 80 });

export interface DiscoveryFilterSettings {
  readonly fullMinimumActiveDays: number;
  readonly fullMinimumActiveMonths: number;
  readonly fullMinimumNotionalUsd: string;
  readonly fullMinimumTradeCount: number;
  readonly fullRecentActivityDays: number;
  readonly minimumObservedNotionalUsd: string;
  readonly minimumObservedTradeCount: number;
  readonly recentActivityHours: number;
}

export interface LightweightCandidate {
  readonly address: string;
  readonly enrichmentStatus: string;
  readonly estimatedNotionalUsd: string;
  readonly lastSeenAt: Date;
  readonly nextEnrichmentAt: Date | null;
  readonly tradeCount: number;
}

export interface CandidateFilterResult {
  readonly eligible: boolean;
  readonly reasons: ReadonlyArray<string>;
  readonly status: "LIGHT_ELIGIBLE" | "EXCLUDED";
}

export interface EnrichedCandidateResult {
  readonly activeDays: number;
  readonly activeMonths: number;
  readonly availableFrom: Date | null;
  readonly availableTo: Date | null;
  readonly completeness: "COMPLETE" | "PARTIAL" | "INSUFFICIENT";
  readonly cumulativeNotionalUsd: string;
  readonly dataQualityScore: number;
  readonly reasons: ReadonlyArray<string>;
  readonly status: "ELIGIBLE" | "EXCLUDED" | "INSUFFICIENT_HISTORY";
}

export interface PositionRelationCounts {
  readonly longRelatedCount: number;
  readonly shortRelatedCount: number;
}

export function evaluateLightweightCandidate(
  candidate: LightweightCandidate,
  settings: DiscoveryFilterSettings,
  options: {
    readonly alreadyWatched: boolean;
    readonly knownSystemAddresses: ReadonlySet<string>;
    readonly now: Date;
  },
): CandidateFilterResult {
  const reasons: string[] = [];
  if (!isHyperliquidAddress(candidate.address)) {
    reasons.push("INVALID_EVM_ADDRESS");
  }
  if (options.knownSystemAddresses.has(candidate.address.toLowerCase())) {
    reasons.push("KNOWN_SYSTEM_ADDRESS");
  }
  if (options.alreadyWatched) {
    reasons.push("ALREADY_WATCHED_ADDRESS");
  }
  if (candidate.tradeCount < settings.minimumObservedTradeCount) {
    reasons.push("OBSERVED_TRADE_COUNT_BELOW_MINIMUM");
  }
  if (
    new FinancialDecimal(candidate.estimatedNotionalUsd).lessThan(
      settings.minimumObservedNotionalUsd,
    )
  ) {
    reasons.push("OBSERVED_NOTIONAL_BELOW_MINIMUM");
  }
  const recentBoundary = options.now.getTime() - settings.recentActivityHours * 60 * 60 * 1_000;
  if (candidate.lastSeenAt.getTime() < recentBoundary) {
    reasons.push("LAST_ACTIVITY_OUTSIDE_LIGHT_WINDOW");
  }

  return reasons.length === 0
    ? { eligible: true, reasons, status: "LIGHT_ELIGIBLE" }
    : { eligible: false, reasons, status: "EXCLUDED" };
}

export function evaluateEnrichedCandidate(
  fills: ReadonlyArray<HyperliquidFill>,
  historyTruncated: boolean,
  settings: DiscoveryFilterSettings,
  now: Date,
): EnrichedCandidateResult {
  const ordered = [...fills].sort((left, right) => left.time - right.time);
  const first = ordered[0];
  const last = ordered.at(-1);
  const availableFrom = first ? new Date(first.time) : null;
  const availableTo = last ? new Date(last.time) : null;
  const activeDays =
    first && last ? Math.floor((last.time - first.time) / (24 * 60 * 60 * 1_000)) + 1 : 0;
  const activeMonths = new Set(
    ordered.map((fill) => {
      const date = new Date(fill.time);
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    }),
  ).size;
  const cumulativeNotional = ordered.reduce(
    (total, fill) => total.plus(new FinancialDecimal(fill.px).mul(fill.sz).abs()),
    new FinancialDecimal(0),
  );
  const historyReasons: string[] = [];
  if (historyTruncated) {
    historyReasons.push("API_HISTORY_LIMIT_REACHED");
  }
  if (activeDays < settings.fullMinimumActiveDays) {
    historyReasons.push("AVAILABLE_ACTIVITY_PERIOD_BELOW_MINIMUM");
  }
  if (activeMonths < settings.fullMinimumActiveMonths) {
    historyReasons.push("AVAILABLE_ACTIVE_MONTHS_BELOW_MINIMUM");
  }

  if (historyReasons.length > 0) {
    return {
      activeDays,
      activeMonths,
      availableFrom,
      availableTo,
      completeness: historyTruncated ? "PARTIAL" : "INSUFFICIENT",
      cumulativeNotionalUsd: cumulativeNotional.toFixed(),
      dataQualityScore: calculateDataQualityScore({
        activeDays,
        endpointFailures: 0,
        fillCount: ordered.length,
        historyTruncated,
      }),
      reasons: historyReasons,
      status: "INSUFFICIENT_HISTORY",
    };
  }

  const reasons: string[] = [];
  if (ordered.length < settings.fullMinimumTradeCount) {
    reasons.push("FULL_TRADE_COUNT_BELOW_MINIMUM");
  }
  if (cumulativeNotional.lessThan(settings.fullMinimumNotionalUsd)) {
    reasons.push("FULL_NOTIONAL_BELOW_MINIMUM");
  }
  const recentBoundary = now.getTime() - settings.fullRecentActivityDays * 24 * 60 * 60 * 1_000;
  if (!last || last.time < recentBoundary) {
    reasons.push("LAST_ACTIVITY_OUTSIDE_FULL_WINDOW");
  }

  return {
    activeDays,
    activeMonths,
    availableFrom,
    availableTo,
    completeness: "COMPLETE",
    cumulativeNotionalUsd: cumulativeNotional.toFixed(),
    dataQualityScore: calculateDataQualityScore({
      activeDays,
      endpointFailures: 0,
      fillCount: ordered.length,
      historyTruncated,
    }),
    reasons,
    status: reasons.length === 0 ? "ELIGIBLE" : "EXCLUDED",
  };
}

export function countPositionRelatedFills(
  fills: ReadonlyArray<HyperliquidFill>,
): PositionRelationCounts {
  return fills.reduce<PositionRelationCounts>(
    (counts, fill) => {
      const direction = fill.dir.toLowerCase();
      return {
        longRelatedCount: counts.longRelatedCount + (direction.includes("long") ? 1 : 0),
        shortRelatedCount: counts.shortRelatedCount + (direction.includes("short") ? 1 : 0),
      };
    },
    { longRelatedCount: 0, shortRelatedCount: 0 },
  );
}

export function calculateDataQualityScore(input: {
  readonly activeDays: number;
  readonly endpointFailures: number;
  readonly fillCount: number;
  readonly historyTruncated: boolean;
}): number {
  let score = 100;
  if (input.historyTruncated) {
    score -= 30;
  }
  if (input.activeDays < 180) {
    score -= 30;
  }
  if (input.fillCount === 0) {
    score -= 30;
  }
  score -= Math.min(30, input.endpointFailures * 5);
  return Math.max(0, score);
}
