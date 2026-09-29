import { tooMany } from './errors.js';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let sweepAt = Date.now() + 60_000;

function sweep(now: number): void {
  if (now < sweepAt) return;
  sweepAt = now + 60_000;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  if (buckets.size > 20000) buckets.clear();
}

export interface LimitOptions {
  limit: number;
  windowMs: number;
  message?: string;
  code?: string;
}

export function hit(key: string, opts: LimitOptions): void {
  if (!opts.limit || opts.limit <= 0) return;
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return;
  }
  b.count += 1;
  if (b.count > opts.limit) {
    const seconds = Math.ceil((b.resetAt - now) / 1000);
    throw tooMany(
      opts.message ?? `Too many attempts. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`,
      opts.code ?? 'rate_limited',
    );
  }
}

export function peek(key: string): { count: number; resetAt: number } | undefined {
  return buckets.get(key);
}

export function reset(key: string): void {
  buckets.delete(key);
}

export function resetAll(): void {
  buckets.clear();
}

/** Named budgets so the limits live in one readable place. */
const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export const limits = {
  login: (ip: string, key: string) => hit(`login:${ip}:${key}`, { limit: 10, windowMs: 10 * 60_000, message: 'Too many sign-in attempts for this account. Try again in a few minutes.' }),
  signup: (ip: string) => hit(`signup:${ip}`, { limit: 8, windowMs: 60 * 60_000, message: 'Too many accounts created from this network. Try again later.' }),
  write: (userId: string) => hit(`write:${userId}`, { limit: 240, windowMs: 60_000, message: 'You are going faster than the page can save. Slow down a moment.' }),
  submit: (userId: string) => hit(`submit:${userId}`, { limit: 30, windowMs: 60_000 }),
  review: (userId: string) => hit(`review:${userId}`, { limit: 120, windowMs: 60_000 }),
  /**
   * Anonymous page reads are budgeted per IP, and a hackathon venue puts a few
   * hundred people behind one NAT address, so the ceiling has to leave room for
   * a whole room. It is a runaway guard against scraping, not a fairness
   * mechanism — signed-in users are on the per-user write budget instead.
   * Raise it with PUBLIC_READ_LIMIT for a bigger venue, lower it if the
   * instance is on a shared host.
   */
  publicRead: (ip: string) => hit(`read:${ip}`, {
    limit: num(process.env.PUBLIC_READ_LIMIT, 3000),
    windowMs: num(process.env.PUBLIC_READ_WINDOW_MS, 60_000),
  }),
  auth: (ip: string) => hit(`auth:${ip}`, { limit: 30, windowMs: 5 * 60_000, message: 'Too many requests. Wait a moment and try again.' }),
  invite: (userId: string) => hit(`invite:${userId}`, { limit: 20, windowMs: 60 * 60_000, message: 'Too many invitations sent. Try again later.' }),
};
