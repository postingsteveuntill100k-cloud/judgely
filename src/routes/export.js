const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/rbac');
const { generateResultsCsv } = require('../services/export');

// GET /api/export.csv - (DOGFOOD Check 7: Organizer CSV export)
router.get('/api/export.csv', requireRole('organizer'), (req, res) => {
  const csvContent = generateResultsCsv('evt_01', req.user);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="judgely-sample-hack-2026-results.csv"');
  res.status(200).send(csvContent);
});

module.exports = router;
