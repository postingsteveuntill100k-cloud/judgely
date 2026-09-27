const test = require('node:test');
const assert = require('node:assert');
const { parseCookies } = require('../src/middleware/auth');
const { getDb } = require('../src/db/database');

test('Auth - parseCookies correctly parses cookie strings', () => {
  const cookieHeader = 'session=org_7f2a; theme=dark; test_val=hello%20world';
  const cookies = parseCookies(cookieHeader);

  assert.strictEqual(cookies.session, 'org_7f2a');
  assert.strictEqual(cookies.theme, 'dark');
  assert.strictEqual(cookies.test_val, 'hello world');
});

test('Auth - Seeded users exist with correct roles in database', () => {
  const db = getDb();
  
  const org = db.prepare('SELECT role, name FROM users WHERE session_token = ?').get('org_7f2a');
  assert.ok(org);
  assert.strictEqual(org.role, 'organizer');

  const judgeA = db.prepare('SELECT role, name FROM users WHERE session_token = ?').get('jdg_a_91bc');
  assert.ok(judgeA);
  assert.strictEqual(judgeA.role, 'judge');

  const judgeB = db.prepare('SELECT role, name FROM users WHERE session_token = ?').get('jdg_b_44de');
  assert.ok(judgeB);
  assert.strictEqual(judgeB.role, 'judge');

  const part = db.prepare('SELECT role, name FROM users WHERE session_token = ?').get('prt_2e88');
  assert.ok(part);
  assert.strictEqual(part.role, 'participant');
});
