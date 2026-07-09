/**
 * TE Connectivity M&A Integration Portal - app.js
 * Controls multi-step assessment survey flow, question rendering, and submission states.
 */

document.addEventListener('DOMContentLoaded', () => {
  const targetCompanyEl = document.getElementById('target-company-name');
  const questionsContainer = document.getElementById('questions-container');
  const stepIndicator = document.getElementById('step-indicator');
  const progressBar = document.getElementById('progress-bar');
  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  
  // Loading overlay elements
  const loadingOverlay = document.getElementById('loading-overlay');
  const loadingTitle = document.getElementById('loading-title');
  const loadingDesc = document.getElementById('loading-desc');

  let currentStep = 0;
  let questionsByDimension = { culture: [], talent: [], value: [] };
  let dimensionsOrder = ['culture', 'talent', 'value'];
  let responses = {}; // Stores chosen rating for each question ID: { q1: 4 }

  // 1. Fetch Target Company Settings
  fetch('/api/settings')
    .then(res => res.json())
    .then(settings => {
      const company = settings.targetCompany || "NextGen Sensors Ltd.";
      const sector = settings.sector || "Sensors & Controls";
      const size = settings.size || "140 Employees";
      const hq = settings.hq || "Munich, Germany";
      const closingDate = settings.acquisitionDate || "May 20, 2026";
      const objective = settings.synergyObjective || "Expand autonomous driving sensor catalog & unify design workflows.";

      // Sidebar target details
      if (targetCompanyEl) targetCompanyEl.textContent = company;
      document.getElementById('target-sector').textContent = sector;
      document.getElementById('target-size').textContent = size;
      document.getElementById('target-hq').textContent = hq;
      document.getElementById('target-closing-date').textContent = closingDate;
      document.getElementById('target-objective').textContent = objective;

      // Central Assessment Context Banner details
      const surveyTitleEl = document.getElementById('survey-target-title');
      if (surveyTitleEl) surveyTitleEl.textContent = company;
      const surveySectorEl = document.getElementById('survey-target-sector-inline');
      if (surveySectorEl) surveySectorEl.textContent = sector;
      const surveySizeEl = document.getElementById('survey-target-size-inline');
      if (surveySizeEl) surveySizeEl.textContent = size;
      const surveyHqEl = document.getElementById('survey-target-hq-inline');
      if (surveyHqEl) surveyHqEl.textContent = hq;
      const surveyDateEl = document.getElementById('survey-target-date-inline');
      if (surveyDateEl) surveyDateEl.textContent = closingDate;
    })
    .catch(err => console.error("Error loading settings:", err));

  // 2. Fetch and Group Survey Questions
  let rawQuestions = [];
  const chkLocalHr = document.getElementById('chk-local-hr-exists');

  function rebuildQuestions() {
    questionsByDimension = { culture: [], talent: [], value: [] };
    const includeLocalHr = chkLocalHr ? chkLocalHr.checked : true;

    rawQuestions.forEach(q => {
      if (q.id === 'q10' && !includeLocalHr) {
        return; // skip q10 if local HR is not moving over
      }
      if (responses[q.id] === undefined) {
        responses[q.id] = 3.0;
      }
      if (questionsByDimension[q.dimension]) {
        questionsByDimension[q.dimension].push(q);
      } else {
        questionsByDimension[q.dimension] = [q];
      }
    });

    renderSurvey();
  }

  if (chkLocalHr) {
    chkLocalHr.addEventListener('change', rebuildQuestions);
  }

  fetch('/api/questions')
    .then(res => res.json())
    .then(questions => {
      if (!questions || questions.length === 0) {
        questionsContainer.innerHTML = '<p style="text-align: center; padding: 2rem;">No questions configured. Visit the Admin Settings to add questions.</p>';
        btnNext.disabled = true;
        return;
      }
      rawQuestions = questions;
      rebuildQuestions();
    })
    .catch(err => {
      console.error("Error loading questions:", err);
      questionsContainer.innerHTML = '<p style="text-align: center; color: var(--status-danger);">Failed to load survey questions. Make sure the local server is running.</p>';
    });

  // Slider State Helper
  function getSliderStatus(val) {
    const v = parseFloat(val);
    if (v <= 1.8) return { label: 'Critical Risk', color: '#EF4444' };
    if (v <= 2.8) return { label: 'Friction Area', color: '#F97316' };
    if (v <= 3.8) return { label: 'Moderate Gap', color: '#E98300' };
    if (v <= 4.7) return { label: 'Aligned', color: '#0D9488' };
    return { label: 'Excellent', color: '#10B981' };
  }

  function updateSliderDisplay(val, sliderInput, tooltipEl) {
    const status = getSliderStatus(val);
    tooltipEl.textContent = `${parseFloat(val).toFixed(1)} - ${status.label}`;
    
    // Color shift gradient calculation
    const pct = ((parseFloat(val) - 1.0) / 4.0) * 100;
    sliderInput.style.setProperty('--slider-color', status.color);
    sliderInput.style.setProperty('--slider-percent', `${pct}%`);
  }

  // 3. Render Survey Dimensions
  function renderSurvey() {
    questionsContainer.innerHTML = '';
    
    dimensionsOrder.forEach((dim, dimIdx) => {
      const stepDiv = document.createElement('div');
      stepDiv.className = `survey-step ${dimIdx === currentStep ? 'active' : ''}`;
      stepDiv.id = `step-${dim}`;

      const dimTitle = document.createElement('h4');
      dimTitle.style.marginBottom = '1.5rem';
      dimTitle.style.color = 'var(--te-dark-teal)';
      dimTitle.style.textTransform = 'uppercase';
      dimTitle.style.letterSpacing = '0.05em';
      dimTitle.textContent = `${dim} Diagnostics`;
      stepDiv.appendChild(dimTitle);

      const list = questionsByDimension[dim];
      if (!list || list.length === 0) {
        const fallbackMsg = document.createElement('p');
        fallbackMsg.style.color = 'var(--text-secondary)';
        fallbackMsg.textContent = 'No questions pre-configured for this dimension.';
        stepDiv.appendChild(fallbackMsg);
      } else {
        list.forEach(q => {
          const qBox = document.createElement('div');
          qBox.className = 'survey-question-box';

          const qText = document.createElement('div');
          qText.className = 'survey-question-text';
          qText.textContent = q.text;
          qBox.appendChild(qText);

          // Slider wrapper
          const sliderWrapper = document.createElement('div');
          sliderWrapper.className = 'slider-wrapper';

          // Tooltip showing live value
          const tooltip = document.createElement('div');
          tooltip.className = 'slider-tooltip';
          
          const slider = document.createElement('input');
          slider.type = 'range';
          slider.className = 'visual-range-slider';
          slider.min = '1.0';
          slider.max = '5.0';
          slider.step = '0.1';
          slider.value = responses[q.id] || '3.0';

          // Update display initially
          updateSliderDisplay(slider.value, slider, tooltip);

          // Event listener on drag
          slider.addEventListener('input', (e) => {
            responses[q.id] = parseFloat(e.target.value);
            updateSliderDisplay(e.target.value, slider, tooltip);
            validateStepCompletion();
          });

          // Tick marks container
          const ticksDiv = document.createElement('div');
          ticksDiv.className = 'slider-ticks';

          const ticks = [
            { val: 1.0, label: 'Critical' },
            { val: 2.0, label: 'Friction' },
            { val: 3.0, label: 'Moderate' },
            { val: 4.0, label: 'Aligned' },
            { val: 5.0, label: 'Excellent' }
          ];

          ticks.forEach(t => {
            const tick = document.createElement('span');
            tick.className = 'slider-tick';
            if (Math.abs(parseFloat(slider.value) - t.val) < 0.05) {
              tick.classList.add('active');
            }
            tick.innerHTML = `<span class="tick-number">${t.val.toFixed(0)}</span><span class="tick-label">${t.label}</span>`;
            
            // Clicking a tick snaps the slider to that value
            tick.addEventListener('click', () => {
              slider.value = t.val.toFixed(1);
              responses[q.id] = t.val;
              updateSliderDisplay(slider.value, slider, tooltip);
              
              // Update active class on ticks
              ticksDiv.querySelectorAll('.slider-tick').forEach(st => st.classList.remove('active'));
              tick.classList.add('active');
              
              validateStepCompletion();
            });

            ticksDiv.appendChild(tick);
          });

          // Highlight closest tick on slider drag
          slider.addEventListener('input', () => {
            const currentVal = parseFloat(slider.value);
            ticksDiv.querySelectorAll('.slider-tick').forEach((st, idx) => {
              const tickVal = ticks[idx].val;
              if (Math.abs(currentVal - tickVal) <= 0.5) {
                ticksDiv.querySelectorAll('.slider-tick').forEach(s => s.classList.remove('active'));
                st.classList.add('active');
              }
            });
          });

          sliderWrapper.appendChild(tooltip);
          sliderWrapper.appendChild(slider);
          sliderWrapper.appendChild(ticksDiv);
          qBox.appendChild(sliderWrapper);
          stepDiv.appendChild(qBox);
        });
      }

      questionsContainer.appendChild(stepDiv);
    });

    updateUI();
  }

  // 4. Update Progress Bar and Buttons
  function updateUI() {
    // Indicator text
    const activeDim = dimensionsOrder[currentStep];
    stepIndicator.textContent = `${activeDim.charAt(0).toUpperCase() + activeDim.slice(1)} (${currentStep + 1}/${dimensionsOrder.length})`;
    
    // Progress Fill
    const pct = ((currentStep) / dimensionsOrder.length) * 100;
    progressBar.style.width = `${pct}%`;

    // Navigation buttons disabled state
    btnPrev.disabled = currentStep === 0;
    
    // If on the last step, rename "Next" button to "Submit"
    if (currentStep === dimensionsOrder.length - 1) {
      btnNext.textContent = 'Compile Integration Plan';
      btnNext.classList.add('btn-dark');
    } else {
      btnNext.textContent = 'Next';
      btnNext.classList.remove('btn-dark');
    }

    validateStepCompletion();
  }

  // Helper: Verify if all questions in the active step are answered
  function validateStepCompletion() {
    const activeDim = dimensionsOrder[currentStep];
    const list = questionsByDimension[activeDim] || [];
    
    let allAnswered = true;
    list.forEach(q => {
      if (responses[q.id] === undefined) {
        allAnswered = false;
      }
    });

    // Disable Next if not fully answered
    btnNext.disabled = !allAnswered;
  }

  // 5. Navigation Click Handlers
  btnNext.addEventListener('click', () => {
    if (currentStep < dimensionsOrder.length - 1) {
      // Move to next step
      currentStep++;
      renderSurvey();
    } else {
      // Submit assessment survey!
      submitAssessment();
    }
  });

  btnPrev.addEventListener('click', () => {
    if (currentStep > 0) {
      currentStep--;
      renderSurvey();
    }
  });

  // 6. Submit Assessment and show high-end processing screens
  function submitAssessment() {
    // Show Loading Overlay
    loadingOverlay.style.display = 'flex';
    
    const pBar = document.getElementById('analysis-progress-bar');
    const pPercent = document.getElementById('analysis-progress-percent');
    
    const chkCulture = document.getElementById('chk-culture');
    const chkTalent = document.getElementById('chk-talent');
    const chkValue = document.getElementById('chk-value');
    const chkRoadmap = document.getElementById('chk-roadmap');
    const chkCoaching = document.getElementById('chk-coaching');

    // Steps configuration for a smooth 10 seconds total progress
    const steps = [
      { element: chkCulture, start: 0, end: 20, desc: "Processing cultural integration matrices & leadership alignments..." },
      { element: chkTalent, start: 20, end: 40, desc: "Calculating key talent retention indexes & mapping competencies..." },
      { element: chkValue, start: 40, end: 60, desc: "Validating growth drivers, R&D patent overlaps & supply chains..." },
      { element: chkRoadmap, start: 60, end: 80, desc: "Assembling first 100 days action tasks & setting up milestones..." },
      { element: chkCoaching, start: 80, end: 100, desc: "Deploying TEodor duck interactive coaching and playbook guides..." }
    ];

    let currentPercent = 0;
    const duration = 10000; // 10 seconds
    const intervalTime = 100; // update progress every 100ms
    const stepCount = duration / intervalTime;
    const increment = 100 / stepCount;

    // Call submit endpoint immediately so it starts background calculation
    const submissionPromise = fetch('/api/assessment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ responses })
    }).then(res => res.json());

    const timer = setInterval(() => {
      currentPercent += increment;
      if (currentPercent > 100) currentPercent = 100;
      
      // Update progress bar UI
      if (pBar) pBar.style.width = `${currentPercent}%`;
      if (pPercent) pPercent.textContent = `${Math.round(currentPercent)}%`;

      // Update checklist states
      steps.forEach((step, idx) => {
        if (currentPercent >= step.end) {
          if (step.element && (step.element.classList.contains('active') || step.element.classList.contains('pending'))) {
            step.element.classList.remove('pending', 'active');
            step.element.classList.add('complete');
            step.element.querySelector('.chk-status-icon').textContent = '✅';
          }
        } else if (currentPercent >= step.start) {
          if (step.element && step.element.classList.contains('pending')) {
            step.element.classList.remove('pending');
            step.element.classList.add('active');
            step.element.querySelector('.chk-status-icon').textContent = '⚡';
            loadingDesc.textContent = step.desc;
          }
        }
      });

      if (currentPercent >= 100) {
        clearInterval(timer);
        
        // Wait for both the 10s animation to complete and the API submission
        submissionPromise
          .then(data => {
            if (data.success) {
              loadingTitle.textContent = "Synergy Plan Built!";
              loadingDesc.textContent = "Routing to your Post-Merger Integration Command Center...";
              
              setTimeout(() => {
                document.body.classList.remove('page-loaded');
                document.body.classList.add('page-exiting');
                setTimeout(() => {
                  window.location.href = '/dashboard.html';
                }, 280);
              }, 800);
            } else {
              alert("Error submitting assessment: " + data.error);
              loadingOverlay.style.display = 'none';
            }
          })
          .catch(err => {
            console.error("API submission failed:", err);
            alert("Error connecting to server. Plan could not be compiled.");
            loadingOverlay.style.display = 'none';
          });
      }
    }, intervalTime);
  }

  // --- 4. Edit Mode Integration for Survey Page ---
  function syncSurveyEditMode() {
    const isEditMode = localStorage.getItem('adminEditMode') === 'true';
    
    // Target Context Banner
    const targetBanner = document.querySelector('.target-context-banner');
    if (targetBanner) {
      if (isEditMode) {
        targetBanner.classList.add('edit-active-border');
        if (!targetBanner.querySelector('.edit-pen-icon')) {
          const pen = document.createElement('div');
          pen.className = 'edit-pen-icon';
          pen.title = 'Edit Acquired Company Data';
          pen.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>`;
          pen.addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.href = '/admin.html'; // Redirect to Admin Control Center
          });
          targetBanner.appendChild(pen);
        }
      } else {
        targetBanner.classList.remove('edit-active-border');
        const pen = targetBanner.querySelector('.edit-pen-icon');
        if (pen) pen.remove();
      }
    }

    // Survey Card
    const surveyCard = document.getElementById('survey-widget');
    if (surveyCard) {
      if (isEditMode) {
        surveyCard.classList.add('edit-active-border');
        if (!surveyCard.querySelector('.edit-pen-icon')) {
          const pen = document.createElement('div');
          pen.className = 'edit-pen-icon';
          pen.title = 'Manage & Reorder Survey Questions';
          pen.innerHTML = `<svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" /></svg>`;
          pen.addEventListener('click', (e) => {
            e.stopPropagation();
            window.location.href = '/admin.html'; // Redirect to Admin Control Center
          });
          surveyCard.appendChild(pen);
        }
      } else {
        surveyCard.classList.remove('edit-active-border');
        const pen = surveyCard.querySelector('.edit-pen-icon');
        if (pen) pen.remove();
      }
    }
  }

  document.addEventListener('editModeChanged', syncSurveyEditMode);
  // Execute sync on load
  setTimeout(syncSurveyEditMode, 150);
});
