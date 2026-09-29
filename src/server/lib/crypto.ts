import crypto from 'node:crypto';
import { config } from '../config.js';

const KEYLEN = 64;

interface StoredHash {
  algo: string;
  salt: string;
  hash: string;
}

/** scrypt via node:crypto. No native dependency, works offline, in Docker, anywhere. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password.normalize('NFKC'), salt, KEYLEN, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  const stored: StoredHash = { algo: 'scrypt', salt: salt.toString('base64'), hash: derived.toString('base64') };
  return `scrypt$${stored.salt}$${stored.hash}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'base64');
  const expected = Buffer.from(parts[2], 'base64');
  let derived: Buffer;
  try {
    derived = crypto.scryptSync(password.normalize('NFKC'), salt, expected.length, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export function passwordProblems(password: string): string[] {
  const out: string[] = [];
  if (password.length < 10) out.push('Use at least 10 characters.');
  if (password.length > 200) out.push('That is longer than 200 characters.');
  if (!/[a-zA-Z]/.test(password)) out.push('Include at least one letter.');
  if (!/[0-9]/.test(password)) out.push('Include at least one number.');
  return out;
}

/** Session cookie: opaque random id, signed so a tampered value is rejected early. */
export function signSessionToken(token: string): string {
  const mac = crypto.createHmac('sha256', config.session.secret).update(token).digest('base64url');
  return `${token}.${mac}`;
}

/**
 * The DOGFOOD acceptance suite attaches a fixed header instead of logging in.
 * These accounts get tokens signed with a fixed key so `.dogfood.toml` keeps
 * working across restarts and fresh clones. They are real users with real rows
 * and real reviews; only the token is predictable, and only when
 * ACCEPTANCE_ACCOUNTS is on (which it is not in production by default).
 */
export const ACCEPTANCE_SECRET = 'hackerly-dogfood-acceptance-v1';

export function signAcceptanceToken(token: string): string {
  const mac = crypto.createHmac('sha256', ACCEPTANCE_SECRET).update(token).digest('base64url');
  return `${token}.${mac}`;
}

function verifyMac(token: string, mac: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(token).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function parseSessionToken(signed: string | undefined | null): string | null {
  if (!signed) return null;
  const idx = signed.lastIndexOf('.');
  if (idx <= 0) return null;
  const token = signed.slice(0, idx);
  const mac = signed.slice(idx + 1);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return null;
  if (verifyMac(token, mac, config.session.secret)) return token;
  if (config.acceptance.enabled && verifyMac(token, mac, ACCEPTANCE_SECRET)) return token;
  return null;
}

export function randomAvatarSeed(input: string): number {
  const h = crypto.createHash('sha1').update(input).digest();
  return h.readUInt32BE(0) % 360;
}
