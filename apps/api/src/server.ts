import { createLogger, errorDetails, loadRootEnvironment, readApiEnv } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import {
  hyperliquidCandidateQueueName,
  hyperliquidDiscoveryQueueName,
  hyperliquidQueueName,
  performanceQueueName,
  type HyperliquidDiscoveryJobData,
  type HyperliquidJobData,
  type PerformanceJobData,
} from "@chaincopy/domain";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { PrismaAddressService } from "./address-service.js";
import { createApi } from "./app.js";
import { PrismaDiscoveryService } from "./discovery-service.js";
import { DatabaseRedisHealthService } from "./health.js";
import { PrismaPerformanceService } from "./performance-service.js";
import { PrismaWalletSelectionService } from "./wallet-selection-service.js";

loadRootEnvironment();

const env = readApiEnv();
const logger = createLogger("api", env.LOG_LEVEL);
const redis = new Redis(env.REDIS_URL, {
  enableReadyCheck: true,
  maxRetriesPerRequest: 2,
});
const healthService = new DatabaseRedisHealthService(prisma, redis);
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
const addressService = new PrismaAddressService(prisma, hyperliquidQueue);
const discoveryService = new PrismaDiscoveryService(prisma, discoveryQueue, candidateQueue);
const performanceService = new PrismaPerformanceService(prisma, performanceQueue);
const walletSelectionService = new PrismaWalletSelectionService(prisma);
const app = await createApi({
  addressService,
  discoveryService,
  env,
  healthService,
  logger,
  performanceService,
  walletSelectionService,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Stopping API");
  await app.close();
  await candidateQueue.close();
  await performanceQueue.close();
  await discoveryQueue.close();
  await hyperliquidQueue.close();
  await redis.quit();
  await disconnectDatabase();
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({
    host: env.API_HOST,
    port: env.API_PORT,
  });
  logger.info({ host: env.API_HOST, port: env.API_PORT }, "API is listening");
} catch (error) {
  logger.fatal({ error: errorDetails(error) }, "API failed to start");
  await candidateQueue.close();
  await performanceQueue.close();
  await discoveryQueue.close();
  await hyperliquidQueue.close();
  await redis.quit();
  await disconnectDatabase();
  process.exitCode = 1;
}
