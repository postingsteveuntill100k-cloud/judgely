import crypto from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, URL-safe, sortable-enough identifier. */
export function id(prefix: string): string {
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

/** Opaque high-entropy secret (session tokens, invitation tokens). */
export function secret(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function isoPlusDays(days: number): string {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

export function isoPlusHours(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Stable, readable slug. Never returns an empty string. */
export function slugify(input: string, fallback = 'item'): string {
  const base = (input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

/**
 * Usernames are shown to strangers, so keep them readable and unambiguous.
 * 3-24 chars, letters/digits/underscore/hyphen, must start with a letter.
 */
export function normalizeUsername(input: string): string {
  return (input || '').trim().replace(/^@+/, '').toLowerCase();
}

export const USERNAME_RE = /^[a-z][a-z0-9_-]{2,23}$/;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
