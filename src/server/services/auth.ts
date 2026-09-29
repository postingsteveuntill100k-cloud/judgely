import { db } from '../db/index.js';
import { id, nowIso, isoPlusDays, secret, sha256, EMAIL_RE, normalizeUsername, USERNAME_RE } from '../lib/ids.js';
import { hashPassword, parseSessionToken, signSessionToken, verifyPassword, passwordProblems, randomAvatarSeed } from '../lib/crypto.js';
import { config } from '../config.js';
import { AppError, badRequest, conflict, forbidden, unauthorized } from '../lib/errors.js';
import { log } from '../lib/logger.js';

export interface Actor {
  id: string;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  avatarSeed: number;
  platformRole: string;
  onboarded: boolean;
  sessionId?: string;
}

export function toActor(u: any, sessionId?: string): Actor | null {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    email: u.email,
    avatarUrl: u.avatar_url,
    avatarSeed: u.avatar_seed,
    platformRole: u.platform_role,
    onboarded: Boolean(u.onboarded),
    sessionId,
  };
}

export interface NewUser {
  email: string;
  username: string;
  displayName: string;
  password?: string;
  authProvider?: string;
  firebaseUid?: string;
  emailVerified?: boolean;
  avatarSeed?: number;
}

/** Single place where a user row is created, so uniqueness rules cannot drift. */
export async function createUser(input: NewUser): Promise<any> {
  const d = db();
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw badRequest('That email address does not look right.', 'bad_email', { field: 'email' });

  const username = normalizeUsername(input.username);
  if (!USERNAME_RE.test(username)) {
    throw badRequest(
      'Usernames start with a letter, then 2-23 letters, numbers, underscores or hyphens.',
      'bad_username',
      { field: 'username' },
    );
  }

  if (await d.getUserByEmail(email)) {
    throw conflict('An account already uses that email address. Sign in instead.', 'email_taken');
  }
  if (await d.getUserByUsername(username)) {
    throw conflict('That username is taken. Try another one.', 'username_taken');
  }

  const at = nowIso();
  const user = {
    id: id('usr'),
    email,
    email_lower: email,
    username,
    username_lower: username,
    display_name: input.displayName?.trim() || username,
    bio: '',
    headline: '',
    location: '',
    avatar_url: '',
    avatar_seed: input.avatarSeed ?? randomAvatarSeed(username),
    website_url: '',
    github_url: '',
    linkedin_url: '',
    password_hash: input.password ? hashPassword(input.password) : null,
    auth_provider: input.authProvider ?? 'local',
    firebase_uid: input.firebaseUid ?? null,
    platform_role: 'user',
    email_verified: input.emailVerified ? 1 : 0,
    disabled: 0,
    onboarded: 0,
    created_at: at,
    updated_at: at,
  };
  return d.createUser(user);
}

export async function createSession(userId: string, meta: { ua?: string; ip?: string; label?: string } = {}): Promise<{ token: string; expiresAt: string }> {
  const d = db();
  const token = secret(32);
  const at = nowIso();
  const expiresAt = isoPlusDays(config.session.ttlDays);
  await d.createSession({
    id: id('ses'),
    user_id: userId,
    token_hash: sha256(token),
    label: meta.label ?? '',
    user_agent: (meta.ua ?? '').slice(0, 240),
    ip: meta.ip ?? '',
    created_at: at,
    last_seen_at: at,
    expires_at: expiresAt,
  });
  return { token: signSessionToken(token), expiresAt };
}

export async function resolveSession(signedToken: string | undefined | null): Promise<{ user: any; sessionId: string } | null> {
  const token = parseSessionToken(signedToken);
  if (!token) return null;
  const d = db();
  const session = await d.getSessionByTokenHash(sha256(token));
  if (!session) return null;
  if (session.expires_at < nowIso()) {
    await d.deleteSession(session.id);
    return null;
  }
  const user = await d.getUserById(session.user_id);
  if (!user || user.disabled) return null;
  return { user, sessionId: session.id };
}

export async function destroySession(sessionId: string): Promise<void> {
  await db().deleteSession(sessionId);
}

export async function destroyAllSessions(userId: string): Promise<void> {
  await db().deleteSessionsForUser(userId);
}

export interface LoginResult {
  token: string;
  user: any;
  expiresAt: string;
}

export async function login(identifier: string, password: string, meta: { ua?: string; ip?: string } = {}): Promise<LoginResult> {
  const d = db();
  const key = identifier.trim().toLowerCase();
  const at = nowIso();
  const failures = await d.countRecentLoginFailures(key, new Date(Date.now() - 15 * 60_000).toISOString());
  if (failures >= 10) {
    throw new AppError(429, 'too_many_attempts', 'Too many failed sign-in attempts. Try again in 15 minutes.');
  }

  const user = key.includes('@') ? await d.getUserByEmail(key) : await d.getUserByUsername(normalizeUsername(key));
  const ok = Boolean(user && user.password_hash && verifyPassword(password, user.password_hash));

  await d.recordLoginAttempt({ id: id('lat'), identifier: key, ip: meta.ip ?? '', ok: ok ? 1 : 0, created_at: at });
  if (!ok) {
    log.warn('sign-in failed', { identifier: key, ip: meta.ip });
    throw unauthorized('That email or password is not right.', 'bad_credentials');
  }
  if (user.disabled) throw forbidden('This account is disabled. Contact the organizer.');

  const { token, expiresAt } = await createSession(user.id, meta);
  return { token, user, expiresAt };
}

export async function changePassword(userId: string, current: string, next: string): Promise<void> {
  const d = db();
  const user = await d.getUserById(userId);
  if (!user) throw unauthorized();
  if (!user.password_hash) throw badRequest('This account signs in with a federated provider, so it has no password to change.', 'no_password');
  if (!verifyPassword(current, user.password_hash)) throw badRequest('Your current password is not correct.', 'bad_current_password', { field: 'current_password' });
  const problems = passwordProblems(next);
  if (problems.length) throw badRequest(problems[0], 'weak_password', { field: 'new_password' });
  await d.updateUser(userId, { password_hash: hashPassword(next), updated_at: nowIso() });
  await d.deleteSessionsForUser(userId);
}

/** Firebase-backed identity for Global mode. Verifies a real ID token server-side. */
export async function linkFirebaseUser(
  firebaseUid: string,
  claims: { email?: string; name?: string; picture?: string; emailVerified?: boolean },
): Promise<{ user: any; created: boolean }> {
  const d = db();
  const existing = await d.getUserByFirebaseUid(firebaseUid);
  if (existing) return { user: existing, created: false };

  const email = (claims.email ?? '').toLowerCase();
  if (!email) throw badRequest('Your Google account did not share an email address.', 'no_email');
  const byEmail = await d.getUserByEmail(email);
  if (byEmail) {
    await d.updateUser(byEmail.id, {
      firebase_uid: firebaseUid,
      auth_provider: 'firebase',
      email_verified: claims.emailVerified ? 1 : byEmail.email_verified,
      updated_at: nowIso(),
    });
    return { user: await d.getUserById(byEmail.id), created: false };
  }

  const base = (claims.name ?? email.split('@')[0] ?? 'builder').toLowerCase();
  let username = normalizeUsername(base).replace(/[^a-z0-9_-]/g, '') || 'builder';
  if (!/^[a-z]/.test(username)) username = `h${username}`;
  username = username.slice(0, 24);
  let n = 0;
  while (await d.getUserByUsername(username)) {
    n += 1;
    username = `${base.replace(/[^a-z0-9_-]/g, '').slice(0, 18)}${n}`;
  }
  const user = await createUser({
    email,
    username,
    displayName: claims.name ?? username,
    authProvider: 'firebase',
    firebaseUid,
    emailVerified: Boolean(claims.emailVerified),
  });
  return { user, created: true };
}

/** Attributes for the session cookie. The token itself is the cookie value. */
export function sessionCookie() {
  return {
    maxAge: config.session.ttlDays * 86400,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.session.secure,
    path: '/',
  };
}

/** Attributes for clearing the session cookie. */
export function clearedSessionCookie() {
  return {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.session.secure,
    path: '/',
  };
}
