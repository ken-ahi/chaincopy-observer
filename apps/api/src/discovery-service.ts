import { normalizeHyperliquidAddress } from "@chaincopy/blockchain-adapters";
import type { Prisma, PrismaClient } from "@chaincopy/database";
import {
  hyperliquidDiscoveryJobNames,
  hyperliquidJobPriorities,
  type HyperliquidDiscoveryJobData,
} from "@chaincopy/domain";
import { type Queue } from "bullmq";

export class CandidateNotFoundError extends Error {
  public constructor(address: string) {
    super(`Hyperliquid discovery candidate ${address} was not found.`);
    this.name = "CandidateNotFoundError";
  }
}

export class CandidateActionConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CandidateActionConflictError";
  }
}

export interface CandidateListQuery {
  readonly cursor?: string;
  readonly enrichmentStatus?: string;
  readonly filterStatus?: string;
  readonly limit: number;
  readonly search?: string;
}

export interface DiscoverySettingsUpdate {
  readonly mode?: "MAJOR" | "ALL";
  readonly minimumObservedNotionalUsd?: string;
  readonly minimumObservedTradeCount?: number;
}

export interface DiscoveryService {
  listCandidates(query: CandidateListQuery): Promise<Readonly<Record<string, unknown>>>;
  getCandidate(address: string): Promise<Readonly<Record<string, unknown>>>;
  getSettings(): Promise<Readonly<Record<string, unknown>>>;
  updateSettings(input: DiscoverySettingsUpdate): Promise<Readonly<Record<string, unknown>>>;
  setEnabled(enabled: boolean): Promise<Readonly<Record<string, unknown>>>;
  getStats(): Promise<Readonly<Record<string, unknown>>>;
  enqueueEnrichment(address: string): Promise<Readonly<Record<string, unknown>>>;
  excludeCandidate(address: string): Promise<Readonly<Record<string, unknown>>>;
  enqueuePromotion(address: string): Promise<Readonly<Record<string, unknown>>>;
}

export class PrismaDiscoveryService implements DiscoveryService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly discoveryQueue: Queue<HyperliquidDiscoveryJobData>,
    private readonly candidateQueue: Queue<HyperliquidDiscoveryJobData>,
  ) {}

  public async listCandidates(
    query: CandidateListQuery,
  ): Promise<Readonly<Record<string, unknown>>> {
    const source = await this.ensureSource();
    const rows = await this.database.addressCandidate.findMany({
      include: {
        coins: {
          orderBy: { tradeCount: "desc" },
          select: { coin: true },
        },
      },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      where: {
        sourceId: source.id,
        ...(query.enrichmentStatus
          ? {
              enrichmentStatus: query.enrichmentStatus as
                "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "RATE_LIMITED",
            }
          : {}),
        ...(query.filterStatus
          ? {
              filterStatus: query.filterStatus as
                | "PENDING"
                | "LIGHT_ELIGIBLE"
                | "INSUFFICIENT_HISTORY"
                | "ELIGIBLE"
                | "EXCLUDED"
                | "PROMOTED",
            }
          : {}),
        ...(query.search
          ? { address: { contains: query.search, mode: "insensitive" as const } }
          : {}),
      },
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    return {
      items: page.map(toCandidateSummary),
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
    };
  }

  public async getCandidate(addressInput: string): Promise<Readonly<Record<string, unknown>>> {
    const address = normalizeHyperliquidAddress(addressInput);
    const candidate = await this.database.addressCandidate.findFirst({
      include: {
        activityBuckets: {
          orderBy: { bucketStart: "desc" },
          select: { bucketStart: true, period: true },
          take: 48,
        },
        coins: {
          orderBy: { tradeCount: "desc" },
          select: {
            coin: true,
            firstSeenAt: true,
            lastSeenAt: true,
            tradeCount: true,
          },
        },
        enrichmentAttempts: {
          orderBy: { startedAt: "desc" },
          select: {
            errorMessage: true,
            finishedAt: true,
            historyCompleteness: true,
            historyTruncated: true,
            requestedFrom: true,
            requestedTo: true,
            retrievedFillCount: true,
            startedAt: true,
            succeeded: true,
            truncationReason: true,
          },
          take: 10,
        },
        qualityIssues: {
          orderBy: { lastDetectedAt: "desc" },
          select: {
            issueType: true,
            lastDetectedAt: true,
            message: true,
            severity: true,
            status: true,
          },
        },
        syncJobs: {
          orderBy: { createdAt: "desc" },
          select: {
            errorMessage: true,
            jobName: true,
            status: true,
            updatedAt: true,
          },
          take: 20,
        },
      },
      where: {
        address,
        source: { kind: "HYPERLIQUID" },
      },
    });
    if (!candidate) {
      throw new CandidateNotFoundError(address);
    }
    return {
      ...toCandidateSummary(candidate),
      activityBuckets: candidate.activityBuckets.map((bucket) => ({
        bucketStart: bucket.bucketStart.toISOString(),
        period: bucket.period,
      })),
      coins: candidate.coins.map((coin) => ({
        ...coin,
        firstSeenAt: coin.firstSeenAt.toISOString(),
        lastSeenAt: coin.lastSeenAt.toISOString(),
      })),
      enrichmentAttempts: candidate.enrichmentAttempts.map((attempt) => ({
        ...attempt,
        finishedAt: attempt.finishedAt?.toISOString() ?? null,
        requestedFrom: attempt.requestedFrom.toISOString(),
        requestedTo: attempt.requestedTo.toISOString(),
        startedAt: attempt.startedAt.toISOString(),
      })),
      qualityIssues: candidate.qualityIssues.map((issue) => ({
        ...issue,
        lastDetectedAt: issue.lastDetectedAt.toISOString(),
      })),
      jobs: candidate.syncJobs.map((job) => ({
        ...job,
        updatedAt: job.updatedAt.toISOString(),
      })),
    };
  }

  public async getSettings(): Promise<Readonly<Record<string, unknown>>> {
    const settings = await this.ensureSettings();
    return toSettings(settings);
  }

  public async updateSettings(
    input: DiscoverySettingsUpdate,
  ): Promise<Readonly<Record<string, unknown>>> {
    const source = await this.ensureSource();
    await this.ensureSettings();
    const settings = await this.database.discoverySettings.update({
      data: {
        ...(input.mode ? { mode: input.mode } : {}),
        ...(input.minimumObservedNotionalUsd
          ? { minimumObservedNotionalUsd: input.minimumObservedNotionalUsd }
          : {}),
        ...(input.minimumObservedTradeCount !== undefined
          ? { minimumObservedTradeCount: input.minimumObservedTradeCount }
          : {}),
      },
      where: { sourceId: source.id },
    });
    return toSettings(settings);
  }

  public async setEnabled(enabled: boolean): Promise<Readonly<Record<string, unknown>>> {
    const source = await this.ensureSource();
    await this.ensureSettings();
    const settings = await this.database.discoverySettings.update({
      data: { enabled },
      where: { sourceId: source.id },
    });
    return toSettings(settings);
  }

  public async getStats(): Promise<Readonly<Record<string, unknown>>> {
    const source = await this.ensureSource();
    const [
      stats,
      enrichmentWaiting,
      filterPassed,
      excluded,
      discoveryQueueCounts,
      candidateQueueCounts,
      openIssues,
    ] = await Promise.all([
      this.database.discoveryStats.upsert({
        create: { sourceId: source.id },
        update: {},
        where: { sourceId: source.id },
      }),
      this.database.addressCandidate.count({
        where: { enrichmentStatus: { in: ["QUEUED", "RUNNING"] }, sourceId: source.id },
      }),
      this.database.addressCandidate.count({
        where: { filterStatus: { in: ["ELIGIBLE", "PROMOTED"] }, sourceId: source.id },
      }),
      this.database.addressCandidate.count({
        where: { filterStatus: "EXCLUDED", sourceId: source.id },
      }),
      this.discoveryQueue.getJobCounts("waiting", "active", "delayed", "prioritized", "failed"),
      this.candidateQueue.getJobCounts("waiting", "active", "delayed", "prioritized", "failed"),
      this.database.discoveryDataQualityIssue.count({
        where: { sourceId: source.id, status: "OPEN" },
      }),
    ]);
    return {
      apiWeightUsed: stats.apiWeightUsed,
      apiWeightWindowStartedAt: stats.apiWeightWindowStartedAt?.toISOString() ?? null,
      discoveredAddresses: stats.discoveredAddresses.toString(),
      duplicateTradeEvents: stats.duplicateTradeEvents.toString(),
      enrichmentFailed: stats.enrichmentFailed.toString(),
      enrichmentSucceeded: stats.enrichmentSucceeded.toString(),
      enrichmentWaiting,
      excluded,
      filterPassed,
      lastEventAt: stats.lastEventAt?.toISOString() ?? null,
      newCandidates: stats.newCandidates.toString(),
      openDataQualityIssues: openIssues,
      queue: mergeQueueCounts(discoveryQueueCounts, candidateQueueCounts),
      queueDepth: pendingQueueDepth(discoveryQueueCounts) + pendingQueueDepth(candidateQueueCounts),
      queues: {
        candidateEnrichment: candidateQueueCounts,
        discovery: discoveryQueueCounts,
      },
      receivedTradeEvents: stats.receivedTradeEvents.toString(),
      subscribedCoins: stats.subscribedCoins,
      websocketStatus: stats.websocketStatus,
    };
  }

  public async enqueueEnrichment(addressInput: string): Promise<Readonly<Record<string, unknown>>> {
    const candidate = await this.findCandidate(addressInput);
    const now = new Date();
    if (candidate.nextEnrichmentAt && candidate.nextEnrichmentAt > now) {
      throw new CandidateActionConflictError(
        `Enrichment is limited until ${candidate.nextEnrichmentAt.toISOString()}.`,
      );
    }
    if (candidate.promotedAt) {
      throw new CandidateActionConflictError("A promoted candidate uses monitored-address sync.");
    }
    if (candidate.exclusionReasons.includes("MANUALLY_EXCLUDED")) {
      throw new CandidateActionConflictError("A manually excluded candidate cannot be enriched.");
    }
    const reserved = await this.database.addressCandidate.updateMany({
      data: { enrichmentStatus: "QUEUED" },
      where: {
        id: candidate.id,
        enrichmentStatus: { notIn: ["QUEUED", "RUNNING"] },
      },
    });
    if (reserved.count !== 1) {
      throw new CandidateActionConflictError("Candidate enrichment is already queued or running.");
    }
    const requestedFrom = new Date(now);
    requestedFrom.setUTCFullYear(requestedFrom.getUTCFullYear() - 5);
    const jobId = `enrich-${candidate.id}-${requestedFrom.getTime()}-${now.getTime()}`;
    try {
      const job = await this.candidateQueue.add(
        hyperliquidDiscoveryJobNames.candidateEnrichment,
        {
          address: candidate.address,
          automatic: false,
          candidateId: candidate.id,
          kind: "candidate",
          requestedAt: now.toISOString(),
          requestedFrom: requestedFrom.toISOString(),
          requestedTo: now.toISOString(),
        },
        discoveryJobOptions(jobId, hyperliquidJobPriorities.candidateEnrichment),
      );
      return { jobId: job.id ?? jobId, status: "QUEUED" };
    } catch (error) {
      await this.database.addressCandidate.update({
        data: { enrichmentStatus: candidate.enrichmentStatus },
        where: { id: candidate.id },
      });
      throw error;
    }
  }

  public async excludeCandidate(addressInput: string): Promise<Readonly<Record<string, unknown>>> {
    const candidate = await this.findCandidate(addressInput);
    if (candidate.promotedAt) {
      throw new CandidateActionConflictError("A promoted candidate cannot be excluded.");
    }
    const updated = await this.database.addressCandidate.update({
      data: {
        exclusionReasons: ["MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      },
      where: { id: candidate.id },
    });
    return toCandidateSummary(updated);
  }

  public async enqueuePromotion(addressInput: string): Promise<Readonly<Record<string, unknown>>> {
    const candidate = await this.findCandidate(addressInput);
    if (candidate.filterStatus !== "ELIGIBLE") {
      throw new CandidateActionConflictError(
        "Only a fully enriched eligible candidate can be promoted.",
      );
    }
    const jobId = `promote-${candidate.id}`;
    const job = await this.discoveryQueue.add(
      hyperliquidDiscoveryJobNames.candidatePromotion,
      {
        address: candidate.address,
        automatic: false,
        candidateId: candidate.id,
        kind: "candidate",
        requestedAt: new Date().toISOString(),
      },
      discoveryJobOptions(jobId, hyperliquidJobPriorities.candidateEnrichment),
    );
    return { jobId: job.id ?? jobId, status: "QUEUED" };
  }

  private async ensureSource() {
    return this.database.dataSource.upsert({
      create: {
        enabled: true,
        key: "hyperliquid-mainnet",
        kind: "HYPERLIQUID",
        name: "Hyperliquid Mainnet",
      },
      update: { enabled: true },
      where: { key: "hyperliquid-mainnet" },
    });
  }

  private async ensureSettings() {
    const source = await this.ensureSource();
    return this.database.discoverySettings.upsert({
      create: { sourceId: source.id },
      update: {},
      where: { sourceId: source.id },
    });
  }

  private async findCandidate(addressInput: string) {
    const address = normalizeHyperliquidAddress(addressInput);
    const candidate = await this.database.addressCandidate.findFirst({
      where: {
        address,
        source: { kind: "HYPERLIQUID" },
      },
    });
    if (!candidate) {
      throw new CandidateNotFoundError(address);
    }
    return candidate;
  }
}

function toCandidateSummary(candidate: {
  readonly activeDays: number;
  readonly activeHours: number;
  readonly address: string;
  readonly availableFrom: Date | null;
  readonly availableTo: Date | null;
  readonly averageTradeUsd: Prisma.Decimal;
  readonly buyCount: number;
  readonly coins?: ReadonlyArray<{ readonly coin: string }>;
  readonly dataQualityScore: number;
  readonly discoverySource: string;
  readonly distinctCoins: number;
  readonly enrichmentStatus: string;
  readonly estimatedNotionalUsd: Prisma.Decimal;
  readonly exclusionReasons: ReadonlyArray<string>;
  readonly filterStatus: string;
  readonly firstSeenAt: Date;
  readonly historyCompleteness: string;
  readonly historyTruncated: boolean;
  readonly id: string;
  readonly largestTradeUsd: Prisma.Decimal;
  readonly lastEnrichedAt: Date | null;
  readonly lastSeenAt: Date;
  readonly longRelatedCount: number;
  readonly makerCount: number;
  readonly promotedAt: Date | null;
  readonly retrievedFillCount: number;
  readonly sellCount: number;
  readonly shortRelatedCount: number;
  readonly takerCount: number;
  readonly tradeCount: number;
  readonly truncationReason: string | null;
}) {
  return {
    activeDays: candidate.activeDays,
    activeHours: candidate.activeHours,
    address: candidate.address,
    availableFrom: candidate.availableFrom?.toISOString() ?? null,
    availableTo: candidate.availableTo?.toISOString() ?? null,
    averageTradeUsd: candidate.averageTradeUsd.toFixed(),
    buyCount: candidate.buyCount,
    coins: candidate.coins?.map((coin) => coin.coin) ?? [],
    dataQualityScore: candidate.dataQualityScore,
    discoverySource: candidate.discoverySource,
    distinctCoins: candidate.distinctCoins,
    enrichmentStatus: candidate.enrichmentStatus,
    estimatedNotionalUsd: candidate.estimatedNotionalUsd.toFixed(),
    exclusionReasons: candidate.exclusionReasons,
    filterStatus: candidate.filterStatus,
    firstSeenAt: candidate.firstSeenAt.toISOString(),
    historyCompleteness: candidate.historyCompleteness,
    historyTruncated: candidate.historyTruncated,
    id: candidate.id,
    largestTradeUsd: candidate.largestTradeUsd.toFixed(),
    lastEnrichedAt: candidate.lastEnrichedAt?.toISOString() ?? null,
    lastSeenAt: candidate.lastSeenAt.toISOString(),
    longRelatedCount: candidate.longRelatedCount,
    makerCount: candidate.makerCount,
    promotedAt: candidate.promotedAt?.toISOString() ?? null,
    retrievedFillCount: candidate.retrievedFillCount,
    sellCount: candidate.sellCount,
    shortRelatedCount: candidate.shortRelatedCount,
    takerCount: candidate.takerCount,
    tradeCount: candidate.tradeCount,
    truncationReason: candidate.truncationReason,
  };
}

function toSettings(settings: {
  readonly enabled: boolean;
  readonly minimumObservedNotionalUsd: Prisma.Decimal;
  readonly minimumObservedTradeCount: number;
  readonly mode: string;
  readonly priorityCoins: ReadonlyArray<string>;
  readonly recentActivityHours: number;
  readonly updatedAt: Date;
}) {
  return {
    enabled: settings.enabled,
    minimumObservedNotionalUsd: settings.minimumObservedNotionalUsd.toFixed(),
    minimumObservedTradeCount: settings.minimumObservedTradeCount,
    mode: settings.mode,
    priorityCoins: settings.priorityCoins,
    recentActivityHours: settings.recentActivityHours,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function discoveryJobOptions(jobId: string, priority: number) {
  return {
    attempts: 5,
    backoff: { delay: 1_000, type: "exponential" as const },
    jobId,
    priority,
    removeOnComplete: { age: 24 * 60 * 60, count: 20_000 },
    removeOnFail: { age: 7 * 24 * 60 * 60, count: 20_000 },
  };
}

function mergeQueueCounts(
  first: Readonly<Record<string, number>>,
  second: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    [...new Set([...Object.keys(first), ...Object.keys(second)])].map((key) => [
      key,
      (first[key] ?? 0) + (second[key] ?? 0),
    ]),
  );
}

function pendingQueueDepth(counts: Readonly<Record<string, number>>): number {
  return ["waiting", "active", "delayed", "prioritized"].reduce(
    (total, state) => total + (counts[state] ?? 0),
    0,
  );
}
