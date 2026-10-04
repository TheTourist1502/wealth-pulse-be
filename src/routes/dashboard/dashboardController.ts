import type { RequestHandler } from 'express';
import { z } from 'zod';
import { BENCHMARK_SYMBOLS, PERFORMANCE_RANGES } from '@/utils/constants';
import { camelKeys } from '@/utils/camelKeys';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { parse } from '@/utils/parse';
import * as dashboardService from '@/routes/dashboard/dashboardService';

const scopeSchema = z.object({ portfolioId: z.uuid().optional() });

const holdingsSchema = scopeSchema.extend({
  sort: z.enum(['marketValue', 'todayPnl', 'totalPnl', 'symbol']).default('marketValue'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const performanceSchema = scopeSchema.extend({
  range: z.enum(PERFORMANCE_RANGES),
  // "^GSPC,^IXIC" → ['^GSPC', '^IXIC'], only known benchmarks, max 3.
  benchmarks: z
    .string()
    .optional()
    .transform((s) => [...new Set((s ?? '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean))])
    .pipe(z.array(z.enum(BENCHMARK_SYMBOLS as [string, ...string[]])).max(3)),
});

export const summary: RequestHandler = async (req, res, next) => {
  try {
    const { portfolioId } = parse(scopeSchema, req.query);
    const result = await dashboardService.getSummary({ userId: req.userId, portfolioId });
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const holdings: RequestHandler = async (req, res, next) => {
  try {
    const { portfolioId, sort, order } = parse(holdingsSchema, req.query);
    const result = await dashboardService.getHoldings({ userId: req.userId, portfolioId }, sort, order);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const performance: RequestHandler = async (req, res, next) => {
  try {
    const { portfolioId, range, benchmarks } = parse(performanceSchema, req.query);
    const result = await dashboardService.getPerformance({ userId: req.userId, portfolioId }, range, benchmarks);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};
