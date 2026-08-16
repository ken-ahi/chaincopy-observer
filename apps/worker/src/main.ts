import { HyperliquidClient, WeightedRateLimiter } from "@chaincopy/blockchain-adapters";
import { createLogger, errorDetails, loadRootEnvironment, readWorkerEnv } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import {
  hyperliquidCandidateQueueName,
  hyperliquidDiscoveryJobNames,
  hyperliquidDiscoveryQueueName,
  hyperliquidQueueName,
  performanceQueueName,
  systemJobNames,
  type HyperliquidDiscoveryJobData,
  type HyperliquidJobData,
  type PerformanceJobData,
} from "@chaincopy/domain";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { startHealthServer } from "./health-server.js";
import { CandidateEnrichmentService } from "./hyperliquid/discovery/enrichment-service.js";
import { HyperliquidDiscoveryJobProcessor } from "./hyperliquid/discovery/processor.js";
import { HyperliquidDiscoveryRepository } from "./hyperliquid/discovery/repository.js";
import { createDiscoveryRuntimePolicy } from "./hyperliquid/discovery/runtime-policy.js";
import { HyperliquidDiscoveryScheduler } from "./hyperliquid/discovery/scheduler.js";
import { HyperliquidDiscoveryWebSocketSupervisor } from "./hyperliquid/discovery/websocket-supervisor.js";
import { KeyedSerialExecutor } from "./hyperliquid/keyed-serial-executor.js";
import { HyperliquidJobProcessor } from "./hyperliquid/processor.js";
import { HyperliquidRepository } from "./hyperliquid/repository.js";
import { HyperliquidScheduler } from "./hyperliquid/scheduler.js";
import { HyperliquidSyncService } from "./hyperliquid/sync-service.js";
import { HyperliquidWebSocketSupervisor } from "./hyperliquid/websocket-supervisor.js";
import { PerformanceJobProcessor } from "./performance/processor.js";
import { PerformanceRepository } from "./performance/repository.js";
import { PerformanceCalculationService } from "./performance/service.js";
import { PerformanceJobScheduler } from "./performance/scheduler.js";
import {
  enqueueSampleHealthJob,
  sampleJobId,
  systemQueueName,
  type SampleHealthJobData,
} from "./sample-job.js";

loadRootEnvironment();

const env = readWorkerEnv();
const discoveryRuntime = createDiscoveryRuntimePolicy(env.HYPERLIQUID_DISCOVERY_ENABLED);
const logger = createLogger("worker", env.LOG_LEVEL);
const redis = new Redis(env.REDIS_URL, {
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
});
redis.on("error", (error) => {
  logger.error({ error: errorDetails(error) }, "Worker Redis connection error");
});
redis.on("reconnecting", (delay: number) => {
  logger.warn({ delay }, "Worker Redis connection is reconnecting");
});
redis.on("ready", () => {
  logger.info("Worker Redis connection is ready");
});

const systemQueue = new Queue<SampleHealthJobData>(systemQueueName, {
  connection: redis,
});
const hyperliquidQueue = new Queue<HyperliquidJobData>(hyperliquidQueueName, {
  connection: redis,
});
const discoveryQueue = new Queue<HyperliquidDiscoveryJobData>(hyperliquidDiscoveryQueueName, {
  connection: redis,
});
const candidateQueue = new Queue<HyperliquidDiscoveryJobData>(hyperliquidCandidateQueueName, {
  connection: redis,
});
const performanceQueue = new Queue<PerformanceJobData>(performanceQueueName, {
  connection: redis,
});

await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);

const sourceKey = `hyperliquid-${env.HYPERLIQUID_NETWORK}`;
const sourceName = `Hyperliquid ${env.HYPERLIQUID_NETWORK === "mainnet" ? "Mainnet" : "Testnet"}`;
const hyperliquidRepository = new HyperliquidRepository(prisma, sourceKey, sourceName);
const sourceId = await hyperliquidRepository.ensureSource();
const discoveryRepository = new HyperliquidDiscoveryRepository(prisma, sourceId);
await discoveryRepository.ensureInfrastructure({
  enabled: env.HYPERLIQUID_DISCOVERY_ENABLED,
  minimumEnrichmentIntervalMin: env.HYPERLIQUID_DISCOVERY_MIN_ENRICHMENT_INTERVAL_MIN,
  minimumObservedNotionalUsd: env.HYPERLIQUID_DISCOVERY_MIN_NOTIONAL_USD,
  minimumObservedTradeCount: env.HYPERLIQUID_DISCOVERY_MIN_TRADES,
  mode: env.HYPERLIQUID_DISCOVERY_MODE,
  priorityCoins: env.HYPERLIQUID_DISCOVERY_PRIORITY_COINS,
  recentActivityHours: env.HYPERLIQUID_DISCOVERY_RECENT_HOURS,
});
const recoveredOrphanedEnrichmentAttempts =
  await discoveryRepository.closeOrphanedEnrichmentAttempts();
if (recoveredOrphanedEnrichmentAttempts > 0) {
  logger.warn(
    { recoveredAttempts: recoveredOrphanedEnrichmentAttempts },
    "Recovered orphaned candidate enrichment attempts",
  );
}
const rateLimiter = new WeightedRateLimiter(
  env.HYPERLIQUID_API_WEIGHT_PER_MINUTE,
  60_000,
  undefined,
  (usage) => discoveryRepository.recordApiUsage(usage),
);
const hyperliquidClient = new HyperliquidClient(env.HYPERLIQUID_API_URL, {
  defaultPriority: 0,
  rateLimiter,
  timeoutMs: env.HYPERLIQUID_HTTP_TIMEOUT_MS,
});
const candidateClient = new HyperliquidClient(env.HYPERLIQUID_API_URL, {
  defaultPriority: 10,
  rateLimiter,
  timeoutMs: env.HYPERLIQUID_HTTP_TIMEOUT_MS,
});
const websocketSupervisor = new HyperliquidWebSocketSupervisor(
  env.HYPERLIQUID_WS_URL,
  hyperliquidRepository,
  hyperliquidQueue,
  logger,
);
const syncService = new HyperliquidSyncService(hyperliquidClient, hyperliquidRepository, logger);
const scheduler = new HyperliquidScheduler(
  prisma,
  redis,
  hyperliquidQueue,
  websocketSupervisor,
  sourceKey,
  Math.min(
    env.HYPERLIQUID_FILL_SYNC_INTERVAL_MS ?? env.HYPERLIQUID_SYNC_INTERVAL_MS,
    env.HYPERLIQUID_ACCOUNT_SYNC_INTERVAL_MS,
    env.HYPERLIQUID_PORTFOLIO_SYNC_INTERVAL_MS,
    env.HYPERLIQUID_ORDER_HISTORY_SYNC_INTERVAL_MS,
    env.HYPERLIQUID_DATA_QUALITY_AUDIT_INTERVAL_MS,
  ),
  {
    accountMs: env.HYPERLIQUID_ACCOUNT_SYNC_INTERVAL_MS,
    auditMs: env.HYPERLIQUID_DATA_QUALITY_AUDIT_INTERVAL_MS,
    backlogLimit: env.HYPERLIQUID_QUEUE_BACKLOG_LIMIT,
    fillMs: env.HYPERLIQUID_FILL_SYNC_INTERVAL_MS ?? env.HYPERLIQUID_SYNC_INTERVAL_MS,
    orderHistoryMs: env.HYPERLIQUID_ORDER_HISTORY_SYNC_INTERVAL_MS,
    portfolioMs: env.HYPERLIQUID_PORTFOLIO_SYNC_INTERVAL_MS,
  },
  logger,
);
const discoverySupervisor = new HyperliquidDiscoveryWebSocketSupervisor(
  env.HYPERLIQUID_WS_URL,
  hyperliquidClient,
  discoveryRepository,
  discoveryQueue,
  logger,
  {
    maximumReconnectAttempts: env.HYPERLIQUID_DISCOVERY_MAX_RECONNECT_ATTEMPTS,
  },
);
const candidateEnrichmentService = new CandidateEnrichmentService(
  candidateClient,
  discoveryRepository,
  logger,
);
const discoveryScheduler = new HyperliquidDiscoveryScheduler(
  discoveryRepository,
  discoveryQueue,
  candidateQueue,
  discoverySupervisor,
  sourceKey,
  env.HYPERLIQUID_DISCOVERY_SCHEDULER_INTERVAL_MS,
  () => scheduler.hasLeadership(),
  logger,
);
const hyperliquidProcessor = new HyperliquidJobProcessor(
  prisma,
  redis,
  hyperliquidQueue,
  syncService,
  websocketSupervisor,
  sourceId,
  () => scheduler.hasLeadership(),
  new PerformanceJobScheduler(prisma, performanceQueue),
  logger,
);
const hyperliquidSyncSerialExecutor = new KeyedSerialExecutor();
const discoveryProcessor = new HyperliquidDiscoveryJobProcessor(
  prisma,
  discoveryQueue,
  candidateQueue,
  hyperliquidQueue,
  discoveryRepository,
  candidateEnrichmentService,
  discoverySupervisor,
  sourceId,
  () => scheduler.hasLeadership(),
  new Set(env.HYPERLIQUID_DISCOVERY_KNOWN_SYSTEM_ADDRESSES.map((address) => address.toLowerCase())),
  logger,
);
const performanceRepository = new PerformanceRepository(prisma);
const performanceService = new PerformanceCalculationService(performanceRepository);
const performanceProcessor = new PerformanceJobProcessor(performanceService, logger);

const systemWorker = new Worker<SampleHealthJobData>(
  systemQueueName,
  async (job: Job<SampleHealthJobData>) => {
    if (job.name !== systemJobNames.sampleHealthCheck) {
      throw new Error(`Unsupported job: ${job.name}`);
    }

    const existing = await prisma.syncJob.findUnique({
      where: { idempotencyKey: sampleJobId },
      select: { status: true },
    });
    if (existing?.status === "SUCCEEDED") {
      logger.info({ jobId: job.id }, "Skipped an already completed sample job");
      return { duplicate: true };
    }

    await prisma.syncJob.upsert({
      where: { idempotencyKey: sampleJobId },
      update: {
        attempt: { increment: 1 },
        errorMessage: null,
        queueJobId: job.id ?? sampleJobId,
        startedAt: new Date(),
        status: "RUNNING",
      },
      create: {
        attempt: 1,
        idempotencyKey: sampleJobId,
        jobName: job.name,
        queueJobId: job.id ?? sampleJobId,
        queueName: systemQueueName,
        startedAt: new Date(),
        status: "RUNNING",
      },
    });

    try {
      const [, redisResponse] = await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
      if (redisResponse !== "PONG") {
        throw new Error("Redis ping did not return PONG");
      }

      await prisma.syncJob.update({
        where: { idempotencyKey: sampleJobId },
        data: {
          finishedAt: new Date(),
          metadata: {
            database: "up",
            phase: 1,
            redis: "up",
            schemaVersion: job.data.schemaVersion,
          },
          status: "SUCCEEDED",
        },
      });

      logger.info({ jobId: job.id }, "Sample health job completed");
      return { database: "up", redis: "up" };
    } catch (error) {
      await prisma.syncJob.update({
        where: { idempotencyKey: sampleJobId },
        data: {
          errorMessage: errorDetails(error).message,
          finishedAt: new Date(),
          status: "FAILED",
        },
      });
      throw error;
    }
  },
  {
    connection: redis,
    concurrency: 2,
  },
);

systemWorker.on("failed", (job, error) => {
  logger.error(
    {
      error: errorDetails(error),
      jobId: job?.id,
    },
    "System worker job failed",
  );
});
systemWorker.on("error", (error) => {
  logger.error({ error: errorDetails(error) }, "System BullMQ worker error");
});

const hyperliquidWorker = new Worker<HyperliquidJobData>(
  hyperliquidQueueName,
  (job) =>
    hyperliquidSyncSerialExecutor.run(job.data.walletAddressId, () =>
      hyperliquidProcessor.process(job),
    ),
  {
    connection: redis,
    concurrency: env.HYPERLIQUID_WORKER_CONCURRENCY,
  },
);

hyperliquidWorker.on("completed", (job) => {
  logger.debug({ jobId: job.id, jobName: job.name }, "Hyperliquid BullMQ job acknowledged");
});
hyperliquidWorker.on("failed", (job, error) => {
  const attempts = job?.opts.attempts ?? 1;
  const attemptsMade = job?.attemptsMade ?? attempts;
  const context = {
    attempts,
    attemptsMade,
    error: errorDetails(error),
    jobId: job?.id,
    jobName: job?.name,
    retryScheduled: isRetryScheduled(error, attemptsMade, attempts),
  };
  if (context.retryScheduled) {
    logger.warn(context, "Hyperliquid BullMQ job failed; retry scheduled");
    return;
  }
  logger.error(context, "Hyperliquid BullMQ job exhausted retries");
});
hyperliquidWorker.on("stalled", (jobId) => {
  logger.warn({ jobId }, "Hyperliquid BullMQ job stalled");
});
hyperliquidWorker.on("error", (error) => {
  logger.error({ error: errorDetails(error) }, "Hyperliquid BullMQ worker error");
});

const discoveryWorker = discoveryRuntime.discoveryConsumer
  ? new Worker<HyperliquidDiscoveryJobData>(
      hyperliquidDiscoveryQueueName,
      (job) => discoveryProcessor.process(job),
      {
        connection: redis,
        concurrency: env.HYPERLIQUID_DISCOVERY_WORKER_CONCURRENCY,
      },
    )
  : null;

if (discoveryWorker) {
  discoveryWorker.on("failed", (job, error) => {
    const attempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? attempts;
    logger.error(
      {
        attempts,
        attemptsMade,
        error: errorDetails(error),
        jobId: job?.id,
        jobName: job?.name,
        retryScheduled: isRetryScheduled(error, attemptsMade, attempts),
      },
      "Hyperliquid discovery BullMQ job failed",
    );
    recoverInterruptedCandidateEnrichment(job, error);
  });
  discoveryWorker.on("error", (error) => {
    logger.error({ error: errorDetails(error) }, "Hyperliquid discovery BullMQ worker error");
  });
}

const candidateWorker = discoveryRuntime.candidateConsumer
  ? new Worker<HyperliquidDiscoveryJobData>(
      hyperliquidCandidateQueueName,
      (job) => discoveryProcessor.process(job, hyperliquidCandidateQueueName),
      {
        connection: redis,
        concurrency: env.HYPERLIQUID_DISCOVERY_ENRICHMENT_CONCURRENCY,
      },
    )
  : null;

if (candidateWorker) {
  candidateWorker.on("failed", (job, error) => {
    const attempts = job?.opts.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? attempts;
    logger.error(
      {
        attempts,
        attemptsMade,
        error: errorDetails(error),
        jobId: job?.id,
        jobName: job?.name,
        retryScheduled: isRetryScheduled(error, attemptsMade, attempts),
      },
      "Hyperliquid candidate BullMQ job failed",
    );
    recoverInterruptedCandidateEnrichment(job, error);
  });
  candidateWorker.on("error", (error) => {
    logger.error({ error: errorDetails(error) }, "Hyperliquid candidate BullMQ worker error");
  });
}

const performanceWorker = new Worker<PerformanceJobData>(
  performanceQueueName,
  (job) => performanceProcessor.process(job),
  {
    connection: redis,
    concurrency: 1,
  },
);

performanceWorker.on("failed", (job, error) => {
  const attempts = job?.opts.attempts ?? 1;
  const attemptsMade = job?.attemptsMade ?? attempts;
  logger.error(
    {
      attempts,
      attemptsMade,
      error: errorDetails(error),
      jobId: job?.id,
      jobName: job?.name,
      retryScheduled: isRetryScheduled(error, attemptsMade, attempts),
    },
    "Address performance BullMQ job failed",
  );
});
performanceWorker.on("error", (error) => {
  logger.error({ error: errorDetails(error) }, "Address performance BullMQ worker error");
});

function recoverInterruptedCandidateEnrichment(
  job: Job<HyperliquidDiscoveryJobData> | undefined,
  error: Error,
): void {
  if (
    job?.name !== hyperliquidDiscoveryJobNames.candidateEnrichment ||
    job.data.kind !== "candidate"
  ) {
    return;
  }
  const candidateId = job.data.candidateId;
  void discoveryRepository
    .failInterruptedEnrichment(candidateId, error.message)
    .then((recovered) => {
      if (recovered) {
        logger.warn(
          {
            candidateId,
            error: errorDetails(error),
            jobId: job.id,
          },
          "Recovered interrupted candidate enrichment state",
        );
      }
    })
    .catch((recoveryError: unknown) => {
      logger.error(
        {
          candidateId,
          error: errorDetails(recoveryError),
          jobId: job.id,
        },
        "Failed to recover interrupted candidate enrichment state",
      );
    });
}

function isRetryScheduled(error: Error, attemptsMade: number, attempts: number): boolean {
  return error.name !== "UnrecoverableError" && attemptsMade < attempts;
}

const healthServer = await startHealthServer({
  database: prisma,
  logger,
  port: env.WORKER_HEALTH_PORT,
  redis,
});

const queuedJobId = await enqueueSampleHealthJob(systemQueue);
await scheduler.start();
if (discoveryRuntime.scheduler && discoveryRuntime.marketWebSocket) {
  await discoveryScheduler.start();
} else {
  logger.info(
    {
      queues: [hyperliquidDiscoveryQueueName, hyperliquidCandidateQueueName],
    },
    "Hyperliquid discovery runtime disabled; scheduler, WebSocket, and consumers not started",
  );
}
logger.info(
  {
    healthPort: env.WORKER_HEALTH_PORT,
    jobId: queuedJobId,
    queues: [
      systemQueueName,
      hyperliquidQueueName,
      ...(discoveryRuntime.discoveryConsumer && discoveryRuntime.candidateConsumer
        ? [hyperliquidDiscoveryQueueName, hyperliquidCandidateQueueName]
        : []),
      performanceQueueName,
    ],
    sourceKey,
  },
  "Worker started",
);

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, "Stopping worker");

  let shutdownFailed = false;
  const close = async (
    component: string,
    operation: () => Promise<unknown>,
    waitsForInFlightJobs = false,
  ): Promise<void> => {
    const startedAt = Date.now();
    if (waitsForInFlightJobs) {
      logger.info({ component }, "Closing BullMQ worker; waiting for in-flight jobs to finish");
    }
    try {
      await operation();
      logger.info(
        { component, durationMs: Date.now() - startedAt, waitsForInFlightJobs },
        "Worker shutdown step completed",
      );
    } catch (error) {
      shutdownFailed = true;
      logger.error({ component, error: errorDetails(error) }, "Worker shutdown step failed");
    }
  };

  await close("health-server", () => closeServer());
  await close("hyperliquid-scheduler", () => scheduler.stop());
  if (discoveryRuntime.scheduler) {
    await close("hyperliquid-discovery-scheduler", () => discoveryScheduler.stop());
  }
  await close("hyperliquid-worker", () => hyperliquidWorker.close(), true);
  if (discoveryWorker) {
    await close("hyperliquid-discovery-worker", () => discoveryWorker.close(), true);
  }
  if (candidateWorker) {
    await close("hyperliquid-candidate-worker", () => candidateWorker.close(), true);
  }
  await close("performance-worker", () => performanceWorker.close(), true);
  await close("system-worker", () => systemWorker.close(), true);
  await close("performance-queue", () => performanceQueue.close());
  await close("hyperliquid-candidate-queue", () => candidateQueue.close());
  await close("hyperliquid-discovery-queue", () => discoveryQueue.close());
  await close("hyperliquid-queue", () => hyperliquidQueue.close());
  await close("system-queue", () => systemQueue.close());
  await close("redis", async () => {
    if (redis.status !== "end") {
      await redis.quit();
    }
  });
  await close("database", () => disconnectDatabase());

  if (shutdownFailed) {
    process.exitCode = 1;
  }
  logger.info({ shutdownFailed, signal }, "Worker stopped");
}

function closeServer(): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    healthServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
