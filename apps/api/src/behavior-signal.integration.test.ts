import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { behaviorEventFingerprint } from "@chaincopy/analytics";
import { PrismaClient, type Prisma } from "@chaincopy/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedTargets } from "../../../tests/isolated-targets.mjs";
import { PrismaBehaviorSignalService } from "./behavior-signal-service.js";
import { PrismaBehaviorAggregationService } from "./behavior-aggregation-service.js";
import { PrismaWalletWeightService } from "./wallet-weight-service.js";

const { databaseUrl } = isolatedTargets(process.env, "TEST");
const schema = `signal_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(databaseUrl);
url.searchParams.set("schema", schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const service = new PrismaBehaviorSignalService(db);
const aggregation = new PrismaBehaviorAggregationService(db);
const weights = new PrismaWalletWeightService(db);
const start = "2026-01-01T00:00:00.000Z",
  next = "2026-01-01T00:15:00.000Z";
const end = new Date("2026-02-01T00:00:00.000Z");
const metrics = {
  winRate: "0.6",
  profitFactor: "1",
  averageWin: "1",
  averageLoss: "-1",
  topTradeContribution: "0.2",
  maxLosingStreak: "2",
};
async function addEvent(id: string, time = start) {
  await db.normalizedTrade.create({
    data: {
      id,
      sourceId: "source",
      walletAddressId: "wallet",
      externalTradeId: id,
      fingerprint: id,
      coin: "BTC",
      side: "BUY",
      direction: "Open Long",
      price: "1",
      size: "1",
      startPosition: "0",
      fee: "0",
      feeToken: "USDC",
      closedPnl: "0",
      crossed: true,
      orderId: id,
      transactionHash: id,
      occurredAt: new Date(time),
    },
  });
  await db.selectedWalletBehaviorEvent.create({
    data: {
      id,
      fingerprint: behaviorEventFingerprint({ sourceEventId: id, sourceOrdinal: 0 }),
      behaviorVersion: "behavior-v1",
      eventType: "POSITION_OPEN",
      direction: "LONG",
      walletAddressId: "wallet",
      sourceId: "source",
      coin: "BTC",
      occurredAt: new Date(time),
      beforePosition: "0",
      afterPosition: "1",
      quantityDelta: "1",
      notionalDeltaUsd: "1",
      sourceEventId: id,
      sourceOrdinal: 0,
      sourcePrice: "1",
      sourceQuantity: "1",
      normalizationRunId: "normalization",
    },
  });
}
describe.sequential("signal isolated persistence", { timeout: 30000 }, () => {
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    execFileSync(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" },
    );
    await db.dataSource.create({
      data: { id: "source", key: "hyperliquid-mainnet", kind: "HYPERLIQUID", name: "isolated" },
    });
    await db.walletAddress.create({
      data: { id: "wallet", sourceId: "source", address: `0x${"1".repeat(40)}` },
    });
    await db.metricCalculationRun.create({
      data: {
        id: "performance",
        walletAddressId: "wallet",
        calculationVersion: "performance-v3",
        calculationFrom: new Date(start),
        calculationTo: end,
        requestedAt: end,
        requestedBy: "test",
        status: "SUCCEEDED",
        historyCompleteness: "COMPLETE",
        inputFingerprint: "performance",
        deduplicationKey: "performance",
        performanceMetrics: {
          create: Object.entries(metrics).map(([metricKey, metricValue]) => ({
            walletAddressId: "wallet",
            metricKey,
            metricValue,
            precision: "DERIVED",
            status: "AVAILABLE",
            calculationFrom: new Date(start),
            calculationTo: end,
            metricVersion: "performance-v3",
          })),
        },
        positionCycles: {
          create: Array.from({ length: 30 }, (_, i) => ({
            walletAddressId: "wallet",
            coin: "BTC",
            side: "LONG",
            openedAt: new Date(start),
            closedAt: end,
            averageEntryPrice: "1",
            averageExitPrice: "2",
            entryQuantity: "1",
            exitQuantity: "1",
            grossRealizedPnl: "1",
            fees: "0",
            funding: "0",
            netRealizedPnl: "1",
            fillCount: 2,
            status: "CLOSED",
            inputFingerprint: `cycle-${i}`,
          })),
        },
      },
    });
    await db.walletSelectionRun.create({
      data: {
        id: "selection",
        sourceId: "source",
        policyVersion: "wallet-selection-v2",
        inputFingerprint: "selection",
        policySnapshot: {},
        evaluatedAt: end,
        universeCount: 1,
        selectedCount: 1,
        qualifiedCount: 0,
        reviewCount: 0,
        excludedCount: 0,
        results: {
          create: {
            walletAddressId: "wallet",
            performanceRunId: "performance",
            automaticStatus: "SELECTED",
          },
        },
      },
    });
    await db.walletSelectionSettings.create({
      data: { sourceId: "source", currentSelectionRunId: "selection" },
    });
    await db.behaviorNormalizationRun.create({
      data: {
        id: "normalization",
        behaviorVersion: "behavior-v1",
        walletAddressId: "wallet",
        sourceId: "source",
        coin: "BTC",
        calculationFrom: new Date(start),
        calculationTo: end,
        inputFingerprint: "normalization",
        status: "SUCCEEDED",
      },
    });
    await db.behaviorSelectionScope.create({
      data: {
        selectionRunId: "selection",
        walletAddressId: "wallet",
        performanceRunId: "performance",
        behaviorNormalizationRunId: "normalization",
        evaluatedAt: end,
        processedAt: end,
      },
    });
    await db.behaviorNormalizationCursor.create({
      data: {
        walletAddressId: "wallet",
        coin: "BTC",
        behaviorVersion: "behavior-v1",
        lastCompletedTimestamp: end,
        boundaryAfterPosition: "0",
        normalizationRunId: "normalization",
      },
    });
    await db.syncCursor.create({
      data: {
        walletAddressId: "wallet",
        sourceId: "source",
        scope: "fills",
        cursorType: "timestamp",
        status: "SUCCEEDED",
        lastSuccessfulAt: end,
        lastTimestamp: end,
      },
    });
    await addEvent("a");
    await addEvent("b", next);
    await aggregation.processBucket("BTC", start, true);
    await aggregation.processBucket("BTC", next, true);
  });
  afterAll(async () => {
    await db.$disconnect();
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  });
  it("requires saved trusted weights; preview never writes", async () => {
    expect(await service.read("BTC", start)).toMatchObject({
      status: "BLOCKED",
      reason: "WEIGHT_NOT_COMPUTED",
    });
    const weight = (await weights.preview())!;
    await weights.persist(weight.id);
    const preview = await service.preview("BTC", start);
    expect(preview).toMatchObject({ buyStrength: "1" });
    expect(await db.behaviorSignalSnapshot.count()).toBe(0);
    expect(await service.read("BTC", start)).toMatchObject({ status: "NOT_COMPUTED" });
  });
  it("idempotent concurrent persistence, read API and expected fingerprint guard", async () => {
    const preview = (await service.preview("BTC", start))!;
    await expect(service.persist("BTC", start, "0".repeat(64))).rejects.toThrow("INPUT_CHANGED");
    const [a, b] = await Promise.all([
      service.persist("BTC", start, preview.id),
      service.persist("BTC", start, preview.id),
    ]);
    expect(a).toEqual(b);
    expect(await db.behaviorSignalSnapshot.count()).toBe(1);
    expect(await service.read("BTC", start)).toMatchObject({
      status: "CURRENT",
      item: { buyStrength: "1", id: a!.id },
    });
    const other = (await service.preview("BTC", next))!;
    await service.persist("BTC", next, other.id);
  });
  it("late input blocks stale aggregation then appends only changed bucket revision", async () => {
    const before = await db.behaviorSignalSnapshot.findMany({ orderBy: { id: "asc" } });
    await addEvent("late");
    expect(await service.read("BTC", start)).toMatchObject({
      status: "BLOCKED",
      reason: "AGGREGATION_STALE_OR_MISSING",
    });
    await aggregation.processBucket("BTC", start, true);
    expect(await service.read("BTC", start)).toMatchObject({ status: "NOT_COMPUTED" });
    const result = (await service.preview("BTC", start))!;
    await service.persist("BTC", start, result.id);
    expect(await db.behaviorSignalSnapshot.count()).toBe(3);
    expect(
      await db.behaviorSignalSnapshot.findMany({
        where: { id: { in: before.map((x) => x.id) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(await service.read("BTC", next)).toMatchObject({ status: "CURRENT" });
  });
  it("relevant DQ blocks saved signal; no manual lifecycle side effects", async () => {
    await db.behaviorDataQualityIssue.create({
      data: {
        id: "dq",
        sourceId: "source",
        normalizationRunId: "normalization",
        detail: "isolated test history gap",
        fingerprint: "dq",
        walletAddressId: "wallet",
        coin: "BTC",
        behaviorVersion: "behavior-v1",
        reason: "HISTORY_GAP",
        sourceGroupAt: new Date(start),
      },
    });
    expect(await service.read("BTC", start)).toMatchObject({ status: "BLOCKED", item: null });
    expect(
      (await db.behaviorDataQualityIssue.findUniqueOrThrow({ where: { id: "dq" } })).status,
    ).toBe("OPEN");
    // Test fixture only, on explicit isolated schema.
    await db.behaviorDataQualityIssue.delete({ where: { id: "dq" } });
  });
  it("corrupt stored receipts fail closed; all provenance FKs restrict deletion", async () => {
    const preview = (await service.preview("BTC", start))!;
    const original = await db.behaviorSignalSnapshot.findUniqueOrThrow({
      where: { id: preview.id },
    });
    await db.behaviorSignalSnapshot.update({ where: { id: preview.id }, data: { result: {} } });
    expect(await service.read("BTC", start)).toMatchObject({
      status: "BLOCKED",
      reason: "SIGNAL_RECEIPT_MISMATCH",
    });
    await expect(service.persist("BTC", start, preview.id)).rejects.toThrow(
      "SIGNAL_RECEIPT_MISMATCH",
    );
    await db.behaviorSignalSnapshot.update({
      where: { id: preview.id },
      data: { result: original.result as Prisma.InputJsonValue },
    });
    await expect(
      db.walletWeightSnapshot.delete({ where: { id: preview.weightSnapshotId } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      db.behaviorAggregationRevision.delete({ where: { id: preview.aggregationRevisionId } }),
    ).rejects.toMatchObject({ code: "P2003" });
    const fks = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM information_schema.table_constraints WHERE table_schema=${schema} AND table_name='behavior_signal_snapshots' AND constraint_type='FOREIGN KEY'`;
    expect(fks[0]!.count).toBe(3n);
  });
  it("stale Performance or altered weights cannot be consumed", async () => {
    const metric = await db.addressPerformanceMetric.findFirstOrThrow();
    await db.addressPerformanceMetric.update({
      where: { id: metric.id },
      data: { status: "REFERENCE_ONLY" },
    });
    expect(await service.read("BTC", start)).toMatchObject({
      status: "BLOCKED",
      reason: "INVALID_PERFORMANCE_EVIDENCE",
    });
    await db.addressPerformanceMetric.update({
      where: { id: metric.id },
      data: { status: "AVAILABLE" },
    });
    const entry = await db.walletWeightEntry.findFirstOrThrow();
    await db.walletWeightEntry.update({
      where: {
        snapshotId_walletAddressId: {
          snapshotId: entry.snapshotId,
          walletAddressId: entry.walletAddressId,
        },
      },
      data: { normalizedWeight: "0.5" },
    });
    expect(await service.read("BTC", start)).toMatchObject({
      status: "BLOCKED",
      reason: "SNAPSHOT_INCONSISTENT",
    });
  });
});
