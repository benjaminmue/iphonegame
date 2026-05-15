/* ORBITAL — strange artefact found inside the phone
 * Single-file game engine. No deps. ES2020.
 * The user touches the screen; gravity follows their finger. A comet
 * drifts through space and is sculpted by that field through glowing
 * gates while asteroids drift past. Music is earned, not given.
 */
(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Palette & constants
  // -------------------------------------------------------------------------
  const C = {
    bg: '#06050d',
    ink: '#f1ead8',
    inkDim: '#a59dba',
    inkFaint: '#5a5375',
    comet: '#fff5d8',
    cometWarm: '#ffd89a',
    gate: '#5af0ff',
    gateCore: '#bff8ff',
    asteroid: '#1a1326',
    asteroidRim: '#ff5a6b',
    star: '#cfc5ff',
    warm: '#ffb86b',
    res: '#ff8be0', // resonance accent
  };

  // C major pentatonic across two octaves — every gate maps to one
  const TUNING = [
    261.63, 293.66, 329.63, 392.00, 440.00,
    523.25, 587.33, 659.25, 783.99, 880.00,
    1046.5, 1174.66,
  ];

  const STORAGE_KEY = 'orbital.v1';

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  const defaultStore = {
    best: 0, totalGates: 0, runs: 0,
    sound: true, tilt: false, seenTutorial: false,
  };
  const loadStore = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? { ...defaultStore, ...JSON.parse(raw) } : { ...defaultStore };
    } catch { return { ...defaultStore }; }
  };
  const saveStore = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
  };
  const store = loadStore();

  // -------------------------------------------------------------------------
  // Reduced motion preference
  // -------------------------------------------------------------------------
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // -------------------------------------------------------------------------
  // Haptics
  // -------------------------------------------------------------------------
  const vibrate = (pattern) => { try { navigator.vibrate && navigator.vibrate(pattern); } catch {} };

  // -------------------------------------------------------------------------
  // Audio engine — generative, no external files
  // -------------------------------------------------------------------------
  const Audio = (() => {
    let actx = null, master = null;
    const init = () => {
      if (actx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try {
        actx = new AC();
        master = actx.createGain();
        master.gain.value = 0.5;
        master.connect(actx.destination);
      } catch { actx = null; }
    };
    const resume = () => { if (actx && actx.state === 'suspended') actx.resume(); };
    const ready = () => !!actx && store.sound;

    const tone = (freq, dur=0.3, type='sine', vol=0.18, attack=0.012) => {
      if (!ready()) return;
      const t = actx.currentTime;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    };
    const pluck = (freq, vol=0.18) => {
      if (!ready()) return;
      tone(freq, 0.45, 'sine', vol, 0.005);
      tone(freq * 2, 0.18, 'sine', vol * 0.25, 0.005);
    };
    const bell = (freqs, vol=0.14) => {
      freqs.forEach((f, i) => setTimeout(() => tone(f, 0.9, 'sine', vol, 0.005), i * 60));
    };
    const noise = (dur=0.45, vol=0.22, cutoff=420) => {
      if (!ready()) return;
      const t = actx.currentTime;
      const bufSize = Math.floor(actx.sampleRate * dur);
      const buf = actx.createBuffer(1, bufSize, actx.sampleRate);
      const ch = buf.getChannelData(0);
      for (let i = 0; i < bufSize; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / bufSize);
      const src = actx.createBufferSource(); src.buffer = buf;
      const filt = actx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = cutoff;
      const g = actx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filt); filt.connect(g); g.connect(master);
      src.start(t);
    };
    const sub = (freq, dur=0.7, vol=0.32) => {
      if (!ready()) return;
      const t = actx.currentTime;
      const o = actx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(freq * 2, t);
      o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
      const g = actx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.05);
    };
    const tick = (freq, vol=0.06) => tone(freq, 0.06, 'triangle', vol, 0.001);

    return { init, resume, tone, pluck, bell, noise, sub, tick, get ctx() { return actx; } };
  })();

  // -------------------------------------------------------------------------
  // Recovered-transmission fragments — drift across the screen
  // -------------------------------------------------------------------------
  const FRAGMENT_LINES = [
    'DEPTH 042 — STABLE', 'CARRIER OK', 'TUNING…',
    'HOLD TO ANCHOR', '⌁ ⌁ ⌁', 'ECHO RECEIVED',
    '23.7N 0.1W', 'NO SIGNAL FOUND', 'ARTEFACT LOCKED',
    '∆ + ⟁ + ◌', 'BREATHE', 'YOU ARE THE FIELD',
    'CLOSE ENOUGH', 'PATIENCE', '— END FRAME —',
    'COMET STABLE', 'RESONANCE READY', 'GHZ.0042',
    'C ⇢ D ⇢ E ⇢ G ⇢ A', 'TIDE INWARD',
    'YOUR FINGER IS THE MOON', 'IT REMEMBERS YOU',
  ];
  const fragmentsLayer = document.getElementById('fragments');
  const spawnFragment = () => {
    if (reduceMotion) return;
    const el = document.createElement('div');
    el.className = 'fragment';
    el.textContent = FRAGMENT_LINES[Math.floor(Math.random() * FRAGMENT_LINES.length)];
    el.style.left = (8 + Math.random() * 70) + '%';
    el.style.top = (16 + Math.random() * 70) + '%';
    fragmentsLayer.appendChild(el);
    setTimeout(() => el.remove(), 7200);
  };

  // -------------------------------------------------------------------------
  // Math helpers
  // -------------------------------------------------------------------------
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const rand = (a, b) => a + Math.random() * (b - a);
  const randSign = () => (Math.random() < 0.5 ? -1 : 1);
  const len2 = (x, y) => x * x + y * y;
  const TAU = Math.PI * 2;

  // -------------------------------------------------------------------------
  // Canvas
  // -------------------------------------------------------------------------
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d', { alpha: true });
  let W = 0, H = 0, DPR = 1;

  const resize = () => {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (G && G.stars) buildStars();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 80));

  // -------------------------------------------------------------------------
  // Game state
  // -------------------------------------------------------------------------
  const STATE = { BOOT: 'boot', TITLE: 'title', TUTORIAL: 'tutorial',
                  PLAYING: 'playing', PAUSED: 'paused', GAMEOVER: 'gameover' };
  let state = STATE.BOOT;

  const G = {
    comet: null,
    gates: [],
    asteroids: [],
    wells: new Map(),    // pointerId -> well
    pings: [],
    particles: [],
    stars: [],
    score: 0,
    combo: 0,
    bestComboThisRun: 0,
    gatesThisRun: 0,
    timeScale: 1,
    targetTimeScale: 1,
    resonance: 0,        // ticks of resonance remaining
    flash: 0,
    shake: 0,
    elapsed: 0,
    tilt: { x: 0, y: 0 },
    tutorialStep: 0,
    tutorialTimer: 0,
  };

  const buildStars = () => {
    G.stars.length = 0;
    const count = reduceMotion ? 40 : 110;
    for (let i = 0; i < count; i++) {
      G.stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: rand(0.2, 1),
        twinkle: Math.random() * TAU,
      });
    }
  };

  // -------------------------------------------------------------------------
  // Entity factories
  // -------------------------------------------------------------------------
  const makeComet = () => ({
    x: W * 0.5, y: H * 0.62,
    vx: rand(-12, 12), vy: rand(-6, -2),
    trail: [],
    alive: true,
  });

  const makeAsteroid = () => {
    const side = Math.floor(Math.random() * 4);
    const r = rand(14, 28);
    let x, y, vx, vy;
    const sp = rand(14, 32);
    if (side === 0) { x = -r; y = rand(0, H); vx = sp; vy = rand(-10, 10); }
    else if (side === 1) { x = W + r; y = rand(0, H); vx = -sp; vy = rand(-10, 10); }
    else if (side === 2) { x = rand(0, W); y = -r; vx = rand(-10, 10); vy = sp; }
    else { x = rand(0, W); y = H + r; vx = rand(-10, 10); vy = -sp; }
    // Build a soft irregular polygon
    const verts = [];
    const n = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      verts.push({ a, r: r * rand(0.78, 1.18) });
    }
    return { x, y, vx, vy, r, rot: rand(0, TAU), vrot: rand(-0.6, 0.6), verts };
  };

  const makeGate = () => {
    // Don't spawn too close to comet
    let x, y, tries = 0;
    do {
      x = rand(W * 0.18, W * 0.82);
      y = rand(H * 0.22, H * 0.78);
      tries++;
    } while (G.comet && len2(x - G.comet.x, y - G.comet.y) < 18000 && tries < 12);
    const note = TUNING[Math.floor(Math.random() * TUNING.length)];
    return {
      x, y,
      angle: rand(0, TAU),
      spin: rand(-0.4, 0.4),
      vr: rand(0.6, 1.2),
      eye: 16,            // collision radius
      ring: 40,           // visual outer
      life: 0,
      maxLife: rand(7, 12),
      threaded: false,
      note,
      pulse: 0,
    };
  };

  const spawnParticles = (x, y, color, n=18, speed=120, life=0.7, size=2.4) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * rand(0.3, 1);
      G.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life, maxLife: life,
        color, size: size * rand(0.6, 1.2),
      });
    }
  };

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------
  const startTutorial = () => {
    G.score = 0; G.combo = 0; G.gatesThisRun = 0; G.bestComboThisRun = 0;
    G.elapsed = 0; G.resonance = 0; G.timeScale = 1; G.targetTimeScale = 1;
    G.flash = 0; G.shake = 0; G.tilt = { x: 0, y: 0 };
    G.comet = makeComet(); G.comet.vx = 0; G.comet.vy = 0;
    G.gates.length = 0; G.asteroids.length = 0; G.particles.length = 0; G.pings.length = 0;
    G.wells.clear();
    G.tutorialStep = 0; G.tutorialTimer = 0;
    state = STATE.TUTORIAL;
    showTutorialCard('touch and hold', 'your finger is a gravity well — pull the comet');
    showScreens({ tutorial: true });
  };

  const startRun = () => {
    G.score = 0; G.combo = 0; G.gatesThisRun = 0; G.bestComboThisRun = 0;
    G.elapsed = 0; G.resonance = 0; G.timeScale = 1; G.targetTimeScale = 1;
    G.flash = 0; G.shake = 0; G.tilt = { x: 0, y: 0 };
    G.comet = makeComet();
    G.gates.length = 0;
    G.asteroids.length = 0;
    G.particles.length = 0;
    G.pings.length = 0;
    G.wells.clear();
    G.gates.push(makeGate());
    setTimeout(() => G.asteroids.push(makeAsteroid()), 800);
    state = STATE.PLAYING;
    showScreens({ hud: true });
    updateHud();
  };

  const endRun = () => {
    if (state !== STATE.PLAYING) return;
    state = STATE.GAMEOVER;
    G.targetTimeScale = 0.18;
    G.shake = 26;
    G.flash = 1;
    Audio.sub(60, 0.9, 0.32);
    Audio.noise(0.6, 0.25, 380);
    vibrate([18, 40, 28]);
    spawnParticles(G.comet.x, G.comet.y, C.cometWarm, 36, 220, 1.0, 3.2);
    spawnParticles(G.comet.x, G.comet.y, C.gate, 22, 160, 1.4, 2);
    G.comet.alive = false;

    store.runs += 1;
    store.totalGates += G.gatesThisRun;
    let newBest = false;
    if (G.score > store.best) { store.best = G.score; newBest = true; }
    saveStore();

    setTimeout(() => {
      document.getElementById('over-score').textContent = String(G.score).padStart(3, '0');
      document.getElementById('over-best').textContent = String(store.best).padStart(3, '0');
      document.getElementById('over-new').hidden = !newBest;
      document.getElementById('over-tag').textContent = newBest ? 'NEW HORIZON' : 'SIGNAL LOST';
      showScreens({ over: true });
      G.targetTimeScale = 1;
    }, 900);
  };

  // -------------------------------------------------------------------------
  // Physics & spawning
  // -------------------------------------------------------------------------
  const G_FORCE = 5200;       // base pull magnitude
  const G_SOFT = 32;          // soft minimum distance for force calc
  const COMET_R = 5;
  const MAX_SPEED = 520;
  const DRAG = 0.985;

  const applyForces = (dt) => {
    if (!G.comet || !G.comet.alive) return;
    let ax = 0, ay = 0;

    G.wells.forEach((w) => {
      const dx = w.x - G.comet.x;
      const dy = w.y - G.comet.y;
      const d2 = dx * dx + dy * dy + G_SOFT * G_SOFT;
      const inv = 1 / Math.sqrt(d2);
      const f = G_FORCE / d2;
      ax += dx * inv * f;
      ay += dy * inv * f;
    });

    G.pings.forEach((p) => {
      const dx = G.comet.x - p.x;
      const dy = G.comet.y - p.y;
      const d2 = dx * dx + dy * dy + 200;
      const inv = 1 / Math.sqrt(d2);
      const strength = 12000 * p.life;
      const f = strength / d2;
      ax += dx * inv * f;
      ay += dy * inv * f;
    });

    G.comet.vx = (G.comet.vx + ax * dt) * DRAG;
    G.comet.vy = (G.comet.vy + ay * dt) * DRAG;

    const sp2 = len2(G.comet.vx, G.comet.vy);
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const s = MAX_SPEED / Math.sqrt(sp2);
      G.comet.vx *= s; G.comet.vy *= s;
    }

    G.comet.x += G.comet.vx * dt;
    G.comet.y += G.comet.vy * dt;

    // Soft bounce edges so we never lose the comet
    const pad = 6;
    if (G.comet.x < pad)       { G.comet.x = pad;       G.comet.vx = Math.abs(G.comet.vx) * 0.6; }
    if (G.comet.x > W - pad)   { G.comet.x = W - pad;   G.comet.vx = -Math.abs(G.comet.vx) * 0.6; }
    if (G.comet.y < pad)       { G.comet.y = pad;       G.comet.vy = Math.abs(G.comet.vy) * 0.6; }
    if (G.comet.y > H - pad)   { G.comet.y = H - pad;   G.comet.vy = -Math.abs(G.comet.vy) * 0.6; }

    // Trail buffer
    G.comet.trail.push({ x: G.comet.x, y: G.comet.y });
    if (G.comet.trail.length > 38) G.comet.trail.shift();
  };

  const advancePings = (dt) => {
    for (let i = G.pings.length - 1; i >= 0; i--) {
      const p = G.pings[i];
      p.life -= dt / 0.25;
      if (p.life <= 0) G.pings.splice(i, 1);
    }
  };

  const advanceGates = (dt) => {
    for (let i = G.gates.length - 1; i >= 0; i--) {
      const g = G.gates[i];
      g.angle += g.spin * dt;
      g.life += dt;
      g.pulse = Math.max(0, g.pulse - dt * 3.5);
      if (g.life > g.maxLife && !g.threaded) {
        // fade out and respawn elsewhere
        G.gates.splice(i, 1);
      }
    }
  };

  const advanceAsteroids = (dt) => {
    for (let i = G.asteroids.length - 1; i >= 0; i--) {
      const a = G.asteroids[i];
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.rot += a.vrot * dt;
      if (a.x < -60 || a.x > W + 60 || a.y < -60 || a.y > H + 60) {
        G.asteroids.splice(i, 1);
      }
    }
  };

  const advanceParticles = (dt) => {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96; p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) G.particles.splice(i, 1);
    }
  };

  const advanceStars = (dt) => {
    for (const s of G.stars) {
      s.twinkle += dt * 1.4 * s.z;
    }
  };

  const checkGates = () => {
    if (!G.comet) return;
    for (let i = G.gates.length - 1; i >= 0; i--) {
      const g = G.gates[i];
      const d2 = len2(G.comet.x - g.x, G.comet.y - g.y);
      if (!g.threaded && d2 < g.eye * g.eye) {
        g.threaded = true;
        g.pulse = 1;
        threadGate(g);
        // remove with small delay-feeling
        G.gates.splice(i, 1);
      }
    }
  };

  const threadGate = (g) => {
    G.combo += 1;
    G.gatesThisRun += 1;
    G.bestComboThisRun = Math.max(G.bestComboThisRun, G.combo);
    const pts = G.resonance > 0 ? 20 : 10;
    G.score += pts;
    G.flash = Math.max(G.flash, 0.35);

    spawnParticles(g.x, g.y, C.gate, 14, 140, 0.6, 2.2);
    Audio.pluck(g.note, 0.16);
    vibrate(8);
    updateHud();

    if (G.combo >= 3 && G.resonance <= 0) {
      // Enter resonance
      G.resonance = 4.0;
      G.targetTimeScale = 0.55;
      Audio.bell([523.25, 659.25, 783.99], 0.12);
      vibrate([6, 30, 6]);
      flashCombo('RESONANCE');
    } else if (G.combo > 1) {
      flashCombo(`×${G.combo}`);
    }

    // Spawn replacement gate, escalate difficulty
    G.gates.push(makeGate());
    if (G.gates.length > 2 && Math.random() < 0.15) G.gates.push(makeGate());

    // Occasionally tighten the field with another asteroid
    if (G.asteroids.length < 2 + Math.floor(G.score / 60) && Math.random() < 0.85) {
      G.asteroids.push(makeAsteroid());
    }
  };

  const checkAsteroids = () => {
    if (!G.comet || !G.comet.alive) return;
    for (const a of G.asteroids) {
      const d = len2(G.comet.x - a.x, G.comet.y - a.y);
      const r = a.r + COMET_R;
      if (d < r * r) { endRun(); return; }
    }
  };

  const decayResonance = (dt) => {
    if (G.resonance > 0) {
      G.resonance -= dt;
      if (G.resonance <= 0) {
        G.targetTimeScale = 1;
        G.combo = 0;
        updateHud();
      }
    }
  };

  // -------------------------------------------------------------------------
  // Tutorial flow
  // -------------------------------------------------------------------------
  // Steps:
  //  0 — hold to anchor: wait until a well exists ≥ 0.7s
  //  1 — pull a target: a soft target appears, comet must approach it
  //  2 — thread one gate: a gate appears, comet must pass through
  //  3 — done; enter real run
  const TUT_TARGET = { x: 0, y: 0, active: false };

  const advanceTutorial = (dt) => {
    if (!G.comet) return;
    G.tutorialTimer += dt;

    if (G.tutorialStep === 0) {
      if (G.wells.size > 0) {
        const w = [...G.wells.values()][0];
        w.held = (w.held || 0) + dt;
        if (w.held > 0.7) {
          G.tutorialStep = 1;
          G.tutorialTimer = 0;
          TUT_TARGET.x = W * 0.5;
          TUT_TARGET.y = H * 0.36;
          TUT_TARGET.active = true;
          showTutorialCard('bring it home', 'guide the comet to the ring');
          Audio.tick(660, 0.12);
          vibrate(12);
        }
      }
    } else if (G.tutorialStep === 1) {
      if (len2(G.comet.x - TUT_TARGET.x, G.comet.y - TUT_TARGET.y) < 36 * 36) {
        TUT_TARGET.active = false;
        G.tutorialStep = 2;
        G.tutorialTimer = 0;
        const gate = makeGate();
        gate.x = W * 0.5; gate.y = H * 0.5;
        gate.maxLife = 30;
        G.gates.length = 0;
        G.gates.push(gate);
        showTutorialCard('thread the gate', 'pass the comet through its centre');
        Audio.tick(880, 0.12);
        vibrate(12);
      }
    } else if (G.tutorialStep === 2) {
      checkGates();
      if (G.gatesThisRun >= 1) {
        G.tutorialStep = 3;
        store.seenTutorial = true; saveStore();
        showTutorialCard('begin', 'thread as many as you can');
        setTimeout(() => {
          showScreens({ hud: true });
          startRun();
        }, 900);
      }
    }
  };

  const drawTutorialOverlays = () => {
    if (state !== STATE.TUTORIAL) return;
    if (G.tutorialStep === 1 && TUT_TARGET.active) {
      const t = G.tutorialTimer;
      const r = 26 + Math.sin(t * 2.6) * 3;
      ctx.save();
      ctx.translate(TUT_TARGET.x, TUT_TARGET.y);
      ctx.strokeStyle = 'rgba(255, 184, 107, 0.55)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255, 184, 107, 0.18)';
      ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill();
      ctx.restore();
    }
  };

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  const drawStars = () => {
    const ox = G.tilt.x * 6;
    const oy = G.tilt.y * 6;
    for (const s of G.stars) {
      const a = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(s.twinkle));
      ctx.globalAlpha = a * s.z;
      ctx.fillStyle = C.star;
      const size = 0.5 + s.z * 1.1;
      ctx.fillRect(s.x + ox * s.z, s.y + oy * s.z, size, size);
    }
    ctx.globalAlpha = 1;
  };

  const drawWells = () => {
    G.wells.forEach((w) => {
      const t = (performance.now() / 1000) - w.t0;
      const grad = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, 110);
      grad.addColorStop(0, 'rgba(255, 245, 216, 0.12)');
      grad.addColorStop(1, 'rgba(255, 245, 216, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(w.x, w.y, 110, 0, TAU); ctx.fill();

      // expanding rings
      for (let i = 0; i < 3; i++) {
        const phase = (t * 1.4 + i / 3) % 1;
        const rad = 18 + phase * 90;
        ctx.strokeStyle = `rgba(255, 245, 216, ${0.18 * (1 - phase)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(w.x, w.y, rad, 0, TAU); ctx.stroke();
      }
      // anchor dot
      ctx.fillStyle = 'rgba(255, 245, 216, 0.9)';
      ctx.beginPath(); ctx.arc(w.x, w.y, 3, 0, TAU); ctx.fill();
    });
  };

  const drawPings = () => {
    for (const p of G.pings) {
      const t = 1 - p.life;
      const rad = 12 + t * 70;
      ctx.strokeStyle = `rgba(255, 184, 107, ${0.6 * p.life})`;
      ctx.lineWidth = 1.4 * p.life + 0.4;
      ctx.beginPath(); ctx.arc(p.x, p.y, rad, 0, TAU); ctx.stroke();
    }
  };

  const drawGates = () => {
    for (const g of G.gates) {
      const isRes = G.resonance > 0;
      const accent = isRes ? C.res : C.gate;
      const core = isRes ? '#ffd1f0' : C.gateCore;
      const pulse = 1 + Math.sin(g.angle * 2 + g.life * 4) * 0.05 + g.pulse * 0.6;

      ctx.save();
      ctx.translate(g.x, g.y);

      // soft halo
      const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, g.ring * 1.6);
      halo.addColorStop(0, `rgba(90, 240, 255, ${0.18 + g.pulse * 0.3})`);
      halo.addColorStop(1, 'rgba(90, 240, 255, 0)');
      if (isRes) {
        halo.addColorStop(0, `rgba(255, 139, 224, ${0.22 + g.pulse * 0.3})`);
      }
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(0, 0, g.ring * 1.6, 0, TAU); ctx.fill();

      ctx.rotate(g.angle);

      // outer ring — broken into arcs to feel like a sigil
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1.4;
      ctx.globalAlpha = 0.85;
      for (let i = 0; i < 4; i++) {
        const a0 = (i / 4) * TAU + 0.18;
        const a1 = a0 + TAU / 4 - 0.36;
        ctx.beginPath();
        ctx.arc(0, 0, g.ring * pulse, a0, a1);
        ctx.stroke();
      }

      // inner — eye target
      ctx.globalAlpha = 1;
      ctx.strokeStyle = core;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(0, 0, g.eye, 0, TAU); ctx.stroke();

      // center dot
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(0, 0, 2.2, 0, TAU); ctx.fill();

      // life dashes — subtle countdown ring
      const lifeFrac = clamp(1 - g.life / g.maxLife, 0, 1);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = C.inkFaint;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, g.ring + 10, -Math.PI / 2, -Math.PI / 2 + TAU * lifeFrac);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  };

  const drawAsteroids = () => {
    for (const a of G.asteroids) {
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(a.rot);

      // rim glow
      const rim = ctx.createRadialGradient(0, 0, a.r * 0.4, 0, 0, a.r * 1.5);
      rim.addColorStop(0, 'rgba(255, 90, 107, 0)');
      rim.addColorStop(0.7, 'rgba(255, 90, 107, 0.18)');
      rim.addColorStop(1, 'rgba(255, 90, 107, 0)');
      ctx.fillStyle = rim;
      ctx.beginPath(); ctx.arc(0, 0, a.r * 1.5, 0, TAU); ctx.fill();

      // body
      ctx.beginPath();
      a.verts.forEach((v, i) => {
        const x = Math.cos(v.a) * v.r;
        const y = Math.sin(v.a) * v.r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = C.asteroid;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 90, 107, 0.6)';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.restore();
    }
  };

  const drawComet = () => {
    if (!G.comet) return;
    // Trail
    const tr = G.comet.trail;
    if (tr.length > 2) {
      for (let i = 1; i < tr.length; i++) {
        const a = i / tr.length;
        ctx.strokeStyle = `rgba(255, 216, 154, ${a * 0.55})`;
        ctx.lineWidth = a * 3 + 0.4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
        ctx.lineTo(tr[i].x, tr[i].y);
        ctx.stroke();
      }
    }

    if (!G.comet.alive) return;

    // glow
    const glow = ctx.createRadialGradient(G.comet.x, G.comet.y, 0, G.comet.x, G.comet.y, 26);
    glow.addColorStop(0, 'rgba(255, 245, 216, 0.85)');
    glow.addColorStop(0.4, 'rgba(255, 216, 154, 0.35)');
    glow.addColorStop(1, 'rgba(255, 216, 154, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(G.comet.x, G.comet.y, 26, 0, TAU); ctx.fill();

    // core
    ctx.fillStyle = C.comet;
    ctx.beginPath(); ctx.arc(G.comet.x, G.comet.y, COMET_R, 0, TAU); ctx.fill();
  };

  const drawParticles = () => {
    for (const p of G.particles) {
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
  };

  const drawFlash = () => {
    if (G.flash > 0.001) {
      ctx.fillStyle = `rgba(255, 245, 216, ${G.flash * 0.18})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  const drawResonanceFrame = () => {
    if (G.resonance <= 0) return;
    const t = performance.now() / 1000;
    const phase = (Math.sin(t * 4) + 1) * 0.5;
    ctx.strokeStyle = `rgba(255, 139, 224, ${0.28 + phase * 0.2})`;
    ctx.lineWidth = 2;
    const inset = 6;
    ctx.strokeRect(inset, inset, W - inset * 2, H - inset * 2);
  };

  const render = () => {
    ctx.clearRect(0, 0, W, H);

    // shake transform
    let sx = 0, sy = 0;
    if (G.shake > 0.01) {
      sx = (Math.random() - 0.5) * G.shake;
      sy = (Math.random() - 0.5) * G.shake;
    }
    ctx.save();
    ctx.translate(sx, sy);

    drawStars();
    drawWells();
    drawPings();
    drawGates();
    drawAsteroids();
    drawComet();
    drawParticles();
    drawTutorialOverlays();
    drawResonanceFrame();
    drawFlash();

    ctx.restore();
  };

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
  let last = performance.now();
  let nextFragmentAt = performance.now() + 3500;

  const loop = (now) => {
    let raw = (now - last) / 1000;
    if (raw > 0.08) raw = 0.08; // clamp huge frames (e.g. tab return)
    last = now;

    // ease time scale
    G.timeScale += (G.targetTimeScale - G.timeScale) * Math.min(1, raw * 8);
    const dt = raw * G.timeScale;

    // decay visuals
    G.flash *= Math.pow(0.001, raw);
    G.shake *= Math.pow(0.0005, raw);
    if (G.shake < 0.05) G.shake = 0;

    if (state === STATE.PLAYING) {
      applyForces(dt);
      advancePings(raw); // pings live in real time
      advanceGates(dt);
      advanceAsteroids(dt);
      advanceParticles(raw);
      checkGates();
      checkAsteroids();
      decayResonance(raw);
      G.elapsed += dt;
    } else if (state === STATE.TUTORIAL) {
      applyForces(dt * 0.85);
      advancePings(raw);
      advanceParticles(raw);
      advanceTutorial(raw);
    } else if (state === STATE.GAMEOVER) {
      // still let particles play & flash settle
      advanceParticles(raw);
      advanceAsteroids(dt * 0.4);
      advancePings(raw);
    } else if (state === STATE.TITLE) {
      // gentle title attract loop — comet idles, no scoring
      if (G.comet) {
        // slow figure-eight pull
        const t = performance.now() / 1000;
        const tx = W * 0.5 + Math.cos(t * 0.4) * W * 0.22;
        const ty = H * 0.55 + Math.sin(t * 0.8) * H * 0.12;
        G.wells.set('__idle__', { x: tx, y: ty, t0: t });
        applyForces(dt);
        G.wells.delete('__idle__');
      }
      advanceParticles(raw);
    }

    advanceStars(raw);

    // Fragments — occasional, only during play & title
    if (now > nextFragmentAt) {
      nextFragmentAt = now + rand(3500, 7500);
      if (state === STATE.TITLE || state === STATE.PLAYING) spawnFragment();
    }

    render();
    requestAnimationFrame(loop);
  };

  // -------------------------------------------------------------------------
  // Pointer input
  // -------------------------------------------------------------------------
  const onPointerDown = (e) => {
    if (e.target.closest('button, .screen:not(.subtle)')) return;
    if (state !== STATE.PLAYING && state !== STATE.TUTORIAL) return;
    e.preventDefault();
    Audio.resume();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    G.wells.set(e.pointerId, {
      x, y, t0: performance.now() / 1000,
      dist: 0, lastX: x, lastY: y, downT: performance.now(),
    });
    Audio.tick(220, 0.04);
  };
  const onPointerMove = (e) => {
    const w = G.wells.get(e.pointerId);
    if (!w) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = x - w.lastX, dy = y - w.lastY;
    w.dist += Math.sqrt(dx * dx + dy * dy);
    w.x = x; w.y = y; w.lastX = x; w.lastY = y;
  };
  const onPointerUp = (e) => {
    const w = G.wells.get(e.pointerId);
    if (!w) return;
    e.preventDefault();
    const heldMs = performance.now() - w.downT;
    const wasTap = heldMs < 180 && w.dist < 14;
    G.wells.delete(e.pointerId);
    if (wasTap && (state === STATE.PLAYING || state === STATE.TUTORIAL)) {
      // Repulsive ping
      G.pings.push({ x: w.x, y: w.y, life: 1 });
      Audio.tone(160, 0.18, 'triangle', 0.16, 0.001);
      vibrate(6);
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp, { passive: false });
  window.addEventListener('pointercancel', onPointerUp, { passive: false });

  // Prevent iOS Safari rubber banding / scroll
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  // Prevent double-tap zoom
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // -------------------------------------------------------------------------
  // Device orientation — optional, decorative tilt parallax
  // -------------------------------------------------------------------------
  const enableTilt = async () => {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === 'function') {
        const r = await DOE.requestPermission();
        if (r !== 'granted') return false;
      }
      window.addEventListener('deviceorientation', (e) => {
        // beta = front/back tilt, gamma = left/right tilt
        const gx = clamp((e.gamma || 0) / 30, -1, 1);
        const gy = clamp((e.beta || 0) / 60, -1, 1);
        G.tilt.x = gx;
        G.tilt.y = gy;
      });
      return true;
    } catch { return false; }
  };

  // -------------------------------------------------------------------------
  // UI wiring
  // -------------------------------------------------------------------------
  const screens = {
    title: document.getElementById('screen-title'),
    tutorial: document.getElementById('screen-tutorial'),
    how: document.getElementById('screen-how'),
    pause: document.getElementById('screen-pause'),
    over: document.getElementById('screen-over'),
    hud: document.getElementById('hud'),
  };
  const showScreens = (flags) => {
    for (const k of Object.keys(screens)) {
      screens[k].hidden = !flags[k];
    }
  };

  const showTutorialCard = (step, hint) => {
    document.getElementById('tut-step').textContent = step;
    document.getElementById('tut-hint').textContent = hint;
    // re-trigger animation
    const card = document.querySelector('.tut-card');
    if (card) {
      card.style.animation = 'none';
      // reflow
      void card.offsetWidth;
      card.style.animation = '';
    }
  };

  const flashCombo = (text) => {
    const el = document.getElementById('hud-combo');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(flashCombo._t);
    flashCombo._t = setTimeout(() => el.classList.remove('show'), 900);
  };

  const updateHud = () => {
    document.getElementById('hud-score').textContent = String(G.score).padStart(3, '0');
  };

  const refreshTitleStats = () => {
    document.getElementById('stat-best').textContent = String(store.best).padStart(3, '0');
    document.getElementById('stat-gates').textContent = String(store.totalGates);
    document.getElementById('stat-runs').textContent = String(store.runs);
  };

  // Begin
  document.getElementById('btn-begin').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.bell([392, 523.25, 659.25], 0.10);
    vibrate([4, 18, 4]);
    showScreens({});
    if (store.seenTutorial) startRun();
    else startTutorial();
  });

  // How to play
  document.getElementById('btn-how').addEventListener('click', () => {
    showScreens({ how: true });
  });
  document.getElementById('btn-how-back').addEventListener('click', () => {
    showScreens({ title: true });
  });

  // Sound toggle
  const soundBtn = document.getElementById('btn-sound');
  const refreshSoundBtn = () => {
    soundBtn.textContent = `sound: ${store.sound ? 'on' : 'off'}`;
    soundBtn.setAttribute('aria-pressed', String(store.sound));
  };
  soundBtn.addEventListener('click', () => {
    store.sound = !store.sound; saveStore(); refreshSoundBtn();
    if (store.sound) { Audio.init(); Audio.resume(); Audio.tick(660); }
  });

  // Tilt toggle
  const tiltBtn = document.getElementById('btn-motion');
  const refreshTiltBtn = () => {
    tiltBtn.textContent = `tilt: ${store.tilt ? 'on' : 'off'}`;
    tiltBtn.setAttribute('aria-pressed', String(store.tilt));
  };
  tiltBtn.addEventListener('click', async () => {
    if (!store.tilt) {
      const ok = await enableTilt();
      store.tilt = ok; saveStore(); refreshTiltBtn();
    } else {
      // can't easily disable orientation listener cleanly; mark off and zero tilt
      store.tilt = false; saveStore(); refreshTiltBtn();
      G.tilt = { x: 0, y: 0 };
    }
  });

  // Pause
  document.getElementById('btn-pause').addEventListener('click', () => {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    G.targetTimeScale = 0;
    showScreens({ pause: true, hud: true });
    Audio.tone(330, 0.18, 'triangle', 0.12, 0.001);
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    state = STATE.PLAYING;
    G.targetTimeScale = 1;
    showScreens({ hud: true });
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    state = STATE.TITLE;
    G.targetTimeScale = 1;
    G.wells.clear();
    refreshTitleStats();
    showScreens({ title: true });
  });

  // Tutorial skip
  document.getElementById('btn-tut-skip').addEventListener('click', () => {
    store.seenTutorial = true; saveStore();
    showScreens({ hud: true });
    startRun();
  });

  // Again / Menu after game over
  document.getElementById('btn-again').addEventListener('click', () => {
    showScreens({ hud: true });
    startRun();
  });
  document.getElementById('btn-menu').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
    // build a peaceful title-attract comet
    G.comet = makeComet();
    G.comet.vx = 0; G.comet.vy = 0;
    G.gates.length = 0;
    G.asteroids.length = 0;
    G.particles.length = 0;
  });

  // Visibility / blur — auto-pause
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === STATE.PLAYING) {
      state = STATE.PAUSED;
      G.targetTimeScale = 0;
      showScreens({ pause: true, hud: true });
    }
  });

  // -------------------------------------------------------------------------
  // Boot sequence — "calibrating" feel before the title settles
  // -------------------------------------------------------------------------
  const bootSequence = async () => {
    const tagEl = document.getElementById('boot-tag');
    const tags = ['CALIBRATING', 'TUNING', 'LINKING', 'ARTEFACT READY'];
    showScreens({ title: true });
    refreshTitleStats();
    refreshSoundBtn();
    refreshTiltBtn();
    for (let i = 0; i < tags.length; i++) {
      tagEl.textContent = tags[i];
      await new Promise((r) => setTimeout(r, reduceMotion ? 120 : 380));
    }
    state = STATE.TITLE;
    // build a peaceful idle comet behind the title
    G.comet = makeComet();
    G.comet.vx = 0; G.comet.vy = 0;
  };

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  resize();
  buildStars();
  bootSequence();
  requestAnimationFrame((t) => { last = t; loop(t); });

})();
