-- Phase 4.3 service review: 現在有効な選定実行を明示的に保持する。
ALTER TABLE "wallet_selection_settings"
ADD COLUMN "current_selection_run_id" TEXT;

CREATE UNIQUE INDEX "wallet_selection_settings_current_run_key"
ON "wallet_selection_settings"("current_selection_run_id");

ALTER TABLE "wallet_selection_settings"
ADD CONSTRAINT "wallet_selection_settings_current_run_id_fkey"
FOREIGN KEY ("current_selection_run_id")
REFERENCES "wallet_selection_runs"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

COMMENT ON COLUMN "wallet_selection_settings"."current_selection_run_id"
IS '現在有効な参考ウォレット選定実行ID';
