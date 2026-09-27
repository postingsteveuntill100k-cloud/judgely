// Judgely Main Application Orchestrator & Router
(function(window) {
  'use strict';

  const { state, setState, escapeHtml, showToast, openModal, closeModal } = window.Judgely;
  const api = window.Judgely.api;

  async function init() {
    // 1. Bind global header branding and modal system immediately
    bindHeaderNavigation();
    bindModalSystem();

    // 2. Load stored active event if present
    const savedEventId = localStorage.getItem('judgely_active_event_id');
    if (savedEventId) {
      state.activeEventId = savedEventId;
    }

    // 3. Render initial view immediately based on URL pathname or current role
    routeFromLocation();

    // 4. Subscribe to state changes to keep header updated
    window.Judgely.subscribe(onStateChange);

    // 5. Fetch server runtime configuration, events directory, and session in parallel
    try {
      const [configRes, meRes, eventsRes] = await Promise.allSettled([
        api.getConfig(),
        api.getMe(),
        api.getEvents()
      ]);

      if (configRes.status === 'fulfilled' && configRes.value) {
        setState({
          demoMode: Boolean(configRes.value.demo_mode),
          googleAuth: Boolean(configRes.value.google_auth),
          googleClientId: configRes.value.google_client_id || ''
        });
        if (state.currentView === 'login') {
          renderCurrentView();
        }
      }

      if (eventsRes.status === 'fulfilled' && eventsRes.value && eventsRes.value.events) {
        const events = eventsRes.value.events;
        setState({ events });
        if (!state.activeEventId && events.length > 0) {
          state.activeEventId = events[0].id;
          localStorage.setItem('judgely_active_event_id', events[0].id);
        }
      }

      if (meRes.status === 'fulfilled' && meRes.value && meRes.value.user) {
        const user = meRes.value.user;
        if (user.role && user.role !== 'visitor') {
          setState({ user });
          // If user is at root showcase or login, transition to their role workspace
          if (window.location.pathname === '/' || window.location.pathname === '/login') {
            navigateTo(user.role);
          }
        }
      }
    } catch (e) {
      console.warn('Could not complete background bootstrap sync:', e.message);
    }

    updateHeaderNav();
  }

  function routeFromLocation() {
    const path = window.location.pathname;
    const role = state.user.role;

    if (path === '/login') {
      navigateTo('login');
    } else if (role === 'participant') {
      navigateTo('participant');
    } else if (role === 'judge') {
      navigateTo('judge');
    } else if (role === 'organizer') {
      navigateTo('organizer');
    } else {
      navigateTo('public');
    }
  }

  function navigateTo(viewName) {
    setState({ currentView: viewName });
    renderCurrentView();
    updateHeaderNav();
  }

  function renderCurrentView() {
    const root = document.getElementById('app-root');
    if (!root) return;

    window.scrollTo({ top: 0, behavior: 'smooth' });

    switch (state.currentView) {
      case 'login':
        window.Judgely.views.login.render(root);
        break;
      case 'participant':
        window.Judgely.views.participant.render(root);
        break;
      case 'judge':
        window.Judgely.views.judge.render(root);
        break;
      case 'organizer':
        window.Judgely.views.organizer.render(root);
        break;
      case 'public':
      default:
        window.Judgely.views.public.render(root);
        break;
    }
  }

  function bindHeaderNavigation() {
    const brand = document.getElementById('nav-brand');
    if (brand) {
      brand.addEventListener('click', () => {
        if (state.user.role === 'visitor') {
          navigateTo('public');
        } else {
          navigateTo(state.user.role);
        }
      });
    }

    window.addEventListener('popstate', () => {
      routeFromLocation();
    });

    // Close open dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('event-dropdown-menu');
      const btn = document.getElementById('event-switcher-btn');
      if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
        menu.style.display = 'none';
      }
    });
  }

  function setActiveEvent(eventId) {
    state.activeEventId = eventId;
    localStorage.setItem('judgely_active_event_id', eventId);
    
    // Find event and check user role for this event
    const activeEvt = (state.events || []).find(e => e.id === eventId);
    if (activeEvt && activeEvt.user_role) {
      state.user.role = activeEvt.user_role;
    }

    showToast(`Switched active event to ${activeEvt ? activeEvt.name : eventId}`, 'info');
    updateHeaderNav();
    renderCurrentView();
  }

  function updateHeaderNav() {
    const nav = document.getElementById('header-nav');
    const userActions = document.getElementById('header-user-actions');
    const eventNameEl = document.getElementById('header-event-name');
    if (!nav || !userActions) return;

    const user = state.user;
    const isAuthed = user && user.role && user.role !== 'visitor';
    const events = state.events || [];
    const activeEvt = events.find(e => e.id === state.activeEventId) || events[0];

    // 1. Render Event Context Switcher in Brand Meta
    if (eventNameEl) {
      const evtDisplayName = activeEvt ? activeEvt.name : 'Hackathon Platform';
      eventNameEl.innerHTML = `
        <div class="event-switcher-wrapper">
          <button class="event-switcher-btn" id="event-switcher-btn" type="button" aria-haspopup="true">
            <span>${escapeHtml(evtDisplayName)}</span>
            <span class="mono text-xs text-muted">▾</span>
          </button>
          <div class="event-dropdown-menu" id="event-dropdown-menu" style="display:none;">
            <div class="event-dropdown-header">Active Hackathons</div>
            <div id="event-dropdown-items-list">
              ${events.map(e => `
                <button type="button" class="event-dropdown-item ${e.id === (activeEvt ? activeEvt.id : '') ? 'active' : ''}" data-event-id="${escapeHtml(e.id)}">
                  <span class="event-item-title">${escapeHtml(e.name)}</span>
                  <div class="event-item-meta">
                    <span class="badge ${e.status === 'RESULTS_RELEASED' ? 'badge-primary' : (e.status === 'JUDGING' ? 'badge-warning' : 'badge-success')}">
                      ${escapeHtml(e.status.replace(/_/g, ' '))}
                    </span>
                    <span>${e.stats ? e.stats.projects_count : 0} projects</span>
                  </div>
                </button>
              `).join('')}
            </div>
            <div class="event-dropdown-footer">
              <button type="button" class="btn btn-primary btn-sm w-full" id="btn-dropdown-host-event">
                + Host a Hackathon
              </button>
            </div>
          </div>
        </div>
      `;

      const switcherBtn = document.getElementById('event-switcher-btn');
      const dropdownMenu = document.getElementById('event-dropdown-menu');
      if (switcherBtn && dropdownMenu) {
        switcherBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.style.display = dropdownMenu.style.display === 'none' ? 'flex' : 'none';
        });
      }

      dropdownMenu.querySelectorAll('.event-dropdown-item').forEach(item => {
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          const targetId = item.getAttribute('data-event-id');
          dropdownMenu.style.display = 'none';
          setActiveEvent(targetId);
        });
      });

      const btnHostDropdown = document.getElementById('btn-dropdown-host-event');
      if (btnHostDropdown) {
        btnHostDropdown.addEventListener('click', (e) => {
          e.stopPropagation();
          dropdownMenu.style.display = 'none';
          showCreateHackathonModal();
        });
      }
    }

    // 2. Populate navigation links based on context
    if (isAuthed) {
      nav.innerHTML = `
        <button class="nav-link ${state.currentView === user.role ? 'active' : ''}" id="nav-workspace-btn">
          My Workspace
        </button>
        <button class="nav-link ${state.currentView === 'public' ? 'active' : ''}" id="nav-gallery-btn">
          Public Showcase
        </button>
        <button class="nav-link" id="nav-host-btn">
          + Host Hackathon
        </button>
      `;

      const wsBtn = document.getElementById('nav-workspace-btn');
      if (wsBtn) wsBtn.addEventListener('click', () => navigateTo(user.role));

      const glBtn = document.getElementById('nav-gallery-btn');
      if (glBtn) glBtn.addEventListener('click', () => navigateTo('public'));

      const hostBtn = document.getElementById('nav-host-btn');
      if (hostBtn) hostBtn.addEventListener('click', showCreateHackathonModal);

      // Check if user is registered for current event
      const isMemberOfCurrent = activeEvt && (activeEvt.user_role || user.role === 'organizer' || user.role === 'judge');

      userActions.innerHTML = `
        <div class="flex items-center gap-3">
          ${!isMemberOfCurrent ? `
            <button class="btn btn-primary btn-sm" id="btn-header-register-event">
              Register for this Hackathon
            </button>
          ` : ''}
          <div class="user-identity-chip">
            <span class="user-name">${escapeHtml(user.name || user.email)}</span>
            <span class="role-tag ${escapeHtml(user.role)}">${escapeHtml(user.role)}</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-header-signout">Sign Out</button>
        </div>
      `;

      const btnReg = document.getElementById('btn-header-register-event');
      if (btnReg && activeEvt) {
        btnReg.addEventListener('click', async () => {
          try {
            const res = await api.registerForEvent(activeEvt.id);
            showToast(res.message || 'Successfully registered!', 'success');
            state.user.role = 'participant';
            navigateTo('participant');
          } catch (err) {
            showToast(err.message || 'Registration failed', 'error');
          }
        });
      }

      const btnSignOut = document.getElementById('btn-header-signout');
      if (btnSignOut) {
        btnSignOut.addEventListener('click', async () => {
          try {
            await api.logout();
            setState({ user: { role: 'visitor' } });
            showToast('Signed out of workspace', 'info');
            navigateTo('public');
          } catch (err) {
            showToast(err.message || 'Error signing out', 'error');
          }
        });
      }
    } else {
      nav.innerHTML = `
        <a href="#projects-showcase" class="nav-link public-anchor" data-target="projects-showcase">Projects</a>
        <a href="#tracks-section" class="nav-link public-anchor" data-target="tracks-section">Tracks</a>
        <a href="#how-judging-works" class="nav-link public-anchor" data-target="how-judging-works">How Judging Works</a>
        <a href="#integrity-section" class="nav-link public-anchor" data-target="integrity-section">Integrity</a>
      `;

      nav.querySelectorAll('.public-anchor').forEach(a => {
        a.addEventListener('click', (e) => {
          e.preventDefault();
          const targetId = a.getAttribute('data-target');
          if (state.currentView !== 'public') {
            navigateTo('public');
            setTimeout(() => {
              const el = document.getElementById(targetId);
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }, 100);
          } else {
            const el = document.getElementById(targetId);
            if (el) el.scrollIntoView({ behavior: 'smooth' });
          }
        });
      });

      userActions.innerHTML = `
        <button class="btn btn-secondary btn-sm" id="btn-header-host-guest">+ Host Hackathon</button>
        ${state.currentView === 'login' ? `
          <button class="btn btn-secondary btn-sm" id="btn-header-public">Back to Showcase</button>
        ` : `
          <button class="btn btn-primary btn-sm" id="btn-header-signin">Sign In</button>
        `}
      `;

      const btnHostGuest = document.getElementById('btn-header-host-guest');
      if (btnHostGuest) {
        btnHostGuest.addEventListener('click', showCreateHackathonModal);
      }

      const btnSignIn = document.getElementById('btn-header-signin');
      if (btnSignIn) btnSignIn.addEventListener('click', () => navigateTo('login'));

      const btnPublic = document.getElementById('btn-header-public');
      if (btnPublic) btnPublic.addEventListener('click', () => navigateTo('public'));
    }
  }

  function showCreateHackathonModal() {
    const isAuthed = state.user && state.user.role && state.user.role !== 'visitor';
    const twoWeeksOut = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 16);

    const wizardHtml = `
      <form id="create-hackathon-form">
        <p class="text-sm text-muted mb-4">
          Launch a complete, self-contained hackathon with custom tracks, weighted judging rubric, and automated verification.
        </p>

        ${!isAuthed ? `
          <!-- Organizer Information (for visitors / new hosts) -->
          <div class="p-3 mb-4 rounded border" style="background: rgba(99, 102, 241, 0.08); border-color: rgba(99, 102, 241, 0.25);">
            <div class="flex items-center justify-between mb-2">
              <span class="text-xs font-bold uppercase tracking-wider text-accent">Host & Organizer Account</span>
              <button type="button" class="btn btn-secondary btn-xs flex items-center gap-1" id="btn-wizard-google-signin">
                <svg width="12" height="12" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.66-5.17 3.66-9.09z"/>
                  <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.1C3.27 21.46 7.35 24 12 24z"/>
                  <path fill="#FBBC05" d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.58H1.25C.45 8.17 0 9.98 0 12s.45 3.83 1.25 5.42l4.03-3.1z"/>
                  <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.54 1.25 6.58l4.03 3.1c.95-2.83 3.6-4.93 6.72-4.93z"/>
                </svg>
                <span>Sign in with Google</span>
              </button>
            </div>
            <div class="grid grid-cols-2 gap-3 mb-2">
              <div>
                <label class="form-label text-xs" for="wizard-org-name">Your Full Name *</label>
                <input type="text" id="wizard-org-name" class="form-input" required placeholder="e.g. Abhinav Reddy" value="${state.user?.name && state.user.name !== 'Guest Explorer' ? escapeHtml(state.user.name) : ''}">
              </div>
              <div>
                <label class="form-label text-xs" for="wizard-org-email">Your Email Address *</label>
                <input type="email" id="wizard-org-email" class="form-input" required placeholder="name@domain.com" value="${state.user?.email && !state.user.email.includes('samplehack.org') ? escapeHtml(state.user.email) : ''}">
              </div>
            </div>
            <p class="text-xs text-muted">You will automatically be registered as the Lead Organizer with full access to the Command Center.</p>
          </div>
        ` : `
          <div class="p-2 mb-3 rounded border text-xs flex items-center justify-between" style="background: var(--bg-surface);">
            <span>Hosting as: <strong>${escapeHtml(state.user.name || state.user.email)}</strong></span>
            <span class="badge badge-primary">Lead Organizer</span>
          </div>
        `}

        <div class="form-group mb-3">
          <label class="form-label" for="wizard-event-name">Hackathon Name *</label>
          <input type="text" id="wizard-event-name" class="form-input" required placeholder="E.g. Global Agentic Hackathon 2026" minlength="3">
        </div>

        <div class="form-group mb-3">
          <label class="form-label" for="wizard-event-desc">Event Mission & Overview</label>
          <textarea id="wizard-event-desc" class="form-textarea" rows="2" placeholder="Building the next generation of verifiable autonomous software and open protocols..."></textarea>
        </div>

        <div class="form-group mb-4">
          <label class="form-label" for="wizard-event-deadline">Submissions Deadline *</label>
          <input type="datetime-local" id="wizard-event-deadline" class="form-input" required value="${twoWeeksOut}">
          <span class="text-xs text-muted mt-1">Deadlines are enforced on the backend. Submissions after this date are strictly rejected.</span>
        </div>

        <div class="border-t pt-3 mb-4">
          <label class="form-label mb-2">Default Competition Tracks</label>
          <div class="flex flex-col gap-2">
            <div class="p-2 rounded border text-xs" style="background: var(--bg-surface);">
              <strong>Track 1: Autonomous Systems & Agents</strong> — Cognitive loops, reasoning agents, and tools
            </div>
            <div class="p-2 rounded border text-xs" style="background: var(--bg-surface);">
              <strong>Track 2: Developer Tools & Infrastructure</strong> — Compilers, debugging harnesses, and open protocols
            </div>
            <div class="p-2 rounded border text-xs" style="background: var(--bg-surface);">
              <strong>Track 3: Open Innovation</strong> — Moonshot applications pushing creative boundaries
            </div>
          </div>
        </div>

        <div class="border-t pt-3 mb-4">
          <label class="form-label mb-2">Authoritative Judging Rubric</label>
          <div class="flex gap-2 text-xs flex-wrap">
            <span class="badge badge-primary">Technical Execution (40%)</span>
            <span class="badge badge-primary">Innovation (35%)</span>
            <span class="badge badge-primary">Practical Utility (25%)</span>
          </div>
        </div>

        <div class="flex justify-end gap-3 border-t pt-4">
          <button type="button" class="btn btn-secondary" onclick="window.Judgely.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-create-event">🚀 Launch Hackathon</button>
        </div>
      </form>
    `;

    openModal('Host a Hackathon on Judgely', wizardHtml);

    const btnWizardGoogle = document.getElementById('btn-wizard-google-signin');
    if (btnWizardGoogle) {
      btnWizardGoogle.addEventListener('click', () => {
        closeModal();
        if (window.Judgely.views.login && window.Judgely.views.login.openGoogleAccountChooser) {
          window.Judgely.views.login.openGoogleAccountChooser();
        }
      });
    }

    const form = document.getElementById('create-hackathon-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-submit-create-event');
        if (submitBtn) submitBtn.disabled = true;

        const name = document.getElementById('wizard-event-name').value.trim();
        const description = document.getElementById('wizard-event-desc').value.trim();
        const deadline = document.getElementById('wizard-event-deadline').value;

        const payload = {
          name,
          description,
          submissions_close: new Date(deadline).toISOString()
        };

        if (!isAuthed) {
          const orgNameInput = document.getElementById('wizard-org-name');
          const orgEmailInput = document.getElementById('wizard-org-email');
          if (orgNameInput && orgEmailInput) {
            payload.organizer_name = orgNameInput.value.trim();
            payload.organizer_email = orgEmailInput.value.trim();
          }
        }

        try {
          const res = await api.createEvent(payload);

          showToast('Hackathon created successfully! Welcome to your operations center.', 'success');
          closeModal();

          if (res.user) {
            state.user = res.user;
            localStorage.setItem('judgely_session_user', JSON.stringify(res.user));
          } else if (state.user) {
            state.user.role = 'organizer';
          }

          // Refresh events directory
          const eventsRes = await api.getEvents();
          if (eventsRes && eventsRes.events) {
            setState({ events: eventsRes.events });
          }

          // Switch active event to new hackathon
          state.activeEventId = res.event.id;
          localStorage.setItem('judgely_active_event_id', res.event.id);

          navigateTo('organizer');
        } catch (err) {
          if (submitBtn) submitBtn.disabled = false;
          showToast(err.message || 'Failed to create hackathon', 'error');
        }
      });
    }
  }

  function onStateChange() {
    updateHeaderNav();
  }

  function onLoginSuccess(user) {
    setState({ user });
    if (user.role === 'visitor') {
      navigateTo('public');
    } else {
      navigateTo(user.role);
    }
  }

  function bindModalSystem() {
    const backdrop = document.getElementById('modal-backdrop');
    const closeBtn = document.getElementById('modal-close-btn');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => window.Judgely.closeModal());
    }

    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          window.Judgely.closeModal();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.Judgely.closeModal();
      }
    });
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.navigateTo = navigateTo;
  window.Judgely.onLoginSuccess = onLoginSuccess;
  window.Judgely.setActiveEvent = setActiveEvent;
  window.Judgely.showCreateHackathonModal = showCreateHackathonModal;

  // Boot on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
