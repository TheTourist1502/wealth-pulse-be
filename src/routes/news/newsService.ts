import { cached } from '@/config/cache';
import { logger } from '@/config/logger';
import { toAppError } from '@/utils/appError';
import * as marketService from '@/routes/market/marketService';
import * as newsRepository from '@/routes/news/newsRepository';

const NEWS_TTL = 900;
const HOLDING_NEWS_SYMBOLS = 10;

// ponytail: single "trending" feed; categories (Markets, Economy, Tech) become a category → query map later.
export const getTrending = async (limit: number) => {
  try {
    const items = await cached('news:trending', NEWS_TTL, () => marketService.searchNews('stock market', 20));
    return items.slice(0, limit).map(({ relatedTickers, ...item }) => ({ ...item, symbols: relatedTickers }));
  } catch (err) {
    throw toAppError(err);
  }
};

// News for the user's top holdings; a failing symbol is skipped, not fatal.
export const getHoldingNews = async (userId: string, limit: number) => {
  try {
    const held = await newsRepository.findTopHeldSymbols(userId, HOLDING_NEWS_SYMBOLS);
    const heldSet = new Set(held);
    const results = await Promise.allSettled(
      held.map((symbol) => cached(`news:symbol:${symbol}`, NEWS_TTL, () => marketService.searchNews(symbol, 5)).then((items) => ({ symbol, items }))),
    );

    const byId = new Map<string, marketService.NewsItem & { symbols: Set<string> }>();
    for (const r of results) {
      if (r.status === 'rejected') {
        logger.warn({ err: r.reason }, 'holding news fetch failed');
        continue;
      }
      for (const item of r.value.items) {
        const entry = byId.get(item.id) ?? { ...item, symbols: new Set<string>() };
        entry.symbols.add(r.value.symbol);
        for (const t of item.relatedTickers) if (heldSet.has(t)) entry.symbols.add(t);
        byId.set(item.id, entry);
      }
    }

    return [...byId.values()]
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit)
      .map(({ relatedTickers: _related, symbols, ...item }) => ({ ...item, symbols: [...symbols] }));
  } catch (err) {
    throw toAppError(err);
  }
};
