const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { requireRole } = require('../middleware/rbac');
const { getJudgingHealth } = require('../services/health');
const { getAuditLogs, recordAuditLog } = require('../services/audit');

// All organizer endpoints strictly require 'organizer' role
router.use('/api/organizer', requireRole('organizer'));

// GET /api/organizer/overview
router.get('/api/organizer/overview', (req, res) => {
  const health = getJudgingHealth();
  const audits = getAuditLogs(20);
  res.json({
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
      a.judge_id,
      j.name AS judge_name,
      a.status,
      a.assigned_at,
      r.total_weighted_score
    FROM judge_assignments a
    JOIN projects p ON a.project_id = p.id
    JOIN judges j ON a.judge_id = j.id
    LEFT JOIN reviews r ON a.project_id = r.project_id AND a.judge_id = r.judge_id
    ORDER BY a.assigned_at DESC
  `);

  const assignments = assignmentsStmt.all().map(a => {
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

// POST /api/organizer/assignments
router.post('/api/organizer/assignments', (req, res) => {
  const db = getDb();
  const { project_id, judge_id } = req.body || {};

  if (!project_id || typeof project_id !== 'string') {
    return res.status(400).json({ error: 'Valid project_id string is required' });
  }
  if (!judge_id || typeof judge_id !== 'string') {
    return res.status(400).json({ error: 'Valid judge_id string is required' });
  }

  // Validate project and judge exist
  const project = db.prepare('SELECT id, track_id FROM projects WHERE id = ?').get(project_id);
  const judge = db.prepare('SELECT id FROM judges WHERE id = ?').get(judge_id);

  if (!project) {
    return res.status(404).json({ error: `Project '${project_id}' not found` });
  }
  if (!judge) {
    return res.status(404).json({ error: `Judge '${judge_id}' not found` });
  }

  const assignmentId = `asg_${project_id}_${judge_id}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO judge_assignments (id, event_id, project_id, judge_id, status, assigned_at)
    VALUES (?, 'evt_01', ?, ?, 'assigned', ?)
    ON CONFLICT(project_id, judge_id) DO UPDATE SET status = 'assigned'
  `).run(assignmentId, project_id, judge_id, now);

  const judgeTracks = db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(judge_id).map(t => t.track_id);
  const trackMatch = judgeTracks.includes(project.track_id);

  recordAuditLog({
    eventId: 'evt_01',
    userId: req.user.id,
    role: req.user.role,
    action: 'assignment.created',
    resourceType: 'assignment',
    resourceId: assignmentId,
    details: { project_id, judge_id, track_match: trackMatch }
  });

  res.status(201).json({
    message: 'Assignment created successfully',
    assignment_id: assignmentId,
    track_match: trackMatch
  });
});

// DELETE /api/organizer/assignments
router.delete('/api/organizer/assignments', (req, res) => {
  const db = getDb();
  const { project_id, judge_id } = req.body || {};

  if (!project_id || !judge_id) {
    return res.status(400).json({ error: 'project_id and judge_id are required' });
  }

  const result = db.prepare('DELETE FROM judge_assignments WHERE project_id = ? AND judge_id = ?').run(project_id, judge_id);

  recordAuditLog({
    eventId: 'evt_01',
    userId: req.user.id,
    role: req.user.role,
    action: 'assignment.deleted',
    resourceType: 'assignment',
    resourceId: `asg_${project_id}_${judge_id}`,
    details: { project_id, judge_id, deletedCount: result.changes }
  });

  res.json({ message: 'Assignment removed', changes: result.changes });
});

// GET /api/organizer/audit
router.get('/api/organizer/audit', (req, res) => {
  const limit = Math.min(200, parseInt(req.query.limit, 10) || 50);
  const logs = getAuditLogs(limit);
  res.json({ logs });
});

// POST /api/organizer/settings/deadline (Allows demo toggle of deadline)
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

  db.prepare('UPDATE events SET submissions_close = ? WHERE id = ?').run(submissions_close, 'evt_01');

  recordAuditLog({
    eventId: 'evt_01',
    userId: req.user.id,
    role: req.user.role,
    action: 'event.deadline_updated',
    resourceType: 'event',
    resourceId: 'evt_01',
    details: { submissions_close }
  });

  res.json({
    message: 'Deadline updated successfully',
    submissions_close
  });
});

module.exports = router;
