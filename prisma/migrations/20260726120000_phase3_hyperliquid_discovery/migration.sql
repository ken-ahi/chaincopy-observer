-- CreateEnum
CREATE TYPE "CandidateEnrichmentStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'RATE_LIMITED');

CREATE TYPE "CandidateFilterStatus" AS ENUM ('PENDING', 'LIGHT_ELIGIBLE', 'INSUFFICIENT_HISTORY', 'ELIGIBLE', 'EXCLUDED', 'PROMOTED');

CREATE TYPE "CandidateHistoryCompleteness" AS ENUM ('UNKNOWN', 'COMPLETE', 'PARTIAL', 'INSUFFICIENT');

CREATE TYPE "CandidateTradeRole" AS ENUM ('BUYER', 'SELLER', 'SELF');

CREATE TYPE "CandidateLiquidityRole" AS ENUM ('MAKER', 'TAKER');

CREATE TYPE "CandidateActivityPeriod" AS ENUM ('DAY', 'HOUR');

CREATE TYPE "DiscoveryMode" AS ENUM ('MAJOR', 'ALL');

CREATE TYPE "DiscoveryConnectionStatus" AS ENUM ('STOPPED', 'STARTING', 'CONNECTED', 'RECONNECTING', 'DEGRADED');

-- AlterTable
ALTER TABLE "sync_jobs" ADD COLUMN "address_candidate_id" TEXT;

-- CreateTable
CREATE TABLE "address_candidates" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "discovery_source" TEXT NOT NULL DEFAULT 'HYPERLIQUID_MARKET_TRADES',
    "trade_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_notional_usd" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "maker_count" INTEGER NOT NULL DEFAULT 0,
    "taker_count" INTEGER NOT NULL DEFAULT 0,
    "buy_count" INTEGER NOT NULL DEFAULT 0,
    "sell_count" INTEGER NOT NULL DEFAULT 0,
    "long_related_count" INTEGER NOT NULL DEFAULT 0,
    "short_related_count" INTEGER NOT NULL DEFAULT 0,
    "distinct_coins" INTEGER NOT NULL DEFAULT 0,
    "largest_trade_usd" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "average_trade_usd" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "active_days" INTEGER NOT NULL DEFAULT 0,
    "active_hours" INTEGER NOT NULL DEFAULT 0,
    "enrichment_status" "CandidateEnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "filter_status" "CandidateFilterStatus" NOT NULL DEFAULT 'PENDING',
    "exclusion_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "promoted_at" TIMESTAMP(3),
    "last_enriched_at" TIMESTAMP(3),
    "next_enrichment_at" TIMESTAMP(3),
    "data_quality_score" INTEGER NOT NULL DEFAULT 0,
    "available_from" TIMESTAMP(3),
    "available_to" TIMESTAMP(3),
    "retrieved_fill_count" INTEGER NOT NULL DEFAULT 0,
    "history_completeness" "CandidateHistoryCompleteness" NOT NULL DEFAULT 'UNKNOWN',
    "history_truncated" BOOLEAN NOT NULL DEFAULT false,
    "truncation_reason" TEXT,
    "enrichment_metadata" JSONB,
    "source_id" TEXT NOT NULL,
    "promoted_wallet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "address_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discovery_trades" (
    "id" TEXT NOT NULL,
    "external_trade_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "price" DECIMAL(38,18) NOT NULL,
    "size" DECIMAL(38,18) NOT NULL,
    "notional_usd" DECIMAL(38,18) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "trade_id" TEXT NOT NULL,
    "buyer_address" TEXT NOT NULL,
    "seller_address" TEXT NOT NULL,
    "raw_payload" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_trades_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidate_trade_participations" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "discovery_trade_id" TEXT NOT NULL,
    "role" "CandidateTradeRole" NOT NULL,
    "liquidity_role" "CandidateLiquidityRole" NOT NULL,
    "side" "TradeSide" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_trade_participations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidate_coins" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "trade_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "candidate_coins_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidate_activity_buckets" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "period" "CandidateActivityPeriod" NOT NULL,
    "bucket_start" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_activity_buckets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidate_enrichment_attempts" (
    "id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "requested_from" TIMESTAMP(3) NOT NULL,
    "requested_to" TIMESTAMP(3) NOT NULL,
    "available_from" TIMESTAMP(3),
    "available_to" TIMESTAMP(3),
    "retrieved_fill_count" INTEGER NOT NULL DEFAULT 0,
    "history_completeness" "CandidateHistoryCompleteness" NOT NULL DEFAULT 'UNKNOWN',
    "history_truncated" BOOLEAN NOT NULL DEFAULT false,
    "truncation_reason" TEXT,
    "endpoint_results" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "succeeded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "candidate_enrichment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidate_data_quality_issues" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "candidate_id" TEXT NOT NULL,
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_data_quality_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discovery_settings" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "DiscoveryMode" NOT NULL DEFAULT 'MAJOR',
    "priority_coins" TEXT[] DEFAULT ARRAY['BTC', 'ETH', 'SOL', 'HYPE', 'SUI']::TEXT[],
    "minimum_observed_trade_count" INTEGER NOT NULL DEFAULT 10,
    "minimum_observed_notional_usd" DECIMAL(38,18) NOT NULL DEFAULT 10000,
    "recent_activity_hours" INTEGER NOT NULL DEFAULT 24,
    "full_minimum_trade_count" INTEGER NOT NULL DEFAULT 30,
    "full_minimum_active_days" INTEGER NOT NULL DEFAULT 180,
    "full_minimum_active_months" INTEGER NOT NULL DEFAULT 6,
    "full_minimum_notional_usd" DECIMAL(38,18) NOT NULL DEFAULT 10000,
    "full_recent_activity_days" INTEGER NOT NULL DEFAULT 90,
    "minimum_enrichment_interval_min" INTEGER NOT NULL DEFAULT 1440,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discovery_stats" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "received_trade_events" BIGINT NOT NULL DEFAULT 0,
    "duplicate_trade_events" BIGINT NOT NULL DEFAULT 0,
    "discovered_addresses" BIGINT NOT NULL DEFAULT 0,
    "new_candidates" BIGINT NOT NULL DEFAULT 0,
    "enrichment_succeeded" BIGINT NOT NULL DEFAULT 0,
    "enrichment_failed" BIGINT NOT NULL DEFAULT 0,
    "filter_passed" BIGINT NOT NULL DEFAULT 0,
    "excluded_candidates" BIGINT NOT NULL DEFAULT 0,
    "api_weight_used" INTEGER NOT NULL DEFAULT 0,
    "api_weight_window_started_at" TIMESTAMP(3),
    "queue_depth" INTEGER NOT NULL DEFAULT 0,
    "websocket_status" "DiscoveryConnectionStatus" NOT NULL DEFAULT 'STOPPED',
    "subscribed_coins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_event_at" TIMESTAMP(3),
    "last_connected_at" TIMESTAMP(3),
    "last_disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_stats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discovery_cursors" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "cursor_type" TEXT NOT NULL,
    "last_timestamp" TIMESTAMP(3),
    "last_external_id" TEXT,
    "last_successful_at" TIMESTAMP(3),
    "last_attempted_at" TIMESTAMP(3),
    "status" "SyncCursorStatus" NOT NULL DEFAULT 'IDLE',
    "error_message" TEXT,
    "source_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_cursors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "discovery_data_quality_issues" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "source_id" TEXT NOT NULL,
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_data_quality_issues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sync_jobs_address_candidate_id_status_created_at_idx" ON "sync_jobs"("address_candidate_id", "status", "created_at");
CREATE UNIQUE INDEX "address_candidates_source_id_address_key" ON "address_candidates"("source_id", "address");
CREATE INDEX "address_candidates_filter_status_enrichment_status_last_seen_at_idx" ON "address_candidates"("filter_status", "enrichment_status", "last_seen_at");
CREATE INDEX "address_candidates_estimated_notional_usd_trade_count_idx" ON "address_candidates"("estimated_notional_usd", "trade_count");
CREATE UNIQUE INDEX "discovery_trades_source_id_external_trade_id_key" ON "discovery_trades"("source_id", "external_trade_id");
CREATE UNIQUE INDEX "discovery_trades_source_id_fingerprint_key" ON "discovery_trades"("source_id", "fingerprint");
CREATE INDEX "discovery_trades_coin_occurred_at_idx" ON "discovery_trades"("coin", "occurred_at");
CREATE INDEX "discovery_trades_buyer_address_occurred_at_idx" ON "discovery_trades"("buyer_address", "occurred_at");
CREATE INDEX "discovery_trades_seller_address_occurred_at_idx" ON "discovery_trades"("seller_address", "occurred_at");
CREATE UNIQUE INDEX "candidate_trade_participations_candidate_id_discovery_trade_id_key" ON "candidate_trade_participations"("candidate_id", "discovery_trade_id");
CREATE INDEX "candidate_trade_participations_candidate_id_created_at_idx" ON "candidate_trade_participations"("candidate_id", "created_at");
CREATE UNIQUE INDEX "candidate_coins_candidate_id_coin_key" ON "candidate_coins"("candidate_id", "coin");
CREATE INDEX "candidate_coins_coin_last_seen_at_idx" ON "candidate_coins"("coin", "last_seen_at");
CREATE UNIQUE INDEX "candidate_activity_buckets_candidate_id_period_bucket_start_key" ON "candidate_activity_buckets"("candidate_id", "period", "bucket_start");
CREATE INDEX "candidate_activity_buckets_period_bucket_start_idx" ON "candidate_activity_buckets"("period", "bucket_start");
CREATE INDEX "candidate_enrichment_attempts_candidate_id_started_at_idx" ON "candidate_enrichment_attempts"("candidate_id", "started_at");
CREATE UNIQUE INDEX "candidate_data_quality_issues_fingerprint_key" ON "candidate_data_quality_issues"("fingerprint");
CREATE INDEX "candidate_data_quality_issues_candidate_id_status_severity_idx" ON "candidate_data_quality_issues"("candidate_id", "status", "severity");
CREATE UNIQUE INDEX "discovery_settings_source_id_key" ON "discovery_settings"("source_id");
CREATE UNIQUE INDEX "discovery_stats_source_id_key" ON "discovery_stats"("source_id");
CREATE UNIQUE INDEX "discovery_cursors_source_id_scope_cursor_type_key" ON "discovery_cursors"("source_id", "scope", "cursor_type");
CREATE INDEX "discovery_cursors_status_last_attempted_at_idx" ON "discovery_cursors"("status", "last_attempted_at");
CREATE UNIQUE INDEX "discovery_data_quality_issues_fingerprint_key" ON "discovery_data_quality_issues"("fingerprint");
CREATE INDEX "discovery_data_quality_issues_source_id_status_severity_idx" ON "discovery_data_quality_issues"("source_id", "status", "severity");

ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_address_candidate_id_fkey" FOREIGN KEY ("address_candidate_id") REFERENCES "address_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "address_candidates" ADD CONSTRAINT "address_candidates_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "address_candidates" ADD CONSTRAINT "address_candidates_promoted_wallet_id_fkey" FOREIGN KEY ("promoted_wallet_id") REFERENCES "wallet_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "discovery_trades" ADD CONSTRAINT "discovery_trades_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "candidate_trade_participations" ADD CONSTRAINT "candidate_trade_participations_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "address_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_trade_participations" ADD CONSTRAINT "candidate_trade_participations_discovery_trade_id_fkey" FOREIGN KEY ("discovery_trade_id") REFERENCES "discovery_trades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_coins" ADD CONSTRAINT "candidate_coins_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "address_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_activity_buckets" ADD CONSTRAINT "candidate_activity_buckets_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "address_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_enrichment_attempts" ADD CONSTRAINT "candidate_enrichment_attempts_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "address_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "candidate_data_quality_issues" ADD CONSTRAINT "candidate_data_quality_issues_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "address_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_settings" ADD CONSTRAINT "discovery_settings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_stats" ADD CONSTRAINT "discovery_stats_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_cursors" ADD CONSTRAINT "discovery_cursors_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "discovery_data_quality_issues" ADD CONSTRAINT "discovery_data_quality_issues_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
