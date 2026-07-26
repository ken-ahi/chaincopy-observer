export type EnrichmentStatus =
  "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "RATE_LIMITED";

export type CandidateFilterStatus =
  "PENDING" | "LIGHT_ELIGIBLE" | "INSUFFICIENT_HISTORY" | "ELIGIBLE" | "EXCLUDED" | "PROMOTED";

export interface DiscoveryCandidate {
  readonly activeDays: number;
  readonly activeHours: number;
  readonly address: string;
  readonly availableFrom: string | null;
  readonly availableTo: string | null;
  readonly averageTradeUsd: string;
  readonly buyCount: number;
  readonly coins: ReadonlyArray<string>;
  readonly dataQualityScore: number;
  readonly discoverySource: string;
  readonly distinctCoins: number;
  readonly enrichmentStatus: EnrichmentStatus;
  readonly estimatedNotionalUsd: string;
  readonly exclusionReasons: ReadonlyArray<string>;
  readonly filterStatus: CandidateFilterStatus;
  readonly firstSeenAt: string;
  readonly historyCompleteness: string;
  readonly historyTruncated: boolean;
  readonly id: string;
  readonly largestTradeUsd: string;
  readonly lastEnrichedAt: string | null;
  readonly lastSeenAt: string;
  readonly longRelatedCount: number;
  readonly makerCount: number;
  readonly promotedAt: string | null;
  readonly retrievedFillCount: number;
  readonly sellCount: number;
  readonly shortRelatedCount: number;
  readonly takerCount: number;
  readonly tradeCount: number;
  readonly truncationReason: string | null;
}

export interface DiscoveryCandidateDetail extends Omit<DiscoveryCandidate, "coins"> {
  readonly activityBuckets: ReadonlyArray<{
    readonly bucketStart: string;
    readonly period: string;
  }>;
  readonly coins: ReadonlyArray<{
    readonly coin: string;
    readonly firstSeenAt: string;
    readonly lastSeenAt: string;
    readonly tradeCount: number;
  }>;
  readonly enrichmentAttempts: ReadonlyArray<{
    readonly errorMessage: string | null;
    readonly finishedAt: string | null;
    readonly historyCompleteness: string;
    readonly historyTruncated: boolean;
    readonly requestedFrom: string;
    readonly requestedTo: string;
    readonly retrievedFillCount: number;
    readonly startedAt: string;
    readonly succeeded: boolean;
    readonly truncationReason: string | null;
  }>;
  readonly qualityIssues: ReadonlyArray<{
    readonly issueType: string;
    readonly lastDetectedAt: string;
    readonly message: string;
    readonly severity: string;
    readonly status: string;
  }>;
  readonly jobs: ReadonlyArray<{
    readonly errorMessage: string | null;
    readonly jobName: string;
    readonly status: string;
    readonly updatedAt: string;
  }>;
}

export interface DiscoverySettings {
  readonly enabled: boolean;
  readonly minimumObservedNotionalUsd: string;
  readonly minimumObservedTradeCount: number;
  readonly mode: "MAJOR" | "ALL";
  readonly priorityCoins: ReadonlyArray<string>;
  readonly recentActivityHours: number;
  readonly updatedAt: string;
}

export interface DiscoveryStats {
  readonly apiWeightUsed: number;
  readonly apiWeightWindowStartedAt: string | null;
  readonly discoveredAddresses: string;
  readonly duplicateTradeEvents: string;
  readonly enrichmentFailed: string;
  readonly enrichmentSucceeded: string;
  readonly enrichmentWaiting: number;
  readonly excluded: number;
  readonly filterPassed: number;
  readonly lastEventAt: string | null;
  readonly newCandidates: string;
  readonly openDataQualityIssues: number;
  readonly queueDepth: number;
  readonly receivedTradeEvents: string;
  readonly subscribedCoins: ReadonlyArray<string>;
  readonly websocketStatus: string;
}

export interface CandidatePage {
  readonly items: ReadonlyArray<DiscoveryCandidate>;
  readonly nextCursor: string | null;
}
