const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { enforceJudgeScoreIsolation, requireRole } = require('../middleware/rbac');
const { getScoresForJudge, getJudgeAssignments, submitReview, getRubric } = require('../services/judging');

// GET /api/judge/scores - (DOGFOOD Check 4, 5, 6)
router.get('/api/judge/scores', enforceJudgeScoreIsolation, (req, res) => {
  const targetJudgeId = req.targetJudgeId || req.user.judge_id;
  
  if (!targetJudgeId) {
    return res.status(400).json({ error: 'Judge ID could not be determined' });
  }

  const scores = getScoresForJudge(targetJudgeId);
  res.json({
    judge_id: targetJudgeId,
    total_reviews: scores.length,
    scores
  });
});

// GET /api/judge/assignments
router.get('/api/judge/assignments', requireRole('judge'), (req, res) => {
  const assignments = getJudgeAssignments(req.user.judge_id);
  const rubric = getRubric();
  res.json({
    judge_id: req.user.judge_id,
    assignments,
    rubric
  });
});

// POST /api/judge/scores - submit review with rigorous input validation
router.post('/api/judge/scores', requireRole('judge'), (req, res) => {
  const db = getDb();
  const { project_id, criteria, comment } = req.body || {};

  if (!project_id || typeof project_id !== 'string') {
    return res.status(400).json({ error: 'Valid project_id is required' });
  }

  // Validate project existence and status
  const project = db.prepare('SELECT id, status FROM projects WHERE id = ?').get(project_id);
  if (!project) {
    return res.status(404).json({ error: 'Target project does not exist' });
  }
  if (project.status === 'disqualified' || project.status === 'withdrawn') {
    return res.status(400).json({ error: `Cannot score project with status '${project.status}'` });
  }

  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
    return res.status(400).json({ error: 'criteria object with criterion scores is required' });
  }

  // Validate each criterion score is numeric and within bounds [0, 5]
  const cleanCriteria = {};
  for (const [key, val] of Object.entries(criteria)) {
    const num = Number(val);
    if (isNaN(num) || num < 0 || num > 5) {
      return res.status(400).json({
        error: `Criterion '${key}' has invalid score '${val}'. Scores must be between 0.0 and 5.0.`
      });
    }
    cleanCriteria[key] = num;
  }

  // Validate comment length
  const cleanComment = (comment && typeof comment === 'string') ? comment.trim() : '';
  if (cleanComment.length > 3000) {
    return res.status(400).json({ error: 'Comment exceeds maximum allowed length of 3000 characters' });
  }

  try {
    const result = submitReview({
      projectId: project_id,
      judgeId: req.user.judge_id,
      criteria: cleanCriteria,
      comment: cleanComment,
      user: req.user
    });

    res.status(200).json({
      message: 'Review submitted successfully',
      ...result
    });
  } catch (err) {
    console.error('Submit review error:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// GET /api/judge/rubric
router.get('/api/judge/rubric', (req, res) => {
  const rubric = getRubric();
  res.json({ rubric });
});

module.exports = router;
