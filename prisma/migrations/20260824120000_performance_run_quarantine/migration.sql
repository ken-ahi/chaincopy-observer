CREATE TYPE "PerformanceRunTrustState" AS ENUM ('TRUSTED', 'QUARANTINED');

ALTER TABLE "metric_calculation_runs"
ADD COLUMN "trust_state" "PerformanceRunTrustState" NOT NULL DEFAULT 'TRUSTED',
ADD COLUMN "trust_revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "performance_run_trust_transitions" (
    "id" TEXT NOT NULL,
    "performance_run_id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "from_state" "PerformanceRunTrustState" NOT NULL,
    "to_state" "PerformanceRunTrustState" NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reason_detail" TEXT,
    "incident_ref" TEXT,
    "actor" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "performance_run_trust_transitions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "metric_calculation_runs"
ADD CONSTRAINT "metric_runs_trust_revision_nonnegative" CHECK ("trust_revision" >= 0);

ALTER TABLE "performance_run_trust_transitions"
ADD CONSTRAINT "performance_run_trust_state_changes" CHECK ("from_state" <> "to_state");

CREATE UNIQUE INDEX "performance_run_trust_operation_key"
ON "performance_run_trust_transitions"("operation_key");

CREATE UNIQUE INDEX "performance_run_trust_revision_key"
ON "performance_run_trust_transitions"("performance_run_id", "revision");

CREATE INDEX "performance_run_trust_run_created_idx"
ON "performance_run_trust_transitions"("performance_run_id", "created_at");

CREATE INDEX "metric_runs_trusted_lookup_idx"
ON "metric_calculation_runs"("wallet_address_id", "calculation_version", "status", "trust_state", "requested_at" DESC);

ALTER TABLE "performance_run_trust_transitions"
ADD CONSTRAINT "performance_run_trust_transitions_performance_run_id_fkey"
FOREIGN KEY ("performance_run_id") REFERENCES "metric_calculation_runs"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
