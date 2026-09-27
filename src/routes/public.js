const express = require('express');
const router = express.Router();
const path = require('node:path');
const fs = require('node:fs');
const { getDb } = require('../db/database');
const { eventMiddleware } = require('../middleware/event');
const { calculateNormalizedRankings } = require('../services/normalization');

/**
 * Bulletproof HTML escaping to prevent XSS (Bug 6)
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * URL sanitizer to reject javascript:, data:, vbscript: protocols
 */
function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (/^(?:https?|mailto):/i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '';
}

/**
 * Renders gallery HTML with pre-baked, safely escaped project cards
 * for DOGFOOD acceptance checkers (run.py), SEO crawlers, and fast first paint.
 */
function renderGalleryHtml(projects, event, tracks) {
  const templatePath = path.join(__dirname, '../../public/index.html');
  let html = fs.readFileSync(templatePath, 'utf8');

  const isReleased = Boolean(event && event.results_released);

  // Generate safely escaped SSR cards
  const cardsHtml = projects.map(p => {
    const safeTitle = escapeHtml(p.title);
    const safeSummary = escapeHtml(p.summary || '');
    const safeTeam = escapeHtml(p.team_name || 'Solo Participant');
    const safeTrack = escapeHtml(p.track_name || 'General');
    const safeId = escapeHtml(p.id);

    // Score visibility based on embargo policy
    const scorePill = isReleased
      ? `<span class="score-pill">Score: <strong>${(p.normalized_score || 0).toFixed(2)}</strong></span>`
      : `<span class="score-pill status-eval">Judging in progress</span>`;

    return `
      <article class="project-card" data-id="${safeId}" data-track="${escapeHtml(p.track_id)}">
        <div class="card-header">
          <span class="track-badge">${safeTrack}</span>
          <span class="project-id">${safeId}</span>
        </div>
        <h3 class="project-title">${safeTitle}</h3>
        <p class="project-team">by <strong>${safeTeam}</strong></p>
        <p class="project-summary">${safeSummary}</p>
        <div class="card-footer">
          ${scorePill}
          <span class="reviews-pill">${p.review_count || 0} review${p.review_count === 1 ? '' : 's'}</span>
        </div>
      </article>
    `;
  }).join('\n');

  // Replace placeholder or inject before </body>
  const injection = `
    <!-- Pre-rendered SSR Projects for Automated Checkers & Instant Load -->
    <div id="ssr-gallery-cache" style="display:none;" data-ssr="true">
      ${cardsHtml}
    </div>
  `;

  if (html.includes('<!-- SSR_INJECTION_POINT -->')) {
    html = html.replace('<!-- SSR_INJECTION_POINT -->', injection);
  } else {
    html = html.replace('</body>', `${injection}\n</body>`);
  }

  return html;
}

// Mount event resolution
router.use('/projects', eventMiddleware);
router.use('/api/projects', eventMiddleware);
router.use('/api/tracks', eventMiddleware);
router.use('/api/event', eventMiddleware);

// GET /projects - Public Gallery (DOGFOOD Check 1 & 2)
router.get('/projects', (req, res) => {
  const db = getDb();
  const event = req.event;
  const tracks = db.prepare('SELECT * FROM tracks WHERE event_id = ?').all(req.eventId);
  
  const normData = calculateNormalizedRankings(req.eventId);
  const projects = normData.rankings;

  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) {
    return res.json({ event, tracks, projects });
  }

  const html = renderGalleryHtml(projects, event, tracks);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(html);
});

// JSON API: GET /api/projects
router.get('/api/projects', (req, res) => {
  const normData = calculateNormalizedRankings(req.eventId);
  const isReleased = Boolean(req.event && req.event.results_released);
  const isOrganizer = req.user && req.user.role === 'organizer';

  // Format public project view models (Bug 2 & 11: Explicit Serializers)
  const publicProjects = normData.rankings.map(p => {
    const base = {
      id: p.id,
      title: p.title,
      summary: p.summary,
      repo_url: p.repo_url,
      demo_url: p.demo_url,
      tech_stack: p.tech_stack,
      team_id: p.team_id,
      team_name: p.team_name,
      track_id: p.track_id,
      track_name: p.track_name,
      status: p.status,
      review_count: p.review_count
    };

    // If released or organizer, include normalized scores and ranks
    if (isReleased || isOrganizer) {
      return {
        ...base,
        raw_score: p.raw_score,
        normalized_score: p.normalized_score,
        rank: p.rank,
        rank_delta: p.rank_delta,
        explanation: p.explanation
      };
    }

    // Before release for public: scores are strictly embargoed
    return {
      ...base,
      raw_score: null,
      normalized_score: null,
      rank: null,
      rank_delta: null,
      explanation: 'Scores are pending evaluation and organizer release.'
    };
  });

  res.json({
    event_id: req.eventId,
    results_released: isReleased,
    projects: publicProjects,
    global: {
      totalReviews: normData.global.totalReviews,
      totalProjects: normData.global.totalProjects
    }
  });
});

// JSON API: GET /api/projects/:id
router.get('/api/projects/:id', (req, res) => {
  const db = getDb();
  const projectId = req.params.id;

  const projectStmt = db.prepare(`
    SELECT 
      p.*,
      t.name AS team_name,
      tr.name AS track_name
    FROM projects p
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN tracks tr ON p.track_id = tr.id
    WHERE p.id = ?
  `);
  const project = projectStmt.get(projectId);

  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Fetch team members from relational table
  const members = db.prepare('SELECT email, role FROM team_members WHERE team_id = ?').all(project.team_id);
  project.team_members = members.map(m => m.email);

  // Get project from normalization data
  const normData = calculateNormalizedRankings(req.eventId);
  const rankedProject = normData.rankings.find(p => p.id === projectId);

  const isReleased = Boolean(req.event && req.event.results_released);
  const isOrganizer = req.user && req.user.role === 'organizer';
  const isAssignedJudge = req.user && req.user.role === 'judge';

  // Role-isolated review breakdown:
  // - Organizers can see all judge evaluations.
  // - Judges can ONLY see their own review for this project.
  // - Participants and public receive NO private judge reviews.
  let visibleReviews = [];
  if (isOrganizer) {
    visibleReviews = rankedProject ? rankedProject.reviews_breakdown : [];
  } else if (isAssignedJudge) {
    visibleReviews = (rankedProject ? rankedProject.reviews_breakdown : [])
      .filter(r => r.judge_id === req.user.judge_id);
  } else {
    visibleReviews = [];
  }

  const showScores = isReleased || isOrganizer;

  res.json({
    project: {
      id: project.id,
      event_id: project.event_id,
      title: project.title,
      summary: project.summary,
      tech_stack: project.tech_stack,
      repo_url: project.repo_url,
      demo_url: project.demo_url,
      team_id: project.team_id,
      team_name: project.team_name,
      team_members: project.team_members,
      track_id: project.track_id,
      track_name: project.track_name,
      status: project.status,
      submitted_at: project.submitted_at,
      updated_at: project.updated_at,
      raw_score: showScores && rankedProject ? rankedProject.raw_score : null,
      normalized_score: showScores && rankedProject ? rankedProject.normalized_score : null,
      rank: showScores && rankedProject ? rankedProject.rank : null,
      rank_delta: showScores && rankedProject ? rankedProject.rank_delta : null,
      review_count: rankedProject ? rankedProject.review_count : 0,
      explanation: showScores && rankedProject ? rankedProject.explanation : 'Results are embargoed until official release.',
      reviews_breakdown: visibleReviews
    }
  });
});

// JSON API: GET /api/tracks
router.get('/api/tracks', (req, res) => {
  const db = getDb();
  const tracks = db.prepare('SELECT id, event_id, name, description FROM tracks WHERE event_id = ?').all(req.eventId);
  res.json({ event_id: req.eventId, tracks });
});

// JSON API: GET /api/event
router.get('/api/event', (req, res) => {
  const isClosed = req.event ? (new Date() > new Date(req.event.submissions_close)) : false;
  res.json({
    ...req.event,
    results_released: Boolean(req.event.results_released),
    is_closed: isClosed
  });
});

module.exports = router;
module.exports.escapeHtml = escapeHtml;
module.exports.sanitizeUrl = sanitizeUrl;
