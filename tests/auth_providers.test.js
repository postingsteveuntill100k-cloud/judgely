const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { app } = require('../src/server');

let server;
let baseUrl;

before(async () => {
  return new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
});

after(async () => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

describe('Google Auth Provider & Guest Mode Architecture', () => {

  test('GET /api/auth/config returns runtime capabilities', async () => {
    const res = await fetch(`${baseUrl}/api/auth/config`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.demo_mode, 'boolean');
    assert.equal(typeof data.google_auth, 'boolean');
    assert.equal(typeof data.environment, 'string');
  });

  test('POST /api/auth/google fails with 400 on missing credential', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(res.status, 400);
  });

  test('POST /api/auth/google for registered participant succeeds and sets session', async () => {
    // Registered participant email from fixture: priya1@example.org (lead member on tm_01)
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: 'mock_google_priya1@example.org'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.role, 'participant');
    assert.equal(data.user.email, 'priya1@example.org');

    // Cookie must be set
    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('session=sess_'));

    // Check /api/auth/me with that session
    const cookieVal = setCookie.split(';')[0];
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Cookie: cookieVal }
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.role, 'participant');
  });

  test('POST /api/auth/google for registered judge resolves to judge role', async () => {
    // Registered judge email from fixture: tomas.varga@example.org
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: 'mock_google_tomas.varga@example.org'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.role, 'judge');
    assert.equal(data.user.email, 'tomas.varga@example.org');
  });

  test('POST /api/auth/google for unregistered email strictly returns 403 Forbidden with exact prompt message', async () => {
    const unregisteredEmail = 'stranger_hacker_99@gmail.com';
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: `mock_google_${unregisteredEmail}`
      })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'Forbidden');
    assert.equal(
      data.message,
      `You are authenticated as ${unregisteredEmail}, but you are not registered for this event.`
    );
    assert.equal(data.registered, false);

    // No session cookie should be issued
    const setCookie = res.headers.get('set-cookie');
    assert.ok(!setCookie || !setCookie.includes('sess_'));
  });

  test('POST /api/auth/guest creates clean visitor state without elevated permissions', async () => {
    const res = await fetch(`${baseUrl}/api/auth/guest`, {
      method: 'POST'
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.role, 'visitor');
    assert.equal(data.user.role, 'visitor');

    // Guest cannot access protected organizer overview
    const orgRes = await fetch(`${baseUrl}/api/organizer/overview`);
    assert.ok(orgRes.status === 401 || orgRes.status === 403);

    // Guest cannot submit a project
    const subRes = await fetch(`${baseUrl}/api/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Rogue Project' })
    });
    assert.ok(subRes.status === 401 || subRes.status === 403);
  });

  test('POST /api/auth/google with register_as: participant registers user and grants participant session', async () => {
    const newGoogleParticipant = `new_hacker_${Date.now()}@gmail.com`;
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: `mock_google_${newGoogleParticipant}`,
        register_as: 'participant'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.role, 'participant');
    assert.equal(data.user.email, newGoogleParticipant);

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('session=sess_'));
  });

  test('POST /api/auth/google for seeded organizer logs in as organizer', async () => {
    const res = await fetch(`${baseUrl}/api/auth/google`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        credential: 'mock_google_quality.prashanth@gmail.com'
      })
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.role, 'organizer');
    assert.equal(data.user.email, 'quality.prashanth@gmail.com');
  });
});
