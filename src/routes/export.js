const express = require('express');
const router = express.Router();
const { requireRole, requireEventMembership } = require('../middleware/rbac');
const { eventMiddleware } = require('../middleware/event');
const { generateResultsCsv } = require('../services/export');

// GET /api/export.csv and /api/export/csv - (DOGFOOD Check 7: Organizer CSV export)
function handleCsvExport(req, res) {
  const csvContent = generateResultsCsv(req.eventId, req.user);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="judgely-${req.eventId}-results.csv"`);
  res.status(200).send(csvContent);
}

router.get('/api/export.csv', eventMiddleware, requireRole('organizer'), requireEventMembership, handleCsvExport);
router.get('/api/export/csv', eventMiddleware, requireRole('organizer'), requireEventMembership, handleCsvExport);

module.exports = router;
