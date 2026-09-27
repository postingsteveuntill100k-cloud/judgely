/**
   JUDGELY — Client-Side Application Core
   Single-Mount Architecture: Only ONE workflow/experience rendered in DOM at a time.
   Zero mock fallbacks • Safe API parsing • Strict privacy & isolation
 */

const state = {
  user: { role: 'visitor' },
  event: null,
  tracks: [],
  projects: [],
  demoMode: false,
  currentView: 'public',
  activeTrackFilter: 'all',
  searchQuery: '',
  organizerTab: 'overview',
  judgeAssignments: [],
  judgeRubric: []
};

// ============================================================================
// Security Helpers
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
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return escapeHtml(trimmed);
  }
  return '';
}

// ============================================================================
// Robust API Client (Zero Mock Fallback • Never Crashes on Non-JSON)
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
    credentials: 'same-origin'
  };

  try {
    const response = await fetch(endpoint, config);
    const contentType = response.headers.get('content-type') || '';

    // If server returned HTML (e.g. static rewrite or error page), handle safely
    if (!contentType.includes('application/json')) {
      return {
        ok: false,
        status: response.status,
        isHtml: true,
        json: async () => ({ error: 'Received non-JSON response from server.' })
      };
    }

    return response;
  } catch (err) {
    return {
      ok: false,
      status: 0,
      networkError: true,
      json: async () => ({ error: err.message })
    };
  }
}

// ============================================================================
// Toast & Modal Managers
// ============================================================================
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

function openModal(title, contentHtml) {
  const backdrop = document.getElementById('modal-backdrop');
  const titleEl = document.getElementById('modal-title');
  const bodyEl = document.getElementById('modal-body');
  if (!backdrop || !titleEl || !bodyEl) return;

  titleEl.textContent = title;
  bodyEl.innerHTML = contentHtml;
  backdrop.style.display = 'flex';
  backdrop.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) return;
  backdrop.style.display = 'none';
  backdrop.setAttribute('aria-hidden', 'true');
}

// ============================================================================
// App Initialization
// ============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupGlobalEvents();
  await initApp();
});

function setupGlobalEvents() {
  const brandHome = document.getElementById('nav-brand');
  if (brandHome) {
    brandHome.addEventListener('click', () => {
      if (state.user && state.user.role !== 'visitor') {
        mountView(state.user.role);
      } else {
        mountView('public');
      }
    });
  }

  const modalClose = document.getElementById('modal-close-btn');
  if (modalClose) {
    modalClose.addEventListener('click', closeModal);
  }

  const backdrop = document.getElementById('modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
  }
}

async function initApp() {
  try {
    // 1. Check server runtime configuration (demo mode status)
    const configRes = await apiFetch('/api/auth/config');
    if (configRes.ok) {
      const cfg = await configRes.json();
      state.demoMode = Boolean(cfg.demo_mode);
    }

    // 2. Resolve authenticated session
    const authRes = await apiFetch('/api/auth/me');
    if (authRes.ok) {
      const authData = await authRes.json();
      state.user = authData.user || { role: 'visitor' };
    } else {
      state.user = { role: 'visitor' };
    }

    // 3. Fetch Event Context & Tracks
    const [eventRes, tracksRes] = await Promise.all([
      apiFetch('/api/event'),
      apiFetch('/api/tracks')
    ]);

    if (eventRes.ok) {
      state.event = await eventRes.json();
      const headerEventName = document.getElementById('header-event-name');
      if (headerEventName && state.event.name) {
        headerEventName.textContent = state.event.name;
      }
    }

    if (tracksRes.ok) {
      const tracksData = await tracksRes.json();
      state.tracks = tracksData.tracks || [];
    }

    // 4. Update Header Shell
    renderHeader();

    // 5. Mount Appropriate Single Experience
    const hash = window.location.hash.replace('#', '');
    if (hash === 'login') {
      mountView('login');
    } else if (state.user.role === 'organizer') {
      mountView('organizer');
    } else if (state.user.role === 'judge') {
      mountView('judge');
    } else if (state.user.role === 'participant') {
      mountView('participant');
    } else {
      mountView('public');
    }
  } catch (err) {
    console.error('Judgely initialization error:', err);
    mountView('public');
  }
}

// ============================================================================
// Header & Navigation Renderer
// ============================================================================
function renderHeader() {
  const navContainer = document.getElementById('header-nav');
  const userActions = document.getElementById('header-user-actions');
  if (!navContainer || !userActions) return;

  navContainer.innerHTML = '';
  userActions.innerHTML = '';

  const role = state.user.role || 'visitor';

  // Navigation Items per Role
  if (role === 'organizer') {
    navContainer.appendChild(createNavBtn('Command Center', 'organizer'));
    navContainer.appendChild(createNavBtn('Public Showcase', 'public'));
  } else if (role === 'judge') {
    navContainer.appendChild(createNavBtn('My Reviews', 'judge'));
    navContainer.appendChild(createNavBtn('Event Showcase', 'public'));
  } else if (role === 'participant') {
    navContainer.appendChild(createNavBtn('My Workspace', 'participant'));
    navContainer.appendChild(createNavBtn('Browse Projects', 'public'));
  } else {
    navContainer.appendChild(createNavBtn('Projects', 'public'));
  }

  // Right Side Authentication Actions
  if (role === 'visitor') {
    const signInBtn = document.createElement('button');
    signInBtn.className = 'btn btn-sm btn-outline';
    signInBtn.textContent = 'Sign In';
    signInBtn.addEventListener('click', () => mountView('login'));
    userActions.appendChild(signInBtn);
  } else {
    // Identity Chip
    const userChip = document.createElement('div');
    userChip.className = 'user-identity-chip';
    userChip.innerHTML = `
      <span class="user-name">${escapeHtml(state.user.name || 'User')}</span>
      <span class="role-tag ${role}">${escapeHtml(role)}</span>
    `;
    userActions.appendChild(userChip);

    // Sign Out Button
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'btn btn-sm btn-outline';
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.addEventListener('click', handleSignOut);
    userActions.appendChild(signOutBtn);
  }
}

function createNavBtn(label, targetView) {
  const btn = document.createElement('button');
  btn.className = `nav-item ${state.currentView === targetView ? 'active' : ''}`;
  btn.textContent = label;
  btn.addEventListener('click', () => mountView(targetView));
  return btn;
}

async function handleSignOut() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    state.user = { role: 'visitor' };
    renderHeader();
    mountView('public');
    showToast('Signed out successfully', 'info');
  } catch (err) {
    showToast('Sign out error', 'error');
  }
}

// ============================================================================
// VIEW SWITCHER — Only ONE Experience Mounted at a Time
// ============================================================================
function mountView(viewName) {
  state.currentView = viewName;
  window.location.hash = viewName === 'public' ? '' : viewName;
  renderHeader();

  const root = document.getElementById('app-root');
  if (!root) return;

  root.innerHTML = '';

  switch (viewName) {
    case 'public':
      renderPublicView(root);
      break;
    case 'login':
      renderLoginView(root);
      break;
    case 'participant':
      if (state.user.role !== 'participant' && state.user.role !== 'organizer') {
        showToast('Please sign in as a participant', 'error');
        mountView('login');
        return;
      }
      renderParticipantView(root);
      break;
    case 'judge':
      if (state.user.role !== 'judge' && state.user.role !== 'organizer') {
        showToast('Please sign in as a judge', 'error');
        mountView('login');
        return;
      }
      renderJudgeView(root);
      break;
    case 'organizer':
      if (state.user.role !== 'organizer') {
        showToast('Organizer access restricted', 'error');
        mountView('login');
        return;
      }
      renderOrganizerView(root);
      break;
    default:
      renderPublicView(root);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ============================================================================
// 1. PUBLIC EXPERIENCE — Event Website & Editorial Showcase
// ============================================================================
async function renderPublicView(container) {
  const eventName = state.event?.name || 'Hackathon Championship';
  const eventDesc = state.event?.description || 'Premier open-source hackathon for systems and software architecture.';
  const isReleased = Boolean(state.event?.results_released);
  const isClosed = Boolean(state.event?.is_closed);

  const statusBadge = isReleased
    ? '<span class="badge badge-success">Official Results Published</span>'
    : (isClosed ? '<span class="badge badge-warning">Judging in Progress</span>' : '<span class="badge badge-primary">Submissions Open</span>');

  container.innerHTML = `
    <div class="container">
      <!-- Editorial Hero -->
      <section class="public-hero">
        <div class="hero-tag">HACKATHON SHOWCASE</div>
        <h1 class="hero-headline">${escapeHtml(eventName)}</h1>
        <p class="hero-subtitle">${escapeHtml(eventDesc)}</p>
        <div style="margin-bottom: 1.5rem;">${statusBadge}</div>
        <div class="hero-actions">
          <button class="btn btn-primary" id="btn-hero-explore">Explore Projects</button>
          <button class="btn btn-outline" id="btn-hero-tracks">View Tracks & Rubric</button>
        </div>
      </section>

      <!-- Live Statistics Ribbon (Loaded dynamically from API) -->
      <section class="stats-ribbon" id="public-stats-ribbon">
        <div class="stat-box">
          <div class="stat-label">Active Projects</div>
          <div class="stat-value" id="stat-projects-count">...</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Specialized Tracks</div>
          <div class="stat-value" id="stat-tracks-count">${state.tracks.length || '...'}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Evaluation Reviews</div>
          <div class="stat-value" id="stat-reviews-count">...</div>
        </div>
      </section>

      <!-- Search & Track Filter Toolbar -->
      <section class="gallery-toolbar" id="projects-section">
        <div class="search-input-wrapper">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input type="text" id="gallery-search" class="search-field" placeholder="Search projects by title, team, or keywords..." value="${escapeHtml(state.searchQuery)}">
        </div>
        <div class="track-filter-pills" id="track-pills-container">
          <!-- Populated by JS -->
        </div>
      </section>

      <!-- Project Cards Grid -->
      <section>
        <div class="projects-grid" id="public-projects-grid">
          <div class="page-loading-skeleton" style="grid-column: 1 / -1;">
            <div class="skeleton-line" style="width: 30%;"></div>
            <div class="skeleton-grid">
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Tracks & Rubric Detail Section -->
      <section id="tracks-detail-section" style="margin-top: 4rem; padding-top: 3rem; border-top: 1px solid var(--border-default);">
        <h2>Competition Tracks & Evaluation Criteria</h2>
        <p style="margin-bottom: 2rem;">Projects are evaluated by domain judges using an objective, weighted rubric.</p>
        <div class="projects-grid" id="tracks-cards-grid"></div>
      </section>
    </div>
  `;

  // Attach Hero Button Handlers
  document.getElementById('btn-hero-explore')?.addEventListener('click', () => {
    document.getElementById('projects-section')?.scrollIntoView({ behavior: 'smooth' });
  });
  document.getElementById('btn-hero-tracks')?.addEventListener('click', () => {
    document.getElementById('tracks-detail-section')?.scrollIntoView({ behavior: 'smooth' });
  });

  // Attach Search Handler
  document.getElementById('gallery-search')?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    filterAndRenderProjects();
  });

  // Render Tracks Detail Cards
  renderTrackCards();

  // Load Projects from Backend API
  await loadAndRenderProjects();
}

function renderTrackCards() {
  const container = document.getElementById('tracks-cards-grid');
  if (!container) return;

  container.innerHTML = state.tracks.map(t => `
    <div class="card" style="padding: 1.5rem;">
      <span class="badge badge-primary" style="margin-bottom: 0.75rem;">${escapeHtml(t.id)}</span>
      <h3>${escapeHtml(t.name)}</h3>
      <p style="font-size: 0.875rem; color: var(--text-body); margin-top: 0.5rem;">${escapeHtml(t.description || 'Projects building in this category.')}</p>
    </div>
  `).join('');
}

async function loadAndRenderProjects() {
  const grid = document.getElementById('public-projects-grid');
  if (!grid) return;

  try {
    const res = await apiFetch('/api/projects');
    if (!res.ok) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;">
          <p style="color: var(--danger); font-weight: 600;">Unable to load projects from server.</p>
          <button class="btn btn-outline btn-sm" id="btn-retry-projects">Retry</button>
        </div>
      `;
      document.getElementById('btn-retry-projects')?.addEventListener('click', loadAndRenderProjects);
      return;
    }

    const data = await res.json();
    state.projects = data.projects || [];

    // Update Live Stats Ribbon with real numbers
    const statProjects = document.getElementById('stat-projects-count');
    const statReviews = document.getElementById('stat-reviews-count');
    if (statProjects) statProjects.textContent = state.projects.length;
    if (statReviews) statReviews.textContent = data.global?.totalReviews ?? '...';

    renderTrackFilterPills();
    filterAndRenderProjects();
  } catch (err) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem;">
        <p style="color: var(--danger); font-weight: 600;">Connection error loading projects.</p>
        <button class="btn btn-outline btn-sm" id="btn-retry-projects">Retry</button>
      </div>
    `;
    document.getElementById('btn-retry-projects')?.addEventListener('click', loadAndRenderProjects);
  }
}

function renderTrackFilterPills() {
  const container = document.getElementById('track-pills-container');
  if (!container) return;

  container.innerHTML = '';

  const allPill = document.createElement('button');
  allPill.className = `filter-pill ${state.activeTrackFilter === 'all' ? 'active' : ''}`;
  allPill.textContent = 'All Tracks';
  allPill.addEventListener('click', () => {
    state.activeTrackFilter = 'all';
    renderTrackFilterPills();
    filterAndRenderProjects();
  });
  container.appendChild(allPill);

  state.tracks.forEach(track => {
    const pill = document.createElement('button');
    pill.className = `filter-pill ${state.activeTrackFilter === track.id ? 'active' : ''}`;
    pill.textContent = track.name;
    pill.addEventListener('click', () => {
      state.activeTrackFilter = track.id;
      renderTrackFilterPills();
      filterAndRenderProjects();
    });
    container.appendChild(pill);
  });
}

function filterAndRenderProjects() {
  const grid = document.getElementById('public-projects-grid');
  if (!grid) return;

  let filtered = state.projects;

  if (state.activeTrackFilter !== 'all') {
    filtered = filtered.filter(p => p.track_id === state.activeTrackFilter);
  }

  if (state.searchQuery) {
    filtered = filtered.filter(p => {
      const title = (p.title || '').toLowerCase();
      const team = (p.team_name || '').toLowerCase();
      const summary = (p.summary || '').toLowerCase();
      return title.includes(state.searchQuery) || team.includes(state.searchQuery) || summary.includes(state.searchQuery);
    });
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem;">
        <h3>No projects match your filter.</h3>
        <p style="color: var(--text-muted);">Try a different search keyword or select all tracks.</p>
      </div>
    `;
    return;
  }

  const isReleased = Boolean(state.event?.results_released);

  grid.innerHTML = filtered.map(p => {
    const scoreBadge = isReleased && p.normalized_score !== null
      ? `<span class="badge badge-success">Rank #${p.rank} • Score ${Number(p.normalized_score).toFixed(2)}</span>`
      : `<span class="badge badge-neutral">${p.review_count || 0} reviews</span>`;

    return `
      <article class="project-card" data-project-id="${escapeHtml(p.id)}">
        <div class="project-card-header">
          <span class="badge badge-primary">${escapeHtml(p.track_name || 'General')}</span>
          <span class="mono" style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(p.id)}</span>
        </div>
        <div class="project-card-body">
          <h3 class="project-title">${escapeHtml(p.title)}</h3>
          <p class="project-team-line">by <strong>${escapeHtml(p.team_name || 'Autonomous Team')}</strong></p>
          <p class="project-summary-text">${escapeHtml(p.summary || 'Open-source hackathon prototype.')}</p>
        </div>
        <div class="project-card-footer">
          ${scoreBadge}
          <span style="font-weight: 600; color: var(--accent);">View Details &rarr;</span>
        </div>
      </article>
    `;
  }).join('');

  // Attach Click Listener to Open Modal
  grid.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => {
      const pid = card.getAttribute('data-project-id');
      openProjectDetailsModal(pid);
    });
  });
}

async function openProjectDetailsModal(projectId) {
  openModal('Loading Project...', '<div class="page-loading-skeleton"><div class="skeleton-line"></div><div class="skeleton-line" style="width: 60%;"></div></div>');

  try {
    const res = await apiFetch(`/api/projects/${projectId}`);
    if (!res.ok) {
      openModal('Project Unavailable', '<p style="color: var(--danger);">Could not retrieve project details from the server.</p>');
      return;
    }

    const { project } = await res.json();
    const isReleased = Boolean(state.event?.results_released);

    // Render team members without exposing raw email addresses
    const memberItems = (project.team_members || []).map(m => {
      const name = typeof m === 'object' ? (m.name || m.display_name) : m;
      const role = typeof m === 'object' ? (m.role ? `(${m.role})` : '') : '';
      return `<li style="margin-bottom: 0.25rem;"><strong>${escapeHtml(name)}</strong> ${escapeHtml(role)}</li>`;
    }).join('');

    const scoresSection = isReleased && project.normalized_score !== null ? `
      <div style="background-color: var(--success-bg); border: 1px solid var(--success-border); padding: 1rem; border-radius: var(--radius-sm); margin-bottom: 1.5rem;">
        <h4 style="color: var(--success); margin-bottom: 0.25rem;">Official Evaluation Result</h4>
        <p style="margin: 0; font-size: 0.9375rem;">Final Normalized Score: <strong>${Number(project.normalized_score).toFixed(3)}</strong> (Rank #${project.rank})</p>
      </div>
    ` : '';

    const contentHtml = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div>
          <span class="badge badge-primary">${escapeHtml(project.track_name || 'General')}</span>
          <h2 style="margin-top: 0.5rem; margin-bottom: 0.25rem;">${escapeHtml(project.title)}</h2>
          <p style="color: var(--text-muted); font-size: 0.875rem;">Submitted by <strong>${escapeHtml(project.team_name || 'Team')}</strong></p>
        </div>

        ${scoresSection}

        <div>
          <h4 style="margin-bottom: 0.375rem;">Project Overview</h4>
          <p style="line-height: 1.6;">${escapeHtml(project.summary || 'No description provided.')}</p>
        </div>

        ${project.tech_stack ? `
          <div>
            <h4 style="margin-bottom: 0.375rem;">Technologies Used</h4>
            <p class="mono" style="font-size: 0.8125rem; background: var(--bg-subtle); padding: 0.5rem; border-radius: var(--radius-sm);">${escapeHtml(project.tech_stack)}</p>
          </div>
        ` : ''}

        ${memberItems ? `
          <div>
            <h4 style="margin-bottom: 0.375rem;">Team Contributors</h4>
            <ul style="padding-left: 1.25rem; font-size: 0.875rem; color: var(--text-body);">${memberItems}</ul>
          </div>
        ` : ''}

        <div style="display: flex; gap: 0.75rem; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-default);">
          ${project.repo_url ? `<a href="${sanitizeUrl(project.repo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">Repository</a>` : ''}
          ${project.demo_url ? `<a href="${sanitizeUrl(project.demo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Live Demo</a>` : ''}
        </div>
      </div>
    `;

    openModal(project.title, contentHtml);
  } catch (err) {
    openModal('Error', `<p style="color: var(--danger);">Network error: ${escapeHtml(err.message)}</p>`);
  }
}

// ============================================================================
// 2. AUTHENTICATION EXPERIENCE — Real Credentials & Gated Demo Controls
// ============================================================================
function renderLoginView(container) {
  container.innerHTML = `
    <div class="login-page-container">
      <div class="login-card">
        <div class="login-header">
          <h2 class="login-title">Sign in to Judgely</h2>
          <p class="login-subtitle">Enter your event credentials to access your workspace</p>
        </div>

        <form id="form-login" novalidate>
          <div class="form-group">
            <label class="form-label" for="login-email">Email Address</label>
            <input type="email" id="login-email" class="form-input" placeholder="name@example.com" required autocomplete="email">
          </div>

          <div class="form-group">
            <label class="form-label" for="login-password">Password</label>
            <input type="password" id="login-password" class="form-input" placeholder="••••••••" required autocomplete="current-password">
          </div>

          <div id="login-error-msg" style="display:none; color: var(--danger); font-size: 0.8125rem; margin-bottom: 1rem;"></div>

          <button type="submit" class="btn btn-primary btn-block" id="btn-submit-login">Sign In</button>
        </form>

        <!-- DEMO_MODE ONLY: Quick Persona Switcher (Zero Production Presence) -->
        <div id="demo-persona-section" class="demo-credentials-box" style="${state.demoMode ? '' : 'display:none;'}">
          <div class="demo-title">Development Demo Personas</div>
          <div class="demo-grid">
            <button class="btn btn-outline btn-sm" data-demo-role="organizer">Organizer</button>
            <button class="btn btn-outline btn-sm" data-demo-role="judge_a">Judge A</button>
            <button class="btn btn-outline btn-sm" data-demo-role="judge_b">Judge B</button>
            <button class="btn btn-outline btn-sm" data-demo-role="participant">Participant</button>
          </div>
        </div>
      </div>
    </div>
  `;

  // Attach Form Submit
  const form = document.getElementById('form-login');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errorMsg = document.getElementById('login-error-msg');
    const submitBtn = document.getElementById('btn-submit-login');

    if (!email || !password) {
      errorMsg.textContent = 'Both email and password are required.';
      errorMsg.style.display = 'block';
      return;
    }

    submitBtn.disabled = true;
    errorMsg.style.display = 'none';

    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: { email, password }
      });

      const data = await res.json();
      if (!res.ok) {
        errorMsg.textContent = data.error || 'Invalid credentials';
        errorMsg.style.display = 'block';
        submitBtn.disabled = false;
        return;
      }

      state.user = data.user;
      showToast(`Welcome back, ${data.user.name}`, 'success');
      renderHeader();
      mountView(data.user.role);
    } catch (err) {
      errorMsg.textContent = 'Connection error. Please try again.';
      errorMsg.style.display = 'block';
      submitBtn.disabled = false;
    }
  });

  // Attach Demo Buttons (Only works if DEMO_MODE=true on server)
  if (state.demoMode) {
    document.querySelectorAll('[data-demo-role]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const role = btn.getAttribute('data-demo-role');
        try {
          const res = await apiFetch('/api/auth/demo-login', {
            method: 'POST',
            body: { role }
          });
          const data = await res.json();
          if (res.ok) {
            state.user = data.user;
            showToast(data.message, 'success');
            renderHeader();
            mountView(data.user.role);
          } else {
            showToast(data.error || 'Demo login denied', 'error');
          }
        } catch (err) {
          showToast('Demo login error', 'error');
        }
      });
    });
  }
}

// ============================================================================
// 3. PARTICIPANT EXPERIENCE — Team & Project Workspace
// ============================================================================
async function renderParticipantView(container) {
  container.innerHTML = `
    <div class="container">
      <div class="workspace-header">
        <div class="workspace-title-group">
          <h1>Participant Workspace</h1>
          <p class="workspace-subtitle">Welcome back, <strong>${escapeHtml(state.user.name)}</strong> • Manage your team and project submission</p>
        </div>
        <div id="participant-event-status-badge">
          <span class="badge badge-neutral">Loading status...</span>
        </div>
      </div>

      <!-- Roadmap Stepper -->
      <section class="roadmap-container">
        <h3 style="margin-bottom: 1rem;">Hackathon Roadmap</h3>
        <div class="roadmap-steps">
          <div class="roadmap-step">
            <div class="step-num done">&check;</div>
            <div class="step-meta">
              <strong>1. Registration</strong>
              <span>Verified Participant</span>
            </div>
          </div>
          <div class="roadmap-step">
            <div class="step-num done" id="step-team-marker">&check;</div>
            <div class="step-meta">
              <strong>2. Team Formation</strong>
              <span id="step-team-label">Enrolled</span>
            </div>
          </div>
          <div class="roadmap-step">
            <div class="step-num" id="step-sub-marker">3</div>
            <div class="step-meta">
              <strong>3. Submission</strong>
              <span id="step-sub-label">Draft / Active</span>
            </div>
          </div>
          <div class="roadmap-step">
            <div class="step-num" id="step-judge-marker">4</div>
            <div class="step-meta">
              <strong>4. Evaluation</strong>
              <span>Blind Peer Review</span>
            </div>
          </div>
          <div class="roadmap-step">
            <div class="step-num" id="step-results-marker">5</div>
            <div class="step-meta">
              <strong>5. Results</strong>
              <span>Official Publication</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 2-Column Participant Grid -->
      <div class="participant-layout-grid">
        <!-- Team Card -->
        <div class="card">
          <div class="card-header">
            <h3>My Team</h3>
            <span class="badge badge-primary" id="participant-team-role">Member</span>
          </div>
          <div class="card-body" id="participant-team-container">
            <div class="page-loading-skeleton"><div class="skeleton-line"></div></div>
          </div>
        </div>

        <!-- Submission Card -->
        <div class="card">
          <div class="card-header">
            <h3>Project Submission</h3>
            <div id="participant-project-action-btns"></div>
          </div>
          <div class="card-body" id="participant-submission-container">
            <div class="page-loading-skeleton"><div class="skeleton-line"></div><div class="skeleton-line" style="width: 70%;"></div></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Fetch live workspace data
  try {
    const res = await apiFetch('/api/participant/workspace');
    if (!res.ok) {
      document.getElementById('participant-submission-container').innerHTML = '<p style="color: var(--danger);">Failed to load participant data.</p>';
      return;
    }

    const data = await res.json();
    const { team, members, project, event } = data;

    // Update status badge
    const statusContainer = document.getElementById('participant-event-status-badge');
    if (statusContainer) {
      const isClosed = event.is_closed;
      statusContainer.innerHTML = isClosed
        ? '<span class="badge badge-warning">Submissions Closed</span>'
        : '<span class="badge badge-success">Submissions Open</span>';
    }

    // Update Roadmap
    const stepSubMarker = document.getElementById('step-sub-marker');
    const stepSubLabel = document.getElementById('step-sub-label');
    if (project) {
      stepSubMarker.className = 'step-num done';
      stepSubMarker.innerHTML = '&check;';
      stepSubLabel.textContent = project.status;
    }

    // Render Team Card
    const teamContainer = document.getElementById('participant-team-container');
    if (team) {
      const memberList = (members || []).map(m => `
        <li style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--border-default);">
          <span><strong>${escapeHtml(m.name || 'Participant')}</strong></span>
          <span class="badge badge-neutral">${escapeHtml(m.role || 'member')}</span>
        </li>
      `).join('');

      teamContainer.innerHTML = `
        <h4 style="margin-bottom: 0.25rem;">${escapeHtml(team.name)}</h4>
        <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1rem;">Team ID: <span class="mono">${escapeHtml(team.id)}</span></p>
        <ul style="list-style: none; padding: 0; margin-bottom: 1rem;">${memberList}</ul>
      `;
    } else {
      teamContainer.innerHTML = `
        <p style="color: var(--text-muted); margin-bottom: 1rem;">You are not currently enrolled in a team for this event.</p>
        <button class="btn btn-outline btn-sm" id="btn-create-team">Create a Team</button>
      `;
      document.getElementById('btn-create-team')?.addEventListener('click', openCreateTeamModal);
    }

    // Render Project Submission Card
    const subContainer = document.getElementById('participant-submission-container');
    const actionBtns = document.getElementById('participant-project-action-btns');

    if (project && project.status !== 'withdrawn') {
      subContainer.innerHTML = `
        <div>
          <span class="badge badge-primary">${escapeHtml(project.track_name || 'General')}</span>
          <h3 style="margin-top: 0.5rem; margin-bottom: 0.5rem;">${escapeHtml(project.title)}</h3>
          <p style="line-height: 1.6; margin-bottom: 1rem;">${escapeHtml(project.summary || 'No summary provided.')}</p>
          <div style="font-size: 0.8125rem; color: var(--text-muted);">
            <div>Repository: ${project.repo_url ? `<a href="${sanitizeUrl(project.repo_url)}" target="_blank" rel="noopener">${escapeHtml(project.repo_url)}</a>` : 'None'}</div>
            <div>Live Demo: ${project.demo_url ? `<a href="${sanitizeUrl(project.demo_url)}" target="_blank" rel="noopener">${escapeHtml(project.demo_url)}</a>` : 'None'}</div>
          </div>
        </div>
      `;

      if (!event.is_closed) {
        actionBtns.innerHTML = `
          <button class="btn btn-outline btn-sm" id="btn-edit-proj">Edit Project</button>
          <button class="btn btn-danger btn-sm" id="btn-withdraw-proj">Withdraw</button>
        `;
        document.getElementById('btn-edit-proj')?.addEventListener('click', () => openEditProjectModal(project));
        document.getElementById('btn-withdraw-proj')?.addEventListener('click', () => handleWithdrawProject(project.id));
      }
    } else {
      subContainer.innerHTML = `
        <p style="color: var(--text-muted); margin-bottom: 1rem;">No active project submission found for your team.</p>
        ${!event.is_closed ? '<button class="btn btn-primary btn-sm" id="btn-submit-new-proj">Create Submission</button>' : '<span class="badge badge-danger">Deadline passed</span>'}
      `;
      document.getElementById('btn-submit-new-proj')?.addEventListener('click', openSubmitProjectModal);
    }
  } catch (err) {
    console.error('Participant workspace fetch error:', err);
  }
}

function openEditProjectModal(project) {
  const trackOptions = state.tracks.map(t => `
    <option value="${escapeHtml(t.id)}" ${t.id === project.track_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>
  `).join('');

  const modalHtml = `
    <form id="form-edit-project">
      <div class="form-group">
        <label class="form-label" for="edit-proj-title">Project Title</label>
        <input type="text" id="edit-proj-title" class="form-input" value="${escapeHtml(project.title)}" required minlength="2">
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-proj-track">Track</label>
        <select id="edit-proj-track" class="form-select">${trackOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-proj-summary">Short Summary</label>
        <textarea id="edit-proj-summary" class="form-textarea" rows="3">${escapeHtml(project.summary || '')}</textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-proj-repo">Repository URL</label>
        <input type="url" id="edit-proj-repo" class="form-input" value="${escapeHtml(project.repo_url || '')}" placeholder="https://github.com/...">
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-proj-demo">Demo URL</label>
        <input type="url" id="edit-proj-demo" class="form-input" value="${escapeHtml(project.demo_url || '')}" placeholder="https://...">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" id="btn-save-project">Save Changes</button>
      </div>
    </form>
  `;

  openModal('Edit Project Submission', modalHtml);

  document.getElementById('form-edit-project')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-save-project');
    btn.disabled = true;

    try {
      const payload = {
        title: document.getElementById('edit-proj-title').value.trim(),
        track_id: document.getElementById('edit-proj-track').value,
        summary: document.getElementById('edit-proj-summary').value.trim(),
        repo_url: document.getElementById('edit-proj-repo').value.trim(),
        demo_url: document.getElementById('edit-proj-demo').value.trim()
      };

      const res = await apiFetch(`/api/projects/${project.id}`, {
        method: 'PUT',
        body: payload
      });

      if (res.ok) {
        showToast('Project updated successfully', 'success');
        closeModal();
        mountView('participant');
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to update project', 'error');
        btn.disabled = false;
      }
    } catch (err) {
      showToast('Error updating project', 'error');
      btn.disabled = false;
    }
  });
}

function openSubmitProjectModal() {
  const trackOptions = state.tracks.map(t => `
    <option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>
  `).join('');

  const modalHtml = `
    <form id="form-new-project">
      <div class="form-group">
        <label class="form-label" for="new-proj-title">Project Title</label>
        <input type="text" id="new-proj-title" class="form-input" placeholder="e.g. Distributed Consensus Engine" required minlength="2">
      </div>
      <div class="form-group">
        <label class="form-label" for="new-proj-track">Track</label>
        <select id="new-proj-track" class="form-select">${trackOptions}</select>
      </div>
      <div class="form-group">
        <label class="form-label" for="new-proj-summary">Short Summary</label>
        <textarea id="new-proj-summary" class="form-textarea" placeholder="Describe the problem, architectural approach, and key achievements..." rows="3"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="new-proj-repo">Repository URL</label>
        <input type="url" id="new-proj-repo" class="form-input" placeholder="https://github.com/...">
      </div>
      <div class="form-group">
        <label class="form-label" for="new-proj-demo">Live Demo URL</label>
        <input type="url" id="new-proj-demo" class="form-input" placeholder="https://...">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" id="btn-submit-new-save">Submit Project</button>
      </div>
    </form>
  `;

  openModal('Submit New Project', modalHtml);

  document.getElementById('form-new-project')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-new-save');
    btn.disabled = true;

    try {
      const payload = {
        title: document.getElementById('new-proj-title').value.trim(),
        track_id: document.getElementById('new-proj-track').value,
        summary: document.getElementById('new-proj-summary').value.trim(),
        repo_url: document.getElementById('new-proj-repo').value.trim(),
        demo_url: document.getElementById('new-proj-demo').value.trim()
      };

      const res = await apiFetch('/api/submissions', {
        method: 'POST',
        body: payload
      });

      if (res.ok) {
        showToast('Project submitted successfully!', 'success');
        closeModal();
        mountView('participant');
      } else {
        const data = await res.json();
        showToast(data.message || data.error || 'Submission failed', 'error');
        btn.disabled = false;
      }
    } catch (err) {
      showToast('Connection error', 'error');
      btn.disabled = false;
    }
  });
}

function openCreateTeamModal() {
  const modalHtml = `
    <form id="form-create-team">
      <div class="form-group">
        <label class="form-label" for="new-team-name">Team Name</label>
        <input type="text" id="new-team-name" class="form-input" placeholder="e.g. Kernel Architects" required minlength="2">
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm">Create Team</button>
      </div>
    </form>
  `;

  openModal('Create New Team', modalHtml);

  document.getElementById('form-create-team')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('new-team-name').value.trim();

    try {
      const res = await apiFetch('/api/teams', {
        method: 'POST',
        body: { name }
      });
      if (res.ok) {
        showToast('Team registered successfully', 'success');
        closeModal();
        mountView('participant');
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to create team', 'error');
      }
    } catch (err) {
      showToast('Error creating team', 'error');
    }
  });
}

async function handleWithdrawProject(projectId) {
  if (!confirm('Are you sure you wish to withdraw your project? This will remove it from active evaluation.')) {
    return;
  }

  try {
    const res = await apiFetch(`/api/projects/${projectId}/withdraw`, {
      method: 'POST'
    });
    if (res.ok) {
      showToast('Project withdrawn', 'info');
      mountView('participant');
    } else {
      const data = await res.json();
      showToast(data.error || 'Failed to withdraw project', 'error');
    }
  } catch (err) {
    showToast('Withdrawal error', 'error');
  }
}

// ============================================================================
// 4. JUDGE EXPERIENCE — Review Dashboard & Evaluation Workflow
// ============================================================================
async function renderJudgeView(container) {
  container.innerHTML = `
    <div class="container">
      <div class="workspace-header">
        <div class="workspace-title-group">
          <h1>Judge Evaluation Portal</h1>
          <p class="workspace-subtitle">Evaluating as <strong>${escapeHtml(state.user.name)}</strong> (${escapeHtml(state.user.judge_id || state.user.id)})</p>
        </div>
      </div>

      <!-- Metrics Row -->
      <section class="judge-metrics-row">
        <div class="stat-box">
          <div class="stat-label">Assigned Projects</div>
          <div class="stat-value" id="judge-stat-assigned">...</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Evaluations Completed</div>
          <div class="stat-value" id="judge-stat-completed">...</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Remaining to Review</div>
          <div class="stat-value" id="judge-stat-remaining">...</div>
        </div>
      </section>

      <!-- Assignments List -->
      <section>
        <h2 style="margin-bottom: 1rem;">Assigned Projects</h2>
        <div class="assignments-list" id="judge-assignments-container">
          <div class="page-loading-skeleton"><div class="skeleton-line"></div></div>
        </div>
      </section>
    </div>
  `;

  try {
    const res = await apiFetch('/api/judge/assignments');
    if (!res.ok) {
      document.getElementById('judge-assignments-container').innerHTML = '<p style="color: var(--danger);">Failed to load judge assignments.</p>';
      return;
    }

    const data = await res.json();
    state.judgeAssignments = data.assignments || [];
    state.judgeRubric = data.rubric || [];

    const completed = state.judgeAssignments.filter(a => a.review_id !== null).length;
    const remaining = state.judgeAssignments.length - completed;

    document.getElementById('judge-stat-assigned').textContent = state.judgeAssignments.length;
    document.getElementById('judge-stat-completed').textContent = completed;
    document.getElementById('judge-stat-remaining').textContent = remaining;

    const containerEl = document.getElementById('judge-assignments-container');
    if (state.judgeAssignments.length === 0) {
      containerEl.innerHTML = '<p style="color: var(--text-muted); padding: 2rem 0;">You have no assigned projects in this event.</p>';
      return;
    }

    containerEl.innerHTML = state.judgeAssignments.map(a => {
      const isDone = a.review_id !== null;
      const statusBadge = isDone
        ? `<span class="badge badge-success">Completed • Score ${Number(a.total_weighted_score).toFixed(2)}</span>`
        : `<span class="badge badge-warning">Pending Review</span>`;

      return `
        <div class="assignment-item-card" data-assignment-id="${escapeHtml(a.assignment_id)}">
          <div class="assignment-meta-left">
            <span class="badge badge-primary" style="margin-bottom: 0.25rem;">${escapeHtml(a.track_name || 'Track')}</span>
            <h3>${escapeHtml(a.project_title)}</h3>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin: 0;">Team: <strong>${escapeHtml(a.team_name || 'Autonomous')}</strong> • Project ID: <span class="mono">${escapeHtml(a.project_id)}</span></p>
          </div>
          <div style="display: flex; align-items: center; gap: 1rem;">
            ${statusBadge}
            <button class="btn btn-primary btn-sm btn-open-review" data-pid="${escapeHtml(a.project_id)}">
              ${isDone ? 'Update Review' : 'Evaluate Project'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    containerEl.querySelectorAll('.btn-open-review').forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.getAttribute('data-pid');
        const assignment = state.judgeAssignments.find(a => a.project_id === pid);
        if (assignment) openReviewModal(assignment);
      });
    });
  } catch (err) {
    console.error('Judge assignments fetch error:', err);
  }
}

function openReviewModal(assignment) {
  const criteriaRows = state.judgeRubric.map(crit => `
    <div class="rubric-scoring-group" data-criterion="${escapeHtml(crit.name)}">
      <div class="rubric-header-line">
        <div>
          <strong style="text-transform: capitalize;">${escapeHtml(crit.name)}</strong>
          <span style="font-size: 0.75rem; color: var(--text-muted);"> (Weight: ${(crit.weight * 100).toFixed(0)}%)</span>
        </div>
        <span class="mono score-display-pill" id="score-val-${crit.name}">3.0</span>
      </div>
      <p style="font-size: 0.75rem; color: var(--text-muted); margin-bottom: 0.5rem;">${escapeHtml(crit.description || '')}</p>
      <div class="score-range-row">
        <span style="font-size: 0.75rem; color: var(--text-muted);">0.0</span>
        <input type="range" class="score-range-slider" min="0" max="${crit.max_score || 5.0}" step="0.5" value="3.0" id="slider-${crit.name}">
        <span style="font-size: 0.75rem; color: var(--text-muted);">${(crit.max_score || 5.0).toFixed(1)}</span>
      </div>
    </div>
  `).join('');

  const modalHtml = `
    <div>
      <div style="margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-default);">
        <h3>${escapeHtml(assignment.project_title)}</h3>
        <p style="font-size: 0.875rem; color: var(--text-body); margin: 0.5rem 0;">${escapeHtml(assignment.project_summary || '')}</p>
        <div style="display: flex; gap: 0.5rem; margin-top: 0.5rem;">
          ${assignment.repo_url ? `<a href="${sanitizeUrl(assignment.repo_url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Inspect Repository</a>` : ''}
          ${assignment.demo_url ? `<a href="${sanitizeUrl(assignment.demo_url)}" target="_blank" rel="noopener" class="btn btn-outline btn-sm">Inspect Live Demo</a>` : ''}
        </div>
      </div>

      <form id="form-submit-review">
        <h4 style="margin-bottom: 0.75rem;">Objective Rubric Evaluation</h4>
        <div id="criteria-sliders-container">${criteriaRows}</div>

        <div class="form-group" style="margin-top: 1rem;">
          <label class="form-label" for="review-comment">Evaluator Notes / Rationale (Optional)</label>
          <textarea id="review-comment" class="form-textarea" placeholder="Explain notable architectural choices, code quality findings, or technical highlights...">${escapeHtml(assignment.comment || '')}</textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1.5rem;">
          <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary btn-sm" id="btn-submit-review-save">Submit Evaluation</button>
        </div>
      </form>
    </div>
  `;

  openModal(`Review: ${assignment.project_title}`, modalHtml);

  // Wire up slider live preview
  state.judgeRubric.forEach(crit => {
    const slider = document.getElementById(`slider-${crit.name}`);
    const display = document.getElementById(`score-val-${crit.name}`);
    if (slider && display) {
      slider.addEventListener('input', () => {
        display.textContent = Number(slider.value).toFixed(1);
      });
    }
  });

  // Submit Review Handler
  document.getElementById('form-submit-review')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-review-save');
    btn.disabled = true;

    const criteriaValues = {};
    state.judgeRubric.forEach(crit => {
      const slider = document.getElementById(`slider-${crit.name}`);
      if (slider) {
        criteriaValues[crit.name] = parseFloat(slider.value);
      }
    });

    const comment = document.getElementById('review-comment').value.trim();

    try {
      const res = await apiFetch('/api/judge/scores', {
        method: 'POST',
        body: {
          project_id: assignment.project_id,
          criteria: criteriaValues,
          comment
        }
      });

      if (res.ok) {
        showToast('Review recorded successfully!', 'success');
        closeModal();
        mountView('judge');
      } else {
        const data = await res.json();
        showToast(data.message || data.error || 'Submission failed', 'error');
        btn.disabled = false;
      }
    } catch (err) {
      showToast('Error submitting review', 'error');
      btn.disabled = false;
    }
  });
}

// ============================================================================
// 5. ORGANIZER EXPERIENCE — Command Center & Operations
// ============================================================================
async function renderOrganizerView(container) {
  container.innerHTML = `
    <div class="container">
      <div class="workspace-header">
        <div class="workspace-title-group">
          <h1>Organizer Command Center</h1>
          <p class="workspace-subtitle">Event Operations, Assignments, and Defensible Normalization</p>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <a href="/api/export.csv" class="btn btn-outline btn-sm" id="btn-export-csv" download>Export Results CSV</a>
        </div>
      </div>

      <!-- Sub Navigation Tabs -->
      <div class="organizer-subnav">
        <button class="subnav-btn ${state.organizerTab === 'overview' ? 'active' : ''}" data-orgtab="overview">Overview</button>
        <button class="subnav-btn ${state.organizerTab === 'assignments' ? 'active' : ''}" data-orgtab="assignments">Assignments</button>
        <button class="subnav-btn ${state.organizerTab === 'results' ? 'active' : ''}" data-orgtab="results">Results & Normalization</button>
        <button class="subnav-btn ${state.organizerTab === 'audit' ? 'active' : ''}" data-orgtab="audit">Audit Log</button>
      </div>

      <div id="organizer-tab-content">
        <div class="page-loading-skeleton"><div class="skeleton-line"></div></div>
      </div>
    </div>
  `;

  // Attach Subnav
  container.querySelectorAll('[data-orgtab]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.organizerTab = btn.getAttribute('data-orgtab');
      renderOrganizerView(container);
    });
  });

  const tabContainer = document.getElementById('organizer-tab-content');

  if (state.organizerTab === 'overview') {
    await renderOrganizerOverview(tabContainer);
  } else if (state.organizerTab === 'assignments') {
    await renderOrganizerAssignments(tabContainer);
  } else if (state.organizerTab === 'results') {
    await renderOrganizerResults(tabContainer);
  } else if (state.organizerTab === 'audit') {
    await renderOrganizerAudit(tabContainer);
  }
}

async function renderOrganizerOverview(container) {
  try {
    const res = await apiFetch('/api/organizer/overview');
    if (!res.ok) {
      container.innerHTML = '<p style="color: var(--danger);">Failed to load organizer overview.</p>';
      return;
    }

    const { event, health } = await res.json();
    const isReleased = Boolean(event.results_released);

    container.innerHTML = `
      <div class="health-overview-grid">
        <div class="stat-box">
          <div class="stat-label">Coverage Ratio</div>
          <div class="stat-value">${health.coverage_ratio}%</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Total Projects</div>
          <div class="stat-value">${health.total_projects}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Completed Reviews</div>
          <div class="stat-value">${health.completed_assignments} / ${health.total_assignments}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Active Judges</div>
          <div class="stat-value">${health.active_judges} / ${health.total_judges}</div>
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem; margin-top: 2rem;">
        <!-- Results Visibility Setting Card -->
        <div class="card">
          <div class="card-header">
            <h3>Results Embargo & Release</h3>
            <span class="badge ${isReleased ? 'badge-success' : 'badge-warning'}">${isReleased ? 'Released' : 'Embargoed'}</span>
          </div>
          <div class="card-body">
            <p style="font-size: 0.875rem; color: var(--text-body);">
              ${isReleased
                ? 'Official competition scores and rankings are visible to participants and the public showcase.'
                : 'Scoring normalization is currently embargoed. Non-organizers cannot view rankings or scores.'}
            </p>
            <button class="btn ${isReleased ? 'btn-danger' : 'btn-primary'} btn-sm" id="btn-toggle-results">
              ${isReleased ? 'Embargo Results (Make Private)' : 'Publish Official Results'}
            </button>
          </div>
        </div>

        <!-- Deadline Setting Card -->
        <div class="card">
          <div class="card-header">
            <h3>Submission Deadline</h3>
            <span class="mono" style="font-size: 0.75rem;">${escapeHtml(event.submissions_close)}</span>
          </div>
          <div class="card-body">
            <form id="form-update-deadline">
              <div class="form-group">
                <label class="form-label" for="input-deadline">Deadline (ISO 8601)</label>
                <input type="text" id="input-deadline" class="form-input" value="${escapeHtml(event.submissions_close)}">
              </div>
              <button type="submit" class="btn btn-outline btn-sm">Update Deadline</button>
            </form>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-toggle-results')?.addEventListener('click', async () => {
      try {
        const toggleRes = await apiFetch('/api/organizer/settings/results-visibility', {
          method: 'POST',
          body: { results_released: !isReleased }
        });
        if (toggleRes.ok) {
          showToast(isReleased ? 'Results embargoed' : 'Results published officially!', 'success');
          // Reload overview
          mountView('organizer');
        }
      } catch (err) {
        showToast('Error toggling visibility', 'error');
      }
    });

    document.getElementById('form-update-deadline')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = document.getElementById('input-deadline').value.trim();
      try {
        const dRes = await apiFetch('/api/organizer/settings/deadline', {
          method: 'POST',
          body: { submissions_close: val }
        });
        if (dRes.ok) {
          showToast('Deadline updated successfully', 'success');
          mountView('organizer');
        } else {
          showToast('Invalid timestamp format', 'error');
        }
      } catch (err) {
        showToast('Error updating deadline', 'error');
      }
    });
  } catch (err) {
    container.innerHTML = '<p style="color: var(--danger);">Error loading overview.</p>';
  }
}

async function renderOrganizerAssignments(container) {
  try {
    const res = await apiFetch('/api/organizer/assignments');
    if (!res.ok) {
      container.innerHTML = '<p style="color: var(--danger);">Failed to load assignments.</p>';
      return;
    }

    const { assignments } = await res.json();

    const rows = assignments.map(a => `
      <tr>
        <td><strong>${escapeHtml(a.project_title)}</strong><br><span class="mono" style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(a.project_id)}</span></td>
        <td>${escapeHtml(a.judge_name)}<br><span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(a.judge_id)}</span></td>
        <td><span class="badge ${a.track_match ? 'badge-primary' : 'badge-neutral'}">${escapeHtml(a.project_track)}</span></td>
        <td><span class="badge ${a.status === 'completed' ? 'badge-success' : 'badge-warning'}">${escapeHtml(a.status)}</span></td>
        <td>
          <button class="btn btn-danger btn-sm btn-delete-asg" data-pid="${escapeHtml(a.project_id)}" data-jid="${escapeHtml(a.judge_id)}">Remove</button>
        </td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
        <h3>Judge Assignments (${assignments.length})</h3>
        <button class="btn btn-primary btn-sm" id="btn-create-assignment">New Assignment</button>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Judge</th>
              <th>Track</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="5">No assignments recorded.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;

    // Attach Delete Assignment
    container.querySelectorAll('.btn-delete-asg').forEach(btn => {
      btn.addEventListener('click', async () => {
        const pid = btn.getAttribute('data-pid');
        const jid = btn.getAttribute('data-jid');
        if (!confirm(`Remove assignment for judge ${jid} on project ${pid}?`)) return;

        try {
          const dRes = await apiFetch('/api/organizer/assignments', {
            method: 'DELETE',
            body: { project_id: pid, judge_id: jid }
          });
          if (dRes.ok) {
            showToast('Assignment removed', 'info');
            renderOrganizerAssignments(container);
          }
        } catch (err) {
          showToast('Error removing assignment', 'error');
        }
      });
    });

    // New Assignment Modal
    document.getElementById('btn-create-assignment')?.addEventListener('click', () => {
      openNewAssignmentModal(() => renderOrganizerAssignments(container));
    });
  } catch (err) {
    container.innerHTML = '<p style="color: var(--danger);">Error loading assignments.</p>';
  }
}

function openNewAssignmentModal(onSuccess) {
  const modalHtml = `
    <form id="form-new-assignment">
      <div class="form-group">
        <label class="form-label" for="asg-project-id">Project ID</label>
        <input type="text" id="asg-project-id" class="form-input" placeholder="e.g. prj_01" required>
      </div>
      <div class="form-group">
        <label class="form-label" for="asg-judge-id">Judge ID</label>
        <input type="text" id="asg-judge-id" class="form-input" placeholder="e.g. jdg_01" required>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem;">
        <button type="button" class="btn btn-outline btn-sm" onclick="closeModal()">Cancel</button>
        <button type="submit" class="btn btn-primary btn-sm" id="btn-save-asg">Create Assignment</button>
      </div>
    </form>
  `;

  openModal('Assign Judge to Project', modalHtml);

  document.getElementById('form-new-assignment')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pid = document.getElementById('asg-project-id').value.trim();
    const jid = document.getElementById('asg-judge-id').value.trim();
    const btn = document.getElementById('btn-save-asg');
    btn.disabled = true;

    try {
      const res = await apiFetch('/api/organizer/assignments', {
        method: 'POST',
        body: { project_id: pid, judge_id: jid }
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Assignment created successfully', 'success');
        closeModal();
        onSuccess();
      } else {
        showToast(data.error || 'Failed to create assignment', 'error');
        btn.disabled = false;
      }
    } catch (err) {
      showToast('Error creating assignment', 'error');
      btn.disabled = false;
    }
  });
}

async function renderOrganizerResults(container) {
  try {
    const res = await apiFetch('/api/results');
    if (!res.ok) {
      container.innerHTML = '<p style="color: var(--danger);">Failed to load normalization results.</p>';
      return;
    }

    const { rankings } = await res.json();

    const rows = (rankings || []).map(p => `
      <tr>
        <td><strong>#${p.rank}</strong></td>
        <td>${escapeHtml(p.title)}<br><span class="mono" style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(p.id)}</span></td>
        <td>${escapeHtml(p.track_name || 'General')}</td>
        <td class="mono"><strong>${p.normalized_score !== null ? Number(p.normalized_score).toFixed(3) : 'N/A'}</strong></td>
        <td class="mono" style="font-size: 0.8125rem; color: var(--text-muted);">${p.raw_score !== null ? Number(p.raw_score).toFixed(3) : 'N/A'}</td>
        <td class="mono" style="font-size: 0.8125rem;">${p.rank_delta > 0 ? `+${p.rank_delta}` : (p.rank_delta < 0 ? p.rank_delta : '0')}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div style="margin-bottom: 1rem;">
        <h3>Z-Score Normalized Standings</h3>
        <p style="font-size: 0.875rem; color: var(--text-muted);">Mathematical z-score standardization adjusts for individual judge harshness and leniency.</p>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Project</th>
              <th>Track</th>
              <th>Normalized Score</th>
              <th>Raw Mean</th>
              <th>Delta</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="6">No rankings computed.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color: var(--danger);">Error computing results.</p>';
  }
}

async function renderOrganizerAudit(container) {
  try {
    const res = await apiFetch('/api/organizer/audit');
    if (!res.ok) {
      container.innerHTML = '<p style="color: var(--danger);">Failed to load audit logs.</p>';
      return;
    }

    const { logs } = await res.json();

    const rows = (logs || []).map(l => `
      <tr>
        <td class="mono" style="font-size: 0.75rem;">${escapeHtml(l.timestamp)}</td>
        <td><strong>${escapeHtml(l.action)}</strong></td>
        <td>${escapeHtml(l.role)} (${escapeHtml(l.user_id)})</td>
        <td class="mono" style="font-size: 0.75rem;">${escapeHtml(l.resource_type)}:${escapeHtml(l.resource_id)}</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <div style="margin-bottom: 1rem;">
        <h3>Immutable Audit Trail</h3>
        <p style="font-size: 0.875rem; color: var(--text-muted);">Cryptographically verifiable ledger of administrative actions, reviews, and deadline mutations.</p>
      </div>

      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>Timestamp</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Resource</th>
            </tr>
          </thead>
          <tbody>
            ${rows || '<tr><td colspan="4">No audit logs found.</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = '<p style="color: var(--danger);">Error loading audit log.</p>';
  }
}
