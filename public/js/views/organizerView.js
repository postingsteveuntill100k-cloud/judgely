// Judgely Organizer Operations Command Center
(function(window) {
  'use strict';

  const { escapeHtml, openModal, closeModal, showToast } = window.Judgely;
  const api = window.Judgely.api;

  let activeTab = 'overview';
  let overviewData = null;
  let healthData = null;
  let auditLogs = [];
  let assignmentsData = null;
  let resultsData = null;

  async function render(container) {
    container.innerHTML = `
      <div class="container py-8">
        <!-- Organizer Header -->
        <div class="flex justify-between items-center mb-6">
          <div>
            <span class="badge badge-primary mb-1">Operations Command</span>
            <h1 class="text-2xl font-bold">Hackathon Management</h1>
          </div>
          <div class="flex gap-2">
            <a href="/api/export/results.csv" download="results.csv" class="btn btn-secondary btn-sm" id="btn-export-csv">
              Export Results CSV
            </a>
            <button class="btn btn-primary btn-sm" id="btn-release-results-toggle">
              Publish Results
            </button>
          </div>
        </div>

        <!-- Tab Navigation Bar -->
        <div class="filter-pills-bar mb-6" id="organizer-tabs-nav">
          <button class="pill active" data-tab="overview">Overview</button>
          <button class="pill" data-tab="health">Judging Health</button>
          <button class="pill" data-tab="assignments">Assignments</button>
          <button class="pill" data-tab="results">Results & Normalization</button>
          <button class="pill" data-tab="audit">Audit Log</button>
        </div>

        <!-- Active Tab Container -->
        <div id="organizer-tab-content">
          <div class="empty-state-box">Loading operations data...</div>
        </div>
      </div>
    `;

    bindOrganizerEvents();
    await switchTab('overview');
  }

  function bindOrganizerEvents() {
    const tabsNav = document.getElementById('organizer-tabs-nav');
    if (tabsNav) {
      tabsNav.querySelectorAll('.pill').forEach(btn => {
        btn.addEventListener('click', () => {
          tabsNav.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const tab = btn.getAttribute('data-tab');
          switchTab(tab);
        });
      });
    }

    const btnRelease = document.getElementById('btn-release-results-toggle');
    if (btnRelease) {
      btnRelease.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to release official hackathon results to the public? This will publish rankings and normalized scores.')) return;
        try {
          await api.releaseResults();
          showToast('Results published successfully!', 'success');
          await switchTab('results');
        } catch (err) {
          showToast(err.message || 'Failed to publish results', 'error');
        }
      });
    }
  }

  async function switchTab(tab) {
    activeTab = tab;
    const content = document.getElementById('organizer-tab-content');
    if (!content) return;

    content.innerHTML = '<div class="empty-state-box">Loading...</div>';

    try {
      if (tab === 'overview') {
        overviewData = await api.getOrganizerOverview();
        renderOverviewTab(content, overviewData);
      } else if (tab === 'health') {
        healthData = await api.getOrganizerHealth();
        renderHealthTab(content, healthData);
      } else if (tab === 'assignments') {
        assignmentsData = await api.getOrganizerAssignments();
        renderAssignmentsTab(content, assignmentsData);
      } else if (tab === 'results') {
        resultsData = await api.getResults();
        renderResultsTab(content, resultsData);
      } else if (tab === 'audit') {
        const auditRes = await api.getOrganizerAudit();
        auditLogs = auditRes.logs || [];
        renderAuditTab(content, auditLogs);
      }
    } catch (err) {
      content.innerHTML = `<div class="error-banner-box"><p class="text-danger font-semibold">${escapeHtml(err.message)}</p></div>`;
    }
  }

  function renderOverviewTab(container, data) {
    const stats = data.stats || {};
    container.innerHTML = `
      <div class="metrics-grid mb-8">
        <div class="metric-card">
          <div class="metric-label">Total Projects</div>
          <div class="metric-value">${stats.projects_count ?? '-'}</div>
          <div class="metric-subtext">Registered Submissions</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Active Judges</div>
          <div class="metric-value">${stats.judges_count ?? '-'}</div>
          <div class="metric-subtext">Verified Evaluators</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Total Assignments</div>
          <div class="metric-value">${stats.assignments_count ?? '-'}</div>
          <div class="metric-subtext">Dispatched Reviews</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Completed Reviews</div>
          <div class="metric-value text-success">${stats.completed_reviews ?? '-'}</div>
          <div class="metric-subtext">Evaluations Ingested</div>
        </div>
      </div>

      <div class="card p-6">
        <h3 class="font-bold mb-3">Event Operations Summary</h3>
        <p class="text-muted text-sm mb-4">
          Status: <strong>${data.event ? (data.event.results_released ? 'Results Released' : 'Judging In Progress') : 'Active'}</strong>
        </p>
        <p class="text-sm leading-relaxed text-body">
          Judgely enforces role isolation, deterministic weighted rubrics, and automated z-score normalization across all track evaluations. Use the tabs above to monitor judging health, dispatch new judge assignments, or inspect the chronological audit ledger.
        </p>
      </div>
    `;
  }

  function renderHealthTab(container, data) {
    const alerts = data.alerts || [];
    const coverage = data.coverage || {};
    const zeroVariance = data.zero_variance_judges || [];
    const duplicateTeams = data.duplicate_teams || [];

    container.innerHTML = `
      <div class="card p-6 mb-6">
        <h3 class="font-bold mb-2">Judging System Health & Diagnostics</h3>
        <p class="text-sm text-muted mb-4">Real-time telemetry flagging reviewer variance, duplicate submissions, and coverage gaps.</p>

        <div class="metrics-grid mb-6">
          <div class="metric-card">
            <div class="metric-label">Min Reviews per Project</div>
            <div class="metric-value">${coverage.min_reviews_per_project ?? '-'}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Avg Reviews per Project</div>
            <div class="metric-value">${coverage.avg_reviews_per_project ? Number(coverage.avg_reviews_per_project).toFixed(1) : '-'}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Unreviewed Projects</div>
            <div class="metric-value ${coverage.unreviewed_projects_count > 0 ? 'text-warning' : 'text-success'}">
              ${coverage.unreviewed_projects_count ?? 0}
            </div>
          </div>
        </div>

        ${zeroVariance.length > 0 ? `
          <div class="card p-4 mb-4" style="background-color: var(--warning-bg); border-color: var(--warning-border);">
            <h4 class="font-bold text-warning mb-1">Zero-Variance Judges Detected (${zeroVariance.length})</h4>
            <p class="text-xs text-muted mb-2">These evaluators awarded identical scores across all assigned projects. Normalization falls back to mean-centering.</p>
            <ul class="text-xs pl-4 text-body">
              ${zeroVariance.map(j => `<li><strong>${escapeHtml(j.name || j.id)}</strong> (${escapeHtml(j.id)})</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${duplicateTeams.length > 0 ? `
          <div class="card p-4" style="background-color: var(--danger-bg); border-color: var(--danger-border);">
            <h4 class="font-bold text-danger mb-1">Duplicate Project Submissions Detected</h4>
            <p class="text-xs text-muted mb-2">Teams with multiple active submissions in the competition ledger:</p>
            <ul class="text-xs pl-4 text-body">
              ${duplicateTeams.map(d => `<li>Team <strong>${escapeHtml(d.team_name || d.team_id)}</strong> has ${d.count} projects (${escapeHtml(d.project_ids)})</li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  function renderAssignmentsTab(container, data) {
    const list = data.assignments || [];
    container.innerHTML = `
      <div class="card p-6">
        <div class="flex justify-between items-center mb-4">
          <div>
            <h3 class="font-bold">Judge Assignments Ledger</h3>
            <p class="text-sm text-muted">All active reviewer assignments and completion status.</p>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-new-assignment">Assign Judge</button>
        </div>

        <div class="table-container" style="overflow-x: auto;">
          <table class="table w-full text-sm">
            <thead>
              <tr class="border-b text-left text-xs text-muted uppercase">
                <th class="p-2">Assignment ID</th>
                <th class="p-2">Project</th>
                <th class="p-2">Judge</th>
                <th class="p-2">Status</th>
                <th class="p-2">Assigned At</th>
              </tr>
            </thead>
            <tbody>
              ${list.map(a => `
                <tr class="border-b">
                  <td class="p-2 mono text-xs">${escapeHtml(a.id)}</td>
                  <td class="p-2 font-medium">${escapeHtml(a.project_title || a.project_id)}</td>
                  <td class="p-2">${escapeHtml(a.judge_name || a.judge_id)}</td>
                  <td class="p-2">
                    <span class="badge ${a.status === 'completed' ? 'badge-success' : 'badge-warning'}">
                      ${escapeHtml(a.status)}
                    </span>
                  </td>
                  <td class="p-2 text-xs text-muted">${new Date(a.assigned_at).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const btnNew = document.getElementById('btn-new-assignment');
    if (btnNew) {
      btnNew.addEventListener('click', () => showAssignJudgeModal());
    }
  }

  async function showAssignJudgeModal() {
    openModal('Assign Judge to Project', '<div class="p-4 text-center">Loading projects and judges...</div>');
    try {
      const [pRes, jRes] = await Promise.all([api.getOrganizerProjects(), api.getOrganizerJudges()]);
      const projects = pRes.projects || [];
      const judges = jRes.judges || [];

      const pOpts = projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${escapeHtml(p.track_id)})</option>`).join('');
      const jOpts = judges.map(j => `<option value="${escapeHtml(j.id)}">${escapeHtml(j.name)} (${escapeHtml(j.id)})</option>`).join('');

      const formHtml = `
        <form id="assign-judge-form">
          <div class="form-group mb-3">
            <label class="form-label">Select Project</label>
            <select id="modal-assign-project" class="form-select" required>${pOpts}</select>
          </div>
          <div class="form-group mb-4">
            <label class="form-label">Select Judge</label>
            <select id="modal-assign-judge" class="form-select" required>${jOpts}</select>
          </div>
          <div class="flex justify-end gap-2 border-t pt-3">
            <button type="button" class="btn btn-secondary" onclick="window.Judgely.closeModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">Create Assignment</button>
          </div>
        </form>
      `;

      openModal('Assign Judge to Project', formHtml);

      const form = document.getElementById('assign-judge-form');
      if (form) {
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const projectId = document.getElementById('modal-assign-project').value;
          const judgeId = document.getElementById('modal-assign-judge').value;
          try {
            await api.assignJudge({ project_id: projectId, judge_id: judgeId });
            showToast('Assignment created successfully!', 'success');
            closeModal();
            await switchTab('assignments');
          } catch (err) {
            showToast(err.message || 'Assignment failed', 'error');
          }
        });
      }
    } catch (err) {
      openModal('Error', `<div class="p-4 text-danger">${escapeHtml(err.message)}</div>`);
    }
  }

  function renderResultsTab(container, data) {
    const results = data.results || [];
    container.innerHTML = `
      <div class="card p-6">
        <div class="flex justify-between items-center mb-4">
          <div>
            <h3 class="font-bold">Official Results Ledger</h3>
            <p class="text-sm text-muted">Z-score normalized rankings across all competition tracks.</p>
          </div>
          <a href="/api/export/results.csv" download="results.csv" class="btn btn-secondary btn-sm">Download CSV</a>
        </div>

        <div class="table-container" style="overflow-x: auto;">
          <table class="table w-full text-sm">
            <thead>
              <tr class="border-b text-left text-xs text-muted uppercase">
                <th class="p-2">Rank</th>
                <th class="p-2">Project</th>
                <th class="p-2">Track</th>
                <th class="p-2">Team</th>
                <th class="p-2">Normalized Score</th>
                <th class="p-2">Raw Score</th>
              </tr>
            </thead>
            <tbody>
              ${results.map(r => `
                <tr class="border-b">
                  <td class="p-2 font-bold">#${r.rank}</td>
                  <td class="p-2 font-semibold">${escapeHtml(r.project_title || r.title || r.project_id)}</td>
                  <td class="p-2"><span class="badge badge-primary">${escapeHtml(r.track_name || r.track_id)}</span></td>
                  <td class="p-2">${escapeHtml(r.team_name || 'Team')}</td>
                  <td class="p-2 mono font-bold text-accent">${Number(r.normalized_score).toFixed(3)}</td>
                  <td class="p-2 mono text-muted">${Number(r.raw_score || 0).toFixed(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  function renderAuditTab(container, logs) {
    container.innerHTML = `
      <div class="card p-6">
        <h3 class="font-bold mb-2">Immutable Audit Ledger</h3>
        <p class="text-sm text-muted mb-4">Cryptographically recorded chronological event log.</p>

        <div class="table-container" style="overflow-x: auto;">
          <table class="table w-full text-sm">
            <thead>
              <tr class="border-b text-left text-xs text-muted uppercase">
                <th class="p-2">Audit ID</th>
                <th class="p-2">Action</th>
                <th class="p-2">Actor (Role)</th>
                <th class="p-2">Resource</th>
                <th class="p-2">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(l => `
                <tr class="border-b">
                  <td class="p-2 mono text-xs">${escapeHtml(l.id)}</td>
                  <td class="p-2 font-semibold text-accent">${escapeHtml(l.action)}</td>
                  <td class="p-2">${escapeHtml(l.user_id || 'system')} (${escapeHtml(l.role || '')})</td>
                  <td class="p-2 mono text-xs">${escapeHtml(l.resource_type || '')}: ${escapeHtml(l.resource_id || '-')}</td>
                  <td class="p-2 text-xs text-muted">${new Date(l.timestamp).toLocaleString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  window.Judgely = window.Judgely || {};
  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.organizer = {
    render
  };
})(window);
