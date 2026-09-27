import { describe, expect, it } from "vitest";

import type { CleanupRule } from "./db-cleanup-policy.js";
import { createCleanupQuery, createDeleteBatchSql } from "./db-cleanup-query.js";

const cutoff = new Date("2026-08-01T00:00:00.000Z");

describe("cleanup batch SQL", () => {
  it("retains durable Behavior quote evidence beyond ordinary HTTP retention", () => {
    const rule: CleanupRule = { cutoff, table: "raw_events" };
    expect(createCleanupQuery(rule).selectionSql).toContain(
      "event_type <> 'behavior-market-provenance-v1'",
    );
    expect(createDeleteBatchSql(rule).sql).toContain(
      "event_type <> 'behavior-market-provenance-v1'",
    );
  });
  it("selects sync jobs in the existing retention index order", () => {
    const rule: CleanupRule = { cutoff, status: "SUCCEEDED", table: "sync_jobs" };
    const query = createCleanupQuery(rule);
    expect(query.indexName).toBe("sync_jobs_status_created_at_idx");
    expect(query.indexColumns).toEqual(["status", "created_at"]);
    expect(query.selectionSql).toContain("status = $1");
    expect(query.selectionSql).toContain("created_at < $2 ORDER BY created_at, id");
    expect(query.selectionSql).not.toContain("ORDER BY id");
  });

  it("selects rejected orders by status and timestamp before the tie-breaker", () => {
    const rule: CleanupRule = { cutoff, status: "badAloPxRejected", table: "order_history" };
    const query = createCleanupQuery(rule);
    expect(query.indexName).toBe("order_history_cleanup_status_timestamp_id_idx");
    expect(query.indexColumns).toEqual(["status", "status_timestamp", "id"]);
    expect(query.selectionSql).toContain(
      "status = $1 AND status_timestamp < $2 ORDER BY status_timestamp, id",
    );
  });

  it("deletes only a materialized bounded candidate set", () => {
    const rule: CleanupRule = { cutoff, status: "badAloPxRejected", table: "order_history" };
    const batch = createDeleteBatchSql(rule);
    expect(batch.sql).toMatch(/^WITH candidates AS MATERIALIZED/);
    expect(batch.sql).toContain("LIMIT $3");
    expect(batch.sql).toContain("DELETE FROM order_history AS target USING candidates");
  });
});
