DO $$ BEGIN
 CREATE TYPE "public"."backtest_status" AS ENUM('queued', 'completed', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."position_direction" AS ENUM('LONG', 'SHORT');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."position_lifecycle" AS ENUM('open', 'closed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."position_mode" AS ENUM('NET', 'HEDGE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."risk_event_severity" AS ENUM('info', 'warning', 'critical');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."strategy_config_slot" AS ENUM('PRIMARY', 'SECONDARY');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."strategy_execution_mode" AS ENUM('SAFE', 'AGGRESSIVE');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."strategy_market_enum" AS ENUM('CRYPTO', 'STOCKS', 'FOREX');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."strategy_priority" AS ENUM('HIGH', 'MEDIUM', 'LOW');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."strategy_risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backtest_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"strategy_keys" jsonb NOT NULL,
	"execution_mode" "strategy_execution_mode" NOT NULL,
	"position_mode" "position_mode" DEFAULT 'NET' NOT NULL,
	"strategy_breakdown" jsonb,
	"performance_metrics" jsonb NOT NULL,
	"equity_curve" jsonb NOT NULL,
	"trade_summary" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "backtest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"asset" varchar(100) NOT NULL,
	"timeframe" varchar(20) NOT NULL,
	"date_from" timestamp NOT NULL,
	"date_to" timestamp NOT NULL,
	"initial_capital" numeric(20, 2) NOT NULL,
	"strategy_keys" jsonb NOT NULL,
	"execution_mode" "strategy_execution_mode" NOT NULL,
	"position_mode" "position_mode" DEFAULT 'NET' NOT NULL,
	"allow_hedge_opposition" boolean DEFAULT false NOT NULL,
	"strategy_config_id" uuid,
	"status" "backtest_status" DEFAULT 'queued' NOT NULL,
	"performance_metrics" jsonb,
	"equity_curve" jsonb,
	"trade_summary" jsonb,
	"strategy_breakdown" jsonb,
	"comparison_label" varchar(150),
	"backtest_assumptions" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "blocked_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"side" "trade_side" NOT NULL,
	"strategy_key" varchar(100),
	"position_scope_key" varchar(160),
	"reason_code" varchar(80) NOT NULL,
	"reason_message" text NOT NULL,
	"details" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "global_exposure_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(20, 8) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "kill_switch_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"close_positions" boolean DEFAULT false NOT NULL,
	"reason" text,
	"activated_at" timestamp,
	"last_deactivated_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_strategy_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"execution_mode" "strategy_execution_mode" DEFAULT 'SAFE' NOT NULL,
	"position_mode" "position_mode" DEFAULT 'NET' NOT NULL,
	"allow_hedge_opposition" boolean DEFAULT false NOT NULL,
	"conflict_blocking" boolean DEFAULT false NOT NULL,
	"aggressive_confirmed_at" timestamp,
	"max_positions_per_symbol" integer DEFAULT 2 NOT NULL,
	"max_capital_per_strategy_pct" numeric(6, 2) DEFAULT '25.00' NOT NULL,
	"max_drawdown_pct" numeric(6, 2) DEFAULT '12.00' NOT NULL,
	"conflict_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exchange_capabilities" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_strategy_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" uuid NOT NULL,
	"strategy_id" uuid NOT NULL,
	"slot" "strategy_config_slot" NOT NULL,
	"priority" "strategy_priority" DEFAULT 'MEDIUM' NOT NULL,
	"cooldown_after_trade_sec" integer DEFAULT 0 NOT NULL,
	"per_trade_percent" numeric(6, 2) DEFAULT '10.00' NOT NULL,
	"max_active_percent" numeric(6, 2) DEFAULT '25.00' NOT NULL,
	"health_min_win_rate_pct" numeric(6, 2) DEFAULT '30.00' NOT NULL,
	"health_max_drawdown_pct" numeric(6, 2) DEFAULT '15.00' NOT NULL,
	"health_max_loss_streak" integer DEFAULT 5 NOT NULL,
	"is_auto_disabled" boolean DEFAULT false NOT NULL,
	"auto_disabled_reason" text,
	"last_trade_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type",
	"symbol" varchar(50),
	"strategy_key" varchar(100),
	"event_type" varchar(80) NOT NULL,
	"severity" "risk_event_severity" DEFAULT 'warning' NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"strategy_key" varchar(100) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"risk_level" "strategy_risk_level" NOT NULL,
	"supported_markets" jsonb NOT NULL,
	"supported_timeframes" jsonb NOT NULL,
	"historical_win_rate" numeric(6, 2) NOT NULL,
	"historical_avg_return" numeric(10, 4) NOT NULL,
	"historical_max_drawdown" numeric(10, 4) NOT NULL,
	"historical_sharpe_ratio" numeric(10, 4) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategies_strategy_key_unique" UNIQUE("strategy_key"),
	CONSTRAINT "strategies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategy_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"execution_mode" "strategy_execution_mode" NOT NULL,
	"position_mode" "position_mode" DEFAULT 'NET' NOT NULL,
	"allow_hedge_opposition" boolean DEFAULT false NOT NULL,
	"strategy_keys" jsonb NOT NULL,
	"asset" varchar(100),
	"timeframe" varchar(20),
	"initial_capital" numeric(20, 2),
	"conflict_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exchange_capabilities" jsonb,
	"strategy_settings" jsonb,
	"source" varchar(30) DEFAULT 'manual' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategy_performance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"strategy_id" uuid,
	"strategy_key" varchar(100) NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"winning_trades" integer DEFAULT 0 NOT NULL,
	"losing_trades" integer DEFAULT 0 NOT NULL,
	"loss_streak" integer DEFAULT 0 NOT NULL,
	"best_equity" numeric(20, 8) DEFAULT '0' NOT NULL,
	"open_positions" integer DEFAULT 0 NOT NULL,
	"realized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"max_drawdown_pct" numeric(8, 4) DEFAULT '0' NOT NULL,
	"last_backtest_return_pct" numeric(10, 4),
	"last_trade_at" timestamp,
	"last_health_status" varchar(30) DEFAULT 'healthy' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategy_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"strategy_id" uuid,
	"strategy_key" varchar(100) NOT NULL,
	"execution_mode" "strategy_execution_mode" NOT NULL,
	"position_mode" "position_mode" DEFAULT 'NET' NOT NULL,
	"direction" "position_direction" NOT NULL,
	"lifecycle" "position_lifecycle" DEFAULT 'open' NOT NULL,
	"size" numeric(20, 8) NOT NULL,
	"remaining_size" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"exit_price" numeric(20, 8),
	"realized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"unrealized_pnl" numeric(20, 8) DEFAULT '0' NOT NULL,
	"max_adverse_excursion" numeric(20, 8) DEFAULT '0' NOT NULL,
	"metadata" jsonb,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp
);
--> statement-breakpoint
DROP INDEX IF EXISTS "exchange_apis_user_idx";--> statement-breakpoint
ALTER TABLE "risk_settings" ADD COLUMN "max_total_exposure" numeric(20, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_settings" ADD COLUMN "max_daily_loss" numeric(20, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_settings" ADD COLUMN "max_open_positions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_settings" ADD COLUMN "paper_balance" numeric(20, 2) DEFAULT '10000.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_state" ADD COLUMN "last_loss_time" double precision;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "fee_rate" numeric(8, 6) DEFAULT '0.001';--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "fee_amount" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "net_pnl" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "filled_quantity" numeric(20, 8) DEFAULT '0';--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "remaining_quantity" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "strategy_key" varchar(100);--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "position_scope_key" varchar(160) DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "stop_loss_order_id" varchar(255);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_run_id_backtest_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."backtest_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backtest_results" ADD CONSTRAINT "backtest_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "blocked_trades" ADD CONSTRAINT "blocked_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "global_exposure_reservations" ADD CONSTRAINT "global_exposure_reservations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kill_switch_state" ADD CONSTRAINT "kill_switch_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_strategy_configs" ADD CONSTRAINT "market_strategy_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_strategy_selections" ADD CONSTRAINT "market_strategy_selections_config_id_market_strategy_configs_id_fk" FOREIGN KEY ("config_id") REFERENCES "public"."market_strategy_configs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_strategy_selections" ADD CONSTRAINT "market_strategy_selections_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strategy_configs" ADD CONSTRAINT "strategy_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strategy_performance" ADD CONSTRAINT "strategy_performance_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strategy_performance" ADD CONSTRAINT "strategy_performance_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strategy_positions" ADD CONSTRAINT "strategy_positions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "strategy_positions" ADD CONSTRAINT "strategy_positions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtest_results_run_idx" ON "backtest_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtest_results_user_idx" ON "backtest_results" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtest_runs_user_created_idx" ON "backtest_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "backtest_runs_status_idx" ON "backtest_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocked_trades_user_idx" ON "blocked_trades" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "blocked_trades_strategy_idx" ON "blocked_trades" USING btree ("user_id","strategy_key","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "global_exposure_reservations_user_idx" ON "global_exposure_reservations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_strategy_configs_user_market_idx" ON "market_strategy_configs" USING btree ("user_id","market_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_strategy_selections_config_slot_idx" ON "market_strategy_selections" USING btree ("config_id","slot");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_strategy_selections_strategy_idx" ON "market_strategy_selections" USING btree ("strategy_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_events_user_idx" ON "risk_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "risk_events_type_idx" ON "risk_events" USING btree ("user_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategies_key_idx" ON "strategies" USING btree ("strategy_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategies_active_idx" ON "strategies" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_configs_user_market_idx" ON "strategy_configs" USING btree ("user_id","market_type","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_performance_user_market_strategy_uq" ON "strategy_performance" USING btree ("user_id","market_type","strategy_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_positions_user_symbol_idx" ON "strategy_positions" USING btree ("user_id","market_type","symbol","lifecycle");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategy_positions_strategy_idx" ON "strategy_positions" USING btree ("user_id","market_type","strategy_key","lifecycle");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "exchange_apis_user_market_uq" ON "exchange_apis" USING btree ("user_id","market_type");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_configs_user_market_uq" ON "market_configs" USING btree ("user_id","market_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trades_stop_loss_order_id" ON "trades" USING btree ("stop_loss_order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_strategy_idx" ON "trades" USING btree ("strategy_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_scope_idx" ON "trades" USING btree ("user_id","market_type","symbol","position_scope_key");