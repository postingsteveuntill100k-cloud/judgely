const express = require('express');
const router = express.Router();
const { eventMiddleware } = require('../middleware/event');
const { calculateNormalizedRankings } = require('../services/normalization');

// GET /api/results - Normalization rankings & proof data
// BUG 2 Fix: Enforce explicit result visibility policy.
// Prior to results release, scoring and normalization internals are strictly embargoed for non-organizers.
router.get('/api/results', eventMiddleware, (req, res) => {
  const event = req.event;
  const isReleased = Boolean(event.results_released);
  const isOrganizer = req.user && req.user.role === 'organizer';

  // Embargo check: if results are not released and caller is not organizer, refuse access with 403
  if (!isReleased && !isOrganizer) {
    return res.status(403).json({
      error: 'Results Embargoed',
      message: 'Competition results and scoring normalization are currently embargoed. They will become accessible once officially released by the organizer.',
      results_released: false
    });
  }

  const normData = calculateNormalizedRankings(req.eventId);

  // If organizer, provide full unredacted judging analytics and normalization proof
  if (isOrganizer) {
    return res.json({
      results_released: isReleased,
      ...normData
    });
  }

  // After official release for public/participants/judges:
  // Strictly redact judge names, judge bias, and internal distribution parameters
  const publicRankings = normData.rankings.map(p => ({
    rank: p.rank,
    id: p.id,
    title: p.title,
    summary: p.summary,
    team_id: p.team_id,
    team_name: p.team_name,
    track_id: p.track_id,
    track_name: p.track_name,
    score: p.normalized_score,
    status: p.status
  }));

  res.json({
    results_released: true,
    global: {
      totalProjects: normData.global.totalProjects,
      totalReviews: normData.global.totalReviews
    },
    rankings: publicRankings
  });
});

module.exports = router;
