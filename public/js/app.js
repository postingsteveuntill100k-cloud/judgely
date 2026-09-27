/**
 * Judgely Frontend Client Application
 * Connects Public Gallery, Judge Portal, Organizer Command Center,
 * Normalization Inspector, and Audit Trail.
 */

// State
const state = {
  activeRole: 'visitor',
  activeToken: '',
  currentUser: null,
  activeView: 'gallery',
  projects: [],
  tracks: [],
  event: null,
  normalizationData: null,
  rankOrder: 'normalized', // 'normalized' or 'raw'
  selectedTrack: 'all',
  searchQuery: ''
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  initTheme();

  // Check if role token in localStorage
  const savedToken = localStorage.getItem('judgely_session') || '';
  if (savedToken) {
    state.activeToken = savedToken;
  }

  setupEventListeners();
  await refreshCurrentUser();
  await loadEventData();
  await loadTracks();
  await loadProjects();
});

// Theme Management
function initTheme() {
  const savedTheme = localStorage.getItem('judgely_theme');
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
  setTheme(initialTheme);

  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'light';
      const nextTheme = current === 'dark' ? 'light' : 'dark';
      setTheme(nextTheme);
    });
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('judgely_theme', theme);
  const toggleBtn = document.getElementById('btn-theme-toggle');
  if (toggleBtn) {
    const icon = toggleBtn.querySelector('.theme-icon') || toggleBtn;
    const label = toggleBtn.querySelector('.theme-label');
    if (theme === 'dark') {
      if (icon) icon.textContent = '◑';
      if (label) label.textContent = 'Dark';
    } else {
      if (icon) icon.textContent = '◐';
      if (label) label.textContent = 'Light';
    }
  }
}

function setupEventListeners() {
  // Role switcher buttons
  const roleButtons = document.querySelectorAll('.role-btn');
  roleButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      roleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const role = btn.dataset.role;
      const token = btn.dataset.token || '';
      await switchRole(role, token);
    });
  });

  // Nav tabs
  const navTabs = document.querySelectorAll('.nav-tab');
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.dataset.view;
      switchView(view);
    });
  });

  // Search input
  const searchInput = document.getElementById('gallery-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase();
      renderGallery();
    });
  }

  // Quick CSV Export button in navbar
  document.getElementById('btn-quick-export').addEventListener('click', handleExportCsv);
  document.getElementById('btn-org-export-csv').addEventListener('click', handleExportCsv);

  // Submit Project button
  document.getElementById('btn-submit-project').addEventListener('click', openSubmitModal);
  document.getElementById('btn-close-submit-modal').addEventListener('click', closeSubmitModal);
  document.getElementById('btn-cancel-submit').addEventListener('click', closeSubmitModal);
  document.getElementById('form-submit-project').addEventListener('submit', handleProjectSubmission);

  // Project Detail Modal close
  document.getElementById('btn-close-proj-modal').addEventListener('click', () => {
    document.getElementById('modal-project-detail').classList.remove('show');
  });

  // Scoring Modal close
  document.getElementById('btn-close-scoring-modal').addEventListener('click', () => {
    document.getElementById('modal-scoring').classList.remove('show');
  });
  document.getElementById('form-scoring').addEventListener('submit', handleScoringSubmission);

  // Normalization toggle
  document.getElementById('btn-toggle-norm').addEventListener('click', () => {
    state.rankOrder = 'normalized';
    document.getElementById('btn-toggle-norm').classList.add('active');
    document.getElementById('btn-toggle-raw').classList.remove('active');
    renderRankingsTable();
  });
  document.getElementById('btn-toggle-raw').addEventListener('click', () => {
    state.rankOrder = 'raw';
    document.getElementById('btn-toggle-raw').classList.add('active');
    document.getElementById('btn-toggle-norm').classList.remove('active');
    renderRankingsTable();
  });

  // Organizer Assignment Form
  document.getElementById('form-assign-judge').addEventListener('submit', handleCreateAssignment);
  document.getElementById('assign-judge').addEventListener('change', checkAssignmentTrackMatch);
  document.getElementById('assign-project').addEventListener('change', checkAssignmentTrackMatch);

  // Deadline Controls
  document.getElementById('btn-set-deadline-past').addEventListener('click', () => updateDeadline('2026-03-01T18:00:00Z'));
  document.getElementById('btn-set-deadline-future').addEventListener('click', () => updateDeadline(new Date(Date.now() + 7 * 86400000).toISOString()));

  // Refresh Audit
  document.getElementById('btn-refresh-audit').addEventListener('click', loadAuditTrail);

  // Close modals on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-backdrop.show').forEach(m => m.classList.remove('show'));
    }
  });
}

// API Fetch helper that includes active session token
async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };

  if (state.activeToken) {
    // Send both Cookie and Bearer for maximum compatibility
    document.cookie = `session=${state.activeToken}; path=/`;
    headers['Authorization'] = `Bearer ${state.activeToken}`;
    headers['x-session-token'] = state.activeToken;
  } else {
    document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }

  const res = await fetch(url, { ...options, headers });
  return res;
}

// Role Switching
async function switchRole(role, token) {
  state.activeRole = role;
  state.activeToken = token;

  if (token) {
    localStorage.setItem('judgely_session', token);
    document.cookie = `session=${token}; path=/`;
  } else {
    localStorage.removeItem('judgely_session');
    document.cookie = 'session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }

  await refreshCurrentUser();

  // If in judge or organizer view, refresh view content
  if (state.activeView === 'judge') loadJudgePortal();
  if (state.activeView === 'organizer') loadOrganizerOverview();
  if (state.activeView === 'audit') loadAuditTrail();
}

async function refreshCurrentUser() {
  try {
    const res = await apiFetch('/api/auth/me');
    const data = await res.json();
    state.currentUser = data.user;

    const authText = document.getElementById('auth-role-text');
    if (state.currentUser && state.currentUser.role !== 'visitor') {
      authText.textContent = `${state.currentUser.name} (${state.currentUser.role.toUpperCase()})`;
    } else {
      authText.textContent = 'Public Visitor';
    }

    // Highlight active role button
    const buttons = document.querySelectorAll('.role-btn');
    buttons.forEach(b => {
      if (b.dataset.token === state.activeToken) {
        b.classList.add('active');
      } else if (!state.activeToken && b.dataset.role === 'visitor') {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  } catch (err) {
    console.error('Failed to resolve current user:', err);
  }
}

// View Switching
function switchView(viewName) {
  state.activeView = viewName;

  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.view === viewName);
  });

  document.querySelectorAll('.view-panel').forEach(p => {
    p.classList.remove('active');
  });

  const targetPanel = document.getElementById(`view-${viewName}`);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }

  // Load view-specific data
  if (viewName === 'gallery') renderGallery();
  if (viewName === 'judge') loadJudgePortal();
  if (viewName === 'organizer') loadOrganizerOverview();
  if (viewName === 'normalization') loadNormalizationData();
  if (viewName === 'audit') loadAuditTrail();
}

let staticFixturesData = null;

async function getStaticFixtures() {
  if (!staticFixturesData) {
    const res = await fetch('/fixtures.json');
    staticFixturesData = await res.json();
  }
  return staticFixturesData;
}

// Data loaders
async function loadEventData() {
  try {
    const res = await apiFetch('/api/event');
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || contentType.includes('text/html')) {
      const data = await getStaticFixtures();
      state.event = data.event;
    } else {
      state.event = await res.json();
    }
  } catch (err) {
    try {
      const data = await getStaticFixtures();
      state.event = data.event;
    } catch (e) {
      console.error('Failed to load event data:', e);
    }
  }

  if (state.event) {
    document.getElementById('banner-event-name').textContent = state.event.name;
    document.getElementById('banner-close-date').textContent = new Date(state.event.submissions_close).toUTCString();
    document.getElementById('input-close-date').value = state.event.submissions_close;

    const isClosed = new Date() > new Date(state.event.submissions_close);
    const badge = document.getElementById('banner-closed-badge');
    if (isClosed) {
      badge.textContent = 'SUBMISSIONS CLOSED';
      badge.className = 'status-badge closed';
    } else {
      badge.textContent = 'SUBMISSIONS OPEN';
      badge.className = 'status-badge open';
    }
  }
}

async function loadTracks() {
  try {
    const res = await apiFetch('/api/tracks');
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || contentType.includes('text/html')) {
      const data = await getStaticFixtures();
      state.tracks = data.tracks || [];
    } else {
      const data = await res.json();
      state.tracks = data.tracks || [];
    }
  } catch (err) {
    try {
      const data = await getStaticFixtures();
      state.tracks = data.tracks || [];
    } catch (e) {
      console.error('Failed to load tracks:', e);
    }
  }

  const container = document.getElementById('track-filter-container');
  container.innerHTML = '<button class="track-pill active" data-track="all">All Tracks</button>';

  state.tracks.forEach(track => {
    const btn = document.createElement('button');
    btn.className = 'track-pill';
    btn.dataset.track = track.id;
    btn.textContent = track.name;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.track-pill').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      state.selectedTrack = track.id;
      renderGallery();
    });
    container.appendChild(btn);
  });

  // Populate track select in submission modal
  const subTrackSelect = document.getElementById('input-sub-track');
  subTrackSelect.innerHTML = '';
  state.tracks.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    subTrackSelect.appendChild(opt);
  });
}

async function loadProjects() {
  try {
    const res = await apiFetch('/api/projects');
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || contentType.includes('text/html')) {
      const data = await getStaticFixtures();
      const teamMap = {};
      (data.teams || []).forEach(t => teamMap[t.id] = t.name);
      const trackMap = {};
      (data.tracks || []).forEach(t => trackMap[t.id] = t.name);

      state.projects = (data.projects || []).map(p => ({
        ...p,
        team_name: teamMap[p.team] || p.team,
        track_name: trackMap[p.track] || p.track,
        track_id: p.track,
        normalized_score: 0,
        raw_score: 0,
        review_count: 0
      }));
    } else {
      const data = await res.json();
      state.projects = data.projects || [];
    }
  } catch (err) {
    try {
      const data = await getStaticFixtures();
      state.projects = data.projects || [];
    } catch (e) {
      console.error('Failed to load projects:', e);
    }
  }
  renderGallery();
}

// Render Gallery
function renderGallery() {
  const grid = document.getElementById('projects-grid');
  grid.innerHTML = '';

  let filtered = state.projects;

  if (state.selectedTrack !== 'all') {
    filtered = filtered.filter(p => p.track_id === state.selectedTrack);
  }

  if (state.searchQuery) {
    filtered = filtered.filter(p =>
      (p.title && p.title.toLowerCase().includes(state.searchQuery)) ||
      (p.team_name && p.team_name.toLowerCase().includes(state.searchQuery)) ||
      (p.summary && p.summary.toLowerCase().includes(state.searchQuery))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">No matching projects found.</div>';
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement('article');
    card.className = 'project-card';
    card.dataset.id = p.id;
    card.innerHTML = `
      <div class="card-header">
        <span class="track-badge">${escapeHtml(p.track_name || 'General')}</span>
        <span class="project-id">${escapeHtml(p.id)}</span>
      </div>
      <h3 class="project-title">${escapeHtml(p.title)}</h3>
      <p class="project-team">by <strong>${escapeHtml(p.team_name || 'Solo')}</strong></p>
      <p class="project-summary">${escapeHtml(p.summary || '')}</p>
      <div class="card-footer">
        <span class="score-pill">Score: <strong>${p.normalized_score > 0 ? p.normalized_score.toFixed(2) : (p.raw_score > 0 ? p.raw_score.toFixed(2) : 'Pending')}</strong></span>
        <span class="reviews-pill">${p.review_count} review${p.review_count === 1 ? '' : 's'}</span>
      </div>
    `;
    card.addEventListener('click', () => openProjectModal(p.id));
    grid.appendChild(card);
  });
}

// Project Detail Modal
async function openProjectModal(projectId) {
  try {
    const res = await apiFetch(`/api/projects/${projectId}`);
    const data = await res.json();
    const p = data.project;

    document.getElementById('modal-proj-track').textContent = p.track_name || 'General';
    document.getElementById('modal-proj-title').textContent = p.title;
    document.getElementById('modal-proj-team').textContent = `by ${p.team_name || 'Solo'}`;
    document.getElementById('modal-proj-summary').textContent = p.summary || 'No summary provided.';

    // Repo link
    const linksRow = document.getElementById('modal-proj-links');
    linksRow.innerHTML = '';
    if (p.repo_url) {
      const a = document.createElement('a');
      a.href = p.repo_url;
      a.target = '_blank';
      a.className = 'btn btn-sm btn-outline';
      a.textContent = '↗ View Source Code';
      linksRow.appendChild(a);
    }

    // Score stats
    document.getElementById('modal-proj-norm-score').textContent = p.normalized_score > 0 ? p.normalized_score.toFixed(2) : 'Pending';
    document.getElementById('modal-proj-raw-score').textContent = p.raw_score > 0 ? p.raw_score.toFixed(2) : '--';
    document.getElementById('modal-proj-rank').textContent = p.rank ? `#${p.rank}` : '--';

    const deltaBox = document.getElementById('modal-proj-delta');
    if (p.rank_delta > 0) {
      deltaBox.innerHTML = `<span class="delta-tag up">+${p.rank_delta}</span>`;
    } else if (p.rank_delta < 0) {
      deltaBox.innerHTML = `<span class="delta-tag down">${p.rank_delta}</span>`;
    } else {
      deltaBox.innerHTML = '<span class="delta-tag neutral">0</span>';
    }

    // Explanation
    document.getElementById('modal-proj-explanation').textContent = p.explanation || 'No evaluation explanation available.';

    // Reviews list according to role visibility
    const reviewsList = document.getElementById('modal-proj-reviews');
    reviewsList.innerHTML = '';

    if (!p.reviews_breakdown || p.reviews_breakdown.length === 0) {
      if (state.currentUser && state.currentUser.role === 'organizer') {
        reviewsList.innerHTML = '<p class="empty-state">No evaluations submitted for this project yet.</p>';
      } else if (state.currentUser && state.currentUser.role === 'judge') {
        reviewsList.innerHTML = '<p class="empty-state">You have not submitted a review for this project. Peer judge evaluations are strictly isolated.</p>';
      } else {
        reviewsList.innerHTML = '<p class="empty-state">Individual judge scores and private reviewer feedback are confidential and restricted to authorized officials.</p>';
      }
    } else {
      const heading = document.createElement('div');
      heading.style.cssText = 'font-size: 11px; color: var(--accent-primary); margin-bottom: 8px; font-weight: 700;';
      heading.textContent = state.currentUser.role === 'organizer' 
        ? `Organizer Inspection (${p.reviews_breakdown.length} Reviews)` 
        : 'Your Evaluation';
      reviewsList.appendChild(heading);

      p.reviews_breakdown.forEach(r => {
        const item = document.createElement('div');
        item.className = 'flag-item';
        item.innerHTML = `
          <div class="flag-header">
            <strong>Judge: ${escapeHtml(r.judge_name || r.judge_id)}</strong>
            <span class="score-pill">Score: <strong>${r.raw_score.toFixed(2)}</strong> (Z-Score: ${r.z_score >= 0 ? '+' : ''}${r.z_score})</span>
          </div>
          <p class="flag-desc">${escapeHtml(r.comment || 'No written feedback provided.')}</p>
        `;
        reviewsList.appendChild(item);
      });
    }

    document.getElementById('modal-project-detail').classList.add('show');
  } catch (err) {
    console.error('Failed to open project modal:', err);
  }
}

// Judge Portal
async function loadJudgePortal() {
  const container = document.getElementById('judge-assignments-list');
  const subtitle = document.getElementById('judge-subtitle');

  if (!state.currentUser || (state.currentUser.role !== 'judge' && state.currentUser.role !== 'organizer')) {
    container.innerHTML = `
      <div class="empty-state">
        <p><strong>Authentication Required</strong></p>
        <p>You are currently viewing as ${state.currentUser ? state.currentUser.role : 'visitor'}.</p>
        <p>Click <strong>"Judge A"</strong> or <strong>"Judge B"</strong> in the top role bar to view assigned projects.</p>
      </div>
    `;
    return;
  }

  subtitle.textContent = `Authenticated as ${state.currentUser.name} (${state.currentUser.judge_id || state.currentUser.role})`;

  try {
    const res = await apiFetch('/api/judge/assignments');
    if (res.status === 403 || res.status === 401) {
      container.innerHTML = '<div class="empty-state">Access denied: Role isolation barrier active.</div>';
      return;
    }
    const data = await res.json();
    const assignments = data.assignments || [];

    if (assignments.length === 0) {
      container.innerHTML = '<div class="empty-state">No projects assigned to you yet.</div>';
      return;
    }

    container.innerHTML = '';
    assignments.forEach(a => {
      const card = document.createElement('div');
      card.className = 'judge-assignment-card';
      const isDone = a.assignment_status === 'completed' || a.total_weighted_score !== null;

      card.innerHTML = `
        <div class="assignment-meta">
          <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
            <span class="track-badge">${escapeHtml(a.track_name || 'General')}</span>
            <span class="assignment-status ${isDone ? 'completed' : 'assigned'}">
              ${isDone ? '&#10003; Evaluated' : 'Pending Review'}
            </span>
          </div>
          <h3 class="project-title" style="margin-bottom: 4px;">${escapeHtml(a.project_title)}</h3>
          <p class="project-team" style="margin-bottom: 6px;">Team: ${escapeHtml(a.team_name || 'Solo')}</p>
          <p class="project-summary">${escapeHtml(a.project_summary || '')}</p>
        </div>
        <div class="assignment-actions">
          <div style="text-align: right; margin-bottom: 8px;">
            <span style="font-size: 11px; color: var(--text-tertiary);">Score: </span>
            <strong style="color: var(--accent-primary); font-size: 16px;">
              ${a.total_weighted_score !== null ? a.total_weighted_score.toFixed(2) : '--'}
            </strong>
          </div>
          <button class="btn ${isDone ? 'btn-outline' : 'btn-primary'}" data-action="score" data-id="${a.project_id}">
            ${isDone ? 'Edit Evaluation' : 'Score Project &rarr;'}
          </button>
        </div>
      `;

      card.querySelector('[data-action="score"]').addEventListener('click', () => {
        openScoringModal(a, data.rubric || []);
      });

      container.appendChild(card);
    });
  } catch (err) {
    console.error('Failed to load judge assignments:', err);
    container.innerHTML = '<div class="empty-state">Error loading assignments.</div>';
  }
}

// Scoring Modal
function openScoringModal(assignment, rubric) {
  document.getElementById('scoring-project-id').value = assignment.project_id;
  document.getElementById('modal-scoring-title').textContent = `Score: ${assignment.project_title}`;
  document.getElementById('modal-scoring-subtitle').textContent = `Team: ${assignment.team_name} | Track: ${assignment.track_name}`;
  document.getElementById('scoring-comment').value = assignment.comment || '';

  const rubricContainer = document.getElementById('rubric-inputs-container');
  rubricContainer.innerHTML = '';

  const existingCriteria = assignment.criteria || {};

  rubric.forEach(r => {
    const initialVal = existingCriteria[r.name] !== undefined ? existingCriteria[r.name] : 3.0;

    const div = document.createElement('div');
    div.className = 'rubric-item';
    div.innerHTML = `
      <div class="rubric-header">
        <span><strong>${escapeHtml(r.name.toUpperCase())}</strong> (Weight: ${Math.round(r.weight * 100)}%)</span>
        <span class="criterion-val" id="val-${r.name}">${initialVal.toFixed(1)}</span>
      </div>
      <p style="font-size: 11.5px; color: var(--text-secondary); margin-bottom: 6px;">${escapeHtml(r.description || '')}</p>
      <input type="range" class="slider-control" min="0" max="${r.max_score || 5}" step="0.5"
             data-criterion="${r.name}" data-weight="${r.weight}" value="${initialVal}">
    `;

    const slider = div.querySelector('.slider-control');
    slider.addEventListener('input', (e) => {
      div.querySelector(`#val-${r.name}`).textContent = parseFloat(e.target.value).toFixed(1);
      updateScoringPreview(rubric);
    });

    rubricContainer.appendChild(div);
  });

  updateScoringPreview(rubric);
  document.getElementById('modal-scoring').classList.add('show');
}

function updateScoringPreview(rubric) {
  let weightedSum = 0;
  let totalWeight = 0;

  const sliders = document.querySelectorAll('#rubric-inputs-container .slider-control');
  sliders.forEach(s => {
    const val = parseFloat(s.value);
    const weight = parseFloat(s.dataset.weight);
    weightedSum += val * weight;
    totalWeight += weight;
  });

  const total = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
  document.getElementById('scoring-preview-total').textContent = total.toFixed(2);
}

async function handleScoringSubmission(e) {
  e.preventDefault();

  const projectId = document.getElementById('scoring-project-id').value;
  const comment = document.getElementById('scoring-comment').value;

  const criteria = {};
  document.querySelectorAll('#rubric-inputs-container .slider-control').forEach(s => {
    criteria[s.dataset.criterion] = parseFloat(s.value);
  });

  try {
    const res = await apiFetch('/api/judge/scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        project_id: projectId,
        criteria,
        comment
      })
    });

    if (res.ok) {
      document.getElementById('modal-scoring').classList.remove('show');
      await loadJudgePortal();
      await loadProjects();
      alert('Review successfully submitted and recorded in audit log!');
    } else {
      const err = await res.json();
      alert(`Submission failed: ${err.message || err.error}`);
    }
  } catch (err) {
    console.error('Review submit failed:', err);
    alert('Failed to submit review.');
  }
}

// Organizer Command Center
async function loadOrganizerOverview() {
  if (!state.currentUser || state.currentUser.role !== 'organizer') {
    document.getElementById('view-organizer').innerHTML = `
      <div class="empty-state">
        <p><strong>Organizer Access Required</strong></p>
        <p>Click <strong>"Organizer"</strong> in the top role bar to view the Command Center.</p>
      </div>
    `;
    return;
  }

  try {
    const res = await apiFetch('/api/organizer/overview');
    if (!res.ok) {
      alert('Access to Organizer Command Center denied.');
      return;
    }
    const data = await res.json();
    const health = data.health;

    // KPI Cards
    document.getElementById('kpi-projects').textContent = health.overview.totalProjects;
    document.getElementById('kpi-judges').textContent = health.overview.totalJudges;
    document.getElementById('kpi-reviews').textContent = health.overview.totalReviews;
    document.getElementById('kpi-coverage').textContent = `${health.overview.coverageRate}%`;

    // Coverage Progress Bar
    const covBar = document.getElementById('coverage-progress-bar');
    const total = health.overview.totalProjects || 1;
    const c3Pct = ((health.coverage.threeOrMore / total) * 100).toFixed(1);
    const c2Pct = ((health.coverage.two / total) * 100).toFixed(1);
    const c1Pct = ((health.coverage.one / total) * 100).toFixed(1);
    const c0Pct = ((health.coverage.zero / total) * 100).toFixed(1);

    covBar.innerHTML = `
      <div class="cov-seg c3" style="width: ${c3Pct}%;" title="3+ reviews: ${health.coverage.threeOrMore}"></div>
      <div class="cov-seg c2" style="width: ${c2Pct}%;" title="2 reviews: ${health.coverage.two}"></div>
      <div class="cov-seg c1" style="width: ${c1Pct}%;" title="1 review: ${health.coverage.one}"></div>
      <div class="cov-seg c0" style="width: ${c0Pct}%;" title="0 reviews: ${health.coverage.zero}"></div>
    `;

    document.getElementById('coverage-legend').innerHTML = `
      <div class="legend-item"><span class="legend-dot" style="background: var(--accent-primary);"></span> 3+ Reviews (${health.coverage.threeOrMore})</div>
      <div class="legend-item"><span class="legend-dot" style="background: #0284c7;"></span> 2 Reviews (${health.coverage.two})</div>
      <div class="legend-item"><span class="legend-dot" style="background: var(--accent-warning);"></span> 1 Review (${health.coverage.one})</div>
      <div class="legend-item"><span class="legend-dot" style="background: var(--accent-danger);"></span> 0 Reviews (${health.coverage.zero})</div>
    `;

    // Flags
    const flagsContainer = document.getElementById('flags-container');
    flagsContainer.innerHTML = '';
    if (health.flags.length === 0) {
      flagsContainer.innerHTML = '<div class="empty-state">No integrity flags detected.</div>';
    } else {
      health.flags.forEach(f => {
        const item = document.createElement('div');
        item.className = 'flag-item';
        item.innerHTML = `
          <div class="flag-header">
            <span class="flag-title">&#9888; ${escapeHtml(f.title)}</span>
            <span class="badge notice">${escapeHtml(f.type)}</span>
          </div>
          <p class="flag-desc">${escapeHtml(f.description)}</p>
          <p class="flag-action">${escapeHtml(f.action_recommended)}</p>
        `;
        flagsContainer.appendChild(item);
      });
    }

    // Populate assignment dropdowns
    await populateAssignmentForm();
  } catch (err) {
    console.error('Failed to load organizer overview:', err);
  }
}

async function populateAssignmentForm() {
  const projSelect = document.getElementById('assign-project');
  const judgeSelect = document.getElementById('assign-judge');

  projSelect.innerHTML = '<option value="">-- Choose Project --</option>';
  judgeSelect.innerHTML = '<option value="">-- Choose Judge --</option>';

  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.title} (${p.track_name || 'General'})`;
    opt.dataset.track = p.track_id;
    projSelect.appendChild(opt);
  });

  try {
    const res = await apiFetch('/api/results');
    const data = await res.json();
    const judges = data.judges || {};

    Object.values(judges).forEach(j => {
      const opt = document.createElement('option');
      opt.value = j.judge_id;
      opt.textContent = `${j.judge_name} (${j.judge_id}) - ${j.review_count} revs`;
      judgeSelect.appendChild(opt);
    });
  } catch (err) {
    console.error('Failed to populate judges:', err);
  }
}

function checkAssignmentTrackMatch() {
  const projSelect = document.getElementById('assign-project');
  const warning = document.getElementById('assign-track-warning');
  const selectedProj = projSelect.options[projSelect.selectedIndex];

  if (!selectedProj || !selectedProj.value) {
    warning.textContent = '';
    return;
  }
  warning.textContent = `✓ Selected Project Track: ${selectedProj.dataset.track}`;
  warning.className = 'track-match-hint';
}

async function handleCreateAssignment(e) {
  e.preventDefault();
  const projectId = document.getElementById('assign-project').value;
  const judgeId = document.getElementById('assign-judge').value;

  if (!projectId || !judgeId) return;

  try {
    const res = await apiFetch('/api/organizer/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project_id: projectId, judge_id: judgeId })
    });

    const data = await res.json();
    if (res.ok) {
      alert(`Assignment created! ${data.track_match ? '✓ Track matches judge specialty.' : 'Note: Cross-track assignment.'}`);
      await loadOrganizerOverview();
    } else {
      alert(`Failed: ${data.error}`);
    }
  } catch (err) {
    console.error('Failed to create assignment:', err);
  }
}

// Deadline Toggle
async function updateDeadline(isoString) {
  try {
    const res = await apiFetch('/api/organizer/settings/deadline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissions_close: isoString })
    });

    if (res.ok) {
      alert('Deadline updated successfully!');
      await loadEventData();
    } else {
      const err = await res.json();
      alert(`Error: ${err.error}`);
    }
  } catch (err) {
    console.error('Failed to update deadline:', err);
  }
}

// Normalization & Proof View
async function loadNormalizationData() {
  try {
    const res = await apiFetch('/api/results');
    const data = await res.json();
    state.normalizationData = data;

    // Meta stats
    document.getElementById('meta-global-mean').textContent = data.global.mean.toFixed(2);
    document.getElementById('meta-global-std').textContent = data.global.stdDev.toFixed(2);
    document.getElementById('meta-global-reviews').textContent = data.global.totalReviews;

    renderRankingsTable();
    renderJudgeDistributions(data.judges || {});
  } catch (err) {
    console.error('Failed to load normalization data:', err);
  }
}

function renderRankingsTable() {
  const tbody = document.getElementById('rankings-table-body');
  tbody.innerHTML = '';

  if (!state.normalizationData || !state.normalizationData.rankings) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No ranking data available.</td></tr>';
    return;
  }

  let list = [...state.normalizationData.rankings];
  if (state.rankOrder === 'raw') {
    list.sort((a, b) => b.raw_score - a.raw_score);
  } else {
    list.sort((a, b) => b.normalized_score - a.normalized_score);
  }

  list.forEach((p, idx) => {
    const currentRank = idx + 1;
    const tr = document.createElement('tr');

    let deltaHtml = '<span class="delta-tag neutral">0</span>';
    if (p.rank_delta > 0) {
      deltaHtml = `<span class="delta-tag up">+${p.rank_delta}</span>`;
    } else if (p.rank_delta < 0) {
      deltaHtml = `<span class="delta-tag down">${p.rank_delta}</span>`;
    }

    tr.innerHTML = `
      <td><strong>#${currentRank}</strong></td>
      <td>
        <strong>${escapeHtml(p.title)}</strong><br>
        <span style="font-size: 11px; color: var(--text-secondary);">${escapeHtml(p.team_name || 'Solo')}</span>
      </td>
      <td><span class="track-badge">${escapeHtml(p.track_name || 'General')}</span></td>
      <td>${p.raw_score > 0 ? p.raw_score.toFixed(2) : '--'}</td>
      <td><strong style="color: var(--accent-primary);">${p.normalized_score > 0 ? p.normalized_score.toFixed(2) : '--'}</strong></td>
      <td>${deltaHtml}</td>
      <td>${p.review_count}</td>
      <td>
        <button class="btn btn-sm btn-outline" data-inspect="${p.id}">Inspect Proof</button>
      </td>
    `;

    tr.querySelector('[data-inspect]').addEventListener('click', () => openProjectModal(p.id));
    tbody.appendChild(tr);
  });
}

function renderJudgeDistributions(judges) {
  const container = document.getElementById('judge-distributions-grid');
  container.innerHTML = '';

  Object.values(judges).forEach(j => {
    const card = document.createElement('div');
    card.className = 'judge-card';

    let biasLabel = 'Balanced';
    let biasColor = 'var(--text-tertiary)';
    if (j.bias_vs_global > 0.15) {
      biasLabel = `Lenient (+${j.bias_vs_global.toFixed(2)})`;
      biasColor = 'var(--accent-danger)';
    } else if (j.bias_vs_global < -0.15) {
      biasLabel = `Harsh (${j.bias_vs_global.toFixed(2)})`;
      biasColor = 'var(--accent-primary)';
    }

    card.innerHTML = `
      <div class="judge-card-header">
        <span>${escapeHtml(j.judge_name)}</span>
        <span style="color: ${biasColor};">${biasLabel}</span>
      </div>
      <div style="font-size: 11px; color: var(--text-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 4px;">
        <span>Mean Score: <strong>${j.mean.toFixed(2)}</strong></span>
        <span>Std Dev: <strong>${j.effective_std_dev.toFixed(2)}</strong></span>
        <span>Evaluations: <strong>${j.review_count}</strong></span>
        <span>Adjusted: <strong>${j.is_zero_variance ? 'Variance reg.' : 'Z-Score'}</strong></span>
      </div>
    `;

    container.appendChild(card);
  });
}

// Audit Trail
async function loadAuditTrail() {
  const tbody = document.getElementById('audit-table-body');
  tbody.innerHTML = '<tr><td colspan="6" class="loading-state">Loading audit events...</td></tr>';

  try {
    const res = await apiFetch('/api/organizer/audit');
    if (res.status === 403 || res.status === 401) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Organizer authentication required to inspect audit logs.</td></tr>';
      return;
    }

    const data = await res.json();
    const logs = data.logs || [];

    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No audit logs recorded yet.</td></tr>';
      return;
    }

    tbody.innerHTML = '';
    logs.forEach(log => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="color: var(--text-tertiary); font-size: 11px;">${new Date(log.timestamp).toLocaleTimeString()} (${new Date(log.timestamp).toLocaleDateString()})</td>
        <td><strong>${escapeHtml(log.user_id || 'system')}</strong></td>
        <td><span class="badge notice">${escapeHtml(log.role || 'system')}</span></td>
        <td><code style="color: var(--accent-primary);">${escapeHtml(log.action)}</code></td>
        <td>${escapeHtml(log.resource_type)} ${log.resource_id ? `(${log.resource_id})` : ''}</td>
        <td style="font-size: 11px; color: var(--text-secondary); max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(log.details || '')}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Failed to load audit logs:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Error fetching audit logs.</td></tr>';
  }
}

// CSV Export Handler
async function handleExportCsv() {
  try {
    const res = await apiFetch('/api/export.csv');
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        alert('Access denied: CSV Export is restricted to organizers only (DOGFOOD Check 7). Please switch to the Organizer role first.');
      } else {
        alert('Failed to export CSV.');
      }
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'judgely-results.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error('CSV export failed:', err);
  }
}

// Submission Modal
function openSubmitModal() {
  const isClosed = state.event && (new Date() > new Date(state.event.submissions_close));
  const notice = document.getElementById('submit-notice-container');

  if (isClosed) {
    notice.innerHTML = `
      <div class="judge-isolation-notice" style="margin-bottom: 16px;">
        <span style="font-size: 16px;">&#9888;</span>
        <div>
          <strong>Submissions are currently closed.</strong><br>
          The deadline for ${state.event.name} passed on ${new Date(state.event.submissions_close).toUTCString()}.
          Submitting will be rejected by the portal (DOGFOOD Check 3).
        </div>
      </div>
    `;
  } else {
    notice.innerHTML = '';
  }

  document.getElementById('modal-submit-project').classList.add('show');
}

function closeSubmitModal() {
  document.getElementById('modal-submit-project').classList.remove('show');
}

async function handleProjectSubmission(e) {
  e.preventDefault();

  const title = document.getElementById('input-sub-title').value;
  const trackId = document.getElementById('input-sub-track').value;
  const teamName = document.getElementById('input-sub-team').value;
  const repoUrl = document.getElementById('input-sub-repo').value;
  const summary = document.getElementById('input-sub-summary').value;

  try {
    const res = await apiFetch('/projects/new', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        track_id: trackId,
        team_name: teamName,
        repo_url: repoUrl,
        summary
      })
    });

    const data = await res.json();
    if (res.ok) {
      alert('Project submitted successfully!');
      closeSubmitModal();
      await loadProjects();
    } else {
      alert(`Submission Refused: ${data.message || data.error} (HTTP ${res.status})`);
    }
  } catch (err) {
    console.error('Submission request failed:', err);
    alert('Submission failed.');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
