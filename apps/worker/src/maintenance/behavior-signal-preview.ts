import { isDeepStrictEqual } from "node:util";
import { PrismaClient, Prisma } from "@chaincopy/database";
import { Redis } from "ioredis";
import { PrismaBehaviorSignalService } from "../../../api/src/behavior-signal-service.js";

// Explicit connections only; no .env load, migration, writes, consumers or Worker.
if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
  throw new Error("Explicit DATABASE_URL and REDIS_URL are required.");
const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
const service = new PrismaBehaviorSignalService(db);
async function queueEvidence() {
  const result: Record<string, Record<string, number>> = {};
  for (const queue of [
    "hyperliquid-sync",
    "address-performance",
    "behavior-normalization",
    "hyperliquid-discovery",
    "hyperliquid-candidate-enrichment",
  ]) {
    const states: Record<string, number> = {};
    for (const state of ["wait", "active", "paused"])
      states[state] = await redis.llen(`bull:${queue}:${state}`);
    for (const state of ["delayed", "completed", "failed", "waiting-children", "prioritized"])
      states[state] = await redis.zcard(`bull:${queue}:${state}`);
    result[queue] = states;
  }
  return result;
}
const tables = [
  "selected_wallet_behavior_events",
  "behavior_aggregation_buckets",
  "behavior_aggregation_revisions",
  "wallet_weight_snapshots",
  "wallet_weight_entries",
  "wallet_selection_settings",
  "wallet_selection_runs",
  "wallet_selection_results",
  "wallet_selection_overrides",
  "behavior_data_quality_issues",
  "behavior_normalization_cursors",
  "metric_calculation_runs",
  "performance_run_trust_transitions",
  "sync_cursors",
  "data_quality_issues",
  "wallet_addresses",
] as const;
async function evidence() {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const result: Record<string, unknown> = {};
      for (const table of tables) {
        // Table identifiers come only from the static protected-table allowlist above.
        result[table] = await tx.$queryRaw(
          Prisma.raw(
            `SELECT count(*)::text AS count, md5(coalesce(string_agg(row_to_json(t)::text, E'\\n' ORDER BY row_to_json(t)::text),'')) AS hash FROM "${table}" t`,
          ),
        );
      }
      return result;
    },
    { isolationLevel: "RepeatableRead", timeout: 60_000 },
  );
}
try {
  const before = await evidence();
  const queuesBefore = await queueEvidence();
  const buckets = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return tx.behaviorAggregationBucket.findMany({
        take: 2001,
        orderBy: [{ coin: "asc" }, { bucketStart: "asc" }],
      });
    },
    { isolationLevel: "RepeatableRead", timeout: 30_000 },
  );
  if (buckets.length !== 1332)
    throw new Error("Expected exactly the reviewed 1,332 bucket cohort; stop on scope change.");
  const distributions: Record<string, Record<string, number>> = {
    buy: {},
    sell: {},
    net: {},
    confidence: {},
  };
  const latest: Record<string, unknown> = {};
  const counts = {
    evaluable: 0,
    buyDominant: 0,
    sellDominant: 0,
    mixed: 0,
    balanced: 0,
    noSignal: 0,
  };
  const fingerprints: string[] = [];
  let provenance: unknown;
  for (const bucket of buckets) {
    const result = await service.preview(bucket.coin, bucket.bucketStart.toISOString());
    if (!result) throw new Error("No selected cohort.");
    const scope = {
      selectionRunId: result.selectionRunId,
      cohortFingerprint: result.cohortFingerprint,
      weightSnapshotId: result.weightSnapshotId,
      signalVersion: result.signalVersion,
      aggregationVersion: result.aggregationVersion,
      weightVersion: result.weightVersion,
    };
    if (provenance && !isDeepStrictEqual(provenance, scope))
      throw new Error("Scope changed during bounded preview.");
    provenance = scope;
    counts.evaluable++;
    const net = new Prisma.Decimal(result.netSignal);
    if (result.status === "NO_SIGNAL") counts.noSignal++;
    else if (net.gt(0)) counts.buyDominant++;
    else if (net.lt(0)) counts.sellDominant++;
    else counts.balanced++;
    if (
      new Prisma.Decimal(result.buyStrength).gt(0) &&
      new Prisma.Decimal(result.sellStrength).gt(0)
    )
      counts.mixed++;
    for (const [key, value] of Object.entries({
      buy: result.buyStrength,
      sell: result.sellStrength,
      net: result.netSignal,
      confidence: result.confidence,
    })) {
      const histogram = distributions[key]!;
      histogram[value] = (histogram[value] ?? 0) + 1;
    }
    latest[bucket.coin] = result;
    fingerprints.push(result.id);
  }
  const after = await evidence();
  const queuesAfter = await queueEvidence();
  if (!isDeepStrictEqual(before, after)) throw new Error("Protected state changed during preview.");
  if (!isDeepStrictEqual(queuesBefore, queuesAfter))
    throw new Error("Queue state changed during preview.");
  console.log(
    JSON.stringify({
      status: "READ_ONLY_PREVIEW_COMPLETE",
      observedAt: new Date().toISOString(),
      provenance,
      counts,
      distributions,
      latest,
      fingerprints,
      protectedState: before,
      protectedStateUnchanged: true,
      queuesBefore,
      queuesAfter,
    }),
  );
} finally {
  await db.$disconnect();
  await redis.quit();
}
