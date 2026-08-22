-- Owner-approved maintenance operation only. Do not run inside a Prisma migration
-- or a transaction. Capture EXPLAIN (ANALYZE, BUFFERS) before and after, and monitor
-- free space, WAL volume, replication lag, locks, and pg_stat_progress_create_index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "normalized_trades_behavior_scan_idx"
ON "normalized_trades" ("wallet_address_id", "coin", "occurred_at", "id");
