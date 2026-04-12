DROP TABLE "backtest_results";--> statement-breakpoint
DROP TABLE "blocked_trades";--> statement-breakpoint
DROP TABLE "global_exposure_reservations";--> statement-breakpoint
DROP TABLE "kill_switch_state";--> statement-breakpoint
DROP TABLE "risk_events";--> statement-breakpoint
DROP TABLE "strategy_configs";--> statement-breakpoint
DROP TABLE "strategy_performance";--> statement-breakpoint
DROP TABLE "strategy_positions";--> statement-breakpoint
ALTER TABLE "backtest_runs" DROP COLUMN IF EXISTS "strategy_config_id";--> statement-breakpoint
ALTER TABLE "backtest_runs" DROP COLUMN IF EXISTS "strategy_breakdown";--> statement-breakpoint
ALTER TABLE "backtest_runs" DROP COLUMN IF EXISTS "backtest_assumptions";