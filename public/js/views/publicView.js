// Judgely Public Event & Editorial Showcase View
(function(window) {
  'use strict';

  const { escapeHtml, sanitizeUrl, openModal, showToast } = window.Judgely;
  const api = window.Judgely.api;

  let publicProjects = [];
  let publicTracks = [];
  let publicEvent = null;
  let activeTrack = 'all';
  let searchQuery = '';

  async function render(container) {
    container.innerHTML = `
      <div class="container py-8">
        ${window.Judgely.state.isHostedShell ? `
          <div class="hosted-shell-banner">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <div>
              <strong>Hosted Showcase Shell:</strong> You are viewing the hosted read-only preview of Sample Hack 2026. For the authoritative evaluation engine, local database persistence, and offline testing, run self-hosted via Docker or Node.js.
            </div>
          </div>
        ` : ''}

        <!-- Hero Section -->
        <section class="hero-section text-center mb-8" id="hero-section">
          <div id="hero-status-container" class="mb-4">
            <span class="badge badge-primary">Loading Event Context...</span>
          </div>
          <h1 class="hero-headline" id="hero-event-title">Judgely Hackathon Showcase</h1>
          <p class="hero-subhead" id="hero-event-desc">
            Open-source judging infrastructure with transparent assignments, defensible scoring, and mathematical normalization.
          </p>
          <div class="flex justify-center gap-3 mt-6">
            <a href="#projects-showcase" class="btn btn-primary" id="btn-explore-projects">Explore Projects</a>
            <a href="#tracks-section" class="btn btn-secondary" id="btn-view-tracks">View Tracks</a>
          </div>
        </section>

        <!-- Live Event Statistics Ribbon -->
        <section class="metrics-grid mb-8" id="event-stats-ribbon">
          <div class="metric-card">
            <div class="metric-label">Registered Projects</div>
            <div class="metric-value" id="stat-projects-count">-</div>
            <div class="metric-subtext">Active Submissions</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Competition Tracks</div>
            <div class="metric-value" id="stat-tracks-count">-</div>
            <div class="metric-subtext">Domain Categories</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Participating Teams</div>
            <div class="metric-value" id="stat-teams-count">-</div>
            <div class="metric-subtext">Collaborative Units</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Judging Engine</div>
            <div class="metric-value text-success">Active</div>
            <div class="metric-subtext">Z-Score Normalization</div>
          </div>
        </section>

        <!-- How Judging Works (5-Step Architectural Flow) -->
        <section class="workflow-section" id="how-judging-works">
          <div class="section-eyebrow">Defensible Evaluation</div>
          <h2 class="section-title">How Judging Works</h2>
          <p class="section-subtitle">
            Judgely eliminates peer influence, score bias, and organizer subjectivity through deterministic cryptographic workflows.
          </p>
          <div class="workflow-steps-grid">
            <div class="workflow-step-card">
              <div class="workflow-step-num">1</div>
              <div class="workflow-step-title">Assignment</div>
              <div class="workflow-step-desc">
                Domain judges are assigned to projects based on track expertise. Zero conflict of interest.
              </div>
            </div>
            <div class="workflow-step-card">
              <div class="workflow-step-num">2</div>
              <div class="workflow-step-title">Blind Review</div>
              <div class="workflow-step-desc">
                Judges score projects in complete isolation. No judge can see peer scores or ranking progress.
              </div>
            </div>
            <div class="workflow-step-card">
              <div class="workflow-step-num">3</div>
              <div class="workflow-step-title">Normalization</div>
              <div class="workflow-step-desc">
                Mathematical z-score normalization neutralizes harsh or lenient grading variances fairly.
              </div>
            </div>
            <div class="workflow-step-card">
              <div class="workflow-step-num">4</div>
              <div class="workflow-step-title">Embargoed Results</div>
              <div class="workflow-step-desc">
                Results remain confidential until the organizer officially signs and publishes the ledger.
              </div>
            </div>
            <div class="workflow-step-card">
              <div class="workflow-step-num">5</div>
              <div class="workflow-step-title">Verifiable Audit</div>
              <div class="workflow-step-desc">
                Every score, assignment, and status transition is recorded in an immutable audit trail.
              </div>
            </div>
          </div>
        </section>

        <!-- Tracks Section -->
        <section class="mb-8" id="tracks-section">
          <div class="section-eyebrow">Competition Categories</div>
          <h2 class="section-title">Hackathon Tracks</h2>
          <div class="grid grid-3 gap-4 mt-4" id="tracks-cards-grid">
            <div class="empty-state-box grid-col-all">Loading competition tracks...</div>
          </div>
        </section>

        <!-- Projects Showcase Section -->
        <section class="mb-8" id="projects-showcase">
          <div class="flex justify-between items-center mb-4">
            <div>
              <div class="section-eyebrow">Submissions Gallery</div>
              <h2 class="section-title">Featured Projects</h2>
            </div>
            <div class="search-box">
              <input type="text" id="project-search-input" class="form-input" placeholder="Search projects by title, summary, or stack..." style="width: 320px;">
            </div>
          </div>

          <!-- Track Filter Pills -->
          <div class="filter-pills-bar mb-6" id="track-filter-pills">
            <button class="pill active" data-track="all">All Tracks</button>
          </div>

          <!-- Project Cards Grid -->
          <div class="projects-grid" id="projects-grid-container">
            <div class="empty-state-box grid-col-all">Loading projects from server...</div>
          </div>
        </section>

        <!-- Judging Integrity Pillars -->
        <section class="mb-8" id="integrity-section">
          <div class="section-eyebrow">Architecture Guarantees</div>
          <h2 class="section-title">Built for Serious Competitions</h2>
          <div class="integrity-grid mt-6">
            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </div>
              <h4>Role Isolation</h4>
              <p>Strict server-side RBAC ensures judges cannot inspect peer evaluations, and participants cannot access private scores.</p>
            </div>
            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <h4>Mathematical Proof</h4>
              <p>Standardized score distribution prevents outlier judges from disproportionately swaying winning project outcomes.</p>
            </div>
            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 14 14"></polyline>
                </svg>
              </div>
              <h4>Auditable Timeline</h4>
              <p>Every assignment, submission edit, score submission, and configuration change is logged with cryptographically strong UUIDs.</p>
            </div>
            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                  <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                  <line x1="6" y1="6" x2="6.01" y2="6"></line>
                  <line x1="6" y1="18" x2="6.01" y2="18"></line>
                </svg>
              </div>
              <h4>Self-Hostable Core</h4>
              <p>Deploy Judgely anywhere in 30 seconds via Docker and SQLite. 100% offline capable with zero external cloud dependencies.</p>
            </div>
          </div>
        </section>
      </div>
    `;

    // Bind search and filter events
    const searchInput = document.getElementById('project-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderFilteredProjects();
      });
    }

    // Fetch live data from backend
    await loadPublicData();
  }

  async function loadPublicData() {
    try {
      const [eventRes, tracksRes, projectsRes] = await Promise.allSettled([
        api.getEvent(),
        api.getTracks(),
        api.getProjects()
      ]);

      if (eventRes.status === 'fulfilled') {
        publicEvent = eventRes.value;
        updateEventHeader(publicEvent);
      } else {
        const heroTitle = document.getElementById('hero-event-title');
        if (heroTitle) heroTitle.textContent = 'Event Details Temporarily Unavailable';
        const heroStatus = document.getElementById('hero-status-container');
        if (heroStatus) heroStatus.innerHTML = '<span class="badge badge-danger">Connection Error</span>';
      }

      if (tracksRes.status === 'fulfilled') {
        publicTracks = tracksRes.value.tracks || tracksRes.value || [];
        renderTracks(publicTracks);
      }

      if (projectsRes.status === 'fulfilled') {
        publicProjects = projectsRes.value.projects || projectsRes.value || [];
        renderFilteredProjects();
      } else {
        const grid = document.getElementById('projects-grid-container');
        if (grid) {
          grid.innerHTML = `
            <div class="error-banner-box">
              <p class="text-danger font-semibold mb-2">Unable to load projects from server</p>
              <p class="text-muted text-sm mb-4">The backend API was unreachable. Please verify server status.</p>
              <button class="btn btn-secondary" onclick="window.Judgely.views.public.reload()">Retry Connection</button>
            </div>
          `;
        }
      }

      // Update metrics ribbon
      const statProjects = document.getElementById('stat-projects-count');
      if (statProjects) statProjects.textContent = publicProjects.length;

      const statTracks = document.getElementById('stat-tracks-count');
      if (statTracks) statTracks.textContent = publicTracks.length;

      const statTeams = document.getElementById('stat-teams-count');
      if (statTeams) {
        const uniqueTeams = new Set(publicProjects.map(p => p.team_id || p.team_name).filter(Boolean));
        statTeams.textContent = uniqueTeams.size || publicProjects.length;
      }

    } catch (err) {
      console.error('Failed to load public data:', err);
    }
  }

  function updateEventHeader(event) {
    if (!event) return;
    const titleEl = document.getElementById('hero-event-title');
    if (titleEl) titleEl.textContent = event.name || 'Hackathon Championship';

    const descEl = document.getElementById('hero-event-desc');
    if (descEl && event.description) descEl.textContent = event.description;

    const navEvent = document.getElementById('header-event-name');
    if (navEvent) navEvent.textContent = event.name;

    const statusContainer = document.getElementById('hero-status-container');
    if (statusContainer) {
      const isClosed = event.submissions_close && new Date(event.submissions_close) < new Date();
      if (event.results_released) {
        statusContainer.innerHTML = '<span class="badge badge-success">Official Results Published</span>';
      } else if (isClosed) {
        statusContainer.innerHTML = '<span class="badge badge-warning">Submissions Closed • Judging In Progress</span>';
      } else {
        statusContainer.innerHTML = '<span class="badge badge-primary">Submissions Open</span>';
      }
    }
  }

  function renderTracks(tracks) {
    const cardsContainer = document.getElementById('tracks-cards-grid');
    const pillsContainer = document.getElementById('track-filter-pills');

    if (cardsContainer) {
      if (!tracks || tracks.length === 0) {
        cardsContainer.innerHTML = '<div class="empty-state-box grid-col-all">No tracks configured for this event.</div>';
      } else {
        cardsContainer.innerHTML = tracks.map(t => `
          <div class="card p-4">
            <span class="badge badge-primary mb-2">${escapeHtml(t.id)}</span>
            <h4 class="font-bold mb-1">${escapeHtml(t.name)}</h4>
            <p class="text-muted text-sm">${escapeHtml(t.description || 'Projects building solutions in this category.')}</p>
          </div>
        `).join('');
      }
    }

    if (pillsContainer && tracks && tracks.length > 0) {
      const totalCount = publicProjects.length;
      pillsContainer.innerHTML = `
        <button class="pill ${activeTrack === 'all' ? 'active' : ''}" data-track="all">All Tracks (${totalCount})</button>
        ${tracks.map(t => {
          const count = publicProjects.filter(p => p.track_id === t.id).length;
          return `
            <button class="pill ${activeTrack === t.id ? 'active' : ''}" data-track="${escapeHtml(t.id)}">
              ${escapeHtml(t.name)} (${count})
            </button>
          `;
        }).join('')}
      `;

      pillsContainer.querySelectorAll('.pill').forEach(btn => {
        btn.addEventListener('click', () => {
          pillsContainer.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          activeTrack = btn.getAttribute('data-track');
          renderFilteredProjects();
        });
      });
    }
  }

  function renderFilteredProjects() {
    const container = document.getElementById('projects-grid-container');
    if (!container) return;

    let filtered = publicProjects;
    if (activeTrack !== 'all') {
      filtered = filtered.filter(p => p.track_id === activeTrack);
    }
    if (searchQuery) {
      filtered = filtered.filter(p => {
        const matchTitle = (p.title || '').toLowerCase().includes(searchQuery);
        const matchSummary = (p.summary || '').toLowerCase().includes(searchQuery);
        const matchTech = (p.tech_stack || '').toLowerCase().includes(searchQuery);
        const matchTeam = (p.team_name || '').toLowerCase().includes(searchQuery);
        return matchTitle || matchSummary || matchTech || matchTeam;
      });
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box">
          <h4 class="font-semibold mb-2">No projects found</h4>
          <p class="text-muted text-sm">Try adjusting your track filter or search query.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(p => {
      const techTags = p.tech_stack ? p.tech_stack.split(',').map(s => s.trim()).filter(Boolean) : [];
      return `
        <div class="card project-card" data-project-id="${escapeHtml(p.id)}">
          <div class="flex justify-between items-center mb-2">
            <span class="badge badge-secondary">${escapeHtml(p.track_name || p.track_id || 'Track')}</span>
            <span class="mono text-muted text-xs">${escapeHtml(p.id)}</span>
          </div>
          <h3 class="font-bold mb-2">${escapeHtml(p.title)}</h3>
          <p class="text-muted text-sm mb-3 line-clamp-3">${escapeHtml(p.summary || 'No overview provided.')}</p>
          ${techTags.length > 0 ? `
            <div class="project-tech-tags">
              ${techTags.slice(0, 3).map(t => `<span class="tech-tag">${escapeHtml(t)}</span>`).join('')}
              ${techTags.length > 3 ? `<span class="tech-tag text-muted">+${techTags.length - 3}</span>` : ''}
            </div>
          ` : ''}
          <div class="project-card-footer flex justify-between items-center border-t pt-3 mt-auto">
            <span class="text-xs text-muted">by <strong>${escapeHtml(p.team_name || 'Team')}</strong></span>
            <button class="btn btn-secondary btn-sm view-project-btn" data-id="${escapeHtml(p.id)}">View Details &rarr;</button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.view-project-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pid = btn.getAttribute('data-id');
        showProjectDetailModal(pid);
      });
    });

    container.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => {
        const pid = card.getAttribute('data-project-id');
        showProjectDetailModal(pid);
      });
    });
  }

  async function showProjectDetailModal(projectId) {
    openModal('Loading Project Details...', '<div class="p-6 text-center text-muted">Fetching project information...</div>');

    try {
      const data = await api.getProject(projectId);
      const project = data.project || data;

      const safeRepo = sanitizeUrl(project.repo_url);
      const safeDemo = sanitizeUrl(project.demo_url);

      const memberItems = (project.members || []).map(m => {
        const name = typeof m === 'object' ? (m.name || m.user_name || 'Participant') : 'Participant';
        const role = typeof m === 'object' && m.role ? `(${m.role})` : '';
        return `<li><strong>${escapeHtml(name)}</strong> ${escapeHtml(role)}</li>`;
      }).join('');

      const normalizedResultBadge = (project.normalized_score !== undefined && project.normalized_score !== null) ? `
        <div class="card p-4 mb-4" style="background-color: var(--success-bg); border-color: var(--success-border);">
          <h4 class="text-success font-bold mb-1">Official Evaluation Result</h4>
          <p class="text-sm">Final Normalized Score: <strong>${Number(project.normalized_score).toFixed(3)}</strong> (Rank #${project.rank})</p>
        </div>
      ` : '';

      const modalHtml = `
        <div class="project-modal-content">
          ${normalizedResultBadge}
          <div class="flex justify-between items-center mb-2">
            <span class="badge badge-primary">${escapeHtml(project.track_name || project.track_id || 'Track')}</span>
            <div class="flex items-center gap-2">
              <span class="badge badge-success capitalize">${escapeHtml(project.status || 'Submitted')}</span>
              <span class="mono text-muted text-xs">${escapeHtml(project.id)}</span>
            </div>
          </div>
          <h2 class="font-bold text-xl mb-1">${escapeHtml(project.title)}</h2>
          <div class="flex justify-between items-center flex-wrap gap-2 text-xs text-muted mb-4">
            <span>Submitted by <strong>${escapeHtml(project.team_name || 'Team')}</strong></span>
            <span>${project.submitted_at ? new Date(project.submitted_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''}</span>
          </div>

          <!-- Quick Action Buttons at Top -->
          ${(safeRepo || safeDemo) ? `
            <div class="flex gap-2 mb-4 pb-3 border-b">
              ${safeRepo ? `<a href="${escapeHtml(safeRepo)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm">GitHub Repository &nearr;</a>` : ''}
              ${safeDemo ? `<a href="${escapeHtml(safeDemo)}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">Live Demo &nearr;</a>` : ''}
            </div>
          ` : ''}

          <div class="mb-4">
            <h4 class="font-semibold text-sm mb-1 text-muted uppercase">Project Overview</h4>
            <p class="text-sm leading-relaxed text-body">${escapeHtml(project.summary || 'No description provided.')}</p>
          </div>

          ${project.tech_stack ? `
            <div class="mb-4">
              <h4 class="font-semibold text-sm mb-1 text-muted uppercase">Technologies</h4>
              <p class="mono text-xs p-2 rounded" style="background: var(--bg-subtle);">${escapeHtml(project.tech_stack)}</p>
            </div>
          ` : ''}

          ${memberItems ? `
            <div class="mb-4">
              <h4 class="font-semibold text-sm mb-1 text-muted uppercase">Contributors</h4>
              <ul class="text-sm text-muted pl-4">${memberItems}</ul>
            </div>
          ` : ''}
        </div>
      `;

      openModal(project.title, modalHtml);
    } catch (err) {
      openModal('Project Unavailable', `<div class="p-6 text-center text-danger">${escapeHtml(err.message)}</div>`);
    }
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.public = {
    render,
    reload: loadPublicData
  };
})(window);
