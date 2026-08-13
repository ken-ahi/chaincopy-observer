import type { CleanupRule } from "./db-cleanup-policy.js";

export interface CleanupQuery {
  readonly indexColumns: readonly string[];
  readonly indexName: string;
  readonly parameters: readonly unknown[];
  readonly selectionSql: string;
}

export function createCleanupQuery(rule: CleanupRule): CleanupQuery {
  switch (rule.table) {
    case "sync_jobs":
      return {
        indexColumns: ["status", "created_at"],
        indexName: "sync_jobs_status_created_at_idx",
        parameters: [rule.status, rule.cutoff],
        selectionSql:
          'SELECT id FROM sync_jobs WHERE status = $1::"SyncJobStatus" AND created_at < $2 ORDER BY created_at, id',
      };
    case "raw_events":
      return {
        indexColumns: ["transport", "received_at", "id"],
        indexName: "raw_events_cleanup_transport_received_at_id_idx",
        parameters: [rule.cutoff],
        selectionSql:
          "SELECT id FROM raw_events WHERE transport = 'HTTP' AND received_at < $1 ORDER BY received_at, id",
      };
    case "order_history":
      return {
        indexColumns: ["status", "status_timestamp", "id"],
        indexName: "order_history_cleanup_status_timestamp_id_idx",
        parameters: [rule.status, rule.cutoff],
        selectionSql:
          "SELECT id FROM order_history WHERE status = $1 AND status_timestamp < $2 ORDER BY status_timestamp, id",
      };
  }
}

export function createDeleteBatchSql(rule: CleanupRule): {
  readonly parameters: readonly unknown[];
  readonly sql: string;
} {
  const query = createCleanupQuery(rule);
  const limit = query.parameters.length + 1;
  return {
    parameters: [...query.parameters],
    sql: `WITH candidates AS MATERIALIZED (${query.selectionSql} LIMIT $${limit}) DELETE FROM ${rule.table} AS target USING candidates WHERE target.id = candidates.id`,
  };
}
