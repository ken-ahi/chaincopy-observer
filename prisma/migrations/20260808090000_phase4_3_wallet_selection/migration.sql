-- Phase 4.3: 参考ウォレット選定の設定、実行結果、手動指定を追跡する。
-- 既存Performance指標は複製せず、計算実行への参照だけを保持する。

-- CreateEnum
CREATE TYPE "WalletSelectionAutomaticStatus" AS ENUM ('SELECTED', 'QUALIFIED', 'REVIEW', 'EXCLUDED');

CREATE TYPE "WalletSelectionOverrideDecision" AS ENUM ('AUTO', 'INCLUDE', 'EXCLUDE');

-- CreateTable
CREATE TABLE "wallet_selection_settings" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "max_auto_selected" INTEGER NOT NULL DEFAULT 100,
    "minimum_evaluation_days" INTEGER NOT NULL DEFAULT 90,
    "minimum_trusted_closed_cycles" INTEGER NOT NULL DEFAULT 20,
    "minimum_annualized_return" DECIMAL(38,18) NOT NULL DEFAULT 0,
    "maximum_drawdown" DECIMAL(38,18) NOT NULL DEFAULT 0.5,
    "maximum_top_trade_contribution" DECIMAL(38,18) NOT NULL DEFAULT 0.75,
    "maximum_data_age_hours" INTEGER NOT NULL DEFAULT 24,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_selection_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_selection_runs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "policy_version" TEXT NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL,
    "universe_count" INTEGER NOT NULL,
    "selected_count" INTEGER NOT NULL,
    "qualified_count" INTEGER NOT NULL,
    "review_count" INTEGER NOT NULL,
    "excluded_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_selection_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_selection_results" (
    "id" TEXT NOT NULL,
    "selection_run_id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "performance_run_id" TEXT,
    "automatic_status" "WalletSelectionAutomaticStatus" NOT NULL,
    "rank" INTEGER,
    "reason_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wallet_selection_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_selection_overrides" (
    "id" TEXT NOT NULL,
    "wallet_address_id" TEXT NOT NULL,
    "decision" "WalletSelectionOverrideDecision" NOT NULL DEFAULT 'AUTO',
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallet_selection_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wallet_selection_settings_source_id_key" ON "wallet_selection_settings"("source_id");
CREATE UNIQUE INDEX "wallet_selection_runs_input_key" ON "wallet_selection_runs"("source_id", "policy_version", "input_fingerprint");
CREATE INDEX "wallet_selection_runs_source_evaluated_idx" ON "wallet_selection_runs"("source_id", "evaluated_at");
CREATE UNIQUE INDEX "wallet_selection_results_run_wallet_key" ON "wallet_selection_results"("selection_run_id", "wallet_address_id");
CREATE INDEX "wallet_selection_results_wallet_created_idx" ON "wallet_selection_results"("wallet_address_id", "created_at");
CREATE UNIQUE INDEX "wallet_selection_overrides_wallet_address_id_key" ON "wallet_selection_overrides"("wallet_address_id");

-- AddForeignKey
ALTER TABLE "wallet_selection_settings" ADD CONSTRAINT "wallet_selection_settings_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_selection_runs" ADD CONSTRAINT "wallet_selection_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "data_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_selection_results" ADD CONSTRAINT "wallet_selection_results_selection_run_id_fkey" FOREIGN KEY ("selection_run_id") REFERENCES "wallet_selection_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_selection_results" ADD CONSTRAINT "wallet_selection_results_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "wallet_selection_results" ADD CONSTRAINT "wallet_selection_results_performance_run_id_fkey" FOREIGN KEY ("performance_run_id") REFERENCES "metric_calculation_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "wallet_selection_overrides" ADD CONSTRAINT "wallet_selection_overrides_wallet_address_id_fkey" FOREIGN KEY ("wallet_address_id") REFERENCES "wallet_addresses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Japanese logical-name comments
COMMENT ON TABLE "wallet_selection_settings" IS '参考ウォレット選定設定';
COMMENT ON COLUMN "wallet_selection_settings"."id" IS 'ID';
COMMENT ON COLUMN "wallet_selection_settings"."source_id" IS 'データソースID';
COMMENT ON COLUMN "wallet_selection_settings"."max_auto_selected" IS '自動選定する最大件数';
COMMENT ON COLUMN "wallet_selection_settings"."minimum_evaluation_days" IS '最低評価期間（日）';
COMMENT ON COLUMN "wallet_selection_settings"."minimum_trusted_closed_cycles" IS '最低完了取引数';
COMMENT ON COLUMN "wallet_selection_settings"."minimum_annualized_return" IS '最低年率換算収益率';
COMMENT ON COLUMN "wallet_selection_settings"."maximum_drawdown" IS '最大下落の上限';
COMMENT ON COLUMN "wallet_selection_settings"."maximum_top_trade_contribution" IS '大勝ち依存の上限';
COMMENT ON COLUMN "wallet_selection_settings"."maximum_data_age_hours" IS 'データ更新の許容時間';
COMMENT ON COLUMN "wallet_selection_settings"."created_at" IS '登録日時';
COMMENT ON COLUMN "wallet_selection_settings"."updated_at" IS '更新日時';

COMMENT ON TABLE "wallet_selection_runs" IS '参考ウォレット選定実行';
COMMENT ON COLUMN "wallet_selection_runs"."id" IS 'ID';
COMMENT ON COLUMN "wallet_selection_runs"."source_id" IS 'データソースID';
COMMENT ON COLUMN "wallet_selection_runs"."policy_version" IS '選定ポリシーバージョン';
COMMENT ON COLUMN "wallet_selection_runs"."input_fingerprint" IS '入力フィンガープリント';
COMMENT ON COLUMN "wallet_selection_runs"."policy_snapshot" IS '選定設定スナップショット';
COMMENT ON COLUMN "wallet_selection_runs"."evaluated_at" IS '評価日時';
COMMENT ON COLUMN "wallet_selection_runs"."universe_count" IS '評価対象件数';
COMMENT ON COLUMN "wallet_selection_runs"."selected_count" IS '参考対象件数';
COMMENT ON COLUMN "wallet_selection_runs"."qualified_count" IS '候補件数';
COMMENT ON COLUMN "wallet_selection_runs"."review_count" IS '要確認件数';
COMMENT ON COLUMN "wallet_selection_runs"."excluded_count" IS '対象外件数';
COMMENT ON COLUMN "wallet_selection_runs"."created_at" IS '登録日時';

COMMENT ON TABLE "wallet_selection_results" IS '参考ウォレット選定結果';
COMMENT ON COLUMN "wallet_selection_results"."id" IS 'ID';
COMMENT ON COLUMN "wallet_selection_results"."selection_run_id" IS '選定実行ID';
COMMENT ON COLUMN "wallet_selection_results"."wallet_address_id" IS 'ウォレットアドレスID';
COMMENT ON COLUMN "wallet_selection_results"."performance_run_id" IS 'Performance計算実行ID';
COMMENT ON COLUMN "wallet_selection_results"."automatic_status" IS '自動判定ステータス';
COMMENT ON COLUMN "wallet_selection_results"."rank" IS '収益性順位';
COMMENT ON COLUMN "wallet_selection_results"."reason_codes" IS '判定理由コード';
COMMENT ON COLUMN "wallet_selection_results"."created_at" IS '登録日時';

COMMENT ON TABLE "wallet_selection_overrides" IS '参考ウォレット手動指定';
COMMENT ON COLUMN "wallet_selection_overrides"."id" IS 'ID';
COMMENT ON COLUMN "wallet_selection_overrides"."wallet_address_id" IS 'ウォレットアドレスID';
COMMENT ON COLUMN "wallet_selection_overrides"."decision" IS '手動指定';
COMMENT ON COLUMN "wallet_selection_overrides"."note" IS '所有者メモ';
COMMENT ON COLUMN "wallet_selection_overrides"."created_at" IS '登録日時';
COMMENT ON COLUMN "wallet_selection_overrides"."updated_at" IS '更新日時';
