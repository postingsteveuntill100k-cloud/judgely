/**
 * Hackerly critic harness.
 *
 * Drives the real application in a real browser: navigates, clicks, fills
 * forms, checks the database afterwards, captures screenshots at several
 * viewports, and reports console errors, failed requests, HTTP errors and
 * layout overflow.
 *
 *   node scripts/critic.mjs sweeps          # every public route, 5 viewports
 *   node scripts/critic.mjs workspaces      # organizer, judge and participant
 *   node scripts/critic.mjs journeys        # the three user journeys
 *   node scripts/critic.mjs security        # the attack pass
 *   node scripts/critic.mjs all
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8090';
const SHOTS = process.env.SHOT_DIR || '/tmp/opencode/shots';
const CHROME = process.env.CHROME_PATH || '/opt/google/chrome/chrome';

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '390x844', width: 390, height: 844, mobile: true },
];

const report = { base: BASE, when: new Date().toISOString(), routes: [], journeys: [], security: [], problems: [] };

function note(kind, detail) {
  report.problems.push({ kind, ...detail });
}

async function launch() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--font-render-hinting=none'],
  });
}

/** Collect everything a human would notice, plus everything a machine should. */
function watch(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      if (text.includes('favicon')) return;
      bucket.consoleErrors.push(text.slice(0, 300));
    }
  });
  page.on('pageerror', (err) => bucket.pageErrors.push(String(err.message).slice(0, 300)));
  page.on('requestfailed', (req) => {
    if (req.url().includes('favicon')) return;
    bucket.failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && new URL(res.url()).origin === new URL(BASE).origin) {
      bucket.httpErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
}

const OVERFLOW_PROBE = `() => {
  const docW = document.documentElement.clientWidth;
  const scrollW = document.documentElement.scrollWidth;
  const out = { docW, scrollW, overflowing: [], smallTargets: [], lowContrast: [] };
  if (scrollW > docW + 2) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > docW + 2 || r.left < -2) {
        const style = getComputedStyle(el);
        if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
        out.overflowing.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 70)) || '',
          right: Math.round(r.right),
          text: (el.textContent || '').trim().slice(0, 60),
        });
      }
      if (out.overflowing.length > 8) break;
    }
  }
  for (const el of document.querySelectorAll('a, button, input, select, textarea, [role=button]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 24 && el.tagName !== 'A') {
      out.smallTargets.push({ tag: el.tagName.toLowerCase(), h: Math.round(r.height), text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40) });
    }
  }
  out.smallTargets = out.smallTargets.slice(0, 8);
  return out;
}`;

let sharedPage = null;
let sharedBrowser = null;

async function getPage(browser) {
  if (sharedPage && !sharedPage.isClosed() && sharedBrowser === browser) return sharedPage;
  const page = await browser.newPage();
  sharedPage = page;
  sharedBrowser = browser;
  return page;
}

async function visit(browser, url, { viewport = VIEWPORTS[0], shot = true, session } = {}) {
  const page = await getPage(browser);
  const bucket = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
  if (!page.__watched) {
    watch(page, bucket);
    page.__watched = true;
    page.__bucket = bucket;
  }
  const b = page.__bucket;
  await page.setViewport({ width: viewport.width, height: viewport.height, isMobile: !!viewport.mobile, hasTouch: !!viewport.mobile });
  if (session) {
    const cookies = Object.entries(session).map(([name, value]) => ({ name, value, domain: 'localhost', path: '/' }));
    await page.setCookie(...cookies);
  }
  const res = await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => ({ status: () => 0, err: e }));
  await new Promise((r) => setTimeout(r, 400));
  const status = typeof res?.status === 'function' ? res.status() : 0;
  await new Promise((r) => setTimeout(r, 250));
  const probe = await page.evaluate(OVERFLOW_PROBE).catch(() => null);
  const title = await page.title().catch(() => '');
  const h1 = await page.$eval('h1', (el) => el.textContent.trim().slice(0, 90)).catch(() => null);
  let file = null;
  if (shot) {
    mkdirSync(SHOTS, { recursive: true });
    const slug = url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
    file = path.join(SHOTS, `${slug}--${viewport.name}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  }
  const entry = {
    url, status, title, h1, viewport: viewport.name,
    consoleErrors: b.consoleErrors,
    pageErrors: b.pageErrors,
    failedRequests: b.failedRequests,
    httpErrors: b.httpErrors,
    overflow: probe ? { scrollW: probe.scrollW, docW: probe.docW, items: probe.overflowing } : null,
    smallTargets: probe ? probe.smallTargets : [],
    shot: file,
  };
  report.routes.push(entry);
  for (const e of b.pageErrors) note('page-error', { url, viewport: viewport.name, message: e });
  for (const e of b.consoleErrors) note('console-error', { url, viewport: viewport.name, message: e });
  for (const e of b.httpErrors) note('http-error', { url, viewport: viewport.name, message: e });
  process.stdout.write(`  swept ${url} [${viewport.name}] ${status}\n`);
  if (probe && probe.scrollW > probe.docW + 2) {
    note('horizontal-overflow', { url, viewport: viewport.name, scrollW: probe.scrollW, docW: probe.docW, items: probe.overflowing });
  }
  if (status >= 400) note('route-status', { url, status });
  return { page, bucket, entry };
}

const PUBLIC_ROUTES = [
  '/',
  '/hackathons',
  '/hackathons?status=open',
  '/hackathons?order=prize',
  '/projects',
  '/projects?q=quiet',
  '/hackathons/hacktron-2026',
  '/hackathons/hacktron-2026/projects',
  '/hackathons/hacktron-2026/tracks/developer-tools',
  '/hackathons/fold-2026-spring',
  '/hackathons/fold-2026-spring/results',
  '/hackathons/sample-hack-2026',
  '/hackathons/sample-hack-2026/projects',
  '/host',
  '/judge',
  '/about',
  '/auth/signin',
  '/auth/signup',
  '/api/v1',
  '/healthz',
  '/this-route-does-not-exist',
];

/**
 * The three signed-in workspaces, each in its own browser context so the roles
 * have independent cookie jars — three different people, not one person with
 * three tabs. Sign-in goes through the real form, because setting cookies by
 * hand is how a test ends up passing for a session the app would not issue.
 */
const WORKSPACE_ROLES = [
  {
    role: 'organizer',
    id: 'meera@hackerly.dev',
    pw: 'HackerlyDemo2026',
    routes: [
      '/host/events', '/host/events/hacktron-2026',
      '/host/events/hacktron-2026/setup/basics', '/host/events/hacktron-2026/setup/dates',
      '/host/events/hacktron-2026/setup/tracks', '/host/events/hacktron-2026/setup/submission',
      '/host/events/hacktron-2026/setup/judging', '/host/events/hacktron-2026/setup/rules',
      '/host/events/hacktron-2026/setup/branding', '/host/events/hacktron-2026/setup/publish',
      '/host/events/hacktron-2026/participants', '/host/events/hacktron-2026/teams',
      '/host/events/hacktron-2026/projects', '/host/events/hacktron-2026/judges',
      '/host/events/hacktron-2026/assignments', '/host/events/hacktron-2026/judging',
      '/host/events/fold-2026-spring/results', '/host/events/hacktron-2026/audit',
      '/host/events/hacktron-2026/export', '/host/events/hacktron-2026/settings',
    ],
    follow: async (page) => {
      const link = await page.$eval('a[href^="/judge/review/"]', (a) => a.getAttribute('href')).catch(() => null);
      return link ? [link] : [];
    },
  },
  {
    role: 'judge',
    id: 'priya.nair@example.org',
    pw: 'SamplePass2026',
    routes: ['/judge/events', '/judge/reviews', '/judge/events/sample-hack-2026'],
    follow: async (page) => {
      await page.goto(`${BASE}/judge/events/sample-hack-2026`, { waitUntil: 'domcontentloaded' });
      const link = await page.$eval('a[href^="/judge/review/"]', (a) => a.getAttribute('href')).catch(() => null);
      if (!link) return [];
      const extra = await page.evaluate(async (href) => {
        const html = await fetch(href).then((r) => r.text());
        const m = html.match(/href="([^"]*\/compare[^"]*)"/);
        return m ? [m[1]] : [];
      }, link).catch(() => []);
      return [link, ...extra];
    },
  },
  {
    role: 'participant',
    id: 'participant@hackerly.test',
    pw: 'HackerlyDemo2026',
    routes: ['/dashboard', '/teams', '/hackathons/hacktron-2026/register'],
    follow: async (page) => {
      // The link lives on the team list, so go there first rather than
      // assuming whatever page the route loop happened to end on has it.
      await page.goto(`${BASE}/teams`, { waitUntil: 'domcontentloaded' });
      const link = await page.$eval('a[href^="/teams/"]', (a) => a.getAttribute('href')).catch(() => null);
      if (!link) return [];
      const extra = await page.evaluate(async (href) => {
        const html = await fetch(href).then((r) => r.text());
        const m = html.match(/href="(\/teams\/tm_[a-z0-9]+\/project\/[a-z0-9-]+)"/);
        return m ? [m[1]] : [];
      }, link).catch(() => []);
      return [link, ...extra];
    },
  },
];

async function workspaces() {
  const browser = await launch();
  try {
    for (const role of WORKSPACE_ROLES) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      const bucket = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
      watch(page, bucket);

      await page.goto(`${BASE}/auth/signin`, { waitUntil: 'domcontentloaded' });
      await page.type('#identifier', role.id);
      await page.type('#password', role.pw);
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {}),
        page.click('button[type=submit]'),
      ]);
      if (page.url().includes('/auth/signin')) {
        note('signin', { role: role.role, url: BASE + '/auth/signin' });
        report.problems.push({ kind: 'signin-failed', role: role.role, id: role.id });
        await context.close();
        continue;
      }

      for (const route of role.routes) {
        await visit(browser, route, { session: await page.cookies().then((cs) => Object.fromEntries(cs.map((c) => [c.name, c.value]))) })
          .catch(() => {});
        // visit() uses the shared page; point the shared page at this context.
        sharedPage = page;
        sharedBrowser = browser;
        page.__watched = true;
        page.__bucket = bucket;
      }
      for (const extra of await role.follow(page)) {
        sharedPage = page;
        sharedBrowser = browser;
        page.__watched = true;
        page.__bucket = bucket;
        await visit(browser, extra).catch(() => {});
      }
      // The pages where the two-column workspace and the wide tables actually
      // break, at every other viewport. The rest of the workspace is the same
      // grid and the same tables.
      const NARROW = role.routes.filter((r) => /judging|assignments|judges|results|export|audit/.test(r)).slice(0, 4);
      for (const route of NARROW) {
        for (const vp of VIEWPORTS.slice(1)) {
          sharedPage = page;
          sharedBrowser = browser;
          page.__watched = true;
          page.__bucket = bucket;
          await visit(browser, route, { viewport: vp }).catch(() => {});
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function sweeps() {
  const browser = await launch();
  try {
    for (const route of PUBLIC_ROUTES) {
      await visit(browser, route);
    }
    // Responsive pass on the pages where layout actually breaks.
    for (const route of ['/', '/hackathons', '/projects', '/hackathons/hacktron-2026', '/host', '/judge', '/auth/signin']) {
      for (const vp of VIEWPORTS.slice(1)) {
        await visit(browser, route, { viewport: vp });
      }
    }
  } finally {
    await browser.close();
  }
}

async function journeys() {
  const browser = await launch();
  const stamp = Date.now();
  const user = {
    name: 'Rivka Ostrowski',
    username: `rivka${String(stamp).slice(-6)}`,
    email: `rivka${stamp}@hackerly.test`,
    password: 'CriticPass2026!',
  };
  try {
    // ---------------- HACKER ----------------
    const page = await browser.newPage();
    const bucket = { consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
    watch(page, bucket);
    await page.setViewport({ width: 1440, height: 900 });

    await page.goto(`${BASE}/auth/signup`, { waitUntil: 'networkidle2' });
    await page.type('#display_name', user.name);
    await page.type('#username', user.username);
    await page.type('#email', user.email);
    await page.type('#password', user.password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('button[type=submit]'),
    ]);
    report.journeys.push({ step: 'signup', url: page.url(), ok: page.url().includes('/settings/profile'), errors: bucket.pageErrors });

    // Profile. Scoped to the form that actually holds these fields: a bare
    // `form button[type=submit]` matches the hidden sign-out form in the
    // header, which is not clickable and is not what we mean.
    await page.type('#headline', 'Backend engineer, mostly Postgres');
    await page.type('#bio', 'I like small tools that do one thing well. Currently exploring local-first software.');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2' }),
      page.click('form:has(#headline) button[type=submit]'),
    ]);
    report.journeys.push({ step: 'profile-save', url: page.url(), ok: page.url().includes('saved=1'), errors: bucket.pageErrors });

    // Register for the open hackathon
    await page.goto(`${BASE}/hackathons/hacktron-2026`, { waitUntil: 'networkidle2' });
    const registerLink = await page.$('a[href="/hackathons/hacktron-2026/register"]');
    report.journeys.push({ step: 'event-cta-present', ok: Boolean(registerLink) });
    if (registerLink) {
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), registerLink.click()]);
      // Tick the agreement, then press that form's own button. Clicking the
      // form element clicks its centre, which may not be the button.
      const agree = await page.$('form[action$="/register"] input[name=confirm]');
      if (agree) await agree.click();
      const submitRegister = await page.$('form[action$="/register"] button[type=submit]');
      if (submitRegister) {
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), submitRegister.click()]);
      }
      report.journeys.push({ step: 'register', url: page.url(), ok: page.url().includes('/teams'), note: 'lands on the team list, where the next step is', errors: bucket.pageErrors });
    }

    // Create a team from the team list — this is the path a real person takes
    // after registering, and it only exists if the product offers it.
    await page.goto(`${BASE}/teams`, { waitUntil: 'networkidle2' });
    const startLink = await page.$('a[href^="/teams/new/"]');
    if (!startLink) {
      report.journeys.push({ step: 'create-team', ok: false, note: 'no "start a team" entry point on /teams after registering' });
      note('missing-ui', { what: 'start-a-team entry point on /teams for a registered user with no team' });
    } else {
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), startLink.click()]);
      const nameInput = await page.$('#name');
      if (nameInput) {
        await nameInput.type('Northlight');
        const desc = await page.$('#description');
        if (desc) await desc.type('Two backend people looking for a frontend.');
        await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('form:has(#name) button[type=submit]')]);
      }
      const onTeam = /\/teams\/tm_/.test(page.url());
      report.journeys.push({ step: 'create-team', url: page.url(), ok: onTeam, note: onTeam ? '' : `expected a team page, got ${page.url()}`, errors: bucket.pageErrors });
      if (!onTeam) note('create-team-failed', { url: page.url() });
    }

    // ---------------- HOST ----------------
    await page.goto(`${BASE}/host/events/new`, { waitUntil: 'networkidle2' });
    // The mode radio is required and has to be chosen; the server refuses
    // without it, which is the correct behaviour and the reason this is here.
    const globalChoice = await page.$('input[name=mode][value=global]');
    if (globalChoice) {
      await page.evaluate(() => {
        const r = document.querySelector('input[name=mode][value=global]');
        if (r) r.checked = true;
      });
      await page.type('#name', 'Northlight Open ' + String(stamp).slice(-4));
      await page.type('#tagline', 'A weekend to build something you can demo.');
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }), page.click('#new-event button[type=submit]')]);
      report.journeys.push({ step: 'host-create', url: page.url(), ok: page.url().includes('/setup/'), errors: bucket.pageErrors });
      // Walk the wizard, but only if the create actually landed there. Building
      // URLs out of wherever the browser happened to end up is how a redirect
      // turns into a crash instead of a finding.
      const m = page.url().match(/^(.*)\/host\/events\/([a-z0-9-]+)\/setup\//);
      if (!m) {
        report.journeys.push({ step: 'wizard-walk', ok: false, note: `create did not land on a wizard URL (${page.url()})` });
        note('wizard-not-reached', { url: page.url() });
      } else {
        const root = `${m[1]}/host/events/${m[2]}`;
        const steps = ['basics', 'dates', 'prizes', 'teams', 'tracks', 'submission', 'judging', 'rules', 'branding', 'publish'];
        let bad = 0;
        for (const step of steps) {
          const res = await page.goto(`${root}/setup/${step}`, { waitUntil: 'networkidle2' });
          const status = res ? res.status() : 0;
          const title = await page.title();
          if (![200, 304].includes(status) || !title || title.startsWith('Something went wrong')) {
            bad += 1;
            note('wizard-step-failed', { step, status, title });
          }
        }
        report.journeys.push({ step: 'wizard-walk', ok: bad === 0, note: `${steps.length - bad}/${steps.length} steps ok` });
      }
    }

    await page.close();
  } finally {
    await browser.close();
  }
}

async function security() {
  // Cookie roles come from the seeded acceptance accounts.
  const { readFileSync } = await import('node:fs');
  const log = readFileSync('/tmp/opencode/hackerly.log', 'utf8');
  const defaults = {
    organizer: 'hkl_session=dogfood_organizer_token_v1.N6xkZNUxYVfjf_PO8-I57gSgbXX3mHkaZZuFn8NQ1K8',
    judge_a: 'hkl_session=dogfood_judge_a_token_v1.wCl0yQpBQ69YnRE3_C1WBbPaEdxvMrq3DE3dY_Ze13Y',
    judge_b: 'hkl_session=dogfood_judge_b_token_v1.Hnxyk2ES9DcnC-KqFBhvibm_TQ0OpsT3KiGncuarAJs',
    participant: 'hkl_session=dogfood_participant_token_v1.Dd0vUBzRTUQXmPpHKieYjOJWjO3hW_q-GdiGH6GoJGc',
  };
  const grab = (role) => {
    const m = log.match(new RegExp(`${role}\\s+Cookie:\\s+([^\\s]+)`));
    return m ? m[1] : defaults[role];
  };
  const headers = {
    organizer: grab('organizer'),
    judge_a: grab('judge_a'),
    judge_b: grab('judge_b'),
    participant: grab('participant'),
  };
  const check = async (name, url, header, expect) => {
    const res = await fetch(BASE + url, { headers: header ? { Cookie: header } : {}, redirect: 'manual' });
    const text = await res.text();
    const ok = expect.includes(res.status);
    const entry = { name, url, header: header ? header.split('=')[0] + '=…' : 'none', status: res.status, expect, ok };
    // A leak check: does a refused response still contain another judge's data?
    if (!ok || res.status === 200) {
      const leaks = ['"criteria"', 'weighted_score', 'per_judge', 'judge_email', 'password_hash', 'token_hash'];
      const found = leaks.filter((k) => text.includes(k));
      if (found.length) entry.leakIndicators = found;
    }
    report.security.push(entry);
    if (!ok) note('security-check-failed', entry);
    if (entry.leakIndicators) note('possible-leak', entry);
    return entry;
  };

  await check('gallery is public', '/projects', null, [200]);
  await check('judge sees own scores', '/api/judge/scores', headers.judge_a, [200]);
  await check('judge cannot see peer scores', '/api/judge/scores?judge=priya.nair', headers.judge_b, [401, 403]);
  await check('participant cannot read judge scores', '/api/judge/scores', headers.participant, [401, 403]);
  await check('participant cannot read any judge scores', '/api/judge/scores', headers.participant, [401, 403]);
  await check('organizer csv export', '/api/export.csv', headers.organizer, [200]);
  await check('judge cannot export', '/api/export.csv', headers.judge_a, [401, 403]);
  await check('participant cannot export', '/api/export.csv', headers.participant, [401, 403]);
  await check('anonymous cannot export', '/api/export.csv', null, [401, 403]);
  await check('unpublished results hidden', '/api/v1/events/sample-hack-2026/results', null, [404]);
  await check('cross-event export blocked', '/api/v1/events/hacktron-2026/export.csv', headers.organizer, [403]);
  await check('host area needs auth', '/host/events', null, [302, 401, 403]);
  await check('judge area needs auth', '/judge/events', null, [302, 401, 403]);
  await check('judge cannot open other host workspace', '/host/events/hacktron-2026', headers.judge_a, [403]);

  // deadline enforcement against the closed fixture event
  const submit = await fetch(`${BASE}/api/submissions`, {
    method: 'POST',
    headers: { Cookie: headers.participant, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'critic-late-submission-probe', summary: 'probe' }),
  });
  const body = await submit.text();
  const entry = { name: 'closed event refuses submissions', url: '/api/submissions', header: 'participant', status: submit.status, expect: [400, 403, 409, 422], ok: submit.status >= 400 && submit.status < 500 };
  if (entry.ok) {
    try { entry.body = JSON.parse(body).error?.message?.slice(0, 160); } catch { entry.body = body.slice(0, 160); }
  }
  report.security.push(entry);
  if (!entry.ok) note('security-check-failed', entry);

  // ID tampering: change ids in the URL and in the body
  await check('unknown assignment id', '/judge/review/asg_totallymadeup', headers.judge_a, [302, 401, 403, 404]);
  const post = async (name, url, header, payload, expect) => {
    const res = await fetch(BASE + url, { method: 'POST', headers: { Cookie: header, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const entry2 = { name, url, status: res.status, expect, ok: expect.includes(res.status) };
    report.security.push(entry2);
    if (!entry2.ok) note('security-check-failed', entry2);
  };
  await post('review with invented judge id', '/api/v1/reviews/asg_fake', headers.judge_a, { scores: [], submit: true }, [401, 403, 404]);
  await post('invented rubric criterion', '/api/v1/reviews/asg_fake', headers.judge_a, { scores: [{ criterion_id: 'cri_madeup', score: 999 }], submit: true }, [401, 403, 404]);

  writeFileSync('/tmp/opencode/security-headers.json', JSON.stringify(headers, null, 2));
}

async function main() {
  const what = process.argv[2] || 'all';
  if (what === 'sweeps' || what === 'all') await sweeps();
  if (what === 'workspaces' || what === 'all') await workspaces();
  if (what === 'journeys' || what === 'all') await journeys();
  if (what === 'security' || what === 'all') await security();
  rmSync('/tmp/opencode/critic-report.json', { force: true });
  writeFileSync('/tmp/opencode/critic-report.json', JSON.stringify(report, null, 2));
  summarise();
}

function summarise() {
  const bad = report.routes.filter((r) => r.status >= 400 || r.pageErrors.length || r.overflow?.scrollW > r.overflow?.docW + 2);
  process.stdout.write(`\n=== ROUTES: ${report.routes.length} checked, ${bad.length} with problems ===\n`);
  for (const r of bad) {
    process.stdout.write(`  ${r.status} ${r.url} [${r.viewport}]${r.overflow?.scrollW > r.overflow?.docW + 2 ? ` overflow ${r.overflow.scrollW}>${r.overflow.docW}` : ''}\n`);
    for (const e of [...r.pageErrors, ...r.consoleErrors].slice(0, 3)) process.stdout.write(`      ! ${e}\n`);
    for (const e of r.overflow?.items || []) process.stdout.write(`      > <${e.tag} class="${e.cls}"> right=${e.right} "${e.text}"\n`);
  }
  if (report.journeys.length) {
    process.stdout.write(`\n=== JOURNEYS ===\n`);
    for (const j of report.journeys) {
      process.stdout.write(`  ${j.ok === false ? 'FAIL' : 'ok  '} ${j.step}${j.url ? ' → ' + j.url.replace(BASE, '') : ''}${j.note ? ' — ' + j.note : ''}\n`);
      for (const e of j.errors || []) process.stdout.write(`      ! ${e}\n`);
    }
  }
  if (report.security.length) {
    process.stdout.write(`\n=== SECURITY ===\n`);
    for (const s of report.security) {
      process.stdout.write(`  ${s.ok ? 'PASS' : 'FAIL'}  ${s.name} → ${s.status} (wanted ${s.expect.join('/')})${s.leakIndicators ? ' LEAK:' + s.leakIndicators.join(',') : ''}\n`);
    }
  }
  process.stdout.write(`\nreport: /tmp/opencode/critic-report.json\nshots:  ${SHOTS}\n`);
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e) + '\n');
  process.exit(1);
});
