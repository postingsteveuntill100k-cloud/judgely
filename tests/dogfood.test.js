const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { app, startServer } = require('../src/server');

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

const fs = require('node:fs');
const path = require('node:path');
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures.json'), 'utf8'));

test('DOGFOOD T1 - Check 1: Public gallery returns HTTP 200 without auth', async () => {
  const res = await request('/projects');
  assert.strictEqual(res.status, 200, 'Gallery must be public and return HTTP 200');
});

test('DOGFOOD T1 - Check 2: Public gallery contains known fixture project title', async () => {
  const res = await request('/projects');
  assert.strictEqual(res.status, 200);
  const titles = (fixtures.projects || []).slice(0, 3).map(p => p.title).filter(Boolean);
  const hasTitle = titles.some(t => res.body.toLowerCase().includes(t.toLowerCase()));
  assert.strictEqual(hasTitle, true, `Gallery body must contain at least one fixture project title from ${titles.join(', ')}`);
});

test('DOGFOOD T1 - Check 3: Closed event refuses submissions with 4xx', async () => {
  const res = await request('/projects/new', {
    method: 'POST',
    headers: {
      'Cookie': 'session=prt_2e88',
      'Content-Type': 'application/json'
    },
    body: { title: 'dogfood-late-submission-probe', summary: 'probe' }
  });
  assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx response, got ${res.status}`);
});

test('DOGFOOD T2 - Check 4: Judge A can view their own scores (HTTP 200)', async () => {
  const res = await request('/api/judge/scores', {
    method: 'GET',
    headers: {
      'Cookie': 'session=jdg_a_91bc'
    }
  });
  assert.strictEqual(res.status, 200, `Expected HTTP 200 for Judge A, got ${res.status}`);
  const data = JSON.parse(res.body);
  assert.strictEqual(data.judge_id, fixtures.judges[0].id);
  assert.ok(Array.isArray(data.scores));
});

test('DOGFOOD T2 - Check 5: Judge B CANNOT view Judge A scores (HTTP 401 or 403)', async () => {
  const judgeAId = fixtures.judges[0].id;
  // Querying judge A's scores as judge B
  const res = await request(`/api/judge/scores?judge=${judgeAId}`, {
    method: 'GET',
    headers: {
      'Cookie': 'session=jdg_b_44de'
    }
  });
  assert.ok(res.status === 401 || res.status === 403, `Expected 401 or 403, got ${res.status}`);
});

test('DOGFOOD T2 - Check 6: Participant cannot view judge scores (HTTP 401 or 403)', async () => {
  const res = await request('/api/judge/scores', {
    method: 'GET',
    headers: {
      'Cookie': 'session=prt_2e88'
    }
  });
  assert.ok(res.status === 401 || res.status === 403, `Expected 401 or 403, got ${res.status}`);
});

test('DOGFOOD T2 - Check 7: Organizer CSV export works (HTTP 200 and CSV body with comma)', async () => {
  const res = await request('/api/export.csv', {
    method: 'GET',
    headers: {
      'Cookie': 'session=org_7f2a'
    }
  });
  assert.strictEqual(res.status, 200, `Expected HTTP 200 for CSV export, got ${res.status}`);
  assert.ok(res.headers['content-type'].includes('csv'), 'Content-Type must be csv');
  const firstLine = res.body.split('\n')[0];
  assert.ok(firstLine.includes(','), 'First line of CSV body must contain comma');
});

test('DOGFOOD T2 - Security: Unauthorized user cannot export CSV', async () => {
  const res = await request('/api/export.csv', {
    method: 'GET',
    headers: {
      'Cookie': 'session=prt_2e88'
    }
  });
  assert.ok(res.status === 401 || res.status === 403, `Non-organizer must be rejected from export, got ${res.status}`);
});
