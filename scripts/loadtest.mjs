/**
 * Load test.
 *
 * Drives the running server the way real traffic would: a mix of anonymous
 * readers on the public pages and signed-in readers on the workspace pages,
 * issued at a target concurrency. Nothing here writes, so it is safe to point
 * at a demo instance.
 *
 *   node scripts/loadtest.mjs [baseUrl] [seconds] [concurrency]
 *
 * Numbers are printed as measured. The script never prints a target it did not
 * reach, and never rounds a failure into a pass.
 */
import { createHmac } from 'node:crypto';

const BASE = process.argv[2] || 'http://localhost:8090';
const SECONDS = Number(process.argv[3] || 20);
const CONCURRENCY = Number(process.argv[4] || 16);
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ACCEPTANCE_SECRET = process.env.ACCEPTANCE_SECRET || '';
const TOKEN = process.env.ACCEPTANCE_TOKEN || 'dogfood_participant_token_v1';
const COOKIE_NAME = process.env.SESSION_COOKIE || 'hkl_session';

// The acceptance session token is `<seed>.<hmac(secret, seed)>`, exactly as the
// server signs it. If the secret is not in the environment the signed-in half of
// the mix is skipped rather than faked.
const cookie = ACCEPTANCE_SECRET
  ? `${TOKEN}.${createHmac('sha256', ACCEPTANCE_SECRET).update(TOKEN).digest('base64url')}`
  : null;

/**
 * The public surface as an anonymous visitor sees it, weighted towards what
 * people actually read: listings, an event page, a project, results.
 */
const ANON = [
  '/', '/hackathons', '/projects', '/hackathons/hacktron-2026',
  '/hackathons/fold-2026-spring', '/hackathons/fold-2026-spring/results',
  '/hackathons/fold-2026-spring/projects', '/about', '/api/v1/events', '/healthz',
];

/** The signed-in surface: a dashboard, a team, a project, a submission form. */
const AUTHED = [
  '/dashboard', '/teams', '/u/meera', '/judge/events', '/host/events',
  '/hackathons/hacktron-2026/register',
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
const ms = (v) => (v >= 1000 ? (v / 1000).toFixed(2) + 's' : Math.round(v) + 'ms');

class Counter {
  constructor() { this.latencies = []; this.okLatencies = []; this.statuses = new Map(); this.errors = []; this.bytes = 0; }
  /** `ms` is wall time in milliseconds, as performance.now() reports it. */
  record(status, ms, size) {
    this.latencies.push(ms);
    if (status < 400) this.okLatencies.push(ms);
    this.statuses.set(status, (this.statuses.get(status) ?? 0) + 1);
    this.bytes += size;
  }
}

const total = new Counter();
const byPath = new Map();
const deadline = Date.now() + SECONDS * 1000;
let issued = 0;

async function worker(n) {
  const c = new Counter();
  const own = new Map();
  let i = n;
  while (Date.now() < deadline) {
    // 70% anonymous browsing, 30% signed-in workspace pages.
    const authed = cookie && (i % 10 < 3);
    const pool = authed ? AUTHED : ANON;
    const path = pool[i % pool.length];
    i += 1;
    const headers = authed ? { cookie: `${COOKIE_NAME}=${cookie}` } : {};
    const t0 = performance.now();
    try {
      const res = await fetch(BASE + path, { headers, redirect: 'manual' });
      const body = await res.text();
      const dt = performance.now() - t0;
      c.record(res.status, dt, body.length);
      total.record(res.status, dt, body.length);
      issued += 1;
      if (!own.has(path)) own.set(path, []);
      own.get(path).push(dt);
    } catch (e) {
      c.errors.push(String(e.message ?? e));
      total.errors.push(`${path}: ${e.message ?? e}`);
      issued += 1;
    }
  }
  for (const [p, arr] of own) {
    if (!byPath.has(p)) byPath.set(p, []);
    byPath.get(p).push(...arr);
  }
  return c;
}

console.log(`load: ${SECONDS}s at concurrency ${CONCURRENCY} against ${BASE}`);
if (!cookie) console.log('note: no ACCEPTANCE_SECRET in the environment, so only the anonymous mix is measured');

const started = Date.now();
const results = await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => worker(n)));
const wall = (Date.now() - started) / 1000;

const sorted = [...total.okLatencies].sort((a, b) => a - b);
const all = [...total.latencies].sort((a, b) => a - b);
const throttled = total.statuses.get(429) ?? 0;
const serverErrors = [...total.statuses].filter(([s]) => s >= 500).reduce((a, [, n]) => a + n, 0);
const clientErrors = [...total.statuses].filter(([s]) => s >= 400 && s < 500 && s !== 429).reduce((a, [, n]) => a + n, 0);
const okCount = total.okLatencies.length;
const rps = issued / wall;

console.log(`\nrequests        ${issued} in ${wall.toFixed(1)}s`);
console.log(`throughput      ${rps.toFixed(1)} req/s offered`);
console.log(`served 2xx/3xx  ${okCount} (${((okCount / issued) * 100).toFixed(1)}%)`);
console.log(`latency p50     ${ms(pct(sorted, 50))}   (served requests)`);
console.log(`latency p90     ${ms(pct(sorted, 90))}`);
console.log(`latency p99     ${ms(pct(sorted, 99))}`);
console.log(`slowest         ${ms(all[all.length - 1] ?? 0)}`);
console.log(`transferred     ${(total.bytes / 1048576).toFixed(1)} MiB`);
console.log(`statuses        ${[...total.statuses].sort().map(([s, n]) => `${s}×${n}`).join('  ')}`);
console.log(`5xx             ${serverErrors}`);
console.log(`4xx (not 429)   ${clientErrors}`);
console.log(`429 throttled   ${throttled}${throttled ? '  — the per-IP read budget, working as designed' : ''}`);
console.log(`transport       ${total.errors.length ? `${total.errors.length} error(s): ${[...new Set(total.errors)].slice(0, 3).join('; ')}` : 'none'}`);

console.log('\nper path (p50 / p99)');
for (const [p, arr] of [...byPath].sort()) {
  const s = arr.sort((a, b) => a - b);
  console.log(`  ${p.padEnd(44)} ${ms(pct(s, 50)).padStart(7)} ${ms(pct(s, 99)).padStart(7)}  (${s.length})`);
}

const bad = serverErrors > 0 || total.errors.length > 0;
console.log(bad
  ? '\nload run finished with failures'
  : '\nload run finished, no 5xx and no transport errors');
process.exit(bad ? 1 : 0);
