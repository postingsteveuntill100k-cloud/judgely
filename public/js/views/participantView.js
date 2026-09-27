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
        <div class="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="badge badge-primary">Participant Workspace</span>
              <span class="text-xs text-muted" id="participant-event-label">Active Hackathon</span>
            </div>
            <h1 class="text-2xl font-bold">Welcome, ${escapeHtml(user.name || 'Participant')}</h1>
          </div>
          <div class="text-right">
            <span class="text-xs text-muted">Signed in as</span>
            <div class="font-semibold text-sm">${escapeHtml(user.email || '')}</div>
          </div>
        </div>

        <!-- Hackathon Roadmap Stepper -->
        <div class="roadmap-container mb-8">
          <div class="roadmap-steps">
            <div class="roadmap-step">
              <div class="step-num done">&#10003;</div>
              <div class="step-meta">
                <strong>1. Registration</strong>
                <span>Verified Member</span>
              </div>
            </div>
            <div class="roadmap-step" id="step-team">
              <div class="step-num ${user.team_id ? 'done' : 'active'}">${user.team_id ? '&#10003;' : '2'}</div>
              <div class="step-meta">
                <strong>2. Team Formation</strong>
                <span>${user.team_id ? escapeHtml(user.team_name || 'Team Formed') : 'Create / Join Team'}</span>
              </div>
            </div>
            <div class="roadmap-step" id="step-project">
              <div class="step-num ${user.project_id ? 'done' : (user.team_id ? 'active' : '')}">${user.project_id ? '&#10003;' : '3'}</div>
              <div class="step-meta">
                <strong>3. Project Submission</strong>
                <span id="roadmap-project-status">${user.project_id ? 'Submitted' : 'Pending Submission'}</span>
              </div>
            </div>
            <div class="roadmap-step">
              <div class="step-num">4</div>
              <div class="step-meta">
                <strong>4. Blind Judging</strong>
                <span>Domain Evaluation</span>
              </div>
            </div>
            <div class="roadmap-step">
              <div class="step-num">5</div>
              <div class="step-meta">
                <strong>5. Results</strong>
                <span>Normalized Standings</span>
              </div>
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
                <li>• Drafts are saved privately before final submission.</li>
                <li>• Public repository URL must be provided on submission.</li>
                <li>• Live demonstration link or video overview.</li>
                <li>• 1 active project per team.</li>
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
      const activeEventId = window.Judgely.state.activeEventId;
      const [meRes, tracksRes, eventRes] = await Promise.all([
        api.getMe(),
        api.getTracks(),
        api.getEvent(activeEventId)
      ]);
      const user = meRes.user;
      window.Judgely.setState({ user });

      const tracks = tracksRes.tracks || tracksRes || [];

      // Update event label
      const eventLabel = document.getElementById('participant-event-label');
      if (eventLabel && eventRes && eventRes.name) {
        eventLabel.textContent = eventRes.name;
      }

      // Update sidebar deadline text
      const deadlineText = document.getElementById('sidebar-deadline-text');
      if (deadlineText && eventRes && eventRes.submissions_close) {
        const d = new Date(eventRes.submissions_close);
        deadlineText.innerHTML = `
          <div class="mono font-semibold text-main mb-1">${d.toUTCString()}</div>
          <span class="badge ${eventRes.is_closed ? 'badge-warning' : 'badge-success'}">
            ${eventRes.is_closed ? 'Submissions Closed' : 'Submissions Open'}
          </span>
        `;
      }

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

      // Update roadmap project status
      const rmProjectStatus = document.getElementById('roadmap-project-status');
      if (rmProjectStatus && project) {
        rmProjectStatus.textContent = project.status === 'draft' ? 'Draft Saved' : 'Submitted';
      }

      renderParticipantState(area, user, project, tracks, eventRes);
    } catch (err) {
      area.innerHTML = `<div class="error-banner-box"><p class="text-danger font-semibold">${escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderParticipantState(container, user, project, tracks, event) {
    const hasTeam = Boolean(user.team_id);
    const hasProject = Boolean(project && project.status !== 'withdrawn');
    const isDraft = Boolean(project && project.status === 'draft');

    container.innerHTML = `
      <!-- Real Team Entity -->
      <div class="card p-6 mb-6">
        <div class="flex justify-between items-center mb-3">
          <span class="section-eyebrow">Team Entity</span>
          ${hasTeam ? `
            <div class="flex items-center gap-2">
              <span class="mono text-xs text-muted">Code: <strong>${escapeHtml(user.team_id)}</strong></span>
              <button class="btn btn-secondary btn-xs" id="btn-copy-team-code" title="Copy Team Invite Code for teammates">Copy Code</button>
            </div>
          ` : ''}
        </div>

        ${hasTeam ? `
          <h2 class="text-xl font-bold mb-1">${escapeHtml(user.team_name || 'My Team')}</h2>
          <p class="text-sm text-muted mb-4">Role: <strong class="capitalize text-accent">${escapeHtml(user.team_role || 'Member')}</strong></p>
          <div class="border-t pt-3 flex justify-between items-center">
            <div>
              <span class="text-xs font-semibold text-muted uppercase">Team Member:</span>
              <div class="text-sm mt-1 font-medium">${escapeHtml(user.name)} (${escapeHtml(user.email)})</div>
            </div>
            <div class="text-xs text-muted">
              Share your team code <code>${escapeHtml(user.team_id)}</code> with teammates to collaborate.
            </div>
          </div>
        ` : `
          <h3 class="font-bold mb-2">You are not in a team</h3>
          <p class="text-muted text-sm mb-4">Every project submission on Hackerly requires a team entity. Create your team or join an existing one.</p>
          
          <div class="grid grid-2 gap-4">
            <div class="p-4 rounded border" style="background: var(--bg-surface);">
              <h4 class="font-bold text-sm mb-2">Create New Team</h4>
              <form id="create-team-form" class="flex flex-col gap-2">
                <input type="text" id="new-team-name" class="form-input" placeholder="Enter team name..." required>
                <button type="submit" class="btn btn-primary btn-sm">Create Team</button>
              </form>
            </div>
            <div class="p-4 rounded border" style="background: var(--bg-surface);">
              <h4 class="font-bold text-sm mb-2">Join Existing Team</h4>
              <form id="join-team-form" class="flex flex-col gap-2">
                <input type="text" id="join-team-code" class="form-input" placeholder="Enter team invite code..." required>
                <button type="submit" class="btn btn-secondary btn-sm">Join Team</button>
              </form>
            </div>
          </div>
        `}
      </div>

      <!-- Real Submission Entity -->
      <div class="card p-6">
        <div class="flex justify-between items-center mb-3">
          <span class="section-eyebrow">Project Submission</span>
          ${hasProject ? `
            <span class="badge ${isDraft ? 'badge-warning' : 'badge-success'} capitalize">
              ${isDraft ? 'Draft (Private)' : 'Submitted (Eligible)'}
            </span>
          ` : ''}
        </div>

        ${hasProject ? `
          ${isDraft ? `
            <div class="p-3 mb-4 rounded border" style="background: rgba(245, 158, 11, 0.1); border-color: rgba(245, 158, 11, 0.3);">
              <strong class="text-warning text-sm">Draft in progress:</strong>
              <span class="text-xs text-muted ml-1">This project is saved as a draft. It is NOT visible in the public showcase or to judges until you finalize and submit it.</span>
            </div>
          ` : ''}

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

          <div class="flex gap-3 border-t pt-4 flex-wrap">
            <button class="btn btn-secondary btn-sm" id="btn-edit-submission">${isDraft ? 'Edit Draft' : 'Edit Submission'}</button>
            ${isDraft ? `<button class="btn btn-primary btn-sm" id="btn-finalize-submission">Finalize & Submit Project</button>` : ''}
            <button class="btn btn-secondary btn-sm text-danger" id="btn-withdraw-submission">Withdraw Project</button>
          </div>
        ` : `
          <h3 class="font-bold mb-2">${event && event.is_closed ? 'Submissions Closed' : 'No Active Submission'}</h3>
          <p class="text-muted text-sm mb-4">
            ${event && event.is_closed ? 'The deadline for this hackathon has passed. New submissions are no longer accepted.' : (hasTeam ? 'Your team has not yet submitted a project for evaluation.' : 'Please create or join a team before submitting a project.')}
          </p>
          ${hasTeam && (!event || !event.is_closed) ? `
            <div class="flex gap-3">
              <button class="btn btn-primary" id="btn-open-submit-modal">Start Submission</button>
            </div>
          ` : ''}
        `}
      </div>
    `;

    // Event Bindings
    const copyCodeBtn = document.getElementById('btn-copy-team-code');
    if (copyCodeBtn && user.team_id) {
      copyCodeBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(user.team_id).then(() => {
          showToast('Team code copied to clipboard!', 'success');
        }).catch(() => {
          showToast(`Team Code: ${user.team_id}`, 'info');
        });
      });
    }

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

    const joinTeamForm = document.getElementById('join-team-form');
    if (joinTeamForm) {
      joinTeamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const code = document.getElementById('join-team-code').value.trim();
        try {
          await api.joinTeam(code);
          showToast('Joined team successfully!', 'success');
          await loadParticipantDetails();
        } catch (err) {
          showToast(err.message || 'Failed to join team', 'error');
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

    const btnFinalize = document.getElementById('btn-finalize-submission');
    if (btnFinalize && project) {
      btnFinalize.addEventListener('click', () => showSubmissionModal(tracks, project, true));
    }

    const btnWithdraw = document.getElementById('btn-withdraw-submission');
    if (btnWithdraw && project) {
      btnWithdraw.addEventListener('click', () => confirmWithdrawal(project.id));
    }
  }

  function showSubmissionModal(tracks, existing = null, forceSubmit = false) {
    const isEdit = Boolean(existing);
    const title = forceSubmit ? 'Finalize Project Submission' : (isEdit ? 'Edit Project Submission' : 'Submit Project for Evaluation');

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

        <div class="flex justify-between items-center border-t pt-4 flex-wrap gap-2">
          <button type="button" class="btn btn-secondary" onclick="window.Judgely.closeModal()">Cancel</button>
          <div class="flex gap-2">
            <button type="button" class="btn btn-secondary" id="btn-save-draft">Save as Draft</button>
            <button type="submit" class="btn btn-primary">${forceSubmit || !existing || existing.status === 'draft' ? 'Submit Project' : 'Update Submission'}</button>
          </div>
        </div>
      </form>
    `;

    openModal(title, formHtml);

    // Draft handler
    const btnDraft = document.getElementById('btn-save-draft');
    if (btnDraft) {
      btnDraft.addEventListener('click', async () => {
        const titleVal = document.getElementById('modal-project-title').value.trim();
        if (!titleVal) {
          showToast('Project title is required to save a draft.', 'error');
          return;
        }

        const payload = {
          title: titleVal,
          track_id: document.getElementById('modal-project-track').value,
          summary: document.getElementById('modal-project-summary').value.trim(),
          tech_stack: document.getElementById('modal-project-tech').value.trim(),
          repo_url: document.getElementById('modal-project-repo').value.trim(),
          demo_url: document.getElementById('modal-project-demo').value.trim(),
          is_draft: true
        };

        try {
          if (existing && existing.status === 'submitted') {
            await api.updateProject(existing.id, payload);
          } else {
            await api.saveDraft(payload);
          }
          showToast('Draft saved successfully!', 'success');
          closeModal();
          await loadParticipantDetails();
        } catch (err) {
          showToast(err.message || 'Failed to save draft', 'error');
        }
      });
    }

    // Submit handler
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
          demo_url: document.getElementById('modal-project-demo').value.trim(),
          status: 'submitted'
        };

        try {
          if (isEdit && existing.status === 'submitted') {
            await api.updateProject(existing.id, payload);
            showToast('Project updated successfully!', 'success');
          } else {
            await api.submitProject(payload);
            showToast('Project submitted successfully for judging!', 'success');
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
