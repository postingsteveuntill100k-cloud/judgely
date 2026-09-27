// Judgely Participant Workspace & Team Submission View
(function(window) {
  'use strict';

  const { escapeHtml, sanitizeUrl, openModal, closeModal, showToast } = window.Judgely;
  const api = window.Judgely.api;

  let participantData = null;

  async function render(container) {
    const user = window.Judgely.state.user;

    container.innerHTML = `
      <div class="container py-8">
        <!-- Participant Top Bar -->
        <div class="flex justify-between items-center mb-6">
          <div>
            <span class="badge badge-primary mb-1">Participant Workspace</span>
            <h1 class="text-2xl font-bold">Welcome, ${escapeHtml(user.name || 'Participant')}</h1>
          </div>
          <div class="text-right">
            <span class="text-xs text-muted">Signed in as</span>
            <div class="font-semibold text-sm">${escapeHtml(user.email || '')}</div>
          </div>
        </div>

        <!-- Hackathon Roadmap Stepper -->
        <div class="card p-6 mb-8">
          <h3 class="font-bold mb-4">Hackathon Roadmap</h3>
          <div class="flex justify-between items-center flex-wrap gap-4">
            <div class="flex items-center gap-2">
              <span class="badge badge-success">&#10003; 1. Registered</span>
              <span class="text-muted text-xs">&rarr;</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge ${user.team_id ? 'badge-success' : 'badge-warning'}">
                ${user.team_id ? '&#10003; 2. Formed Team' : '2. Join/Create Team'}
              </span>
              <span class="text-muted text-xs">&rarr;</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge ${user.project_id ? 'badge-success' : 'badge-primary'}">
                ${user.project_id ? '&#10003; 3. Project Submitted' : '3. Submit Project'}
              </span>
              <span class="text-muted text-xs">&rarr;</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="badge badge-secondary">4. Blind Judging</span>
              <span class="text-muted text-xs">&rarr;</span>
            </div>
            <div>
              <span class="badge badge-secondary">5. Normalized Standings</span>
            </div>
          </div>
        </div>

        <div class="participant-layout-grid">
          <!-- Left Column: Team & Submission Entity Details -->
          <div id="participant-content-area">
            <div class="empty-state-box">Loading your team and submission status...</div>
          </div>

          <!-- Right Column: Submission Guidelines & Deadlines -->
          <div class="participant-sidebar">
            <div class="card p-6 mb-6">
              <h4 class="font-bold mb-3">Event Milestones</h4>
              <ul class="text-sm text-muted flex flex-col gap-3">
                <li>
                  <strong class="text-main">Hacking Begins:</strong><br>
                  Platform opened for project registrations
                </li>
                <li>
                  <strong class="text-main">Submission Deadline:</strong><br>
                  <span id="sidebar-deadline-text">Refer to event guidelines</span>
                </li>
                <li>
                  <strong class="text-main">Evaluation Window:</strong><br>
                  Domain judges review assigned submissions
                </li>
                <li>
                  <strong class="text-main">Official Standings:</strong><br>
                  Z-score normalized results published
                </li>
              </ul>
            </div>

            <div class="card p-6">
              <h4 class="font-bold mb-2">Submission Checklist</h4>
              <ul class="text-sm text-muted flex flex-col gap-2">
                <li>• Project must belong to exactly one track.</li>
                <li>• Public repository URL must be provided.</li>
                <li>• Live demonstration link or video overview.</li>
                <li>• Max 1 active project per team.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;

    await loadParticipantDetails();
  }

  async function loadParticipantDetails() {
    const area = document.getElementById('participant-content-area');
    if (!area) return;

    try {
      // Refresh session me to get latest team & project
      const meRes = await api.getMe();
      const user = meRes.user;
      window.Judgely.setState({ user });

      // Fetch event tracks for submission dropdown
      const tracksRes = await api.getTracks();
      const tracks = tracksRes.tracks || tracksRes || [];

      // Fetch user's project if project_id exists
      let project = null;
      if (user.project_id) {
        try {
          const prjRes = await api.getProject(user.project_id);
          project = prjRes.project || prjRes;
        } catch (e) {
          // May be withdrawn or draft
        }
      }

      renderParticipantState(area, user, project, tracks);
    } catch (err) {
      area.innerHTML = `<div class="error-banner-box"><p class="text-danger font-semibold">${escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderParticipantState(container, user, project, tracks) {
    const hasTeam = Boolean(user.team_id);
    const hasProject = Boolean(project && project.status !== 'withdrawn');

    container.innerHTML = `
      <!-- Real Team Entity -->
      <div class="card p-6 mb-6">
        <div class="flex justify-between items-center mb-3">
          <span class="section-eyebrow">Team Entity</span>
          ${hasTeam ? `<span class="mono text-xs text-muted">ID: ${escapeHtml(user.team_id)}</span>` : ''}
        </div>

        ${hasTeam ? `
          <h2 class="text-xl font-bold mb-1">${escapeHtml(user.team_name || 'My Team')}</h2>
          <p class="text-sm text-muted mb-4">Role: <strong class="capitalize">${escapeHtml(user.team_role || 'Member')}</strong></p>
          <div class="border-t pt-3">
            <span class="text-xs font-semibold text-muted uppercase">Team Member:</span>
            <div class="text-sm mt-1">${escapeHtml(user.name)} (${escapeHtml(user.email)})</div>
          </div>
        ` : `
          <h3 class="font-bold mb-2">You are not in a team</h3>
          <p class="text-muted text-sm mb-4">Every project submission in Judgely requires a team entity.</p>
          <form id="create-team-form" class="flex gap-2">
            <input type="text" id="new-team-name" class="form-input" placeholder="Enter your team name..." required style="max-width: 320px;">
            <button type="submit" class="btn btn-primary btn-sm">Create Team</button>
          </form>
        `}
      </div>

      <!-- Real Submission Entity -->
      <div class="card p-6">
        <div class="flex justify-between items-center mb-3">
          <span class="section-eyebrow">Project Submission</span>
          ${hasProject ? `<span class="badge ${project.status === 'submitted' ? 'badge-success' : 'badge-warning'} capitalize">${escapeHtml(project.status)}</span>` : ''}
        </div>

        ${hasProject ? `
          <div class="flex justify-between items-center mb-2">
            <h2 class="text-xl font-bold">${escapeHtml(project.title)}</h2>
            <span class="mono text-xs text-muted">${escapeHtml(project.id)}</span>
          </div>
          <span class="badge badge-primary mb-3">${escapeHtml(project.track_name || project.track_id || 'Track')}</span>
          <p class="text-sm text-body leading-relaxed mb-4">${escapeHtml(project.summary || 'No summary provided.')}</p>

          ${project.tech_stack ? `
            <div class="mb-4">
              <span class="text-xs font-semibold text-muted uppercase">Tech Stack:</span>
              <p class="mono text-xs p-2 rounded mt-1" style="background: var(--bg-subtle);">${escapeHtml(project.tech_stack)}</p>
            </div>
          ` : ''}

          <div class="flex gap-4 text-sm text-muted mb-6">
            ${project.repo_url ? `<div><strong>Repository:</strong> <a href="${escapeHtml(sanitizeUrl(project.repo_url))}" target="_blank" class="text-accent underline">Link &nearr;</a></div>` : ''}
            ${project.demo_url ? `<div><strong>Demo:</strong> <a href="${escapeHtml(sanitizeUrl(project.demo_url))}" target="_blank" class="text-accent underline">Link &nearr;</a></div>` : ''}
          </div>

          <div class="flex gap-3 border-t pt-4">
            <button class="btn btn-secondary btn-sm" id="btn-edit-submission">Edit Submission</button>
            <button class="btn btn-secondary btn-sm text-danger" id="btn-withdraw-submission">Withdraw Project</button>
          </div>
        ` : `
          <h3 class="font-bold mb-2">No Active Submission</h3>
          <p class="text-muted text-sm mb-4">
            ${hasTeam ? 'Your team has not yet submitted a project for evaluation.' : 'Please create or join a team before submitting a project.'}
          </p>
          ${hasTeam ? `
            <button class="btn btn-primary" id="btn-open-submit-modal">Submit Project</button>
          ` : ''}
        `}
      </div>
    `;

    // Event Bindings
    const teamForm = document.getElementById('create-team-form');
    if (teamForm) {
      teamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('new-team-name').value.trim();
        try {
          await api.createTeam(name);
          showToast('Team created successfully!', 'success');
          await loadParticipantDetails();
        } catch (err) {
          showToast(err.message || 'Failed to create team', 'error');
        }
      });
    }

    const btnSubmit = document.getElementById('btn-open-submit-modal');
    if (btnSubmit) {
      btnSubmit.addEventListener('click', () => showSubmissionModal(tracks));
    }

    const btnEdit = document.getElementById('btn-edit-submission');
    if (btnEdit && project) {
      btnEdit.addEventListener('click', () => showSubmissionModal(tracks, project));
    }

    const btnWithdraw = document.getElementById('btn-withdraw-submission');
    if (btnWithdraw && project) {
      btnWithdraw.addEventListener('click', () => confirmWithdrawal(project.id));
    }
  }

  function showSubmissionModal(tracks, existing = null) {
    const isEdit = Boolean(existing);
    const title = isEdit ? 'Edit Project Submission' : 'Submit Project for Evaluation';

    const tracksOptions = tracks.map(t => `
      <option value="${escapeHtml(t.id)}" ${existing && existing.track_id === t.id ? 'selected' : ''}>
        ${escapeHtml(t.name)} (${escapeHtml(t.id)})
      </option>
    `).join('');

    const formHtml = `
      <form id="submission-modal-form">
        <div class="form-group mb-3">
          <label class="form-label" for="modal-project-title">Project Title *</label>
          <input type="text" id="modal-project-title" class="form-input" required value="${existing ? escapeHtml(existing.title) : ''}" placeholder="E.g. Autonomous AI Drone">
        </div>

        <div class="form-group mb-3">
          <label class="form-label" for="modal-project-track">Competition Track *</label>
          <select id="modal-project-track" class="form-select" required>
            ${tracksOptions}
          </select>
        </div>

        <div class="form-group mb-3">
          <label class="form-label" for="modal-project-summary">Project Summary *</label>
          <textarea id="modal-project-summary" class="form-textarea" rows="4" required placeholder="What problem does this project solve? How is it implemented?">${existing ? escapeHtml(existing.summary || '') : ''}</textarea>
        </div>

        <div class="form-group mb-3">
          <label class="form-label" for="modal-project-tech">Tech Stack (comma separated)</label>
          <input type="text" id="modal-project-tech" class="form-input" value="${existing ? escapeHtml(existing.tech_stack || '') : ''}" placeholder="Python, React, SQLite, Docker">
        </div>

        <div class="grid grid-2 gap-3 mb-4">
          <div class="form-group">
            <label class="form-label" for="modal-project-repo">Repository URL</label>
            <input type="url" id="modal-project-repo" class="form-input" value="${existing ? escapeHtml(existing.repo_url || '') : ''}" placeholder="https://github.com/org/repo">
          </div>
          <div class="form-group">
            <label class="form-label" for="modal-project-demo">Live Demo URL</label>
            <input type="url" id="modal-project-demo" class="form-input" value="${existing ? escapeHtml(existing.demo_url || '') : ''}" placeholder="https://my-demo.app">
          </div>
        </div>

        <div class="flex justify-end gap-3 border-t pt-4">
          <button type="button" class="btn btn-secondary" onclick="window.Judgely.closeModal()">Cancel</button>
          <button type="submit" class="btn btn-primary">${isEdit ? 'Update Submission' : 'Submit Project'}</button>
        </div>
      </form>
    `;

    openModal(title, formHtml);

    const form = document.getElementById('submission-modal-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
          title: document.getElementById('modal-project-title').value.trim(),
          track_id: document.getElementById('modal-project-track').value,
          summary: document.getElementById('modal-project-summary').value.trim(),
          tech_stack: document.getElementById('modal-project-tech').value.trim(),
          repo_url: document.getElementById('modal-project-repo').value.trim(),
          demo_url: document.getElementById('modal-project-demo').value.trim()
        };

        try {
          if (isEdit) {
            await api.updateProject(existing.id, payload);
            showToast('Project updated successfully!', 'success');
          } else {
            await api.submitProject(payload);
            showToast('Project submitted successfully!', 'success');
          }
          closeModal();
          await loadParticipantDetails();
        } catch (err) {
          showToast(err.message || 'Submission failed', 'error');
        }
      });
    }
  }

  async function confirmWithdrawal(projectId) {
    if (!confirm('Are you sure you want to withdraw this project? Judges will no longer evaluate it.')) return;

    try {
      await api.withdrawProject(projectId);
      showToast('Project withdrawn successfully', 'info');
      await loadParticipantDetails();
    } catch (err) {
      showToast(err.message || 'Withdrawal failed', 'error');
    }
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.participant = {
    render
  };
})(window);
