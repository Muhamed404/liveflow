import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (what) => new HttpError(404, `${what} not found`);

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.issues });
  }
  if (err?.code?.startsWith?.('SQLITE_CONSTRAINT')) {
    const status = err.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ? 409 : 409;
    return res.status(status).json({ error: 'Constraint violation', details: err.message });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
