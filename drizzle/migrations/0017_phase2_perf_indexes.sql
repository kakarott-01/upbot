-- Phase 2 performance indexes
-- Apply safely on Neon with concurrent builds to avoid blocking writes.

-- Covers: performance route WHERE user_id + status='closed' + closed_at range
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trades_user_status_closed
ON trades(user_id, status, closed_at DESC)
WHERE status = 'closed';

-- Covers: open trade counts per market
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trades_user_market_status
ON trades(user_id, market_type, status);

-- Covers: bot stop/cleanup/history WHERE user_id + status IN (running, stopping)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_bot_sessions_user_status
ON bot_sessions(user_id, status, started_at DESC);

-- Intentionally not adding an INCLUDE(net_pnl, pnl, fee_amount) index yet.
-- Wait for EXPLAIN ANALYZE on the summary aggregates before paying the extra
-- write/storage cost for a covering index.
