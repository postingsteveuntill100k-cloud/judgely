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
          <div class="card p-4 mb-6 flex items-center gap-3 text-sm border" style="background: #f8fafc; border-color: #cbd5e1;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-primary flex-shrink-0">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <div>
              <strong>Hosted Showcase Shell:</strong> You are viewing the live cloud preview on Firebase. For the authoritative evaluation engine, local database persistence, and offline testing, run self-hosted via Docker or Node.js.
            </div>
          </div>
        ` : ''}

        <!-- 1. Spacious Editorial Hero -->
        <section class="public-hero" id="hero-section">
          <!-- Subtle Three.js Constellation Background -->
          <div class="hero-universe-canvas-wrapper" aria-hidden="true">
            <canvas id="hackerly-universe-canvas"></canvas>
          </div>

          <!-- Hero Content -->
          <div class="hero-content-layer">
            <div class="hero-tag">
              <span class="live-dot"></span>
              <span>HACKERLY PLATFORM</span>
            </div>
            <h1 class="hero-headline" id="hero-event-title">The Modern Platform for Hackathons</h1>
            <p class="hero-subtitle" id="hero-event-desc">
              Discover engineering competitions, assemble teams, build ambitious software, and experience transparent, mathematically normalized evaluation.
            </p>
            <div class="hero-actions">
              <a href="#hackathons-directory" class="btn btn-primary" id="btn-explore-hackathons">Explore Hackathons</a>
              <button class="btn btn-secondary" id="btn-hero-host-event">+ Host a Hackathon</button>
              <a href="#projects-showcase" class="btn btn-outline" id="btn-explore-projects">Browse Projects</a>
            </div>
          </div>
        </section>

        <!-- 2. Hackathon Lifecycle Journey (Clean Horizontal Flow) -->
        <section class="lifecycle-journey" id="lifecycle-section">
          <div class="text-center mb-6">
            <div class="section-eyebrow">The Hackathon Lifecycle</div>
            <h2 class="section-title">How Hackathons Happen on Hackerly</h2>
          </div>

          <div class="lifecycle-timeline">
            <div class="lifecycle-step">
              <div class="step-marker">01</div>
              <div class="step-name">Discover</div>
              <div class="step-caption">Find engineering hackathons that match your domain interests and stack.</div>
            </div>

            <div class="lifecycle-step">
              <div class="step-marker">02</div>
              <div class="step-name">Join</div>
              <div class="step-caption">Register individually or assemble a collaborative team roster.</div>
            </div>

            <div class="lifecycle-step">
              <div class="step-marker">03</div>
              <div class="step-name">Build</div>
              <div class="step-caption">Develop ambitious software with clear track guidelines and resources.</div>
            </div>

            <div class="lifecycle-step">
              <div class="step-marker">04</div>
              <div class="step-name">Submit</div>
              <div class="step-caption">Submit repositories and live deployments before server-enforced deadlines.</div>
            </div>

            <div class="lifecycle-step">
              <div class="step-marker">05</div>
              <div class="step-name">Judge</div>
              <div class="step-caption">Independent evaluations using weighted rubrics and Z-score normalization.</div>
            </div>

            <div class="lifecycle-step">
              <div class="step-marker">06</div>
              <div class="step-name">Showcase</div>
              <div class="step-caption">Results and verified projects become part of a permanent gallery.</div>
            </div>
          </div>
        </section>

        <!-- 3. Hackathon Discovery Directory (/hackathons) -->
        <section class="discovery-section" id="hackathons-directory">
          <div class="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div>
              <div class="section-eyebrow">Competition Directory</div>
              <h2 class="section-title">Explore Hackathons</h2>
              <p class="section-subtitle">Discover active engineering hackathons, join teams to build, or launch your own competition.</p>
            </div>
            <div class="flex gap-2 items-center flex-wrap">
              <input type="text" id="hackathon-search-input" class="form-input" placeholder="Search hackathons..." style="width: 240px;">
              <button class="btn btn-primary" id="btn-directory-host-event">+ Host a Hackathon</button>
            </div>
          </div>

          <div class="discovery-filter-bar">
            <div class="pills-group" id="hackathons-filter-bar">
              <button type="button" class="pill active" data-filter="all">All Competitions</button>
              <button type="button" class="pill" data-filter="SUBMISSIONS_OPEN">Submissions Open</button>
              <button type="button" class="pill" data-filter="JUDGING">Judging in Progress</button>
              <button type="button" class="pill" data-filter="RESULTS_RELEASED">Results Announced</button>
            </div>
          </div>

          <div class="hackathons-list" id="hackathons-container">
            <div class="empty-state-box col-span-full">Loading hackathons directory...</div>
          </div>
        </section>

        <!-- 4. Active Event Experience (Spotlight) -->
        <section class="card p-6 mb-12" id="event-spotlight-section" style="border-left: 4px solid var(--accent);">
          <div class="flex justify-between items-start flex-wrap gap-4 mb-4">
            <div>
              <div class="flex items-center gap-2 mb-1">
                <span class="badge badge-primary" id="spotlight-status-badge">Active Event</span>
                <span class="text-xs text-muted" id="spotlight-deadline-text">Deadline Enforced</span>
              </div>
              <h3 class="text-2xl font-bold" id="spotlight-event-name">Event Details</h3>
              <p class="text-muted text-sm mt-1" id="spotlight-event-desc">Loading event details...</p>
            </div>
            <div class="flex gap-2">
              <button class="btn btn-primary btn-sm" id="btn-spotlight-register">Register for this Event</button>
            </div>
          </div>

          <!-- Event Information Tabs / Sections -->
          <div class="grid grid-3 gap-4 pt-4 border-t" id="spotlight-details-grid">
            <div>
              <h4 class="font-bold text-sm mb-1">Schedule & Timeline</h4>
              <p class="text-xs text-muted" id="spotlight-schedule-desc">Hacking open until submissions deadline. Followed by blind judging and normalized results.</p>
            </div>
            <div>
              <h4 class="font-bold text-sm mb-1">Evaluation Rubric</h4>
              <p class="text-xs text-muted">Evaluated on technical complexity, execution quality, domain fit, and architectural innovation.</p>
            </div>
            <div>
              <h4 class="font-bold text-sm mb-1">Platform Rules</h4>
              <p class="text-xs text-muted">Original code written during competition window. Open-source repositories and live deployments required.</p>
            </div>
          </div>
        </section>

        <!-- 5. Competition Tracks (Clean Deduplicated Names, Zero Raw IDs) -->
        <section class="mb-12" id="tracks-section">
          <div class="section-eyebrow">Domain Focus</div>
          <h2 class="section-title">Competition Tracks</h2>
          <p class="section-subtitle">Projects are categorized into technical tracks with dedicated rubric criteria and domain evaluators.</p>
          <div class="tracks-grid" id="tracks-cards-grid">
            <div class="empty-state-box grid-col-all">Loading competition tracks...</div>
          </div>
        </section>

        <!-- 6. Project Showcase Gallery (/projects) -->
        <section class="showcase-section" id="projects-showcase">
          <div class="flex justify-between items-center mb-4 flex-wrap gap-3">
            <div>
              <div class="section-eyebrow">Project Showcase</div>
              <h2 class="section-title">Explore What People Built</h2>
              <p class="section-subtitle">Search working software, repositories, and architectural solutions built by teams.</p>
            </div>
            <div class="search-box">
              <input type="text" id="project-search-input" class="form-input" placeholder="Search projects by title, stack, or team..." style="width: 300px;">
            </div>
          </div>

          <!-- Track Filter Pills (Clean Normalized Names) -->
          <div class="discovery-filter-bar mb-4">
            <div class="pills-group" id="track-filter-pills">
              <button class="pill active" data-track="all">All Tracks</button>
            </div>
          </div>

          <!-- Project Cards Grid -->
          <div class="projects-grid" id="projects-grid-container">
            <div class="empty-state-box grid-col-all">Loading projects from server...</div>
          </div>
        </section>

        <!-- 7. How Judging Works (First-Class Editorial Section) -->
        <section class="judging-explainer-section" id="how-judging-works">
          <div class="text-center mb-6">
            <div class="section-eyebrow">Evaluation Infrastructure</div>
            <h2 class="section-title">How Judging Works on Hackerly</h2>
            <p class="section-subtitle mx-auto">
              Hackerly replaces subjective grading and peer influence with transparent rubrics, blind evaluations, and mathematical normalization.
            </p>
          </div>

          <div class="judging-steps-grid">
            <div class="judging-step-card">
              <div class="judging-step-num">STEP 01</div>
              <div class="judging-step-title">Domain Judge Assignment</div>
              <div class="judging-step-desc">
                Organizers assign domain specialists to projects based on track expertise. Workloads are balanced to prevent judge fatigue.
              </div>
            </div>

            <div class="judging-step-card">
              <div class="judging-step-num">STEP 02</div>
              <div class="judging-step-title">Blind Independent Scoring</div>
              <div class="judging-step-desc">
                Judges score projects in complete isolation. Judge A can never inspect Judge B's scores, ensuring zero peer bias or herd consensus.
              </div>
            </div>

            <div class="judging-step-card">
              <div class="judging-step-num">STEP 03</div>
              <div class="judging-step-title">Weighted Rubric Evaluation</div>
              <div class="judging-step-desc">
                Criteria such as Technical Complexity, Execution, and Innovation are configured with explicit weights and numeric boundaries.
              </div>
            </div>

            <div class="judging-step-card">
              <div class="judging-step-num">STEP 04</div>
              <div class="judging-step-title">Written Qualitative Feedback</div>
              <div class="judging-step-desc">
                Judges provide clear technical feedback and evaluation reasoning, helping builders understand the merits of their project.
              </div>
            </div>

            <div class="judging-step-card">
              <div class="judging-step-num">STEP 05</div>
              <div class="judging-step-title">Statistical Normalization</div>
              <div class="judging-step-desc">
                Deterministic Z-score normalization standardizes score distributions across judges, eliminating harsh or lenient grading bias.
              </div>
            </div>

            <div class="judging-step-card">
              <div class="judging-step-num">STEP 06</div>
              <div class="judging-step-title">Embargoed Release & Audit</div>
              <div class="judging-step-desc">
                Rankings remain confidential until the organizer officially releases results. Every review, score change, and audit event is permanently logged.
              </div>
            </div>
          </div>
        </section>

        <!-- 8. Platform Integrity Guarantees -->
        <section class="mb-12" id="integrity-section">
          <div class="section-eyebrow">Architectural Principles</div>
          <h2 class="section-title">Built for Serious Engineering Competitions</h2>
          <p class="section-subtitle">
            Engineered with strict security boundaries, defensive authorization, and full self-hosting capabilities.
          </p>

          <div class="integrity-grid mt-6">
            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                </svg>
              </div>
              <h4>Role Isolation & Privacy</h4>
              <p>Strict server-side RBAC ensures judges cannot view peer evaluations, and participants cannot access private scores prior to release.</p>
            </div>

            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
                </svg>
              </div>
              <h4>Mathematical Fairness</h4>
              <p>Z-score normalization transforms raw evaluations into standardized scores, neutralizing harsh or lenient grading variances fairly.</p>
            </div>

            <div class="integrity-card">
              <div class="integrity-card-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 14 14"></polyline>
                </svg>
              </div>
              <h4>Verifiable Audit Ledger</h4>
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
              <p>Deploy Hackerly anywhere with Docker and SQLite. Full local database persistence, 100% offline capable with zero mandatory cloud accounts.</p>
            </div>
          </div>
        </section>

        <!-- 9. Truthful Bottom Call to Action (No Manufactured Traction) -->
        <section class="card p-8 text-center mb-8" style="background: var(--bg-subtle);">
          <h2 class="text-2xl font-bold mb-2">Host your next hackathon with confidence</h2>
          <p class="text-muted max-width-600 mx-auto mb-6">
            Run an engineering competition with transparent assignments, defensible scoring, and self-hosted reliability.
          </p>
          <div class="flex justify-center gap-3 flex-wrap">
            <button class="btn btn-primary" id="btn-bottom-host-hackathon">+ Host a Hackathon</button>
            <button class="btn btn-secondary" id="btn-bottom-signin">Sign In to Platform</button>
          </div>
        </section>
      </div>
    `;

    // 1. Initialize Subtle Three.js Network
    if (window.HackerlyUniverse) {
      setTimeout(() => {
        window.HackerlyUniverse.init('hackerly-universe-canvas');
      }, 50);
    }

    // 2. Project Search & Filter
    const searchInput = document.getElementById('project-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.toLowerCase().trim();
        renderFilteredProjects();
      });
    }

    // 3. Hackathon Search & Filters
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

    // 4. Host Hackathon Buttons
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

    const btnSpotlightReg = document.getElementById('btn-spotlight-register');
    if (btnSpotlightReg) {
      btnSpotlightReg.addEventListener('click', async () => {
        const activeId = window.Judgely.state.activeEventId;
        const user = window.Judgely.state.user;
        if (!user || user.role === 'visitor') {
          window.Judgely.navigateTo('login');
          return;
        }
        try {
          const res = await api.registerForEvent(activeId);
          showToast(res.message || 'Successfully registered!', 'success');
          window.Judgely.state.user.role = 'participant';
          window.Judgely.navigateTo('participant');
        } catch (err) {
          showToast(err.message || 'Registration failed', 'error');
        }
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

      // Clean organizer display (no ugly raw IDs)
      const organizerDisplay = evt.organizer_name || 'Hackerly Community';

      return `
        <div class="hackathon-card-editorial ${isCurrent ? 'active-event' : ''}">
          <div class="hackathon-info">
            <div class="hackathon-top-meta">
              ${statusBadge}
              <span class="text-xs text-muted">Organized by <strong>${escapeHtml(organizerDisplay)}</strong></span>
              ${isCurrent ? '<span class="badge badge-info text-xs">Viewing</span>' : ''}
            </div>

            <a href="#event-spotlight-section" class="hackathon-title-link btn-switch-hackathon" data-id="${escapeHtml(evt.id)}">
              ${escapeHtml(evt.name)}
            </a>

            <p class="hackathon-desc-text">
              ${escapeHtml(evt.description || 'Open-source engineering competition on Hackerly.')}
            </p>

            <div class="hackathon-bottom-meta">
              <span><strong>Deadline:</strong> ${deadlineStr}</span>
              <span>•</span>
              <span><strong>${evt.stats?.projects_count ?? 0}</strong> projects</span>
              <span>•</span>
              <span><strong>${evt.stats?.teams_count ?? 0}</strong> teams</span>
            </div>
          </div>

          <div class="hackathon-action-col">
            <button class="btn ${isCurrent ? 'btn-secondary' : 'btn-primary'} btn-sm w-full btn-switch-hackathon" data-id="${escapeHtml(evt.id)}">
              ${isCurrent ? 'Viewing Active Event' : 'View Event & Projects'}
            </button>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.btn-switch-hackathon').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const id = btn.getAttribute('data-id');
        if (id) {
          window.Judgely.state.activeEventId = id;
          localStorage.setItem('judgely_active_event_id', id);
          loadPublicData();
          const spotlight = document.getElementById('event-spotlight-section');
          if (spotlight) spotlight.scrollIntoView({ behavior: 'smooth' });
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

    } catch (err) {
      console.error('Failed to load public data:', err);
    }
  }

  function updateEventHeader(event) {
    if (!event) return;

    // Header nav active event
    const navEvent = document.getElementById('header-event-name');
    if (navEvent && event.name) {
      navEvent.textContent = event.name;
    }

    // Spotlight section
    const spotlightName = document.getElementById('spotlight-event-name');
    if (spotlightName && event.name) {
      spotlightName.textContent = event.name;
    }

    const spotlightDesc = document.getElementById('spotlight-event-desc');
    if (spotlightDesc && event.description) {
      spotlightDesc.textContent = event.description;
    }

    const statusBadge = document.getElementById('spotlight-status-badge');
    if (statusBadge) {
      const isClosed = event.is_closed || (event.submissions_close && new Date(event.submissions_close) < new Date());
      if (event.results_released || event.status === 'RESULTS_RELEASED') {
        statusBadge.className = 'badge badge-success';
        statusBadge.textContent = 'Results Released';
      } else if (isClosed) {
        statusBadge.className = 'badge badge-warning';
        statusBadge.textContent = 'Judging in Progress';
      } else {
        statusBadge.className = 'badge badge-primary';
        statusBadge.textContent = 'Submissions Open';
      }
    }

    const deadlineEl = document.getElementById('spotlight-deadline-text');
    if (deadlineEl && event.submissions_close) {
      const d = new Date(event.submissions_close);
      deadlineEl.textContent = isNaN(d.getTime()) ? event.submissions_close : `Closes ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }
  }

  // Deduplicate and sanitize tracks: NEVER expose internal IDs in public UI
  function renderTracks(rawTracks) {
    // 1. Deduplicate by clean name
    const cleanTracksMap = new Map();

    (rawTracks || []).forEach(t => {
      // Clean up track name
      let name = (t.name || '').trim();
      // If name is an ugly ID like evt_... or trk_..., format it cleanly
      if (!name || name.startsWith('evt_') || name.startsWith('trk_')) {
        name = 'General Challenge';
      }
      if (!cleanTracksMap.has(name)) {
        cleanTracksMap.set(name, {
          name: name,
          id: t.id,
          description: t.description || 'Specialized technical challenge category.'
        });
      }
    });

    const uniqueTracks = Array.from(cleanTracksMap.values());

    // 2. Render Track Filter Pills
    const pillsContainer = document.getElementById('track-filter-pills');
    if (pillsContainer) {
      const pillsHtml = `
        <button class="pill ${activeTrack === 'all' ? 'active' : ''}" data-track="all">All Tracks (${publicProjects.length})</button>
        ${uniqueTracks.map(t => {
          const count = publicProjects.filter(p => p.track_id === t.id || (p.track_name && p.track_name.toLowerCase() === t.name.toLowerCase())).length;
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

    // 3. Render Track Cards Grid (No raw database IDs!)
    const tracksGrid = document.getElementById('tracks-cards-grid');
    if (tracksGrid) {
      if (uniqueTracks.length === 0) {
        tracksGrid.innerHTML = '<div class="empty-state-box grid-col-all">No tracks configured yet.</div>';
        return;
      }

      tracksGrid.innerHTML = uniqueTracks.map(t => {
        const count = publicProjects.filter(p => p.track_id === t.id || (p.track_name && p.track_name.toLowerCase() === t.name.toLowerCase())).length;
        return `
          <div class="track-card">
            <div>
              <h4>${escapeHtml(t.name)}</h4>
              <p>${escapeHtml(t.description)}</p>
            </div>
            <div class="pt-4 border-t flex justify-between items-center text-xs text-muted mt-3">
              <span>Domain Criteria</span>
              <span class="font-semibold text-main">${count} project${count === 1 ? '' : 's'}</span>
            </div>
          </div>
        `;
      }).join('');
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
        const techMatch = (p.tech_stack || p.technologies || []).some?.(t => t.toLowerCase().includes(searchQuery));
        return titleMatch || summaryMatch || teamMatch || techMatch;
      });
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-state-box grid-col-all">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted mb-2">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <h4 class="font-semibold mb-1">No matching projects found</h4>
          <p class="text-sm text-muted">Try adjusting your search terms or selecting another track.</p>
        </div>
      `;
      return;
    }

    const isReleased = publicEvent && (publicEvent.results_released || publicEvent.status === 'RESULTS_RELEASED');

    grid.innerHTML = filtered.map(p => {
      // Find clean track name
      let trackName = p.track_name;
      if (!trackName) {
        const trackObj = publicTracks.find(t => t.id === p.track_id);
        trackName = trackObj ? trackObj.name : 'General';
      }
      if (trackName.startsWith('evt_') || trackName.startsWith('trk_')) {
        trackName = 'General Track';
      }

      const scoreDisplay = isReleased && p.normalized_score !== undefined && p.normalized_score !== null
        ? `<span class="score-pill">Score: <strong>${Number(p.normalized_score).toFixed(2)}</strong></span>`
        : `<span class="score-pill status-eval">Evaluation in progress</span>`;

      return `
        <article class="project-card" data-id="${escapeHtml(p.id)}" data-track="${escapeHtml(p.track_id || '')}">
          <div>
            <div class="project-card-header">
              <span class="track-badge">${escapeHtml(trackName)}</span>
              <span class="text-xs text-muted">Active Submission</span>
            </div>
            <h3 class="project-title">${escapeHtml(p.title)}</h3>
            <p class="project-team">by <strong>${escapeHtml(p.team_name || 'Independent Builder')}</strong></p>
            <p class="project-summary">${escapeHtml(p.summary || 'No project description provided.')}</p>
          </div>

          <div class="project-card-footer">
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
      const res = await api.getProject(projectId);
      const p = res.project || res;
      if (!p) return;

      let trackName = p.track_name;
      if (!trackName) {
        const trackObj = publicTracks.find(t => t.id === p.track_id);
        trackName = trackObj ? trackObj.name : 'General';
      }
      if (trackName.startsWith('evt_') || trackName.startsWith('trk_')) {
        trackName = 'General Challenge';
      }

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
          </div>

          <div class="project-detail-section mb-6">
            <h4 class="font-semibold text-sm text-muted uppercase tracking-wider mb-2">Project Summary</h4>
            <p class="text-body leading-relaxed">${escapeHtml(p.summary || 'No description provided.')}</p>
          </div>

          ${p.team_members && p.team_members.length > 0 ? `
            <div class="project-detail-section mb-6">
              <h4 class="font-semibold text-sm text-muted uppercase tracking-wider mb-2">Team Members</h4>
              <div class="flex gap-2 flex-wrap">
                ${p.team_members.map(m => `<span class="badge badge-subtle">${escapeHtml(m.name || 'Member')}</span>`).join('')}
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
                <span class="text-xs text-muted block">Normalized Score</span>
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
