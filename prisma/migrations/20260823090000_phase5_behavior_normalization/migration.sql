-- Phase 5.0 schema only. This migration deliberately does not backfill
-- normalized_trades.source_trade_id and does not add an index to that large table.
CREATE TYPE "BehaviorNormalizationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED');
CREATE TYPE "BehaviorEventType" AS ENUM ('POSITION_OPEN', 'POSITION_INCREASE', 'POSITION_REDUCE', 'POSITION_CLOSE');
CREATE TYPE "BehaviorDirection" AS ENUM ('LONG', 'SHORT');
CREATE TYPE "BehaviorDataQualityReason" AS ENUM ('MISSING_BOUNDARY', 'ORDERING_AMBIGUOUS', 'INVALID_DECIMAL', 'SOURCE_INCONSISTENT', 'IMPOSSIBLE_TRANSITION', 'HISTORY_GAP', 'UNSUPPORTED_QUOTE', 'INCOMPLETE_TIMESTAMP_GROUP');

ALTER TABLE "normalized_trades" ADD COLUMN "source_trade_id" TEXT;

CREATE TABLE "behavior_normalization_runs" (
  "id" TEXT NOT NULL,
  "behavior_version" TEXT NOT NULL,
  "wallet_address_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "coin" TEXT NOT NULL,
  "calculation_from" TIMESTAMP(3) NOT NULL,
  "calculation_to" TIMESTAMP(3) NOT NULL,
  "input_fingerprint" TEXT NOT NULL,
  "status" "BehaviorNormalizationStatus" NOT NULL DEFAULT 'PENDING',
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "error_code" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "behavior_normalization_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "selected_wallet_behavior_events" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "behavior_version" TEXT NOT NULL,
  "event_type" "BehaviorEventType" NOT NULL,
  "direction" "BehaviorDirection" NOT NULL,
  "wallet_address_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "coin" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "before_position" DECIMAL(38,18) NOT NULL,
  "after_position" DECIMAL(38,18) NOT NULL,
  "quantity_delta" DECIMAL(38,18) NOT NULL,
  "notional_delta_usd" DECIMAL(38,18) NOT NULL,
  "source_type" TEXT NOT NULL DEFAULT 'NORMALIZED_TRADE',
  "source_event_id" TEXT NOT NULL,
  "source_trade_id" TEXT,
  "source_ordinal" INTEGER NOT NULL,
  "source_price" DECIMAL(38,18) NOT NULL,
  "source_quantity" DECIMAL(38,18) NOT NULL,
  "normalization_run_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "selected_wallet_behavior_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "behavior_selection_scopes" (
  "id" TEXT NOT NULL,
  "selection_run_id" TEXT NOT NULL,
  "wallet_address_id" TEXT NOT NULL,
  "performance_run_id" TEXT,
  "behavior_normalization_run_id" TEXT NOT NULL,
  "evaluated_at" TIMESTAMP(3) NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "behavior_selection_scopes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "behavior_normalization_cursors" (
  "id" TEXT NOT NULL,
  "wallet_address_id" TEXT NOT NULL,
  "coin" TEXT NOT NULL,
  "behavior_version" TEXT NOT NULL,
  "last_completed_timestamp" TIMESTAMP(3),
  "boundary_after_position" DECIMAL(38,18),
  "last_source_event_id" TEXT,
  "normalization_run_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "behavior_normalization_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "behavior_data_quality_issues" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "reason" "BehaviorDataQualityReason" NOT NULL,
  "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
  "behavior_version" TEXT NOT NULL,
  "wallet_address_id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "coin" TEXT NOT NULL,
  "source_event_id" TEXT,
  "source_group_at" TIMESTAMP(3),
  "normalization_run_id" TEXT NOT NULL,
  "detail" TEXT NOT NULL,
  "first_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMP(3),
  "reevaluation_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "behavior_data_quality_issues_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "behavior_runs_input_key" ON "behavior_normalization_runs"("behavior_version", "wallet_address_id", "coin", "calculation_from", "calculation_to", "input_fingerprint");
CREATE INDEX "behavior_runs_wallet_coin_status_idx" ON "behavior_normalization_runs"("wallet_address_id", "coin", "behavior_version", "status");
CREATE UNIQUE INDEX "behavior_events_fingerprint_key" ON "selected_wallet_behavior_events"("fingerprint");
CREATE UNIQUE INDEX "behavior_events_source_ordinal_key" ON "selected_wallet_behavior_events"("behavior_version", "source_event_id", "source_ordinal");
CREATE INDEX "behavior_events_wallet_coin_time_idx" ON "selected_wallet_behavior_events"("wallet_address_id", "coin", "occurred_at", "id");
CREATE INDEX "behavior_events_coin_time_idx" ON "selected_wallet_behavior_events"("coin", "occurred_at", "id");
CREATE INDEX "behavior_events_run_idx" ON "selected_wallet_behavior_events"("normalization_run_id");
CREATE UNIQUE INDEX "behavior_selection_scopes_key" ON "behavior_selection_scopes"("selection_run_id", "wallet_address_id", "behavior_normalization_run_id");
CREATE INDEX "behavior_selection_scopes_wallet_run_idx" ON "behavior_selection_scopes"("wallet_address_id", "selection_run_id");
CREATE INDEX "behavior_selection_scopes_normalization_run_idx" ON "behavior_selection_scopes"("behavior_normalization_run_id");
CREATE UNIQUE INDEX "behavior_cursors_wallet_coin_version_key" ON "behavior_normalization_cursors"("wallet_address_id", "coin", "behavior_version");
CREATE INDEX "behavior_cursors_run_idx" ON "behavior_normalization_cursors"("normalization_run_id");
CREATE UNIQUE INDEX "behavior_dq_fingerprint_key" ON "behavior_data_quality_issues"("fingerprint");
CREATE INDEX "behavior_dq_wallet_coin_status_idx" ON "behavior_data_quality_issues"("wallet_address_id", "coin", "status", "reason");
CREATE INDEX "behavior_dq_run_status_idx" ON "behavior_data_quality_issues"("normalization_run_id", "status");

ALTER TABLE "behavior_normalization_runs" ADD CONSTRAINT "behavior_normalization_runs_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_normalization_runs" ADD CONSTRAINT "behavior_normalization_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selected_wallet_behavior_events" ADD CONSTRAINT "selected_wallet_behavior_events_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selected_wallet_behavior_events" ADD CONSTRAINT "selected_wallet_behavior_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selected_wallet_behavior_events" ADD CONSTRAINT "selected_wallet_behavior_events_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "normalized_trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "selected_wallet_behavior_events" ADD CONSTRAINT "selected_wallet_behavior_events_normalization_run_id_fkey" FOREIGN KEY ("normalization_run_id") REFERENCES "behavior_normalization_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_selection_scopes" ADD CONSTRAINT "behavior_selection_scopes_selection_run_id_fkey" FOREIGN KEY ("selection_run_id") REFERENCES "wallet_selection_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_selection_scopes" ADD CONSTRAINT "behavior_selection_scopes_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_selection_scopes" ADD CONSTRAINT "behavior_selection_scopes_performance_run_id_fkey" FOREIGN KEY ("performance_run_id") REFERENCES "metric_calculation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_selection_scopes" ADD CONSTRAINT "behavior_selection_scopes_behavior_normalization_run_id_fkey" FOREIGN KEY ("behavior_normalization_run_id") REFERENCES "behavior_normalization_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_normalization_cursors" ADD CONSTRAINT "behavior_normalization_cursors_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_normalization_cursors" ADD CONSTRAINT "behavior_normalization_cursors_normalization_run_id_fkey" FOREIGN KEY ("normalization_run_id") REFERENCES "behavior_normalization_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_data_quality_issues" ADD CONSTRAINT "behavior_data_quality_issues_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_data_quality_issues" ADD CONSTRAINT "behavior_data_quality_issues_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_data_quality_issues" ADD CONSTRAINT "behavior_data_quality_issues_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "normalized_trades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "behavior_data_quality_issues" ADD CONSTRAINT "behavior_data_quality_issues_normalization_run_id_fkey" FOREIGN KEY ("normalization_run_id") REFERENCES "behavior_normalization_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
