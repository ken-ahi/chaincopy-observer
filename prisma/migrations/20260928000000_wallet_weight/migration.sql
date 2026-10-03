-- Phase 5.2: real application REQUIRES separate Owner approval.
-- Additive only: no existing table/data/index alterations.
CREATE TABLE "wallet_weight_snapshots" (
  "id" TEXT NOT NULL,
  "weight_version" TEXT NOT NULL,
  "selection_run_id" TEXT NOT NULL,
  "cohort_fingerprint" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wallet_weight_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "wallet_weight_entries" (
  "snapshot_id" TEXT NOT NULL,
  "wallet_address_id" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "performance_run_id" TEXT NOT NULL,
  "raw_weight" DECIMAL(38,36) NOT NULL,
  "normalized_weight" DECIMAL(38,18) NOT NULL,
  "metric_inputs" JSONB NOT NULL,
  CONSTRAINT "wallet_weight_entries_pkey" PRIMARY KEY ("snapshot_id", "wallet_address_id"),
  CONSTRAINT "wallet_weight_entry_bounds" CHECK ("raw_weight" >= 0 AND "raw_weight" <= 1 AND "normalized_weight" >= 0 AND "normalized_weight" <= 1)
);
CREATE UNIQUE INDEX "wallet_weight_snapshot_input_key" ON "wallet_weight_snapshots"("weight_version", "input_fingerprint");
CREATE INDEX "wallet_weight_snapshot_scope_idx" ON "wallet_weight_snapshots"("selection_run_id", "cohort_fingerprint", "weight_version");
CREATE UNIQUE INDEX "wallet_weight_entry_address_key" ON "wallet_weight_entries"("snapshot_id", "address");
CREATE INDEX "wallet_weight_entry_performance_idx" ON "wallet_weight_entries"("performance_run_id");
CREATE INDEX "wallet_weight_entry_wallet_idx" ON "wallet_weight_entries"("wallet_address_id");
ALTER TABLE "wallet_weight_snapshots" ADD CONSTRAINT "wallet_weight_snapshots_selection_run_id_fkey" FOREIGN KEY ("selection_run_id") REFERENCES "wallet_selection_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_weight_entries" ADD CONSTRAINT "wallet_weight_entries_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "wallet_weight_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_weight_entries" ADD CONSTRAINT "wallet_weight_entries_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "wallet_weight_entries" ADD CONSTRAINT "wallet_weight_entries_performance_run_id_fkey" FOREIGN KEY ("performance_run_id") REFERENCES "metric_calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
