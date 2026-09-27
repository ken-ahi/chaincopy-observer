-- Owner-approved scope: exactly two new derived tables; no existing data mutations.
CREATE TABLE "behavior_aggregation_buckets" (
  "id" TEXT NOT NULL,
  "aggregation_version" TEXT NOT NULL,
  "behavior_version" TEXT NOT NULL,
  "selection_run_id" TEXT NOT NULL,
  "scope_fingerprint" TEXT NOT NULL,
  "coin" TEXT NOT NULL,
  "bucket_start" TIMESTAMP(3) NOT NULL,
  "bucket_end" TIMESTAMP(3) NOT NULL,
  "current_revision_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "behavior_aggregation_buckets_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "behavior_aggregation_interval_check" CHECK ("bucket_end" = "bucket_start" + interval '15 minutes')
);
CREATE TABLE "behavior_aggregation_revisions" (
  "id" TEXT NOT NULL,
  "bucket_id" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "totals" JSONB,
  "event_count" INTEGER,
  "unique_wallet_count" INTEGER,
  "notional_usd" DECIMAL(50,18),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "behavior_aggregation_revisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "behavior_aggregation_status_check" CHECK (
    ("status" = 'BLOCKED' AND "totals" IS NULL AND "event_count" IS NULL AND "unique_wallet_count" IS NULL AND "notional_usd" IS NULL)
    OR ("status" IN ('VALID', 'EMPTY') AND "totals" IS NOT NULL AND "event_count" >= 0 AND "unique_wallet_count" >= 0 AND "notional_usd" >= 0)
  )
);
CREATE UNIQUE INDEX "behavior_aggregation_bucket_key" ON "behavior_aggregation_buckets"("selection_run_id", "scope_fingerprint", "aggregation_version", "behavior_version", "coin", "bucket_start");
CREATE INDEX "behavior_aggregation_coin_time_idx" ON "behavior_aggregation_buckets"("coin", "bucket_start", "selection_run_id", "scope_fingerprint");
CREATE UNIQUE INDEX "behavior_aggregation_revision_key" ON "behavior_aggregation_revisions"("bucket_id", "input_fingerprint");
ALTER TABLE "behavior_aggregation_buckets" ADD CONSTRAINT "behavior_aggregation_buckets_selection_run_id_fkey" FOREIGN KEY ("selection_run_id") REFERENCES "wallet_selection_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_aggregation_revisions" ADD CONSTRAINT "behavior_aggregation_revisions_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "behavior_aggregation_buckets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_aggregation_buckets" ADD CONSTRAINT "behavior_aggregation_buckets_current_revision_id_fkey" FOREIGN KEY ("current_revision_id") REFERENCES "behavior_aggregation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
