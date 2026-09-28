import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { type Prisma, PrismaClient } from "@chaincopy/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isolatedTargets } from "../../../tests/isolated-targets.mjs";
import { PrismaWalletWeightService } from "./wallet-weight-service.js";
import { PerformanceRunTrustService } from "./performance-run-trust.js";

// Validate reserved isolated endpoints BEFORE deriving a per-suite schema.
// Independent schema avoids racing other suites' global Selection pointer.
const { databaseUrl } = isolatedTargets(process.env, "TEST");
const schema = `weight_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(databaseUrl);
url.searchParams.set("schema", schema);
const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const service = new PrismaWalletWeightService(database);
const from = new Date("2026-01-01T00:00:00.000Z"),
  to = new Date("2026-02-01T00:00:00.000Z");
const metrics = {
  winRate: "0.6",
  profitFactor: "1",
  topTradeContribution: "0.2",
  averageWin: "1",
  averageLoss: "-1",
  maxLosingStreak: "3",
};
let sourceId: string;
async function performance(wallet: string, id: string, requestedAt = to, n = 30) {
  await database.metricCalculationRun.create({
    data: {
      id,
      walletAddressId: wallet,
      calculationVersion: "performance-v3",
      calculationFrom: from,
      calculationTo: to,
      requestedAt,
      requestedBy: "isolated-test",
      status: "SUCCEEDED",
      historyCompleteness: "PARTIAL",
      inputFingerprint: id,
      deduplicationKey: id,
      performanceMetrics: {
        create: Object.entries(metrics).map(([metricKey, metricValue]) => ({
          walletAddressId: wallet,
          metricKey,
          metricValue,
          precision: "DERIVED",
          status: "AVAILABLE",
          calculationFrom: from,
          calculationTo: to,
          metricVersion: "performance-v3",
        })),
      },
      positionCycles: {
        create: Array.from({ length: n }, (_, i) => ({
          walletAddressId: wallet,
          coin: "BTC",
          side: "LONG",
          openedAt: from,
          closedAt: to,
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
          inputFingerprint: `${id}-${i}`,
        })),
      },
    },
  });
}
async function selection(id: string, run = "p-a") {
  await database.walletSelectionRun.create({
    data: {
      id,
      sourceId,
      policyVersion: "wallet-selection-v2",
      inputFingerprint: id,
      policySnapshot: {},
      evaluatedAt: to,
      universeCount: 4,
      selectedCount: 2,
      qualifiedCount: 1,
      reviewCount: 1,
      excludedCount: 0,
      results: {
        create: [
          { walletAddressId: "a", performanceRunId: run, automaticStatus: "SELECTED" },
          { walletAddressId: "b", performanceRunId: "p-b", automaticStatus: "SELECTED" },
          { walletAddressId: "c", performanceRunId: "p-c", automaticStatus: "REVIEW" },
          { walletAddressId: "d", performanceRunId: "p-d", automaticStatus: "QUALIFIED" },
        ],
      },
    },
  });
  await database.walletSelectionSettings.upsert({
    where: { sourceId },
    create: { sourceId, currentSelectionRunId: id },
    update: { currentSelectionRunId: id },
  });
}
describe.sequential("wallet weight isolated persistence", { timeout: 30000 }, () => {
  beforeAll(async () => {
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    execFileSync(
      process.execPath,
      [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: "pipe" },
    );
    sourceId = (
      await database.dataSource.create({
        data: { key: "hyperliquid-mainnet", kind: "HYPERLIQUID", name: "Isolated weights" },
      })
    ).id;
    for (const [i, id] of ["a", "b", "c", "d"].entries()) {
      await database.walletAddress.create({
        data: { id, sourceId, address: `0x${(i + 1).toString().padStart(40, "0")}` },
      });
      await performance(id, `p-${id}`, to, id === "c" ? 2 : 30);
    }
    await database.walletSelectionOverride.create({
      data: { walletAddressId: "c", decision: "INCLUDE" },
    });
    await selection("s1");
  });
  afterAll(async () => {
    await database.$disconnect();
    // Exact generated schema on previously validated isolated endpoint only.
    await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.$disconnect();
  });
  it("uses Selection SSoT, never admits high-quality small sample REVIEW or QUALIFIED", async () => {
    const preview = await service.preview();
    expect(preview!.entries.map((e) => e.walletAddressId)).toEqual(["a", "b"]);
    expect(await database.walletWeightSnapshot.count()).toBe(0);
    expect(await service.current()).toMatchObject({ status: "NOT_COMPUTED" });
  });
  it("persists idempotently including concurrent writers and rejects stale fingerprints", async () => {
    const preview = (await service.preview())!;
    await expect(service.persist("0".repeat(64))).rejects.toThrow("INPUT_CHANGED");
    const [a, b] = await Promise.all([service.persist(preview.id), service.persist(preview.id)]);
    expect(a).toEqual(b);
    expect(await database.walletWeightSnapshot.count()).toBe(1);
    expect(await service.persist(preview.id)).toEqual(a);
    expect(await service.current()).toMatchObject({
      status: "CURRENT",
      snapshotId: a!.id,
      items: [{ normalizedWeight: "0.5" }, { normalizedWeight: "0.5" }],
    });
  });
  it("EXCLUDE creates a new snapshot without rewriting history and removal reuses it", async () => {
    const original = await database.walletWeightSnapshot.findMany({ include: { entries: true } });
    await database.walletSelectionOverride.create({
      data: { walletAddressId: "b", decision: "EXCLUDE" },
    });
    const preview = (await service.preview())!;
    expect(preview.entries.map((e) => e.walletAddressId)).toEqual(["a"]);
    expect(preview.entries[0]!.normalizedWeight).toBe("1");
    await service.persist(preview.id);
    expect(
      await database.walletWeightSnapshot.findUnique({
        where: { id: original[0]!.id },
        include: { entries: true },
      }),
    ).toEqual(original[0]);
    await database.walletSelectionOverride.update({
      where: { walletAddressId: "b" },
      data: { decision: "AUTO" },
    });
    expect((await service.current()).status).toBe("CURRENT");
  });
  it("new trusted Performance blocks stale Selection evidence until a new Selection run", async () => {
    const before = await database.walletWeightSnapshot.findMany({
      include: { entries: true },
      orderBy: { id: "asc" },
    });
    await performance("a", "p-new", new Date("2026-02-02T00:00:00.000Z"));
    expect(await service.current()).toMatchObject({
      status: "BLOCKED",
      reason: "STALE_SELECTION_EVIDENCE",
    });
    await selection("s2", "p-new");
    const preview = (await service.preview())!;
    expect(preview.entries[0]!.performanceRunId).toBe("p-new");
    await service.persist(preview.id);
    expect(
      await database.walletWeightSnapshot.findMany({
        where: { id: { in: before.map((s) => s.id) } },
        include: { entries: true },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
  });
  it("missing metric fails closed without returning a historical current weight", async () => {
    const row = await database.addressPerformanceMetric.findFirstOrThrow({
      where: { calculationRunId: "p-new", metricKey: "profitFactor" },
    });
    await database.addressPerformanceMetric.update({
      where: { id: row.id },
      data: { status: "REFERENCE_ONLY" },
    });
    expect(await service.current()).toMatchObject({
      status: "BLOCKED",
      reason: "INVALID_PERFORMANCE_EVIDENCE",
      items: [],
    });
    await database.addressPerformanceMetric.update({
      where: { id: row.id },
      data: { status: "AVAILABLE" },
    });
  });
  it("migration enforces unique entries and restricts provenance deletion", async () => {
    const entry = await database.walletWeightEntry.findFirstOrThrow();
    await expect(
      database.walletWeightEntry.create({
        data: { ...entry, metricInputs: entry.metricInputs as Prisma.InputJsonValue },
      }),
    ).rejects.toMatchObject({
      code: "P2002",
    });
    await expect(database.walletSelectionRun.delete({ where: { id: "s1" } })).rejects.toMatchObject(
      { code: "P2003" },
    );
    await expect(
      database.metricCalculationRun.delete({ where: { id: "p-a" } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(
      database.walletWeightEntry.update({
        where: {
          snapshotId_walletAddressId: {
            snapshotId: entry.snapshotId,
            walletAddressId: entry.walletAddressId,
          },
        },
        data: { normalizedWeight: "1.1" },
      }),
    ).rejects.toThrow();
    const fks = await database.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM information_schema.table_constraints WHERE table_schema=${schema} AND table_name IN ('wallet_weight_snapshots','wallet_weight_entries') AND constraint_type='FOREIGN KEY'`;
    expect(fks[0]!.count).toBe(4n);
  });
  it("rejects wrong-wallet metric provenance and incoherent windows", async () => {
    const metric = await database.addressPerformanceMetric.findFirstOrThrow({
      where: { calculationRunId: "p-new", metricKey: "profitFactor" },
    });
    await database.addressPerformanceMetric.update({
      where: { id: metric.id },
      data: { walletAddressId: "b" },
    });
    expect(await service.current()).toMatchObject({
      status: "BLOCKED",
      reason: "INVALID_PERFORMANCE_EVIDENCE",
    });
    await database.addressPerformanceMetric.update({
      where: { id: metric.id },
      data: { walletAddressId: "a", calculationTo: new Date("2026-02-02T00:00:00.000Z") },
    });
    expect(await service.current()).toMatchObject({
      status: "BLOCKED",
      reason: "INVALID_PERFORMANCE_EVIDENCE",
    });
    await database.addressPerformanceMetric.update({
      where: { id: metric.id },
      data: { calculationTo: to },
    });
  });
  it("detects corrupted stored receipt rather than silently presenting recomputed values", async () => {
    const preview = (await service.preview())!;
    const row = await database.walletWeightSnapshot.findUniqueOrThrow({
      where: { id: preview.id },
    });
    await database.walletWeightSnapshot.update({
      where: { id: row.id },
      data: { inputSnapshot: { corrupt: true } },
    });
    expect(await service.current()).toMatchObject({
      status: "BLOCKED",
      reason: "SNAPSHOT_INCONSISTENT",
    });
    await expect(service.persist(preview.id)).rejects.toThrow("SNAPSHOT_INCONSISTENT");
    await database.walletWeightSnapshot.update({
      where: { id: row.id },
      data: { inputSnapshot: row.inputSnapshot as Prisma.InputJsonValue },
    });
  });
  it("quarantine removes active membership without changing historical weight evidence", async () => {
    const before = await database.walletWeightSnapshot.findMany({
      orderBy: { id: "asc" },
      include: { entries: true },
    });
    await new PerformanceRunTrustService(database).quarantine("p-new", {
      actor: "isolated-test",
      operationKey: randomUUID(),
      reasonCode: "TEST",
    });
    const preview = (await service.preview())!;
    expect(preview.entries.map((e) => e.walletAddressId)).toEqual(["b"]);
    expect(preview.entries[0]!.normalizedWeight).toBe("1");
    expect(
      await database.walletWeightSnapshot.findMany({
        orderBy: { id: "asc" },
        include: { entries: true },
      }),
    ).toEqual(before);
  });
  it("no current Selection is a normal no-op with no watched fallback", async () => {
    await database.walletSelectionSettings.update({
      where: { sourceId },
      data: { currentSelectionRunId: null },
    });
    expect(await service.preview()).toBeNull();
    expect(await service.current()).toEqual({ status: "NO_SELECTED_WALLETS", items: [] });
  });
});
