/**
 * Application error type.
 *
 * Every failure a user can trigger carries a status, a short machine code and a
 * sentence that tells them what to do next. Route handlers throw these; a single
 * error middleware renders HTML for browsers and JSON for API clients.
 */
export class AppError extends Error {
  status: number;
  code: string;
  detail?: string;
  field?: string;
  meta?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    opts: { detail?: string; field?: string; meta?: Record<string, unknown> } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.detail = opts.detail;
    this.field = opts.field;
    this.meta = opts.meta;
  }
}

export const badRequest = (msg: string, code = 'bad_request', extra?: Record<string, unknown>) =>
  new AppError(400, code, msg, extra ?? {});

export const unauthorized = (msg = 'Sign in to continue.', code = 'unauthenticated') =>
  new AppError(401, code, msg);

export const forbidden = (msg = 'You do not have access to this.', code = 'forbidden', extra?: Record<string, unknown>) =>
  new AppError(403, code, msg, extra);

export const notFound = (msg = 'That page does not exist.', code = 'not_found') =>
  new AppError(404, code, msg);

export const conflict = (msg: string, code = 'conflict', extra?: Record<string, unknown>) => new AppError(409, code, msg, extra);

export const gone = (msg: string, code = 'gone', extra?: Record<string, unknown>) => new AppError(410, code, msg, extra);

export const tooMany = (msg = 'Too many attempts. Wait a minute and try again.', code = 'rate_limited') =>
  new AppError(429, code, msg);
