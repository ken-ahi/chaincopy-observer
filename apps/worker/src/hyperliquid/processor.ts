import { errorDetails } from "@chaincopy/config";
import {
  hyperliquidJobNames,
  hyperliquidQueueName,
  type HyperliquidJobData,
  type HyperliquidJobName,
} from "@chaincopy/domain";
import { type PrismaClient } from "@chaincopy/database";
import { type Job, type Queue, UnrecoverableError } from "bullmq";
import { type Redis } from "ioredis";
import { type Logger } from "pino";

import { SyncLockUnavailableError, withRedisLock } from "./lock.js";
import { enqueueWalletBackfillChildren } from "./queue.js";
import type { HyperliquidSyncService } from "./sync-service.js";
import type { HyperliquidWebSocketSupervisor } from "./websocket-supervisor.js";
import type { PerformanceJobScheduler } from "../performance/scheduler.js";

const supportedJobNames = new Set<string>(Object.values(hyperliquidJobNames));

export class HyperliquidJobProcessor {
  public constructor(
    private readonly database: PrismaClient,
    private readonly redis: Redis,
    private readonly queue: Queue<HyperliquidJobData>,
    private readonly syncService: HyperliquidSyncService,
    private readonly websocketSupervisor: HyperliquidWebSocketSupervisor,
    private readonly sourceId: string,
    private readonly isSchedulerLeader: () => boolean,
    private readonly performanceScheduler: PerformanceJobScheduler,
    private readonly logger: Logger,
  ) {}

  public async process(job: Job<HyperliquidJobData>): Promise<Readonly<Record<string, unknown>>> {
    if (!supportedJobNames.has(job.name)) {
      throw new Error(`Unsupported Hyperliquid job: ${job.name}`);
    }
    const jobName = job.name as HyperliquidJobName;
    const canonicalWallet = await this.database.walletAddress.findUnique({
      select: { address: true },
      where: { id: job.data.walletAddressId },
    });
    if (!canonicalWallet) {
      this.logger.error(
        { jobId: job.id, jobName, walletAddressId: job.data.walletAddressId },
        "Rejected a Hyperliquid job for an unknown wallet identity",
      );
      throw new UnrecoverableError(
        `Hyperliquid wallet identity ${job.data.walletAddressId} was not found.`,
      );
    }
    if (normalizeAddress(canonicalWallet.address) !== normalizeAddress(job.data.walletAddress)) {
      this.logger.error(
        { jobId: job.id, jobName, walletAddressId: job.data.walletAddressId },
        "Rejected a Hyperliquid job whose wallet address does not match its canonical identity",
      );
      throw new UnrecoverableError(
        `Hyperliquid wallet identity ${job.data.walletAddressId} does not match its canonical address.`,
      );
    }
    const canonicalData: HyperliquidJobData = {
      ...job.data,
      walletAddress: canonicalWallet.address,
    };
    const queueJobId = job.id ?? `${jobName}-${job.data.walletAddressId}`;
    const idempotencyKey = `${hyperliquidQueueName}:${queueJobId}`;

    const existing = await this.database.syncJob.findUnique({
      select: { status: true },
      where: { idempotencyKey },
    });
    if (existing?.status === "SUCCEEDED") {
      this.logger.info(
        { idempotencyKey, jobId: job.id, jobName },
        "Skipped an already completed Hyperliquid job",
      );
      return { duplicateSuppressed: true };
    }

    await this.database.syncJob.upsert({
      create: {
        attempt: 1,
        idempotencyKey,
        jobName,
        queueJobId,
        queueName: hyperliquidQueueName,
        sourceId: this.sourceId,
        startedAt: new Date(),
        status: "RUNNING",
        walletAddressId: job.data.walletAddressId,
      },
      update: {
        attempt: { increment: 1 },
        errorMessage: null,
        finishedAt: null,
        sourceId: this.sourceId,
        startedAt: new Date(),
        status: "RUNNING",
      },
      where: { idempotencyKey },
    });

    this.logger.info(
      {
        attempt: job.attemptsMade + 1,
        idempotencyKey,
        jobId: job.id,
        jobName,
        walletAddress: canonicalData.walletAddress,
      },
      "Hyperliquid job started",
    );

    try {
      const result =
        jobName === hyperliquidJobNames.websocketListener
          ? await this.startWebSocket(canonicalData)
          : await withRedisLock(
              this.redis,
              `hyperliquid:wallet-sync:${canonicalData.walletAddressId}`,
              () => this.runJob(jobName, canonicalData, queueJobId),
            );
      const performance =
        jobName === hyperliquidJobNames.dataQualityAudit ||
        jobName === hyperliquidJobNames.gapRecovery
          ? await this.performanceScheduler.enqueue(
              canonicalData.walletAddressId,
              new Date(canonicalData.requestedAt),
              `automatic:${jobName}`,
            )
          : null;
      await this.database.syncJob.update({
        data: {
          errorMessage: null,
          finishedAt: new Date(),
          metadata: {
            performance: performance ? JSON.stringify(performance) : null,
            result: JSON.stringify(result),
          },
          status: "SUCCEEDED",
        },
        where: { idempotencyKey },
      });
      this.logger.info(
        {
          attempt: job.attemptsMade + 1,
          idempotencyKey,
          jobId: job.id,
          jobName,
          result,
        },
        "Hyperliquid job completed",
      );
      return performance ? { ...result, performance } : result;
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
        {
          attempt: job.attemptsMade + 1,
          error: details,
          idempotencyKey,
          jobId: job.id,
          jobName,
        },
        "Hyperliquid job attempt failed",
      );
      if (error instanceof SyncLockUnavailableError) {
        throw suppressImmediateLockRetry(error);
      }
      throw error;
    }
  }

  private async runJob(
    jobName: HyperliquidJobName,
    data: HyperliquidJobData,
    queueJobId: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    switch (jobName) {
      case hyperliquidJobNames.walletBackfill:
        return {
          childJobIds: await enqueueWalletBackfillChildren(this.queue, data, queueJobId),
        };
      case hyperliquidJobNames.fillSync:
        return this.syncService.syncFills(data);
      case hyperliquidJobNames.fundingSync:
        return this.syncService.syncFunding(data);
      case hyperliquidJobNames.ledgerSync:
        return this.syncService.syncLedger(data);
      case hyperliquidJobNames.positionSnapshot:
      case hyperliquidJobNames.currentStateSnapshot:
        return this.syncService.snapshotPositions(data);
      case hyperliquidJobNames.portfolioSnapshot:
        return this.syncService.snapshotPortfolio(data);
      case hyperliquidJobNames.historicalOrdersSync:
        return this.syncService.syncHistoricalOrders(data);
      case hyperliquidJobNames.gapRecovery:
        return this.syncService.recoverGap(data);
      case hyperliquidJobNames.dataQualityAudit:
        return this.syncService.auditDataQuality(data);
      case hyperliquidJobNames.websocketListener:
        return this.startWebSocket(data);
    }
  }

  private async startWebSocket(
    data: HyperliquidJobData,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (!this.isSchedulerLeader()) {
      this.logger.info(
        { walletAddress: data.walletAddress },
        "Deferred WebSocket listener to the scheduler leader",
      );
      return { delegatedToSchedulerLeader: true, listening: false };
    }
    await this.websocketSupervisor.ensureWallet({
      address: data.walletAddress,
      id: data.walletAddressId,
    });
    this.logger.info(
      { walletAddress: data.walletAddress },
      "Hyperliquid WebSocket listener is active",
    );
    return { listening: true };
  }
}

function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function suppressImmediateLockRetry(error: SyncLockUnavailableError): UnrecoverableError {
  return new UnrecoverableError(
    `${error.message} Immediate BullMQ retries are suppressed; a later scheduler tick may enqueue fresh work.`,
  );
}
