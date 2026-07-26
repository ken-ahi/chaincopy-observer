-- CreateEnum
CREATE TYPE "MetricCalculationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'INSUFFICIENT_DATA', 'FAILED');

CREATE TYPE "PerformanceHistoryCompleteness" AS ENUM ('COMPLETE', 'PARTIAL', 'TRUNCATED', 'GAP_DETECTED', 'INSUFFICIENT_HISTORY');

CREATE TYPE "PerformancePrecision" AS ENUM ('EXACT', 'DERIVED', 'ESTIMATED', 'UNAVAILABLE');

CREATE TYPE "PerformanceMetricStatus" AS ENUM ('AVAILABLE', 'REFERENCE_ONLY');

CREATE TYPE "PositionCycleStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "metric_calculation_runs" (
    "id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "calculation_version" TEXT NOT NULL,
    "calculation_from" TIMESTAMP(3) NOT NULL,
    "calculation_to" TIMESTAMP(3) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL,
    "requested_by" TEXT NOT NULL,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "status" "MetricCalculationStatus" NOT NULL DEFAULT 'PENDING',
    "history_completeness" "PerformanceHistoryCompleteness" NOT NULL,
    "precision" "PerformancePrecision",
    "input_fingerprint" TEXT NOT NULL,
    "deduplication_key" TEXT NOT NULL,
    "warning_count" INTEGER NOT NULL DEFAULT 0,
    "warning_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "error_code" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_calculation_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "daily_navs" (
    "id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "nav" DECIMAL(38,18) NOT NULL,
    "cash_balance" DECIMAL(38,18),
    "unrealized_pnl" DECIMAL(38,18),
    "realized_pnl" DECIMAL(38,18),
    "funding" DECIMAL(38,18),
    "fees" DECIMAL(38,18),
    "external_cash_flow" DECIMAL(38,18),
    "precision" "PerformancePrecision" NOT NULL,
    "history_completeness" "PerformanceHistoryCompleteness" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_navs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "position_cycles" (
    "id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "coin" TEXT NOT NULL,
    "side" "PositionSide" NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "average_entry_price" DECIMAL(38,18) NOT NULL,
    "average_exit_price" DECIMAL(38,18),
    "entry_quantity" DECIMAL(38,18) NOT NULL,
    "exit_quantity" DECIMAL(38,18) NOT NULL,
    "gross_realized_pnl" DECIMAL(38,18) NOT NULL,
    "fees" DECIMAL(38,18) NOT NULL,
    "funding" DECIMAL(38,18) NOT NULL,
    "net_realized_pnl" DECIMAL(38,18) NOT NULL,
    "fill_count" INTEGER NOT NULL,
    "status" "PositionCycleStatus" NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_cycles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "address_performance_metrics" (
    "id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "calculation_run_id" TEXT NOT NULL,
    "metric_key" TEXT NOT NULL,
    "metric_value" DECIMAL(38,18) NOT NULL,
    "precision" "PerformancePrecision" NOT NULL,
    "status" "PerformanceMetricStatus" NOT NULL,
    "warning_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "calculation_from" TIMESTAMP(3) NOT NULL,
    "calculation_to" TIMESTAMP(3) NOT NULL,
    "metric_version" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "address_performance_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "metric_runs_dedup_key" ON "metric_calculation_runs"("deduplication_key");

CREATE INDEX "metric_runs_wallet_status_requested_idx" ON "metric_calculation_runs"("wallet_address_id", "status", "requested_at");

CREATE INDEX "metric_runs_input_idx" ON "metric_calculation_runs"("wallet_address_id", "calculation_version", "input_fingerprint");

CREATE UNIQUE INDEX "daily_navs_run_date_key" ON "daily_navs"("calculation_run_id", "date");

CREATE INDEX "daily_navs_wallet_date_idx" ON "daily_navs"("wallet_address_id", "date");

CREATE UNIQUE INDEX "position_cycles_run_input_key" ON "position_cycles"("calculation_run_id", "input_fingerprint");

CREATE INDEX "position_cycles_wallet_opened_idx" ON "position_cycles"("wallet_address_id", "opened_at");

CREATE UNIQUE INDEX "performance_metrics_run_key" ON "address_performance_metrics"("calculation_run_id", "metric_key");

CREATE INDEX "performance_metrics_wallet_key_to_idx" ON "address_performance_metrics"("wallet_address_id", "metric_key", "calculation_to");

-- AddForeignKey
ALTER TABLE "metric_calculation_runs" ADD CONSTRAINT "metric_calculation_runs_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_navs" ADD CONSTRAINT "daily_navs_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_navs" ADD CONSTRAINT "daily_navs_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "metric_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "position_cycles" ADD CONSTRAINT "position_cycles_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "position_cycles" ADD CONSTRAINT "position_cycles_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "metric_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "address_performance_metrics" ADD CONSTRAINT "address_performance_metrics_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "address_performance_metrics" ADD CONSTRAINT "address_performance_metrics_calculation_run_id_fkey" FOREIGN KEY ("calculation_run_id") REFERENCES "metric_calculation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
