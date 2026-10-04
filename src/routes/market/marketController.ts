import type { RequestHandler } from 'express';
import { z } from 'zod';
import { camelKeys } from '@/utils/camelKeys';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { parse } from '@/utils/parse';
import * as marketService from '@/routes/market/marketService';

const moversSchema = z.object({
  type: z.enum(['gainers', 'losers']),
  limit: z.coerce.number().int().min(1).max(25).default(10),
});

export const indices: RequestHandler = async (_req, res, next) => {
  try {
    const result = await marketService.getIndices();
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const movers: RequestHandler = async (req, res, next) => {
  try {
    const { type, limit } = parse(moversSchema, req.query);
    const result = await marketService.getMovers(type, limit);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};
