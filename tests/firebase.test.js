import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, req } from './harness.js';
import fs from 'node:fs';
import path from 'node:path';

let firebaseAuth;

before(async () => {
  await boot();
  const mod = await import('../dist/server/services/firebase.js');
  firebaseAuth = mod.firebaseAuth;
});
after(async () => { await shutdown(); });

describe('judgely firebase & static deployment verification', () => {
  test('firebase publicConfig returns enabled with Judgely keys', () => {
    const cfg = firebaseAuth.publicConfig();
    assert.equal(cfg.enabled, true, 'firebase auth should be enabled');
    assert.ok(cfg.apiKey, 'apiKey should be present');
    assert.ok(cfg.authDomain, 'authDomain should be present');
    assert.equal(cfg.projectId, 'hackerly-hackatrons', 'projectId should be hackerly-hackatrons');
  });

  test('signin and signup pages render data-firebase-config with Judgely config', async () => {
    const signinRes = await req('/auth/signin');
    assert.equal(signinRes.status, 200);
    const signinMatch = signinRes.text.match(/<script type="application\/json" data-firebase-config>(.*?)<\/script>/);
    assert.ok(signinMatch, 'signin should have data-firebase-config script');
    const signinCfg = JSON.parse(signinMatch[1]);
    assert.equal(signinCfg.projectId, 'hackerly-hackatrons');

    const signupRes = await req('/auth/signup');
    assert.equal(signupRes.status, 200);
    const signupMatch = signupRes.text.match(/<script type="application\/json" data-firebase-config>(.*?)<\/script>/);
    assert.ok(signupMatch, 'signup should have data-firebase-config script');
    const signupCfg = JSON.parse(signupMatch[1]);
    assert.equal(signupCfg.projectId, 'hackerly-hackatrons');
  });

  test('firebase endpoint refuses empty token cleanly with 400', async () => {
    const res = await req('/auth/firebase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(res.status, 400);
  });

  test('project detail page static exports exist and do not redirect to home', () => {
    const greenhousePath = path.resolve('public/hackathons/hacktron-2026/projects/greenhouse/index.html');
    assert.ok(fs.existsSync(greenhousePath), 'greenhouse detail page must exist statically');
    const content = fs.readFileSync(greenhousePath, 'utf8');
    assert.ok(content.includes('Greenhouse'), 'greenhouse page must contain project title');
    assert.ok(!content.includes('Find a hackathon. Host your event.'), 'must not be the homepage');

    const aliasPath = path.resolve('public/projects/greenhouse/index.html');
    assert.ok(fs.existsSync(aliasPath), 'project alias page must exist');
  });

  test('wizard steps indicator renders with small white circle style', () => {
    const cssPath = path.resolve('public/css/workspace.css');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.ok(css.includes('.wizard-steps a[aria-current="step"]::before'), 'wizard step active indicator should exist');
    assert.ok(css.includes('border-radius: 50%'), 'indicator should be circular');
  });
});
