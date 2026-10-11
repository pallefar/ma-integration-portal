// Externalised from the inline block of index.html (SAFE-02 / D-13-03, plan 13-10) - moved verbatim, same position.
(function () {
    document.addEventListener('DOMContentLoaded', () => {
      const roleCards = document.querySelectorAll('.demo-role-card');
      const panel = document.getElementById('showcase-detail-panel');
      
      const badge = document.getElementById('panel-role-badge');
      const title = document.getElementById('panel-role-title');
      const desc = document.getElementById('panel-role-desc');
      const features = document.getElementById('panel-role-features');
      const launchBtn = document.getElementById('panel-launch-btn');
      const visual = document.getElementById('panel-role-visual');

      const roleData = {
        pmo: {
          badge: "🏢 PMO OFFICE",
          title: "PMO Steering Control Console",
          desc: "The Project Management Office (PMO) acts as the integration command desk. PMO leads steer cross-functional tracks (R&D, Sales, Finance, IT), monitor progress gauges, resolve high-priority synergy blockers, and track global Day 1-100 timeline gates.",
          features: [
            "100-Day Timeline Gates",
            "Functional Progress Gauges",
            "Blocker Cockpit Desk",
            "Regional Integration Leader Provisioning",
            "PMO Onboarding Stepper Wizard",
            "Strategic Integration Insights"
          ],
          href: "/pmo.html",
          btnText: "Launch PMO Steering Console 🏢",
          visual: `
            <svg viewBox="0 0 300 180" style="width: 100%; height: auto;">
              <rect width="300" height="180" fill="none" stroke="var(--te-dark-teal)" stroke-dasharray="3,3" stroke-width="2" rx="8"/>
              <circle cx="150" cy="70" r="40" fill="rgba(36, 76, 90, 0.05)" stroke="var(--te-dark-teal)" stroke-width="3"/>
              <text x="150" y="75" text-anchor="middle" font-size="28" fill="var(--te-dark-teal)">🏢</text>
              <line x1="150" y1="110" x2="150" y2="140" stroke="var(--te-orange)" stroke-width="2"/>
              <line x1="150" y1="110" x2="90" y2="130" stroke="var(--border-color)" stroke-width="2"/>
              <line x1="150" y1="110" x2="210" y2="130" stroke="var(--border-color)" stroke-width="2"/>
              <circle cx="90" cy="130" r="10" fill="#3B82F6"/>
              <circle cx="150" cy="140" r="10" fill="#E98300"/>
              <circle cx="210" cy="130" r="10" fill="#10B981"/>
            </svg>
          `
        },
        hrbp: {
          badge: "📊 INTEGRATION LEADER PORTAL",
          title: "Integration Leader Dashboard",
          desc: "Integration Leaders execute the local people transition strategy. Use this dashboard to provision legacy employees, map them to TE Connectivity integration buddies, monitor cohort training progress, analyze cultural change-curves, and dispatch divisions broadcast letters.",
          features: [
            "Smart CSV/JSON Auto-Mapper",
            "Onboarding Academy Tracking",
            "Employee Change-Curve Analysis",
            "Workforce Broadcast Center",
            "Buddy Pairing Desks",
            "Active Megaphone Advice Tips"
          ],
          href: "/dashboard.html",
          btnText: "Launch Integration Leader Dashboard 📊",
          visual: `
            <svg viewBox="0 0 300 180" style="width: 100%; height: auto;">
              <rect width="300" height="180" fill="none" stroke="var(--te-orange)" stroke-dasharray="3,3" stroke-width="2" rx="8"/>
              <rect x="40" y="120" width="30" height="40" fill="#E98300" rx="2"/>
              <rect x="90" y="80" width="30" height="80" fill="var(--te-dark-teal)" rx="2"/>
              <rect x="140" y="50" width="30" height="110" fill="#10B981" rx="2"/>
              <rect x="190" y="90" width="30" height="70" fill="#F59E0B" rx="2"/>
              <rect x="230" y="110" width="30" height="50" fill="#8B5CF6" rx="2"/>
              <line x1="30" y1="160" x2="270" y2="160" stroke="var(--text-primary)" stroke-width="3"/>
            </svg>
          `
        },
        supporting: {
          badge: "👥 SUPPORTING TEAMS",
          title: "Supporting Teams Dashboard Hub",
          desc: "Supporting operations are isolated into their own workflow desk. Specialized subtabs allow HR Shared Services (HRSS) to verify VPN badges, Regional HR to align local compliance, Legal to map patents, and Total Rewards to authorize health plan benefit migrations.",
          features: [
            "Isolated support desks",
            "Shared-Services (HRSS) logs",
            "Legal & IP clearances",
            "Total Rewards benefit syncs",
            "Support Roster registries",
            "4 Core Integration pillars"
          ],
          href: "/supporting.html",
          btnText: "Launch Supporting Teams Hub 👥",
          visual: `
            <svg viewBox="0 0 300 180" style="width: 100%; height: auto;">
              <rect width="300" height="180" fill="none" stroke="#8B5CF6" stroke-dasharray="3,3" stroke-width="2" rx="8"/>
              <rect x="30" y="30" width="100" height="50" rx="6" fill="rgba(139, 92, 246, 0.05)" stroke="#8B5CF6" stroke-width="1.5"/>
              <text x="80" y="60" text-anchor="middle" font-size="10" font-weight="bold" fill="#8B5CF6">🏢 HRSS</text>
              <rect x="170" y="30" width="100" height="50" rx="6" fill="rgba(139, 92, 246, 0.05)" stroke="#8B5CF6" stroke-width="1.5"/>
              <text x="220" y="60" text-anchor="middle" font-size="10" font-weight="bold" fill="#8B5CF6">🌍 Regional HR</text>
              <rect x="30" y="100" width="100" height="50" rx="6" fill="rgba(139, 92, 246, 0.05)" stroke="#8B5CF6" stroke-width="1.5"/>
              <text x="80" y="130" text-anchor="middle" font-size="10" font-weight="bold" fill="#8B5CF6">⚖️ Legal &amp; IP</text>
              <rect x="170" y="100" width="100" height="50" rx="6" fill="rgba(139, 92, 246, 0.05)" stroke="#8B5CF6" stroke-width="1.5"/>
              <text x="220" y="130" text-anchor="middle" font-size="10" font-weight="bold" fill="#8B5CF6">💵 Total Rewards</text>
            </svg>
          `
        },
        employee: {
          badge: "👤 LEGACY COHORT",
          title: "Personal Integration Journey Portal",
          desc: "Acquired legacy employees experience a highly gamified, personalized onboarding path. Check list tasks dynamically award Merit Points (XP), trigger popping sine-synth audio chimes and confetti bursts, display active session multipliers, and track progressive horizontal milestones.",
          features: [
            "Dynamic Horizontal Timeline",
            "Synthesized Pop Audio Chimes",
            "Checklist Confetti Particle Bursts",
            "Consecutive Lesson Streaks",
            "Personalized Buddy widgets",
            "Did You Know Integration Tips"
          ],
          href: "/employee.html?name=Alex&role=R%26D%20Specialist&dept=R%26D",
          btnText: "Launch Employee Portal 👤",
          visual: `
            <svg viewBox="0 0 300 180" style="width: 100%; height: auto;">
              <rect width="300" height="180" fill="none" stroke="#10B981" stroke-dasharray="3,3" stroke-width="2" rx="8"/>
              <!-- Stepper Line -->
              <line x1="40" y1="90" x2="260" y2="90" stroke="#border-color" stroke-width="4"/>
              <line x1="40" y1="90" x2="160" y2="90" stroke="#10B981" stroke-width="4"/>
              <!-- Check Nodes -->
              <circle cx="60" cy="90" r="16" fill="#10B981" stroke="white" stroke-width="2"/>
              <text x="60" y="94" text-anchor="middle" font-size="12" fill="white">✓</text>
              <circle cx="160" cy="90" r="16" fill="#10B981" stroke="white" stroke-width="2"/>
              <text x="160" y="94" text-anchor="middle" font-size="12" fill="white">✓</text>
              <circle cx="240" cy="90" r="16" fill="#E98300" stroke="white" stroke-width="2"/>
              <text x="240" y="94" text-anchor="middle" font-size="12" fill="white">🔒</text>
            </svg>
          `
        },
        admin: {
          badge: "⚙️ SYSTEM CONTROLLER",
          title: "Administrative Systems Console",
          desc: "Admins maintain system governance. From database connection settings to credentials configuration, administrators can compile flat file mock databases into structured SQL scripts optimized for Supabase or Microsoft Azure SQL.",
          features: [
            "Relational Database Migrator",
            "Azure / Supabase connection desks",
            "Interactive SQL script compiler",
            "Copyable SQL terminal previews",
            "Custom data reset options",
            "LLM RAG settings management"
          ],
          href: "/admin.html",
          btnText: "Launch Admin Console ⚙️",
          visual: `
            <svg viewBox="0 0 300 180" style="width: 100%; height: auto;">
              <rect width="300" height="180" fill="none" stroke="#374151" stroke-dasharray="3,3" stroke-width="2" rx="8"/>
              <rect x="80" y="40" width="140" height="100" rx="4" fill="#1e293b"/>
              <circle cx="110" cy="60" r="6" fill="#ef4444"/>
              <circle cx="130" cy="60" r="6" fill="#eab308"/>
              <circle cx="150" cy="60" r="6" fill="#22c55e"/>
              <rect x="95" y="80" width="110" height="4" fill="#38bdf8" rx="2"/>
              <rect x="95" y="95" width="80" height="4" fill="#a7f3d0" rx="2"/>
              <rect x="95" y="110" width="95" height="4" fill="#fef08a" rx="2"/>
            </svg>
          `
        }
      };

      roleCards.forEach(card => {
        card.addEventListener('click', () => {
          const role = card.getAttribute('data-role');
          const data = roleData[role];

          // Set active card styles
          roleCards.forEach(c => c.classList.remove('active-role'));
          card.classList.add('active-role');
          
          // Persist selected demo role
          localStorage.setItem('active_demo_role', role);

          // Populate panel data
          badge.innerText = data.badge;
          title.innerText = data.title;
          desc.innerText = data.desc;
          launchBtn.href = data.href;
          launchBtn.innerText = data.btnText;
          visual.innerHTML = data.visual;

          // Populate features list
          features.innerHTML = '';
          data.features.forEach(feat => {
            const li = document.createElement('li');
            li.innerText = feat;
            features.appendChild(li);
          });

          // Show panel with smooth animations (skip scroll on the initial programmatic selection)
          panel.style.display = 'block';
          if (!window.__initialRoleSelect) {
            panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });
      });

      // Demo Role Visibility: only show role cards enabled from the Admin console,
      // then default-select the first visible card.
      const setupShowcase = (rv) => {
        let anyVisible = false;
        roleCards.forEach(card => {
          const role = card.getAttribute('data-role');
          if (rv[role] === false) {
            card.style.display = 'none';
          } else {
            card.style.display = '';
            anyVisible = true;
          }
        });
        if (!anyVisible) roleCards.forEach(card => { card.style.display = ''; });
        const firstVisible = Array.from(roleCards).find(c => c.style.display !== 'none');
        if (firstVisible) {
          window.__initialRoleSelect = true;
          firstVisible.click();
          window.__initialRoleSelect = false;
        }
      };

      // Apply admin-authored landing-card content (icon/title/desc per language) and
      // visibility, merged with the demo role-visibility settings, then set up the showcase.
      Promise.all([
        fetch('/api/settings').then(r => r.json()).catch(() => ({})),
        fetch('/api/menus').then(r => r.json()).catch(() => ({}))
      ]).then(([settings, menus]) => {
        const lang = localStorage.getItem('employeeLanguage') || 'en';
        const pick = (v) => (v && typeof v === 'object') ? (v[lang] || v.en || '') : (v || '');
        const rv = Object.assign({}, settings.roleVisibility || {});
        ((menus && menus.landingCards) || []).forEach(c => {
          const card = document.querySelector('.demo-role-card[data-role="' + c.role + '"]');
          if (!card) return;
          const icon = card.querySelector('.demo-role-icon');
          const h3 = card.querySelector('h3');
          const p = card.querySelector('p');
          if (icon && c.icon) icon.textContent = c.icon;
          if (h3 && pick(c.title)) h3.textContent = pick(c.title);
          if (p && pick(c.desc)) p.textContent = pick(c.desc);
          if (c.visible === false) rv[c.role] = false;
        });
        setupShowcase(rv);
      });
    });
})();
