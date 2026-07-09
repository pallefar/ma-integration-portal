/**
 * TEd: Corporate Ladder
 * A high-fidelity retro HTML5 Canvas 2D Platformer
 * Features:
 * - 8 complete levels representing World 1 & 2 Mario archetypes with post-merger integration themes.
 * - Programmatic 3D realistic texturing (beveled bricks, shiny linoleum, server racks with circuits, gear-rolling conveyors, glossy mahogany).
 * - Liquid coolant swimming physics (Level 2-2 underwater archetype) with zero gravity, bubble flows.
 * - Industrial conveyor belts and springboard launch pads.
 * - Rotating cybersecurity firewall fire-bars.
 * - Advanced vector sprite detailing (tilt mechanics, glasses specular shine, heel dust particles).
 * - Custom synthetic Web Audio chiptune synthesizer and BGM loop sequencer.
 */
(function() {
  window.initSynergyQuest = function(containerEl, currentLang) {
    containerEl.innerHTML = '';

    const canvas = document.createElement('canvas');
    canvas.id = 'synergy-quest-canvas';
    canvas.width = 640;
    canvas.height = 360;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.backgroundColor = '#070f14';
    canvas.setAttribute('tabindex', '1');
    containerEl.appendChild(canvas);

    const ctx = canvas.getContext('2d');

    // Language Dictionaries (Karsten rebranded to TEd)
    const TEXTS = {
      en: {
        selectHero: "CHOOSE YOUR INTEGRATION HERO",
        sarahName: "Sarah (Lead Scientist)",
        sarahStats: "Abilities: +Jump Boost (Coffee Lover)",
        tedName: "TEd (Integration Analyst)",
        tedStats: "Abilities: +Speed Boost (Fast Analyst)",
        startPrompt: "PRESS ENTER OR CLICK TO START WORK",
        levelName: "Level",
        levelTitles: [
          "1-1: The HR Onboarding Lobby",
          "1-2: The Underground Mailroom",
          "1-3: The HR Skyscraper Ledges",
          "1-4: The Local Security Firewall",
          "2-1: The Cyber-Cloud Overworld",
          "2-2: The Liquid Coolant Vats",
          "2-3: The Assembly Line Girders",
          "2-4: The Boardroom Integration Core"
        ],
        score: "Merit Points",
        lives: "Lives",
        xp: "XP",
        gameOver: "TERMINATED (GAME OVER)",
        retryPrompt: "Press ENTER or Tap to Try Onboarding Again",
        victoryTitle: "MERGER COMPLETE! 100% SYNERGY ACHIEVED",
        victoryDesc: "You conquered the Legacy System Blocker and integrated TE Connectivity!",
        victoryPrompt: "Congratulations! Press ENTER to restart TEd."
      },
      de: {
        selectHero: "WÄHLEN SIE IHREN INTEGRATIONS-HELDEN",
        sarahName: "Sarah (Chef-Wissenschaftlerin)",
        sarahStats: "Fähigkeiten: +Sprung-Boost (Kaffeeliebhaber)",
        tedName: "TEd (Integrationsanalyst)",
        tedStats: "Fähigkeiten: +Geschwindigkeits-Boost (Schneller Analyst)",
        startPrompt: "EINGABE ODER KLICKEN ZUM STARTEN",
        levelName: "Ebene",
        levelTitles: [
          "1-1: Die HR-Onboarding-Lobby",
          "1-2: Die unterirdische Poststelle",
          "1-3: Die HR-Wolkenkratzerkanten",
          "1-4: Die lokale Sicherheitsfirewall",
          "2-1: Die Cyber-Wolken-Oberwelt",
          "2-2: Die flüssigen Kühlmitteltanks",
          "2-3: Die Montagelinien-Träger",
          "2-4: Der Vorstands-Integrationskern"
        ],
        score: "Leistungspunkte",
        lives: "Leben",
        xp: "XP",
        gameOver: "GEKÜNDIGT (SPIEL VORBEI)",
        retryPrompt: "Drücken Sie EINGABE oder Tippen für Neustart",
        victoryTitle: "FUSION ABGESCHLOSSEN! 100% SYNERGIE ERREICHT",
        victoryDesc: "Sie haben den Legacy-Systemblocker besiegt und TE integriert!",
        victoryPrompt: "Glückwunsch! EINGABE drücken zum Neustarten."
      },
      zh: {
        selectHero: "选择您的整合英雄",
        sarahName: "Sarah (首席科学家)",
        sarahStats: "能力：+跳跃增强 (咖啡爱好者)",
        tedName: "TEd (整合分析师)",
        tedStats: "能力：+速度增强 (高效分析师)",
        startPrompt: "按 回车(ENTER) 或 点击开始工作",
        levelName: "级别",
        levelTitles: [
          "1-1: HR 员工入职大厅",
          "1-2: 地下物流邮政中心",
          "1-3: HR 摩天大楼边缘",
          "1-4: 局域网络安全防火墙",
          "2-1: 虚拟 IT 赛博云端",
          "2-2: 工厂冷却液池 (潜水)",
          "2-3: 协同制造流水线钢梁",
          "2-4: 核心执行董事会会议室"
        ],
        score: "绩效积分",
        lives: "生命值",
        xp: "经验值",
        gameOver: "试用期终止 (游戏结束)",
        retryPrompt: "按 回车(ENTER) 或 点击重新开始入职",
        victoryTitle: "合并圆满完成！达到 100% 协同效应",
        victoryDesc: "您成功击败了历史系统阻碍，并完美整合了 TE Connectivity！",
        victoryPrompt: "恭喜！按 回车(ENTER) 键重新开始 TEd。"
      },
      cs: {
        selectHero: "VYBERTE SVÉHO INTEGRAČNÍHO HRDINU",
        sarahName: "Sarah (Vedoucí Vědkyně)",
        sarahStats: "Schopnosti: +Výskok (Milovník kávy)",
        tedName: "TEd (Integrační Analytik)",
        tedStats: "Schopnosti: +Rychlost (Rychlý analytik)",
        startPrompt: "STISKNĚTE ENTER NEBO KLIKNĚTE PRO ZAHÁJENÍ PRÁCE",
        levelName: "Úroveň",
        levelTitles: [
          "1-1: HR Onboarding Lobby",
          "1-2: Podzemní Poštovní Mailroom",
          "1-3: HR Výškové Skleněné Terasy",
          "1-4: Lokální Bezpečnostní Firewall",
          "2-1: Kybernetická IT Nadstavba",
          "2-2: Kapalná Chladicí Nádrž",
          "2-3: Výrobní Linka a Nosníky",
          "2-4: Správní Rada - Integrační Jádro"
        ],
        score: "Záslužné Body",
        lives: "Životy",
        xp: "XP",
        gameOver: "UKONČENO (KONEC HRY)",
        retryPrompt: "Stiskněte ENTER nebo klepněte pro nový pokus",
        victoryTitle: "FÚZE DOKONČENA! DOSAŽENO 100% SYNERGIE",
        victoryDesc: "Porazili jste blokátor starého systému a plně integrovali TE!",
        victoryPrompt: "Gratulujeme! Stiskněte ENTER pro restartování."
      }
    };

    const dict = TEXTS[currentLang] || TEXTS.en;

    // --- Web Audio Synth Engine ---
    let audioCtx = null;
    function initAudio() {
      if (audioCtx) return;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }

    function playSynthSound(type) {
      if (!audioCtx) return;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const t = audioCtx.currentTime;
      
      if (type === 'jump') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, t);
        osc.frequency.exponentialRampToValueAtTime(520, t + 0.14);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.14);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.14);
      } else if (type === 'swim') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.linearRampToValueAtTime(220, t + 0.15);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.15);
      } else if (type === 'coin') {
        const osc1 = audioCtx.createOscillator();
        const osc2 = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(987.77, t); // B5
        osc2.frequency.setValueAtTime(1318.51, t + 0.07); // E6
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.25);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(audioCtx.destination);
        osc1.start(t);
        osc1.stop(t + 0.2);
        osc2.start(t + 0.07);
        osc2.stop(t + 0.25);
      } else if (type === 'powerup') {
        const notes = [329.63, 392.00, 523.25, 659.25]; // E4, G4, C5, E5
        notes.forEach((freq, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(freq, t + idx * 0.06);
          gain.gain.setValueAtTime(0.06, t + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.005, t + idx * 0.06 + 0.12);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(t + idx * 0.06);
          osc.stop(t + idx * 0.06 + 0.14);
        });
      } else if (type === 'stomp') {
        const bufferSize = audioCtx.sampleRate * 0.1;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = Math.random() * 2 - 1;
        }
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(220, t);
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.1);
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);
        noise.start(t);
      } else if (type === 'hurt') {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280, t);
        osc.frequency.linearRampToValueAtTime(80, t + 0.22);
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.01, t + 0.22);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.22);
      } else if (type === 'victory') {
        const melody = [
          { f: 523.25, d: 0.08 }, { f: 523.25, d: 0.08 },
          { f: 523.25, d: 0.08 }, { f: 523.25, d: 0.22 },
          { f: 415.30, d: 0.22 }, { f: 466.16, d: 0.22 },
          { f: 523.25, d: 0.15 }, { f: 466.16, d: 0.08 },
          { f: 523.25, d: 0.5 }
        ];
        let currTime = t;
        melody.forEach((note) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'square';
          osc.frequency.setValueAtTime(note.f, currTime);
          gain.gain.setValueAtTime(0.1, currTime);
          gain.gain.exponentialRampToValueAtTime(0.005, currTime + note.d);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(currTime);
          osc.stop(currTime + note.d);
          currTime += note.d + 0.02;
        });
      }
    }

    let bgmIntervalId = null;
    function playBGM() {
      if (!audioCtx) return;
      if (bgmIntervalId) return;

      // Classically bouncy retro bassline
      const notes = [
        261.63, 0, 261.63, 0, 329.63, 0, 392.00, 0,
        196.00, 0, 0, 0, 220.00, 0, 246.94, 0,
        261.63, 0, 196.00, 0, 164.81, 0, 220.00, 0,
        293.66, 0, 293.66, 0, 392.00, 349.23, 329.63, 0
      ];

      let step = 0;
      bgmIntervalId = setInterval(() => {
        if (!audioCtx || gameState.state !== 'playing' || gameState.invincibilityTime > 0) return;
        
        const f = notes[step % notes.length];
        if (f > 0) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(f, audioCtx.currentTime);
          gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.12);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.14);
        }
        step++;
      }, 140);
    }

    function stopBGM() {
      if (bgmIntervalId) {
        clearInterval(bgmIntervalId);
        bgmIntervalId = null;
      }
    }

    let starIntervalId = null;
    function playStarMusic() {
      if (!audioCtx) return;
      stopBGM();
      if (starIntervalId) return;

      let step = 0;
      const scale = [261.63, 329.63, 392.00, 440.00, 392.00, 329.63, 261.63, 0];
      starIntervalId = setInterval(() => {
        if (!audioCtx || gameState.state !== 'playing' || gameState.invincibilityTime <= 0) {
          stopStarMusic();
          if (gameState.state === 'playing') playBGM();
          return;
        }
        
        const note = scale[step % scale.length];
        if (note > 0) {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(note * 1.5, audioCtx.currentTime);
          gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.09);
        }
        step++;
      }, 95);
    }

    function stopStarMusic() {
      if (starIntervalId) {
        clearInterval(starIntervalId);
        starIntervalId = null;
      }
    }

    // --- Game States ---
    const gameState = {
      state: 'select', 
      hero: 'sarah',   
      score: 0,
      lives: 3,
      xp: 0,
      currentLevel: 0,
      invincibilityTime: 0,
      cameraX: 0,
      levelWidth: 3200,
      shakeTime: 0,
      bossHits: 0
    };

    const keys = {};
    function setupInputs() {
      canvas.addEventListener('keydown', (e) => {
        initAudio();
        keys[e.code] = true;
        
        if (gameState.state === 'select') {
          if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
            gameState.hero = 'sarah';
            playSynthSound('jump');
          } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
            gameState.hero = 'ted';
            playSynthSound('jump');
          } else if (e.code === 'Enter') {
            startGame();
          }
        } else if (['gameover', 'victory'].includes(gameState.state) && e.code === 'Enter') {
          restartWholeGame();
        }
        
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
          e.preventDefault();
        }
      });

      canvas.addEventListener('keyup', (e) => {
        keys[e.code] = false;
      });

      canvas.addEventListener('click', (e) => {
        initAudio();
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
        const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

        if (gameState.state === 'select') {
          if (x >= 80 && x <= 280 && y >= 110 && y <= 270) {
            gameState.hero = 'sarah';
            playSynthSound('jump');
            startGame();
          } else if (x >= 360 && x <= 560 && y >= 110 && y <= 270) {
            gameState.hero = 'ted';
            playSynthSound('jump');
            startGame();
          }
        } else if (['gameover', 'victory'].includes(gameState.state)) {
          restartWholeGame();
        }
      });
    }

    const parallaxLayers = [
      { speed: 0.08, color: '#09151c' },
      { speed: 0.22, color: '#10222b' },
      { speed: 0.4, color: '#172f3d' }
    ];

    const particles = [];
    function spawnParticle(x, y, color, size, vx, vy, life) {
      particles.push({ x, y, color, size, vx, vy, life, maxLife: life });
    }

    function triggerConfettiAt(x, y) {
      const colors = ['#E98300', '#244C5A', '#F59E0B', '#34D399', '#60A5FA', '#F472B6'];
      for (let i = 0; i < 40; i++) {
        const color = colors[Math.floor(Math.random() * colors.length)];
        const size = Math.random() * 3 + 2;
        const vx = (Math.random() - 0.5) * 8;
        const vy = -Math.random() * 5 - 2;
        const life = Math.random() * 40 + 20;
        spawnParticle(x, y, color, size, vx, vy, life);
      }
    }

    // Entities Blueprint
    let platforms = [];
    let items = [];
    let enemies = [];
    let cyberBars = []; // Rotating cybersecurity fire-bars
    let liftPlatforms = []; // Vertically or horizontally sliding lifts
    let bossInstance = null;

    const player = {
      x: 100,
      y: 200,
      vx: 0,
      vy: 0,
      width: 16,
      height: 24,
      isGrounded: false,
      hasHardhat: false, 
      hasCoffee: false,   
      coffeeTime: 0,
      facingRight: true,
      jumpsUsed: 0,
      maxJumps: 1,
      baseSpeed: 3.2,
      jumpForce: 7.2,
      iframeTime: 0,
      runFrame: 0,
      isSwimming: false
    };

    function startGame() {
      gameState.state = 'playing';
      gameState.score = 0;
      gameState.lives = 3;
      gameState.xp = 0;
      gameState.currentLevel = 0;
      gameState.bossHits = 0;
      
      if (gameState.hero === 'sarah') {
        player.maxJumps = 2; // double jump
        player.baseSpeed = 3.1;
      } else {
        player.maxJumps = 1;
        player.baseSpeed = 4.2; // faster TEd analyst
      }

      loadLevel(0);
      playBGM();
    }

    function restartWholeGame() {
      gameState.state = 'select';
      stopBGM();
      stopStarMusic();
    }

    function loadLevel(lvlIdx) {
      gameState.currentLevel = lvlIdx;
      gameState.cameraX = 0;
      gameState.shakeTime = 0;
      
      player.x = 80;
      player.y = 150;
      player.vx = 0;
      player.vy = 0;
      player.isGrounded = false;
      player.iframeTime = 0;
      player.jumpsUsed = 0;
      player.isSwimming = false;

      platforms = [];
      items = [];
      enemies = [];
      cyberBars = [];
      liftPlatforms = [];
      bossInstance = null;

      // Define level size & builds matching Super Mario Bros Saga
      if (lvlIdx === 3 || lvlIdx === 7) {
        // Firewall Castles (1-4 and 2-4)
        gameState.levelWidth = 1600;
        buildFirewallCastle(lvlIdx);
      } else if (lvlIdx === 5) {
        // Liquid Coolant Vats Swim level (2-2 Underwater)
        gameState.levelWidth = 2400;
        buildLiquidCoolantVats();
      } else {
        // Standard levels
        gameState.levelWidth = 2800;
        buildStandardLevel(lvlIdx);
      }
    }

    function addBlock(x, y, w, h, type, conveyorSpeed = 0) {
      platforms.push({ x, y, width: w, height: h, type, conveyorSpeed }); 
    }

    function addItem(x, y, type) {
      items.push({ x, y, width: 14, height: 14, type, vy: 0, vx: 0, yOffset: 0, collected: false });
    }

    function addEnemy(x, y, type) {
      enemies.push({
        x, y,
        width: type === 'phish' ? 18 : 16,
        height: type === 'phish' ? 14 : 16,
        type, // 'expense', 'phish', 'bottleneck', 'disk'
        vx: type === 'expense' ? -1.0 : type === 'phish' ? -0.8 : 0,
        vy: 0,
        yStart: y,
        isGrounded: false,
        alive: true,
        animFrame: 0
      });
    }

    function addCyberBar(x, y, nodeCount, speed = 0.02) {
      cyberBars.push({ x, y, nodeCount, angle: 0, speed });
    }

    function addLift(x, y, w, h, type, range = 100, axis = 'y', speed = 1.0) {
      liftPlatforms.push({
        x, y, xStart: x, yStart: y, width: w, height: h, type, range, axis, speed, angle: 0
      });
    }

    // Level Builder 1: Highly Detailed Super Mario 1-1 / 1-2 / 1-3 / 2-1 / 2-3 Replica maps
    function buildStandardLevel(lvl) {
      // Primary solid floor ground
      addBlock(0, 320, gameState.levelWidth, 40, 'solid');

      // 1-1 Overworld Lobby (Lvl 0) - Iconic World 1-1 layout, corporate theme
      if (lvl === 0) {
        // Blocks stack 1
        addBlock(200, 224, 16, 16, 'coin-box');
        addBlock(280, 224, 16, 16, 'coin-box');
        addBlock(296, 224, 16, 16, 'hardhat-box'); // Powerup box
        addBlock(312, 224, 16, 16, 'coin-box');
        addBlock(296, 128, 16, 16, 'coin-box'); // High floating box

        // Desk towers (Classic Green Pipes)
        addBlock(450, 256, 48, 64, 'solid'); // height 2 blocks
        addBlock(680, 224, 48, 96, 'solid'); // height 3 blocks
        addBlock(880, 192, 48, 128, 'solid'); // height 4 blocks

        // Hidden block under desk
        addBlock(800, 224, 16, 16, 'duck-box'); // Invisible until hit but solid here

        // Gap Pits
        platforms = platforms.filter(p => !(p.x >= 1100 && p.x <= 1160)); // Slice ground pit
        addBlock(0, 320, 1100, 40, 'solid');
        addBlock(1180, 320, 1620, 40, 'solid');

        // Multi brick row overhead
        addBlock(1280, 224, 48, 16, 'solid');
        addBlock(1328, 128, 128, 16, 'solid');
        addBlock(1344, 128, 16, 16, 'coin-box');
        addBlock(1408, 128, 16, 16, 'coffee-box'); // Fast coffee powerup

        // Large dual staircases (pyramids)
        // Pyramid 1
        addBlock(1700, 304, 16, 16, 'solid');
        addBlock(1716, 288, 16, 32, 'solid');
        addBlock(1732, 272, 16, 48, 'solid');
        addBlock(1748, 256, 16, 64, 'solid');

        addBlock(1820, 256, 16, 64, 'solid');
        addBlock(1836, 272, 16, 48, 'solid');
        addBlock(1852, 288, 16, 32, 'solid');
        addBlock(1868, 304, 16, 16, 'solid');

        // Trampoline springboard to reach high coins
        addBlock(2050, 304, 20, 16, 'spring');
        addItem(2052, 120, 'coin');
        addItem(2072, 100, 'coin');

        // Main staircase to flagpole
        let startStairX = 2380;
        for (let row = 0; row < 8; row++) {
          let stepW = (8 - row) * 16;
          let stepH = 16;
          addBlock(startStairX + row * 16, 320 - (row + 1) * 16, stepW, stepH, 'solid');
        }
        
        // Flagpole
        addBlock(2580, 80, 8, 240, 'flag');
        addBlock(2588, 288, 48, 32, 'solid'); // Castle base

        // Enemies
        addEnemy(380, 300, 'expense');
        addEnemy(600, 300, 'expense');
        addEnemy(1000, 300, 'expense');
        addEnemy(1400, 100, 'phish');
        addEnemy(1950, 300, 'expense');
      }

      // 1-2 Underground Mailroom (Lvl 1) - Classic Underground brick corridors with ceiling run
      else if (lvl === 1) {
        // Enclosed roof running the whole way
        addBlock(0, 0, 2800, 32, 'solid');

        // Ceiling run: platform overhead leaving a 24px gap at the top to walk on ceiling
        addBlock(120, 56, 1200, 16, 'solid');
        addBlock(1450, 56, 1100, 16, 'solid');

        // Stacks of brick corridors
        addBlock(250, 200, 160, 32, 'solid');
        addBlock(250, 200, 16, 16, 'coin-box');
        addBlock(350, 200, 16, 16, 'hardhat-box');

        // Elevator Shafts
        addBlock(550, 120, 48, 200, 'solid'); // wall divider
        addLift(490, 220, 48, 12, 'lift', 90, 'y', 1.0); // Moving elevator

        addBlock(900, 120, 64, 16, 'solid');
        addBlock(980, 220, 80, 16, 'solid');

        // Springboard to reach high ceiling walk
        addBlock(1200, 304, 20, 16, 'spring');

        addBlock(1500, 150, 128, 16, 'solid');
        addBlock(1560, 150, 16, 16, 'coffee-box');

        // Dual elevator blocks moving in opposite directions
        addLift(1800, 150, 48, 12, 'lift', 80, 'y', 0.9);
        addLift(1950, 250, 48, 12, 'lift', 80, 'y', -0.9);

        // Escalator stairs at end
        addBlock(2300, 272, 64, 48, 'solid');
        addBlock(2364, 224, 64, 96, 'solid');
        addBlock(2428, 176, 64, 144, 'solid');

        // Flag
        addBlock(2620, 80, 8, 240, 'flag');

        // Enemies
        addEnemy(300, 100, 'phish');
        addEnemy(750, 300, 'expense');
        addEnemy(1100, 300, 'expense');
        addEnemy(1600, 100, 'phish');
        addEnemy(2150, 300, 'expense');
      }

      // 1-3 Skyscraper Ledges (Lvl 2) - Athletic High gaps, clouds, trees
      else if (lvl === 2) {
        // Slice ground floor into narrow platforms and high drops
        platforms = []; // Clean ground
        addBlock(0, 320, 250, 40, 'solid');
        addBlock(450, 320, 180, 40, 'solid');
        addBlock(800, 320, 150, 40, 'solid');
        addBlock(1200, 320, 300, 40, 'solid');
        addBlock(1800, 320, 200, 40, 'solid');
        addBlock(2300, 320, 500, 40, 'solid');

        // Floating cloud steps
        addBlock(200, 220, 80, 16, 'solid');
        addBlock(320, 150, 80, 16, 'solid');
        addBlock(500, 220, 96, 16, 'solid');
        addBlock(650, 140, 80, 16, 'solid');
        addBlock(850, 220, 16, 16, 'duck-box');

        // Moving clouds
        addLift(1050, 180, 48, 12, 'lift', 120, 'x', 1.2); // Horizontal platform

        addBlock(1350, 200, 120, 16, 'solid');
        addBlock(1400, 200, 16, 16, 'coffee-box');

        addLift(1650, 240, 48, 12, 'lift', 80, 'y', 1.0); // Vertical elevator

        addBlock(1900, 140, 96, 16, 'solid');
        addBlock(2100, 200, 80, 16, 'solid');

        // Springboard to high floating cloud
        addBlock(2320, 304, 20, 16, 'spring');
        addBlock(2400, 120, 96, 16, 'solid');

        // Final flag
        addBlock(2650, 80, 8, 240, 'flag');

        // Enemies
        addEnemy(500, 180, 'phish');
        addEnemy(1400, 160, 'phish');
        addEnemy(2000, 100, 'phish');
      }

      // 2-1 IT Cyber Cloud (Lvl 4) - Cyber springboards and high-altitude stacks
      else if (lvl === 4) {
        addBlock(200, 240, 96, 16, 'solid');
        addBlock(240, 240, 16, 16, 'coin-box');
        
        // Trampolines stacks
        addBlock(450, 304, 20, 16, 'spring');
        addBlock(520, 180, 80, 16, 'solid');
        addBlock(650, 120, 80, 16, 'solid');
        addBlock(680, 120, 16, 16, 'hardhat-box');

        addLift(850, 180, 48, 12, 'lift', 90, 'y', 1.1);

        // Long conveyer segment
        addBlock(1050, 220, 250, 16, 'solid', 1.5); // Slipping right
        addBlock(1150, 120, 64, 16, 'solid');

        addBlock(1450, 304, 20, 16, 'spring');
        addBlock(1550, 180, 120, 16, 'solid');
        addBlock(1600, 180, 16, 16, 'coffee-box');

        // Twin lifts
        addLift(1900, 120, 48, 12, 'lift', 70, 'y', 1.2);
        addLift(2050, 260, 48, 12, 'lift', 70, 'y', -1.2);

        // Escalator
        addBlock(2300, 272, 64, 48, 'solid');
        addBlock(2364, 224, 64, 96, 'solid');

        addBlock(2600, 80, 8, 240, 'flag');

        addEnemy(550, 150, 'phish');
        addEnemy(1150, 200, 'bottleneck');
        addEnemy(1600, 300, 'expense');
        addEnemy(2100, 100, 'phish');
      }

      // 2-3 Factory Conveyor Line (Lvl 6) - Fast momentum changing belts and industrial traps
      else if (lvl === 6) {
        // Wide hazard gaps
        platforms = [];
        addBlock(0, 320, 300, 40, 'solid');
        addBlock(400, 320, 400, 40, 'solid');
        addBlock(900, 320, 300, 40, 'solid');
        addBlock(1300, 320, 400, 40, 'solid');
        addBlock(1850, 320, 350, 40, 'solid');
        addBlock(2300, 320, 500, 40, 'solid');

        // Conveyors going opposite directions
        addBlock(200, 220, 120, 16, 'solid', 2.0);  // pushes right
        addBlock(450, 160, 120, 16, 'solid', -2.0); // pushes left

        addBlock(750, 240, 16, 16, 'hardhat-box');
        
        // Trampolines and falling bottleneck weights
        addBlock(920, 304, 20, 16, 'spring');
        addBlock(1000, 140, 96, 16, 'solid');
        addEnemy(1000, 100, 'bottleneck');

        addBlock(1200, 200, 120, 16, 'solid', 1.8);
        addBlock(1450, 150, 16, 16, 'coffee-box');
        addBlock(1600, 220, 120, 16, 'solid', -1.8);

        addLift(1950, 180, 64, 12, 'lift', 100, 'x', 1.3);

        addBlock(2200, 240, 80, 16, 'solid');

        addBlock(2600, 80, 8, 240, 'flag');

        addEnemy(480, 120, 'phish');
        addEnemy(1250, 160, 'phish');
        addEnemy(1650, 180, 'phish');
        addEnemy(2350, 300, 'expense');
      }
    }

    // Level Builder 2: Fluid Coolant Vats Swimming Level (2-2 Underwater)
    function buildLiquidCoolantVats() {
      player.isSwimming = true;
      player.vy = 0;

      // Solid top and bottom borders (completely enclosed pipe vat)
      addBlock(0, 0, gameState.levelWidth, 32, 'solid');
      addBlock(0, 328, gameState.levelWidth, 32, 'solid');

      // Floating cooling grids inside coolant fluid (Maze structure)
      for (let x = 300; x < gameState.levelWidth - 300; x += 350) {
        addBlock(x, 32, 48, 120, 'solid');
        addBlock(x, 200, 48, 128, 'solid');

        addBlock(x + 180, 100, 48, 160, 'solid');

        // Floating reward items
        addItem(x + 90, 80, 'coin');
        addItem(x + 250, 260, 'coin');

        if (x % 700 === 0) {
          addItem(x + 90, 180, 'coffee');
        } else {
          addItem(x + 90, 180, 'duck'); // Glowing golden invincibility duck!
        }

        // Swim phish bugs
        addEnemy(x + 100, 120, 'phish');
        addEnemy(x + 220, 220, 'phish');
      }

      // Exit pipeline flagpole gate
      addBlock(gameState.levelWidth - 120, 120, 8, 200, 'flag');
    }

    // Level Builder 3: Castles (Firewall core rooms)
    function buildFirewallCastle(lvl) {
      // Solid steel mesh ceiling
      addBlock(0, 0, gameState.levelWidth, 32, 'solid');
      addBlock(0, 320, gameState.levelWidth, 40, 'solid');

      // 1-4 Security Firewall Boss (Lvl 3)
      if (lvl === 3) {
        // Rotating Cyber fire-bars
        addCyberBar(300, 160, 5, 0.025);
        addCyberBar(550, 200, 5, -0.02);
        addCyberBar(800, 140, 6, 0.03);

        addBlock(420, 200, 64, 16, 'solid');
        addBlock(680, 160, 64, 16, 'solid');

        // Mini-Blocker boss checkpoint room
        buildMiniBossDesk();
      }

      // 2-4 The Executive Boardroom core (Lvl 7)
      else if (lvl === 7) {
        // Advanced conveyors and dual rotating cyber firebar traps
        addBlock(220, 200, 96, 16, 'solid', 1.5);
        addCyberBar(270, 192, 6, 0.03);

        addBlock(450, 140, 96, 16, 'solid', -1.5);
        addCyberBar(500, 132, 6, -0.03);

        // Double firebar tunnel
        addBlock(700, 240, 120, 16, 'solid');
        addCyberBar(760, 232, 5, 0.035);
        addCyberBar(760, 232, 5, -0.035); // Overlapping reverse fire-bar!

        addLift(920, 200, 48, 12, 'lift', 80, 'y', 1.2);

        // Master Boardroom Boss Setup
        buildMasterBossRoom();
      }
    }

    function buildMiniBossDesk() {
      addBlock(1000, 240, 80, 16, 'solid');
      addBlock(1280, 240, 80, 16, 'solid');

      // Lava pit under boss bridge
      platforms = platforms.filter(p => !(p.x >= 1080 && p.x <= 1280 && p.y >= 320));
      addBlock(1080, 260, 200, 16, 'solid'); // The bridge itself!

      bossInstance = {
        x: 1140,
        y: 180,
        width: 60,
        height: 50,
        maxLife: 2, // 2 stomps for mini-boss
        shootCooldown: 80
      };

      // Synergy button switch
      addBlock(1290, 224, 16, 16, 'boss-switch');
    }

    function buildMasterBossRoom() {
      addBlock(1000, 240, 80, 16, 'solid');
      addBlock(1320, 240, 80, 16, 'solid');

      // Massive coolant vat lava pit under boss bridge
      platforms = platforms.filter(p => !(p.x >= 1080 && p.x <= 1320 && p.y >= 320));
      addBlock(1080, 260, 240, 16, 'solid'); // The main boss bridge!

      bossInstance = {
        x: 1150,
        y: 170,
        width: 80,
        height: 60,
        maxLife: 3, // 3 stomps for final boss
        shootCooldown: 90
      };

      addBlock(1332, 224, 16, 16, 'boss-switch');
    }

    // --- Core Physics Engine Loops ---

    function update() {
      if (gameState.state === 'playing') {
        updatePlaying();
      }

      // Particle physics update
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        
        // Fluid coolant density or normal air friction gravity
        const envGravity = gameState.currentLevel === 5 ? 0.04 : 0.15;
        p.vy += envGravity;
        p.life--;
        if (p.life <= 0) {
          particles.splice(i, 1);
        }
      }

      if (gameState.shakeTime > 0) gameState.shakeTime--;
    }

    function updatePlaying() {
      // Invincible star timers
      if (gameState.invincibilityTime > 0) {
        gameState.invincibilityTime--;
        // Spawn rainbow sparks trail
        if (Math.random() < 0.3) {
          const rainbowColors = ['#E98300', '#F59E0B', '#34D399', '#60A5FA', '#F472B6'];
          spawnParticle(player.x + Math.random() * player.width, player.y + player.height / 2, rainbowColors[Math.floor(Math.random() * rainbowColors.length)], 3, (Math.random() - 0.5) * 2, -Math.random(), 15);
        }
      }

      if (player.iframeTime > 0) {
        player.iframeTime--;
      }

      if (player.hasCoffee && player.coffeeTime > 0) {
        player.coffeeTime--;
        // Coffee steam puff from heels
        if (Math.random() < 0.2) {
          spawnParticle(player.x + 8, player.y + 20, '#ffffff', 2.5, (Math.random() - 0.5) * 2, -1, 10);
        }
        if (player.coffeeTime <= 0) {
          player.hasCoffee = false;
        }
      }

      // Check coolant level configuration
      const isVatLevel = (gameState.currentLevel === 5);
      player.isSwimming = isVatLevel;

      // 1. Controls processing
      const moveSpeed = player.hasCoffee ? player.baseSpeed * 1.5 : player.baseSpeed;
      
      // Reduce horizontal agility inside liquid coolant fluid
      const activeSpeed = player.isSwimming ? moveSpeed * 0.65 : moveSpeed;

      if (keys['ArrowLeft'] || keys['KeyA']) {
        player.vx = -activeSpeed;
        player.facingRight = false;
        player.runFrame++;
        
        // Puff footprints particles
        if (player.isGrounded && Math.random() < 0.25) {
          spawnParticle(player.x + 8, player.y + 22, 'rgba(255,255,255,0.4)', 2.5, Math.random() * 2, -Math.random(), 12);
        }
      } else if (keys['ArrowRight'] || keys['KeyD']) {
        player.vx = activeSpeed;
        player.facingRight = true;
        player.runFrame++;
        if (player.isGrounded && Math.random() < 0.25) {
          spawnParticle(player.x + 8, player.y + 22, 'rgba(255,255,255,0.4)', 2.5, -Math.random() * 2, -Math.random(), 12);
        }
      } else {
        player.vx = 0;
      }

      // Jump (swimming strokes vs high bounds vaults)
      if (keys['Space'] || keys['ArrowUp'] || keys['KeyW']) {
        if (!player.spacePressed) {
          if (player.isSwimming) {
            // Under water swim stroke
            player.vy = -3.2;
            playSynthSound('swim');
            // Coolant bubbles sparks
            for (let b = 0; b < 3; b++) {
              spawnParticle(player.x + 8, player.y + 12, '#60A5FA', 3, (Math.random() - 0.5) * 2, -Math.random() * 2 - 1, 30);
            }
          } else {
            // Balanced realistic jump height:
            // TEd: jumpForce 5.7. Sarah: jumpForce 5.9. Second jump is slightly softer at 4.2.
            const jumpsLimit = player.hasCoffee ? player.maxJumps + 1 : player.maxJumps;
            if (player.isGrounded || player.jumpsUsed < jumpsLimit) {
              let currentForce = 5.7;
              if (gameState.hero === 'sarah') {
                currentForce = player.jumpsUsed === 0 ? 5.9 : 4.4;
              } else {
                currentForce = player.jumpsUsed === 0 ? 5.7 : 4.2;
              }
              // If coffee-boosted, give a tiny speed multiplier but keep vertical heights balanced
              if (player.hasCoffee) {
                currentForce *= 1.08;
              }
              player.vy = -currentForce;
              player.isGrounded = false;
              player.jumpsUsed++;
              playSynthSound('jump');
              
              for (let k = 0; k < 6; k++) {
                spawnParticle(player.x + 8, player.y + 24, '#E98300', 2, (Math.random() - 0.5) * 3, Math.random() * 2 - 1, 10);
              }
            }
          }
          player.spacePressed = true;
        }
      } else {
        player.spacePressed = false;
      }

      // Environmental gravity forces
      const activeGravity = player.isSwimming ? 0.08 : 0.35;
      const terminalVel = player.isSwimming ? 2.5 : 9.0;
      
      player.vy += activeGravity;
      if (player.vy > terminalVel) player.vy = terminalVel;

      // Coordinate shifts
      player.x += player.vx;
      checkHorizontalCollisions();

      player.y += player.vy;
      checkVerticalCollisions();

      if (player.x < 0) player.x = 0;
      if (player.y > 360) {
        loseLife();
      }

      // Parallax scroll viewport camera
      const targetCamX = player.x - canvas.width / 2;
      gameState.cameraX = targetCamX;
      if (gameState.cameraX < 0) gameState.cameraX = 0;
      const maxCam = gameState.levelWidth - canvas.width;
      if (gameState.cameraX > maxCam) gameState.cameraX = maxCam;

      // 2. Platform lifts update
      liftPlatforms.forEach((lift) => {
        lift.angle += 0.02 * lift.speed;
        const drift = Math.sin(lift.angle) * lift.range;
        
        let oldX = lift.x;
        let oldY = lift.y;

        if (lift.axis === 'x') {
          lift.x = lift.xStart + drift;
        } else {
          lift.y = lift.yStart + drift;
        }

        // Carry player standing on lift
        if (checkOverlap(player, lift) && player.vy >= 0 && player.y + player.height - player.vy <= oldY + 4) {
          player.x += (lift.x - oldX);
          player.y = lift.y - player.height;
          player.vy = 0;
          player.isGrounded = true;
          player.jumpsUsed = 0;
        }
      });

      // 3. Cyber fire-bars rotation update
      cyberBars.forEach((bar) => {
        bar.angle += bar.speed;
        
        // Calculate coordinate points of each security node
        for (let n = 1; n <= bar.nodeCount; n++) {
          const nodeDist = n * 14;
          const nx = bar.x + Math.cos(bar.angle) * nodeDist;
          const ny = bar.y + Math.sin(bar.angle) * nodeDist;

          // Check node overlap with player body
          const nodeBound = { x: nx - 5, y: ny - 5, width: 10, height: 10 };
          if (checkOverlap(player, nodeBound)) {
            damagePlayer();
          }
        }
      });

      // 4. Power-ups items update
      items.forEach((item) => {
        if (item.collected) return;
        
        if (item.type !== 'coin') {
          item.vy += 0.25;
          item.x += item.vx;
          item.y += item.vy;

          if (item.y > 306) {
            item.y = 306;
            item.vy = -item.vy * 0.4;
            item.vx = item.vx * 0.8;
          }
        } else {
          item.yOffset = Math.sin(Date.now() / 200) * 3;
        }

        if (checkOverlap(player, item)) {
          collectItem(item);
        }
      });

      // 5. Enemies update
      enemies.forEach((enemy) => {
        if (!enemy.alive) return;

        enemy.animFrame++;

        if (enemy.type === 'expense' || enemy.type === 'phish') {
          enemy.x += enemy.vx;
          
          if (enemy.type === 'phish') {
            enemy.y = enemy.yStart + Math.sin(enemy.animFrame / 15) * 20;
          } else {
            platforms.forEach((p) => {
              if (checkOverlap(enemy, p) && p.type !== 'spring') {
                enemy.vx = -enemy.vx;
                enemy.x += enemy.vx * 2;
              }
            });
          }
        }

        if (checkOverlap(player, enemy)) {
          if (gameState.invincibilityTime > 0) {
            stompEnemy(enemy);
          } else if (player.vy > 0 && player.y + player.height - player.vy <= enemy.y + 4) {
            if (enemy.type === 'bottleneck') {
              damagePlayer(); 
            } else {
              player.vy = player.isSwimming ? -2.2 : -5.0; // swimming bounce is softer
              stompEnemy(enemy);
            }
          } else {
            damagePlayer();
          }
        }
      });

      // 6. Boss update
      if (bossInstance) {
        bossInstance.shootCooldown--;
        if (bossInstance.shootCooldown <= 0) {
          // Fire Legacy Disk projectile
          enemies.push({
            x: bossInstance.x + 30,
            y: bossInstance.y + 40,
            width: 14,
            height: 12,
            type: 'disk', 
            vx: player.x < bossInstance.x ? -2.4 : 2.4,
            vy: 0.4,
            alive: true,
            animFrame: 0
          });
          bossInstance.shootCooldown = 95;
          playSynthSound('jump');
        }

        for (let idx = enemies.length - 1; idx >= 0; idx--) {
          const enemy = enemies[idx];
          if (enemy.type === 'disk' && enemy.alive) {
            enemy.x += enemy.vx;
            enemy.y += enemy.vy;
            
            if (enemy.x < 0 || enemy.x > gameState.levelWidth || enemy.y > 360) {
              enemies.splice(idx, 1);
            }
          }
        }
      }
    }

    function checkOverlap(rect1, rect2) {
      return rect1.x < rect2.x + rect2.width &&
             rect1.x + rect1.width > rect2.x &&
             rect1.y < rect2.y + rect2.height &&
             rect1.y + rect1.height > rect2.y;
    }

    function checkHorizontalCollisions() {
      platforms.forEach((p) => {
        if (['flag', 'boss-switch'].includes(p.type)) return;
        if (checkOverlap(player, p)) {
          if (player.vx > 0) {
            player.x = p.x - player.width;
          } else if (player.vx < 0) {
            player.x = p.x + p.width;
          }
        }
      });
    }

    function checkVerticalCollisions() {
      let groundedThisFrame = false;
      
      platforms.forEach((p) => {
        if (checkOverlap(player, p)) {
          if (p.type === 'flag') {
            triggerLevelComplete();
            return;
          }

          if (p.type === 'boss-switch') {
            if (player.vy > 0 && player.y + player.height - player.vy <= p.y + 2) {
              stompBossSwitch(p);
            }
            return;
          }

          if (player.vy > 0) {
            player.y = p.y - player.height;
            player.vy = 0;
            groundedThisFrame = true;
            player.jumpsUsed = 0;
            
            // Conveyor Platform speed carry
            if (p.conveyorSpeed !== 0) {
              player.x += p.conveyorSpeed;
            }

            // Springboard Trampoline bounce
            if (p.type === 'spring') {
              player.vy = -10.5; // mega jump
              player.isGrounded = false;
              playSynthSound('jump');
              p.squashTimer = 10; // Trigger squash animation
              
              // Spark effects
              for (let i = 0; i < 8; i++) {
                spawnParticle(p.x + 10, p.y, '#E98300', 3, (Math.random() - 0.5) * 4, -Math.random() * 3 - 2, 15);
              }
            }
          } else if (player.vy < 0) {
            player.y = p.y + p.height;
            player.vy = 0;
            
            if (p.type.includes('-box')) {
              hitMysteryBox(p);
            }
          }
        }
      });
      player.isGrounded = groundedThisFrame;
    }

    function hitMysteryBox(box) {
      const originalType = box.type;
      box.type = 'solid'; 
      gameState.shakeTime = 5;
      playSynthSound('coin');

      const px = box.x + 1;
      const py = box.y - 18;

      if (originalType === 'coin-box') {
        gameState.score += 10;
        gameState.xp += 10;
        playSynthSound('coin');
        for (let i = 0; i < 5; i++) {
          spawnParticle(box.x + 8, box.y, '#F59E0B', 3, (Math.random() - 0.5) * 4, -Math.random() * 3 - 2, 20);
        }
      } else if (originalType === 'hardhat-box') {
        addItem(px, py, 'hardhat');
        items[items.length - 1].vy = -3.5;
        items[items.length - 1].vx = 1.0;
      } else if (originalType === 'duck-box') {
        addItem(px, py, 'duck');
        items[items.length - 1].vy = -4.0;
        items[items.length - 1].vx = -1.2;
      } else {
        addItem(px, py, 'coffee');
        items[items.length - 1].vy = -3.5;
        items[items.length - 1].vx = 0.8;
      }
    }

    function stompBossSwitch(sw) {
      player.vy = player.isSwimming ? -2.5 : -4.5;
      gameState.shakeTime = 12;
      playSynthSound('stomp');

      triggerConfettiAt(sw.x + 8, sw.y + 8);

      gameState.bossHits++;
      if (gameState.bossHits >= bossInstance.maxLife) {
        triggerBossDefeat();
      } else {
        gameState.shakeTime = 15;
      }
    }

    function collectItem(item) {
      item.collected = true;
      triggerConfettiAt(item.x + 7, item.y + 7);

      if (item.type === 'coin') {
        gameState.score += 10;
        gameState.xp += 10;
        playSynthSound('coin');
      } else if (item.type === 'hardhat') {
        player.hasHardhat = true;
        playSynthSound('powerup');
      } else if (item.type === 'coffee') {
        player.hasCoffee = true;
        player.coffeeTime = 600; 
        playSynthSound('powerup');
      } else if (item.type === 'duck') {
        gameState.invincibilityTime = 500; 
        playSynthSound('powerup');
        playStarMusic();
      }
    }

    function stompEnemy(enemy) {
      enemy.alive = false;
      playSynthSound('stomp');
      gameState.score += 25;
      gameState.xp += 25;

      const particlesColor = enemy.type === 'phish' ? '#34D399' : '#EF4444';
      for (let i = 0; i < 15; i++) {
        spawnParticle(
          enemy.x + enemy.width / 2,
          enemy.y + enemy.height / 2,
          particlesColor,
          enemy.type === 'phish' ? 3 : 2,
          (Math.random() - 0.5) * 6,
          -Math.random() * 4 - 1,
          25
        );
      }
    }

    function damagePlayer() {
      if (player.iframeTime > 0) return;

      if (player.hasHardhat) {
        player.hasHardhat = false; 
        player.iframeTime = 60;
        playSynthSound('hurt');
        for (let s = 0; s < 10; s++) {
          spawnParticle(player.x + 8, player.y + 12, '#F59E0B', 3, (Math.random() - 0.5) * 5, -Math.random() * 3, 20);
        }
      } else {
        loseLife();
      }
    }

    function loseLife() {
      gameState.lives--;
      playSynthSound('hurt');
      
      if (gameState.lives <= 0) {
        gameState.state = 'gameover';
        stopBGM();
        stopStarMusic();
      } else {
        player.x = 80;
        player.y = 150;
        player.vx = 0;
        player.vy = 0;
        player.iframeTime = 90; 
        player.hasCoffee = false;
      }
    }

    function triggerLevelComplete() {
      stopBGM();
      stopStarMusic();
      playSynthSound('victory');
      triggerConfettiAt(player.x, player.y);

      if (gameState.currentLevel < 7) {
        setTimeout(() => {
          loadLevel(gameState.currentLevel + 1);
          playBGM();
        }, 1500);
      } else {
        gameState.state = 'victory';
      }
    }

    function triggerBossDefeat() {
      stopBGM();
      stopStarMusic();
      playSynthSound('victory');
      
      triggerConfettiAt(bossInstance.x + 40, bossInstance.y + 30);
      gameState.shakeTime = 30;

      enemies = [];
      bossInstance = null;

      setTimeout(() => {
        triggerLevelComplete();
      }, 1200);
    }

    // --- Dynamic 3D Sprite Rendering Canvas ---

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.save();
      if (gameState.shakeTime > 0) {
        const shakeX = (Math.random() - 0.5) * 6;
        const shakeY = (Math.random() - 0.5) * 6;
        ctx.translate(shakeX, shakeY);
      }

      if (gameState.state === 'select') {
        drawSelectScreen();
      } else if (gameState.state === 'playing') {
        ctx.translate(-gameState.cameraX, 0);
        drawParallaxBackdrop();
        drawStaticPlatforms();
        drawItems();
        drawEnemies();
        drawBoss();
        drawParticles();
        drawPlayer();
        
        // Swim fluid coolant filter overlay
        if (player.isSwimming) {
          ctx.fillStyle = 'rgba(36, 76, 90, 0.25)';
          ctx.fillRect(gameState.cameraX, 0, canvas.width, canvas.height);
        }
        
        ctx.restore();
        drawHUD();
      } else if (gameState.state === 'gameover') {
        drawGameOverScreen();
      } else if (gameState.state === 'victory') {
        ctx.translate(-gameState.cameraX, 0);
        drawParallaxBackdrop();
        drawStaticPlatforms();
        drawParticles();
        ctx.restore();
        drawVictoryScreen();
      }
      
      // Draw CRT arcade effects for absolute realism
      drawCRTOverlay();
    }

    function drawCRTOverlay() {
      // 1. Curved screen glass glare (white gloss gradient)
      const glossGrad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
      glossGrad.addColorStop(0.3, 'rgba(255, 255, 255, 0.03)');
      glossGrad.addColorStop(0.32, 'rgba(255, 255, 255, 0)');
      glossGrad.addColorStop(1, 'rgba(0, 0, 0, 0.2)');
      ctx.fillStyle = glossGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // 2. Curved vignette corner shadows
      const vignette = ctx.createRadialGradient(canvas.width / 2, canvas.height / 2, 220, canvas.width / 2, canvas.height / 2, 380);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.65)');
      ctx.fillStyle = vignette;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawSelectScreen() {
      const bgGrad = ctx.createRadialGradient(320, 180, 50, 320, 180, 300);
      bgGrad.addColorStop(0, '#10222b');
      bgGrad.addColorStop(1, '#050a0d');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.font = '700 20px "Outfit", "Inter", sans-serif';
      ctx.fillStyle = '#E98300';
      ctx.textAlign = 'center';
      ctx.shadowColor = '#E98300';
      ctx.shadowBlur = 10;
      ctx.fillText(dict.selectHero, 320, 60);
      ctx.shadowBlur = 0;

      // Sarah Card
      const isSarah = gameState.hero === 'sarah';
      ctx.fillStyle = isSarah ? 'rgba(233, 131, 0, 0.12)' : 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = isSarah ? '#E98300' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = isSarah ? 2.5 : 1;
      ctx.beginPath();
      ctx.roundRect(80, 110, 200, 160, 8);
      ctx.fill();
      ctx.stroke();
      drawSarahVector(180, 170, true, false, false);
      ctx.fillStyle = isSarah ? '#E98300' : '#ffffff';
      ctx.font = '700 13px sans-serif';
      ctx.fillText(dict.sarahName, 180, 220);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '11px sans-serif';
      ctx.fillText(dict.sarahStats, 180, 245);

      // TEd Card (Rebranded from Karsten)
      const isTed = gameState.hero === 'ted';
      ctx.fillStyle = isTed ? 'rgba(36, 76, 90, 0.25)' : 'rgba(255,255,255,0.03)';
      ctx.strokeStyle = isTed ? '#244C5A' : 'rgba(255,255,255,0.15)';
      ctx.lineWidth = isTed ? 2.5 : 1;
      ctx.beginPath();
      ctx.roundRect(360, 110, 200, 160, 8);
      ctx.fill();
      ctx.stroke();
      drawTedVector(460, 170, true, false, false);
      ctx.fillStyle = isTed ? '#60A5FA' : '#ffffff';
      ctx.font = '700 13px sans-serif';
      ctx.fillText(dict.tedName, 460, 220);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = '11px sans-serif';
      ctx.fillText(dict.tedStats, 460, 245);

      ctx.font = '11px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(dict.startPrompt, 320, 310);
    }

    function drawParallaxBackdrop() {
      let grad = ctx.createLinearGradient(0, 0, 0, 360);
      const wIdx = gameState.currentLevel;
      
      if (wIdx === 1 || wIdx === 3 || wIdx === 7) {
        // Dark Castles / undergrounds
        grad.addColorStop(0, '#0a0a0f');
        grad.addColorStop(1, '#1a1010');
      } else if (wIdx === 5) {
        // Swim deep blue coolant
        grad.addColorStop(0, '#0f242e');
        grad.addColorStop(1, '#050c10');
      } else {
        // Sky overworld
        grad.addColorStop(0, '#0a1d28');
        grad.addColorStop(1, '#1b3b4d');
      }
      
      ctx.fillStyle = grad;
      ctx.fillRect(gameState.cameraX, 0, canvas.width, canvas.height);

      // Parallax City silhouettes
      parallaxLayers.forEach((layer) => {
        ctx.fillStyle = layer.color;
        const xOffset = -(gameState.cameraX * layer.speed) % 180;
        
        for (let x = -50; x < canvas.width + 100; x += 120) {
          const w = 90;
          const h = 180 + Math.sin(x) * 45;
          ctx.fillRect(gameState.cameraX + x + xOffset, 320 - h, w, h);
          
          ctx.fillStyle = 'rgba(233, 131, 0, 0.07)';
          for (let wy = 320 - h + 20; wy < 300; wy += 25) {
            ctx.fillRect(gameState.cameraX + x + xOffset + 15, wy, 15, 10);
            ctx.fillRect(gameState.cameraX + x + xOffset + 50, wy, 15, 10);
          }
          ctx.fillStyle = layer.color; 
        }
      });
    }

    // Realistic 3D Platform Drawing
    function drawStaticPlatforms() {
      // First draw drop shadows for all standard platforms for 3D realism
      platforms.forEach((p) => {
        if (p.type === 'flag') return;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
        ctx.beginPath();
        ctx.roundRect(p.x + 4, p.y + 4, p.width, p.height, p.type.includes('cloud') ? 6 : 2);
        ctx.fill();
      });

      // Now draw the actual platforms
      platforms.forEach((p) => {
        if (p.type === 'flag') {
          // 3D flagpole
          ctx.fillStyle = '#6b7280';
          ctx.fillRect(p.x + 3, p.y, 3, p.height);
          // Highlight
          ctx.fillStyle = '#9ca3af';
          ctx.fillRect(p.x + 3, p.y, 1, p.height);

          // Gold finial sphere
          const sphereGrad = ctx.createRadialGradient(p.x + 4.5, p.y - 2, 0, p.x + 4.5, p.y - 2, 4);
          sphereGrad.addColorStop(0, '#fef08a');
          sphereGrad.addColorStop(1, '#ca8a04');
          ctx.fillStyle = sphereGrad;
          ctx.beginPath();
          ctx.arc(p.x + 4.5, p.y - 2, 4, 0, Math.PI * 2);
          ctx.fill();

          // Waving flag
          const flagWave = Math.sin(Date.now() / 150) * 3;
          ctx.fillStyle = '#E98300';
          ctx.beginPath();
          ctx.moveTo(p.x + 6, p.y + 10);
          ctx.quadraticCurveTo(p.x + 22, p.y + 10 + flagWave, p.x + 40, p.y + 14);
          ctx.lineTo(p.x + 40, p.y + 36);
          ctx.quadraticCurveTo(p.x + 22, p.y + 32 + flagWave, p.x + 6, p.y + 32);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('TE', p.x + 23, p.y + 24 + flagWave * 0.5);
          return;
        }

        if (p.type === 'boss-switch') {
          // Realistic big industrial red button
          ctx.fillStyle = '#3f0c0c';
          ctx.fillRect(p.x, p.y + 10, p.width, 6);
          ctx.fillStyle = '#ef4444'; 
          ctx.fillRect(p.x + 2, p.y + 4, p.width - 4, 6);
          // Shine
          ctx.fillStyle = '#fca5a5';
          ctx.fillRect(p.x + 4, p.y + 4, 3, 2);
          return;
        }

        if (p.type === 'spring') {
          // Bouncy metal coil springboard
          const squash = p.squashTimer > 0 ? 6 : 14;
          if (p.squashTimer > 0) p.squashTimer--;
          
          ctx.strokeStyle = '#9ca3af';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(p.x + 4, p.y + 16);
          ctx.lineTo(p.x + 16, p.y + 16 - squash * 0.33);
          ctx.lineTo(p.x + 4, p.y + 16 - squash * 0.66);
          ctx.lineTo(p.x + 16, p.y + 16 - squash);
          ctx.stroke();

          // Safety top plate
          ctx.fillStyle = '#E98300';
          ctx.fillRect(p.x - 2, p.y + 16 - squash - 3, p.width + 4, 4);
          ctx.fillStyle = '#fdbb2d';
          ctx.fillRect(p.x - 2, p.y + 16 - squash - 3, p.width + 4, 1.5);
          return;
        }

        // Programmatic Textures based on Levels
        const wIdx = gameState.currentLevel;
        if (p.type.includes('-box')) {
          drawItemBoxTexture(p.x, p.y, p.width, p.height);
        } else if (wIdx === 1) {
          // 1-2 Underground Brick
          drawBrickTexture(p.x, p.y, p.width, p.height);
        } else if (wIdx === 2 || wIdx === 4) {
          // 1-3 Sky Cloud platforms
          drawCloudPlatformTexture(p.x, p.y, p.width, p.height);
        } else if (wIdx === 3) {
          // 1-4 Security Firewall server mesh
          drawServerMeshTexture(p.x, p.y, p.width, p.height);
        } else if (wIdx === 6) {
          // 2-3 Factory conveyor safety girders
          drawFactoryGirderTexture(p.x, p.y, p.width, p.height, p.conveyorSpeed !== 0);
        } else if (wIdx === 7) {
          // 2-4 Boardroom polished mahogany
          drawBoardroomTexture(p.x, p.y, p.width, p.height);
        } else {
          // Standard linoleum floor
          drawOfficeFloorTexture(p.x, p.y, p.width, p.height);
        }
      });

      // Draw sliding lift platforms
      liftPlatforms.forEach((lift) => {
        ctx.fillStyle = '#374151';
        ctx.fillRect(lift.x, lift.y, lift.width, lift.height);
        
        // Steel plate highlights
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(lift.x, lift.y, lift.width, 2);
        
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1;
        ctx.strokeRect(lift.x, lift.y, lift.width, lift.height);

        // Rivets details
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(lift.x + 3, lift.y + 3, 2, 2);
        ctx.fillRect(lift.x + lift.width - 5, lift.y + 3, 2, 2);
      });

      // Draw rotating cyber security fire-bars
      cyberBars.forEach((bar) => {
        // Draw center pivot hub
        ctx.fillStyle = '#EF4444';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(bar.x, bar.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Draw rotating nodes
        for (let n = 1; n <= bar.nodeCount; n++) {
          const nodeDist = n * 14;
          const nx = bar.x + Math.cos(bar.angle) * nodeDist;
          const ny = bar.y + Math.sin(bar.angle) * nodeDist;

          ctx.shadowColor = '#EF4444';
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#EF4444';
          ctx.beginPath();
          ctx.arc(nx, ny, 5, 0, Math.PI * 2);
          ctx.fill();
          
          // Connect cables lines
          ctx.shadowBlur = 0;
          ctx.strokeStyle = 'rgba(239, 68, 68, 0.4)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(bar.x, bar.y);
          ctx.lineTo(nx, ny);
          ctx.stroke();
        }
      });
    }

    // --- Procedural 3D Textures ---

    function drawOfficeFloorTexture(x, y, w, h) {
      // 3D linoleum tiled green carpet office block
      const floorGrad = ctx.createLinearGradient(x, y, x, y + h);
      floorGrad.addColorStop(0, '#2e5c48');
      floorGrad.addColorStop(1, '#1e3c2f');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(x, y, w, h);
      
      // Tile borders
      ctx.strokeStyle = '#162e24';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);

      // Floor sheen highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.beginPath();
      ctx.moveTo(x + 1, y + 1);
      ctx.lineTo(x + w - 1, y + 1);
      ctx.stroke();
    }

    function drawBrickTexture(x, y, w, h) {
      // 3D textured bricks
      ctx.fillStyle = '#421a0f'; // Mortar dark backdrop
      ctx.fillRect(x, y, w, h);

      const brickH = 8;
      const brickW = 16;

      for (let rY = y; rY < y + h; rY += brickH) {
        const offset = (rY % 16 === 0) ? 8 : 0;
        for (let bX = x - offset; bX < x + w + 8; bX += brickW) {
          // Draw individual brick block
          const bx = Math.max(x, bX);
          const bw = Math.min(x + w - bx, brickW - (bx - bX));
          if (bw <= 0) continue;

          ctx.fillStyle = '#6e2b19'; // Brick base
          ctx.fillRect(bx, rY, bw, brickH);

          // 3D highlights (Top and left)
          ctx.fillStyle = '#8f3c26';
          ctx.fillRect(bx, rY, bw, 1);
          ctx.fillRect(bx, rY, 1, brickH);

          // 3D shadows (Bottom and right)
          ctx.fillStyle = '#291009';
          ctx.fillRect(bx, rY + brickH - 1, bw, 1);
          ctx.fillRect(bx + bw - 1, rY, 1, brickH);

          // Random cracks for realism
          if ((bx + rY) % 57 === 0) {
            ctx.strokeStyle = '#291009';
            ctx.beginPath();
            ctx.moveTo(bx + 3, rY + 1);
            ctx.lineTo(bx + 6, rY + 5);
            ctx.stroke();
          }
        }
      }
    }

    function drawCloudPlatformTexture(x, y, w, h) {
      // Shaded puffy cyber cloud platform
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, '#f0f9ff');
      grad.addColorStop(0.3, '#bae6fd');
      grad.addColorStop(1, '#0284c7');
      ctx.fillStyle = grad;
      
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 6);
      ctx.fill();

      // Fluffy bubble edges
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.beginPath();
      ctx.arc(x + 10, y + 3, 5, 0, Math.PI * 2);
      ctx.arc(x + w - 10, y + 3, 5, 0, Math.PI * 2);
      ctx.arc(x + w / 2, y + 2, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawServerMeshTexture(x, y, w, h) {
      // Technical server mesh cabinet
      ctx.fillStyle = '#0f172a'; // Deep slate
      ctx.fillRect(x, y, w, h);

      // Technical mesh slots patterns
      ctx.fillStyle = '#020617';
      for (let sy = y + 4; sy < y + h - 2; sy += 6) {
        for (let sx = x + 4; sx < x + w - 4; sx += 8) {
          ctx.fillRect(sx, sy, 5, 3);
        }
      }

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);

      // Corner rivets with highlights
      ctx.fillStyle = '#64748b';
      ctx.fillRect(x + 2, y + 2, 2, 2);
      ctx.fillRect(x + w - 4, y + 2, 2, 2);

      // Neon blinking circuits (Active networking traces)
      const isBlink = (Math.floor(Date.now() / 300) % 2 === 0);
      ctx.fillStyle = isBlink ? '#38bdf8' : '#0284c7';
      ctx.fillRect(x + 4, y + h - 6, 2, 2);
      ctx.fillStyle = isBlink ? '#f43f5e' : '#9f1239';
      ctx.fillRect(x + 10, y + h - 6, 2, 2);
    }

    function drawFactoryGirderTexture(x, y, w, h, isConveyor = false) {
      // 3D Steel frame girder
      ctx.fillStyle = '#18181b';
      ctx.fillRect(x, y, w, h);

      // Warning hazard stripes (sweeps in conveyor speed)
      ctx.fillStyle = '#E98300';
      const stripeOffset = isConveyor ? (Date.now() / 45) % 24 : 0;
      for (let sx = x - 24 + stripeOffset; sx < x + w; sx += 24) {
        ctx.beginPath();
        ctx.moveTo(sx, y);
        ctx.lineTo(sx + 10, y);
        ctx.lineTo(sx + 10 + h, y + h);
        ctx.lineTo(sx + h, y + h);
        ctx.closePath();
        ctx.fill();
      }

      ctx.strokeStyle = '#3f3f46';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);

      // If active conveyor belt, draw rolling gears at ends
      if (isConveyor) {
        const angle = (Date.now() / 120);
        ctx.save();
        ctx.translate(x + 4, y + h / 2);
        ctx.rotate(angle);
        ctx.strokeStyle = '#71717a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-3, -3, 6, 6);
        ctx.restore();

        ctx.save();
        ctx.translate(x + w - 4, y + h / 2);
        ctx.rotate(angle);
        ctx.strokeStyle = '#71717a';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(-3, -3, 6, 6);
        ctx.restore();
      }
    }

    function drawBoardroomTexture(x, y, w, h) {
      // Highly polished mahogany wood board
      const woodGrad = ctx.createLinearGradient(x, y, x, y + h);
      woodGrad.addColorStop(0, '#581c1c');
      woodGrad.addColorStop(1, '#2d0a0a');
      ctx.fillStyle = woodGrad;
      ctx.fillRect(x, y, w, h);

      // Swirling wood knots grain lines
      ctx.strokeStyle = 'rgba(45, 10, 10, 0.4)';
      ctx.lineWidth = 1.5;
      for (let gy = y + 2; gy < y + h; gy += 5) {
        ctx.beginPath();
        ctx.arc(x + w / 2, gy - 120, 120 + (gy % 3), 0, Math.PI);
        ctx.stroke();
      }

      // Specular table shine
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.lineTo(x + w, y + 6);
      ctx.lineTo(x + w, y + 12);
      ctx.lineTo(x, y + 8);
      ctx.closePath();
      ctx.fill();

      // Gold border trim
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, w, h);
    }

    function drawItemBoxTexture(x, y, w, h) {
      // 3D metallic glowing integration box
      const boxGrad = ctx.createLinearGradient(x, y, x + w, y + h);
      boxGrad.addColorStop(0, '#f59e0b');
      boxGrad.addColorStop(0.5, '#E98300');
      boxGrad.addColorStop(1, '#b45309');
      ctx.fillStyle = boxGrad;
      
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 4);
      ctx.fill();

      // 3D borders
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);

      // Flashing glowing question mark
      const qScale = 1 + Math.sin(Date.now() / 150) * 0.12;
      ctx.save();
      ctx.translate(x + w / 2, y + h / 2 + 1);
      ctx.scale(qScale, qScale);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('?', 0, 3.5);
      ctx.restore();

      // Corner rivets
      ctx.fillStyle = '#fef08a';
      ctx.fillRect(x + 2, y + 2, 1.5, 1.5);
      ctx.fillRect(x + w - 3.5, y + 2, 1.5, 1.5);
      ctx.fillRect(x + 2, y + h - 3.5, 1.5, 1.5);
      ctx.fillRect(x + w - 3.5, y + h - 3.5, 1.5, 1.5);
    }

    // --- Dynamic Items Rendering ---
    function drawItems() {
      items.forEach((item) => {
        if (item.collected) return;

        const y = item.y + item.yOffset;

        if (item.type === 'coin') {
          // Spinning 3D perspective metallic coin
          const spinScale = Math.sin(Date.now() / 120);
          ctx.save();
          ctx.translate(item.x + 7, y + 7);
          ctx.scale(Math.abs(spinScale), 1.0);

          ctx.shadowColor = '#F59E0B';
          ctx.shadowBlur = 10;

          const coinGrad = ctx.createRadialGradient(-1, -1, 0, 0, 0, 6);
          coinGrad.addColorStop(0, '#fef08a');
          coinGrad.addColorStop(1, '#ca8a04');
          ctx.fillStyle = coinGrad;
          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, Math.PI * 2);
          ctx.fill();

          ctx.shadowBlur = 0;
          ctx.strokeStyle = '#a16207';
          ctx.lineWidth = 1;
          ctx.stroke();

          // Coin highlight shine
          ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.beginPath();
          ctx.ellipse(-2, -2, 1.5, 3, Math.PI / 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.restore();
        } else if (item.type === 'hardhat') {
          // Detailed 3D yellow safety hardhat
          ctx.fillStyle = '#fdbb2d';
          ctx.beginPath();
          ctx.arc(item.x + 7, y + 6, 6, Math.PI, 0); 
          ctx.fill();
          ctx.fillRect(item.x + 1, y + 6, 12, 2.5); // Brim

          // Helmet band
          ctx.fillStyle = '#eab308';
          ctx.fillRect(item.x + 3, y + 4, 8, 1.5);

          // Flashing active red beacon light
          const blink = (Math.floor(Date.now() / 150) % 2 === 0);
          ctx.fillStyle = blink ? '#ef4444' : '#7f1d1d';
          ctx.fillRect(item.x + 5.5, y + 0.5, 3, 2);
        } else if (item.type === 'coffee') {
          // Detailed corporate steaming coffee cup
          ctx.fillStyle = '#f8fafc'; // White cup
          ctx.beginPath();
          ctx.roundRect(item.x + 3, y + 3, 8, 10, [0, 0, 2, 2]);
          ctx.fill();
          // Cardboard brown sleeve
          ctx.fillStyle = '#ca8a04';
          ctx.fillRect(item.x + 3, y + 5.5, 8, 4.5);
          // Dark plastic lid
          ctx.fillStyle = '#1e293b';
          ctx.fillRect(item.x + 2, y + 1, 10, 2.5);

          // Steam particles rising
          const steamPhase = (Date.now() / 250) % 4;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(item.x + 5, y - 1);
          ctx.quadraticCurveTo(item.x + 7, y - 3 - steamPhase, item.x + 5, y - 5 - steamPhase);
          ctx.stroke();
        } else if (item.type === 'duck') {
          // Invincible Golden Teodor Duck
          const isGold = (Math.floor(Date.now() / 100) % 2 === 0);
          ctx.fillStyle = isGold ? '#fdbb2d' : '#f59e0b';
          ctx.beginPath();
          ctx.arc(item.x + 6, y + 8, 5, 0, Math.PI * 2); // Body
          ctx.fill();
          ctx.beginPath();
          ctx.arc(item.x + 9, y + 4, 3.5, 0, Math.PI * 2); // Head
          ctx.fill();
          // Orange beak
          ctx.fillStyle = '#ea580c';
          ctx.fillRect(item.x + 11.5, y + 3, 3, 1.5);
        }
      });
    }

    // --- Dynamic 3D Enemies Rendering ---
    function drawEnemies() {
      enemies.forEach((enemy) => {
        if (!enemy.alive) return;

        enemy.animFrame++;

        if (enemy.type === 'expense') {
          // 3D detailed crumpled Expense report receipt
          ctx.fillStyle = '#f8fafc'; 
          ctx.strokeStyle = '#ef4444'; // Red borders
          ctx.lineWidth = 1;
          
          ctx.save();
          ctx.shadowColor = 'rgba(0,0,0,0.3)';
          ctx.shadowBlur = 4;
          ctx.beginPath();
          ctx.roundRect(enemy.x, enemy.y, enemy.width, enemy.height, 1);
          ctx.fill();
          ctx.stroke();
          ctx.restore();

          // Green beveled checkmark
          ctx.strokeStyle = '#22c55e';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(enemy.x + 3, enemy.y + 4);
          ctx.lineTo(enemy.x + 5, enemy.y + 6);
          ctx.lineTo(enemy.x + 8, enemy.y + 2);
          ctx.stroke();

          // Red stamp warning stamp: "OVERDUE"
          ctx.fillStyle = '#dc2626';
          ctx.font = 'bold 5px monospace';
          ctx.fillText("OVERDUE", enemy.x + 3, enemy.y + 11);

          // Moving legs with boots
          ctx.fillStyle = '#0f172a';
          const legPhase = Math.sin(enemy.animFrame / 4) * 3;
          ctx.fillRect(enemy.x + 3, enemy.y + enemy.height, 2, 4 + legPhase);
          ctx.fillRect(enemy.x + 11, enemy.y + enemy.height, 2, 4 - legPhase);
        } else if (enemy.type === 'phish') {
          // Cybersecurity Phish Bug
          const scale = 1 + Math.sin(enemy.animFrame / 6) * 0.12;
          ctx.save();
          ctx.translate(enemy.x + 9, enemy.y + 7);
          ctx.scale(scale, scale);
          
          // Bug base
          ctx.fillStyle = '#064e3b';
          ctx.beginPath();
          ctx.arc(0, 0, 6, 0, Math.PI * 2);
          ctx.fill();

          // Menacing neon red glowing eyes
          ctx.fillStyle = '#ef4444';
          ctx.beginPath();
          ctx.arc(-2, -2, 1.5, 0, Math.PI * 2);
          ctx.arc(2, -2, 1.5, 0, Math.PI * 2);
          ctx.fill();

          // Fast fluttering translucent cyber-wings
          const wingAngle = Math.sin(Date.now() / 40) * 0.5;
          ctx.save();
          ctx.rotate(wingAngle);
          ctx.fillStyle = 'rgba(96, 165, 250, 0.4)';
          ctx.beginPath();
          ctx.ellipse(-7, -4, 4, 7, Math.PI / 4, 0, Math.PI * 2);
          ctx.ellipse(7, -4, 4, 7, -Math.PI / 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          
          ctx.restore();
        } else if (enemy.type === 'bottleneck') {
          // Industrial warning barrel barricade
          ctx.fillStyle = '#374151'; 
          ctx.strokeStyle = '#111827';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(enemy.x, enemy.y, enemy.width, enemy.height, 2);
          ctx.fill();
          ctx.stroke();

          // Orange warning stripes
          ctx.fillStyle = '#E98300';
          ctx.fillRect(enemy.x + 1, enemy.y + 3, enemy.width - 2, 3);
          ctx.fillRect(enemy.x + 1, enemy.y + 9, enemy.width - 2, 3);

          // Blinking hazard beacon light on top
          const isFlash = (Math.floor(Date.now() / 200) % 2 === 0);
          ctx.fillStyle = isFlash ? '#f59e0b' : '#78350f';
          ctx.fillRect(enemy.x + 6, enemy.y - 3, 4, 3);
        } else if (enemy.type === 'disk') {
          // 3D floppy disk projectile
          ctx.fillStyle = '#dc2626'; // Retro red disk
          ctx.strokeStyle = '#991b1b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(enemy.x, enemy.y, enemy.width, enemy.height, 1);
          ctx.fill();
          ctx.stroke();

          // Metallic write slider shield
          ctx.fillStyle = '#9ca3af';
          ctx.fillRect(enemy.x + 3, enemy.y + 1, 5, 4);

          // Shards sparks tail
          if (Math.random() < 0.3) {
            spawnParticle(enemy.x + 7, enemy.y + 6, '#dc2626', 2, -enemy.vx * 0.2, 0, 8);
          }
        }
      });
    }

    function drawBoss() {
      if (!bossInstance) return;

      // 3D Server Blocker Boss cabinet
      ctx.fillStyle = '#1e293b'; 
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(bossInstance.x, bossInstance.y, bossInstance.width, bossInstance.height, 6);
      ctx.fill();
      ctx.stroke();

      // Glowing interior server motherboard
      ctx.fillStyle = '#020617'; 
      ctx.fillRect(bossInstance.x + 6, bossInstance.y + 6, bossInstance.width - 12, bossInstance.height - 18);

      // Bouncing LED matrix text screen
      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 9px monospace';
      ctx.textAlign = 'center';
      const glitchText = (Math.random() < 0.15) ? "SYS ERR" : "LEGACY 1.0";
      ctx.fillText(glitchText, bossInstance.x + bossInstance.width / 2, bossInstance.y + 28);

      // Rotating spinning cooling fans
      const fanAngle = (Date.now() / 80);
      ctx.fillStyle = '#334155';
      ctx.save();
      ctx.translate(bossInstance.x + 20, bossInstance.y + bossInstance.height - 10);
      ctx.rotate(fanAngle);
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillRect(-2, -6, 4, 12);
      ctx.restore();

      ctx.save();
      ctx.translate(bossInstance.x + bossInstance.width - 20, bossInstance.y + bossInstance.height - 10);
      ctx.rotate(fanAngle);
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillRect(-2, -6, 4, 12);
      ctx.restore();

      // Blinker LED warning rows
      const blink = (Math.floor(Date.now() / 150) % 2 === 0);
      ctx.fillStyle = blink ? '#22c55e' : '#14532d';
      ctx.fillRect(bossInstance.x + 8, bossInstance.y + 8, 3, 3);
      ctx.fillStyle = blink ? '#ef4444' : '#7f1d1d';
      ctx.fillRect(bossInstance.x + 14, bossInstance.y + 8, 3, 3);

      // Health bar
      const hpWidth = (bossInstance.width - 12) * ((bossInstance.maxLife - gameState.bossHits) / bossInstance.maxLife);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(bossInstance.x + 6, bossInstance.y - 12, bossInstance.width - 12, 6);
      ctx.fillStyle = '#ef4444'; 
      ctx.fillRect(bossInstance.x + 6, bossInstance.y - 12, hpWidth, 6);
    }

    function drawParticles() {
      particles.forEach((p) => {
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      });
    }

    function drawPlayer() {
      if (player.iframeTime > 0 && Math.floor(player.iframeTime / 4) % 2 === 0) {
        return;
      }

      let isInvincible = gameState.invincibilityTime > 0;
      
      ctx.save();
      const pxCenter = player.x + player.width / 2;
      const pyBottom = player.y + player.height;
      ctx.translate(pxCenter, pyBottom);

      // Advanced Vector tilt rotations when leaping or floating
      if (!player.isGrounded) {
        const tiltAngle = player.vy * 0.02 * (player.facingRight ? 1 : -1);
        ctx.rotate(tiltAngle);
      }

      const sizeScale = player.hasHardhat ? 1.6 : 1.0;
      ctx.scale(sizeScale, sizeScale);

      // Draw vector avatars
      if (gameState.hero === 'sarah') {
        drawSarahVector(0, -24, player.facingRight, !player.isGrounded, player.vx !== 0);
      } else {
        drawTedVector(0, -24, player.facingRight, !player.isGrounded, player.vx !== 0);
      }

      if (player.hasHardhat) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(0, -23, 6, Math.PI, 0); 
        ctx.fill();
        ctx.fillRect(-6, -23, 12, 2); 

        const beaconPhase = (Date.now() / 120) % (Math.PI * 2);
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-1.5, -26, 3, 3);
        ctx.fillStyle = `rgba(239, 68, 68, ${0.4 + Math.sin(beaconPhase) * 0.4})`;
        ctx.beginPath();
        ctx.arc(0, -27, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isInvincible) {
        const rainbowGlow = ctx.createRadialGradient(0, -12, 2, 0, -12, 18);
        const hue = (Date.now() / 5) % 360;
        rainbowGlow.addColorStop(0, `hsla(${hue}, 90%, 60%, 0.35)`);
        rainbowGlow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rainbowGlow;
        ctx.beginPath();
        ctx.arc(0, -12, 18, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
    }

    function drawSarahVector(x, y, facingRight, jumping, walking) {
      ctx.save();
      ctx.translate(x, y);
      if (!facingRight) ctx.scale(-1, 1);

      // Shaded suit legs
      ctx.fillStyle = '#1e3a8a'; 
      const walkCycle = walking ? Math.sin(Date.now() / 60) * 4 : 0;
      const jumpStretch = jumping ? 3 : 0;
      ctx.fillRect(-5, 18, 3, 6 + jumpStretch + walkCycle);
      ctx.fillRect(2, 18, 3, 6 + jumpStretch - walkCycle);

      // 3D look-alike lab coat
      ctx.fillStyle = '#f8fafc'; 
      ctx.beginPath();
      ctx.roundRect(-7, 4, 14, 14, 2);
      ctx.fill();

      // Undercoat tie V
      ctx.fillStyle = '#244C5A';
      ctx.beginPath();
      ctx.moveTo(-4, 4);
      ctx.lineTo(0, 11);
      ctx.lineTo(4, 4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#E98300'; 
      ctx.fillRect(-2, 5, 4, 1.5);

      // Skin head
      ctx.fillStyle = '#fed7aa'; 
      ctx.beginPath();
      ctx.arc(0, -2, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Glasses shine specular
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(-2.2, -2, 2.2, 0, Math.PI * 2);
      ctx.arc(2.2, -2, 2.2, 0, Math.PI * 2);
      ctx.stroke();
      
      const glint = (Math.sin(Date.now() / 250) > 0);
      if (glint) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(-2.5, -3, 1, 1);
        ctx.fillRect(2.0, -3, 1, 1);
      }

      // Styled hair
      ctx.fillStyle = '#78350F';
      ctx.beginPath();
      ctx.roundRect(-7, -8, 14, 11, [4, 4, 1, 1]);
      ctx.fill();

      ctx.restore();
    }

    // Realistic TEd Vector character avatar (Rebranded from Karsten)
    function drawTedVector(x, y, facingRight, jumping, walking) {
      ctx.save();
      ctx.translate(x, y);
      if (!facingRight) ctx.scale(-1, 1);

      // Shaded suit legs
      ctx.fillStyle = '#0f172a'; 
      const walkCycle = walking ? Math.sin(Date.now() / 60) * 4 : 0;
      const jumpStretch = jumping ? 3 : 0;
      ctx.fillRect(-5, 18, 3, 6 + jumpStretch + walkCycle);
      ctx.fillRect(2, 18, 3, 6 + jumpStretch - walkCycle);

      // Premium suit coat with highlights
      ctx.fillStyle = '#1e293b'; 
      ctx.beginPath();
      ctx.roundRect(-6.5, 4, 13, 14, 2);
      ctx.fill();
      ctx.fillStyle = '#334155'; // coat highlight
      ctx.fillRect(-6.5, 4, 2, 14);

      // Waving corporate orange tie
      ctx.fillStyle = '#E98300';
      ctx.beginPath();
      ctx.moveTo(-1.2, 4);
      ctx.lineTo(1.2, 4);
      ctx.lineTo(1.5, 13);
      ctx.lineTo(0, 16);
      ctx.lineTo(-1.5, 13);
      ctx.closePath();
      ctx.fill();

      // Head
      ctx.fillStyle = '#ffedd5';
      ctx.beginPath();
      ctx.arc(0, -2, 5.5, 0, Math.PI * 2);
      ctx.fill();

      // Specular shine executive glasses
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(0, -2, 6, Math.PI, 0); 
      ctx.stroke();

      const glint = (Math.sin(Date.now() / 250) > 0);
      if (glint) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fillRect(-2, -3, 1.5, 1.5);
      }

      // Styled brown hair
      ctx.fillStyle = '#b45309';
      ctx.beginPath();
      ctx.arc(0, -6, 5, Math.PI, 0);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-5, -6);
      ctx.quadraticCurveTo(-1, -7, 3, -4);
      ctx.lineTo(4, -6);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    function drawHUD() {
      ctx.fillStyle = 'rgba(10, 20, 26, 0.72)';
      ctx.fillRect(0, 0, canvas.width, 35);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, 35);
      ctx.lineTo(canvas.width, 35);
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.font = 'bold 11px monospace';

      ctx.fillStyle = '#E98300';
      ctx.fillText(`${dict.levelName.toUpperCase()}:`, 15, 21);
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px sans-serif';
      ctx.fillText(dict.levelTitles[gameState.currentLevel], 60, 20);

      ctx.textAlign = 'right';
      ctx.font = 'bold 10px monospace';
      
      ctx.fillStyle = '#F59E0B';
      ctx.fillText(`🪙 ${dict.score.toUpperCase()}: ${gameState.score}`, 430, 21);

      ctx.fillStyle = '#34D399';
      ctx.fillText(`⭐ ${dict.xp.toUpperCase()}: ${gameState.xp}`, 510, 21);

      ctx.fillStyle = '#EF4444';
      let heartsStr = '';
      for (let h = 0; h < gameState.lives; h++) heartsStr += '❤️';
      ctx.fillText(`${dict.lives.toUpperCase()}: ${heartsStr}`, 625, 21);
    }

    function drawGameOverScreen() {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.fillStyle = '#EF4444';
      ctx.font = 'bold 24px monospace';
      ctx.fillText(dict.gameOver, 320, 150);

      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.fillText(`Final Synergy score: ${gameState.score} Merit Points`, 320, 190);

      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '10px monospace';
      ctx.fillText(dict.retryPrompt, 320, 230);
    }

    function drawVictoryScreen() {
      ctx.fillStyle = 'rgba(10, 20, 26, 0.9)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.shadowColor = '#34D399';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#34D399';
      ctx.font = 'bold 18px "Outfit", sans-serif';
      ctx.fillText(dict.victoryTitle, 320, 120);
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#ffffff';
      ctx.font = '13px sans-serif';
      ctx.fillText(dict.victoryDesc, 320, 160);

      ctx.fillStyle = '#F59E0B';
      ctx.font = 'bold 14px monospace';
      ctx.fillText(`Synergy Record: ${gameState.score} Points (+${gameState.xp} Onboarding XP!)`, 320, 200);

      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px monospace';
      ctx.fillText(dict.victoryPrompt, 320, 250);
    }

    let animationFrameId = null;
    function gameLoop() {
      update();
      draw();
      animationFrameId = requestAnimationFrame(gameLoop);
    }

    setupInputs();
    gameLoop();

    window.cleanupSynergyQuest = function() {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      stopBGM();
      stopStarMusic();
      if (audioCtx) {
        try {
          audioCtx.close();
        } catch (e) {
          console.warn("Error closing TEd AudioContext:", e);
        }
        audioCtx = null;
      }
    };
  };
})();
