import { createLogger, errorDetails, loadRootEnvironment, readWorkerEnv } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import { systemJobNames } from "@chaincopy/domain";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";

import { startHealthServer } from "./health-server.js";
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
const queue = new Queue<SampleHealthJobData>(systemQueueName, {
  connection: redis,
});

const worker = new Worker<SampleHealthJobData>(
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

worker.on("failed", (job, error) => {
  logger.error(
    {
      error: errorDetails(error),
      jobId: job?.id,
    },
    "Worker job failed",
  );
});
worker.on("error", (error) => {
  logger.error({ error: errorDetails(error) }, "BullMQ worker error");
});

const healthServer = await startHealthServer({
  database: prisma,
  logger,
  port: env.WORKER_HEALTH_PORT,
  redis,
});

await prisma.$queryRaw`SELECT 1`;
await redis.ping();
const queuedJobId = await enqueueSampleHealthJob(queue);
logger.info(
  {
    healthPort: env.WORKER_HEALTH_PORT,
    jobId: queuedJobId,
    queue: systemQueueName,
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

  await new Promise<void>((resolve, reject) => {
    healthServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await worker.close();
  await queue.close();
  await redis.quit();
  await disconnectDatabase();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
