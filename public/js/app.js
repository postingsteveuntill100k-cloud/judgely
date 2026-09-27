// Judgely Main Application Orchestrator & Router
(function(window) {
  'use strict';

  const { state, setState, escapeHtml, showToast } = window.Judgely;
  const api = window.Judgely.api;

  async function init() {
    // 1. Bind global header branding and modal system immediately
    bindHeaderNavigation();
    bindModalSystem();

    // 2. Render initial view immediately based on URL pathname or current role
    routeFromLocation();

    // 3. Subscribe to state changes to keep header updated
    window.Judgely.subscribe(onStateChange);

    // 4. Fetch server runtime configuration and session identity in parallel
    try {
      const [configRes, meRes] = await Promise.allSettled([
        api.getConfig(),
        api.getMe()
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

      if (meRes.status === 'fulfilled' && meRes.value && meRes.value.user) {
        const user = meRes.value.user;
        if (user.role && user.role !== 'visitor') {
          setState({ user });
          // If user is at root showcase, transition to their role workspace
          if (window.location.pathname === '/' || window.location.pathname === '/login') {
            navigateTo(user.role);
          }
        }
      }
    } catch (e) {
      console.warn('Could not complete background auth sync:', e.message);
    }
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
  }

  function updateHeaderNav() {
    const nav = document.getElementById('header-nav');
    const userActions = document.getElementById('header-user-actions');
    if (!nav || !userActions) return;

    const user = state.user;
    const isAuthed = user && user.role && user.role !== 'visitor';

    // Populate navigation links based on context
    if (isAuthed) {
      nav.innerHTML = `
        <button class="nav-link ${state.currentView === user.role ? 'active' : ''}" id="nav-workspace-btn">
          My Workspace
        </button>
        <button class="nav-link ${state.currentView === 'public' ? 'active' : ''}" id="nav-gallery-btn">
          Public Showcase
        </button>
      `;

      const wsBtn = document.getElementById('nav-workspace-btn');
      if (wsBtn) wsBtn.addEventListener('click', () => navigateTo(user.role));

      const glBtn = document.getElementById('nav-gallery-btn');
      if (glBtn) glBtn.addEventListener('click', () => navigateTo('public'));

      userActions.innerHTML = `
        <div class="flex items-center gap-3">
          <div class="user-identity-chip">
            <span class="user-name">${escapeHtml(user.name || user.email)}</span>
            <span class="role-tag ${escapeHtml(user.role)}">${escapeHtml(user.role)}</span>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-header-signout">Sign Out</button>
        </div>
      `;

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
        ${state.currentView === 'login' ? `
          <button class="btn btn-secondary btn-sm" id="btn-header-public">Back to Showcase</button>
        ` : `
          <button class="btn btn-primary btn-sm" id="btn-header-signin">Sign In</button>
        `}
      `;

      const btnSignIn = document.getElementById('btn-header-signin');
      if (btnSignIn) btnSignIn.addEventListener('click', () => navigateTo('login'));

      const btnPublic = document.getElementById('btn-header-public');
      if (btnPublic) btnPublic.addEventListener('click', () => navigateTo('public'));
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

  // Boot on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
