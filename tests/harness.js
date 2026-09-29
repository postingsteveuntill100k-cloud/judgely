/**
 * In-process test harness.
 *
 * Boots the real application — real schema, real seed, real HTTP — inside the
 * test process. No child process, no log scraping: the acceptance accounts are
 * read from the seed module that created them.
 *
 * Set HACKERLY_TEST_KEEP=1 to leave the temporary database in place.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.TEST_PORT || 8137);
export const BASE = `http://127.0.0.1:${PORT}`;

let state = null;

export async function boot() {
  if (state) return state;
  const dir = mkdtempSync(path.join(tmpdir(), 'hackerly-test-'));

  // The config module reads the environment at import time, so set it first.
  process.env.NODE_ENV = 'test';
  process.env.PORT = String(PORT);
  process.env.DATA_DIR = dir;
  process.env.SQLITE_FILE = path.join(dir, 'test.db');
  process.env.FIXTURES_FILE = path.join(ROOT, 'fixtures.json');
  process.env.ACCEPTANCE_ACCOUNTS = 'true';
  process.env.SESSION_SECRET = 'test-only-secret-0123456789abcdefghijklmn';
  process.env.SEED_ON_BOOT = 'true';
  process.env.SEED_DEMO = 'true';
  process.env.SEED_FIXTURES = 'true';
  process.env.MAIL_MODE = 'log';
  process.env.LOG_LEVEL = 'warn';

  const { getDb, closeDb } = await import(path.join(ROOT, 'dist/server/db/index.js'));
  const { runSeed, acceptanceHeaders } = await import(path.join(ROOT, 'dist/server/seed/index.js'));
  const { createApp } = await import(path.join(ROOT, 'dist/server/app.js'));

  await getDb();
  await runSeed({ demo: true, fixtures: true });

  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(PORT, '127.0.0.1', () => resolve(s));
  });

  const headers = {};
  for (const h of acceptanceHeaders()) headers[h.role] = h.header;

  state = { dir, server, closeDb, headers };
  return state;
}

export async function shutdown() {
  if (!state) return;
  await new Promise((resolve) => state.server.close(resolve));
  try { await state.closeDb(); } catch { /* already closed */ }
  if (process.env.HACKERLY_TEST_KEEP !== '1' && existsSync(state.dir)) {
    rmSync(state.dir, { recursive: true, force: true });
  }
  state = null;
}

export function cookie(role) {
  return cookieFor(role);
}

function cookieFor(role) {
  if (!state) throw new Error('boot() must be awaited first');
  const header = state.headers[role];
  if (!header) throw new Error(`no acceptance account for ${role}`);
  // The seed prints "Cookie: name=value" for the acceptance report; the fetch
  // API wants the bare cookie pair.
  return header.replace(/^Cookie:\s*/i, '');
}

export async function req(pathname, { method = 'GET', as, cookie, body, form, redirect = 'manual' } = {}) {
  as = as ?? cookie;
  const headers = {};
  if (as) headers.Cookie = cookieFor(as);
  let payload = body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(BASE + pathname, { method, headers, body: payload, redirect });
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* html or csv */ }
  return { status: res.status, text, body: parsed, headers: res.headers };
}

/** Pull a CSRF token out of a rendered page. */
export function csrfFrom(html) {
  const m = html.match(/name="_csrf" value="([^"]+)"/);
  return m ? m[1] : '';
}
