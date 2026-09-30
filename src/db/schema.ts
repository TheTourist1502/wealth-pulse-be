import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
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

const symbol = varchar('symbol', { length: 15 }).notNull();

// ---------- enums ----------

export const alertType = pgEnum('alert_type', ['price_above', 'price_below', 'percent_change']);
export const transactionType = pgEnum('transaction_type', ['buy', 'sell']);
export const userRole = pgEnum('user_role', ['user', 'admin']);

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
    symbol,
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
    symbol,
    quantity: money('quantity').notNull(),
    price: money('price').notNull(),
    fee: money('fee').notNull().default('0'),
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
    symbol,
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
    symbol,
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
    symbol,
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

// ---------- relations ----------

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}));

export const portfoliosRelations = relations(portfolios, ({ one, many }) => ({
  user: one(users, { fields: [portfolios.userId], references: [users.id] }),
  holdings: many(holdings),
  transactions: many(transactions),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  portfolio: one(portfolios, { fields: [holdings.portfolioId], references: [portfolios.id] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  portfolio: one(portfolios, { fields: [transactions.portfolioId], references: [portfolios.id] }),
}));

export const watchlistRelations = relations(watchlist, ({ one }) => ({
  user: one(users, { fields: [watchlist.userId], references: [users.id] }),
}));

export const alertsRelations = relations(alerts, ({ one, many }) => ({
  user: one(users, { fields: [alerts.userId], references: [users.id] }),
  history: many(alertHistory),
}));

export const alertHistoryRelations = relations(alertHistory, ({ one }) => ({
  alert: one(alerts, { fields: [alertHistory.alertId], references: [alerts.id] }),
  user: one(users, { fields: [alertHistory.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));
