import type { RequestHandler } from 'express';
import { z } from 'zod';
import { camelKeys } from '@/utils/camelKeys';
import { HTTP_STATUS } from '@/utils/httpStatus';
import { decimalString, parse, symbolString } from '@/utils/parse';
import * as portfoliosService from '@/routes/portfolios/portfoliosService';

const idParams = z.object({ id: z.uuid() });
const transactionParams = idParams.extend({ transactionId: z.uuid() });

const portfolioSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).nullish(),
});
const portfolioUpdateSchema = portfolioSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const transactionSchema = z.object({
  type: z.enum(['buy', 'sell']),
  symbol: symbolString,
  quantity: decimalString.refine((v) => /[1-9]/.test(v), 'Must be greater than 0'),
  price: decimalString,
  fee: decimalString.default('0'),
  executedAt: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + 60_000, 'Cannot be in the future')
    .refine((d) => d.getFullYear() >= 1990, 'Too far in the past')
    .optional(),
});

export const list: RequestHandler = async (req, res, next) => {
  try {
    const result = await portfoliosService.listPortfolios(req.userId);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const get: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(idParams, req.params);
    const result = await portfoliosService.getPortfolio(req.userId, id);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const create: RequestHandler = async (req, res, next) => {
  try {
    const body = parse(portfolioSchema, req.body);
    const result = await portfoliosService.createPortfolio(req.userId, body);
    res.status(HTTP_STATUS.CREATED).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const update: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(idParams, req.params);
    const body = parse(portfolioUpdateSchema, req.body);
    const result = await portfoliosService.updatePortfolio(req.userId, id, body);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const remove: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(idParams, req.params);
    await portfoliosService.deletePortfolio(req.userId, id);
    res.status(HTTP_STATUS.NO_CONTENT).end();
  } catch (err) {
    next(err);
  }
};

export const listTransactions: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(idParams, req.params);
    const paging = parse(paginationSchema, req.query);
    const { rows, total } = await portfoliosService.listTransactions(req.userId, id, paging);
    res.status(HTTP_STATUS.OK).json({ data: camelKeys(rows), meta: { ...paging, total } });
  } catch (err) {
    next(err);
  }
};

export const createTransaction: RequestHandler = async (req, res, next) => {
  try {
    const { id } = parse(idParams, req.params);
    const body = parse(transactionSchema, req.body);
    const result = await portfoliosService.createTransaction(req.userId, id, body, req.ip);
    res.status(HTTP_STATUS.CREATED).json({ data: camelKeys(result) });
  } catch (err) {
    next(err);
  }
};

export const deleteTransaction: RequestHandler = async (req, res, next) => {
  try {
    const { id, transactionId } = parse(transactionParams, req.params);
    await portfoliosService.deleteTransaction(req.userId, id, transactionId, req.ip);
    res.status(HTTP_STATUS.NO_CONTENT).end();
  } catch (err) {
    next(err);
  }
};
