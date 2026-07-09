/**
 * TE Connectivity M&A Integration Portal - signage.js
 * Controls the digital plant screens signage displays.
 * Performs ticking clocks, integration event calendars, milestones dashboard, announcements slides,
 * and pulling real-time team stats for the lobby leaderboard.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const clockEl = document.getElementById('signage-clock');
  const dateEl = document.getElementById('signage-date');
  const timelineDayText = document.getElementById('signage-timeline-day-text');
  const timelineBarFill = document.getElementById('signage-timeline-bar-fill');
  const completionRateEl = document.getElementById('signage-completion-rate');
  const teamXpEl = document.getElementById('signage-team-xp');
  
  const todayEventBox = document.getElementById('signage-today-event-box');
  const todayEventTitle = document.getElementById('signage-today-event-title');
  const todayEventDesc = document.getElementById('signage-today-event-desc');
  const upcomingList = document.getElementById('signage-upcoming-list');
  
  const calendarGrid = document.getElementById('signage-calendar-grid');
  const bulletinContainer = document.getElementById('signage-bulletin-container');
  const leaderboardContainer = document.getElementById('signage-leaderboard-container');

  // Hardcoded integration events (Must match employee.js and system specifications)
  const INTEGRATION_EVENTS = [
    { day: 15, title: "Day 1 Kickoff & Welcome Breakfast", type: "news", time: "09:00 CET", desc: "Welcome breakfast in the lobby, site leader address, and distribution of physical Welcome Kits!" },
    { day: 18, title: "IT Accounts SSO Registration", type: "training", time: "11:00 CET", desc: "Deadline to complete SSO registration and activate your new TE corporate email inbox." },
    { day: 22, title: "Q&A Session with IMO Integration Lead", type: "meeting", time: "15:00 CET", desc: "Drop-in virtual session to ask questions about system conversions and payroll transitions." },
    { day: 25, title: "Cultural Integration Welcome Town Hall", type: "news", time: "10:00 CET", desc: "Join TE corporate executives and local leads for a combined welcome session and open Q&A. May 25, 10:00 CET." },
    { day: 26, title: "Post-Merger Integration Review Meeting", type: "meeting", time: "14:00 CET", desc: "Join the Integration Management Office for the bi-weekly Post-Merger calibration sync on MS Teams. May 26, 14:00 CET." },
    { day: 28, title: "TE Cybersecurity Systems Compliance Course", type: "training", time: "All Day", desc: "All newly acquired employees must complete the basic cybersecurity and compliance training within their first 30 days." }
  ];

  // Announcements list for the lobby screen slide rotation
  const BULLETIN_ANNOUNCEMENTS = [
    { icon: "🚀", title: "Integration Kickoff!", body: "Welcome NextGen Sensors team! Complete your onboarding profile and start earning milestone badges today." },
    { icon: "💡", title: "Lessons Learned Center", body: "Check out the new M&A Case Studies section under Resources in your Playbook to learn from past successful integrations." },
    { icon: "👕", title: "Welcome Kits Personalizer", body: "Integration Leaders can now custom order personalized T-shirts, travel mugs, and notebooks directly from the dashboard cockpit!" },
    { icon: "👥", title: "Integration Buddy System", body: "Acquired managers, local HR, and site leaders can now access the new Leaders Portal and connect with their assigned TE Buddies." },
    { icon: "📈", title: "Lobby Broadcast Mode", body: "Celebrating NextGen site onboarding! Keep up the amazing work - we are currently at a fantastic completion rate!" }
  ];

  let currentBulletinIndex = 0;
  let activeTimelineDay = 8; // Default fallback to Day 8 (May 22, 2026)

  // 1. Ticking Clock & Current Date Update Loop
  function startClock() {
    function updateClock() {
      const now = new Date();
      
      // Force date display matching our simulated M&A timeline year 2026
      // We will parse the local clock time but override the day to match May 22, 2026 (or time-traveled day)
      // Wait, let's map the day properly! Since May 15 is Day 1, then the current calendar day is May 14 + activeTimelineDay
      const simulatedDay = 14 + activeTimelineDay; 
      const dayName = now.toLocaleDateString('en-US', { weekday: 'long' });
      const monthName = 'May';
      const year = '2026';
      
      if (dateEl) {
        dateEl.textContent = `${dayName}, ${monthName} ${simulatedDay}, ${year}`;
      }
      
      if (clockEl) {
        let hours = now.getHours();
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        
        hours = hours % 12;
        hours = hours ? hours : 12; // the hour '0' should be '12'
        const hoursStr = String(hours).padStart(2, '0');
        
        clockEl.textContent = `${hoursStr}:${minutes}:${seconds} ${ampm}`;
      }
    }
    
    updateClock();
    setInterval(updateClock, 1000);
  }

  // 2. Fetch System Settings & Set Active Milestones
  async function loadSettingsAndStats() {
    try {
      // Fetch settings
      const settingsRes = await fetch('/api/settings');
      const settings = await settingsRes.json();
      
      // Update active day based on time travel settings
      activeTimelineDay = settings.timeTravelDay || 8;
      
      // Calculate current date in May 2026: May 15 was Day 1, so May 14 + day
      const currentCalendarDay = 14 + activeTimelineDay;

      if (timelineDayText) {
        timelineDayText.textContent = `Day ${activeTimelineDay} / Day 30`;
      }
      
      if (timelineBarFill) {
        const percent = Math.min(100, Math.max(0, (activeTimelineDay / 30) * 100));
        timelineBarFill.style.width = `${percent}%`;
      }

      // Fetch employee roster
      const employeesRes = await fetch('/api/employees');
      const employees = await employeesRes.json();
      
      // Filter out non-NextGen employees or calculate global site aggregates
      const siteEmployees = employees.filter(e => !e.isLeader || e.id !== 'emp_3'); // Emma Watson is leader, keep others
      
      let totalLessonsCompleted = 0;
      let totalPoints = 0;
      const maxLessonsPerEmployee = 9;
      
      employees.forEach(emp => {
        const completed = emp.completedLessons ? emp.completedLessons.length : 0;
        totalLessonsCompleted += completed;
        totalPoints += emp.points || 0;
      });

      // Update Completion Stats
      const totalPossibleLessons = employees.length * maxLessonsPerEmployee;
      const avgProgressPct = totalPossibleLessons > 0 ? Math.round((totalLessonsCompleted / totalPossibleLessons) * 100) : 0;
      
      if (completionRateEl) {
        completionRateEl.textContent = `${avgProgressPct}%`;
      }
      if (teamXpEl) {
        teamXpEl.textContent = totalPoints;
      }

      // Render Leaderboard (Top 5)
      renderLeaderboard(employees);

      // Draw Calendar
      renderCalendar(currentCalendarDay);

      // Display Event schedules
      renderEvents(currentCalendarDay);

    } catch (error) {
      console.error("Error loading signage board metrics:", error);
    }
  }

  // 3. Render Calendar Grid dynamically
  function renderCalendar(currentCalendarDay) {
    if (!calendarGrid) return;

    // Clear existing cells except header row (first 7 children)
    const headers = Array.from(calendarGrid.querySelectorAll('.calendar-day-header-signage'));
    calendarGrid.innerHTML = '';
    headers.forEach(h => calendarGrid.appendChild(h));

    // May 2026 starts on Friday (5 empty cells)
    const firstDayIndex = 5;
    const totalDays = 31;

    // Render empty prefix cells
    for (let i = 0; i < firstDayIndex; i++) {
      const emptyCell = document.createElement('div');
      emptyCell.className = 'calendar-cell-signage empty-cell';
      emptyCell.style.opacity = '0.15';
      calendarGrid.appendChild(emptyCell);
    }

    // Render calendar days
    for (let d = 1; d <= totalDays; d++) {
      const cell = document.createElement('div');
      cell.className = 'calendar-cell-signage';
      cell.innerHTML = `<span style="align-self: flex-start; padding: 2px;">${d}</span>`;

      // Highlight active simulated timeline day
      if (d === currentCalendarDay) {
        cell.classList.add('active-day');
      }

      // Check if day has an integration event
      const dayEvent = INTEGRATION_EVENTS.find(e => e.day === d);
      if (dayEvent) {
        cell.classList.add('has-event');
        cell.setAttribute('title', dayEvent.title);
        
        let labelColor = '#38bdf8';
        if (dayEvent.type === 'meeting') labelColor = '#e98300';
        if (dayEvent.type === 'training') labelColor = '#10b981';
        
        // Add miniature badge icon or dot
        const dot = document.createElement('div');
        dot.style.cssText = `width: 6px; height: 6px; background-color: ${labelColor}; border-radius: 50%; box-shadow: 0 0 6px ${labelColor}; margin-bottom: 2px;`;
        cell.appendChild(dot);
      }

      calendarGrid.appendChild(cell);
    }
  }

  // 4. Render Today's Event & Upcoming Checklist
  function renderEvents(currentCalendarDay) {
    // 1. Highlight today's event (if currentCalendarDay matches)
    const todayEvent = INTEGRATION_EVENTS.find(e => e.day === currentCalendarDay);
    
    if (todayEventBox) {
      if (todayEvent) {
        let typeIcon = "📢";
        let typeClass = "news";
        if (todayEvent.type === 'meeting') { typeIcon = "📅"; typeClass = "meeting"; }
        if (todayEvent.type === 'training') { typeIcon = "🛡️"; typeClass = "training"; }

        todayEventBox.innerHTML = `
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem;">${typeIcon}</div>
          <span style="font-size: 0.75rem; background: rgba(56, 189, 248, 0.15); color: #38bdf8; padding: 0.2rem 0.6rem; border-radius: 12px; font-weight: 700; border: 1px solid rgba(56, 189, 248, 0.3); text-transform: uppercase; margin-bottom: 0.5rem; display: inline-block;">
            ${todayEvent.type.toUpperCase()} @ ${todayEvent.time}
          </span>
          <h3 style="margin: 0 0 0.5rem 0; color: white; font-size: 1.15rem; font-weight: 800;">${todayEvent.title}</h3>
          <p style="margin: 0; color: #94a3b8; font-size: 0.85rem; line-height: 1.4;">${todayEvent.desc}</p>
        `;
      } else {
        todayEventBox.innerHTML = `
          <div style="font-size: 2.5rem; margin-bottom: 0.5rem; opacity: 0.5;">💤</div>
          <h3 style="margin: 0 0 0.5rem 0; color: #64748b; font-size: 1.1rem; font-weight: 700;">No Event Today</h3>
          <p style="margin: 0; color: #64748b; font-size: 0.8rem; line-height: 1.4;">Enjoy a quiet integration checklist focus day! Review upcoming calendars.</p>
        `;
      }
    }

    // 2. Render future list (Next 3 events on or after currentCalendarDay)
    if (upcomingList) {
      upcomingList.innerHTML = '';
      
      const futureEvents = INTEGRATION_EVENTS.filter(e => e.day >= currentCalendarDay).slice(0, 3);

      if (futureEvents.length === 0) {
        upcomingList.innerHTML = `
          <p style="text-align: center; color: #64748b; font-size: 0.85rem; padding: 1rem;">All timeline events completed! Great job team!</p>
        `;
        return;
      }

      futureEvents.forEach(e => {
        let typeIcon = "📢";
        let typeColor = "#38bdf8";
        if (e.type === 'meeting') { typeIcon = "📅"; typeColor = "#e98300"; }
        if (e.type === 'training') { typeIcon = "🛡️"; typeColor = "#10b981"; }

        const item = document.createElement('div');
        item.style.cssText = `
          display: flex;
          align-items: center;
          gap: 0.75rem;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.04);
          padding: 0.75rem;
          border-radius: 12px;
        `;
        
        item.innerHTML = `
          <div style="font-size: 1.5rem; width: 40px; height: 40px; border-radius: 8px; background: rgba(255,255,255,0.03); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05); color: ${typeColor};">
            ${typeIcon}
          </div>
          <div style="flex-grow: 1;">
            <div style="font-weight: 700; color: #cbd5e1; font-size: 0.85rem; line-height: 1.2;">${e.title}</div>
            <div style="font-size: 0.75rem; color: #64748b; margin-top: 0.15rem;">May ${e.day}, 2026 &bull; ${e.time}</div>
          </div>
        `;
        
        upcomingList.appendChild(item);
      });
    }
  }

  // 5. Render Leaderboard listing with premium medals
  function renderLeaderboard(employees) {
    if (!leaderboardContainer) return;
    leaderboardContainer.innerHTML = '';

    // Sort by points descending
    const sorted = [...employees].sort((a, b) => (b.points || 0) - (a.points || 0)).slice(0, 5);

    sorted.forEach((emp, index) => {
      let badgeClass = 'signage-badge-circle';
      let icon = '🏅';
      
      if (index === 0) {
        badgeClass += ' gold';
        icon = '👑';
      } else if (index === 1) {
        icon = '🥈';
      } else if (index === 2) {
        icon = '🥉';
      }

      const row = document.createElement('div');
      row.className = 'signage-leader-row leaderboard-roster-row-premium';
      row.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div class="${badgeClass}">${icon}</div>
          <div>
            <h5 style="margin: 0; color: #f8fafc; font-size: 0.9rem; font-weight: 700;">${emp.name} ${emp.isLeader ? '👑' : ''}</h5>
            <p style="margin: 0.1rem 0 0 0; font-size: 0.75rem; color: #94a3b8;">${emp.role} &bull; ${emp.department}</p>
          </div>
        </div>
        <div style="text-align: right;">
          <span style="font-weight: 800; color: var(--te-orange); font-size: 1rem;">${emp.points || 0} XP</span>
          <div style="font-size: 0.65rem; color: #64748b; margin-top: 0.1rem; text-transform: uppercase; font-weight: 700;">${emp.badge || 'Recruit'}</div>
        </div>
      `;
      
      leaderboardContainer.appendChild(row);
    });
  }

  // 6. Announcements Bulletin Board Loop (Fades cards in and out)
  function startBulletinLoop() {
    if (!bulletinContainer) return;

    setInterval(() => {
      const fader = document.getElementById('signage-bulletin-fader');
      if (!fader) return;

      // 1. Fade out
      fader.style.opacity = '0';

      // 2. Swap content and fade in after transition delay
      setTimeout(() => {
        currentBulletinIndex = (currentBulletinIndex + 1) % BULLETIN_ANNOUNCEMENTS.length;
        const current = BULLETIN_ANNOUNCEMENTS[currentBulletinIndex];
        
        fader.innerHTML = `
          <div class="bulletin-icon">${current.icon}</div>
          <div class="bulletin-heading">${current.title}</div>
          <div class="bulletin-body">${current.body}</div>
        `;
        
        // Fade back in
        fader.style.opacity = '1';
      }, 500);

    }, 6000);
  }

  // Initialize all routines
  startClock();
  loadSettingsAndStats();
  startBulletinLoop();

  // Refresh stats periodically (every 30 seconds) to stay aligned with admin shifts
  setInterval(loadSettingsAndStats, 30000);
});
