const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireRole, requireEventMembership } = require('../middleware/rbac');
const { eventMiddleware } = require('../middleware/event');
const { getJudgingHealth } = require('../services/health');
const { getAuditLogs, recordAuditLog } = require('../services/audit');

// All organizer endpoints strictly require 'organizer' role, event resolution, and event membership
router.use('/api/organizer', requireRole('organizer'), eventMiddleware, requireEventMembership);

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
