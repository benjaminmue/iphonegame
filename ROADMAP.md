# SIGIL — design roadmap

> Living document. The architecture is data-driven: adding worlds, mechanics, or sigils is appending to data, not rewriting code.

---

## 1. Hierarchy

```
GALAXY        (e.g. REMEMBERED)
  └─ SOLAR    (12 per galaxy, e.g. HOMEKEEPER)
       └─ WORLD     (10 per solar, e.g. PRIME)
            └─ LEVEL    (20 per world)
                 └─ SIGIL   (10 per level — the playable unit)
```

**Counts at scale:**

| Tier | Per parent | Cumulative |
|---|---:|---:|
| Sigils | 10 | 10 per level |
| Levels | 20 | 200 sigils per world |
| Worlds | 10 (+1 Sun) | 2,000 sigils per solar |
| Solars | 12 (+1 Core) | 24,000 sigils per galaxy |

Procedural generation does the heavy lifting for sigils; design effort lives at the **world** and **level** tiers.

---

## 2. The five difficulty axes

Every sigil draws from five orthogonal difficulty axes. Mechanics raise one or more axes; combining mechanics raises several. This is why a "level 18" feels different from a "level 5" even with the same star count.

| Axis | What it tests | Mechanics that raise it |
|---|---|---|
| Cognitive load | how many things to track | star count, decoy count, mechanic stacking |
| Memory | what you hold in your head | hint fade, no-hint, mirror, whisper |
| Spatial reasoning | geometry comprehension | drift, mirror, branching, duplicates |
| Time pressure | speed of execution | timer, drift speed, pulse rate |
| Precision | finger-tip control | red distance, hold duration, narrow corridors |

---

## 3. The HOMEKEEPER world roadmap

Each world owns a primary mechanic. Worlds get progressively harder; the Sun synthesises everything.

| # | World | Primary mechanic | Difficulty bump |
|---|---|---|---|
| 1 | **PRIME** | basic tracing | establishes baseline |
| 2 | **DRIFT** | stars orbit — lead the trace | +spatial |
| 3 | **CROSS** | red stars trace must avoid | +precision |
| 4 | **ECHO** | hints fade rapidly | +memory |
| 5 | **MIRROR** | trace the reflected shape | +spatial, +memory |
| 6 | **HOLD** | press-and-hold each star to lock | +precision, +time |
| 7 | **PULSE** | strike on the beat | +time, +precision |
| 8 | **WHISPER** | invisible stars, single peek each | +memory |
| 9 | **FORK** | one or two stars used twice | +spatial, +cognitive |
| 10 | **ENTROPY** | everything combined, no hint | all axes max |
| ★ | **HEART OF HOMEKEEPER** | curated boss sigil | terminal |

### Per-world internal arc

A 20-level world isn't 20 versions of the same difficulty. It's:

| Levels | Phase | What happens |
|---|---|---|
| 1–3 | **Onboarding** | new mechanic shown alone, gentle parameters |
| 4–7 | **Internalising** | mechanic + 1 prior axis (e.g., +decoys) |
| 8–11 | **Variation** | mechanic parameter ramps (faster drift, more reds) |
| 12–15 | **Combination** | mechanic + 2 prior axes |
| 16–19 | **Mastery** | every prior axis active, mechanic at peak |
| 20 | **Capstone** | hardest sigil of the world, hints at next world |

---

## 4. Procedural sigil difficulty curve

Within any non-narrative level, sigils are generated from `diff = levelIdx × 10 + sigilIdx`. Same curve for every world; the world's own mechanic layers on top.

| Diff range | What enters |
|---|---|
| 0–49 | star count rises 3→7, decoys 0→2 |
| 50–69 | **time pressure** introduced (60s → 30s) |
| 70–89 | **hint fade** introduced (path disappears mid-trace) |
| 90–129 | **×2 knot** introduced — one star must be hit twice |
| 130–149 | **2× ×2 knots** — two stars each hit twice |
| 150–199 | **no hint at all** — pure deduction from star positions |

So Level 15 Sigil 5 in any world is harder than Level 8 Sigil 0 in any world, while still being qualitatively different because of the world's mechanic.

---

## 5. Galaxy roadmap (per-solar themes)

Looking past HOMEKEEPER, each solar system has a thematic focus that twists the existing mechanics:

| Solar | Theme | Twist |
|---|---|---|
| **HOMEKEEPER** | tutorial / message recovery | standard mechanics, gentle ramp |
| **DEEP CARRIER** | sub-frequency | every base value harder (faster drift, smaller red distance) |
| **1981** | retro signal | CRT scanlines visual + telegraph-rhythm pulse world |
| **FAR ECHO** | echo chamber | every sigil silently repeats — second trace must match the first |
| **OUTER** | edge of reception | larger sigils (12-15 stars), more decoys baseline |
| **MNEMOSYNE** | memory orbit | sigils chain — solving one shows part of the next |
| **LUNARIA** | a named moon | circular/orbital sigil shapes; introduces "pivot" mechanic |
| **THE QUIET** | silent reception | no audio cues; mistakes are purely visual |
| **COLD ROOM** | the waiting | slow-paced meditative; long levels (15+ sigils, no timer) |
| **HIBERNAL** | sleep cycle | wait-states required; some sigils need a literal pause |
| **NULL** | no carrier | mechanics inverted (decoys are real, real stars are decoys, etc.) |
| **ORIGIN** | terminal | every mechanic from every solar, hand-curated final levels |
| **★ CORE** | the heart of the galaxy | single 100-sigil capstone level, narrative payoff |

---

## 6. Onboarding & in-sigil hints

Two layers of player-facing info:

**Per-sigil tip strip** (always shown for ~2.5s on sigil start):
```
5 stars · 2 decoys · ×2 knot · 38s
```
A compact summary so the player knows what they're walking into. Auto-fades.

**First-time mechanic intro** (full-screen, once ever):
```
DRIFT

stars orbit now.
wait for them. lead your trace.

[got it]
```
Persisted in `localStorage`. Each new mechanic shows its intro the first time it appears.

---

## 7. Implementation status

| Mechanic | Status | Notes |
|---|---|---|
| Basic tracing | ✓ shipped | working everywhere |
| Decoys | ✓ shipped | |
| Hint fade | ✓ shipped | |
| Time pressure | ✓ shipped | |
| Drift (moving stars) | ✓ engine + flag | needs procedural enabling |
| Red stars | ✓ engine + flag | needs procedural enabling |
| Red drift | ✓ engine + flag | |
| **×2 knot (duplicate use)** | ✓ this commit | |
| **No-hint** | ✓ this commit | |
| **Per-sigil tip** | ✓ this commit | |
| **First-time mechanic intro** | ✓ this commit | |
| Mirror | → next | reflected target shape |
| Hold | → next | hold duration per star |
| Pulse | → next | beat-timed taps |
| Whisper | → next | invisible stars + peek |
| Inverted | future | NULL world theme |
| Echo chain | future | FAR ECHO sigil-pair system |

---

## 8. Authoring future content

Adding a world: append an entry to `GALAXY.systems[N].worlds[]` with `id`, `name`, `kicker`, `orbit`, `mechanic`, `requires`. Set the world's `id` as a key in `WORLD_MECHANIC` with flags like `{ drift: true, red: true }`. No code changes needed for sigil generation — the procedural curve picks it up automatically.

Adding a *narrative* level: extend `STORY_LEVELS` and tie sigil indices to message-line indices in `MESSAGE_LINES`. The PRIME LEVEL 01 hook already supports this for the first 10; expand the special case to support PRIME LEVEL 02 narrative, etc.

Adding a new mechanic: extend `getSigilCfg` to set the new flag based on `diff`, then extend `generateLevel` and the renderer + input handlers. Register the mechanic in `MECHANIC_INTROS` to surface its first-time intro.
