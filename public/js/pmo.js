/**
 * TE Connectivity M&A Integration Portal - PMO Client Controller
 * Coordinates and connects HR, IT, Finance, Sales, Legal, R&D, and Operations integrations.
 * Implements state management, persistence, blocker constraints, and timeline gating.
 */

document.addEventListener('DOMContentLoaded', () => {
  
  // 1. Initial State Definition
  const tracks = {
    hr: { title: "HR & Talent", icon: "👤", color: "#3B82F6", weight: 1.0 },
    it: { title: "IT & Cybersecurity", icon: "💻", color: "#10B981", weight: 1.2 },
    finance: { title: "Finance & Compliance", icon: "💵", color: "#F59E0B", weight: 1.0 },
    sales: { title: "Sales & Marketing", icon: "🤝", color: "#8B5CF6", weight: 1.1 },
    legal: { title: "Legal & IP", icon: "⚖️", color: "#EC4899", weight: 0.9 },
    rd: { title: "R&D & Engineering", icon: "🧪", color: "#06B6D4", weight: 1.2 },
    ops: { title: "Operations & Supply Chain", icon: "⚙️", color: "#E98300", weight: 1.3 }
  };

  const defaultTasks = {
    hr: [
      { id: "hr_benefits", title: "Harmonize benefits & pensions", desc: "Align corporate health insurance plans, pension transfer structures, and 401(k) matching guidelines.", weight: 3 },
      { id: "hr_banding", title: "Align grade salary banding", desc: "Correlate legacy employee bands to official TE Connectivity standard bands.", weight: 4 },
      { id: "hr_buddy", title: "Launch Integration Buddy pairings", desc: "Assign legacy site reports to native integration buddies for cultural onboarding support.", weight: 2 },
      { id: "hr_handbook", title: "Distribute unified employee code", desc: "Deploy unified code of conduct handbook and collect signatures.", weight: 1 }
    ],
    it: [
      { id: "it_ssn_bridge", title: "Deploy unified SSO login", desc: "Set up corporate Single Sign-On accounts and align security credentials.", weight: 4 },
      { id: "it_vpn_bridge", title: "Establish secure VPN paths", desc: "Bridge legacy subnets and secure communication lanes with target servers.", weight: 3 },
      { id: "it_hardware_swap", title: "Provision business badges & notebooks", desc: "Deploy corporate hardware and activate network-enabled site security badges.", weight: 2 },
      { id: "it_cyber_audit", title: "Execute database threat audit", desc: "Scan legacy filesystems and databases for active vulnerabilities.", weight: 1 }
    ],
    finance: [
      { id: "fin_ledger_convert", title: "Harmonize chart of accounts", desc: "Convert acquired ledger balance matrices to the unified global ledger schema.", weight: 4 },
      { id: "fin_banking_sync", title: "Consolidate legal-entity banking", desc: "Audit and reconcile active local bank channels into unified treasury pipelines.", weight: 3 },
      { id: "fin_tax_filings", title: "Align joint fiscal reporting cadences", desc: "Incorporate acquired entity data into active corporate tax registers.", weight: 2 },
      { id: "fin_procure_policy", title: "Align corporate purchasing policies", desc: "Deploy purchasing delegation guidelines and audit procurement vendor sheets.", weight: 1 }
    ],
    sales: [
      { id: "sales_crm_sync", title: "Migrate CRM accounts pipeline", desc: "Merge legacy customer pipeline database with target CRM accounts data.", weight: 4 },
      { id: "sales_price_align", title: "Harmonize price catalogue sheets", desc: "Align legacy margins and pricing models to corporate standard matrix guidelines.", weight: 3 },
      { id: "sales_branding_swap", title: "Rebrand customer-facing collaterals", desc: "Update sales decks, pamphlets, site branding boards to TE standards.", weight: 1 },
      { id: "sales_training_pmi", title: "Conduct catalog cross-training", desc: "Train legacy sales reps on target products and commercial processes.", weight: 2 }
    ],
    legal: [
      { id: "leg_antitrust_clear", title: "Obtain antitrust regulatory clear", desc: "File and secure legal antitrust regulatory clearance across regional desks.", weight: 4 },
      { id: "leg_patent_transfer", title: "Re-register IP & patent deeds", desc: "File legal paperwork transferring acquired patents and trademarks to TE Connectivity.", weight: 3 },
      { id: "leg_contract_nda", title: "Review regional vendor contracts", desc: "Audit active contracts, NDA terms, and client obligation metrics.", weight: 2 },
      { id: "leg_corporate_filing", title: "Submit regional merger paperwork", desc: "Submit corporate legal dissolution and unification documents to local state bureaus.", weight: 1 }
    ],
    rd: [
      { id: "rd_codebase_repo", title: "Sync codebase to unified repository", desc: "Migrate acquired R&D software codebase directories into central corporate Git hosts.", weight: 3 },
      { id: "rd_schematics_map", title: "Standardize CAD & hardware maps", desc: "Map and index acquired mechanical designs and product schematics.", weight: 4 },
      { id: "rd_patents_eval", title: "Incorporate active patent records", desc: "Log active patent details in the global product planning register.", weight: 2 },
      { id: "rd_tools_license", title: "Harmonize compiler licensing matrix", desc: "Align CAD, MATLAB, and IDE compiler licenses to corporate matrices.", weight: 1 }
    ],
    ops: [
      { id: "ops_manufacture_run", title: "Certify manufacturing safety standards", desc: "Perform extensive on-site plant safety checks to secure official safety certifications.", weight: 4 },
      { id: "ops_sku_harmonize", title: "Re-index inventory SKU codes", desc: "Map legacy warehouses inventory codes to central inventory management listings.", weight: 3 },
      { id: "ops_logistics_route", title: "Consolidate shipping channels", desc: "Merge regional delivery routes and global carriers contracts.", weight: 2 },
      { id: "ops_equipment_tag", title: "Audit facility capital equipment", desc: "Perform asset tagging and depreciation audit on all manufacturing machinery.", weight: 1 }
    ]
  };

  const defaultBlockers = [
    {
      id: "blocker_sso",
      title: "HR Employee Records SSO Sync Failure",
      desc: "Legacy directory record mismatch locks directory syncs, preventing deployment of unified SSO portals.",
      impactTracks: ["hr", "it"],
      maxCap: 50, // Capped at 50%
      buttonLabel: "⚡ Resolve SSO Sync Blocker",
      resolved: false
    },
    {
      id: "blocker_patent",
      title: "Patent Transfer Trademark Audits Delayed",
      desc: "Delays in trademark approvals prevent codebase sharing, locking R&D repository syncing.",
      impactTracks: ["rd", "legal"],
      maxCap: 40, // Capped at 40%
      buttonLabel: "⚡ Resolve Patent Audit Blocker",
      resolved: false
    },
    {
      id: "blocker_erp",
      title: "Manufacturing ERP Ledger Consolidation Error",
      desc: "Warehouse SKU inventory valuation ledger mismatches block listing joint product catalog items in Sales CRM.",
      impactTracks: ["finance", "ops"],
      maxCap: 45, // Capped at 45%
      buttonLabel: "⚡ Resolve ERP Valuation Blocker",
      resolved: false
    }
  ];

  // 2. State & Storage Key Definitions
  let tasksKey = 'pmo_tasks_state';
  let blockersKey = 'pmo_blockers_state';
  let tabKey = 'pmo_active_tab';

  let pmoTasksState = {};
  let pmoBlockersState = defaultBlockers;
  let activeTab = 'hr';

  // Bind elements
  const dayBadge = document.getElementById('pmo-timeline-badge');

  // PMO 4-Pillar Tabs Switcher
  const pmoTabBtns = document.querySelectorAll('.supporting-nav-tabs .supporting-tab-btn');
  const pmoTabSections = document.querySelectorAll('.pmo-tab-section');

  pmoTabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      pmoTabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetTab = btn.getAttribute('data-pmo-tab');
      pmoTabSections.forEach(sec => {
        sec.style.display = 'none';
        sec.classList.remove('active');
      });

      const targetSection = document.getElementById(`pmo-pillar-${targetTab}`);
      if (targetSection) {
        targetSection.style.display = 'block';
        targetSection.classList.add('active');
      }
    });
  });
  const switcherContainer = document.getElementById('demo-mode-switcher-container');
  const switcherIndicator = document.getElementById('demo-switcher-indicator');
  const switcherText = document.getElementById('demo-switcher-text');

  // Header switcher click event
  if (switcherContainer) {
    switcherContainer.addEventListener('click', () => {
      fetch('/api/settings')
        .then(res => res.json())
        .then(settings => {
          const nextDemoMode = settings.demoMode === false;
          fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ demoMode: nextDemoMode })
          })
          .then(res => res.json())
          .then(() => {
            window.location.reload();
          });
        })
        .catch(err => console.error("Error toggling demo mode:", err));
    });
  }

  // Load configuration and routes Wizard vs Dashboard
  function loadPageSettings() {
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        const isDemo = settings.demoMode !== false;
        
        // Dynamic key binding for data isolation
        tasksKey = isDemo ? 'pmo_tasks_state' : 'custom_pmo_tasks_state';
        blockersKey = isDemo ? 'pmo_blockers_state' : 'custom_pmo_blockers_state';
        tabKey = isDemo ? 'pmo_active_tab' : 'custom_pmo_active_tab';

        // Load states
        pmoTasksState = JSON.parse(localStorage.getItem(tasksKey)) || {};
        pmoBlockersState = JSON.parse(localStorage.getItem(blockersKey)) || defaultBlockers;
        activeTab = localStorage.getItem(tabKey) || 'hr';

        // Seed tasks if empty
        if (Object.keys(pmoTasksState).length === 0) {
          for (const track in defaultTasks) {
            pmoTasksState[track] = {};
            defaultTasks[track].forEach(task => {
              pmoTasksState[track][task.id] = false;
            });
          }
          localStorage.setItem(tasksKey, JSON.stringify(pmoTasksState));
        }

        // Header switcher UI updates
        if (switcherIndicator && switcherText) {
          switcherIndicator.style.background = isDemo ? '#10B981' : '#3B82F6';
          switcherText.textContent = isDemo ? 'DEMO ACTIVE' : 'CUSTOM M&A';
          switcherText.style.color = isDemo ? '#10B981' : '#3B82F6';
          switcherContainer.title = isDemo ? 'Click to enter custom M&A setup' : 'Running on custom integration databases';
        }

        // Bind timeline day
        const activeDay = settings.timeTravelDay || settings.timelineDay || localStorage.getItem('timeline_day') || 12;
        if (dayBadge) {
          dayBadge.textContent = `INTEGRATION DAY: ${activeDay}`;
        }

        // Route between Wizard and Dashboard
        const wizardContainer = document.getElementById('pmo-onboarding-wizard');
        const dashboardContent = document.getElementById('pmo-dashboard-content');

        if (!isDemo && (!settings.targetCompany || !settings.pmoCustomSetupComplete)) {
          if (wizardContainer) wizardContainer.style.display = 'block';
          if (dashboardContent) dashboardContent.style.display = 'none';
          initOnboardingWizard();
        } else {
          if (wizardContainer) wizardContainer.style.display = 'none';
          if (dashboardContent) dashboardContent.style.display = 'block';
          
          if (!isDemo && settings.targetCompany) {
            updateDashboardCompanyLabels(settings.targetCompany);
          }

          // Initial calls for standard dashboard
          renderAll();
          loadActiveHrbps();
          loadPmoCommunications();
        }
      })
      .catch(err => {
        console.error("Failed loading settings:", err);
        // Fallback: load normal dashboard
        tasksKey = 'pmo_tasks_state';
        blockersKey = 'pmo_blockers_state';
        tabKey = 'pmo_active_tab';
        pmoTasksState = JSON.parse(localStorage.getItem(tasksKey)) || {};
        pmoBlockersState = JSON.parse(localStorage.getItem(blockersKey)) || defaultBlockers;
        activeTab = localStorage.getItem(tabKey) || 'hr';
        renderAll();
        loadActiveHrbps();
        loadPmoCommunications();
      });
  }

  // 3. Overall Calculations
  function calculateProgress() {
    const trackProgress = {};
    
    // Calculate raw track percentage
    for (const track in defaultTasks) {
      let totalWeight = 0;
      let completedWeight = 0;
      
      defaultTasks[track].forEach(task => {
        totalWeight += task.weight;
        if (pmoTasksState[track] && pmoTasksState[track][task.id]) {
          completedWeight += task.weight;
        }
      });
      
      let rawPct = Math.round((completedWeight / totalWeight) * 100);
      
      // Enforce Blocker Caps
      let activeCap = 100;
      let activeBlockerDesc = null;
      
      pmoBlockersState.forEach(blocker => {
        if (!blocker.resolved && blocker.impactTracks.includes(track)) {
          if (blocker.maxCap < activeCap) {
            activeCap = blocker.maxCap;
            activeBlockerDesc = blocker.title;
          }
        }
      });
      
      let cappedPct = Math.min(rawPct, activeCap);
      trackProgress[track] = {
        pct: cappedPct,
        rawPct: rawPct,
        capped: rawPct > activeCap,
        capLimit: activeCap,
        blockerName: activeBlockerDesc
      };
    }
    
    // Calculate Overall Synergy Score
    let totalScore = 0;
    let totalWeight = 0;
    for (const track in tracks) {
      totalScore += trackProgress[track].pct * tracks[track].weight;
      totalWeight += tracks[track].weight;
    }
    
    const overallSynergy = Math.round(totalScore / totalWeight);
    return { trackProgress, overallSynergy };
  }

  // 4. Render Layout Elements
  function renderAll() {
    const data = calculateProgress();
    const { trackProgress, overallSynergy } = data;

    // A. Render circular gauge
    const svgCircle = document.getElementById('pmo-synergy-fill');
    const pctText = document.getElementById('pmo-synergy-percent');
    const statusText = document.getElementById('pmo-synergy-status');
    
    if (svgCircle && pctText && statusText) {
      // Circle dash offset formula
      const circumference = 2 * Math.PI * 15.9155; // ~100
      const offset = circumference - (overallSynergy / 100) * circumference;
      svgCircle.style.strokeDasharray = `${circumference}, 100`;
      svgCircle.style.strokeDashoffset = offset;
      
      pctText.textContent = `${overallSynergy}%`;
      
      // Dynamic synergy status text
      if (overallSynergy < 30) {
        statusText.textContent = "Synergies Initialized (Day 1-15 Focus)";
      } else if (overallSynergy < 60) {
        statusText.textContent = "Transition Accelerating (Systems Online)";
      } else if (overallSynergy < 85) {
        statusText.textContent = "Operations Conforming (High Synergy)";
      } else {
        statusText.textContent = "PMI Harmonization Completed (100% Target)";
      }
    }

    // B. Render Blocker Cockpit
    const blockerListContainer = document.getElementById('pmo-blocker-list');
    const blockerCountBadge = document.getElementById('blocker-badge');
    
    if (blockerListContainer && blockerCountBadge) {
      blockerListContainer.innerHTML = '';
      let activeCount = 0;
      
      pmoBlockersState.forEach(blocker => {
        if (!blocker.resolved) activeCount++;
        
        const card = document.createElement('div');
        card.className = `blocker-item ${blocker.resolved ? 'resolved' : ''}`;
        
        card.innerHTML = `
          <div class="blocker-info">
            <span class="blocker-meta">${blocker.resolved ? '✓ Synergy Unlocked' : '⚡ active blocker'}</span>
            <span class="blocker-title">${blocker.title}</span>
            <p style="font-size: 0.72rem; color: var(--text-secondary); margin: 0.15rem 0 0 0; line-height:1.3;">
              ${blocker.desc}
            </p>
          </div>
          <div class="blocker-action" style="margin-left: 1rem;">
            ${blocker.resolved 
              ? `<span class="blocker-resolved-icon">✓ RESOLVED</span>`
              : `<button type="button" class="btn-resolve-blocker" data-blocker-id="${blocker.id}">${blocker.buttonLabel}</button>`
            }
          </div>
        `;
        blockerListContainer.appendChild(card);
      });
      
      blockerCountBadge.textContent = `${activeCount} ACTIVE`;
      if (activeCount === 0) {
        blockerCountBadge.className = 'blocker-count-badge zero';
      } else {
        blockerCountBadge.className = 'blocker-count-badge';
      }
    }

    // C. Render Track KPI cards
    const tracksGrid = document.getElementById('pmo-tracks-container');
    if (tracksGrid) {
      tracksGrid.innerHTML = '';
      
      for (const track in tracks) {
        const trData = tracks[track];
        const progress = trackProgress[track];
        
        const card = document.createElement('div');
        card.className = `pmo-track-card ${activeTab === track ? 'active' : ''}`;
        card.setAttribute('data-track', track);
        
        card.innerHTML = `
          <div class="pmo-track-card-header">
            <span class="pmo-track-title">${trData.icon} ${trData.title}</span>
            <span class="pmo-track-pct">${progress.pct}%</span>
          </div>
          <div class="pmo-track-bar-bg" style="margin-bottom: 0.5rem;">
            <div class="pmo-track-bar-fill" style="width: ${progress.pct}%; background-color: ${trData.color};"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.65rem; color: var(--text-dim);">
            <span>${progress.capped ? `⚠️ Capped by blocker (${progress.capLimit}%)` : 'Normal Operations'}</span>
            <span>Raw: ${progress.rawPct}%</span>
          </div>
        `;
        
        card.addEventListener('click', () => {
          activeTab = track;
          localStorage.setItem(tabKey, activeTab);
          renderAll();
        });
        
        tracksGrid.appendChild(card);
      }
    }

    // D. Render Checklist Workspace Tabs
    const tabsContainer = document.getElementById('pmo-tabs-container');
    if (tabsContainer) {
      tabsContainer.innerHTML = '';
      
      for (const track in tracks) {
        const trData = tracks[track];
        const progress = trackProgress[track];
        
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `pmo-tab-btn ${activeTab === track ? 'active' : ''}`;
        btn.innerHTML = `${trData.icon} <span>${trData.title}</span> <span style="font-size:0.7rem; font-weight:800; background:#E2E8F0; padding:0.1rem 0.35rem; border-radius:10px; color:var(--te-dark-teal);">${progress.pct}%</span>`;
        
        btn.addEventListener('click', () => {
          activeTab = track;
          localStorage.setItem(tabKey, activeTab);
          renderAll();
        });
        
        tabsContainer.appendChild(btn);
      }
    }

    // E. Render Checklist Tasks
    const checklistContainer = document.getElementById('pmo-checklist-container');
    if (checklistContainer) {
      checklistContainer.innerHTML = '';
      
      const currentTrackTasks = defaultTasks[activeTab];
      const currentTrackState = pmoTasksState[activeTab] || {};
      
      currentTrackTasks.forEach(task => {
        const isChecked = currentTrackState[task.id] || false;
        
        const item = document.createElement('div');
        item.className = 'pmo-checklist-item';
        
        item.innerHTML = `
          <input type="checkbox" class="pmo-checklist-checkbox" id="chk-${task.id}" data-task-id="${task.id}" ${isChecked ? 'checked' : ''}>
          <label class="pmo-checklist-label" for="chk-${task.id}">
            <span class="pmo-task-title" style="${isChecked ? 'text-decoration: line-through; color: var(--text-secondary);' : ''}">${task.title}</span>
            <span class="pmo-task-desc">${task.desc}</span>
            <span style="font-size: 0.65rem; color: var(--te-orange); font-weight:700; margin-top: 0.2rem;">Impact Weight: ${task.weight}x</span>
          </label>
        `;
        
        const checkbox = item.querySelector('.pmo-checklist-checkbox');
        checkbox.addEventListener('change', (e) => {
          const id = e.target.getAttribute('data-task-id');
          pmoTasksState[activeTab][id] = e.target.checked;
          localStorage.setItem(tasksKey, JSON.stringify(pmoTasksState));
          
          // Trigger dynamic beak quack on local SVG coach if present
          const ductCoach = document.getElementById('teodor-duck-coach');
          if (ductCoach) {
            ductCoach.classList.add('quacking');
            setTimeout(() => ductCoach.classList.remove('quacking'), 600);
          }
          
          renderAll();
        });
        
        checklistContainer.appendChild(item);
      });
    }

    // F. Render Milestones Timeline Indicators
    const timelineFill = document.getElementById('pmo-timeline-fill');
    if (timelineFill) {
      timelineFill.style.width = `${overallSynergy}%`;
    }

    // Update milestone gates
    const gates = [
      { id: "gate-day1", target: 0, title: "Day 1", desc: "Town Hall Launch" },
      { id: "gate-month1", target: 20, title: "Month 1", desc: "IT VPN Link" },
      { id: "gate-month2", target: 45, title: "Month 2", desc: "HR Transition" },
      { id: "gate-month3", target: 70, title: "Month 3", desc: "Pricing Launch" },
      { id: "gate-day100", target: 90, title: "Day 100", desc: "Full Harmonized" }
    ];

    gates.forEach(gate => {
      const el = document.getElementById(gate.id);
      if (el) {
        el.classList.remove('unlocked', 'completed');
        
        // Milestone conditions
        let unlocked = overallSynergy >= gate.target;
        let completed = false;
        
        if (gate.id === 'gate-day1') {
          completed = overallSynergy > 5;
        } else if (gate.id === 'gate-month1') {
          completed = trackProgress.it.pct > 50 && trackProgress.hr.pct > 40;
        } else if (gate.id === 'gate-month2') {
          completed = overallSynergy > 45 && pmoBlockersState.some(b => b.resolved);
        } else if (gate.id === 'gate-month3') {
          completed = trackProgress.sales.pct > 60 && trackProgress.finance.pct > 60;
        } else if (gate.id === 'gate-day100') {
          completed = overallSynergy > 90 && pmoBlockersState.every(b => b.resolved);
        }

        if (completed) {
          el.classList.add('completed');
        } else if (unlocked) {
          el.classList.add('unlocked');
        }
      }
    });
  }

  // 5. Setup Blocker Resolve Event Listeners
  document.addEventListener('click', (e) => {
    if (e.target && e.target.classList.contains('btn-resolve-blocker')) {
      const blockerId = e.target.getAttribute('data-blocker-id');
      
      // Update Blocker State
      pmoBlockersState = pmoBlockersState.map(blocker => {
        if (blocker.id === blockerId) {
          blocker.resolved = true;
        }
        return blocker;
      });
      
      localStorage.setItem(blockersKey, JSON.stringify(pmoBlockersState));
      
      // Trigger canvas particle confetti
      triggerPmoConfetti();
      
      // Render updates
      renderAll();
    }
  });

  // 6. Inline Particle Confetti Engine for Premium Touch
  function triggerPmoConfetti() {
    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '999999';
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    
    // Scale canvas sizes
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const colors = ['#E98300', '#244C5A', '#FBBF24', '#10B981', '#3B82F6', '#EF4444'];
    const particles = [];

    // Create 120 particles bursting from center-bottom
    for (let i = 0; i < 120; i++) {
      particles.push({
        x: window.innerWidth / 2,
        y: window.innerHeight - 50,
        vx: (Math.random() - 0.5) * 15,
        vy: -Math.random() * 20 - 5,
        color: colors[Math.floor(Math.random() * colors.length)],
        size: Math.random() * 6 + 4,
        rotation: Math.random() * 360,
        spin: Math.random() * 10 - 5,
        opacity: 1
      });
    }

    function animate() {
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      
      let alive = false;
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.45; // gravity
        p.vx *= 0.98; // drag
        p.rotation += p.spin;
        p.opacity -= 0.012;

        if (p.opacity > 0) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.globalAlpha = p.opacity;
          ctx.fillStyle = p.color;
          
          // Draw standard confetti rectangles
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 1.5);
          ctx.restore();
        }
      });

      if (alive) {
        requestAnimationFrame(animate);
      } else {
        canvas.remove();
      }
    }

    animate();
  }

  // --- Integration Leader Provisioning Desk Handlers ---
  const provisionForm = document.getElementById('pmo-hrbp-provision-form');
  const hrbpNameInput = document.getElementById('pmo-hrbp-name');
  const hrbpEmailInput = document.getElementById('pmo-hrbp-email');
  const hrbpRegionInput = document.getElementById('pmo-hrbp-region');
  const hrbpTrackInput = document.getElementById('pmo-hrbp-track');
  const hrbpsListContainer = document.getElementById('pmo-hrbps-list');

  // Load and Render Active Integration Leaders
  function loadActiveHrbps() {
    if (!hrbpsListContainer) return;
    
    fetch('/api/hrbps')
      .then(res => res.json())
      .then(hrbps => {
        hrbpsListContainer.innerHTML = '';
        const list = hrbps || [];
        // Filter out global PMO Leads, only show provisioned Integration Leaders here
        const activeList = list.filter(h => h.role !== 'pmo');
        
        if (activeList.length === 0) {
          hrbpsListContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); font-size: 0.8rem; padding: 0.5rem; margin: 0;">No active Integration Leaders registered.</p>';
          return;
        }
        
        activeList.forEach(h => {
          const div = document.createElement('div');
          div.className = 'card';
          div.style.padding = '0.5rem 0.75rem';
          div.style.background = 'white';
          div.style.display = 'flex';
          div.style.justifyContent = 'space-between';
          div.style.alignItems = 'center';
          div.style.fontSize = '0.8rem';
          div.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)';
          div.style.border = '1px solid var(--border-color)';
          div.style.borderRadius = '6px';
          div.style.marginBottom = '0.4rem';
          
          const region = h.supportingTeams && h.supportingTeams[0] || 'Munich, Germany';
          const track = h.assignedTracks && h.assignedTracks[0] || 'culture';
          
          div.innerHTML = `
            <div style="flex: 1;">
              <strong style="color: var(--te-dark-teal); font-weight: 700;">${escapeHtml(h.name)}</strong> 
              <span style="color: var(--text-secondary); font-size:0.75rem;">(${escapeHtml(h.email)})</span>
              <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 0.15rem;">
                Region: <strong>${escapeHtml(region)}</strong> | Track: <span class="admin-dimension-tag ${track}" style="font-size:0.6rem; padding:0.05rem 0.25rem;">${track}</span>
              </div>
            </div>
            <button type="button" class="btn-delete-pmo-hrbp" data-hrbp-id="${h.id}" style="background:transparent; border:none; color:#ef4444; font-size: 1.1rem; font-weight:bold; cursor:pointer; padding: 0 0.5rem;">×</button>
          `;
          
          const deleteBtn = div.querySelector('.btn-delete-pmo-hrbp');
          deleteBtn.addEventListener('click', () => deleteHrbp(h.id));
          hrbpsListContainer.appendChild(div);
        });
      })
      .catch(err => console.error("Error loading Integration Leaders in PMO console:", err));
  }

  // Delete Integration Leader
  function deleteHrbp(id) {
    if (!confirm("Are you sure you want to revoke access for this Integration Leader?")) return;
    fetch(`/api/hrbps/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          loadActiveHrbps();
          triggerPmoConfetti();
        }
      })
      .catch(err => console.error("Error deleting Integration Leader in PMO:", err));
  }

  // Handle Form Submit
  if (provisionForm) {
    provisionForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const payload = {
        name: hrbpNameInput.value.trim(),
        email: hrbpEmailInput.value.trim(),
        assignedTracks: [hrbpTrackInput.value],
        supportingTeams: [hrbpRegionInput.value], // Store region in supportingTeams as first item
        role: 'hrbp'
      };
      
      fetch('/api/hrbps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            provisionForm.reset();
            loadActiveHrbps();
            // Show particle confetti
            triggerPmoConfetti();
          } else {
            alert("Error provisioning Integration Leader.");
          }
        })
        .catch(err => console.error("Error provisioning Integration Leader:", err));
    });
  }

  // --- PMO Broadcast Steering Desk Section ---
  const pmoBroadcastForm = document.getElementById('pmo-broadcast-form');
  const pmoRecipientType = document.getElementById('pmo-comm-recipient-type');
  const pmoRecipientSpecificContainer = document.getElementById('pmo-comm-recipient-specific-container');
  const pmoRecipientSelect = document.getElementById('pmo-comm-recipient-select');
  const pmoCommLedgerContainer = document.getElementById('pmo-comm-ledger-container');
  const pmoCommLedgerCount = document.getElementById('pmo-comm-ledger-count');

  if (pmoRecipientType) {
    pmoRecipientType.addEventListener('change', () => {
      if (pmoRecipientType.value === 'individual') {
        pmoRecipientSpecificContainer.style.display = 'flex';
        loadPmoRecipientOptions();
      } else {
        pmoRecipientSpecificContainer.style.display = 'none';
      }
    });
  }

  function loadPmoRecipientOptions() {
    if (!pmoRecipientSelect) return;
    pmoRecipientSelect.innerHTML = '<option value="">Loading recipients...</option>';

    Promise.all([
      fetch('/api/employees').then(res => res.json()).catch(() => []),
      fetch('/api/hrbps').then(res => res.json()).catch(() => [])
    ]).then(([employees, hrbps]) => {
      pmoRecipientSelect.innerHTML = '';
      if (employees.length === 0 && hrbps.length === 0) {
        pmoRecipientSelect.innerHTML = '<option value="">No users registered</option>';
        return;
      }

      if (employees.length > 0) {
        const empGroup = document.createElement('optgroup');
        empGroup.label = 'Acquired Legacy Employees';
        employees.forEach(e => {
          const opt = document.createElement('option');
          opt.value = e.email || `${e.name.toLowerCase().replace(/\s+/g, '')}@te-legacy.com`;
          opt.textContent = `${e.name} (${e.role || 'Employee'} - ${e.department || 'R&D'})`;
          opt.dataset.name = e.name;
          opt.dataset.role = e.role || 'Legacy Employee';
          empGroup.appendChild(opt);
        });
        pmoRecipientSelect.appendChild(empGroup);
      }

      if (hrbps.length > 0) {
        const hrbpGroup = document.createElement('optgroup');
        hrbpGroup.label = 'Integration Integration Leaders';
        hrbps.forEach(h => {
          const opt = document.createElement('option');
          opt.value = h.email || `${h.name.toLowerCase().replace(/\s+/g, '')}@te.com`;
          opt.textContent = `${h.name} (${h.role || 'Integration Leader'} - ${h.region || 'HQ'})`;
          opt.dataset.name = h.name;
          opt.dataset.role = h.role || 'Integration Leader';
          hrbpGroup.appendChild(opt);
        });
        pmoRecipientSelect.appendChild(hrbpGroup);
      }
    });
  }

  if (pmoBroadcastForm) {
    pmoBroadcastForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const sender = document.getElementById('pmo-comm-sender').value;
      const senderRole = document.getElementById('pmo-comm-sender-role').value;
      const recipientType = pmoRecipientType.value;
      const template = document.getElementById('pmo-comm-template').value;
      const subject = document.getElementById('pmo-comm-subject').value;
      const body = document.getElementById('pmo-comm-body').value;

      let recipientEmail = 'all@te.com';
      let recipientName = 'All Legacy Employees';
      let recipientId = 'all';

      if (recipientType === 'hrbp') {
        recipientEmail = 'integration-leaders@te.com';
        recipientName = 'All Integration Leaders';
        recipientId = 'hrbp';
      } else if (recipientType === 'individual') {
        const selectedOpt = pmoRecipientSelect.options[pmoRecipientSelect.selectedIndex];
        if (!selectedOpt || !selectedOpt.value) {
          showPmoNotification('Please select a specific recipient first.', true);
          return;
        }
        recipientEmail = selectedOpt.value;
        recipientName = selectedOpt.dataset.name;
        recipientId = selectedOpt.dataset.role;
      }

      const payload = {
        sender,
        senderRole,
        recipientType,
        recipientId,
        recipientEmail,
        recipientName,
        subject,
        template,
        body
      };

      fetch('/api/communications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showPmoNotification(`M&A Broadcast sent! Simulation compiled successfully.`);
          pmoBroadcastForm.reset();
          if (pmoRecipientType) {
            pmoRecipientType.value = 'all';
            pmoRecipientSpecificContainer.style.display = 'none';
          }
          loadPmoCommunications();
        } else {
          showPmoNotification(data.error || 'Failed to dispatch broadcast.', true);
        }
      })
      .catch(err => {
        console.error("Error dispatching PMO communication:", err);
        showPmoNotification('Server connection error.', true);
      });
    });
  }

  function loadPmoCommunications() {
    if (!pmoCommLedgerContainer) return;

    fetch('/api/communications')
      .then(res => res.json())
      .then(comms => {
        pmoCommLedgerContainer.innerHTML = '';
        const pmoComms = comms.filter(c => c.sender.includes('PMO') || c.senderRole.includes('PMO') || c.sender === 'PMO Steering Office');
        
        if (pmoCommLedgerCount) pmoCommLedgerCount.textContent = `${pmoComms.length} Sent`;

        if (!pmoComms || pmoComms.length === 0) {
          pmoCommLedgerContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); font-size: 0.85rem; padding: 1.5rem; font-style: italic;">No steering broadcasts sent yet.</p>';
          return;
        }

        // Sort descending by timestamp
        pmoComms.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        pmoComms.forEach(c => {
          const item = document.createElement('div');
          item.style.cssText = 'background: rgba(255,255,255,0.03); border: 1.5px solid rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; display: flex; flex-direction: column; gap: 0.5rem; position: relative; border-left: 4px solid ' + getPmoTemplateColor(c.template);
          
          const dateStr = new Date(c.timestamp).toLocaleString();

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
              <div>
                <span class="badge" style="background: ${getPmoTemplateColor(c.template)}; color: white; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: bold;">${getPmoTemplateLabel(c.template)}</span>
                <h4 style="margin: 0.25rem 0; font-size: 0.95rem; color: var(--text-main); font-family: var(--font-family-display); font-weight: 700;">${escapeHtml(c.subject)}</h4>
                <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.15rem;">
                  <span><strong>To:</strong> ${escapeHtml(c.recipientName)} &lt;${escapeHtml(c.recipientEmail)}&gt;</span> &bull; 
                  <span>${dateStr}</span>
                </div>
              </div>
              <a href="${c.htmlEmailPath}" target="_blank" class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.25rem; text-decoration: none; border-radius: 4px; border: 1.5px solid rgba(36, 76, 90, 0.2); background: transparent; color: var(--te-dark-teal); font-weight: bold; cursor: pointer;">
                <span>🔍</span> HTML
              </a>
            </div>
            <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${escapeHtml(c.body)}
            </p>
          `;

          pmoCommLedgerContainer.appendChild(item);
        });
      })
      .catch(err => console.error("Error loading PMO communications:", err));
  }

  function getPmoTemplateColor(tmpl) {
    switch (tmpl) {
      case 'security': return '#B91C1C';
      case 'synergy': return '#E98300';
      case 'welcome': return '#244C5A';
      default: return '#4b5563';
    }
  }

  function getPmoTemplateLabel(tmpl) {
    switch (tmpl) {
      case 'security': return 'Compliance';
      case 'synergy': return 'Synergy';
      case 'welcome': return 'Welcome';
      default: return 'System';
    }
  }

  function showPmoNotification(msg, isError = false) {
    const banner = document.createElement('div');
    banner.style.cssText = `position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%) translateY(-20px); opacity: 0; background: ${isError ? '#B91C1C' : 'var(--te-dark-teal)'}; color: var(--text-light); border-left: 4px solid var(--te-orange); padding: 0.75rem 1.5rem; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); font-weight: 600; font-size: 0.9rem; z-index: 100000; transition: all 0.3s ease;`;
    banner.textContent = msg;
    document.body.appendChild(banner);

    requestAnimationFrame(() => {
      banner.style.opacity = '1';
      banner.style.transform = 'translateX(-50%) translateY(0)';
    });

    setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transform = 'translateX(-50%) translateY(-20px)';
      setTimeout(() => {
        banner.remove();
      }, 300);
    }, 3000);
  }

  // Escape HTML helper
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#039;");
  }

  // Helper to dynamically update target company labels on console
  function updateDashboardCompanyLabels(companyName) {
    const welcomeCard = document.querySelector('.pmo-container > .card h2');
    if (welcomeCard) {
      welcomeCard.textContent = `${companyName} Integration Desk`;
    }
    const welcomeDesc = document.querySelector('.pmo-container > .card p');
    if (welcomeDesc) {
      welcomeDesc.innerHTML = `Coordinating cross-functional workflows, resolving alignment blockers, and steering key milestone gates for the <strong>${escapeHtml(companyName)}</strong> integration.`;
    }
    const synergyDesc = document.getElementById('pmo-synergy-desc');
    if (synergyDesc) {
      synergyDesc.innerHTML = `Overall integration index for <strong>${escapeHtml(companyName)}</strong> calculates the weighted task completions, local survey sentiment adjustments, and the resolution state of key cross-functional synergy blockers.`;
    }
  }

  // Wizard state holders
  let currentWizStep = 1;
  const surveyResponses = {};
  let calculatedScores = null;
  let parsedRoster = null;
  let activeSettings = null;

  function switchWizStep(stepNum) {
    currentWizStep = stepNum;
    document.getElementById('current-step-num').textContent = stepNum;
    
    // Hide all steps
    document.querySelectorAll('.wizard-step').forEach(step => {
      step.style.display = 'none';
    });
    
    // Show current step
    document.getElementById(`wizard-step-${stepNum}`).style.display = 'block';

    // Update progress bar fills
    for (let i = 1; i <= 4; i++) {
      const fill = document.getElementById(`wizard-step${i}-fill`);
      if (fill) {
        fill.style.backgroundColor = i <= stepNum ? 'var(--te-orange)' : 'var(--border-color)';
      }
    }
  }

  function loadWizHrbpsList() {
    const listContainer = document.getElementById('wiz-hrbp-list');
    const countBadge = document.getElementById('wiz-hrbp-count');
    if (!listContainer) return;

    fetch('/api/hrbps')
      .then(res => res.json())
      .then(hrbps => {
        const list = hrbps || [];
        const activeList = list.filter(h => h.role !== 'pmo');
        
        if (countBadge) countBadge.textContent = activeList.length;
        
        if (activeList.length === 0) {
          listContainer.innerHTML = '<p style="font-size: 0.75rem; color: var(--text-dim); margin: 0; font-style: italic;">No Integration Leaders registered yet.</p>';
          return;
        }

        listContainer.innerHTML = '';
        activeList.forEach(h => {
          const div = document.createElement('div');
          div.style.cssText = "display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.4); border: 1px solid var(--border-color); border-radius: 4px; padding: 0.35rem 0.5rem; font-size: 0.75rem; margin-bottom: 0.25rem;";
          div.innerHTML = `
            <div>
              <strong>${escapeHtml(h.name)}</strong>
              <span style="color: var(--text-secondary);">(${escapeHtml(h.supportingTeams[0])})</span>
            </div>
            <button type="button" class="wiz-del-hrbp" data-id="${h.id}" style="background:transparent; border:none; color:#ef4444; font-weight:bold; cursor:pointer; padding: 0 0.25rem;">×</button>
          `;
          
          div.querySelector('.wiz-del-hrbp').addEventListener('click', (e) => {
            const hId = e.target.getAttribute('data-id');
            fetch(`/api/hrbps/${hId}`, { method: 'DELETE' })
              .then(res => res.json())
              .then(() => loadWizHrbpsList());
          });

          listContainer.appendChild(div);
        });
      });
  }

  function renderWizTrackSuggestions(scores) {
    const container = document.getElementById('wiz-tracks-recommendations');
    if (!container) return;

    container.innerHTML = '';
    
    // Dynamic recommendation profiles
    const suggestions = [];
    if (scores.culture < 3.5) {
      suggestions.push({
        title: "Culture Sync Track",
        color: "var(--te-orange)",
        status: "HIGH RISK",
        desc: "Prioritize alignment of employee values, leadership transparency, and interactive feedback loops to bridge regional corporate silos."
      });
    }
    if (scores.talent < 3.5) {
      suggestions.push({
        title: "VPN System Transition Track",
        color: "var(--te-dark-teal)",
        status: "MANDATORY",
        desc: "Execute secure IT SSO directory bridges, deploy network credentials, and initiate fast badge/laptop swaps for acquired staff."
      });
    }
    if (scores.value < 3.5) {
      suggestions.push({
        title: "CRM Catalog Integration Track",
        color: "#8B5CF6",
        status: "CRITICAL SYNERGY",
        desc: "Accelerate product catalog harmonizations, migrate customer pipeline databases, and synchronize pricing policies to hit joint commercial synergy targets."
      });
    }

    if (suggestions.length === 0) {
      suggestions.push({
        title: "Post-Merger Operational Audits Track",
        color: "#10B981",
        status: "STANDARD SYNERGY",
        desc: "Conduct standard reviews of operational efficiencies, manufacturing standard unifications, and joint business development catalog sessions."
      });
    }

    suggestions.forEach(s => {
      const card = document.createElement('div');
      card.style.cssText = `background: rgba(255,255,255,0.45); border-left: 4px solid ${s.color}; border-radius: 6px; padding: 0.85rem; box-shadow: var(--shadow-sm); border-top: 1px solid var(--border-glass); border-right: 1px solid var(--border-glass); border-bottom: 1px solid var(--border-glass);`;
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.25rem;">
          <h5 style="margin: 0; color: var(--te-dark-teal); font-weight: 700; font-size: 0.85rem;">${s.title}</h5>
          <span style="font-size: 0.65rem; background: ${s.color}20; color: ${s.color}; font-weight: 800; padding: 0.1rem 0.4rem; border-radius: 4px;">${s.status}</span>
        </div>
        <p style="margin: 0; font-size: 0.75rem; color: var(--text-secondary); line-height: 1.35;">${s.desc}</p>
      `;
      container.appendChild(card);
    });
  }

  function initOnboardingWizard() {
    // 1. Render questions for Step 2
    const qContainer = document.getElementById('wiz-questions-container');
    if (!qContainer) return;
    
    fetch('/api/questions')
      .then(res => res.json())
      .then(questions => {
        qContainer.innerHTML = '';
        questions.forEach((q, idx) => {
          const div = document.createElement('div');
          div.style.cssText = "border-bottom: 1px dashed rgba(36,76,90,0.1); padding-bottom: 0.85rem; margin-bottom: 0.85rem;";
          div.innerHTML = `
            <p style="margin: 0 0 0.5rem 0; font-size: 0.85rem; font-weight: 700; color: var(--te-dark-teal);">${idx+1}. ${escapeHtml(q.text)}</p>
            <div class="rating-scale" data-question-id="${q.id}" style="margin: 0; display: flex; gap: 0.5rem; justify-content: space-between;">
              ${[1, 2, 3, 4, 5].map(v => {
                let lbl = 'Moderate';
                if (v === 1) lbl = 'Critical Risk';
                if (v === 2) lbl = 'Friction';
                if (v === 4) lbl = 'Aligned';
                if (v === 5) lbl = 'Optimal';
                return `<button type="button" class="rating-btn" data-val="${v}" title="${lbl}" style="flex: 1; padding: 0.4rem; border: 1.5px solid var(--border-color); border-radius: 6px; cursor: pointer; font-size: 0.85rem; font-weight: 800; background: rgba(255,255,255,0.5); color: var(--te-dark-teal); transition: all 0.2s;">${v}</button>`;
              }).join('')}
            </div>
          `;
          
          const ratingButtons = div.querySelectorAll('.rating-btn');
          ratingButtons.forEach(btn => {
            btn.addEventListener('click', () => {
              const val = parseInt(btn.getAttribute('data-val'), 10);
              surveyResponses[q.id] = val;
              
              // Clear other selected buttons in this scale
              ratingButtons.forEach(b => {
                b.style.background = 'rgba(255,255,255,0.5)';
                b.style.color = 'var(--te-dark-teal)';
                b.style.borderColor = 'var(--border-color)';
              });

              // Select this button
              btn.style.background = 'var(--te-dark-teal)';
              btn.style.color = 'white';
              btn.style.borderColor = 'var(--te-dark-teal)';
            });
          });

          qContainer.appendChild(div);
        });
      });

    loadWizHrbpsList();
  }

  // Bind wizard navigation listeners
  const specsForm = document.getElementById('wizard-form-specs');
  if (specsForm) {
    specsForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const payload = {
        targetCompany: document.getElementById('wiz-target-company').value.trim(),
        sector: document.getElementById('wiz-sector').value.trim(),
        hq: document.getElementById('wiz-hq').value.trim(),
        size: document.getElementById('wiz-size').value.trim(),
        acquisitionDate: document.getElementById('wiz-acq-date').value,
        synergyObjective: document.getElementById('wiz-synergy').value.trim()
      };

      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          activeSettings = data.settings;
          switchWizStep(2);
        } else {
          alert("Error saving integration specifications.");
        }
      })
      .catch(err => console.error("Error saving specs:", err));
    });
  }

  const surveyForm = document.getElementById('wizard-form-survey');
  if (surveyForm) {
    surveyForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      // Verify all questions are answered
      const quesContainer = document.getElementById('wiz-questions-container');
      const ratingScales = quesContainer.querySelectorAll('.rating-scale');
      let allAnswered = true;
      ratingScales.forEach(scale => {
        const qId = scale.getAttribute('data-question-id');
        if (surveyResponses[qId] === undefined) {
          allAnswered = false;
          scale.parentElement.style.border = "1.5px solid #ef4444";
          scale.parentElement.style.padding = "0.5rem";
          scale.parentElement.style.borderRadius = "6px";
        } else {
          scale.parentElement.style.border = "none";
          scale.parentElement.style.padding = "0";
        }
      });

      if (!allAnswered) {
        alert("Please rate all 10 alignment dimensions before proceeding.");
        return;
      }

      // Submit assessment
      fetch('/api/assessment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: surveyResponses })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          calculatedScores = data.assessment.scores;
          renderWizTrackSuggestions(calculatedScores);
          switchWizStep(3);
        } else {
          alert("Error generating post-merger integration plan.");
        }
      })
      .catch(err => console.error("Error submitting survey:", err));
    });
  }

  const backTo1Btn = document.getElementById('wiz-back-to-1');
  if (backTo1Btn) {
    backTo1Btn.addEventListener('click', () => switchWizStep(1));
  }
  const backTo2Btn = document.getElementById('wiz-back-to-2');
  if (backTo2Btn) {
    backTo2Btn.addEventListener('click', () => switchWizStep(2));
  }
  const to4Btn = document.getElementById('wiz-to-4');
  if (to4Btn) {
    to4Btn.addEventListener('click', () => switchWizStep(4));
  }
  const backTo3Btn = document.getElementById('wiz-back-to-3');
  if (backTo3Btn) {
    backTo3Btn.addEventListener('click', () => switchWizStep(3));
  }

  const wizHrbpForm = document.getElementById('wizard-form-hrbp');
  if (wizHrbpForm) {
    wizHrbpForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const name = document.getElementById('wiz-hrbp-name').value.trim();
      const region = document.getElementById('wiz-hrbp-region').value;
      const email = document.getElementById('wiz-hrbp-email').value.trim();

      const payload = {
        name,
        email,
        assignedTracks: ['culture'], // default
        supportingTeams: [region],
        role: 'hrbp'
      };

      fetch('/api/hrbps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          wizHrbpForm.reset();
          loadWizHrbpsList();
        } else {
          alert("Error creating Integration Leader.");
        }
      })
      .catch(err => console.error("Error creating Integration Leader:", err));
    });
  }

  const btnParse = document.getElementById('btn-wiz-parse-roster');
  const rosterRawInput = document.getElementById('wiz-roster-raw');
  const previewStatus = document.getElementById('wiz-roster-preview-status');

  if (btnParse && rosterRawInput && previewStatus) {
    btnParse.addEventListener('click', () => {
      const val = rosterRawInput.value.trim();
      if (!val) {
        previewStatus.textContent = "❌ Please enter roster content first.";
        previewStatus.style.color = "#ef4444";
        return;
      }

      try {
        if (val.startsWith('[')) {
          // Parse JSON
          const data = JSON.parse(val);
          if (!Array.isArray(data)) {
            throw new Error("Roster JSON must be an array of employees.");
          }
          // Validate
          const invalid = data.some(emp => !emp.name || !emp.role || !emp.department);
          if (invalid) {
            throw new Error("Each employee record must contain name, role, and department.");
          }
          parsedRoster = data;
          previewStatus.textContent = `✅ Successfully parsed ${data.length} employee records from JSON! Click Finalize to load.`;
          previewStatus.style.color = "#10B981";
        } else {
          // Parse CSV
          const lines = val.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (lines.length < 2) {
            throw new Error("CSV must contain a header line and at least one employee row.");
          }
          const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
          const nameIdx = headers.indexOf('name');
          const roleIdx = headers.indexOf('role');
          const deptIdx = headers.indexOf('department');
          
          if (nameIdx === -1 || roleIdx === -1 || deptIdx === -1) {
            throw new Error("CSV headers must include: name, role, department");
          }

          const records = [];
          for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length < headers.length) continue;
            records.push({
              name: cols[nameIdx],
              role: cols[roleIdx],
              department: cols[deptIdx],
              company: activeSettings ? activeSettings.targetCompany : ""
            });
          }
          parsedRoster = records;
          previewStatus.textContent = `✅ Successfully parsed ${records.length} employee records from CSV! Click Finalize to load.`;
          previewStatus.style.color = "#10B981";
        }
      } catch (err) {
        previewStatus.textContent = `❌ Parsing Error: ${err.message}`;
        previewStatus.style.color = "#ef4444";
        parsedRoster = null;
      }
    });
  }

  const finalizeBtn = document.getElementById('btn-wiz-finalize');
  if (finalizeBtn) {
    finalizeBtn.addEventListener('click', async () => {
      finalizeBtn.disabled = true;
      finalizeBtn.textContent = "Finalizing Custom Workspace...";

      try {
        // 1. If we parsed employee roster, upload them
        if (parsedRoster && parsedRoster.length > 0) {
          for (const emp of parsedRoster) {
            await fetch('/api/employees', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(emp)
            });
          }
        }

        // 2. Set PMO custom setup complete
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pmoCustomSetupComplete: true })
        });
        const data = await res.json();
        
        if (data.success) {
          showPmoNotification("✨ Custom post-merger workspace initialized successfully!");
          setTimeout(() => {
            window.location.reload();
          }, 1000);
        } else {
          alert("Error finalizing workspace setup.");
          finalizeBtn.disabled = false;
          finalizeBtn.textContent = "Finalize and Launch PMO Control Console 🚀";
        }
      } catch (err) {
        console.error("Error finalizing:", err);
        alert("Connection lost during initialization.");
        finalizeBtn.disabled = false;
        finalizeBtn.textContent = "Finalize and Launch PMO Control Console 🚀";
      }
    });
  }

  // --- 7. Initial Call ---
  loadPageSettings();

  // Expose reset parameters in window for the Admin Settings Console integration
  window.resetPmoDashboard = function() {
    pmoTasksState = {};
    for (const track in defaultTasks) {
      pmoTasksState[track] = {};
      defaultTasks[track].forEach(task => {
        pmoTasksState[track][task.id] = false;
      });
    }
    
    pmoBlockersState = defaultBlockers.map(b => {
      b.resolved = false;
      return b;
    });

    localStorage.setItem(tasksKey, JSON.stringify(pmoTasksState));
    localStorage.setItem(blockersKey, JSON.stringify(pmoBlockersState));
    activeTab = 'hr';
    localStorage.setItem(tabKey, activeTab);
    
    renderAll();
  };

});
