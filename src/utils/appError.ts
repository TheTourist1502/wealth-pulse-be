import { HTTP_STATUS, type HttpStatus } from '@/utils/httpStatus';

export class AppError extends Error {
  constructor(
    public readonly status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

// Service catch blocks: pass AppErrors through, wrap anything else as a 500 keeping the original as `cause`.
export const toAppError = (err: unknown): AppError =>
  err instanceof AppError ? err : new AppError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', 'Internal server error', undefined, { cause: err });

const PG_ERRORS: Record<string, [status: HttpStatus, code: string, message: string]> = {
  '23505': [HTTP_STATUS.CONFLICT, 'CONFLICT', 'Resource already exists'],
  '23503': [HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', 'Related resource not found'],
};

// Repository catch blocks: map Postgres constraint violations to 4xx, everything else to 500.
// Drizzle wraps driver errors, so the PG code may sit on `cause`.
export const toDbError = (err: unknown): AppError => {
  if (err instanceof AppError) return err;
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  const pgCode = String(e?.code ?? e?.cause?.code ?? '');
  const mapped = PG_ERRORS[pgCode];
  return mapped ? new AppError(...mapped, undefined, { cause: err }) : toAppError(err);
};
