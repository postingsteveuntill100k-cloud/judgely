/**
 * JUDGELY — Frontend Application Core
 * Professional Hackathon Platform & Judging Workflow Engine
 * Zero localStorage credentials • Zero fake fixture fallbacks • Strict role isolation
 */

// ============================================================================
// State Management
// ============================================================================
const state = {
  user: { role: 'visitor' },
  event: null,
  tracks: [],
  projects: [],
  activeWorkspace: 'public',
  activeTrack: 'all',
  searchQuery: '',
  judgeAssignments: [],
  judgeRubric: [],
  organizerData: {
    health: null,
    assignments: [],
    normalization: null,
    audits: []
  }
};

// ============================================================================
// Security Helpers (XSS & Protocol Defense)
// ============================================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '';
  const s = url.trim();
  if (/^https?:\/\//i.test(s)) return escapeHtml(s);
  return '';
}

// Toast Notifications
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

// ============================================================================
// API Client (Zero Mock Fallback — Real Errors Only)
// ============================================================================
async function apiFetch(endpoint, options = {}) {
  const defaultHeaders = {
    'Accept': 'application/json'
  };

  if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
    defaultHeaders['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    },
    credentials: 'same-origin' // Ensures HttpOnly session cookies are transmitted
  };

  const response = await fetch(endpoint, config);
  return response;
}

// ============================================================================
// Initialization & Role Resolution
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  await initApp();
  setupGlobalEventListeners();
});

async function initApp() {
  try {
    // 1. Resolve server-managed session identity
    const authRes = await apiFetch('/api/auth/me');
    if (authRes.ok) {
      const authData = await authRes.json();
      state.user = authData.user || { role: 'visitor' };
    } else {
      state.user = { role: 'visitor' };
    }

    // 2. Fetch event metadata & tracks
    const [eventRes, tracksRes] = await Promise.all([
      apiFetch('/api/event'),
      apiFetch('/api/tracks')
    ]);

    if (eventRes.ok) {
      state.event = await eventRes.json();
    }
    if (tracksRes.ok) {
      const data = await tracksRes.json();
      state.tracks = data.tracks || [];
    }

    // 3. Update top banner & branding
    updateEventBanner();
    updateUserBadge();
    setupNavigation();

    // 4. Determine initial active workspace based on authenticated role
    if (state.user.role === 'organizer') {
      switchWorkspace('organizer');
    } else if (state.user.role === 'judge') {
      switchWorkspace('judge');
    } else if (state.user.role === 'participant') {
      switchWorkspace('participant');
    } else {
      switchWorkspace('public');
    }
  } catch (err) {
    console.error('Initialization error:', err);
    showToast('Failed to connect to Judgely server.', 'error');
  }
}

function updateEventBanner() {
  const bannerText = document.getElementById('banner-event-text');
  const statusBadge = document.getElementById('banner-status-badge');
  const quickStats = document.getElementById('banner-quick-stats');
  const heroTitle = document.getElementById('public-hero-title');
  const heroDesc = document.getElementById('public-hero-desc');

  if (state.event) {
    if (heroTitle) heroTitle.textContent = state.event.name;
    if (heroDesc) heroDesc.textContent = state.event.description || 'Open-Source Hackathon Championship';

    const isReleased = Boolean(state.event.results_released);
    if (isReleased) {
      statusBadge.textContent = 'Results Released';
      statusBadge.className = 'badge badge-pulse';
    } else if (state.event.is_closed) {
      statusBadge.textContent = 'Judging in Progress';
      statusBadge.className = 'badge badge-neutral';
    } else {
      statusBadge.textContent = 'Submissions Open';
      statusBadge.className = 'badge badge-pulse';
    }

    const closeDate = state.event.submissions_close ? new Date(state.event.submissions_close).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
    bannerText.textContent = `${state.event.name} — Submissions closed on ${closeDate}. Evaluation active.`;
  }
}

function updateUserBadge() {
  const userName = document.getElementById('header-user-name');
  const userRole = document.getElementById('header-user-role');
  const btnLogout = document.getElementById('btn-logout');

  if (!userName || !userRole) return;

  if (state.user && state.user.role !== 'visitor') {
    userName.textContent = state.user.name || 'Authenticated User';
    userRole.textContent = state.user.role;
    if (btnLogout) btnLogout.style.display = 'inline-flex';
  } else {
    userName.textContent = 'Public Visitor';
    userRole.textContent = 'Visitor';
    if (btnLogout) btnLogout.style.display = 'none';
  }
}

function setupNavigation() {
  const navContainer = document.getElementById('main-nav-links');
  if (!navContainer) return;

  navContainer.innerHTML = '';

  const links = [];

  // Tailor top navigation links to role
  if (state.user.role === 'organizer') {
    links.push({ id: 'organizer', label: 'Command Center' });
    links.push({ id: 'public', label: 'Public Showcase' });
  } else if (state.user.role === 'judge') {
    links.push({ id: 'judge', label: 'My Reviews' });
    links.push({ id: 'public', label: 'Event Showcase' });
  } else if (state.user.role === 'participant') {
    links.push({ id: 'participant', label: 'My Workspace' });
    links.push({ id: 'public', label: 'Browse Projects' });
  } else {
    links.push({ id: 'public', label: 'Projects & Tracks' });
  }

  links.forEach(l => {
    const btn = document.createElement('button');
    btn.className = `nav-link-btn ${state.activeWorkspace === l.id ? 'active' : ''}`;
    btn.textContent = l.label;
    btn.addEventListener('click', () => switchWorkspace(l.id));
    navContainer.appendChild(btn);
  });
}

function switchWorkspace(workspaceId) {
  state.activeWorkspace = workspaceId;

  // Toggle workspace sections
  document.querySelectorAll('.workspace-section').forEach(sec => {
    sec.classList.remove('active');
  });

  const targetSec = document.getElementById(`workspace-${workspaceId}`);
  if (targetSec) {
    targetSec.classList.add('active');
  }

  // Update navigation active state
  document.querySelectorAll('.nav-link-btn').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(workspaceId));
  });

  // Load section-specific data
  if (workspaceId === 'public') {
    loadPublicProjects();
  } else if (workspaceId === 'participant') {
    loadParticipantWorkspace();
  } else if (workspaceId === 'judge') {
    loadJudgeWorkspace();
  } else if (workspaceId === 'organizer') {
    loadOrganizerWorkspace();
  }
}

// ============================================================================
// 1. PUBLIC WORKSPACE (Projects Gallery & Track Filtering)
// ============================================================================
async function loadPublicProjects() {
  const grid = document.getElementById('public-projects-grid');
  if (!grid) return;

  try {
    renderTrackPills();

    const res = await apiFetch('/api/projects');
    if (!res.ok) {
      grid.innerHTML = `<div class="alert-box alert-info"><p>Unable to load projects from server (HTTP ${res.status}).</p></div>`;
      return;
    }

    const data = await res.json();
    state.projects = data.projects || [];
    renderProjectsGrid();
  } catch (err) {
    grid.innerHTML = `<div class="alert-box alert-info"><p>Network error loading projects: ${escapeHtml(err.message)}</p></div>`;
  }
}

function renderTrackPills() {
  const container = document.getElementById('track-filter-pills');
  if (!container) return;

  container.innerHTML = '';

  const allPill = document.createElement('button');
  allPill.className = `track-pill ${state.activeTrack === 'all' ? 'active' : ''}`;
  allPill.textContent = 'All Tracks';
  allPill.addEventListener('click', () => {
    state.activeTrack = 'all';
    renderTrackPills();
    renderProjectsGrid();
  });
  container.appendChild(allPill);

  state.tracks.forEach(track => {
    const pill = document.createElement('button');
    pill.className = `track-pill ${state.activeTrack === track.id ? 'active' : ''}`;
    pill.textContent = track.name;
    pill.addEventListener('click', () => {
      state.activeTrack = track.id;
      renderTrackPills();
      renderProjectsGrid();
    });
    container.appendChild(pill);
  });
}

function renderProjectsGrid() {
  const grid = document.getElementById('public-projects-grid');
  if (!grid) return;

  let filtered = state.projects;

  if (state.activeTrack !== 'all') {
    filtered = filtered.filter(p => p.track_id === state.activeTrack);
  }

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    filtered = filtered.filter(p =>
      (p.title && p.title.toLowerCase().includes(q)) ||
      (p.summary && p.summary.toLowerCase().includes(q)) ||
      (p.team_name && p.team_name.toLowerCase().includes(q))
    );
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding: 3rem; color: var(--text-tertiary);">No matching projects found.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const isReleased = Boolean(state.event && state.event.results_released);
    const scorePill = (isReleased && p.normalized_score)
      ? `<span class="score-pill">Rank #${p.rank} • Score: <strong>${p.normalized_score.toFixed(2)}</strong></span>`
      : `<span class="score-pill status-eval">Judging in progress</span>`;

    return `
      <article class="project-card" data-project-id="${escapeHtml(p.id)}">
        <div class="card-header">
          <span class="track-badge">${escapeHtml(p.track_name || 'General')}</span>
          <span class="project-id">${escapeHtml(p.id)}</span>
        </div>
        <h3 class="project-title">${escapeHtml(p.title)}</h3>
        <p class="project-team">by <strong>${escapeHtml(p.team_name || 'Team')}</strong></p>
        <p class="project-summary">${escapeHtml(p.summary || '')}</p>
        <div class="card-footer">
          ${scorePill}
          <span class="reviews-pill">${p.review_count || 0} review${p.review_count === 1 ? '' : 's'}</span>
        </div>
      </article>
    `;
  }).join('');

  // Attach card click handlers for clean detail drawer
  grid.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => {
      const pid = card.getAttribute('data-project-id');
      openProjectDetailDrawer(pid);
    });
  });
}

async function openProjectDetailDrawer(projectId) {
  const overlay = document.getElementById('drawer-project-overlay');
  const content = document.getElementById('drawer-project-content');
  const trackBadge = document.getElementById('drawer-project-track');
  const idBadge = document.getElementById('drawer-project-id');

  if (!overlay || !content) return;

  overlay.classList.add('active');
  content.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading project details...</p></div>`;

  try {
    const res = await apiFetch(`/api/projects/${projectId}`);
    if (!res.ok) {
      content.innerHTML = `<div class="alert-box alert-info"><p>Failed to load project details (HTTP ${res.status}).</p></div>`;
      return;
    }

    const data = await res.json();
    const p = data.project;

    trackBadge.textContent = p.track_name || 'Track';
    idBadge.textContent = p.id;

    const isReleased = Boolean(state.event && state.event.results_released);
    const isOrganizer = state.user.role === 'organizer';
    const showScore = isReleased || isOrganizer;

    let scoreSection = '';
    if (showScore && p.normalized_score) {
      scoreSection = `
        <div style="background-color: var(--bg-subtle); padding: 1rem; border-radius: var(--radius-md); margin-bottom: 1.25rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong>Normalized Rank: #${p.rank}</strong>
            <span class="mono-val" style="font-size: 1.25rem; font-weight:700;">${p.normalized_score.toFixed(3)} / 5.000</span>
          </div>
          <p style="font-size: 0.8125rem; color: var(--text-tertiary); margin-top: 0.35rem;">${escapeHtml(p.explanation)}</p>
        </div>
      `;
    } else {
      scoreSection = `
        <div style="background-color: var(--bg-subtle); padding: 0.875rem 1rem; border-radius: var(--radius-md); margin-bottom: 1.25rem; font-size: 0.8125rem; color: var(--text-tertiary);">
          🔒 Results are currently embargoed. Scores will be published once officially released.
        </div>
      `;
    }

    // Role-specific reviews section
    let reviewsHtml = '';
    if (p.reviews_breakdown && p.reviews_breakdown.length > 0) {
      reviewsHtml = `
        <div style="margin-top: 1.5rem;">
          <h4 style="margin-bottom: 0.75rem; font-size: 0.9375rem;">Evaluator Feedback</h4>
          ${p.reviews_breakdown.map(r => `
            <div style="border: 1px solid var(--border-default); border-radius: var(--radius-sm); padding: 0.875rem; margin-bottom: 0.5rem;">
              <div style="display:flex; justify-content:space-between; margin-bottom: 0.25rem;">
                <strong>${escapeHtml(r.judge_name || 'Evaluator')}</strong>
                <span class="mono-val">Score: ${Number(r.raw_score).toFixed(2)}</span>
              </div>
              <p style="font-size: 0.8125rem; color: var(--text-secondary);">${escapeHtml(r.comment || 'No written comment provided.')}</p>
            </div>
          `).join('')}
        </div>
      `;
    }

    content.innerHTML = `
      <h2 style="font-size: 1.5rem; font-weight: 800; margin-bottom: 0.35rem;">${escapeHtml(p.title)}</h2>
      <p style="color: var(--text-tertiary); font-size: 0.875rem; margin-bottom: 1.25rem;">
        Team: <strong>${escapeHtml(p.team_name || 'Solo')}</strong>
        ${p.team_members && p.team_members.length ? `• Members: ${escapeHtml(p.team_members.join(', '))}` : ''}
      </p>

      ${scoreSection}

      <div style="margin-bottom: 1.25rem;">
        <h4 style="font-size: 0.8125rem; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 0.35rem;">Overview</h4>
        <p style="font-size: 0.9375rem; line-height: 1.6; color: var(--text-secondary);">${escapeHtml(p.summary || 'No overview provided.')}</p>
      </div>

      ${p.tech_stack ? `
        <div style="margin-bottom: 1.25rem;">
          <h4 style="font-size: 0.8125rem; text-transform: uppercase; color: var(--text-tertiary); margin-bottom: 0.35rem;">Technologies</h4>
          <p style="font-family: var(--font-mono); font-size: 0.8125rem; background: var(--bg-subtle); padding: 0.5rem 0.75rem; border-radius: var(--radius-sm);">${escapeHtml(p.tech_stack)}</p>
        </div>
      ` : ''}

      <div style="display:flex; gap: 0.75rem; margin-top: 1.5rem;">
        ${p.repo_url ? `<a href="${sanitizeUrl(p.repo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">GitHub Repository ↗</a>` : ''}
        ${p.demo_url ? `<a href="${sanitizeUrl(p.demo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Live Demo ↗</a>` : ''}
      </div>

      ${reviewsHtml}
    `;
  } catch (err) {
    content.innerHTML = `<div class="alert-box alert-info"><p>Error: ${escapeHtml(err.message)}</p></div>`;
  }
}

// ============================================================================
// 2. PARTICIPANT WORKSPACE (Hack2Skill Inspired Layout)
// ============================================================================
async function loadParticipantWorkspace() {
  const teamBody = document.getElementById('participant-team-body');
  const projectBody = document.getElementById('participant-project-body');
  const greeting = document.getElementById('participant-greeting');
  const teamAffil = document.getElementById('participant-team-affiliation');

  if (!teamBody || !projectBody) return;

  try {
    const res = await apiFetch('/api/participant/workspace');
    if (!res.ok) {
      teamBody.innerHTML = `<p class="alert-box alert-info">Participant workspace requires participant authentication.</p>`;
      projectBody.innerHTML = `<p class="alert-box alert-info">Please select the Participant demo persona.</p>`;
      return;
    }

    const data = await res.json();
    const user = data.user;
    const team = data.team;
    const members = data.members || [];
    const project = data.project;

    if (greeting) greeting.textContent = `Welcome, ${user.name}`;
    if (teamAffil) teamAffil.textContent = `Team: ${team ? team.name : 'Unassigned'} (${user.team_role || 'Member'})`;

    // Render Team Members
    if (team) {
      document.getElementById('team-size-badge').textContent = `${members.length} Member${members.length === 1 ? '' : 's'}`;
      teamBody.innerHTML = `
        <div style="margin-bottom: 1rem;">
          <h4 style="font-size: 1rem; font-weight: 700;">${escapeHtml(team.name)}</h4>
          <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary);">${escapeHtml(team.id)}</span>
        </div>
        <div class="team-members-list">
          ${members.map(m => `
            <div class="team-member-item">
              <div class="member-info">
                <strong>${escapeHtml(m.name || m.email.split('@')[0])}</strong>
                <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(m.email)}</span>
              </div>
              <span class="member-role-badge ${m.role === 'lead' ? 'lead' : ''}">${escapeHtml(m.role || 'member')}</span>
            </div>
          `).join('')}
        </div>
      `;
    } else {
      teamBody.innerHTML = `<p style="color: var(--text-tertiary);">No team assigned yet.</p>`;
    }

    // Render Project Submission
    if (project) {
      projectBody.innerHTML = `
        <div style="margin-bottom: 0.75rem;">
          <span class="badge" style="margin-bottom: 0.5rem;">${escapeHtml(project.track_name || 'Track')}</span>
          <h4 style="font-size: 1.125rem; font-weight: 700;">${escapeHtml(project.title)}</h4>
          <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary);">${escapeHtml(project.id)}</span>
        </div>
        <p style="font-size: 0.875rem; color: var(--text-secondary); line-height: 1.5; margin-bottom: 1rem;">
          ${escapeHtml(project.summary || 'No description provided.')}
        </p>
        <div style="display:flex; gap: 0.75rem;">
          ${project.repo_url ? `<a href="${sanitizeUrl(project.repo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline">Repository ↗</a>` : ''}
          ${project.demo_url ? `<a href="${sanitizeUrl(project.demo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline">Demo ↗</a>` : ''}
        </div>
      `;
    } else {
      projectBody.innerHTML = `
        <p style="color: var(--text-tertiary); margin-bottom: 1rem;">No project submitted yet for this team.</p>
        <button class="btn btn-primary btn-sm" id="btn-create-project-sub">+ Submit New Project</button>
      `;
      const btnCreate = document.getElementById('btn-create-project-sub');
      if (btnCreate) btnCreate.addEventListener('click', openSubmissionDrawer);
    }
  } catch (err) {
    teamBody.innerHTML = `<p class="alert-box alert-info">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function openSubmissionDrawer() {
  const overlay = document.getElementById('drawer-submission-overlay');
  const trackSelect = document.getElementById('sub-input-track');
  if (!overlay || !trackSelect) return;

  // Populate tracks dropdown
  trackSelect.innerHTML = state.tracks.map(t => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join('');

  overlay.classList.add('active');
}

// ============================================================================
// 3. JUDGE WORKSPACE (Assigned Projects & Rubric Scoring)
// ============================================================================
async function loadJudgeWorkspace() {
  const list = document.getElementById('judge-assignments-list');
  const greeting = document.getElementById('judge-greeting');
  if (!list) return;

  if (greeting && state.user.name) {
    greeting.textContent = `Good morning, ${state.user.name}`;
  }

  try {
    const res = await apiFetch('/api/judge/assignments');
    if (!res.ok) {
      list.innerHTML = `<p class="alert-box alert-info">Judge portal access denied (HTTP ${res.status}). Ensure Judge persona is active.</p>`;
      return;
    }

    const data = await res.json();
    state.judgeAssignments = data.assignments || [];
    state.judgeRubric = data.rubric || [];

    // Calculate workload metrics
    const total = state.judgeAssignments.length;
    const completed = state.judgeAssignments.filter(a => a.assignment_status === 'completed' || a.total_weighted_score !== null).length;
    const remaining = total - completed;

    document.getElementById('judge-stat-assigned').textContent = total;
    document.getElementById('judge-stat-completed').textContent = completed;
    document.getElementById('judge-stat-remaining').textContent = remaining;

    if (total === 0) {
      list.innerHTML = `<div style="text-align:center; padding: 2rem; color: var(--text-tertiary);">No projects currently assigned to your panel.</div>`;
      return;
    }

    list.innerHTML = state.judgeAssignments.map(a => {
      const isCompleted = a.assignment_status === 'completed' || a.total_weighted_score !== null;
      const statusBadge = isCompleted
        ? `<span class="badge" style="background-color: var(--accent-success-subtle); color: var(--accent-success);">Score: ${Number(a.total_weighted_score).toFixed(2)}</span>`
        : `<span class="badge badge-pulse">Pending Evaluation</span>`;

      return `
        <div class="assignment-row-card">
          <div class="assignment-details">
            <div style="display:flex; align-items:center; gap: 0.5rem; margin-bottom: 0.25rem;">
              <span class="track-badge">${escapeHtml(a.track_name || 'Track')}</span>
              <span class="mono-id">${escapeHtml(a.project_id)}</span>
            </div>
            <h4>${escapeHtml(a.project_title)}</h4>
            <p style="font-size: 0.8125rem; color: var(--text-tertiary); margin-bottom: 0.5rem;">Team: ${escapeHtml(a.team_name || 'Solo')}</p>
            <p style="font-size: 0.875rem; color: var(--text-secondary); line-height: 1.4;">${escapeHtml(a.project_summary || '')}</p>
          </div>
          <div class="assignment-actions">
            ${statusBadge}
            <button class="btn btn-sm ${isCompleted ? 'btn-outline' : 'btn-primary'}" data-score-project-id="${escapeHtml(a.project_id)}">
              ${isCompleted ? 'Update Review' : 'Evaluate'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Attach evaluation button listeners
    list.querySelectorAll('[data-score-project-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-score-project-id');
        openJudgeScoringDrawer(pid);
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="alert-box alert-info">Network error: ${escapeHtml(err.message)}</p>`;
  }
}

function openJudgeScoringDrawer(projectId) {
  const overlay = document.getElementById('drawer-score-overlay');
  const projectTitle = document.getElementById('drawer-score-project-title');
  const summaryBox = document.getElementById('score-project-summary-box');
  const rubricList = document.getElementById('judge-rubric-inputs-list');
  const hiddenId = document.getElementById('score-input-project-id');
  const commentInput = document.getElementById('judge-comment-input');

  const assignment = state.judgeAssignments.find(a => a.project_id === projectId);
  if (!assignment || !overlay) return;

  hiddenId.value = projectId;
  projectTitle.textContent = `Evaluating: ${assignment.project_title}`;

  summaryBox.innerHTML = `
    <div style="display:flex; justify-content:space-between; margin-bottom: 0.35rem;">
      <span class="track-badge">${escapeHtml(assignment.track_name || 'Track')}</span>
      <span class="mono-id">${escapeHtml(projectId)}</span>
    </div>
    <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 0.5rem;">${escapeHtml(assignment.project_summary || '')}</p>
    ${assignment.repo_url ? `<a href="${sanitizeUrl(assignment.repo_url)}" target="_blank" rel="noopener noreferrer" style="font-size: 0.8125rem; color: var(--accent-primary);">View GitHub Repository ↗</a>` : ''}
  `;

  // Render authoritative rubric inputs
  const existingCriteria = assignment.criteria || {};
  rubricList.innerHTML = state.judgeRubric.map(r => {
    const val = existingCriteria[r.name] !== undefined ? existingCriteria[r.name] : 4.0;
    return `
      <div class="rubric-input-group" style="background: var(--bg-subtle); padding: 0.875rem 1rem; border-radius: var(--radius-sm); margin-bottom: 0.75rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 0.25rem;">
          <strong>${escapeHtml(r.name.toUpperCase())} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: normal;">(Weight: ${Math.round(r.weight * 100)}%)</span></strong>
          <span class="mono-val" id="val-display-${escapeHtml(r.name)}" style="font-weight: 700;">${Number(val).toFixed(1)} / ${r.max_score}</span>
        </div>
        <p style="font-size: 0.75rem; color: var(--text-tertiary); margin-bottom: 0.5rem;">${escapeHtml(r.description || '')}</p>
        <input type="range" class="form-control" name="crit_${escapeHtml(r.name)}" min="0" max="${r.max_score}" step="0.5" value="${val}" style="width: 100%;">
      </div>
    `;
  }).join('');

  if (commentInput) {
    commentInput.value = assignment.comment || '';
  }

  // Live score calculation
  const updateScorePreview = () => {
    let weightedSum = 0;
    let totalWeight = 0;

    state.judgeRubric.forEach(r => {
      const input = rubricList.querySelector(`input[name="crit_${r.name}"]`);
      const display = document.getElementById(`val-display-${r.name}`);
      if (input) {
        const num = parseFloat(input.value) || 0;
        if (display) display.textContent = `${num.toFixed(1)} / ${r.max_score}`;
        weightedSum += num * r.weight;
        totalWeight += r.weight;
      }
    });

    const finalWeighted = totalWeight > 0 ? (weightedSum / totalWeight).toFixed(2) : '0.00';
    document.getElementById('preview-weighted-score').textContent = `${finalWeighted} / 5.00`;
  };

  rubricList.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', updateScorePreview);
  });
  updateScorePreview();

  overlay.classList.add('active');
}

// ============================================================================
// 4. ORGANIZER WORKSPACE (Operations, Assignments & Results Release)
// ============================================================================
async function loadOrganizerWorkspace() {
  try {
    const [overviewRes, asgRes, resultsRes, auditRes] = await Promise.all([
      apiFetch('/api/organizer/overview'),
      apiFetch('/api/organizer/assignments'),
      apiFetch('/api/results'),
      apiFetch('/api/organizer/audit')
    ]);

    if (!overviewRes.ok) {
      showToast('Organizer access denied. Switch to Organizer persona.', 'error');
      return;
    }

    const overviewData = await overviewRes.json();
    state.organizerData.health = overviewData.health;
    state.event = overviewData.event || state.event;

    // 1. Update Metrics
    const ov = state.organizerData.health.overview;
    document.getElementById('org-metric-coverage').textContent = `${ov.coverageRate}%`;
    document.getElementById('org-metric-coverage-sub').textContent = `${ov.totalProjects - state.organizerData.health.coverage.zero} of ${ov.totalProjects} projects reviewed`;
    document.getElementById('org-metric-reviews').textContent = ov.totalReviews;
    document.getElementById('org-metric-flags').textContent = state.organizerData.health.flags.length;

    // 2. Coverage Bar
    const cov = state.organizerData.health.coverage;
    const totalP = Math.max(1, ov.totalProjects);
    document.getElementById('cov-bar-zero').style.width = `${(cov.zero / totalP) * 100}%`;
    document.getElementById('cov-bar-one').style.width = `${(cov.one / totalP) * 100}%`;
    document.getElementById('cov-bar-two').style.width = `${(cov.two / totalP) * 100}%`;
    document.getElementById('cov-bar-three').style.width = `${(cov.threeOrMore / totalP) * 100}%`;

    document.getElementById('lbl-cov-0').textContent = cov.zero;
    document.getElementById('lbl-cov-1').textContent = cov.one;
    document.getElementById('lbl-cov-2').textContent = cov.two;
    document.getElementById('lbl-cov-3').textContent = cov.threeOrMore;
    document.getElementById('org-coverage-pct').textContent = `${ov.coverageRate}% Reviewed`;

    // 3. Results Release Toggle Switch
    const releaseBtn = document.getElementById('btn-toggle-release');
    const releaseText = document.getElementById('btn-release-text');
    const isReleased = Boolean(state.event && state.event.results_released);
    if (releaseBtn && releaseText) {
      releaseBtn.setAttribute('data-released', isReleased ? 'true' : 'false');
      releaseBtn.className = `btn btn-sm ${isReleased ? 'btn-primary' : 'btn-outline'}`;
      releaseText.textContent = isReleased ? '🔓 Results Publicly Released' : '🔒 Results Embargoed (Private)';
    }

    // 4. Integrity Anomaly Flags (Phase 9)
    renderOrganizerFlags(state.organizerData.health.flags);

    // 5. Assignments Matrix
    if (asgRes.ok) {
      const asgData = await asgRes.json();
      state.organizerData.assignments = asgData.assignments || [];
      renderOrganizerAssignmentsTable();
      populateAssignmentFormSelectors();
    }

    // 6. Normalization Proof Table
    if (resultsRes.ok) {
      const resData = await resultsRes.json();
      state.organizerData.normalization = resData;
      renderNormalizationTable(resData.rankings || []);
    }

    // 7. Audit Log Trail
    if (auditRes.ok) {
      const auditData = await auditRes.json();
      state.organizerData.audits = auditData.logs || [];
      renderAuditTable(state.organizerData.audits);
    }
  } catch (err) {
    console.error('Organizer workspace load error:', err);
  }
}

function renderOrganizerFlags(flags) {
  const container = document.getElementById('organizer-flags-list');
  if (!container) return;

  if (!flags || flags.length === 0) {
    container.innerHTML = `<p style="color: var(--accent-success); font-size: 0.875rem;">✓ No integrity flags detected. Judging distribution is balanced.</p>`;
    return;
  }

  container.innerHTML = flags.map(f => `
    <div class="flag-card">
      <div class="flag-header">
        <span class="flag-title">${escapeHtml(f.title)}</span>
        <span class="badge badge-neutral">${escapeHtml(f.resource_type)}: ${escapeHtml(f.resource_id)}</span>
      </div>
      <p class="flag-desc">${escapeHtml(f.description)}</p>
      <div class="flag-action">Recommended Action: ${escapeHtml(f.action_recommended)}</div>
    </div>
  `).join('');
}

function renderOrganizerAssignmentsTable() {
  const tbody = document.getElementById('tbody-assignments');
  if (!tbody) return;

  const asgs = state.organizerData.assignments;
  if (!asgs || asgs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem;">No assignments recorded.</td></tr>`;
    return;
  }

  tbody.innerHTML = asgs.map(a => `
    <tr>
      <td><strong>${escapeHtml(a.project_title)}</strong> <br><span class="mono-id">${escapeHtml(a.project_id)}</span></td>
      <td><span class="track-badge">${escapeHtml(a.project_track)}</span></td>
      <td>${escapeHtml(a.judge_name)} <br><span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(a.judge_email)}</span></td>
      <td>
        <span class="badge ${a.track_match ? 'badge-pulse' : 'badge-neutral'}">
          ${a.track_match ? '✓ Matched' : '⚠ Cross-Track'}
        </span>
      </td>
      <td><span class="badge ${a.status === 'completed' ? 'badge-pulse' : 'badge-neutral'}">${escapeHtml(a.status)}</span></td>
      <td class="mono-cell">${a.total_weighted_score ? Number(a.total_weighted_score).toFixed(2) : '—'}</td>
      <td>
        <button class="btn btn-sm btn-ghost" data-delete-asg-project="${escapeHtml(a.project_id)}" data-delete-asg-judge="${escapeHtml(a.judge_id)}" title="Remove assignment">
          Remove
        </button>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('[data-delete-asg-project]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.getAttribute('data-delete-asg-project');
      const jid = btn.getAttribute('data-delete-asg-judge');
      if (confirm(`Remove judge assignment for project ${pid}?`)) {
        const res = await apiFetch('/api/organizer/assignments', {
          method: 'DELETE',
          body: { project_id: pid, judge_id: jid }
        });
        if (res.ok) {
          showToast('Assignment removed successfully', 'info');
          loadOrganizerWorkspace();
        } else {
          showToast('Failed to remove assignment', 'error');
        }
      }
    });
  });
}

function populateAssignmentFormSelectors() {
  const projSelect = document.getElementById('asg-select-project');
  const judgeSelect = document.getElementById('asg-select-judge');
  if (!projSelect || !judgeSelect) return;

  projSelect.innerHTML = '<option value="">-- Choose Target Project --</option>' +
    state.projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${escapeHtml(p.id)} - ${escapeHtml(p.track_name || p.track_id)})</option>`).join('');

  const workloads = state.organizerData.health ? state.organizerData.health.judgeWorkloads : [];
  judgeSelect.innerHTML = '<option value="">-- Choose Judge --</option>' +
    workloads.map(j => `<option value="${escapeHtml(j.id)}">${escapeHtml(j.name)} (${j.assigned_count} assigned, ${j.pending_count} pending)</option>`).join('');
}

function renderNormalizationTable(rankings) {
  const tbody = document.getElementById('tbody-normalization');
  if (!tbody) return;

  if (!rankings || rankings.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 2rem;">No ranking data computed.</td></tr>`;
    return;
  }

  tbody.innerHTML = rankings.map(r => `
    <tr>
      <td class="mono-cell"><strong>#${r.rank}</strong></td>
      <td><strong>${escapeHtml(r.title)}</strong></td>
      <td>${escapeHtml(r.team_name || '')}</td>
      <td><span class="track-badge">${escapeHtml(r.track_name || '')}</span></td>
      <td class="mono-cell">${r.raw_score.toFixed(3)}</td>
      <td class="mono-cell"><strong>${r.normalized_score.toFixed(3)}</strong></td>
      <td class="mono-cell">${r.rank_delta > 0 ? `+${r.rank_delta}` : r.rank_delta}</td>
      <td>${r.review_count}</td>
      <td style="font-size: 0.8125rem; color: var(--text-tertiary); max-width: 250px;">${escapeHtml(r.explanation)}</td>
    </tr>
  `).join('');
}

function renderAuditTable(logs) {
  const tbody = document.getElementById('tbody-audit');
  if (!tbody) return;

  if (!logs || logs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">No audit logs recorded.</td></tr>`;
    return;
  }

  tbody.innerHTML = logs.map(l => {
    const time = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return `
      <tr>
        <td class="mono-cell" style="font-size: 0.75rem;">${time}</td>
        <td class="mono-cell">${escapeHtml(l.user_id)}</td>
        <td><span class="role-chip">${escapeHtml(l.role)}</span></td>
        <td><strong>${escapeHtml(l.action)}</strong></td>
        <td class="mono-cell">${escapeHtml(l.resource_type)}: ${escapeHtml(l.resource_id || '')}</td>
        <td style="font-size: 0.75rem; font-family: var(--font-mono); color: var(--text-muted);">${escapeHtml(l.details || '')}</td>
      </tr>
    `;
  }).join('');
}

// ============================================================================
// Event Listeners & Persona Switcher Handlers
// ============================================================================
function setupGlobalEventListeners() {
  // Brand Click -> Return to Public or Home
  const brand = document.getElementById('brand-home');
  if (brand) brand.addEventListener('click', () => switchWorkspace('public'));

  // Hero CTAs
  const btnExplore = document.getElementById('btn-hero-explore-projects');
  if (btnExplore) {
    btnExplore.addEventListener('click', () => {
      document.getElementById('section-gallery').scrollIntoView({ behavior: 'smooth' });
    });
  }

  // Search Input
  const searchInput = document.getElementById('gallery-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      renderProjectsGrid();
    });
  }

  // Drawers Close Buttons
  document.getElementById('btn-close-project-drawer')?.addEventListener('click', () => {
    document.getElementById('drawer-project-overlay').classList.remove('active');
  });
  document.getElementById('btn-close-score-drawer')?.addEventListener('click', () => {
    document.getElementById('drawer-score-overlay').classList.remove('active');
  });
  document.getElementById('btn-cancel-evaluation')?.addEventListener('click', () => {
    document.getElementById('drawer-score-overlay').classList.remove('active');
  });
  document.getElementById('btn-close-sub-drawer')?.addEventListener('click', () => {
    document.getElementById('drawer-submission-overlay').classList.remove('active');
  });
  document.getElementById('btn-cancel-submission')?.addEventListener('click', () => {
    document.getElementById('drawer-submission-overlay').classList.remove('active');
  });

  // Modal: Demo Persona Switcher
  const demoModal = document.getElementById('modal-demo-switcher');
  document.getElementById('btn-open-demo-switcher')?.addEventListener('click', () => {
    demoModal.classList.add('active');
  });
  document.getElementById('btn-close-demo-modal')?.addEventListener('click', () => {
    demoModal.classList.remove('active');
  });

  // Persona Selection Cards
  document.querySelectorAll('.persona-card').forEach(card => {
    card.addEventListener('click', async () => {
      const persona = card.getAttribute('data-persona');
      demoModal.classList.remove('active');
      await switchDemoPersona(persona);
    });
  });

  // Logout Button
  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    showToast('Signed out successfully.', 'info');
    await initApp();
  });

  // Judge Review Submission Form
  const judgeForm = document.getElementById('form-judge-evaluation');
  if (judgeForm) {
    judgeForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectId = document.getElementById('score-input-project-id').value;
      const comment = document.getElementById('judge-comment-input').value;

      const criteria = {};
      state.judgeRubric.forEach(r => {
        const input = judgeForm.querySelector(`input[name="crit_${r.name}"]`);
        if (input) {
          criteria[r.name] = parseFloat(input.value);
        }
      });

      try {
        const res = await apiFetch('/api/judge/scores', {
          method: 'POST',
          body: {
            project_id: projectId,
            criteria,
            comment
          }
        });

        const data = await res.json();
        if (res.ok) {
          showToast(`Review submitted! Total score: ${data.totalWeightedScore}`, 'success');
          document.getElementById('drawer-score-overlay').classList.remove('active');
          loadJudgeWorkspace();
        } else {
          showToast(`Failed: ${data.message || data.error}`, 'error');
        }
      } catch (err) {
        showToast(`Submission error: ${err.message}`, 'error');
      }
    });
  }

  // Organizer: Results Release Toggle
  const btnRelease = document.getElementById('btn-toggle-release');
  if (btnRelease) {
    btnRelease.addEventListener('click', async () => {
      const current = btnRelease.getAttribute('data-released') === 'true';
      const targetState = !current;

      const res = await apiFetch('/api/organizer/settings/results-visibility', {
        method: 'POST',
        body: { results_released: targetState }
      });

      if (res.ok) {
        showToast(targetState ? 'Results officially released!' : 'Results re-embargoed.', 'success');
        await loadOrganizerWorkspace();
        updateEventBanner();
      } else {
        showToast('Failed to update results visibility.', 'error');
      }
    });
  }

  // Organizer: Export CSV Button
  const btnExport = document.getElementById('btn-organizer-export-csv');
  if (btnExport) {
    btnExport.addEventListener('click', () => {
      window.location.href = '/api/export.csv';
    });
  }

  // Organizer Sub-tabs
  document.querySelectorAll('.org-sub-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const view = tab.getAttribute('data-org-view');
      document.querySelectorAll('.org-sub-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.org-sub-panel').forEach(p => p.style.display = 'none');

      tab.classList.add('active');
      const panel = document.getElementById(`org-panel-${view}`);
      if (panel) panel.style.display = 'flex';
    });
  });

  // Organizer: Create Assignment Form
  const asgForm = document.getElementById('form-create-assignment');
  if (asgForm) {
    asgForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const projectId = document.getElementById('asg-select-project').value;
      const judgeId = document.getElementById('asg-select-judge').value;

      try {
        const res = await apiFetch('/api/organizer/assignments', {
          method: 'POST',
          body: { project_id: projectId, judge_id: judgeId }
        });
        const data = await res.json();
        if (res.ok) {
          showToast(`Assignment created (${data.track_match ? 'Track Matched' : 'Cross-Track'})`, 'success');
          loadOrganizerWorkspace();
        } else {
          showToast(`Error: ${data.error || data.message}`, 'error');
        }
      } catch (err) {
        showToast(`Assignment error: ${err.message}`, 'error');
      }
    });
  }

  // Participant Edit Submission Button
  const btnEditSub = document.getElementById('btn-edit-submission');
  if (btnEditSub) {
    btnEditSub.addEventListener('click', openSubmissionDrawer);
  }
}

async function switchDemoPersona(persona) {
  try {
    const res = await apiFetch('/api/auth/demo-login', {
      method: 'POST',
      body: { role: persona }
    });

    if (res.ok) {
      const data = await res.json();
      showToast(data.message, 'success');
      await initApp();
    } else {
      showToast('Failed to switch persona.', 'error');
    }
  } catch (err) {
    showToast(`Network error: ${err.message}`, 'error');
  }
}
