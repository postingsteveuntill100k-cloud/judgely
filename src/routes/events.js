const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDb } = require('../db/database');
const { recordAuditLog } = require('../services/audit');

/**
 * Helper to compute event lifecycle status
 */
function getEventStatus(event) {
  if (event.results_released) {
    return 'RESULTS_RELEASED';
  }
  const now = new Date();
  const closeDate = new Date(event.submissions_close);
  if (now > closeDate) {
    return 'JUDGING';
  }
  return 'SUBMISSIONS_OPEN';
}

// GET /api/events - List all hackathons with live stats & user membership
router.get('/api/events', (req, res) => {
  const db = getDb();
  const events = db.prepare(`
    SELECT id, name, description, submissions_close, results_released, created_at
    FROM events
    ORDER BY created_at DESC
  `).all();

  const userMemberships = {};
  if (req.user && req.user.id) {
    const mems = db.prepare(`
      SELECT event_id, role, status FROM event_memberships
      WHERE user_id = ? AND status = 'active'
    `).all(req.user.id);
    for (const m of mems) {
      userMemberships[m.event_id] = m.role;
    }
  }

  const enriched = events.map(evt => {
    const stats = {
      projects_count: db.prepare(`SELECT COUNT(*) AS count FROM projects WHERE event_id = ? AND status = 'submitted'`).get(evt.id).count,
      teams_count: db.prepare(`SELECT COUNT(*) AS count FROM teams WHERE event_id = ?`).get(evt.id).count,
      tracks_count: db.prepare(`SELECT COUNT(*) AS count FROM tracks WHERE event_id = ?`).get(evt.id).count,
      judges_count: db.prepare(`SELECT COUNT(*) AS count FROM judges WHERE event_id = ?`).get(evt.id).count
    };

    const status = getEventStatus(evt);
    const userRole = userMemberships[evt.id] || (req.user && req.user.role === 'visitor' ? null : null);

    return {
      id: evt.id,
      name: evt.name,
      description: evt.description,
      submissions_close: evt.submissions_close,
      results_released: Boolean(evt.results_released),
      created_at: evt.created_at,
      status,
      stats,
      user_role: userRole
    };
  });

  res.json({ events: enriched });
});

// GET /api/events/:id - Detailed event data
router.get('/api/events/:id', (req, res) => {
  const db = getDb();
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  const tracks = db.prepare('SELECT id, name, description FROM tracks WHERE event_id = ?').all(event.id);
  const rubric = db.prepare('SELECT id, name, description, weight, max_score FROM rubric_criteria WHERE event_id = ?').all(event.id);

  let userRole = null;
  if (req.user && req.user.id) {
    const mem = db.prepare('SELECT role FROM event_memberships WHERE event_id = ? AND user_id = ? AND status = \'active\'').get(event.id, req.user.id);
    if (mem) userRole = mem.role;
  }

  res.json({
    event: {
      ...event,
      results_released: Boolean(event.results_released),
      status: getEventStatus(event)
    },
    tracks,
    rubric,
    user_role: userRole
  });
});

// POST /api/events - Create a new Hackathon (Self-Service Organizer Lifecycle)
router.post('/api/events', (req, res) => {
  if (!req.user || req.user.role === 'visitor') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'You must be signed in to create and host a hackathon.'
    });
  }

  const db = getDb();
  const { name, description, submissions_close, tracks, rubric } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 3) {
    return res.status(400).json({ error: 'Hackathon name is required (minimum 3 characters).' });
  }

  // Generate event ID
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 16);
  const eventId = `evt_${slug}_${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();

  // Submissions deadline defaults to 14 days from now if not provided
  let closeIso = submissions_close;
  if (!closeIso || isNaN(new Date(closeIso).getTime())) {
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    closeIso = future.toISOString();
  }

  db.prepare(`
    INSERT INTO events (id, name, description, submissions_close, results_released, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    eventId,
    name.trim(),
    (description && typeof description === 'string') ? description.trim() : 'A premier open hackathon on Judgely.',
    closeIso,
    now
  );

  // Insert tracks
  const defaultTracks = [
    { id: `trk_${eventId}_1`, name: 'Autonomous Systems & AI', description: 'Agentic workflows, self-improving loops, and cognitive architecture.' },
    { id: `trk_${eventId}_2`, name: 'Developer Tools & Infra', description: 'Core compilers, debugging harnesses, and open protocols.' },
    { id: `trk_${eventId}_3`, name: 'Open Innovation', description: 'Moonshot applications pushing creative boundaries.' }
  ];

  const tracksToInsert = (Array.isArray(tracks) && tracks.length > 0) ? tracks : defaultTracks;
  const insertTrack = db.prepare('INSERT INTO tracks (id, event_id, name, description) VALUES (?, ?, ?, ?)');
  tracksToInsert.forEach((t, i) => {
    const rawId = (typeof t === 'string') ? t : (t.id || `track_${i + 1}`);
    const tId = rawId.startsWith(`${eventId}_`) ? rawId : `${eventId}_${rawId}`;
    const tName = (typeof t === 'string') ? t : (t.name || `Track ${i + 1}`);
    const tDesc = (typeof t === 'string') ? '' : (t.description || '');
    insertTrack.run(tId, eventId, tName, tDesc);
  });

  // Insert rubric criteria
  const defaultRubric = [
    { name: 'technical_execution', weight: 0.40, max_score: 5.0, description: 'Code architecture, test coverage, and execution reliability' },
    { name: 'innovation', weight: 0.35, max_score: 5.0, description: 'Novelty, creative insight, and differentiated approach' },
    { name: 'practical_utility', weight: 0.25, max_score: 5.0, description: 'Real-world impact, UX polish, and documentation' }
  ];

  const rubricToInsert = (Array.isArray(rubric) && rubric.length > 0) ? rubric : defaultRubric;
  const insertRubric = db.prepare('INSERT INTO rubric_criteria (id, event_id, name, description, weight, max_score) VALUES (?, ?, ?, ?, ?, ?)');
  rubricToInsert.forEach((r, i) => {
    const rawName = (typeof r === 'string') ? r : (r.name || `criterion_${i + 1}`);
    const cId = `crit_${eventId}_${crypto.randomUUID().slice(0, 6)}`;
    const cDesc = (typeof r === 'string') ? '' : (r.description || '');
    const cWeight = (typeof r === 'string') ? 1.0 : (Number(r.weight) || 1.0);
    const cMax = (typeof r === 'string') ? 5.0 : (Number(r.max_score) || 5.0);
    insertRubric.run(cId, eventId, rawName, cDesc, cWeight, cMax);
  });

  // Creator becomes Organizer in event_memberships
  db.prepare(`
    INSERT INTO event_memberships (id, event_id, user_id, role, status, created_at)
    VALUES (?, ?, ?, 'organizer', 'active', ?)
  `).run(`mem_${crypto.randomUUID()}`, eventId, req.user.id, now);

  // If user role was visitor, promote to organizer globally as well
  if (req.user.role === 'visitor') {
    db.prepare(`UPDATE users SET role = 'organizer' WHERE id = ?`).run(req.user.id);
  }

  recordAuditLog({
    eventId,
    userId: req.user.id,
    role: 'organizer',
    action: 'event.created',
    resourceType: 'event',
    resourceId: eventId,
    details: { name: name.trim(), submissions_close: closeIso }
  });

  res.status(201).json({
    message: 'Hackathon created successfully! You are the event organizer.',
    event: {
      id: eventId,
      name: name.trim(),
      description: description || '',
      submissions_close: closeIso,
      results_released: false,
      status: 'SUBMISSIONS_OPEN'
    },
    role: 'organizer'
  });
});

// POST /api/events/:id/register - Register as Participant for an event
router.post('/api/events/:id/register', (req, res) => {
  if (!req.user || req.user.role === 'visitor') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'You must sign in before registering for a hackathon.'
    });
  }

  const db = getDb();
  const eventId = req.params.id;
  const event = db.prepare('SELECT id, name, submissions_close FROM events WHERE id = ?').get(eventId);

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // Check if already registered
  const existingMem = db.prepare('SELECT role, status FROM event_memberships WHERE event_id = ? AND user_id = ?').get(eventId, req.user.id);
  if (existingMem) {
    return res.json({
      message: `You are already registered for '${event.name}' as ${existingMem.role}.`,
      role: existingMem.role,
      event_id: eventId
    });
  }

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO event_memberships (id, event_id, user_id, role, status, created_at)
    VALUES (?, ?, ?, 'participant', 'active', ?)
  `).run(`mem_${crypto.randomUUID()}`, eventId, req.user.id, now);

  recordAuditLog({
    eventId,
    userId: req.user.id,
    role: 'participant',
    action: 'participant.registered',
    resourceType: 'event_membership',
    resourceId: eventId,
    details: { eventName: event.name }
  });

  res.status(201).json({
    message: `Successfully registered for '${event.name}'! Welcome to the competition.`,
    role: 'participant',
    event_id: eventId
  });
});

// GET /api/user/events - List all events associated with the authenticated user
router.get('/api/user/events', (req, res) => {
  if (!req.user || req.user.role === 'visitor') {
    return res.json({ events: [] });
  }

  const db = getDb();
  const myEvents = db.prepare(`
    SELECT e.id, e.name, e.description, e.submissions_close, e.results_released, em.role, em.status
    FROM event_memberships em
    JOIN events e ON em.event_id = e.id
    WHERE em.user_id = ? AND em.status = 'active'
    ORDER BY e.created_at DESC
  `).all(req.user.id).map(e => ({
    ...e,
    results_released: Boolean(e.results_released),
    status: getEventStatus(e)
  }));

  res.json({ events: myEvents });
});

module.exports = router;
