/* Progressive enhancement only. Every page works with JavaScript disabled. */
(function () {
  'use strict';

  // --- mobile navigation ---------------------------------------------------
  document.querySelectorAll('[data-menu-toggle]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var nav = document.getElementById('primary-nav');
      if (!nav) return;
      var open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!open));
      btn.setAttribute('aria-expanded', String(!open));
    });
  });

  // --- account dropdown ----------------------------------------------------
  document.querySelectorAll('[data-menu-root]').forEach(function (root) {
    var trigger = root.querySelector('[data-menu-trigger]');
    if (!trigger) return;
    function close() {
      root.setAttribute('data-open', 'false');
      trigger.setAttribute('aria-expanded', 'false');
    }
    trigger.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = root.getAttribute('data-open') === 'true';
      root.setAttribute('data-open', String(!open));
      trigger.setAttribute('aria-expanded', String(!open));
    });
    document.addEventListener('click', function (e) {
      if (!root.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  });

  // --- confirm before a destructive submit ---------------------------------
  document.querySelectorAll('form[data-confirm]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // --- countdown -----------------------------------------------------------
  document.querySelectorAll('[data-countdown]').forEach(function (el) {
    var target = new Date(el.getAttribute('data-countdown')).getTime();
    var out = el.querySelector('[data-countdown-text]');
    if (!out || isNaN(target)) return;
    function tick() {
      var diff = target - Date.now();
      var past = diff < 0;
      var s = Math.floor(Math.abs(diff) / 1000);
      var d = Math.floor(s / 86400);
      var hh = Math.floor((s % 86400) / 3600);
      var mm = Math.floor((s % 3600) / 60);
      var ss = s % 60;
      var text = (d > 0 ? d + 'd ' : '') + (hh > 0 || d > 0 ? hh + 'h ' : '') + mm + 'm ' + ss + 's';
      out.textContent = past ? 'closed ' + text + ' ago' : text + ' left';
    }
    tick();
    setInterval(tick, 1000);
  });

  // --- slug preview --------------------------------------------------------
  var nameInput = document.querySelector('[data-slug-source]');
  var slugOut = document.querySelector('[data-slug-target]');
  if (nameInput && slugOut) {
    var update = function () {
      slugOut.textContent = nameInput.value
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'your-hackathon';
    };
    nameInput.addEventListener('input', update);
    update();
  }

  // --- copy to clipboard ---------------------------------------------------
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (!text) return;
      var done = function () {
        var old = btn.getAttribute('data-label') || btn.textContent;
        btn.setAttribute('data-label', old);
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = old; }, 1400);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        done();
      }
    });
  });

  // --- repeatable form rows (tracks, criteria, schedule, fields) -----------
  document.querySelectorAll('[data-repeat-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-repeat-add');
      var list = document.querySelector('[data-repeat-list="' + name + '"]');
      if (!list) return;
      var template = list.querySelector('[data-repeat-template]');
      if (!template) return;
      var index = list.querySelectorAll('[data-repeat-row]').length;
      var wrap = document.createElement('div');
      wrap.setAttribute('data-repeat-row', '');
      wrap.innerHTML = template.innerHTML.replace(/__INDEX__/g, String(index));
      list.appendChild(wrap);
      var first = wrap.querySelector('input, textarea, select');
      if (first) first.focus();
    });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-repeat-remove]');
    if (!btn) return;
    var row = btn.closest('[data-repeat-row]');
    if (row) row.remove();
  });

  // --- rubric weight total -------------------------------------------------
  function updateWeights() {
    var box = document.querySelector('[data-weight-total]');
    if (!box) return;
    var inputs = document.querySelectorAll('[data-weight-input]');
    var sum = 0;
    inputs.forEach(function (i) { sum += Number(i.value || 0); });
    var ok = Math.abs(sum) > 0.001 && Math.abs(sum - 100) < 0.001;
    var equal = Math.abs(sum) < 0.001;
    box.textContent = 'Weights total ' + (Math.round(sum * 100) / 100) + (ok ? ' — good.' : equal ? ' — equal weighting.' : ' — must be 100, or all zero.');
    box.className = ok || equal ? 'tag tag--ok' : 'tag tag--warn';
  }
  document.querySelectorAll('[data-weight-input]').forEach(function (i) { i.addEventListener('input', updateWeights); });
  updateWeights();

  // --- auto-submit filter selects ------------------------------------------
  document.querySelectorAll('[data-autosubmit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form && el.form.submit(); });
  });

  // --- Client session hydration for static deployments --------------------
  try {
    var savedUser = localStorage.getItem('hkl_user');
    if (savedUser) {
      var u = JSON.parse(savedUser);
      var headerActions = document.querySelector('.header-actions');
      if (headerActions && !document.querySelector('[data-menu-root]')) {
        var initial = (u.displayName || u.email || 'U').slice(0, 1).toUpperCase();
        var firstName = (u.displayName || u.email || 'User').split(' ')[0];
        headerActions.innerHTML =
          '<a class="btn btn--ghost btn--sm hide-sm" href="/dashboard">My dashboard</a>' +
          '<div class="menu" data-menu-root>' +
            '<button class="btn btn--quiet" type="button" data-menu-trigger aria-haspopup="true" aria-expanded="false" aria-label="Account menu">' +
              '<span class="avatar avatar--xs" style="background:var(--accent);color:#fff;font-weight:600;">' + initial + '</span>' +
              '<span class="hide-xs" style="font-weight:550;margin-left:6px;">' + firstName + '</span>' +
            '</button>' +
            '<div class="menu__panel" role="menu">' +
              '<div class="menu__header">' +
                '<div style="font-weight:600;font-size:.9rem">' + (u.displayName || firstName) + '</div>' +
                '<div class="tiny muted mono">' + (u.email || '@' + u.username) + '</div>' +
              '</div>' +
              '<a href="/dashboard" role="menuitem">Dashboard</a>' +
              '<a href="/teams" role="menuitem">My Teams</a>' +
              '<a href="/projects" role="menuitem">Showcase</a>' +
              '<hr>' +
              '<button type="button" id="client-logout-btn" role="menuitem" style="width:100%;text-align:left;background:none;border:none;padding:8px 12px;font:inherit;cursor:pointer;color:var(--danger,#dc3545);">Sign out</button>' +
            '</div>' +
          '</div>';
        var logoutBtn = document.getElementById('client-logout-btn');
        if (logoutBtn) {
          logoutBtn.addEventListener('click', function () {
            try { localStorage.removeItem('hkl_user'); localStorage.removeItem('hkl_session'); } catch (_) {}
            window.location.href = '/';
          });
        }
      }
    }
  } catch (e) {}

  // --- Firebase Google sign-in & Firestore Database -------------------------
  var cfgEl = document.querySelector('[data-firebase-config]');
  if (cfgEl) {
    var cfg;
    try { cfg = JSON.parse(cfgEl.textContent); } catch (err) { cfg = null; }

    if (cfg && cfg.apiKey) {
      var SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
      function load(url) {
        return import(/* webpackIgnore: true */ url);
      }

      var authCfg = {
        apiKey: cfg.apiKey,
        authDomain: cfg.authDomain || (window.location.host.indexOf('web.app') !== -1 ? window.location.host : (cfg.projectId ? cfg.projectId + '.firebaseapp.com' : 'iiuh-1bcee.firebaseapp.com')),
        projectId: cfg.projectId || 'iiuh-1bcee'
      };

      var dbCfg = {
        apiKey: cfg.dbApiKey || cfg.apiKey,
        projectId: cfg.dbProjectId || cfg.projectId || 'iiuh-1bcee'
      };

      Promise.all([
        load(SDK + '/firebase-app.js'),
        load(SDK + '/firebase-auth.js')
      ]).then(function (mods) {
        var appMod = mods[0];
        var authMod = mods[1];

        var authApp = appMod.getApps().find(function (a) { return a.name === '[DEFAULT]'; }) || appMod.initializeApp(authCfg);
        var auth = authMod.getAuth(authApp);

        function handleSuccessfulAuth(user) {
          var profile = {
            id: user.uid,
            uid: user.uid,
            email: user.email,
            displayName: user.displayName || (user.email ? user.email.split('@')[0] : 'Hacker'),
            username: user.email ? user.email.split('@')[0].replace(/[^a-zA-Z0-9_-]/g, '') : 'user_' + user.uid.slice(0, 6),
            photoURL: user.photoURL,
            role: 'participant'
          };
          try {
            localStorage.setItem('hkl_user', JSON.stringify(profile));
          } catch (_) {}

          return user.getIdToken()
            .then(function (idToken) {
              return fetch('/auth/firebase', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'fetch' },
                body: JSON.stringify({ idToken: idToken }),
              }).then(function (res) {
                if (res.ok) return res.json();
                return { redirect: '/dashboard' };
              }).catch(function () {
                return { redirect: '/dashboard' };
              });
            })
            .then(function (data) {
              window.location.href = data.redirect || '/dashboard';
            });
        }

        // Handle redirect result if user returned from signInWithRedirect
        authMod.getRedirectResult(auth).then(function (cred) {
          if (cred && cred.user) {
            handleSuccessfulAuth(cred.user);
          }
        }).catch(function (err) {
          console.warn('Redirect error:', err);
        });

        // Attach click listener for popup sign in
        document.querySelectorAll('[data-google-signin]').forEach(function (btn) {
          var original = btn.textContent;
          btn.addEventListener('click', function () {
            btn.disabled = true;
            btn.textContent = 'Opening Google…';
            var provider = new authMod.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            provider.addScope('email');
            provider.addScope('profile');

            authMod.signInWithPopup(auth, provider)
              .then(function (cred) {
                btn.textContent = 'Signing in…';
                return handleSuccessfulAuth(cred.user);
              })
              .catch(function (err) {
                btn.disabled = false;
                btn.textContent = original;
                var note = document.getElementById('google-error');
                if (note) {
                  note.style.display = 'block';
                  if (err && (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request')) {
                    note.innerHTML = '<strong>Sign-in notice:</strong> The popup window was closed before finishing. <a href="javascript:void(0)" id="btn-redirect-link" style="color:var(--accent);font-weight:600;margin-left:4px;">Click here to sign in with page redirect</a> or use the Quick Sign-In buttons below.';
                    var rlink = document.getElementById('btn-redirect-link');
                    if (rlink) {
                      rlink.addEventListener('click', function () {
                        authMod.signInWithRedirect(auth, provider);
                      });
                    }
                  } else if (err && err.code === 'auth/popup-blocked') {
                    note.innerHTML = '<strong>Popup blocked:</strong> Please allow popups or <a href="javascript:void(0)" id="btn-redirect-link" style="color:var(--accent);font-weight:600;margin-left:4px;">click here to sign in with redirect</a>.';
                    var rlink = document.getElementById('btn-redirect-link');
                    if (rlink) {
                      rlink.addEventListener('click', function () {
                        authMod.signInWithRedirect(auth, provider);
                      });
                    }
                  } else {
                    note.innerHTML = '<strong>Google Sign-In note:</strong> ' + (err && err.message ? err.message : 'The requested action is invalid') + '.<br><span style="margin-top:4px;display:block;">You can sign in immediately using the Quick Sign-In buttons below.</span>';
                  }
                }
              });
          });
        });
      }).catch(function (err) {
        console.warn('Firebase SDK load failed:', err);
      });
    }
  }

  // --- Persona quick-fill login --------------------------------------------
  document.querySelectorAll('[data-fill-creds]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var idInput = document.getElementById('identifier');
      var passInput = document.getElementById('password');
      if (idInput && passInput) {
        idInput.value = btn.getAttribute('data-fill-creds');
        passInput.value = btn.getAttribute('data-pass');
        var form = document.getElementById('signin-form') || btn.closest('.auth-card').querySelector('form');
        if (form) form.submit();
      }
    });
  });
})();


// --- judge score buttons & progress ---------------------------------------
(function () {
  function updateScoreProgress() {
    var total = document.querySelectorAll('[data-criterion]').length;
    var filled = 0;
    document.querySelectorAll('[data-criterion]').forEach(function (c) {
      var val = '';
      var hidden = c.querySelector('input[data-score-value]');
      if (hidden) val = hidden.value.trim();
      if (val !== '' && !isNaN(Number(val))) filled++;
    });
    var progEl = document.getElementById('criteria-progress-text');
    if (progEl) {
      progEl.textContent = 'Progress: ' + filled + ' / ' + total + ' criteria completed';
    }
  }

  document.querySelectorAll('[data-score-input]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var name = btn.getAttribute('data-score-input');
      var value = btn.getAttribute('data-value');
      var hidden = document.querySelector('[name="' + name + '"]');
      if (!hidden) return;
      var group = btn.closest('.score-row');
      group.querySelectorAll('[data-score-input]').forEach(function (b) {
        b.setAttribute('aria-pressed', 'false');
      });
      btn.setAttribute('aria-pressed', 'true');
      hidden.value = value;
      var criterion = btn.closest('[data-criterion]');
      if (criterion) {
        criterion.classList.remove('criterion--missing');
        var readout = group.querySelector('[data-score-readout]');
        var label = readout ? readout.textContent.split('/')[1].trim() : '';
        if (readout) readout.textContent = value + ' / ' + label;
        else {
          var tag = document.createElement('span');
          tag.className = 'tag';
          tag.setAttribute('data-score-readout', '');
          tag.textContent = value + ' / ' + label;
          group.appendChild(tag);
        }
      }
      updateScoreProgress();
    });
  });

  document.querySelectorAll('.score-number-input').forEach(function (input) {
    input.addEventListener('input', function () {
      var criterion = input.closest('[data-criterion]');
      if (criterion && input.value.trim() !== '') {
        criterion.classList.remove('criterion--missing');
      }
      updateScoreProgress();
    });
  });
})();

