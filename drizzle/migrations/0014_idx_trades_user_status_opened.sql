-- Add composite index to speed filtered trades queries by user, status, ordered by opened_at desc
-- Recommended by app/api/trades/route.ts comments
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trades_user_status_opened
ON trades(user_id, status, opened_at DESC);

-- If you need to roll back, drop the index (non-concurrent drop is fine during maintenance window):
-- DROP INDEX IF EXISTS idx_trades_user_status_opened;
