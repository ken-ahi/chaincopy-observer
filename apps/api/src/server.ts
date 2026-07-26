import { createLogger, errorDetails, loadRootEnvironment, readApiEnv } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import { hyperliquidQueueName, type HyperliquidJobData } from "@chaincopy/domain";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { PrismaAddressService } from "./address-service.js";
import { createApi } from "./app.js";
import { DatabaseRedisHealthService } from "./health.js";

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
const addressService = new PrismaAddressService(prisma, hyperliquidQueue);
const app = await createApi({ addressService, env, healthService, logger });

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Stopping API");
  await app.close();
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
  await redis.quit();
  await disconnectDatabase();
  process.exitCode = 1;
}
