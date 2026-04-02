CREATE TABLE IF NOT EXISTS "reconciliation_log" (
	"user_id" uuid NOT NULL,
	"market_type" varchar(50) NOT NULL,
	"last_run_at" timestamp DEFAULT now() NOT NULL,
	"trades_fixed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "reconciliation_log_user_id_market_type_pk" PRIMARY KEY("user_id","market_type")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "risk_state" (
	"user_id" uuid NOT NULL,
	"market_type" varchar(50) NOT NULL,
	"daily_loss" numeric(20, 8) DEFAULT '0' NOT NULL,
	"open_trade_count" integer DEFAULT 0 NOT NULL,
	"day_date" date DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "risk_state_user_id_market_type_day_date_pk" PRIMARY KEY("user_id","market_type","day_date")
);
--> statement-breakpoint
ALTER TABLE "access_codes" ADD COLUMN "code_sha256" varchar(64);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "reconciliation_log" ADD CONSTRAINT "reconciliation_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "risk_state" ADD CONSTRAINT "risk_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
