import { wrapRouter } from './safe.js';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { page, strParam } from './helpers.js';
import { createUser, createSession, destroySession, linkFirebaseUser, login, sessionCookie, clearedSessionCookie } from '../services/auth.js';
import { passwordProblems } from '../lib/crypto.js';
import { emailField, parse, text, usernameField } from '../lib/validate.js';
import { badRequest, conflict, unauthorized } from '../lib/errors.js';
import { requireAuth, ipOf } from '../middleware/session.js';
import { limitAuth, limitSignup } from '../middleware/guards.js';
import { limits, reset as resetLimit } from '../lib/ratelimit.js';
import { safeUrl } from '../lib/format.js';
import { log } from '../lib/logger.js';
import { firebaseAuth } from '../services/firebase.js';

const signUpSchema = z.object({
  display_name: text(60, 'Your name', 2),
  username: usernameField,
  email: emailField,
  password: z.string().min(1, 'Choose a password.'),
});

export function authRoutes(): Router {
  const r = Router();

  r.get('/auth/signup', (req, res) => {
    if (req.actor) {
      res.redirect(303, '/dashboard');
      return;
    }
    page(res, 'auth/signup', req, {
      pageTitle: 'Create your account',
      metaDescription: 'Create a Hackerly account to join hackathons, host events and judge projects.',
      values: { username: '' },
      error: null,
      issues: [],
      firebase: firebaseAuth.publicConfig(),
      next: strParam(req.query.next, 200) || '/dashboard',
    });
  });

  r.post('/auth/signup', limitSignup, async (req, res, next) => {
    const body = req.body as Record<string, string>;
    const nextUrl = safeNext(body.next, '/dashboard');
    let data;
    try {
      data = parse(signUpSchema, body);
    } catch (e) {
      return page(res, 'auth/signup', req, {
        pageTitle: 'Create your account',
        values: { username: body.username ?? '', display_name: body.display_name ?? '', email: body.email ?? '' },
        error: (e as any).message,
        issues: (e as any).meta?.issues ?? [],
        firebase: firebaseAuth.publicConfig(),
        next: nextUrl,
      }, 400);
    }
    const problems = passwordProblems(data.password);
    if (problems.length) {
      return page(res, 'auth/signup', req, {
        pageTitle: 'Create your account',
        values: { username: data.username, display_name: data.display_name, email: data.email },
        error: problems[0],
        issues: [{ field: 'password', message: problems[0] }],
        firebase: firebaseAuth.publicConfig(),
        next: nextUrl,
      }, 400);
    }
    try {
      const user = await createUser({
        email: data.email,
        username: data.username,
        displayName: data.display_name,
        password: data.password,
      });
      const { token } = await createSession(user.id, { ua: req.get('user-agent') ?? '', ip: ipOf(req) });
      res.cookie(config.session.cookieName, token, sessionCookie());
      log.info('account created', { username: user.username });
      res.redirect(303, '/settings/profile?welcome=1');
    } catch (e) {
      const err = e as any;
      if (err.status === 409) {
        return page(res, 'auth/signup', req, {
          pageTitle: 'Create your account',
          values: { username: body.username ?? '', display_name: body.display_name ?? '', email: body.email ?? '' },
          error: err.message,
          issues: [{ field: err.field ?? 'email', message: err.message }],
          firebase: firebaseAuth.publicConfig(),
          next: nextUrl,
        }, 409);
      }
      return next(e);
    }
  });

  r.get('/auth/signin', (req, res, next) => {
    if (req.actor) return res.redirect(303, '/dashboard');
    page(res, 'auth/signin', req, {
      pageTitle: 'Sign in',
      error: strParam(req.query.error, 200) || null,
      values: { identifier: strParam(req.query.identifier, 120) },
      next: strParam(req.query.next, 200) || '/dashboard',
      firebase: firebaseAuth.publicConfig(),
      invited: req.query.invited === '1',
    });
    void next;
  });

  r.post('/auth/signin', limitAuth, async (req, res, next) => {
    const body = req.body as Record<string, string>;
    const identifier = String(body.identifier ?? '').trim();
    const password = String(body.password ?? '');
    const nextUrl = safeNext(body.next, '/dashboard');
    if (!identifier || !password) {
      return page(res, 'auth/signin', req, {
        pageTitle: 'Sign in',
        error: 'Enter your email or username and your password.',
        values: { identifier },
        next: nextUrl,
        firebase: firebaseAuth.publicConfig(),
        invited: false,
      }, 400);
    }
    try {
      limits.login(ipOf(req), identifier.toLowerCase());
    } catch (e) {
      return next(e);
    }
    try {
      const result = await login(identifier, password, { ua: req.get('user-agent') ?? '', ip: ipOf(req) });
      resetLimit(`login:${ipOf(req)}:${identifier.toLowerCase()}`);
      res.cookie(config.session.cookieName, result.token, sessionCookie());
      res.redirect(303, nextUrl);
    } catch (e) {
      const err = e as any;
      return page(res, 'auth/signin', req, {
        pageTitle: 'Sign in',
        error: err.message,
        values: { identifier },
        next: nextUrl,
        firebase: firebaseAuth.publicConfig(),
        invited: false,
      }, err.status === 429 ? 429 : 401);
    }
  });

  /**
   * Firebase ID-token exchange for Global mode. The browser gets a real ID
   * token from Firebase Auth; this endpoint verifies it with the admin SDK and
   * then issues Hackerly's own session, so authorization stays server-side.
   */
  r.post('/auth/firebase', limitAuth, async (req, res, next) => {
    const token = String((req.body as any)?.idToken ?? '');
    if (!token) return next(badRequest('No identity token was provided.', 'no_token'));
    const claims = await firebaseAuth.verifyIdToken(token);
    if (!claims) return next(unauthorized('That identity token could not be verified.', 'bad_token'));
    const { user, created } = await linkFirebaseUser(claims.uid, {
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      emailVerified: claims.email_verified,
    });
    const session = await createSession(user.id, { ua: req.get('user-agent') ?? '', ip: ipOf(req), label: 'firebase' });
    res.cookie(config.session.cookieName, session.token, sessionCookie());
    res.json({ ok: true, created, username: user.username, redirect: created ? '/settings/profile?welcome=1' : '/dashboard' });
  });

  r.post('/auth/logout', requireAuth, async (req, res) => {
    if (req.sessionId) await destroySession(req.sessionId).catch(() => undefined);
    res.clearCookie(config.session.cookieName, clearedSessionCookie());
    res.redirect(303, '/');
  });

  r.get('/auth/switch', requireAuth, async (req, res) => {
    const target = strParam(req.query.to, 200);
    const allowed: string[] = ['/dashboard', '/host', '/judge', '/host/events', '/judge/reviews', '/settings/profile'];
    res.redirect(303, allowed.includes(target) ? target : '/dashboard');
  });

  return wrapRouter(r);
}

/** Only same-origin, path-only redirects. Never an absolute URL from the body. */
function safeNext(value: unknown, fallback: string): string {
  const v = String(value ?? '').trim();
  if (!v) return fallback;
  if (!v.startsWith('/') || v.startsWith('//')) return fallback;
  if (v.includes('\\') || /[\x00-\x1f\x7f]/.test(v)) return fallback;
  return v;
}

export { safeNext, conflict, db, config };
