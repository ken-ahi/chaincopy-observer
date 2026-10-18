-- Additive only. Real application requires separate Owner approval.
CREATE TABLE "direction_change_snapshots" (
  "id" TEXT NOT NULL,
  "direction_change_version" TEXT NOT NULL,
  "signal_version" TEXT NOT NULL,
  "previous_signal_id" TEXT NOT NULL,
  "current_signal_id" TEXT NOT NULL,
  "coin" TEXT NOT NULL,
  "previous_bucket" TIMESTAMP(3) NOT NULL,
  "current_bucket" TIMESTAMP(3) NOT NULL,
  "previous_net_signal" DECIMAL(38,19) NOT NULL,
  "current_net_signal" DECIMAL(38,19) NOT NULL,
  "delta" DECIMAL(38,19) NOT NULL,
  "event_type" TEXT NOT NULL,
  "selection_run_id" TEXT NOT NULL,
  "cohort_fingerprint" TEXT NOT NULL,
  "weight_snapshot_id" TEXT NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "input_snapshot" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direction_change_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "direction_change_identity_check" CHECK ("id" = "input_fingerprint"),
  CONSTRAINT "direction_change_adjacency_check" CHECK (
    "current_bucket" = "previous_bucket" + INTERVAL '15 minutes'
    AND MOD(EXTRACT(EPOCH FROM "previous_bucket"),900) = 0),
  CONSTRAINT "direction_change_delta_check" CHECK (
    "previous_net_signal" BETWEEN -1 AND 1 AND "current_net_signal" BETWEEN -1 AND 1
    AND "delta" = "current_net_signal" - "previous_net_signal"),
  CONSTRAINT "direction_change_event_check" CHECK ("event_type" IN (
    'BUY_ACCELERATING','BUY_WEAKENING','SELL_ACCELERATING','SELL_WEAKENING',
    'BULLISH_REVERSAL','BEARISH_REVERSAL','NONE'))
);
CREATE UNIQUE INDEX "direction_change_source_key" ON "direction_change_snapshots"("direction_change_version","previous_signal_id","current_signal_id");
CREATE UNIQUE INDEX "direction_change_input_key" ON "direction_change_snapshots"("direction_change_version","input_fingerprint");
CREATE INDEX "direction_change_coin_time_idx" ON "direction_change_snapshots"("coin","current_bucket","direction_change_version");
CREATE INDEX "direction_change_previous_idx" ON "direction_change_snapshots"("previous_signal_id");
CREATE INDEX "direction_change_current_idx" ON "direction_change_snapshots"("current_signal_id");
ALTER TABLE "direction_change_snapshots" ADD CONSTRAINT "direction_change_previous_fkey" FOREIGN KEY ("previous_signal_id") REFERENCES "behavior_signal_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "direction_change_snapshots" ADD CONSTRAINT "direction_change_current_fkey" FOREIGN KEY ("current_signal_id") REFERENCES "behavior_signal_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
