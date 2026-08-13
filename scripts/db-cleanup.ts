import { setTimeout as delay } from "node:timers/promises";

import type { PrismaClient } from "@chaincopy/database";

import { createCleanupRules, executeCleanupRule, type CleanupRule } from "./db-cleanup-policy.js";
import { cleanupHelp, parseCleanupOptions } from "./db-cleanup-options.js";
import { createCleanupQuery, createDeleteBatchSql } from "./db-cleanup-query.js";

function whereClause(rule: CleanupRule): {
  readonly parameters: readonly unknown[];
  readonly sql: string;
} {
  switch (rule.table) {
    case "sync_jobs":
      return {
        parameters: [rule.status, rule.cutoff],
        sql: 'status = $1::"SyncJobStatus" AND created_at < $2',
      };
    case "raw_events":
      return { parameters: [rule.cutoff], sql: "received_at < $1 AND transport = 'HTTP'" };
    case "order_history":
      return {
        parameters: [rule.status, rule.cutoff],
        sql: "status = $1 AND status_timestamp < $2",
      };
  }
}

async function countRule(database: PrismaClient, rule: CleanupRule): Promise<bigint> {
  const where = whereClause(rule);
  const rows = await database.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) AS count FROM ${rule.table} WHERE ${where.sql}`,
    ...where.parameters,
  );
  return rows[0]?.count ?? 0n;
}

async function deleteBatch(
  database: PrismaClient,
  rule: CleanupRule,
  batchSize: number,
): Promise<number> {
  const batch = createDeleteBatchSql(rule);
  return database.$executeRawUnsafe(batch.sql, ...batch.parameters, batchSize);
}

async function assertCleanupIndex(database: PrismaClient, rule: CleanupRule): Promise<void> {
  const { indexColumns, indexName } = createCleanupQuery(rule);
  const rows = await database.$queryRawUnsafe<
    Array<{ columns: string[]; ready: boolean; valid: boolean }>
  >(
    `SELECT index.indisready AS ready, index.indisvalid AS valid,
            ARRAY(SELECT pg_get_indexdef(index.indexrelid, position, TRUE)
                  FROM generate_series(1, index.indnkeyatts) AS position
                  ORDER BY position) AS columns
     FROM pg_catalog.pg_index AS index
     JOIN pg_catalog.pg_class AS relation ON relation.oid = index.indexrelid
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = current_schema() AND relation.relname = $1`,
    indexName,
  );
  const actual = rows[0];
  if (
    actual?.ready !== true ||
    actual.valid !== true ||
    actual.columns.length < indexColumns.length ||
    !indexColumns.every((column, position) => actual.columns[position] === column)
  ) {
    throw new Error(
      `Cleanup preflight failed: required index ${indexName} is missing, invalid, or not ready. See docs/phase4-3-1-worker-db-stability.md.`,
    );
  }
}

async function explainRule(
  database: PrismaClient,
  rule: CleanupRule,
  batchSize: number,
): Promise<unknown> {
  const query = createCleanupQuery(rule);
  const limit = query.parameters.length + 1;
  return database.$queryRawUnsafe(
    `EXPLAIN (FORMAT JSON, COSTS TRUE) ${query.selectionSql} LIMIT $${limit}`,
    ...query.parameters,
    batchSize,
  );
}

async function main(): Promise<void> {
  const options = parseCleanupOptions(process.argv.slice(2));
  if (options.help) {
    console.info(cleanupHelp);
    return;
  }
  const { disconnectDatabase, prisma } = await import("@chaincopy/database");
  try {
    const rules = createCleanupRules(new Date(), options.table, options.status);
    if (rules.length === 0) {
      throw new RangeError("No cleanup rule matches the requested table/status.");
    }
    for (const rule of rules) {
      if (!options.dryRun) await assertCleanupIndex(prisma, rule);
      if (options.explain) {
        const plan = await explainRule(prisma, rule, options.batchSize);
        console.info(JSON.stringify({ action: "explain", plan, ...rule }));
        continue;
      }
      const adapter = {
        count: (targetRule: CleanupRule) => countRule(prisma, targetRule),
        deleteBatch: (targetRule: CleanupRule, batchSize: number) =>
          deleteBatch(prisma, targetRule, batchSize),
      };
      const planned = await adapter.count(rule);
      console.info(JSON.stringify({ action: "plan", ...rule, planned: planned.toString() }));
      let deleted = 0;
      await executeCleanupRule({
        adapter: {
          count: async () => planned,
          deleteBatch: (targetRule, batchSize) => adapter.deleteBatch(targetRule, batchSize),
        },
        batchSize: options.batchSize,
        dryRun: options.dryRun,
        onBatch: async (batchDeleted) => {
          deleted += batchDeleted;
          console.info(JSON.stringify({ action: "delete", batchDeleted, deleted, ...rule }));
          if (batchDeleted === options.batchSize) await delay(options.delayMs);
        },
        rule,
      });
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
