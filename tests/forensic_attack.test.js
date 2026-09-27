const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { app } = require('../src/server');
const { getDb } = require('../src/db/database');

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
// 1. PRIVACY FORENSICS — ZERO EMAIL EXPOSURE ON PUBLIC APIS
// ============================================================================

test('Privacy - GET /api/projects/:id strictly redacts all participant and judge emails', async () => {
  const res = await request('/api/projects/prj_01', { method: 'GET' });
  assert.strictEqual(res.status, 200);

  const data = JSON.parse(res.body);
  const project = data.project;

  // Verify project payload exists
  assert.ok(project);
  assert.strictEqual(project.id, 'prj_01');

  // Verify no emails in stringified JSON
  const rawJson = JSON.stringify(data);
  assert.ok(!rawJson.includes('@'), `Public project endpoint must not contain email addresses: ${rawJson}`);
  assert.ok(!rawJson.includes('@example.org'), 'Must not leak participant email addresses');

  // Verify team_members DTO format (display names only)
  if (project.team_members && project.team_members.length > 0) {
    for (const member of project.team_members) {
      if (typeof member === 'object') {
        assert.ok(!member.email, 'team_members object must not have email field');
        assert.ok(member.name || member.display_name, 'team_members object has name');
      } else {
        assert.ok(!member.includes('@'), 'team_members string must not be an email');
      }
    }
  }
});

test('Privacy - GET /api/projects list strictly omits emails', async () => {
  const res = await request('/api/projects', { method: 'GET' });
  assert.strictEqual(res.status, 200);
  const rawJson = res.body;
  assert.ok(!rawJson.includes('@example.org'), 'Public project list must never leak member emails');
});

// ============================================================================
// 2. CROSS-EVENT AUTHORIZATION & IDOR ISOLATION
// ============================================================================

test('Cross-Event IDOR - Requesting project with mismatched event context returns 404', async () => {
  // prj_01 belongs to evt_01. Passing an arbitrary foreign event ID header must refuse access.
  const res = await request('/api/projects/prj_01', {
    method: 'GET',
    headers: { 'x-event-id': 'evt_foreign_999' }
  });
  assert.strictEqual(res.status, 404, 'Mismatched event ID header must return 404');
});

test('Cross-Event IDOR - Organizer cannot mutate foreign event assignments (HTTP 403)', async () => {
  // Seed a second dummy event in database for testing isolation
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO events (id, name, submissions_close, results_released, created_at)
    VALUES ('evt_isolated', 'Isolated Second Event', '2029-01-01T00:00:00Z', 0, '2099-01-01T00:00:00Z')
  `).run();

  try {
    // Organizer from evt_01 attempts to create assignment on evt_isolated
    const res = await request('/api/organizer/assignments', {
      method: 'POST',
      headers: {
        'Cookie': 'session=org_7f2a',
        'Content-Type': 'application/json',
        'x-event-id': 'evt_isolated'
      },
      body: { project_id: 'prj_01', judge_id: 'jdg_01' }
    });

    assert.strictEqual(res.status, 403, 'Organizer from Event A must be forbidden from Event B (403)');
    const data = JSON.parse(res.body);
    assert.ok(data.message.includes('membership') || data.message.includes('denied'));
  } finally {
    db.prepare("DELETE FROM events WHERE id = 'evt_isolated'").run();
  }
});

test('Cross-Event IDOR - Judge cannot view assignments for foreign event (HTTP 403)', async () => {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO events (id, name, submissions_close, results_released, created_at)
    VALUES ('evt_isolated', 'Isolated Second Event', '2029-01-01T00:00:00Z', 0, '2099-01-01T00:00:00Z')
  `).run();

  try {
    const res = await request('/api/judge/assignments', {
      method: 'GET',
      headers: {
        'Cookie': 'session=jdg_a_91bc',
        'x-event-id': 'evt_isolated'
      }
    });
    assert.strictEqual(res.status, 403, 'Judge from Event A must be forbidden from Event B assignments (403)');
  } finally {
    db.prepare("DELETE FROM events WHERE id = 'evt_isolated'").run();
  }
});

test('Track Ownership - Updating project with foreign track returns HTTP 400', async () => {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO events (id, name, submissions_close, results_released, created_at)
    VALUES ('evt_isolated', 'Isolated Second Event', '2029-01-01T00:00:00Z', 0, '2099-01-01T00:00:00Z')
  `).run();

  // First ensure foreign track exists on evt_isolated
  db.prepare(`
    INSERT OR IGNORE INTO tracks (id, event_id, name, description)
    VALUES ('trk_foreign', 'evt_isolated', 'Foreign Track', 'Foreign')
  `).run();

  try {
    // Attempt to assign foreign track to evt_01 project
    const res = await request('/api/projects/prj_07', {
      method: 'PUT',
      headers: {
        'Cookie': 'session=org_7f2a', // Organizer in evt_01
        'Content-Type': 'application/json'
      },
      body: {
        track_id: 'trk_foreign' // Does not belong to evt_01
      }
    });

    assert.strictEqual(res.status, 400, 'Cross-event track update must be rejected with 400');
    const data = JSON.parse(res.body);
    assert.ok(data.error.includes('does not belong to event'));
  } finally {
    db.prepare("DELETE FROM tracks WHERE id = 'trk_foreign'").run();
    db.prepare("DELETE FROM events WHERE id = 'evt_isolated'").run();
  }
});

// ============================================================================
// 3. COMPLETE AUTHENTICATION CONTRACT
// ============================================================================

test('Auth - Email-only login is strictly rejected (HTTP 400)', async () => {
  const res = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'organizer@judgely.local' }
  });
  assert.strictEqual(res.status, 400, 'Email-only login must be rejected with 400');
});

test('Auth - Invalid password rejected with HTTP 401', async () => {
  const res = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { email: 'organizer@judgely.local', password: 'bad_password' }
  });
  assert.strictEqual(res.status, 401, 'Invalid password must receive 401');
});

test('Auth - GET /api/auth/config returns demo_mode boolean', async () => {
  const res = await request('/api/auth/config', { method: 'GET' });
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert.strictEqual(typeof data.demo_mode, 'boolean');
});

// ============================================================================
// 4. EMBARGO & RESULTS PERMISSION CONTRACT
// ============================================================================

test('Embargo - Visitor calling /api/results before release receives HTTP 403', async () => {
  // Ensure results_released is 0
  const db = getDb();
  db.prepare("UPDATE events SET results_released = 0 WHERE id = 'evt_01'").run();

  const res = await request('/api/results', { method: 'GET' });
  assert.strictEqual(res.status, 403, 'Public visitor must receive 403 when results are embargoed');
});

test('Embargo - Participant calling /api/results before release receives HTTP 403', async () => {
  const res = await request('/api/results', {
    method: 'GET',
    headers: { 'Cookie': 'session=prt_2e88' }
  });
  assert.strictEqual(res.status, 403, 'Participant must receive 403 when results are embargoed');
});
