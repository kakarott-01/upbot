DO $$
BEGIN
  CREATE TYPE strategy_priority AS ENUM ('HIGH', 'MEDIUM', 'LOW');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE risk_event_severity AS ENUM ('info', 'warning', 'critical');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE market_strategy_selections
  ADD COLUMN IF NOT EXISTS priority strategy_priority NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS cooldown_after_trade_sec integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS per_trade_percent numeric(6,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS max_active_percent numeric(6,2) NOT NULL DEFAULT 25.00,
  ADD COLUMN IF NOT EXISTS health_min_win_rate_pct numeric(6,2) NOT NULL DEFAULT 30.00,
  ADD COLUMN IF NOT EXISTS health_max_drawdown_pct numeric(6,2) NOT NULL DEFAULT 15.00,
  ADD COLUMN IF NOT EXISTS health_max_loss_streak integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS is_auto_disabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_disabled_reason text,
  ADD COLUMN IF NOT EXISTS last_trade_at timestamp;

ALTER TABLE risk_settings
  ADD COLUMN IF NOT EXISTS max_total_exposure numeric(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_daily_loss numeric(20,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_open_positions integer NOT NULL DEFAULT 0;

ALTER TABLE strategy_performance
  ADD COLUMN IF NOT EXISTS loss_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_equity numeric(20,8) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_health_status varchar(30) NOT NULL DEFAULT 'healthy';

ALTER TABLE backtest_runs
  ADD COLUMN IF NOT EXISTS backtest_assumptions jsonb;

ALTER TABLE strategy_configs
  ADD COLUMN IF NOT EXISTS strategy_settings jsonb;

CREATE TABLE IF NOT EXISTS kill_switch_state (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_active boolean NOT NULL DEFAULT false,
  close_positions boolean NOT NULL DEFAULT false,
  reason text,
  activated_at timestamp,
  last_deactivated_at timestamp,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS blocked_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_type market_type NOT NULL,
  symbol varchar(50) NOT NULL,
  side trade_side NOT NULL,
  strategy_key varchar(100),
  position_scope_key varchar(160),
  reason_code varchar(80) NOT NULL,
  reason_message text NOT NULL,
  details jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS blocked_trades_user_idx ON blocked_trades(user_id, created_at);
CREATE INDEX IF NOT EXISTS blocked_trades_strategy_idx ON blocked_trades(user_id, strategy_key, created_at);

CREATE TABLE IF NOT EXISTS risk_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  market_type market_type,
  symbol varchar(50),
  strategy_key varchar(100),
  event_type varchar(80) NOT NULL,
  severity risk_event_severity NOT NULL DEFAULT 'warning',
  message text NOT NULL,
  payload jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS risk_events_user_idx ON risk_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS risk_events_type_idx ON risk_events(user_id, event_type, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS strategy_performance_user_market_strategy_uq
ON strategy_performance(user_id, market_type, strategy_key);
