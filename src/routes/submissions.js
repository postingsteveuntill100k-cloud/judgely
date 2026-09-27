const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireRole } = require('../middleware/rbac');
const { recordAuditLog } = require('../services/audit');

// Handle submission check and processing
function handleSubmission(req, res) {
  const db = getDb();
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get('evt_01');

  if (!event) {
    return res.status(404).json({ error: 'Event not found' });
  }

  // DOGFOOD Check 3: Closed event refuses submissions with 4xx
  const now = new Date();
  const closeDate = new Date(event.submissions_close);

  if (now > closeDate) {
    return res.status(403).json({
      error: 'Submissions closed',
      message: `Submissions closed on ${event.submissions_close}. Late submissions are strictly rejected by portal policy.`,
      submissions_close: event.submissions_close
    });
  }

  // If open, validate authenticated participant
  if (!req.user || req.user.role !== 'participant') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Only registered participants can submit projects.'
    });
  }

  const { title, summary, repo_url, track_id, team_name } = req.body || {};
  
  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    return res.status(400).json({ error: 'Project title is required (minimum 2 characters)' });
  }
  if (title.length > 150) {
    return res.status(400).json({ error: 'Project title cannot exceed 150 characters' });
  }

  // Validate track existence if provided
  let selectedTrackId = track_id;
  if (selectedTrackId) {
    const trackExists = db.prepare('SELECT id FROM tracks WHERE id = ? AND event_id = ?').get(selectedTrackId, event.id);
    if (!trackExists) {
      return res.status(400).json({ error: `Track '${selectedTrackId}' does not exist in this event` });
    }
  } else {
    // Default to first track if omitted
    const firstTrack = db.prepare('SELECT id FROM tracks WHERE event_id = ? LIMIT 1').get(event.id);
    selectedTrackId = firstTrack ? firstTrack.id : 'trk_01';
  }

  // Create or resolve team
  let teamId = null;
  const existingTeam = db.prepare('SELECT id FROM teams WHERE name = ?').get(team_name || req.user.name);
  if (existingTeam) {
    teamId = existingTeam.id;
  } else {
    teamId = `tm_${Date.now()}`;
    db.prepare('INSERT INTO teams (id, event_id, name) VALUES (?, ?, ?)').run(
      teamId,
      event.id,
      (team_name && typeof team_name === 'string') ? team_name.trim() : `${req.user.name}'s Team`
    );
    // Add participant to team_members
    db.prepare('INSERT OR IGNORE INTO team_members (team_id, email, user_id) VALUES (?, ?, ?)').run(
      teamId,
      req.user.email,
      req.user.id
    );
  }

  const projectId = `prj_${Date.now()}`;
  db.prepare(`
    INSERT INTO projects (id, event_id, team_id, track_id, title, summary, repo_url, submitted_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
  `).run(
    projectId,
    event.id,
    teamId,
    selectedTrackId,
    title.trim(),
    (summary && typeof summary === 'string') ? summary.trim() : '',
    (repo_url && typeof repo_url === 'string') ? repo_url.trim() : '',
    now.toISOString()
  );

  recordAuditLog({
    eventId: event.id,
    userId: req.user.id,
    role: req.user.role,
    action: 'project.submitted',
    resourceType: 'project',
    resourceId: projectId,
    details: { title: title.trim(), teamId, trackId: selectedTrackId }
  });

  return res.status(201).json({
    message: 'Project submitted successfully',
    project_id: projectId
  });
}

// POST /projects/new (Targeted by .dogfood.toml submit route)
router.post('/projects/new', handleSubmission);

// POST /api/submissions
router.post('/api/submissions', handleSubmission);

// GET /projects/new - Returns status or form
router.get('/projects/new', (req, res) => {
  const db = getDb();
  const event = db.prepare('SELECT * FROM events WHERE id = ?').get('evt_01');
  const isClosed = event ? (new Date() > new Date(event.submissions_close)) : true;

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      event_id: event ? event.id : null,
      is_closed: isClosed,
      submissions_close: event ? event.submissions_close : null
    });
  }

  // Redirect to SPA submit action
  res.redirect('/#submit');
});

module.exports = router;
