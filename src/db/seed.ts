// Seeds a realistic year of trading for the admin user with real Yahoo prices.
// Idempotent: re-running deletes and recreates the seeded portfolios, watchlist and alerts.
// Usage: npm run db:seed
import Decimal from 'decimal.js';
import { and, eq, inArray } from 'drizzle-orm';
import { cacheService } from '@/config/cache';
import { db, sql } from '@/config/database';
import { logger } from '@/config/logger';
import { redisClient } from '@/config/redis';
import { alerts, portfolios, users, watchlist } from '@/db/schema';
import { BENCHMARK_SYMBOLS } from '@/utils/constants';
import { shiftDate, toNyDate } from '@/utils/marketTime';
import * as dashboardService from '@/routes/dashboard/dashboardService';
import * as marketService from '@/routes/market/marketService';
import * as portfoliosService from '@/routes/portfolios/portfoliosService';

const ADMIN_EMAIL = 'admin@wealthpulse.com';

// [days ago, type, symbol, quantity, fee]
type Trade = [number, 'buy' | 'sell', string, number, number?];

const SEED_PORTFOLIOS: { name: string; description: string; trades: Trade[] }[] = [
  {
    name: 'Growth',
    description: 'US large-cap technology and growth',
    trades: [
      [360, 'buy', 'AAPL', 60, 1],
      [360, 'buy', 'MSFT', 30, 1],
      [355, 'buy', 'NVDA', 80, 1],
      [340, 'buy', 'AMZN', 40],
      [300, 'buy', 'GOOGL', 50],
      [270, 'buy', 'META', 15],
      [240, 'buy', 'AAPL', 40],
      [200, 'sell', 'NVDA', 20, 1],
      [180, 'buy', 'TSLA', 20],
      [150, 'buy', 'MSFT', 25],
      [120, 'sell', 'TSLA', 10, 1],
      [90, 'buy', 'NVDA', 30],
      [60, 'buy', 'AMZN', 20],
      [30, 'sell', 'META', 5],
      [10, 'buy', 'GOOGL', 20],
      [0, 'buy', 'AAPL', 20], // today: exercises the session-aware today's P&L
    ],
  },
  {
    name: 'Dividend & Value',
    description: 'Financials, healthcare, energy and staples',
    trades: [
      [330, 'buy', 'JPM', 40, 1],
      [330, 'buy', 'JNJ', 50, 1],
      [320, 'buy', 'XOM', 60],
      [300, 'buy', 'KO', 100],
      [280, 'buy', 'PG', 40],
      [250, 'buy', 'V', 25],
      [220, 'buy', 'UNH', 15],
      [180, 'buy', 'JPM', 20],
      [150, 'sell', 'XOM', 20, 1],
      [100, 'buy', 'KO', 50],
      [45, 'buy', 'PG', 20],
      [20, 'sell', 'UNH', 5],
      [1, 'buy', 'V', 10],
    ],
  },
];

const WATCHLIST = ['AMD', 'NFLX', 'CRM', 'PLTR'];

const run = async () => {
  await redisClient.connect();

  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.email, ADMIN_EMAIL));
  if (!admin) throw new Error(`${ADMIN_EMAIL} not found — create the admin user first`);
  const userId = admin.id;

  // Clean previous seed.
  await db
    .delete(portfolios)
    .where(and(eq(portfolios.userId, userId), inArray(portfolios.name, SEED_PORTFOLIOS.map((p) => p.name))));
  await db.delete(watchlist).where(eq(watchlist.userId, userId));
  await db.delete(alerts).where(eq(alerts.userId, userId));

  const tradeSymbols = [...new Set(SEED_PORTFOLIOS.flatMap((p) => p.trades.map((t) => t[2])))];
  const allSymbols = [...tradeSymbols, ...WATCHLIST];

  logger.info(`securities: ${allSymbols.length} symbols`);
  for (const symbol of allSymbols) await marketService.ensureSecurity(symbol);
  await marketService.refreshQuotes([...allSymbols, ...BENCHMARK_SYMBOLS]);

  const today = toNyDate(new Date());
  const historyFrom = shiftDate(today, { days: -380 });
  logger.info(`price history since ${historyFrom}`);
  await marketService.ensureHistory([...tradeSymbols, ...BENCHMARK_SYMBOLS], historyFrom);

  logger.info('profiles (name, sector)');
  for (const symbol of [...allSymbols, ...BENCHMARK_SYMBOLS]) await marketService.refreshProfile(symbol);

  const closes = await marketService.getDailyCloses(tradeSymbols, historyFrom);
  const quotes = await marketService.getQuotes(tradeSymbols);

  for (const seed of SEED_PORTFOLIOS) {
    const portfolio = await portfoliosService.createPortfolio(userId, { name: seed.name, description: seed.description });
    if (!portfolio) throw new Error('portfolio insert failed');

    for (const [daysAgo, type, symbol, quantity, fee = 0] of seed.trades) {
      let price: string;
      let executedAt: Date;
      if (daysAgo === 0) {
        price = quotes.find((q) => q.symbol === symbol)!.price;
        executedAt = new Date();
      } else {
        // Weekend/holiday targets fall back to the last trading day before them.
        const target = shiftDate(today, { days: -daysAgo });
        const close = closes.filter((c) => c.symbol === symbol && c.date <= target).at(-1);
        if (!close) throw new Error(`no close for ${symbol} on/before ${target}`);
        price = close.close;
        executedAt = new Date(`${close.date}T19:30:00Z`); // mid-afternoon New York time
      }
      await portfoliosService.recordTransaction(userId, portfolio.id, {
        type,
        symbol,
        quantity: String(quantity),
        price: new Decimal(price).toFixed(2),
        fee: new Decimal(fee).toFixed(2),
        executedAt,
      });
    }

    await dashboardService.rebuildSnapshots(portfolio.id);
    logger.info(`portfolio "${seed.name}": ${seed.trades.length} trades, snapshots rebuilt`);
  }

  await db.insert(watchlist).values(WATCHLIST.map((symbol) => ({ userId, symbol })));

  const priceOf = (symbol: string) => new Decimal(quotes.find((q) => q.symbol === symbol)!.price);
  await db.insert(alerts).values([
    { userId, symbol: 'NVDA', type: 'price_above', targetValue: priceOf('NVDA').times(1.1).toFixed(2) },
    { userId, symbol: 'AAPL', type: 'price_below', targetValue: priceOf('AAPL').times(0.9).toFixed(2) },
    { userId, symbol: 'TSLA', type: 'percent_change', targetValue: '5' },
  ]);

  await cacheService.invalidatePattern(`dashboard:${userId}:*`);
  logger.info('seed complete');
};

run()
  .catch((err: unknown) => {
    logger.fatal({ err }, 'seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([sql.end({ timeout: 5 }), redisClient.quit()]);
  });
