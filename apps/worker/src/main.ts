import { HyperliquidClient } from "@chaincopy/blockchain-adapters";
import { createLogger, errorDetails, loadRootEnvironment, readWorkerEnv } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import { hyperliquidQueueName, systemJobNames, type HyperliquidJobData } from "@chaincopy/domain";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { startHealthServer } from "./health-server.js";
import { HyperliquidJobProcessor } from "./hyperliquid/processor.js";
import { HyperliquidRepository } from "./hyperliquid/repository.js";
import { HyperliquidScheduler } from "./hyperliquid/scheduler.js";
import { HyperliquidSyncService } from "./hyperliquid/sync-service.js";
import { HyperliquidWebSocketSupervisor } from "./hyperliquid/websocket-supervisor.js";
import {
  enqueueSampleHealthJob,
  sampleJobId,
  systemQueueName,
  type SampleHealthJobData,
} from "./sample-job.js";

loadRootEnvironment();

const env = readWorkerEnv();
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

await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);

const sourceKey = `hyperliquid-${env.HYPERLIQUID_NETWORK}`;
const sourceName = `Hyperliquid ${env.HYPERLIQUID_NETWORK === "mainnet" ? "Mainnet" : "Testnet"}`;
const hyperliquidRepository = new HyperliquidRepository(prisma, sourceKey, sourceName);
const sourceId = await hyperliquidRepository.ensureSource();
const hyperliquidClient = new HyperliquidClient(env.HYPERLIQUID_API_URL, {
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
  env.HYPERLIQUID_SYNC_INTERVAL_MS,
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
  logger,
);

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
  (job) => hyperliquidProcessor.process(job),
  {
    connection: redis,
    concurrency: 4,
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
    retryScheduled: attemptsMade < attempts,
  };
  if (attemptsMade < attempts) {
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

const healthServer = await startHealthServer({
  database: prisma,
  logger,
  port: env.WORKER_HEALTH_PORT,
  redis,
});

const queuedJobId = await enqueueSampleHealthJob(systemQueue);
await scheduler.start();
logger.info(
  {
    healthPort: env.WORKER_HEALTH_PORT,
    jobId: queuedJobId,
    queues: [systemQueueName, hyperliquidQueueName],
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
  const close = async (component: string, operation: () => Promise<unknown>): Promise<void> => {
    try {
      await operation();
    } catch (error) {
      shutdownFailed = true;
      logger.error({ component, error: errorDetails(error) }, "Worker shutdown step failed");
    }
  };

  await close("health-server", () => closeServer());
  await close("hyperliquid-scheduler", () => scheduler.stop());
  await close("hyperliquid-worker", () => hyperliquidWorker.close());
  await close("system-worker", () => systemWorker.close());
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
