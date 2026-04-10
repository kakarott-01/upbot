ALTER TABLE IF EXISTS backtest_runs DROP COLUMN IF EXISTS strategy_config_id;
ALTER TABLE IF EXISTS backtest_runs DROP COLUMN IF EXISTS strategy_breakdown;
ALTER TABLE IF EXISTS backtest_runs DROP COLUMN IF EXISTS backtest_assumptions;

DROP TABLE IF EXISTS blocked_trades;
DROP TABLE IF EXISTS risk_events;
DROP TABLE IF EXISTS position_close_log;
DROP TABLE IF EXISTS strategy_positions;
DROP TABLE IF EXISTS strategy_performance;
DROP TABLE IF EXISTS backtest_results;
DROP TABLE IF EXISTS strategy_configs;
DROP TABLE IF EXISTS kill_switch_state;
DROP TABLE IF EXISTS global_exposure_reservations;
