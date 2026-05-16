/* SIGIL — strange artefact found inside the phone
 * A tracing game. Stars are scattered on a dark field; you drag your
 * finger from one to the next in a hidden order to redraw a sigil.
 * Each successful sigil decodes one line of the artefact's message.
 * Designed for touchscreens: targets are static, widely spaced, and
 * the next required star is always larger than a fingertip.
 */
(() => {
  'use strict';

  // -------------------------------------------------------------------------
  // Palette
  // -------------------------------------------------------------------------
  const C = {
    ink: '#f1ead8',
    inkDim: '#a59dba',
    inkFaint: '#5a5375',
    star: '#fff5d8',
    starGlow: '#ffd89a',
    accent: '#5af0ff',
    accentDeep: '#6affb0',
    warm: '#ffb86b',
    warn: '#ff5a6b',
    decoy: '#5a5375',
  };

  // -------------------------------------------------------------------------
  // The recovered message — ten fragments, one decoded per sigil
  // -------------------------------------------------------------------------
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

  // Pentatonic notes mapped to step index in a sigil
  const TUNING = [
    261.63, 293.66, 329.63, 392.00, 440.00,
    523.25, 587.33, 659.25, 783.99, 880.00,
    1046.5, 1174.66,
  ];

  // -------------------------------------------------------------------------
  // Level configuration — difficulty rises with sigil index
  // -------------------------------------------------------------------------
  const LEVELS = [
    { count: 3, decoys: 0, hintFade: 0,   time: 0  },
    { count: 4, decoys: 0, hintFade: 0,   time: 0  },
    { count: 4, decoys: 1, hintFade: 0,   time: 0  },
    { count: 5, decoys: 1, hintFade: 6,   time: 0  },
    { count: 5, decoys: 2, hintFade: 5,   time: 0  },
    { count: 6, decoys: 2, hintFade: 4,   time: 45 },
    { count: 6, decoys: 3, hintFade: 4,   time: 40 },
    { count: 7, decoys: 3, hintFade: 3,   time: 38 },
    { count: 8, decoys: 4, hintFade: 3,   time: 36 },
    { count: 9, decoys: 4, hintFade: 2.5, time: 34 },
  ];

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------
  const STORAGE_KEY = 'sigil.v1';
  const defaultStore = {
    sound: true,
    sigilsTraced: 0,
    runs: 0,
    bestPerfect: 0,          // longest no-mistake streak
    recoveredLines: [],
    complete: false,
    seenTutorial: false,
    nextLevel: 0,            // resume point
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
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // -------------------------------------------------------------------------
  // Haptics
  // -------------------------------------------------------------------------
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
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  const TAU = Math.PI * 2;
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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
  const STATE = { BOOT: 'boot', TITLE: 'title', TUTORIAL: 'tutorial',
                  PLAYING: 'playing', COMPLETE: 'complete', FAILED: 'failed',
                  PAUSED: 'paused', ARCHIVE: 'archive', HOW: 'how' };
  let state = STATE.BOOT;

  const G = {
    levelIdx: 0,           // which sigil we're working on
    nodes: [],             // [{x,y,decoy:bool,idx,hit:bool,touchedAt}]
    path: [],              // sequence of node indices (required only)
    progress: 0,           // count of correctly hit nodes (path[0..progress-1])
    touching: false,       // finger currently down + has hit at least one node
    fingerX: 0, fingerY: 0,
    fingerActive: false,   // finger is down somewhere
    timeLeft: 0,
    timeLimit: 0,
    elapsed: 0,
    hintAlpha: 1,
    hintFade: 0,           // seconds after which hints fade
    mistakes: 0,           // wrong-node touches this attempt
    perfectStreak: 0,      // current run streak with zero mistakes
    flashAlpha: 0,         // wrong-node flash overlay
    successPhase: 0,       // 0=playing, 1=celebrating
    successTimer: 0,
    stars: [],             // background twinkles
    particles: [],
    nudge: 0,              // small camera shake on error
    completeTier: -1,      // for "depth" accent shift
  };

  const buildStars = () => {
    G.stars.length = 0;
    const count = reduceMotion ? 30 : 90;
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
  // Level generation
  // -------------------------------------------------------------------------
  const PLAY_TOP = 92;       // reserve top area for HUD + level label
  const PLAY_BOTTOM = 110;   // reserve bottom area for controls / cue card
  const NODE_MIN_DIST = 92;

  const generateLevel = (levelIdx) => {
    const cfg = LEVELS[Math.min(levelIdx, LEVELS.length - 1)];
    const total = cfg.count + cfg.decoys;
    const nodes = [];
    const margin = 36;

    for (let i = 0; i < total; i++) {
      let x, y, tries = 0;
      do {
        x = rand(margin, W - margin);
        y = rand(PLAY_TOP + margin, H - PLAY_BOTTOM - margin);
        tries++;
      } while (tries < 80 && nodes.some(n => dist(n.x, n.y, x, y) < NODE_MIN_DIST));
      nodes.push({ x, y, decoy: false, hit: false, touchedAt: 0, errorAt: 0 });
    }

    // Pick which indices form the required path (sigil); the rest are decoys
    const order = shuffle(nodes.map((_, i) => i));
    const required = order.slice(0, cfg.count);
    const decoys = order.slice(cfg.count);
    decoys.forEach(i => { nodes[i].decoy = true; });

    // Build a clean traceable path via nearest-neighbor
    const path = [];
    const seen = new Set();
    let cur = required[Math.floor(Math.random() * required.length)];
    path.push(cur); seen.add(cur);
    while (seen.size < required.length) {
      let best = -1, bd = Infinity;
      for (const i of required) {
        if (seen.has(i)) continue;
        const d = dist(nodes[cur].x, nodes[cur].y, nodes[i].x, nodes[i].y);
        if (d < bd) { bd = d; best = i; }
      }
      path.push(best); seen.add(best); cur = best;
    }

    return { nodes, path, cfg };
  };

  const loadLevel = (levelIdx) => {
    const lvl = generateLevel(levelIdx);
    G.levelIdx = levelIdx;
    G.nodes = lvl.nodes;
    G.path = lvl.path;
    G.progress = 0;
    G.touching = false;
    G.fingerActive = false;
    G.elapsed = 0;
    G.timeLimit = lvl.cfg.time;
    G.timeLeft = lvl.cfg.time;
    G.hintFade = lvl.cfg.hintFade;
    G.hintAlpha = 1;
    G.mistakes = 0;
    G.flashAlpha = 0;
    G.successPhase = 0;
    G.successTimer = 0;
    G.particles.length = 0;
    G.nudge = 0;
    updateLevelLabel();
  };

  // -------------------------------------------------------------------------
  // Particles
  // -------------------------------------------------------------------------
  const spawnParticles = (x, y, color, n = 14, sp = 110, life = 0.7, size = 2.2) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = sp * rand(0.3, 1);
      G.particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life, maxLife: life, color, size: size * rand(0.6, 1.2),
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
  // Game logic
  // -------------------------------------------------------------------------
  const NODE_HIT_RADIUS = 38;   // generous touch target

  const onCorrectHit = (nodeIdx) => {
    const node = G.nodes[nodeIdx];
    node.hit = true;
    node.touchedAt = performance.now();
    G.progress += 1;
    const note = TUNING[Math.min(G.progress - 1 + Math.floor(G.levelIdx / 2), TUNING.length - 1)];
    Audio.pluck(note, 0.20);
    vibrate(6);
    spawnParticles(node.x, node.y, C.star, 8, 90, 0.5, 1.6);
    if (G.progress === G.path.length) {
      onSigilComplete();
    }
  };

  const onWrongHit = (nodeIdx) => {
    const node = G.nodes[nodeIdx];
    node.errorAt = performance.now();
    G.mistakes += 1;
    G.flashAlpha = 0.45;
    G.nudge = 10;
    Audio.error();
    vibrate([10, 40, 10]);
    // reset stroke — player must lift finger and start over
    G.nodes.forEach(n => { n.hit = false; });
    G.progress = 0;
    G.touching = false;
  };

  const tryHitAt = (x, y) => {
    // returns the node index nearest within hit radius, or -1
    let best = -1, bd = NODE_HIT_RADIUS;
    for (let i = 0; i < G.nodes.length; i++) {
      const n = G.nodes[i];
      const d = dist(n.x, n.y, x, y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };

  const onSigilComplete = () => {
    G.successPhase = 1;
    G.successTimer = 0;
    Audio.bell([523.25, 659.25, 783.99, 1046.5], 0.12);
    vibrate([6, 60, 6, 60, 12]);
    // celebration: emit particles along the path
    for (let i = 0; i < G.path.length; i++) {
      const n = G.nodes[G.path[i]];
      setTimeout(() => spawnParticles(n.x, n.y, C.warm, 14, 130, 0.7, 2.4), i * 60);
    }
    // persist
    store.sigilsTraced += 1;
    if (G.mistakes === 0) G.perfectStreak += 1; else G.perfectStreak = 0;
    if (G.perfectStreak > (store.bestPerfect || 0)) store.bestPerfect = G.perfectStreak;
    // Unlock the message line for this level
    const lineIdx = G.levelIdx;
    if (lineIdx < TOTAL_LINES && !store.recoveredLines.includes(lineIdx)) {
      store.recoveredLines.push(lineIdx);
      store.recoveredLines.sort((a, b) => a - b);
      if (store.recoveredLines.length >= TOTAL_LINES && !store.complete) {
        store.complete = true;
      }
    }
    // Advance the persistent cursor
    store.nextLevel = Math.min(LEVELS.length - 1, Math.max(store.nextLevel, G.levelIdx + 1));
    saveStore();
  };

  const onTimeUp = () => {
    if (G.successPhase !== 0) return;
    state = STATE.FAILED;
    Audio.tone(80, 0.6, 'sine', 0.28, 0.001);
    vibrate([12, 80, 12]);
    showScreens({ failed: true });
    document.getElementById('fail-msg').textContent =
      'the signal slipped. trace it again.';
    document.getElementById('fail-level').textContent =
      `LEVEL ${String(G.levelIdx + 1).padStart(2, '0')}`;
  };

  // -------------------------------------------------------------------------
  // Update / advance
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
    // hint fade
    if (G.hintFade > 0) {
      const fadeStart = G.hintFade;
      G.hintAlpha = clamp(1 - Math.max(0, G.elapsed - fadeStart) / 2.5, 0, 1);
    }
    // flash and nudge decay
    G.flashAlpha *= Math.pow(0.001, dt);
    G.nudge *= Math.pow(0.0008, dt);
    if (G.nudge < 0.1) G.nudge = 0;
    // celebration
    if (G.successPhase === 1) {
      G.successTimer += dt;
      if (G.successTimer > 1.8) {
        G.successPhase = 2;
        // Show success overlay
        showSuccessOverlay();
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
      const size = 0.4 + s.z * 1.0;
      ctx.fillRect(s.x, s.y, size, size);
    }
    ctx.globalAlpha = 1;
  };

  const drawHintPath = () => {
    if (G.hintAlpha < 0.001) return;
    if (!G.path.length) return;
    const a = G.hintAlpha;
    ctx.save();
    ctx.strokeStyle = `rgba(90, 240, 255, ${0.18 * a})`;
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
    // Arrow at start to indicate beginning
    const first = G.nodes[G.path[0]];
    ctx.fillStyle = `rgba(90, 240, 255, ${0.4 * a})`;
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
    // Active stroke from last hit to finger
    if (G.touching && G.progress > 0 && G.progress < G.path.length) {
      const a = G.nodes[G.path[G.progress - 1]];
      ctx.strokeStyle = 'rgba(255, 245, 216, 0.65)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(G.fingerX, G.fingerY);
      ctx.stroke();
    }
    ctx.restore();
  };

  const drawNodes = () => {
    const now = performance.now();
    const nextRequired = G.progress < G.path.length ? G.path[G.progress] : -1;
    for (let i = 0; i < G.nodes.length; i++) {
      const n = G.nodes[i];
      const isNext = i === nextRequired;
      const isCompleted = n.hit;
      const sinceError = n.errorAt ? (now - n.errorAt) / 1000 : Infinity;

      // halo
      const haloRadius = isNext ? 30 + Math.sin(G.elapsed * 4) * 3 : 18;
      const haloColor = isCompleted ? 'rgba(255, 216, 154, 0.45)' :
                        isNext ? 'rgba(90, 240, 255, 0.5)' :
                        sinceError < 0.6 ? `rgba(255, 90, 107, ${0.6 * (1 - sinceError / 0.6)})` :
                        'rgba(255, 245, 216, 0.18)';
      const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, haloRadius);
      grad.addColorStop(0, haloColor);
      grad.addColorStop(1, haloColor.replace(/[\d.]+\)$/, '0)'));
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(n.x, n.y, haloRadius, 0, TAU); ctx.fill();

      // core
      const coreColor = isCompleted ? C.starGlow :
                        isNext ? C.accent :
                        sinceError < 0.6 ? C.warn : C.star;
      ctx.fillStyle = coreColor;
      ctx.beginPath(); ctx.arc(n.x, n.y, isNext ? 4.5 : 3.5, 0, TAU); ctx.fill();

      // outer ring on next-required to make it unmistakable past a fingertip
      if (isNext) {
        ctx.strokeStyle = 'rgba(90, 240, 255, 0.7)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(n.x, n.y, 16 + Math.sin(G.elapsed * 4) * 1.5, 0, TAU);
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
    if (state === STATE.PLAYING || state === STATE.TUTORIAL ||
        state === STATE.COMPLETE || state === STATE.FAILED || state === STATE.PAUSED) {
      drawHintPath();
      drawCompletedPath();
      drawNodes();
      drawParticles();
    }
    drawFlash();
    ctx.restore();
  };

  // -------------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------------
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

  const onPointerDown = (e) => {
    if (e.target.closest('button, .screen:not(.subtle)')) return;
    if (!playable()) return;
    if (G.successPhase !== 0) return;
    e.preventDefault();
    Audio.resume();
    const rect = canvas.getBoundingClientRect();
    G.fingerX = e.clientX - rect.left;
    G.fingerY = e.clientY - rect.top;
    G.fingerActive = true;

    const hit = tryHitAt(G.fingerX, G.fingerY);
    if (hit === -1) return;
    if (hit === G.path[0]) {
      // valid start
      G.touching = true;
      onCorrectHit(hit);
    } else {
      // hitting any other node first is a mistake
      if (G.nodes[hit].decoy || hit !== G.path[G.progress]) {
        onWrongHit(hit);
      }
    }
  };

  const onPointerMove = (e) => {
    if (!G.fingerActive || !playable() || G.successPhase !== 0) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    G.fingerX = e.clientX - rect.left;
    G.fingerY = e.clientY - rect.top;
    if (!G.touching) return;
    const hit = tryHitAt(G.fingerX, G.fingerY);
    if (hit === -1) return;
    // Already hit nodes are inert
    if (G.nodes[hit].hit) return;
    // Correct next?
    if (G.progress < G.path.length && hit === G.path[G.progress]) {
      onCorrectHit(hit);
    } else if (G.nodes[hit].decoy || hit !== G.path[G.progress]) {
      onWrongHit(hit);
    }
  };

  const onPointerUp = (e) => {
    if (!G.fingerActive) return;
    G.fingerActive = false;
    if (G.successPhase !== 0) return;
    // If incomplete, reset for next attempt
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
    hud: document.getElementById('hud'),
  };
  const showScreens = (flags) => {
    for (const k of Object.keys(screens)) {
      screens[k].hidden = !flags[k];
    }
  };

  const updateLevelLabel = () => {
    document.getElementById('hud-level').textContent =
      `SIGIL ${String(G.levelIdx + 1).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}`;
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
      if (store.complete) sub.textContent = 'artefact whole — thank you';
      else if (rec === 0) sub.textContent = 'a sigil to redraw inside the phone';
      else if (rec < 4) sub.textContent = 'a signal is coming through';
      else if (rec < 8) sub.textContent = 'it remembers more each time';
      else sub.textContent = 'almost. almost.';
    }
    const bootTag = document.getElementById('boot-tag');
    if (bootTag) bootTag.textContent = store.complete ? 'ARTEFACT WHOLE' : 'ARTEFACT READY';

    // Begin button label reflects resume point
    const btn = document.getElementById('btn-begin');
    if (btn) {
      if (store.complete) btn.textContent = 'TRACE AGAIN';
      else if (store.nextLevel === 0 && !store.seenTutorial) btn.textContent = 'BEGIN';
      else btn.textContent = `CONTINUE · SIGIL ${String(store.nextLevel + 1).padStart(2, '0')}`;
    }
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

  // Success overlay (after tracing) — shows the decoded line
  const showSuccessOverlay = () => {
    const idx = G.levelIdx;
    const line = MESSAGE_LINES[idx];
    document.getElementById('success-num').textContent =
      `FRAGMENT ${String(idx + 1).padStart(2, '0')} / ${String(TOTAL_LINES).padStart(2, '0')}`;
    document.getElementById('success-line').textContent = line;
    document.getElementById('success-stats').textContent =
      G.mistakes === 0 ? 'TRACED CLEAN' : `${G.mistakes} mistake${G.mistakes === 1 ? '' : 's'}`;
    const nextBtn = document.getElementById('btn-success-next');
    const isLast = idx >= LEVELS.length - 1;
    nextBtn.textContent = isLast ? 'COMPLETE' : 'NEXT SIGIL';
    state = STATE.COMPLETE;
    showScreens({ success: true, hud: true });
  };

  // -------------------------------------------------------------------------
  // Tutorial — first three nodes, no decoys, hints stay
  // -------------------------------------------------------------------------
  const startTutorial = () => {
    state = STATE.TUTORIAL;
    loadLevel(0); // tutorial uses level 0 (3 nodes, no decoys)
    G.timeLimit = 0; G.timeLeft = 0;
    G.hintFade = 0;
    document.getElementById('tut-step').textContent = 'trace the sigil';
    document.getElementById('tut-hint').textContent =
      'drag your finger from the cyan star, through each white star in order';
    showScreens({ tutorial: true, hud: true });
  };

  const startLevel = (idx) => {
    state = STATE.PLAYING;
    loadLevel(idx);
    showScreens({ hud: true });
  };

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
      startLevel(store.nextLevel || 0);
    }
  });

  document.getElementById('btn-tut-skip').addEventListener('click', () => {
    store.seenTutorial = true; saveStore();
    showScreens({ hud: true });
    state = STATE.PLAYING;
  });

  document.getElementById('btn-success-next').addEventListener('click', () => {
    Audio.tick(660);
    const isLast = G.levelIdx >= LEVELS.length - 1;
    if (isLast) {
      // Returns to title
      state = STATE.TITLE;
      refreshTitleStats();
      showScreens({ title: true });
    } else {
      startLevel(G.levelIdx + 1);
    }
  });
  document.getElementById('btn-success-menu').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
  });

  document.getElementById('btn-fail-retry').addEventListener('click', () => {
    Audio.tick(440);
    startLevel(G.levelIdx);
  });
  document.getElementById('btn-fail-menu').addEventListener('click', () => {
    state = STATE.TITLE;
    refreshTitleStats();
    showScreens({ title: true });
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
    startLevel(G.levelIdx);
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
  bootSequence();
  requestAnimationFrame((t) => { last = t; loop(t); });

})();
