CREATE TYPE "public"."alert_type" AS ENUM('price_above', 'price_below', 'percent_change');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "alert_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alert_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(15) NOT NULL,
	"type" "alert_type" NOT NULL,
	"target_value" numeric(20, 6) NOT NULL,
	"triggered_price" numeric(20, 6) NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(15) NOT NULL,
	"type" "alert_type" NOT NULL,
	"target_value" numeric(20, 6) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50),
	"entity_id" uuid,
	"metadata" jsonb,
	"ip_address" varchar(45),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holdings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"symbol" varchar(15) NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"average_cost" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holdings_quantity_non_negative" CHECK ("holdings"."quantity" >= 0),
	CONSTRAINT "holdings_average_cost_non_negative" CHECK ("holdings"."average_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "portfolios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" uuid NOT NULL,
	"type" "transaction_type" NOT NULL,
	"symbol" varchar(15) NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"fee" numeric(20, 6) DEFAULT '0' NOT NULL,
	"executed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_quantity_positive" CHECK ("transactions"."quantity" > 0),
	CONSTRAINT "transactions_price_non_negative" CHECK ("transactions"."price" >= 0),
	CONSTRAINT "transactions_fee_non_negative" CHECK ("transactions"."fee" >= 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	"first_name" varchar(100) NOT NULL,
	"last_name" varchar(100) NOT NULL,
	"password_reset_token_hash" varchar(64),
	"password_reset_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "watchlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"symbol" varchar(15) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_alert_id_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_history" ADD CONSTRAINT "alert_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolios" ADD CONSTRAINT "portfolios_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_history_user_id_created_at_idx" ON "alert_history" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "alert_history_alert_id_idx" ON "alert_history" USING btree ("alert_id");--> statement-breakpoint
CREATE INDEX "alerts_user_id_idx" ON "alerts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "alerts_active_symbol_idx" ON "alerts" USING btree ("symbol") WHERE "alerts"."is_active" = true;--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holdings_portfolio_id_symbol_uq" ON "holdings" USING btree ("portfolio_id","symbol");--> statement-breakpoint
CREATE INDEX "holdings_symbol_idx" ON "holdings" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "portfolios_user_id_idx" ON "portfolios" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_portfolio_id_executed_at_idx" ON "transactions" USING btree ("portfolio_id","executed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watchlist_user_id_symbol_uq" ON "watchlist" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "watchlist_symbol_idx" ON "watchlist" USING btree ("symbol");