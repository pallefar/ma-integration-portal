/**
 * TE Connectivity M&A Integration Portal - dashboard.js
 * Controls tab navigation, visual gauge rendering, API integration, and markdown formatting.
 */

document.addEventListener('DOMContentLoaded', () => {
  const mainView = document.getElementById('dashboard-main-view');
  const emptyState = document.getElementById('dashboard-empty-state');
  const targetNameEl = document.getElementById('dashboard-target-name');
  
  // Gauges
  const gaugeCultureFill = document.getElementById('gauge-culture-fill');
  const gaugeCultureVal = document.getElementById('gauge-culture-val');
  const gaugeCultureBadge = document.getElementById('gauge-culture-badge');
  
  const gaugeTalentFill = document.getElementById('gauge-talent-fill');
  const gaugeTalentVal = document.getElementById('gauge-talent-val');
  const gaugeTalentBadge = document.getElementById('gauge-talent-badge');
  
  const gaugeValueFill = document.getElementById('gauge-value-fill');
  const gaugeValueVal = document.getElementById('gauge-value-val');
  const gaugeValueBadge = document.getElementById('gauge-value-badge');
  
  // Content panels
  const aiPlanMarkdown = document.getElementById('ai-plan-markdown');
  const hrModulesContainer = document.getElementById('hr-modules-container');
  const coachingContainer = document.getElementById('coaching-container');

  // 1. Fetch Integration Assessment (Latest or Historical Archive)
  const historicalId = localStorage.getItem('active_assessment_id');
  
  let fetchPromise;
  if (historicalId) {
    console.log(`Loading archived assessment: ${historicalId}`);
    fetchPromise = fetch('/api/assessments')
      .then(res => res.json())
      .then(list => {
        const found = list.find(a => a.id === historicalId);
        // Clear immediately so subsequent refreshes load normally
        localStorage.removeItem('active_assessment_id');
        return found ? { success: true, assessment: found } : { success: false };
      });
  } else {
    console.log("Loading latest assessment results...");
    fetchPromise = fetch('/api/assessment/latest').then(res => res.json());
  }

  fetchPromise
    .then(data => {
      if (!data.success || !data.assessment) {
        // No assessment taken yet, show empty state
        mainView.style.display = 'none';
        emptyState.style.display = 'block';
        return;
      }

      // Assessment found, populate dashboard
      mainView.style.display = 'block';
      emptyState.style.display = 'none';
      
      const assessment = data.assessment;
      targetNameEl.textContent = `${assessment.targetCompany} Integration`;

      // Fetch and map exact survey questions to gauge tooltips
      fetch('/api/questions')
        .then(res => res.json())
        .then(questions => {
          const cList = document.getElementById('culture-questions-list');
          const tList = document.getElementById('talent-questions-list');
          const vList = document.getElementById('value-questions-list');
          if (cList) cList.innerHTML = '';
          if (tList) tList.innerHTML = '';
          if (vList) vList.innerHTML = '';

          questions.forEach(q => {
            const li = document.createElement('li');
            li.textContent = q.text;
            if (q.dimension === 'culture' && cList) cList.appendChild(li);
            if (q.dimension === 'talent' && tList) tList.appendChild(li);
            if (q.dimension === 'value' && vList) vList.appendChild(li);
          });
        })
        .catch(err => console.error("Error loading survey questions:", err));

      // Render visual gauges
      updateGauge(gaugeCultureFill, gaugeCultureVal, gaugeCultureBadge, assessment.scores.culture);
      updateGauge(gaugeTalentFill, gaugeTalentVal, gaugeTalentBadge, assessment.scores.talent);
      updateGauge(gaugeValueFill, gaugeValueVal, gaugeValueBadge, assessment.scores.value);

      // Render the AI Markdown Plan
      renderMarkdownPlan(assessment.aiPlan);

      // Render dynamic HR Action Modules
      renderActionModules(assessment.scores);

      // Render dynamic Integration Leader Coaching Desk
      renderCoachingCorner(assessment.scores);

      // Render the functional department tracks (Sales/Product/Finance + admin-created)
      renderFunctionalTracks(assessment.scores);
    })
    .catch(err => {
      console.error("Error loading latest assessment:", err);
      mainView.style.display = 'none';
      emptyState.style.display = 'block';
    });

  // ===== Functional Integration Tracks (department modules) =====
  // Culture & Communication are shared org-wide; Systems & Trainings are per-department.
  function focusAreasFromScores(scores) {
    if (!scores) return [];
    return [
      { key: 'culture', label: 'Culture & Values', score: scores.culture },
      { key: 'talent', label: 'Talent & Systems', score: scores.talent },
      { key: 'value', label: 'Value & Synergies', score: scores.value }
    ].filter(d => typeof d.score === 'number' && d.score < 3).sort((a, b) => a.score - b.score);
  }

  function renderFunctionalTracks(scores) {
    const container = document.getElementById('functional-tracks-container');
    if (!container) return;
    fetch('/api/departments').then(r => r.json()).then(depts => {
      container.innerHTML = '';
      // Known demo departments map to existing translated strings so the tracks
      // localize on DE/ZH/CS; custom (admin-added) departments fall back to their
      // raw name until per-language department fields exist.
      const TRACK_I18N = {
        dept_sales:   { title: 'dashboard.track_sales_title',   desc: 'dashboard.track_sales_desc',   badge: 'dashboard.track_badge_phase2_sales' },
        dept_product: { title: 'dashboard.track_product_title', desc: 'dashboard.track_product_desc', badge: 'dashboard.track_badge_phase2_product' },
        dept_finance: { title: 'dashboard.track_finance_title', desc: 'dashboard.track_finance_desc', badge: 'dashboard.track_badge_phase3_finance' }
      };
      const attr = (k) => k ? ` data-i18n="${k}"` : '';
      (depts || []).forEach(d => {
        const tk = TRACK_I18N[d.id] || {};
        const card = document.createElement('div');
        card.className = 'placeholder-card' + (d.locked ? ' locked' : ' unlocked');
        if (d.locked) {
          card.innerHTML = `
            <svg class="placeholder-lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" /></svg>
            <h4>${d.icon ? escapeHtml(d.icon) + ' ' : ''}<span${attr(tk.title)}>${escapeHtml(d.name)}</span></h4>
            <p${attr(tk.desc)}>${escapeHtml(d.desc || '')}</p>
            <span class="placeholder-badge">🔒 <span${attr(tk.badge)}>Locked${d.phase ? ' - ' + escapeHtml(d.phase) : ''}</span></span>`;
        } else {
          card.style.cursor = 'pointer';
          card.innerHTML = `
            <div style="font-size:2rem;line-height:1;">${escapeHtml(d.icon || '🏭')}</div>
            <h4><span${attr(tk.title)}>${escapeHtml(d.name)}</span></h4>
            <p${attr(tk.desc)}>${escapeHtml(d.desc || '')}</p>
            <span class="placeholder-badge" style="background:rgba(16,185,129,0.12);color:#059669;border-color:rgba(16,185,129,0.3);">● Active — open module</span>`;
          card.addEventListener('click', () => openDepartmentModal(d, scores));
        }
        container.appendChild(card);
      });
      // Localize the freshly-injected [data-i18n] cards (safe no-op if the
      // dictionary hasn't loaded yet — the engine re-applies on load/switch).
      if (window.applyPortalI18n) window.applyPortalI18n();
    }).catch(err => console.error('Error loading department tracks:', err));
  }

  function openDepartmentModal(d, scores) {
    const cultureScore = scores && typeof scores.culture === 'number' ? scores.culture : null;
    const culturePct = cultureScore != null ? Math.round((cultureScore / 5) * 100) : 0;
    const focus = focusAreasFromScores(scores);
    const list = (items, empty) => (items && items.length)
      ? `<ul style="margin:0.35rem 0 0;padding-left:1.1rem;">${items.map(i => `<li style="margin-bottom:0.35rem;"><strong>${escapeHtml(i.title || '')}</strong>${i.desc ? ' — <span style="color:var(--text-secondary);">' + escapeHtml(i.desc) + '</span>' : ''}</li>`).join('')}</ul>`
      : `<p style="color:var(--text-dim);font-size:0.85rem;margin:0.35rem 0 0;">${empty}</p>`;

    const overlay = document.createElement('div');
    overlay.className = 'cms-modal-overlay';
    const box = document.createElement('div');
    box.className = 'cms-modal';
    box.style.maxWidth = '640px';
    box.innerHTML = `
      <div class="cms-modal-head"><h3>${escapeHtml((d.icon ? d.icon + ' ' : '') + d.name)} — Integration Module</h3><button type="button" class="cms-modal-x" aria-label="Close">✕</button></div>
      <div class="cms-modal-body">
        <div class="dept-section">
          <h4 class="dept-section-h">🎭 Culture &amp; Values <span class="dept-shared">Shared org-wide</span></h4>
          <p style="font-size:0.83rem;color:var(--text-secondary);margin:0 0 0.5rem;">Culture onboarding is shared across every department — progress made with HR is reflected here.</p>
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <div style="flex:1;height:10px;background:rgba(36,76,90,0.1);border-radius:6px;overflow:hidden;"><div style="height:100%;width:${culturePct}%;background:var(--te-orange);"></div></div>
            <strong style="font-size:0.85rem;">${cultureScore != null ? cultureScore.toFixed(1) + '/5' : 'n/a'}</strong>
          </div>
        </div>
        <div class="dept-section">
          <h4 class="dept-section-h">📣 Communication <span class="dept-shared">Shared org-wide</span></h4>
          <p style="font-size:0.83rem;color:var(--text-secondary);margin:0.35rem 0 0;">Town halls, integration newsletters and leadership alignment reuse the same shared communication cadence as HR — broadcast once, reaches every department.</p>
        </div>
        <div class="dept-section">
          <h4 class="dept-section-h">⚙️ Systems <span class="dept-own">${escapeHtml(d.name)}</span></h4>
          ${list(d.systems, 'No systems defined yet — add them in Admin ▸ Departments.')}
        </div>
        <div class="dept-section">
          <h4 class="dept-section-h">🎓 Trainings <span class="dept-own">${escapeHtml(d.name)}</span></h4>
          ${list(d.trainings, 'No trainings defined yet — add them in Admin ▸ Departments.')}
        </div>
        <div class="dept-section">
          <h4 class="dept-section-h">🎯 Focus Areas <span class="dept-shared">from survey feedback</span></h4>
          ${focus.length
            ? `<ul style="margin:0.35rem 0 0;padding-left:1.1rem;">${focus.map(f => `<li style="margin-bottom:0.25rem;"><strong style="color:#B45309;">${escapeHtml(f.label)}</strong> — score ${f.score.toFixed(1)}/5 needs attention</li>`).join('')}</ul>`
            : '<p style="color:#059669;font-size:0.85rem;margin:0.35rem 0 0;">✓ No critical focus areas — all assessment dimensions are on track.</p>'}
        </div>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    box.querySelector('.cms-modal-x').addEventListener('click', close);
  }

  // 2. Animate Circular Gauges
  function updateGauge(circleEl, valEl, badgeEl, score) {
    const totalCircumference = 251.2;
    valEl.textContent = score.toFixed(1);

    const percentage = score / 5.0;
    const offset = totalCircumference * (1 - percentage);
    
    setTimeout(() => {
      circleEl.style.strokeDashoffset = offset;
    }, 100);

    badgeEl.className = 'gauge-status-badge';
    let badgeKey, badgeText;
    if (score < 3.0) {
      badgeKey = 'dashboard.badge_critical_risk'; badgeText = 'Critical Risk';
      badgeEl.classList.add('status-badge-risk-low');
    } else if (score < 4.2) {
      badgeKey = 'dashboard.gauge_badge_moderate_gap'; badgeText = 'Moderate Gap';
      badgeEl.classList.add('status-badge-risk-med');
    } else {
      badgeKey = 'dashboard.gauge_badge_strong_align'; badgeText = 'Strong Align';
      badgeEl.classList.add('status-badge-risk-high');
    }
    // Tag with an i18n key so the badge localizes on load and on language switch.
    badgeEl.setAttribute('data-i18n', badgeKey);
    badgeEl.textContent = badgeText;
    if (window.applyPortalI18n) window.applyPortalI18n();
  }

  // 3. Tab Navigation Switches
  const tabs = document.querySelectorAll('.dashboard-nav-btn');
  const tabPanels = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabPanels.forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
      });

      tab.classList.add('active');
      const activePanelId = `tab-${tab.getAttribute('data-tab')}`;
      const activePanel = document.getElementById(activePanelId);
      
      if (activePanel) {
        if (activePanelId === 'tab-integration-gauges') {
          activePanel.style.display = 'grid';
        } else {
          activePanel.style.display = 'block';
        }
        setTimeout(() => {
          activePanel.classList.add('active');
        }, 10);
      }
    });
  });

  // 4. Render Dynamic HR Modules from database
  function renderActionModules(scores) {
    hrModulesContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem;">Scanning database modules...</p>';
    
    fetch('/api/modules')
      .then(res => res.json())
      .then(modules => {
        hrModulesContainer.innerHTML = '';
        if (!modules || modules.length === 0) {
          hrModulesContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 2rem;">No Action Modules configured in Admin Settings.</p>';
          return;
        }

        // Filter modules by active scores
        const cultureScore = scores.culture;
        const talentScore = scores.talent;
        const valueScore = scores.value;

        const recommended = modules.filter(m => {
          let score = 3.0;
          if (m.dimension === 'culture') score = cultureScore;
          else if (m.dimension === 'talent') score = talentScore;
          else if (m.dimension === 'value') score = valueScore;
          return score >= m.minScore && score <= m.maxScore;
        });

        if (recommended.length === 0) {
          hrModulesContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 2rem;">No modules recommended for your current diagnostic scores. Check score boundaries in Admin.</p>';
          return;
        }

        recommended.forEach(m => {
          const card = document.createElement('div');
          card.className = 'card';
          card.style.margin = '0';
          card.style.borderLeft = `5px solid ${m.dimension === 'culture' ? 'var(--te-orange)' : m.dimension === 'talent' ? 'var(--te-dark-teal)' : '#0D9488'}`;
          
          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem;">
              <h4 style="color: var(--te-dark-teal); font-size: 1.15rem; font-family: var(--font-family-display); font-weight: 700;">${escapeHtml(m.title)}</h4>
              <span class="hero-badge" style="font-size: 0.7rem; font-weight: 700; background-color: var(--bg-light); color: var(--text-secondary); margin: 0; text-transform: uppercase;">
                ${escapeHtml(m.urgency)}
              </span>
            </div>
            <p style="font-size: 0.95rem; color: var(--text-primary); margin-bottom: 1.25rem;">
              <strong>Supporting IMO Teams:</strong> ${escapeHtml(m.supportingTeams || 'Integration Leader, IMO')}<br>
              <strong>Deployment Checklist:</strong> ${escapeHtml(m.description)}
            </p>
            <a href="${m.playbookLink || '/playbook.html'}" class="btn btn-secondary" style="font-size: 0.8rem; padding: 0.4rem 1rem;">Open Playbook Chapter</a>
          `;
          hrModulesContainer.appendChild(card);
        });
      })
      .catch(err => {
        console.error("Error loading modules:", err);
        hrModulesContainer.innerHTML = '<p style="color: var(--status-danger);">Failed to load recommended modules.</p>';
      });
  }

  // 5. Render Coaching Corners & Scripts
  function renderCoachingCorner(scores) {
    coachingContainer.innerHTML = '';

    let coachingHtml = `
      <div class="alert-box alert-box-info" style="margin-top:0;">
        <span class="alert-title">Integration Leader Coach Desk</span>
        <span class="alert-content">
          Your role is central to integration success. Below are specific roleplay coaching guidelines modeled for the ${scores.culture < 3.0 ? 'low cultural alignment' : 'normal onboarding'} score observed in the diagnostics.
        </span>
      </div>
      
      <div style="display: flex; flex-direction: column; gap: 1.5rem; margin-top: 1.5rem;">
    `;

    // Dialogue Scenario 1
    if (scores.culture < 3.0) {
      coachingHtml += `
        <div class="card" style="margin: 0; background: var(--bg-light);">
          <h4 style="margin-bottom: 0.5rem; color: var(--te-dark-teal);">Scenario: Middle Management Resistance</h4>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
            <em>Friction:</em> Local managers feel TE Connectivity is too bureaucratic and will destroy their agility.
          </p>
          <div style="background-color: var(--bg-white); padding: 1rem; border-radius: var(--radius-md); font-size: 0.9rem; border-left: 3px solid var(--te-orange);">
            <strong>Coaching Dialogue Blueprint:</strong><br>
            <span style="color: var(--text-secondary);">"We understand the value of your execution agility; it is exactly why we acquired this company. Our goal is to leverage TE's massive global supply chain to supercharge your agile innovation, not restrict it. Let's work together to establish what processes we can safeguard."</span>
          </div>
        </div>
      `;
    } else {
      coachingHtml += `
        <div class="card" style="margin: 0; background: var(--bg-light);">
          <h4 style="margin-bottom: 0.5rem; color: var(--te-dark-teal);">Scenario: Communication Cadence Transitions</h4>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
            <em>Friction:</em> Minor alignment hurdles in meeting cadences and monthly business reviews.
          </p>
          <div style="background-color: var(--bg-white); padding: 1rem; border-radius: var(--radius-md); font-size: 0.9rem; border-left: 3px solid var(--te-dark-teal);">
            <strong>Coaching Dialogue Blueprint:</strong><br>
            <span style="color: var(--text-secondary);">"Let us hold bi-weekly synchronization meetings to map operating rhythms. We want to align standard deliverables to simplify reports and free up time for your team to focus on R&D."</span>
          </div>
        </div>
      `;
    }

    // Talent Scenario
    if (scores.talent < 3.0) {
      coachingHtml += `
        <div class="card" style="margin: 0; background: var(--bg-light);">
          <h4 style="margin-bottom: 0.5rem; color: var(--te-dark-teal);">Scenario: Talent Retention Frictions</h4>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
            <em>Friction:</em> High-performing engineering staff express flight risks due to fear of career lock-downs.
          </p>
          <div style="background-color: var(--bg-white); padding: 1rem; border-radius: var(--radius-md); font-size: 0.9rem; border-left: 3px solid var(--te-orange);">
            <strong>Coaching Dialogue Blueprint:</strong><br>
            <span style="color: var(--text-secondary);">"Your engineering role here is critical to TE's sensor portfolio. We are launching key talent retention incentives, but more importantly: by joining TE, your career pathways expand into our global laboratories and design centers in the US, Europe, and Asia. Here is our retention blueprint."</span>
          </div>
        </div>
      `;
    } else {
      coachingHtml += `
        <div class="card" style="margin: 0; background: var(--bg-light);">
          <h4 style="margin-bottom: 0.5rem; color: var(--te-dark-teal);">Scenario: Job Level Harmonization</h4>
          <p style="font-size: 0.9rem; color: var(--text-secondary); margin-bottom: 0.75rem;">
            <em>Friction:</em> Employees have questions on how their titles transfer into TE Connectivity levels.
          </p>
          <div style="background-color: var(--bg-white); padding: 1rem; border-radius: var(--radius-md); font-size: 0.9rem; border-left: 3px solid var(--te-dark-teal);">
            <strong>Coaching Dialogue Blueprint:</strong><br>
            <span style="color: var(--text-secondary);">"We mapping our levels to reflect your skills accurately. This harmonization preserves your core benefits and clarifies long-term growth options. Let's schedule a 1-on-1 to review the translation details."</span>
          </div>
        </div>
      `;
    }

    coachingHtml += `
      </div>
      
      <div class="card" style="margin-top: 1.5rem; border-left: 4px solid var(--te-orange);">
        <h4 style="margin-bottom: 0.75rem;">Interactive Integration Leader Checklist</h4>
        <div style="display: flex; flex-direction: column; gap: 0.6rem;">
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; cursor: pointer;">
            <input type="checkbox" style="accent-color: var(--te-orange);"> Complete initial 1-on-1s with top 10% critical acquired employees.
          </label>
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; cursor: pointer;">
            <input type="checkbox" style="accent-color: var(--te-orange);"> Set up bi-weekly synergy calendar for acquired middle managers.
          </label>
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; cursor: pointer;">
            <input type="checkbox" style="accent-color: var(--te-orange);"> Establish clear transition pathways for local HR systems to TE ERP.
          </label>
        </div>
      </div>
    `;

    coachingContainer.innerHTML = coachingHtml;
  }

  // 6. TEodor Coach Interaction Engine & Dialogue Scripts
  const teodorFaqs = {
    culture: "Quack! Middle management anxiety is extremely common. I recommend scheduling weekly touchpoints between acquired functional leads and the TE Integration Office. Acknowledge their execution speed, and explain that TE's goal is to scale their innovation globally, not block it! Always encourage feedback loops.",
    talent: "Quack! Key engineers fear being locked down. You should immediately coordinate with the Compensation & Benefits team to deploy the Key Talent Retention Incentives. Let them know that at TE, they gain massive career opportunities across laboratories in the US, Europe, and Asia!",
    values: "Quack! TE's core values are Integrity, Accountability, Teamwork, and Innovation. Rather than delivering corporate slide decks, hold interactive values synergy workshops! Focus on how their local strengths amplify these four pillars, and show that we are stronger together.",
    systems: "Quack! Slow IT systems transition is a major friction. Engage the IT & Cybersecurity team immediately. Send the compliance training links to their emails, track completions, and provide personalized support for setting up corporate logins in the first 30 days."
  };

  const duckCoach = document.getElementById('teodor-duck-coach');
  const speechBubble = document.getElementById('teodor-speech-bubble');
  
  if (duckCoach && speechBubble) {
    duckCoach.addEventListener('click', () => {
      duckCoach.classList.add('quacking');
      // If AI is downloaded, speech bubble changes to a dynamic message
      if (document.getElementById('teodor-chat-panel').style.display === 'block') {
        speechBubble.innerHTML = "Quack! I am operating as a fully autonomous **Hugging Face AI Insight**! Type any question in the console below to check my step-by-step reasoning!";
      } else {
        speechBubble.innerHTML = "Quack! I am <strong>TEodor</strong>, your M&A advisor. Select one of the integration questions below and I'll give you premium corporate coaching advice!";
      }
      setTimeout(() => {
        duckCoach.classList.remove('quacking');
      }, 500);
    });

    document.querySelectorAll('.faq-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const faqType = btn.getAttribute('data-faq');
        if (teodorFaqs[faqType]) {
          duckCoach.classList.add('quacking');
          speechBubble.innerHTML = teodorFaqs[faqType];
          setTimeout(() => {
            duckCoach.classList.remove('quacking');
          }, 500);
        }
      });
    });
  }

  // ==========================================
  // NEW IN-BROWSER DUCK LOCAL LLM & SMOLAGENT
  // ==========================================
  
  let teodorPipeline = null;
  let activeAiInsight = null;

  class AiInsight {
    constructor(modelPipeline, loggerCallback) {
      this.pipeline = modelPipeline;
      this.logger = loggerCallback;
      
      // Client-Side Tools
      this.tools = {
        getDiagnosticsScore: async (dimension) => {
          try {
            const res = await fetch('/api/assessment/latest');
            const data = await res.json();
            if (data.success && data.assessment) {
              const score = data.assessment.scores[dimension];
              return `Diagnostics evaluation: ${dimension.toUpperCase()} score is ${score || 'unknown'}/5.0.`;
            }
            return `Diagnostics check: No assessment score found for ${dimension}.`;
          } catch (e) {
            return `Error verifying scores: ${e.message}`;
          }
        },
        searchPlaybook: async (query) => {
          try {
            const res = await fetch(`/api/rag/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data.success && data.results && data.results.length > 0) {
              const snippets = data.results.map((r, idx) => `[Rule #${idx+1}] [${r.chapter}] ${r.title}: "${r.text}"`).join('\n');
              return `Retrieved ${data.results.length} relevant integration playbook guidelines from backend RAG index:\n${snippets}`;
            }
            return `RAG search check: No matching playbook guidelines found for query keyword "${query}".`;
          } catch (e) {
            return `Error querying backend RAG search index: ${e.message}`;
          }
        },
        getPlaybookLink: async (dimension) => {
          const links = {
            culture: "/playbook.html#culture",
            talent: "/playbook.html#talent",
            value: "/playbook.html#value"
          };
          return `Target Playbook coordinates: Chapter link is ${links[dimension] || '/playbook.html'}.`;
        },
        getAcquisitionProgress: async () => {
          try {
            const res = await fetch('/api/employees');
            const employees = await res.json();
            if (employees && employees.length > 0) {
              const totalXp = employees.reduce((sum, e) => sum + (e.points || 0), 0);
              const avgLessons = employees.reduce((sum, e) => sum + (e.completedLessons ? e.completedLessons.length : 0), 0) / employees.length;
              const certified = employees.filter(e => (e.points || 0) >= 100).length;
              return `Acquisition Analytics: Roster lists ${employees.length} employees, total accrued XP is ${totalXp}, average lessons completed is ${avgLessons.toFixed(1)}/9, and ${certified} employee(s) have reached Certified status.`;
            }
            return `Acquisition Analytics: No employees found in the database.`;
          } catch (e) {
            return `Error loading workforce: ${e.message}`;
          }
        }
      };
    }

    async run(userInput) {
      const query = userInput.toLowerCase();
      const actions = [];
      
      if (query.includes('culture') || query.includes('values') || query.includes('anxiety') || query.includes('resist')) {
        actions.push({
          thought: "User is asking about culture, values, or managerial anxiety. I need to run getDiagnosticsScore to check the current Culture score.",
          tool: "getDiagnosticsScore",
          arg: "culture",
          nextThought: "Diagnostic culture score verified. Querying backend RAG search index to pull official Culture playbook guidelines."
        });
        actions.push({
          tool: "searchPlaybook",
          arg: "culture values communication resistance town hall",
          nextThought: "RAG guidelines parsed. Let's also fetch the direct playbook URL coordinate link for the Integration Leader."
        });
        actions.push({
          tool: "getPlaybookLink",
          arg: "culture",
          nextThought: "All diagnostic, RAG rules, and coordinate resources are loaded. Running neural network compiler to formulate final recommendation."
        });
      } else if (query.includes('talent') || query.includes('retention') || query.includes('engineer') || query.includes('sso') || query.includes('access') || query.includes('systems')) {
        actions.push({
          thought: "User is asking about talent retention, engineering incentives, or systems access onboarding. Checking current Talent & Systems score.",
          tool: "getDiagnosticsScore",
          arg: "talent",
          nextThought: "Talent score is compiled. Querying backend RAG index for Comp & Benefits integration policies."
        });
        actions.push({
          tool: "searchPlaybook",
          arg: "talent retention R&D cyber security SSO credentials",
          nextThought: "Talent policies retrieved via RAG. Fetching target playbook coordinates for the Integration Leader."
        });
        actions.push({
          tool: "getPlaybookLink",
          arg: "talent",
          nextThought: "Playbook coordinates locked in. Loading deep learning model to finalize the quacking advice."
        });
      } else if (query.includes('value') || query.includes('synergy') || query.includes('sales') || query.includes('pricing') || query.includes('patent')) {
        actions.push({
          thought: "User is asking about synergy capture, sales networks, or patent technology transfer. Verifying the Value & Synergies score.",
          tool: "getDiagnosticsScore",
          arg: "value",
          nextThought: "Value score retrieved. Running backend RAG search for sales network and IP protection guidelines."
        });
        actions.push({
          tool: "searchPlaybook",
          arg: "synergy pricing sales distribution technology transfer patent",
          nextThought: "RAG compliance snippets acquired. Fetching CRM/pipeline integration coordinate link."
        });
        actions.push({
          tool: "getPlaybookLink",
          arg: "value",
          nextThought: "Resources obtained. Loading Transformers inference parameters to generate response."
        });
      } else if (query.includes('progress') || query.includes('employee') || query.includes('xp') || query.includes('roster') || query.includes('certified') || query.includes('academy')) {
        actions.push({
          thought: "User wants a status report on Employee Academy progress and leaderboard metrics. Checking getAcquisitionProgress.",
          tool: "getAcquisitionProgress",
          arg: null,
          nextThought: "Workforce analytics successfully pulled. Ready to formulate final progress report."
        });
      } else {
        actions.push({
          thought: `This is a general post-merger integration query. Let's run a backend RAG query to pull standard playbook guidelines matching: "${userInput}".`,
          tool: "searchPlaybook",
          arg: userInput,
          nextThought: "Playbook insights retrieved. Let's also check workforce academy stats to provide complete organizational context."
        });
        actions.push({
          tool: "getAcquisitionProgress",
          arg: null,
          nextThought: "Workforce progress loaded. Running local LLM inference to compile advice."
        });
      }

      // Execute Action Steps
      for (let act of actions) {
        if (act.thought) {
          this.logger({ type: 'thought', text: act.thought });
          await new Promise(r => setTimeout(r, 900));
        }
        
        this.logger({ type: 'action', text: `run ${act.tool}(${act.arg ? `'${act.arg}'` : ''})` });
        await new Promise(r => setTimeout(r, 700));
        
        const observation = await this.tools[act.tool](act.arg);
        this.logger({ type: 'observation', text: observation });
        await new Promise(r => setTimeout(r, 1000));
        
        if (act.nextThought) {
          this.logger({ type: 'thought', text: act.nextThought });
          await new Promise(r => setTimeout(r, 800));
        }
      }

      this.logger({ type: 'thought', text: "Synthesizing final advice with TEodor duck speech parameters..." });
      await new Promise(r => setTimeout(r, 600));

      let finalAnswer = "";
      if (this.pipeline) {
        try {
          const finalPrompt = `Post-merger integration question: "${userInput}". Context: Culture score 3.67, Talent score 4.67, Value score 5.0. Answer in a helpful, coaching tone:`;
          const result = await this.pipeline(finalPrompt, { max_new_tokens: 75 });
          finalAnswer = result[0]?.generated_text || result[0]?.translation_text || "";
          
          if (!finalAnswer.toLowerCase().startsWith("quack")) {
            finalAnswer = "Quack! " + finalAnswer;
          }
        } catch (err) {
          console.error("Local LLM inference error, using high-fidelity fallback:", err);
          finalAnswer = this.getFallbackAnswer(query);
        }
      } else {
        finalAnswer = this.getFallbackAnswer(query);
      }

      this.logger({ type: 'final', text: finalAnswer });
      return finalAnswer;
    }

    getFallbackAnswer(query) {
      if (query.includes('culture') || query.includes('values') || query.includes('anxiety') || query.includes('resist')) {
        return "Quack! Middle management anxiety is best handled via early values workshops and localized town halls. Since our diagnostics showed a Culture & Values score of 3.67 (Moderate Gap), prioritize communication cadences. Ensure you open our comprehensive [Culture and Values Playbook](/playbook.html#culture) to schedule the TE Values Synergy Workshops.";
      }
      if (query.includes('talent') || query.includes('retention') || query.includes('engineer') || query.includes('sso') || query.includes('access') || query.includes('systems')) {
        return "Quack! Our Talent & Systems alignment is highly positive at 4.67. To safeguard this, make sure SSO logins are fully distributed and cyber training completed in the first 30 days. Read the [Talent Mapping & Retention Guide](/playbook.html#talent) for key retention incentive models.";
      }
      if (query.includes('value') || query.includes('synergy') || query.includes('sales') || query.includes('pricing') || query.includes('patent')) {
        return "Quack! Commercial synergy capture is rated at 5.0 (Strong Alignment). Secure this target by catalog alignment and pipeline integration. Check out the [Value Synergy Playbook](/playbook.html#value) to coordinate direct supply-chain handoffs.";
      }
      if (query.includes('progress') || query.includes('employee') || query.includes('xp') || query.includes('roster') || query.includes('certified') || query.includes('academy')) {
        return "Quack! Our Academy Roster currently tracks 3 pre-seeded integration leads. Emma Watson is leading with 160 XP (Synergy Scout badge tier), followed by Sarah Jenkins at 110 XP (Systems Scholar badge tier). Keep awarding Merit Points (+50 XP) to integration champions to unlock milestone bonuses!";
      }
      return "Quack! I am TEodor, your post-merger integration coach! Ask me about culture gaps, engineer retention incentives, product synergies, or the employee training progress dashboard!";
    }
  }

  // Initialize TEodor chatbot and background model compilation
  function initTeodorLocalAI() {
    const progressContainer = document.getElementById('teodor-download-progress-bar-container');
    const progressFill = document.getElementById('teodor-download-progress-fill');
    const percentEl = document.getElementById('teodor-download-percent');
    const statusLabelEl = document.getElementById('teodor-download-status-label');
    
    const staticFaqContainer = document.getElementById('teodor-static-faq-container');
    const chatPanel = document.getElementById('teodor-chat-panel');
    const chatHistory = document.getElementById('teodor-chat-history');
    const reasoningLogs = document.getElementById('teodor-reasoning-logs');
    const logContent = document.getElementById('teodor-log-content');
    const chatForm = document.getElementById('teodor-chat-form');
    const chatInput = document.getElementById('teodor-chat-input');

    if (!progressContainer || !chatPanel) return;

    fetch('/api/settings')
      .then(res => res.json())
      .then(async (settings) => {
        const browserModel = settings.browserModel || 'none';
        
        if (browserModel === 'none') {
          // Normal static FAQ mode
          if (staticFaqContainer) staticFaqContainer.style.display = 'block';
          chatPanel.style.display = 'none';
          progressContainer.style.display = 'none';
          return;
        }

        // AI Mode Selected - Show Downloader & Hide static FAQs
        if (staticFaqContainer) staticFaqContainer.style.display = 'none';
        progressContainer.style.display = 'block';
        chatPanel.style.display = 'none';

        if (speechBubble) {
          speechBubble.innerHTML = `📥 Quack! Downloading my AI Brain (model: <strong>${browserModel}</strong>) directly in your browser. Once loaded, my full chat console activates!`;
        }

        if (browserModel === 'simulated-duck') {
          // Run high-fidelity simulated download over 5 seconds
          let currentPct = 0;
          const totalSizeMB = 120.4;
          
          const interval = setInterval(() => {
            currentPct += Math.floor(Math.random() * 15) + 5;
            if (currentPct >= 100) {
              currentPct = 100;
              clearInterval(interval);
              
              progressFill.style.width = '100%';
              percentEl.textContent = '100%';
              statusLabelEl.textContent = `Completed! Fully Compiled ${totalSizeMB} MB`;
              
              setTimeout(() => {
                activateChatPanel(null);
              }, 400);
            } else {
              const loadedMB = ((currentPct / 100) * totalSizeMB).toFixed(1);
              progressFill.style.width = `${currentPct}%`;
              percentEl.textContent = `${currentPct}%`;
              statusLabelEl.textContent = `Downloading AI Brain... ${loadedMB} MB / ${totalSizeMB} MB`;
            }
          }, 500);
          
        } else {
          // Real Transformers.js CDN loading
          try {
            const modelName = browserModel === 'lamini-78m' ? 'Xenova/LaMini-Flan-T5-78M' : 'Xenova/Qwen1.5-0.5B-Chat';
            statusLabelEl.textContent = `Importing Transformers.js CDN...`;
            
            // Dynamic import of transformers
            const transformers = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2');
            
            // Configure transformers environmental variables for browser execution
            transformers.env.allowLocalModels = false;
            
            statusLabelEl.textContent = `Connecting to Hugging Face Hub...`;
            
            // Instantiate pipeline with progress callback
            const pipelineInstance = await transformers.pipeline('text2text-generation', modelName, {
              progress_callback: (data) => {
                if (data.status === 'progress') {
                  const pct = Math.floor(data.progress || 0);
                  progressFill.style.width = `${pct}%`;
                  percentEl.textContent = `${pct}%`;
                  statusLabelEl.textContent = `Downloading ${data.file || 'model files'}... (${pct}%)`;
                } else if (data.status === 'ready') {
                  statusLabelEl.textContent = `Compiling model parameters...`;
                }
              }
            });

            progressFill.style.width = '100%';
            percentEl.textContent = '100%';
            statusLabelEl.textContent = `Ready! Model parameters loaded.`;
            
            setTimeout(() => {
              activateChatPanel(pipelineInstance);
            }, 500);
            
          } catch (error) {
            console.error("Transformers.js download failed, falling back to simulated engine:", error);
            statusLabelEl.textContent = `⚠️ Network Error. Fallback to Local Neural Simulation...`;
            
            // Automatic fallback to simulated duck
            let currentPct = 0;
            const interval = setInterval(() => {
              currentPct += 20;
              if (currentPct >= 100) {
                currentPct = 100;
                clearInterval(interval);
                activateChatPanel(null);
              } else {
                progressFill.style.width = `${currentPct}%`;
                percentEl.textContent = `${currentPct}%`;
              }
            }, 300);
          }
        }
      })
      .catch(err => console.error("Error checking browser AI settings:", err));

    function activateChatPanel(pipelineInstance) {
      progressContainer.style.display = 'none';
      chatPanel.style.display = 'block';
      chatPanel.style.animation = 'slideIn 0.5s ease-in-out';
      
      if (speechBubble) {
        const inlineDuck = typeof window.getTeodorDuckSvg === 'function' ? window.getTeodorDuckSvg('24px', 'teodor-duck-inline teodor-duck-coach-animated') : '🦆';
        speechBubble.innerHTML = `${inlineDuck} Quack! My AI Brain is fully operational! Use the console below to ask me anything. Watch my **AI Insight tool calls** execute live!`;
      }

      teodorPipeline = pipelineInstance;
      activeAiInsight = new AiInsight(teodorPipeline, (logStep) => {
        if (logStep.type === 'thought') {
          logContent.innerHTML += `<div style="color: #38BDF8; margin-bottom: 0.5rem; font-family: monospace;">💭 <strong>[THOUGHT]:</strong> ${escapeHtml(logStep.text)}</div>`;
        } else if (logStep.type === 'action') {
          logContent.innerHTML += `<div style="color: #FBBF24; margin-bottom: 0.5rem; font-family: monospace;">⚡ <strong>[CALL TOOL]:</strong> ${escapeHtml(logStep.text)}</div>`;
        } else if (logStep.type === 'observation') {
          logContent.innerHTML += `<div style="color: #10B981; margin-bottom: 0.5rem; font-family: monospace;">🔍 <strong>[OBSERVATION]:</strong> ${escapeHtml(logStep.text)}</div>`;
        } else if (logStep.type === 'final') {
          const logDuck = typeof window.getTeodorDuckSvg === 'function' ? window.getTeodorDuckSvg('18px', 'teodor-duck-inline teodor-duck-coach-animated') : '🦆';
          logContent.innerHTML += `<div style="color: #E98300; margin-bottom: 0.5rem; font-family: monospace; border-top: 1px dashed #334155; padding-top: 0.5rem; display: flex; align-items: center; gap: 0.35rem;">${logDuck} <strong>[FINAL ANSWER]:</strong> ${escapeHtml(logStep.text)}</div>`;
        }
        logContent.scrollTop = logContent.scrollHeight;
      });

      // Bind Chat Submits
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const userInput = chatInput.value.trim();
        if (!userInput) return;

        chatInput.value = '';
        appendUserMessage(userInput);

        // Open and Clear logs panel
        reasoningLogs.style.display = 'block';
        logContent.innerHTML = '';

        // Animate quack
        if (duckCoach) duckCoach.classList.add('quacking');

        const answer = await activeAiInsight.run(userInput);
        
        if (duckCoach) duckCoach.classList.remove('quacking');
        appendAssistantMessage(formatMarkdownLinks(answer));
      });

      // Bind Suggestion Tags
      document.querySelectorAll('.quick-chat-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const query = btn.getAttribute('data-query');
          chatInput.value = query;
          chatForm.dispatchEvent(new Event('submit'));
        });
      });
    }

    function appendUserMessage(text) {
      chatHistory.innerHTML += `
        <div class="chat-bubble user" style="align-self: flex-end; background-color: var(--te-dark-teal); color: var(--text-light); padding: 0.75rem 1rem; border-radius: 12px 12px 0 12px; max-width: 85%; font-size: 0.9rem; box-shadow: var(--shadow-sm); line-height: 1.4;">
          ${escapeHtml(text)}
        </div>
      `;
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function appendAssistantMessage(htmlContent) {
      chatHistory.innerHTML += `
        <div class="chat-bubble assistant" style="align-self: flex-start; background-color: var(--te-orange-light); border: 1px solid rgba(233, 131, 0, 0.2); padding: 0.75rem 1rem; border-radius: 12px 12px 12px 0; max-width: 85%; font-size: 0.9rem; color: var(--te-dark-teal); box-shadow: var(--shadow-sm); line-height: 1.4;">
          ${htmlContent}
        </div>
      `;
      chatHistory.scrollTop = chatHistory.scrollHeight;
    }

    function formatMarkdownLinks(text) {
      return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="btn-link" style="color: var(--te-orange); font-weight: 700; text-decoration: underline;">$1</a>');
    }
  }

  // ==========================================
  // ACADEMY TRACKING ROSTER & KPI CONTROLLERS
  // ==========================================
  
  let globalEmployees = [];

  function loadAcademyTracking() {
    const tbody = document.getElementById('academy-roster-table-body');
    const avgRateEl = document.getElementById('academy-avg-rate');
    const totalXpEl = document.getElementById('academy-total-xp');
    const certifiedEl = document.getElementById('academy-certified-count');
    const searchInput = document.getElementById('roster-search-input');

    if (!tbody) return;

    fetch('/api/employees')
      .then(res => res.json())
      .then(employees => {
        globalEmployees = employees || [];
        renderRoster(globalEmployees);
        calculateAcademyKPIs(globalEmployees);
      })
      .catch(err => {
        console.error("Error loading Academy employees:", err);
        tbody.innerHTML = '<tr><td colspan="6" style="padding:2rem; text-align:center; color:var(--status-danger);">Failed to load employee roster.</td></tr>';
      });

    // Roster Search filter binding
    if (searchInput) {
      searchInput.addEventListener('keyup', () => {
        const query = searchInput.value.toLowerCase().trim();
        const filtered = globalEmployees.filter(e => {
          return e.name.toLowerCase().includes(query) ||
                 e.role.toLowerCase().includes(query) ||
                 e.department.toLowerCase().includes(query);
        });
        renderRoster(filtered);
      });
    }

    function calculateAcademyKPIs(list) {
      if (!list || list.length === 0) {
        avgRateEl.textContent = '0%';
        totalXpEl.textContent = '0 XP';
        certifiedEl.textContent = '0';
        return;
      }

      // Avg. completion rate (each has max 9 lessons)
      let totalLessonsCompleted = 0;
      let totalPoints = 0;
      let certifiedCount = 0;

      list.forEach(e => {
        const completedCount = e.completedLessons ? e.completedLessons.length : 0;
        totalLessonsCompleted += completedCount;
        totalPoints += (e.points || 0);

        // Certified === reached the "Certified Integrator" milestone at 100 XP
        // (single source of truth; matches the employee milestone label and the AI insight).
        if ((e.points || 0) >= 100) {
          certifiedCount++;
        }
      });

      const maxPossibleLessons = list.length * 9;
      const avgRate = ((totalLessonsCompleted / maxPossibleLessons) * 100).toFixed(0);

      avgRateEl.textContent = `${avgRate}%`;
      totalXpEl.textContent = `${totalPoints} XP`;
      certifiedEl.textContent = certifiedCount;
    }

    function renderRoster(list) {
      tbody.innerHTML = '';
      if (!list || list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="padding:2rem; text-align:center; color:var(--text-dim);">No matching employees found in roster.</td></tr>';
        return;
      }

      list.forEach(e => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-color)';
        tr.style.transition = 'background-color 0.2s ease';
        
        const completedCount = e.completedLessons ? e.completedLessons.length : 0;
        const progressPct = ((completedCount / 9) * 100).toFixed(0);
        
        let badgeColorClass = 'status-badge-risk-low'; // red/orange
        if (completedCount >= 9) badgeColorClass = 'status-badge-risk-high'; // green
        else if (completedCount >= 6) badgeColorClass = 'status-badge-risk-med'; // yellow/teal
        else if (completedCount >= 3) badgeColorClass = 'status-badge-risk-med';

        tr.innerHTML = `
          <td style="padding: 1rem;">
            <div style="font-weight:700; color:var(--te-dark-teal);">${escapeHtml(e.name)}</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">${escapeHtml(e.role)}</div>
          </td>
          <td style="padding: 1rem; font-size: 0.9rem; color: var(--text-primary); font-weight: 500;">
            ${escapeHtml(e.department)}
          </td>
          <td style="padding: 1rem; width: 220px;">
            <div style="display:flex; justify-content:space-between; font-size:0.75rem; font-weight:700; margin-bottom:0.25rem; color: var(--text-primary);">
              <span>${completedCount} / 9 Lessons</span>
              <span>${progressPct}%</span>
            </div>
            <div style="height: 6px; background-color: var(--border-color); border-radius: 3px; overflow:hidden;">
              <div style="height: 100%; background-color: var(--te-orange); width: ${progressPct}%; transition: width 0.5s ease;"></div>
            </div>
          </td>
          <td style="padding: 1rem;">
            <span class="gauge-status-badge ${badgeColorClass}" style="font-size: 0.7rem; font-weight: 700; padding: 0.25rem 0.5rem; text-transform: uppercase;">
              ${escapeHtml(e.badge || 'New Recruit')}
            </span>
          </td>
          <td style="padding: 1rem;">
            <span class="hero-badge" style="background-color: var(--te-dark-teal-light); color: var(--te-dark-teal); font-weight: 800; font-size: 0.8rem; margin:0; border-color: rgba(36,76,90,0.15);">
              🏆 ${e.points || 0} XP
            </span>
          </td>
          <td style="padding: 1rem; text-align: right;">
            <button class="btn btn-secondary btn-award-merit-trigger" data-id="${e.id}" data-name="${escapeHtml(e.name)}" style="font-size:0.75rem; padding: 0.35rem 0.75rem; margin: 0; font-weight: 700; border-color: var(--te-orange); color: var(--te-orange);">
              🏅 Award Merit
            </button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      // Bind Award Merit click triggers
      document.querySelectorAll('.btn-award-merit-trigger').forEach(btn => {
        btn.addEventListener('click', () => {
          const empId = btn.getAttribute('data-id');
          const empName = btn.getAttribute('data-name');
          openMeritModal(empId, empName);
        });
      });
    }
  }

  // Merit Award Modal Dialog Controllers
  const meritModal = document.getElementById('award-merit-modal');
  const closeMeritModalBtn = document.getElementById('close-merit-modal-btn');
  const cancelMeritBtn = document.getElementById('cancel-merit-btn');
  const meritForm = document.getElementById('award-merit-form');
  const reasonSelect = document.getElementById('merit-reason-select');
  const customPointsContainer = document.getElementById('custom-points-container');

  function openMeritModal(id, name) {
    if (!meritModal) return;
    document.getElementById('merit-emp-id').value = id;
    document.getElementById('merit-emp-name').value = name;
    
    // Reset inputs
    reasonSelect.value = '50';
    customPointsContainer.style.display = 'none';
    document.getElementById('merit-points-custom').value = '50';
    document.getElementById('merit-notes').value = '';

    meritModal.style.display = 'flex';
    setTimeout(() => {
      meritModal.style.opacity = '1';
      meritModal.querySelector('.modal-content').style.transform = 'scale(1)';
    }, 10);
  }

  function closeMeritModal() {
    if (!meritModal) return;
    meritModal.style.opacity = '0';
    meritModal.querySelector('.modal-content').style.transform = 'scale(0.9)';
    setTimeout(() => {
      meritModal.style.display = 'none';
    }, 300);
  }

  if (closeMeritModalBtn) closeMeritModalBtn.addEventListener('click', closeMeritModal);
  if (cancelMeritBtn) cancelMeritBtn.addEventListener('click', closeMeritModal);
  
  if (reasonSelect) {
    reasonSelect.addEventListener('change', () => {
      if (reasonSelect.value === 'custom') {
        customPointsContainer.style.display = 'block';
      } else {
        customPointsContainer.style.display = 'none';
      }
    });
  }

  if (meritForm) {
    meritForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const empId = document.getElementById('merit-emp-id').value;
      const empName = document.getElementById('merit-emp-name').value;
      const selectVal = reasonSelect.value;
      
      let pointsToAward = 50;
      if (selectVal === 'custom') {
        pointsToAward = parseInt(document.getElementById('merit-points-custom').value) || 50;
      } else {
        pointsToAward = parseInt(selectVal) || 50;
      }

      fetch('/api/employees/award-merit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ empId, points: pointsToAward })
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          closeMeritModal();
          showToast(`Awarded +${pointsToAward} XP to ${empName}!`, 'success');
          
          // Re-render Academy roster & refresh scorecard KPIs
          loadAcademyTracking();
          
          // Also, re-fetch gauge metrics and trigger success feeds to align overall indicators
          loadOnboardingSuccess();
        } else {
          showToast('Failed to award merit points. Please try again.', 'error');
        }
      })
      .catch(err => {
        console.error("Error awarding merit bonus:", err);
        showToast('Server communications failure.', 'error');
      });
    });
  }

  // Custom Toast Notification popup
  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '2rem';
    toast.style.right = '2rem';
    toast.style.padding = '1rem 1.5rem';
    toast.style.backgroundColor = type === 'success' ? 'var(--te-dark-teal)' : '#DC2626';
    toast.style.color = '#FFFFFF';
    toast.style.borderRadius = 'var(--radius-md)';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
    toast.style.zIndex = '9999';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.gap = '0.75rem';
    toast.style.borderLeft = '5px solid var(--te-orange)';
    toast.style.transform = 'translateY(20px)';
    toast.style.opacity = '0';
    toast.style.transition = 'all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
    
    toast.innerHTML = `
      <span style="font-size: 1.3rem;">${type === 'success' ? '🏅' : '⚠️'}</span>
      <span style="font-weight: 700; font-size: 0.9rem; font-family: var(--font-family-body);">${escapeHtml(message)}</span>
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    }, 50);
    
    setTimeout(() => {
      toast.style.transform = 'translateY(20px)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3800);
  }

  // ==========================================
  // SHARED ANNOUNCEMENT AND PULSE DESK
  // ==========================================

  // 7. Dynamic Alert Announcement Banners (Removed - Replaced by Calendar Hub)
  function loadAlerts() {
    return; // Dynamic alerts fully disabled
    const alertCenter = document.getElementById('announcement-center');
    if (!alertCenter) return;

    fetch('/api/alerts')
      .then(res => res.json())
      .then(alerts => {
        alertCenter.innerHTML = '';
        if (!alerts || alerts.length === 0) return;

        alerts.forEach(a => {
          const banner = document.createElement('div');
          banner.className = `announcement-banner ${a.type || 'news'}`;
          
          banner.innerHTML = `
            <div class="announcement-icon-pulsing">
              ${a.type === 'meeting' ? '📅' : a.type === 'training' ? '🛡️' : '📣'}
            </div>
            <div class="announcement-content-box">
              <div class="announcement-title">${escapeHtml(a.title)}</div>
              <div class="announcement-desc">${escapeHtml(a.message)}</div>
            </div>
            <button class="announcement-close-btn" title="Dismiss Alert">&times;</button>
          `;

          banner.querySelector('.announcement-close-btn').addEventListener('click', () => {
            banner.style.opacity = '0';
            banner.style.transform = 'translateY(-10px)';
            setTimeout(() => banner.remove(), 300);
          });

          alertCenter.appendChild(banner);
        });
      })
      .catch(err => console.error("Error loading alerts:", err));
  }

  // 8. 30-Day Onboarding Success & Pulses Tracker
  function loadOnboardingSuccess() {
    const sentimentText = document.getElementById('sentiment-average-text');
    const sentimentPointer = document.getElementById('sentiment-marker-pointer');
    const commentsFeed = document.getElementById('pulse-comments-feed');

    if (!sentimentText || !sentimentPointer || !commentsFeed) return;

    fetch('/api/pulses')
      .then(res => res.json())
      .then(pulses => {
        commentsFeed.innerHTML = '';
        if (!pulses || pulses.length === 0) {
          commentsFeed.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 2rem;">No employee feedback pulse surveys recorded yet.</p>';
          sentimentText.textContent = "0.0 / 5.0";
          sentimentPointer.style.left = "0%";
          sentimentPointer.textContent = "0.0";
          return;
        }

        // Calculate Sentiment Average
        let sum = 0;
        pulses.forEach(p => sum += p.rating);
        const avg = sum / pulses.length;

        // Position Slider marker: Rating ranges from 1.0 to 5.0 (4 units spacing)
        const markerPercent = ((avg - 1.0) / 4.0) * 100;
        sentimentPointer.style.left = `${Math.max(0, Math.min(100, markerPercent))}%`;
        sentimentPointer.textContent = avg.toFixed(1);
        sentimentText.textContent = `${avg.toFixed(1)} / 5.0`;

        // Render comments newest first
        const sorted = [...pulses].reverse();
        sorted.forEach(p => {
          const card = document.createElement('div');
          card.className = 'pulse-comment-card';
          
          const dateStr = new Date(p.timestamp).toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });

          const stars = '★'.repeat(p.rating) + '☆'.repeat(5 - p.rating);

          card.innerHTML = `
            <div class="pulse-comment-header">
              <span style="color: var(--te-dark-teal); font-weight: 700;">${escapeHtml(p.employeeName)}</span>
              <span>${dateStr}</span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 0.5rem; flex-wrap: wrap; gap: 0.5rem;">
              <p style="margin: 0; color: var(--text-primary); font-size: 0.9rem; flex-grow: 1;">"${escapeHtml(p.comment || 'No comment provided')}"</p>
              <div class="pulse-comment-rating" title="Rating: ${p.rating} / 5">
                ${stars}
              </div>
            </div>
          `;

          commentsFeed.appendChild(card);
        });
      })
      .catch(err => {
        console.error("Error loading success pulses:", err);
        commentsFeed.innerHTML = '<p style="color: var(--status-danger);">Failed to load pulse data.</p>';
      });
  }

  // 9. Markdown Plan Parser Engine
  function renderMarkdownPlan(md) {
    if (!md) {
      aiPlanMarkdown.innerHTML = '<p style="color: var(--status-danger);">Error: No plan content compiled.</p>';
      return;
    }

    let html = md
      .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
      .replace(/^---$/gm, '<hr style="border: 0; height: 1px; background: var(--border-color); margin: 2rem 0;">')
      .replace(/^# (.*$)/gim, '<h2 style="font-size: 2.2rem; color: var(--te-dark-teal); font-family: var(--font-family-display); font-weight: 800; margin-top: 0; margin-bottom: 1.5rem; border-bottom: 2px solid var(--te-orange); padding-bottom: 0.5rem;">$1</h2>')
      .replace(/^## (.*$)/gim, '<h3 style="font-size: 1.6rem; color: var(--te-dark-teal); font-family: var(--font-family-display); font-weight: 700; margin-top: 2rem; margin-bottom: 1.25rem; border-bottom: 1px solid var(--border-color); padding-bottom: 0.25rem;">$1</h3>')
      .replace(/^### (.*$)/gim, '<h4 style="font-size: 1.25rem; color: var(--te-dark-teal); font-family: var(--font-family-display); font-weight: 600; margin-top: 1.5rem; margin-bottom: 0.75rem;">$1</h4>')
      .replace(/^#### (.*$)/gim, '<h5 style="font-size: 1.05rem; color: var(--text-primary); font-weight: 700; margin-top: 1.25rem; margin-bottom: 0.5rem;">$1</h5>')
      .replace(/> \[\!NOTE\]\s*\n*> (.*$)/gim, '<div class="alert-box alert-box-info"><span class="alert-title">Note</span><span class="alert-content">$1</span></div>')
      .replace(/> \[\!WARNING\]\s*\n*> (.*$)/gim, '<div class="alert-box alert-box-warning"><span class="alert-title">Warning</span><span class="alert-content">$1</span></div>')
      .replace(/> \[\!IMPORTANT\]\s*\n*> (.*$)/gim, '<div class="alert-box alert-box-info" style="border-left-color: var(--te-orange);"><span class="alert-title" style="color: var(--te-orange);">Important</span><span class="alert-content">$1</span></div>')
      .replace(/> \[\!CAUTION\]\s*\n*> (.*$)/gim, '<div class="alert-box alert-box-warning" style="border-left-color: var(--status-danger); background-color: var(--status-danger-light); color: #7F1D1D;"><span class="alert-title" style="color: var(--status-danger);">Caution</span><span class="alert-content">$1</span></div>')
      .replace(/^> (.*$)/gim, '<blockquote style="border-left: 4px solid var(--te-orange); background: var(--bg-light); padding: 0.75rem 1.25rem; margin: 1.5rem 0; border-radius: 0 var(--radius-md) var(--radius-md) 0; font-size: 0.95rem; color: var(--text-secondary);">$1</blockquote>')
      .replace(/\*\*(.*?)\*\*/g, '<strong style="color: var(--te-dark-teal); font-weight: 700;">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\| (.*) \|/g, (match) => {
        if (match.includes(':---') || match.includes('---:')) {
          return '';
        }
        const cells = match.split('|').map(c => c.trim()).filter(c => c !== '');
        let isHeader = false;
        if (match.includes('Integration Dimension') || match.includes('Functional Team') || match.includes('Corporate Track')) {
          isHeader = true;
        }
        const tag = isHeader ? 'th' : 'td';
        const rowCells = cells.map(cell => `<${tag} style="padding: 0.75rem 1rem; border: 1px solid var(--border-color);">${cell}</${tag}>`).join('');
        return `<tr style="border-bottom: 1px solid var(--border-color);">${rowCells}</tr>`;
      });

    html = html
      .replace(/(<tr[^>]*>[\s\S]*?<\/tr>)+/gi, (match) => {
        return `<div style="overflow-x: auto; margin: 1.5rem 0;"><table style="width: 100%; border-collapse: collapse; border: 1px solid var(--border-color);">${match}</table></div>`;
      })
      .replace(/^\s*\*\s+(.*$)/gim, '<li style="margin-bottom: 0.5rem; list-style: square; margin-left: 1.5rem; color: var(--text-primary);">$1</li>')
      .replace(/^([^<].*)$/gim, '<p style="margin-bottom: 1rem; color: var(--text-primary);">$1</p>')
      .replace(/<p><\/p>/g, '')
      .replace(/<p><h/g, '<h')
      .replace(/<\/h(\d)><\/p>/g, '</h$1>')
      .replace(/<p><div/g, '<div')
      .replace(/<\/div><\/p>/g, '</div>')
      .replace(/<p><li/g, '<li')
      .replace(/<\/li><\/p>/g, '</li>');

    aiPlanMarkdown.innerHTML = html;
  }

  // Helper: Escape HTML strings safely
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // --- Dashboard Widget Customization & Reordering Logic ---
  let currentLayoutOrder = ["gauges", "roadmap", "modules", "coach", "pulses", "teams"];

  function sortDOMWidgets(layoutOrder) {
    if (!layoutOrder || !Array.isArray(layoutOrder)) {
      layoutOrder = ["gauges", "roadmap", "modules", "coach", "pulses", "teams"];
    }

    // Sort the tab panels INSIDE .dashboard-panels-container. Every panel —
    // including the Integration KPIs (gauges) panel — must stay a child of this
    // container so it behaves like a normal tab. (Previously the gauges panel
    // was hoisted out of the container and re-parented next to .dashboard-grid,
    // which detached the "Integration KPIs" tab: it rendered full-width above the
    // grid instead of switching in the tab area. Keep it in the tab flow.)
    const container = document.querySelector('.dashboard-panels-container');
    if (!container) return;

    // Guard: if a previous build hoisted the gauges panel out of the container,
    // pull it back in as the first tab.
    const gaugesPanel = document.getElementById('tab-integration-gauges');
    if (gaugesPanel && gaugesPanel.parentElement !== container) {
      container.insertBefore(gaugesPanel, container.firstChild);
    }

    // Order: gauges first, then the rest by saved layout order (unlisted panels
    // keep their authored order at the end), academy tracking always last.
    const rank = id => {
      const i = layoutOrder.indexOf(id);
      return i === -1 ? 900 : i;
    };
    const widgets = Array.from(container.querySelectorAll(':scope > [data-widget]'))
      .filter(w => w.getAttribute('data-widget') !== 'gauges' && w.id !== 'tab-academy-tracking');
    widgets.sort((a, b) => rank(a.getAttribute('data-widget')) - rank(b.getAttribute('data-widget')));
    widgets.forEach(w => container.appendChild(w));

    const academyTracking = container.querySelector('#tab-academy-tracking');
    if (academyTracking) container.appendChild(academyTracking);
    if (gaugesPanel) container.insertBefore(gaugesPanel, container.firstChild);
  }

  function saveLayoutOrder(layoutOrder, highlightedWidgetId) {
    fetch('/api/dashboard/reorder-widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ layoutOrder })
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        sortDOMWidgets(layoutOrder);
        if (highlightedWidgetId) {
          highlightWidget(highlightedWidgetId);
        }
      }
    })
    .catch(err => console.error("Error saving layout order:", err));
  }

  function highlightWidget(widgetId) {
    const widget = document.querySelector(`[data-widget="${widgetId}"]`);
    if (widget) {
      widget.style.transition = 'box-shadow 0.4s ease, transform 0.4s ease';
      widget.style.boxShadow = '0 0 25px rgba(233, 131, 0, 0.6)';
      widget.style.transform = 'scale(1.02)';
      widget.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => {
        widget.style.boxShadow = '';
        widget.style.transform = '';
      }, 1500);
    }
  }

  // Load layout order from settings on load
  fetch('/api/settings')
    .then(res => res.json())
    .then(settings => {
      if (settings.dashboardLayoutOrder && Array.isArray(settings.dashboardLayoutOrder)) {
        currentLayoutOrder = settings.dashboardLayoutOrder;
      }
      sortDOMWidgets(currentLayoutOrder);
    })
    .catch(err => console.error("Error loading layout order:", err));

  // Delegate click event for reorder buttons inside dashboard-main-view
  if (mainView) {
    mainView.addEventListener('click', (e) => {
      const btn = e.target.closest('.reorder-btn');
      if (!btn) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const widgetEl = btn.closest('[data-widget]');
      if (!widgetEl) return;
      
      const widgetId = widgetEl.getAttribute('data-widget');
      const isUp = btn.classList.contains('btn-up');
      
      const currentIndex = currentLayoutOrder.indexOf(widgetId);
      if (currentIndex === -1) return;
      
      let newIndex = currentIndex;
      if (isUp && currentIndex > 0) {
        newIndex = currentIndex - 1;
      } else if (!isUp && currentIndex < currentLayoutOrder.length - 1) {
        newIndex = currentIndex + 1;
      }
      
      if (newIndex !== currentIndex) {
        // Swap elements in currentLayoutOrder array
        const temp = currentLayoutOrder[currentIndex];
        currentLayoutOrder[currentIndex] = currentLayoutOrder[newIndex];
        currentLayoutOrder[newIndex] = temp;
        
        // Save to backend and apply
        saveLayoutOrder(currentLayoutOrder, widgetId);
      }
    });
  }

  // ==========================================
  // CHANGE MANAGEMENT CURVE & SUGGESTIONS
  // ==========================================
  function loadChangeCurve() {
    const activeDot = document.getElementById('change-curve-active-dot');
    const labelDenial = document.getElementById('stage-label-denial');
    const labelResistance = document.getElementById('stage-label-resistance');
    const labelExploration = document.getElementById('stage-label-exploration');
    const labelCommitment = document.getElementById('stage-label-commitment');
    
    const diagnosticsDay = document.getElementById('curve-diagnostics-day');
    const diagnosticsState = document.getElementById('curve-diagnostics-state');
    const diagnosticsSentiment = document.getElementById('curve-diagnostics-sentiment');
    const diagnosticsSentimentBadge = document.getElementById('curve-diagnostics-sentiment-badge');
    const recommendationText = document.getElementById('curve-recommendation-text');
    
    if (!activeDot) return;
    
    Promise.all([
      fetch('/api/settings').then(res => res.json()),
      fetch('/api/pulses').then(res => res.json())
    ])
    .then(([settings, pulses]) => {
      const day = settings.timeTravelDay || 8;
      
      let avgSentiment = 3.8;
      if (pulses && pulses.length > 0) {
        const sum = pulses.reduce((s, p) => s + p.rating, 0);
        avgSentiment = sum / pulses.length;
      }
      
      diagnosticsDay.textContent = `Day ${day}`;
      diagnosticsSentiment.textContent = `${avgSentiment.toFixed(1)} / 5.0`;
      
      diagnosticsSentimentBadge.className = 'hero-badge';
      if (avgSentiment < 3.0) {
        diagnosticsSentimentBadge.textContent = 'Critical Risk';
        diagnosticsSentimentBadge.style.backgroundColor = '#DC2626';
        diagnosticsSentimentBadge.style.color = '#FFFFFF';
      } else if (avgSentiment < 4.2) {
        diagnosticsSentimentBadge.textContent = 'Moderate Risk';
        diagnosticsSentimentBadge.style.backgroundColor = 'var(--te-orange)';
        diagnosticsSentimentBadge.style.color = '#FFFFFF';
      } else {
        diagnosticsSentimentBadge.textContent = 'Strong Alignment';
        diagnosticsSentimentBadge.style.backgroundColor = 'var(--status-success)';
        diagnosticsSentimentBadge.style.color = '#FFFFFF';
      }
      
      let x = 75, y = 60;
      let phase = 'Denial';
      let recommendations = '';
      
      if (day <= 14) {
        const f = (day - 1) / 13 || 0;
        x = 75 + f * 150;
        y = 60 + f * 100;
        phase = day <= 7 ? 'Denial' : 'Resistance';
      } else if (day <= 45) {
        const f = (day - 14) / 31 || 0;
        x = 225 + f * 150;
        y = 160 - f * 50;
        phase = day <= 30 ? 'Resistance' : 'Exploration';
      } else {
        const f = Math.min(1.0, (day - 45) / 45) || 0;
        x = 375 + f * 150;
        y = 110 - f * 60;
        phase = day <= 60 ? 'Exploration' : 'Commitment';
      }
      
      const leftPct = (x / 600) * 100;
      const topPct = (y / 220) * 100;
      
      activeDot.style.left = `${leftPct}%`;
      activeDot.style.top = `${topPct}%`;
      
      diagnosticsState.textContent = `${phase} Phase`;
      
      labelDenial.classList.remove('active');
      labelResistance.classList.remove('active');
      labelExploration.classList.remove('active');
      labelCommitment.classList.remove('active');
      
      if (phase === 'Denial') {
        labelDenial.classList.add('active');
        recommendations = `
          <strong>IMO Priority: Build Trust & Communication Cadences</strong><br><br>
          We are currently in the <strong>Denial Phase</strong> (Timeline Days 1 to 7). Employees are experiencing shock, uncertainty, and corporate fatigue.
          <br><br>
          <strong>Actionable Advice:</strong>
          <ul>
            <li>Focus heavily on holding cross-functional Integration Synergy town halls led by acquired team managers.</li>
            <li>Distribute clear, simple FAQ leaflets explaining HR benefits mappings and title harmonizations.</li>
            <li>Maintain high communication visibility. Avoid silent periods; transparently declare that IT and HR systems are under audit.</li>
          </ul>
        `;
      } else if (phase === 'Resistance') {
        labelResistance.classList.add('active');
        recommendations = `
          <strong>IMO Priority: Mitigate Resistance & Address Anxiety</strong><br><br>
          We are in the critical <strong>Resistance Phase</strong> (Timeline Days 8 to 30). Acquired personnel are expressing concerns regarding cultural friction and compensation changes.
          <br><br>
          <strong>Actionable Advice:</strong>
          <ul>
            <li>Active leadership coaching is highly essential. Schedule site town halls immediately to allow employee concerns to be aired.</li>
            <li>Coordinate compensation alignment reviews. Ensure employees have direct channels to local Integration Leader contacts.</li>
            <li>Engage direct report leads to help identify key talent flight risks. Deploy compensation retention packages where appropriate.</li>
          </ul>
        `;
      } else if (phase === 'Exploration') {
        labelExploration.classList.add('active');
        recommendations = `
          <strong>IMO Priority: Channel Exploration & Encourage Training</strong><br><br>
          Employees have moved into the <strong>Exploration Phase</strong> (Timeline Days 31 to 60). Staff are actively exploring options and adapting to the TE Connectivity ecosystem.
          <br><br>
          <strong>Actionable Advice:</strong>
          <ul>
            <li>Focus efforts on driving training completions in the Integration Academy. Use positive reinforcement (Milestone badges, merit points).</li>
            <li>Provide advanced system training sessions. Enable collaborative cross-team brainstorming workshops.</li>
            <li>Acknowledge and highlight early synergy wins, sales coordination successes, and technical patent integration milestones.</li>
          </ul>
        `;
      } else {
        labelCommitment.classList.add('active');
        recommendations = `
          <strong>IMO Priority: Lock-in Commitment & Finalize Conversions</strong><br><br>
          We have entered the <strong>Commitment Phase</strong> (Timeline Days 61+). Acquired employees are fully integrated, certified, and aligned with TE's values.
          <br><br>
          <strong>Actionable Advice:</strong>
          <ul>
            <li>Celebrate overall integration completion! Issue master certification badges to all qualifying team members.</li>
            <li>Conduct a post-integration audit survey to extract key lessons learned for future merger playbooks.</li>
            <li>Continue supporting long-term career growth, supply-chain synergy projects, and advanced technological innovation initiatives.</li>
          </ul>
        `;
      }
      
      recommendationText.innerHTML = recommendations;
    })
    .catch(err => console.error("Error loading Change Curve details:", err));
  }

  // ==========================================
  // WELCOME KIT CUSTOMIZER & ORDER LEDGER
  // ==========================================
  function renderWelcomeKitOrders() {
    const tbody = document.getElementById('customizer-orders-tbody');
    if (!tbody) return;
    
    let orders = [];
    try {
      orders = JSON.parse(localStorage.getItem('welcome_kit_orders')) || [];
    } catch (e) {
      orders = [];
    }
    
    if (orders.length === 0) {
      orders = [
        {
          id: 'ord_1',
          item: 'TE Organic Crewneck T-Shirt',
          name: 'EMMA WATSON',
          dept: 'FINANCE OPERATIONS',
          spec: 'TE Heritage Orange, Size M',
          date: 'May 20, 2026',
          status: '🚚 Shipped'
        },
        {
          id: 'ord_2',
          item: 'TE Anti-Theft Tech Backpack',
          name: 'SARAH JENKINS',
          dept: 'CYBERSECURITY & INFRA',
          spec: 'TE Corporate Deep Teal',
          date: 'May 18, 2026',
          status: '🚚 Shipped'
        }
      ];
      localStorage.setItem('welcome_kit_orders', JSON.stringify(orders));
    }
    
    tbody.innerHTML = '';
    orders.forEach(o => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      tr.innerHTML = `
        <td style="padding: 0.75rem; color: var(--te-dark-teal); font-weight: 700;">${escapeHtml(o.item)}</td>
        <td style="padding: 0.75rem; font-weight: 600;">${escapeHtml(o.name)}</td>
        <td style="padding: 0.75rem; color: var(--text-secondary);">${escapeHtml(o.dept)}</td>
        <td style="padding: 0.75rem; font-style: italic;">${escapeHtml(o.spec)}</td>
        <td style="padding: 0.75rem; color: var(--text-dim);">${escapeHtml(o.date)}</td>
        <td style="padding: 0.75rem;">
          <span class="hero-badge" style="background-color: ${o.status.includes('Shipped') ? 'var(--te-dark-teal-light)' : 'var(--te-orange-light)'}; color: ${o.status.includes('Shipped') ? 'var(--te-dark-teal)' : 'var(--te-orange)'}; font-weight: 800; font-size: 0.7rem; margin:0; border: none;">
            ${escapeHtml(o.status)}
          </span>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  function initWelcomeKitCustomizer() {
    const productSelect = document.getElementById('customizer-product-select');
    const colorSelect = document.getElementById('customizer-color-select');
    const sizeSelect = document.getElementById('customizer-size-select');
    const nameInput = document.getElementById('customizer-name-input');
    const deptInput = document.getElementById('customizer-dept-input');
    const orderBtn = document.getElementById('customizer-order-btn');
    
    if (!productSelect || !orderBtn) return;

    const layoutConfigs = {
      tshirt: {
        src: '/images/te_tshirt.png',
        overlay: {
          top: '47%',
          left: '50%',
          width: '70%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center'
        },
        name: {
          fontSize: '0.9rem',
          color: '#FFFFFF',
          letterSpacing: '1px',
          fontWeight: '800'
        },
        dept: {
          fontSize: '0.6rem',
          color: '#E98300',
          letterSpacing: '0.5px',
          fontWeight: '600',
          marginTop: '2px'
        }
      },
      mug: {
        src: '/images/te_tumbler.png',
        overlay: {
          top: '55%',
          left: '50%',
          width: '60%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center'
        },
        name: {
          fontSize: '0.75rem',
          color: '#FFFFFF',
          letterSpacing: '1px',
          fontWeight: '800'
        },
        dept: {
          fontSize: '0.5rem',
          color: '#244C5A',
          letterSpacing: '0.5px',
          fontWeight: '600',
          marginTop: '1px'
        }
      },
      backpack: {
        src: '/images/te_backpack.png',
        overlay: {
          top: '73%',
          left: '50%',
          width: '60%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center'
        },
        name: {
          fontSize: '0.75rem',
          color: '#FFFFFF',
          letterSpacing: '1px',
          fontWeight: '800'
        },
        dept: {
          fontSize: '0.5rem',
          color: '#E98300',
          letterSpacing: '0.5px',
          fontWeight: '600',
          marginTop: '1px'
        }
      },
      stickers: {
        src: '/images/te_stickers.png',
        overlay: {
          top: '60%',
          left: '50%',
          width: '60%',
          transform: 'translate(-50%, -50%) rotate(-4deg)',
          textAlign: 'center'
        },
        name: {
          fontSize: '0.8rem',
          color: '#244C5A',
          letterSpacing: '1px',
          fontWeight: '800'
        },
        dept: {
          fontSize: '0.55rem',
          color: '#E98300',
          letterSpacing: '0.5px',
          fontWeight: '600',
          marginTop: '1px'
        }
      },
      notebook: {
        src: '/images/te_notebook.png',
        overlay: {
          top: '58%',
          left: '54%',
          width: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center'
        },
        name: {
          fontSize: '0.8rem',
          color: '#E98300',
          letterSpacing: '1px',
          fontWeight: '800'
        },
        dept: {
          fontSize: '0.55rem',
          color: '#FFFFFF',
          letterSpacing: '0.5px',
          fontWeight: '600',
          marginTop: '1px'
        }
      }
    };
    
    function updateTextOverlay() {
      const name = nameInput.value.toUpperCase();
      const dept = deptInput.value.toUpperCase();
      
      const overlayName = document.querySelector('#customizer-text-overlay .overlay-print-name');
      const overlayDept = document.querySelector('#customizer-text-overlay .overlay-print-dept');
      
      if (overlayName) overlayName.textContent = name || 'ALEX SMITH';
      if (overlayDept) overlayDept.textContent = dept || 'R&D SENSORS';
    }
    
    function applyProductLayout() {
      const product = productSelect.value;
      const config = layoutConfigs[product];
      if (!config) return;
      
      const previewImg = document.getElementById('customizer-preview-img');
      const overlay = document.getElementById('customizer-text-overlay');
      const overlayName = document.querySelector('#customizer-text-overlay .overlay-print-name');
      const overlayDept = document.querySelector('#customizer-text-overlay .overlay-print-dept');
      
      if (previewImg) previewImg.src = config.src;
      
      if (overlay) {
        Object.assign(overlay.style, {
          top: config.overlay.top,
          left: config.overlay.left,
          width: config.overlay.width,
          transform: config.overlay.transform,
          textAlign: config.overlay.textAlign
        });
      }
      
      if (overlayName) {
        Object.assign(overlayName.style, {
          fontSize: config.name.fontSize,
          color: config.name.color,
          letterSpacing: config.name.letterSpacing,
          fontWeight: config.name.fontWeight
        });
      }
      
      if (overlayDept) {
        Object.assign(overlayDept.style, {
          fontSize: config.dept.fontSize,
          color: config.dept.color,
          letterSpacing: config.dept.letterSpacing,
          fontWeight: config.dept.fontWeight,
          marginTop: config.dept.marginTop || '0px'
        });
      }
    }
    
    function updateColors() {
      // Color choices are recorded in the shipment ledger.
      // High-fidelity preview mockups represent premium default brand editions.
    }
    
    productSelect.addEventListener('change', applyProductLayout);
    
    nameInput.addEventListener('input', updateTextOverlay);
    deptInput.addEventListener('input', updateTextOverlay);
    colorSelect.addEventListener('change', updateColors);
    
    orderBtn.addEventListener('click', () => {
      const name = nameInput.value.trim().toUpperCase();
      const dept = deptInput.value.trim().toUpperCase();
      const item = productSelect.options[productSelect.selectedIndex].text;
      const colorName = colorSelect.options[colorSelect.selectedIndex].text;
      const size = sizeSelect.value;
      
      if (!name) {
        showToast('Please specify a personalization name!', 'error');
        return;
      }
      
      triggerConfettiBurst();
      
      const newOrder = {
        id: 'ord_' + Date.now(),
        item: item,
        name: name,
        dept: dept || 'GENERAL STAFF',
        spec: `${colorName}, Size ${size}`,
        date: new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
        status: '🔄 Pending Shipping'
      };
      
      let orders = [];
      try {
        orders = JSON.parse(localStorage.getItem('welcome_kit_orders')) || [];
      } catch (e) {
        orders = [];
      }
      
      orders.unshift(newOrder);
      localStorage.setItem('welcome_kit_orders', JSON.stringify(orders));
      
      renderWelcomeKitOrders();
      showToast(`Welcome Kit Ordered for ${name}!`, 'success');
    });
    
    applyProductLayout();
    updateTextOverlay();
    renderWelcomeKitOrders();
  }

  function triggerConfettiBurst() {
    const duration = 2000;
    const end = Date.now() + duration;
    const colors = ['#E98300', '#244C5A', '#0D9488', '#FBBF24', '#38BDF8'];
    
    const interval = setInterval(() => {
      if (Date.now() > end) {
        clearInterval(interval);
        return;
      }
      
      for (let i = 0; i < 6; i++) {
        const p = document.createElement('div');
        p.style.position = 'fixed';
        p.style.zIndex = '99999';
        p.style.width = Math.random() * 10 + 6 + 'px';
        p.style.height = Math.random() * 10 + 6 + 'px';
        p.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
        p.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        
        let posX = window.innerWidth / 2;
        let posY = window.innerHeight * 0.9;
        
        p.style.left = posX + 'px';
        p.style.top = posY + 'px';
        
        const angle = Math.random() * Math.PI + Math.PI;
        const speed = Math.random() * 15 + 8;
        let vx = Math.cos(angle) * speed;
        let vy = Math.sin(angle) * speed;
        
        document.body.appendChild(p);
        
        let rotation = Math.random() * 360;
        let rotSpeed = Math.random() * 15 - 7.5;
        let gravity = 0.5;
        
        const move = () => {
          vx *= 0.98;
          vy += gravity;
          posX += vx;
          posY += vy;
          rotation += rotSpeed;
          
          p.style.left = posX + 'px';
          p.style.top = posY + 'px';
          p.style.transform = `rotate(${rotation}deg)`;
          
          if (posY > window.innerHeight + 20) {
            p.remove();
          } else {
            requestAnimationFrame(move);
          }
        };
        requestAnimationFrame(move);
      }
    }, 150);
  }



  // ==========================================
  // EMPLOYEE PROVISIONING & MASS UPLOAD HUB
  // ==========================================
  
  const manualEmpForm = document.getElementById('hrbp-manual-employee-form');
  const manEmpNameInput = document.getElementById('man-emp-name');
  const manEmpRoleInput = document.getElementById('man-emp-role');
  const manEmpDeptSelect = document.getElementById('man-emp-dept');
  const manEmpBuddyInput = document.getElementById('man-emp-buddy');
  const manEmpBuddyEmailInput = document.getElementById('man-emp-buddy-email');

  const dropzone = document.getElementById('mass-upload-dropzone');
  const fileInput = document.getElementById('mass-upload-file-input');
  const previewCenter = document.getElementById('mass-upload-preview-center');
  const previewBody = document.getElementById('mass-upload-preview-body');
  const parsedCountEl = document.getElementById('parsed-records-count');
  
  const btnClear = document.getElementById('btn-mass-upload-clear');
  const btnSubmitUpload = document.getElementById('btn-mass-upload-submit');
  
  const uploadProgressContainer = document.getElementById('batch-upload-progress-container');
  const uploadProgressBar = document.getElementById('batch-upload-progress-bar');
  const uploadProgressPctText = document.getElementById('batch-upload-pct');
  const uploadProgressStatusText = document.getElementById('batch-upload-status-text');

  let parsedEmployeesList = [];

  // Manual Provisioning Submit
  if (manualEmpForm) {
    manualEmpForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const payload = {
        name: manEmpNameInput.value.trim(),
        role: manEmpRoleInput.value.trim(),
        department: manEmpDeptSelect.value,
        company: 'NextGen Sensors Ltd.',
        completedLessons: [],
        points: 0,
        badge: 'New Recruit',
        bonusPoints: 0,
        isLeader: false,
        leaderRole: 'None',
        buddyName: manEmpBuddyInput.value.trim() || 'Sarah Connor',
        buddyEmail: manEmpBuddyEmailInput.value.trim() || 'sconnor@te.com'
      };

      fetch('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          manEmpNameInput.value = '';
          manEmpRoleInput.value = '';
          showToast(`Onboarded legacy employee: ${payload.name}!`, 'success');
          loadAcademyTracking();
          triggerDashboardConfetti();
        } else {
          showToast('Failed to manual onboard employee.', 'error');
        }
      })
      .catch(err => {
        console.error("Error manual onboarding:", err);
        showToast('Server communications failure.', 'error');
      });
    });
  }

  // Drag and Drop triggers
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('csv-drag-overlay-active');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('csv-drag-overlay-active');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('csv-drag-overlay-active');
      
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        handleFileLoad(files[0]);
      }
    });

    fileInput.addEventListener('change', () => {
      if (fileInput.files && fileInput.files.length > 0) {
        handleFileLoad(fileInput.files[0]);
      }
    });
  }

  // Load and Parse File (CSV/JSON)
  function handleFileLoad(file) {
    const reader = new FileReader();
    const isCsv = file.name.endsWith('.csv');
    const isJson = file.name.endsWith('.json');

    if (!isCsv && !isJson) {
      showToast("Format unsupported. Only CSV and JSON roster sheets are accepted.", "error");
      return;
    }

    reader.onload = (e) => {
      const content = e.target.result;
      try {
        if (isCsv) {
          parseRosterCsv(content);
        } else {
          parseRosterJson(content);
        }
      } catch (err) {
        console.error("Failed to parse file:", err);
        showToast("Roster file format corrupted. Verify headers & syntax.", "error");
      }
    };

    reader.readAsText(file);
  }

  // Parse CSV
  function parseRosterCsv(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length < 2) {
      showToast("CSV sheet lacks pre-seeded rows.", "error");
      return;
    }

    // Header extraction
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/['"]/g, ''));
    
    // Find index of headers dynamically for smarter mapping
    let nameIdx = headers.findIndex(h => ['name', 'full name', 'staff', 'employee', 'employee name', 'employee_name'].includes(h));
    let roleIdx = headers.findIndex(h => ['role', 'title', 'job title', 'position', 'staff role', 'staff title', 'job_title'].includes(h));
    let deptIdx = headers.findIndex(h => ['department', 'dept', 'division', 'business unit', 'bu'].includes(h));
    let buddyNameIdx = headers.findIndex(h => ['buddyname', 'buddy name', 'buddy', 'buddy_name', 'mentor', 'onboarding buddy', 'onboarding_buddy'].includes(h));
    let buddyEmailIdx = headers.findIndex(h => ['buddyemail', 'buddy email', 'buddy_email', 'mentor email', 'mentor_email', 'buddy contact', 'buddy_contact'].includes(h));

    // Fallbacks if not found by exact array match, check substring/contains
    if (nameIdx === -1) nameIdx = headers.findIndex(h => h.includes('name') || h.includes('staff') || h.includes('employee'));
    if (roleIdx === -1) roleIdx = headers.findIndex(h => h.includes('role') || h.includes('title') || h.includes('position'));
    if (deptIdx === -1) deptIdx = headers.findIndex(h => h.includes('department') || h.includes('dept') || h.includes('division') || h.includes('unit'));
    if (buddyNameIdx === -1) buddyNameIdx = headers.findIndex(h => h.includes('buddy') && !h.includes('email') || h.includes('mentor'));
    if (buddyEmailIdx === -1) buddyEmailIdx = headers.findIndex(h => h.includes('buddy') && h.includes('email') || h.includes('buddy_email') || h.includes('mentor_email'));

    // If still not found, default to index fallbacks (0: name, 1: role, 2: department, 3: buddyName, 4: buddyEmail)
    if (nameIdx === -1) nameIdx = 0;
    if (roleIdx === -1) roleIdx = 1;
    if (deptIdx === -1) deptIdx = 2;
    if (buddyNameIdx === -1) buddyNameIdx = 3;
    if (buddyEmailIdx === -1) buddyEmailIdx = 4;

    // Rows extraction
    const list = [];
    for (let i = 1; i < lines.length; i++) {
      const columns = lines[i].split(',').map(c => c.trim().replace(/['"]/g, ''));
      if (columns.length <= Math.max(nameIdx, roleIdx, deptIdx)) continue;

      const name = columns[nameIdx] || '';
      const role = columns[roleIdx] || 'Acquired Specialist';
      const department = columns[deptIdx] || 'R&D';
      const buddyName = columns[buddyNameIdx] || 'Sarah Connor';
      const buddyEmail = columns[buddyEmailIdx] || 'sconnor@te.com';

      if (name.length > 0) {
        list.push({ name, role, department, buddyName, buddyEmail });
      }
    }

    if (list.length === 0) {
      showToast("No active employee rows parsed from CSV.", "error");
      return;
    }

    parsedEmployeesList = list;
    renderUploadPreview();
  }

  // Parse JSON
  function parseRosterJson(text) {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) {
      showToast("JSON roster sheet must be an array of records.", "error");
      return;
    }

    const list = [];
    arr.forEach(record => {
      const name = record.name || record.fullName || '';
      const role = record.role || record.title || 'Acquired Specialist';
      const department = record.department || record.dept || 'R&D';
      const buddyName = record.buddyName || record.buddy || 'Sarah Connor';
      const buddyEmail = record.buddyEmail || 'sconnor@te.com';

      if (name.length > 0) {
        list.push({ name, role, department, buddyName, buddyEmail });
      }
    });

    if (list.length === 0) {
      showToast("No active employee records parsed from JSON.", "error");
      return;
    }

    parsedEmployeesList = list;
    renderUploadPreview();
  }

  // Render Roster Preview Table
  function renderUploadPreview() {
    if (!previewBody || !previewCenter || !parsedCountEl) return;

    previewBody.innerHTML = '';
    parsedCountEl.textContent = parsedEmployeesList.length;

    parsedEmployeesList.forEach(e => {
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid var(--border-color)';
      
      tr.innerHTML = `
        <td style="padding: 0.5rem 0.6rem; font-weight:700; color:var(--te-dark-teal);">${escapeHtml(e.name)}</td>
        <td style="padding: 0.5rem 0.6rem;">${escapeHtml(e.role)}</td>
        <td style="padding: 0.5rem 0.6rem;"><span class="admin-dimension-tag" style="background:#E2E8F0; color:var(--te-dark-teal); font-size:0.65rem; padding:0.1rem 0.3rem;">${escapeHtml(e.department)}</span></td>
        <td style="padding: 0.5rem 0.6rem; font-size:0.75rem;">${escapeHtml(e.buddyName)}</td>
      `;
      previewBody.appendChild(tr);
    });

    previewCenter.style.display = 'block';
    uploadProgressContainer.style.display = 'none';
    btnSubmitUpload.disabled = false;
    btnClear.disabled = false;
  }

  // Reset Uploader
  if (btnClear) {
    btnClear.addEventListener('click', () => {
      parsedEmployeesList = [];
      previewCenter.style.display = 'none';
      if (fileInput) fileInput.value = '';
    });
  }

  // Submit Mass Upload Roster
  if (btnSubmitUpload) {
    btnSubmitUpload.addEventListener('click', async () => {
      if (parsedEmployeesList.length === 0) return;

      btnSubmitUpload.disabled = true;
      btnClear.disabled = true;
      
      uploadProgressContainer.style.display = 'block';
      uploadProgressBar.style.width = '0%';
      uploadProgressPctText.textContent = '0%';
      uploadProgressStatusText.textContent = 'Batch provisioning legacy roster...';

      let uploadedCount = 0;
      const total = parsedEmployeesList.length;

      for (let i = 0; i < total; i++) {
        const e = parsedEmployeesList[i];
        
        uploadProgressStatusText.textContent = `Registering ${escapeHtml(e.name)} (${i + 1}/${total})...`;
        
        const payload = {
          name: e.name,
          role: e.role,
          department: e.department,
          company: 'NextGen Sensors Ltd.',
          completedLessons: [],
          points: 0,
          badge: 'New Recruit',
          bonusPoints: 0,
          isLeader: false,
          leaderRole: 'None',
          buddyName: e.buddyName,
          buddyEmail: e.buddyEmail
        };

        try {
          const res = await fetch('/api/employees', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const data = await res.json();
          if (data.success) {
            uploadedCount++;
          }
        } catch (err) {
          console.error("Batch element post failed:", err);
        }

        // Add minor dynamic artificial delay to simulate live bulk compiling engine
        await new Promise(r => setTimeout(r, 150));

        const pct = Math.round(((i + 1) / total) * 100);
        uploadProgressBar.style.width = `${pct}%`;
        uploadProgressPctText.textContent = `${pct}%`;
      }

      uploadProgressStatusText.textContent = `Completed! ${uploadedCount} of ${total} employees onboarded successfully.`;
      showToast(`Successfully batch integrated ${uploadedCount} acquired recruits!`, 'success');
      
      // Cleanup preview
      setTimeout(() => {
        parsedEmployeesList = [];
        previewCenter.style.display = 'none';
        if (fileInput) fileInput.value = '';
        
        loadAcademyTracking();
        triggerDashboardConfetti();
      }, 1500);
    });
  }

  // Victory Confetti burst
  function triggerDashboardConfetti() {
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
    
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.scale(dpr, dpr);

    const colors = ['#E98300', '#244C5A', '#FBBF24', '#10B981', '#3B82F6', '#EF4444'];
    const particles = [];

    for (let i = 0; i < 150; i++) {
      particles.push({
        x: window.innerWidth / 2,
        y: window.innerHeight - 50,
        vx: (Math.random() - 0.5) * 18,
        vy: -Math.random() * 22 - 7,
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

  // --- Integration Leader Communications Desk Section ---
  const hrbpRecipientType = document.getElementById('hrbp-comm-recipient-type');
  const hrbpRecipientSpecificContainer = document.getElementById('hrbp-comm-recipient-specific-container');
  const hrbpRecipientSelect = document.getElementById('hrbp-comm-recipient-select');
  const hrbpBroadcastForm = document.getElementById('hrbp-broadcast-form');
  const hrbpCommLedgerContainer = document.getElementById('hrbp-comm-ledger-container');
  const hrbpCommLedgerCount = document.getElementById('hrbp-comm-ledger-count');

  if (hrbpRecipientType) {
    hrbpRecipientType.addEventListener('change', () => {
      if (hrbpRecipientType.value === 'individual') {
        hrbpRecipientSpecificContainer.style.display = 'flex';
        loadHrbpRecipientOptions();
      } else {
        hrbpRecipientSpecificContainer.style.display = 'none';
      }
    });
  }

  function loadHrbpRecipientOptions() {
    if (!hrbpRecipientSelect) return;
    hrbpRecipientSelect.innerHTML = '<option value="">Loading employees...</option>';
    
    fetch('/api/employees')
      .then(res => res.json())
      .then(employees => {
        hrbpRecipientSelect.innerHTML = '';
        if (!employees || employees.length === 0) {
          hrbpRecipientSelect.innerHTML = '<option value="">No registered legacy employees</option>';
          return;
        }

        employees.forEach(e => {
          const opt = document.createElement('option');
          opt.value = e.email || `${e.name.toLowerCase().replace(/\s+/g, '')}@te-legacy.com`;
          opt.textContent = `${e.name} (${e.role || 'Employee'} - ${e.department || 'R&D'})`;
          opt.dataset.name = e.name;
          opt.dataset.role = e.role || 'Legacy Employee';
          hrbpRecipientSelect.appendChild(opt);
        });
      })
      .catch(err => {
        console.error("Error loading hrbp recipient options:", err);
        hrbpRecipientSelect.innerHTML = '<option value="">Error loading list</option>';
      });
  }

  if (hrbpBroadcastForm) {
    hrbpBroadcastForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const sender = document.getElementById('hrbp-comm-sender').value;
      const senderRole = document.getElementById('hrbp-comm-sender-role').value;
      const recipientType = hrbpRecipientType.value;
      const template = document.getElementById('hrbp-comm-template').value;
      const subject = document.getElementById('hrbp-comm-subject').value;
      const body = document.getElementById('hrbp-comm-body').value;

      let recipientEmail = 'all@te.com';
      let recipientName = 'All Legacy Employees';
      let recipientId = 'all';

      if (recipientType === 'individual') {
        const selectedOpt = hrbpRecipientSelect.options[hrbpRecipientSelect.selectedIndex];
        if (!selectedOpt || !selectedOpt.value) {
          showHrbpNotification('Please select a target employee first.', true);
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
          showHrbpNotification('Divisional workforce alert sent successfully.');
          hrbpBroadcastForm.reset();
          if (hrbpRecipientType) {
            hrbpRecipientType.value = 'all';
            hrbpRecipientSpecificContainer.style.display = 'none';
          }
          loadHrbpCommunications();
        } else {
          showHrbpNotification(data.error || 'Failed to dispatch broadcast alert.', true);
        }
      })
      .catch(err => {
        console.error("Error dispatching Integration Leader communication:", err);
        showHrbpNotification('Server connection error.', true);
      });
    });
  }

  function loadHrbpCommunications() {
    if (!hrbpCommLedgerContainer) return;

    fetch('/api/communications')
      .then(res => res.json())
      .then(comms => {
        hrbpCommLedgerContainer.innerHTML = '';
        
        // Filter: communications sent by Integration Leader
        const hrbpComms = comms.filter(c => c.sender.includes('Integration Leader') || c.senderRole.includes('Integration Leader') || c.sender === 'Integration Leadership Team' || c.recipientType === 'hrbp');
        
        if (hrbpCommLedgerCount) hrbpCommLedgerCount.textContent = `${hrbpComms.length} Sent`;

        if (!hrbpComms || hrbpComms.length === 0) {
          hrbpCommLedgerContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); font-size: 0.85rem; padding: 2rem; font-style: italic;">No alerts broadcasted from this Integration Leader seat.</p>';
          return;
        }

        // Sort descending by timestamp
        hrbpComms.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        hrbpComms.forEach(c => {
          const item = document.createElement('div');
          item.style.cssText = 'background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; display: flex; flex-direction: column; gap: 0.5rem; border-left: 4px solid ' + getHrbpTemplateColor(c.template);
          
          const dateStr = new Date(c.timestamp).toLocaleString();

          item.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem;">
              <div>
                <span class="badge" style="background: ${getHrbpTemplateColor(c.template)}; color: white; padding: 0.1rem 0.4rem; border-radius: 4px; font-size: 0.7rem; font-weight: bold;">${getHrbpTemplateLabel(c.template)}</span>
                <h4 style="margin: 0.25rem 0; font-size: 0.95rem; color: var(--text-main); font-family: var(--font-family-display); font-weight: 700;">${escapeHtml(c.subject)}</h4>
                <div style="font-size: 0.75rem; color: var(--text-dim); margin-top: 0.15rem;">
                  <span><strong>To:</strong> ${escapeHtml(c.recipientName)}</span> &bull; 
                  <span>${dateStr}</span>
                </div>
              </div>
              <a href="${c.htmlEmailPath}" target="_blank" class="btn btn-secondary" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; display: flex; align-items: center; gap: 0.25rem; text-decoration: none; border-radius: 4px; border: 1.5px solid rgba(233,131,0,0.2); background: transparent; color: var(--te-orange); font-weight: bold; cursor: pointer;">
                <span>🔍</span> HTML
              </a>
            </div>
            <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
              ${escapeHtml(c.body)}
            </p>
          `;

          hrbpCommLedgerContainer.appendChild(item);
        });
      })
      .catch(err => console.error("Error loading Integration Leader communications:", err));
  }

  function getHrbpTemplateColor(tmpl) {
    switch (tmpl) {
      case 'security': return '#B91C1C';
      case 'synergy': return '#E98300';
      case 'welcome': return '#244C5A';
      default: return '#4b5563';
    }
  }

  function getHrbpTemplateLabel(tmpl) {
    switch (tmpl) {
      case 'security': return 'Compliance';
      case 'synergy': return 'Synergy';
      case 'welcome': return 'Welcome';
      default: return 'System';
    }
  }

  function showHrbpNotification(msg, isError = false) {
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

  // Initial runs
  loadAlerts();
  loadOnboardingSuccess();
  loadAcademyTracking();
  initTeodorLocalAI();
  loadChangeCurve();
  initWelcomeKitCustomizer();
  loadHrbpCommunications();
});

