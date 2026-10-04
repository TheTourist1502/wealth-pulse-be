CREATE TYPE "public"."quote_type" AS ENUM('EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'CRYPTOCURRENCY', 'OTHER');--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"portfolio_id" uuid NOT NULL,
	"as_of_date" date NOT NULL,
	"market_value" numeric(20, 6) NOT NULL,
	"net_flow" numeric(20, 6) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_snapshots_portfolio_id_as_of_date_pk" PRIMARY KEY("portfolio_id","as_of_date")
);
--> statement-breakpoint
CREATE TABLE "securities" (
	"symbol" varchar(15) PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"exchange" varchar(50),
	"currency" varchar(3),
	"quote_type" "quote_type" DEFAULT 'EQUITY' NOT NULL,
	"sector" varchar(100),
	"industry" varchar(100),
	"profile_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_prices_daily" (
	"symbol" varchar(15) NOT NULL,
	"trade_date" date NOT NULL,
	"close" numeric(20, 6) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "security_prices_daily_symbol_trade_date_pk" PRIMARY KEY("symbol","trade_date")
);
--> statement-breakpoint
CREATE TABLE "security_quotes" (
	"symbol" varchar(15) PRIMARY KEY NOT NULL,
	"price" numeric(20, 6) NOT NULL,
	"previous_close" numeric(20, 6) NOT NULL,
	"change" numeric(20, 6) NOT NULL,
	"change_percent" numeric(20, 6) NOT NULL,
	"day_high" numeric(20, 6),
	"day_low" numeric(20, 6),
	"volume" bigint,
	"market_state" varchar(20) NOT NULL,
	"quoted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "realized_pnl" numeric(20, 6);--> statement-breakpoint
-- hand-added: existing symbols must exist in securities before the FKs below
INSERT INTO "securities" ("symbol")
SELECT "symbol" FROM "holdings" UNION SELECT "symbol" FROM "transactions"
UNION SELECT "symbol" FROM "watchlist" UNION SELECT "symbol" FROM "alerts"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "securities" ("symbol", "name", "quote_type", "currency") VALUES
  ('^GSPC', 'S&P 500', 'INDEX', 'USD'),
  ('^IXIC', 'NASDAQ Composite', 'INDEX', 'USD'),
  ('^DJI', 'Dow Jones Industrial Average', 'INDEX', 'USD'),
  ('^VIX', 'CBOE Volatility Index', 'INDEX', 'USD')
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_portfolio_id_portfolios_id_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_prices_daily" ADD CONSTRAINT "security_prices_daily_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_quotes" ADD CONSTRAINT "security_quotes_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watchlist" ADD CONSTRAINT "watchlist_symbol_securities_symbol_fk" FOREIGN KEY ("symbol") REFERENCES "public"."securities"("symbol") ON DELETE restrict ON UPDATE no action;