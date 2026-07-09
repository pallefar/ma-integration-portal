/**
 * TE Connectivity M&A Integration Portal - leaders.js
 * Controls leader dashboard metrics calculation, checklist state storage, direct reports listings,
 * and the interactive Buddy chat simulator.
 */

document.addEventListener('DOMContentLoaded', () => {
  const reportsContainer = document.getElementById('direct-reports-roster');
  const progressCircleFill = document.getElementById('progress-circle-fill');
  const progressCirclePercent = document.getElementById('progress-circle-percent');
  const teamMeritPointsEl = document.getElementById('team-merit-points');
  const leaderIdentityTag = document.getElementById('leader-identity-tag');
  
  const buddyAvatar = document.getElementById('buddy-avatar');
  const buddyNameEl = document.getElementById('buddy-name');
  const buddyRoleEl = document.getElementById('buddy-role');
  const buddyEmailEl = document.getElementById('buddy-email');
  
  const chatMessages = document.getElementById('buddy-chat-messages');
  const chatForm = document.getElementById('buddy-chat-form');
  const chatInput = document.getElementById('buddy-chat-input');
  const chatTyping = document.getElementById('buddy-chat-typing');

  let activeLeader = null;
  let allEmployees = [];

  // 1. Fetch Employees and resolve leader context
  function loadLeaderDashboard() {
    fetch('/api/employees')
      .then(res => res.json())
      .then(employees => {
        allEmployees = employees;
        
        // Find an active leader. If none is marked in localStorage, default to Emma Watson (emp_3)
        const cachedLeaderId = localStorage.getItem('activeLeaderId') || 'emp_3';
        activeLeader = employees.find(e => e.id === cachedLeaderId && e.isLeader);
        
        if (!activeLeader) {
          // Fallback to first leader in list
          activeLeader = employees.find(e => e.isLeader) || {
            id: 'emp_3',
            name: "Emma Watson",
            role: "Finance Operations Manager",
            isLeader: true,
            leaderRole: "Local HR",
            buddyName: "Sarah Connor",
            buddyEmail: "sconnor@te.com"
          };
        }

        // Set leader identity header
        if (leaderIdentityTag) {
          leaderIdentityTag.textContent = `${activeLeader.name.toUpperCase()} (${activeLeader.leaderRole || 'Acquired Leader'})`;
        }

        // Configure Buddy details
        if (buddyNameEl) buddyNameEl.textContent = activeLeader.buddyName || 'Sarah Connor';
        if (buddyEmailEl) {
          buddyEmailEl.textContent = activeLeader.buddyEmail || 'sconnor@te.com';
          buddyEmailEl.href = `mailto:${activeLeader.buddyEmail || 'sconnor@te.com'}`;
        }
        if (buddyAvatar) {
          const initials = (activeLeader.buddyName || 'Sarah Connor').split(' ').map(n => n[0]).join('');
          buddyAvatar.textContent = initials.toUpperCase();
        }

        // Render Direct Reports Roster (exclude active leader and other leaders for a clean site list)
        const teamMembers = employees.filter(e => !e.isLeader);
        renderDirectReports(teamMembers);

        // Restore checklist items
        restoreChecklist(activeLeader.id);
      })
      .catch(err => {
        console.error("Error loading leadership stats:", err);
        if (reportsContainer) {
          reportsContainer.innerHTML = '<p style="text-align: center; color: var(--status-danger);">Failed to connect with acquired staff roster.</p>';
        }
      });
  }

  // 2. Render direct reports and calculate aggregate site team progress
  function renderDirectReports(team) {
    if (!reportsContainer) return;
    reportsContainer.innerHTML = '';

    if (team.length === 0) {
      reportsContainer.innerHTML = '<p style="text-align: center; color: var(--text-dim); padding: 1.5rem;">No direct reports registered for this plant site.</p>';
      return;
    }

    let totalLessonsCompleted = 0;
    let totalPoints = 0;
    const maxLessonsPerEmployee = 9;

    team.forEach(emp => {
      const completed = emp.completedLessons ? emp.completedLessons.length : 0;
      totalLessonsCompleted += completed;
      totalPoints += emp.points || 0;

      const pct = Math.round((completed / maxLessonsPerEmployee) * 100);

      const row = document.createElement('div');
      row.className = 'card';
      row.style.cssText = 'padding: 0.85rem 1.25rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; background: white; border: 1px solid rgba(0,0,0,0.04); transition: transform 0.2s;';
      
      row.addEventListener('mouseenter', () => row.style.transform = 'translateX(5px)');
      row.addEventListener('mouseleave', () => row.style.transform = 'translateX(0)');

      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 38px; height: 38px; background: rgba(36,76,90,0.06); border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 800; color: var(--te-dark-teal);">
            ${emp.name[0]}
          </div>
          <div>
            <h5 style="margin: 0; color: var(--te-dark-teal); font-family: var(--font-family-display); font-size: 0.9rem;">${emp.name}</h5>
            <p style="margin: 0.15rem 0 0 0; font-size: 0.75rem; color: var(--text-secondary);">${emp.role} &bull; <strong style="color:var(--te-orange);">${emp.points || 0} XP</strong></p>
          </div>
        </div>
        
        <div style="text-align: right; min-width: 120px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.75rem; margin-bottom: 0.25rem;">
            <span style="color: var(--text-dim);">Academy:</span>
            <span style="font-weight: 700; color: var(--te-dark-teal);">${pct}%</span>
          </div>
          <div style="background: #E2E8F0; height: 6px; border-radius: 3px; overflow: hidden; width: 100%;">
            <div style="background: var(--te-dark-teal); height: 100%; width: ${pct}%;"></div>
          </div>
        </div>
      `;

      reportsContainer.appendChild(row);
    });

    // Update dynamic team circle ring average
    const maxPossibleLessons = team.length * maxLessonsPerEmployee;
    const avgProgressPct = maxPossibleLessons > 0 ? Math.round((totalLessonsCompleted / maxPossibleLessons) * 100) : 0;
    
    if (progressCirclePercent) progressCirclePercent.textContent = `${avgProgressPct}%`;
    if (progressCircleFill) {
      // Stroke-dasharray format: "dash, gap". Circumference is 100
      progressCircleFill.setAttribute('stroke-dasharray', `${avgProgressPct}, 100`);
    }

    if (teamMeritPointsEl) {
      teamMeritPointsEl.textContent = totalPoints;
    }
  }

  // 3. Leadership checklist state save/restore
  function restoreChecklist(leaderId) {
    const checklist = document.getElementById('leader-checklist-container');
    if (!checklist) return;

    const checkboxes = checklist.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(chk => {
      const savedState = localStorage.getItem(`te_leader_checklist_${leaderId}_${chk.id}`);
      chk.checked = savedState === 'true';

      chk.addEventListener('change', () => {
        localStorage.setItem(`te_leader_checklist_${leaderId}_${chk.id}`, chk.checked);
        
        // Add subtle animation check effect
        const label = checklist.querySelector(`label[for="${chk.id}"]`);
        if (label) {
          if (chk.checked) {
            label.style.textDecoration = 'line-through';
            label.style.opacity = '0.6';
          } else {
            label.style.textDecoration = 'none';
            label.style.opacity = '1';
          }
        }
      });

      // Initial visual trigger
      const label = checklist.querySelector(`label[for="${chk.id}"]`);
      if (label) {
        if (chk.checked) {
          label.style.textDecoration = 'line-through';
          label.style.opacity = '0.6';
        }
      }
    });
  }

  // 4. Buddy Chat Box Simulator
  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const text = chatInput.value.trim();
      if (!text) return;

      // Add user message bubble
      appendMessageBubble('user', text);
      chatInput.value = '';

      // Auto scroll
      chatMessages.scrollTop = chatMessages.scrollHeight;

      // Trigger typing indicator and reply
      triggerBuddyResponse(text);
    });
  }

  function appendMessageBubble(sender, text) {
    const bubble = document.createElement('div');
    bubble.style.display = 'flex';
    bubble.style.gap = '0.5rem';
    bubble.style.maxWidth = '85%';
    
    if (sender === 'user') {
      bubble.style.alignSelf = 'flex-end';
      bubble.style.flexDirection = 'row-reverse';
      bubble.innerHTML = `
        <div style="width: 28px; height: 28px; background: var(--te-dark-teal); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 0.7rem; flex-shrink: 0;">ME</div>
        <div style="background: var(--te-dark-teal); color: white; border-radius: 10px 0 10px 10px; padding: 0.55rem 0.75rem; line-height: 1.4;">
          ${escapeHtml(text)}
        </div>
      `;
    } else {
      bubble.style.alignSelf = 'flex-start';
      const buddyInitials = buddyNameEl ? buddyNameEl.textContent.split(' ').map(n => n[0]).join('') : 'SC';
      bubble.innerHTML = `
        <div style="width: 28px; height: 28px; background: var(--te-orange); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 0.7rem; flex-shrink: 0;">${buddyInitials}</div>
        <div style="background: white; border: 1px solid var(--border-color); border-radius: 0 10px 10px 10px; padding: 0.55rem 0.75rem; color: var(--text-primary); line-height: 1.4; box-shadow: var(--shadow-sm);">
          ${text}
        </div>
      `;
    }

    chatMessages.appendChild(bubble);
  }

  function triggerBuddyResponse(msg) {
    const textLower = msg.toLowerCase();
    let reply = "";

    // Simulated Smart Responses
    if (textLower.includes('payroll') || textLower.includes('salary') || textLower.includes('pay')) {
      reply = "The payroll conversion is scheduled for Day 30 (June 15). All employee bank accounts and salary bands will carry over smoothly. David Miller from the Comp & Benefits team is reviewing all folders today.";
    } else if (textLower.includes('town hall') || textLower.includes('meeting') || textLower.includes('townhall')) {
      reply = "The Chapter 1 Cultural Town Hall is set for May 25 at 10:00 CET on MS Teams. We've compiled welcome slides and transition guides for site managers. I'll email you the slide deck template.";
    } else if (textLower.includes('sso') || textLower.includes('it') || textLower.includes('account') || textLower.includes('system')) {
      reply = "All SSO accounts are mapped dynamically. Acquired employees will receive an automated migration email once corporate verification finishes. Check the IT Checklist in the Playbook for steps.";
    } else if (textLower.includes('hello') || textLower.includes('hi') || textLower.includes('hey')) {
      reply = `Great to hear from you! How is the local site team adjusting to the TE integration timeline? Let me know if you need specific resources or a quick video call.`;
    } else {
      reply = `Got it! I will check that with the Post-Merger Integration Office (IMO) and report back to you shortly. Don't forget that the M&A Playbook (playbook.html) has templates covering most structural tracks.`;
    }

    // Show Typing Indicator
    if (chatTyping) {
      chatTyping.style.display = 'block';
      const buddyName = buddyNameEl ? buddyNameEl.textContent : 'Sarah';
      chatTyping.textContent = `${buddyName} is typing...`;
    }
    chatMessages.scrollTop = chatMessages.scrollHeight;

    setTimeout(() => {
      if (chatTyping) chatTyping.style.display = 'none';
      appendMessageBubble('buddy', reply);
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 1800);
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Load dashboard
  loadLeaderDashboard();
});
