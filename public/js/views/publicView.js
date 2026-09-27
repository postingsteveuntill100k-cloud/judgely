// Hackerly Public Platform & Editorial Showcase View
(function(window) {
  'use strict';

  const { escapeHtml, sanitizeUrl, openModal, showToast } = window.Judgely;
  const api = window.Judgely.api;

  let publicProjects = [];
  let publicTracks = [];
  let publicEvent = null;
  let cachedEvents = [];
  let activeTrack = 'all';
  let searchQuery = '';
  let hackathonFilter = 'all';
  let hackathonSearch = '';

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
              <strong>Hosted Showcase Shell:</strong> You are viewing the live cloud showcase on Firebase. For the authoritative evaluation engine, local database persistence, and offline testing, run self-hosted via Docker or Node.js.
            </div>
          </div>
        ` : ''}

        <!-- 3D Spatial Hero Section -->
        <section class="public-hero" id="hero-section">
          <!-- Three.js Universe Layer -->
          <div class="hero-universe-canvas-wrapper" aria-hidden="true">
            <canvas id="hackerly-universe-canvas"></canvas>
          </div>

          <!-- Hero Content Layer -->
          <div class="hero-content-layer">
            <div class="hero-tag">
              <span class="live-dot"></span>
              <span id="hero-status-pill">HACKERLY PLATFORM • THE MODERN HACKATHON ECOSYSTEM</span>
            </div>
            <h1 class="hero-headline" id="hero-event-title">Where Serious Hackathons Happen.</h1>
            <p class="hero-subtitle" id="hero-event-desc">
              The unified operating system for builders, teams, and organizers. Discover high-stakes competitions, assemble teams, build ambitious software, and experience transparent, mathematically normalized evaluation.
            </p>
            <div class="hero-actions">
              <a href="#hackathons-directory" class="btn btn-primary" id="btn-explore-hackathons">Explore Hackathons</a>
              <a href="#projects-showcase" class="btn btn-secondary" id="btn-explore-projects">Browse Projects</a>
              <button class="btn btn-secondary" id="btn-hero-host-event">+ Host a Hackathon</button>
            </div>
          </div>
        </section>

        <!-- Hackathon Lifecycle Walkthrough -->
        <section class="mb-10" id="lifecycle-section">
          <div class="section-eyebrow">The Complete Ecosystem</div>
          <h2 class="section-title">Built for the Entire Hackathon Journey</h2>
          <p class="section-subtitle">
            Hackerly is not merely a judging tool or a submission form. It is the end-to-end infrastructure connecting builders, projects, and defensible outcomes.
          </p>

          <div class="lifecycle-grid">
            <div class="lifecycle-card">
              <div class="lifecycle-num">01 / DISCOVER</div>
              <div class="lifecycle-title">Find Competitions</div>
              <div class="lifecycle-desc">
                Browse curated engineering hackathons with transparent rules, verified prize pools, and domain tracks.
              </div>
            </div>

            <div class="lifecycle-card">
              <div class="lifecycle-num">02 / TEAM UP</div>
              <div class="lifecycle-title">Assemble Rosters</div>
              <div class="lifecycle-desc">
                Create or join teams, manage member invitations with cryptographic codes, and collaborate seamlessly.
              </div>
            </div>

            <div class="lifecycle-card">
              <div class="lifecycle-num">03 / BUILD</div>
              <div class="lifecycle-title">Build Ambitious Code</div>
              <div class="lifecycle-desc">
                Build against clear rubrics, connect GitHub repositories and live deployments, and track milestone readiness.
              </div>
            </div>

            <div class="lifecycle-card">
              <div class="lifecycle-num">04 / SUBMIT</div>
              <div class="lifecycle-title">Enforced Deadlines</div>
              <div class="lifecycle-desc">
                Server-enforced deadline timestamps guarantee fair submission windows with tamper-proof version control.
              </div>
            </div>

            <div class="lifecycle-card">
              <div class="lifecycle-num">05 / EVALUATE</div>
              <div class="lifecycle-title">Defensible Judging</div>
              <div class="lifecycle-desc">
                Blind scoring, peer score privacy, weighted rubric criteria, and deterministic Z-score normalization.
              </div>
            </div>

            <div class="lifecycle-card">
              <div class="lifecycle-num">06 / SHOWCASE</div>
              <div class="lifecycle-title">Permanent Gallery</div>
              <div class="lifecycle-desc">
                Persistent, searchable project archives celebrating builder achievements with verifiable credentials.
              </div>
            </div>
          </div>
        </section>

        <!-- Live Platform Telemetry Ribbon -->
        <section class="metrics-grid mb-10" id="event-stats-ribbon">
          <div class="metric-card">
            <div class="metric-label">Active Submissions</div>
            <div class="metric-value" id="stat-projects-count">-</div>
            <div class="metric-subtext">Verified projects in gallery</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Domain Tracks</div>
            <div class="metric-value" id="stat-tracks-count">-</div>
            <div class="metric-subtext">Competitive technical categories</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Participating Teams</div>
            <div class="metric-value" id="stat-teams-count">-</div>
            <div class="metric-subtext">Collaborative builder squads</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Evaluation Engine</div>
            <div class="metric-value text-success">Active</div>
            <div class="metric-subtext">Z-Score Normalization & Blind RBAC</div>
          </div>
        </section>

        <!-- Hackathon Discovery Directory (/hackathons) -->
        <section class="mb-12" id="hackathons-directory">
          <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <div class="section-eyebrow">Hackathon Discovery</div>
              <h2 class="section-title">Explore Hackathons</h2>
              <p class="section-subtitle">Discover active competitions, join teams to build, or launch your own hackathon.</p>
            </div>
            <div class="flex gap-2 items-center flex-wrap">
              <input type="text" id="hackathon-search-input" class="form-input" placeholder="Search hackathons..." style="width: 240px;">
              <button class="btn btn-primary" id="btn-directory-host-event">+ Host a Hackathon</button>
            </div>
          </div>

          <div class="hackathons-filter-bar flex gap-2 mb-6 flex-wrap" id="hackathons-filter-bar">
            <button type="button" class="pill active" data-filter="all">All Competitions</button>
            <button type="button" class="pill" data-filter="SUBMISSIONS_OPEN">Submissions Open</button>
            <button type="button" class="pill" data-filter="JUDGING">Judging in Progress</button>
            <button type="button" class="pill" data-filter="RESULTS_RELEASED">Results Announced</button>
          </div>

          <div class="hackathons-grid" id="hackathons-container">
            <div class="p-6 text-center text-muted col-span-full">Loading hackathons directory...</div>
          </div>
        </section>

        <!-- Projects Showcase Gallery (/projects) -->
        <section class="mb-12" id="projects-showcase">
          <div class="flex justify-between items-center mb-4 flex-wrap gap-3">
            <div>
              <div class="section-eyebrow">Submissions Showcase</div>
              <h2 class="section-title">Project Gallery</h2>
              <p class="section-subtitle">Explore working prototypes, repositories, and architectural solutions built on Hackerly.</p>
            </div>
            <div class="search-box">
              <input type="text" id="project-search-input" class="form-input" placeholder="Search projects by title, stack, or team..." style="width: 320px;">
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

        <!-- Tracks Section -->
        <section class="mb-12" id="tracks-section">
          <div class="section-eyebrow">Competition Categories</div>
          <h2 class="section-title">Hackathon Tracks & Specializations</h2>
          <p class="section-subtitle">Each track features tailored rubric criteria, specialized judges, and dedicated awards.</p>
          <div class="grid grid-3 gap-4 mt-6" id="tracks-cards-grid">
            <div class="empty-state-box grid-col-all">Loading competition tracks...</div>
          </div>
        </section>

        <!-- Competition Schedule -->
        <section class="mb-12" id="schedule-section">
          <div class="section-eyebrow">Event Lifecycle</div>
          <h2 class="section-title">Competition Timeline</h2>
          <div class="roadmap-steps mt-6">
            <div class="roadmap-step">
              <div class="step-num done">1</div>
              <div class="step-meta">
                <strong>Registration Opens</strong>
                <span>Rosters & Individual Entry</span>
              </div>
            </div>
            <div class="roadmap-step">
              <div class="step-num active">2</div>
              <div class="step-meta">
                <strong>Hacking & Building</strong>
                <span>Collaborative Development</span>
              </div>
            </div>
            <div class="roadmap-step">
              <div class="step-num">3</div>
              <div class="step-meta">
                <strong>Submissions Lock</strong>
                <span id="schedule-deadline-text">Server Enforced</span>
              </div>
            </div>
            <div class="roadmap-step">
              <div class="step-num">4</div>
              <div class="step-meta">
                <strong>Blind Evaluation</strong>
                <span>Isolated Reviews & Normalization</span>
              </div>
            </div>
            <div class="roadmap-step">
              <div class="step-num">5</div>
              <div class="step-meta">
                <strong>Results Released</strong>
                <span>Public Standings & Awards</span>
              </div>
            </div>
          </div>
        </section>

        <!-- Defensible Evaluation Architecture -->
        <section class="mb-12" id="integrity-section">
          <div class="section-eyebrow">Architecture Guarantees</div>
          <h2 class="section-title">Built for Serious Competitions</h2>
          <p class="section-subtitle">
            Hackerly eliminates peer bias, score inflation, and organizer favoritism through mathematical normalization and cryptographic audit trails.
          </p>
          <div class="integrity-grid mt-6">
            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </div>
              <h4>Role Isolation & Privacy</h4>
              <p>Strict server-side RBAC ensures judges evaluate in isolation: Judge A cannot view Judge B's scores, and participants cannot access evaluations prior to release.</p>
            </div>

            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <h4>Mathematical Normalization</h4>
              <p>Z-score normalization transforms raw judge scores, neutralizing both overly generous and harsh graders to produce statistically defensible final rankings.</p>
            </div>

            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 14 14"></polyline>
                </svg>
              </div>
              <h4>Immutable Audit Ledger</h4>
              <p>Every assignment, submission version, review submission, score change, and result publication is timestamped and recorded in the audit log.</p>
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
              <p>Deploy Hackerly anywhere with Docker and SQLite. Full local database persistence, 100% offline ready, with zero mandatory cloud accounts.</p>
            </div>
          </div>
        </section>

        <!-- Bottom CTA -->
        <section class="card p-8 text-center mb-8" style="background: linear-gradient(135deg, rgba(99,102,241,0.1) 0%, rgba(16,185,129,0.06) 100%);">
          <h2 class="text-2xl font-bold mb-2">Ready to run your next hackathon?</h2>
          <p class="text-muted max-width-600 mx-auto mb-6">
            Join thousands of developers, organizers, and universities running seamless competitions on Hackerly.
          </p>
          <div class="flex justify-center gap-3 flex-wrap">
            <button class="btn btn-primary" id="btn-bottom-host-hackathon">+ Host a Hackathon</button>
            <button class="btn btn-secondary" id="btn-bottom-signin">Sign In to Platform</button>
          </div>
        </section>
      </div>
    `;

    // 1. Initialize Three.js Spatial Universe in Hero
    if (window.HackerlyUniverse) {
      setTimeout(() => {
        window.HackerlyUniverse.init('hackerly-universe-canvas');
      }, 50);
    }

    // 2. Bind Project Search & Track Filter
    const searchInput = document.getElementById('project-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderFilteredProjects();
      });
    }

    // 3. Bind Hackathon Search & Status Filters
    const hackathonSearchInput = document.getElementById('hackathon-search-input');
    if (hackathonSearchInput) {
      hackathonSearchInput.addEventListener('input', (e) => {
        hackathonSearch = e.target.value.toLowerCase().trim();
        filterAndRenderHackathons();
      });
    }

    document.querySelectorAll('#hackathons-filter-bar .pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('#hackathons-filter-bar .pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        hackathonFilter = pill.getAttribute('data-filter') || 'all';
        filterAndRenderHackathons();
      });
    });

    // 4. Bind Host Event CTAs
    const btnHeroHost = document.getElementById('btn-hero-host-event');
    if (btnHeroHost && window.Judgely.showCreateHackathonModal) {
      btnHeroHost.addEventListener('click', window.Judgely.showCreateHackathonModal);
    }

    const btnDirHost = document.getElementById('btn-directory-host-event');
    if (btnDirHost && window.Judgely.showCreateHackathonModal) {
      btnDirHost.addEventListener('click', window.Judgely.showCreateHackathonModal);
    }

    const btnBottomHost = document.getElementById('btn-bottom-host-hackathon');
    if (btnBottomHost && window.Judgely.showCreateHackathonModal) {
      btnBottomHost.addEventListener('click', window.Judgely.showCreateHackathonModal);
    }

    const btnBottomSignIn = document.getElementById('btn-bottom-signin');
    if (btnBottomSignIn) {
      btnBottomSignIn.addEventListener('click', () => {
        window.Judgely.navigateTo('login');
      });
    }

    // 5. Fetch live data from backend
    await loadPublicData();
  }

  function filterAndRenderHackathons() {
    let filtered = cachedEvents || [];
    if (hackathonFilter !== 'all') {
      filtered = filtered.filter(e => e.status === hackathonFilter);
    }
    if (hackathonSearch) {
      filtered = filtered.filter(e =>
        (e.name && e.name.toLowerCase().includes(hackathonSearch)) ||
        (e.description && e.description.toLowerCase().includes(hackathonSearch))
      );
    }
    renderHackathonsCards(filtered);
  }

  function renderHackathonsCards(events) {
    const container = document.getElementById('hackathons-container');
    if (!container) return;

    if (!events || events.length === 0) {
      container.innerHTML = `
        <div class="empty-state-box text-center p-6 bg-surface rounded border col-span-full">
          <p class="text-muted">No hackathons currently matching your search and filter criteria.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = events.map(evt => {
      const isCurrent = evt.id === window.Judgely.state.activeEventId;
      const statusBadge = evt.status === 'RESULTS_RELEASED'
        ? '<span class="badge badge-success">● Results Released</span>'
        : (evt.status === 'JUDGING'
            ? '<span class="badge badge-warning">● In Judging</span>'
            : '<span class="badge badge-primary">● Submissions Open</span>');

      const closeDate = new Date(evt.submissions_close);
      const deadlineStr = isNaN(closeDate.getTime()) ? 'Open' : closeDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

      return `
        <div class="hackathon-card ${isCurrent ? 'active-event' : ''}">
          <div class="hackathon-card-header">
            ${statusBadge}
            ${isCurrent ? '<span class="badge badge-info text-xs">Viewing</span>' : ''}
          </div>
          <h3 class="hackathon-card-title">${escapeHtml(evt.name)}</h3>
          <p class="hackathon-card-desc">${escapeHtml(evt.description || 'Open-source engineering competition on Hackerly.')}</p>
          
          <div class="hackathon-card-meta">
            <div class="meta-item">
              <span class="meta-label">Deadline</span>
              <span class="meta-val">${deadlineStr}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Projects</span>
              <span class="meta-val">${evt.stats?.projects_count ?? 0}</span>
            </div>
            <div class="meta-item">
              <span class="meta-label">Teams</span>
              <span class="meta-val">${evt.stats?.teams_count ?? 0}</span>
            </div>
          </div>

          <div class="hackathon-card-actions mt-auto">
            <button class="btn btn-primary btn-sm w-full btn-switch-hackathon" data-id="${evt.id}">
              ${isCurrent ? 'Viewing Active Showcase' : 'Enter Hackathon'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-switch-hackathon').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        if (id) {
          window.Judgely.state.activeEventId = id;
          localStorage.setItem('judgely_active_event_id', id);
          window.Judgely.navigateTo('public');
        }
      });
    });
  }

  async function loadPublicData() {
    try {
      const activeId = window.Judgely.state.activeEventId;
      const [eventRes, tracksRes, projectsRes, eventsRes] = await Promise.allSettled([
        api.getEvent(activeId),
        api.getTracks(),
        api.getProjects(activeId),
        api.getEvents()
      ]);

      if (eventsRes.status === 'fulfilled' && eventsRes.value && eventsRes.value.events) {
        cachedEvents = eventsRes.value.events;
        filterAndRenderHackathons();
      }

      if (eventRes.status === 'fulfilled') {
        publicEvent = eventRes.value;
        updateEventHeader(publicEvent);
      } else {
        const heroTitle = document.getElementById('hero-event-title');
        if (heroTitle) heroTitle.textContent = 'Event Details Temporarily Unavailable';
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

      // Update platform metrics ribbon
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
    if (titleEl && event.name) {
      titleEl.textContent = event.name;
    }

    const descEl = document.getElementById('hero-event-desc');
    if (descEl && event.description) {
      descEl.textContent = event.description;
    }

    const navEvent = document.getElementById('header-event-name');
    if (navEvent && event.name) {
      navEvent.textContent = event.name;
    }

    const deadlineEl = document.getElementById('schedule-deadline-text');
    if (deadlineEl && event.submissions_close) {
      const d = new Date(event.submissions_close);
      deadlineEl.textContent = isNaN(d.getTime()) ? event.submissions_close : d.toLocaleString();
    }
  }

  function renderTracks(tracks) {
    // 1. Render Track Filter Pills
    const pillsContainer = document.getElementById('track-filter-pills');
    if (pillsContainer) {
      const pillsHtml = `
        <button class="pill ${activeTrack === 'all' ? 'active' : ''}" data-track="all">All Tracks (${publicProjects.length})</button>
        ${tracks.map(t => {
          const count = publicProjects.filter(p => p.track_id === t.id).length;
          return `<button class="pill ${activeTrack === t.id ? 'active' : ''}" data-track="${escapeHtml(t.id)}">${escapeHtml(t.name)} (${count})</button>`;
        }).join('')}
      `;
      pillsContainer.innerHTML = pillsHtml;

      pillsContainer.querySelectorAll('.pill').forEach(pill => {
        pill.addEventListener('click', () => {
          pillsContainer.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
          pill.classList.add('active');
          activeTrack = pill.getAttribute('data-track');
          renderFilteredProjects();
        });
      });
    }

    // 2. Render Track Cards Grid
    const tracksGrid = document.getElementById('tracks-cards-grid');
    if (tracksGrid) {
      if (tracks.length === 0) {
        tracksGrid.innerHTML = '<div class="empty-state-box grid-col-all">No tracks configured yet.</div>';
        return;
      }

      tracksGrid.innerHTML = tracks.map(t => `
        <div class="card p-6 flex flex-col justify-between">
          <div>
            <div class="flex items-center justify-between mb-2">
              <span class="track-badge">${escapeHtml(t.id)}</span>
              <span class="mono text-xs text-muted">Track</span>
            </div>
            <h3 class="font-bold text-lg mb-2">${escapeHtml(t.name)}</h3>
            <p class="text-sm text-muted mb-4">${escapeHtml(t.description || 'Focused technical challenge track.')}</p>
          </div>
          <div class="pt-4 border-t flex justify-between items-center text-xs text-muted">
            <span>Specialized Evaluation</span>
            <span class="text-primary font-semibold">Active</span>
          </div>
        </div>
      `).join('');
    }
  }

  function renderFilteredProjects() {
    const grid = document.getElementById('projects-grid-container');
    if (!grid) return;

    let filtered = publicProjects;

    // Filter by track
    if (activeTrack !== 'all') {
      filtered = filtered.filter(p => p.track_id === activeTrack);
    }

    // Filter by search query
    if (searchQuery) {
      filtered = filtered.filter(p => {
        const titleMatch = (p.title || '').toLowerCase().includes(searchQuery);
        const summaryMatch = (p.summary || '').toLowerCase().includes(searchQuery);
        const teamMatch = (p.team_name || '').toLowerCase().includes(searchQuery);
        const techMatch = (p.technologies || []).some(t => t.toLowerCase().includes(searchQuery));
        return titleMatch || summaryMatch || teamMatch || techMatch;
      });
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state-box grid-col-all">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted mb-2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <h4 class="font-semibold mb-1">No matching projects found</h4>
          <p class="text-sm text-muted">Try adjusting your search query or track filter.</p>
        </div>
      `;
      return;
    }

    const isReleased = publicEvent && (publicEvent.results_released || publicEvent.status === 'RESULTS_RELEASED');

    grid.innerHTML = filtered.map(p => {
      const trackObj = publicTracks.find(t => t.id === p.track_id);
      const trackName = trackObj ? trackObj.name : (p.track_id || 'General');

      const scoreDisplay = isReleased && p.normalized_score !== undefined && p.normalized_score !== null
        ? `<span class="score-pill">Score: <strong>${Number(p.normalized_score).toFixed(2)}</strong></span>`
        : `<span class="score-pill status-eval">Evaluation in progress</span>`;

      return `
        <article class="project-card" data-id="${escapeHtml(p.id)}" data-track="${escapeHtml(p.track_id || '')}">
          <div class="card-header">
            <span class="track-badge">${escapeHtml(trackName)}</span>
            <span class="project-id">${escapeHtml(p.id)}</span>
          </div>
          <h3 class="project-title">${escapeHtml(p.title)}</h3>
          <p class="project-team">by <strong>${escapeHtml(p.team_name || 'Independent Builder')}</strong></p>
          <p class="project-summary">${escapeHtml(p.summary || 'No project description provided.')}</p>
          <div class="card-footer">
            ${scoreDisplay}
            <span class="reviews-pill">${p.review_count || 0} review${p.review_count === 1 ? '' : 's'}</span>
          </div>
        </article>
      `;
    }).join('');

    // Attach click listeners to open detailed project modal
    grid.querySelectorAll('.project-card').forEach(card => {
      card.addEventListener('click', () => {
        const pid = card.getAttribute('data-id');
        openProjectDetailModal(pid);
      });
    });
  }

  async function openProjectDetailModal(projectId) {
    try {
      const p = await api.getProject(projectId);
      if (!p) return;

      const trackObj = publicTracks.find(t => t.id === p.track_id);
      const trackName = trackObj ? trackObj.name : (p.track_id || 'General');
      const isReleased = publicEvent && (publicEvent.results_released || publicEvent.status === 'RESULTS_RELEASED');

      const modalHtml = `
        <div class="project-modal-view">
          <div class="flex justify-between items-start mb-4">
            <div>
              <span class="track-badge mb-2 inline-block">${escapeHtml(trackName)}</span>
              <h2 class="text-2xl font-bold">${escapeHtml(p.title)}</h2>
              <div class="text-sm text-muted mt-1">
                Team: <strong class="text-main">${escapeHtml(p.team_name || 'Independent Builder')}</strong>
              </div>
            </div>
            <div class="text-right">
              <span class="mono text-xs text-muted block mb-1">PROJECT ID</span>
              <span class="badge badge-secondary">${escapeHtml(p.id)}</span>
            </div>
          </div>

          <div class="project-detail-section mb-6">
            <h4 class="font-semibold text-sm text-muted uppercase tracking-wider mb-2">Project Summary</h4>
            <p class="text-body leading-relaxed">${escapeHtml(p.summary || 'No description provided.')}</p>
          </div>

          ${p.technologies && p.technologies.length > 0 ? `
            <div class="project-detail-section mb-6">
              <h4 class="font-semibold text-sm text-muted uppercase tracking-wider mb-2">Technologies & Architecture</h4>
              <div class="flex gap-2 flex-wrap">
                ${p.technologies.map(t => `<span class="badge badge-subtle">${escapeHtml(t)}</span>`).join('')}
              </div>
            </div>
          ` : ''}

          <div class="project-detail-section mb-6">
            <h4 class="font-semibold text-sm text-muted uppercase tracking-wider mb-2">Links & Resources</h4>
            <div class="flex gap-3 flex-wrap">
              ${p.repo_url ? `
                <a href="${sanitizeUrl(p.repo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm inline-flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                  </svg>
                  Repository
                </a>
              ` : '<span class="text-sm text-muted">No repository provided</span>'}

              ${p.demo_url ? `
                <a href="${sanitizeUrl(p.demo_url)}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm inline-flex items-center gap-2">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polygon points="10 8 16 12 10 16 10 8"></polygon>
                  </svg>
                  Live Deployment
                </a>
              ` : ''}
            </div>
          </div>

          <div class="project-detail-section pt-4 border-t flex justify-between items-center">
            <div>
              <span class="text-xs text-muted block">Evaluation Status</span>
              <strong>${isReleased ? 'Official Results Released' : 'Judging in Progress'}</strong>
            </div>
            ${isReleased && p.normalized_score !== undefined ? `
              <div class="text-right">
                <span class="text-xs text-muted block">Final Normalized Score</span>
                <span class="font-bold text-lg text-primary">${Number(p.normalized_score).toFixed(2)}</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;

      openModal('Project Overview', modalHtml);
    } catch (err) {
      showToast('Could not load project details', 'error');
    }
  }

  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.public = {
    render: render,
    reload: loadPublicData
  };
})(window);
