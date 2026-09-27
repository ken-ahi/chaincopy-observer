import { randomUUID } from "node:crypto";
import { behaviorEventFingerprint } from "@chaincopy/analytics";
import { PrismaClient } from "@chaincopy/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedTargets } from "../../../tests/isolated-targets.mjs";
import { PrismaBehaviorAggregationService } from "./behavior-aggregation-service.js";

const { databaseUrl } = isolatedTargets(process.env, "TEST");
const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const service = new PrismaBehaviorAggregationService(database);
const prefix = `aggregation-${randomUUID()}`;
const walletId = `${prefix}-wallet`;
const selectionId = `${prefix}-selection`;
const runId = `${prefix}-run`;
const performanceId = `${prefix}-performance`;
const start = "2026-01-01T00:00:00.000Z";
const next = "2026-01-01T00:15:00.000Z";
const end = new Date("2026-01-02T00:00:00.000Z");
let sourceId: string;
let priorSelectionId: string | null = null;

async function addEvent(suffix: string, occurredAt = start) {
  const id = `${prefix}-${suffix}`;
  await database.normalizedTrade.create({
    data: {
      id,
      sourceId,
      walletAddressId: walletId,
      externalTradeId: id,
      fingerprint: id,
      coin: "BTC",
      side: "BUY",
      direction: "Open Long",
      price: "0.1",
      size: "1",
      startPosition: "0",
      fee: "0",
      feeToken: "USDC",
      closedPnl: "0",
      crossed: true,
      orderId: id,
      transactionHash: id,
      occurredAt: new Date(occurredAt),
    },
  });
  await database.selectedWalletBehaviorEvent.create({
    data: {
      id,
      fingerprint: behaviorEventFingerprint({ sourceEventId: id, sourceOrdinal: 0 }),
      behaviorVersion: "behavior-v1",
      eventType: "POSITION_OPEN",
      direction: "LONG",
      walletAddressId: walletId,
      sourceId,
      coin: "BTC",
      occurredAt: new Date(occurredAt),
      beforePosition: "0",
      afterPosition: "1",
      quantityDelta: "1",
      notionalDeltaUsd: "0.1",
      sourceEventId: id,
      sourceOrdinal: 0,
      sourcePrice: "0.1",
      sourceQuantity: "1",
      normalizationRunId: runId,
    },
  });
}

describe.sequential("aggregation isolated persistence", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    const source = await database.dataSource.upsert({
      where: { key: "hyperliquid-mainnet" },
      update: {},
      create: { key: "hyperliquid-mainnet", kind: "HYPERLIQUID", name: "Isolated tests" },
    });
    sourceId = source.id;
    priorSelectionId =
      (await database.walletSelectionSettings.findUnique({ where: { sourceId } }))
        ?.currentSelectionRunId ?? null;
    await database.walletAddress.create({
      data: { id: walletId, address: `0x${randomUUID().replaceAll("-", "")}12345678`, sourceId },
    });
    await database.metricCalculationRun.create({
      data: {
        id: performanceId,
        walletAddressId: walletId,
        calculationVersion: "performance-v3",
        calculationFrom: new Date(start),
        calculationTo: end,
        requestedAt: end,
        requestedBy: "isolated-test",
        status: "SUCCEEDED",
        historyCompleteness: "COMPLETE",
        inputFingerprint: prefix,
        deduplicationKey: prefix,
      },
    });
    await database.walletSelectionRun.create({
      data: {
        id: selectionId,
        sourceId,
        policyVersion: "wallet-selection-v2",
        inputFingerprint: prefix,
        policySnapshot: {},
        evaluatedAt: end,
        universeCount: 1,
        selectedCount: 1,
        qualifiedCount: 0,
        reviewCount: 0,
        excludedCount: 0,
        results: {
          create: {
            walletAddressId: walletId,
            performanceRunId: performanceId,
            automaticStatus: "SELECTED",
          },
        },
      },
    });
    await database.walletSelectionSettings.upsert({
      where: { sourceId },
      create: { sourceId, currentSelectionRunId: selectionId },
      update: { currentSelectionRunId: selectionId },
    });
    // BLOCKED originating run can contain valid committed prefix groups.
    await database.behaviorNormalizationRun.create({
      data: {
        id: runId,
        behaviorVersion: "behavior-v1",
        walletAddressId: walletId,
        sourceId,
        coin: "BTC",
        calculationFrom: new Date(start),
        calculationTo: end,
        inputFingerprint: prefix,
        status: "BLOCKED",
      },
    });
    await database.behaviorSelectionScope.create({
      data: {
        selectionRunId: selectionId,
        walletAddressId: walletId,
        performanceRunId: performanceId,
        behaviorNormalizationRunId: runId,
        evaluatedAt: end,
        processedAt: end,
      },
    });
    await database.behaviorNormalizationCursor.create({
      data: {
        walletAddressId: walletId,
        coin: "BTC",
        behaviorVersion: "behavior-v1",
        lastCompletedTimestamp: end,
        boundaryAfterPosition: "0",
        normalizationRunId: runId,
      },
    });
    await database.syncCursor.create({
      data: {
        walletAddressId: walletId,
        sourceId,
        scope: "fills",
        cursorType: "timestamp",
        status: "SUCCEEDED",
        lastSuccessfulAt: end,
        lastTimestamp: end,
      },
    });
    await addEvent("a");
    await addEvent("b", next);
  });
  afterAll(async () => {
    // Exact UUID fixture cleanup on the guarded isolated service only.
    await database.behaviorAggregationBucket.updateMany({
      where: { selectionRunId: selectionId },
      data: { currentRevisionId: null },
    });
    await database.behaviorAggregationRevision.deleteMany({
      where: { bucket: { selectionRunId: selectionId } },
    });
    await database.behaviorAggregationBucket.deleteMany({ where: { selectionRunId: selectionId } });
    await database.behaviorDataQualityIssue.deleteMany({ where: { walletAddressId: walletId } });
    await database.selectedWalletBehaviorEvent.deleteMany({ where: { walletAddressId: walletId } });
    await database.behaviorNormalizationCursor.deleteMany({ where: { walletAddressId: walletId } });
    await database.behaviorSelectionScope.deleteMany({ where: { walletAddressId: walletId } });
    await database.behaviorNormalizationRun.deleteMany({ where: { walletAddressId: walletId } });
    await database.walletSelectionSettings.update({
      where: { sourceId },
      data: { currentSelectionRunId: priorSelectionId },
    });
    await database.walletSelectionRun.deleteMany({ where: { id: selectionId } });
    await database.walletAddress.deleteMany({ where: { id: walletId } });
    await database.$disconnect();
  });
  it("persists reproducible receipts and repeated processing changes no row", async () => {
    const dry = await service.processBucket("BTC", start);
    expect(dry.status).toBe("VALID");
    await service.processBucket("BTC", start, true);
    await service.processBucket("BTC", next, true);
    const before = await database.behaviorAggregationBucket.findMany({
      where: { selectionRunId: selectionId },
      include: { revisions: true },
      orderBy: { id: "asc" },
    });
    await service.processBucket("BTC", start, true);
    expect(
      await database.behaviorAggregationBucket.findMany({
        where: { selectionRunId: selectionId },
        include: { revisions: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(await service.plan("BTC", start, "2026-01-01T00:30:00.000Z")).toEqual([start, next]);
  });
  it("suppresses stale totals, appends late revision and preserves other bucket", async () => {
    const unaffected = await database.behaviorAggregationBucket.findFirstOrThrow({
      where: { selectionRunId: selectionId, bucketStart: new Date(next) },
      include: { revisions: true },
    });
    await addEvent("late");
    expect((await service.read("BTC", start, next)).items[0]).toMatchObject({
      status: "STALE",
      totals: null,
    });
    const result = await service.processBucket("BTC", start, true);
    expect(result).toMatchObject({
      status: "VALID",
      totals: { eventCount: 2, uniqueWalletCount: 1, notionalUsd: "0.2" },
    });
    expect(
      await database.behaviorAggregationBucket.findUnique({
        where: { id: unaffected.id },
        include: { revisions: true },
      }),
    ).toEqual(unaffected);
  });
  it("isolates coin DQ, blocks relevant DQ, and reuses A after A→B→A", async () => {
    const original = await service.processBucket("BTC", start, true);
    const dq = await database.behaviorDataQualityIssue.create({
      data: {
        fingerprint: prefix,
        walletAddressId: walletId,
        sourceId,
        coin: "ETH",
        behaviorVersion: "behavior-v1",
        reason: "UNSUPPORTED_QUOTE",
        normalizationRunId: runId,
        detail: "isolated fixture",
      },
    });
    expect(await service.processBucket("BTC", start, true)).toEqual(original);
    await database.behaviorDataQualityIssue.update({ where: { id: dq.id }, data: { coin: "BTC" } });
    expect((await service.read("BTC", start, next)).items[0]).toMatchObject({
      status: "STALE",
      totals: null,
    });
    expect(await service.processBucket("BTC", start, true)).toMatchObject({
      status: "BLOCKED",
      totals: null,
    });
    await database.behaviorDataQualityIssue.delete({ where: { id: dq.id } });
    expect(await service.processBucket("BTC", start, true)).toEqual(original);
  });
  it("rejects missing source legs and distinguishes unknown coin from empty", async () => {
    expect(await service.processBucket("ETH", start)).toMatchObject({
      status: "BLOCKED",
      totals: null,
    });
    expect(await service.processBucket("BTC", "2026-01-01T01:00:00.000Z")).toMatchObject({
      status: "EMPTY",
    });
    const id = `${prefix}-late`;
    const original = await database.selectedWalletBehaviorEvent.findUniqueOrThrow({
      where: { id },
    });
    await database.selectedWalletBehaviorEvent.delete({ where: { id } });
    expect(await service.processBucket("BTC", start)).toMatchObject({ status: "BLOCKED" });
    await database.selectedWalletBehaviorEvent.create({ data: original });
  });
  it("returns a no-op with no current Selection without watched fallback", async () => {
    await database.walletSelectionSettings.update({
      where: { sourceId },
      data: { currentSelectionRunId: null },
    });
    expect(await service.processBucket("BTC", start, true)).toEqual({
      status: "NO_SELECTED_WALLETS",
    });
    await database.walletSelectionSettings.update({
      where: { sourceId },
      data: { currentSelectionRunId: selectionId },
    });
  });
  it("rejects unbounded/misaligned requests", async () => {
    await expect(service.processBucket("BTC", start, true, "unexpected-cohort")).rejects.toThrow(
      "Selected cohort changed",
    );
    await expect(service.read("BTC", start, "2026-04-01T00:00:00.000Z")).rejects.toThrow();
    await expect(service.processBucket("BTC", "2026-01-01T00:00:01.000Z")).rejects.toThrow();
  });
  it("fails closed on upstream gap, incomplete cursor and failed generating evidence", async () => {
    const cursor = await database.syncCursor.findFirstOrThrow({
      where: { walletAddressId: walletId },
    });
    await database.syncCursor.update({
      where: { id: cursor.id },
      data: { status: "GAP_DETECTED" },
    });
    expect(await service.processBucket("BTC", start)).toMatchObject({ status: "BLOCKED" });
    await database.syncCursor.update({ where: { id: cursor.id }, data: { status: "SUCCEEDED" } });
    await database.behaviorNormalizationCursor.updateMany({
      where: { walletAddressId: walletId },
      data: { lastCompletedTimestamp: new Date("2025-12-31T00:00:00.000Z") },
    });
    expect(await service.processBucket("BTC", start)).toMatchObject({ status: "BLOCKED" });
    await database.behaviorNormalizationCursor.updateMany({
      where: { walletAddressId: walletId },
      data: { lastCompletedTimestamp: end },
    });
    await database.metricCalculationRun.update({
      where: { id: performanceId },
      data: { status: "FAILED" },
    });
    expect(await service.processBucket("BTC", start)).toMatchObject({ status: "BLOCKED" });
    await database.metricCalculationRun.update({
      where: { id: performanceId },
      data: { status: "SUCCEEDED" },
    });
  });
  it("concurrent repeat writers converge without duplicate receipts", async () => {
    const before = await database.behaviorAggregationRevision.count({
      where: { bucket: { selectionRunId: selectionId } },
    });
    const results = await Promise.all([
      service.processBucket("BTC", start, true),
      service.processBucket("BTC", start, true),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      await database.behaviorAggregationRevision.count({
        where: { bucket: { selectionRunId: selectionId } },
      }),
    ).toBe(before);
  });
});
