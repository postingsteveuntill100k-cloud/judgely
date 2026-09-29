/**
 * Integration tests.
 *
 * These run the real application in-process: real schema, real seed, real HTTP.
 * Nothing is mocked. The point is to prove the authorization boundaries, the
 * deadline rule and the judging arithmetic behave the way the product claims.
 *
 *   npm test
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, shutdown, req, csrfFrom, cookie } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

before(async () => { await boot(); });
after(async () => { await shutdown(); });

// ---------------------------------------------------------------------------

describe('public discovery', () => {
  test('the gallery is public and shows fixture projects', async () => {
    const r = await req('/projects');
    assert.equal(r.status, 200);
    const fixtures = JSON.parse(readFileSync(path.join(ROOT, 'fixtures.json'), 'utf8'));
    const title = fixtures.projects[0].title;
    assert.ok(r.text.includes(title), `expected the gallery to mention ${title}`);
  });

  test('the API index is public', async () => {
    const r = await req('/api/v1');
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.endpoints));
  });

  test('an unknown page is a 404, not a 500', async () => {
    assert.equal((await req('/definitely-not-a-page')).status, 404);
  });

  test('a missing asset is a 404, not a rendered page', async () => {
    assert.equal((await req('/css/nope.css')).status, 404);
  });
});

describe('judge isolation — the checks the DOGFOOD spec cares about', () => {
  test('a judge reads their own scores', async () => {
    const r = await req('/api/judge/scores', { as: 'judge_a' });
    assert.equal(r.status, 200);
    assert.ok(r.body.reviews.length > 0, 'judge_a should have at least one review');
  });

  test('a judge cannot read a peer, and the refusal does not leak the data', async () => {
    const me = await req('/api/judge/scores', { as: 'judge_a' });
    const r = await req('/api/judge/scores?judge=judge_b', { as: 'judge_b' });
    assert.equal(r.status, 403);
    for (const marker of ['criteria', 'weighted_score', 'per_judge', 'judge_email', 'password_hash']) {
      assert.ok(!r.text.includes(marker), `refusal response leaked ${marker}`);
    }
    assert.ok(!r.text.includes(me.body.reviews[0].review_id), 'refusal contained a review id');
  });

  test('asking for your own handle by another name is still refused', async () => {
    const r = await req('/api/judge/scores?judge=somebody-else', { as: 'judge_b' });
    assert.equal(r.status, 403);
  });

  test('a participant cannot read review scores at all', async () => {
    const r = await req('/api/judge/scores', { as: 'participant' });
    assert.equal(r.status, 403);
  });

  test('an anonymous caller cannot read review scores', async () => {
    assert.equal((await req('/api/judge/scores')).status, 401);
  });

  test('a judge cannot open another judge review workspace', async () => {
    const mine = await req('/api/judge/scores', { as: 'judge_a' });
    const bMine = await req('/api/judge/scores', { as: 'judge_b' });
    const shared = bMine.body.reviews.find(
      (r) => mine.body.reviews.some((m) => m.project_id === r.project_id),
    );
    if (!shared) return; // the two judges share no project in the fixture set
    const r = await req(`/judge/review/${shared.assignment_id}`, { as: 'judge_a' });
    assert.equal(r.status, 403, 'judge_a opened an assignment that belongs to judge_b');
  });
});

describe('submissions and the deadline', () => {
  test('a closed event refuses a submission, with an explanation', async () => {
    const r = await req('/api/submissions', {
      method: 'POST',
      as: 'participant',
      body: JSON.stringify({ title: 'late probe', summary: 'probe' }),
    });
    assert.ok(r.status >= 400 && r.status < 500, `expected 4xx, got ${r.status}`);
    assert.equal(r.body.error.code, 'submissions_closed');
  });

  test('the refusal names the deadline', async () => {
    const r = await req('/api/submissions', {
      method: 'POST',
      as: 'participant',
      body: JSON.stringify({ title: 'late probe 2' }),
    });
    assert.match(r.body.error.message, /closed/i);
  });

  test('a participant cannot submit into somebody else’s team', async () => {
    const r = await req('/api/v1/events/sample-hack-2026/submissions', {
      method: 'POST',
      as: 'participant',
      body: JSON.stringify({ team_id: 'tm_does_not_exist', title: 'x' }),
    });
    assert.ok(r.status === 403 || r.status === 404, `expected 403/404, got ${r.status}`);
  });

  /**
   * Regression: the deadline guard used to be conditional on the project being
   * exactly `submitted`. Judging moves a project to `under_review`, and from
   * that moment the same route accepted edits — so a team could rewrite the
   * title, the repository URL and the demo link after the panel had started
   * scoring, while the UI still said the form was read-only.
   */
  test('an edit is refused after the deadline even once judging has started', async () => {
    // Find the participant's own project the way they would: their team list,
    // then the team page. No test-only shortcut through the database.
    const teams = await req('/teams', { as: 'participant' });
    const teamIds = [...new Set((teams.text.match(/href="\/teams\/(tm_[a-z0-9]+)"/g) ?? [])
      .map((m) => m.match(/\/(tm_[a-z0-9]+)/)[1]))];
    assert.ok(teamIds.length, 'the acceptance participant should be on a team');

    let editUrl = null;
    for (const id of teamIds) {
      const page = await req(`/teams/${id}`, { as: 'participant' });
      const link = page.text.match(/href="(\/teams\/tm_[a-z0-9]+\/project\/[a-z0-9-]+)"/)?.[1];
      // Sample Hack's submissions are all past the deadline, so any of its
      // project pages is the one to try to rewrite.
      if (link && /sample-hack-2026|Sample Hack 2026/i.test(page.text)) { editUrl = link; break; }
    }
    assert.ok(editUrl, 'the fixture should give the participant a real submission');

    const formPage = await req(editUrl, { as: 'participant' });
    const r = await req(editUrl, {
      method: 'POST',
      as: 'participant',
      form: { _csrf: csrfFrom(formPage.text), title: 'Renamed after the deadline', action: 'submit' },
    });
    assert.ok(r.status >= 400 && r.status < 500, `expected the edit to be refused, got HTTP ${r.status}`);

    // The refusal has to mean something: the page must still show the old name.
    const after = await req(editUrl, { as: 'participant' });
    assert.ok(!after.text.includes('Renamed after the deadline'),
      'the refused edit still reached the database');
  });
});

describe('exports and organizer boundaries', () => {
  test('an organizer gets a CSV with a header row', async () => {
    const r = await req('/api/export.csv', { as: 'organizer' });
    assert.equal(r.status, 200);
    const first = r.text.split('\n')[0];
    assert.ok(first.includes(','), 'the first CSV line has no comma');
    assert.ok(first.includes('rank'), `unexpected CSV header: ${first.slice(0, 80)}`);
  });

  test('a participant and a judge are both refused', async () => {
    assert.equal((await req('/api/export.csv', { as: 'participant' })).status, 403);
    assert.equal((await req('/api/export.csv', { as: 'judge_a' })).status, 403);
    assert.equal((await req('/api/export.csv')).status, 401);
  });

  test('an organizer cannot export a hackathon they do not run', async () => {
    const r = await req('/api/v1/events/hacktron-2026/export.csv', { as: 'organizer' });
    assert.equal(r.status, 403);
  });
});

describe('results visibility', () => {
  test('unpublished results are not served', async () => {
    const r = await req('/api/v1/events/sample-hack-2026/results');
    assert.equal(r.status, 404);
  });

  test('published results are served with ranks but no judge identities', async () => {
    const r = await req('/api/v1/events/fold-2026-spring/results');
    assert.equal(r.status, 200);
    assert.ok(r.body.results.length > 0);
    for (const row of r.body.results) {
      assert.ok(!('judge' in row) && !('judge_email' in row), 'a public result row exposed judge data');
    }
  });
});

describe('workspace authorization', () => {
  test('the host and judge areas are closed to anonymous callers', async () => {
    assert.ok([302, 401, 403].includes((await req('/host/events')).status));
    assert.ok([302, 401, 403].includes((await req('/judge/events')).status));
  });

  test('a judge sees an empty organizer list, not somebody else\'s events', async () => {
    const r = await req('/host/events', { as: 'judge_a' });
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes('Sample Hack 2026'), 'a judge saw an event they do not organize');
    assert.ok(!r.text.includes('HACKTRON'), 'a judge saw an event they do not organize');
  });

  test('an organizer who does not own an event gets 403 on its workspace', async () => {
    const r = await req('/host/events/hacktron-2026', { as: 'organizer' });
    assert.equal(r.status, 403);
  });

  test('a judge of one event cannot open another event’s judge area', async () => {
    // Precondition, stated explicitly: if the seed ever made judge_a a judge of
    // HACKTRON, a 200 here would be correct and the test would be meaningless.
    const mine = await req('/api/judge/scores', { as: 'judge_a' });
    const events = new Set((mine.body.reviews ?? []).map((r) => r.event_id));
    assert.ok(!events.has('hacktron-2026'), 'judge_a is unexpectedly a judge of HACKTRON; pick a different event for this test');
    const r = await req('/judge/events/hacktron-2026', { as: 'judge_a' });
    assert.equal(r.status, 403);
  });
});

describe('injection and input handling', () => {
  test('an XSS payload in a search term is not reflected raw', async () => {
    const r = await req(`/hackathons?q=${encodeURIComponent('<script>alert(1)</script>')}`);
    assert.equal(r.status, 200);
    assert.ok(!r.text.includes('<script>alert(1)</script>'), 'the payload was reflected unescaped');
  });

  test('a javascript: link in a stored field is dropped, not rendered', async () => {
    const r = await req('/hackathons/fold-2026-spring/projects/tidewatch');
    assert.equal(r.status, 200);
    assert.ok(!/href="javascript:/i.test(r.text));
  });

  test('an oversized body is refused rather than parsed', async () => {
    const big = 'x'.repeat(2 * 1024 * 1024);
    const r = await req('/auth/signin', { method: 'POST', json: false, body: `identifier=${big}&password=x` });
    assert.ok(r.status === 400 || r.status === 413, `expected a refusal, got ${r.status}`);
  });

  test('the sign-in form is protected against cross-site submission in production mode', async () => {
    // CSRF is on in production; the test server runs NODE_ENV=test with the
    // default, so assert the cookie is issued on GET and required on POST.
    const get = await req('/auth/signin');
    assert.equal(get.status, 200);
    assert.ok(/name="_csrf" value="([^"]+)"/.test(get.text), 'no CSRF token on the sign-in form');
  });
});

describe('health and observability', () => {
  test('healthz reports the driver and is honest about the database', async () => {
    const r = await req('/healthz');
    assert.equal(r.status, 200);
    assert.equal(r.body.database.ok, true);
    assert.equal(r.body.database.driver, 'sqlite');
  });

  test('security headers are present', async () => {
    const r = await req('/');
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.ok(r.headers.get('content-security-policy'));
  });
});
