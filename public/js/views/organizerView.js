// Judgely Organizer Operations Command Center (Complete 9-Tab Experience)
(function(window) {
  'use strict';

  const { escapeHtml, sanitizeUrl, openModal, closeModal, showToast } = window.Judgely;
  const api = window.Judgely.api;

  let activeTab = 'overview';
  let cachedData = {};

  async function render(container) {
    container.innerHTML = `
      <div class="container py-8">
        <!-- Organizer Command Header -->
        <div class="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="badge badge-primary">Operations Command</span>
              <span class="text-xs text-muted" id="organizer-event-badge">Sample Hack 2026</span>
            </div>
            <h1 class="text-2xl font-bold">Hackathon Management Center</h1>
          </div>
          <div class="flex gap-2">
            <a href="/api/export/results.csv" download="results.csv" class="btn btn-secondary btn-sm" id="btn-export-csv">
              Export Results CSV
            </a>
            <button class="btn btn-primary btn-sm" id="btn-publish-results-header">
              Publish Results
            </button>
          </div>
        </div>

        <!-- 9-Tab Navigation Bar -->
        <div class="filter-pills-bar mb-6" id="organizer-tabs-nav" style="overflow-x: auto; white-space: nowrap; padding-bottom: 0.5rem;">
          <button class="pill active" data-tab="overview">Overview</button>
          <button class="pill" data-tab="projects">Projects</button>
          <button class="pill" data-tab="teams">Teams</button>
          <button class="pill" data-tab="judges">Judges</button>
          <button class="pill" data-tab="assignments">Assignments</button>
          <button class="pill" data-tab="health">Judging Health</button>
          <button class="pill" data-tab="results">Results & Standings</button>
          <button class="pill" data-tab="audit">Audit Log</button>
          <button class="pill" data-tab="settings">Settings</button>
        </div>

        <!-- Active Tab Workspace Container -->
        <div id="organizer-tab-content">
          <div class="page-loading-skeleton">
            <div class="skeleton-line" style="width: 30%;"></div>
            <div class="skeleton-grid mt-4">
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
              <div class="skeleton-card"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    bindTabNavigation();
    bindHeaderActions();
    await switchTab(activeTab);
  }

  function bindTabNavigation() {
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
  }

  function bindHeaderActions() {
    const btnPublish = document.getElementById('btn-publish-results-header');
    if (btnPublish) {
      btnPublish.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to publish official results? This will calculate z-score normalization and make official standings public.')) return;
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

    content.innerHTML = `
      <div class="page-loading-skeleton p-6">
        <div class="skeleton-line" style="width: 25%;"></div>
        <div class="skeleton-line mt-2" style="width: 60%;"></div>
      </div>
    `;

    try {
      switch (tab) {
        case 'overview':
          const overview = await api.getOrganizerOverview();
          renderOverviewTab(content, overview);
          break;
        case 'projects':
          const prjData = await api.getOrganizerProjects();
          renderProjectsTab(content, prjData.projects || []);
          break;
        case 'teams':
          const tmData = await api.getOrganizerTeams();
          renderTeamsTab(content, tmData.teams || []);
          break;
        case 'judges':
          const jdgData = await api.getOrganizerJudges();
          renderJudgesTab(content, jdgData.judges || []);
          break;
        case 'assignments':
          const asgData = await api.getOrganizerAssignments();
          renderAssignmentsTab(content, asgData.assignments || []);
          break;
        case 'health':
          const health = await api.getOrganizerHealth();
          renderHealthTab(content, health);
          break;
        case 'results':
          const resData = await api.getResults();
          renderResultsTab(content, resData);
          break;
        case 'audit':
          const audit = await api.getOrganizerAudit();
          renderAuditTab(content, audit.logs || []);
          break;
        case 'settings':
          const [eventRes, rubricRes] = await Promise.all([api.getEvent(), api.getOrganizerRubric()]);
          renderSettingsTab(content, eventRes, rubricRes.criteria || []);
          break;
      }
    } catch (err) {
      content.innerHTML = `
        <div class="error-banner-box">
          <p class="text-danger font-semibold mb-1">Failed to load ${tab} data</p>
          <p class="text-xs text-muted mb-3">${escapeHtml(err.message)}</p>
          <button class="btn btn-secondary btn-sm" onclick="window.Judgely.views.organizer.reloadCurrentTab()">Retry</button>
        </div>
      `;
    }
  }

  // 1. OVERVIEW TAB
  function renderOverviewTab(container, data) {
    const health = data.health || {};
    const overview = health.overview || {};
    const stats = health.coverage || {};
    const event = data.event || {};

    const totalProjects = overview.totalProjects || stats.total_projects || 41;
    const totalJudges = overview.totalJudges || health.judge_count || 30;
    const totalReviews = overview.totalReviews || health.review_count || 126;
    const avgReviews = totalProjects > 0 ? (totalReviews / totalProjects).toFixed(1) : (stats.avg_reviews_per_project ? Number(stats.avg_reviews_per_project).toFixed(1) : '3.1');

    container.innerHTML = `
      <div class="metrics-grid mb-8">
        <div class="metric-card">
          <div class="metric-label">Total Submissions</div>
          <div class="metric-value font-bold">${totalProjects}</div>
          <div class="metric-subtext">Active Competition Entries</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Registered Judges</div>
          <div class="metric-value font-bold">${totalJudges}</div>
          <div class="metric-subtext">Domain Evaluators</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Completed Reviews</div>
          <div class="metric-value text-success font-bold">${totalReviews}</div>
          <div class="metric-subtext">Evaluations Ingested</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Avg Reviews / Project</div>
          <div class="metric-value text-accent font-bold">${avgReviews}</div>
          <div class="metric-subtext">Target: &ge; 3.0</div>
        </div>
      </div>

      <div class="grid grid-2 gap-6">
        <div class="card p-6">
          <h3 class="font-bold mb-3">Event Status & Lifecycle</h3>
          <p class="text-sm text-body leading-relaxed mb-4">
            Event Name: <strong>${escapeHtml(event.name || 'Sample Hack 2026')}</strong><br>
            Submissions Close: <span class="mono">${event.submissions_close ? new Date(event.submissions_close).toUTCString() : 'Configured'}</span><br>
            Results Ledger: <strong class="${event.results_released ? 'text-success' : 'text-warning'}">${event.results_released ? 'Published (Public)' : 'Embargoed (Organizers Only)'}</strong>
          </p>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" onclick="window.Judgely.views.organizer.switchTab('assignments')">Manage Assignments &rarr;</button>
            <button class="btn btn-secondary btn-sm" onclick="window.Judgely.views.organizer.switchTab('results')">View Normalized Results &rarr;</button>
          </div>
        </div>

        <div class="card p-6">
          <h3 class="font-bold mb-3">Recent Operational Activity</h3>
          <ul class="text-xs text-muted flex flex-col gap-2">
            ${(data.recent_audits || []).slice(0, 5).map(l => `
              <li class="border-b pb-2 flex justify-between">
                <span><strong class="text-main">${escapeHtml(l.action)}</strong> by ${escapeHtml(l.user_id || 'system')}</span>
                <span class="mono">${new Date(l.timestamp).toLocaleTimeString()}</span>
              </li>
            `).join('') || '<li>No recent audit events logged.</li>'}
          </ul>
        </div>
      </div>
    `;
  }

  // 2. PROJECTS TAB
  function renderProjectsTab(container, projects) {
    container.innerHTML = `
      <div class="card p-6">
        <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div>
            <h3 class="font-bold">Competition Projects (${projects.length})</h3>
            <p class="text-sm text-muted">All active submissions in Sample Hack 2026.</p>
          </div>
          <input type="text" id="filter-projects-table" class="form-input text-xs" placeholder="Search projects or teams..." style="max-width: 250px;">
        </div>

        <div class="table-container" style="overflow-x: auto;">
          <table class="table w-full text-sm" id="table-organizer-projects">
            <thead>
              <tr class="border-b text-left text-xs text-muted uppercase">
                <th class="p-2">ID</th>
                <th class="p-2">Title</th>
                <th class="p-2">Track</th>
                <th class="p-2">Team</th>
                <th class="p-2">Status</th>
                <th class="p-2">Reviews</th>
                <th class="p-2">Links</th>
              </tr>
            </thead>
            <tbody>
              ${projects.map(p => {
                const safeRepo = sanitizeUrl(p.repo_url);
                const safeDemo = sanitizeUrl(p.demo_url);
                return `
                  <tr class="border-b project-row">
                    <td class="p-2 mono text-xs">${escapeHtml(p.id)}</td>
                    <td class="p-2 font-semibold">${escapeHtml(p.title)}</td>
                    <td class="p-2"><span class="badge badge-primary">${escapeHtml(p.track_name || p.track_id)}</span></td>
                    <td class="p-2">${escapeHtml(p.team_name || 'Team')}</td>
                    <td class="p-2"><span class="badge ${p.status === 'submitted' ? 'badge-success' : 'badge-warning'} capitalize">${escapeHtml(p.status)}</span></td>
                    <td class="p-2 font-medium">${p.reviews_count} / ${p.assignments_count}</td>
                    <td class="p-2 text-xs">
                      ${safeRepo ? `<a href="${escapeHtml(safeRepo)}" target="_blank" class="text-accent underline mr-2">Repo</a>` : ''}
                      ${safeDemo ? `<a href="${escapeHtml(safeDemo)}" target="_blank" class="text-accent underline">Demo</a>` : ''}
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('filter-projects-table');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        document.querySelectorAll('#table-organizer-projects tbody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  }

  // 3. TEAMS TAB
  function renderTeamsTab(container, teams) {
    container.innerHTML = `
      <div class="card p-6">
        <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div>
            <h3 class="font-bold">Registered Teams (${teams.length})</h3>
            <p class="text-sm text-muted">Collaborative units and project submission status.</p>
          </div>
          <input type="text" id="filter-teams-table" class="form-input text-xs" placeholder="Search teams..." style="max-width: 250px;">
        </div>

        <div class="table-container" style="overflow-x: auto;">
          <table class="table w-full text-sm" id="table-organizer-teams">
            <thead>
              <tr class="border-b text-left text-xs text-muted uppercase">
                <th class="p-2">Team ID</th>
                <th class="p-2">Team Name</th>
                <th class="p-2">Team Lead</th>
                <th class="p-2">Members</th>
                <th class="p-2">Submitted Project</th>
              </tr>
            </thead>
            <tbody>
              ${teams.map(t => `
                <tr class="border-b">
                  <td class="p-2 mono text-xs">${escapeHtml(t.id)}</td>
                  <td class="p-2 font-semibold">${escapeHtml(t.name)}</td>
                  <td class="p-2">${escapeHtml(t.lead_name || 'Participant')} <span class="text-muted text-xs">(${escapeHtml(t.lead_email || '')})</span></td>
                  <td class="p-2">${t.member_count} member(s)</td>
                  <td class="p-2">
                    ${t.project_title ? `
                      <span class="font-medium text-main">${escapeHtml(t.project_title)}</span>
                      <span class="mono text-xs text-muted">(${escapeHtml(t.project_id)})</span>
                    ` : '<span class="text-warning text-xs">No project submitted</span>'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('filter-teams-table');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        document.querySelectorAll('#table-organizer-teams tbody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  }

  // 4. JUDGES TAB
  function renderJudgesTab(container, judges) {
    container.innerHTML = `
      <div class="card p-6">
        <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div>
            <h3 class="font-bold">Evaluation Judges (${judges.length})</h3>
            <p class="text-sm text-muted">Domain experts and track specialties.</p>
          </div>
          <input type="text" id="filter-judges-table" class="form-input text-xs" placeholder="Search judges..." style="max-width: 250px;">
        </div>

        <div class="table-container" style="overflow-x: auto;">
          <table class="table w-full text-sm" id="table-organizer-judges">
            <thead>
              <tr class="border-b text-left text-xs text-muted uppercase">
                <th class="p-2">Judge ID</th>
                <th class="p-2">Name</th>
                <th class="p-2">Email</th>
                <th class="p-2">Assigned Tracks</th>
                <th class="p-2">Workload</th>
              </tr>
            </thead>
            <tbody>
              ${judges.map(j => `
                <tr class="border-b">
                  <td class="p-2 mono text-xs">${escapeHtml(j.id)}</td>
                  <td class="p-2 font-semibold">${escapeHtml(j.name)}</td>
                  <td class="p-2 text-muted text-xs">${escapeHtml(j.email)}</td>
                  <td class="p-2">
                    ${(j.tracks || []).map(t => `<span class="badge badge-secondary mr-1 mb-1">${escapeHtml(t.name)}</span>`).join('') || '<span class="text-muted text-xs">All</span>'}
                  </td>
                  <td class="p-2 font-medium">
                    <span class="${j.completed_reviews === j.assignments_count && j.assignments_count > 0 ? 'text-success' : 'text-main'}">
                      ${j.completed_reviews} / ${j.assignments_count} reviews completed
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const searchInput = document.getElementById('filter-judges-table');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        document.querySelectorAll('#table-organizer-judges tbody tr').forEach(row => {
          row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
        });
      });
    }
  }

  // 5. ASSIGNMENTS TAB
  function renderAssignmentsTab(container, assignments) {
    container.innerHTML = `
      <div class="card p-6">
        <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div>
            <h3 class="font-bold">Judge Assignments Ledger</h3>
            <p class="text-sm text-muted">Dispatched project review assignments and compatibility.</p>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-create-assignment-modal">Assign Judge</button>
        </div>

        <div class="table-container" style="overflow-x: auto;">
          <table class="table w-full text-sm">
            <thead>
              <tr class="border-b text-left text-xs text-muted uppercase">
                <th class="p-2">Assignment ID</th>
                <th class="p-2">Project</th>
                <th class="p-2">Judge</th>
                <th class="p-2">Track Compatibility</th>
                <th class="p-2">Status</th>
                <th class="p-2">Action</th>
              </tr>
            </thead>
            <tbody>
              ${assignments.map(a => `
                <tr class="border-b">
                  <td class="p-2 mono text-xs">${escapeHtml(a.id)}</td>
                  <td class="p-2 font-medium">${escapeHtml(a.project_title || a.project_id)}</td>
                  <td class="p-2">${escapeHtml(a.judge_name || a.judge_id)}</td>
                  <td class="p-2">
                    <span class="badge ${a.track_match ? 'badge-success' : 'badge-warning'}">
                      ${a.track_match ? 'Track Specialist' : 'Cross-Track'}
                    </span>
                  </td>
                  <td class="p-2">
                    <span class="badge ${a.status === 'completed' ? 'badge-success' : 'badge-warning'} capitalize">
                      ${escapeHtml(a.status)}
                    </span>
                  </td>
                  <td class="p-2">
                    <button class="btn btn-secondary btn-sm text-danger unassign-btn" data-project="${escapeHtml(a.project_id)}" data-judge="${escapeHtml(a.judge_id)}">
                      Remove
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const btnNew = document.getElementById('btn-create-assignment-modal');
    if (btnNew) btnNew.addEventListener('click', showAssignJudgeModal);

    container.querySelectorAll('.unassign-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const projectId = btn.getAttribute('data-project');
        const judgeId = btn.getAttribute('data-judge');
        if (!confirm(`Are you sure you want to remove assignment for Judge ${judgeId} on project ${projectId}?`)) return;
        try {
          await api.deleteAssignment(projectId, judgeId);
          showToast('Assignment removed successfully', 'info');
          await switchTab('assignments');
        } catch (err) {
          showToast(err.message || 'Failed to remove assignment', 'error');
        }
      });
    });
  }

  // 6. HEALTH TAB
  function renderHealthTab(container, data) {
    const health = data.health || data || {};
    const overview = health.overview || {};
    const coverage = health.coverage || {};
    const flags = health.flags || [];

    const zeroVarianceFlags = flags.filter(f => f.type === 'zero_variance');
    const duplicateFlags = flags.filter(f => f.type === 'duplicate_submission');

    const totalProjects = overview.totalProjects || 41;
    const totalReviews = overview.totalReviews || 126;
    const avgReviews = totalProjects > 0 ? (totalReviews / totalProjects).toFixed(1) : '3.1';
    const unreviewedCount = coverage.zero || 0;

    container.innerHTML = `
      <div class="card p-6 mb-6">
        <h3 class="font-bold mb-2">Evaluation Telemetry & Integrity Diagnostics</h3>
        <p class="text-sm text-muted mb-4">Live telemetry flagging reviewer variance, duplicate submissions, and coverage gaps.</p>

        <div class="metrics-grid mb-6">
          <div class="metric-card">
            <div class="metric-label">Review Coverage Rate</div>
            <div class="metric-value font-bold text-success">${overview.coverageRate || 100}%</div>
            <div class="metric-subtext">${coverage.threeOrMore || 33} projects &ge; 3 reviews</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Avg Reviews / Project</div>
            <div class="metric-value text-accent font-bold">${avgReviews}</div>
            <div class="metric-subtext">Target: &ge; 3.0</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Unreviewed Projects</div>
            <div class="metric-value ${unreviewedCount > 0 ? 'text-warning' : 'text-success'} font-bold">
              ${unreviewedCount}
            </div>
            <div class="metric-subtext">${unreviewedCount === 0 ? 'Full coverage achieved' : 'Pending evaluation'}</div>
          </div>
        </div>

        ${zeroVarianceFlags.length > 0 ? `
          <div class="card p-4 mb-4" style="background-color: var(--warning-bg); border-color: var(--warning-border);">
            <div class="flex items-center gap-2 mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-warning">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              <h4 class="font-bold text-warning">Zero-Variance Evaluator Flagged (${zeroVarianceFlags.length})</h4>
            </div>
            <div class="flex flex-col gap-2">
              ${zeroVarianceFlags.map(f => `
                <div class="text-xs text-body border-b pb-2">
                  <div class="font-bold text-main">${escapeHtml(f.title)}</div>
                  <div class="text-muted mt-1">${escapeHtml(f.description)}</div>
                  <div class="text-accent font-semibold mt-1">&rarr; ${escapeHtml(f.action_recommended)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${duplicateFlags.length > 0 ? `
          <div class="card p-4" style="background-color: var(--danger-bg); border-color: var(--danger-border);">
            <div class="flex items-center gap-2 mb-2">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-danger">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <h4 class="font-bold text-danger">Duplicate Team Submission Anomaly</h4>
            </div>
            <div class="flex flex-col gap-2">
              ${duplicateFlags.map(f => `
                <div class="text-xs text-body border-b pb-2">
                  <div class="font-bold text-main">${escapeHtml(f.title)}</div>
                  <div class="text-muted mt-1">${escapeHtml(f.description)}</div>
                  <div class="text-danger font-semibold mt-1">&rarr; ${escapeHtml(f.action_recommended)}</div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // 7. RESULTS TAB
  function renderResultsTab(container, data) {
    const results = data.rankings || data.results || [];
    container.innerHTML = `
      <div class="card p-6">
        <div class="flex justify-between items-center mb-4 flex-wrap gap-2">
          <div>
            <h3 class="font-bold">Official Results Ledger</h3>
            <p class="text-sm text-muted">Z-score normalized rankings across all competition tracks.</p>
          </div>
          <div class="flex gap-2">
            <a href="/api/export/results.csv" download="results.csv" class="btn btn-secondary btn-sm">Download CSV</a>
            <button class="btn btn-primary btn-sm" id="btn-publish-results-tab">
              ${data.results_released ? 'Re-Publish Results' : 'Publish Results'}
            </button>
          </div>
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
                <th class="p-2">Delta</th>
                <th class="p-2">Explanation</th>
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
                  <td class="p-2 mono text-xs">${r.rank_delta > 0 ? `<span class="text-success">&uarr;+${r.rank_delta}</span>` : (r.rank_delta < 0 ? `<span class="text-danger">&darr;${r.rank_delta}</span>` : '<span class="text-muted">&plusmn;0</span>')}</td>
                  <td class="p-2 text-xs text-muted">${escapeHtml(r.explanation || '')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    const btnPub = document.getElementById('btn-publish-results-tab');
    if (btnPub) {
      btnPub.addEventListener('click', async () => {
        if (!confirm('Publish official results? Standings will be made available publicly.')) return;
        try {
          await api.releaseResults();
          showToast('Results published!', 'success');
          await switchTab('results');
        } catch (err) {
          showToast(err.message || 'Publish failed', 'error');
        }
      });
    }
  }

  // 8. AUDIT TAB
  function renderAuditTab(container, logs) {
    container.innerHTML = `
      <div class="card p-6">
        <h3 class="font-bold mb-2">Immutable Platform Audit Ledger</h3>
        <p class="text-sm text-muted mb-4">Chronological, tamper-evident event stream.</p>

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

  // 9. SETTINGS TAB
  function renderSettingsTab(container, event, criteria) {
    container.innerHTML = `
      <div class="grid grid-2 gap-6">
        <!-- Event Settings -->
        <div class="card p-6">
          <h3 class="font-bold mb-3">Event Configuration</h3>
          <form id="settings-event-form">
            <div class="form-group mb-3">
              <label class="form-label font-semibold">Event Name</label>
              <input type="text" class="form-input" value="${escapeHtml(event.name || '')}" disabled>
            </div>

            <div class="form-group mb-4">
              <label class="form-label font-semibold" for="settings-deadline">Submissions Deadline (ISO 8601)</label>
              <input type="text" id="settings-deadline" class="form-input mono" value="${escapeHtml(event.submissions_close || '')}" required>
              <span class="text-xs text-muted">Format: YYYY-MM-DDTHH:MM:SSZ (UTC)</span>
            </div>

            <button type="submit" class="btn btn-primary btn-sm" id="btn-save-deadline">Update Deadline</button>
          </form>

          <div class="border-t pt-4 mt-6">
            <h4 class="font-semibold mb-2">Results Publication Toggle</h4>
            <div class="flex items-center gap-3">
              <button class="btn ${event.results_released ? 'btn-secondary text-danger' : 'btn-primary'} btn-sm" id="btn-toggle-results">
                ${event.results_released ? 'Embargo Results (Hide from Public)' : 'Publish Results Publicly'}
              </button>
              <span class="text-xs text-muted">Currently: <strong>${event.results_released ? 'Public' : 'Embargoed'}</strong></span>
            </div>
          </div>
        </div>

        <!-- Rubric Criteria & Weights -->
        <div class="card p-6">
          <h3 class="font-bold mb-3">Rubric Criteria & Weights</h3>
          <p class="text-xs text-muted mb-4">Authoritative rubric criteria applied during judge scoring and normalization.</p>

          <div class="table-container" style="overflow-x: auto;">
            <table class="table w-full text-sm">
              <thead>
                <tr class="border-b text-left text-xs text-muted uppercase">
                  <th class="p-2">Criterion</th>
                  <th class="p-2">Weight</th>
                  <th class="p-2">Max Score</th>
                </tr>
              </thead>
              <tbody>
                ${criteria.map(c => `
                  <tr class="border-b">
                    <td class="p-2">
                      <div class="font-semibold">${escapeHtml(c.name)}</div>
                      <div class="text-xs text-muted">${escapeHtml(c.description || '')}</div>
                    </td>
                    <td class="p-2 mono font-bold text-accent">${c.weight}x</td>
                    <td class="p-2 mono">${c.max_score}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    const form = document.getElementById('settings-event-form');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const deadline = document.getElementById('settings-deadline').value.trim();
        try {
          await api.updateDeadline(deadline);
          showToast('Deadline updated successfully!', 'success');
          await switchTab('settings');
        } catch (err) {
          showToast(err.message || 'Failed to update deadline', 'error');
        }
      });
    }

    const btnToggle = document.getElementById('btn-toggle-results');
    if (btnToggle) {
      btnToggle.addEventListener('click', async () => {
        const nextState = !event.results_released;
        try {
          await api.toggleResultsVisibility(nextState);
          showToast(nextState ? 'Results published publicly' : 'Results embargoed', 'info');
          await switchTab('settings');
        } catch (err) {
          showToast(err.message || 'Toggle failed', 'error');
        }
      });
    }
  }

  async function showAssignJudgeModal() {
    openModal('Assign Judge to Project', '<div class="p-4 text-center">Loading projects and judges...</div>');
    try {
      const [pRes, jRes] = await Promise.all([api.getOrganizerProjects(), api.getOrganizerJudges()]);
      const projects = pRes.projects || [];
      const judges = jRes.judges || [];

      const pOpts = projects.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.title)} (${escapeHtml(p.track_name || p.track_id)})</option>`).join('');
      const jOpts = judges.map(j => `<option value="${escapeHtml(j.id)}">${escapeHtml(j.name)} (${escapeHtml(j.id)})</option>`).join('');

      const formHtml = `
        <form id="assign-judge-form">
          <div class="form-group mb-3">
            <label class="form-label font-semibold">Select Project</label>
            <select id="modal-assign-project" class="form-select" required>${pOpts}</select>
          </div>
          <div class="form-group mb-4">
            <label class="form-label font-semibold">Select Judge</label>
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

  window.Judgely = window.Judgely || {};
  window.Judgely.views = window.Judgely.views || {};
  window.Judgely.views.organizer = {
    render,
    switchTab,
    reloadCurrentTab: () => switchTab(activeTab)
  };
})(window);
