ALTER TABLE "address_candidates"
  ALTER COLUMN "exclusion_reasons" SET NOT NULL;

ALTER TABLE "discovery_settings"
  ALTER COLUMN "priority_coins" SET NOT NULL;

ALTER TABLE "discovery_stats"
  ALTER COLUMN "subscribed_coins" SET NOT NULL;
