import { setTimeout as delay } from "node:timers/promises";

import type { PrismaClient } from "@chaincopy/database";

import { createCleanupRules, executeCleanupRule, type CleanupRule } from "./db-cleanup-policy.js";
import { cleanupHelp, parseCleanupOptions } from "./db-cleanup-options.js";

function whereClause(rule: CleanupRule): {
  readonly parameters: readonly unknown[];
  readonly sql: string;
} {
  switch (rule.table) {
    case "sync_jobs":
      return {
        parameters: [rule.cutoff, rule.status],
        sql: 'created_at < $1 AND status = $2::"SyncJobStatus"',
      };
    case "raw_events":
      return { parameters: [rule.cutoff], sql: "received_at < $1 AND transport = 'HTTP'" };
    case "order_history":
      return {
        parameters: [rule.cutoff, rule.status],
        sql: "status_timestamp < $1 AND status = $2",
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
  const where = whereClause(rule);
  const limitParameter = where.parameters.length + 1;
  return database.$executeRawUnsafe(
    `DELETE FROM ${rule.table} WHERE id IN (SELECT id FROM ${rule.table} WHERE ${where.sql} ORDER BY id LIMIT $${limitParameter})`,
    ...where.parameters,
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
