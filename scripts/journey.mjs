/**
 * End-to-end journey, driven the way a person drives it: real forms, real
 * redirects, real cookies. Nothing here reaches into the database to make a
 * step pass; the only direct reads are the assertions at the end, which exist
 * to prove the journey actually wrote rows.
 *
 *   node scripts/journey.mjs [baseUrl]
 */
import Database from 'better-sqlite3';

const BASE = process.argv[2] || 'http://localhost:8090';
const DB = process.env.SQLITE_FILE || 'data/hackerly.db';

let failures = 0;
const ok = (label, extra = '') => console.log(`  ✓ ${label}${extra ? ' — ' + extra : ''}`);
const bad = (label, detail) => { failures += 1; console.log(`  ✗ ${label}\n      ${detail}`); };
const step = (label) => console.log(`\n▸ ${label}`);

/** A single cookie jar, like one browser window. */
function jar() {
  const store = new Map();
  return {
    header: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(res) {
      for (const line of res.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(';');
        const i = pair.indexOf('=');
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
      }
    },
  };
}

let csrf = null;

async function page(c, path) {
  const res = await fetch(BASE + path, { headers: { cookie: c.header() }, redirect: 'manual' });
  c.absorb(res);
  const body = await res.text();
  csrf = body.match(/name="_csrf" value="([^"]+)"/)?.[1] ?? csrf;
  return { status: res.status, body, location: res.headers.get('location') ?? '' };
}

async function post(c, path, fields) {
  const fd = new URLSearchParams({ _csrf: csrf ?? '', ...fields });
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { cookie: c.header(), 'content-type': 'application/x-www-form-urlencoded' },
    body: fd, redirect: 'manual',
  });
  // The 303 that signs someone in carries the session cookie. Without absorbing
  // it here the jar stays empty and every later step looks like a 401.
  c.absorb(res);
  return { status: res.status, location: res.headers.get('location') ?? '', body: await res.text() };
}

const expect = (label, got, want) =>
  got === want ? ok(label, `HTTP ${got}`) : bad(label, `expected HTTP ${want}, got ${got}`);

/**
 * Read every named control out of a rendered form, then override the ones the
 * journey cares about. Posting back the form as the server rendered it is what
 * a person does; hand-picking field names is how tests end up passing against a
 * form that a human could not actually submit.
 */
function readForm(html, overrides = {}) {
  const fields = {};
  for (const m of html.matchAll(/<(?:input|textarea)\b[^>]*>/g)) {
    const tag = m[0];
    const name = tag.match(/name="([^"]+)"/)?.[1];
    if (!name || name === '_csrf') continue;
    const type = tag.match(/type="([^"]+)"/)?.[1] ?? 'text';
    if (type === 'checkbox') { if (/checked/.test(tag)) fields[name] = 'on'; continue; }
    if (type === 'radio') { if (/checked/.test(tag)) fields[name] = tag.match(/value="([^"]*)"/)?.[1] ?? 'on'; continue; }
    if (type === 'file' || type === 'submit' || type === 'button') continue;
    if (type === 'hidden') { fields[name] = tag.match(/value="([^"]*)"/)?.[1] ?? ''; continue; }
    fields[name] = tag.match(/value="([^"]*)"/)?.[1] ?? '';
  }
  for (const m of html.matchAll(/<textarea\b[^>]*>([\s\S]*?)<\/textarea>/g)) {
    const name = m[0].match(/name="([^"]+)"/)?.[1];
    if (name && name !== '_csrf') fields[name] = decodeEntities(m[1]);
  }
  for (const m of html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const selected = m[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/)
      ?? m[2].match(/<option[^>]*value="([^"]*)"[^>]*selected/);
    if (selected) fields[m[1]] = selected[1];
  }
  return { ...fields, ...overrides };
}

const decodeEntities = (s) => s
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** The first option with a real value, skipping a "choose one" placeholder. */
function firstRealOption(html, selectName) {
  const block = html.match(new RegExp(`<select\\b[^>]*name="${selectName}"[^>]*>([\\s\\S]*?)</select>`))?.[1];
  if (!block) return null;
  for (const m of block.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/g)) {
    if (m[1].trim() === '') continue;
    if (/choose|select|—|--/i.test(decodeEntities(m[2]))) continue;
    return m[1];
  }
  return null;
}

/** A 303 that carries ?error= is the server refusing something. Say so. */
function checkOutcome(label, r) {
  if (r.status !== 303) return bad(label, `expected a redirect, got HTTP ${r.status}`);
  const err = r.location.match(/[?&]error=([^&]+)/);
  if (err) return bad(label, `server refused: ${decodeURIComponent(err[1])}`);
  return ok(label, r.location);
}

async function signIn(c, identifier, password) {
  await page(c, '/auth/signin');
  return post(c, '/auth/signin', { identifier, password });
}

const db = () => new Database(DB, { readonly: true });

// ---------------------------------------------------------------- 1. signup
const hacker = jar();
const email = `journey-${Date.now()}@hackerly.test`;
const username = `journey${String(Date.now()).slice(-6)}`;

step('A new hacker signs up with a real form');
{
  const form = await page(hacker, '/auth/signup');
  if (form.status === 200 && /name="_csrf"/.test(form.body)) ok('sign-up form renders');
  else bad('sign-up form renders', `HTTP ${form.status}`);
  const r = await post(hacker, '/auth/signup', {
    email, username, display_name: 'Journey Hacker',
    password: 'JourneyPass2026', password_confirm: 'JourneyPass2026',
  });
  expect('sign-up accepted', r.status, 303);
  const who = await page(hacker, '/dashboard');
  if (who.status === 200 && who.body.includes('Journey Hacker')) ok('signed in and landed on the dashboard');
  else bad('signed in after sign-up', `HTTP ${who.status} at /dashboard`);
}

// ---------------------------------------------------------------- 2. register
step('They register for a live event through the public form');
{
  const form = await page(hacker, '/hackathons/hacktron-2026/register');
  if (!/name="confirm"/.test(form.body)) bad('register page offers the agreement checkbox', 'no confirm field');
  else ok('register page offers the agreement checkbox');
  const r = await post(hacker, '/hackathons/hacktron-2026/register', { confirm: 'on' });
  checkOutcome('registration accepted', r);

  const d = db();
  const row = d.prepare('SELECT event_id, role FROM event_members WHERE user_id = (SELECT id FROM users WHERE email = ?)').get(email);
  d.close();
  if (row) ok('membership row written', `${row.event_id} as ${row.role}`);
  else bad('membership row written', 'no event_members row for the new user');
}

// ---------------------------------------------------------------- 3. a team
step('They create a team and it appears on their team list');
let teamPath = '';
{
  // The real form is per-event: /teams/new/:eventSlug
  await page(hacker, '/teams/new/hacktron-2026');
  const r = await post(hacker, '/teams/new/hacktron-2026', {
    name: 'Journey Squad', description: 'Created by the end-to-end journey.',
  });
  checkOutcome('team created', r);
  teamPath = r.location;

  const list = await page(hacker, '/teams');
  const link = list.body.match(/href="(\/teams\/tm_[a-z0-9]+)"/)?.[1];
  if (!link) bad('team appears on the team list', 'no link to the new team found');
  else ok('team appears on the team list', link);
}

// ---------------------------------------------------------------- 4. a project
step('They create a project and fill in the submission form');
let projectPath = '';
{
  const tp = await page(hacker, teamPath || '/teams');
  const startLink = tp.body.match(/href="(\/teams\/tm_[a-z0-9]+\/project\/new)"/)?.[1];
  if (!startLink) bad('team page offers “start a project”', 'no link found');
  else {
    // Following that link is what creates the draft; the server redirects to the
    // edit form, which is the page the person actually types into.
    const started = await page(hacker, startLink);
    if (started.status !== 303 && started.status !== 200) bad('starting a project', `HTTP ${started.status}`);
    projectPath = started.location;
    if (!projectPath) bad('starting a project redirected to the edit form', `HTTP ${started.status}, no Location`);
    else {
      const form = await page(hacker, projectPath);
      ok('draft project created', projectPath);
      const track = firstRealOption(form.body, 'track_id');
      const fields = readForm(form.body, {
        title: 'Journey Project',
        tagline: 'Written by the end-to-end journey script.',
        summary: 'A submission created through the real form, to prove the whole path works.',
        description: 'A longer description for the same submission.',
        tech_stack: 'TypeScript, SQLite',
        repo_url: 'https://github.com/hackerly-demo/journey-project',
        demo_url: 'https://journey-project.example.org',
        field_problem: 'A clinic intake form that a nurse can finish on a phone in ninety seconds.',
        field_how_it_works: 'The server renders the form and validates every field before storing it.',
        ...(track ? { track_id: track } : {}),
      });
      const r = await post(hacker, projectPath, fields);
      checkOutcome('project saved', r);
      // Saving re-slugs the project, so the edit URL moves. Follow the redirect.
      if (r.location) projectPath = r.location;
      if (form.status !== 200) bad('project edit form renders', `HTTP ${form.status}`);
    }
  }
}

// ---------------------------------------------------------------- 5. submit
step('They submit it, and the server accepts it');
{
  if (!projectPath) bad('submit step', 'no project was created');
  else {
    const form = await page(hacker, projectPath);
    // The submit button carries its own name, so reposting the rendered form
    // with action=submit is exactly what pressing it does.
    const r = await post(hacker, projectPath, { ...readForm(form.body), action: 'submit' });
    checkOutcome('submit accepted', r);
    if (r.location) projectPath = r.location;
    const after = await page(hacker, projectPath);
    if (after.status === 200 && /\bsubmitted\b/i.test(after.body)) ok('project reads as submitted afterwards');
    else bad('project reads as submitted', `HTTP ${after.status}`);

    const d = db();
    const row = d.prepare('SELECT status, submitted_at FROM projects WHERE slug = ?')
      .get(projectPath.split('?')[0].split('/').pop());
    d.close();
    if (row?.status === 'submitted' && row.submitted_at) ok('submission persisted', `status=${row.status} at ${row.submitted_at}`);
    else bad('submission persisted', `status=${row?.status}, submitted_at=${row?.submitted_at}`);
  }
}

// ------------------------------------------------- 6. the deadline really holds
step('The server refuses an edit after the deadline');
{
  const participant = jar();
  await signIn(participant, 'participant@hackerly.test', 'HackerlyDemo2026');
  // Pick precisely: a project the signed-in user is a member of, in an event
  // whose submission deadline is in the past. Anything looser risks testing an
  // event that is still open, where an edit is supposed to succeed.
  const d = db();
  const target = d.prepare(`
    SELECT p.slug, t.id AS team_id, p.title
    FROM projects p
    JOIN teams t ON t.id = p.team_id
    JOIN team_members m ON m.team_id = t.id
    JOIN events e ON e.id = p.event_id
    JOIN users u ON u.id = m.user_id
    WHERE u.email = 'participant@hackerly.test'
      AND e.submission_deadline IS NOT NULL
      AND e.submission_deadline < datetime('now')
    LIMIT 1`).get();
  d.close();
  if (!target) bad('found a past-deadline project for this user', 'none in the database');
  else {
    const proj = `/teams/${target.team_id}/project/${target.slug}`;
    const pp = await page(participant, proj);
    if (/Submissions are closed|read-only/i.test(pp.body)) ok('past-deadline project renders read-only');
    else bad('past-deadline project renders read-only', 'no closed notice shown');

    const r = await post(participant, proj, { title: 'Renamed after the deadline', action: 'submit' });
    const d2 = db();
    const after = d2.prepare('SELECT title FROM projects WHERE slug = ?').get(target.slug);
    d2.close();
    if (r.status !== 303) ok('late edit refused outright', `HTTP ${r.status}`);
    else if (after.title === target.title) ok('late edit refused: title unchanged', `still "${after.title}"`);
    else bad('late edit refused', `title changed to "${after.title}"`);
  }
}

// ---------------------------------------------------------------- 7. judging
step('A judge scores a project and the scores reach the database');
{
  const judge = jar();
  await signIn(judge, 'priya.nair@example.org', 'SamplePass2026');
  const q = await page(judge, '/judge/events/sample-hack-2026');
  const review = q.body.match(/href="(\/judge\/review\/[^"]+)"/)?.[1];
  if (!review) bad('judge has a queue', 'no review link on the event page');
  else {
    const rp = await page(judge, review);
    const assignmentId = review.match(/\/judge\/review\/([^/?#]+)/)?.[1];
    // Scores are buttons that write into a hidden criterion_<id> field; that
    // field is what the server reads, so that is what is posted. The maximum
    // comes from the group's own label, because the server rejects anything
    // above it and the ranges differ between events.
    const groups = rp.body.split('class="score-row"').slice(1);
    const fields = {
      comment: 'Written by the end-to-end journey.', recommendation: 'yes',
      strengths: 'Real form, real server.', improvements: 'Nothing.', submit: 'on',
    };
    let scored = 0;
    for (const g of groups) {
      const max = Number(g.match(/score, 0 to (\d+)/)?.[1]);
      const criterion = g.match(/name="criterion_([^"]+)"/)?.[1];
      if (!max || !criterion) continue;
      fields[`criterion_${criterion}`] = String(Math.min(4, max));
      scored += 1;
    }
    if (!scored) bad('review page renders a score field per criterion', 'no score rows found');
    else {
      const r = await post(judge, review, fields);
      expect('review submitted', r.status, 303);
      const d = db();
      const row = d.prepare('SELECT id, status, submitted_at FROM reviews WHERE assignment_id = ?').get(assignmentId);
      const n = row ? d.prepare('SELECT COUNT(*) n FROM review_scores WHERE review_id = ?').get(row.id).n : 0;
      d.close();
      if (row?.status === 'submitted') ok('review persisted as submitted', `${n} criterion scores written`);
      else bad('review persisted as submitted', `status=${row?.status}`);
    }
  }
}

// ------------------------------------------- 8. a judge cannot read a peer's
step('A judge cannot open a review assigned to another judge');
{
  const judge = jar();
  await signIn(judge, 'priya.nair@example.org', 'SamplePass2026');
  const d = db();
  // An assignment on an event Priya judges, held by somebody else.
  const other = d.prepare(`
    SELECT a.id FROM judge_assignments a
    JOIN event_judges ej ON ej.id = a.event_judge_id
    JOIN event_judges mine ON mine.event_id = a.event_id
    WHERE mine.email_lower = 'priya.nair@example.org'
      AND mine.status = 'active'
      AND ej.email_lower <> 'priya.nair@example.org'
    LIMIT 1`).get();
  d.close();
  if (!other) bad('found a peer review on an event Priya judges', 'none in the database');
  else {
    const r = await fetch(`${BASE}/judge/review/${other.id}`, { headers: { cookie: judge.header() }, redirect: 'manual' });
    const body = await r.text();
    if (r.status === 403) ok('peer review refused', `HTTP ${r.status}`);
    else if (r.status === 303) ok('peer review redirected away', `HTTP ${r.status}`);
    else bad('peer review refused', `got HTTP ${r.status}`);
    if (!/\b\d{1,2}\s*\/\s*10\b/.test(body)) ok('refusal body contains no scores');
    else bad('refusal body leaks scores', 'a numeric score appeared in the response');
  }
}

// ------------------------------------------------ 9. participants see nothing
step('A participant cannot read a review at all');
{
  const p = jar();
  await signIn(p, 'participant@hackerly.test', 'HackerlyDemo2026');
  const d = db();
  const a = d.prepare('SELECT id FROM judge_assignments LIMIT 1').get();
  d.close();
  const r = await fetch(`${BASE}/judge/review/${a.id}`, { headers: { cookie: p.header() }, redirect: 'manual' });
  if (r.status === 401 || r.status === 403 || r.status === 303) ok('participant refused a review', `HTTP ${r.status}`);
  else bad('participant refused a review', `got HTTP ${r.status}`);
}

// ---------------------------------------------------------------- 10. results
step('Published results are public; unreleased ones are not');
{
  const pub = await page(jar(), '/hackathons/fold-2026-spring/results');
  if (pub.status === 200 && /Tidewatch/.test(pub.body)) ok('published ranking is public', 'Fold results include the winner');
  else bad('published ranking is public', `HTTP ${pub.status}`);

  const hid = await page(jar(), '/hackathons/sample-hack-2026/results');
  if (!/Small Meadow/.test(hid.body)) ok('unreleased results stay hidden');
  else bad('unreleased results stay hidden', 'a project name leaked from an unreleased event');
  if (/not released|hidden|published/i.test(hid.body)) ok('the hidden page explains itself');
  else bad('the hidden page explains itself', 'no explanation shown');
}

// ----------------------------------------------------------------- 11. export
step('The organizer CSV export contains real rows and the API is not open to the world');
{
  const org = jar();
  await signIn(org, 'meera@hackerly.dev', 'HackerlyDemo2026');
  const csv = await fetch(`${BASE}/host/events/fold-2026-spring/export.csv`, { headers: { cookie: org.header() } });
  const text = await csv.text();
  const lines = text.trim().split('\n');
  if (csv.status === 200 && lines.length > 5 && lines[0].includes(',')) ok('organizer export returns CSV', `${lines.length - 1} data rows`);
  else bad('organizer export returns CSV', `HTTP ${csv.status}, ${lines.length} lines`);

  const anon = await fetch(`${BASE}/host/events/fold-2026-spring/export.csv`, { redirect: 'manual' });
  if (anon.status === 302 || anon.status === 303 || anon.status === 401) ok('anonymous export refused', `HTTP ${anon.status}`);
  else bad('anonymous export refused', `got HTTP ${anon.status}`);
}

console.log(failures ? `\n${failures} check(s) failed` : '\njourney passed end to end');
process.exit(failures ? 1 : 0);
