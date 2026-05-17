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
    if (Music.active) Music.setHue(p.hue);
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
    // Moving red stars enter the field once you're deep enough to handle them.
    const redDrift = idx >= 14;
    return { count, decoys, hintFade, time, drift, redCount, redDrift };
  };

  // Daily uses date as seed; config is fixed but feels different daily
  // because positions, decoys, and red star locations vary deterministically.
  // The daily red drifts fast, can sever lines, and is the day's challenge.
  const DAILY_CONFIG = {
    count: 6, decoys: 2, hintFade: 3.5, time: 40,
    drift: true, redCount: 1, redDrift: true, redDisconnects: true,
    redIntensity: 0.85,
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
    return { init, resume, tone, pluck, bell, error, tick, get ctx() { return actx; },
             get master() { return master; } };
  })();

  // -------------------------------------------------------------------------
  // Dynamic ambient music — generative drone whose fundamental tracks the
  // current world's hue. Layers: fundamental + perfect fifth + two octaves,
  // a slow LFO breath, and a low-rate random "wind chime" sparkle.
  // -------------------------------------------------------------------------
  const Music = (() => {
    let oscNodes = [];     // [{osc, gain, freq}]
    let lfo = null, lfoGain = null;
    let bus = null;        // music master gain
    let active = false;
    let currentHue = 190;
    let sparkleTimer = null;

    const ensureBus = () => {
      if (bus) return true;
      const ctx = Audio.ctx;
      if (!ctx) return false;
      bus = ctx.createGain();
      bus.gain.value = 0;
      bus.connect(ctx.destination);
      return true;
    };

    const hueToFundamental = (hue) => {
      // Map hue to a soft, low fundamental — C2 to C3 range.
      // Semitones 0..12, then up an octave for richness if hue is high.
      const baseHz = 65.41; // C2
      const semis = (hue / 360) * 12;
      return baseHz * Math.pow(2, semis / 12);
    };

    const harmonicsFor = (fund) => [
      fund,           // root
      fund * 1.5,     // perfect fifth
      fund * 2,       // octave
      fund * 3,       // octave + fifth
    ];

    const start = (hue) => {
      if (!ensureBus() || !store.sound || active) return;
      const ctx = Audio.ctx;
      const t = ctx.currentTime;
      active = true;
      if (typeof hue === 'number') currentHue = hue;

      const fund = hueToFundamental(currentHue);
      const freqs = harmonicsFor(fund);
      oscNodes = freqs.map((freq, i) => {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = freq;
        const g = ctx.createGain();
        const vol = 0.05 / (i + 1.2);
        g.gain.value = 0;
        g.gain.linearRampToValueAtTime(vol, t + 5);
        o.connect(g);
        g.connect(bus);
        o.start();
        return { osc: o, gain: g, freq };
      });

      // Slow LFO modulating bus amplitude — "breath"
      lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.07;
      lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.18;
      lfo.connect(lfoGain);
      lfoGain.connect(bus.gain);
      lfo.start();

      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(0, t);
      bus.gain.linearRampToValueAtTime(0.5, t + 5);

      // Wind chime sparkle — rare bell tone tuned to the harmonic
      const sparkle = () => {
        if (!active) return;
        if (store.sound && Audio.ctx) {
          const sparkFreq = freqs[2] * (Math.random() < 0.5 ? 2 : 3);
          const tt = Audio.ctx.currentTime;
          const o = Audio.ctx.createOscillator();
          const g = Audio.ctx.createGain();
          o.type = 'sine';
          o.frequency.value = sparkFreq;
          g.gain.setValueAtTime(0.0001, tt);
          g.gain.exponentialRampToValueAtTime(0.06, tt + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.4);
          o.connect(g); g.connect(bus);
          o.start(tt); o.stop(tt + 1.5);
        }
        sparkleTimer = setTimeout(sparkle, 4000 + Math.random() * 8000);
      };
      sparkleTimer = setTimeout(sparkle, 3000 + Math.random() * 4000);
    };

    const setHue = (hue) => {
      currentHue = hue;
      if (!active || !Audio.ctx) return;
      const t = Audio.ctx.currentTime;
      const fund = hueToFundamental(hue);
      const freqs = harmonicsFor(fund);
      oscNodes.forEach((n, i) => {
        try {
          n.osc.frequency.cancelScheduledValues(t);
          n.osc.frequency.setValueAtTime(n.osc.frequency.value, t);
          n.osc.frequency.exponentialRampToValueAtTime(freqs[i], t + 3);
          n.freq = freqs[i];
        } catch {}
      });
    };

    const setVolume = (v, fadeSec = 0.6) => {
      if (!bus || !Audio.ctx) return;
      const t = Audio.ctx.currentTime;
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(v, t + fadeSec);
    };

    const stop = () => {
      if (!active) return;
      const ctx = Audio.ctx;
      if (!ctx) { active = false; return; }
      const t = ctx.currentTime;
      active = false;
      if (sparkleTimer) { clearTimeout(sparkleTimer); sparkleTimer = null; }
      bus.gain.cancelScheduledValues(t);
      bus.gain.setValueAtTime(bus.gain.value, t);
      bus.gain.linearRampToValueAtTime(0, t + 1.5);
      const localOscs = oscNodes; const localLfo = lfo;
      oscNodes = []; lfo = null; lfoGain = null;
      setTimeout(() => {
        localOscs.forEach(n => { try { n.osc.stop(); } catch {} });
        if (localLfo) { try { localLfo.stop(); } catch {} }
      }, 1600);
    };

    return {
      start, stop, setHue, setVolume,
      get active() { return active; },
    };
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
    // visualViewport reflects iOS Safari's URL bar visibility correctly;
    // fall back to innerWidth/Height when not available.
    const vv = window.visualViewport;
    W = vv ? vv.width : window.innerWidth;
    H = vv ? vv.height : window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildStars();
  };
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 80));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', resize);
  }

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

    // ×2 knot — insert duplicate path entries so certain stars get visited twice.
    // Each knot picks a star already in path[] and inserts it again at a later
    // position (not immediately adjacent — that would be a no-op).
    const knots = Math.max(0, cfg.duplicates || 0);
    for (let k = 0; k < knots && required.length >= 3; k++) {
      // Prefer stars that are currently visited only once
      const candidates = required.filter(idx => path.filter(p => p === idx).length === 1);
      if (candidates.length === 0) break;
      const pickIdx = candidates[Math.floor(rng() * candidates.length)];
      // First occurrence index
      const firstAt = path.indexOf(pickIdx);
      // Insert at a position at least 2 steps later, before the end
      const minInsert = firstAt + 2;
      const maxInsert = path.length;
      if (minInsert >= maxInsert) {
        // Path too short; append at end
        path.push(pickIdx);
      } else {
        const at = minInsert + Math.floor(rng() * (maxInsert - minInsert + 1));
        path.splice(at, 0, pickIdx);
      }
    }

    // Per-node use accounting: how many times each node appears in the path
    nodes.forEach(n => { n.useCount = 0; n.requiredUses = 0; });
    path.forEach(idx => { nodes[idx].requiredUses += 1; });

    // Red stars — placed away from path nodes, but possibly near path segments
    // (that's the point: the player must steer around them).
    // When cfg.redDrift, each red star orbits slowly — you have to time
    // your stroke around moving hazards.
    const redStars = [];
    const redCount = cfg.redCount || 0;

    // Place a red star so it sits NEAR a path segment — guaranteed to
    // intercept the player's trace as it orbits. Falls back to random
    // placement if it can't find a workable spot.
    const placeRedNearSegment = () => {
      if (path.length < 2) return null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const segIdx = Math.floor(rng() * (path.length - 1));
        const a = nodes[path[segIdx]];
        const b = nodes[path[segIdx + 1]];
        const t = 0.30 + rng() * 0.40;
        const mx = a.baseX + (b.baseX - a.baseX) * t;
        const my = a.baseY + (b.baseY - a.baseY) * t;
        const sx = b.baseX - a.baseX, sy = b.baseY - a.baseY;
        const len = Math.hypot(sx, sy) || 1;
        const px = -sy / len, py = sx / len;
        const offset = 32 + rng() * 36;
        const sign = rng() < 0.5 ? 1 : -1;
        const x = mx + px * offset * sign;
        const y = my + py * offset * sign;
        if (x < margin + 12 || x > W - margin - 12) continue;
        if (y < PLAY_TOP + margin + 12 || y > H - PLAY_BOTTOM - margin - 12) continue;
        if (nodes.some(n => dist(n.baseX, n.baseY, x, y) < 50)) continue;
        if (redStars.some(rr => dist(rr.x, rr.y, x, y) < 90)) continue;
        return { x, y };
      }
      return null;
    };

    for (let i = 0; i < redCount; i++) {
      let pos = placeRedNearSegment();
      if (!pos) {
        // Fallback: original random placement
        let x, y, ok = false;
        for (let tries = 0; tries < 50 && !ok; tries++) {
          x = r(margin + 12, W - margin - 12);
          y = r(PLAY_TOP + margin + 12, H - PLAY_BOTTOM - margin - 12);
          const tooClose = nodes.some(n => dist(n.baseX, n.baseY, x, y) < 56);
          const tooClose2 = redStars.some(rr => dist(rr.x, rr.y, x, y) < 90);
          ok = !tooClose && !tooClose2;
        }
        pos = { x, y };
      }
      const { x, y } = pos;
      const red = { x, y, baseX: x, baseY: y, pulse: rng() * TAU };
      if (cfg.redDrift) {
        const intensity = cfg.redIntensity ?? 0.2;
        const linearChance = cfg.redLinearChance || 0;
        if (linearChance > 0 && rng() < linearChance) {
          // Linear sweep — crosses the field; wraps via advanceNodes
          const ang = rng() * TAU;
          const sp = 90 + 110 * intensity; // pixels/sec
          red.linear = {
            vx: Math.cos(ang) * sp,
            vy: Math.sin(ang) * sp,
          };
        } else {
          // Orbit radius scaled so that even at low intensity the red
          // sweeps far enough to actually cross the nearest path segment
          // (red is placed ~32–68 px from a line; min radius 50 guarantees
          // an intercept).
          red.drift = {
            cx: x, cy: y,
            radius: 50 + 30 * intensity + rng() * (28 + 60 * intensity),
            speed: 0.22 + 0.55 * intensity + rng() * (0.18 + 0.40 * intensity),
            phase: rng() * TAU,
          };
        }
      }
      redStars.push(red);
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
    // No-hint mode: the dashed path is never drawn, BUT we flash the full
    // path for 1 second on entry so the player gets a fleeting glimpse.
    G.noHintFlash = lvl.cfg.noHint ? 1.0 : 0;
    G.mistakes = 0;
    G.flashAlpha = 0;
    G.successPhase = 0;
    G.successTimer = 0;
    G.particles.length = 0;
    G.nudge = 0;
    G.transitioning = false;
    // Ghost of last attempt — if the last failed sigil matches this one,
    // expose the previous trace as a faint dotted overlay (idea #1).
    const sigilKeyCur = G.mode === 'sigil'
      ? sigilKey(G.playWorldId, G.playLevelIdx, G.playSigilIdx) : null;
    G.ghost = (G.lastGhost && G.lastGhost.key === sigilKeyCur) ? G.lastGhost.points : null;
    G.traceSamples = [];
    // Tip strip
    G.tipText = buildTip(lvl.cfg);
    G.tipUntil = performance.now() + 3200;
    // Reset per-sigil mechanic state
    G.holdNodeIdx = null;
    G.holdStartAt = 0;
    G.peekUntil = lvl.cfg.whisper ? performance.now() + 700 : 0; // brief opening peek
    G.peeksRemaining = lvl.cfg.whisper ? (lvl.cfg.peeks || 3) : 0;
    updateLevelLabel();
    // Force a paint on the next animation frame in case iOS Safari is
    // sitting on a stale canvas (we've occasionally seen the first
    // post-mode-tap render skip on mobile Safari).
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { try { render(); } catch (e) {} });
    }
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
    for (const r of G.redStars) {
      if (r.drift) {
        const d = r.drift;
        d.phase += d.speed * dt;
        r.x = d.cx + Math.cos(d.phase) * d.radius;
        r.y = d.cy + Math.sin(d.phase) * d.radius;
      } else if (r.linear) {
        r.x += r.linear.vx * dt;
        r.y += r.linear.vy * dt;
        // Wrap to opposite edge so the sweep is continuous
        const pad = 30;
        if (r.x < -pad) r.x = W + pad;
        else if (r.x > W + pad) r.x = -pad;
        if (r.y < PLAY_TOP - pad) r.y = H - PLAY_BOTTOM + pad;
        else if (r.y > H - PLAY_BOTTOM + pad) r.y = PLAY_TOP - pad;
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
    node.useCount = (node.useCount || 0) + 1;
    node.hit = node.requiredUses > 0 && node.useCount >= node.requiredUses;
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

  // Drifting red stars can sever a completed segment if they orbit
  // through it — gated by cfg.redDisconnects. Cooldown prevents rapid
  // multi-breaks if the red star is camped on the line.
  const checkLineBreaks = () => {
    if ((G.lineBreakCooldown || 0) > 0) {
      G.lineBreakCooldown = Math.max(0, G.lineBreakCooldown - 1 / 60);
      return;
    }
    for (let i = 0; i < G.progress - 1; i++) {
      const a = G.nodes[G.path[i]];
      const b = G.nodes[G.path[i + 1]];
      for (const r of G.redStars) {
        if (!r.drift) continue; // only drifting reds disconnect
        if (distPointToSeg(r.x, r.y, a.x, a.y, b.x, b.y) < RED_THRESHOLD) {
          breakLineAt(i, r);
          return;
        }
      }
    }
  };

  const breakLineAt = (segIdx, redStar) => {
    // Walk back: every node visited at path positions > segIdx loses one use
    for (let i = segIdx + 1; i < G.progress; i++) {
      const n = G.nodes[G.path[i]];
      n.useCount = Math.max(0, (n.useCount || 0) - 1);
      n.hit = n.requiredUses > 0 && n.useCount >= n.requiredUses;
    }
    G.progress = segIdx + 1;
    G.lineBreakCooldown = 1.2;
    // Feedback
    G.flashAlpha = Math.max(G.flashAlpha, 0.55);
    G.nudge = Math.max(G.nudge, 14);
    G.mistakes += 1;
    G.runMistakes += 1;
    Audio.error();
    Audio.tone(120, 0.3, 'sawtooth', 0.18, 0.001);
    vibrate([20, 60, 20, 40, 20]);
    if (redStar) spawnParticles(redStar.x, redStar.y, '#ff5a6b', 12, 130, 0.5, 2);
    // The active stroke is broken — release the finger requirement so
    // the player must re-touch the last good node before continuing.
    G.touching = false;
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
    // Ghost-of-last-attempt: remember the trace so the next try shows it.
    if (G.mode === 'sigil' && G.traceSamples && G.traceSamples.length > 4) {
      // Down-sample to a manageable number of points
      const step = Math.max(1, Math.floor(G.traceSamples.length / 80));
      const pts = [];
      for (let i = 0; i < G.traceSamples.length; i += step) pts.push(G.traceSamples[i]);
      G.lastGhost = {
        key: sigilKey(G.playWorldId, G.playLevelIdx, G.playSigilIdx),
        points: pts,
      };
    }
    if (G.mode === 'endless') endEndlessRun(false);
    else if (G.mode === 'daily') endDailyAttempt(false);
    else endStoryAttempt(false);
  };

  // -------------------------------------------------------------------------
  // Mode handlers
  // -------------------------------------------------------------------------
  const startStory = (levelIdx) => {
    // Legacy entry point: PRIME · LEVEL 01 · sigil <levelIdx>
    startSigil('prime', 0, levelIdx);
  };

  // First-time mechanic intros — collect every MECHANIC_INTROS entry whose
  // .test() matches this config and the player hasn't seen.
  const pendingIntros = (cfg) => {
    if (!Array.isArray(store.introsSeen)) store.introsSeen = [];
    const out = [];
    for (const k of Object.keys(MECHANIC_INTROS)) {
      const m = MECHANIC_INTROS[k];
      if (m.test(cfg) && !store.introsSeen.includes(m.key)) out.push(m);
    }
    return out;
  };
  const showMechIntro = (intro, onContinue) => {
    document.getElementById('mech-intro-title').textContent = intro.title;
    document.getElementById('mech-intro-body').textContent = intro.body;
    showScreens({ mech_intro: true });
    if (!Array.isArray(store.introsSeen)) store.introsSeen = [];
    if (!store.introsSeen.includes(intro.key)) {
      store.introsSeen.push(intro.key);
      saveStore();
    }
    const btn = document.getElementById('btn-mech-intro-continue');
    btn.onclick = () => { Audio.tick(660); onContinue(); };
  };
  const runIntroQueue = (intros, onDone) => {
    let i = 0;
    const next = () => {
      if (i >= intros.length) { onDone(); return; }
      showMechIntro(intros[i++], next);
    };
    next();
  };

  // Play any (world, level, sigil) coordinate. Configs come from getSigilCfg,
  // which returns the narrative STORY_LEVELS configs for PRIME · LEVEL 01 and
  // procedural rising-difficulty configs everywhere else.
  const startSigil = (worldId, lvlIdx, sigIdx) => {
    const cfg = getSigilCfg(worldId, lvlIdx, sigIdx);
    const intros = pendingIntros(cfg);
    if (intros.length > 0) {
      // Show each unseen mechanic intro in turn, then start the sigil
      runIntroQueue(intros, () => beginSigilPlay(worldId, lvlIdx, sigIdx, cfg));
      return;
    }
    beginSigilPlay(worldId, lvlIdx, sigIdx, cfg);
  };
  const beginSigilPlay = (worldId, lvlIdx, sigIdx, cfg) => {
    clearPlayState();
    G.mode = 'sigil';
    G.playWorldId = worldId;
    G.playLevelIdx = lvlIdx;
    G.playSigilIdx = sigIdx;
    G.levelIdx = sigIdx;
    G.runMistakes = 0;
    G.seededRng = null;
    applyPalette(paletteFor('REMEMBERED', 'homekeeper', worldId, `${lvlIdx}:${sigIdx}`));
    state = STATE.PLAYING;
    loadLevel(cfg);
    showScreens({ hud: true });
  };

  // Clear leftover play state so a new mode never inherits stale fields
  const clearPlayState = () => {
    G.playWorldId = null;
    G.playLevelIdx = null;
    G.playSigilIdx = null;
    G.lastGhost = null;
    G.ghost = null;
    G.traceSamples = [];
    G.tipText = '';
    G.holdNodeIdx = null;
    G.holdStartAt = 0;
    G.peekUntil = 0;
    G.peeksRemaining = 0;
  };

  const startDaily = () => {
    clearPlayState();
    G.mode = 'daily';
    G.levelIdx = 0;
    G.runMistakes = 0;
    const dateKey = todayKey();
    const seed = hashString('sigil-daily-' + dateKey);
    G.seededRng = mulberry32(seed);
    applyPalette(paletteFor('REMEMBERED', 'daily', dateKey));
    state = STATE.PLAYING;
    loadLevel(DAILY_CONFIG, G.seededRng);
    showScreens({ hud: true });
  };

  const startEndless = (startIdx = 0) => {
    clearPlayState();
    G.mode = 'endless';
    G.levelIdx = startIdx;
    G.sigilsThisRun = 0;
    G.runMistakes = 0;
    G.seededRng = null;
    applyPalette(paletteFor('REMEMBERED', 'endless', null, 'endless-' + startIdx));
    state = STATE.PLAYING;
    loadLevel(generateEndlessConfig(startIdx));
    showScreens({ hud: true });
  };

  const onStoryComplete = () => {
    // Mark the sigil completed in the (world, level, sigil) coordinate
    const w = G.playWorldId || 'prime';
    const l = G.playLevelIdx ?? 0;
    const s = G.playSigilIdx ?? G.levelIdx;
    markSigilCompleted(w, l, s);

    let firstTime = false;
    let isNarrative = (w === 'prime' && l === 0 && s < TOTAL_LINES);
    if (isNarrative && !store.recoveredLines.includes(s)) {
      store.recoveredLines.push(s);
      store.recoveredLines.sort((a, b) => a - b);
      firstTime = true;
      if (store.recoveredLines.length >= TOTAL_LINES && !store.complete) {
        store.complete = true;
      }
    }
    if (G.mistakes === 0) store.bestPerfect = Math.max(store.bestPerfect || 0, 1);
    saveStore();
    showStorySuccess(firstTime, isNarrative);
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
    if (G.mode === 'story' || G.mode === 'sigil') endStoryAttempt(true);
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
    if (G.noHintFlash > 0) G.noHintFlash = Math.max(0, G.noHintFlash - dt);
    G.flashAlpha *= Math.pow(0.001, dt);
    G.nudge *= Math.pow(0.0008, dt);
    if (G.nudge < 0.1) G.nudge = 0;
    // Capture finger trace samples while playing (used to draw ghost on retry)
    if (G.touching && G.config) {
      G.traceSamples.push({ x: G.fingerX, y: G.fingerY });
      if (G.traceSamples.length > 240) G.traceSamples.shift();
    }
    // Line-break check: drifting reds can sever already-completed segments
    if (G.config?.redDisconnects && G.progress >= 2 && G.successPhase === 0) {
      checkLineBreaks();
    }
    // HOLD mechanic — advance when the player has held a star long enough,
    // while also drag-tracking: if the finger leaves the held star's hit
    // radius, the hold is cancelled (handled in handleHit).
    if (G.holdNodeIdx !== null && G.holdNodeIdx !== undefined &&
        G.config && G.config.hold > 0 && G.successPhase === 0) {
      const n = G.nodes[G.holdNodeIdx];
      // Verify the finger is still within the node's hit radius
      if (n && dist(G.fingerX, G.fingerY, n.x, n.y) > NODE_HIT_RADIUS + 6) {
        G.holdNodeIdx = null;
      } else if (n) {
        const elapsed = (performance.now() - G.holdStartAt) / 1000;
        if (elapsed >= G.config.hold) {
          const idx = G.holdNodeIdx;
          G.holdNodeIdx = null;
          onCorrectHit(idx);
        }
      }
    }
    // WHISPER mechanic — peek timer decays
    if (G.peekUntil && performance.now() > G.peekUntil) G.peekUntil = 0;
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
    if (!G.path.length) return;
    const noHint = G.config && G.config.noHint;
    // In no-hint mode the dashed path is normally invisible — except during
    // the 1-second entry flash, where it's drawn briefly so the player gets
    // a fleeting sense of the shape.
    let alpha = G.hintAlpha;
    if (noHint) {
      // Flash starts at 1.0 and decays in 1s. Map to a 0..1 alpha curve.
      const f = G.noHintFlash;
      alpha = f > 0 ? Math.min(1, f * 1.2) : 0;
    }
    if (alpha < 0.001) return;
    const mirror = G.config && G.config.mirror;
    const mapPt = (n) => {
      if (mirror === 'h') return { x: W - n.x, y: n.y };
      if (mirror === 'v') return { x: n.x, y: H - n.y };
      return { x: n.x, y: n.y };
    };
    ctx.save();
    ctx.strokeStyle = accentRgba(0.20 * alpha);
    ctx.lineWidth = 1.2;
    ctx.setLineDash([6, 8]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < G.path.length; i++) {
      const p = mapPt(G.nodes[G.path[i]]);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    // Start star ring — kept even in no-hint mode (start star is always cyan).
    // In mirror mode the start ring is also at the mirrored position.
    const first = mapPt(G.nodes[G.path[0]]);
    ctx.strokeStyle = accentRgba(noHint ? 0.55 : 0.4 * alpha);
    ctx.beginPath(); ctx.arc(first.x, first.y, 22, 0, TAU); ctx.stroke();
    ctx.restore();
  };

  const drawGhost = () => {
    if (!G.ghost || G.ghost.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 245, 216, 0.18)';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 5]);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < G.ghost.length; i++) {
      const p = G.ghost[i];
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
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
      // Drift orbit indicator — shows where the red star will travel
      if (r.drift && G.hintAlpha > 0.05) {
        ctx.strokeStyle = `rgba(255, 90, 107, ${0.10 * G.hintAlpha})`;
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.arc(r.drift.cx, r.drift.cy, r.drift.radius, 0, TAU);
        ctx.stroke();
      }
      const halo = ctx.createRadialGradient(r.x, r.y, 0, r.x, r.y, RED_THRESHOLD + 6);
      halo.addColorStop(0, 'rgba(255, 90, 107, 0.35)');
      halo.addColorStop(1, 'rgba(255, 90, 107, 0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(r.x, r.y, RED_THRESHOLD + 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255, 90, 107, ${0.45 + Math.sin(r.pulse) * 0.15})`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.arc(r.x, r.y, RED_THRESHOLD, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = C.red;
      ctx.beginPath(); ctx.arc(r.x, r.y, 3, 0, TAU); ctx.fill();
    }
  };

  const drawNodes = () => {
    const now = performance.now();
    const nextRequired = G.progress < G.path.length ? G.path[G.progress] : -1;
    const knotVis = (G.config && G.config.knotVisibility) || 'badge';
    // WHISPER fade — when whisper is active and the player isn't peeking,
    // stars render at very low alpha. Completed stars are spared (you've
    // discovered them; they stay visible as a record).
    const whisper = G.config && G.config.whisper;
    const peeking = whisper && (G.peekUntil || 0) > now;
    const peekRemain = peeking ? (G.peekUntil - now) / 1100 : 0;
    const whisperAlpha = peeking ? Math.max(0.4, peekRemain) : 0.08;
    for (let i = 0; i < G.nodes.length; i++) {
      const n = G.nodes[i];
      const isNext = i === nextRequired;
      const isCompleted = n.requiredUses > 0 && n.useCount >= n.requiredUses;
      const isPartial = n.requiredUses > 0 && n.useCount > 0 && !isCompleted;
      const usesRemaining = Math.max(0, n.requiredUses - n.useCount);
      const sinceError = n.errorAt ? (now - n.errorAt) / 1000 : Infinity;
      // PULSE — size oscillation when the world has a pulse tempo
      const pulseAmp = (G.config && G.config.pulse)
        ? (Math.sin(G.elapsed * G.config.pulse + i * 0.6) * 4 + 4) : 0;
      const haloRadius = (isNext ? 30 + Math.sin(G.elapsed * 4) * 3 : 18) + pulseAmp * 0.6;
      const haloColor = isCompleted ? 'rgba(255, 216, 154, 0.45)' :
                        isPartial ? 'rgba(255, 216, 154, 0.30)' :
                        isNext ? accentRgba(0.5) :
                        sinceError < 0.6 ? `rgba(255, 90, 107, ${0.6 * (1 - sinceError / 0.6)})` :
                        'rgba(255, 245, 216, 0.18)';
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloRadius);
      grad.addColorStop(0, haloColor);
      grad.addColorStop(1, haloColor.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(n.x, n.y, haloRadius, 0, TAU); ctx.fill();

      const coreColor = isCompleted ? C.starGlow :
                        isPartial ? C.starGlow :
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

      // ×2 knot indicator: a "×N" badge or concentric rings, gated by knotVisibility
      if (n.requiredUses > 1 && usesRemaining > 0 && knotVis !== 'tip-only') {
        if (knotVis === 'badge') {
          // Small typographic badge above-right of the dot
          ctx.fillStyle = `rgba(255, 184, 107, 0.85)`;
          ctx.font = '600 9px -apple-system, system-ui, sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(`×${n.requiredUses}`, n.x + 8, n.y - 10);
        } else if (knotVis === 'rings') {
          // One thin ring per use remaining
          for (let r = 0; r < usesRemaining; r++) {
            ctx.strokeStyle = `rgba(255, 184, 107, ${0.45 - r * 0.10})`;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.arc(n.x, n.y, 9 + r * 4, 0, TAU);
            ctx.stroke();
          }
        }
      }

      // Subtle drift orbit indicator for moving stars (only undone, only when hint visible)
      if (n.drift && !isCompleted && G.hintAlpha > 0.2) {
        ctx.strokeStyle = `rgba(160, 200, 255, ${0.10 * G.hintAlpha})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(n.drift.cx, n.drift.cy, n.drift.radius, 0, TAU);
        ctx.stroke();
      }

      // HOLD indicator — ring fills as you hold this star
      if (G.holdNodeIdx === i && G.config && G.config.hold > 0) {
        const elapsed = (performance.now() - G.holdStartAt) / 1000;
        const frac = clamp(elapsed / G.config.hold, 0, 1);
        ctx.strokeStyle = `rgba(${C.accentRgb}, 0.95)`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, 14, -Math.PI / 2, -Math.PI / 2 + TAU * frac);
        ctx.stroke();
      }
    }

  };

  const drawWhisperVeil = () => {
    if (!G.config || !G.config.whisper) return;
    const now = performance.now();
    const peeking = (G.peekUntil || 0) > now;
    if (peeking) return; // see clearly during the peek
    ctx.fillStyle = 'rgba(6, 5, 13, 0.92)';
    ctx.fillRect(0, 0, W, H);
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
      drawGhost();
      drawHintPath();
      drawRedStars();
      drawCompletedPath();
      drawNodes();
      drawParticles();
      drawWhisperVeil();
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
    const node = G.nodes[hit];
    const isNext = G.progress < G.path.length && hit === G.path[G.progress];

    if (isNext) {
      // Correct next star (works for first hit AND for revisits on ×2 knots).
      // Fresh touchdown allowed at progress 0 OR after a broken stroke.
      if (isInitial) {
        if (G.progress > 0 && G.touching) return;
        G.touching = true;
      }
      // HOLD mechanic: don't advance immediately. Start a hold timer; the
      // main loop calls onCorrectHit() when the duration elapses.
      const holdDur = (G.config && G.config.hold) || 0;
      if (holdDur > 0) {
        if (G.holdNodeIdx !== hit) {
          G.holdNodeIdx = hit;
          G.holdStartAt = performance.now();
        }
        return;
      }
      onCorrectHit(hit);
      return;
    }
    // If we were holding a star and the finger has moved off, clear the hold
    if (G.holdNodeIdx !== null && G.holdNodeIdx !== undefined && G.holdNodeIdx !== hit) {
      G.holdNodeIdx = null;
    }

    // Not the next required:
    if (node.decoy) { onWrongHit(); return; }
    // Already fully used? Treat as drag-through (silent ignore)
    if (node.requiredUses > 0 && node.useCount >= node.requiredUses) return;
    // Otherwise this is a required star but the wrong one
    onWrongHit();
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
    // WHISPER — tap on empty space triggers a peek (limited count)
    const hit = tryHitAt(G.fingerX, G.fingerY);
    if (hit === -1 && G.config && G.config.whisper && (G.peeksRemaining || 0) > 0) {
      G.peeksRemaining -= 1;
      G.peekUntil = performance.now() + 1100;
      Audio.tick(880, 0.05);
      vibrate(4);
      return;
    }
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
    mech_intro: document.getElementById('screen-mech-intro'),
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
    if (G.mode === 'sigil') {
      const l = String((G.playLevelIdx ?? 0) + 1).padStart(2, '0');
      const s = String((G.playSigilIdx ?? 0) + 1).padStart(2, '0');
      const name = getLevelName(G.playWorldId || 'prime', G.playLevelIdx ?? 0);
      el.textContent = `L${l} · ${name} · S${s}`;
    } else if (G.mode === 'story') {
      el.textContent = `SIGIL ${String(G.levelIdx + 1).padStart(2, '0')} / ${String(STORY_LEVELS.length).padStart(2, '0')}`;
    } else if (G.mode === 'daily') {
      el.textContent = `DAILY · ${todayKey()}`;
    } else {
      el.textContent = `ENDLESS · ${String(G.sigilsThisRun).padStart(2, '0')}`;
    }
    // Show the tip strip
    const tip = document.getElementById('sigil-tip');
    if (tip && G.tipText && G.mode === 'sigil') {
      tip.textContent = G.tipText;
      tip.hidden = false;
      tip.classList.remove('show');
      // force reflow to restart animation
      void tip.offsetWidth;
      tip.classList.add('show');
      setTimeout(() => {
        if (tip.classList.contains('show')) {
          tip.hidden = true;
          tip.classList.remove('show');
        }
      }, 3300);
    } else if (tip) {
      tip.hidden = true;
      tip.classList.remove('show');
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

    // Title screen actions:
    //   - BEGIN/CONTINUE button points to the next undone sigil (walks
    //     HOMEKEEPER's world/level/sigil chain). Stays visible even after
    //     the story is whole so the player can keep advancing in PRIME
    //     levels 02-20 or moving on to DRIFT/CROSS/... when unlocked.
    //   - Mode tiles (DAILY · ENDLESS · RETRACE) show only once the story
    //     is whole.
    const modes = document.getElementById('modes');
    const beginBtn = document.getElementById('btn-begin');
    const next = findNextUndoneSigil();
    modes.hidden = !store.complete;
    if (next) {
      beginBtn.hidden = false;
      const totalDone = (store.doneSigils || []).length;
      if (!store.seenTutorial && totalDone === 0) {
        beginBtn.textContent = 'BEGIN';
      } else {
        const w = next.worldId.toUpperCase();
        const l = String(next.levelIdx + 1).padStart(2, '0');
        const s = String(next.sigilIdx + 1).padStart(2, '0');
        beginBtn.textContent = `CONTINUE · ${w} · L${l} · S${s}`;
      }
    } else {
      // No undone sigils — everything in HOMEKEEPER is whole
      beginBtn.hidden = true;
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

  const showStorySuccess = (firstTime, isNarrative) => {
    const w = G.playWorldId || 'prime';
    const l = G.playLevelIdx ?? 0;
    const s = G.playSigilIdx ?? G.levelIdx;
    const levelNum = String(l + 1).padStart(2, '0');
    const sigilNum = String(s + 1).padStart(2, '0');
    const numEl = document.getElementById('success-num');
    const lineEl = document.getElementById('success-line');
    if (isNarrative && s < TOTAL_LINES) {
      numEl.textContent = `FRAGMENT ${String(s + 1).padStart(2, '0')} / ${String(TOTAL_LINES).padStart(2, '0')}`;
      lineEl.textContent = MESSAGE_LINES[s];
      lineEl.classList.remove('procedural');
    } else {
      const levelName = getLevelName(w, l);
      numEl.textContent = `${w.toUpperCase()} · ${levelName} · SIGIL ${sigilNum}`;
      lineEl.textContent = isLevelCompleted(w, l)
        ? 'level whole. step inward.'
        : 'sigil decoded. tap next.';
      lineEl.classList.add('procedural');
    }
    document.getElementById('success-stats').textContent =
      G.mistakes === 0 ? 'TRACED CLEAN' : `${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}`;
    const nextBtn = document.getElementById('btn-success-next');
    // Determine what NEXT means: next sigil → next level → return to map
    const nextSigil = s + 1;
    if (nextSigil < SIGILS_PER_LEVEL) {
      nextBtn.textContent = `SIGIL ${String(nextSigil + 1).padStart(2, '0')}`;
      nextBtn._next = () => startSigil(w, l, nextSigil);
    } else if (l + 1 < LEVELS_PER_WORLD && isLevelUnlocked(w, l + 1)) {
      nextBtn.textContent = `LEVEL ${String(l + 2).padStart(2, '0')}`;
      nextBtn._next = () => startSigil(w, l + 1, 0);
    } else {
      nextBtn.textContent = 'WORLD MAP';
      nextBtn._next = () => {
        state = STATE.TITLE;
        refreshTitleStats();
        showScreens({ title: true });
      };
    }
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
  // Orbit tiers — multiple rings; closer = faster (vague Kepler).
  // r is fraction of map half-extent from centre; speed is rad/sec.
  // Spacing of 0.12 between rings so labels never collide vertically.
  const TIERS = {
    nucleus: { r: 0.10, speed: 0.18 },
    inner:   { r: 0.22, speed: 0.11 },
    mid:     { r: 0.34, speed: 0.07 },
    outer:   { r: 0.46, speed: 0.045 },
  };

  // Each solar/world has orbit: { r, baseAngle, speed }.
  // Stories are organised: world → sigils → levels (indices into STORY_LEVELS).
  const GALAXY = {
    id: 'remembered',
    name: 'REMEMBERED',
    systems: [
      // ── inner orbit
      {
        id: 'homekeeper', name: 'HOMEKEEPER', kicker: 'home system',
        orbit: { r: TIERS.outer.r, baseAngle: Math.PI * 0.5, speed: TIERS.outer.speed },
        unlocked: true,
        sun: {
          id: 'homekeeper-sun', name: 'HEART OF HOMEKEEPER',
          kicker: 'the home star',
          locked_note: 'sealed · lights up when every world is whole.',
          ready_note: 'the heart is open. (final challenge — next update)',
        },
        // 10 worlds, progressively harder. Each introduces a mechanic.
        // requires: id of the previous world that must be whole to unlock.
        worlds: [
          {
            id: 'prime', name: 'PRIME', kicker: 'the message',
            mechanic: 'basic tracing',
            orbit: { r: 0.46, baseAngle: -Math.PI / 2, speed: 0.045 },
            unlocked: true,
            sigils: [
              { id: 'reaching',   name: 'REACHING',   levels: [0, 1] },
              { id: 'holding',    name: 'HOLDING',    levels: [2, 3] },
              { id: 'waiting',    name: 'WAITING',    levels: [4, 5] },
              { id: 'remembered', name: 'REMEMBERED', levels: [6, 7] },
              { id: 'found',      name: 'FOUND',      levels: [8, 9] },
            ],
          },
          {
            id: 'drift', name: 'DRIFT', kicker: 'moving stars',
            mechanic: 'stars orbit — lead your trace',
            orbit: { r: 0.40, baseAngle: Math.PI * 0.85, speed: 0.062 },
            requires: 'prime', unlocked: false, sigils: [],
          },
          {
            id: 'cross', name: 'CROSS', kicker: 'avoid the red',
            mechanic: 'red stars — do not cross',
            orbit: { r: 0.40, baseAngle: Math.PI * 0.15, speed: 0.060 },
            requires: 'drift', unlocked: false, sigils: [],
          },
          {
            id: 'echo', name: 'ECHO', kicker: 'fading hints',
            mechanic: 'hints fade fast — remember the shape',
            orbit: { r: 0.34, baseAngle: Math.PI * 1.10, speed: 0.082 },
            requires: 'cross', unlocked: false, sigils: [],
          },
          {
            id: 'mirror', name: 'MIRROR', kicker: 'reflected',
            mechanic: 'trace the mirrored shape',
            orbit: { r: 0.34, baseAngle: Math.PI * 1.90, speed: 0.078 },
            requires: 'echo', unlocked: false, sigils: [],
          },
          {
            id: 'hold', name: 'HOLD', kicker: 'press to anchor',
            mechanic: 'hold each star to lock it',
            orbit: { r: 0.28, baseAngle: Math.PI * 0.45, speed: 0.110 },
            requires: 'mirror', unlocked: false, sigils: [],
          },
          {
            id: 'pulse', name: 'PULSE', kicker: 'on the beat',
            mechanic: 'stars pulse — strike on rhythm',
            orbit: { r: 0.28, baseAngle: Math.PI * 1.55, speed: 0.105 },
            requires: 'hold', unlocked: false, sigils: [],
          },
          {
            id: 'whisper', name: 'WHISPER', kicker: 'unseen',
            mechanic: 'stars hidden — tap to peek briefly',
            orbit: { r: 0.22, baseAngle: Math.PI * 0.20, speed: 0.150 },
            requires: 'pulse', unlocked: false, sigils: [],
          },
          {
            id: 'fork', name: 'FORK', kicker: 'choose the path',
            mechanic: 'branching paths — pick the right one',
            orbit: { r: 0.22, baseAngle: Math.PI * 1.80, speed: 0.140 },
            requires: 'whisper', unlocked: false, sigils: [],
          },
          {
            id: 'entropy', name: 'ENTROPY', kicker: 'everything at once',
            mechanic: 'every mechanic combined — closest to the heart',
            orbit: { r: 0.15, baseAngle: Math.PI * 1.00, speed: 0.230 },
            requires: 'fork', unlocked: false, sigils: [],
          },
        ],
      },

      // ── mid ring (4 solars on diagonals — clear of HOMEKEEPER's vertical line)
      // DEEP CARRIER is the second playable solar. Same shape as HOMEKEEPER
      // (10 worlds, central Sun) but every world inherits a harder baseline.
      { id: 'deepcarrier', name: 'DEEP CARRIER', kicker: 'below the band',
        orbit: { r: TIERS.mid.r, baseAngle: Math.PI * 0.25, speed: TIERS.mid.speed },
        requires: 'homekeeper', unlocked: false,
        note: 'a sub-frequency. unlocks when HOMEKEEPER is whole.',
        sun: {
          id: 'deepcarrier-sun', name: 'HEART OF DEEP CARRIER',
          kicker: 'the sub-bass star',
          locked_note: 'sealed · lights up when every DEEP CARRIER world is whole.',
          ready_note: 'the carrier is open. (final challenge — next update)',
        },
        worlds: [
          { id: 'subsonic',  name: 'SUBSONIC', kicker: 'low band',
            mechanic: 'basic tracing — below the noise',
            orbit: { r: 0.46, baseAngle: -Math.PI / 2, speed: 0.045 },
            unlocked: true, sigils: [] },
          { id: 'static',    name: 'STATIC',   kicker: 'drifting noise',
            mechanic: 'stars drift on the carrier',
            orbit: { r: 0.40, baseAngle: Math.PI * 0.85, speed: 0.062 },
            requires: 'subsonic', unlocked: false, sigils: [] },
          { id: 'hum',       name: 'HUM',      kicker: 'red interference',
            mechanic: 'red bands — do not cross',
            orbit: { r: 0.40, baseAngle: Math.PI * 0.15, speed: 0.060 },
            requires: 'static', unlocked: false, sigils: [] },
          { id: 'decay',     name: 'DECAY',    kicker: 'short half-life',
            mechanic: 'hints decay almost instantly',
            orbit: { r: 0.34, baseAngle: Math.PI * 1.10, speed: 0.082 },
            requires: 'hum', unlocked: false, sigils: [] },
          { id: 'reverb',    name: 'REVERB',   kicker: 'reflected',
            mechanic: 'mirror — the hint is on the wrong side',
            orbit: { r: 0.34, baseAngle: Math.PI * 1.90, speed: 0.078 },
            requires: 'decay', unlocked: false, sigils: [] },
          { id: 'sustain',   name: 'SUSTAIN',  kicker: 'long anchor',
            mechanic: 'hold each star to lock',
            orbit: { r: 0.28, baseAngle: Math.PI * 0.45, speed: 0.110 },
            requires: 'reverb', unlocked: false, sigils: [] },
          { id: 'beat',      name: 'BEAT',     kicker: 'on the kick',
            mechanic: 'pulse — stars beat with the carrier',
            orbit: { r: 0.28, baseAngle: Math.PI * 1.55, speed: 0.105 },
            requires: 'sustain', unlocked: false, sigils: [] },
          { id: 'hiss',      name: 'HISS',     kicker: 'just under threshold',
            mechanic: 'whisper — stars hidden, tap to peek',
            orbit: { r: 0.22, baseAngle: Math.PI * 0.20, speed: 0.150 },
            requires: 'beat', unlocked: false, sigils: [] },
          { id: 'dropout',   name: 'DROPOUT',  kicker: 'cutting in and out',
            mechanic: 'segments randomly truncate · coming in a future update',
            orbit: { r: 0.22, baseAngle: Math.PI * 1.80, speed: 0.140 },
            requires: 'hiss', unlocked: false, sigils: [] },
          { id: 'carrier',   name: 'CARRIER WAVE', kicker: 'all at once',
            mechanic: 'every DEEP CARRIER mechanic combined',
            orbit: { r: 0.15, baseAngle: Math.PI * 1.00, speed: 0.230 },
            requires: 'dropout', unlocked: false, sigils: [] },
        ] },
      { id: 'nineteen',    name: '1981',         kicker: 'the year they left',
        orbit: { r: TIERS.mid.r, baseAngle: Math.PI * 0.75, speed: TIERS.mid.speed * 1.05 },
        requires: 'deepcarrier', unlocked: false, worlds: [],
        note: 'the operator who closed the room.' },
      { id: 'farecho',     name: 'FAR ECHO',     kicker: 'past signal',
        orbit: { r: TIERS.mid.r, baseAngle: Math.PI * 1.25, speed: TIERS.mid.speed * 0.95 },
        requires: 'nineteen', unlocked: false, worlds: [],
        note: 'reachable when 1981 is whole.' },
      { id: 'outer',       name: 'OUTER',        kicker: 'edge of carrier',
        orbit: { r: TIERS.mid.r, baseAngle: Math.PI * 1.75, speed: TIERS.mid.speed * 1.08 },
        requires: 'farecho', unlocked: false, worlds: [],
        note: 'a faint signal.' },

      // ── inner ring (4 solars at cardinals — offset 45° from mid)
      { id: 'mnemosyne',   name: 'MNEMOSYNE',    kicker: 'memory orbit',
        orbit: { r: TIERS.inner.r, baseAngle: Math.PI * 0.0, speed: TIERS.inner.speed * 1.05 },
        requires: 'outer', unlocked: false, worlds: [],
        note: 'before the keys were ever pressed.' },
      { id: 'lunaria',     name: 'LUNARIA',      kicker: 'a named moon',
        orbit: { r: TIERS.inner.r, baseAngle: Math.PI * 0.5, speed: TIERS.inner.speed * 1.08 },
        requires: 'mnemosyne', unlocked: false, worlds: [],
        note: 'the moon you orbit.' },
      { id: 'thequiet',    name: 'THE QUIET',    kicker: 'between keys',
        orbit: { r: TIERS.inner.r, baseAngle: Math.PI * 1.0, speed: TIERS.inner.speed * 0.97 },
        requires: 'lunaria', unlocked: false, worlds: [],
        note: 'the long pause.' },
      { id: 'coldroom',    name: 'COLD ROOM',    kicker: 'the waiting',
        orbit: { r: TIERS.inner.r, baseAngle: Math.PI * 1.5, speed: TIERS.inner.speed * 0.92 },
        requires: 'thequiet', unlocked: false, worlds: [],
        note: 'they left the radio on.' },

      // ── nucleus (3 solars evenly spaced at thirds — closest to the core)
      { id: 'hibernal', name: 'HIBERNAL', kicker: 'sleep cycle',
        orbit: { r: TIERS.nucleus.r, baseAngle: Math.PI * 0.33, speed: TIERS.nucleus.speed * 0.95 },
        requires: 'coldroom', unlocked: false, worlds: [],
        note: 'winters between transmissions.' },
      { id: 'null',     name: 'NULL',     kicker: 'no carrier',
        orbit: { r: TIERS.nucleus.r, baseAngle: Math.PI * 1.0, speed: TIERS.nucleus.speed * 1.10 },
        requires: 'hibernal', unlocked: false, worlds: [],
        note: 'the silence between transmissions.' },
      { id: 'origin',   name: 'ORIGIN',   kicker: 'unknown',
        orbit: { r: TIERS.nucleus.r, baseAngle: Math.PI * 1.67, speed: TIERS.nucleus.speed * 1.05 },
        requires: 'null', unlocked: false, worlds: [],
        note: 'the heart of the galaxy. silent. for now.' },
    ],
    // The galactic core — pure centre, the last thing to reach.
    core: {
      id: 'galactic-core', name: 'CORE',
      locked_note: 'sealed. all of REMEMBERED must be whole.',
      ready_note: 'the core is open. (terminal challenge — future update)',
    },
  };

  // -------------------------------------------------------------------------
  // World content shape
  //   World  →  20 levels  →  10 sigils each  (sigil = one tracing puzzle)
  //   PRIME · LEVEL 01 is the narrative chapter (uses the ten message lines)
  //   PRIME · LEVEL 02..20 are procedural — playable, rising difficulty
  //   Other worlds are stubbed for now (DRIFT/CROSS/ECHO/...); when their
  //   mechanics ship, their procedural sigils inherit world-specific traits.
  // -------------------------------------------------------------------------
  const LEVELS_PER_WORLD = 20;
  const SIGILS_PER_LEVEL = 10;

  // World-specific mechanic flags applied to procedural sigil configs.
  const WORLD_MECHANIC = {
    // HOMEKEEPER
    prime:    {},
    drift:    { drift: true },
    cross:    { red: true },
    echo:     { hintFadeMul: 0.3 },
    mirror:   { mirror: 'h' },                    // hint reflected horizontally
    hold:     { hold: 0.5 },                      // 0.5s anchor per star
    pulse:    { pulse: 1.4 },                     // 1.4 rad/s beat
    whisper:  { whisper: true, peeks: 3 },        // stars hidden; 3 peeks
    fork:     {},                                  // engine TBD
    entropy:  { drift: true, red: true, mirror: 'h', hold: 0.35, hintFadeMul: 0.5 },
    // DEEP CARRIER (next solar) — same mechanics, harder baseline
    subsonic: {},
    static:   { drift: true },
    hum:      { red: true },
    decay:    { hintFadeMul: 0.25 },
    reverb:   { mirror: 'h' },
    sustain:  { hold: 0.6 },
    beat:     { pulse: 1.7 },
    hiss:     { whisper: true, peeks: 2 },
    dropout:  {},
    carrier:  { drift: true, red: true, mirror: 'h', hold: 0.4, hintFadeMul: 0.4 },
  };

  // Procedural sigil config for a (world, level, sigil) coordinate.
  // Narrative override: PRIME · LEVEL 01 · sigils 0..9 = STORY_LEVELS.
  // Difficulty curve (see ROADMAP.md §4) staggers mechanic introduction:
  //   0–49   : stars + decoys
  //   50–69  : time pressure
  //   70–89  : hint fade
  //   90–129 : ×2 knot — first introduced with visible "×2" badge
  //   130–149: ×2 knot — rings replace badge (more abstract cue)
  //   150–169: ×2 knot — only the tip strip mentions it; no per-star marker
  //   170+   : no hint at all (with a 1s flash on entry)
  const getSigilCfg = (worldId, levelIdx, sigilIdx) => {
    if (worldId === 'prime' && levelIdx === 0 && sigilIdx < STORY_LEVELS.length) {
      // Story configs don't define duplicates/noHint — explicit defaults
      return { ...STORY_LEVELS[sigilIdx], duplicates: 0, noHint: false, knotVisibility: 'badge' };
    }
    const m = WORLD_MECHANIC[worldId] || {};
    const diff = levelIdx * SIGILS_PER_LEVEL + sigilIdx;
    const cfg = {
      count: Math.min(9, 3 + Math.floor(diff / 14)),
      decoys: Math.min(5, Math.floor(diff / 18)),
      hintFade: 0,
      time: 0,
      drift: !!m.drift,
      redCount: 0,
      duplicates: 0,
      noHint: false,
      knotVisibility: 'badge', // 'badge' | 'rings' | 'tip-only'
    };
    if (diff >= 50)  cfg.time = Math.max(18, 55 - (diff - 50) * 0.5);
    if (diff >= 70)  cfg.hintFade = Math.max(2, 6 - (diff - 70) * 0.04);
    if (diff >= 90)  cfg.duplicates = 1;
    if (diff >= 130) cfg.duplicates = 2;
    if (diff >= 130) cfg.knotVisibility = 'rings';
    if (diff >= 150) cfg.knotVisibility = 'tip-only';
    if (diff >= 170) cfg.noHint = true;
    if (m.red) cfg.redCount = Math.min(3, 1 + Math.floor(diff / 40));
    if (m.redDrift) cfg.redDrift = true;
    // Red threat intensity rises smoothly with difficulty (0..1).
    // Scales orbit speed and sweep radius so drifting reds feel
    // progressively more dangerous instead of being a slow nuisance.
    if (m.red) cfg.redIntensity = clamp((diff - 30) / 140, 0, 1);
    // High-difficulty escalation: drifting reds can sever a completed
    // segment if they orbit through it.
    if (m.red && diff >= 150) cfg.redDisconnects = true;
    // At the deepest difficulty, some reds switch to linear sweep —
    // they cross the screen edge-to-edge instead of looping. Much
    // less predictable.
    if (m.red && diff >= 180) cfg.redLinearChance = 0.5;
    if (m.hintFadeMul && cfg.hintFade > 0) cfg.hintFade *= m.hintFadeMul;
    // World-signature mechanics — inherited from WORLD_MECHANIC
    if (m.mirror) cfg.mirror = m.mirror;
    if (m.hold) cfg.hold = m.hold;
    if (m.pulse) cfg.pulse = m.pulse;
    if (m.whisper) {
      cfg.whisper = true;
      cfg.peeks = m.peeks || 3;
    }
    return cfg;
  };

  // -------------------------------------------------------------------------
  // Procedural level naming. "LEVEL 02 — THE PATIENT" etc.
  // Deterministic (hash of worldId + levelIdx), so the same level always
  // resolves to the same name. PRIME LEVEL 01 is hand-named "THE MESSAGE".
  // -------------------------------------------------------------------------
  const LEVEL_NAME_WORDS = [
    // Original 72 (kept for continuity; hashed index will still shuffle)
    'PATIENT', 'QUIET', 'BRIGHT', 'FALLEN', 'FORGOTTEN', 'BURIED', 'STILL',
    'EMPTY', 'HUMMING', 'WIDE', 'LATE', 'FROZEN', 'WARM', 'SHALLOW', 'DEEP',
    'FAINT', 'GRAVE', 'SACRED', 'BARELY', 'ENDLESS', 'WAITING', 'WAKING',
    'BREATHING', 'GIVEN', 'TAKEN', 'HOLLOW', 'WHOLE', 'BROKEN', 'WORN',
    'CLEAN', 'OLD', 'NEW', 'FAR', 'NEAR', 'LOST', 'KEPT', 'OPENED', 'CLOSED',
    'KNOWN', 'UNKNOWN', 'NAMED', 'NAMELESS', 'ANCHORED', 'DRIFTING', 'TIDAL',
    'LUNAR', 'SOLAR', 'GLOWING', 'FADED', 'TUNED', 'BROADCAST', 'WHISPERED',
    'TURNING', 'COMING', 'GOING', 'HELD', 'UNTOLD', 'BORROWED', 'RETURNED',
    'SLOW', 'SUDDEN', 'HONEST', 'CARELESS', 'CAREFUL', 'SILENT', 'SPOKEN',
    'OFFERED', 'SHADED', 'CRACKED', 'HEARD', 'UNSEEN', 'WITNESSED',
    // Verbal-adjectives (action-state)
    'TRAILING', 'FRAYING', 'ANSWERING', 'LISTENING', 'RETURNING',
    'RECEDING', 'LINGERING', 'FALTERING', 'UNFOLDING',
    // un-negations
    'WAITED', 'UNKEPT', 'UNSAID', 'UNSENT', 'UNREAD', 'UNHEARD',
    'UNNAMED', 'UNMADE', 'UNOPENED', 'UNANSWERED',
    // re-prefix (repetition / return)
    'REPEATED', 'RECOVERED', 'RECALLED', 'RECEIVED', 'REMAINING',
    'REJOINED', 'REMNANT', 'RESIDUAL',
    // relative position
    'DISTANT', 'ADJACENT', 'INWARD', 'OUTWARD', 'LOWER', 'UPPER', 'HITHER',
    'ELSEWHERE', 'NEARER', 'FURTHER', 'FINAL',
    // time (old / young / first / last)
    'EARLY', 'ELDER', 'OLDER', 'YOUNGER', 'ANTIQUE', 'ANCIENT', 'VESTIGIAL',
    'PRIMAL', 'FIRST', 'LAST', 'LATTER', 'FORMER', 'BEFORE', 'AFTER',
    'BELOW', 'ABOVE', 'BENEATH', 'WITHIN', 'WITHOUT', 'BETWEEN', 'AGAIN',
    // emotional / human
    'ALMOST', 'ENOUGH', 'UNSURE', 'TENDER', 'TRUSTING', 'FAITHFUL', 'AFRAID',
    'GENTLE', 'SOLEMN', 'SORRY', 'GRATEFUL', 'LONELY', 'LOVING',
    'FAMILIAR', 'STRANGE', 'KIN', 'ORPHANED', 'ABSENT', 'PRESENT',
    // rooms & doors
    'OPEN', 'LOCKED', 'AJAR', 'VACANT', 'OCCUPIED',
    // motion / placement
    'LEFT', 'PLACED', 'FOUND', 'STORED', 'SHELVED', 'FOLDED', 'UNFOLDED',
    'SEALED', 'UNSEALED',
    // material condition
    'TARNISHED', 'ACCRETED', 'WEATHERED', 'DUSTED', 'FINGERED',
    'CREASED', 'DOGEARED', 'THREADED', 'KNOTTED', 'WOVEN', 'PATCHED',
    'MENDED', 'SCARRED', 'SMOOTHED', 'THINNED', 'PALED', 'BLEACHED',
    'STAINED', 'GRAINY',
    // water / sea / colour
    'BRINY', 'GLAUCOUS', 'MILKY', 'ASHEN', 'PEARLED', 'WAXEN',
    'CHALKY', 'SILVERED', 'RUSTED', 'COPPERED', 'AMBERED', 'BLUEING',
    // light
    'DIMMED', 'LIT', 'HALF-LIT', 'BACKLIT', 'LAMPLIT', 'MOONLIT',
    'STARLESS', 'STARRY',
    // astronomical
    'ORBITAL', 'SIDEREAL', 'ECLIPSED', 'TIDED', 'PHASED',
    'WANING', 'WAXING', 'CRESCENT', 'GIBBOUS', 'UMBRAL', 'PENUMBRAL',
    'OCCULTED', 'ALIGNED', 'MISALIGNED', 'ASCENDING', 'DESCENDING',
    'FALLING', 'RISEN', 'RISING', 'SUNLESS',
    // winter / sleep
    'WINTERING', 'SLEEPING', 'WAKENING', 'DROWSING', 'DORMANT', 'ROOTED',
    'SEEDING', 'THAWING', 'FROSTED', 'HOAR', 'SNOWBOUND',
    'HIBERNAL', 'NORTHWARD', 'LOWERING',
    // silence / rest
    'MUTED', 'MUFFLED', 'HUSHED', 'PAUSED', 'RESTING', 'SUSTAINED',
    'MEASURED', 'COUNTED', 'COUNTLESS', 'BREATHED', 'BREATHLESS',
    // sound / vibration
    'HUMMED', 'UNTUNED', 'ATTUNED', 'WAVERING', 'TREMBLING',
    'FLICKERING', 'PULSING', 'BEATING', 'RINGING', 'CHIMING', 'TONAL',
    'TONED', 'SUBTLE', 'FAINTED', 'FILTERED', 'BANDLIMITED', 'NARROW',
    'WIDESET', 'DISTORTED', 'DOPPLERED', 'ECHOING', 'REVERBED',
    'DELAYED', 'RELAYED', 'LOOPED', 'DROPPED', 'SKIPPED', 'MISSED',
    // optics & reflection
    'CROSSED', 'MIRRORED', 'INVERTED', 'REVERSED', 'SHIFTED', 'OFFSET',
    'PHANTOM', 'GHOSTED', 'APPARENT', 'LATENT', 'HIDDEN', 'COVERED',
    'VEILED', 'SHADOWED', 'CLOUDED', 'FOGGED', 'MISTED',
    'OVERCAST', 'CLEARING',
    // geometry
    'SHALLOWING', 'DEEPENING', 'HOLLOWED', 'ROUNDED', 'WIDENING',
    'NARROWING', 'BOUND', 'UNBOUND', 'TETHERED', 'UNTETHERED',
    'ADRIFT', 'AFLOAT', 'STRANDED', 'MOORING', 'HARBOURED',
    'CARRIED', 'BEARING', 'LADEN', 'LIGHTENED', 'WEIGHTED',
    // writing / archive
    'GRAVEN', 'ETCHED', 'IMPRINTED', 'PRESSED', 'INSCRIBED', 'ERODED',
    'WASHED', 'SORTED', 'STACKED', 'ARCHIVED', 'INDEXED', 'MISFILED',
    'CATALOGUED', 'NUMBERED', 'DATED', 'POSTMARKED',
    'FORWARDED', 'KEPTSAFE', 'UNDELIVERED',
  ];
  const getLevelName = (worldId, levelIdx) => {
    if (worldId === 'prime' && levelIdx === 0) return 'THE MESSAGE';
    const seed = hashU32(`${worldId}-level-${levelIdx}`);
    return 'THE ' + LEVEL_NAME_WORDS[seed % LEVEL_NAME_WORDS.length];
  };

  // Map of mechanic flag → first-time intro shown to the player.
  // The first sigil a player encounters that has this flag pops up the
  // overlay; subsequent encounters skip it (persisted in store.introsSeen).
  const MECHANIC_INTROS = {
    decoys: {
      key: 'decoys',
      title: 'DECOYS',
      body: 'extra stars appear that aren\'t on the path. touching one resets your stroke.',
      test: (cfg) => (cfg.decoys || 0) > 0,
    },
    time: {
      key: 'time',
      title: 'TIME',
      body: 'the sigil decays. complete it before the timer runs out.',
      test: (cfg) => (cfg.time || 0) > 0,
    },
    hintFade: {
      key: 'hintFade',
      title: 'FADING HINTS',
      body: 'the dashed path fades a few seconds in. remember the shape before it\'s gone.',
      test: (cfg) => (cfg.hintFade || 0) > 0 && !cfg.noHint,
    },
    drift: {
      key: 'drift',
      title: 'DRIFT',
      body: 'the stars are moving. wait for them. lead your trace.',
      test: (cfg) => !!cfg.drift,
    },
    red: {
      key: 'red',
      title: 'RED STARS',
      body: 'red stars are hostile. your trace line cannot pass within their range.',
      test: (cfg) => (cfg.redCount || 0) > 0,
    },
    duplicates: {
      key: 'duplicates',
      title: '×2 KNOT',
      body: 'some stars must be touched twice. they pulse with a small ×2 badge when they need another visit.',
      test: (cfg) => (cfg.duplicates || 0) > 0,
    },
    noHint: {
      key: 'noHint',
      title: 'NO HINT',
      body: 'no path is shown. you must deduce the order from the stars themselves. trust the shape.',
      test: (cfg) => !!cfg.noHint,
    },
    mirror: {
      key: 'mirror',
      title: 'MIRROR',
      body: 'the hint is reflected. the visible path is on the wrong side — the real stars wait opposite. flip the shape in your head.',
      test: (cfg) => !!cfg.mirror,
    },
    hold: {
      key: 'hold',
      title: 'HOLD',
      body: 'press and hold each star to lock it. a ring fills as you wait; release too soon and the star releases too.',
      test: (cfg) => (cfg.hold || 0) > 0,
    },
    pulse: {
      key: 'pulse',
      title: 'PULSE',
      body: 'stars beat on a steady tempo. touch only when a star is at its brightest. off-beat hits are rejected.',
      test: (cfg) => (cfg.pulse || 0) > 0,
    },
    whisper: {
      key: 'whisper',
      title: 'WHISPER',
      body: 'the stars are hidden. tap empty space to peek — they appear for a moment. you have a limited number of peeks.',
      test: (cfg) => !!cfg.whisper,
    },
  };

  // Build the per-sigil tip strip text from the config
  const buildTip = (cfg) => {
    const parts = [];
    parts.push(`${cfg.count} stars`);
    if (cfg.decoys > 0) parts.push(`${cfg.decoys} decoy${cfg.decoys === 1 ? '' : 's'}`);
    if (cfg.duplicates > 0) parts.push(`${cfg.duplicates === 1 ? '×2 knot' : `${cfg.duplicates} ×2 knots`}`);
    if (cfg.drift) parts.push('drift');
    if (cfg.mirror) parts.push('mirror');
    if (cfg.hold) parts.push(`hold ${cfg.hold.toFixed(1)}s`);
    if (cfg.pulse) parts.push('pulse');
    if (cfg.whisper) parts.push(`whisper · ${cfg.peeks || 3} peeks`);
    if (cfg.redCount > 0) {
      parts.push(cfg.redDisconnects
        ? `${cfg.redCount} red · breaks lines`
        : `${cfg.redCount} red`);
    }
    if (cfg.noHint) parts.push('no hint · 1s flash');
    else if (cfg.hintFade > 0) parts.push('hint fades');
    if (cfg.time > 0) parts.push(`${Math.round(cfg.time)}s`);
    return parts.join(' · ');
  };

  // Generate the 10 sigil configs for a level
  const getLevelSigils = (worldId, levelIdx) => {
    const out = [];
    for (let i = 0; i < SIGILS_PER_LEVEL; i++) out.push(getSigilCfg(worldId, levelIdx, i));
    return out;
  };

  // Completion tracking: per-(world, level, sigil) flat key set
  const sigilKey = (w, l, s) => `${w}:${l}:${s}`;
  const isSigilCompleted = (w, l, s) => (store.doneSigils || []).includes(sigilKey(w, l, s));
  const markSigilCompleted = (w, l, s) => {
    if (!Array.isArray(store.doneSigils)) store.doneSigils = [];
    const k = sigilKey(w, l, s);
    if (!store.doneSigils.includes(k)) {
      store.doneSigils.push(k);
      saveStore();
    }
  };
  const isLevelCompleted = (w, l) => {
    for (let s = 0; s < SIGILS_PER_LEVEL; s++) {
      if (!isSigilCompleted(w, l, s)) return false;
    }
    return true;
  };
  const isWorldCompleted = (w) => {
    for (let l = 0; l < LEVELS_PER_WORLD; l++) {
      if (!isLevelCompleted(w, l)) return false;
    }
    return true;
  };
  const isSigilUnlockedAt = (w, l, s) => s === 0 || isSigilCompleted(w, l, s - 1);
  const isLevelUnlocked = (w, l) => l === 0 || isLevelCompleted(w, l - 1);
  // Compatibility wrappers for solar/galaxy rendering — operate on GALAXY entities
  const isWorldDone = (w) => isWorldCompleted(w.id);
  const isSolarDone = (sys) => (sys.worlds?.length || 0) > 0 && sys.worlds.every(isWorldDone);

  // Find the next undone sigil the player can pick up. Walks HOMEKEEPER's
  // worlds in order, respects unlock chain (world requires + level requires
  // + sigil requires). Returns {worldId, levelIdx, sigilIdx} or null.
  const findNextUndoneSigil = () => {
    // Defined after GALAXY below — but GALAXY hoists fine because we read
    // it at call time, not at definition time.
    if (typeof GALAXY === 'undefined') return null;
    const sys = GALAXY.systems.find(s => s.id === 'homekeeper');
    if (!sys) return null;
    for (const world of sys.worlds) {
      // Walk worlds in declaration order
      const reqs = world.requires;
      const wUnlocked = world.unlocked || !reqs ||
        (sys.worlds.find(w => w.id === reqs) && isWorldCompleted(reqs));
      if (!wUnlocked) continue;
      for (let l = 0; l < LEVELS_PER_WORLD; l++) {
        if (!isLevelUnlocked(world.id, l)) break;
        for (let s = 0; s < SIGILS_PER_LEVEL; s++) {
          if (!isSigilUnlockedAt(world.id, l, s)) break;
          if (!isSigilCompleted(world.id, l, s)) {
            return { worldId: world.id, levelIdx: l, sigilIdx: s };
          }
        }
      }
    }
    return null;
  };

  // Migrate v2 (recoveredLines tied to PRIME · LEVEL 01) into the new
  // (world, level, sigil) coordinate system.
  const migrateToSigilGrid = () => {
    if (!Array.isArray(store.doneSigils)) store.doneSigils = [];
    if (Array.isArray(store.recoveredLines) && store.recoveredLines.length > 0) {
      let changed = false;
      for (const i of store.recoveredLines) {
        const k = sigilKey('prime', 0, i);
        if (!store.doneSigils.includes(k)) { store.doneSigils.push(k); changed = true; }
      }
      if (changed) saveStore();
    }
  };
  migrateToSigilGrid();

  // Order of completion — used to draw connection lines between completed
  // entities so the "sigil" they form follows orbital motion.
  const ensureOrderArrays = () => {
    if (!Array.isArray(store.completedSigilOrder)) store.completedSigilOrder = [];
    if (!Array.isArray(store.completedWorldOrder)) store.completedWorldOrder = [];
    if (!Array.isArray(store.completedSolarOrder)) store.completedSolarOrder = [];
  };
  ensureOrderArrays();

  const Map = (() => {
    let view = 'galaxy';      // 'galaxy' | 'solar' | 'world' | 'sigil'
    let sysId = null;
    let worldId = null;
    let sigilId = null;

    // Orbital animation
    let animFrame = null;
    let animStart = 0;
    const nodeRefs = new globalThis.Map();   // entityId -> button el
    const orbitInfo = new globalThis.Map();  // entityId -> orbit

    // Zoom + pan
    let scale = 1, tx = 0, ty = 0;
    // Visible at-rest bounds — what zoom-buttons clamp to
    const SCALE_MIN = 0.7, SCALE_MAX = 3.2;
    // Extended bounds during an active pinch — overshoot is allowed because
    // crossing a threshold on release triggers a tier-drill instead of clamping.
    const PINCH_MIN = 0.4, PINCH_MAX = 4.5;
    // Cross any of these on release of a pinch/wheel → drill into a tier
    const DRILL_IN_THRESHOLD = 3.6;
    const DRILL_OUT_THRESHOLD = 0.55;
    const pointers = new globalThis.Map();
    let pinchStartDist = 0, pinchStartScale = 1;
    let pinchCenterX = 0, pinchCenterY = 0;
    let panStartX = 0, panStartY = 0, panOriginX = 0, panOriginY = 0;
    let suppressClick = false;
    let movedSinceDown = false;

    const applyTransform = (tween) => {
      const content = document.getElementById('map-content');
      if (!content) return;
      content.classList.toggle('tween', !!tween);
      content.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    };
    const resetTransform = (tween) => {
      scale = 1; tx = 0; ty = 0;
      applyTransform(tween);
    };
    const setScale = (next, tween) => {
      scale = clamp(next, SCALE_MIN, SCALE_MAX);
      applyTransform(tween);
    };

    // Tier-drill animations. Both directions follow a single visual rule:
    //   scale > 1 == closer, scale < 1 == farther.
    // So drill-IN: old view zooms past, new view arrives from far (0.45 → 1).
    //    drill-OUT: old view retreats (1 → 0.45), new view arrives close (1.8 → 1).
    // This avoids the previous "zoom-in then zoom-out" sensation when stepping
    // between tiers.
    let isZooming = false;
    const zoomInto = (cx, cy, callback) => {
      if (isZooming) return;
      isZooming = true;
      const canv = document.getElementById('map-canvas');
      const content = document.getElementById('map-content');
      const w = canv.offsetWidth, h = canv.offsetHeight;
      // Phase A — old view continues zooming IN toward (cx, cy) and fades out.
      const exitScale = 3.4;
      scale = exitScale;
      tx = w * (0.5 - cx) * exitScale;
      ty = h * (0.5 - cy) * exitScale;
      content.style.transition =
        'transform 400ms cubic-bezier(.4,0,.2,1), opacity 280ms ease 80ms';
      content.style.opacity = '0';
      applyTransform(false);
      setTimeout(() => {
        // Phase B — content swap, then new view arrives "from far": scale 0.45 → 1.
        callback();
        content.style.transition = 'none';
        scale = 0.45; tx = 0; ty = 0;
        applyTransform(false);
        // Force the snap to commit before re-enabling transitions.
        void content.offsetWidth;
        content.style.transition =
          'transform 380ms cubic-bezier(.4,0,.2,1), opacity 300ms ease';
        requestAnimationFrame(() => {
          scale = 1; applyTransform(false);
          content.style.opacity = '1';
        });
        setTimeout(() => {
          isZooming = false;
          content.style.transition = '';
        }, 420);
      }, 420);
    };
    const zoomOut = (callback) => {
      if (isZooming) return;
      isZooming = true;
      const content = document.getElementById('map-content');
      // Phase A — old view retreats (shrinks) and fades out.
      scale = 0.45; tx = 0; ty = 0;
      content.style.transition =
        'transform 340ms cubic-bezier(.4,0,.2,1), opacity 260ms ease 60ms';
      content.style.opacity = '0';
      applyTransform(false);
      setTimeout(() => {
        // Phase B — content swap, then new view arrives "from close": scale 1.8 → 1.
        callback();
        content.style.transition = 'none';
        scale = 1.8; tx = 0; ty = 0;
        applyTransform(false);
        void content.offsetWidth;
        content.style.transition =
          'transform 360ms cubic-bezier(.4,0,.2,1), opacity 280ms ease';
        requestAnimationFrame(() => {
          scale = 1; applyTransform(false);
          content.style.opacity = '1';
        });
        setTimeout(() => {
          isZooming = false;
          content.style.transition = '';
        }, 400);
      }, 360);
    };

    const orbitalPos = (orbit, t, cx = 0.5, cy = 0.5) => {
      const angle = orbit.baseAngle + orbit.speed * t;
      return { x: cx + orbit.r * Math.cos(angle), y: cy + orbit.r * Math.sin(angle) };
    };

    const startAnim = () => {
      if (animFrame) return;
      animStart = performance.now() / 1000;
      const loop = (t) => {
        animFrame = requestAnimationFrame(loop);
        const elapsed = t / 1000 - animStart;
        // Update DOM positions
        nodeRefs.forEach((el, id) => {
          const orbit = orbitInfo.get(id);
          if (!orbit) return;
          const p = orbitalPos(orbit, elapsed);
          el.style.left = (p.x * 100) + '%';
          el.style.top = (p.y * 100) + '%';
        });
        // Re-draw connection lines (only present after entries complete)
        redrawConnections(elapsed);
      };
      animFrame = requestAnimationFrame(loop);
    };
    const stopAnim = () => {
      if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
      nodeRefs.clear();
      orbitInfo.clear();
    };

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
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      svg().appendChild(el);
    };

    // A pulsing light streak that travels along a single segment —
    // drawn over the regular connection so the player sees "this is
    // where you go next".
    const streakSvg = (x1, y1, x2, y2) => {
      const ns = 'http://www.w3.org/2000/svg';
      const el = document.createElementNS(ns, 'line');
      el.setAttribute('x1', x1); el.setAttribute('y1', y1);
      el.setAttribute('x2', x2); el.setAttribute('y2', y2);
      el.setAttribute('stroke', `rgba(${C.accentRgb}, 0.95)`);
      el.setAttribute('stroke-width', '3');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('vector-effect', 'non-scaling-stroke');
      el.setAttribute('class', 'streak-pulse');
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
      else b.setAttribute('aria-disabled', 'true');
      nodes().appendChild(b);
      return b;
    };

    const isUnlockedSolar = (sys) => {
      if (sys.unlocked) return true;
      if (!sys.requires) return false;
      const req = GALAXY.systems.find(s => s.id === sys.requires);
      return req && isSolarDone(req);
    };
    const isUnlockedWorld = (sys, w) => {
      if (w.unlocked) return true;
      if (!w.requires) return false;
      const req = sys.worlds.find(x => x.id === w.requires);
      return req && isWorldDone(req);
    };

    const renderGalaxy = () => {
      stopAnim();
      clearMap();
      setHeader('GALAXY', GALAXY.name);

      // Draw one ring per unique orbital radius — multiple concentric orbits
      const uniqueRs = [...new Set(GALAXY.systems.map(s => Math.round(s.orbit.r * 1000)))];
      uniqueRs.forEach(rv => {
        circleSvg(500, 500, rv, { stroke: 'rgba(241, 234, 216, 0.05)', dash: '2 8' });
      });

      // Galactic core (terminal). Visible always, sealed by default.
      const allSolarsDone = GALAXY.systems.every(s => isSolarDone(s));
      drawCore(allSolarsDone);

      // Place each solar at its starting orbital position
      const t0 = 0;
      GALAXY.systems.forEach(sys => {
        const unlocked = isUnlockedSolar(sys);
        const done = isSolarDone(sys);
        const pos = orbitalPos(sys.orbit, t0);
        const totalWorlds = sys.worlds.length;
        const unlockedCount = sys.worlds.filter(w => isUnlockedWorld(sys, w)).length;
        const meta = !unlocked ? 'sealed'
                   : done ? 'whole'
                   : (totalWorlds > 0 ? `${unlockedCount} / ${totalWorlds} worlds` : 'empty');
        const cls = done ? 'complete' : unlocked ? 'current' : 'locked';
        const lockMsg = !unlocked
          ? (sys.requires ? `sealed · complete ${(GALAXY.systems.find(s => s.id === sys.requires)?.name) || sys.requires} to unlock`
                          : (sys.note || 'sealed.'))
          : null;
        const el = makeNode(pos.x, pos.y, sys.name, cls, meta, () => {
          if (unlocked) {
            // Use the solar's current orbital position when zooming
            const t = (performance.now() / 1000) - animStart;
            const cur = orbitalPos(sys.orbit, t);
            zoomInto(cur.x, cur.y, () => showSolar(sys.id));
          } else {
            flashStatus(`${sys.name} — ${lockMsg}`);
          }
        });
        nodeRefs.set('sys:' + sys.id, el);
        orbitInfo.set('sys:' + sys.id, sys.orbit);
      });

      setStatus('tap a solar system to descend');
      startAnim();
    };

    const drawCore = (ready) => {
      // Inner sealing rings — visually distinct from regular orbits
      circleSvg(500, 500, 30, {
        stroke: ready ? 'rgba(255, 184, 107, 0.55)' : 'rgba(255, 245, 216, 0.12)',
        dash: ready ? null : '3 5',
        width: ready ? 1.2 : 0.6,
      });
      circleSvg(500, 500, 10, { fill: ready ? 'rgba(255, 184, 107, 0.85)' : 'rgba(255, 245, 216, 0.35)' });

      // Add a tappable core node label
      const el = document.createElement('button');
      el.className = 'map-node sun ' + (ready ? 'ready' : 'sealed');
      el.style.left = '50%';
      el.style.top = '50%';
      const dot = document.createElement('div'); dot.className = 'map-node-dot sun-dot';
      const lbl = document.createElement('div'); lbl.className = 'map-node-label'; lbl.textContent = GALAXY.core.name;
      const meta = document.createElement('div'); meta.className = 'map-node-meta';
      meta.textContent = ready ? 'open' : 'sealed';
      el.appendChild(dot); el.appendChild(lbl); el.appendChild(meta);
      el.addEventListener('click', () => {
        flashStatus(`${GALAXY.core.name} — ${ready ? GALAXY.core.ready_note : GALAXY.core.locked_note}`);
      });
      nodes().appendChild(el);
    };

    const renderSolar = (id) => {
      sysId = id;
      stopAnim();
      const sys = GALAXY.systems.find(s => s.id === id);
      if (!sys) return renderGalaxy();
      applyPalette(paletteFor('REMEMBERED', id));
      clearMap();
      setHeader('SOLAR · ' + GALAXY.name, sys.name);

      // Multiple orbital rings — one per unique orbit radius among this
      // solar's worlds. The Sun lives at centre.
      const worldRs = [...new Set(sys.worlds.map(w => Math.round(w.orbit.r * 1000)))];
      worldRs.forEach(rv => {
        circleSvg(500, 500, rv, { stroke: 'rgba(241, 234, 216, 0.05)', dash: '2 8' });
      });

      // Central Sun — terminal challenge of the solar system
      if (sys.sun) {
        const allDone = sys.worlds.length > 0 && sys.worlds.every(isWorldDone);
        drawSun(sys, allDone);
      }

      if (sys.worlds.length === 0) {
        const div = document.createElement('div');
        div.className = 'map-node locked';
        div.style.left = '50%'; div.style.top = '14%';
        const lbl = document.createElement('div');
        lbl.className = 'map-node-label';
        lbl.textContent = sys.note || 'empty';
        div.appendChild(lbl);
        nodes().appendChild(div);
      } else {
        const t0 = 0;
        sys.worlds.forEach(w => {
          const unlocked = isUnlockedWorld(sys, w);
          const done = isWorldDone(w);
          const pos = orbitalPos(w.orbit, t0);
          // Per-world level progress for the meta line
          let doneLvls = 0;
          for (let li = 0; li < LEVELS_PER_WORLD; li++) {
            if (isLevelCompleted(w.id, li)) doneLvls++;
          }
          const meta = !unlocked ? 'sealed'
                     : done ? 'whole'
                     : `${doneLvls} / ${LEVELS_PER_WORLD} levels`;
          const cls = done ? 'complete' : unlocked ? 'current' : 'locked';
          const lockMsg = !unlocked
            ? (w.requires
                ? `sealed · complete ${(sys.worlds.find(x => x.id === w.requires)?.name) || w.requires} to unlock`
                : (w.note || 'sealed.'))
            : (w.mechanic ? `tap to enter · ${w.mechanic}` : 'tap to enter');
          const el = makeNode(pos.x, pos.y, w.name, cls, meta, () => {
            if (unlocked) {
              const t = (performance.now() / 1000) - animStart;
              const cur = orbitalPos(w.orbit, t);
              zoomInto(cur.x, cur.y, () => showWorld(sys.id, w.id));
            } else {
              flashStatus(`${w.name} — ${lockMsg}`);
            }
          });
          nodeRefs.set('w:' + w.id, el);
          orbitInfo.set('w:' + w.id, w.orbit);
        });
      }

      const someUnlocked = sys.worlds.some(w => isUnlockedWorld(sys, w));
      setStatus(someUnlocked ? 'tap a world to see its sigils' : (sys.note || 'no worlds online yet'));
      startAnim();
    };

    const drawSun = (sys, ready) => {
      // The Sun visualisation lives at the centre.
      circleSvg(500, 500, 28, {
        stroke: ready ? 'rgba(255, 184, 107, 0.7)' : 'rgba(255, 245, 216, 0.12)',
        dash: ready ? null : '3 5',
        width: ready ? 1.4 : 0.6,
      });
      circleSvg(500, 500, 12, { fill: ready ? 'rgba(255, 184, 107, 0.85)' : 'rgba(255, 245, 216, 0.30)' });

      const el = document.createElement('button');
      el.className = 'map-node sun ' + (ready ? 'ready' : 'sealed');
      el.style.left = '50%';
      el.style.top = '50%';
      const dot = document.createElement('div'); dot.className = 'map-node-dot sun-dot';
      const lbl = document.createElement('div'); lbl.className = 'map-node-label';
      lbl.textContent = sys.sun.name;
      const meta = document.createElement('div'); meta.className = 'map-node-meta';
      meta.textContent = ready ? 'open' : 'sealed';
      el.appendChild(dot); el.appendChild(lbl); el.appendChild(meta);
      el.addEventListener('click', () => {
        flashStatus(`${sys.sun.name} — ${ready ? sys.sun.ready_note : sys.sun.locked_note}`);
      });
      nodes().appendChild(el);
    };

    const showWorld = (sId, wId) => {
      worldId = wId;
      view = 'world';
      renderWorld(sId, wId);
    };
    const showLevel = (sId, wId, lvlIdx) => {
      worldId = wId;
      sigilId = lvlIdx; // reusing var to track the open level idx
      view = 'level';
      renderLevel(sId, wId, lvlIdx);
    };

    // WORLD VIEW — shows the 20 LEVELS of a world on a spiral, outer = Level 01
    const renderWorld = (sId, wId) => {
      stopAnim();
      const sys = GALAXY.systems.find(s => s.id === sId);
      const w = sys?.worlds.find(ww => ww.id === wId);
      if (!w) return renderGalaxy();
      applyPalette(paletteFor('REMEMBERED', sId, wId));
      clearMap();
      const worldComplete = isWorldCompleted(w.id);
      setHeader('WORLD · ' + sys.name, w.name + (worldComplete ? '  ✓' : ''));

      const N = LEVELS_PER_WORLD;
      const cx = 500, cy = 500;
      const positions = [];
      // 4 concentric rings of 5 levels each. Outer ring = Level 01-05.
      // Each ring offset by a half-step so nodes never align radially.
      const PER_RING = 5;
      const RINGS = Math.ceil(N / PER_RING);
      const RING_RADII = [430, 330, 230, 130];
      for (let i = 0; i < N; i++) {
        const ringIdx = Math.floor(i / PER_RING);
        const inRing = i % PER_RING;
        const r = RING_RADII[Math.min(ringIdx, RING_RADII.length - 1)];
        const baseAngle = -Math.PI / 2;
        const offset = ringIdx * (Math.PI / PER_RING); // half-step stagger
        const angle = baseAngle + (inRing / PER_RING) * Math.PI * 2 + offset;
        positions.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      }

      // Connection spiral — bright between consecutive completed levels
      let lastDoneLvl = -1;
      for (let i = 0; i < N; i++) {
        if (isLevelCompleted(w.id, i)) lastDoneLvl = i;
      }
      for (let i = 0; i < N - 1; i++) {
        const a = positions[i], b = positions[i + 1];
        const bothDone = isLevelCompleted(w.id, i) && isLevelCompleted(w.id, i + 1);
        lineSvg(a.x, a.y, b.x, b.y, {
          color: bothDone ? 'rgba(255, 184, 107, 0.6)' : accentRgba(0.18),
          width: bothDone ? 1.4 : 0.6,
          dash: bothDone ? null : '5 8',
        });
      }
      // Light streak from last-done to next-up
      if (lastDoneLvl >= 0 && lastDoneLvl + 1 < N) {
        const a = positions[lastDoneLvl], b = positions[lastDoneLvl + 1];
        streakSvg(a.x, a.y, b.x, b.y);
      }

      // Level nodes
      let doneCount = 0;
      for (let i = 0; i < N; i++) {
        const done = isLevelCompleted(w.id, i);
        if (done) doneCount++;
        const unlocked = isLevelUnlocked(w.id, i);
        const cls = ['sigil-node'];
        if (done) cls.push('done');
        else if (unlocked) cls.push('next');
        else cls.push('locked');
        const b = document.createElement('button');
        b.className = cls.join(' ');
        b.style.left = (positions[i].x / 1000 * 100) + '%';
        b.style.top = (positions[i].y / 1000 * 100) + '%';
        b.textContent = String(i + 1).padStart(2, '0');
        if (unlocked) {
          const nx = positions[i].x / 1000, ny = positions[i].y / 1000;
          b.addEventListener('click', () => zoomInto(nx, ny, () => showLevel(sId, wId, i)));
        } else {
          b.setAttribute('aria-disabled', 'true');
          const num = String(i + 1).padStart(2, '0');
          const prev = String(i).padStart(2, '0');
          b.addEventListener('click', () => {
            flashStatus(`LEVEL ${num} — sealed · complete LEVEL ${prev} to unlock`);
          });
        }
        nodes().appendChild(b);
      }

      const remaining = N - doneCount;
      const statusEl = document.getElementById('map-status');
      statusEl.classList.toggle('whole', worldComplete);
      const status = worldComplete ? '✓ WORLD WHOLE — every level decoded · tap any to retrace' :
                    doneCount === 0 ? `mechanic: ${w.mechanic || 'tap LEVEL 01 to begin'}` :
                    `${remaining} of ${N} levels remaining`;
      setStatus(status);
    };

    // LEVEL VIEW — shows the 10 SIGILS of a level on a ring
    const renderLevel = (sId, wId, lvlIdx) => {
      stopAnim();
      const sys = GALAXY.systems.find(s => s.id === sId);
      const w = sys?.worlds.find(ww => ww.id === wId);
      if (!w) return renderWorld(sId, wId);
      applyPalette(paletteFor('REMEMBERED', sId, wId, `l${lvlIdx}`));
      clearMap();
      const levelComplete = isLevelCompleted(w.id, lvlIdx);
      const levelNum = String(lvlIdx + 1).padStart(2, '0');
      const levelName = getLevelName(w.id, lvlIdx);
      setHeader('LEVEL ' + levelNum + ' · ' + w.name, levelName + (levelComplete ? '  ✓' : ''));

      const N = SIGILS_PER_LEVEL;
      const cx = 500, cy = 500;
      const positions = [];
      for (let i = 0; i < N; i++) {
        const t = i / N;
        // outer = Sigil 01, slight inward spiral
        const angle = t * Math.PI * 2 - Math.PI / 2;
        const r = 340 - t * 80;
        positions.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
      }

      // Connections
      let lastDoneSig = -1;
      for (let i = 0; i < N; i++) {
        if (isSigilCompleted(w.id, lvlIdx, i)) lastDoneSig = i;
      }
      for (let i = 0; i < N - 1; i++) {
        const a = positions[i], b = positions[i + 1];
        const bothDone = isSigilCompleted(w.id, lvlIdx, i) && isSigilCompleted(w.id, lvlIdx, i + 1);
        lineSvg(a.x, a.y, b.x, b.y, {
          color: bothDone ? 'rgba(255, 184, 107, 0.7)' : accentRgba(0.22),
          width: bothDone ? 1.6 : 0.7,
          dash: bothDone ? null : '5 8',
        });
      }
      // Light streak from last completed sigil to the next required
      if (lastDoneSig >= 0 && lastDoneSig + 1 < N) {
        const a = positions[lastDoneSig], b = positions[lastDoneSig + 1];
        streakSvg(a.x, a.y, b.x, b.y);
      }

      // Sigil nodes
      let doneSig = 0;
      for (let i = 0; i < N; i++) {
        const done = isSigilCompleted(w.id, lvlIdx, i);
        if (done) doneSig++;
        const unlocked = isSigilUnlockedAt(w.id, lvlIdx, i);
        const cls = ['sigil-node'];
        if (done) cls.push('done');
        else if (unlocked) cls.push('next');
        else cls.push('locked');
        const b = document.createElement('button');
        b.className = cls.join(' ');
        b.style.left = (positions[i].x / 1000 * 100) + '%';
        b.style.top = (positions[i].y / 1000 * 100) + '%';
        b.textContent = String(i + 1).padStart(2, '0');
        if (unlocked) {
          b.addEventListener('click', () => {
            closeMap();
            Audio.init(); Audio.resume();
            startSigil(w.id, lvlIdx, i);
          });
        } else {
          b.setAttribute('aria-disabled', 'true');
          const num = String(i + 1).padStart(2, '0');
          const prev = String(i).padStart(2, '0');
          b.addEventListener('click', () => {
            flashStatus(`SIGIL ${num} — sealed · complete SIGIL ${prev} to unlock`);
          });
        }
        nodes().appendChild(b);
      }

      const remaining = N - doneSig;
      const statusEl = document.getElementById('map-status');
      statusEl.classList.toggle('whole', levelComplete);
      const status = levelComplete ? '✓ LEVEL WHOLE — every sigil decoded · tap any to retrace' :
                    doneSig === 0 ? 'tap the cyan sigil to begin' :
                    `${remaining} of ${N} sigils remaining`;
      setStatus(status);
    };

    // Re-draw orbital connection lines between consecutive completed
    // entries — called every frame so the "sigil" they form moves with
    // the orbits.
    const redrawConnections = (elapsed) => {
      // Remove old connection elements (lines with data-conn="1")
      const svgEl = svg();
      const old = svgEl.querySelectorAll('line[data-conn="1"]');
      old.forEach(o => o.remove());

      const connect = (entities) => {
        for (let i = 0; i < entities.length - 1; i++) {
          const a = orbitalPos(entities[i].orbit, elapsed);
          const b = orbitalPos(entities[i + 1].orbit, elapsed);
          const ns = 'http://www.w3.org/2000/svg';
          const el = document.createElementNS(ns, 'line');
          el.setAttribute('x1', a.x * 1000); el.setAttribute('y1', a.y * 1000);
          el.setAttribute('x2', b.x * 1000); el.setAttribute('y2', b.y * 1000);
          el.setAttribute('stroke', 'rgba(255, 184, 107, 0.7)');
          el.setAttribute('stroke-width', '2');
          el.setAttribute('vector-effect', 'non-scaling-stroke');
          el.setAttribute('data-conn', '1');
          svgEl.appendChild(el);
        }
      };

      if (view === 'galaxy') {
        const done = GALAXY.systems.filter(isSolarDone);
        connect(done);
      } else if (view === 'solar' && sysId) {
        const sys = GALAXY.systems.find(s => s.id === sysId);
        if (sys) connect(sys.worlds.filter(isWorldDone));
      }
    };

    const showGalaxy = () => { view = 'galaxy'; renderGalaxy(); };
    const showSolar = (id) => { view = 'solar'; renderSolar(id); };

    const open = () => {
      view = 'galaxy';
      applyPalette(paletteFor('REMEMBERED'));
      showScreens({ map: true });
      resetTransform(false);
      renderGalaxy();
    };

    // Locked-node feedback — flash the status bar with the lock-message, plus
    // a small audio + haptic cue. Replaces silent setStatus() for lock taps.
    let statusFlashTimer = null;
    const flashStatus = (text, ms = 2400) => {
      const el = document.getElementById('map-status');
      el.textContent = text;
      // Restart the CSS animation by removing + forcing reflow + re-adding.
      el.classList.remove('locked-flash');
      void el.offsetWidth;
      el.classList.add('locked-flash');
      if (statusFlashTimer) clearTimeout(statusFlashTimer);
      statusFlashTimer = setTimeout(() => {
        el.classList.remove('locked-flash');
        statusFlashTimer = null;
      }, ms);
      try { if (Audio && Audio.ready && Audio.ready()) Audio.tick(220, 0.06); } catch {}
      try { vibrate && vibrate(8); } catch {}
    };

    // Zoom towards a screen point — keeps the world-point currently under that
    // point fixed during the scale change. Without this, every zoom orbits
    // the centre of the map regardless of where the user is pinching/scrolling.
    const zoomTowards = (cursorX, cursorY, nextScale, tween = false) => {
      const canv = document.getElementById('map-canvas');
      const rect = canv.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const diffX = cursorX - cx;
      const diffY = cursorY - cy;
      const f = nextScale / scale;
      // f = 1 → no-op; cursor-stable derivation:
      //   tx_new = tx_old * f + diff * (1 - f)
      tx = tx * f + diffX * (1 - f);
      ty = ty * f + diffY * (1 - f);
      scale = nextScale;
      applyTransform(tween);
    };

    // When a pinch or wheel-zoom releases beyond a tier-threshold, drill into
    // the element the gesture was centred on (drill-in) or step back a tier
    // (drill-out). Returns true if a real drill happened (caller should NOT
    // snap-back). Returns false for "no node found" OR "node was locked" —
    // caller should snap the scale back to the visible bounds.
    const tryDrillAtPoint = (clientX, clientY) => {
      const el = document.elementFromPoint(clientX, clientY);
      const node = el && el.closest
        ? el.closest('.map-node, .sigil-node')
        : null;
      if (!node) return false;
      const isLocked = node.classList.contains('locked')
                    || node.classList.contains('sealed')
                    || node.getAttribute('aria-disabled') === 'true';
      // Always click — unlocked nodes drill, locked nodes flash a message.
      suppressClick = true;
      node.click();
      setTimeout(() => { suppressClick = false; }, 120);
      return !isLocked;
    };

    // Pinch + pan + tap-to-not-click suppression on the map canvas
    const initPanZoom = () => {
      const canv = document.getElementById('map-canvas');
      if (!canv || canv.dataset.bound === '1') return;
      canv.dataset.bound = '1';

      canv.addEventListener('pointerdown', (e) => {
        // Don't capture if the user is pressing a zoom button itself
        if (e.target.closest('.map-zoom-btn')) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        movedSinceDown = false;
        if (pointers.size === 2) {
          const ps = [...pointers.values()];
          pinchStartDist = Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y);
          pinchStartScale = scale;
          pinchCenterX = (ps[0].x + ps[1].x) / 2;
          pinchCenterY = (ps[0].y + ps[1].y) / 2;
        } else if (pointers.size === 1) {
          panStartX = e.clientX; panStartY = e.clientY;
          panOriginX = tx; panOriginY = ty;
        }
      }, { passive: true });

      canv.addEventListener('pointermove', (e) => {
        if (!pointers.has(e.pointerId)) return;
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.size === 2) {
          const ps = [...pointers.values()];
          const d = Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y);
          const newCx = (ps[0].x + ps[1].x) / 2;
          const newCy = (ps[0].y + ps[1].y) / 2;
          if (pinchStartDist > 0) {
            // Allow overshoot up to PINCH_MAX / down to PINCH_MIN — release-
            // threshold decides if it's a tier-drill or just a snap-back.
            const next = clamp(pinchStartScale * (d / pinchStartDist), PINCH_MIN, PINCH_MAX);
            zoomTowards(newCx, newCy, next);
            movedSinceDown = true;
            suppressClick = true;
          }
          pinchCenterX = newCx;
          pinchCenterY = newCy;
        } else if (pointers.size === 1) {
          const dx = e.clientX - panStartX;
          const dy = e.clientY - panStartY;
          if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
            tx = panOriginX + dx;
            ty = panOriginY + dy;
            applyTransform(false);
            movedSinceDown = true;
            suppressClick = true;
          }
        }
      }, { passive: true });

      const endPointer = (e) => {
        const wasPinch = pointers.size === 2;
        pointers.delete(e.pointerId);
        if (pointers.size === 0) {
          // Briefly suppress the synthetic click that follows pointerup if user dragged
          if (movedSinceDown) {
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 50);
          } else {
            suppressClick = false;
          }
        }
        // Pinch just ended (second finger lifted) — check tier-drill thresholds.
        if (wasPinch && !isZooming) {
          if (scale > DRILL_IN_THRESHOLD) {
            if (!tryDrillAtPoint(pinchCenterX, pinchCenterY)) {
              // No drillable node at the pinch centre — snap back to the
              // visible max so the user isn't stuck at an overshoot scale.
              scale = SCALE_MAX;
              applyTransform(true);
            }
          } else if (scale < DRILL_OUT_THRESHOLD) {
            if (view === 'galaxy') {
              scale = SCALE_MIN;
              applyTransform(true);
            } else {
              back();
            }
          } else if (scale > SCALE_MAX || scale < SCALE_MIN) {
            // Overshot but didn't reach drill threshold — settle inside bounds
            // while keeping the pinch-centre stable so the snap feels grounded.
            zoomTowards(pinchCenterX, pinchCenterY, clamp(scale, SCALE_MIN, SCALE_MAX), true);
          }
        }
      };
      canv.addEventListener('pointerup', endPointer, { passive: true });
      canv.addEventListener('pointercancel', endPointer, { passive: true });

      // Mouse-wheel + trackpad — same drill semantics as pinch. Zoom anchors
      // on the cursor; at the visible limit, an additional scroll-in/out
      // crosses into a tier drill.
      canv.addEventListener('wheel', (e) => {
        if (isZooming) { e.preventDefault(); return; }
        e.preventDefault();
        // Smooth exponential — same formula on mousewheel and trackpad
        const factor = Math.pow(1.0015, -e.deltaY);
        const next = scale * factor;
        // Scroll-IN past the visible max → attempt drill into element under cursor.
        // tryDrillAtPoint also fires for locked nodes (shows flash-message) but
        // returns false in that case — we then snap back to MAX.
        if (e.deltaY < 0 && scale >= SCALE_MAX - 0.02) {
          if (tryDrillAtPoint(e.clientX, e.clientY)) return;
          scale = SCALE_MAX;
          applyTransform(false);
          return;
        }
        // Scroll-OUT past the visible min → drill back a tier
        if (e.deltaY > 0 && scale <= SCALE_MIN + 0.02 && view !== 'galaxy') {
          back();
          return;
        }
        zoomTowards(e.clientX, e.clientY, clamp(next, SCALE_MIN, SCALE_MAX));
      }, { passive: false });

      // Capture-phase click filter — blocks clicks on map-nodes after a drag/pinch
      canv.addEventListener('click', (e) => {
        if (suppressClick) { e.stopPropagation(); e.preventDefault(); }
      }, true);

      // Zoom buttons
      document.getElementById('btn-zoom-in').addEventListener('click', () => setScale(scale * 1.35, true));
      document.getElementById('btn-zoom-out').addEventListener('click', () => setScale(scale / 1.35, true));
      document.getElementById('btn-zoom-reset').addEventListener('click', () => resetTransform(true));
    };
    initPanZoom();

    const back = () => {
      if (view === 'level') {
        zoomOut(() => {
          applyPalette(paletteFor('REMEMBERED', sysId, worldId));
          showWorld(sysId, worldId);
        });
      } else if (view === 'world') {
        zoomOut(() => {
          applyPalette(paletteFor('REMEMBERED', sysId));
          showSolar(sysId);
        });
      } else if (view === 'solar') {
        zoomOut(() => {
          applyPalette(paletteFor('REMEMBERED'));
          showGalaxy();
        });
      } else {
        closeMap();
      }
    };

    const closeMap = () => {
      stopAnim();
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
      else if (view === 'level') renderLevel(sysId, worldId, sigilId);
    }};
  })();

  // -------------------------------------------------------------------------
  // Button wiring
  // -------------------------------------------------------------------------
  document.getElementById('btn-begin').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.bell([392, 523.25, 659.25], 0.10);
    Music.start(C.accentHue);
    vibrate([4, 18, 4]);
    if (!store.seenTutorial) {
      store.seenTutorial = true; saveStore();
      startTutorial();
    } else {
      // Smart continue — pick up at the next undone sigil anywhere in
      // HOMEKEEPER (respecting unlock chain), not just PRIME LEVEL 01.
      const next = findNextUndoneSigil();
      if (next) startSigil(next.worldId, next.levelIdx, next.sigilIdx);
      else startSigil('prime', 0, 0); // safety fallback
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
    Music.start(C.accentHue);
    startDaily();
  });
  document.getElementById('mode-endless').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.tick(660);
    Music.start(C.accentHue);
    startEndless(0);
  });
  document.getElementById('mode-replay').addEventListener('click', () => {
    Audio.init(); Audio.resume();
    Audio.tick(660);
    Music.start(C.accentHue);
    startStory(0); // restart story from the top
  });

  document.getElementById('btn-success-next').addEventListener('click', (e) => {
    Audio.tick(660);
    const fn = e.currentTarget._next;
    if (typeof fn === 'function') fn();
  });
  document.getElementById('btn-success-menu').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
  });

  document.getElementById('btn-fail-retry').addEventListener('click', () => {
    Audio.tick(440);
    if (G.mode === 'sigil') startSigil(G.playWorldId, G.playLevelIdx, G.playSigilIdx);
    else if (G.mode === 'story') startStory(G.levelIdx);
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
    Music.start(C.accentHue);
    Map.open();
  });
  document.getElementById('btn-map-back').addEventListener('click', () => Map.back());
  document.getElementById('btn-map-close').addEventListener('click', () => Map.close());

  document.getElementById('btn-pause').addEventListener('click', () => {
    if (state !== STATE.PLAYING) return;
    state = STATE.PAUSED;
    showScreens({ pause: true, hud: true });
    Audio.tone(330, 0.18, 'triangle', 0.10, 0.001);
    Music.setVolume(0.18);
  });
  document.getElementById('btn-resume').addEventListener('click', () => {
    state = STATE.PLAYING;
    showScreens({ hud: true });
    Music.setVolume(0.5);
  });
  document.getElementById('btn-restart').addEventListener('click', () => {
    if (G.mode === 'sigil') startSigil(G.playWorldId, G.playLevelIdx, G.playSigilIdx);
    else if (G.mode === 'story') startStory(G.levelIdx);
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
    if (store.sound) {
      Audio.init(); Audio.resume(); Audio.tick(660);
      Music.start(C.accentHue);
    } else {
      Music.stop();
    }
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
