import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { isApiRequest } from './session.js';
import { renderBare } from '../view.js';

const assetVersion = () => (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');

export function notFoundHandler(req: Request, res: Response): void {
  if (isApiRequest(req)) {
    res.status(404).json({ error: { code: 'not_found', message: `No route matches ${req.method} ${req.path}.` } });
    return;
  }
  res.status(404);
  res.type('html').send(
    renderBare('errors/404', {
      title: 'Not found',
      actor: req.actor,
      csrfToken: (req as any).csrfToken ?? '',
      nav: '',
      assetVersion: assetVersion(),
    }),
  );
}

export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  const isApp = err instanceof AppError;
  // body-parser and friends already set a 4xx status; do not turn a rejected
  // upload into a 500.
  const frameworkStatus = Number(err?.status ?? err?.statusCode ?? 0);
  const status = isApp ? err.status : frameworkStatus >= 400 && frameworkStatus < 600 ? frameworkStatus : 500;

  if (!isApp) {
    log.error('unhandled error', {
      method: req.method,
      path: req.originalUrl?.split('?')[0],
      message: err?.message,
      stack: String(err?.stack ?? '').split('\n').slice(0, 4).join(' | '),
    });
  }

  const message = isApp
    ? err.message
    : status < 500
      ? err.message || 'That request could not be accepted.'
      : config.isProd
        ? 'Something went wrong on our side. The error has been logged.'
        : `${err?.message ?? 'Unknown error'}`;

  const payload = {
    error: {
      code: isApp ? err.code : 'internal_error',
      message,
      ...(isApp && err.field ? { field: err.field } : {}),
      ...(isApp && err.meta ? { meta: err.meta } : {}),
      ...(config.isProd || !isApp ? {} : { stack: String(err?.stack ?? '').split('\n').slice(0, 6) }),
    },
  };

  if (isApiRequest(req)) {
    res.status(status).json(payload);
    return;
  }

  res.status(status);
  const wantsForm = req.method !== 'GET';
  res.type('html').send(renderBare('errors/error', {
    title: status === 404 ? 'Not found' : 'Something went wrong',
    actor: req.actor,
    csrfToken: (req as any).csrfToken ?? '',
    nav: '',
    assetVersion: assetVersion(),
    status,
    code: payload.error.code,
    message,
    detail: isApp ? err.detail ?? null : null,
    issues: payload.error.meta?.issues ?? null,
    backTo: wantsForm ? safeReferer(req) : null,
  }));
}

function safeReferer(req: Request): string | null {
  const ref = req.get('referer');
  if (!ref) return null;
  try {
    const url = new URL(ref);
    const base = new URL(config.baseUrl);
    if (url.origin !== base.origin) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
