/**
 * TE Connectivity M&A Integration Portal - Supporting Teams Client Controller
 * Manages HRSS, Regional HR, Legal, and Total Rewards isolated workflows.
 * Implements persistent state storage, 4-pillar dashboard updates, and inline role creation.
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initial State Definitions
  const teamData = {
    hrss: {
      icon: "🏢",
      title: "HR Shared Services (HRSS)",
      desc: "Managing IT credentials, badging systems, hardware migrations, and system directory synchronizations.",
      bulletins: [
        { id: "b1", title: "SSO Sync Alert", text: "SSO integration is running at 90% completion. Remind EMEA to update profiles." },
        { id: "b2", title: "Hardware Distribution", text: "Laptops shipped to Toulouse. Roster matching scheduled for tomorrow." }
      ],
      cultureScore: 82,
      cultureDesc: "IT synchronization matches integration metrics, ensuring hardware deployments have minimal disruption on local employee sentiment.",
      roles: [
        { name: "Linus Torvalds", spec: "SSO Architecture Specialist" },
        { name: "Grace Hopper", spec: "Directory Records Lead" }
      ],
      tasks: [
        { id: "verify_sso", title: "Verify corporate Active Directory SSO sync", completed: false },
        { id: "badge_hardware", title: "Deploy security badges and employee notebooks", completed: false },
        { id: "email_migrations", title: "Re-map system email routing tables", completed: false },
        { id: "intranet_access", title: "Provision global intranet portal access", completed: false },
        { id: "helpdesk_cutover", title: "Finalize Tier-1 IT Support cutover strategy", completed: false }
      ]
    },
    regional: {
      icon: "🌍",
      title: "Regional HR Localization",
      desc: "Aligning employee banding grades, collective bargaining agreements, and regional policies.",
      bulletins: [
        { id: "r1", title: "Banding Match", text: "Munich tariff negotiations complete. Grade matching matches corporate standards." },
        { id: "r2", title: "Compliance Training", text: "InfoSec training completion rate is at 74% in APAC." }
      ],
      cultureScore: 78,
      cultureDesc: "Regional alignment scores verify localized handbook integrations. Leadership presence remains strong during site meetings.",
      roles: [
        { name: "Sarah Connor", spec: "EMEA Onboarding Buddy Manager" },
        { name: "Jean-Luc Picard", spec: "APAC Integration Lead" }
      ],
      tasks: [
        { id: "grade_alignment", title: "Correlate legacy employee banding grades", completed: false },
        { id: "handbook_signs", title: "Collect handbook policy confirmation signatures", completed: false },
        { id: "buddy_pairings", title: "Launch regional onboarding buddy partnerships", completed: false },
        { id: "labor_council", title: "Align with local work councils and unions", completed: false },
        { id: "manager_training", title: "Deploy local leadership integration training", completed: false }
      ]
    },
    legal: {
      icon: "⚖️",
      title: "Legal & Patent Dissolution",
      desc: "Governing regulatory filings, NDA audits, and patent trademark transfers.",
      bulletins: [
        { id: "l1", title: "Antitrust Cleared", text: "Antitrust filings successfully approved by regional desks." },
        { id: "l2", title: "IP Deeds Filed", text: "Apex patent re-registrations completed for central products." }
      ],
      cultureScore: 95,
      cultureDesc: "Regulatory clearances are IMO certified. Audited contracts verify full compliance with regional synergy goals.",
      roles: [
        { name: "Harvey Specter", spec: "M&A Chief Counsel" },
        { name: "Elle Woods", spec: "Trademark Attorney" }
      ],
      tasks: [
        { id: "antitrust_filing", title: "Secure antitrust regulatory clearances", completed: false },
        { id: "deed_transfers", title: "Re-register patents and trademarks to TE", completed: false },
        { id: "contract_audits", title: "Audit vendor contracts and confidentiality clauses", completed: false },
        { id: "entity_dissolution", title: "File legal entity dissolution documentation", completed: false },
        { id: "compliance_training", title: "Mandate anti-bribery and compliance checks", completed: false }
      ]
    },
    rewards: {
      icon: "💵",
      title: "Total Rewards & Compensation",
      desc: "Harmonizing pension plans, health insurances, and equity matching options.",
      bulletins: [
        { id: "w1", title: "Insurance Bridge", text: "Joint health insurance contracts negotiated with provider." },
        { id: "w2", title: "Payroll Schedule", text: "Tax schedules successfully linked. Payroll transfer begins next month." }
      ],
      cultureScore: 89,
      cultureDesc: "Compensation adjustments have been received with high employee morale. Pension transfers are running smoothly.",
      roles: [
        { name: "Warren Buffett", spec: "Pension Fund Advisory Chair" },
        { name: "Melinda Gates", spec: "Benefits Optimization Consultant" }
      ],
      tasks: [
        { id: "benefits_harmony", title: "Harmonize health benefits & pension plans", completed: false },
        { id: "payroll_sync", title: "Consolidate legal entity payroll systems", completed: false },
        { id: "equity_matching", title: "Map equity awards to TE corporate schemes", completed: false },
        { id: "bonus_structure", title: "Calibrate annual incentive bonus structures", completed: false },
        { id: "severance_planning", title: "Review retention and severance packages", completed: false }
      ]
    }
  };

  // 2. State persistence binders
  let activeTeam = 'hrss';
  const localTasksKey = 'supporting_tasks_state_v1';
  const localRolesKey = 'supporting_roles_state_v1';

  // Load states from LocalStorage if present, else seed
  let savedTasks = JSON.parse(localStorage.getItem(localTasksKey));
  if (!savedTasks) {
    savedTasks = {};
    for (const team in teamData) {
      savedTasks[team] = {};
      teamData[team].tasks.forEach(t => {
        savedTasks[team][t.id] = false;
      });
    }
    localStorage.setItem(localTasksKey, JSON.stringify(savedTasks));
  }

  let savedRoles = JSON.parse(localStorage.getItem(localRolesKey));
  if (!savedRoles) {
    savedRoles = {};
    for (const team in teamData) {
      savedRoles[team] = [...teamData[team].roles];
    }
    localStorage.setItem(localRolesKey, JSON.stringify(savedRoles));
  }

  // 3. UI Element Bindings
  const tabButtons = document.querySelectorAll('.supporting-nav-tabs .supporting-tab-btn');
  const teamIcon = document.getElementById('active-team-icon');
  const teamTitle = document.getElementById('active-team-title');
  const teamDesc = document.getElementById('active-team-desc');

  const commList = document.getElementById('support-comm-list');
  const cultureScore = document.getElementById('support-culture-score');
  const cultureDesc = document.getElementById('support-culture-desc');
  const rolesList = document.getElementById('support-roles-list');
  const taskChecklist = document.getElementById('support-onboarding-progress');

  const addAgentForm = document.getElementById('add-support-role-form');
  const newAgentNameInput = document.getElementById('new-agent-name');
  const newAgentSpecInput = document.getElementById('new-agent-spec');

  // 4. Render active team view
  function renderActiveTeam() {
    const data = teamData[activeTeam];
    
    // Header updates with smooth transition
    teamIcon.textContent = data.icon;
    teamTitle.textContent = data.title;
    teamDesc.textContent = data.desc;

    // A. Render Communication list
    commList.innerHTML = '';
    data.bulletins.forEach(bull => {
      const card = document.createElement('div');
      card.style.cssText = `
        background: rgba(36, 76, 90, 0.02);
        border: 1px solid var(--border-color);
        border-radius: 6px;
        padding: 0.65rem 0.85rem;
        transition: transform 0.2s, border-color 0.2s;
      `;
      card.innerHTML = `
        <h5 style="margin: 0 0 0.2rem 0; color: var(--te-dark-teal); font-size: 0.82rem; font-weight: bold;">📣 ${bull.title}</h5>
        <p style="margin: 0; font-size: 0.76rem; color: var(--text-secondary); line-height: 1.35;">${bull.text}</p>
      `;
      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateX(2px)';
        card.style.borderColor = 'var(--te-orange)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'none';
        card.style.borderColor = 'var(--border-color)';
      });
      commList.appendChild(card);
    });

    // B. Render Culture Metrics
    cultureScore.textContent = `${data.cultureScore}%`;
    cultureDesc.textContent = data.cultureDesc;

    // C. Render Roles Registry
    rolesList.innerHTML = '';
    const activeRoles = savedRoles[activeTeam];
    activeRoles.forEach((role, idx) => {
      const row = document.createElement('div');
      row.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: rgba(36, 76, 90, 0.02);
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        border: 1px solid rgba(0,0,0,0.03);
        font-size: 0.78rem;
        transition: background-color 0.2s;
      `;
      row.innerHTML = `
        <div>
          <strong style="color: var(--te-dark-teal);">${role.name}</strong>
          <span style="color: var(--text-dim); display: block; font-size: 0.7rem;">${role.spec}</span>
        </div>
        <button type="button" class="btn-revoke-agent" data-idx="${idx}" style="background: none; border: none; color: #EF4444; font-size: 0.95rem; cursor: pointer; opacity: 0.7; transition: opacity 0.2s;" title="Revoke Agent Access">×</button>
      `;
      row.addEventListener('mouseenter', () => {
        row.style.backgroundColor = 'rgba(36, 76, 90, 0.05)';
        row.querySelector('.btn-revoke-agent').style.opacity = '1';
      });
      row.addEventListener('mouseleave', () => {
        row.style.backgroundColor = 'rgba(36, 76, 90, 0.02)';
        row.querySelector('.btn-revoke-agent').style.opacity = '0.7';
      });
      rolesList.appendChild(row);
    });

    // D. Render Onboarding Checklist
    taskChecklist.innerHTML = '';
    
    // Add Progress Bar Header
    const completedTasks = data.tasks.filter(t => savedTasks[activeTeam][t.id]).length;
    const progressPercent = Math.round((completedTasks / data.tasks.length) * 100) || 0;
    
    const progressHeader = document.createElement('div');
    progressHeader.style.cssText = 'margin-bottom: 0.5rem;';
    progressHeader.innerHTML = `
      <div style="display: flex; justify-content: space-between; font-size: 0.75rem; font-weight: bold; color: var(--te-dark-teal); margin-bottom: 0.35rem;">
        <span>Action Plan Progress</span>
        <span>${progressPercent}%</span>
      </div>
      <div style="height: 6px; background: rgba(36, 76, 90, 0.1); border-radius: 3px; overflow: hidden;">
        <div style="height: 100%; width: ${progressPercent}%; background: var(--te-orange); transition: width 0.3s ease;"></div>
      </div>
    `;
    taskChecklist.appendChild(progressHeader);

    data.tasks.forEach(task => {
      const isChecked = savedTasks[activeTeam][task.id];
      const item = document.createElement('div');
      item.style.cssText = `
        display: flex;
        align-items: flex-start;
        gap: 0.5rem;
        background: ${isChecked ? 'rgba(16,185,129,0.02)' : 'transparent'};
        border: 1px solid ${isChecked ? 'rgba(16,185,129,0.15)' : 'var(--border-color)'};
        padding: 0.65rem;
        border-radius: 6px;
        transition: all 0.25s ease;
      `;
      item.innerHTML = `
        <input type="checkbox" data-task-id="${task.id}" ${isChecked ? 'checked' : ''} style="margin-top: 0.15rem; cursor: pointer; accent-color: var(--te-orange); width: 16px; height: 16px;">
        <span style="font-size: 0.78rem; line-height: 1.4; color: ${isChecked ? 'var(--text-secondary)' : 'var(--text-primary)'}; text-decoration: ${isChecked ? 'line-through' : 'none'}; cursor: pointer;">
          ${task.title}
        </span>
      `;
      
      const check = item.querySelector('input');
      const textSpan = item.querySelector('span');

      const toggleCheck = () => {
        const nextVal = !check.checked;
        check.checked = nextVal;
        savedTasks[activeTeam][task.id] = nextVal;
        localStorage.setItem(localTasksKey, JSON.stringify(savedTasks));
        renderActiveTeam();
      };

      check.addEventListener('change', () => {
        savedTasks[activeTeam][task.id] = check.checked;
        localStorage.setItem(localTasksKey, JSON.stringify(savedTasks));
        renderActiveTeam();
      });

      textSpan.addEventListener('click', toggleCheck);
      taskChecklist.appendChild(item);
    });
  }

  // 5. Tab switcher interaction
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      activeTeam = btn.getAttribute('data-support-team');

      // Grid visual fade-in animation
      const grid = document.querySelector('.supporting-grid');
      if (grid) {
        grid.style.opacity = '0';
        grid.style.transform = 'translateY(10px)';
        setTimeout(() => {
          renderActiveTeam();
          grid.style.transition = 'all 0.35s cubic-bezier(0.4, 0, 0.2, 1)';
          grid.style.opacity = '1';
          grid.style.transform = 'none';
        }, 150);
      } else {
        renderActiveTeam();
      }
    });
  });

  // 6. Handle agent creation
  addAgentForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = newAgentNameInput.value.trim();
    const spec = newAgentSpecInput.value.trim();

    if (name.length > 0 && spec.length > 0) {
      savedRoles[activeTeam].push({ name, spec });
      localStorage.setItem(localRolesKey, JSON.stringify(savedRoles));
      newAgentNameInput.value = '';
      newAgentSpecInput.value = '';
      renderActiveTeam();
    }
  });

  // 7. Handle agent revoking
  rolesList.addEventListener('click', (e) => {
    const revokeBtn = e.target.closest('.btn-revoke-agent');
    if (!revokeBtn) return;
    const idx = parseInt(revokeBtn.getAttribute('data-idx'));
    savedRoles[activeTeam].splice(idx, 1);
    localStorage.setItem(localRolesKey, JSON.stringify(savedRoles));
    renderActiveTeam();
  });

  // Initial render
  renderActiveTeam();
});
