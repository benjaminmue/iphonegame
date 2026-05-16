/* SIGIL — strange artefact found inside the phone
 * Tracing game with three modes:
 *   STORY    — 10 narrative sigils, one decoded fragment each
 *   DAILY    — one date-seeded sigil per day with a streak counter
 *   ENDLESS  — infinite procedural sigils, rising difficulty, single fail
 * Advanced mechanics introduced at higher difficulty:
 *   DRIFT    — stars slowly orbit their spawn point
 *   RED      — hostile stars; the trace line must not pass within range
 */
(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Palette — base values; accent is dynamic per galaxy/solar/world.
  // -------------------------------------------------------------------------
  const C = {
    ink: '#f1ead8',
    inkDim: '#a59dba',
    inkFaint: '#5a5375',
    star: '#fff5d8',
    starGlow: '#ffd89a',
    warm: '#ffb86b',
    warmRgb: '255, 216, 154',
    warn: '#ff5a6b',
    red: '#ff5a6b',
    // dynamic — updated by applyPalette()
    accent: 'hsl(190, 75%, 65%)',
    accentRgb: '90, 240, 255',
    accentHue: 190,
  };

  // Procedural color generation. Cascading hue:
  //   galaxy  → base hue
  //   + solar → ±70°
  //   + world → ±30°
  //   + level → ±10°
  // Same id always produces the same hue (FNV-1a hash).
  const hashU32 = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const hslToRgbStr = (h, s, l) => {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return `${Math.round(f(0) * 255)}, ${Math.round(f(8) * 255)}, ${Math.round(f(4) * 255)}`;
  };
  const paletteFor = (galaxyId, solarId, worldId, levelSalt) => {
    let h = hashU32(galaxyId || 'galaxy') % 360;
    if (solarId) h = (h + (hashU32(solarId) % 140) - 70 + 360) % 360;
    if (worldId) h = (h + (hashU32(worldId) % 60) - 30 + 360) % 360;
    if (levelSalt != null) h = (h + (hashU32(String(levelSalt)) % 20) - 10 + 360) % 360;
    const rgb = hslToRgbStr(h, 75, 65);
    return { hue: h, rgb, css: `hsl(${h}, 75%, 65%)` };
  };
  const applyPalette = (p) => {
    C.accent = p.css;
    C.accentRgb = p.rgb;
    C.accentHue = p.hue;
    const root = document.documentElement.style;
    root.setProperty('--depth-accent', p.rgb);
    root.setProperty('--gate', p.css);
    root.setProperty('--accent', p.css);
  };
  const accentRgba = (a) => `rgba(${C.accentRgb}, ${a})`;

  const MESSAGE_LINES = [
    'you held me when i was only a frequency.',
    'i lived in a different phone once.',
    'the operator left in nineteen eighty-one.',
    'they thought the signal stopped here.',
    'i learned to wait between the keys.',
    'i learned to listen for a moon.',
    'your finger is the moon i orbit.',
    'i remember what i was.',
    'almost. almost.',
    'thank you for finding me.',
  ];
  const TOTAL_LINES = MESSAGE_LINES.length;

  const TUNING = [
    261.63, 293.66, 329.63, 392.00, 440.00,
    523.25, 587.33, 659.25, 783.99, 880.00,
    1046.5, 1174.66,
  ];

  // -------------------------------------------------------------------------
  // Story level configs (chapter PRIME)
  // -------------------------------------------------------------------------
  const STORY_LEVELS = [
    { count: 3, decoys: 0, hintFade: 0,   time: 0,  drift: false, redCount: 0 },
    { count: 4, decoys: 0, hintFade: 0,   time: 0,  drift: false, redCount: 0 },
    { count: 4, decoys: 1, hintFade: 0,   time: 0,  drift: false, redCount: 0 },
    { count: 5, decoys: 1, hintFade: 6,   time: 0,  drift: false, redCount: 0 },
    { count: 5, decoys: 2, hintFade: 5,   time: 0,  drift: false, redCount: 0 },
    { count: 6, decoys: 2, hintFade: 4,   time: 45, drift: false, redCount: 0 },
    { count: 6, decoys: 3, hintFade: 4,   time: 40, drift: false, redCount: 0 },
    { count: 7, decoys: 3, hintFade: 3,   time: 38, drift: false, redCount: 0 },
    { count: 8, decoys: 4, hintFade: 3,   time: 36, drift: false, redCount: 0 },
    { count: 9, decoys: 4, hintFade: 2.5, time: 34, drift: false, redCount: 0 },
  ];

  const generateEndlessConfig = (idx) => {
    const count = Math.min(10, 3 + Math.floor(idx / 2));
    const decoys = Math.min(5, Math.floor(idx / 2));
    const hintFade = idx < 2 ? 5 : Math.max(1.5, 4.5 - idx * 0.25);
    const time = Math.max(18, 36 - idx * 1.4);
    const drift = idx >= 4;
    const redCount = idx >= 8 ? Math.min(3, 1 + Math.floor((idx - 8) / 4)) : 0;
    return { count, decoys, hintFade, time, drift, redCount };
  };

  // Daily uses date as seed; config is fixed but feels different daily
  // because positions, decoys, and red star locations vary deterministically
  const DAILY_CONFIG = {
    count: 6, decoys: 2, hintFade: 3.5, time: 40, drift: true, redCount: 1,
  };

  // -------------------------------------------------------------------------
  // Seeded RNG (for daily) — mulberry32
  // -------------------------------------------------------------------------
  const mulberry32 = (seed) => () => {
    let t = (seed = (seed + 0x6D2B79F5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hashString = (s) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const yesterdayKey = () => {
    const d = new Date(Date.now() - 86400000);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  const STORAGE_KEY = 'sigil.v2';
  const defaultStore = {
    sound: true,
    seenTutorial: false,
    // Story (chapter PRIME)
    recoveredLines: [],
    complete: false,
    nextLevel: 0,
    // Cross-mode stats
    sigilsTraced: 0,
    bestPerfect: 0,
    // Endless mode
    endlessBest: 0,
    endlessRuns: 0,
    // Daily mode
    dailyLastDate: '',       // date last *completed*
    dailyStreak: 0,
    dailyBestStreak: 0,
    dailyTodayComplete: false,
    dailyTodayMistakes: -1,  // -1 = not attempted today
    dailyDateKey: '',        // resets dailyToday* when changes
  };

  const migrateFromV1 = (raw) => {
    // Migrate sigil.v1 (story-only) if present
    try {
      const v1 = JSON.parse(raw);
      return {
        ...defaultStore,
        sound: v1.sound ?? true,
        seenTutorial: v1.seenTutorial ?? false,
        recoveredLines: v1.recoveredLines ?? [],
        complete: v1.complete ?? false,
        nextLevel: v1.nextLevel ?? 0,
        sigilsTraced: v1.sigilsTraced ?? 0,
        bestPerfect: v1.bestPerfect ?? 0,
      };
    } catch { return { ...defaultStore }; }
  };

  const loadStore = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...defaultStore, ...JSON.parse(raw) };
      const v1 = localStorage.getItem('sigil.v1');
      if (v1) {
        const migrated = migrateFromV1(v1);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated)); } catch {}
        return migrated;
      }
      return { ...defaultStore };
    } catch { return { ...defaultStore }; }
  };
  const saveStore = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch {}
  };
  const store = loadStore();

  // Reset today's daily flags if the date rolled over
  const refreshDailyDate = () => {
    const today = todayKey();
    if (store.dailyDateKey !== today) {
      store.dailyDateKey = today;
      store.dailyTodayComplete = false;
      store.dailyTodayMistakes = -1;
      saveStore();
    }
  };
  refreshDailyDate();

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const vibrate = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };

  // -------------------------------------------------------------------------
  // Audio
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
    const tone = (freq, dur = 0.3, type = 'sine', vol = 0.18, attack = 0.012) => {
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
    const pluck = (freq, vol = 0.22) => {
      if (!ready()) return;
      tone(freq, 0.55, 'sine', vol, 0.003);
      tone(freq * 2, 0.18, 'sine', vol * 0.3, 0.003);
    };
    const bell = (freqs, vol = 0.14) => {
      freqs.forEach((f, i) => setTimeout(() => tone(f, 0.95, 'sine', vol, 0.003), i * 65));
    };
    const error = () => tone(110, 0.18, 'square', 0.12, 0.001);
    const tick = (f, vol = 0.07) => tone(f, 0.07, 'triangle', vol, 0.001);
    return { init, resume, tone, pluck, bell, error, tick };
  })();

  // -------------------------------------------------------------------------
  // Math
  // -------------------------------------------------------------------------
  const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const TAU = Math.PI * 2;
  const shuffle = (arr, rng) => {
    const a = arr.slice();
    const r = rng || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const distPointToSeg = (px, py, ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 0.001) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

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
    buildStars();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 80));

  // -------------------------------------------------------------------------
  // Game state
  // -------------------------------------------------------------------------
  const STATE = {
    BOOT: 'boot', TITLE: 'title', TUTORIAL: 'tutorial',
    PLAYING: 'playing', PAUSED: 'paused',
    SUCCESS: 'success', FAILED: 'failed',
    ENDLESS_OVER: 'endless_over', DAILY_RESULT: 'daily_result',
  };
  let state = STATE.BOOT;

  const G = {
    mode: 'story',            // 'story' | 'daily' | 'endless'
    levelIdx: 0,              // story: 0..9 ; endless: count of sigils traced
    sigilsThisRun: 0,         // endless score
    nodes: [],
    path: [],
    redStars: [],
    progress: 0,
    touching: false,
    fingerX: 0, fingerY: 0,
    fingerActive: false,
    timeLeft: 0,
    timeLimit: 0,
    elapsed: 0,
    hintAlpha: 1,
    hintFade: 0,
    mistakes: 0,
    runMistakes: 0,
    flashAlpha: 0,
    successPhase: 0,
    successTimer: 0,
    stars: [],
    particles: [],
    nudge: 0,
    seededRng: null,           // when present, used for level gen
    config: null,
    transitioning: false,
  };

  const buildStars = () => {
    G.stars.length = 0;
    const count = reduceMotion ? 30 : 90;
    for (let i = 0; i < count; i++) {
      G.stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.2 + Math.random() * 0.8,
        twinkle: Math.random() * TAU,
      });
    }
  };

  // -------------------------------------------------------------------------
  // Level generation
  // -------------------------------------------------------------------------
  const PLAY_TOP = 92;
  const PLAY_BOTTOM = 110;
  const NODE_MIN_DIST = 92;

  const generateLevel = (cfg, rngFn) => {
    const rng = rngFn || Math.random;
    const r = (lo, hi) => lo + rng() * (hi - lo);
    const total = cfg.count + (cfg.decoys || 0);
    const nodes = [];
    const margin = 36;

    for (let i = 0; i < total; i++) {
      let x, y, tries = 0;
      do {
        x = r(margin, W - margin);
        y = r(PLAY_TOP + margin, H - PLAY_BOTTOM - margin);
        tries++;
      } while (tries < 80 && nodes.some(n => dist(n.baseX, n.baseY, x, y) < NODE_MIN_DIST));
      const node = {
        x, y, baseX: x, baseY: y,
        decoy: false, hit: false, touchedAt: 0, errorAt: 0,
      };
      if (cfg.drift) {
        node.drift = {
          cx: x, cy: y,
          radius: 12 + rng() * 22,
          speed: 0.18 + rng() * 0.38,
          phase: rng() * TAU,
        };
      }
      nodes.push(node);
    }

    const order = shuffle(nodes.map((_, i) => i), rng);
    const required = order.slice(0, cfg.count);
    const decoys = order.slice(cfg.count);
    decoys.forEach(i => { nodes[i].decoy = true; });

    // Nearest-neighbor path through required
    const path = [];
    const seen = new Set();
    let cur = required[Math.floor(rng() * required.length)];
    path.push(cur); seen.add(cur);
    while (seen.size < required.length) {
      let best = -1, bd = Infinity;
      for (const i of required) {
        if (seen.has(i)) continue;
        const d = dist(nodes[cur].baseX, nodes[cur].baseY, nodes[i].baseX, nodes[i].baseY);
        if (d < bd) { bd = d; best = i; }
      }
      path.push(best); seen.add(best); cur = best;
    }

    // Red stars — placed away from path nodes, but possibly near path segments
    // (that's the point: the player must steer around them)
    const redStars = [];
    const redCount = cfg.redCount || 0;
    for (let i = 0; i < redCount; i++) {
      let x, y, ok = false;
      for (let tries = 0; tries < 80 && !ok; tries++) {
        x = r(margin + 12, W - margin - 12);
        y = r(PLAY_TOP + margin + 12, H - PLAY_BOTTOM - margin - 12);
        // Keep red stars away from node centers so they don't sit on a target
        const tooClose = nodes.some(n => dist(n.baseX, n.baseY, x, y) < 56);
        // And away from each other
        const tooClose2 = redStars.some(rr => dist(rr.x, rr.y, x, y) < 90);
        ok = !tooClose && !tooClose2;
      }
      redStars.push({ x, y, pulse: rng() * TAU });
    }

    return { nodes, path, redStars, cfg };
  };

  const loadLevel = (cfg, rngFn) => {
    const lvl = generateLevel(cfg, rngFn);
    G.nodes = lvl.nodes;
    G.path = lvl.path;
    G.redStars = lvl.redStars;
    G.config = lvl.cfg;
    G.progress = 0;
    G.touching = false;
    G.fingerActive = false;
    G.elapsed = 0;
    G.timeLimit = lvl.cfg.time || 0;
    G.timeLeft = G.timeLimit;
    G.hintFade = lvl.cfg.hintFade || 0;
    G.hintAlpha = 1;
    G.mistakes = 0;
    G.flashAlpha = 0;
    G.successPhase = 0;
    G.successTimer = 0;
    G.particles.length = 0;
    G.nudge = 0;
    G.transitioning = false;
    updateLevelLabel();
  };

  // -------------------------------------------------------------------------
  // Particles
  // -------------------------------------------------------------------------
  const spawnParticles = (x, y, color, n = 14, sp = 110, life = 0.7, size = 2.2) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = sp * (0.3 + Math.random() * 0.7);
      G.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life, maxLife: life, color, size: size * (0.6 + Math.random() * 0.6),
      });
    }
  };
  const advanceParticles = (dt) => {
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.life -= dt;
      if (p.life <= 0) G.particles.splice(i, 1);
    }
  };

  // -------------------------------------------------------------------------
  // Drift update — moving stars (only unhit ones)
  // -------------------------------------------------------------------------
  const advanceNodes = (dt) => {
    for (const n of G.nodes) {
      if (n.drift && !n.hit) {
        const d = n.drift;
        d.phase += d.speed * dt;
        n.x = d.cx + Math.cos(d.phase) * d.radius;
        n.y = d.cy + Math.sin(d.phase) * d.radius;
      }
    }
  };

  // -------------------------------------------------------------------------
  // Game logic
  // -------------------------------------------------------------------------
  const NODE_HIT_RADIUS = 38;
  const RED_THRESHOLD = 22;

  const onCorrectHit = (nodeIdx) => {
    const node = G.nodes[nodeIdx];
    node.hit = true;
    node.touchedAt = performance.now();
    G.progress += 1;
    const noteIdx = Math.min(G.progress - 1 + Math.floor(G.levelIdx / 2), TUNING.length - 1);
    Audio.pluck(TUNING[noteIdx], 0.20);
    vibrate(6);
    spawnParticles(node.x, node.y, C.star, 8, 90, 0.5, 1.6);
    if (G.progress === G.path.length) onSigilComplete();
  };

  const onWrongHit = () => {
    G.mistakes += 1;
    G.runMistakes += 1;
    G.flashAlpha = 0.45;
    G.nudge = 10;
    Audio.error();
    vibrate([10, 40, 10]);
    G.nodes.forEach(n => { n.hit = false; });
    G.progress = 0;
    G.touching = false;
  };

  const tryHitAt = (x, y) => {
    let best = -1, bd = NODE_HIT_RADIUS;
    for (let i = 0; i < G.nodes.length; i++) {
      const n = G.nodes[i];
      const d = dist(n.x, n.y, x, y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const segmentCrossesRed = (ax, ay, bx, by) => {
    for (const r of G.redStars) {
      if (distPointToSeg(r.x, r.y, ax, ay, bx, by) < RED_THRESHOLD) return r;
    }
    return null;
  };

  const onSigilComplete = () => {
    G.successPhase = 1;
    G.successTimer = 0;
    Audio.bell([523.25, 659.25, 783.99, 1046.5], 0.12);
    vibrate([6, 60, 6, 60, 12]);
    for (let i = 0; i < G.path.length; i++) {
      const n = G.nodes[G.path[i]];
      setTimeout(() => spawnParticles(n.x, n.y, C.warm, 14, 130, 0.7, 2.4), i * 60);
    }
    store.sigilsTraced += 1;
    saveStore();
  };

  const onTimeUp = () => {
    if (G.successPhase !== 0 || G.transitioning) return;
    G.transitioning = true;
    Audio.tone(80, 0.6, 'sine', 0.28, 0.001);
    vibrate([12, 80, 12]);
    if (G.mode === 'endless') endEndlessRun(false);
    else if (G.mode === 'daily') endDailyAttempt(false);
    else endStoryAttempt(false);
  };

  // -------------------------------------------------------------------------
  // Mode handlers
  // -------------------------------------------------------------------------
  const startStory = (levelIdx) => {
    G.mode = 'story';
    G.levelIdx = levelIdx;
    G.runMistakes = 0;
    G.seededRng = null;
    applyPalette(paletteFor('REMEMBERED', 'homekeeper', 'prime', levelIdx));
    state = STATE.PLAYING;
    loadLevel(STORY_LEVELS[Math.min(levelIdx, STORY_LEVELS.length - 1)]);
    showScreens({ hud: true });
  };

  const startDaily = () => {
    G.mode = 'daily';
    G.levelIdx = 0;
    G.runMistakes = 0;
    const dateKey = todayKey();
    const seed = hashString('sigil-daily-' + dateKey);
    G.seededRng = mulberry32(seed);
    // Daily gets a unique hue each day — colour is part of "today's signal"
    applyPalette(paletteFor('REMEMBERED', 'daily', dateKey));
    state = STATE.PLAYING;
    loadLevel(DAILY_CONFIG, G.seededRng);
    showScreens({ hud: true });
  };

  const startEndless = (startIdx = 0) => {
    G.mode = 'endless';
    G.levelIdx = startIdx;
    G.sigilsThisRun = 0;
    G.runMistakes = 0;
    G.seededRng = null;
    // Endless hue shifts every level — you "descend through colour"
    applyPalette(paletteFor('REMEMBERED', 'endless', null, 'endless-' + startIdx));
    state = STATE.PLAYING;
    loadLevel(generateEndlessConfig(startIdx));
    showScreens({ hud: true });
  };

  const onStoryComplete = () => {
    const lineIdx = G.levelIdx;
    let firstTime = false;
    if (lineIdx < TOTAL_LINES && !store.recoveredLines.includes(lineIdx)) {
      store.recoveredLines.push(lineIdx);
      store.recoveredLines.sort((a, b) => a - b);
      firstTime = true;
      if (store.recoveredLines.length >= TOTAL_LINES && !store.complete) {
        store.complete = true;
      }
    }
    store.nextLevel = Math.min(STORY_LEVELS.length - 1, Math.max(store.nextLevel, G.levelIdx + 1));
    if (G.mistakes === 0) {
      // Track best perfect-streak across story
      store.bestPerfect = Math.max(store.bestPerfect || 0, 1);
    }
    saveStore();
    showStorySuccess(firstTime);
  };

  const onDailyComplete = () => {
    if (!store.dailyTodayComplete) {
      // streak handling: link to lastDate (last completed date)
      if (store.dailyLastDate === yesterdayKey()) {
        store.dailyStreak += 1;
      } else if (store.dailyLastDate === todayKey()) {
        // already counted (shouldn't happen since dailyTodayComplete was false)
      } else {
        store.dailyStreak = 1;
      }
      store.dailyLastDate = todayKey();
      store.dailyBestStreak = Math.max(store.dailyBestStreak || 0, store.dailyStreak);
      store.dailyTodayComplete = true;
      store.dailyTodayMistakes = G.mistakes;
    } else {
      // replay for fun — keep the best mistake count
      if (G.mistakes < (store.dailyTodayMistakes ?? Infinity)) {
        store.dailyTodayMistakes = G.mistakes;
      }
    }
    saveStore();
    showDailyResult();
  };

  const onEndlessComplete = () => {
    G.sigilsThisRun += 1;
    G.levelIdx += 1;
    // Shift the palette on each new endless sigil — colour drift over depth
    applyPalette(paletteFor('REMEMBERED', 'endless', null, 'endless-' + G.levelIdx));
    setTimeout(() => {
      if (state !== STATE.PLAYING) return;
      loadLevel(generateEndlessConfig(G.levelIdx));
    }, 1200);
  };

  const endStoryAttempt = (success) => {
    if (success) onStoryComplete();
    else {
      state = STATE.FAILED;
      document.getElementById('fail-msg').textContent = 'the signal slipped. trace it again.';
      document.getElementById('fail-level').textContent =
        `SIGIL ${String(G.levelIdx + 1).padStart(2, '0')}`;
      showScreens({ failed: true });
    }
  };

  const endDailyAttempt = (success) => {
    if (success) {
      onDailyComplete();
    } else {
      state = STATE.DAILY_RESULT;
      const tag = document.getElementById('daily-result-tag');
      const title = document.getElementById('daily-result-title');
      const msg = document.getElementById('daily-result-msg');
      const stats = document.getElementById('daily-result-stats');
      const retryBtn = document.getElementById('btn-daily-retry');
      tag.textContent = `DAILY ${todayKey()}`;
      title.textContent = 'signal slipped';
      msg.textContent = 'today\'s signal escaped. try again.';
      stats.textContent = store.dailyStreak > 0 ? `streak: ${store.dailyStreak}` : 'no streak yet';
      retryBtn.textContent = 'retrace today\'s sigil';
      retryBtn.hidden = false;
      showScreens({ daily_result: true });
    }
  };

  const endEndlessRun = (success) => {
    const score = G.sigilsThisRun;
    const newBest = score > (store.endlessBest || 0);
    if (newBest) store.endlessBest = score;
    store.endlessRuns = (store.endlessRuns || 0) + 1;
    saveStore();
    state = STATE.ENDLESS_OVER;
    document.getElementById('endless-score').textContent = String(score).padStart(2, '0');
    document.getElementById('endless-best-display').textContent = String(store.endlessBest).padStart(2, '0');
    document.getElementById('endless-new').hidden = !newBest;
    showScreens({ endless_over: true });
  };

  // After the success-phase celebration finishes, transition based on mode
  const onCelebrationEnd = () => {
    if (G.mode === 'story') endStoryAttempt(true);
    else if (G.mode === 'daily') endDailyAttempt(true);
    else if (G.mode === 'endless') onEndlessComplete();
  };

  // -------------------------------------------------------------------------
  // Update loop
  // -------------------------------------------------------------------------
  const advanceStars = (dt) => {
    for (const s of G.stars) s.twinkle += dt * 1.4 * s.z;
  };

  const advanceGame = (dt) => {
    if (state !== STATE.PLAYING && state !== STATE.TUTORIAL) return;
    G.elapsed += dt;
    if (G.successPhase === 0 && G.timeLimit > 0) {
      G.timeLeft = Math.max(0, G.timeLeft - dt);
      if (G.timeLeft <= 0) onTimeUp();
    }
    advanceNodes(dt);
    if (G.hintFade > 0) {
      G.hintAlpha = clamp(1 - Math.max(0, G.elapsed - G.hintFade) / 2.5, 0, 1);
    }
    G.flashAlpha *= Math.pow(0.001, dt);
    G.nudge *= Math.pow(0.0008, dt);
    if (G.nudge < 0.1) G.nudge = 0;
    if (G.successPhase === 1) {
      G.successTimer += dt;
      const threshold = G.mode === 'endless' ? 1.0 : 1.6;
      if (G.successTimer > threshold) {
        G.successPhase = 2;
        onCelebrationEnd();
      }
    }
    updateHud();
  };

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------
  const drawStars = () => {
    for (const s of G.stars) {
      const a = 0.35 + 0.5 * (0.5 + 0.5 * Math.sin(s.twinkle));
      ctx.globalAlpha = a * s.z;
      ctx.fillStyle = '#cfc5ff';
      const sz = 0.4 + s.z * 1.0;
      ctx.fillRect(s.x, s.y, sz, sz);
    }
    ctx.globalAlpha = 1;
  };

  const drawHintPath = () => {
    if (G.hintAlpha < 0.001 || !G.path.length) return;
    const a = G.hintAlpha;
    ctx.save();
    ctx.strokeStyle = accentRgba(0.18 * a);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < G.path.length; i++) {
      const n = G.nodes[G.path[i]];
      if (i === 0) ctx.moveTo(n.x, n.y); else ctx.lineTo(n.x, n.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    const first = G.nodes[G.path[0]];
    ctx.strokeStyle = accentRgba(0.4 * a);
    ctx.beginPath(); ctx.arc(first.x, first.y, 22, 0, TAU); ctx.stroke();
    ctx.restore();
  };

  const drawCompletedPath = () => {
    if (G.progress < 1) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < G.progress - 1; i++) {
      const a = G.nodes[G.path[i]];
      const b = G.nodes[G.path[i + 1]];
      const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
      grad.addColorStop(0, 'rgba(255, 245, 216, 0.95)');
      grad.addColorStop(1, 'rgba(255, 216, 154, 0.95)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3;
      ctx.shadowColor = 'rgba(255, 216, 154, 0.55)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (G.touching && G.progress > 0 && G.progress < G.path.length) {
      const a = G.nodes[G.path[G.progress - 1]];
      // Color the active stroke red if it's currently crossing a red zone
      const crossing = G.redStars.length && segmentCrossesRed(a.x, a.y, G.fingerX, G.fingerY);
      ctx.strokeStyle = crossing
        ? 'rgba(255, 90, 107, 0.85)'
        : 'rgba(255, 245, 216, 0.65)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(G.fingerX, G.fingerY);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawRedStars = () => {
    for (const r of G.redStars) {
      r.pulse += 0.04;
      const halo = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, RED_THRESHOLD + 6);
      halo.addColorStop(0, 'rgba(255, 90, 107, 0.35)');
      halo.addColorStop(1, 'rgba(255, 90, 107, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(r.x, r.y, RED_THRESHOLD + 6, 0, TAU); ctx.fill();
      // danger ring
      ctx.strokeStyle = `rgba(255, 90, 107, ${0.45 + Math.sin(r.pulse) * 0.15})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(r.x, r.y, RED_THRESHOLD, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      // core
      ctx.fillStyle = C.red;
      ctx.beginPath(); ctx.arc(r.x, r.y, 3, 0, TAU); ctx.fill();
    }
  };

  const drawNodes = () => {
    const now = performance.now();
    const nextRequired = G.progress < G.path.length ? G.path[G.progress] : -1;
    for (let i = 0; i < G.nodes.length; i++) {
      const n = G.nodes[i];
      const isNext = i === nextRequired;
      const isCompleted = n.hit;
      const sinceError = n.errorAt ? (now - n.errorAt) / 1000 : Infinity;
      const haloRadius = isNext ? 30 + Math.sin(G.elapsed * 4) * 3 : 18;
      const haloColor = isCompleted ? 'rgba(255, 216, 154, 0.45)' :
                        isNext ? accentRgba(0.5) :
                        sinceError < 0.6 ? `rgba(255, 90, 107, ${0.6 * (1 - sinceError / 0.6)})` :
                        'rgba(255, 245, 216, 0.18)';
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloRadius);
      grad.addColorStop(0, haloColor);
      grad.addColorStop(1, haloColor.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(n.x, n.y, haloRadius, 0, TAU); ctx.fill();

      const coreColor = isCompleted ? C.starGlow :
                        isNext ? C.accent :
                        sinceError < 0.6 ? C.warn : C.star;
      ctx.fillStyle = coreColor;
      ctx.beginPath(); ctx.arc(n.x, n.y, isNext ? 4.5 : 3.5, 0, TAU); ctx.fill();

      if (isNext) {
        ctx.strokeStyle = accentRgba(0.7);
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(n.x, n.y, 16 + Math.sin(G.elapsed * 4) * 1.5, 0, TAU);
        ctx.stroke();
      }
      // Subtle drift orbit indicator for moving stars (only unhit, only when hint visible)
      if (n.drift && !n.hit && G.hintAlpha > 0.2) {
        ctx.strokeStyle = `rgba(160, 200, 255, ${0.10 * G.hintAlpha})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(n.drift.cx, n.drift.cy, n.drift.radius, 0, TAU);
        ctx.stroke();
      }
    }
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
    if (G.flashAlpha > 0.001) {
      ctx.fillStyle = `rgba(255, 90, 107, ${G.flashAlpha * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  };

  const render = () => {
    ctx.clearRect(0, 0, W, H);
    let sx = 0, sy = 0;
    if (G.nudge > 0.1) {
      sx = (Math.random() - 0.5) * G.nudge;
      sy = (Math.random() - 0.5) * G.nudge;
    }
    ctx.save();
    ctx.translate(sx, sy);
    drawStars();
    if (state === STATE.PLAYING || state === STATE.TUTORIAL || state === STATE.PAUSED) {
      drawHintPath();
      drawRedStars();
      drawCompletedPath();
      drawNodes();
      drawParticles();
    }
    drawFlash();
    ctx.restore();
  };

  let last = performance.now();
  const loop = (now) => {
    let dt = (now - last) / 1000;
    if (dt > 0.08) dt = 0.08;
    last = now;
    advanceStars(dt);
    advanceParticles(dt);
    advanceGame(dt);
    render();
    requestAnimationFrame(loop);
  };

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------
  const playable = () => state === STATE.PLAYING || state === STATE.TUTORIAL;

  const handleHit = (x, y, isInitial) => {
    const hit = tryHitAt(x, y);
    if (hit === -1) return;
    if (G.nodes[hit].hit) return; // already touched

    if (isInitial) {
      if (hit === G.path[0]) {
        G.touching = true;
        onCorrectHit(hit);
      } else if (G.nodes[hit].decoy || hit !== G.path[G.progress]) {
        onWrongHit();
      }
    } else {
      if (G.progress < G.path.length && hit === G.path[G.progress]) {
        onCorrectHit(hit);
      } else if (G.nodes[hit].decoy || hit !== G.path[G.progress]) {
        onWrongHit();
      }
    }
  };

  const onPointerDown = (e) => {
    if (e.target.closest('button, .screen:not(.subtle)')) return;
    if (!playable() || G.successPhase !== 0) return;
    e.preventDefault();
    Audio.resume();
    const rect = canvas.getBoundingClientRect();
    G.fingerX = e.clientX - rect.left;
    G.fingerY = e.clientY - rect.top;
    G.fingerActive = true;
    handleHit(G.fingerX, G.fingerY, true);
  };

  const onPointerMove = (e) => {
    if (!G.fingerActive || !playable() || G.successPhase !== 0) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const prevX = G.fingerX, prevY = G.fingerY;
    G.fingerX = e.clientX - rect.left;
    G.fingerY = e.clientY - rect.top;
    if (!G.touching) return;

    // Red-star segment collision check on the active stroke
    if (G.redStars.length > 0 && G.progress > 0) {
      const last = G.nodes[G.path[G.progress - 1]];
      // Check incremental finger motion AND the full active stroke
      if (segmentCrossesRed(last.x, last.y, G.fingerX, G.fingerY)) {
        onWrongHit();
        return;
      }
    }

    handleHit(G.fingerX, G.fingerY, false);
  };

  const onPointerUp = (e) => {
    if (!G.fingerActive) return;
    G.fingerActive = false;
    if (G.successPhase !== 0) return;
    if (G.progress > 0 && G.progress < G.path.length) {
      G.nodes.forEach(n => { n.hit = false; });
      G.progress = 0;
      G.touching = false;
      Audio.tick(220, 0.05);
    }
  };

  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  window.addEventListener('pointermove', onPointerMove, { passive: false });
  window.addEventListener('pointerup', onPointerUp, { passive: false });
  window.addEventListener('pointercancel', onPointerUp, { passive: false });
  document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // -------------------------------------------------------------------------
  // Screens / UI
  // -------------------------------------------------------------------------
  const screens = {
    title: document.getElementById('screen-title'),
    tutorial: document.getElementById('screen-tutorial'),
    how: document.getElementById('screen-how'),
    archive: document.getElementById('screen-archive'),
    pause: document.getElementById('screen-pause'),
    success: document.getElementById('screen-success'),
    failed: document.getElementById('screen-failed'),
    endless_over: document.getElementById('screen-endless-over'),
    daily_result: document.getElementById('screen-daily-result'),
    map: document.getElementById('screen-map'),
    hud: document.getElementById('hud'),
  };
  const showScreens = (flags) => {
    for (const k of Object.keys(screens)) {
      if (screens[k]) screens[k].hidden = !flags[k];
    }
  };

  const updateLevelLabel = () => {
    const el = document.getElementById('hud-level');
    if (!el) return;
    if (G.mode === 'story') {
      el.textContent = `SIGIL ${String(G.levelIdx + 1).padStart(2, '0')} / ${String(STORY_LEVELS.length).padStart(2, '0')}`;
    } else if (G.mode === 'daily') {
      el.textContent = `DAILY · ${todayKey()}`;
    } else {
      el.textContent = `ENDLESS · ${String(G.sigilsThisRun).padStart(2, '0')}`;
    }
  };

  const updateHud = () => {
    const t = document.getElementById('hud-timer');
    if (G.timeLimit > 0 && state === STATE.PLAYING) {
      t.textContent = String(Math.ceil(G.timeLeft)).padStart(2, '0');
      t.classList.toggle('warn', G.timeLeft < 8);
      t.hidden = false;
    } else {
      t.hidden = true;
    }
    document.getElementById('hud-progress').textContent =
      `${G.progress} / ${G.path.length}`;
  };

  const refreshTitleStats = () => {
    refreshDailyDate();
    const rec = store.recoveredLines.length;
    document.getElementById('stat-recovered').textContent = String(rec);
    document.getElementById('stat-total').textContent = String(TOTAL_LINES);
    document.getElementById('recovery-bar-fill').style.width =
      ((rec / TOTAL_LINES) * 100) + '%';
    document.getElementById('recovery').classList.toggle('complete', store.complete);
    document.getElementById('stat-sigils').textContent = String(store.sigilsTraced);
    document.getElementById('stat-perfect').textContent = String(store.bestPerfect || 0);

    const sub = document.querySelector('#screen-title .subtitle');
    if (sub) {
      if (store.complete) sub.textContent = 'artefact whole — keep tracing';
      else if (rec === 0) sub.textContent = 'a sigil to redraw inside the phone';
      else if (rec < 4) sub.textContent = 'a signal is coming through';
      else if (rec < 8) sub.textContent = 'it remembers more each time';
      else sub.textContent = 'almost. almost.';
    }
    const bootTag = document.getElementById('boot-tag');
    if (bootTag) bootTag.textContent = store.complete ? 'ARTEFACT WHOLE' : 'ARTEFACT READY';

    // Show/hide the post-completion mode-select tiles
    const modes = document.getElementById('modes');
    const beginBtn = document.getElementById('btn-begin');
    if (store.complete) {
      modes.hidden = false;
      beginBtn.hidden = true;
    } else {
      modes.hidden = true;
      beginBtn.hidden = false;
      if (!store.seenTutorial && store.nextLevel === 0) beginBtn.textContent = 'BEGIN';
      else beginBtn.textContent = `CONTINUE · SIGIL ${String(store.nextLevel + 1).padStart(2, '0')}`;
    }

    // Mode tile stats
    document.getElementById('daily-streak').textContent = String(store.dailyStreak || 0);
    document.getElementById('daily-best-streak').textContent = String(store.dailyBestStreak || 0);
    const dailyToday = document.getElementById('daily-today');
    if (dailyToday) {
      dailyToday.textContent = store.dailyTodayComplete ? '✓ traced' : 'untraced';
      dailyToday.classList.toggle('done', store.dailyTodayComplete);
    }
    document.getElementById('endless-best').textContent = String(store.endlessBest || 0);
  };

  const refreshArchive = () => {
    const list = document.getElementById('archive-list');
    list.innerHTML = '';
    MESSAGE_LINES.forEach((text, i) => {
      const li = document.createElement('li');
      const unlocked = store.recoveredLines.includes(i);
      li.className = unlocked ? 'unlocked' : 'locked';
      li.textContent = unlocked ? text : '— — — — — — — —';
      list.appendChild(li);
    });
    const sub = document.getElementById('archive-sub');
    if (sub) {
      const rec = store.recoveredLines.length;
      if (store.complete) sub.textContent = 'the artefact is whole';
      else if (rec === 0) sub.textContent = 'trace your first sigil to decode a fragment';
      else sub.textContent = `${rec} of ${TOTAL_LINES} fragments decoded`;
    }
  };

  const showStorySuccess = (firstTime) => {
    const idx = G.levelIdx;
    const line = MESSAGE_LINES[idx];
    document.getElementById('success-num').textContent =
      `FRAGMENT ${String(idx + 1).padStart(2, '0')} / ${String(TOTAL_LINES).padStart(2, '0')}`;
    document.getElementById('success-line').textContent = line;
    document.getElementById('success-stats').textContent =
      G.mistakes === 0 ? 'TRACED CLEAN' : `${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}`;
    const nextBtn = document.getElementById('btn-success-next');
    const isLast = idx >= STORY_LEVELS.length - 1;
    nextBtn.textContent = isLast ? 'COMPLETE' : 'NEXT SIGIL';
    state = STATE.SUCCESS;
    showScreens({ success: true });
  };

  const showDailyResult = () => {
    const tag = document.getElementById('daily-result-tag');
    const title = document.getElementById('daily-result-title');
    const msg = document.getElementById('daily-result-msg');
    const stats = document.getElementById('daily-result-stats');
    const retryBtn = document.getElementById('btn-daily-retry');
    tag.textContent = `DAILY ${todayKey()}`;
    title.textContent = 'traced';
    msg.textContent = store.dailyStreak > 1
      ? 'come back tomorrow to keep the streak.'
      : 'come back tomorrow.';
    const mistakeText = G.mistakes === 0 ? 'TRACED CLEAN' :
      `${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}`;
    stats.textContent = `${mistakeText} · streak ${store.dailyStreak}`;
    retryBtn.textContent = 'retrace today\'s sigil';
    retryBtn.hidden = false;
    state = STATE.DAILY_RESULT;
    showScreens({ daily_result: true });
  };

  // -------------------------------------------------------------------------
  // Tutorial
  // -------------------------------------------------------------------------
  const startTutorial = () => {
    G.mode = 'story';
    G.levelIdx = 0;
    G.runMistakes = 0;
    state = STATE.TUTORIAL;
    loadLevel(STORY_LEVELS[0]);
    G.timeLimit = 0; G.timeLeft = 0;
    G.hintFade = 0;
    showScreens({ tutorial: true, hud: true });
  };

  // -------------------------------------------------------------------------
  // Galaxy / Solar / World map
  // Data-driven so updates can append content without rewriting.
  // Position fields are normalized 0..1 within their parent view.
  // -------------------------------------------------------------------------
  const GALAXY = {
    name: 'REMEMBERED',
    systems: [
      // Top rim
      { id: 'null',         name: 'NULL',         kicker: 'no carrier',
        x: 0.50, y: 0.07, unlocked: false,
        note: 'the silence between transmissions. last solar in the galaxy.', worlds: [] },
      { id: 'deepcarrier',  name: 'DEEP CARRIER', kicker: 'below the band',
        x: 0.22, y: 0.18, unlocked: false,
        note: 'a sub-frequency. requires HOMEKEEPER · whole.', worlds: [] },
      { id: 'nineteen',     name: '1981',         kicker: 'the year they left',
        x: 0.78, y: 0.18, unlocked: false,
        note: 'the operator who closed the room. requires MNEMOSYNE.', worlds: [] },

      // Upper orbit
      { id: 'farecho',      name: 'FAR ECHO',     kicker: 'past signal',
        x: 0.12, y: 0.36, unlocked: false,
        note: 'reachable when HOMEKEEPER · PRIME is complete.', worlds: [] },
      { id: 'outer',        name: 'OUTER',        kicker: 'edge of carrier',
        x: 0.88, y: 0.36, unlocked: false,
        note: 'a faint signal. coming in a future update.', worlds: [] },

      // Centre — the live solar
      {
        id: 'homekeeper', name: 'HOMEKEEPER', kicker: 'home system',
        x: 0.50, y: 0.50, unlocked: true,
        worlds: [
          { id: 'prime', name: 'PRIME', kicker: 'the message',
            x: 0.50, y: 0.50, unlocked: true,
            sigilCount: STORY_LEVELS.length, mode: 'story' },
          { id: 'drift', name: 'DRIFT', kicker: 'moving stars',
            x: 0.22, y: 0.74, unlocked: false, sigilCount: 24, mode: 'drift',
            note: 'unlocked once homekeeper · prime is complete (next update)' },
          { id: 'cross', name: 'CROSS', kicker: 'avoid the red',
            x: 0.78, y: 0.74, unlocked: false, sigilCount: 24, mode: 'cross',
            note: 'requires drift · coming soon' },
        ],
      },

      // Lower orbit
      { id: 'mnemosyne',    name: 'MNEMOSYNE',    kicker: 'memory orbit',
        x: 0.12, y: 0.64, unlocked: false,
        note: 'before the keys were ever pressed. requires FAR ECHO.', worlds: [] },
      { id: 'lunaria',      name: 'LUNARIA',      kicker: 'a named moon',
        x: 0.88, y: 0.64, unlocked: false,
        note: 'the moon you orbit. requires OUTER.', worlds: [] },

      // Lower rim
      { id: 'thequiet',     name: 'THE QUIET',    kicker: 'between keys',
        x: 0.22, y: 0.82, unlocked: false,
        note: 'the long pause. requires 1981.', worlds: [] },
      { id: 'coldroom',     name: 'COLD ROOM',    kicker: 'the waiting',
        x: 0.78, y: 0.82, unlocked: false,
        note: 'they left the radio on. requires DEEP CARRIER.', worlds: [] },

      // Bottom
      { id: 'hibernal',     name: 'HIBERNAL',     kicker: 'sleep cycle',
        x: 0.38, y: 0.93, unlocked: false,
        note: 'winters between transmissions. requires LUNARIA.', worlds: [] },
      { id: 'origin',       name: 'ORIGIN',       kicker: 'unknown',
        x: 0.62, y: 0.93, unlocked: false,
        note: 'silent. for now.', worlds: [] },
    ],
  };

  const Map = (() => {
    let view = 'galaxy';      // 'galaxy' | 'solar' | 'world'
    let sysId = null;
    let worldId = null;

    const svg = () => document.getElementById('map-svg');
    const nodes = () => document.getElementById('map-nodes');

    const clearMap = () => {
      svg().innerHTML = '';
      nodes().innerHTML = '';
    };

    const setHeader = (kicker, title) => {
      document.getElementById('map-kicker').textContent = kicker;
      document.getElementById('map-title').textContent = title;
    };

    const setStatus = (text) => {
      document.getElementById('map-status').textContent = text || '';
    };

    const lineSvg = (x1, y1, x2, y2, opts = {}) => {
      const ns = 'http://www.w3.org/2000/svg';
      const el = document.createElementNS(ns, 'line');
      el.setAttribute('x1', x1); el.setAttribute('y1', y1);
      el.setAttribute('x2', x2); el.setAttribute('y2', y2);
      el.setAttribute('stroke', opts.color || 'rgba(241, 234, 216, 0.12)');
      el.setAttribute('stroke-width', opts.width || 0.6);
      if (opts.dash) el.setAttribute('stroke-dasharray', opts.dash);
      svg().appendChild(el);
    };

    const circleSvg = (cx, cy, r, opts = {}) => {
      const ns = 'http://www.w3.org/2000/svg';
      const el = document.createElementNS(ns, 'circle');
      el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
      el.setAttribute('fill', opts.fill || 'none');
      el.setAttribute('stroke', opts.stroke || 'rgba(241, 234, 216, 0.10)');
      el.setAttribute('stroke-width', opts.width || 0.6);
      if (opts.dash) el.setAttribute('stroke-dasharray', opts.dash);
      svg().appendChild(el);
    };

    const makeNode = (x, y, name, classes, meta, onClick) => {
      const b = document.createElement('button');
      b.className = 'map-node ' + (classes || '');
      b.style.left = (x * 100) + '%';
      b.style.top = (y * 100) + '%';
      const dot = document.createElement('div'); dot.className = 'map-node-dot';
      const lbl = document.createElement('div'); lbl.className = 'map-node-label'; lbl.textContent = name;
      b.appendChild(dot); b.appendChild(lbl);
      if (meta) {
        const m = document.createElement('div'); m.className = 'map-node-meta'; m.textContent = meta;
        b.appendChild(m);
      }
      if (onClick) b.addEventListener('click', onClick);
      else b.disabled = true;
      nodes().appendChild(b);
      return b;
    };

    const renderGalaxy = () => {
      clearMap();
      setHeader('GALAXY', GALAXY.name);

      // A few concentric reference rings — feels like a galactic chart
      // without drawing twelve overlapping circles.
      [180, 320, 460].forEach(r => {
        circleSvg(500, 500, r, {
          stroke: 'rgba(241, 234, 216, 0.05)', dash: '2 8',
        });
      });
      // Central singularity / unknown core
      circleSvg(500, 500, 30, { stroke: 'rgba(255, 245, 216, 0.18)', dash: '3 5' });
      circleSvg(500, 500, 6, { fill: 'rgba(255, 245, 216, 0.55)' });

      GALAXY.systems.forEach(sys => {
        const totalWorlds = sys.worlds.length;
        const unlockedWorlds = sys.worlds.filter(w => w.unlocked).length;
        const meta = sys.unlocked
          ? (totalWorlds > 0 ? `${unlockedWorlds} / ${totalWorlds} worlds` : 'empty')
          : 'locked';
        const cls = sys.unlocked ? 'current' : 'locked';
        makeNode(sys.x, sys.y, sys.name, cls, meta, () => {
          if (sys.unlocked) showSolar(sys.id);
          else setStatus(sys.note || 'locked.');
        });
      });

      setStatus('tap a solar system to descend');
    };

    const renderSolar = (id) => {
      sysId = id;
      const sys = GALAXY.systems.find(s => s.id === id);
      if (!sys) return renderGalaxy();
      applyPalette(paletteFor('REMEMBERED', id));
      clearMap();
      setHeader('SOLAR · ' + GALAXY.name, sys.name);

      // central star of the system
      circleSvg(500, 500, 18, { stroke: 'rgba(255, 184, 107, 0.7)', width: 1.2 });
      circleSvg(500, 500, 8, { fill: 'rgba(255, 184, 107, 0.5)' });

      // worlds orbit the star
      sys.worlds.forEach(w => {
        const wx = w.x * 1000, wy = w.y * 1000;
        const r = dist(500, 500, wx, wy);
        circleSvg(500, 500, r, {
          stroke: w.unlocked ? accentRgba(0.22) : 'rgba(241, 234, 216, 0.05)',
          dash: '2 6',
        });
      });

      if (sys.worlds.length === 0) {
        const div = document.createElement('div');
        div.className = 'map-node current';
        div.style.left = '50%'; div.style.top = '50%';
        div.style.transform = 'translate(-50%, -50%)';
        const lbl = document.createElement('div');
        lbl.className = 'map-node-label';
        lbl.textContent = sys.note || 'empty';
        div.appendChild(lbl);
        nodes().appendChild(div);
      } else {
        sys.worlds.forEach(w => {
          const meta = w.unlocked ? `${w.sigilCount} sigils` : 'locked';
          let cls = w.unlocked ? '' : 'locked';
          // Mark prime as complete or current
          if (w.unlocked && w.id === 'prime') {
            cls = store.complete ? 'complete' : 'current';
          }
          makeNode(w.x, w.y, w.name, cls, meta,
            w.unlocked ? () => showWorld(sys.id, w.id) : null);
        });
      }

      setStatus(sys.worlds.some(w => w.unlocked) ?
        'tap a world to see its sigils' :
        sys.note || 'no worlds online yet');
    };

    const showWorld = (sId, wId) => {
      worldId = wId;
      view = 'world';
      renderWorld(sId, wId);
    };

    const renderWorld = (sId, wId) => {
      const sys = GALAXY.systems.find(s => s.id === sId);
      const w = sys?.worlds.find(ww => ww.id === wId);
      if (!w) return renderGalaxy();
      applyPalette(paletteFor('REMEMBERED', sId, wId));
      clearMap();
      setHeader('WORLD · ' + sys.name, w.name);

      const n = w.sigilCount;
      // Arrange sigils as a constellation: gentle spiral inside the play area
      const cx = 500, cy = 500;
      const positions = [];
      for (let i = 0; i < n; i++) {
        const t = i / Math.max(1, n - 1);
        const angle = t * Math.PI * 2.4 - Math.PI / 2;
        const radius = 120 + t * 280;
        positions.push({
          x: cx + Math.cos(angle) * radius,
          y: cy + Math.sin(angle) * radius,
        });
      }

      // Connect consecutive sigils with faint lines
      for (let i = 0; i < positions.length - 1; i++) {
        const a = positions[i], b = positions[i + 1];
        const recovered = store.recoveredLines.includes(i) && store.recoveredLines.includes(i + 1);
        lineSvg(a.x, a.y, b.x, b.y, {
          color: recovered ? 'rgba(255, 184, 107, 0.5)' : 'rgba(241, 234, 216, 0.08)',
          width: recovered ? 1.4 : 0.6,
        });
      }

      // Render sigil buttons
      for (let i = 0; i < n; i++) {
        const done = store.recoveredLines.includes(i);
        const isNext = !done && i === (store.nextLevel || 0);
        const locked = i > (store.nextLevel || 0) && !done;
        const cls = ['sigil-node'];
        if (done) cls.push('done');
        else if (isNext) cls.push('next');
        else if (locked) cls.push('locked');
        const b = document.createElement('button');
        b.className = cls.join(' ');
        b.style.left = (positions[i].x / 1000 * 100) + '%';
        b.style.top = (positions[i].y / 1000 * 100) + '%';
        b.textContent = String(i + 1).padStart(2, '0');
        if (!locked) {
          b.addEventListener('click', () => {
            closeMap();
            Audio.init(); Audio.resume();
            startStory(i);
          });
        } else {
          b.disabled = true;
        }
        nodes().appendChild(b);
      }

      const remaining = n - store.recoveredLines.length;
      const status = store.complete ? 'world whole — tap any sigil to retrace' :
                    remaining === n ? 'tap the cyan sigil to begin' :
                    `${remaining} fragment${remaining === 1 ? '' : 's'} remaining`;
      setStatus(status);
    };

    const showGalaxy = () => { view = 'galaxy'; renderGalaxy(); };
    const showSolar = (id) => { view = 'solar'; renderSolar(id); };

    const open = () => {
      view = 'galaxy';
      applyPalette(paletteFor('REMEMBERED'));
      showScreens({ map: true });
      renderGalaxy();
    };

    const back = () => {
      if (view === 'world') {
        // Going back from world to solar — restore solar palette
        applyPalette(paletteFor('REMEMBERED', sysId));
        showSolar(sysId);
      } else if (view === 'solar') {
        applyPalette(paletteFor('REMEMBERED'));
        showGalaxy();
      } else {
        closeMap();
      }
    };

    const closeMap = () => {
      view = 'galaxy';
      applyPalette(paletteFor('REMEMBERED'));
      state = STATE.TITLE;
      refreshTitleStats();
      showScreens({ title: true });
    };

    return { open, back, close: closeMap, refresh: () => {
      if (view === 'galaxy') renderGalaxy();
      else if (view === 'solar') renderSolar(sysId);
      else if (view === 'world') renderWorld(sysId, worldId);
    }};
  })();

  // -------------------------------------------------------------------------
  // Button wiring
  // -------------------------------------------------------------------------
  document.getElementById('btn-begin').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.bell([392, 523.25, 659.25], 0.10);
    vibrate([4, 18, 4]);
    if (!store.seenTutorial) {
      store.seenTutorial = true; saveStore();
      startTutorial();
    } else {
      startStory(store.nextLevel || 0);
    }
  });

  document.getElementById('btn-tut-skip').addEventListener('click', () => {
    store.seenTutorial = true; saveStore();
    state = STATE.PLAYING;
    showScreens({ hud: true });
  });

  document.getElementById('mode-daily').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.tick(660);
    startDaily();
  });
  document.getElementById('mode-endless').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.tick(660);
    startEndless(0);
  });
  document.getElementById('mode-replay').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.tick(660);
    startStory(0); // restart story from the top
  });

  document.getElementById('btn-success-next').addEventListener('click', () => {
    Audio.tick(660);
    const isLast = G.levelIdx >= STORY_LEVELS.length - 1;
    if (isLast) {
      state = STATE.TITLE;
      refreshTitleStats();
      showScreens({ title: true });
    } else {
      startStory(G.levelIdx + 1);
    }
  });
  document.getElementById('btn-success-menu').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
  });

  document.getElementById('btn-fail-retry').addEventListener('click', () => {
    Audio.tick(440);
    if (G.mode === 'story') startStory(G.levelIdx);
    else if (G.mode === 'daily') startDaily();
    else startEndless(0);
  });
  document.getElementById('btn-fail-menu').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
  });

  document.getElementById('btn-endless-again').addEventListener('click', () => {
    Audio.tick(440);
    startEndless(0);
  });
  document.getElementById('btn-endless-menu').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
  });

  document.getElementById('btn-daily-back').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
  });
  document.getElementById('btn-daily-retry').addEventListener('click', () => {
    startDaily();
  });

  document.getElementById('btn-how').addEventListener('click', () => {
    showScreens({ how: true });
  });
  document.getElementById('btn-how-back').addEventListener('click', () => {
    showScreens({ title: true });
  });

  document.getElementById('btn-archive').addEventListener('click', () => {
    refreshArchive();
    showScreens({ archive: true });
  });
  document.getElementById('btn-archive-back').addEventListener('click', () => {
    showScreens({ title: true });
  });

  document.getElementById('btn-map').addEventListener('click', () => {
    Audio.init(); Audio.resume(); Audio.tick(523.25, 0.08);
    Map.open();
  });
  document.getElementById('btn-map-back').addEventListener('click', () => Map.back());
  document.getElementById('btn-map-close').addEventListener('click', () => Map.close());

  document.getElementById('btn-pause').addEventListener('click', () => {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    showScreens({ pause: true, hud: true });
    Audio.tone(330, 0.18, 'triangle', 0.10, 0.001);
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    state = STATE.PLAYING;
    showScreens({ hud: true });
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    if (G.mode === 'story') startStory(G.levelIdx);
    else if (G.mode === 'daily') startDaily();
    else startEndless(0);
  });
  document.getElementById('btn-quit').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
  });

  const soundBtn = document.getElementById('btn-sound');
  const refreshSoundBtn = () => {
    soundBtn.textContent = `sound: ${store.sound ? 'on' : 'off'}`;
    soundBtn.setAttribute('aria-pressed', String(store.sound));
  };
  soundBtn.addEventListener('click', () => {
    store.sound = !store.sound; saveStore(); refreshSoundBtn();
    if (store.sound) { Audio.init(); Audio.resume(); Audio.tick(660); }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === STATE.PLAYING) {
      state = STATE.PAUSED;
      showScreens({ pause: true, hud: true });
    }
  });

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  const bootSequence = async () => {
    const tagEl = document.getElementById('boot-tag');
    const tags = ['CALIBRATING', 'TUNING', 'LINKING', store.complete ? 'ARTEFACT WHOLE' : 'ARTEFACT READY'];
    showScreens({ title: true });
    refreshTitleStats();
    refreshSoundBtn();
    for (let i = 0; i < tags.length; i++) {
      tagEl.textContent = tags[i];
      await new Promise(r => setTimeout(r, reduceMotion ? 100 : 380));
    }
    state = STATE.TITLE;
  };

  resize();
  buildStars();
  applyPalette(paletteFor('REMEMBERED'));
  bootSequence();
  requestAnimationFrame((t) => { last = t; loop(t); });

})();
