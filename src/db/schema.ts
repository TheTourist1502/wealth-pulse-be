import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// ---------- shared columns ----------

const id = uuid('id').primaryKey().defaultRandom();

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// Drizzle returns numeric as string — never parseFloat-sum these.
const money = (name: string) => numeric(name, { precision: 20, scale: 6 });

// Every symbol-bearing table (except alert_history, a historical copy) references the securities master.
const symbolRef = () =>
  varchar('symbol', { length: 15 })
    .notNull()
    .references(() => securities.symbol, { onDelete: 'restrict' });

// ---------- enums ----------

export const alertType = pgEnum('alert_type', ['price_above', 'price_below', 'percent_change']);
export const transactionType = pgEnum('transaction_type', ['buy', 'sell']);
export const userRole = pgEnum('user_role', ['user', 'admin']);
export const quoteType = pgEnum('quote_type', ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'CRYPTOCURRENCY', 'OTHER']);

// ---------- tables ----------

export const users = pgTable('master_userlist', {
  id,
  email: varchar('email', { length: 255 }).notNull().unique(),
  password: varchar('password', { length: 255 }).notNull(), // bcrypt hash
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  role: userRole('role').notNull().default('user'),
  // Single active reset token per user: sha256 hash, 1h expiry, cleared on use.
  passwordResetTokenHash: varchar('password_reset_token_hash', { length: 64 }),
  passwordResetExpiresAt: timestamp('password_reset_expires_at', { withTimezone: true }),
  ...timestamps,
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('refresh_tokens_user_id_idx').on(t.userId)],
);

export const portfolios = pgTable(
  'portfolios',
  {
    id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    ...timestamps,
  },
  (t) => [index('portfolios_user_id_idx').on(t.userId)],
);

export const holdings = pgTable(
  'holdings',
  {
    id,
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: symbolRef(),
    quantity: money('quantity').notNull(),
    averageCost: money('average_cost').notNull(),
    ...timestamps,
  },
  (t) => [
    // also serves as the portfolio_id index (leading column)
    uniqueIndex('holdings_portfolio_id_symbol_uq').on(t.portfolioId, t.symbol),
    index('holdings_symbol_idx').on(t.symbol), // price job → affected portfolios
    check('holdings_quantity_non_negative', sql`${t.quantity} >= 0`),
    check('holdings_average_cost_non_negative', sql`${t.averageCost} >= 0`),
  ],
);

// Ledger — keeps history even after a holding is sold out and deleted.
export const transactions = pgTable(
  'transactions',
  {
    id,
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    type: transactionType('type').notNull(),
    symbol: symbolRef(),
    quantity: money('quantity').notNull(),
    price: money('price').notNull(),
    fee: money('fee').notNull().default('0'),
    // Sells only: qty × (price − average cost at sale) − fee. Kept in sync by the ledger replay.
    realizedPnl: money('realized_pnl'),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index('transactions_portfolio_id_executed_at_idx').on(t.portfolioId, t.executedAt),
    check('transactions_quantity_positive', sql`${t.quantity} > 0`),
    check('transactions_price_non_negative', sql`${t.price} >= 0`),
    check('transactions_fee_non_negative', sql`${t.fee} >= 0`),
  ],
);

export const watchlist = pgTable(
  'watchlist',
  {
    id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: symbolRef(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('watchlist_user_id_symbol_uq').on(t.userId, t.symbol),
    index('watchlist_symbol_idx').on(t.symbol), // price job symbol discovery
  ],
);

export const alerts = pgTable(
  'alerts',
  {
    id,
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: symbolRef(),
    type: alertType('type').notNull(),
    // price for price_above/below, percent for percent_change
    targetValue: money('target_value').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('alerts_user_id_idx').on(t.userId),
    // alert-check job scans only active alerts
    index('alerts_active_symbol_idx').on(t.symbol).where(sql`${t.isActive} = true`),
  ],
);

export const alertHistory = pgTable(
  'alert_history',
  {
    id,
    alertId: uuid('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    symbol: varchar('symbol', { length: 15 }).notNull(),
    type: alertType('type').notNull(),
    targetValue: money('target_value').notNull(),
    triggeredPrice: money('triggered_price').notNull(),
    message: text('message').notNull(),
    ...timestamps,
  },
  (t) => [
    index('alert_history_user_id_created_at_idx').on(t.userId, t.createdAt),
    index('alert_history_alert_id_idx').on(t.alertId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id,
    // set null, not cascade: the audit trail outlives the account
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 100 }).notNull(), // e.g. 'holding.create'
    entityType: varchar('entity_type', { length: 50 }),
    entityId: uuid('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ipAddress: varchar('ip_address', { length: 45 }),
    ...timestamps,
  },
  (t) => [index('audit_logs_user_id_created_at_idx').on(t.userId, t.createdAt)],
);

// ---------- market data ----------

// Symbol master. Natural PK: every table already stores `symbol`, a surrogate id would only add joins.
export const securities = pgTable('securities', {
  symbol: varchar('symbol', { length: 15 }).primaryKey(),
  name: varchar('name', { length: 255 }),
  exchange: varchar('exchange', { length: 50 }),
  currency: varchar('currency', { length: 3 }),
  quoteType: quoteType('quote_type').notNull().default('EQUITY'),
  sector: varchar('sector', { length: 100 }), // null for ETFs/indices
  industry: varchar('industry', { length: 100 }),
  profileUpdatedAt: timestamp('profile_updated_at', { withTimezone: true }),
  ...timestamps,
});

// Latest quote per symbol, overwritten by the price-update job.
export const securityQuotes = pgTable('security_quotes', {
  symbol: varchar('symbol', { length: 15 })
    .primaryKey()
    .references(() => securities.symbol, { onDelete: 'cascade' }),
  price: money('price').notNull(),
  previousClose: money('previous_close').notNull(),
  change: money('change').notNull(),
  changePercent: money('change_percent').notNull(),
  dayHigh: money('day_high'),
  dayLow: money('day_low'),
  volume: bigint('volume', { mode: 'number' }),
  marketState: varchar('market_state', { length: 20 }).notNull(),
  quotedAt: timestamp('quoted_at', { withTimezone: true }).notNull(),
  ...timestamps,
});

// Daily closes; ^GSPC's rows double as the trading calendar.
export const securityPricesDaily = pgTable(
  'security_prices_daily',
  {
    symbol: varchar('symbol', { length: 15 })
      .notNull()
      .references(() => securities.symbol, { onDelete: 'cascade' }),
    tradeDate: date('trade_date', { mode: 'string' }).notNull(), // America/New_York date
    close: money('close').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.symbol, t.tradeDate] })],
);

// End-of-day value per portfolio, rebuilt from the transaction ledger × daily closes.
export const portfolioSnapshots = pgTable(
  'portfolio_snapshots',
  {
    portfolioId: uuid('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    asOfDate: date('as_of_date', { mode: 'string' }).notNull(),
    marketValue: money('market_value').notNull(),
    netFlow: money('net_flow').notNull().default('0'), // buys (qty×price+fee) − sells (qty×price−fee) that day
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.portfolioId, t.asOfDate] })],
);

// ---------- relations ----------

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, { fields: [portfolios.userId], references: [users.id] }),
  holdings: many(holdings),
  transactions: many(transactions),
  snapshots: many(portfolioSnapshots),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  portfolio: one(portfolios, { fields: [holdings.portfolioId], references: [portfolios.id] }),
  security: one(securities, { fields: [holdings.symbol], references: [securities.symbol] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  portfolio: one(portfolios, { fields: [transactions.portfolioId], references: [portfolios.id] }),
  security: one(securities, { fields: [transactions.symbol], references: [securities.symbol] }),
}));

export const watchlistRelations = relations(watchlist, ({ one }) => ({
  user: one(users, { fields: [watchlist.userId], references: [users.id] }),
  security: one(securities, { fields: [watchlist.symbol], references: [securities.symbol] }),
}));

export const alertsRelations = relations(alerts, ({ one, many }) => ({
  user: one(users, { fields: [alerts.userId], references: [users.id] }),
  security: one(securities, { fields: [alerts.symbol], references: [securities.symbol] }),
  history: many(alertHistory),
}));

export const alertHistoryRelations = relations(alertHistory, ({ one }) => ({
  alert: one(alerts, { fields: [alertHistory.alertId], references: [alerts.id] }),
  user: one(users, { fields: [alertHistory.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export const securitiesRelations = relations(securities, ({ one, many }) => ({
  quote: one(securityQuotes, { fields: [securities.symbol], references: [securityQuotes.symbol] }),
  dailyPrices: many(securityPricesDaily),
  holdings: many(holdings),
  transactions: many(transactions),
  watchlistItems: many(watchlist),
  alerts: many(alerts),
}));

export const securityQuotesRelations = relations(securityQuotes, ({ one }) => ({
  security: one(securities, { fields: [securityQuotes.symbol], references: [securities.symbol] }),
}));

export const securityPricesDailyRelations = relations(securityPricesDaily, ({ one }) => ({
  security: one(securities, { fields: [securityPricesDaily.symbol], references: [securities.symbol] }),
}));

export const portfolioSnapshotsRelations = relations(portfolioSnapshots, ({ one }) => ({
  portfolio: one(portfolios, { fields: [portfolioSnapshots.portfolioId], references: [portfolios.id] }),
}));
