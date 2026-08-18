import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { asCleanupAdapter, cleanupQueue } from "./queue-cleanup.js";
import { parseQueueCleanupOptions, queueCleanupHelp } from "./queue-cleanup-options.js";

async function main(): Promise<void> {
  const options = parseQueueCleanupOptions(process.argv.slice(2));
  if (options.help) {
    console.info(queueCleanupHelp);
    return;
  }
  const { loadRootEnvironment } = await import("@chaincopy/config");
  loadRootEnvironment();
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl?.startsWith("redis://")) throw new Error("REDIS_URL must be a redis:// URL.");
  const redis = new Redis(redisUrl, { enableReadyCheck: true, maxRetriesPerRequest: null });
  const queue = new Queue(options.queue, { connection: redis });
  const log = (event: Readonly<Record<string, unknown>>): void =>
    console.info(
      JSON.stringify({ queue: options.queue, timestamp: new Date().toISOString(), ...event }),
    );
  try {
    log({
      action: "start",
      batchSize: options.batchSize,
      before: options.before.toISOString(),
      dryRun: options.dryRun,
    });
    await cleanupQueue({ ...options, log, queue: asCleanupAdapter(queue) });
  } finally {
    await queue.close();
    await redis.quit();
  }
}

main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      action: "error",
      error:
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { message: String(error) },
      timestamp: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
});
