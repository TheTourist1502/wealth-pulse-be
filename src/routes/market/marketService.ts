import Decimal from 'decimal.js';
import { cached } from '@/config/cache';
import { logger } from '@/config/logger';
import { yahoo } from '@/config/yahoo';
import { AppError, toAppError } from '@/utils/appError';
import { BENCHMARKS, BENCHMARK_SYMBOLS, CALENDAR_SYMBOL } from '@/utils/constants';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { shiftDate, toNyDate } from '@/utils/marketTime';
import { emitStockPrices } from '@/websocket/emitter';
import * as marketRepository from '@/routes/market/marketRepository';

// Every Yahoo call in the app lives in this file, so swapping the provider touches one place.

const QUOTE_TYPES = ['EQUITY', 'ETF', 'INDEX', 'MUTUALFUND', 'CRYPTOCURRENCY'] as const;
type QuoteType = (typeof QUOTE_TYPES)[number] | 'OTHER';
const toQuoteType = (t: string | undefined): QuoteType =>
  (QUOTE_TYPES as readonly string[]).includes(t ?? '') ? (t as QuoteType) : 'OTHER';

// The subset of Yahoo's quote shape we read.
type YahooQuote = {
  symbol: string;
  quoteType?: string;
  currency?: string;
  longName?: string;
  shortName?: string;
  fullExchangeName?: string;
  marketState?: string;
  regularMarketPrice?: number;
  regularMarketPreviousClose?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  regularMarketTime?: Date;
};

export type NewsItem = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string;
  thumbnailUrl: string | null;
  relatedTickers: string[];
};

export type Mover = { symbol: string; name: string; price: string | null; changePercent: string | null };

const upstream = async <T>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    throw new AppError(HTTP_STATUS.BAD_GATEWAY, 'UPSTREAM_ERROR', 'Market data provider unavailable', undefined, { cause: err });
  }
};

const str = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? null : String(n));
const fixed = (value: string | number | null | undefined, dp: number) =>
  value === null || value === undefined ? null : new Decimal(value).toFixed(dp);

const toQuoteRow = (q: YahooQuote): marketRepository.QuoteRow | undefined => {
  const price = str(q.regularMarketPrice);
  const previousClose = str(q.regularMarketPreviousClose);
  if (!price || !previousClose) return undefined;
  return {
    symbol: q.symbol,
    price,
    previousClose,
    change: str(q.regularMarketChange) ?? new Decimal(price).minus(previousClose).toString(),
    changePercent: str(q.regularMarketChangePercent) ?? '0',
    dayHigh: str(q.regularMarketDayHigh),
    dayLow: str(q.regularMarketDayLow),
    volume: q.regularMarketVolume ?? null,
    marketState: q.marketState ?? 'CLOSED',
    quotedAt: q.regularMarketTime ?? new Date(),
  };
};

const fetchQuotes = async (symbols: string[]): Promise<YahooQuote[]> => {
  const out: YahooQuote[] = [];
  for (let i = 0; i < symbols.length; i += 100) {
    const chunk = symbols.slice(i, i + 100);
    // Yahoo's union includes symbol-less ECN quotes; drop anything without a symbol.
    const quotes = (await upstream(() => yahoo.quote(chunk))) as unknown as Partial<YahooQuote>[];
    out.push(...quotes.filter((q): q is YahooQuote => typeof q.symbol === 'string'));
  }
  return out;
};

// ---------- quotes ----------

export const refreshQuotes = async (symbols: string[]) => {
  try {
    const rows = (await fetchQuotes(symbols)).map(toQuoteRow).filter((r) => r !== undefined);
    await marketRepository.upsertQuotes(rows);
    emitStockPrices(
      rows.map((r) => ({
        symbol: r.symbol,
        price: r.price,
        previousClose: r.previousClose,
        change: r.change,
        changePercent: r.changePercent,
        marketState: r.marketState,
        timestamp: r.quotedAt.toISOString(),
      })),
    );
    return rows;
  } catch (err) {
    throw toAppError(err);
  }
};

export const refreshTrackedQuotes = async () => {
  try {
    const symbols = [...new Set([...(await marketRepository.findTrackedSymbols()), ...BENCHMARK_SYMBOLS])];
    return await refreshQuotes(symbols);
  } catch (err) {
    throw toAppError(err);
  }
};

export const getQuotes = async (symbols: string[]) => {
  try {
    return await marketRepository.findQuotes(symbols);
  } catch (err) {
    throw toAppError(err);
  }
};

// The current (or last) trading session: New York date of the calendar index's last quote.
export const getSessionDate = async (): Promise<string> => {
  try {
    const [quote] = await marketRepository.findQuotes([CALENDAR_SYMBOL]);
    return toNyDate(quote?.quotedAt ?? new Date());
  } catch (err) {
    throw toAppError(err);
  }
};

// ---------- securities ----------

// Makes sure `symbol` exists in the securities master (validating it with Yahoo the first time).
export const ensureSecurity = async (symbol: string) => {
  try {
    const existing = await marketRepository.findSecurity(symbol);
    if (existing) return { security: existing, created: false };

    const [quote] = await fetchQuotes([symbol]);
    if (!quote || quote.symbol !== symbol || quote.regularMarketPrice === undefined) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, 'UNKNOWN_SYMBOL', `Unknown symbol ${symbol}`);
    }
    // ponytail: USD only; multi-currency needs FX rates and a base currency.
    if (quote.currency !== 'USD') {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, 'UNSUPPORTED_CURRENCY', 'Only USD-listed securities are supported');
    }
    await marketRepository.insertSecurity({
      symbol,
      name: quote.longName ?? quote.shortName ?? null,
      exchange: quote.fullExchangeName ?? null,
      currency: quote.currency,
      quoteType: toQuoteType(quote.quoteType),
    });
    const row = toQuoteRow(quote);
    if (row) await marketRepository.upsertQuotes([row]);

    const security = await marketRepository.findSecurity(symbol);
    if (!security) throw new Error(`security ${symbol} missing after insert`);
    return { security, created: true };
  } catch (err) {
    throw toAppError(err);
  }
};

export const refreshProfile = async (symbol: string) => {
  try {
    const security = await marketRepository.findSecurity(symbol);
    if (!security) return;
    // Indices and funds have no assetProfile; asking for it makes Yahoo fail the whole call.
    const hasProfile = security.quoteType === 'EQUITY';
    const summary = await upstream(() =>
      yahoo.quoteSummary(symbol, { modules: hasProfile ? ['price', 'assetProfile'] : ['price'] }),
    );
    await marketRepository.updateSecurity(symbol, {
      name: summary.price?.longName ?? summary.price?.shortName ?? security.name,
      exchange: summary.price?.exchangeName ?? security.exchange,
      currency: summary.price?.currency ?? security.currency,
      quoteType: toQuoteType(summary.price?.quoteType ?? security.quoteType),
      sector: summary.assetProfile?.sector ?? security.sector,
      industry: summary.assetProfile?.industry ?? security.industry,
      profileUpdatedAt: new Date(),
    });
  } catch (err) {
    throw toAppError(err);
  }
};

export const refreshAllProfiles = async () => {
  try {
    for (const { symbol } of await marketRepository.listSecurities()) {
      await refreshProfile(symbol).catch((err: unknown) => logger.warn({ err, symbol }, 'profile refresh failed'));
    }
  } catch (err) {
    throw toAppError(err);
  }
};

// ---------- price history ----------

const fetchDailyCloses = async (symbol: string, fromDate: string): Promise<marketRepository.DailyCloseRow[]> => {
  const chart = await upstream(() => yahoo.chart(symbol, { period1: fromDate, interval: '1d' }));
  return chart.quotes
    .filter((q) => q.close !== null && q.close !== undefined)
    .map((q) => ({ symbol, tradeDate: toNyDate(q.date), close: String(q.close) }));
};

// Makes sure daily closes cover fromDate..today for every symbol (fetches only what's missing).
export const ensureHistory = async (symbols: string[], fromDate: string) => {
  try {
    const staleBefore = shiftDate(toNyDate(new Date()), { days: -5 });
    for (const symbol of new Set(symbols)) {
      const range = await marketRepository.findPriceDateRange(symbol);
      const start = !range?.first || range.first > fromDate ? fromDate : range.last && range.last < staleBefore ? range.last : undefined;
      if (start) await marketRepository.upsertDailyCloses(await fetchDailyCloses(symbol, start));
    }
  } catch (err) {
    throw toAppError(err);
  }
};

// EOD: the last week of closes for every tracked symbol; the 7-day window self-heals missed runs.
// ponytail: sequential Yahoo calls; batch with limited concurrency if tracked symbols reach the hundreds.
export const refreshDailyCloses = async () => {
  try {
    const symbols = [...new Set([...(await marketRepository.findTrackedSymbols()), ...BENCHMARK_SYMBOLS])];
    const from = shiftDate(toNyDate(new Date()), { days: -7 });
    for (const symbol of symbols) {
      await marketRepository
        .upsertDailyCloses(await fetchDailyCloses(symbol, from))
        .catch((err: unknown) => logger.warn({ err, symbol }, 'daily close refresh failed'));
    }
  } catch (err) {
    throw toAppError(err);
  }
};

export const getDailyCloses = async (symbols: string[], fromDate: string) => {
  try {
    return await marketRepository.findDailyCloses(symbols, fromDate);
  } catch (err) {
    throw toAppError(err);
  }
};

// Intraday bars for the 1D (5m) / 1W (1h) charts, cached briefly and shared across users.
export const getIntradayBars = async (symbol: string, range: '1D' | '1W') => {
  try {
    return await cached(`stock:${symbol}:chart:${range}`, range === '1D' ? 60 : 300, async () => {
      const days = range === '1D' ? 4 : 9;
      const chart = await upstream(() =>
        yahoo.chart(symbol, { period1: new Date(Date.now() - days * 86_400_000), interval: range === '1D' ? '5m' : '1h' }),
      );
      return chart.quotes
        .filter((q) => q.close !== null && q.close !== undefined)
        .map((q) => ({ t: q.date.toISOString(), close: String(q.close) }));
    });
  } catch (err) {
    throw toAppError(err);
  }
};

// ---------- endpoints ----------

export const getIndices = async () => {
  try {
    return await cached('market:indices', 30, async () => {
      let rows = await marketRepository.findQuotes(BENCHMARK_SYMBOLS);
      // Cold start before the price job has run.
      if (rows.length < BENCHMARK_SYMBOLS.length) {
        await refreshQuotes(BENCHMARK_SYMBOLS);
        rows = await marketRepository.findQuotes(BENCHMARK_SYMBOLS);
      }
      const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
      const calendar = bySymbol.get(CALENDAR_SYMBOL);
      return {
        marketState: calendar?.marketState ?? 'CLOSED',
        asOf: calendar?.quotedAt.toISOString() ?? null,
        indices: BENCHMARKS.map(({ symbol, label }) => {
          const r = bySymbol.get(symbol);
          return {
            symbol,
            label,
            price: fixed(r?.price, 2),
            change: fixed(r?.change, 2),
            changePercent: fixed(r?.changePercent, 2),
          };
        }),
      };
    });
  } catch (err) {
    throw toAppError(err);
  }
};

export const getMovers = async (type: 'gainers' | 'losers', limit: number) => {
  try {
    const movers = await cached<Mover[]>(`market:movers:${type}`, 300, async () => {
      // Yahoo's screener payload drifts from the library's schema; we only read stable quote fields.
      const res = await upstream(() =>
        yahoo.screener({ scrIds: type === 'gainers' ? 'day_gainers' : 'day_losers', count: 25 }, undefined, {
          validateResult: false,
        }),
      );
      return (res as { quotes: YahooQuote[] }).quotes.map((q) => ({
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? q.symbol,
        price: fixed(q.regularMarketPrice, 2),
        changePercent: fixed(q.regularMarketChangePercent, 2),
      }));
    });
    return movers.slice(0, limit);
  } catch (err) {
    throw toAppError(err);
  }
};

type YahooThumbnail = { resolutions: { url: string; width: number }[] } | undefined;
const pickThumbnail = (thumb: YahooThumbnail) =>
  thumb?.resolutions.slice().sort((a, b) => a.width - b.width).find((r) => r.width >= 140)?.url ?? null;

export const searchNews = async (query: string, count: number): Promise<NewsItem[]> => {
  try {
    const res = await upstream(() => yahoo.search(query, { newsCount: count, quotesCount: 0 }));
    return res.news
      .filter((n) => /^https?:\/\//i.test(n.link))
      .map((n) => ({
        id: n.uuid,
        title: n.title,
        publisher: n.publisher,
        url: n.link,
        publishedAt: new Date(n.providerPublishTime).toISOString(),
        thumbnailUrl: pickThumbnail(n.thumbnail as YahooThumbnail),
        relatedTickers: n.relatedTickers ?? [],
      }));
  } catch (err) {
    throw toAppError(err);
  }
};
