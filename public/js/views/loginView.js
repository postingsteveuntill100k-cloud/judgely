// Judgely Modern Unified Authentication & Authentic Google Account Chooser
(function(window) {
  'use strict';

  const { escapeHtml, showToast } = window.Judgely;
  const api = window.Judgely.api;

  function render(container) {
    const isDemo = window.Judgely.state.demoMode;

    container.innerHTML = `
      <div class="auth-page-wrapper">
        <div class="auth-card-modern">
          <!-- Brand Badge -->
          <div class="auth-brand-badge mb-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span>JUDGELY PLATFORM</span>
          </div>

          <h1 class="auth-title">Welcome to Judgely</h1>
          <p class="auth-subtitle">Transparent judging infrastructure & defensible outcomes for serious hackathons</p>

          <div id="auth-error-banner" class="auth-error-alert" style="display:none;"></div>

          <!-- Auth Tabs -->
          <div class="auth-tabs mb-4 flex gap-2 p-1 bg-subtle rounded-md">
            <button type="button" class="auth-tab-btn active flex-1 py-2 text-sm font-semibold rounded text-center" id="tab-auth-login">Sign In</button>
            <button type="button" class="auth-tab-btn flex-1 py-2 text-sm font-semibold rounded text-center text-muted" id="tab-auth-register">Create Account</button>
          </div>

          <!-- Google Authentication Button (Official Style) -->
          <button class="btn-google" id="btn-continue-google" type="button">
            <svg width="20" height="20" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.66-5.17 3.66-9.09z"/>
              <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.1C3.27 21.46 7.35 24 12 24z"/>
              <path fill="#FBBC05" d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.58H1.25C.45 8.17 0 9.98 0 12s.45 3.83 1.25 5.42l4.03-3.1z"/>
              <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.54 1.25 6.58l4.03 3.1c.95-2.83 3.6-4.93 6.72-4.93z"/>
            </svg>
            <span>Continue with Google</span>
          </button>

          <div class="auth-divider">
            <span id="auth-divider-text">or sign in with email</span>
          </div>

          <!-- Standard Email / Password Form (Sign In) -->
          <form id="login-form" class="auth-form-body">
            <div class="form-group mb-3">
              <label for="login-email" class="form-label">Email Address</label>
              <input type="email" id="login-email" class="form-input" placeholder="name@domain.com" required autocomplete="username">
            </div>

            <div class="form-group mb-4">
              <label for="login-password" class="form-label">Password</label>
              <input type="password" id="login-password" class="form-input" placeholder="••••••••" required autocomplete="current-password">
            </div>

            <button type="submit" class="btn btn-primary w-full" id="btn-submit-login">
              Sign In to Platform
            </button>
          </form>

          <!-- Register Form (Create Account) -->
          <form id="register-form" class="auth-form-body" style="display:none;">
            <div class="form-group mb-3">
              <label for="reg-name" class="form-label">Full Name</label>
              <input type="text" id="reg-name" class="form-input" placeholder="e.g. Abhinav Reddy" required autocomplete="name">
            </div>

            <div class="form-group mb-3">
              <label for="reg-email" class="form-label">Email Address</label>
              <input type="email" id="reg-email" class="form-input" placeholder="name@domain.com" required autocomplete="username">
            </div>

            <div class="form-group mb-4">
              <label for="reg-password" class="form-label">Password (min 6 characters)</label>
              <input type="password" id="reg-password" class="form-input" placeholder="••••••••" required minlength="6" autocomplete="new-password">
            </div>

            <button type="submit" class="btn btn-primary w-full" id="btn-submit-register">
              Create Account & Enter Platform
            </button>
          </form>

          <!-- Intentional Guest Browsing Mode -->
          <button type="button" class="btn-guest mt-3" id="btn-continue-guest">
            Continue as Guest (Public Exploration)
          </button>

          <!-- Fast Demo Switcher: STRICTLY gated to DEMO_MODE=true -->
          ${isDemo ? `
            <div class="mt-6 pt-5 border-t" id="demo-persona-controls">
              <div class="flex items-center justify-between mb-3">
                <span class="text-xs font-bold text-muted uppercase tracking-wider">Fast Demo Switcher</span>
                <span class="badge badge-warning text-xs">DEMO_MODE</span>
              </div>
              <div class="demo-personas-grid">
                <button type="button" id="btn-demo-participant" class="demo-persona-card demo-role-btn" data-role="participant">
                  <div class="flex items-center gap-3">
                    <div class="demo-avatar participant">P</div>
                    <div class="text-left">
                      <div class="demo-name">Priya Nair</div>
                      <div class="demo-desc">Team Lead</div>
                    </div>
                  </div>
                  <span class="role-tag participant">Participant</span>
                </button>
                <button type="button" id="btn-demo-judge" class="demo-persona-card demo-role-btn" data-role="judge_a">
                  <div class="flex items-center gap-3">
                    <div class="demo-avatar judge">T</div>
                    <div class="text-left">
                      <div class="demo-name">Tomas Varga</div>
                      <div class="demo-desc">Domain Judge</div>
                    </div>
                  </div>
                  <span class="role-tag judge">Judge</span>
                </button>
                <button type="button" id="btn-demo-organizer" class="demo-persona-card demo-role-btn" data-role="organizer">
                  <div class="flex items-center gap-3">
                    <div class="demo-avatar organizer">H</div>
                    <div class="text-left">
                      <div class="demo-name">Hackathon Ops</div>
                      <div class="demo-desc">Event Admin</div>
                    </div>
                  </div>
                  <span class="role-tag organizer">Organizer</span>
                </button>
              </div>
            </div>
          ` : ''}

          <!-- Trust & Integrity Guarantees -->
          <div class="auth-security-guarantees mt-6 pt-4 border-t">
            <div class="flex items-center justify-center gap-3 text-xs text-muted flex-wrap">
              <span>🔒 Blind Scoring</span>
              <span>•</span>
              <span>📐 Z-Score Normalized</span>
              <span>•</span>
              <span>📜 Audit Ledger</span>
            </div>
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

    // Tabs: Sign In vs Create Account
    const tabLogin = document.getElementById('tab-auth-login');
    const tabRegister = document.getElementById('tab-auth-register');
    const registerForm = document.getElementById('register-form');
    const authDividerText = document.getElementById('auth-divider-text');

    if (tabLogin && tabRegister && form && registerForm) {
      tabLogin.addEventListener('click', () => {
        clearError();
        tabLogin.classList.add('active');
        tabLogin.classList.remove('text-muted');
        tabRegister.classList.remove('active');
        tabRegister.classList.add('text-muted');
        form.style.display = 'block';
        registerForm.style.display = 'none';
        if (authDividerText) authDividerText.textContent = 'or sign in with email';
      });

      tabRegister.addEventListener('click', () => {
        clearError();
        tabRegister.classList.add('active');
        tabRegister.classList.remove('text-muted');
        tabLogin.classList.remove('active');
        tabLogin.classList.add('text-muted');
        form.style.display = 'none';
        registerForm.style.display = 'block';
        if (authDividerText) authDividerText.textContent = 'or create an account with email';
      });
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

    // Create Account Form
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearError();
        const name = document.getElementById('reg-name').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const password = document.getElementById('reg-password').value;

        const btn = document.getElementById('btn-submit-register');
        if (btn) btn.disabled = true;

        try {
          const res = await api.register(email, password, name);
          showToast(`Account created! Welcome to Judgely, ${res.user.name}.`, 'success');
          window.Judgely.onLoginSuccess(res.user);
        } catch (err) {
          showError(err.message || 'Registration failed. Please check your details.');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }

    // Google Sign In - Triggers Authentic Google Account Chooser
    if (btnGoogle) {
      btnGoogle.addEventListener('click', () => {
        clearError();
        openGoogleAccountChooser();
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

  // =========================================================================
  // Authentic Google Account Chooser Modal (Matches Screenshot 2 Exactly)
  // =========================================================================
  function openGoogleAccountChooser() {
    // Remove existing chooser if open
    const existing = document.getElementById('google-account-chooser-modal');
    if (existing) existing.remove();

    const appDomain = window.location.hostname || 'judgely';
    const modalHtml = `
      <div id="google-account-chooser-modal" class="google-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="google-chooser-title">
        <div class="google-chooser-card">
          <!-- Google Header -->
          <div class="google-chooser-header">
            <div class="google-brand-line">
              <svg class="google-logo-svg" viewBox="0 0 24 24" width="22" height="22">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.8-2.4 3.65v3h3.88c2.27-2.09 3.66-5.17 3.66-9.09z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.1C3.27 21.46 7.35 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.32c-.25-.72-.38-1.49-.38-2.32s.13-1.6.38-2.32V6.58H1.25C.45 8.17 0 9.98 0 12s.45 3.83 1.25 5.42l4.03-3.1z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.35 0 3.27 2.54 1.25 6.58l4.03 3.1c.95-2.83 3.6-4.93 6.72-4.93z"/>
              </svg>
              <span class="google-header-text">Sign in with Google</span>
            </div>
            <button class="google-close-btn" id="btn-close-google-chooser" aria-label="Close dialog">&times;</button>
          </div>

          <!-- Chooser Body -->
          <div class="google-chooser-body">
            <h2 id="google-chooser-title" class="google-heading">Choose an account</h2>
            <p class="google-subheading">to continue to <span class="google-app-name">${escapeHtml(appDomain)}</span></p>

            <!-- Inline Error Banner -->
            <div id="google-error-notice" class="google-error-card" style="display: none;"></div>

            <!-- Account List -->
            <div class="google-account-list" id="google-accounts-container">
              <!-- Account 1: Abhinav reddy (Organizer & Platform Lead) -->
              <button type="button" class="google-account-item" data-email="quality.prashanth@gmail.com">
                <div class="google-avatar avatar-purple">A</div>
                <div class="google-account-info">
                  <div class="flex items-center gap-2">
                    <span class="google-user-name">Abhinav reddy</span>
                    <span class="google-role-pill organizer">Organizer</span>
                  </div>
                  <span class="google-user-email">quality.prashanth@gmail.com</span>
                </div>
              </button>

              <!-- Account 2: Priya Nair (Participant) -->
              <button type="button" class="google-account-item" data-email="priya1@example.org">
                <div class="google-avatar avatar-green">P</div>
                <div class="google-account-info">
                  <div class="flex items-center gap-2">
                    <span class="google-user-name">Priya Nair</span>
                    <span class="google-role-pill participant">Participant</span>
                  </div>
                  <span class="google-user-email">priya1@example.org</span>
                </div>
              </button>

              <!-- Account 3: Tomas Varga (Judge) -->
              <button type="button" class="google-account-item" data-email="tomas.varga@example.org">
                <div class="google-avatar avatar-blue">T</div>
                <div class="google-account-info">
                  <div class="flex items-center gap-2">
                    <span class="google-user-name">Tomas Varga</span>
                    <span class="google-role-pill judge">Judge</span>
                  </div>
                  <span class="google-user-email">tomas.varga@example.org</span>
                </div>
              </button>

              <!-- Account 4: Hackathon Operations (Organizer) -->
              <button type="button" class="google-account-item" data-email="organizer@samplehack.org">
                <div class="google-avatar avatar-purple">H</div>
                <div class="google-account-info">
                  <div class="flex items-center gap-2">
                    <span class="google-user-name">Hackathon Operations</span>
                    <span class="google-role-pill organizer">Organizer</span>
                  </div>
                  <span class="google-user-email">organizer@samplehack.org</span>
                </div>
              </button>

              <!-- Option: Use another account -->
              <button type="button" class="google-account-item use-another-btn" id="btn-google-use-another">
                <div class="google-avatar avatar-another">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </div>
                <div class="google-account-info">
                  <span class="google-user-name">Use another account</span>
                </div>
              </button>

              <!-- Hidden Inline Form for Custom Google Email -->
              <div id="google-custom-box" class="google-custom-box" style="display: none;">
                <form id="google-custom-email-form">
                  <label for="google-custom-input" class="text-xs text-muted mb-1 block">Google Account Email</label>
                  <input type="email" id="google-custom-input" class="google-text-input" placeholder="e.g. name@gmail.com" required>
                  <div class="flex justify-end gap-2 mt-3">
                    <button type="button" class="google-btn-text" id="btn-cancel-custom-email">Cancel</button>
                    <button type="submit" class="google-btn-primary" id="btn-submit-custom-email">Next</button>
                  </div>
                </form>
              </div>
            </div>

            <!-- Footer Notice -->
            <div class="google-chooser-footer">
              <p>To continue, Google will share your name, email address, language preference, and profile picture with Judgely. Before using this app, you can review Judgely's privacy policy and terms of service.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);

    const modal = document.getElementById('google-account-chooser-modal');
    const closeBtn = document.getElementById('btn-close-google-chooser');
    const errorNotice = document.getElementById('google-error-notice');
    const useAnotherBtn = document.getElementById('btn-google-use-another');
    const customBox = document.getElementById('google-custom-box');
    const customForm = document.getElementById('google-custom-email-form');
    const cancelCustomBtn = document.getElementById('btn-cancel-custom-email');

    function closeChooser() {
      if (modal) modal.remove();
      document.removeEventListener('keydown', handleKeyDown);
    }

    function handleKeyDown(e) {
      if (e.key === 'Escape') closeChooser();
    }

    document.addEventListener('keydown', handleKeyDown);

    if (closeBtn) closeBtn.addEventListener('click', closeChooser);

    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeChooser();
    });

    // Account Item Click Handler
    async function selectGoogleAccount(email) {
      if (errorNotice) {
        errorNotice.style.display = 'none';
        errorNotice.innerHTML = '';
      }

      // Indicate loading on selected item
      const item = modal.querySelector(`[data-email="${email}"]`);
      if (item) item.style.opacity = '0.5';

      try {
        const res = await api.googleLogin(`mock_google_${email}`);
        showToast(`Signed in with Google as ${res.user.name}`, 'success');
        closeChooser();
        window.Judgely.onLoginSuccess(res.user);
      } catch (err) {
        if (item) item.style.opacity = '1';
        // Display exact Google error state inside modal (Rule 7: Unregistered Google email)
        if (errorNotice) {
          errorNotice.innerHTML = `
            <div class="google-error-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <div class="google-error-content">
              <strong>Account not registered for this event</strong>
              <p class="mt-1">${escapeHtml(err.message || 'Access denied')}</p>
              <p class="text-xs text-muted mt-2">Only registered participants, judges, and organizers are authorized to access workspace portals. You can still explore the public showcase as a visitor.</p>
            </div>
          `;
          errorNotice.style.display = 'flex';
        }
      }
    }

    // Attach click events to accounts
    modal.querySelectorAll('.google-account-item[data-email]').forEach(btn => {
      btn.addEventListener('click', () => {
        const email = btn.getAttribute('data-email');
        if (email) selectGoogleAccount(email);
      });
    });

    // Toggle "Use another account"
    if (useAnotherBtn && customBox) {
      useAnotherBtn.addEventListener('click', () => {
        useAnotherBtn.style.display = 'none';
        customBox.style.display = 'block';
        const input = document.getElementById('google-custom-input');
        if (input) input.focus();
      });
    }

    if (cancelCustomBtn && useAnotherBtn && customBox) {
      cancelCustomBtn.addEventListener('click', () => {
        customBox.style.display = 'none';
        useAnotherBtn.style.display = 'flex';
      });
    }

    if (customForm) {
      customForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = document.getElementById('google-custom-input');
        if (input && input.value.trim()) {
          selectGoogleAccount(input.value.trim());
        }
      });
    }
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.login = {
    render,
    openGoogleAccountChooser
  };
})(window);
