import { cacheService } from '@/config/cache';
import { db, type DbExecutor } from '@/config/database';
import { enqueueSecurityProfile, enqueueSnapshotRebuild } from '@/jobs/queues';
import { AppError, toAppError } from '@/utils/appError';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { replayLedger } from '@/utils/ledger';
import { toNyDate } from '@/utils/marketTime';
import * as marketService from '@/routes/market/marketService';
import * as portfoliosRepository from '@/routes/portfolios/portfoliosRepository';

export type TransactionInput = {
  type: 'buy' | 'sell';
  symbol: string;
  quantity: string;
  price: string;
  fee: string;
  executedAt?: Date;
};

const notFound = () => new AppError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Portfolio not found');

const getOwned = async (userId: string, id: string) => {
  const portfolio = await portfoliosRepository.findPortfolio(userId, id);
  if (!portfolio) throw notFound();
  return portfolio;
};

const invalidateUser = async (userId: string) => {
  await Promise.all([cacheService.invalidatePattern(`dashboard:${userId}:*`), cacheService.delete(`portfolio:${userId}`)]);
};

export const listPortfolios = async (userId: string) => {
  try {
    return await portfoliosRepository.findPortfolios(userId);
  } catch (err) {
    throw toAppError(err);
  }
};

export const getPortfolio = async (userId: string, id: string) => {
  try {
    return await getOwned(userId, id);
  } catch (err) {
    throw toAppError(err);
  }
};

export const createPortfolio = async (userId: string, input: { name: string; description?: string | null }) => {
  try {
    const portfolio = await portfoliosRepository.insertPortfolio({ userId, ...input });
    await invalidateUser(userId);
    return portfolio;
  } catch (err) {
    throw toAppError(err);
  }
};

export const updatePortfolio = async (userId: string, id: string, input: { name?: string; description?: string | null }) => {
  try {
    const portfolio = await portfoliosRepository.updatePortfolio(userId, id, input);
    if (!portfolio) throw notFound();
    await invalidateUser(userId);
    return portfolio;
  } catch (err) {
    throw toAppError(err);
  }
};

export const deletePortfolio = async (userId: string, id: string) => {
  try {
    const deleted = await portfoliosRepository.deletePortfolio(userId, id);
    if (!deleted) throw notFound();
    await invalidateUser(userId);
  } catch (err) {
    throw toAppError(err);
  }
};

export const listTransactions = async (userId: string, portfolioId: string, paging: { page: number; limit: number }) => {
  try {
    await getOwned(userId, portfolioId);
    return await portfoliosRepository.findTransactions(portfolioId, paging);
  } catch (err) {
    throw toAppError(err);
  }
};

// Holdings are always the replayed result of the ledger: recompute quantity, average cost and every
// sell's realized P&L for the symbol. Any backdated insert/delete is handled by the same path.
const syncHolding = async (exec: DbExecutor, portfolioId: string, symbol: string) => {
  const ledger = await portfoliosRepository.findSymbolLedger(exec, portfolioId, symbol);
  const result = replayLedger(ledger);
  if ('oversoldBy' in result) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'INSUFFICIENT_QUANTITY', 'Sell quantity exceeds the position held at that time');
  }
  for (const entry of ledger) {
    const realized = result.realized.get(entry.id)?.toFixed(6);
    if (realized !== undefined && realized !== entry.realizedPnl) {
      await portfoliosRepository.updateRealizedPnl(exec, entry.id, realized);
    }
  }
  if (result.quantity.isZero()) {
    await portfoliosRepository.deleteHolding(exec, portfolioId, symbol);
  } else {
    await portfoliosRepository.upsertHolding(exec, {
      portfolioId,
      symbol,
      quantity: result.quantity.toFixed(6),
      averageCost: result.averageCost.toFixed(6),
    });
  }
};

// After commit: caches, profile for new symbols, and history rebuild for backdated changes.
const afterLedgerChange = async (userId: string, portfolioId: string, executedAt: Date, newSymbol?: string) => {
  await invalidateUser(userId);
  if (newSymbol) await enqueueSecurityProfile(newSymbol);
  const fromDate = toNyDate(executedAt);
  if (fromDate < (await marketService.getSessionDate())) await enqueueSnapshotRebuild({ portfolioId, fromDate });
};

// DB part of creating a trade, without side effects (the seed script calls this directly).
export const recordTransaction = async (userId: string, portfolioId: string, input: TransactionInput, ipAddress?: string) => {
  try {
    await getOwned(userId, portfolioId);
    const { security, created } = await marketService.ensureSecurity(input.symbol);
    if (security.quoteType === 'INDEX') {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, 'NOT_TRADABLE', `${input.symbol} is an index and can't be traded`);
    }
    const transaction = await db.transaction(async (tx) => {
      await portfoliosRepository.lockPortfolio(tx, portfolioId);
      const row = await portfoliosRepository.insertTransaction(tx, {
        portfolioId,
        type: input.type,
        symbol: input.symbol,
        quantity: input.quantity,
        price: input.price,
        fee: input.fee,
        executedAt: input.executedAt ?? new Date(),
      });
      await syncHolding(tx, portfolioId, input.symbol);
      await portfoliosRepository.insertAuditLog(tx, {
        userId,
        action: 'transaction.create',
        entityType: 'transaction',
        entityId: row.id,
        metadata: { portfolioId, symbol: row.symbol, type: row.type, quantity: row.quantity, price: row.price },
        ipAddress: ipAddress ?? null,
      });
      return row;
    });
    return { transaction, securityCreated: created };
  } catch (err) {
    throw toAppError(err);
  }
};

export const createTransaction = async (userId: string, portfolioId: string, input: TransactionInput, ipAddress?: string) => {
  try {
    const { transaction, securityCreated } = await recordTransaction(userId, portfolioId, input, ipAddress);
    await afterLedgerChange(userId, portfolioId, transaction.executedAt, securityCreated ? transaction.symbol : undefined);
    // Re-read so realized P&L computed by the replay is included.
    return (await portfoliosRepository.findTransaction(portfolioId, transaction.id)) ?? transaction;
  } catch (err) {
    throw toAppError(err);
  }
};

export const deleteTransaction = async (userId: string, portfolioId: string, transactionId: string, ipAddress?: string) => {
  try {
    await getOwned(userId, portfolioId);
    const existing = await portfoliosRepository.findTransaction(portfolioId, transactionId);
    if (!existing) throw new AppError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Transaction not found');
    await db.transaction(async (tx) => {
      await portfoliosRepository.lockPortfolio(tx, portfolioId);
      await portfoliosRepository.deleteTransaction(tx, portfolioId, transactionId);
      await syncHolding(tx, portfolioId, existing.symbol);
      await portfoliosRepository.insertAuditLog(tx, {
        userId,
        action: 'transaction.delete',
        entityType: 'transaction',
        entityId: transactionId,
        metadata: { portfolioId, symbol: existing.symbol, type: existing.type, quantity: existing.quantity },
        ipAddress: ipAddress ?? null,
      });
    });
    await afterLedgerChange(userId, portfolioId, existing.executedAt);
  } catch (err) {
    throw toAppError(err);
  }
};
