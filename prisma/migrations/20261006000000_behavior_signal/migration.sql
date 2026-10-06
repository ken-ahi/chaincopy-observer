-- Additive Phase 5.3 only. Real application requires separate Owner approval.
CREATE TABLE "behavior_signal_snapshots" (
  "id" TEXT NOT NULL,
  "signal_version" TEXT NOT NULL,
  "aggregation_revision_id" TEXT NOT NULL,
  "weight_snapshot_id" TEXT NOT NULL,
  "selection_run_id" TEXT NOT NULL,
  "cohort_fingerprint" TEXT NOT NULL,
  "coin" TEXT NOT NULL,
  "bucket_start" TIMESTAMP(3) NOT NULL,
  "bucket_end" TIMESTAMP(3) NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "behavior_signal_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "behavior_signal_bucket_check" CHECK ("bucket_end" = "bucket_start" + interval '15 minutes'),
  CONSTRAINT "behavior_signal_identity_check" CHECK ("id" = "input_fingerprint")
);
CREATE UNIQUE INDEX "behavior_signal_source_key" ON "behavior_signal_snapshots"("signal_version", "aggregation_revision_id", "weight_snapshot_id");
CREATE UNIQUE INDEX "behavior_signal_input_key" ON "behavior_signal_snapshots"("signal_version", "input_fingerprint");
CREATE INDEX "behavior_signal_coin_time_idx" ON "behavior_signal_snapshots"("coin", "bucket_start", "selection_run_id", "cohort_fingerprint");
CREATE INDEX "behavior_signal_aggregation_idx" ON "behavior_signal_snapshots"("aggregation_revision_id");
CREATE INDEX "behavior_signal_weight_idx" ON "behavior_signal_snapshots"("weight_snapshot_id");
CREATE INDEX "behavior_signal_selection_idx" ON "behavior_signal_snapshots"("selection_run_id");
ALTER TABLE "behavior_signal_snapshots" ADD CONSTRAINT "behavior_signal_snapshots_aggregation_revision_id_fkey" FOREIGN KEY ("aggregation_revision_id") REFERENCES "behavior_aggregation_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_signal_snapshots" ADD CONSTRAINT "behavior_signal_snapshots_weight_snapshot_id_fkey" FOREIGN KEY ("weight_snapshot_id") REFERENCES "wallet_weight_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_signal_snapshots" ADD CONSTRAINT "behavior_signal_snapshots_selection_run_id_fkey" FOREIGN KEY ("selection_run_id") REFERENCES "wallet_selection_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
