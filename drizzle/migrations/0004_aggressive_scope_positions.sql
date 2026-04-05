ALTER TABLE "trades"
  ADD COLUMN IF NOT EXISTS "strategy_key" varchar(100),
  ADD COLUMN IF NOT EXISTS "position_scope_key" varchar(160);
--> statement-breakpoint
UPDATE "trades"
SET
  "strategy_key" = COALESCE("strategy_key", "algo_used"),
  "position_scope_key" = COALESCE("position_scope_key", "algo_used", "symbol", 'default')
WHERE
  "strategy_key" IS NULL
  OR "position_scope_key" IS NULL;
--> statement-breakpoint
ALTER TABLE "trades"
  ALTER COLUMN "position_scope_key" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "trades"
  ALTER COLUMN "position_scope_key" SET DEFAULT 'default';
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_trades_one_open_per_symbol";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_trades_one_open_per_scope"
  ON "trades" ("user_id", "market_type", "symbol", "position_scope_key")
  WHERE "status" = 'open';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_strategy_idx" ON "trades" ("strategy_key");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_scope_idx" ON "trades" ("user_id", "market_type", "symbol", "position_scope_key");
