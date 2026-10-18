import { DIRECTION_CHANGE_EVENTS, type calculateDirectionChange } from "@chaincopy/analytics";
import { PrismaDirectionChangeService } from "../../../api/src/direction-change-service.js";
import { isDeepStrictEqual } from "node:util";
import { PrismaClient, Prisma } from "@chaincopy/database";
import { Redis } from "ioredis";
import { PrismaBehaviorSignalService } from "../../../api/src/behavior-signal-service.js";

// Explicit connections only; no .env load, migration, writes, consumers or Worker.
if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
  throw new Error("Explicit DATABASE_URL and REDIS_URL are required.");
const db = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
const signals = new PrismaBehaviorSignalService(db);
const service = new PrismaDirectionChangeService(db);
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
  "behavior_signal_snapshots",
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
  const before = await evidence(),
    queuesBefore = await queueEvidence();
  const rows = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return tx.behaviorSignalSnapshot.findMany({
        take: 1333,
        orderBy: [{ coin: "asc" }, { bucketStart: "asc" }, { id: "asc" }],
      });
    },
    { isolationLevel: "RepeatableRead", timeout: 30000 },
  );
  if (
    rows.length !== 1332 ||
    new Set(rows.map((r) => r.coin + ":" + r.bucketStart.toISOString())).size !== 1332
  )
    throw new Error("Reviewed 1,332-row scope changed or ambiguous revisions; stop");
  const counts = Object.fromEntries(DIRECTION_CHANGE_EVENTS.map((e) => [e, 0]));
  const summary: Record<string, unknown> = {};
  const results: ReturnType<typeof calculateDirectionChange>[] = [];
  let totalGaps = 0,
    checked = 0;
  for (const coin of [...new Set(rows.map((r) => r.coin))]) {
    const group = rows.filter((r) => r.coin === coin);
    const histogram: Record<string, Record<string, number>> = {
      netSignal: {},
      buyStrength: {},
      sellStrength: {},
      confidence: {},
    };
    const coinCounts = Object.fromEntries(DIRECTION_CHANGE_EVENTS.map((e) => [e, 0]));
    const sequences: { from: string; to: string; count: number }[] = [];
    let gaps = 0,
      missingBucketSlots = 0,
      run = 1,
      longest = 1,
      segment = group[0]!.bucketStart.toISOString();
    let newestEvent: ReturnType<typeof calculateDirectionChange> | null = null;
    for (const [i, row] of group.entries()) {
      const verified = await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET TRANSACTION READ ONLY`;
          return signals.verifiedInTransaction(tx, coin, row.bucketStart.toISOString());
        },
        { isolationLevel: "RepeatableRead", timeout: 30000 },
      );
      if (!verified || verified.id !== row.id || !isDeepStrictEqual(verified, row.result))
        throw new Error("Signal not current-valid");
      for (const key of ["netSignal", "buyStrength", "sellStrength", "confidence"] as const) {
        const value = verified[key];
        histogram[key]![value] = (histogram[key]![value] ?? 0) + 1;
      }
      if (i) {
        const previous = group[i - 1]!;
        const diff = row.bucketStart.getTime() - previous.bucketStart.getTime();
        if (diff !== 900000) {
          if (diff < 900000 || diff % 900000 !== 0) throw new Error("Noncanonical timeline");
          sequences.push({ from: segment, to: previous.bucketStart.toISOString(), count: run });
          gaps++;
          totalGaps++;
          missingBucketSlots += diff / 900000 - 1;
          run = 1;
          segment = row.bucketStart.toISOString();
        } else {
          run++;
          longest = Math.max(longest, run);
          const result = await service.preview(coin, row.bucketStart.toISOString());
          if (
            !result ||
            result.previousSignalId !== previous.id ||
            result.currentSignalId !== row.id
          )
            throw new Error("Pair provenance changed");
          results.push(result);
          counts[result.eventType]!++;
          coinCounts[result.eventType]!++;
          if (result.eventType !== "NONE") newestEvent = result;
        }
      }
      if (++checked % 100 === 0) console.error(`verified ${checked}/1332`);
    }
    sequences.push({ from: segment, to: group.at(-1)!.bucketStart.toISOString(), count: run });
    summary[coin] = {
      count: group.length,
      first: group[0]!.bucketStart.toISOString(),
      last: group.at(-1)!.bucketStart.toISOString(),
      gaps,
      missingBucketSlots,
      longest,
      sequences,
      histogram,
      counts: coinCounts,
      newestEvent,
    };
  }
  const after = await evidence(),
    queuesAfter = await queueEvidence();
  if (!isDeepStrictEqual(before, after) || !isDeepStrictEqual(queuesBefore, queuesAfter))
    throw new Error("Protected state or queues changed");
  console.log(
    JSON.stringify({
      status: "READ_ONLY_PREVIEW_COMPLETE",
      observedAt: new Date().toISOString(),
      signalCount: rows.length,
      comparableAdjacentPairs: results.length,
      blockedNonAdjacentPairs: totalGaps,
      firstObservationsWithoutPredecessor: Object.keys(summary).length,
      counts,
      summary,
      results,
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
