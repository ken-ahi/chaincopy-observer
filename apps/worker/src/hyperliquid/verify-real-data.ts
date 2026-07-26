import { HyperliquidClient } from "@chaincopy/blockchain-adapters";
import { createLogger, loadRootEnvironment, readWorkerEnv } from "@chaincopy/config";
import { PrismaClient } from "@chaincopy/database";
import { type HyperliquidJobData } from "@chaincopy/domain";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { HyperliquidRepository } from "./repository.js";
import { HyperliquidSyncService } from "./sync-service.js";
import { HyperliquidWebSocketSupervisor } from "./websocket-supervisor.js";

const verificationAddress =
  process.env.HYPERLIQUID_VERIFICATION_ADDRESS ?? "0x831ea8a4a4d7ea2657ba48f8c074d69bdaece05c";

loadRootEnvironment();
const rawEnv = readWorkerEnv({
  ...process.env,
  DATABASE_URL: localServiceUrl(process.env.DATABASE_URL),
  REDIS_URL: localServiceUrl(process.env.REDIS_URL),
});
const logger = createLogger("phase2-real-data-verification", rawEnv.LOG_LEVEL);
const database = new PrismaClient({
  datasources: { db: { url: rawEnv.DATABASE_URL } },
});
const redis = new Redis(rawEnv.REDIS_URL, { maxRetriesPerRequest: null });
const queueName = `phase2-real-verification-${Date.now()}`;
const queue = new Queue<HyperliquidJobData>(queueName, { connection: redis });

try {
  await Promise.all([database.$queryRaw`SELECT 1`, redis.ping()]);
  const sourceKey = `hyperliquid-${rawEnv.HYPERLIQUID_NETWORK}`;
  const repository = new HyperliquidRepository(
    database,
    sourceKey,
    `Hyperliquid ${rawEnv.HYPERLIQUID_NETWORK === "mainnet" ? "Mainnet" : "Testnet"}`,
  );
  const sourceId = await repository.ensureSource();
  if (process.env.RESET_PHASE2_VERIFICATION === "true") {
    const existing = await database.walletAddress.findUnique({
      select: { displayName: true, id: true },
      where: {
        sourceId_address: {
          address: verificationAddress,
          sourceId,
        },
      },
    });
    if (existing && existing.displayName !== "Phase 2 public verification") {
      throw new Error("Refusing to reset a verification address not owned by this script.");
    }
    if (existing) {
      await database.walletAddress.delete({ where: { id: existing.id } });
    }
  }
  const wallet = await database.walletAddress.upsert({
    create: {
      address: verificationAddress,
      displayName: "Phase 2 public verification",
      isWatched: false,
      sourceId,
    },
    update: {
      displayName: "Phase 2 public verification",
      isWatched: false,
    },
    where: {
      sourceId_address: {
        address: verificationAddress,
        sourceId,
      },
    },
  });
  const client = new HyperliquidClient(rawEnv.HYPERLIQUID_API_URL, {
    timeoutMs: rawEnv.HYPERLIQUID_HTTP_TIMEOUT_MS,
  });
  const syncService = new HyperliquidSyncService(client, repository, logger);
  const before = await counts(wallet.id);
  const firstResult = await runHttpSync(syncService, wallet.id);
  const afterFirst = await counts(wallet.id);
  const secondResult = await runHttpSync(syncService, wallet.id);
  const afterSecond = await counts(wallet.id);

  for (const key of ["fills", "funding", "ledger"] as const) {
    const inserted = resultCount(secondResult[key], "inserted");
    const countIncrease = afterSecond[key] - afterFirst[key];
    if (countIncrease !== inserted) {
      throw new Error(
        `Idempotency verification failed for ${key}: count increased by ${countIncrease}, but only ${inserted} new events were inserted.`,
      );
    }
  }

  const websocketBefore = afterSecond.websocketRawEvents;
  const websocketSupervisor = new HyperliquidWebSocketSupervisor(
    rawEnv.HYPERLIQUID_WS_URL,
    repository,
    queue,
    logger,
  );
  try {
    await websocketSupervisor.ensureWallet({
      address: verificationAddress,
      id: wallet.id,
    });
    await waitFor(async () => {
      const current = await counts(wallet.id);
      return current.websocketRawEvents > websocketBefore;
    }, 20_000);
  } finally {
    await websocketSupervisor.stop();
  }
  await database.walletAddress.update({
    data: { isWatched: true },
    where: { id: wallet.id },
  });
  const final = await counts(wallet.id);

  process.stdout.write(
    `${JSON.stringify(
      {
        address: verificationAddress,
        afterFirst,
        afterSecond,
        before,
        final,
        firstResult,
        secondResult,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await queue.obliterate({ force: true });
  await queue.close();
  await redis.quit();
  await database.$disconnect();
}

async function runHttpSync(service: HyperliquidSyncService, walletAddressId: string) {
  const requestedAt = new Date().toISOString();
  const job: HyperliquidJobData = {
    requestedAt,
    walletAddress: verificationAddress,
    walletAddressId,
  };
  const fills = await service.syncFills(job);
  const funding = await service.syncFunding(job);
  const ledger = await service.syncLedger(job);
  const snapshot = await service.snapshotPositions(job);
  const quality = await service.auditDataQuality(job);
  return { fills, funding, ledger, quality, snapshot };
}

async function counts(walletAddressId: string) {
  const [
    rawEvents,
    websocketRawEvents,
    fills,
    funding,
    ledger,
    positionEvents,
    positions,
    portfolioSnapshots,
    spotBalanceSnapshots,
    orders,
    syncJobs,
    syncCursors,
    dataQualityIssues,
  ] = await Promise.all([
    database.rawEvent.count({ where: { walletAddressId } }),
    database.rawEvent.count({
      where: { transport: "WEBSOCKET", walletAddressId },
    }),
    database.normalizedTrade.count({ where: { walletAddressId } }),
    database.fundingPayment.count({ where: { walletAddressId } }),
    database.cashFlow.count({ where: { walletAddressId } }),
    database.perpPositionEvent.count({ where: { walletAddressId } }),
    database.perpPosition.count({ where: { walletAddressId } }),
    database.portfolioSnapshot.count({ where: { walletAddressId } }),
    database.spotBalanceSnapshot.count({ where: { walletAddressId } }),
    database.orderHistory.count({ where: { walletAddressId } }),
    database.syncJob.count({ where: { walletAddressId } }),
    database.syncCursor.count({ where: { walletAddressId } }),
    database.dataQualityIssue.count({ where: { walletAddressId } }),
  ]);
  return {
    dataQualityIssues,
    fills,
    funding,
    ledger,
    orders,
    portfolioSnapshots,
    positionEvents,
    positions,
    rawEvents,
    spotBalanceSnapshots,
    syncCursors,
    syncJobs,
    websocketRawEvents,
  };
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for WebSocket data.`);
}

function localServiceUrl(value: string | undefined): string | undefined {
  if (!value) {
    return value;
  }
  const url = new URL(value);
  if (url.hostname === "postgres" || url.hostname === "redis") {
    url.hostname = "127.0.0.1";
  }
  return url.toString();
}

function resultCount(result: Readonly<Record<string, unknown>>, key: string): number {
  const value = result[key];
  if (typeof value !== "number") {
    throw new TypeError(`Expected numeric verification result ${key}.`);
  }
  return value;
}
