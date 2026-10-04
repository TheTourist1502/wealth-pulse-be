import type { RequestHandler } from 'express';
import { z } from 'zod';
import { camelKeys } from '@/utils/camelKeys';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { parse } from '@/utils/parse';
import * as newsService from '@/routes/news/newsService';

const listSchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export const trending: RequestHandler = async (req, res, next) => {
  try {
    const { limit } = parse(listSchema, req.query);
    const result = await newsService.getTrending(limit);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const holdings: RequestHandler = async (req, res, next) => {
  try {
    const { limit } = parse(listSchema, req.query);
    const result = await newsService.getHoldingNews(req.userId, limit);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};
