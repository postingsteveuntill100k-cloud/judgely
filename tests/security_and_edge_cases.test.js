const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { app } = require('../src/server');

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

test('Security - Invalid or forged session token rejected', async () => {
  const res = await request('/api/judge/scores', {
    method: 'GET',
    headers: { 'Cookie': 'session=forged_token_12345' }
  });
  assert.strictEqual(res.status, 401, 'Forged session must receive 401 Unauthorized');
});

test('Security - Judge A cannot access Judge B scores via query param', async () => {
  const res = await request('/api/judge/scores?judge=jdg_02', {
    method: 'GET',
    headers: { 'Cookie': 'session=jdg_a_91bc' } // Judge A
  });
  assert.strictEqual(res.status, 403, 'Judge A must be forbidden from accessing Judge B scores');
});

test('Security - Participant cannot access organizer overview API', async () => {
  const res = await request('/api/organizer/overview', {
    method: 'GET',
    headers: { 'Cookie': 'session=prt_2e88' }
  });
  assert.strictEqual(res.status, 403, 'Participant must be forbidden from accessing organizer API');
});

test('Security - Judge cannot access organizer overview API', async () => {
  const res = await request('/api/organizer/overview', {
    method: 'GET',
    headers: { 'Cookie': 'session=jdg_a_91bc' }
  });
  assert.strictEqual(res.status, 403, 'Judge must be forbidden from accessing organizer API');
});

test('Security - Public project detail NEVER leaks private judge reviews to visitors', async () => {
  const res = await request('/api/projects/prj_01', {
    method: 'GET' // No auth header = visitor
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.project);
  assert.deepStrictEqual(data.project.reviews_breakdown, [], 'Visitor must receive empty reviews_breakdown');
});

test('Security - Public project detail NEVER leaks peer judge reviews to participants', async () => {
  const res = await request('/api/projects/prj_01', {
    method: 'GET',
    headers: { 'Cookie': 'session=prt_2e88' } // Participant
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.project);
  assert.deepStrictEqual(data.project.reviews_breakdown, [], 'Participant must receive empty reviews_breakdown');
});

test('Security - Judge inspecting project detail ONLY sees own review, NOT peers', async () => {
  // prj_01 has reviews from jdg_08, jdg_11, etc.
  const res = await request('/api/projects/prj_01', {
    method: 'GET',
    headers: { 'Cookie': 'session=jdg_a_91bc' } // Judge A (jdg_01)
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  // jdg_01 did not review prj_01, so visible reviews must be empty for jdg_01
  assert.deepStrictEqual(data.project.reviews_breakdown, [], 'Judge A cannot see reviews by jdg_08 or jdg_11');
});

test('Security - Organizer inspecting project detail CAN see full judging reviews', async () => {
  const res = await request('/api/projects/prj_01', {
    method: 'GET',
    headers: { 'Cookie': 'session=org_7f2a' } // Organizer
  });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.project.reviews_breakdown.length > 0, 'Organizer must have visibility into judging reviews');
});

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

test('Edge Cases - Judge review submission rejects invalid criteria scores (out of bounds or NaN)', async () => {
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=jdg_a_91bc',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_01',
      criteria: { functionality: 9.99, quality: -1 } // Invalid bounds
    }
  });
  assert.strictEqual(res.status, 400, 'Must reject scores outside [0, 5]');
});

test('Edge Cases - Judge review submission rejects non-existent project', async () => {
  const res = await request('/api/judge/scores', {
    method: 'POST',
    headers: {
      'Cookie': 'session=jdg_a_91bc',
      'Content-Type': 'application/json'
    },
    body: {
      project_id: 'prj_does_not_exist_9999',
      criteria: { functionality: 4.0 }
    }
  });
  assert.strictEqual(res.status, 404, 'Must return 404 for non-existent project');
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

test('Edge Cases - Results API returns mathematically sound normalization within bounds [0, 5]', async () => {
  const res = await request('/api/results');
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.global.totalReviews > 0);
  for (const p of data.rankings) {
    assert.ok(p.normalized_score >= 0 && p.normalized_score <= 5, `Normalized score ${p.normalized_score} must be within [0, 5]`);
    assert.ok(p.rank >= 1 && p.rank <= data.rankings.length);
  }
});

