import Decimal from 'decimal.js';
import { cached, cacheService } from '@/config/cache';
import { AppError, toAppError } from '@/utils/appError';
import { BENCHMARKS, CALENDAR_SYMBOL, type PerformanceRange } from '@/utils/constants';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { isRegularHours, shiftDate, toNyDate } from '@/utils/marketTime';
import { pct, simpleReturns, timeWeightedReturns } from '@/utils/returns';
import * as marketService from '@/routes/market/marketService';
import * as dashboardRepository from '@/routes/dashboard/dashboardRepository';

type Scope = dashboardRepository.Scope;

const SUMMARY_TTL = 30;
const PERFORMANCE_TTL: Record<PerformanceRange, number> = { '1D': 60, '1W': 300, '1M': 3600, '3M': 3600, '6M': 3600, '1Y': 3600 };
const RANGE_MONTHS: Record<Exclude<PerformanceRange, '1D' | '1W'>, number> = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 };

const cacheKey = (scope: Scope, name: string) => `dashboard:${scope.userId}:${scope.portfolioId ?? 'all'}:${name}`;

// 404 for a portfolio that doesn't exist or isn't the caller's.
const assertScope = async (scope: Scope) => {
  if (scope.portfolioId && !(await dashboardRepository.findOwnedPortfolio(scope.userId, scope.portfolioId))) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Portfolio not found');
  }
};

const ratio = (num: Decimal, den: Decimal) => (den.isZero() ? new Decimal(0) : num.div(den));

// ---------- summary ----------

const computeSummary = async (scope: Scope, sessionDate: string) => {
  const t = await dashboardRepository.findSummaryTotals(scope, sessionDate);
  const marketValue = new Decimal(t.market_value);
  const invested = new Decimal(t.invested);
  const realized = new Decimal(t.realized_pnl);
  const sessionFlow = new Decimal(t.session_flow);

  // Portfolio-level today's P&L from yesterday's snapshot also covers positions sold out today.
  // Before the first snapshot exists, fall back to the sum of the per-holding numbers.
  const hasPrev = t.prev_count > 0;
  const todayPnl = hasPrev ? marketValue.minus(t.prev_value).minus(sessionFlow) : new Decimal(t.rows_today_pnl);
  const todayBase = hasPrev ? new Decimal(t.prev_value).plus(sessionFlow) : marketValue.minus(todayPnl);
  const totalReturn = marketValue.minus(invested);

  return {
    raw: { marketValue, sessionFlow },
    asOf: t.as_of,
    holdingsCount: t.holdings_count,
    marketValue: marketValue.toFixed(2),
    invested: invested.toFixed(2),
    todayPnl: todayPnl.toFixed(2),
    todayPnlPct: pct(ratio(todayPnl, todayBase)),
    totalReturn: totalReturn.toFixed(2),
    totalReturnPct: pct(ratio(totalReturn, invested)),
    realizedPnl: realized.toFixed(2),
    overallPnl: totalReturn.plus(realized).toFixed(2),
  };
};

export const getSummary = async (scope: Scope) => {
  try {
    await assertScope(scope);
    return await cached(cacheKey(scope, 'summary'), SUMMARY_TTL, async () => {
      const sessionDate = await marketService.getSessionDate();
      const [{ raw: _raw, ...summary }, [calendar]] = await Promise.all([
        computeSummary(scope, sessionDate),
        marketService.getQuotes([CALENDAR_SYMBOL]),
      ]);
      return { sessionDate, marketState: calendar?.marketState ?? 'CLOSED', currency: 'USD', ...summary };
    });
  } catch (err) {
    throw toAppError(err);
  }
};

// ---------- holdings ----------

export const getHoldings = async (scope: Scope, sort: dashboardRepository.HoldingSort, order: 'asc' | 'desc') => {
  try {
    await assertScope(scope);
    return await cached(cacheKey(scope, `holdings:${sort}:${order}`), SUMMARY_TTL, async () => {
      const sessionDate = await marketService.getSessionDate();
      return [...(await dashboardRepository.findHoldings(scope, sessionDate, sort, order))];
    });
  } catch (err) {
    throw toAppError(err);
  }
};

// ---------- performance ----------

type Point = { t: string; value?: string; returnPct: string };
type Series = { returnPct: string; points: Point[] };

const labelOf = (symbol: string) => BENCHMARKS.find((b) => b.symbol === symbol)?.label ?? symbol;

const toSeries = (times: string[], returns: Decimal[], values?: string[]): Series => ({
  returnPct: pct(returns.at(-1) ?? new Decimal(0)),
  points: times.map((t, i) => ({ t, ...(values && { value: new Decimal(values[i]!).toFixed(2) }), returnPct: pct(returns[i]!) })),
});

const dailyPerformance = async (scope: Scope, range: keyof typeof RANGE_MONTHS, benchmarks: string[], sessionDate: string) => {
  const fromDate = shiftDate(sessionDate, { months: -RANGE_MONTHS[range] });
  const [history, live] = await Promise.all([
    dashboardRepository.findSnapshotSeries(scope, fromDate, sessionDate),
    computeSummary(scope, sessionDate),
  ]);
  // Snapshots up to yesterday + a live point for the current session.
  const points = [...history, { date: sessionDate, value: live.raw.marketValue.toString(), flow: live.raw.sessionFlow.toString() }];
  const portfolio = toSeries(
    points.map((p) => p.date),
    timeWeightedReturns(points),
    points.map((p) => p.value),
  );

  // Benchmarks start on the portfolio's first point so both lines share a baseline.
  const baseDate = points[0]!.date;
  const [closes, quotes] = await Promise.all([
    marketService.getDailyCloses(benchmarks, baseDate),
    marketService.getQuotes(benchmarks),
  ]);
  return {
    portfolio,
    benchmarks: benchmarks.map((symbol) => {
      const series = closes.filter((c) => c.symbol === symbol && c.date < sessionDate);
      const quote = quotes.find((q) => q.symbol === symbol);
      if (quote) series.push({ symbol, date: sessionDate, close: quote.price });
      const values = series.map((c) => c.close);
      return { symbol, label: labelOf(symbol), ...toSeries(series.map((c) => c.date), simpleReturns(values, values[0] ?? '0')) };
    }),
  };
};

// Regular-hours bars of the current session (1D) or the last 7 calendar days (1W); Yahoo also
// returns pre/post-market bars for stocks but not for indices, which would skew the comparison.
const sessionBars = (bars: { t: string; close: string }[], range: '1D' | '1W', sessionDate: string) => {
  const since = range === '1D' ? sessionDate : shiftDate(sessionDate, { days: -6 });
  return bars.filter((b) => {
    const at = new Date(b.t);
    const day = toNyDate(at);
    return day >= since && day <= sessionDate && isRegularHours(at);
  });
};

// ponytail: values each bar with *current* quantities, so trades made today shift the whole 1D/1W line.
// Apply the session's transactions to bars after their executedAt if that matters.
const intradayPerformance = async (scope: Scope, range: '1D' | '1W', benchmarks: string[], sessionDate: string) => {
  const positions = await dashboardRepository.findHeldPositions(scope);
  const symbols = [...new Set([...positions.map((p) => p.symbol), ...benchmarks])];
  const bars = new Map(
    await Promise.all(
      symbols.map(async (s) => [s, sessionBars(await marketService.getIntradayBars(s, range), range, sessionDate)] as const),
    ),
  );
  const quotes = await marketService.getQuotes(benchmarks);

  // Portfolio: Σ qty × last close at or before each timestamp (forward-filled).
  const times = [...new Set(positions.flatMap((p) => bars.get(p.symbol)?.map((b) => b.t) ?? []))].sort();
  const cursor = new Map<string, { i: number; close: string | undefined }>();
  const values = times.map((t) =>
    positions
      .reduce((sum, p) => {
        const series = bars.get(p.symbol) ?? [];
        const c = cursor.get(p.symbol) ?? { i: 0, close: range === '1D' ? (p.previous_close ?? undefined) : series[0]?.close };
        while (c.i < series.length && series[c.i]!.t <= t) c.close = series[c.i++]!.close;
        cursor.set(p.symbol, c);
        return c.close ? sum.plus(new Decimal(p.qty).times(c.close)) : sum;
      }, new Decimal(0))
      .toString(),
  );
  // 1D measures against yesterday's close (like brokers do); 1W against its first bar.
  const base =
    range === '1D'
      ? positions.reduce((s, p) => (p.previous_close ? s.plus(new Decimal(p.qty).times(p.previous_close)) : s), new Decimal(0)).toString()
      : (values[0] ?? '0');

  return {
    portfolio: toSeries(times, simpleReturns(values, base), values),
    benchmarks: benchmarks.map((symbol) => {
      const series = bars.get(symbol) ?? [];
      const closes = series.map((b) => b.close);
      const benchBase = range === '1D' ? (quotes.find((q) => q.symbol === symbol)?.previousClose ?? closes[0]) : closes[0];
      return { symbol, label: labelOf(symbol), ...toSeries(series.map((b) => b.t), simpleReturns(closes, benchBase ?? '0')) };
    }),
  };
};

export const getPerformance = async (scope: Scope, range: PerformanceRange, benchmarks: string[]) => {
  try {
    await assertScope(scope);
    return await cached(cacheKey(scope, `perf:${range}:${benchmarks.join(',')}`), PERFORMANCE_TTL[range], async () => {
      const sessionDate = await marketService.getSessionDate();
      const result =
        range === '1D' || range === '1W'
          ? await intradayPerformance(scope, range, benchmarks, sessionDate)
          : await dailyPerformance(scope, range, benchmarks, sessionDate);
      return { range, interval: range === '1D' ? '5m' : range === '1W' ? '1h' : '1d', ...result };
    });
  } catch (err) {
    throw toAppError(err);
  }
};

// ---------- snapshot jobs ----------

// Recomputes a portfolio's daily snapshots from `fromDate` (default: its first trade) to today.
export const rebuildSnapshots = async (portfolioId: string, fromDate?: string) => {
  try {
    const { firstDate, symbols } = await dashboardRepository.findLedgerInfo(portfolioId);
    await dashboardRepository.deleteSnapshotsOutside(portfolioId, firstDate);
    if (!firstDate) return;
    const from = fromDate && fromDate > firstDate ? fromDate : firstDate;
    // A week of slack so "latest close on/before" has a value on the first day.
    await marketService.ensureHistory([...symbols, CALENDAR_SYMBOL], shiftDate(from, { days: -7 }));
    await dashboardRepository.upsertSnapshots(portfolioId, from, toNyDate(new Date()));
    const userId = await dashboardRepository.findPortfolioOwner(portfolioId);
    if (userId) await cacheService.invalidatePattern(`dashboard:${userId}:*:perf:*`);
  } catch (err) {
    throw toAppError(err);
  }
};

// EOD: refresh the last week of snapshots for every portfolio (self-heals missed runs).
export const snapshotAll = async () => {
  try {
    const today = toNyDate(new Date());
    const from = shiftDate(today, { days: -7 });
    for (const portfolioId of await dashboardRepository.findPortfolioIdsWithTransactions()) {
      await dashboardRepository.upsertSnapshots(portfolioId, from, today);
    }
    await cacheService.invalidatePattern('dashboard:*:perf:*');
  } catch (err) {
    throw toAppError(err);
  }
};
