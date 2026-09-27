// Judgely Focused Judge Workspace & Blind Rubric Evaluation
(function(window) {
  'use strict';

  const { escapeHtml, sanitizeUrl, openModal, closeModal, showToast } = window.Judgely;
  const api = window.Judgely.api;

  let assignments = [];
  let rubricCriteria = [];
  let selectedProjectId = null;

  async function render(container) {
    const user = window.Judgely.state.user;

    container.innerHTML = `
      <div class="container py-8">
        <!-- Judge Header -->
        <div class="flex justify-between items-center mb-6">
          <div>
            <span class="badge badge-primary mb-1">Judge Evaluation Control</span>
            <h1 class="text-2xl font-bold">Welcome, ${escapeHtml(user.name || 'Judge')}</h1>
          </div>
          <div class="text-right">
            <span class="text-xs text-muted">Authorized Tracks:</span>
            <div class="font-semibold text-sm">${(user.tracks || []).join(', ') || 'All Assigned'}</div>
          </div>
        </div>

        <!-- Telemetry Stats: Assigned, Completed, Remaining -->
        <div class="metrics-grid mb-8" id="judge-telemetry-grid">
          <div class="metric-card">
            <div class="metric-label">Assigned Projects</div>
            <div class="metric-value" id="judge-stat-assigned">-</div>
            <div class="metric-subtext">Assigned to your queue</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Completed Reviews</div>
            <div class="metric-value text-success" id="judge-stat-completed">-</div>
            <div class="metric-subtext">Submitted & locked</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Pending Evaluations</div>
            <div class="metric-value text-warning" id="judge-stat-remaining">-</div>
            <div class="metric-subtext">Awaiting your evaluation</div>
          </div>
        </div>

        <!-- Two Column Layout: Assigned Projects List on Left, Active Evaluation Form on Right -->
        <div class="grid grid-2 gap-6" id="judge-workspace-grid">
          <!-- Assignments Queue -->
          <div class="card p-6">
            <h3 class="font-bold mb-4">Your Evaluation Queue</h3>
            <div id="judge-assignments-list">
              <div class="empty-state-box">Loading assigned submissions...</div>
            </div>
          </div>

          <!-- Evaluation Card -->
          <div class="card p-6" id="judge-scoring-panel">
            <div class="empty-state-box">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="text-muted mb-2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <h4 class="font-semibold mb-1">Select an assigned project</h4>
              <p class="text-sm text-muted">Click any project from your queue on the left to begin evaluation.</p>
            </div>
          </div>
        </div>
      </div>
    `;

    await loadJudgeData();
  }

  async function loadJudgeData() {
    try {
      const data = await api.getJudgeAssignments();
      assignments = data.assignments || [];
      rubricCriteria = data.criteria || [];

      updateJudgeTelemetry();
      renderAssignmentsList();

      // Automatically select first pending project if none selected
      if (!selectedProjectId && assignments.length > 0) {
        const firstPending = assignments.find(a => a.review_status !== 'submitted') || assignments[0];
        selectProject(firstPending.project_id);
      }
    } catch (err) {
      const listEl = document.getElementById('judge-assignments-list');
      if (listEl) {
        listEl.innerHTML = `<div class="error-banner-box"><p class="text-danger font-semibold">${escapeHtml(err.message)}</p></div>`;
      }
    }
  }

  function updateJudgeTelemetry() {
    const total = assignments.length;
    const completed = assignments.filter(a => a.review_status === 'submitted').length;
    const remaining = total - completed;

    const elTotal = document.getElementById('judge-stat-assigned');
    const elCompleted = document.getElementById('judge-stat-completed');
    const elRemaining = document.getElementById('judge-stat-remaining');

    if (elTotal) elTotal.textContent = total;
    if (elCompleted) elCompleted.textContent = completed;
    if (elRemaining) elRemaining.textContent = remaining;
  }

  function renderAssignmentsList() {
    const listEl = document.getElementById('judge-assignments-list');
    if (!listEl) return;

    if (assignments.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state-box">
          <p class="font-semibold mb-1">No Projects Assigned</p>
          <p class="text-sm text-muted">The event organizer has not dispatched projects to your queue yet.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = `
      <div class="flex flex-col gap-3">
        ${assignments.map(a => {
          const isSelected = a.project_id === selectedProjectId;
          const isDone = a.review_status === 'submitted';
          return `
            <div class="card p-4 cursor-pointer assignment-card ${isSelected ? 'border-accent' : ''}" data-project-id="${escapeHtml(a.project_id)}" style="${isSelected ? 'background-color: var(--accent-subtle); border-color: var(--accent);' : ''}">
              <div class="flex justify-between items-center mb-1">
                <span class="badge ${isDone ? 'badge-success' : 'badge-warning'}">
                  ${isDone ? '&#10003; Evaluated' : 'Pending Review'}
                </span>
                <span class="mono text-xs text-muted">${escapeHtml(a.project_id)}</span>
              </div>
              <h4 class="font-bold mb-1">${escapeHtml(a.title)}</h4>
              <div class="flex justify-between items-center text-xs text-muted">
                <span>Track: <strong>${escapeHtml(a.track_name || a.track_id)}</strong></span>
                <span>Team: ${escapeHtml(a.team_name || 'Team')}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    listEl.querySelectorAll('.assignment-card').forEach(card => {
      card.addEventListener('click', () => {
        const pid = card.getAttribute('data-project-id');
        selectProject(pid);
      });
    });
  }

  function selectProject(projectId) {
    selectedProjectId = projectId;
    renderAssignmentsList();

    const assignment = assignments.find(a => a.project_id === projectId);
    const panel = document.getElementById('judge-scoring-panel');
    if (!panel || !assignment) return;

    const safeRepo = sanitizeUrl(assignment.repo_url);
    const safeDemo = sanitizeUrl(assignment.demo_url);
    const isDone = assignment.review_status === 'submitted';

    const criteriaInputs = (rubricCriteria || []).map(c => {
      const existingScore = (assignment.scores && assignment.scores[c.name]) !== undefined ? assignment.scores[c.name] : 3.0;
      return `
        <div class="rubric-row mb-4 pb-3 border-b">
          <div class="flex justify-between items-center mb-1">
            <label class="font-semibold text-sm" for="score-${escapeHtml(c.name)}">${escapeHtml(c.name)}</label>
            <span class="text-xs text-muted">Weight: <strong>${c.weight}x</strong> • Max: <strong>${c.max_score}</strong></span>
          </div>
          <p class="text-xs text-muted mb-2">${escapeHtml(c.description || 'Evaluation criterion')}</p>
          <div class="flex items-center gap-3">
            <input type="range" class="form-range" id="range-${escapeHtml(c.name)}" min="0" max="${c.max_score}" step="0.5" value="${existingScore}">
            <input type="number" class="form-input score-number-input" id="num-${escapeHtml(c.name)}" name="${escapeHtml(c.name)}" min="0" max="${c.max_score}" step="0.5" value="${existingScore}" style="width: 80px;" required>
          </div>
        </div>
      `;
    }).join('');

    panel.innerHTML = `
      <div class="project-evaluation-form">
        <div class="flex justify-between items-center mb-2">
          <span class="section-eyebrow">Project Evaluation</span>
          <span class="badge ${isDone ? 'badge-success' : 'badge-warning'}">
            ${isDone ? 'Completed Review' : 'Pending Review'}
          </span>
        </div>

        <h2 class="text-xl font-bold mb-1">${escapeHtml(assignment.title)}</h2>
        <p class="text-xs text-muted mb-3">Submitted by <strong>${escapeHtml(assignment.team_name || 'Team')}</strong> • Track: <strong>${escapeHtml(assignment.track_name || assignment.track_id)}</strong></p>

        <div class="card p-3 mb-4" style="background-color: var(--bg-subtle);">
          <p class="text-sm leading-relaxed">${escapeHtml(assignment.summary || 'No project description provided.')}</p>
          <div class="flex gap-4 text-xs mt-3 pt-2 border-t">
            ${safeRepo ? `<a href="${escapeHtml(safeRepo)}" target="_blank" class="text-accent underline font-semibold">Repository &nearr;</a>` : ''}
            ${safeDemo ? `<a href="${escapeHtml(safeDemo)}" target="_blank" class="text-accent underline font-semibold">Live Demo &nearr;</a>` : ''}
          </div>
        </div>

        <form id="judge-rubric-form">
          <div class="flex justify-between items-center mb-3">
            <h4 class="font-bold">Objective Rubric Criteria</h4>
            <span class="text-xs text-muted">Range: 0.0 to Max Score</span>
          </div>
          ${criteriaInputs}

          <!-- Live Weighted Score Indicator -->
          <div class="card p-3 mb-4 flex justify-between items-center" style="background-color: var(--accent-subtle); border: 1px solid var(--accent-border);">
            <div>
              <div class="font-semibold text-sm text-main">Calculated Total Weighted Score:</div>
              <div class="text-xs text-muted">Normalized across criteria weights</div>
            </div>
            <div class="text-xl font-bold text-accent mono" id="live-total-weighted-score">0.00 / 5.00</div>
          </div>

          <div class="form-group mb-4">
            <div class="flex justify-between items-center mb-1">
              <label class="form-label font-semibold" for="judge-comments">Confidential Evaluator Feedback (Required)</label>
              <span class="text-xs text-muted" id="comments-char-count">0 characters</span>
            </div>
            <textarea id="judge-comments" class="form-textarea" rows="3" required placeholder="Explain technical strengths, architecture, and areas for improvement...">${escapeHtml(assignment.comment || '')}</textarea>
            <span class="text-xs text-muted mt-1">Feedback is strictly isolated and never shown to peer judges.</span>
          </div>

          <div class="flex justify-end gap-3 border-t pt-4">
            <button type="submit" class="btn btn-primary" id="btn-submit-review">
              ${isDone ? 'Update Evaluation' : 'Submit Review'}
            </button>
          </div>
        </form>
      </div>
    `;

    // Calculate live weighted score
    function updateLiveScore() {
      let totalWeight = 0;
      let weightedSum = 0;
      (rubricCriteria || []).forEach(c => {
        const input = document.getElementById(`num-${c.name}`);
        const val = input ? parseFloat(input.value) || 0 : 0;
        const w = c.weight || 1.0;
        weightedSum += val * w;
        totalWeight += w;
      });
      const scoreEl = document.getElementById('live-total-weighted-score');
      if (scoreEl) {
        const avg = totalWeight > 0 ? (weightedSum / totalWeight) : 0;
        scoreEl.textContent = `${avg.toFixed(2)} / 5.00`;
      }
    }

    // Sync range and number inputs
    (rubricCriteria || []).forEach(c => {
      const range = document.getElementById(`range-${c.name}`);
      const num = document.getElementById(`num-${c.name}`);
      if (range && num) {
        range.addEventListener('input', () => { 
          num.value = range.value; 
          updateLiveScore();
        });
        num.addEventListener('input', () => { 
          range.value = num.value; 
          updateLiveScore();
        });
      }
    });

    const commentsArea = document.getElementById('judge-comments');
    const charCountEl = document.getElementById('comments-char-count');
    if (commentsArea && charCountEl) {
      charCountEl.textContent = `${commentsArea.value.length} characters`;
      commentsArea.addEventListener('input', () => {
        charCountEl.textContent = `${commentsArea.value.length} characters`;
      });
    }

    updateLiveScore();

    const form = document.getElementById('judge-rubric-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const scores = {};
        (rubricCriteria || []).forEach(c => {
          const val = parseFloat(document.getElementById(`num-${c.name}`).value);
          scores[c.name] = val;
        });

        const comments = document.getElementById('judge-comments').value.trim();

        const btn = document.getElementById('btn-submit-review');
        if (btn) btn.disabled = true;

        try {
          await api.submitReview(projectId, {
            scores,
            comments
          });
          showToast('Evaluation submitted successfully!', 'success');
          await loadJudgeData();
        } catch (err) {
          showToast(err.message || 'Failed to submit review', 'error');
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.judge = {
    render
  };
})(window);
