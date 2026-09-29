/**
 * What can this service account actually do on the Firebase project?
 *
 * Answers the question directly instead of guessing, and prints the exact
 * status it got for each attempt. Run with:
 *   node scripts/firebase-probe.mjs /path/to/service-account.json
 */
import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import https from 'node:https';

const keyPath = process.argv[2] || '/home/abhinav/Downloads/hackerly-hackatrons-firebase-adminsdk-fbsvc-5071228397.json';
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const PROJECT = key.project_id;

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${signer.sign(key.private_key, 'base64url')}`;
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'content-length': Buffer.byteLength(assertion) },
    }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => { try { resolve(JSON.parse(b).access_token); } catch (e) { reject(new Error(b)); } });
    });
    req.on('error', reject);
    req.write(`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(assertion)}`);
    req.end();
  });
}

function call(token, host, path, method = 'GET') {
  return new Promise((resolve) => {
    const req = https.request({ host, path, method, headers: { authorization: `Bearer ${token}` } }, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(b); } catch { /* not json */ }
        resolve({ status: res.statusCode, body: parsed, raw: b.slice(0, 400) });
      });
    });
    req.on('error', (e) => resolve({ status: 0, body: null, raw: String(e.message) }));
    if (method === 'POST' || method === 'PATCH') req.write('{}');
    req.end();
  });
}

const line = (label, r, note = '') => {
  const detail = r.body?.error?.message ? `: ${r.body.error.message}` : note ? ` (${note})` : '';
  console.log(`  ${String(r.status).padEnd(4)} ${label}${detail}`);
};

const token = await accessToken();
console.log(`service account: ${key.client_email}`);
console.log(`project:         ${PROJECT}\n`);

console.log('identity and project metadata');
line('cloudresourcemanager projects/get', await call(token, 'cloudresourcemanager.googleapis.com', `/v1/projects/${PROJECT}`));
line('serviceusage services.list', await call(token, 'serviceusage.googleapis.com', `/v1/projects/${PROJECT}/services`));

const services = await call(token, 'serviceusage.googleapis.com', `/v1/projects/${PROJECT}/services`);
const enabled = (services.body?.services ?? []).filter((s) => s.state === 'ENABLED').map((s) => s.config?.name);
console.log(`\nenabled services (${enabled?.length ?? 0}): ${(enabled ?? []).join(', ') || 'none'}`);

console.log('\nstorage');
const fs = await call(token, 'firestore.googleapis.com', `/v1/projects/${PROJECT}/databases/(default)`);
line('firestore databases/get', fs, fs.status === 404 ? 'no database' : '');
line('firestore databases/create', await call(token, 'firestore.googleapis.com', `/v1/projects/${PROJECT}/databases`, 'POST'));

console.log('\nauth');
line('identitytoolkit projects/getConfig', await call(token, 'identitytoolkit.googleapis.com', `/v1/projects/${PROJECT}/config`));

console.log('\nhosting');
const sites = await call(token, 'firebasehosting.googleapis.com', `/v1beta1/projects/${PROJECT}/sites`);
line('hosting sites/list', sites, sites.body?.sites?.length ? `${sites.body.sites.length} site(s): ${sites.body.sites.map((s) => s.name).join(', ')}` : 'no sites');
line('hosting sites/create', await call(token, 'firebasehosting.googleapis.com', `/v1beta1/projects/${PROJECT}/sites`, 'POST'));

console.log('\ncompute (cloud functions backing)');
line('cloudfunctions list', await call(token, 'cloudfunctions.googleapis.com', `/v2/projects/${PROJECT}/locations/-/functions`));
