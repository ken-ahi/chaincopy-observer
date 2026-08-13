-- Run explicitly with psql. Do not run inside a transaction or a Prisma migration.
-- Re-running is safe. Monitor pg_stat_progress_create_index while it is active.
CREATE INDEX CONCURRENTLY IF NOT EXISTS order_history_cleanup_status_timestamp_id_idx
  ON order_history (status, status_timestamp, id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS raw_events_cleanup_transport_received_at_id_idx
  ON raw_events (transport, received_at, id);
