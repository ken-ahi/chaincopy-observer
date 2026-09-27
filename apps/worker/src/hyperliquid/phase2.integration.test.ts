import { randomUUID } from "node:crypto";

import { fillSchema, mapFill } from "@chaincopy/blockchain-adapters";
import { loadRootEnvironment } from "@chaincopy/config";
import { PrismaClient } from "@chaincopy/database";
import { hyperliquidJobNames, type HyperliquidJobData } from "@chaincopy/domain";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AddressConflictError, PrismaAddressService } from "../../../api/src/address-service.js";
import { enqueueHyperliquidJob } from "./queue.js";
import { HyperliquidRepository } from "./repository.js";

loadRootEnvironment();

const databaseUrl = localServiceUrl(
  process.env.DATABASE_URL ??
    "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=public",
);
const redisUrl = localServiceUrl(process.env.REDIS_URL ?? "redis://127.0.0.1:6379");
const runId = randomUUID();
const sourceKey = `phase2-integration-${runId}`;
const queueName = `phase2-integration-${runId}`;
const address = `0x${runId.replaceAll("-", "").slice(0, 32)}00000000`;
const counterpartyAddress = `${address.slice(0, -1)}1`;

const database = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});
const queue = new Queue<HyperliquidJobData>(queueName, {
  connection: redis,
});

function localServiceUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "postgres" || url.hostname === "redis") {
    url.hostname = "127.0.0.1";
  }
  return url.toString();
}

describe.sequential("Phase 2 PostgreSQL and Redis integration", () => {
  beforeAll(async () => {
    await Promise.all([database.$queryRaw`SELECT 1`, redis.ping()]);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await database.walletAddress.deleteMany({
      where: { address: { in: [address, counterpartyAddress] } },
    });
    await database.dataSource.deleteMany({ where: { key: sourceKey } });
    await queue.close();
    await redis.quit();
    await database.$disconnect();
  });

  it("persists duplicate HTTP events and fills exactly once", async () => {
    const source = await database.dataSource.create({
      data: {
        enabled: true,
        key: sourceKey,
        kind: "HYPERLIQUID",
        name: "Phase 2 integration",
      },
    });
    const wallet = await database.walletAddress.create({
      data: {
        address,
        isWatched: false,
        sourceId: source.id,
      },
    });
    const repository = new HyperliquidRepository(database, sourceKey, "Phase 2 integration");
    const fill = fillSchema.parse({
      closedPnl: "0",
      coin: "BTC",
      crossed: true,
      dir: "Open Long",
      fee: "0.01",
      feeToken: "USDC",
      hash: `0x${runId}`,
      oid: "1",
      px: "100000.123456789012345678",
      side: "B",
      startPosition: "0",
      sz: "0.000000000000000001",
      tid: "2",
      time: 1_721_862_400_000,
    });

    await repository.saveRawEvent({
      eventType: "userFillsByTime",
      rawPayload: JSON.stringify([fill]),
      transport: "HTTP",
      walletAddress: address,
      walletAddressId: wallet.id,
    });
    await repository.saveRawEvent({
      eventType: "userFillsByTime",
      rawPayload: JSON.stringify([fill]),
      transport: "HTTP",
      walletAddress: address,
      walletAddressId: wallet.id,
    });
    expect(await repository.saveFills(wallet.id, address, [fill])).toBe(1);
    expect(await repository.saveFills(wallet.id, address, [fill])).toBe(0);

    const [rawEvents, fills] = await Promise.all([
      database.rawEvent.count({ where: { walletAddressId: wallet.id } }),
      database.normalizedTrade.count({ where: { walletAddressId: wallet.id } }),
    ]);
    expect({ fills, rawEvents }).toEqual({ fills: 1, rawEvents: 1 });
  });

  it("keeps cursors monotonic when an older interval completes later", async () => {
    const wallet = await database.walletAddress.findFirstOrThrow({
      where: { address, source: { key: sourceKey } },
    });
    const repository = new HyperliquidRepository(database, sourceKey, "Phase 2 integration");
    const newer = new Date("2026-07-25T12:10:00.000Z");
    const older = new Date("2026-07-25T12:05:00.000Z");

    await repository.completeCursor(wallet.id, "fills", "timestamp", newer, "newer");
    await repository.completeCursor(wallet.id, "fills", "timestamp", older, "older");

    await expect(repository.getCursor(wallet.id, "fills", "timestamp")).resolves.toEqual({
      lastExternalId: "newer",
      lastTimestamp: newer,
    });
  });

  it("retains both sides of a shared trade and preserves legacy identity on replay", async () => {
    const wallet = await database.walletAddress.findFirstOrThrow({
      where: { address, source: { key: sourceKey } },
    });
    const other = await database.walletAddress.create({
      data: { address: counterpartyAddress, sourceId: wallet.sourceId },
    });
    const repository = new HyperliquidRepository(database, sourceKey, "Phase 2 integration");
    const buy = fillSchema.parse({
      closedPnl: "0",
      coin: "BTC",
      crossed: true,
      dir: "Open Long",
      fee: "0.443467",
      feeToken: "USDC",
      hash: "0xd475fcf931aefb69d5ef044170510e02043c00decca21a3b783ea84bf0a2d554",
      oid: "509958558519",
      px: "64119.0",
      side: "B",
      startPosition: "0.0",
      sz: "0.01601",
      tid: "908928218771332",
      time: 1785858599780,
    });
    const sell = {
      ...buy,
      side: "A" as const,
      startPosition: "-3.70177",
      dir: "Open Short",
      oid: "other-order",
    };
    const legacy = await database.normalizedTrade.create({
      data: {
        ...mapFill(counterpartyAddress, sell),
        externalTradeId: "1785858599780:BTC:908928218771332",
        walletAddressId: other.id,
        sourceId: wallet.sourceId,
      },
    });
    expect(await repository.saveFills(wallet.id, address, [buy, buy])).toBe(1);
    expect(await repository.saveFills(wallet.id, address, [buy])).toBe(0);
    expect(await repository.saveFills(other.id, counterpartyAddress, [sell])).toBe(0);
    expect(await database.normalizedTrade.findUniqueOrThrow({ where: { id: legacy.id } })).toEqual(
      legacy,
    );
    const rows = await database.normalizedTrade.findMany({
      where: { sourceId: wallet.sourceId, sourceTradeId: buy.tid },
    });
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.walletAddressId === wallet.id)).toMatchObject({
      externalTradeId: `${address}:1785858599780:BTC:908928218771332`,
      side: "BUY",
    });
  });

  it("deduplicates BullMQ scheduling and keeps manual sync requests distinct", async () => {
    const data: HyperliquidJobData = {
      requestedAt: "2026-07-25T12:00:00.000Z",
      walletAddress: address,
      walletAddressId: `wallet-${runId}`,
    };
    const first = await enqueueHyperliquidJob(queue, hyperliquidJobNames.fillSync, data);
    const duplicate = await enqueueHyperliquidJob(queue, hyperliquidJobNames.fillSync, data);

    expect(duplicate).toBe(first);
    expect(await queue.getJobCounts("waiting", "prioritized")).toMatchObject({
      prioritized: 1,
      waiting: 0,
    });

    const service = new PrismaAddressService(database, queue);
    const mainnetSource = await database.dataSource.upsert({
      create: {
        enabled: true,
        key: "hyperliquid-mainnet",
        kind: "HYPERLIQUID",
        name: "Hyperliquid Mainnet",
      },
      update: {},
      where: { key: "hyperliquid-mainnet" },
    });
    await database.walletAddress.create({
      data: { address, isWatched: false, sourceId: mainnetSource.id },
    });
    await expect(service.setWatch(address, true)).resolves.toMatchObject({
      isWatched: true,
    });
    await expect(service.setWatch(address, false)).resolves.toMatchObject({
      isWatched: false,
    });
    const firstManual = await service.enqueueSync(address);
    const secondManual = await service.enqueueSync(address);

    expect(secondManual.jobId).not.toBe(firstManual.jobId);
    await expect(service.createAddress({ address, isWatched: false })).rejects.toBeInstanceOf(
      AddressConflictError,
    );
  });
});
