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

test('Event Lifecycle - GET /api/events lists active hackathons with stats', async () => {
  const res = await request('/api/events');
  assert.strictEqual(res.status, 200);
  const data = JSON.parse(res.body);
  assert(Array.isArray(data.events));
  assert(data.events.length >= 1);
  const first = data.events[0];
  assert(first.id);
  assert(first.name);
  assert(first.stats);
  assert(typeof first.stats.projects_count === 'number');
  assert(typeof first.stats.teams_count === 'number');
});

test('Event Lifecycle - POST /api/events creates a new hackathon with organizer role', async () => {
  // 1. Unauthenticated creation is rejected with 401
  const unauthRes = await request('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { name: 'Unauthorized Hackathon' }
  });
  assert.strictEqual(unauthRes.status, 401);

  // 2. Authenticated user creates a new hackathon
  const createRes = await request('/api/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'session=prt_2e88' // Priya Nair creates her own hackathon!
    },
    body: {
      name: 'Autonomous Systems Hackathon 2026',
      description: 'Building verifiable agentic protocols and decentralized infrastructure',
      submissions_close: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
      tracks: [
        { id: 'trk_agents', name: 'Agents', description: 'Autonomous agents' },
        { id: 'trk_tools', name: 'Developer Tools', description: 'Compilers and debuggers' }
      ]
    }
  });

  assert.strictEqual(createRes.status, 201);
  const createData = JSON.parse(createRes.body);
  assert.strictEqual(createData.role, 'organizer');
  assert(createData.event && createData.event.id);
  const newEventId = createData.event.id;

  // 3. Verify the user is Organizer for new event, but remains Participant for seeded event
  const myEventsRes = await request('/api/user/events', {
    headers: { 'Cookie': 'session=prt_2e88' }
  });
  assert.strictEqual(myEventsRes.status, 200);
  const myEvents = JSON.parse(myEventsRes.body).events;
  const newEvtMem = myEvents.find(e => e.id === newEventId);
  assert(newEvtMem);
  assert.strictEqual(newEvtMem.role, 'organizer');

  // Seeded event membership is participant
  const seededEvtMem = myEvents.find(e => e.id !== newEventId);
  if (seededEvtMem) {
    assert.strictEqual(seededEvtMem.role, 'participant');
  }
});

test('Event Lifecycle - Registration & Team Collaboration', async () => {
  // Create a fresh open hackathon
  const createRes = await request('/api/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'session=org_7f2a'
    },
    body: {
      name: 'Collab Hackathon 2026',
      submissions_close: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString()
    }
  });
  assert.strictEqual(createRes.status, 201);
  const newEventId = JSON.parse(createRes.body).event.id;

  // Register participant in this event
  const regRes = await request(`/api/events/${newEventId}/register`, {
    method: 'POST',
    headers: { 'Cookie': 'session=prt_2e88' }
  });
  assert.strictEqual(regRes.status, 201);
  const regData = JSON.parse(regRes.body);
  assert.strictEqual(regData.role, 'participant');

  // Create a team in this event
  const teamRes = await request('/api/teams', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'session=prt_2e88',
      'x-event-id': newEventId
    },
    body: { name: 'Team Hyperdrive' }
  });
  assert.strictEqual(teamRes.status, 201);
  const teamId = JSON.parse(teamRes.body).team_id;
  assert(teamId);

  // Save a project draft
  const draftRes = await request('/api/submissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'session=prt_2e88',
      'x-event-id': newEventId
    },
    body: {
      title: 'Hyperdrive Protocol (Draft)',
      summary: 'Drafting our autonomous compute engine',
      is_draft: true,
      team_id: teamId
    }
  });
  assert.strictEqual(draftRes.status, 201);
  const draftData = JSON.parse(draftRes.body);
  assert.strictEqual(draftData.status, 'draft');
  const projectId = draftData.project_id;

  // Verify draft does NOT appear in public gallery for this event
  const galleryRes = await request(`/api/projects?event_id=${newEventId}`);
  assert.strictEqual(galleryRes.status, 200);
  const galleryProjects = JSON.parse(galleryRes.body).projects;
  const draftInGallery = galleryProjects.find(p => p.id === projectId);
  assert(!draftInGallery, 'Draft project must NEVER leak into public gallery');

  // Promote draft to submitted
  const submitRes = await request('/api/submissions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': 'session=prt_2e88',
      'x-event-id': newEventId
    },
    body: {
      title: 'Hyperdrive Protocol',
      summary: 'Production-ready autonomous compute engine',
      repo_url: 'https://github.com/hyperdrive/engine',
      demo_url: 'https://hyperdrive.example.org',
      team_id: teamId,
      status: 'submitted'
    }
  });
  assert.strictEqual(submitRes.status, 200);
  const submitData = JSON.parse(submitRes.body);
  assert.strictEqual(submitData.status, 'submitted');

  // Now project DOES appear in public gallery
  const galleryUpdated = await request(`/api/projects?event_id=${newEventId}`);
  const updatedProjects = JSON.parse(galleryUpdated.body).projects;
  const submittedInGallery = updatedProjects.find(p => p.id === projectId);
  assert(submittedInGallery, 'Submitted project must now appear in public gallery');
  assert.strictEqual(submittedInGallery.title, 'Hyperdrive Protocol');
});

test('Event Lifecycle - Hoster can add and remove evaluation judges with track specialties', async () => {
  const orgCookie = 'session=org_7f2a';

  // Add judge with track specialty
  const addRes = await request('/api/organizer/judges', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': orgCookie,
      'x-event-id': 'evt_01'
    },
    body: {
      name: 'Dr. Sarah Chen',
      email: 'sarah.chen@evaluation.org',
      track_ids: ['trk_01']
    }
  });

  assert.strictEqual(addRes.status, 201);
  const addData = JSON.parse(addRes.body);
  assert.strictEqual(addData.judge.name, 'Dr. Sarah Chen');
  assert.strictEqual(addData.judge.email, 'sarah.chen@evaluation.org');
  assert.strictEqual(addData.judge.tracks.length, 1);
  const judgeId = addData.judge.id;

  // Verify judge appears in judges list
  const listRes = await request('/api/organizer/judges', {
    headers: {
      'Cookie': orgCookie,
      'x-event-id': 'evt_01'
    }
  });
  assert.strictEqual(listRes.status, 200);
  const listData = JSON.parse(listRes.body);
  const foundJudge = listData.judges.find(j => j.id === judgeId);
  assert(foundJudge, 'Newly added judge must appear in organizer judges list');

  // Verify Sarah can log in via Google now that host has added her
  const googleRes = await request('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-event-id': 'evt_01' },
    body: {
      credential: 'mock_google_sarah.chen@evaluation.org'
    }
  });
  assert.strictEqual(googleRes.status, 200);
  const googleData = JSON.parse(googleRes.body);
  assert.strictEqual(googleData.role, 'judge');

  // Remove judge
  const delRes = await request(`/api/organizer/judges/${judgeId}`, {
    method: 'DELETE',
    headers: {
      'Cookie': orgCookie,
      'x-event-id': 'evt_01'
    }
  });
  assert.strictEqual(delRes.status, 200);
});
