import { z } from 'zod';
import { AppError } from '@/utils/appError';
import { SYMBOL_REGEX } from '@/utils/constants';
import { HTTP_STATUS } from '@/utils/httpStatus';

// Controllers validate req.body/query/params with this; returns the parsed (trimmed/coerced) value or throws 400.
export const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR', 'Invalid request', z.flattenError(result.error).fieldErrors);
  }
  return result.data;
};

// Money/quantity input: number or string, normalized to a plain decimal string (max 6 dp) for numeric columns.
export const decimalString = z
  .union([z.string().trim(), z.number().finite()])
  .transform(String)
  .pipe(z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Must be a non-negative decimal with at most 6 decimals'));

export const symbolString = z.string().trim().toUpperCase().regex(SYMBOL_REGEX, 'Invalid symbol');
