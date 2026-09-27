const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { app } = require('../src/server');
const { getDb } = require('../src/db/database');
const { escapeHtml, sanitizeUrl } = require('../src/routes/public');

let server;
let baseUrl;

test.before(async () => {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

function request(urlPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, baseUrl);
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, headers: res.headers, body });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'object' ? JSON.stringify(options.body) : options.body);
    }
    req.end();
  });
}

// ============================================================================
// 1. AUTHENTICATION & SESSION MECHANISM TESTS
// ============================================================================

test('Auth - Invalid or forged session token rejected with 401', async () => {
  const res = await request('/api/judge/scores', {
    method: 'GET',
    headers: { 'Cookie': 'session=forged_token_12345' }
  });
  assert.strictEqual(res.status, 401, 'Forged session must receive 401 Unauthorized');
});

test('Auth - Query parameter session tokens are strictly ignored (Bug 3)', async () => {
  // Pass token in URL query: must NOT authenticate the user
  const res = await request('/api/judge/scores?session=jdg_a_91bc', {
    method: 'GET'
  });
  assert.strictEqual(res.status, 401, 'Query-parameter session tokens must be rejected');
});

test('Auth - POST /api/auth/demo-login issues valid HttpOnly session cookie', async () => {
  const res = await request('/api/auth/demo-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { role: 'organizer' }
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.user.role, 'organizer');
  assert.ok(res.headers['set-cookie'], 'Must issue Set-Cookie header');
  const cookieHeader = res.headers['set-cookie'].join('; ');
  assert.ok(cookieHeader.includes('HttpOnly'), 'Cookie must be HttpOnly');
  assert.ok(cookieHeader.includes('SameSite=Lax'), 'Cookie must have SameSite=Lax');
});

test('Auth - GET /api/auth/me returns current session identity', async () => {
  const res = await request('/api/auth/me', {
    method: 'GET',
    headers: { 'Cookie': 'session=org_7f2a' }
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.user.role, 'organizer');
  assert.strictEqual(data.user.name, 'Hackathon Operations');
});

// ============================================================================
// 2. AUTHORIZATION & ROLE ISOLATION TESTS
// ============================================================================

test('Authorization - Judge A cannot access Judge B scores via query param (DOGFOOD T2)', async () => {
  const res = await request('/api/judge/scores?judge=jdg_02', {
    method: 'GET',
    headers: { 'Cookie': 'session=jdg_a_91bc' } // Judge A
  });
  assert.strictEqual(res.status, 403, 'Judge A must be forbidden from accessing Judge B scores');
});

test('Authorization - Participant cannot access organizer overview API', async () => {
  const res = await request('/api/organizer/overview', {
    method: 'GET',
    headers: { 'Cookie': 'session=prt_2e88' }
  });
  assert.strictEqual(res.status, 403, 'Participant must be forbidden from accessing organizer API');
});

test('Authorization - Judge cannot access organizer overview API', async () => {
  const res = await request('/api/organizer/overview', {
    method: 'GET',
    headers: { 'Cookie': 'session=jdg_a_91bc' }
  });
  assert.strictEqual(res.status, 403, 'Judge must be forbidden from accessing organizer API');
});

// ============================================================================
// 3. JUDGING ASSIGNMENT & RUBRIC INTEGRITY (BUG 1 & BUG 7)
// ============================================================================

test('Judging - Judge A scoring an UNASSIGNED project returns HTTP 403 (Bug 1)', async () => {
  // jdg_01 is assigned to prj_07, NOT prj_01
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=jdg_a_91bc',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_01', // Unassigned project
      criteria: { functionality: 4.0, quality: 4.0 }
    }
  });
  assert.strictEqual(res.status, 403, 'Judge must be forbidden (403) from scoring unassigned project');
});

test('Judging - Judge A scoring an ASSIGNED project is allowed (Bug 1)', async () => {
  // jdg_01 is assigned to prj_07
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=jdg_a_91bc',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_07',
      criteria: { functionality: 4.5, quality: 4.0, innovation: 4.8 },
      comment: 'Excellent execution on edge optimization.'
    }
  });
  assert.strictEqual(res.status, 200, 'Judge must be allowed to score assigned project');
});

test('Judging - Participant attempting to submit scores receives HTTP 403', async () => {
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=prt_2e88',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_07',
      criteria: { functionality: 5.0, quality: 5.0 }
    }
  });
  assert.strictEqual(res.status, 403, 'Participant must be forbidden from score endpoint');
});

test('Judging - Submitting UNKNOWN criterion returns HTTP 400 (Bug 7 Rubric Bypass)', async () => {
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=jdg_a_91bc',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_07',
      criteria: { functionality: 4.0, quality: 4.0, fake_hacked_criterion: 5.0 }
    }
  });
  assert.strictEqual(res.status, 400, 'Must reject unknown criteria with 400');
  const data = JSON.parse(res.body);
  assert.ok(data.message.includes('Unknown rubric criterion'));
});

test('Judging - Submitting OUT OF RANGE score (> 5.0 or < 0) returns HTTP 400 (Bug 7)', async () => {
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=jdg_a_91bc',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_07',
      criteria: { functionality: 9.99, quality: 3.0 }
    }
  });
  assert.strictEqual(res.status, 400, 'Must reject scores outside bounds [0, 5]');
});

test('Judging - Submitting MISSING required criterion returns HTTP 400 (Bug 7)', async () => {
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=jdg_a_91bc',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_07',
      criteria: { functionality: 4.0 } // Missing quality criterion
    }
  });
  assert.strictEqual(res.status, 400, 'Must reject submission with missing required criterion');
  const data = JSON.parse(res.body);
  assert.ok(data.message.includes('Missing required rubric criterion'));
});

// ============================================================================
// 4. RESULTS EMBARGO & VISIBILITY (BUG 2)
// ============================================================================

test('Results Visibility - Embargoed results refuse public /api/results with HTTP 403 (Bug 2)', async () => {
  const db = getDb();
  db.prepare("UPDATE events SET results_released = 0 WHERE id = 'evt_01'").run();

  const res = await request('/api/results', {
    method: 'GET'
  });
  assert.strictEqual(res.status, 403, 'Public must receive 403 when results are embargoed');
});

test('Results Visibility - Organizer CAN access /api/results before release', async () => {
  const res = await request('/api/results', {
    method: 'GET',
    headers: { 'Cookie': 'session=org_7f2a' }
  });
  assert.strictEqual(res.status, 200, 'Organizer must have authorized access to results');
  const data = JSON.parse(res.body);
  assert.ok(data.rankings && data.rankings.length > 0);
  assert.ok(data.judges, 'Organizer receives judge bias and normalization proof');
});

test('Results Visibility - When organizer releases results, public receives sanitized rankings without judge bias', async () => {
  // Release results
  const releaseRes = await request('/api/organizer/settings/results-visibility', {
    method: 'POST',
    headers: {
      'Cookie': 'session=org_7f2a',
      'Content-Type': 'application/json'
    },
    body: { results_released: true }
  });
  assert.strictEqual(releaseRes.status, 200);

  // Public request to /api/results
  const res = await request('/api/results', {
    method: 'GET'
  });
  assert.strictEqual(res.status, 200, 'Public can view results after release');
  const data = JSON.parse(res.body);
  assert.strictEqual(data.results_released, true);
  assert.strictEqual(data.judges, undefined, 'Public MUST NOT receive judge bias or judge distribution internals');

  // Re-embargo for subsequent tests
  const db = getDb();
  db.prepare("UPDATE events SET results_released = 0 WHERE id = 'evt_01'").run();
});

test('Results Visibility - Public project detail NEVER leaks peer judge reviews to visitors', async () => {
  const res = await request('/api/projects/prj_01', {
    method: 'GET'
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.project);
  assert.deepStrictEqual(data.project.reviews_breakdown, [], 'Visitor must receive empty reviews_breakdown');
});

test('Results Visibility - Judge inspecting project detail ONLY sees own review, NOT peers', async () => {
  const res = await request('/api/projects/prj_01', {
    method: 'GET',
    headers: { 'Cookie': 'session=jdg_a_91bc' } // Judge A (jdg_01)
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.deepStrictEqual(data.project.reviews_breakdown, [], 'Judge A cannot see peer reviews');
});

test('Results Visibility - Organizer inspecting project detail CAN see full judging reviews', async () => {
  const res = await request('/api/projects/prj_01', {
    method: 'GET',
    headers: { 'Cookie': 'session=org_7f2a' } // Organizer
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.project.reviews_breakdown.length > 0, 'Organizer must have visibility into judging reviews');
});

// ============================================================================
// 5. TEAM AND SUBMISSION OWNERSHIP (BUG 8 & BUG 9)
// ============================================================================

test('Team Ownership - Participant submitting into another team receives HTTP 403 (Bug 8)', async () => {
  // First temporarily reopen submissions for test
  const db = getDb();
  const future = new Date(Date.now() + 86400000).toISOString();
  db.prepare("UPDATE events SET submissions_close = ? WHERE id = 'evt_01'").run(future);

  // Participant Priya (usr_participant) belongs to tm_01, NOT tm_02
  const res = await request('/api/submissions', {
    method: 'POST',
    headers: {
      'Cookie': 'session=prt_2e88',
      'Content-Type': 'application/json'
    },
    body: {
      title: 'Hacked Team Submission Probe',
      team_id: 'tm_02' // Different team
    }
  });
  assert.strictEqual(res.status, 403, 'Participant must be forbidden from submitting to an unowned team');

  // Re-close submissions to keep fixture state
  db.prepare("UPDATE events SET submissions_close = '2026-03-01T18:00:00Z' WHERE id = 'evt_01'").run();
});

test('Submission Ownership - Participant cannot edit another team project (Bug 9)', async () => {
  const res = await request('/api/projects/prj_02', {
    method: 'PUT',
    headers: {
      'Cookie': 'session=prt_2e88', // Participant on tm_01
      'Content-Type': 'application/json'
    },
    body: {
      title: 'Malicious Update to prj_02'
    }
  });
  // Should be 403 because submissions are closed or participant doesn't own prj_02
  assert.strictEqual(res.status, 403);
});

// ============================================================================
// 6. XSS AND INJECTION DEFENSE (BUG 6)
// ============================================================================

test('Security - SSR HTML and XSS strings are properly escaped (Bug 6)', () => {
  const maliciousTitle = '<script>alert(1)</script>';
  const maliciousImg = '<img src=x onerror=alert(1)>';

  assert.strictEqual(escapeHtml(maliciousTitle), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(escapeHtml(maliciousImg), '&lt;img src=x onerror=alert(1)&gt;');
});

test('Security - javascript: URLs are rejected by sanitizeUrl (Bug 6)', () => {
  assert.strictEqual(sanitizeUrl('javascript:alert(1)'), '');
  assert.strictEqual(sanitizeUrl('data:text/html,<script>alert(1)</script>'), '');
  assert.strictEqual(sanitizeUrl('https://github.com/judgely/judgely'), 'https://github.com/judgely/judgely');
});

// ============================================================================
// 7. EDGE CASES & HEALTH ANOMALIES
// ============================================================================

test('Edge Cases - Duplicate project submissions by same team (tm_07: prj_07 and prj_41)', async () => {
  const res1 = await request('/api/projects/prj_07');
  const res2 = await request('/api/projects/prj_41');
  assert.strictEqual(res1.status, 200);
  assert.strictEqual(res2.status, 200);
  const p1 = JSON.parse(res1.body).project;
  const p2 = JSON.parse(res2.body).project;
  assert.strictEqual(p1.team_id, 'tm_07');
  assert.strictEqual(p2.team_id, 'tm_07');
  assert.notStrictEqual(p1.id, p2.id);
});

test('Edge Cases - Health API detects zero-variance judge jdg_07 and duplicate team tm_07', async () => {
  const res = await request('/api/organizer/overview', {
    method: 'GET',
    headers: { 'Cookie': 'session=org_7f2a' }
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.health);
  const zeroVarFlag = data.health.flags.find(f => f.type === 'zero_variance' && f.resource_id === 'jdg_07');
  assert.ok(zeroVarFlag, 'Must detect zero variance flag for jdg_07');
  const dupFlag = data.health.flags.find(f => f.type === 'duplicate_submission' && f.resource_id === 'tm_07');
  assert.ok(dupFlag, 'Must detect duplicate submission flag for tm_07');
});
