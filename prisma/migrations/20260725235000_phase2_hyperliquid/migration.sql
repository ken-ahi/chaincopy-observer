-- CreateEnum
CREATE TYPE "SyncCursorStatus" AS ENUM ('IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED', 'GAP_DETECTED');

-- CreateEnum
CREATE TYPE "DataQualityIssueStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "EventTransport" AS ENUM ('HTTP', 'WEBSOCKET');

-- CreateEnum
CREATE TYPE "TradeSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('LONG', 'SHORT');

-- AlterTable
ALTER TABLE "sync_jobs" ADD COLUMN "wallet_address_id" TEXT;

-- CreateTable
CREATE TABLE "wallet_addresses" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "display_name" TEXT,
    "is_watched" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "source_id" TEXT NOT NULL,
    "owner_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raw_events" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "external_event_id" TEXT,
    "event_type" TEXT NOT NULL,
    "transport" "EventTransport" NOT NULL,
    "event_time" TIMESTAMP(3),
    "raw_payload" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raw_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normalized_trades" (
    "id" TEXT NOT NULL,
    "external_trade_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "direction" TEXT NOT NULL,
    "price" DECIMAL(38,18) NOT NULL,
    "size" DECIMAL(38,18) NOT NULL,
    "fee" DECIMAL(38,18) NOT NULL,
    "fee_token" TEXT NOT NULL,
    "closed_pnl" DECIMAL(38,18) NOT NULL,
    "start_position" DECIMAL(38,18) NOT NULL,
    "crossed" BOOLEAN NOT NULL,
    "order_id" TEXT NOT NULL,
    "transaction_hash" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "normalized_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funding_payments" (
    "id" TEXT NOT NULL,
    "external_payment_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "amount" DECIMAL(38,18) NOT NULL,
    "position_size" DECIMAL(38,18) NOT NULL,
    "funding_rate" DECIMAL(38,18) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "funding_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_flows" (
    "id" TEXT NOT NULL,
    "external_flow_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "flow_type" TEXT NOT NULL,
    "asset" TEXT,
    "amount" DECIMAL(38,18),
    "usd_value" DECIMAL(38,18),
    "fee" DECIMAL(38,18),
    "counterparty" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "raw_payload" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_flows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perp_positions" (
    "id" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "side" "PositionSide" NOT NULL,
    "size" DECIMAL(38,18) NOT NULL,
    "entry_price" DECIMAL(38,18),
    "position_value" DECIMAL(38,18) NOT NULL,
    "unrealized_pnl" DECIMAL(38,18) NOT NULL,
    "return_on_equity" DECIMAL(38,18) NOT NULL,
    "margin_used" DECIMAL(38,18) NOT NULL,
    "liquidation_price" DECIMAL(38,18),
    "leverage_type" TEXT NOT NULL,
    "leverage_value" DECIMAL(38,18) NOT NULL,
    "max_leverage" DECIMAL(38,18) NOT NULL,
    "updated_external_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "perp_positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perp_position_events" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "side" "PositionSide" NOT NULL,
    "size" DECIMAL(38,18) NOT NULL,
    "entry_price" DECIMAL(38,18),
    "position_value" DECIMAL(38,18) NOT NULL,
    "unrealized_pnl" DECIMAL(38,18) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perp_position_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_snapshots" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "snapshot_type" TEXT NOT NULL,
    "account_value" DECIMAL(38,18),
    "total_notional_position" DECIMAL(38,18),
    "total_margin_used" DECIMAL(38,18),
    "withdrawable" DECIMAL(38,18),
    "raw_payload" TEXT NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spot_balance_snapshots" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "token_index" INTEGER NOT NULL,
    "total" DECIMAL(38,18) NOT NULL,
    "hold" DECIMAL(38,18) NOT NULL,
    "entry_notional" DECIMAL(38,18) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "spot_balance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_history" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "client_order_id" TEXT,
    "coin" TEXT NOT NULL,
    "side" "TradeSide" NOT NULL,
    "status" TEXT NOT NULL,
    "order_type" TEXT NOT NULL,
    "limit_price" DECIMAL(38,18) NOT NULL,
    "size" DECIMAL(38,18) NOT NULL,
    "original_size" DECIMAL(38,18) NOT NULL,
    "reduce_only" BOOLEAN NOT NULL,
    "status_timestamp" TIMESTAMP(3) NOT NULL,
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
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
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_issues" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "issue_type" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "details" JSONB,
    "first_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "source_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_quality_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_addresses_is_watched_updated_at_idx" ON "wallet_addresses"("is_watched", "updated_at");

-- CreateIndex
CREATE INDEX "wallet_addresses_owner_user_id_idx" ON "wallet_addresses"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallet_addresses_source_id_address_key" ON "wallet_addresses"("source_id", "address");

-- CreateIndex
CREATE INDEX "raw_events_wallet_address_id_event_time_idx" ON "raw_events"("wallet_address_id", "event_time");

-- CreateIndex
CREATE INDEX "raw_events_event_type_received_at_idx" ON "raw_events"("event_type", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "raw_events_source_id_fingerprint_key" ON "raw_events"("source_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "raw_events_source_id_external_event_id_key" ON "raw_events"("source_id", "external_event_id");

-- CreateIndex
CREATE INDEX "normalized_trades_wallet_address_id_occurred_at_idx" ON "normalized_trades"("wallet_address_id", "occurred_at");

-- CreateIndex
CREATE INDEX "normalized_trades_coin_occurred_at_idx" ON "normalized_trades"("coin", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "normalized_trades_source_id_external_trade_id_key" ON "normalized_trades"("source_id", "external_trade_id");

-- CreateIndex
CREATE UNIQUE INDEX "normalized_trades_source_id_fingerprint_key" ON "normalized_trades"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "funding_payments_wallet_address_id_occurred_at_idx" ON "funding_payments"("wallet_address_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "funding_payments_source_id_external_payment_id_key" ON "funding_payments"("source_id", "external_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "funding_payments_source_id_fingerprint_key" ON "funding_payments"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "cash_flows_wallet_address_id_occurred_at_idx" ON "cash_flows"("wallet_address_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "cash_flows_source_id_external_flow_id_key" ON "cash_flows"("source_id", "external_flow_id");

-- CreateIndex
CREATE UNIQUE INDEX "cash_flows_source_id_fingerprint_key" ON "cash_flows"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "perp_positions_source_id_coin_idx" ON "perp_positions"("source_id", "coin");

-- CreateIndex
CREATE UNIQUE INDEX "perp_positions_wallet_address_id_coin_key" ON "perp_positions"("wallet_address_id", "coin");

-- CreateIndex
CREATE INDEX "perp_position_events_wallet_address_id_occurred_at_idx" ON "perp_position_events"("wallet_address_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "perp_position_events_source_id_fingerprint_key" ON "perp_position_events"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "portfolio_snapshots_wallet_address_id_captured_at_idx" ON "portfolio_snapshots"("wallet_address_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_snapshots_source_id_fingerprint_key" ON "portfolio_snapshots"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "spot_balance_snapshots_wallet_address_id_captured_at_idx" ON "spot_balance_snapshots"("wallet_address_id", "captured_at");

-- CreateIndex
CREATE UNIQUE INDEX "spot_balance_snapshots_source_id_fingerprint_key" ON "spot_balance_snapshots"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "order_history_wallet_address_id_status_timestamp_idx" ON "order_history"("wallet_address_id", "status_timestamp");

-- CreateIndex
CREATE INDEX "order_history_order_id_idx" ON "order_history"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_history_source_id_fingerprint_key" ON "order_history"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "sync_cursors_status_last_attempted_at_idx" ON "sync_cursors"("status", "last_attempted_at");

-- CreateIndex
CREATE UNIQUE INDEX "sync_cursors_source_id_wallet_address_id_scope_cursor_type_key" ON "sync_cursors"("source_id", "wallet_address_id", "scope", "cursor_type");

-- CreateIndex
CREATE UNIQUE INDEX "data_quality_issues_fingerprint_key" ON "data_quality_issues"("fingerprint");

-- CreateIndex
CREATE INDEX "data_quality_issues_wallet_address_id_status_severity_idx" ON "data_quality_issues"("wallet_address_id", "status", "severity");

-- CreateIndex
CREATE INDEX "sync_jobs_wallet_address_id_status_created_at_idx" ON "sync_jobs"("wallet_address_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_addresses" ADD CONSTRAINT "wallet_addresses_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normalized_trades" ADD CONSTRAINT "normalized_trades_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normalized_trades" ADD CONSTRAINT "normalized_trades_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_payments" ADD CONSTRAINT "funding_payments_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funding_payments" ADD CONSTRAINT "funding_payments_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flows" ADD CONSTRAINT "cash_flows_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_flows" ADD CONSTRAINT "cash_flows_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perp_positions" ADD CONSTRAINT "perp_positions_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perp_positions" ADD CONSTRAINT "perp_positions_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perp_position_events" ADD CONSTRAINT "perp_position_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perp_position_events" ADD CONSTRAINT "perp_position_events_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spot_balance_snapshots" ADD CONSTRAINT "spot_balance_snapshots_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spot_balance_snapshots" ADD CONSTRAINT "spot_balance_snapshots_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_history" ADD CONSTRAINT "order_history_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
