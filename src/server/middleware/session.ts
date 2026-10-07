import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { resolveSession, toActor, type Actor } from '../services/auth.js';
import { db } from '../db/index.js';
import { log } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor: Actor | null;
      sessionId?: string;
      sessionError?: Error | null;
      startedAt: number;
      wantsJson?: boolean;
    }
  }
}

function clientIp(req: Request): string {
  if (config.security.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? '';
}

/** Reads the signed session cookie or a bearer token. Never trusts the browser alone. */
export async function sessionMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
  req.actor = null;
  req.sessionError = null;
  req.startedAt = Date.now();
  const header = req.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const token = bearer ?? (req.cookies?.[config.session.cookieName] as string | undefined);
  if (token) {
    try {
      const found = await resolveSession(token);
      if (found) {
        req.actor = toActor(found.user, found.sessionId);
        req.sessionId = found.sessionId;
      }
    } catch (e) {
      log.warn('session lookup failed', { error: (e as Error).message });
      req.sessionError = e as Error;
    }
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.sessionError) {
    next(new AppError(503, 'session_store_unavailable', 'Authentication service is temporarily unavailable. Please retry.'));
    return;
  }
  if (!req.actor) {
    next(new AppError(401, 'unauthenticated', 'Sign in to continue.'));
    return;
  }
  next();
}

export function currentActor(req: Request): Actor | null {
  return req.actor ?? null;
}

export function ipOf(req: Request): string {
  return clientIp(req);
}

export function isApiRequest(req: Request): boolean {
  return req.path.startsWith('/api/') || req.get('accept')?.includes('application/json') === true;
}
