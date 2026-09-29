/**
 * Runtime configuration.
 *
 * Everything is environment driven. The defaults describe a self-hosted,
 * offline-capable install (SQLite, local auth, no cloud calls). Firebase is
 * opt-in and only used when FIREBASE_PROJECT_ID is set.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(new URL('../../', import.meta.url).pathname);

function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}
function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Minimal .env loader so `docker compose up` and local runs behave the same. */
function loadDotEnv(): void {
  const file = env('ENV_FILE', path.join(ROOT, '.env'));
  if (!existsSync(file)) return;
  const raw = readFileSync(file, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadDotEnv();

const nodeEnv = env('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

/**
 * Session signing secret. Persisted to data/.secret so that a restart does not
 * invalidate every session in a self-hosted install. In production the
 * SESSION_SECRET env var is required.
 */
function resolveSecret(): string {
  const fromEnv = env('SESSION_SECRET');
  if (fromEnv) return fromEnv;
  if (isProd) {
    throw new Error(
      'SESSION_SECRET is required in production. Generate one with: openssl rand -hex 32',
    );
  }
  const dir = env('DATA_DIR', path.join(ROOT, 'data'));
  const file = path.join(dir, '.secret');
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(file)) return readFileSync(file, 'utf8').trim();
    const s = crypto.randomBytes(32).toString('hex');
    writeFileSync(file, s, { mode: 0o600 });
    return s;
  } catch {
    return crypto.randomBytes(32).toString('hex');
  }
}

const dataDir = path.resolve(env('DATA_DIR', path.join(ROOT, 'data')));
const dbDriver = env('DB_DRIVER', 'sqlite');
const port = envInt('PORT', 8080);

export const config = {
  root: ROOT,
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',
  port,
  host: env('HOST', '0.0.0.0'),
  baseUrl: env('BASE_URL', `http://localhost:${port}`),
  appName: 'Hackerly',
  tagline: 'Find a hackathon. Host your event. Invite your judges.',

  dataDir,
  db: {
    driver: dbDriver as 'sqlite' | 'firestore',
    sqliteFile: path.resolve(env('SQLITE_FILE', path.join(dataDir, 'hackerly.db'))),
  },

  session: {
    cookieName: env('SESSION_COOKIE', 'hkl_session'),
    secret: resolveSecret(),
    ttlDays: envInt('SESSION_TTL_DAYS', 30),
    secure: envBool('SESSION_SECURE', isProd),
  },

  security: {
    // Enabled in production and when explicitly requested. Keep the dev server
    // usable over plain http on localhost.
    csrf: envBool('CSRF_PROTECT', isProd),
    trustProxy: envBool('TRUST_PROXY', isProd),
    rateLimit: envBool('RATE_LIMIT', !envBool('RATE_LIMIT_OFF', false)),
    maxBodyBytes: envInt('MAX_BODY_BYTES', 512 * 1024),
  },

  registration: {
    open: envBool('REGISTRATION_OPEN', true),
  },

  firebase: {
    projectId: env('FIREBASE_PROJECT_ID', ''),
    clientEmail: env('FIREBASE_CLIENT_EMAIL', ''),
    privateKey: env('FIREBASE_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
    webApiKey: env('FIREBASE_WEB_API_KEY', ''),
    authDomain: env('FIREBASE_AUTH_DOMAIN', ''),
    authProjectId: env('FIREBASE_AUTH_PROJECT_ID', ''),
    authApiKey: env('FIREBASE_AUTH_API_KEY', ''),
    serviceAccountFile: env('GOOGLE_APPLICATION_CREDENTIALS', ''),
    get configured(): boolean {
      return Boolean(this.projectId && this.clientEmail && this.privateKey);
    },
  },

  mail: {
    // 'log'   -> invitations are written to data/outbox and shown in the host UI
    // 'smtp'  -> real delivery through SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS
    mode: env('MAIL_MODE', 'log') as 'log' | 'smtp',
    from: env('MAIL_FROM', 'Hackerly <no-reply@hackerly.local>'),
    smtpHost: env('SMTP_HOST', ''),
    smtpPort: envInt('SMTP_PORT', 587),
    smtpUser: env('SMTP_USER', ''),
    smtpPass: env('SMTP_PASS', ''),
  },

  /**
   * Deterministic acceptance accounts for the DOGFOOD checker. These are real
   * users with real sessions; only their tokens are fixed so that
   * .dogfood.toml keeps working across restarts. Disabled in production unless
   * explicitly switched on.
   */
  acceptance: {
    enabled: envBool('ACCEPTANCE_ACCOUNTS', !isProd),
  },

  seed: {
    onBoot: envBool('SEED_ON_BOOT', true),
    demo: envBool('SEED_DEMO', true),
    fixtures: envBool('SEED_FIXTURES', true),
    fixturesFile: path.resolve(env('FIXTURES_FILE', path.join(ROOT, 'fixtures.json'))),
  },

  log: {
    level: env('LOG_LEVEL', isProd ? 'info' : 'info'),
    json: envBool('LOG_JSON', isProd),
  },

  cache: {
    ttlSeconds: envInt('CACHE_TTL', 30),
    enabled: envBool('CACHE_ENABLED', true),
  },
} as const;

export type Config = typeof config;
