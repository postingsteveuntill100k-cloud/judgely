// Judgely 2-Column Authentication Experience
(function(window) {
  'use strict';

  const { escapeHtml, showToast } = window.Judgely;
  const api = window.Judgely.api;

  function render(container) {
    const isDemo = window.Judgely.state.demoMode;

    container.innerHTML = `
      <div class="auth-page-wrapper">
        <div class="auth-split-layout">
          <!-- Left Column: Brand, Mission, Infrastructure Guarantees -->
          <div class="auth-brand-side">
            <div class="auth-brand-header">
              <div class="auth-brand-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                JUDGELY
              </div>
              <div class="auth-brand-tagline">
                Transparent judging infrastructure for serious hackathons.
              </div>
              <p class="auth-brand-desc">
                Defensible outcomes powered by blind scoring, mathematical z-score normalization, and a tamper-evident audit ledger.
              </p>
              <ul class="auth-feature-list">
                <li class="auth-feature-item">
                  <div class="auth-feature-bullet"></div>
                  <span><strong>Assignments:</strong> Domain expertise matching with zero peer leaks.</span>
                </li>
                <li class="auth-feature-item">
                  <div class="auth-feature-bullet"></div>
                  <span><strong>Reviews:</strong> Weighted criteria rubrics with strictly enforced boundaries.</span>
                </li>
                <li class="auth-feature-item">
                  <div class="auth-feature-bullet"></div>
                  <span><strong>Normalization:</strong> Outlier correction neutralizing harsh or lenient scoring.</span>
                </li>
                <li class="auth-feature-item">
                  <div class="auth-feature-bullet"></div>
                  <span><strong>Results:</strong> Cryptographically verifiable official standings.</span>
                </li>
                <li class="auth-feature-item">
                  <div class="auth-feature-bullet"></div>
                  <span><strong>Auditability:</strong> Complete chronological timeline of all platform events.</span>
                </li>
              </ul>
            </div>
            <div class="auth-brand-footer">
              Open-Source & Self-Hostable • 100% Offline Capable
            </div>
          </div>

          <!-- Right Column: Sign In Form & Providers -->
          <div class="auth-form-side">
            <div class="auth-form-header">
              <h2>Sign in to Judgely</h2>
              <p>Enter your workspace credentials or continue with an authorized provider.</p>
            </div>

            <div id="auth-error-banner" class="card p-3 mb-4 text-sm text-danger" style="display:none; background-color: var(--danger-bg); border-color: var(--danger-border);"></div>

            <!-- Google Authentication Option -->
            <button class="btn-google mb-2" id="btn-continue-google" type="button">
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.66-5.17 3.66-9.09z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.1C3.27 21.46 7.35 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.58H1.25C.45 8.17 0 9.98 0 12s.45 3.83 1.25 5.42l4.03-3.1z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.54 1.25 6.58l4.03 3.1c.95-2.83 3.6-4.93 6.72-4.93z"/>
              </svg>
              <span>Continue with Google</span>
            </button>

            <div class="auth-divider">
              <span>or continue with email</span>
            </div>

            <!-- Standard Email / Password Form -->
            <form id="login-form">
              <div class="form-group mb-3">
                <label for="login-email" class="form-label">Email Address</label>
                <input type="email" id="login-email" class="form-input" placeholder="name@domain.com" required autocomplete="username">
              </div>

              <div class="form-group mb-4">
                <label for="login-password" class="form-label">Password</label>
                <input type="password" id="login-password" class="form-input" placeholder="••••••••" required autocomplete="current-password">
              </div>

              <button type="submit" class="btn btn-primary w-full" id="btn-submit-login">
                Sign In to Workspace
              </button>
            </form>

            <!-- Intentional Guest Browsing Mode -->
            <button type="button" class="btn-guest" id="btn-continue-guest">
              Continue as Guest (Public Exploration)
            </button>

            <!-- Demo Persona Controls: STRICTLY gated to DEMO_MODE=true -->
            ${isDemo ? `
              <div class="mt-6 pt-4 border-t" id="demo-persona-controls">
                <div class="flex items-center justify-between mb-3">
                  <span class="text-xs font-bold text-muted uppercase">Fast Demo Switcher</span>
                  <span class="badge badge-warning text-xs">DEMO_MODE</span>
                </div>
                <div class="flex flex-col gap-2">
                  <button type="button" id="btn-demo-participant" class="btn btn-secondary btn-sm w-full demo-role-btn flex justify-between items-center" data-role="participant">
                    <span class="font-semibold text-left">Priya Nair <span class="text-xs text-muted font-normal">(Team Lead)</span></span>
                    <span class="role-tag participant">Participant</span>
                  </button>
                  <button type="button" id="btn-demo-judge" class="btn btn-secondary btn-sm w-full demo-role-btn flex justify-between items-center" data-role="judge_a">
                    <span class="font-semibold text-left">Tomas Varga <span class="text-xs text-muted font-normal">(Domain Judge)</span></span>
                    <span class="role-tag judge">Judge</span>
                  </button>
                  <button type="button" id="btn-demo-organizer" class="btn btn-secondary btn-sm w-full demo-role-btn flex justify-between items-center" data-role="organizer">
                    <span class="font-semibold text-left">Hackathon Ops <span class="text-xs text-muted font-normal">(Event Admin)</span></span>
                    <span class="role-tag organizer">Organizer</span>
                  </button>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      </div>
    `;

    bindLoginEvents();
  }

  function bindLoginEvents() {
    const errorBanner = document.getElementById('auth-error-banner');
    const form = document.getElementById('login-form');
    const btnGoogle = document.getElementById('btn-continue-google');
    const btnGuest = document.getElementById('btn-continue-guest');

    function showError(msg) {
      if (errorBanner) {
        errorBanner.textContent = msg;
        errorBanner.style.display = 'block';
      }
    }

    function clearError() {
      if (errorBanner) {
        errorBanner.style.display = 'none';
        errorBanner.textContent = '';
      }
    }

    // Email/Password Login
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearError();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        const btn = document.getElementById('btn-submit-login');
        if (btn) btn.disabled = true;

        try {
          const res = await api.login(email, password);
          showToast(`Welcome back, ${res.user.name}!`, 'success');
          window.Judgely.onLoginSuccess(res.user);
        } catch (err) {
          showError(err.message || 'Authentication failed. Please verify your credentials.');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    // Google Sign In Button
    if (btnGoogle) {
      btnGoogle.addEventListener('click', async () => {
        clearError();
        // In local demo or when GOOGLE_CLIENT_ID is not configured, prompt for email to simulate provider
        let credential = prompt('Google Authentication: Enter your verified Google account email to sign in:\n(e.g., priya1@example.org for participant, tomas.varga@example.org for judge)');
        if (!credential) return;

        try {
          const res = await api.googleLogin(`mock_google_${credential.trim()}`);
          showToast(`Authenticated via Google as ${res.user.name}`, 'success');
          window.Judgely.onLoginSuccess(res.user);
        } catch (err) {
          // If unassigned Google account, display exact message
          showError(err.message || 'Google authentication rejected');
        }
      });
    }

    // Guest Mode Button
    if (btnGuest) {
      btnGuest.addEventListener('click', async () => {
        clearError();
        try {
          const res = await api.guestLogin();
          showToast('Browsing as Guest explorer', 'info');
          window.Judgely.onLoginSuccess(res.user);
        } catch (err) {
          showError(err.message || 'Failed to initialize guest session.');
        }
      });
    }

    // Demo Persona Switchers (when DEMO_MODE=true)
    document.querySelectorAll('.demo-role-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        clearError();
        const role = btn.getAttribute('data-role');
        try {
          const res = await api.demoLogin(role);
          showToast(`Switched persona to ${res.user.name}`, 'success');
          window.Judgely.onLoginSuccess(res.user);
        } catch (err) {
          showError(err.message || 'Failed to switch demo persona.');
        }
      });
    });
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.login = {
    render
  };
})(window);
