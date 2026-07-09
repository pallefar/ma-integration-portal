/**
 * TE Connectivity M&A Integration Portal - admin.js
 * Controls system settings, survey blueprint builders, dynamic action modules,
 * employee onboarding links compiler, and Integration Leader & Alerts publishing desks.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- 1. Tab Navigation Switches (SaaS rail) ---
  const tabs = document.querySelectorAll('.admin-tab-btn');
  const tabPanels = document.querySelectorAll('.tab-content');

  // Section metadata drives the topbar heading
  const SECTION_META = {
    courses: ['Courses', 'Manage the academy curriculum — courses, modules, lessons & quizzes'],
    modules: ['Action Modules', 'Score-gated recommendations shown on the Integration Leader dashboard'],
    pages: ['Pages & Playbook', 'CMS-owned page content and the integration playbook'],
    employees: ['Employees', 'Acquired-employee roster and personalized welcome portals'],
    hrbp: ['Integration Leaders & Alerts', 'Provisioned Integration Leaders and workforce announcements'],
    communication: ['Communications', 'Broadcast email dispatcher and sent ledger'],
    banners: ['Notification Banners', 'Per-page and global alerts that users can dismiss'],
    translations: ['Translations', 'Languages and the app-wide string dictionary'],
    menus: ['Menus & Navigation', 'Sidebar, groups, and landing-page cards'],
    media: ['Media Library', 'Uploaded images and per-language welcome video'],
    system: ['Settings & Survey', 'Company profile, feature flags, survey blueprint and system tools']
  };
  const setSection = (key) => {
    const meta = SECTION_META[key];
    const titleEl = document.getElementById('admin-section-title');
    const subEl = document.getElementById('admin-section-sub');
    if (meta && titleEl) titleEl.textContent = meta[0];
    if (meta && subEl) subEl.textContent = meta[1];
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabPanels.forEach(p => {
        p.style.display = 'none';
        p.classList.remove('active');
      });

      tab.classList.add('active');
      const key = tab.getAttribute('data-tab');
      const activePanel = document.getElementById(`tab-${key}`);
      setSection(key);

      if (activePanel) {
        activePanel.style.display = 'block';
        setTimeout(() => {
          activePanel.classList.add('active');
        }, 10);
      }
    });
  });

  // --- 2. System Settings & Survey Blueprint ---
  const settingsForm = document.getElementById('settings-form');
  const targetCompanyInput = document.getElementById('setting-target-company');
  const sectorInput = document.getElementById('setting-sector');
  const sizeInput = document.getElementById('setting-size');
  const hqInput = document.getElementById('setting-hq');
  const acqDateInput = document.getElementById('setting-acq-date');
  const synergyObjectiveInput = document.getElementById('setting-synergy-objective');
  const geminiKeyInput = document.getElementById('setting-gemini-key');
  const btnToggleKey = document.getElementById('btn-toggle-key-visibility');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const browserModelInput = document.getElementById('setting-browser-model');
  const videoTypeEnInput = document.getElementById('setting-video-type-en');
  const videoUrlEnInput = document.getElementById('setting-video-url-en');
  const videoTypeDeInput = document.getElementById('setting-video-type-de');
  const videoUrlDeInput = document.getElementById('setting-video-url-de');
  const videoTypeZhInput = document.getElementById('setting-video-type-zh');
  const videoUrlZhInput = document.getElementById('setting-video-url-zh');
  const videoTypeCsInput = document.getElementById('setting-video-type-cs');
  const videoUrlCsInput = document.getElementById('setting-video-url-cs');

  const addQuestionForm = document.getElementById('add-question-form');
  const newQText = document.getElementById('new-q-text');
  const newQDim = document.getElementById('new-q-dim');
  const newQWeight = document.getElementById('new-q-weight');
  const questionsListContainer = document.getElementById('questions-index-list');
  const assessmentsHistoryList = document.getElementById('assessments-history-list');

  // Load Settings
  function loadSettings() {
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        if (settings.targetCompany) targetCompanyInput.value = settings.targetCompany;
        if (settings.sector) sectorInput.value = settings.sector;
        if (settings.size) sizeInput.value = settings.size;
        if (settings.hq) hqInput.value = settings.hq;
        if (settings.acquisitionDate) acqDateInput.value = settings.acquisitionDate;
        if (settings.synergyObjective) synergyObjectiveInput.value = settings.synergyObjective;
        if (settings.geminiApiKey) geminiKeyInput.value = settings.geminiApiKey;
        if (settings.browserModel) browserModelInput.value = settings.browserModel;
        
        if (videoTypeEnInput) videoTypeEnInput.value = settings.welcomeVideoType_en || settings.welcomeVideoType || 'local';
        if (videoUrlEnInput) videoUrlEnInput.value = settings.welcomeVideoUrl_en || settings.welcomeVideoUrl || '';
        if (videoTypeDeInput) videoTypeDeInput.value = settings.welcomeVideoType_de || 'local';
        if (videoUrlDeInput) videoUrlDeInput.value = settings.welcomeVideoUrl_de || '';
        if (videoTypeZhInput) videoTypeZhInput.value = settings.welcomeVideoType_zh || 'local';
        if (videoUrlZhInput) videoUrlZhInput.value = settings.welcomeVideoUrl_zh || '';
        if (videoTypeCsInput) videoTypeCsInput.value = settings.welcomeVideoType_cs || 'local';
        if (videoUrlCsInput) videoUrlCsInput.value = settings.welcomeVideoUrl_cs || '';


        // Virtualization switcher UI synchronization
        const isDemo = settings.demoMode !== false;
        const switcherContainer = document.getElementById('demo-mode-switcher-container');
        const switcherIndicator = document.getElementById('demo-switcher-indicator');
        const switcherText = document.getElementById('demo-switcher-text');

        if (switcherContainer && switcherIndicator && switcherText) {
          switcherIndicator.style.background = isDemo ? '#10B981' : '#3B82F6';
          switcherText.textContent = isDemo ? 'DEMO ACTIVE' : 'CUSTOM M&A';
          switcherText.style.color = isDemo ? '#10B981' : '#3B82F6';
          switcherContainer.title = isDemo ? 'Click to enter custom M&A setup' : 'Running on custom integration databases';
        }

        const customMaCard = document.getElementById('admin-custom-ma-card');
        if (customMaCard) {
          customMaCard.style.display = isDemo ? 'none' : 'block';
        }

        // Database migration badge UI synchronization
        const dbStatusBadge = document.getElementById('db-migration-status-badge');
        if (dbStatusBadge) {
          if (settings.databaseConfig && settings.databaseConfig.enabled) {
            const provider = settings.databaseConfig.provider;
            dbStatusBadge.textContent = `SQL - ${provider.toUpperCase()}`;
            dbStatusBadge.style.background = '#10B981'; // Green active

            // Sync database migration form values
            const providerSelect = document.getElementById('mig-db-provider');
            if (providerSelect) {
              providerSelect.value = provider;
              // Trigger change handler to show correct subform
              setTimeout(() => {
                providerSelect.dispatchEvent(new Event('change'));
              }, 50);
            }

            const details = settings.databaseConfig.connectionDetails || {};
            if (provider === 'supabase') {
              const urlInput = document.getElementById('mig-sup-url');
              const keyInput = document.getElementById('mig-sup-key');
              if (urlInput) urlInput.value = details.url || '';
              if (keyInput) keyInput.value = details.key || '';
            } else if (provider === 'azure') {
              const connInput = document.getElementById('mig-az-conn');
              if (connInput) connInput.value = details.connectionString || '';
            } else if (provider === 'aws' || provider === 'sql') {
              const hostInput = document.getElementById('mig-gen-host');
              const portInput = document.getElementById('mig-gen-port');
              const dbnameInput = document.getElementById('mig-gen-dbname');
              const userInput = document.getElementById('mig-gen-user');
              const passInput = document.getElementById('mig-gen-pass');
              if (hostInput) hostInput.value = details.host || '';
              if (portInput) portInput.value = details.port || '';
              if (dbnameInput) dbnameInput.value = details.dbname || '';
              if (userInput) userInput.value = details.username || '';
              if (passInput) passInput.value = details.password || '';
            }
          } else {
            dbStatusBadge.textContent = 'LOCAL JSON DB';
            dbStatusBadge.style.background = 'var(--text-dim)'; // Default gray
          }
        }
      })
      .catch(err => console.error("Error fetching settings:", err));
  }

  // Save Settings
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    btnSaveSettings.disabled = true;
    btnSaveSettings.textContent = "Saving Configuration...";

    const payload = {
      targetCompany: targetCompanyInput.value.trim(),
      sector: sectorInput.value.trim(),
      size: sizeInput.value.trim(),
      hq: hqInput.value.trim(),
      acquisitionDate: acqDateInput.value,
      synergyObjective: synergyObjectiveInput.value.trim(),
      geminiApiKey: geminiKeyInput.value.trim(),
      browserModel: browserModelInput.value,
      
      welcomeVideoType: videoTypeEnInput ? videoTypeEnInput.value : 'local',
      welcomeVideoUrl: videoUrlEnInput ? videoUrlEnInput.value.trim() : '',
      welcomeVideoType_en: videoTypeEnInput ? videoTypeEnInput.value : 'local',
      welcomeVideoUrl_en: videoUrlEnInput ? videoUrlEnInput.value.trim() : '',
      welcomeVideoType_de: videoTypeDeInput ? videoTypeDeInput.value : 'local',
      welcomeVideoUrl_de: videoUrlDeInput ? videoUrlDeInput.value.trim() : '',
      welcomeVideoType_zh: videoTypeZhInput ? videoTypeZhInput.value : 'local',
      welcomeVideoUrl_zh: videoUrlZhInput ? videoUrlZhInput.value.trim() : '',
      welcomeVideoType_cs: videoTypeCsInput ? videoTypeCsInput.value : 'local',
      welcomeVideoUrl_cs: videoUrlCsInput ? videoUrlCsInput.value.trim() : '',

    };

    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          btnSaveSettings.textContent = "Saved Successfully!";
          btnSaveSettings.style.backgroundColor = "var(--status-success)";
          setTimeout(() => {
            btnSaveSettings.disabled = false;
            btnSaveSettings.textContent = "Save System Configuration";
            btnSaveSettings.style.backgroundColor = "";
          }, 1200);
        } else {
          alert("Failed to save settings.");
          btnSaveSettings.disabled = false;
          btnSaveSettings.textContent = "Save System Configuration";
        }
      })
      .catch(err => {
        console.error("Settings save error:", err);
        alert("Error saving settings.");
        btnSaveSettings.disabled = false;
        btnSaveSettings.textContent = "Save System Configuration";
      });
  });

  // Toggle API Key password visibility
  btnToggleKey.addEventListener('click', () => {
    if (geminiKeyInput.type === 'password') {
      geminiKeyInput.type = 'text';
      btnToggleKey.textContent = "Hide";
    } else {
      geminiKeyInput.type = 'password';
      btnToggleKey.textContent = "Show";
    }
  });

  // Load Survey Questions Blueprint
  function loadQuestions() {
    fetch('/api/questions')
      .then(res => res.json())
      .then(questions => {
        questionsListContainer.innerHTML = '';
        if (!questions || questions.length === 0) {
          questionsListContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem;">No questions active. Add questions above.</p>';
          return;
        }

        questions.forEach((q, idx) => {
          const row = document.createElement('div');
          row.className = 'admin-question-row edit-active-border';
          row.id = `q-row-${q.id}`;
          row.innerHTML = `
            <!-- Reorder Buttons -->
            <div class="reorder-controls-overlay">
              <button type="button" class="reorder-btn btn-up" title="Move Up" ${idx === 0 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5"/></svg>
              </button>
              <button type="button" class="reorder-btn btn-down" title="Move Down" ${idx === questions.length - 1 ? 'disabled style="opacity:0.3; cursor:not-allowed;"' : ''}>
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>
              </button>
            </div>

            <!-- Inline Edit Pen -->
            <div class="edit-pen-icon" title="Edit Question Inline">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>
            </div>

            <div class="admin-question-body">
              <span class="admin-question-text">${escapeHtml(q.text)}</span>
              <div class="admin-question-meta">
                <span class="admin-dimension-tag ${q.dimension}">${q.dimension}</span>
                <span style="font-size: 0.7rem; color: var(--text-secondary); font-weight: 500;">Weight: ${q.weight.toFixed(1)}</span>
              </div>
            </div>
            <button class="admin-action-btn delete-q-btn" data-id="${q.id}" title="Delete Question">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
              </svg>
            </button>
          `;

          // Bind Reorder Buttons
          const btnUp = row.querySelector('.btn-up');
          const btnDown = row.querySelector('.btn-down');
          if (btnUp && idx > 0) {
            btnUp.addEventListener('click', (e) => {
              e.stopPropagation();
              reorderQuestion(q.id, 'up');
            });
          }
          if (btnDown && idx < questions.length - 1) {
            btnDown.addEventListener('click', (e) => {
              e.stopPropagation();
              reorderQuestion(q.id, 'down');
            });
          }

          // Bind Inline Edit Pen
          const pen = row.querySelector('.edit-pen-icon');
          pen.addEventListener('click', (e) => {
            e.stopPropagation();
            activateInlineEdit(q, row);
          });

          row.querySelector('.delete-q-btn').addEventListener('click', () => deleteQuestion(q.id));
          questionsListContainer.appendChild(row);
        });
      })
      .catch(err => console.error("Error loading questions:", err));
  }

  // Reorder Survey Question logic
  async function reorderQuestion(id, direction) {
    try {
      const res = await fetch('/api/questions');
      const questions = await res.json();
      const idx = questions.findIndex(q => q.id === id);
      if (idx === -1) return;
      
      let targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= questions.length) return;
      
      // Swap elements in the array
      const temp = questions[idx];
      questions[idx] = questions[targetIdx];
      questions[targetIdx] = temp;
      
      const questionIds = questions.map(q => q.id);
      
      const response = await fetch('/api/questions/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds })
      });
      const data = await response.json();
      if (data.success) {
        loadQuestions();
      }
    } catch (err) {
      console.error("Error reordering questions:", err);
    }
  }

  // Activate Inline Editing for a single question row
  function activateInlineEdit(q, row) {
    const bodyEl = row.querySelector('.admin-question-body');
    const deleteBtn = row.querySelector('.delete-q-btn');
    const pen = row.querySelector('.edit-pen-icon');
    
    // Hide delete button and pen during edit
    if (deleteBtn) deleteBtn.style.display = 'none';
    if (pen) pen.style.display = 'none';
    
    bodyEl.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:0.5rem; width:100%; margin-top: 0.25rem;">
        <textarea class="inline-edit-textarea" rows="2" style="width:100%; box-sizing:border-box;">${q.text}</textarea>
        <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap; width:100%;">
          <select class="inline-edit-input select-dim" style="flex:1; min-width:100px; padding:0.25rem 0.5rem;">
            <option value="culture" ${q.dimension === 'culture' ? 'selected' : ''}>Culture & Values</option>
            <option value="talent" ${q.dimension === 'talent' ? 'selected' : ''}>Talent & Systems</option>
            <option value="value" ${q.dimension === 'value' ? 'selected' : ''}>Value & Synergies</option>
          </select>
          <select class="inline-edit-input select-weight" style="flex:1; min-width:80px; padding:0.25rem 0.5rem;">
            <option value="1.0" ${q.weight === 1.0 ? 'selected' : ''}>1.0 (Standard)</option>
            <option value="1.5" ${q.weight === 1.5 ? 'selected' : ''}>1.5 (High)</option>
            <option value="0.5" ${q.weight === 0.5 ? 'selected' : ''}>0.5 (Low)</option>
          </select>
        </div>
        <div class="inline-edit-actions" style="margin-top: 0.25rem;">
          <button type="button" class="btn-inline-cancel btn btn-secondary btn-sm" style="margin:0; padding:0.2rem 0.5rem; font-size:0.75rem;">Cancel</button>
          <button type="button" class="btn-inline-save btn btn-primary btn-sm" style="margin:0; padding:0.2rem 0.5rem; font-size:0.75rem;">Save</button>
        </div>
      </div>
    `;
    
    // Bind Save & Cancel
    const btnCancel = bodyEl.querySelector('.btn-inline-cancel');
    const btnSave = bodyEl.querySelector('.btn-inline-save');
    
    btnCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      loadQuestions();
    });
    
    btnSave.addEventListener('click', async (e) => {
      e.stopPropagation();
      const newText = bodyEl.querySelector('.inline-edit-textarea').value.trim();
      const newDim = bodyEl.querySelector('.select-dim').value;
      const newWeight = parseFloat(bodyEl.querySelector('.select-weight').value) || 1.0;
      
      if (!newText) {
        alert("Question prompt cannot be empty.");
        return;
      }
      
      try {
        btnSave.disabled = true;
        btnSave.textContent = "Saving...";
        const response = await fetch(`/api/questions/${q.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: newText, dimension: newDim, weight: newWeight })
        });
        const data = await response.json();
        if (data.success) {
          loadQuestions();
        } else {
          alert("Failed to save changes.");
          btnSave.disabled = false;
          btnSave.textContent = "Save";
        }
      } catch (err) {
        console.error("Error saving inline edit:", err);
        alert("Error saving changes.");
        btnSave.disabled = false;
        btnSave.textContent = "Save";
      }
    });
  }

  // Lock/Unlock Settings Form fields based on Edit Mode status
  function syncSettingsEditMode() {
    const isEditMode = localStorage.getItem('adminEditMode') === 'true';
    const formFields = settingsForm.querySelectorAll('input, textarea, select, button[type="submit"]');
    const settingsCard = settingsForm.closest('.card');
    
    if (isEditMode) {
      if (settingsCard) settingsCard.classList.add('edit-active-border');
      formFields.forEach(f => {
        if (f.id !== 'btn-toggle-key-visibility') {
          f.removeAttribute('disabled');
        }
      });
      
      if (settingsCard && !settingsCard.querySelector('.edit-pen-icon')) {
        const decorPen = document.createElement('div');
        decorPen.className = 'edit-pen-icon';
        decorPen.title = 'Edit Mode is Active';
        decorPen.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>`;
        settingsCard.appendChild(decorPen);
      }
    } else {
      if (settingsCard) settingsCard.classList.remove('edit-active-border');
      formFields.forEach(f => {
        if (f.id !== 'btn-toggle-key-visibility' && f.id !== 'btn-save-settings') {
          f.setAttribute('disabled', 'true');
        }
      });
      if (settingsCard) {
        const decorPen = settingsCard.querySelector('.edit-pen-icon');
        if (decorPen) decorPen.remove();
      }
    }
  }

  document.addEventListener('editModeChanged', syncSettingsEditMode);
  // Execute sync on layout settings mount
  setTimeout(syncSettingsEditMode, 150);

  // Add Question to Survey Blueprint
  addQuestionForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = newQText.value.trim();
    const dimension = newQDim.value;
    const weight = parseFloat(newQWeight.value) || 1.0;

    fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dimension, weight })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          newQText.value = '';
          loadQuestions();
        } else {
          alert("Failed to add question.");
        }
      })
      .catch(err => console.error("Error creating question:", err));
  });

  // Delete Question
  function deleteQuestion(id) {
    if (!confirm("Delete this question from future assessments?")) return;
    const row = document.getElementById(`q-row-${id}`);
    row.style.transform = 'translateX(-20px)';
    row.style.opacity = '0';
    setTimeout(() => {
      fetch(`/api/questions/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) loadQuestions();
        })
        .catch(err => console.error("Error deleting question:", err));
    }, 250);
  }

  // Load Assessments History Archive
  function loadAssessmentsHistory() {
    fetch('/api/assessments')
      .then(res => res.json())
      .then(assessments => {
        assessmentsHistoryList.innerHTML = '';
        if (!assessments || assessments.length === 0) {
          assessmentsHistoryList.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No diagnostics archived.</p>';
          return;
        }

        assessments.slice().reverse().forEach(a => {
          const entry = document.createElement('div');
          entry.className = 'admin-question-row';
          entry.style.padding = '0.75rem 1rem';
          entry.id = `assess-row-${a.id}`;
          const date = new Date(a.timestamp).toLocaleString();
          entry.innerHTML = `
            <div class="admin-question-body" style="gap: 0.15rem;">
              <span style="font-weight: 700; color: var(--te-dark-teal); font-size: 0.95rem;">${escapeHtml(a.targetCompany)}</span>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">${date}</span>
              <div style="display: flex; gap: 0.5rem; margin-top: 0.25rem; font-size: 0.7rem; font-weight: 600;">
                <span style="color: var(--te-orange);">C: ${a.scores.culture.toFixed(1)}</span>
                <span style="color: var(--te-dark-teal);">T: ${a.scores.talent.toFixed(1)}</span>
                <span style="color: #0D9488;">V: ${a.scores.value.toFixed(1)}</span>
              </div>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <button class="btn btn-secondary load-assess-btn" data-id="${a.id}" style="font-size: 0.75rem; padding: 0.3rem 0.6rem; border-radius: var(--radius-sm); margin:0;">
                Promote
              </button>
              <button class="admin-action-btn delete-assess-btn" data-id="${a.id}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px; height:16px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          `;
          entry.querySelector('.load-assess-btn').addEventListener('click', () => {
            localStorage.setItem('active_assessment_id', a.id);
            document.body.classList.remove('page-loaded');
            document.body.classList.add('page-exiting');
            setTimeout(() => window.location.href = '/dashboard.html', 280);
          });
          entry.querySelector('.delete-assess-btn').addEventListener('click', () => deleteAssessment(a.id));
          assessmentsHistoryList.appendChild(entry);
        });
      })
      .catch(err => console.error("Error loading history:", err));
  }

  // Delete Assessment Record
  function deleteAssessment(id) {
    if (!confirm("Delete this archived report?")) return;
    const row = document.getElementById(`assess-row-${id}`);
    row.style.transform = 'translateX(20px)';
    row.style.opacity = '0';
    setTimeout(() => {
      fetch(`/api/assessments/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) loadAssessmentsHistory();
        })
        .catch(err => console.error("Error deleting archive:", err));
    }, 250);
  }


  // --- 3. Action Modules CRUD ---
  const addModuleForm = document.getElementById('add-module-form');
  const moduleIdInput = document.getElementById('module-id');
  const moduleTitleInput = document.getElementById('module-title');
  const moduleDimensionInput = document.getElementById('module-dimension');
  const moduleUrgencyInput = document.getElementById('module-urgency');
  const moduleMinScoreInput = document.getElementById('module-min-score');
  const moduleMaxScoreInput = document.getElementById('module-max-score');
  const moduleTeamsInput = document.getElementById('module-teams');
  const moduleLinkInput = document.getElementById('module-link');
  const moduleDescInput = document.getElementById('module-desc');
  const btnCancelModuleEdit = document.getElementById('btn-cancel-module-edit');
  const btnSaveModule = document.getElementById('btn-save-module');
  const modulesListContainer = document.getElementById('modules-index-list');

  // Load Integration Modules
  function loadModules() {
    fetch('/api/modules')
      .then(res => res.json())
      .then(modules => {
        modulesListContainer.innerHTML = '';
        if (!modules || modules.length === 0) {
          modulesListContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No modules active. Create one to standardise your M&A process.</p>';
          return;
        }

        modules.forEach(m => {
          const card = document.createElement('div');
          card.className = 'admin-question-row';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'stretch';
          card.style.gap = '0.5rem';
          card.id = `mod-card-${m.id}`;

          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <strong style="color: var(--te-dark-teal); font-size: 1.05rem;">${escapeHtml(m.title)}</strong>
                <div style="display: flex; gap: 0.4rem; margin-top: 0.25rem;">
                  <span class="admin-dimension-tag ${m.dimension}" style="font-size: 0.65rem; padding: 0.15rem 0.4rem;">${m.dimension}</span>
                  <span style="font-size: 0.7rem; font-weight:700; color: var(--te-orange); background: var(--te-orange-light); padding: 0.15rem 0.4rem; border-radius: 4px;">${escapeHtml(m.urgency)}</span>
                  <span style="font-size: 0.7rem; color: var(--text-secondary); background: var(--bg-light); padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 500;">Scores: ${m.minScore}-${m.maxScore}</span>
                </div>
              </div>
              <div style="display: flex; gap: 0.25rem;">
                <button class="btn btn-secondary edit-mod-btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin: 0;">Edit</button>
                <button class="admin-action-btn delete-mod-btn" style="padding: 4px; width: 28px; height: 28px;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 14px; height: 14px;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
            <p style="font-size: 0.8rem; color: var(--text-primary); line-height: 1.4; margin: 0.15rem 0;">${escapeHtml(m.description)}</p>
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-secondary); border-top: 1px solid var(--border-color); padding-top: 0.4rem; margin-top: 0.25rem;">
              <span>Teams: <strong>${escapeHtml(m.supportingTeams)}</strong></span>
              <span>Ref: <a href="${escapeHtml(m.playbookLink)}" target="_blank" style="color: var(--te-dark-teal); font-weight:600; text-decoration: underline;">Playbook</a></span>
            </div>
          `;

          // Edit Handler
          card.querySelector('.edit-mod-btn').addEventListener('click', () => {
            moduleIdInput.value = m.id;
            moduleTitleInput.value = m.title;
            moduleDimensionInput.value = m.dimension;
            moduleUrgencyInput.value = m.urgency;
            moduleMinScoreInput.value = m.minScore;
            moduleMaxScoreInput.value = m.maxScore;
            moduleTeamsInput.value = m.supportingTeams;
            moduleLinkInput.value = m.playbookLink;
            moduleDescInput.value = m.description;
            
            btnSaveModule.textContent = "Update Integration Module";
            btnCancelModuleEdit.style.display = "block";
          });

          // Delete Handler
          card.querySelector('.delete-mod-btn').addEventListener('click', () => deleteModule(m.id));

          modulesListContainer.appendChild(card);
        });
      })
      .catch(err => console.error("Error loading modules:", err));
  }

  // Cancel Module Edit
  btnCancelModuleEdit.addEventListener('click', () => {
    addModuleForm.reset();
    moduleIdInput.value = '';
    btnSaveModule.textContent = "Save Integration Module";
    btnCancelModuleEdit.style.display = "none";
  });

  // Save Module Form Submit
  addModuleForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const payload = {
      title: moduleTitleInput.value.trim(),
      dimension: moduleDimensionInput.value,
      urgency: moduleUrgencyInput.value.trim(),
      minScore: parseFloat(moduleMinScoreInput.value) || 1.0,
      maxScore: parseFloat(moduleMaxScoreInput.value) || 5.0,
      supportingTeams: moduleTeamsInput.value.trim(),
      playbookLink: moduleLinkInput.value.trim(),
      description: moduleDescInput.value.trim()
    };

    if (moduleIdInput.value) {
      payload.id = moduleIdInput.value;
    }

    fetch('/api/modules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          addModuleForm.reset();
          moduleIdInput.value = '';
          btnSaveModule.textContent = "Save Integration Module";
          btnCancelModuleEdit.style.display = "none";
          loadModules();
        } else {
          alert("Failed to save action module.");
        }
      })
      .catch(err => console.error("Error saving module:", err));
  });

  // Delete Action Module
  function deleteModule(id) {
    if (!confirm("Are you sure you want to delete this action module?")) return;
    const card = document.getElementById(`mod-card-${id}`);
    card.style.transform = 'translateY(15px)';
    card.style.opacity = '0';
    setTimeout(() => {
      fetch(`/api/modules/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) loadModules();
        })
        .catch(err => console.error("Error deleting module:", err));
    }, 250);
  }


  // --- 4. Employee Roster & Welcome URL Compiler ---
  const addEmployeeForm = document.getElementById('add-employee-form');
  const empIdInput = document.getElementById('emp-id');
  const empNameInput = document.getElementById('emp-name');
  const empRoleInput = document.getElementById('emp-role');
  const empDeptInput = document.getElementById('emp-dept');
  const empCompanyInput = document.getElementById('emp-company');
  const empLangInput = document.getElementById('emp-lang');
  const empIsLeader = document.getElementById('emp-is-leader');
  const leaderRoleGroup = document.getElementById('leader-role-group');
  const empLeaderRole = document.getElementById('emp-leader-role');
  const empBuddyName = document.getElementById('emp-buddy-name');
  const empBuddyEmail = document.getElementById('emp-buddy-email');
  const btnSaveEmp = document.getElementById('btn-save-emp');
  const btnCancelEmpEdit = document.getElementById('btn-cancel-emp-edit');
  const employeesListContainer = document.getElementById('employees-index-list');

  // Toggle leader role select visibility
  if (empIsLeader && leaderRoleGroup) {
    empIsLeader.addEventListener('change', () => {
      if (empIsLeader.checked) {
        leaderRoleGroup.style.display = 'block';
      } else {
        leaderRoleGroup.style.display = 'none';
        if (empLeaderRole) empLeaderRole.value = 'None';
      }
    });
  }

  // Load Acquired Employees Roster
  function loadEmployees() {
    fetch('/api/employees')
      .then(res => res.json())
      .then(employees => {
        employeesListContainer.innerHTML = '';
        if (!employees || employees.length === 0) {
          employeesListContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No employees registered. Add staff on the left.</p>';
          return;
        }

        employees.forEach(e => {
          const row = document.createElement('div');
          row.className = 'admin-question-row';
          row.style.flexDirection = 'column';
          row.style.alignItems = 'stretch';
          row.style.gap = '0.5rem';
          row.id = `emp-row-${e.id}`;

          // Compile Welcome URL with language
          const escName = encodeURIComponent(e.name);
          const escRole = encodeURIComponent(e.role);
          const escDept = encodeURIComponent(e.department);
          const escCompany = encodeURIComponent(e.company || targetCompanyInput.value || "Acquired Co.");
          const eLang = e.lang || 'en';
          const welcomeUrl = `${window.location.origin}/employee.html?empId=${e.id}&name=${escName}&role=${escRole}&dept=${escDept}&company=${escCompany}&lang=${eLang}`;

          row.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.35rem;">
                  <strong style="color: var(--te-dark-teal); font-size: 1rem;">${escapeHtml(e.name)}</strong>
                  ${e.isLeader ? `<span style="background-color: #D4AF37; color: white; font-size: 0.65rem; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: bold; white-space: nowrap;">👑 LEADER (${escapeHtml(e.leaderRole || 'Acquired Leadership')})</span>` : ''}
                </div>
                <span style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(e.role)} (${escapeHtml(e.department)}) [${eLang.toUpperCase()}]</span>
                <p style="font-size: 0.7rem; color: var(--text-dim); margin-top: 0.15rem; font-weight: 500; margin-bottom: 0.15rem;">Entity: ${escapeHtml(e.company)}</p>
                ${e.buddyName ? `<p style="font-size: 0.7rem; color: var(--te-orange); margin-top: 0.1rem; font-weight: 600; margin-bottom: 0;">Buddy: ${escapeHtml(e.buddyName)} (${escapeHtml(e.buddyEmail)})</p>` : ''}
              </div>
              <div style="display: flex; gap: 0.25rem;">
                <button class="btn btn-secondary edit-emp-btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin: 0; height: 26px;">Edit</button>
                <button class="admin-action-btn delete-emp-btn" style="width: 26px; height: 26px; padding: 4px;">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px; height:14px;">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
            
            <div style="display: flex; gap: 0.5rem; align-items: center; border-top: 1px dashed var(--border-color); padding-top: 0.4rem; margin-top: 0.25rem;">
              <input type="text" class="form-control" style="font-size: 0.75rem; padding: 0.35rem 0.5rem; height: auto; flex-grow: 1;" readonly value="${welcomeUrl}">
              <button class="btn btn-secondary copy-url-btn" style="margin: 0; padding: 0.4rem 0.8rem; font-size: 0.75rem; font-weight:700; white-space: nowrap;">Copy URL</button>
            </div>
          `;

          // Copy URL Trigger
          row.querySelector('.copy-url-btn').addEventListener('click', (e) => {
            const btn = e.target;
            navigator.clipboard.writeText(welcomeUrl).then(() => {
              const oldTxt = btn.textContent;
              btn.textContent = "Copied!";
              btn.style.backgroundColor = "var(--status-success)";
              btn.style.color = "#FFFFFF";
              setTimeout(() => {
                btn.textContent = oldTxt;
                btn.style.backgroundColor = "";
                btn.style.color = "";
              }, 1200);
            }).catch(err => {
              console.error("Clipboard copy failed:", err);
            });
          });

          // Edit Trigger
          row.querySelector('.edit-emp-btn').addEventListener('click', () => {
            empIdInput.value = e.id;
            empNameInput.value = e.name;
            empRoleInput.value = e.role;
            empDeptInput.value = e.department;
            empCompanyInput.value = e.company || '';
            if (empLangInput) empLangInput.value = e.lang || 'en';
            
            if (empIsLeader) {
              empIsLeader.checked = e.isLeader === true;
              if (empIsLeader.checked) {
                leaderRoleGroup.style.display = 'block';
                if (empLeaderRole) empLeaderRole.value = e.leaderRole || 'None';
              } else {
                leaderRoleGroup.style.display = 'none';
                if (empLeaderRole) empLeaderRole.value = 'None';
              }
            }
            
            if (empBuddyName) empBuddyName.value = e.buddyName || '';
            if (empBuddyEmail) empBuddyEmail.value = e.buddyEmail || '';
            
            btnSaveEmp.textContent = "Update Employee Info";
            btnCancelEmpEdit.style.display = "block";
            
            addEmployeeForm.scrollIntoView({ behavior: 'smooth' });
          });

          // Delete Trigger
          row.querySelector('.delete-emp-btn').addEventListener('click', () => deleteEmployee(e.id));

          employeesListContainer.appendChild(row);
        });
      })
      .catch(err => console.error("Error loading employees:", err));
  }

  // Cancel Employee Edit
  btnCancelEmpEdit.addEventListener('click', () => {
    addEmployeeForm.reset();
    empIdInput.value = '';
    if (leaderRoleGroup) leaderRoleGroup.style.display = 'none';
    btnSaveEmp.textContent = "Register Employee";
    btnCancelEmpEdit.style.display = "none";
  });

  // Add Employee submit
  addEmployeeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const payload = {
      name: empNameInput.value.trim(),
      role: empRoleInput.value.trim(),
      department: empDeptInput.value,
      company: empCompanyInput.value.trim() || undefined,
      lang: empLangInput ? empLangInput.value : 'en',
      isLeader: empIsLeader ? empIsLeader.checked : false,
      leaderRole: empLeaderRole ? empLeaderRole.value : 'None',
      buddyName: empBuddyName ? empBuddyName.value.trim() : '',
      buddyEmail: empBuddyEmail ? empBuddyEmail.value.trim() : ''
    };

    if (empIdInput.value) {
      payload.id = empIdInput.value;
    }

    fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          addEmployeeForm.reset();
          empIdInput.value = '';
          btnSaveEmp.textContent = "Register Employee";
          btnCancelEmpEdit.style.display = "none";
          if (leaderRoleGroup) leaderRoleGroup.style.display = 'none';
          loadEmployees();
        } else {
          alert("Failed to register employee.");
        }
      })
      .catch(err => console.error("Error adding employee:", err));
  });

  // Delete Employee
  function deleteEmployee(id) {
    if (!confirm("Are you sure you want to delete this staff registry and compile links?")) return;
    const row = document.getElementById(`emp-row-${id}`);
    row.style.transform = 'translateY(15px)';
    row.style.opacity = '0';
    setTimeout(() => {
      fetch(`/api/employees/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) loadEmployees();
        })
        .catch(err => console.error("Error deleting employee:", err));
    }, 250);
  }


  // --- 5. Integration Leader Registry & Alerts desk ---
  const addHrbpForm = document.getElementById('add-hrbp-form');
  const hrbpIdInput = document.getElementById('hrbp-id');
  const hrbpNameInput = document.getElementById('hrbp-name');
  const hrbpEmailInput = document.getElementById('hrbp-email');
  const hrbpTeamsInput = document.getElementById('hrbp-teams');
  const btnSaveHrbp = document.getElementById('btn-save-hrbp');
  const btnCancelHrbpEdit = document.getElementById('btn-cancel-hrbp-edit');
  const hrbpIndexContainer = document.getElementById('hrbp-index-list');

  const addAlertForm = document.getElementById('add-alert-form');
  const alertIdInput = document.getElementById('alert-id');
  const alertTitleInput = document.getElementById('alert-title');
  const alertTypeInput = document.getElementById('alert-type');
  const alertMessageInput = document.getElementById('alert-message');
  const btnSaveAlert = document.getElementById('btn-save-alert');
  const btnCancelAlertEdit = document.getElementById('btn-cancel-alert-edit');
  const alertsIndexContainer = document.getElementById('alerts-index-list');

  // Load Integration Leaders List
  function loadHrbps() {
    fetch('/api/hrbps')
      .then(res => res.json())
      .then(hrbps => {
        hrbpIndexContainer.innerHTML = '';
        if (!hrbps || hrbps.length === 0) {
          hrbpIndexContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem;">No Integration Leaders registered.</p>';
          return;
        }

        hrbps.forEach(h => {
          const row = document.createElement('div');
          row.className = 'admin-question-row';
          row.style.padding = '0.6rem 0.8rem';
          row.id = `hrbp-row-${h.id}`;

          const tracks = h.assignedTracks.map(t => `<span class="admin-dimension-tag ${t}" style="font-size:0.65rem; padding:0.1rem 0.3rem;">${t}</span>`).join(' ');
          const roleBadge = h.role === 'pmo' 
            ? `<span class="portal-badge" style="background: var(--te-dark-teal); color: white; font-size: 0.65rem; padding: 0.15rem 0.35rem; font-weight: bold; border-radius: 4px; margin-left: 0.5rem; display: inline-block;">👑 PMO LEAD</span>`
            : `<span class="portal-badge" style="background: var(--te-orange); color: white; font-size: 0.65rem; padding: 0.15rem 0.35rem; font-weight: bold; border-radius: 4px; margin-left: 0.5rem; display: inline-block;">💼 Integration Leader</span>`;

          row.innerHTML = `
            <div class="admin-question-body" style="gap:0.1rem;">
              <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem;">
                <strong style="color: var(--te-dark-teal); font-size: 0.9rem;">${escapeHtml(h.name)}</strong>
                ${roleBadge}
              </div>
              <span style="font-size: 0.75rem; color: var(--text-secondary);">${escapeHtml(h.email)}</span>
              <div style="display: flex; gap: 0.35rem; align-items:center; margin-top: 0.2rem;">
                ${tracks}
                <span style="font-size: 0.7rem; color: var(--text-dim); font-weight:500;">Teams: ${escapeHtml(h.supportingTeams.join(', '))}</span>
              </div>
            </div>
            <div style="display: flex; gap: 0.25rem; align-items: center;">
              <button class="btn btn-secondary edit-hrbp-btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin: 0; height: 24px;">Edit</button>
              <button class="admin-action-btn delete-hrbp-btn" style="width:24px; height:24px; padding:3px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          `;

          // Edit Handler
          row.querySelector('.edit-hrbp-btn').addEventListener('click', () => {
            hrbpIdInput.value = h.id;
            hrbpNameInput.value = h.name;
            hrbpEmailInput.value = h.email;
            
            const roleSelect = document.getElementById('hrbp-role');
            if (roleSelect) roleSelect.value = h.role || 'hrbp';
            
            document.querySelectorAll('input[name="hrbp-tracks"]').forEach(cb => {
              cb.checked = h.assignedTracks.includes(cb.value);
            });
            
            hrbpTeamsInput.value = h.supportingTeams.join(', ');
            
            btnSaveHrbp.textContent = "Update Partner Details";
            btnCancelHrbpEdit.style.display = "block";
            
            addHrbpForm.scrollIntoView({ behavior: 'smooth' });
          });

          row.querySelector('.delete-hrbp-btn').addEventListener('click', () => deleteHrbp(h.id));
          hrbpIndexContainer.appendChild(row);
        });
      })
      .catch(err => console.error("Error loading Integration Leaders:", err));
  }

  // Cancel Integration Leader Edit
  btnCancelHrbpEdit.addEventListener('click', () => {
    addHrbpForm.reset();
    hrbpIdInput.value = '';
    btnSaveHrbp.textContent = "Register Partner";
    btnCancelHrbpEdit.style.display = "none";
  });

  // Add Integration Leader submit
  addHrbpForm.addEventListener('submit', (e) => {
    e.preventDefault();

    // Compile checked tracks
    const checkedTracks = [];
    document.querySelectorAll('input[name="hrbp-tracks"]:checked').forEach(cb => {
      checkedTracks.push(cb.value);
    });

    const teams = hrbpTeamsInput.value.split(',').map(t => t.trim()).filter(t => t.length > 0);
    const roleSelect = document.getElementById('hrbp-role');
    const roleValue = roleSelect ? roleSelect.value : 'hrbp';

    const payload = {
      name: hrbpNameInput.value.trim(),
      email: hrbpEmailInput.value.trim(),
      assignedTracks: checkedTracks,
      supportingTeams: teams,
      role: roleValue
    };

    if (hrbpIdInput.value) {
      payload.id = hrbpIdInput.value;
    }

    fetch('/api/hrbps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          addHrbpForm.reset();
          hrbpIdInput.value = '';
          btnSaveHrbp.textContent = "Register Partner";
          btnCancelHrbpEdit.style.display = "none";
          loadHrbps();
        } else {
          alert("Failed to add partner.");
        }
      })
      .catch(err => console.error("Error creating hrbp:", err));
  });

  // Delete Integration Leader
  function deleteHrbp(id) {
    if (!confirm("Are you sure you want to delete this partner registry?")) return;
    const row = document.getElementById(`hrbp-row-${id}`);
    row.style.transform = 'translateX(-15px)';
    row.style.opacity = '0';
    setTimeout(() => {
      fetch(`/api/hrbps/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) loadHrbps();
        })
        .catch(err => console.error("Error deleting hrbp:", err));
    }, 250);
  }

  // Load Active Alerts Banners
  function loadAlerts() {
    fetch('/api/alerts')
      .then(res => res.json())
      .then(alerts => {
        alertsIndexContainer.innerHTML = '';
        if (!alerts || alerts.length === 0) {
          alertsIndexContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1rem;">No announcements active.</p>';
          return;
        }

        alerts.forEach(a => {
          const row = document.createElement('div');
          row.className = 'admin-question-row';
          row.style.padding = '0.6rem 0.8rem';
          row.id = `alert-row-${a.id}`;

          let categoryBadgeColor = 'var(--text-secondary)';
          if (a.type === 'meeting') categoryBadgeColor = 'var(--te-orange)';
          if (a.type === 'training') categoryBadgeColor = '#0D9488';

          row.innerHTML = `
            <div class="admin-question-body" style="gap:0.1rem;">
              <strong style="color: var(--te-dark-teal); font-size: 0.9rem;">${escapeHtml(a.title)}</strong>
              <p style="font-size: 0.75rem; color: var(--text-primary); margin: 0.15rem 0; line-height:1.4;">${escapeHtml(a.message)}</p>
              <span style="font-size: 0.65rem; color: ${categoryBadgeColor}; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; margin-top:0.15rem;">Category: ${escapeHtml(a.type)}</span>
            </div>
            <div style="display: flex; gap: 0.25rem; align-items: center;">
              <button class="btn btn-secondary edit-alert-btn" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; margin: 0; height: 24px;">Edit</button>
              <button class="admin-action-btn delete-alert-btn" style="width:24px; height:24px; padding:3px;">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:12px; height:12px;">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                </svg>
              </button>
            </div>
          `;

          // Edit Handler
          row.querySelector('.edit-alert-btn').addEventListener('click', () => {
            alertIdInput.value = a.id;
            alertTitleInput.value = a.title;
            alertTypeInput.value = a.type;
            alertMessageInput.value = a.message;
            
            btnSaveAlert.textContent = "Update System Alert";
            btnCancelAlertEdit.style.display = "block";
            
            addAlertForm.scrollIntoView({ behavior: 'smooth' });
          });

          row.querySelector('.delete-alert-btn').addEventListener('click', () => deleteAlert(a.id));
          alertsIndexContainer.appendChild(row);
        });
      })
      .catch(err => console.error("Error loading alerts:", err));
  }

  // Cancel Alert Edit
  btnCancelAlertEdit.addEventListener('click', () => {
    addAlertForm.reset();
    alertIdInput.value = '';
    btnSaveAlert.textContent = "Publish System Alert";
    btnCancelAlertEdit.style.display = "none";
  });

  // Add Alert submit
  addAlertForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const payload = {
      title: alertTitleInput.value.trim(),
      type: alertTypeInput.value,
      message: alertMessageInput.value.trim()
    };

    if (alertIdInput.value) {
      payload.id = alertIdInput.value;
    }

    fetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          addAlertForm.reset();
          alertIdInput.value = '';
          btnSaveAlert.textContent = "Publish System Alert";
          btnCancelAlertEdit.style.display = "none";
          loadAlerts();
        } else {
          alert("Failed to publish announcement.");
        }
      })
      .catch(err => console.error("Error publishing alert:", err));
  });

  // Delete Alert
  function deleteAlert(id) {
    if (!confirm("Are you sure you want to delete this alert announcement?")) return;
    const row = document.getElementById(`alert-row-${id}`);
    row.style.transform = 'translateX(15px)';
    row.style.opacity = '0';
    setTimeout(() => {
      fetch(`/api/alerts/${id}`, { method: 'DELETE' })
        .then(res => res.json())
        .then(data => {
          if (data.success) loadAlerts();
        })
        .catch(err => console.error("Error deleting announcement:", err));
    }, 250);
  }


  // --- Helper: Escape HTML strings safely ---
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // --- 8. AI RAG PDF Training Upload & AI Insight Review ---
  const ragUploadZone = document.getElementById('rag-upload-zone');
  const ragFileInput = document.getElementById('rag-file-input');
  const ragProcessingContainer = document.getElementById('rag-processing-container');
  const ragProgressBar = document.getElementById('rag-progress-bar');
  const ragStatusText = document.getElementById('rag-status-text');
  const ragPercentText = document.getElementById('rag-percent-text');
  const ragResultContainer = document.getElementById('rag-result-container');
  const ragResultSummary = document.getElementById('rag-result-summary');
  const ragResultDim = document.getElementById('rag-result-dim');
  const ragResultChunks = document.getElementById('rag-result-chunks');
  
  const stepUpload = document.getElementById('step-upload');
  const stepCognitive = document.getElementById('step-cognitive');
  const stepIndexing = document.getElementById('step-indexing');

  if (ragUploadZone) {
    ragUploadZone.addEventListener('click', () => ragFileInput.click());
    
    // Drag & Drop handlers
    ragUploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      ragUploadZone.style.borderColor = 'var(--te-orange)';
      ragUploadZone.style.background = 'rgba(233, 131, 0, 0.05)';
    });
    
    ragUploadZone.addEventListener('dragleave', () => {
      ragUploadZone.style.borderColor = 'rgba(36, 76, 90, 0.3)';
      ragUploadZone.style.background = 'rgba(255,255,255,0.4)';
    });
    
    ragUploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      ragUploadZone.style.borderColor = 'rgba(36, 76, 90, 0.3)';
      ragUploadZone.style.background = 'rgba(255,255,255,0.4)';
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        handleRagPdfFile(files[0]);
      }
    });
    
    ragFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        handleRagPdfFile(e.target.files[0]);
      }
    });
  }

  function handleRagPdfFile(file) {
    if (file.type !== 'application/pdf') {
      alert("Only PDF files are supported for AI RAG training.");
      return;
    }
    
    // Hide previous result if any
    ragResultContainer.style.display = 'none';
    
    // Show progress container & reset steps
    ragProcessingContainer.style.display = 'block';
    updateRagUploadProgress(0, "Reading local PDF file...");
    
    stepUpload.style.opacity = '1';
    stepUpload.querySelector('.step-bullet').textContent = '⚡';
    stepCognitive.style.opacity = '0.5';
    stepCognitive.querySelector('.step-bullet').textContent = '•';
    stepIndexing.style.opacity = '0.5';
    stepIndexing.querySelector('.step-bullet').textContent = '•';
    
    const reader = new FileReader();
    reader.onload = function(evt) {
      const fileData = evt.target.result; // base64 string with header
      
      // Step 2: Upload and extract text on server
      updateRagUploadProgress(25, "Extracting playbook text on server...");
      stepUpload.querySelector('.step-bullet').textContent = '✅';
      stepUpload.style.fontWeight = '500';
      
      stepCognitive.style.opacity = '1';
      stepCognitive.querySelector('.step-bullet').textContent = '⚡';
      stepCognitive.style.fontWeight = '700';
      
      // Simulate progress ticks for LLM review
      let reviewPercent = 25;
      const reviewTimer = setInterval(() => {
        if (reviewPercent < 75) {
          reviewPercent += 3;
          updateRagUploadProgress(reviewPercent, "AI Insight reviewing contents & drafting compliance chunks...");
        }
      }, 400);

      fetch('/api/rag/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          fileData: fileData
        })
      })
      .then(res => {
        clearInterval(reviewTimer);
        return res.json();
      })
      .then(data => {
        if (data.success) {
          updateRagUploadProgress(90, "Compiling and building new active RAG index...");
          stepCognitive.querySelector('.step-bullet').textContent = '✅';
          stepCognitive.style.fontWeight = '500';
          
          stepIndexing.style.opacity = '1';
          stepIndexing.querySelector('.step-bullet').textContent = '⚡';
          stepIndexing.style.fontWeight = '700';
          
          setTimeout(() => {
            updateRagUploadProgress(100, "RAG Training Complete!");
            stepIndexing.querySelector('.step-bullet').textContent = '✅';
            stepIndexing.style.fontWeight = '500';
            
            // Show result details
            ragResultContainer.style.display = 'block';
            ragResultSummary.textContent = data.upload.summary;
            ragResultDim.textContent = data.upload.dimension;
            ragResultChunks.textContent = `${data.upload.suggestedRags.length} guidelines`;
            
            // Reset zone file input
            ragFileInput.value = '';
          }, 800);
        } else {
          alert("Error processing PDF: " + data.error);
          ragProcessingContainer.style.display = 'none';
        }
      })
      .catch(err => {
        clearInterval(reviewTimer);
        console.error("PDF upload RAG failed:", err);
        alert("Failed to connect to RAG upload server endpoint.");
        ragProcessingContainer.style.display = 'none';
      });
    };
    
    reader.readAsDataURL(file);
  }

  function updateRagUploadProgress(percent, statusText) {
    ragProgressBar.style.width = `${percent}%`;
    ragPercentText.textContent = `${percent}%`;
    ragStatusText.textContent = statusText;
  }

  // --- 2b. PMO Integration Control Diagnostics ---
  function loadPmoDiagnostics() {
    const adminPmoSynergyVal = document.getElementById('admin-pmo-synergy-val');
    const adminPmoSynergyBar = document.getElementById('admin-pmo-synergy-bar');
    const adminPmoTasksVal = document.getElementById('admin-pmo-tasks-val');
    const adminPmoBlockersVal = document.getElementById('admin-pmo-blockers-val');

    if (!adminPmoSynergyVal) return;

    // Load from localStorage
    const tasksState = JSON.parse(localStorage.getItem('pmo_tasks_state')) || {};
    const blockersState = JSON.parse(localStorage.getItem('pmo_blockers_state')) || [];

    // Tracks structure for weighting
    const tracks = {
      hr: { weight: 1.0 },
      it: { weight: 1.2 },
      finance: { weight: 1.0 },
      sales: { weight: 1.1 },
      legal: { weight: 0.9 },
      rd: { weight: 1.2 },
      ops: { weight: 1.3 }
    };

    // Task counts matching defaultTasks
    const defaultTaskCounts = {
      hr: 4,
      it: 4,
      finance: 4,
      sales: 4,
      legal: 4,
      rd: 4,
      ops: 4
    };

    const taskWeights = {
      hr: [3, 4, 2, 1],
      it: [4, 3, 2, 1],
      finance: [4, 3, 2, 1],
      sales: [4, 3, 1, 2],
      legal: [4, 3, 2, 1],
      rd: [3, 4, 2, 1],
      ops: [4, 3, 2, 1]
    };

    let totalDone = 0;
    let totalTasksCount = 0;
    
    // Calculate raw and capped progress per track
    const trackProgress = {};
    let totalScore = 0;
    let totalWeight = 0;

    const tracksKeys = Object.keys(tracks);

    tracksKeys.forEach(track => {
      let done = 0;
      let trackTasks = tasksState[track] || {};
      
      // Count completed
      Object.keys(trackTasks).forEach(taskId => {
        if (trackTasks[taskId]) {
          done++;
          totalDone++;
        }
      });
      totalTasksCount += defaultTaskCounts[track];

      // Weighted calculations
      let completedWeight = 0;
      let totalTrackWeight = 0;
      const weights = taskWeights[track];
      
      // Map tasks to their index for weights
      const taskIdsList = [
        "hr_benefits", "hr_banding", "hr_buddy", "hr_handbook",
        "it_ssn_bridge", "it_vpn_bridge", "it_hardware_swap", "it_cyber_audit",
        "fin_ledger_convert", "fin_banking_sync", "fin_tax_filings", "fin_procure_policy",
        "sales_crm_sync", "sales_price_align", "sales_branding_swap", "sales_training_pmi",
        "leg_antitrust_clear", "leg_patent_transfer", "leg_contract_nda", "leg_corporate_filing",
        "rd_codebase_repo", "rd_schematics_map", "rd_patents_eval", "rd_tools_license",
        "ops_manufacture_run", "ops_sku_harmonize", "ops_logistics_route", "ops_equipment_tag"
      ].filter(id => id.startsWith(track === 'hr' ? 'hr_' : track === 'rd' ? 'rd_' : track + '_') || (track === 'it' && id.startsWith('it_')) || (track === 'sales' && id.startsWith('sales_')) || (track === 'finance' && id.startsWith('fin_')) || (track === 'legal' && id.startsWith('leg_')) || (track === 'ops' && id.startsWith('ops_')));

      for (let i = 0; i < defaultTaskCounts[track]; i++) {
        totalTrackWeight += weights[i] || 1;
        const tId = taskIdsList[i];
        if (tId && trackTasks[tId]) {
          completedWeight += weights[i] || 1;
        }
      }

      let rawPct = Math.round((completedWeight / totalTrackWeight) * 100);

      // Enforce Blocker Caps
      let activeCap = 100;
      blockersState.forEach(blocker => {
        if (!blocker.resolved && blocker.impactTracks.includes(track)) {
          if (blocker.maxCap < activeCap) {
            activeCap = blocker.maxCap;
          }
        }
      });

      let cappedPct = Math.min(rawPct, activeCap);
      trackProgress[track] = cappedPct;
      
      totalScore += cappedPct * tracks[track].weight;
      totalWeight += tracks[track].weight;
    });

    const overallSynergy = Math.round(totalScore / totalWeight);

    adminPmoSynergyVal.textContent = `${overallSynergy}%`;
    adminPmoSynergyBar.style.width = `${overallSynergy}%`;
    adminPmoTasksVal.textContent = `${totalDone}/${totalTasksCount} Done`;

    // Active blockers
    let activeBlockers = 0;
    blockersState.forEach(b => {
      if (!b.resolved) activeBlockers++;
    });

    adminPmoBlockersVal.textContent = `${activeBlockers} Active`;
    if (activeBlockers === 0) {
      adminPmoBlockersVal.style.color = '#10B981';
    } else {
      adminPmoBlockersVal.style.color = '#EF4444';
    }
  }

  // Bind Reset PMO Button
  const btnResetPmo = document.getElementById('btn-admin-reset-pmo');
  if (btnResetPmo) {
    btnResetPmo.addEventListener('click', () => {
      if (confirm("Are you sure you want to reset the cross-functional PMO Control Desk? This will uncheck all tasks, restore all synergy blockers, and lock gated milestones!")) {
        const defaultTasksList = {
          hr: ["hr_benefits", "hr_banding", "hr_buddy", "hr_handbook"],
          it: ["it_ssn_bridge", "it_vpn_bridge", "it_hardware_swap", "it_cyber_audit"],
          finance: ["fin_ledger_convert", "fin_banking_sync", "fin_tax_filings", "fin_procure_policy"],
          sales: ["sales_crm_sync", "sales_price_align", "sales_branding_swap", "sales_training_pmi"],
          legal: ["leg_antitrust_clear", "leg_patent_transfer", "leg_contract_nda", "leg_corporate_filing"],
          rd: ["rd_codebase_repo", "rd_schematics_map", "rd_patents_eval", "rd_tools_license"],
          ops: ["ops_manufacture_run", "ops_sku_harmonize", "ops_logistics_route", "ops_equipment_tag"]
        };

        const defaultBlockers = [
          {
            id: "blocker_sso",
            title: "HR Employee Records SSO Sync Failure",
            desc: "Legacy directory record mismatch locks directory syncs, preventing deployment of unified SSO portals.",
            impactTracks: ["hr", "it"],
            maxCap: 50,
            buttonLabel: "⚡ Resolve SSO Sync Blocker",
            resolved: false
          },
          {
            id: "blocker_patent",
            title: "Patent Transfer Trademark Audits Delayed",
            desc: "Delays in trademark approvals prevent codebase sharing, locking R&D repository syncing.",
            impactTracks: ["rd", "legal"],
            maxCap: 40,
            buttonLabel: "⚡ Resolve Patent Audit Blocker",
            resolved: false
          },
          {
            id: "blocker_erp",
            title: "Manufacturing ERP Ledger Consolidation Error",
            desc: "Warehouse SKU inventory valuation ledger mismatches block listing joint product catalog items in Sales CRM.",
            impactTracks: ["finance", "ops"],
            maxCap: 45,
            buttonLabel: "⚡ Resolve ERP Valuation Blocker",
            resolved: false
          }
        ];

        const tasksState = {};
        for (const track in defaultTasksList) {
          tasksState[track] = {};
          defaultTasksList[track].forEach(taskId => {
            tasksState[track][taskId] = false;
          });
        }

        localStorage.setItem('pmo_tasks_state', JSON.stringify(tasksState));
        localStorage.setItem('pmo_blockers_state', JSON.stringify(defaultBlockers));
        localStorage.setItem('pmo_active_tab', 'hr');

        // Show banner announcement
        const banner = document.createElement('div');
        banner.className = 'announcement-banner';
        banner.style.cssText = 'position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%) translateY(-20px); opacity: 0; background: var(--te-dark-teal); color: var(--text-light); border-left: 4px solid var(--te-orange); padding: 0.75rem 1.5rem; border-radius: var(--radius-md); box-shadow: var(--shadow-lg); font-weight: 600; font-size: 0.9rem; z-index: 100000; transition: all 0.3s ease;';
        banner.textContent = "PMO Control Desk Integration state has been successfully wiped and reset!";
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
        }, 2000);

        loadPmoDiagnostics();
      }
    });
  }

  // --- Unified Communications Hub Section ---
  const broadcastForm = document.getElementById('admin-broadcast-form');
  const recipientTypeSelect = document.getElementById('comm-recipient-type');
  const specificRecipientContainer = document.getElementById('comm-recipient-specific-container');
  const specificRecipientSelect = document.getElementById('comm-recipient-select');
  const commLedgerContainer = document.getElementById('comm-ledger-container');
  const commLedgerCount = document.getElementById('comm-ledger-count');

  // Toggle Specific Recipient selector
  if (recipientTypeSelect) {
    recipientTypeSelect.addEventListener('change', () => {
      if (recipientTypeSelect.value === 'individual') {
        specificRecipientContainer.style.display = 'block';
        loadRecipientDropdownOptions();
      } else {
        specificRecipientContainer.style.display = 'none';
      }
    });
  }

  // Load Recipient options
  function loadRecipientDropdownOptions() {
    if (!specificRecipientSelect) return;
    specificRecipientSelect.innerHTML = '<option value="">Loading recipients...</option>';
    
    Promise.all([
      fetch('/api/employees').then(res => res.json()).catch(() => []),
      fetch('/api/hrbps').then(res => res.json()).catch(() => [])
    ]).then(([employees, hrbps]) => {
      specificRecipientSelect.innerHTML = '';
      
      if (employees.length === 0 && hrbps.length === 0) {
        specificRecipientSelect.innerHTML = '<option value="">No corporate users available</option>';
        return;
      }

      // Group for Legacy Employees
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
        specificRecipientSelect.appendChild(empGroup);
      }

      // Group for Integration Leaders
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
        specificRecipientSelect.appendChild(hrbpGroup);
      }
    });
  }

  // Submit form handler
  if (broadcastForm) {
    broadcastForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const sender = document.getElementById('comm-sender').value;
      const senderRole = document.getElementById('comm-sender-role').value;
      const recipientType = recipientTypeSelect.value;
      const template = document.getElementById('comm-template').value;
      const subject = document.getElementById('comm-subject').value;
      const body = document.getElementById('comm-body').value;

      let recipientEmail = 'all@te.com';
      let recipientName = 'All Legacy Employees';
      let recipientId = 'all';

      if (recipientType === 'hrbp') {
        recipientEmail = 'integration-leaders@te.com';
        recipientName = 'All Integration Leaders';
        recipientId = 'hrbp';
      } else if (recipientType === 'individual') {
        const selectedOpt = specificRecipientSelect.options[specificRecipientSelect.selectedIndex];
        if (!selectedOpt || !selectedOpt.value) {
          showNotification('Please select a specific recipient first.', true);
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
          showNotification(`Broadcast successfully sent! Styled email written to ${data.communication.htmlEmailPath}`);
          broadcastForm.reset();
          if (recipientTypeSelect) {
            recipientTypeSelect.value = 'all';
            specificRecipientContainer.style.display = 'none';
          }
          loadCommunications();
        } else {
          showNotification(data.error || 'Failed to dispatch broadcast email.', true);
        }
      })
      .catch(err => {
        console.error("Error sending communication:", err);
        showNotification('Server error when dispatching communication.', true);
      });
    });
  }

  // Load communications ledger
  function loadCommunications() {
    if (!commLedgerContainer) return;
    
    fetch('/api/communications')
      .then(res => res.json())
      .then(comms => {
        commLedgerContainer.innerHTML = '';
        if (commLedgerCount) commLedgerCount.textContent = `${comms.length} Sent`;

        if (!comms || comms.length === 0) {
          commLedgerContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); font-style: italic; margin-top: 2rem;">No broadcasts sent yet. Use the dispatcher to send one!</p>';
          return;
        }

        // Sort descending by timestamp
        comms.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        comms.forEach(c => {
          const card = document.createElement('div');
          card.className = 'admin-question-row';
          card.style.flexDirection = 'column';
          card.style.alignItems = 'stretch';
          card.style.gap = '0.75rem';
          card.style.borderLeft = `5px solid ${getTemplateColor(c.template)}`;
          card.style.padding = '1.25rem';
          card.style.background = 'rgba(255,255,255,0.02)';
          card.style.borderRadius = 'var(--radius-md)';
          card.style.boxShadow = 'var(--shadow-sm)';

          const dateStr = new Date(c.timestamp).toLocaleString();
          const badgeText = getTemplateLabel(c.template);
          const badgeColor = getTemplateColor(c.template);

          card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.5rem; flex-wrap: wrap;">
              <div>
                <span class="badge" style="background: ${badgeColor}; color: white; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; margin-bottom: 0.35rem; display: inline-block;">${badgeText}</span>
                <h3 style="margin: 0.25rem 0; font-size: 1.1rem; color: var(--text-main); font-family: var(--font-family-display);">${escapeHtml(c.subject)}</h3>
                <div style="font-size: 0.8rem; color: var(--text-dim); display: flex; gap: 1rem; flex-wrap: wrap; margin-top: 0.25rem;">
                  <span><strong>From:</strong> ${escapeHtml(c.sender)} (${escapeHtml(c.senderRole)})</span>
                  <span><strong>To:</strong> ${escapeHtml(c.recipientName)} (${escapeHtml(c.recipientEmail)})</span>
                  <span><strong>Date:</strong> ${dateStr}</span>
                </div>
              </div>
              <div style="display: flex; gap: 0.5rem;">
                <a href="${c.htmlEmailPath}" target="_blank" class="btn btn-secondary" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; display: flex; align-items: center; gap: 0.3rem; text-decoration: none; border-radius: var(--radius-sm);">
                  <span>🔍</span> View Sent HTML
                </a>
                <button class="btn btn-secondary delete-comm-btn" data-id="${c.id}" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border-color: rgba(220,38,38,0.3); color: #ef4444; border-radius: var(--radius-sm);">
                  <span>🗑️</span> Delete
                </button>
              </div>
            </div>
            <div style="font-size: 0.85rem; color: var(--text-main); background: rgba(0,0,0,0.1); padding: 0.75rem; border-radius: 6px; white-space: pre-line; border: 1px solid rgba(255,255,255,0.05);">
              ${escapeHtml(c.body.substring(0, 180))}${c.body.length > 180 ? '...' : ''}
            </div>
          `;

          // Wire delete button
          card.querySelector('.delete-comm-btn').addEventListener('click', () => {
            if (confirm('Are you sure you want to delete this communication record? This will also remove the generated HTML file.')) {
              deleteCommunication(c.id);
            }
          });

          commLedgerContainer.appendChild(card);
        });
      })
      .catch(err => {
        console.error("Error loading communications:", err);
      });
  }

  function deleteCommunication(id) {
    fetch(`/api/communications/${id}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          showNotification('Communication record successfully deleted.');
          loadCommunications();
        } else {
          showNotification('Failed to delete communication record.', true);
        }
      })
      .catch(err => {
        console.error("Error deleting communication:", err);
        showNotification('Error communicating with server.', true);
      });
  }

  function getTemplateColor(tmpl) {
    switch (tmpl) {
      case 'security': return '#B91C1C'; // Crimson
      case 'synergy': return '#E98300'; // TE Orange
      case 'welcome': return '#244C5A'; // Dark Teal
      default: return '#4b5563'; // Charcoal
    }
  }

  function getTemplateLabel(tmpl) {
    switch (tmpl) {
      case 'security': return 'InfoSec Compliance';
      case 'synergy': return 'Values Synergy';
      case 'welcome': return 'Welcome Announcement';
      default: return 'System Notice';
    }
  }

  function showNotification(msg, isError = false) {
    const banner = document.createElement('div');
    banner.className = 'announcement-banner';
    banner.style.cssText = `position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%) translateY(-20px); opacity: 0; background: ${isError ? '#B91C1C' : 'var(--te-dark-teal)'}; color: var(--text-light); border-left: 4px solid var(--te-orange); padding: 0.75rem 1.5rem; border-radius: var(--radius-md); box-shadow: var(--shadow-lg); font-weight: 600; font-size: 0.9rem; z-index: 100000; transition: all 0.3s ease;`;
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
  // Expose toast for the course-CMS module (admin-cms.js)
  window.adminToast = showNotification;

  // --- Header Switcher Toggle click event inside Admin ---
  const switcherContainer = document.getElementById('demo-mode-switcher-container');
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

  // --- Edit Mode pill: unlocks system settings + inline survey editing ---
  const editModePill = document.getElementById('edit-mode-switcher-container');
  function syncEditModePill() {
    const isEditMode = localStorage.getItem('adminEditMode') === 'true';
    const indicator = document.getElementById('edit-switcher-indicator');
    const text = document.getElementById('edit-switcher-text');
    if (indicator) indicator.style.background = isEditMode ? '#10B981' : '#94a3b8';
    if (text) text.textContent = isEditMode ? 'EDIT MODE: ON' : 'EDIT MODE: OFF';
    document.body.classList.toggle('admin-edit-active', isEditMode);
  }
  if (editModePill) {
    editModePill.addEventListener('click', () => {
      const next = localStorage.getItem('adminEditMode') !== 'true';
      localStorage.setItem('adminEditMode', next ? 'true' : 'false');
      syncEditModePill();
      document.dispatchEvent(new CustomEvent('editModeChanged'));
    });
    syncEditModePill();
  }

  // --- Demo Role Visibility & Feature Toggles ---
  const roleVisibilityForm = document.getElementById('role-visibility-form');

  function loadRoleVisibility() {
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        const rv = settings.roleVisibility || {};
        const setChk = (id, val) => {
          const el = document.getElementById(id);
          if (el) el.checked = val !== false;
        };
        setChk('rv-pmo', rv.pmo);
        setChk('rv-hrbp', rv.hrbp);
        setChk('rv-supporting', rv.supporting);
        setChk('rv-employee', rv.employee);
        setChk('rv-leaders', rv.leaders);
        setChk('rv-admin', rv.admin);
        const tedChk = document.getElementById('ted-game-enabled');
        if (tedChk) tedChk.checked = settings.doomGloballyEnabled !== false;
        const tedXp = document.getElementById('ted-unlock-xp');
        if (tedXp) tedXp.value = settings.doomUnlockXp !== undefined ? settings.doomUnlockXp : 220;
        const quickNavChk = document.getElementById('rv-floating-menu');
        if (quickNavChk) quickNavChk.checked = settings.floatingMenuEnabled !== false;
      })
      .catch(err => console.error("Error loading role visibility settings:", err));
  }

  if (roleVisibilityForm) {
    roleVisibilityForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const payload = {
        roleVisibility: {
          pmo: document.getElementById('rv-pmo').checked,
          hrbp: document.getElementById('rv-hrbp').checked,
          supporting: document.getElementById('rv-supporting').checked,
          employee: document.getElementById('rv-employee').checked,
          leaders: document.getElementById('rv-leaders').checked,
          admin: document.getElementById('rv-admin').checked
        },
        doomGloballyEnabled: document.getElementById('ted-game-enabled').checked,
        doomUnlockXp: parseInt(document.getElementById('ted-unlock-xp').value, 10) || 220,
        floatingMenuEnabled: document.getElementById('rv-floating-menu').checked
      };
      fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            showNotification('✅ Demo visibility configuration saved.');
          } else {
            showNotification('Error saving visibility settings.', true);
          }
        })
        .catch(() => showNotification('Error saving visibility settings.', true));
    });
  }

  // --- Reset Custom M&A button event listener ---
  const btnResetCustomMa = document.getElementById('btn-reset-custom-ma');
  if (btnResetCustomMa) {
    btnResetCustomMa.addEventListener('click', () => {
      if (!confirm("Are you sure you want to completely clear and reset your Custom M&A workspace? This will delete all custom employees, roadmaps, and registered Integration Leaders.")) return;
      
      fetch('/api/settings/new-ma', {
        method: 'POST'
      })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          alert("Custom M&A workspace cleared successfully! You will now be redirected to the PMO Integration Wizard.");
          window.location.href = '/';
        } else {
          alert("Error clearing workspace.");
        }
      })
      .catch(err => {
        console.error("Error clearing custom M&A workspace:", err);
        alert("Failed to connect to the server.");
      });
    });
  }

  // ==========================================
  // DATABASE MIGRATION & CLOUD DEPLOYMENT PORTAL HANDLERS
  // ==========================================
  const migProviderSelect = document.getElementById('mig-db-provider');
  const migSubforms = document.querySelectorAll('.mig-subform');
  const dbMigrationForm = document.getElementById('db-migration-form');
  const btnMigrateDatabase = document.getElementById('btn-migrate-database');
  const migProgressPanel = document.getElementById('migration-progress-panel');
  const migProgressFill = document.getElementById('migration-progress-fill');
  const migProgressChecklist = document.getElementById('migration-progress-checklist');
  const migSchemaContainer = document.getElementById('migration-schema-output-container');
  const migSchemaBlock = document.getElementById('compiled-sql-schema-block');
  const btnCopySqlSchema = document.getElementById('btn-copy-sql-schema');

  // Toggle visible credential subforms dynamically based on provider
  if (migProviderSelect) {
    migProviderSelect.addEventListener('change', (e) => {
      const selected = e.target.value;
      
      // Hide all subforms
      migSubforms.forEach(sub => {
        sub.style.display = 'none';
        // Remove required attribute from all nested inputs to prevent blockages
        sub.querySelectorAll('input').forEach(input => {
          input.removeAttribute('required');
        });
      });

      // Show the selected subform and apply required attribute to its relevant fields
      if (selected === 'supabase') {
        const sub = document.getElementById('mig-subform-supabase');
        if (sub) {
          sub.style.display = 'flex';
          sub.querySelectorAll('input').forEach(input => {
            input.setAttribute('required', 'true');
          });
        }
      } else if (selected === 'azure') {
        const sub = document.getElementById('mig-subform-azure');
        if (sub) {
          sub.style.display = 'flex';
          sub.querySelectorAll('input').forEach(input => {
            input.setAttribute('required', 'true');
          });
        }
      } else if (selected === 'aws' || selected === 'sql') {
        const sub = document.getElementById('mig-subform-generic');
        if (sub) {
          sub.style.display = 'flex';
          sub.querySelectorAll('input').forEach(input => {
            input.setAttribute('required', 'true');
          });
        }
      }
    });
  }

  // Handle Cloud Database Migration submission
  if (dbMigrationForm) {
    dbMigrationForm.addEventListener('submit', (e) => {
      e.preventDefault();

      const provider = migProviderSelect.value;
      const connectionDetails = {};

      // Gather credentials based on active subform
      if (provider === 'supabase') {
        connectionDetails.url = document.getElementById('mig-sup-url').value.trim();
        connectionDetails.key = document.getElementById('mig-sup-key').value.trim();
      } else if (provider === 'azure') {
        connectionDetails.connectionString = document.getElementById('mig-az-conn').value.trim();
      } else if (provider === 'aws' || provider === 'sql') {
        connectionDetails.host = document.getElementById('mig-gen-host').value.trim();
        connectionDetails.port = parseInt(document.getElementById('mig-gen-port').value, 10) || 5432;
        connectionDetails.dbname = document.getElementById('mig-gen-dbname').value.trim();
        connectionDetails.username = document.getElementById('mig-gen-user').value.trim();
        connectionDetails.password = document.getElementById('mig-gen-pass').value.trim();
      }

      // Deactivate form controls to prevent multiple submits
      btnMigrateDatabase.disabled = true;
      btnMigrateDatabase.innerHTML = `<span>⏳</span> Compiling Migration Script...`;

      // Visual progress setup
      if (migProgressPanel) {
        migProgressPanel.style.display = 'block';
      }
      if (migProgressFill) {
        migProgressFill.style.width = '0%';
        migProgressFill.style.backgroundColor = 'var(--te-orange)';
      }
      if (migProgressChecklist) {
        migProgressChecklist.innerHTML = '';
      }

      // Check off milestones dynamically
      const milestones = [
        { text: "🔒 SSL Connection handshake and authorization checks", start: 0, end: 20 },
        { text: "🔍 Dialect validation & schema permission analysis", start: 20, end: 40 },
        { text: "🧱 DDL execution - Creating relational table structures", start: 40, end: 60 },
        { text: "🌱 Converting JSON collections to SQL Relational rows", start: 60, end: 80 },
        { text: "🎉 Finalizing database upgrade & persisting credentials", start: 80, end: 100 }
      ];

      // Draw initial pending list
      milestones.forEach((m, idx) => {
        const div = document.createElement('div');
        div.id = `mig-step-${idx}`;
        div.style.display = 'flex';
        div.style.alignItems = 'center';
        div.style.gap = '0.5rem';
        div.style.color = 'var(--text-dim)';
        div.style.marginBottom = '0.35rem';
        div.innerHTML = `<span>⏳</span> <span>${m.text}</span>`;
        migProgressChecklist.appendChild(div);
      });

      let currentPercent = 0;
      let isApiComplete = false;
      let apiData = null;
      let apiError = null;

      // Fire off server-side database migration POST request
      fetch('/api/admin/migrate-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, connectionDetails })
      })
      .then(res => {
        if (!res.ok) throw new Error('Database migration request failed.');
        return res.json();
      })
      .then(data => {
        isApiComplete = true;
        apiData = data;
      })
      .catch(err => {
        isApiComplete = true;
        apiError = err.message || 'Unknown network error.';
      });

      // Animate progress bar with high-fidelity gate conditions
      const interval = setInterval(() => {
        if (apiError) {
          clearInterval(interval);
          if (migProgressFill) {
            migProgressFill.style.width = '100%';
            migProgressFill.style.backgroundColor = '#ef4444'; // Red error
          }
          const activeStepDiv = document.querySelector('[id^="mig-step-"]:not(.completed)');
          if (activeStepDiv) {
            activeStepDiv.innerHTML = `<span>❌</span> <span style="color: #ef4444;">Failed: ${apiError}</span>`;
          }
          btnMigrateDatabase.disabled = false;
          btnMigrateDatabase.innerHTML = `<span>⚡</span> Retry Database Migration`;
          return;
        }

        // Progress speed controls: fast in early stages, waits at 90% if API is slow
        if (currentPercent < 90) {
          currentPercent += Math.floor(Math.random() * 4) + 2; // Increments of 2-5%
          if (currentPercent > 90) currentPercent = 90;
        } else if (isApiComplete && apiData) {
          currentPercent += 5;
          if (currentPercent > 100) currentPercent = 100;
        }

        // Update progress bar width
        if (migProgressFill) {
          migProgressFill.style.width = `${currentPercent}%`;
        }

        // Update milestone states dynamically
        milestones.forEach((m, idx) => {
          const stepDiv = document.getElementById(`mig-step-${idx}`);
          if (stepDiv) {
            if (currentPercent >= m.end) {
              stepDiv.classList.add('completed');
              stepDiv.style.color = '#10B981'; // Green complete
              stepDiv.innerHTML = `<span>✅</span> <span>${m.text}</span>`;
            } else if (currentPercent >= m.start) {
              stepDiv.style.color = 'var(--te-dark-teal)'; // Active teal
              stepDiv.innerHTML = `<span>⚙️</span> <span style="font-weight: bold;">${m.text}...</span>`;
            }
          }
        });

        // Migration fully complete ceremony!
        if (currentPercent === 100 && isApiComplete && apiData) {
          clearInterval(interval);
          
          // Re-enable and show success badge
          btnMigrateDatabase.disabled = false;
          btnMigrateDatabase.style.background = '#10B981';
          btnMigrateDatabase.innerHTML = `<span>🎉</span> Database Migrated Successfully!`;

          // Trigger Premium Particle Confetti
          triggerMigConfetti();

          // Render schema outputs
          if (migSchemaContainer && migSchemaBlock) {
            migSchemaBlock.textContent = apiData.schema || '-- SQL Script';
            migSchemaContainer.style.display = 'block';
            migSchemaContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }

          // Force loadSettings to run to synchronize badges
          loadSettings();

          setTimeout(() => {
            btnMigrateDatabase.style.background = '';
            btnMigrateDatabase.innerHTML = `<span>⚡</span> Migrate &amp; Generate Relational Schema`;
          }, 4000);
        }
      }, 80);
    });
  }

  // Copy compiled schema to clipboard
  if (btnCopySqlSchema && migSchemaBlock) {
    btnCopySqlSchema.addEventListener('click', () => {
      navigator.clipboard.writeText(migSchemaBlock.textContent)
        .then(() => {
          const originalText = btnCopySqlSchema.textContent;
          btnCopySqlSchema.textContent = 'Copied! ✅';
          btnCopySqlSchema.style.background = '#10B981';
          btnCopySqlSchema.style.color = 'white';
          
          setTimeout(() => {
            btnCopySqlSchema.textContent = originalText;
            btnCopySqlSchema.style.background = '';
            btnCopySqlSchema.style.color = '';
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy schema:', err);
          alert('Could not copy schema script. Please select all and copy manually.');
        });
    });
  }

  // Confetti celebration bursting engine
  function triggerMigConfetti() {
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

    // Create 150 particles bursting from center-bottom
    for (let i = 0; i < 150; i++) {
      particles.push({
        x: window.innerWidth / 2,
        y: window.innerHeight - 50,
        vx: (Math.random() - 0.5) * 18,
        vy: -Math.random() * 22 - 6,
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

  // =====================================================================
  // CMS admin panels (Phase 2 shell — Courses live; others summarize live data)
  // =====================================================================
  const langLabel = (v) => (v && typeof v === 'object') ? (v.en || Object.values(v)[0] || '') : (v || '');

  function loadCoursesAdmin() {
    const wrap = document.getElementById('courses-admin-list');
    if (!wrap) return;
    fetch('/api/courses').then(r => r.json()).then(courses => {
      if (!courses || !courses.length) {
        wrap.innerHTML = '<p style="text-align:center; color:var(--text-dim); padding:1.5rem;">No courses yet.</p>';
        return;
      }
      wrap.innerHTML = '';
      courses.forEach(c => {
        const lessonCount = (c.modules || []).reduce((n, m) => n + (m.lessons || []).length, 0);
        const el = document.createElement('div');
        el.className = 'cms-course';
        const modulesHtml = (c.modules || []).map(m => {
          const lessons = (m.lessons || []).map(l => {
            const qn = (l.quiz && l.quiz.questions ? l.quiz.questions.length : 0);
            return `<div class="cms-lesson"><span>${escapeHtml(langLabel(l.title))}</span>
              <span class="meta"><span class="cms-xp">+${l.xp || 0} XP</span> · <span>${qn} quiz Q</span></span></div>`;
          }).join('');
          return `<div class="cms-module"><div class="cms-module-name">${escapeHtml(langLabel(m.title))}
            <span style="font-weight:600;color:var(--text-dim);font-size:0.7rem;">${(m.lessons||[]).length} lessons</span></div>${lessons}</div>`;
        }).join('');
        el.innerHTML = `
          <div class="cms-course-head">
            <div>
              <div class="cms-course-title">${escapeHtml(langLabel(c.title))}</div>
              <div style="font-size:0.76rem;color:var(--text-secondary);">${(c.modules||[]).length} modules · ${lessonCount} lessons · ${c.gating || 'soft'} gating${c.certificateOnComplete ? ' · certificate' : ''}</div>
            </div>
            <label class="admin-toggle" title="Published">
              <input type="checkbox" data-course-id="${c.id}" ${c.published ? 'checked' : ''}>
              <span class="track"></span><span class="thumb"></span>
            </label>
          </div>
          ${modulesHtml}`;
        wrap.appendChild(el);
        const toggle = el.querySelector('input[data-course-id]');
        toggle.addEventListener('change', () => {
          fetch('/api/courses', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: c.id, published: toggle.checked })
          }).then(r => r.json()).then(d => {
            if (d.success) showNotification(`Course ${toggle.checked ? 'published' : 'unpublished'}.`);
          }).catch(() => showNotification('Could not update course.', true));
        });
      });
    }).catch(() => { wrap.innerHTML = '<p style="text-align:center; color:#B91C1C; padding:1.5rem;">Failed to load courses.</p>'; });
  }

  function summaryRow(title, sub, pillText, pillClass) {
    return `<div class="cms-row"><div class="cms-row-main">
      <span class="cms-row-title">${escapeHtml(title)}</span>
      <span class="cms-row-sub">${escapeHtml(sub)}</span>
    </div><span class="cms-pill ${pillClass}">${escapeHtml(pillText)}</span></div>`;
  }

  function loadPagesAdmin() {
    const wrap = document.getElementById('pages-admin-list');
    if (!wrap) return;
    fetch('/api/pages').then(r => r.json()).then(pages => {
      wrap.innerHTML = (pages || []).map(p =>
        summaryRow(langLabel(p.title) || p.slug, `/${p.slug}` + (p.source ? ` · from ${p.source}` : ''),
          p.published ? 'Published' : 'Draft', p.published ? 'on' : 'off')
      ).join('') || '<p style="text-align:center;color:var(--text-dim);padding:1.5rem;">No pages.</p>';
    }).catch(() => {});
  }

  function loadTranslationsAdmin() {
    const wrap = document.getElementById('translations-admin-list');
    if (!wrap) return;
    fetch('/api/i18n').then(r => r.json()).then(d => {
      const langs = (d.languages || []).map(l => l.code);
      const strings = d.strings || {};
      const keys = Array.from(new Set(langs.flatMap(l => Object.keys(strings[l] || {})))).sort();
      const escA = (s) => String(s == null ? '' : s).replace(/"/g, '&quot;');
      const head = `<div class="cms-row" style="gap:0.6rem;"><strong style="flex:1;">${keys.length} keys · ${langs.length} languages</strong>
        <button type="button" class="cms-mini" id="i18n-add-key">+ Add key</button>
        <button type="button" class="btn btn-primary" id="i18n-save" style="width:auto;margin:0;padding:0.4rem 0.9rem;">Save all</button></div>`;
      const table = `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.82rem;">
        <thead><tr><th style="text-align:left;padding:0.4rem;color:var(--text-dim);">Key</th>${(d.languages||[]).map(l=>`<th style="text-align:left;padding:0.4rem;color:var(--text-dim);">${l.flag||''} ${l.code.toUpperCase()}</th>`).join('')}</tr></thead>
        <tbody>${keys.map(k => `<tr data-key="${escA(k)}"><td style="padding:0.35rem;font-family:monospace;font-size:0.75rem;color:var(--te-dark-teal);vertical-align:top;">${escA(k)}</td>
          ${langs.map(l => `<td style="padding:0.25rem;"><input class="form-control i18n-cell" data-lang="${l}" style="font-size:0.8rem;padding:0.3rem;margin:0;" value="${escA((strings[l]||{})[k])}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      wrap.innerHTML = head + table;
      wrap.querySelector('#i18n-add-key').addEventListener('click', () => {
        const key = prompt('New translation key (e.g. nav.about):');
        if (!key) return;
        const tbody = wrap.querySelector('tbody');
        const row = document.createElement('tr'); row.setAttribute('data-key', key);
        row.innerHTML = `<td style="padding:0.35rem;font-family:monospace;font-size:0.75rem;color:var(--te-dark-teal);">${escA(key)}</td>` +
          langs.map(l => `<td style="padding:0.25rem;"><input class="form-control i18n-cell" data-lang="${l}" style="font-size:0.8rem;padding:0.3rem;margin:0;" value=""></td>`).join('');
        tbody.appendChild(row);
      });
      wrap.querySelector('#i18n-save').addEventListener('click', () => {
        const payloadStrings = {}; langs.forEach(l => payloadStrings[l] = {});
        wrap.querySelectorAll('tbody tr').forEach(tr => {
          const k = tr.getAttribute('data-key');
          tr.querySelectorAll('.i18n-cell').forEach(inp => { payloadStrings[inp.getAttribute('data-lang')][k] = inp.value; });
        });
        fetch('/api/i18n', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strings: payloadStrings }) })
          .then(r => r.json()).then(res => { if (res.success) showNotification('✅ Translations saved.'); else showNotification('Save failed.', true); })
          .catch(() => showNotification('Save failed.', true));
      });
    }).catch(() => {});
  }

  function loadMenusAdmin() {
    const wrap = document.getElementById('menus-admin-list');
    if (!wrap) return;
    fetch('/api/menus').then(r => r.json()).then(m => {
      wrap.innerHTML = [
        summaryRow('Sidebar items', 'Left-navigation entries across the portal', `${(m.sidebar || []).length} items`, 'soon'),
        summaryRow('Menu groups', 'Portals · Resources · General', `${(m.groups || []).length} groups`, 'soon'),
        summaryRow('Landing role cards', 'Cards shown on the demo home page', `${(m.landingCards || []).length} cards`, 'soon')
      ].join('');
    }).catch(() => {});
  }

  function loadMediaAdmin() {
    const wrap = document.getElementById('media-admin-list');
    if (!wrap) return;
    fetch('/api/media').then(r => r.json()).then(items => {
      wrap.innerHTML = (items && items.length)
        ? items.map(m => summaryRow(m.fileName, m.kind, 'Uploaded', 'on')).join('')
        : '<p style="text-align:center;color:var(--text-dim);padding:1.5rem;">No media uploaded yet. Per-language welcome videos are configured under Settings.</p>';
    }).catch(() => {});
  }

  // Reflect demo/custom mode in the topbar badge
  function syncTopbarMode() {
    const badge = document.getElementById('admin-topbar-mode');
    if (!badge) return;
    fetch('/api/settings').then(r => r.json()).then(s => {
      badge.textContent = s.demoMode === false ? 'CUSTOM M&A' : 'DEMO';
    }).catch(() => {});
  }

  // --- Initial runs ---
  loadSettings();
  loadQuestions();
  loadAssessmentsHistory();
  loadModules();
  loadEmployees();
  loadHrbps();
  loadAlerts();
  loadPmoDiagnostics();
  loadCommunications();
  loadRoleVisibility();
  // Courses panel is owned by admin-cms.js (full editor); loadCoursesAdmin() no longer called.
  // Pages panel is owned by admin-cms.js (editor); loadPagesAdmin() no longer called.
  loadTranslationsAdmin();
  // Menus panel is owned by admin-cms.js (full editor); loadMenusAdmin() no longer called.
  loadMediaAdmin();
  syncTopbarMode();
});
