WITH ranked_market_configs AS (
  SELECT
    ctid,
    row_number() OVER (
      PARTITION BY user_id, market_type
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS rn
  FROM market_configs
)
DELETE FROM market_configs mc
USING ranked_market_configs ranked
WHERE mc.ctid = ranked.ctid
  AND ranked.rn > 1;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS market_configs_user_market_uq
  ON market_configs(user_id, market_type);
