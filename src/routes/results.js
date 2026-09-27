const express = require('express');
const router = express.Router();
const { calculateNormalizedRankings } = require('../services/normalization');

// GET /api/results - Normalization rankings & proof data
router.get('/api/results', (req, res) => {
  const normData = calculateNormalizedRankings('evt_01');
  res.json(normData);
});

module.exports = router;
