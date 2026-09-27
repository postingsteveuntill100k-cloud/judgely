const { calculateNormalizedRankings } = require('./normalization');
const { recordAuditLog } = require('./audit');
const { getDb } = require('../db/database');

function generateResultsCsv(eventId, user = {}) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;
  if (!targetEventId) {
    throw new Error('No active event found for CSV export');
  }

  const normData = calculateNormalizedRankings(targetEventId);

  const headers = [
    'Rank',
    'Project ID',
    'Project Title',
    'Team Name',
    'Track',
    'Raw Score',
    'Normalized Score',
    'Rank Delta',
    'Review Count',
    'Status'
  ];

  const lines = [headers.join(',')];

  for (const p of normData.rankings) {
    const escapeCsv = (str) => {
      if (str === null || str === undefined) return '""';
      const clean = String(str).replace(/"/g, '""');
      return `"${clean}"`;
    };

    const row = [
      p.rank,
      escapeCsv(p.id),
      escapeCsv(p.title),
      escapeCsv(p.team_name || ''),
      escapeCsv(p.track_name || ''),
      p.raw_score.toFixed(3),
      p.normalized_score.toFixed(3),
      (p.rank_delta > 0 ? `+${p.rank_delta}` : p.rank_delta),
      p.review_count,
      escapeCsv(p.status)
    ];

    lines.push(row.join(','));
  }

  recordAuditLog({
    eventId: targetEventId,
    userId: user.id || 'organizer',
    role: user.role || 'organizer',
    action: 'export.csv_generated',
    resourceType: 'results_export',
    resourceId: targetEventId,
    details: { totalRankedProjects: normData.rankings.length }
  });

  return lines.join('\n');
}

module.exports = {
  generateResultsCsv
};
