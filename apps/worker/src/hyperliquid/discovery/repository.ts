import { createHash } from "node:crypto";

import { normalizeHyperliquidAddress, type RateLimiterUsage } from "@chaincopy/blockchain-adapters";
import {
  Prisma,
  type CandidateFilterStatus,
  type CandidateHistoryCompleteness,
  type DiscoveryConnectionStatus,
  type DiscoveryMode,
  type PrismaClient,
} from "@chaincopy/database";
import { type DiscoveryMarketTradeData } from "@chaincopy/domain";

import {
  calculateDataQualityScore,
  type DiscoveryFilterSettings,
  type EnrichedCandidateResult,
} from "./filter.js";

const FinancialDecimal = Prisma.Decimal.clone({ precision: 80 });

export interface DiscoveryDefaults {
  readonly enabled: boolean;
  readonly minimumEnrichmentIntervalMin: number;
  readonly minimumObservedNotionalUsd: string;
  readonly minimumObservedTradeCount: number;
  readonly mode: DiscoveryMode;
  readonly priorityCoins: ReadonlyArray<string>;
  readonly recentActivityHours: number;
}

export interface CandidateReference {
  readonly address: string;
  readonly filterReady: boolean;
  readonly id: string;
  readonly tradeCount: number;
}

export interface CandidateFilterContext {
  readonly candidate: {
    readonly address: string;
    readonly enrichmentStatus: string;
    readonly estimatedNotionalUsd: string;
    readonly exclusionReasons: ReadonlyArray<string>;
    readonly filterStatus: CandidateFilterStatus;
    readonly id: string;
    readonly lastSeenAt: Date;
    readonly nextEnrichmentAt: Date | null;
    readonly tradeCount: number;
  };
  readonly settings: DiscoveryFilterSettings & {
    readonly minimumEnrichmentIntervalMin: number;
  };
  readonly watched: boolean;
}

export interface EnrichmentStart {
  readonly address: string;
  readonly attemptId: string;
  readonly candidateId: string;
  readonly settings: DiscoveryFilterSettings & {
    readonly minimumEnrichmentIntervalMin: number;
  };
}

export interface CandidateEnrichmentCompletion {
  readonly availableFrom: Date | null;
  readonly availableTo: Date | null;
  readonly endpointResults: Prisma.InputJsonValue;
  readonly historyCompleteness: CandidateHistoryCompleteness;
  readonly historyTruncated: boolean;
  readonly longRelatedCount: number;
  readonly retrievedFillCount: number;
  readonly shortRelatedCount: number;
  readonly truncationReason: string | null;
}

export interface PromotionResult {
  readonly address: string;
  readonly alreadyPromoted: boolean;
  readonly promotedAt: Date;
  readonly walletAddressId: string;
}

export class HyperliquidDiscoveryRepository {
  public constructor(
    private readonly database: PrismaClient,
    private readonly sourceId: string,
  ) {}

  public async ensureInfrastructure(defaults: DiscoveryDefaults): Promise<void> {
    await this.database.$transaction([
      this.database.discoverySettings.upsert({
        create: {
          enabled: defaults.enabled,
          minimumEnrichmentIntervalMin: defaults.minimumEnrichmentIntervalMin,
          minimumObservedNotionalUsd: defaults.minimumObservedNotionalUsd,
          minimumObservedTradeCount: defaults.minimumObservedTradeCount,
          mode: defaults.mode,
          priorityCoins: [...defaults.priorityCoins],
          recentActivityHours: defaults.recentActivityHours,
          sourceId: this.sourceId,
        },
        update: {},
        where: { sourceId: this.sourceId },
      }),
      this.database.discoveryStats.upsert({
        create: { sourceId: this.sourceId },
        update: {},
        where: { sourceId: this.sourceId },
      }),
    ]);
  }

  public async closeOrphanedEnrichmentAttempts(): Promise<number> {
    return this.database.$transaction(async (transaction) => {
      const runningCandidates = await transaction.addressCandidate.findMany({
        select: { id: true },
        where: {
          enrichmentStatus: "RUNNING",
          sourceId: this.sourceId,
        },
      });
      const now = new Date();
      const attempts = await transaction.candidateEnrichmentAttempt.updateMany({
        data: {
          errorMessage: "Recovered unfinished attempt after Worker restart.",
          finishedAt: now,
          succeeded: false,
        },
        where: {
          candidate: { sourceId: this.sourceId },
          finishedAt: null,
        },
      });
      if (runningCandidates.length > 0) {
        await transaction.addressCandidate.updateMany({
          data: { enrichmentStatus: "FAILED" },
          where: {
            id: { in: runningCandidates.map((candidate) => candidate.id) },
          },
        });
        await transaction.discoveryStats.update({
          data: { enrichmentFailed: { increment: runningCandidates.length } },
          where: { sourceId: this.sourceId },
        });
      }
      return attempts.count;
    });
  }

  public async getSettings() {
    return this.database.discoverySettings.findUniqueOrThrow({
      where: { sourceId: this.sourceId },
    });
  }

  public async upsertTrade(trade: DiscoveryMarketTradeData): Promise<{
    readonly candidates: ReadonlyArray<CandidateReference>;
    readonly duplicate: boolean;
  }> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const candidates = await this.database.$transaction(
          async (transaction) => {
            await transaction.$queryRaw`
              SELECT pg_advisory_xact_lock(
                hashtext(${`hyperliquid-discovery:${this.sourceId}`})
              )::text
            `;
            return this.upsertTradeTransaction(transaction, trade);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
        return { candidates, duplicate: false };
      } catch (error) {
        if (isTransactionConflict(error)) {
          continue;
        }
        if (isUniqueConflict(error)) {
          const duplicate = await this.database.discoveryTrade.findUnique({
            select: { id: true },
            where: {
              sourceId_externalTradeId: {
                externalTradeId: trade.externalTradeId,
                sourceId: this.sourceId,
              },
            },
          });
          if (duplicate) {
            await this.recordDuplicateTrade();
            return {
              candidates: await this.getCandidateReferencesForTrade(duplicate.id),
              duplicate: true,
            };
          }
          continue;
        }
        throw error;
      }
    }
    throw new Error("Candidate trade upsert exhausted transaction retries.");
  }

  public async getCandidateFilterContext(candidateId: string): Promise<CandidateFilterContext> {
    const [candidate, settings] = await Promise.all([
      this.database.addressCandidate.findUniqueOrThrow({
        select: {
          address: true,
          enrichmentStatus: true,
          estimatedNotionalUsd: true,
          exclusionReasons: true,
          filterStatus: true,
          id: true,
          lastSeenAt: true,
          nextEnrichmentAt: true,
          tradeCount: true,
        },
        where: { id: candidateId },
      }),
      this.getSettings(),
    ]);
    const watched = await this.database.walletAddress.findFirst({
      select: { id: true },
      where: {
        address: candidate.address,
        isWatched: true,
        sourceId: this.sourceId,
      },
    });
    return {
      candidate: {
        ...candidate,
        estimatedNotionalUsd: candidate.estimatedNotionalUsd.toFixed(),
      },
      settings: toFilterSettings(settings),
      watched: Boolean(watched),
    };
  }

  public async updateLightFilter(
    candidateId: string,
    status: "LIGHT_ELIGIBLE" | "EXCLUDED",
    reasons: ReadonlyArray<string>,
  ): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.addressCandidate.findUniqueOrThrow({
        select: { exclusionReasons: true, filterStatus: true },
        where: { id: candidateId },
      });
      if (current.exclusionReasons.includes("MANUALLY_EXCLUDED")) {
        return false;
      }
      const exclusionReasons =
        status === "EXCLUDED"
          ? mergeExclusionReasons(current.exclusionReasons, reasons)
          : [...reasons];
      const updated = await transaction.addressCandidate.updateMany({
        data: {
          exclusionReasons,
          filterStatus: status,
        },
        where: {
          id: candidateId,
          NOT: { exclusionReasons: { has: "MANUALLY_EXCLUDED" } },
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      if (status === "EXCLUDED" && current.filterStatus !== "EXCLUDED") {
        await transaction.discoveryStats.update({
          data: { excludedCandidates: { increment: 1 } },
          where: { sourceId: this.sourceId },
        });
      }
      return true;
    });
  }

  public async markEnrichmentQueued(candidateId: string): Promise<boolean> {
    const now = new Date();
    return this.database.$transaction(async (transaction) => {
      const candidate = await transaction.addressCandidate.findUniqueOrThrow({
        select: { address: true },
        where: { id: candidateId },
      });
      const watched = await transaction.walletAddress.findFirst({
        select: { id: true },
        where: {
          address: candidate.address,
          isWatched: true,
          sourceId: this.sourceId,
        },
      });
      if (watched) {
        return false;
      }
      const updated = await transaction.addressCandidate.updateMany({
        data: { enrichmentStatus: "QUEUED" },
        where: {
          id: candidateId,
          NOT: { exclusionReasons: { has: "MANUALLY_EXCLUDED" } },
          OR: [{ nextEnrichmentAt: null }, { nextEnrichmentAt: { lte: now } }],
          enrichmentStatus: { in: ["PENDING", "FAILED", "SUCCEEDED", "RATE_LIMITED"] },
          promotedAt: null,
          promotedWalletId: null,
        },
      });
      return updated.count === 1;
    });
  }

  public async releaseEnrichmentQueue(candidateId: string): Promise<void> {
    await this.database.addressCandidate.updateMany({
      data: { enrichmentStatus: "PENDING" },
      where: { enrichmentStatus: "QUEUED", id: candidateId },
    });
  }

  public async beginEnrichment(
    candidateId: string,
    requestedFrom: Date,
    requestedTo: Date,
  ): Promise<EnrichmentStart | null> {
    return this.database.$transaction(async (transaction) => {
      const candidate = await transaction.addressCandidate.findUniqueOrThrow({
        select: {
          address: true,
          exclusionReasons: true,
          id: true,
          nextEnrichmentAt: true,
          promotedAt: true,
          promotedWalletId: true,
        },
        where: { id: candidateId },
      });
      if (
        candidate.exclusionReasons.includes("MANUALLY_EXCLUDED") ||
        candidate.promotedAt ||
        candidate.promotedWalletId ||
        (candidate.nextEnrichmentAt && candidate.nextEnrichmentAt > new Date())
      ) {
        return null;
      }
      const watched = await transaction.walletAddress.findFirst({
        select: { id: true },
        where: {
          address: candidate.address,
          isWatched: true,
          sourceId: this.sourceId,
        },
      });
      if (watched) {
        return null;
      }
      const settings = await transaction.discoverySettings.findUniqueOrThrow({
        where: { sourceId: this.sourceId },
      });
      const started = await transaction.addressCandidate.updateMany({
        data: { enrichmentStatus: "RUNNING" },
        where: {
          id: candidateId,
          NOT: { exclusionReasons: { has: "MANUALLY_EXCLUDED" } },
          promotedAt: null,
          promotedWalletId: null,
        },
      });
      if (started.count !== 1) {
        return null;
      }
      await transaction.candidateEnrichmentAttempt.updateMany({
        data: {
          errorMessage: "Superseded by a retried candidate enrichment attempt.",
          finishedAt: new Date(),
          succeeded: false,
        },
        where: {
          candidateId,
          finishedAt: null,
        },
      });
      const attempt = await transaction.candidateEnrichmentAttempt.create({
        data: {
          candidateId,
          requestedFrom,
          requestedTo,
        },
      });
      return {
        address: candidate.address,
        attemptId: attempt.id,
        candidateId,
        settings: toFilterSettings(settings),
      };
    });
  }

  public async completeEnrichment(
    start: EnrichmentStart,
    completion: CandidateEnrichmentCompletion,
  ): Promise<void> {
    const now = new Date();
    const nextEnrichmentAt = new Date(
      now.getTime() + start.settings.minimumEnrichmentIntervalMin * 60 * 1_000,
    );
    await this.database.$transaction([
      this.database.candidateEnrichmentAttempt.update({
        data: {
          availableFrom: completion.availableFrom,
          availableTo: completion.availableTo,
          endpointResults: completion.endpointResults,
          finishedAt: now,
          historyCompleteness: completion.historyCompleteness,
          historyTruncated: completion.historyTruncated,
          retrievedFillCount: completion.retrievedFillCount,
          succeeded: true,
          truncationReason: completion.truncationReason,
        },
        where: { id: start.attemptId },
      }),
      this.database.addressCandidate.update({
        data: {
          availableFrom: completion.availableFrom,
          availableTo: completion.availableTo,
          enrichmentMetadata: completion.endpointResults,
          enrichmentStatus: "SUCCEEDED",
          historyCompleteness: completion.historyCompleteness,
          historyTruncated: completion.historyTruncated,
          lastEnrichedAt: now,
          longRelatedCount: completion.longRelatedCount,
          nextEnrichmentAt,
          retrievedFillCount: completion.retrievedFillCount,
          shortRelatedCount: completion.shortRelatedCount,
          truncationReason: completion.truncationReason,
        },
        where: { id: start.candidateId },
      }),
      this.database.discoveryStats.update({
        data: { enrichmentSucceeded: { increment: 1 } },
        where: { sourceId: this.sourceId },
      }),
    ]);
  }

  public async failEnrichment(
    candidateId: string,
    attemptId: string,
    message: string,
    rateLimited: boolean,
  ): Promise<void> {
    await this.database.$transaction([
      this.database.candidateEnrichmentAttempt.update({
        data: {
          errorMessage: message,
          finishedAt: new Date(),
          succeeded: false,
        },
        where: { id: attemptId },
      }),
      this.database.addressCandidate.update({
        data: {
          enrichmentStatus: rateLimited ? "RATE_LIMITED" : "FAILED",
        },
        where: { id: candidateId },
      }),
      this.database.discoveryStats.update({
        data: { enrichmentFailed: { increment: 1 } },
        where: { sourceId: this.sourceId },
      }),
    ]);
  }

  public async failInterruptedEnrichment(candidateId: string, message: string): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const now = new Date();
      const candidate = await transaction.addressCandidate.updateMany({
        data: { enrichmentStatus: "FAILED" },
        where: {
          enrichmentStatus: { in: ["QUEUED", "RUNNING"] },
          id: candidateId,
        },
      });
      await transaction.candidateEnrichmentAttempt.updateMany({
        data: {
          errorMessage: message,
          finishedAt: now,
          succeeded: false,
        },
        where: {
          candidateId,
          finishedAt: null,
        },
      });
      if (candidate.count === 1) {
        await transaction.discoveryStats.update({
          data: { enrichmentFailed: { increment: 1 } },
          where: { sourceId: this.sourceId },
        });
      }
      return candidate.count === 1;
    });
  }

  public async updateFullFilter(
    candidateId: string,
    result: EnrichedCandidateResult,
    endpointFailures: number,
    retrievedFillCount: number,
    historyTruncated: boolean,
  ): Promise<boolean> {
    const dataQualityScore = calculateDataQualityScore({
      activeDays: result.activeDays,
      endpointFailures,
      fillCount: retrievedFillCount,
      historyTruncated,
    });
    return this.database.$transaction(async (transaction) => {
      const current = await transaction.addressCandidate.findUniqueOrThrow({
        select: { exclusionReasons: true, filterStatus: true },
        where: { id: candidateId },
      });
      if (current.exclusionReasons.includes("MANUALLY_EXCLUDED")) {
        return false;
      }
      const exclusionReasons =
        result.status === "EXCLUDED"
          ? mergeExclusionReasons(current.exclusionReasons, result.reasons)
          : [...result.reasons];
      const updated = await transaction.addressCandidate.updateMany({
        data: {
          availableFrom: result.availableFrom,
          availableTo: result.availableTo,
          dataQualityScore,
          exclusionReasons,
          filterStatus: result.status,
          historyCompleteness: result.completeness,
        },
        where: {
          id: candidateId,
          NOT: { exclusionReasons: { has: "MANUALLY_EXCLUDED" } },
        },
      });
      if (updated.count !== 1) {
        return false;
      }
      if (result.status === "ELIGIBLE" && current.filterStatus !== "ELIGIBLE") {
        await transaction.discoveryStats.update({
          data: { filterPassed: { increment: 1 } },
          where: { sourceId: this.sourceId },
        });
      }
      if (result.status === "EXCLUDED" && current.filterStatus !== "EXCLUDED") {
        await transaction.discoveryStats.update({
          data: { excludedCandidates: { increment: 1 } },
          where: { sourceId: this.sourceId },
        });
      }
      return true;
    });
  }

  public async getCandidateEnrichmentMetadata(candidateId: string): Promise<{
    readonly endpointFailures: number;
    readonly historyTruncated: boolean;
    readonly retrievedFillCount: number;
  }> {
    const candidate = await this.database.addressCandidate.findUniqueOrThrow({
      select: {
        enrichmentMetadata: true,
        historyTruncated: true,
        retrievedFillCount: true,
      },
      where: { id: candidateId },
    });
    const metadata = asRecord(candidate.enrichmentMetadata);
    return {
      endpointFailures:
        typeof metadata.endpointFailures === "number" ? metadata.endpointFailures : 0,
      historyTruncated: candidate.historyTruncated,
      retrievedFillCount: candidate.retrievedFillCount,
    };
  }

  public async getStoredFullFilterResult(candidateId: string): Promise<{
    readonly endpointFailures: number;
    readonly historyTruncated: boolean;
    readonly result: EnrichedCandidateResult;
    readonly retrievedFillCount: number;
  }> {
    const candidate = await this.database.addressCandidate.findUniqueOrThrow({
      select: {
        enrichmentMetadata: true,
        historyTruncated: true,
        retrievedFillCount: true,
      },
      where: { id: candidateId },
    });
    const metadata = asRecord(candidate.enrichmentMetadata);
    const analysis = asRecord(
      "analysis" in metadata ? (metadata.analysis as Prisma.JsonValue) : null,
    );
    return {
      endpointFailures:
        typeof metadata.endpointFailures === "number" ? metadata.endpointFailures : 0,
      historyTruncated: candidate.historyTruncated,
      result: parseStoredAnalysis(analysis),
      retrievedFillCount: candidate.retrievedFillCount,
    };
  }

  public async promoteCandidate(candidateId: string): Promise<PromotionResult> {
    return this.database.$transaction(
      async (transaction) => {
        const candidate = await transaction.addressCandidate.findUniqueOrThrow({
          where: { id: candidateId },
        });
        if (candidate.promotedAt && candidate.promotedWalletId) {
          return {
            address: candidate.address,
            alreadyPromoted: true,
            promotedAt: candidate.promotedAt,
            walletAddressId: candidate.promotedWalletId,
          };
        }
        if (candidate.filterStatus !== "ELIGIBLE") {
          throw new Error("Only a fully eligible candidate can be promoted.");
        }
        const wallet = await transaction.walletAddress.upsert({
          create: {
            address: candidate.address,
            isWatched: true,
            sourceId: this.sourceId,
          },
          update: {
            isWatched: true,
          },
          where: {
            sourceId_address: {
              address: candidate.address,
              sourceId: this.sourceId,
            },
          },
        });
        const promotedAt = new Date();
        await transaction.addressCandidate.update({
          data: {
            filterStatus: "PROMOTED",
            promotedAt,
            promotedWalletId: wallet.id,
          },
          where: { id: candidateId },
        });
        return {
          address: candidate.address,
          alreadyPromoted: false,
          promotedAt,
          walletAddressId: wallet.id,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public async setWebSocketStatus(
    status: DiscoveryConnectionStatus,
    options: {
      readonly coins?: ReadonlyArray<string>;
      readonly connectedAt?: Date;
      readonly disconnectedAt?: Date;
    } = {},
  ): Promise<void> {
    await this.database.discoveryStats.upsert({
      create: {
        ...(options.coins ? { subscribedCoins: [...options.coins] } : {}),
        ...(options.connectedAt ? { lastConnectedAt: options.connectedAt } : {}),
        ...(options.disconnectedAt ? { lastDisconnectedAt: options.disconnectedAt } : {}),
        sourceId: this.sourceId,
        websocketStatus: status,
      },
      update: {
        ...(options.coins ? { subscribedCoins: [...options.coins] } : {}),
        ...(options.connectedAt ? { lastConnectedAt: options.connectedAt } : {}),
        ...(options.disconnectedAt ? { lastDisconnectedAt: options.disconnectedAt } : {}),
        websocketStatus: status,
      },
      where: { sourceId: this.sourceId },
    });
  }

  public async recordDiscoveryGap(disconnectedAt: Date, reconnectedAt?: Date): Promise<void> {
    const fingerprint = createHash("sha256")
      .update(`HYPERLIQUID_DISCOVERY_GAP:${this.sourceId}:${disconnectedAt.toISOString()}`)
      .digest("hex");
    const details = {
      disconnectedAt: disconnectedAt.toISOString(),
      ...(reconnectedAt ? { reconnectedAt: reconnectedAt.toISOString() } : {}),
      recovery: "UNAVAILABLE_FROM_FREE_MARKET_API",
    };
    await this.database.$transaction([
      this.database.discoveryDataQualityIssue.upsert({
        create: {
          details,
          fingerprint,
          issueType: "HYPERLIQUID_DISCOVERY_GAP",
          message:
            "Market-wide trades missed during the disconnect cannot be fully recovered from the free public API.",
          severity: "WARNING",
          sourceId: this.sourceId,
        },
        update: {
          details,
          lastDetectedAt: new Date(),
          message:
            "Market-wide trades missed during the disconnect cannot be fully recovered from the free public API.",
          status: "OPEN",
        },
        where: { fingerprint },
      }),
      this.database.discoveryCursor.upsert({
        create: {
          cursorType: "timestamp",
          errorMessage: "Market-wide gap cannot be backfilled by the free public API.",
          lastAttemptedAt: disconnectedAt,
          lastExternalId: disconnectedAt.toISOString(),
          lastTimestamp: disconnectedAt,
          scope: "market-trades",
          sourceId: this.sourceId,
          status: "GAP_DETECTED",
        },
        update: {
          errorMessage: "Market-wide gap cannot be backfilled by the free public API.",
          lastAttemptedAt: disconnectedAt,
          status: "GAP_DETECTED",
        },
        where: {
          sourceId_scope_cursorType: {
            cursorType: "timestamp",
            scope: "market-trades",
            sourceId: this.sourceId,
          },
        },
      }),
    ]);
  }

  public async recordDiscoveryStartupGap(reconnectedAt: Date): Promise<Date | null> {
    const cursor = await this.database.discoveryCursor.findUnique({
      select: { lastTimestamp: true },
      where: {
        sourceId_scope_cursorType: {
          cursorType: "timestamp",
          scope: "market-trades",
          sourceId: this.sourceId,
        },
      },
    });
    const gapFrom = cursor?.lastTimestamp ?? null;
    if (!gapFrom || gapFrom >= reconnectedAt) {
      return null;
    }
    await this.recordDiscoveryGap(gapFrom, reconnectedAt);
    return gapFrom;
  }

  public async recordApiUsage(usage: RateLimiterUsage): Promise<void> {
    await this.database.discoveryStats.upsert({
      create: {
        apiWeightUsed: usage.usedWeight,
        apiWeightWindowStartedAt:
          usage.windowStartedAt === null ? null : new Date(usage.windowStartedAt),
        sourceId: this.sourceId,
      },
      update: {
        apiWeightUsed: usage.usedWeight,
        apiWeightWindowStartedAt:
          usage.windowStartedAt === null ? null : new Date(usage.windowStartedAt),
      },
      where: { sourceId: this.sourceId },
    });
  }

  public async recordReceivedTradeEvents(count: number): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError("Received trade event count must be a non-negative safe integer.");
    }
    if (count === 0) {
      return;
    }
    await this.database.discoveryStats.update({
      data: { receivedTradeEvents: { increment: count } },
      where: { sourceId: this.sourceId },
    });
  }

  public async recordDuplicateTradeEvents(count: number): Promise<void> {
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError("Duplicate trade event count must be a non-negative safe integer.");
    }
    if (count === 0) {
      return;
    }
    await this.database.discoveryStats.update({
      data: { duplicateTradeEvents: { increment: count } },
      where: { sourceId: this.sourceId },
    });
  }

  public async setQueueDepth(queueDepth: number): Promise<void> {
    await this.database.discoveryStats.update({
      data: { queueDepth },
      where: { sourceId: this.sourceId },
    });
  }

  public async auditCandidates(): Promise<{ readonly audited: number }> {
    const issueTypes = [
      "HYPERLIQUID_CANDIDATE_HISTORY_TRUNCATED",
      "HYPERLIQUID_CANDIDATE_LOW_DATA_QUALITY",
    ];
    const candidates = await this.database.addressCandidate.findMany({
      select: {
        dataQualityScore: true,
        historyTruncated: true,
        id: true,
      },
      where: {
        enrichmentStatus: "SUCCEEDED",
        sourceId: this.sourceId,
        OR: [{ historyTruncated: true }, { dataQualityScore: { lt: 70 } }],
      },
    });
    const detectedAt = new Date();
    await this.database.$transaction([
      this.database.candidateDataQualityIssue.updateMany({
        data: {
          resolvedAt: detectedAt,
          status: "RESOLVED",
        },
        where: {
          candidate: { sourceId: this.sourceId },
          issueType: { in: issueTypes },
          status: "OPEN",
        },
      }),
      ...candidates.map((candidate) => {
        const issueType = candidate.historyTruncated
          ? "HYPERLIQUID_CANDIDATE_HISTORY_TRUNCATED"
          : "HYPERLIQUID_CANDIDATE_LOW_DATA_QUALITY";
        const fingerprint = createHash("sha256")
          .update(`${issueType}:${candidate.id}`)
          .digest("hex");
        return this.database.candidateDataQualityIssue.upsert({
          create: {
            candidateId: candidate.id,
            details: {
              dataQualityScore: candidate.dataQualityScore,
              historyTruncated: candidate.historyTruncated,
            },
            fingerprint,
            issueType,
            message: "Candidate history is incomplete or below the data quality threshold.",
            severity: "WARNING",
          },
          update: {
            lastDetectedAt: detectedAt,
            resolvedAt: null,
            status: "OPEN",
          },
          where: { fingerprint },
        });
      }),
    ]);
    return { audited: candidates.length };
  }

  private async getCandidateReferencesForTrade(
    discoveryTradeId: string,
  ): Promise<ReadonlyArray<CandidateReference>> {
    const [participations, filterSettings] = await Promise.all([
      this.database.candidateTradeParticipation.findMany({
        select: {
          candidate: {
            select: {
              address: true,
              enrichmentStatus: true,
              estimatedNotionalUsd: true,
              exclusionReasons: true,
              id: true,
              promotedAt: true,
              tradeCount: true,
            },
          },
        },
        where: { discoveryTradeId },
      }),
      this.database.discoverySettings.findUniqueOrThrow({
        select: {
          minimumObservedNotionalUsd: true,
          minimumObservedTradeCount: true,
        },
        where: { sourceId: this.sourceId },
      }),
    ]);
    return participations.map(({ candidate }) => toCandidateReference(candidate, filterSettings));
  }

  private async upsertTradeTransaction(
    transaction: Prisma.TransactionClient,
    trade: DiscoveryMarketTradeData,
  ): Promise<ReadonlyArray<CandidateReference>> {
    const occurredAt = new Date(trade.occurredAt);
    const notional = new FinancialDecimal(trade.notionalUsd);
    const filterSettings = await transaction.discoverySettings.findUniqueOrThrow({
      select: {
        minimumObservedNotionalUsd: true,
        minimumObservedTradeCount: true,
      },
      where: { sourceId: this.sourceId },
    });
    const discoveryTrade = await transaction.discoveryTrade.create({
      data: {
        buyerAddress: normalizeHyperliquidAddress(trade.buyerAddress),
        coin: trade.coin,
        externalTradeId: trade.externalTradeId,
        fingerprint: trade.fingerprint,
        notionalUsd: notional,
        occurredAt,
        price: trade.price,
        rawPayload: trade.rawPayload,
        sellerAddress: normalizeHyperliquidAddress(trade.sellerAddress),
        side: trade.side,
        size: trade.size,
        sourceId: this.sourceId,
        tradeId: trade.tradeId,
        transactionHash: trade.transactionHash,
      },
    });
    const actors = candidateActors(trade);
    const candidates: CandidateReference[] = [];
    let newCandidateCount = 0;

    for (const actor of actors) {
      const existing = await transaction.addressCandidate.findUnique({
        where: {
          sourceId_address: {
            address: actor.address,
            sourceId: this.sourceId,
          },
        },
      });
      const candidate = existing
        ? await transaction.addressCandidate.update({
            data: {
              averageTradeUsd: new FinancialDecimal(existing.estimatedNotionalUsd)
                .plus(notional)
                .div(new FinancialDecimal(existing.tradeCount.toString()).plus(1)),
              buyCount: { increment: actor.side === "BUY" ? 1 : 0 },
              estimatedNotionalUsd: { increment: notional },
              firstSeenAt: occurredAt < existing.firstSeenAt ? occurredAt : existing.firstSeenAt,
              largestTradeUsd: FinancialDecimal.max(existing.largestTradeUsd, notional),
              lastSeenAt: occurredAt > existing.lastSeenAt ? occurredAt : existing.lastSeenAt,
              makerCount: { increment: actor.liquidityRole === "MAKER" ? 1 : 0 },
              sellCount: { increment: actor.side === "SELL" ? 1 : 0 },
              takerCount: { increment: actor.liquidityRole === "TAKER" ? 1 : 0 },
              tradeCount: { increment: 1 },
            },
            where: { id: existing.id },
          })
        : await transaction.addressCandidate.create({
            data: {
              address: actor.address,
              averageTradeUsd: notional,
              buyCount: actor.side === "BUY" ? 1 : 0,
              estimatedNotionalUsd: notional,
              firstSeenAt: occurredAt,
              largestTradeUsd: notional,
              lastSeenAt: occurredAt,
              makerCount: actor.liquidityRole === "MAKER" ? 1 : 0,
              sellCount: actor.side === "SELL" ? 1 : 0,
              sourceId: this.sourceId,
              takerCount: actor.liquidityRole === "TAKER" ? 1 : 0,
              tradeCount: 1,
            },
          });
      if (!existing) {
        newCandidateCount += 1;
      }

      await transaction.candidateTradeParticipation.create({
        data: {
          candidateId: candidate.id,
          discoveryTradeId: discoveryTrade.id,
          liquidityRole: actor.liquidityRole,
          role: actor.role,
          side: actor.side,
        },
      });
      const existingCoin = await transaction.candidateCoin.findUnique({
        where: {
          candidateId_coin: {
            candidateId: candidate.id,
            coin: trade.coin,
          },
        },
      });
      if (existingCoin) {
        await transaction.candidateCoin.update({
          data: {
            firstSeenAt:
              occurredAt < existingCoin.firstSeenAt ? occurredAt : existingCoin.firstSeenAt,
            lastSeenAt: occurredAt > existingCoin.lastSeenAt ? occurredAt : existingCoin.lastSeenAt,
            tradeCount: { increment: 1 },
          },
          where: { id: existingCoin.id },
        });
      } else {
        await transaction.candidateCoin.create({
          data: {
            candidateId: candidate.id,
            coin: trade.coin,
            firstSeenAt: occurredAt,
            lastSeenAt: occurredAt,
          },
        });
      }
      await transaction.candidateActivityBucket.createMany({
        data: [
          {
            bucketStart: startOfUtcDay(occurredAt),
            candidateId: candidate.id,
            period: "DAY",
          },
          {
            bucketStart: startOfUtcHour(occurredAt),
            candidateId: candidate.id,
            period: "HOUR",
          },
        ],
        skipDuplicates: true,
      });
      const [distinctCoins, activeDays, activeHours] = await Promise.all([
        transaction.candidateCoin.count({ where: { candidateId: candidate.id } }),
        transaction.candidateActivityBucket.count({
          where: { candidateId: candidate.id, period: "DAY" },
        }),
        transaction.candidateActivityBucket.count({
          where: { candidateId: candidate.id, period: "HOUR" },
        }),
      ]);
      await transaction.addressCandidate.update({
        data: { activeDays, activeHours, distinctCoins },
        where: { id: candidate.id },
      });
      candidates.push(toCandidateReference(candidate, filterSettings));
    }

    const currentStats = await transaction.discoveryStats.findUniqueOrThrow({
      select: { lastEventAt: true },
      where: { sourceId: this.sourceId },
    });
    await transaction.discoveryStats.update({
      data: {
        discoveredAddresses: { increment: newCandidateCount },
        lastEventAt:
          !currentStats.lastEventAt || occurredAt > currentStats.lastEventAt
            ? occurredAt
            : currentStats.lastEventAt,
        newCandidates: { increment: newCandidateCount },
      },
      where: { sourceId: this.sourceId },
    });
    await advanceCursor(transaction, this.sourceId, "market-trades", trade, occurredAt);
    await advanceCursor(
      transaction,
      this.sourceId,
      `market-trades:${trade.coin}`,
      trade,
      occurredAt,
    );
    return candidates;
  }

  private async recordDuplicateTrade(): Promise<void> {
    await this.recordDuplicateTradeEvents(1);
  }
}

function toCandidateReference(
  candidate: {
    readonly address: string;
    readonly enrichmentStatus: string;
    readonly estimatedNotionalUsd: Prisma.Decimal;
    readonly exclusionReasons: ReadonlyArray<string>;
    readonly id: string;
    readonly promotedAt: Date | null;
    readonly tradeCount: number;
  },
  settings: {
    readonly minimumObservedNotionalUsd: Prisma.Decimal;
    readonly minimumObservedTradeCount: number;
  },
): CandidateReference {
  return {
    address: candidate.address,
    filterReady:
      candidate.tradeCount >= settings.minimumObservedTradeCount &&
      candidate.estimatedNotionalUsd.greaterThanOrEqualTo(settings.minimumObservedNotionalUsd) &&
      ["PENDING", "FAILED", "RATE_LIMITED"].includes(candidate.enrichmentStatus) &&
      !candidate.exclusionReasons.includes("MANUALLY_EXCLUDED") &&
      candidate.promotedAt === null,
    id: candidate.id,
    tradeCount: candidate.tradeCount,
  };
}

function mergeExclusionReasons(
  current: ReadonlyArray<string>,
  evaluated: ReadonlyArray<string>,
): Array<string> {
  return [...new Set([...current, ...evaluated])];
}

function candidateActors(trade: DiscoveryMarketTradeData): ReadonlyArray<{
  readonly address: string;
  readonly liquidityRole: "MAKER" | "TAKER";
  readonly role: "BUYER" | "SELLER" | "SELF";
  readonly side: "BUY" | "SELL";
}> {
  const buyer = normalizeHyperliquidAddress(trade.buyerAddress);
  const seller = normalizeHyperliquidAddress(trade.sellerAddress);
  if (buyer === seller) {
    return [
      {
        address: buyer,
        liquidityRole: "TAKER",
        role: "SELF",
        side: trade.side,
      },
    ];
  }
  return [
    {
      address: buyer,
      liquidityRole: trade.side === "BUY" ? "TAKER" : "MAKER",
      role: "BUYER",
      side: "BUY",
    },
    {
      address: seller,
      liquidityRole: trade.side === "SELL" ? "TAKER" : "MAKER",
      role: "SELLER",
      side: "SELL",
    },
  ];
}

async function advanceCursor(
  transaction: Prisma.TransactionClient,
  sourceId: string,
  scope: string,
  trade: DiscoveryMarketTradeData,
  occurredAt: Date,
): Promise<void> {
  const key = {
    cursorType: "timestamp",
    scope,
    sourceId,
  };
  const existing = await transaction.discoveryCursor.findUnique({
    where: { sourceId_scope_cursorType: key },
  });
  const shouldAdvance = !existing?.lastTimestamp || occurredAt >= existing.lastTimestamp;
  const preserveGap = existing?.status === "GAP_DETECTED";
  await transaction.discoveryCursor.upsert({
    create: {
      ...key,
      lastAttemptedAt: new Date(),
      lastExternalId: trade.externalTradeId,
      lastSuccessfulAt: new Date(),
      lastTimestamp: occurredAt,
      status: "SUCCEEDED",
    },
    update: {
      errorMessage: preserveGap ? existing.errorMessage : null,
      lastAttemptedAt: new Date(),
      lastSuccessfulAt: new Date(),
      ...(shouldAdvance
        ? {
            lastExternalId: trade.externalTradeId,
            lastTimestamp: occurredAt,
          }
        : {}),
      status: preserveGap ? "GAP_DETECTED" : "SUCCEEDED",
    },
    where: { sourceId_scope_cursorType: key },
  });
}

function toFilterSettings(settings: {
  readonly fullMinimumActiveDays: number;
  readonly fullMinimumActiveMonths: number;
  readonly fullMinimumNotionalUsd: Prisma.Decimal;
  readonly fullMinimumTradeCount: number;
  readonly fullRecentActivityDays: number;
  readonly minimumEnrichmentIntervalMin: number;
  readonly minimumObservedNotionalUsd: Prisma.Decimal;
  readonly minimumObservedTradeCount: number;
  readonly recentActivityHours: number;
}): DiscoveryFilterSettings & { readonly minimumEnrichmentIntervalMin: number } {
  return {
    fullMinimumActiveDays: settings.fullMinimumActiveDays,
    fullMinimumActiveMonths: settings.fullMinimumActiveMonths,
    fullMinimumNotionalUsd: settings.fullMinimumNotionalUsd.toFixed(),
    fullMinimumTradeCount: settings.fullMinimumTradeCount,
    fullRecentActivityDays: settings.fullRecentActivityDays,
    minimumEnrichmentIntervalMin: settings.minimumEnrichmentIntervalMin,
    minimumObservedNotionalUsd: settings.minimumObservedNotionalUsd.toFixed(),
    minimumObservedTradeCount: settings.minimumObservedTradeCount,
    recentActivityHours: settings.recentActivityHours,
  };
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUtcHour(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours()),
  );
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

function asRecord(value: Prisma.JsonValue | null): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

function parseStoredAnalysis(value: Readonly<Record<string, unknown>>): EnrichedCandidateResult {
  const status = value.status;
  const completeness = value.completeness;
  if (
    (status !== "ELIGIBLE" && status !== "EXCLUDED" && status !== "INSUFFICIENT_HISTORY") ||
    (completeness !== "COMPLETE" && completeness !== "PARTIAL" && completeness !== "INSUFFICIENT")
  ) {
    throw new Error("Candidate enrichment analysis is missing or invalid.");
  }
  return {
    activeDays: requireNumber(value.activeDays, "activeDays"),
    activeMonths: requireNumber(value.activeMonths, "activeMonths"),
    availableFrom: optionalDate(value.availableFrom),
    availableTo: optionalDate(value.availableTo),
    completeness,
    cumulativeNotionalUsd: requireString(value.cumulativeNotionalUsd, "cumulativeNotionalUsd"),
    dataQualityScore: requireNumber(value.dataQualityScore, "dataQualityScore"),
    reasons: requireStringArray(value.reasons, "reasons"),
    status,
  };
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Candidate enrichment ${field} is invalid.`);
  }
  return value;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`Candidate enrichment ${field} is invalid.`);
  }
  return value;
}

function requireStringArray(value: unknown, field: string): ReadonlyArray<string> {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Candidate enrichment ${field} is invalid.`);
  }
  return value;
}

function optionalDate(value: unknown): Date | null {
  if (value === null) {
    return null;
  }
  const text = requireString(value, "date");
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Candidate enrichment date is invalid.");
  }
  return date;
}
