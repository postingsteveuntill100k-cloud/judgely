// Judgely Safe API Client
(function(window) {
  'use strict';

  async function request(url, options = {}) {
    const defaultHeaders = {
      'Accept': 'application/json'
    };
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
      throw new Error(`Network failure connecting to Judgely server: ${networkErr.message}`);
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      // In static hosting environments or proxy misconfigurations, HTML may be returned
      const text = await res.text();
      if (text.startsWith('<!DOCTYPE') || text.includes('<html')) {
        throw new Error(`API endpoint ${url} returned HTML instead of JSON. Ensure the Express backend is running and reachable.`);
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

  const api = {
    // Auth endpoints
    getConfig: () => request('/api/auth/config'),
    getMe: () => request('/api/auth/me'),
    login: (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } }),
    demoLogin: (role) => request('/api/auth/demo-login', { method: 'POST', body: { role } }),
    googleLogin: (credential, eventId) => request('/api/auth/google', { method: 'POST', body: { credential, event_id: eventId } }),
    guestLogin: () => request('/api/auth/guest', { method: 'POST' }),
    logout: () => request('/api/auth/logout', { method: 'POST' }),

    // Public event endpoints
    getEvent: () => request('/api/event'),
    getTracks: () => request('/api/tracks'),
    getProjects: () => request('/api/projects'),
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
    submitProject: (projectData) => request('/api/submissions', { method: 'POST', body: projectData }),
    updateProject: (id, projectData) => request(`/api/submissions/${encodeURIComponent(id)}`, { method: 'PUT', body: projectData }),
    withdrawProject: (id) => request(`/api/submissions/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }),

    // Judge endpoints
    getJudgeAssignments: () => request('/api/judge/assignments'),
    submitReview: (projectId, payload) => request(`/api/judge/assignments/${encodeURIComponent(projectId)}/review`, { method: 'POST', body: payload }),

    // Organizer endpoints
    getOrganizerOverview: () => request('/api/organizer/overview'),
    getOrganizerProjects: () => request('/api/organizer/projects'),
    getOrganizerJudges: () => request('/api/organizer/judges'),
    getOrganizerAssignments: () => request('/api/organizer/assignments'),
    getOrganizerHealth: () => request('/api/organizer/health'),
    getOrganizerAudit: () => request('/api/organizer/audit'),
    assignJudge: (payload) => request('/api/organizer/assignments', { method: 'POST', body: payload }),
    releaseResults: () => request('/api/organizer/results/release', { method: 'POST' })
  };

  window.Judgely = window.Judgely || {};
  window.Judgely.api = api;
})(window);
