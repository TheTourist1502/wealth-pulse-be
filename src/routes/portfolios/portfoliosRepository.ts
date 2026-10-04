import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { db, type DbExecutor } from '@/config/database';
import { auditLogs, holdings, portfolios, transactions } from '@/db/schema';
import { toDbError } from '@/utils/appError';

export const findPortfolios = async (userId: string) => {
  try {
    return await db.select().from(portfolios).where(eq(portfolios.userId, userId)).orderBy(asc(portfolios.createdAt));
  } catch (err) {
    throw toDbError(err);
  }
};

export const findPortfolio = async (userId: string, id: string) => {
  try {
    const [row] = await db
      .select()
      .from(portfolios)
      .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
      .limit(1);
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const insertPortfolio = async (values: typeof portfolios.$inferInsert) => {
  try {
    const [row] = await db.insert(portfolios).values(values).returning();
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const updatePortfolio = async (userId: string, id: string, values: Partial<typeof portfolios.$inferInsert>) => {
  try {
    const [row] = await db
      .update(portfolios)
      .set(values)
      .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
      .returning();
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const deletePortfolio = async (userId: string, id: string) => {
  try {
    const [row] = await db
      .delete(portfolios)
      .where(and(eq(portfolios.id, id), eq(portfolios.userId, userId)))
      .returning({ id: portfolios.id });
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

// Serializes ledger writes per portfolio so concurrent trades can't replay over each other.
export const lockPortfolio = async (exec: DbExecutor, id: string) => {
  try {
    await exec.execute(sql`select id from portfolios where id = ${id} for update`);
  } catch (err) {
    throw toDbError(err);
  }
};

export const findTransactions = async (portfolioId: string, { page, limit }: { page: number; limit: number }) => {
  try {
    const where = eq(transactions.portfolioId, portfolioId);
    const [rows, [total]] = await Promise.all([
      db
        .select()
        .from(transactions)
        .where(where)
        .orderBy(desc(transactions.executedAt), desc(transactions.createdAt))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ value: count() }).from(transactions).where(where),
    ]);
    return { rows, total: total?.value ?? 0 };
  } catch (err) {
    throw toDbError(err);
  }
};

export const findTransaction = async (portfolioId: string, id: string) => {
  try {
    const [row] = await db
      .select()
      .from(transactions)
      .where(and(eq(transactions.id, id), eq(transactions.portfolioId, portfolioId)))
      .limit(1);
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const insertTransaction = async (exec: DbExecutor, values: typeof transactions.$inferInsert) => {
  try {
    const [row] = await exec.insert(transactions).values(values).returning();
    if (!row) throw new Error('insert returned no row');
    return row;
  } catch (err) {
    throw toDbError(err);
  }
};

export const deleteTransaction = async (exec: DbExecutor, portfolioId: string, id: string) => {
  try {
    await exec.delete(transactions).where(and(eq(transactions.id, id), eq(transactions.portfolioId, portfolioId)));
  } catch (err) {
    throw toDbError(err);
  }
};

// One symbol's ledger in execution order (created_at breaks ties for same-timestamp trades).
export const findSymbolLedger = async (exec: DbExecutor, portfolioId: string, symbol: string) => {
  try {
    return await exec
      .select({
        id: transactions.id,
        type: transactions.type,
        quantity: transactions.quantity,
        price: transactions.price,
        fee: transactions.fee,
        realizedPnl: transactions.realizedPnl,
      })
      .from(transactions)
      .where(and(eq(transactions.portfolioId, portfolioId), eq(transactions.symbol, symbol)))
      .orderBy(asc(transactions.executedAt), asc(transactions.createdAt));
  } catch (err) {
    throw toDbError(err);
  }
};

export const updateRealizedPnl = async (exec: DbExecutor, id: string, realizedPnl: string) => {
  try {
    await exec.update(transactions).set({ realizedPnl }).where(eq(transactions.id, id));
  } catch (err) {
    throw toDbError(err);
  }
};

export const upsertHolding = async (exec: DbExecutor, values: typeof holdings.$inferInsert) => {
  try {
    await exec
      .insert(holdings)
      .values(values)
      .onConflictDoUpdate({
        target: [holdings.portfolioId, holdings.symbol],
        set: { quantity: values.quantity, averageCost: values.averageCost, updatedAt: new Date() },
      });
  } catch (err) {
    throw toDbError(err);
  }
};

export const deleteHolding = async (exec: DbExecutor, portfolioId: string, symbol: string) => {
  try {
    await exec.delete(holdings).where(and(eq(holdings.portfolioId, portfolioId), eq(holdings.symbol, symbol)));
  } catch (err) {
    throw toDbError(err);
  }
};

export const insertAuditLog = async (exec: DbExecutor, values: typeof auditLogs.$inferInsert) => {
  try {
    await exec.insert(auditLogs).values(values);
  } catch (err) {
    throw toDbError(err);
  }
};
