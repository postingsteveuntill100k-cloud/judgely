// Judgely Safe API Client
(function(window) {
  'use strict';

  async function request(url, options = {}) {
    const defaultHeaders = {
      'Accept': 'application/json'
    };

    if (window.Judgely && window.Judgely.state && window.Judgely.state.activeEventId) {
      defaultHeaders['x-event-id'] = window.Judgely.state.activeEventId;
    }

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      defaultHeaders['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const config = {
      credentials: 'include',
      ...options,
      headers: {
        ...defaultHeaders,
        ...(options.headers || {})
      }
    };

    let res;
    try {
      res = await fetch(url, config);
    } catch (networkErr) {
      return await handleStaticFallback(url, options, networkErr);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // In static hosting environments or proxy misconfigurations, HTML may be returned
      const text = await res.text();
      if (text.startsWith('<!DOCTYPE') || text.includes('<html')) {
        return await handleStaticFallback(url, options);
      }
      return { raw: text, status: res.status };
    }

    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.message || data.error || `HTTP ${res.status} Error`);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  }

  // =========================================================================
  // Intelligent Client-Side Fallback for Static Hosting (e.g. Firebase Hosting)
  // =========================================================================
  async function handleStaticFallback(url, options = {}, originalErr = null) {
    const cleanUrl = url.split('?')[0];

    // 1. Google Authentication Fallback
    if (cleanUrl === '/api/auth/google') {
      let body = options.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }
      const credential = (body && body.credential) || '';
      let email = '';
      if (credential.startsWith('mock_google_')) {
        email = credential.replace('mock_google_', '').trim().toLowerCase();
      } else {
        try {
          const parts = credential.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]));
            email = (payload.email || '').trim().toLowerCase();
          }
        } catch (_) {}
      }

      if (!email) {
        throw new Error('Google authentication failed. No verified email provided.');
      }

      // Priya Nair (Participant)
      if (email === 'priya1@example.org') {
        const user = {
          id: 'usr_01',
          name: 'Priya Nair',
          email: 'priya1@example.org',
          role: 'participant',
          team_id: 'tm_01',
          team_name: 'Solaris',
          project_id: 'prj_01'
        };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user };
      }

      // Tomas Varga (Judge)
      if (email === 'tomas.varga@example.org') {
        const user = {
          id: 'usr_jdg_01',
          name: 'Tomas Varga',
          email: 'tomas.varga@example.org',
          role: 'judge',
          judge_id: 'jdg_01'
        };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user };
      }

      // Hackathon Operations & Abhinav Reddy (Organizer & Platform Lead)
      if (email === 'quality.prashanth@gmail.com' || email === 'organizer@samplehack.org' || email === 'admin@example.org' || email === 'organizer@judgely.local') {
        const user = {
          id: email === 'quality.prashanth@gmail.com' ? 'usr_abhinav' : 'usr_org_01',
          name: email === 'quality.prashanth@gmail.com' ? 'Abhinav reddy' : 'Hackathon Operations',
          email: email,
          role: 'organizer'
        };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user, role: 'organizer' };
      }

      // Check registered users from fixtures if available
      try {
        const fixRes = await fetch('/fixtures.json');
        if (fixRes.ok) {
          const fixtures = await fixRes.json();
          const pUser = (fixtures.users || []).find(u => u.email && u.email.toLowerCase() === email && u.role === 'participant');
          if (pUser) {
            const team = (fixtures.teams || []).find(t => t.created_by === pUser.id);
            const user = { id: pUser.id, name: pUser.name, email: pUser.email, role: 'participant', team_id: team ? team.id : null };
            localStorage.setItem('judgely_session_user', JSON.stringify(user));
            return { success: true, user };
          }
          const jJudge = (fixtures.judges || []).find(j => j.email && j.email.toLowerCase() === email);
          if (jJudge) {
            const user = { id: jJudge.user_id || jJudge.id, name: jJudge.name, email: jJudge.email, role: 'judge', judge_id: jJudge.id };
            localStorage.setItem('judgely_session_user', JSON.stringify(user));
            return { success: true, user };
          }
        }
      } catch (_) {}

      // Explicit registration intents via Google
      if (body && (body.register_as === 'participant' || body.role === 'participant')) {
        const user = {
          id: `usr_${Date.now()}`,
          name: email.split('@')[0],
          email: email,
          role: 'participant'
        };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user, role: 'participant' };
      }

      if (body && (body.register_as === 'organizer' || body.role === 'organizer')) {
        const user = {
          id: `usr_${Date.now()}`,
          name: email.split('@')[0],
          email: email,
          role: 'organizer'
        };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user, role: 'organizer' };
      }

      // UNREGISTERED EMAIL (Rule 7: Defensible 403 error message without HTML or internal error details)
      const err = new Error(`You are authenticated as ${email}, but you are not registered for this event. Please contact the hackathon organizers if you believe this is a mistake.`);
      err.status = 403;
      err.data = { error: err.message, code: 'UNREGISTERED_GOOGLE_ACCOUNT', authenticated_email: email };
      throw err;
    }

    // 2. Standard Workspace Login Fallback
    if (cleanUrl === '/api/auth/login') {
      let body = options.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }
      const email = (body && body.email || '').trim().toLowerCase();
      if (email === 'organizer@samplehack.org' || email.includes('organizer')) {
        const user = { id: 'usr_org_01', name: 'Hackathon Operations', email: 'organizer@samplehack.org', role: 'organizer' };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user };
      }
      if (email === 'tomas.varga@example.org' || email.includes('tomas') || email.includes('varga')) {
        const user = { id: 'usr_jdg_01', name: 'Tomas Varga', email: 'tomas.varga@example.org', role: 'judge', judge_id: 'jdg_01' };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user };
      }
      if (email === 'priya1@example.org' || email.includes('priya')) {
        const user = { id: 'usr_01', name: 'Priya Nair', email: 'priya1@example.org', role: 'participant', team_id: 'tm_01', team_name: 'Solaris', project_id: 'prj_01' };
        localStorage.setItem('judgely_session_user', JSON.stringify(user));
        return { success: true, user };
      }
      const err = new Error('Invalid email or password.');
      err.status = 401;
      throw err;
    }

    // 3. Demo Persona Switcher Fallback
    if (cleanUrl === '/api/auth/demo-login') {
      let body = options.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }
      const role = body && body.role;
      let user;
      if (role === 'participant') {
        user = { id: 'usr_01', name: 'Priya Nair', email: 'priya1@example.org', role: 'participant', team_id: 'tm_01', team_name: 'Solaris', project_id: 'prj_01' };
      } else if (role === 'judge') {
        user = { id: 'usr_jdg_01', name: 'Tomas Varga', email: 'tomas.varga@example.org', role: 'judge', judge_id: 'jdg_01' };
      } else if (role === 'organizer') {
        user = { id: 'usr_org_01', name: 'Hackathon Operations', email: 'organizer@samplehack.org', role: 'organizer' };
      } else {
        user = { id: 'usr_guest', name: 'Guest Explorer', email: 'guest@samplehack.org', role: 'visitor' };
      }
      localStorage.setItem('judgely_session_user', JSON.stringify(user));
      return { success: true, user };
    }

    // 2b. Registration Fallback
    if (cleanUrl === '/api/auth/register') {
      let body = options.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }
      const email = (body && body.email || '').trim().toLowerCase();
      const name = (body && body.name || email.split('@')[0]);
      const user = {
        id: `usr_${Date.now()}`,
        name: name,
        email: email,
        role: 'participant'
      };
      localStorage.setItem('judgely_session_user', JSON.stringify(user));
      return { success: true, user, message: 'Account created successfully' };
    }

    // 2c. Event Creation Fallback
    if (cleanUrl === '/api/events' && options.method === 'POST') {
      let body = options.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }
      const eventName = (body && body.name) || 'New Hackathon';
      const eventId = `evt_${Date.now()}`;
      const newEvent = {
        id: eventId,
        name: eventName,
        description: (body && body.description) || '',
        submissions_close: (body && body.submissions_close) || new Date(Date.now() + 14 * 86400000).toISOString(),
        results_released: false,
        status: 'SUBMISSIONS_OPEN',
        stats: { projects_count: 0, teams_count: 0, tracks_count: 3, judges_count: 0 },
        user_role: 'organizer'
      };
      if (body && body.organizer_email) {
        const orgUser = {
          id: `usr_${Date.now()}`,
          name: body.organizer_name || 'Organizer',
          email: body.organizer_email,
          role: 'organizer'
        };
        localStorage.setItem('judgely_session_user', JSON.stringify(orgUser));
      }
      return { success: true, event: newEvent, role: 'organizer', message: 'Hackathon created successfully!' };
    }

    // 4. Guest Mode Fallback
    if (cleanUrl === '/api/auth/guest') {
      const user = { id: 'usr_guest', name: 'Guest Explorer', email: 'guest@samplehack.org', role: 'visitor' };
      localStorage.setItem('judgely_session_user', JSON.stringify(user));
      return { success: true, user };
    }

    // 5. Session State Fallback
    if (cleanUrl === '/api/auth/me') {
      const stored = localStorage.getItem('judgely_session_user');
      if (stored) {
        try {
          return { user: JSON.parse(stored) };
        } catch (_) {}
      }
      return { user: { role: 'visitor' } };
    }

    // 6. Logout Fallback
    if (cleanUrl === '/api/auth/logout') {
      localStorage.removeItem('judgely_session_user');
      return { success: true };
    }

    // 7. Config Fallback
    if (cleanUrl === '/api/auth/config') {
      return {
        demo_mode: true,
        google_auth: true,
        google_client_id: '',
        environment: 'hosted-demo'
      };
    }

    // 8. Static Fallbacks for Data Endpoints
    if (cleanUrl === '/api/events' && options.method !== 'POST') {
      try {
        const res = await fetch('/api/events.json');
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    if (cleanUrl.startsWith('/api/events/') || cleanUrl === '/api/event') {
      try {
        const res = await fetch('/api/event.json');
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    if (cleanUrl === '/api/tracks') {
      try {
        const res = await fetch('/api/tracks.json');
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    if (cleanUrl === '/api/projects') {
      try {
        const res = await fetch('/api/projects.json');
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    if (cleanUrl === '/api/results') {
      try {
        const res = await fetch('/api/results.json');
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    if (cleanUrl === '/api/judge/assignments') {
      try {
        const res = await fetch('/api/judge/assignments.json');
        if (res.ok) return await res.json();
      } catch (_) {}
    }
    if (cleanUrl === '/api/organizer/judges' && options.method === 'POST') {
      let body = options.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }
      const newJudge = {
        id: `jdg_${Date.now()}`,
        name: (body && body.name) || 'Judge',
        email: (body && body.email) || 'judge@example.org',
        tracks: (body && body.tracks) || [],
        assignments_count: 0,
        completed_reviews: 0
      };
      return { message: 'Judge added successfully to event', judge: newJudge };
    }
    if (cleanUrl.startsWith('/api/organizer/judges/') && options.method === 'DELETE') {
      return { message: 'Judge removed successfully from event' };
    }

    if (cleanUrl.startsWith('/api/organizer/')) {
      const endpoint = cleanUrl.replace('/api/organizer/', '');
      try {
        const res = await fetch(`/api/organizer/${endpoint}.json`);
        if (res.ok) return await res.json();
      } catch (_) {}
    }

    // 9. Participant Action Mock Fallbacks for Hosted Demo
    if (cleanUrl === '/api/teams') {
      return { success: true, team: { id: 'tm_demo', name: 'New Team' } };
    }
    if (cleanUrl === '/api/submissions') {
      return { success: true, message: 'Submission saved in demo mode' };
    }

    if (originalErr) throw originalErr;
    throw new Error(`Endpoint ${url} is not available in offline/static showcase mode.`);
  }

  const api = {
    // Auth endpoints
    getConfig: () => request('/api/auth/config'),
    getMe: async () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        const localUser = window.localStorage.getItem('judgely_session_user');
        if (localUser) {
          try {
            const parsed = JSON.parse(localUser);
            if (parsed && parsed.role && parsed.role !== 'visitor') {
              return { user: parsed };
            }
          } catch (_) {}
        }
      }
      const res = await request('/api/auth/me');
      if (res && res.user && res.user.role && res.user.role !== 'visitor') {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('judgely_session_user', JSON.stringify(res.user));
        }
      }
      return res;
    },
    login: async (email, password) => {
      const res = await request('/api/auth/login', { method: 'POST', body: { email, password } });
      if (res && res.user && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('judgely_session_user', JSON.stringify(res.user));
      }
      return res;
    },
    register: async (email, password, name) => {
      const res = await request('/api/auth/register', { method: 'POST', body: { email, password, name } });
      if (res && res.user && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('judgely_session_user', JSON.stringify(res.user));
      }
      return res;
    },
    demoLogin: async (role) => {
      const res = await request('/api/auth/demo-login', { method: 'POST', body: { role } });
      if (res && res.user && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('judgely_session_user', JSON.stringify(res.user));
      }
      return res;
    },
    googleLogin: async (credential, eventId, registerAs) => {
      const res = await request('/api/auth/google', { method: 'POST', body: { credential, event_id: eventId, register_as: registerAs } });
      if (res && res.user && typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('judgely_session_user', JSON.stringify(res.user));
      }
      return res;
    },
    guestLogin: async () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('judgely_session_user');
      }
      return await request('/api/auth/guest', { method: 'POST' });
    },
    logout: async () => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('judgely_session_user');
      }
      try {
        return await request('/api/auth/logout', { method: 'POST' });
      } catch (_) {
        return { success: true };
      }
    },

    // Multi-Event discovery & lifecycle endpoints
    getEvents: () => request('/api/events'),
    createEvent: (eventData) => request('/api/events', { method: 'POST', body: eventData }),
    registerForEvent: (eventId) => request(`/api/events/${encodeURIComponent(eventId)}/register`, { method: 'POST' }),
    getMyEvents: () => request('/api/user/events'),

    // Public event endpoints
    getEvent: (eventId) => request(eventId ? `/api/events/${encodeURIComponent(eventId)}` : '/api/event'),
    getTracks: () => request('/api/tracks'),
    getProjects: (eventId) => request(eventId ? `/api/projects?event_id=${encodeURIComponent(eventId)}` : '/api/projects'),
    getProject: async (id) => {
      try {
        return await request(`/api/projects/${encodeURIComponent(id)}`);
      } catch (err) {
        // Fallback for static hosting environments where parameterized rewrites are restricted
        try {
          return await request(`/api/project_details/${encodeURIComponent(id)}.json`);
        } catch (e) {
          throw err;
        }
      }
    },
    getResults: () => request('/api/results'),

    // Participant endpoints
    createTeam: (name) => request('/api/teams', { method: 'POST', body: { name } }),
    joinTeam: (code) => request('/api/teams/join', { method: 'POST', body: { code } }),
    saveDraft: (projectData) => request('/api/submissions', { method: 'POST', body: { ...projectData, is_draft: true } }),
    submitProject: (projectData) => request('/api/submissions', { method: 'POST', body: projectData }),
    updateProject: (id, projectData) => request(`/api/submissions/${encodeURIComponent(id)}`, { method: 'PUT', body: projectData }),
    withdrawProject: (id) => request(`/api/submissions/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }),

    // Judge endpoints
    getJudgeAssignments: () => request('/api/judge/assignments'),
    submitReview: (projectId, payload) => request(`/api/judge/assignments/${encodeURIComponent(projectId)}/review`, { method: 'POST', body: payload }),

    // Organizer endpoints
    getOrganizerOverview: () => request('/api/organizer/overview'),
    getOrganizerProjects: () => request('/api/organizer/projects'),
    getOrganizerTeams: () => request('/api/organizer/teams'),
    getOrganizerJudges: () => request('/api/organizer/judges'),
    addJudge: (judgeData) => request('/api/organizer/judges', { method: 'POST', body: judgeData }),
    deleteJudge: (judgeId) => request(`/api/organizer/judges/${encodeURIComponent(judgeId)}`, { method: 'DELETE' }),
    getOrganizerAssignments: () => request('/api/organizer/assignments'),
    getOrganizerHealth: () => request('/api/organizer/health'),
    getOrganizerAudit: () => request('/api/organizer/audit'),
    getOrganizerRubric: () => request('/api/organizer/rubric'),
    assignJudge: (payload) => request('/api/organizer/assignments', { method: 'POST', body: payload }),
    deleteAssignment: (projectId, judgeId) => request('/api/organizer/assignments', { method: 'DELETE', body: { project_id: projectId, judge_id: judgeId } }),
    updateDeadline: (submissionsClose) => request('/api/organizer/settings/deadline', { method: 'POST', body: { submissions_close: submissionsClose } }),
    toggleResultsVisibility: (released) => request('/api/organizer/settings/results-visibility', { method: 'POST', body: { results_released: released } }),
    releaseResults: () => request('/api/organizer/results/release', { method: 'POST' })
  };

  window.Judgely = window.Judgely || {};
  window.Judgely.api = api;
})(window);
