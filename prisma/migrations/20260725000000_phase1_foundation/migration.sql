-- CreateEnum
CREATE TYPE "DataSourceKind" AS ENUM ('HYPERLIQUID', 'SUI', 'CETUS', 'SYSTEM');

-- CreateEnum
CREATE TYPE "OperationalStatus" AS ENUM ('UNKNOWN', 'HEALTHY', 'DEGRADED', 'UNAVAILABLE');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARNING', 'ERROR', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "email_verified" TIMESTAMP(3),
    "image" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_account_id" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "oauth_token_secret" TEXT,
    "oauth_token" TEXT,
    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "session_token" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DataSourceKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "OperationalStatus" NOT NULL DEFAULT 'UNKNOWN',
    "last_success_at" TIMESTAMP(3),
    "last_failure_at" TIMESTAMP(3),
    "status_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "queue_job_id" TEXT,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "error_message" TEXT,
    "metadata" JSONB,
    "source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "source_id" TEXT,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "accounts_provider_provider_account_id_key" ON "accounts"("provider", "provider_account_id");
CREATE INDEX "accounts_user_id_idx" ON "accounts"("user_id");
CREATE UNIQUE INDEX "sessions_session_token_key" ON "sessions"("session_token");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE UNIQUE INDEX "verification_tokens_identifier_token_key" ON "verification_tokens"("identifier", "token");
CREATE UNIQUE INDEX "data_sources_key_key" ON "data_sources"("key");
CREATE UNIQUE INDEX "sync_jobs_idempotency_key_key" ON "sync_jobs"("idempotency_key");
CREATE INDEX "sync_jobs_status_created_at_idx" ON "sync_jobs"("status", "created_at");
CREATE INDEX "sync_jobs_source_id_idx" ON "sync_jobs"("source_id");
CREATE UNIQUE INDEX "system_alerts_fingerprint_key" ON "system_alerts"("fingerprint");
CREATE INDEX "system_alerts_status_severity_idx" ON "system_alerts"("status", "severity");
CREATE INDEX "system_alerts_source_id_idx" ON "system_alerts"("source_id");
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
