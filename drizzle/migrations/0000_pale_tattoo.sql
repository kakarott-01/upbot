DO $$ BEGIN
 CREATE TYPE "public"."bot_session_status" AS ENUM('running', 'stopped', 'error');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."bot_status_enum" AS ENUM('running', 'stopped', 'paused', 'error', 'stopping');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."close_log_status" AS ENUM('pending', 'filled', 'partial', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."market_type" AS ENUM('indian', 'crypto', 'commodities', 'global');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."signal_type" AS ENUM('buy', 'sell', 'hold');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."trade_side" AS ENUM('buy', 'sell');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."trade_status" AS ENUM('pending', 'open', 'closed', 'cancelled', 'failed');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 CREATE TYPE "public"."trading_mode" AS ENUM('paper', 'live');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "access_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"label" varchar(100),
	"created_by" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"is_burned" boolean DEFAULT false NOT NULL,
	"burned_at" timestamp,
	"burned_by_ip" varchar(64),
	"used_by_email" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "access_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "algo_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"signal" "signal_type" NOT NULL,
	"confidence" numeric(5, 2),
	"algo_name" varchar(100),
	"timeframe" varchar(20),
	"indicators_snapshot" jsonb,
	"was_executed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exchange" varchar(100) DEFAULT 'unknown' NOT NULL,
	"market" varchar(50) NOT NULL,
	"mode" "trading_mode" DEFAULT 'paper' NOT NULL,
	"status" "bot_session_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"open_trades" integer DEFAULT 0 NOT NULL,
	"closed_trades" integer DEFAULT 0 NOT NULL,
	"total_pnl" numeric(20, 8) DEFAULT '0',
	"error_message" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "bot_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "bot_status_enum" DEFAULT 'stopped' NOT NULL,
	"active_markets" jsonb DEFAULT '[]'::jsonb,
	"started_at" timestamp,
	"stopped_at" timestamp,
	"last_heartbeat" timestamp,
	"last_signal" text,
	"error_message" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"stop_mode" varchar(20),
	"stopping_at" timestamp,
	"stop_timeout_sec" integer DEFAULT 300,
	"watchdog_restart_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "bot_statuses_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exchange_apis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"exchange_name" varchar(100) NOT NULL,
	"exchange_label" varchar(100),
	"api_key_enc" text NOT NULL,
	"api_secret_enc" text NOT NULL,
	"extra_fields_enc" text,
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "failed_live_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"exchange_name" varchar(100) NOT NULL,
	"market_type" "market_type" NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"side" "trade_side" NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"exchange_order_id" varchar(255),
	"fail_reason" text NOT NULL,
	"cancel_attempted" boolean DEFAULT false NOT NULL,
	"cancel_succeeded" boolean DEFAULT false NOT NULL,
	"cancel_error" text,
	"requires_manual_review" boolean DEFAULT true NOT NULL,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"market_type" "market_type" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"algo_name" varchar(100),
	"paper_mode" boolean DEFAULT true NOT NULL,
	"mode" "trading_mode" DEFAULT 'paper' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mode_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"scope" varchar(50) NOT NULL,
	"from_mode" "trading_mode" NOT NULL,
	"to_mode" "trading_mode" NOT NULL,
	"ip_address" varchar(64),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "position_close_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"trade_id" uuid NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" "close_log_status" NOT NULL,
	"quantity_req" numeric(20, 8),
	"quantity_fill" numeric(20, 8),
	"exchange_order_id" varchar(255),
	"error_message" text,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"filled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"max_position_pct" numeric(5, 2) DEFAULT '2.00' NOT NULL,
	"stop_loss_pct" numeric(5, 2) DEFAULT '1.50' NOT NULL,
	"take_profit_pct" numeric(5, 2) DEFAULT '3.00' NOT NULL,
	"max_daily_loss_pct" numeric(5, 2) DEFAULT '5.00' NOT NULL,
	"max_open_trades" integer DEFAULT 3 NOT NULL,
	"cooldown_seconds" integer DEFAULT 300 NOT NULL,
	"trailing_stop" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "risk_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(255) NOT NULL,
	"device_fingerprint" text,
	"ip_address" varchar(64),
	"user_agent" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"exchange_name" varchar(100) NOT NULL,
	"market_type" "market_type" NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"side" "trade_side" NOT NULL,
	"quantity" numeric(20, 8) NOT NULL,
	"entry_price" numeric(20, 8) NOT NULL,
	"exit_price" numeric(20, 8),
	"stop_loss" numeric(20, 8),
	"take_profit" numeric(20, 8),
	"pnl" numeric(20, 8),
	"pnl_pct" numeric(8, 4),
	"status" "trade_status" DEFAULT 'pending' NOT NULL,
	"algo_used" varchar(100),
	"signal_id" uuid,
	"is_paper" boolean DEFAULT true NOT NULL,
	"exchange_order_id" varchar(255),
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"metadata" jsonb,
	"bot_session_ref" varchar(100),
	"close_attempts" integer DEFAULT 0,
	"close_error" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"google_id" varchar(255),
	"avatar_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_whitelisted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_login_at" timestamp,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "algo_signals" ADD CONSTRAINT "algo_signals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bot_statuses" ADD CONSTRAINT "bot_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exchange_apis" ADD CONSTRAINT "exchange_apis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "failed_live_orders" ADD CONSTRAINT "failed_live_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "market_configs" ADD CONSTRAINT "market_configs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mode_audit_logs" ADD CONSTRAINT "mode_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "position_close_log" ADD CONSTRAINT "position_close_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "position_close_log" ADD CONSTRAINT "position_close_log_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_settings" ADD CONSTRAINT "risk_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_session_id_bot_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."bot_sessions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_user_idx" ON "algo_signals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_created_idx" ON "algo_signals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_sessions_user_idx" ON "bot_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_sessions_started_idx" ON "bot_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bot_sessions_status_idx" ON "bot_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exchange_apis_user_idx" ON "exchange_apis" USING btree ("user_id","market_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "failed_orders_user_idx" ON "failed_live_orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "failed_orders_review_idx" ON "failed_live_orders" USING btree ("requires_manual_review","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_configs_user_market_idx" ON "market_configs" USING btree ("user_id","market_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_user_idx" ON "mode_audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_created_idx" ON "mode_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_close_log_trade" ON "position_close_log" USING btree ("trade_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_close_log_user" ON "position_close_log" USING btree ("user_id","attempted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_user_idx" ON "trades" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_symbol_idx" ON "trades" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_status_idx" ON "trades" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_opened_idx" ON "trades" USING btree ("opened_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trades_session_idx" ON "trades" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_trades_user_open" ON "trades" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_email_idx" ON "users" USING btree ("email");