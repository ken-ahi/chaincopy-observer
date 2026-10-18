import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { behaviorEventFingerprint } from "@chaincopy/analytics";
import { PrismaClient, type Prisma } from "@chaincopy/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedTargets } from "../../../tests/isolated-targets.mjs";
import { PrismaDirectionChangeService } from "./direction-change-service.js";
import { PrismaBehaviorSignalService } from "./behavior-signal-service.js";
import { PrismaBehaviorAggregationService } from "./behavior-aggregation-service.js";
import { PrismaWalletWeightService } from "./wallet-weight-service.js";
import { PerformanceRunTrustService } from "./performance-run-trust.js";

const { databaseUrl } = isolatedTargets(process.env, "TEST");
const schema = `direction_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(databaseUrl);
url.searchParams.set("schema", schema);
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const signals = new PrismaBehaviorSignalService(db);
const service = new PrismaDirectionChangeService(db);
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
describe.sequential("direction-change isolated persistence", { timeout: 30000 }, () => {
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

  it("requires persisted Signals; read-only preview cannot manufacture predecessors", async () => {
    const w = (await weights.preview())!;
    await weights.persist(w.id);
    expect(await service.read("BTC", next)).toMatchObject({
      status: "BLOCKED",
      reason: "SIGNAL_NOT_COMPUTED",
    });
    for (const time of [start, next]) {
      const p = (await signals.preview("BTC", time))!;
      await signals.persist("BTC", time, p.id);
    }
    const p = await service.preview("BTC", next);
    expect(p).toMatchObject({ eventType: "NONE" });
    expect(await db.directionChangeSnapshot.count()).toBe(0);
    expect(await service.read("BTC", next)).toMatchObject({ status: "NOT_COMPUTED" });
    expect(await service.read("BTC", start)).toMatchObject({ status: "BLOCKED" });
  });
  it("expected fingerprint, concurrent idempotency, explicit NONE and saved read", async () => {
    const p = (await service.preview("BTC", next))!;
    await expect(service.persist("BTC", next, "0".repeat(64))).rejects.toThrow("INPUT_CHANGED");
    const [a, b] = await Promise.all([
      service.persist("BTC", next, p.id),
      service.persist("BTC", next, p.id),
    ]);
    expect(a).toEqual(b);
    expect(await db.directionChangeSnapshot.count()).toBe(1);
    expect(await service.read("BTC", next)).toMatchObject({
      status: "CURRENT",
      item: { id: p.id, eventType: "NONE", delta: "0" },
    });
    expect(await service.persist("BTC", next, p.id)).toEqual(a);
  });
  it("late middle revision affects exactly its two neighboring comparisons", async () => {
    const third = "2026-01-01T00:30:00.000Z",
      fourth = "2026-01-01T00:45:00.000Z";
    for (const [id, time] of [
      ["c", third],
      ["d", fourth],
    ] as const) {
      await addEvent(id, time);
      await aggregation.processBucket("BTC", time, true);
      const s = (await signals.preview("BTC", time))!;
      await signals.persist("BTC", time, s.id);
      const p = (await service.preview("BTC", time))!;
      await service.persist("BTC", time, p.id);
    }
    const before = await db.directionChangeSnapshot.findMany({ orderBy: { id: "asc" } });
    expect(before.length).toBe(3);
    const unaffected = await service.read("BTC", fourth);
    await addEvent("late-middle", next);
    expect(await service.read("BTC", next)).toMatchObject({ status: "BLOCKED" });
    expect(await service.read("BTC", third)).toMatchObject({ status: "BLOCKED" });
    await aggregation.processBucket("BTC", next, true);
    const fresh = (await signals.preview("BTC", next))!;
    await signals.persist("BTC", next, fresh.id);
    for (const time of [next, third]) {
      expect(await service.read("BTC", time)).toMatchObject({ status: "NOT_COMPUTED" });
      const p = (await service.preview("BTC", time))!;
      await service.persist("BTC", time, p.id);
    }
    expect(await db.directionChangeSnapshot.count()).toBe(5);
    expect(
      await db.directionChangeSnapshot.findMany({
        where: { id: { in: before.map((r) => r.id) } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    expect(await service.read("BTC", fourth)).toEqual(unaffected);
  });
  it("DQ blocks both relevant comparisons without lifecycle mutation", async () => {
    await db.behaviorDataQualityIssue.create({
      data: {
        id: "dq",
        sourceId: "source",
        normalizationRunId: "normalization",
        detail: "test",
        fingerprint: "dq",
        walletAddressId: "wallet",
        coin: "BTC",
        behaviorVersion: "behavior-v1",
        reason: "HISTORY_GAP",
        sourceGroupAt: new Date(next),
      },
    });
    expect(await service.read("BTC", next)).toMatchObject({ status: "BLOCKED", item: null });
    expect(await service.read("BTC", "2026-01-01T00:30:00.000Z")).toMatchObject({
      status: "BLOCKED",
      item: null,
    });
    expect(
      (await db.behaviorDataQualityIssue.findUniqueOrThrow({ where: { id: "dq" } })).status,
    ).toBe("OPEN");
    await db.behaviorDataQualityIssue.delete({ where: { id: "dq" } }); // isolated UUID fixture only
  });
  it("saved receipt tampering fails closed; source FKs and CHECKs protect rows", async () => {
    const p = (await service.preview("BTC", next))!;
    const original = await db.directionChangeSnapshot.findUniqueOrThrow({ where: { id: p.id } });
    await db.directionChangeSnapshot.update({ where: { id: p.id }, data: { result: {} } });
    expect(await service.read("BTC", next)).toMatchObject({
      status: "BLOCKED",
      reason: "DIRECTION_CHANGE_RECEIPT_MISMATCH",
    });
    await expect(service.persist("BTC", next, p.id)).rejects.toThrow(
      "DIRECTION_CHANGE_RECEIPT_MISMATCH",
    );
    await db.directionChangeSnapshot.update({
      where: { id: p.id },
      data: { result: original.result as Prisma.InputJsonValue },
    });
    for (const id of [p.previousSignalId, p.currentSignalId])
      await expect(db.behaviorSignalSnapshot.delete({ where: { id } })).rejects.toMatchObject({
        code: "P2003",
      });
    await expect(
      db.directionChangeSnapshot.update({ where: { id: p.id }, data: { delta: "0.1" } }),
    ).rejects.toThrow();
    await expect(
      db.directionChangeSnapshot.update({
        where: { id: p.id },
        data: { currentBucket: new Date(start) },
      }),
    ).rejects.toThrow();
    await expect(
      db.directionChangeSnapshot.update({
        where: { id: p.id },
        data: { eventType: "BUY_RECOMMENDATION" },
      }),
    ).rejects.toThrow();
  });
  it("quarantined input and changed cohort cannot expose saved results", async () => {
    await db.metricCalculationRun.update({
      where: { id: "performance" },
      data: { trustState: "QUARANTINED" },
    });
    expect(await service.read("BTC", next)).toMatchObject({
      status: "BLOCKED",
      reason: "PERFORMANCE_TRUST_INCONSISTENT",
    });
    await db.metricCalculationRun.update({
      where: { id: "performance" },
      data: { trustState: "TRUSTED" },
    });
    await new PerformanceRunTrustService(db).quarantine("performance", {
      actor: "isolated-test",
      operationKey: "quarantine-fixture",
      reasonCode: "TEST_PROVENANCE",
    });
    expect(await service.read("BTC", next)).toEqual({ status: "NO_SELECTED_WALLETS", item: null });
    await db.walletSelectionSettings.update({
      where: { sourceId: "source" },
      data: { currentSelectionRunId: null },
    });
    expect(await service.read("BTC", next)).toEqual({ status: "NO_SELECTED_WALLETS", item: null });
  });
});
