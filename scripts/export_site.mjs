#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const BASE = process.env.BASE_URL || 'http://localhost:8090';

const COOKIE_ORGANIZER = 'hkl_session=dogfood_organizer_token_v1.N6xkZNUxYVfjf_PO8-I57gSgbXX3mHkaZZuFn8NQ1K8';
const COOKIE_JUDGE = 'hkl_session=dogfood_judge_a_token_v1.wCl0yQpBQ69YnRE3_C1WBbPaEdxvMrq3DE3dY_Ze13Y';
const COOKIE_PARTICIPANT = 'hkl_session=dogfood_participant_token_v1.Dd0vUBzRTUQXmPpHKieYjOJWjO3hW_q-GdiGH6GoJGc';

const ROUTES = [
  // Public
  { url: '/', out: 'index.html' },
  { url: '/hackathons', out: 'hackathons/index.html' },
  { url: '/projects', out: 'projects/index.html' },
  { url: '/host', out: 'host/index.html' },
  { url: '/judge', out: 'judge/index.html' },
  { url: '/about', out: 'about/index.html' },
  { url: '/testing', out: 'testing/index.html' },
  { url: '/auth/signin', out: 'auth/signin/index.html' },
  { url: '/auth/signup', out: 'auth/signup/index.html' },
  { url: '/hackathons/hacktron-2026', out: 'hackathons/hacktron-2026/index.html' },
  { url: '/hackathons/hacktron-2026/projects', out: 'hackathons/hacktron-2026/projects/index.html' },
  { url: '/hackathons/hacktron-2026/tracks/developer-tools', out: 'hackathons/hacktron-2026/tracks/developer-tools/index.html' },
  { url: '/hackathons/fold-2026-spring', out: 'hackathons/fold-2026-spring/index.html' },
  { url: '/hackathons/fold-2026-spring/results', out: 'hackathons/fold-2026-spring/results/index.html' },
  { url: '/hackathons/sample-hack-2026', out: 'hackathons/sample-hack-2026/index.html' },
  { url: '/hackathons/sample-hack-2026/projects', out: 'hackathons/sample-hack-2026/projects/index.html' },

  // Participant & Dashboard
  { url: '/dashboard', cookie: COOKIE_PARTICIPANT, out: 'dashboard/index.html' },
  { url: '/teams', cookie: COOKIE_PARTICIPANT, out: 'teams/index.html' },
  { url: '/teams/tm_01', cookie: COOKIE_PARTICIPANT, out: 'teams/tm_01/index.html' },
  { url: '/teams/tm_01/project/glass-signal', cookie: COOKIE_PARTICIPANT, out: 'teams/tm_01/project/glass-signal/index.html' },

  // Host / Organizer
  { url: '/host/events', cookie: COOKIE_ORGANIZER, out: 'host/events/index.html' },
  { url: '/host/events/hacktron-2026', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/index.html' },
  { url: '/host/events/hacktron-2026/setup/basics', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/basics/index.html' },
  { url: '/host/events/hacktron-2026/setup/dates', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/dates/index.html' },
  { url: '/host/events/hacktron-2026/setup/tracks', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/tracks/index.html' },
  { url: '/host/events/hacktron-2026/setup/submission', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/submission/index.html' },
  { url: '/host/events/hacktron-2026/setup/judging', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/judging/index.html' },
  { url: '/host/events/hacktron-2026/setup/rules', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/rules/index.html' },
  { url: '/host/events/hacktron-2026/setup/branding', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/branding/index.html' },
  { url: '/host/events/hacktron-2026/setup/publish', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/setup/publish/index.html' },
  { url: '/host/events/hacktron-2026/participants', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/participants/index.html' },
  { url: '/host/events/hacktron-2026/teams', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/teams/index.html' },
  { url: '/host/events/hacktron-2026/projects', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/projects/index.html' },
  { url: '/host/events/hacktron-2026/judges', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/judges/index.html' },
  { url: '/host/events/hacktron-2026/assignments', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/assignments/index.html' },
  { url: '/host/events/hacktron-2026/judging', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/judging/index.html' },
  { url: '/host/events/hacktron-2026/audit', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/audit/index.html' },
  { url: '/host/events/hacktron-2026/export', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/export/index.html' },
  { url: '/host/events/hacktron-2026/settings', cookie: COOKIE_ORGANIZER, out: 'host/events/hacktron-2026/settings/index.html' },

  // Judge
  { url: '/judge/events', cookie: COOKIE_JUDGE, out: 'judge/events/index.html' },
  { url: '/judge/reviews', cookie: COOKIE_JUDGE, out: 'judge/reviews/index.html' },
  { url: '/judge/events/sample-hack-2026', cookie: COOKIE_JUDGE, out: 'judge/events/sample-hack-2026/index.html' },
  { url: '/judge/review/asg_684ooj7pfg9k', cookie: COOKIE_JUDGE, out: 'judge/review/asg_684ooj7pfg9k/index.html' },

  // Healthz
  { url: '/healthz', out: 'healthz/index.html' },
  { url: '/api/v1', out: 'api/v1/index.html' }
];

async function run() {
  console.log(`Exporting pages from ${BASE}...`);
  for (const r of ROUTES) {
    const headers = {};
    if (r.cookie) headers['cookie'] = r.cookie;
    try {
      const res = await fetch(`${BASE}${r.url}`, { headers });
      if (!res.ok && res.status !== 304) {
        console.warn(`[WARN] ${r.url} -> ${res.status}`);
        continue;
      }
      const text = await res.text();
      const dest = path.join(PUBLIC, r.out);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, text, 'utf8');
      console.log(`✔ Saved ${r.out}`);
    } catch (e) {
      console.error(`✖ Failed ${r.url}:`, e.message);
    }
  }
  console.log('Site export complete!');
}

run();
