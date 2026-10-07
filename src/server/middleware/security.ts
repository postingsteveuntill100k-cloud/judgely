import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { log } from '../lib/logger.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function tokenFrom(req: Request): string | null {
  const body = req.body as Record<string, unknown> | undefined;
  if (body && typeof body._csrf === 'string') return body._csrf;
  const header = req.get('x-csrf-token');
  return header ?? null;
}

/**
 * Double-submit CSRF token for cookie-authenticated writes.
 * Bearer-token API callers are exempt: they are not vulnerable to ambient
 * credential submission, because the browser will not attach the header.
 */
export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!config.security.csrf) {
    next();
    return;
  }
  if (SAFE.has(req.method)) {
    next();
    return;
  }
  if (req.get('authorization')?.startsWith('Bearer ')) {
    next();
    return;
  }
  const expected = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const provided = tokenFrom(req);
  if (!expected || !provided) {
    log.warn('CSRF token missing', {
      ip: req.socket.remoteAddress,
      path: req.path,
      method: req.method,
      hasCookie: Boolean(expected),
      hasToken: Boolean(provided),
    });
    next(new AppError(403, 'csrf_missing', 'Your session expired while the page was open. Reload the page and try again.'));
    return;
  }
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    log.warn('CSRF token mismatch', {
      ip: req.socket.remoteAddress,
      path: req.path,
      method: req.method,
    });
    next(new AppError(403, 'csrf_invalid', 'That form was submitted from a stale page. Reload and try again.'));
    return;
  }
  next();
}

export const CSRF_COOKIE = 'hkl_csrf';

export function issueCsrfToken(res: Response): string {
  const existing = res.req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (existing && /^[A-Za-z0-9_-]{16,128}$/.test(existing)) return existing;
  const token = crypto.randomBytes(24).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.session.secure,
    path: '/',
    maxAge: 12 * 3600,
  });
  return token;
}

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // The Firebase web SDK is only reachable when Firebase Authentication is
  // actually configured. A self-hosted install gets a strict 'self' policy.
  const firebase = config.firebase.configured && Boolean(config.firebase.webApiKey);
  const scriptSrc = ["'self'", ...(firebase ? ['https://www.gstatic.com'] : [])];
  const connectSrc = ["'self'", ...(firebase ? ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'] : [])];
  const authDomain = config.firebase.authDomain || (config.firebase.projectId ? `https://${config.firebase.projectId}.firebaseapp.com` : '');
  const frameSrc = [
    'https://www.youtube.com',
    'https://player.vimeo.com',
    'https://www.loom.com',
    'https://accounts.google.com',
    ...(authDomain ? [authDomain.startsWith('http') ? authDomain : `https://${authDomain}`] : []),
  ];

  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data: https:",
      "style-src 'self' 'unsafe-inline'",
      `script-src ${scriptSrc.join(' ')}`,
      "font-src 'self' data:",
      `connect-src ${connectSrc.join(' ')}`,
      `frame-src ${frameSrc.join(' ')}`,
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      config.isProd ? 'upgrade-insecure-requests' : '',
    ]
      .filter(Boolean)
      .join('; '),
  );
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    const ms = Date.now() - (req.startedAt ?? Date.now());
    if (res.statusCode >= 500) {
      log.error('request failed', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms });
    } else if (ms > 1200) {
      log.warn('slow request', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms });
    } else {
      log.debug('request', { method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms });
    }
  });
  next();
}
