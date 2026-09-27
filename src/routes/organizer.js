const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDb } = require('../db/database');
const { requireRole, requireEventMembership } = require('../middleware/rbac');
const { eventMiddleware } = require('../middleware/event');
const { getJudgingHealth } = require('../services/health');
const { getAuditLogs, recordAuditLog } = require('../services/audit');

// All organizer endpoints strictly require 'organizer' role, event resolution, and event membership
router.use('/api/organizer', eventMiddleware, requireRole('organizer'), requireEventMembership);

// GET /api/organizer/overview
router.get('/api/organizer/overview', (req, res) => {
  const db = getDb();
  const health = getJudgingHealth(req.eventId);
  const audits = getAuditLogs(25, req.eventId);
  const event = db.prepare('SELECT id, name, description, submissions_close, results_released FROM events WHERE id = ?').get(req.eventId);

  res.json({
    event,
    health,
    recent_audits: audits
  });
});

// GET /api/organizer/health
router.get('/api/organizer/health', (req, res) => {
  const health = getJudgingHealth(req.eventId);
  res.json({ health });
});

// GET /api/organizer/projects
router.get('/api/organizer/projects', (req, res) => {
  const db = getDb();
  const projects = db.prepare(`
    SELECT 
      p.id, p.event_id, p.team_id, p.track_id, p.title, p.summary,
      p.tech_stack, p.repo_url, p.demo_url, p.status, p.submitted_at,
      t.name AS track_name,
      tm.name AS team_name,
      COUNT(DISTINCT a.id) AS assignments_count,
      COUNT(DISTINCT r.id) AS reviews_count
    FROM projects p
    LEFT JOIN tracks t ON p.track_id = t.id
    LEFT JOIN teams tm ON p.team_id = tm.id
    LEFT JOIN judge_assignments a ON a.project_id = p.id
    LEFT JOIN reviews r ON r.project_id = p.id
    WHERE p.event_id = ?
    GROUP BY p.id
    ORDER BY p.submitted_at DESC
  `).all(req.eventId);
  res.json({ projects });
});

// GET /api/organizer/teams
router.get('/api/organizer/teams', (req, res) => {
  const db = getDb();
  const teams = db.prepare(`
    SELECT 
      t.id, t.name, t.created_at,
      u.name AS lead_name,
      u.email AS lead_email,
      COUNT(DISTINCT tm.email) AS member_count,
      p.id AS project_id,
      p.title AS project_title,
      p.status AS project_status
    FROM teams t
    LEFT JOIN users u ON t.created_by = u.id
    LEFT JOIN team_members tm ON tm.team_id = t.id
    LEFT JOIN projects p ON p.team_id = t.id AND p.status != 'withdrawn'
    WHERE t.event_id = ?
    GROUP BY t.id
    ORDER BY t.name ASC
  `).all(req.eventId);
  res.json({ teams });
});

// GET /api/organizer/judges
router.get('/api/organizer/judges', (req, res) => {
  const db = getDb();
  const judges = db.prepare(`
    SELECT 
      j.id, j.name, j.email, j.user_id,
      COUNT(DISTINCT a.id) AS assignments_count,
      COUNT(DISTINCT r.id) AS completed_reviews
    FROM judges j
    LEFT JOIN judge_assignments a ON a.judge_id = j.id AND a.event_id = j.event_id
    LEFT JOIN reviews r ON r.judge_id = j.id AND r.event_id = j.event_id
    WHERE j.event_id = ?
    GROUP BY j.id
    ORDER BY j.name ASC
  `).all(req.eventId).map(j => {
    const tracks = db.prepare(`
      SELECT t.id, t.name FROM judge_tracks jt
      JOIN tracks t ON jt.track_id = t.id
      WHERE jt.judge_id = ?
    `).all(j.id);
    return {
      ...j,
      tracks
    };
  });
  res.json({ judges });
});

// POST /api/organizer/judges - Add a new judge to the hackathon
router.post('/api/organizer/judges', (req, res) => {
  const db = getDb();
  const { name, email, track_ids, tracks } = req.body || {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Valid judge name is required' });
  }

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid judge email address is required' });
  }

  const cleanEmail = email.trim().toLowerCase();
  const cleanName = name.trim();

  // Check if judge already registered for this event
  const existingJudge = db.prepare('SELECT id FROM judges WHERE event_id = ? AND email = ? COLLATE NOCASE').get(req.eventId, cleanEmail);
  if (existingJudge) {
    return res.status(409).json({ error: `Judge with email '${cleanEmail}' is already registered for this event` });
  }

  // 1. Locate or create Judgely user account
  let user = db.prepare('SELECT id, role FROM users WHERE email = ? COLLATE NOCASE').get(cleanEmail);
  if (!user) {
    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, name, role, created_at)
      VALUES (?, ?, ?, 'judge', ?)
    `).run(userId, cleanEmail, cleanName, now);
    user = { id: userId, role: 'judge' };
  } else if (user.role === 'visitor') {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run('judge', user.id);
  }

  // 2. Generate judge record
  const judgeId = `jdg_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO judges (id, event_id, user_id, name, email)
    VALUES (?, ?, ?, ?, ?)
  `).run(judgeId, req.eventId, user.id, cleanName, cleanEmail);

  // 3. Create active event membership
  db.prepare(`
    INSERT OR IGNORE INTO event_memberships (id, event_id, user_id, role, status, created_at)
    VALUES (?, ?, ?, 'judge', 'active', ?)
  `).run(`mem_${crypto.randomUUID()}`, req.eventId, user.id, new Date().toISOString());

  // 4. Associate tracks if provided
  const targetTracks = Array.isArray(track_ids) ? track_ids : (Array.isArray(tracks) ? tracks : []);
  const addedTracks = [];
  for (const trkId of targetTracks) {
    if (typeof trkId === 'string' && trkId.trim()) {
      const validTrack = db.prepare('SELECT id, name FROM tracks WHERE id = ? AND event_id = ?').get(trkId.trim(), req.eventId);
      if (validTrack) {
        db.prepare(`
          INSERT OR IGNORE INTO judge_tracks (judge_id, track_id)
          VALUES (?, ?)
        `).run(judgeId, validTrack.id);
        addedTracks.push(validTrack);
      }
    }
  }

  // 5. Audit log
  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'judge.created',
    resourceType: 'judge',
    resourceId: judgeId,
    details: { name: cleanName, email: cleanEmail, tracks: addedTracks.map(t => t.name) }
  });

  res.status(201).json({
    message: 'Judge added successfully to event',
    judge: {
      id: judgeId,
      name: cleanName,
      email: cleanEmail,
      user_id: user.id,
      tracks: addedTracks,
      assignments_count: 0,
      completed_reviews: 0
    }
  });
});

// DELETE /api/organizer/judges/:id - Remove a judge from the event
router.delete('/api/organizer/judges/:id', (req, res) => {
  const db = getDb();
  const judgeId = req.params.id;

  const judge = db.prepare('SELECT id, name, email, event_id FROM judges WHERE id = ?').get(judgeId);
  if (!judge) {
    return res.status(404).json({ error: `Judge '${judgeId}' not found` });
  }

  if (judge.event_id !== req.eventId) {
    return res.status(400).json({ error: 'Judge belongs to a different event' });
  }

  // Remove judge tracks, assignments, reviews
  db.prepare('DELETE FROM judge_tracks WHERE judge_id = ?').run(judgeId);
  db.prepare('DELETE FROM judge_assignments WHERE judge_id = ? AND event_id = ?').run(judgeId, req.eventId);
  db.prepare('DELETE FROM judges WHERE id = ?').run(judgeId);

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'judge.removed',
    resourceType: 'judge',
    resourceId: judgeId,
    details: { name: judge.name, email: judge.email }
  });

  res.json({ message: 'Judge removed successfully from event' });
});

// GET /api/organizer/rubric
router.get('/api/organizer/rubric', (req, res) => {
  const db = getDb();
  const criteria = db.prepare(`
    SELECT id, name, description, weight, max_score
    FROM rubric_criteria
    WHERE event_id = ?
    ORDER BY weight DESC, name ASC
  `).all(req.eventId);
  res.json({ criteria });
});

// GET /api/organizer/assignments
router.get('/api/organizer/assignments', (req, res) => {
  const db = getDb();

  const assignmentsStmt = db.prepare(`
    SELECT 
      a.id,
      a.project_id,
      p.title AS project_title,
      p.track_id AS project_track,
      p.status AS project_status,
      p.team_id,
      t.name AS team_name,
      a.judge_id,
      j.name AS judge_name,
      j.email AS judge_email,
      a.status,
      a.assigned_at,
      r.total_weighted_score
    FROM judge_assignments a
    JOIN projects p ON a.project_id = p.id
    LEFT JOIN teams t ON p.team_id = t.id
    JOIN judges j ON a.judge_id = j.id
    LEFT JOIN reviews r ON a.project_id = r.project_id AND a.judge_id = r.judge_id
    WHERE a.event_id = ?
    ORDER BY a.assigned_at DESC
  `);

  const assignments = assignmentsStmt.all(req.eventId).map(a => {
    const judgeTracks = db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(a.judge_id).map(t => t.track_id);
    const trackMatch = judgeTracks.includes(a.project_track);
    return {
      ...a,
      judge_tracks: judgeTracks,
      track_match: trackMatch
    };
  });

  res.json({ assignments });
});

// POST /api/organizer/assignments - Phase 6 Hardened Assignment Creation
router.post('/api/organizer/assignments', (req, res) => {
  const db = getDb();
  const { project_id, judge_id } = req.body || {};

  if (!project_id || typeof project_id !== 'string') {
    return res.status(400).json({ error: 'Valid project_id string is required' });
  }
  if (!judge_id || typeof judge_id !== 'string') {
    return res.status(400).json({ error: 'Valid judge_id string is required' });
  }

  // 1. Verify project exists and belongs to current event
  const project = db.prepare('SELECT id, event_id, track_id, team_id, status FROM projects WHERE id = ?').get(project_id);
  if (!project) {
    return res.status(404).json({ error: `Project '${project_id}' not found` });
  }
  if (project.event_id !== req.eventId) {
    return res.status(400).json({ error: `Project '${project_id}' belongs to event '${project.event_id}', not '${req.eventId}'` });
  }
  if (project.status === 'withdrawn' || project.status === 'disqualified') {
    return res.status(400).json({ error: `Cannot assign judge to project with status '${project.status}'` });
  }

  // 2. Verify judge exists and belongs to current event
  const judge = db.prepare('SELECT id, event_id, name, user_id FROM judges WHERE id = ?').get(judge_id);
  if (!judge) {
    return res.status(404).json({ error: `Judge '${judge_id}' not found` });
  }
  if (judge.event_id && judge.event_id !== req.eventId) {
    return res.status(400).json({ error: `Judge '${judge_id}' is registered for a different event` });
  }

  // 3. Conflict of interest check: Judge must NOT be a member of the project's team
  if (project.team_id && judge.user_id) {
    const conflict = db.prepare('SELECT team_id FROM team_members WHERE team_id = ? AND user_id = ?').get(project.team_id, judge.user_id);
    if (conflict) {
      return res.status(400).json({
        error: 'Conflict of interest detected: Judge is a registered member of this project team'
      });
    }
  }

  // 4. Duplicate assignment check
  const existing = db.prepare('SELECT id, status FROM judge_assignments WHERE event_id = ? AND project_id = ? AND judge_id = ?').get(req.eventId, project_id, judge_id);
  if (existing) {
    return res.status(409).json({
      error: `Assignment already exists for judge '${judge_id}' on project '${project_id}'`,
      assignment_id: existing.id,
      status: existing.status
    });
  }

  // 5. Track compatibility analysis
  const judgeTracks = db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(judge_id).map(t => t.track_id);
  const trackMatch = judgeTracks.includes(project.track_id);

  const assignmentId = `asg_${project_id}_${judge_id}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO judge_assignments (id, event_id, project_id, judge_id, status, assigned_at)
    VALUES (?, ?, ?, ?, 'assigned', ?)
  `).run(assignmentId, req.eventId, project_id, judge_id, now);

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'assignment.created',
    resourceType: 'assignment',
    resourceId: assignmentId,
    details: { project_id, judge_id, track_match: trackMatch, cross_track: !trackMatch }
  });

  res.status(201).json({
    message: 'Assignment created successfully',
    assignment_id: assignmentId,
    track_match: trackMatch,
    cross_track: !trackMatch,
    warning: !trackMatch ? 'Note: Judge does not specialize in this project track (cross-track assignment)' : null
  });
});

// DELETE /api/organizer/assignments
router.delete('/api/organizer/assignments', (req, res) => {
  const db = getDb();
  const { project_id, judge_id } = req.body || {};

  if (!project_id || !judge_id) {
    return res.status(400).json({ error: 'project_id and judge_id are required' });
  }

  const result = db.prepare('DELETE FROM judge_assignments WHERE event_id = ? AND project_id = ? AND judge_id = ?').run(req.eventId, project_id, judge_id);

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'assignment.deleted',
    resourceType: 'assignment',
    resourceId: `asg_${project_id}_${judge_id}`,
    details: { project_id, judge_id, deletedCount: result.changes }
  });

  res.json({ message: 'Assignment removed', changes: result.changes });
});

// POST /api/organizer/settings/results-visibility - Toggle embargo/release of public results
router.post('/api/organizer/settings/results-visibility', (req, res) => {
  const db = getDb();
  const { results_released } = req.body || {};

  const flagVal = results_released ? 1 : 0;
  db.prepare('UPDATE events SET results_released = ? WHERE id = ?').run(flagVal, req.eventId);

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'event.results_visibility_changed',
    resourceType: 'event',
    resourceId: req.eventId,
    details: { results_released: Boolean(flagVal) }
  });

  res.json({
    message: flagVal ? 'Results officially released to participants and public' : 'Results embargoed (private to organizers)',
    results_released: Boolean(flagVal)
  });
});

// POST /api/organizer/settings/deadline
router.post('/api/organizer/settings/deadline', (req, res) => {
  const db = getDb();
  const { submissions_close } = req.body || {};

  if (!submissions_close || typeof submissions_close !== 'string') {
    return res.status(400).json({ error: 'submissions_close ISO 8601 timestamp required' });
  }

  const parsedDate = new Date(submissions_close);
  if (isNaN(parsedDate.getTime())) {
    return res.status(400).json({ error: 'Invalid ISO 8601 timestamp format for submissions_close' });
  }

  db.prepare('UPDATE events SET submissions_close = ? WHERE id = ?').run(submissions_close, req.eventId);

  recordAuditLog({
    eventId: req.eventId,
    userId: req.user.id,
    role: req.user.role,
    action: 'event.deadline_updated',
    resourceType: 'event',
    resourceId: req.eventId,
    details: { submissions_close }
  });

  res.json({
    message: 'Deadline updated successfully',
    submissions_close
  });
});

// GET /api/organizer/audit
router.get('/api/organizer/audit', (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const logs = getAuditLogs(limit, req.eventId);
  res.json({ logs });
});

module.exports = router;
