-- 0015_trade_spool.sql
-- Add persistent DB spool for pending live trades to survive restarts

CREATE TABLE IF NOT EXISTS trade_spool (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL,
  retry_count int NOT NULL DEFAULT 0,
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_spool_user ON trade_spool(user_id, created_at);

-- Rollback helpers (uncomment during manual rollback windows):
-- DROP INDEX IF EXISTS idx_trade_spool_user;
-- DROP TABLE IF EXISTS trade_spool;
