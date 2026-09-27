const express = require('express');
const router = express.Router();
const { enforceJudgeScoreIsolation, requireRole } = require('../middleware/rbac');
const { eventMiddleware } = require('../middleware/event');
const { getScoresForJudge, getJudgeAssignments, submitReview, getRubric } = require('../services/judging');

// Mount event resolution middleware for judge routes
router.use('/api/judge', eventMiddleware);

// GET /api/judge/scores - (DOGFOOD Check 4, 5, 6)
router.get('/api/judge/scores', enforceJudgeScoreIsolation, (req, res) => {
  const targetJudgeId = req.targetJudgeId || req.user.judge_id;
  
  if (!targetJudgeId) {
    return res.status(400).json({ error: 'Judge ID could not be determined' });
  }

  const scores = getScoresForJudge(targetJudgeId, req.eventId);
  res.json({
    event_id: req.eventId,
    judge_id: targetJudgeId,
    total_reviews: scores.length,
    scores
  });
});

// GET /api/judge/assignments
router.get('/api/judge/assignments', requireRole('judge'), (req, res) => {
  const assignments = getJudgeAssignments(req.user.judge_id, req.eventId);
  const rubric = getRubric(req.eventId);
  res.json({
    event_id: req.eventId,
    judge_id: req.user.judge_id,
    assignments,
    rubric
  });
});

// POST /api/judge/scores - submit review with rigorous validation & assignment check
router.post('/api/judge/scores', requireRole('judge'), (req, res) => {
  const { project_id, criteria, comment } = req.body || {};

  if (!project_id || typeof project_id !== 'string') {
    return res.status(400).json({ error: 'Valid project_id string is required' });
  }

  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) {
    return res.status(400).json({ error: 'criteria object with criterion scores is required' });
  }

  const cleanComment = (comment && typeof comment === 'string') ? comment.trim() : '';
  if (cleanComment.length > 3000) {
    return res.status(400).json({ error: 'Comment exceeds maximum allowed length of 3000 characters' });
  }

  try {
    const result = submitReview({
      eventId: req.eventId,
      projectId: project_id,
      judgeId: req.user.judge_id,
      criteria,
      comment: cleanComment,
      user: req.user
    });

    res.status(200).json({
      message: 'Review submitted successfully',
      ...result
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: status === 403 ? 'Forbidden' : (status === 400 ? 'Validation Error' : 'Server Error'),
      message: err.message
    });
  }
});

// GET /api/judge/rubric
router.get('/api/judge/rubric', (req, res) => {
  const rubric = getRubric(req.eventId);
  res.json({
    event_id: req.eventId,
    rubric
  });
});

module.exports = router;
