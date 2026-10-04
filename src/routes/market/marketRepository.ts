import { and, asc, eq, gte, inArray, max, min, sql } from 'drizzle-orm';
import { db } from '@/config/database';
import { securities, securityPricesDaily, securityQuotes } from '@/db/schema';
import { toDbError } from '@/utils/appError';

export type QuoteRow = typeof securityQuotes.$inferInsert;
export type DailyCloseRow = typeof securityPricesDaily.$inferInsert;

const excluded = (column: string) => sql.raw(`excluded.${column}`);

export const findSecurity = async (symbol: string) => {
  try {
    const [row] = await db.select().from(securities).where(eq(securities.symbol, symbol)).limit(1);
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const insertSecurity = async (values: typeof securities.$inferInsert) => {
  try {
    await db.insert(securities).values(values).onConflictDoNothing();
  } catch (err) {
    throw toDbError(err);
  }
};

export const updateSecurity = async (symbol: string, values: Partial<typeof securities.$inferInsert>) => {
  try {
    await db.update(securities).set(values).where(eq(securities.symbol, symbol));
  } catch (err) {
    throw toDbError(err);
  }
};

export const listSecurities = async () => {
  try {
    return await db.select({ symbol: securities.symbol, quoteType: securities.quoteType }).from(securities);
  } catch (err) {
    throw toDbError(err);
  }
};

// Symbols worth refreshing: held, watched, or with an active alert.
export const findTrackedSymbols = async (): Promise<string[]> => {
  try {
    const rows = await db.execute<{ symbol: string }>(sql`
      select symbol from holdings where quantity > 0
      union select symbol from watchlist
      union select symbol from alerts where is_active`);
    return rows.map((r) => r.symbol);
  } catch (err) {
    throw toDbError(err);
  }
};

export const upsertQuotes = async (rows: QuoteRow[]) => {
  try {
    if (!rows.length) return;
    await db
      .insert(securityQuotes)
      .values(rows)
      .onConflictDoUpdate({
        target: securityQuotes.symbol,
        set: {
          price: excluded('price'),
          previousClose: excluded('previous_close'),
          change: excluded('change'),
          changePercent: excluded('change_percent'),
          dayHigh: excluded('day_high'),
          dayLow: excluded('day_low'),
          volume: excluded('volume'),
          marketState: excluded('market_state'),
          quotedAt: excluded('quoted_at'),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    throw toDbError(err);
  }
};

export const findQuotes = async (symbols: string[]) => {
  try {
    if (!symbols.length) return [];
    return await db
      .select({
        symbol: securityQuotes.symbol,
        name: securities.name,
        price: securityQuotes.price,
        previousClose: securityQuotes.previousClose,
        change: securityQuotes.change,
        changePercent: securityQuotes.changePercent,
        marketState: securityQuotes.marketState,
        quotedAt: securityQuotes.quotedAt,
      })
      .from(securityQuotes)
      .innerJoin(securities, eq(securities.symbol, securityQuotes.symbol))
      .where(inArray(securityQuotes.symbol, symbols));
  } catch (err) {
    throw toDbError(err);
  }
};

export const upsertDailyCloses = async (rows: DailyCloseRow[]) => {
  try {
    if (!rows.length) return;
    await db
      .insert(securityPricesDaily)
      .values(rows)
      .onConflictDoUpdate({
        target: [securityPricesDaily.symbol, securityPricesDaily.tradeDate],
        set: { close: excluded('close'), updatedAt: new Date() },
      });
  } catch (err) {
    throw toDbError(err);
  }
};

export const findPriceDateRange = async (symbol: string) => {
  try {
    const [row] = await db
      .select({ first: min(securityPricesDaily.tradeDate), last: max(securityPricesDaily.tradeDate) })
      .from(securityPricesDaily)
      .where(eq(securityPricesDaily.symbol, symbol));
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const findDailyCloses = async (symbols: string[], fromDate: string) => {
  try {
    if (!symbols.length) return [];
    return await db
      .select({ symbol: securityPricesDaily.symbol, date: securityPricesDaily.tradeDate, close: securityPricesDaily.close })
      .from(securityPricesDaily)
      .where(and(inArray(securityPricesDaily.symbol, symbols), gte(securityPricesDaily.tradeDate, fromDate)))
      .orderBy(asc(securityPricesDaily.symbol), asc(securityPricesDaily.tradeDate));
  } catch (err) {
    throw toDbError(err);
  }
};
