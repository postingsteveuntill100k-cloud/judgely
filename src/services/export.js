const { calculateNormalizedRankings } = require('./normalization');
const { recordAuditLog } = require('./audit');

function generateResultsCsv(eventId = 'evt_01', user = {}) {
  const normData = calculateNormalizedRankings(eventId);

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
    eventId,
    userId: user.id || 'organizer',
    role: user.role || 'organizer',
    action: 'export.csv_generated',
    resourceType: 'results_export',
    resourceId: eventId,
    details: { totalRankedProjects: normData.rankings.length }
  });

  return lines.join('\n');
}

module.exports = {
  generateResultsCsv
};
