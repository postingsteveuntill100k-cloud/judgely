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

const INSECURE_SECRETS = new Set([
  'change-me-this-is-not-a-secret',
  'secret',
  'keyboard cat',
  'session-secret',
  'default',
  'password',
  '1234567890',
  'test',
]);

/**
 * Session signing secret. Persisted to data/.secret so that a restart does not
 * invalidate every session in a self-hosted install. In production the
 * SESSION_SECRET env var is required and must not be a weak placeholder.
 */
function resolveSecret(): string {
  const fromEnv = env('SESSION_SECRET');
  if (isProd) {
    if (!fromEnv) {
      throw new Error(
        'SESSION_SECRET is required in production. Generate one with: openssl rand -hex 32',
      );
    }
    if (fromEnv.length < 32) {
      throw new Error(
        'SESSION_SECRET must be at least 32 characters in production.',
      );
    }
    if (INSECURE_SECRETS.has(fromEnv.toLowerCase()) || fromEnv.includes('change-me')) {
      throw new Error(
        'SESSION_SECRET cannot be a known default or placeholder in production. Generate a secure secret with: openssl rand -hex 32',
      );
    }
    return fromEnv;
  }
  if (fromEnv) return fromEnv;
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

function resolveAcceptance(): boolean {
  const enabled = envBool('ACCEPTANCE_ACCOUNTS', !isProd);
  if (isProd && enabled) {
    throw new Error(
      'ACCEPTANCE_ACCOUNTS cannot be enabled in production. This setting is strictly for local/testing environments.',
    );
  }
  return enabled;
}

function resolveSeed(): { onBoot: boolean; demo: boolean; fixtures: boolean; fixturesFile: string } {
  const onBoot = envBool('SEED_ON_BOOT', !isProd);
  const demo = envBool('SEED_DEMO', !isProd);
  const fixtures = envBool('SEED_FIXTURES', !isProd);
  if (isProd && (onBoot || demo) && !envBool('ALLOW_PRODUCTION_SEED', false)) {
    throw new Error(
      'Database auto-seeding is disabled in production to protect real data. Set ALLOW_PRODUCTION_SEED=true only if you explicitly intend to seed a fresh production database.',
    );
  }
  return {
    onBoot,
    demo,
    fixtures,
    fixturesFile: path.resolve(env('FIXTURES_FILE', path.join(ROOT, 'fixtures.json'))),
  };
}

const dataDir = path.resolve(env('DATA_DIR', path.join(ROOT, 'data')));
const dbDriver = env('DB_DRIVER', 'sqlite');
const port = envInt('PORT', 8080);

if (isProd && dbDriver === 'firestore' && (!env('FIREBASE_PROJECT_ID') || !env('FIREBASE_CLIENT_EMAIL') || !env('FIREBASE_PRIVATE_KEY'))) {
  throw new Error(
    'DB_DRIVER=firestore in production requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY to be set.',
  );
}

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

  acceptance: {
    enabled: resolveAcceptance(),
  },

  seed: resolveSeed(),

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

export function validateProductionConfig(opts: {
  env?: string;
  security?: { sessionSecret?: string };
  auth?: { acceptanceAccounts?: boolean };
  seed?: { onBoot?: boolean; demo?: boolean; allowProductionSeed?: boolean };
  dbDriver?: string;
  firebase?: { projectId?: string; clientEmail?: string; privateKey?: string };
}): void {
  const isP = opts.env === 'production';
  if (!isP) return;

  const secret = opts.security?.sessionSecret;
  if (!secret) {
    throw new Error('SESSION_SECRET is required in production.');
  }
  if (secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }
  if (INSECURE_SECRETS.has(secret.toLowerCase()) || secret.includes('change-me')) {
    throw new Error('SESSION_SECRET cannot be a known default or placeholder in production. Generate a secure secret with: openssl rand -hex 32');
  }

  if (opts.auth?.acceptanceAccounts) {
    throw new Error('ACCEPTANCE_ACCOUNTS must be false in production. This setting is strictly for local/testing environments.');
  }

  if (opts.seed?.onBoot && !opts.seed?.allowProductionSeed) {
    throw new Error('SEED_ON_BOOT must be false in production to protect real data.');
  }
}

