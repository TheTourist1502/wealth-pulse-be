import { z } from 'zod';
import { AppError } from '@/utils/appError';
import { HTTP_STATUS } from '@/utils/httpStatus';

// Controllers validate req.body/query/params with this; returns the parsed (trimmed/coerced) value or throws 400.
export const parse = <T extends z.ZodType>(schema: T, data: unknown): z.infer<T> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR', 'Invalid request', z.flattenError(result.error).fieldErrors);
  }
  return result.data;
};
