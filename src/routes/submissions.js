const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireRole, requireEventMembership } = require('../middleware/rbac');
const { eventMiddleware } = require('../middleware/event');
const { recordAuditLog } = require('../services/audit');

// Helper to validate and sanitize URLs (prevent javascript: or data: injection)
function isValidHttpUrl(string) {
  if (!string || typeof string !== 'string') return true;
  const s = string.trim();
  if (!s) return true;
  return /^https?:\/\/[^\s$.?#].[^\s]*$/i.test(s);
}

// Handle project submission with team ownership and deadline enforcement
function handleSubmission(req, res) {
  const db = getDb();
  const event = req.event;

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

  // Validate authenticated participant
  if (!req.user || req.user.role !== 'participant') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Only registered participants can submit projects.'
    });
  }

  // Verify participant membership in this event
  const eventMem = db.prepare(`
    SELECT role, status FROM event_memberships
    WHERE event_id = ? AND user_id = ? AND status = 'active'
  `).get(req.eventId, req.user.id);

  if (!eventMem) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Access denied: You do not have an active participant registration for event '${req.eventId}'.`
    });
  }

  const { title, summary, repo_url, demo_url, tech_stack, track_id, team_id, team_name } = req.body || {};

  if (!title || typeof title !== 'string' || title.trim().length < 2) {
    return res.status(400).json({ error: 'Project title is required (minimum 2 characters)' });
  }
  if (title.length > 150) {
    return res.status(400).json({ error: 'Project title cannot exceed 150 characters' });
  }

  // URL security validation (Bug 6)
  if (repo_url && !isValidHttpUrl(repo_url)) {
    return res.status(400).json({ error: 'Invalid repository URL. Only http:// or https:// URLs are allowed.' });
  }
  if (demo_url && !isValidHttpUrl(demo_url)) {
    return res.status(400).json({ error: 'Invalid demo URL. Only http:// or https:// URLs are allowed.' });
  }

  // Validate track existence
  let selectedTrackId = track_id;
  if (selectedTrackId) {
    const trackExists = db.prepare('SELECT id FROM tracks WHERE id = ? AND event_id = ?').get(selectedTrackId, req.eventId);
    if (!trackExists) {
      return res.status(400).json({ error: `Track '${selectedTrackId}' does not exist in this event` });
    }
  } else {
    const firstTrack = db.prepare('SELECT id FROM tracks WHERE event_id = ? ORDER BY id ASC LIMIT 1').get(req.eventId);
    selectedTrackId = firstTrack ? firstTrack.id : 'trk_01';
  }

  // BUG 8 Fix: Real Team Ownership Validation
  let resolvedTeamId = null;

  if (team_id) {
    // Explicit team requested: verify existence and membership
    const team = db.prepare('SELECT id, event_id FROM teams WHERE id = ?').get(team_id);
    if (!team) {
      return res.status(404).json({ error: `Team '${team_id}' not found` });
    }
    if (team.event_id !== req.eventId) {
      return res.status(400).json({ error: `Team belongs to a different event` });
    }

    // Verify participant is a member of this team
    const membership = db.prepare(`
      SELECT role FROM team_members
      WHERE team_id = ? AND (user_id = ? OR email = ?)
    `).get(team_id, req.user.id, req.user.email);

    if (!membership) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: You are not an enrolled member of this team.'
      });
    }

    resolvedTeamId = team.id;
  } else {
    // Check if participant already belongs to a team in this event
    const existingMembership = db.prepare(`
      SELECT t.id
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE t.event_id = ? AND (tm.user_id = ? OR tm.email = ?)
      LIMIT 1
    `).get(req.eventId, req.user.id, req.user.email);

    if (existingMembership) {
      resolvedTeamId = existingMembership.id;
    } else {
      // Create new team owned by participant
      resolvedTeamId = `tm_${Date.now()}`;
      const safeTeamName = (team_name && typeof team_name === 'string' && team_name.trim())
        ? team_name.trim()
        : `${req.user.name}'s Team`;

      db.prepare(`
        INSERT INTO teams (id, event_id, name, created_by, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(resolvedTeamId, req.eventId, safeTeamName, req.user.id, now.toISOString());

      db.prepare(`
        INSERT OR IGNORE INTO team_members (team_id, email, user_id, role)
        VALUES (?, ?, ?, 'lead')
      `).run(resolvedTeamId, req.user.email, req.user.id);
    }
  }

  // BUG 9 Fix: Verify team does not already have an active submission
  const existingProject = db.prepare(`
    SELECT id, title FROM projects
    WHERE team_id = ? AND event_id = ? AND status != 'withdrawn'
  `).get(resolvedTeamId, req.eventId);

  if (existingProject) {
    return res.status(409).json({
      error: 'Conflict',
      message: `Your team has already submitted project '${existingProject.title}' (${existingProject.id}). Please update your existing submission instead.`,
      project_id: existingProject.id
    });
  }

  const projectId = `prj_${Date.now()}`;
  db.prepare(`
    INSERT INTO projects (id, event_id, team_id, track_id, title, summary, tech_stack, repo_url, demo_url, submitted_at, updated_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
  `).run(
    projectId,
    req.eventId,
    resolvedTeamId,
    selectedTrackId,
    title.trim(),
    (summary && typeof summary === 'string') ? summary.trim() : '',
    (tech_stack && typeof tech_stack === 'string') ? tech_stack.trim() : '',
    (repo_url && typeof repo_url === 'string') ? repo_url.trim() : '',
    (demo_url && typeof demo_url === 'string') ? demo_url.trim() : '',
    now.toISOString(),
    now.toISOString()
  );

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'project.submitted',
    resourceType: 'project',
    resourceId: projectId,
    details: { title: title.trim(), teamId: resolvedTeamId, trackId: selectedTrackId }
  });

  return res.status(201).json({
    message: 'Project submitted successfully',
    project_id: projectId,
    team_id: resolvedTeamId
  });
}

// Mount event resolution middleware for submission routes
router.use('/projects/new', eventMiddleware);
router.use('/api/submissions', eventMiddleware);
router.use('/api/projects', eventMiddleware);
router.use('/api/participant', eventMiddleware);
router.use('/api/teams', eventMiddleware);

// POST /projects/new (Targeted by .dogfood.toml submit route)
router.post('/projects/new', handleSubmission);

// POST /api/submissions
router.post('/api/submissions', handleSubmission);

// GET /projects/new - Returns submission status JSON or redirect
router.get('/projects/new', (req, res) => {
  const isClosed = req.event ? (new Date() > new Date(req.event.submissions_close)) : true;

  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.json({
      event_id: req.eventId,
      is_closed: isClosed,
      submissions_close: req.event ? req.event.submissions_close : null
    });
  }

  res.redirect('/#participant');
});

// GET /api/participant/workspace - Full participant workspace state
router.get('/api/participant/workspace', requireRole('participant'), requireEventMembership, (req, res) => {
  const db = getDb();

  // Find team
  const teamStmt = db.prepare(`
    SELECT t.id, t.name, t.event_id, t.created_by, tm.role AS member_role
    FROM team_members tm
    JOIN teams t ON tm.team_id = t.id
    WHERE t.event_id = ? AND (tm.user_id = ? OR tm.email = ?)
    LIMIT 1
  `);
  const team = teamStmt.get(req.eventId, req.user.id, req.user.email);

  let teamMembers = [];
  let project = null;

  if (team) {
    teamMembers = db.prepare(`
      SELECT tm.email, tm.user_id, tm.role, u.name
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
    `).all(team.id);

    project = db.prepare(`
      SELECT p.*, tr.name AS track_name
      FROM projects p
      LEFT JOIN tracks tr ON p.track_id = tr.id
      WHERE p.team_id = ? AND p.event_id = ?
    `).get(team.id, req.eventId);
  }

  const isClosed = new Date() > new Date(req.event.submissions_close);

  res.json({
    event: {
      id: req.event.id,
      name: req.event.name,
      submissions_close: req.event.submissions_close,
      is_closed: isClosed,
      results_released: Boolean(req.event.results_released)
    },
    user: req.user,
    team: team || null,
    members: teamMembers,
    project: project || null
  });
});

// PUT /api/projects/:id - Edit project with ownership and event scoping (Bug 5 & 18)
router.put('/api/projects/:id', requireRole('participant', 'organizer'), requireEventMembership, (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  // Scope project lookup strictly to current event
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND event_id = ?').get(projectId, req.eventId);

  if (!project) {
    return res.status(404).json({ error: 'Project not found in this event' });
  }

  // If participant, check ownership and deadline
  if (req.user.role === 'participant') {
    const isClosed = new Date() > new Date(req.event.submissions_close);
    if (isClosed) {
      return res.status(403).json({ error: 'Submissions closed', message: 'Submissions are closed. Projects cannot be modified.' });
    }

    const membership = db.prepare(`
      SELECT role FROM team_members
      WHERE team_id = ? AND (user_id = ? OR email = ?)
    `).get(project.team_id, req.user.id, req.user.email);

    if (!membership) {
      return res.status(403).json({ error: 'Forbidden', message: 'Access denied: You do not own this project.' });
    }
  }

  const { title, summary, repo_url, demo_url, tech_stack, track_id } = req.body || {};

  if (title && (typeof title !== 'string' || title.trim().length < 2)) {
    return res.status(400).json({ error: 'Title must be at least 2 characters' });
  }
  if (repo_url && !isValidHttpUrl(repo_url)) {
    return res.status(400).json({ error: 'Invalid repository URL' });
  }
  if (demo_url && !isValidHttpUrl(demo_url)) {
    return res.status(400).json({ error: 'Invalid demo URL' });
  }

  // Rule 18: Track must belong to current event
  if (track_id) {
    const trackExists = db.prepare('SELECT id FROM tracks WHERE id = ? AND event_id = ?').get(track_id, req.eventId);
    if (!trackExists) {
      return res.status(400).json({ error: `Track '${track_id}' does not belong to event '${req.eventId}'` });
    }
  }

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE projects SET
      title = COALESCE(?, title),
      summary = COALESCE(?, summary),
      repo_url = COALESCE(?, repo_url),
      demo_url = COALESCE(?, demo_url),
      tech_stack = COALESCE(?, tech_stack),
      track_id = COALESCE(?, track_id),
      updated_at = ?
    WHERE id = ? AND event_id = ?
  `).run(
    title ? title.trim() : null,
    summary !== undefined ? summary.trim() : null,
    repo_url !== undefined ? repo_url.trim() : null,
    demo_url !== undefined ? demo_url.trim() : null,
    tech_stack !== undefined ? tech_stack.trim() : null,
    track_id || null,
    now,
    projectId,
    req.eventId
  );

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'project.updated',
    resourceType: 'project',
    resourceId: projectId,
    details: { updatedFields: req.body }
  });

  res.json({ message: 'Project updated successfully', project_id: projectId });
});

// POST /api/projects/:id/withdraw - Withdraw project with ownership check (Bug 5 & 9)
router.post('/api/projects/:id/withdraw', requireRole('participant', 'organizer'), requireEventMembership, (req, res) => {
  const db = getDb();
  const projectId = req.params.id;
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND event_id = ?').get(projectId, req.eventId);

  if (!project) {
    return res.status(404).json({ error: 'Project not found in this event' });
  }

  if (req.user.role === 'participant') {
    const membership = db.prepare(`
      SELECT role FROM team_members
      WHERE team_id = ? AND (user_id = ? OR email = ?)
    `).get(project.team_id, req.user.id, req.user.email);

    if (!membership) {
      return res.status(403).json({ error: 'Forbidden', message: 'You do not own this project.' });
    }
  }

  db.prepare("UPDATE projects SET status = 'withdrawn', updated_at = ? WHERE id = ? AND event_id = ?").run(new Date().toISOString(), projectId, req.eventId);

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'project.withdrawn',
    resourceType: 'project',
    resourceId: projectId
  });

  res.json({ message: 'Project withdrawn successfully', project_id: projectId });
});

// POST /api/teams - Create a team explicitly
router.post('/api/teams', requireRole('participant'), requireEventMembership, (req, res) => {
  const db = getDb();
  const { name } = req.body || {};

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Team name is required (minimum 2 characters)' });
  }

  const teamId = `tm_${Date.now()}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO teams (id, event_id, name, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(teamId, req.eventId, name.trim(), req.user.id, now);

  db.prepare(`
    INSERT INTO team_members (team_id, email, user_id, role)
    VALUES (?, ?, ?, 'lead')
  `).run(teamId, req.user.email, req.user.id);

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'team.created',
    resourceType: 'team',
    resourceId: teamId,
    details: { name: name.trim() }
  });

  res.status(201).json({
    message: 'Team created successfully',
    team_id: teamId,
    name: name.trim()
  });
});

module.exports = router;
