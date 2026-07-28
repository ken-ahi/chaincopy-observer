import { errorDetails } from "@chaincopy/config";
import {
  hyperliquidDiscoveryJobNames,
  hyperliquidDiscoveryQueueName,
  hyperliquidJobNames,
  type DiscoveryCandidateJobData,
  type HyperliquidDiscoveryJobData,
  type HyperliquidDiscoveryJobName,
  type HyperliquidJobData,
} from "@chaincopy/domain";
import { type PrismaClient } from "@chaincopy/database";
import { type Job, type Queue } from "bullmq";
import { type Logger } from "pino";

import { enqueueHyperliquidJob } from "../queue.js";
import { type CandidateEnrichmentService } from "./enrichment-service.js";
import { evaluateLightweightCandidate } from "./filter.js";
import { enqueueCandidateEnrichment, enqueueCandidateFilter } from "./queue.js";
import { type HyperliquidDiscoveryRepository } from "./repository.js";
import { type HyperliquidDiscoveryWebSocketSupervisor } from "./websocket-supervisor.js";

const supportedJobNames = new Set<string>(Object.values(hyperliquidDiscoveryJobNames));

export class HyperliquidDiscoveryJobProcessor {
  public constructor(
    private readonly database: PrismaClient,
    private readonly discoveryQueue: Queue<HyperliquidDiscoveryJobData>,
    private readonly candidateQueue: Queue<HyperliquidDiscoveryJobData>,
    private readonly syncQueue: Queue<HyperliquidJobData>,
    private readonly repository: HyperliquidDiscoveryRepository,
    private readonly enrichmentService: CandidateEnrichmentService,
    private readonly supervisor: HyperliquidDiscoveryWebSocketSupervisor,
    private readonly sourceId: string,
    private readonly isSchedulerLeader: () => boolean,
    private readonly knownSystemAddresses: ReadonlySet<string>,
    private readonly logger: Logger,
  ) {}

  public async process(
    job: Job<HyperliquidDiscoveryJobData>,
    processingQueueName = hyperliquidDiscoveryQueueName,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!supportedJobNames.has(job.name)) {
      throw new Error(`Unsupported Hyperliquid discovery job: ${job.name}`);
    }
    const jobName = job.name as HyperliquidDiscoveryJobName;
    const queueJobId = job.id ?? `${jobName}-${job.data.requestedAt}`;
    const idempotencyKey = `${processingQueueName}:${queueJobId}`;
    const candidateId = job.data.kind === "candidate" ? job.data.candidateId : undefined;
    const completed = await this.database.syncJob.findUnique({
      select: { status: true },
      where: { idempotencyKey },
    });
    if (completed?.status === "SUCCEEDED") {
      return { duplicateSuppressed: true };
    }

    await this.database.syncJob.upsert({
      create: {
        ...(candidateId ? { addressCandidateId: candidateId } : {}),
        attempt: 1,
        idempotencyKey,
        jobName,
        queueJobId,
        queueName: processingQueueName,
        sourceId: this.sourceId,
        startedAt: new Date(),
        status: "RUNNING",
      },
      update: {
        attempt: { increment: 1 },
        errorMessage: null,
        finishedAt: null,
        startedAt: new Date(),
        status: "RUNNING",
      },
      where: { idempotencyKey },
    });
    this.logger.info(
      {
        attempt: job.attemptsMade + 1,
        candidateId,
        jobId: job.id,
        jobName,
      },
      "Hyperliquid discovery job started",
    );

    try {
      const result = await this.runJob(jobName, job.data);
      await this.database.syncJob.update({
        data: {
          errorMessage: null,
          finishedAt: new Date(),
          metadata: { result: JSON.stringify(result) },
          status: "SUCCEEDED",
        },
        where: { idempotencyKey },
      });
      this.logger.info(
        { candidateId, jobId: job.id, jobName, result },
        "Hyperliquid discovery job completed",
      );
      return result;
    } catch (error) {
      const details = errorDetails(error);
      await this.database.syncJob.update({
        data: {
          errorMessage: details.message,
          finishedAt: new Date(),
          status: "FAILED",
        },
        where: { idempotencyKey },
      });
      this.logger.error(
        { candidateId, error: details, jobId: job.id, jobName },
        "Hyperliquid discovery job failed",
      );
      throw error;
    }
  }

  private async runJob(
    jobName: HyperliquidDiscoveryJobName,
    data: HyperliquidDiscoveryJobData,
  ): Promise<Readonly<Record<string, unknown>>> {
    switch (jobName) {
      case hyperliquidDiscoveryJobNames.marketTradeDiscovery:
        requireKind(data, "control");
        if (!this.isSchedulerLeader()) {
          return { delegatedToSchedulerLeader: true, listening: false };
        }
        return this.supervisor.ensureRunning();
      case hyperliquidDiscoveryJobNames.candidateUpsert:
        requireKind(data, "trade");
        return this.upsertCandidateTrade(data);
      case hyperliquidDiscoveryJobNames.candidateFilter:
        requireKind(data, "candidate");
        return this.filterCandidate(data);
      case hyperliquidDiscoveryJobNames.candidateEnrichment:
        requireKind(data, "candidate");
        return this.enrichCandidate(data);
      case hyperliquidDiscoveryJobNames.candidateQualityAudit:
        requireKind(data, "control");
        return this.repository.auditCandidates();
      case hyperliquidDiscoveryJobNames.candidatePromotion:
        requireKind(data, "candidate");
        return this.promoteCandidate(data);
    }
  }

  private async upsertCandidateTrade(
    data: Extract<HyperliquidDiscoveryJobData, { readonly kind: "trade" }>,
  ): Promise<Readonly<Record<string, unknown>>> {
    const result = await this.repository.upsertTrade(data.trade);
    const filterJobIds = await Promise.all(
      result.candidates
        .filter((candidate) => candidate.filterReady)
        .map((candidate) =>
          enqueueCandidateFilter(
            this.discoveryQueue,
            {
              address: candidate.address,
              automatic: true,
              candidateId: candidate.id,
              kind: "candidate",
              requestedAt: data.requestedAt,
            },
            `light-${data.requestedAt.slice(0, 10)}`,
          ),
        ),
    );
    return {
      candidateCount: result.candidates.length,
      duplicate: result.duplicate,
      filterJobIds,
    };
  }

  private async filterCandidate(
    data: DiscoveryCandidateJobData,
  ): Promise<Readonly<Record<string, unknown>>> {
    const context = await this.repository.getCandidateFilterContext(data.candidateId);
    if (context.candidate.filterStatus === "PROMOTED") {
      return { alreadyPromoted: true };
    }
    if (context.candidate.exclusionReasons.includes("MANUALLY_EXCLUDED")) {
      return { manuallyExcluded: true };
    }
    if (context.candidate.enrichmentStatus === "SUCCEEDED") {
      const stored = await this.repository.getStoredFullFilterResult(data.candidateId);
      if (
        !(await this.repository.updateFullFilter(
          data.candidateId,
          stored.result,
          stored.endpointFailures,
          stored.retrievedFillCount,
          stored.historyTruncated,
        ))
      ) {
        return { manuallyExcluded: true };
      }
      return {
        reasons: stored.result.reasons,
        status: stored.result.status,
      };
    }

    const result = evaluateLightweightCandidate(context.candidate, context.settings, {
      alreadyWatched: context.watched,
      knownSystemAddresses: this.knownSystemAddresses,
      now: new Date(data.requestedAt),
    });
    if (
      !(await this.repository.updateLightFilter(data.candidateId, result.status, result.reasons))
    ) {
      return { manuallyExcluded: true };
    }
    if (!result.eligible) {
      return { reasons: result.reasons, status: result.status };
    }
    if (!(await this.repository.markEnrichmentQueued(data.candidateId))) {
      return { enqueueSuppressed: true, status: result.status };
    }

    const requestedTo = new Date(data.requestedAt);
    const requestedFrom = new Date(requestedTo);
    requestedFrom.setUTCFullYear(requestedFrom.getUTCFullYear() - 5);
    try {
      const enrichmentJobId = await enqueueCandidateEnrichment(this.candidateQueue, {
        address: data.address,
        automatic: true,
        candidateId: data.candidateId,
        kind: "candidate",
        requestedAt: data.requestedAt,
        requestedFrom: requestedFrom.toISOString(),
        requestedTo: requestedTo.toISOString(),
      });
      return { enrichmentJobId, status: result.status };
    } catch (error) {
      await this.repository.releaseEnrichmentQueue(data.candidateId);
      throw error;
    }
  }

  private async enrichCandidate(
    data: DiscoveryCandidateJobData,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!data.requestedFrom || !data.requestedTo) {
      throw new RangeError("Candidate enrichment job is missing its time range.");
    }
    const result = await this.enrichmentService.enrich(
      data.candidateId,
      new Date(data.requestedFrom),
      new Date(data.requestedTo),
    );
    const filterJobId = await enqueueCandidateFilter(
      this.discoveryQueue,
      data,
      `enriched-${new Date(data.requestedTo).getTime()}`,
    );
    return { ...result, filterJobId };
  }

  private async promoteCandidate(
    data: DiscoveryCandidateJobData,
  ): Promise<Readonly<Record<string, unknown>>> {
    const promotion = await this.repository.promoteCandidate(data.candidateId);
    const syncJobId = await enqueueHyperliquidJob(
      this.syncQueue,
      hyperliquidJobNames.walletBackfill,
      {
        requestedAt: promotion.promotedAt.toISOString(),
        walletAddress: promotion.address,
        walletAddressId: promotion.walletAddressId,
      },
      1,
      `candidate-${data.candidateId}`,
    );
    return {
      alreadyPromoted: promotion.alreadyPromoted,
      syncJobId,
      walletAddressId: promotion.walletAddressId,
    };
  }
}

function requireKind<K extends HyperliquidDiscoveryJobData["kind"]>(
  data: HyperliquidDiscoveryJobData,
  kind: K,
): asserts data is Extract<HyperliquidDiscoveryJobData, { readonly kind: K }> {
  if (data.kind !== kind) {
    throw new TypeError(`Discovery job expected ${kind} data, received ${data.kind}.`);
  }
}
