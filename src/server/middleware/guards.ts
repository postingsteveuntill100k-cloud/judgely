import type { NextFunction, Request, Response } from 'express';
import { config } from '../config.js';
import { limits } from '../lib/ratelimit.js';
import { ipOf } from './session.js';

/** Cheap per-IP budget for anonymous read traffic. */
export function limitPublicRead(req: Request, _res: Response, next: NextFunction): void {
  if (!config.security.rateLimit) return next();
  if (req.actor) return next(); // signed-in users are covered by the write budget
  try {
    limits.publicRead(ipOf(req));
  } catch (e) {
    return next(e);
  }
  next();
}

export function limitAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!config.security.rateLimit) return next();
  try {
    limits.auth(ipOf(req));
  } catch (e) {
    return next(e);
  }
  next();
}

export function limitSignup(req: Request, _res: Response, next: NextFunction): void {
  if (!config.security.rateLimit) return next();
  try {
    limits.signup(ipOf(req));
  } catch (e) {
    return next(e);
  }
  next();
}

export function limitWrite(req: Request, _res: Response, next: NextFunction): void {
  if (!config.security.rateLimit || !req.actor) return next();
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  try {
    limits.write(req.actor.id);
  } catch (e) {
    return next(e);
  }
  next();
}

export function limitReview(req: Request, _res: Response, next: NextFunction): void {
  if (!config.security.rateLimit || !req.actor) return next();
  try {
    limits.review(req.actor.id);
  } catch (e) {
    return next(e);
  }
  next();
}

export function limitInvite(req: Request, _res: Response, next: NextFunction): void {
  if (!config.security.rateLimit || !req.actor) return next();
  try {
    limits.invite(req.actor.id);
  } catch (e) {
    return next(e);
  }
  next();
}
