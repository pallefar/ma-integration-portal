/**
 * TEd Workstation Launcher
 * Defines window.launchDoomProtocol(): boots the retro "TEd: Corporate Ladder"
 * platformer (synergy-quest.js) inside a fullscreen overlay console.
 * Used by the Admin "TE TEd Bypass" card and the Employee 220 XP "TEd Gateway" milestone.
 */
(function () {
  let overlayEl = null;

  function onEscKey(e) {
    if (e.key === 'Escape') closeTedOverlay();
  }

  function closeTedOverlay() {
    if (typeof window.cleanupSynergyQuest === 'function') {
      try { window.cleanupSynergyQuest(); } catch (err) { console.warn('TEd cleanup failed:', err); }
    }
    document.removeEventListener('keydown', onEscKey);
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function bootGame(container) {
    const lang = localStorage.getItem('employeeLanguage') || 'en';
    try {
      window.initSynergyQuest(container, lang);
      const canvas = container.querySelector('canvas');
      if (canvas) canvas.focus();
    } catch (err) {
      console.error('Failed to boot TEd:', err);
      container.innerHTML = '<p style="color:#f87171; text-align:center; padding-top:20%; font-family:monospace;">FATAL: TEd kernel panic. Close and retry.</p>';
    }
  }

  window.launchDoomProtocol = function () {
    if (overlayEl) return;

    overlayEl = document.createElement('div');
    overlayEl.id = 'ted-workstation-overlay';
    overlayEl.style.cssText = 'position:fixed; inset:0; z-index:99999; background:rgba(7,15,20,0.96); display:flex; flex-direction:column; align-items:center; justify-content:center; padding:1.5rem; backdrop-filter:blur(6px);';

    overlayEl.innerHTML = `
      <div style="width:min(960px,96vw); display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
        <div style="font-family:monospace; color:#34D399; font-size:0.9rem; letter-spacing:0.08em;">
          &#128126; TEd WORKSTATION CONSOLE <span style="color:#64748b;">// CORPORATE LADDER</span>
        </div>
        <button type="button" id="btn-close-ted-overlay" style="background:#1e293b; color:#f1f5f9; border:1px solid #334155; border-radius:6px; padding:0.4rem 1rem; font-weight:700; cursor:pointer; font-size:0.85rem;">&#10005; Exit Console</button>
      </div>
      <div id="ted-game-container" style="width:min(960px,96vw); aspect-ratio:16/9; background:#070f14; border:2px solid #244C5A; border-radius:8px; overflow:hidden; box-shadow:0 20px 60px rgba(0,0,0,0.6);"></div>
      <div style="margin-top:0.6rem; color:#64748b; font-size:0.75rem; font-family:monospace;">ARROW KEYS to move &bull; ENTER to start &bull; ESC to exit</div>
    `;

    document.body.appendChild(overlayEl);
    overlayEl.querySelector('#btn-close-ted-overlay').addEventListener('click', closeTedOverlay);
    document.addEventListener('keydown', onEscKey);

    const container = overlayEl.querySelector('#ted-game-container');

    if (typeof window.initSynergyQuest === 'function') {
      bootGame(container);
    } else {
      container.innerHTML = '<p style="color:#94a3b8; text-align:center; padding-top:20%; font-family:monospace;">BOOTING TEd KERNEL...</p>';
      const script = document.createElement('script');
      script.src = '/js/synergy-quest.js';
      script.onload = () => { container.innerHTML = ''; bootGame(container); };
      script.onerror = () => {
        container.innerHTML = '<p style="color:#f87171; text-align:center; padding-top:20%; font-family:monospace;">Failed to load the TEd game engine.</p>';
      };
      document.head.appendChild(script);
    }
  };
})();
