# SIGIL

> _A sigil to redraw, inside the phone._

A tracing game for iPhone Safari. Stars are scattered on a dark field; a faint sigil shows the order to connect them. Drag your finger from star to star to redraw the sigil. Ten correctly traced sigils recover ten fragments of the artefact's message.

This is the second iteration of this project. The first was a gravity / comet game called ORBITAL — it was abandoned because finger-on-screen occlusion made fast-moving targets unreadable on a phone. SIGIL is built so that no target you need to see is ever under your finger.

---

## Concept

- **Title:** SIGIL
- **Core idea:** Redraw the artefact's broken sigils. Each sigil is a hidden order through a field of stars. You retrace it by dragging.
- **Why this works on a phone screen:**
  - All targets are **static** and **widely spaced** (≥90 px). Your finger never has to chase.
  - The **next required star** is always larger and brighter than a fingertip, with a halo that extends beyond your finger.
  - The whole game is **one continuous drag**. Your finger's position *is* the action — you're not trying to *also* see something *under* your finger.
- **Controls:** Touch the cyan star to start; drag through each white star in order. Touch a decoy or hit the wrong star and the stroke resets — lift your finger and try again.
- **Objective:** Trace ten sigils. Each one decodes one of ten lines of the artefact's message. Read the message.

---

## What's in the loop

- **Notes:** Each star plays a pentatonic tone when struck. The order of stars is the order of notes — a clean sigil literally plays a melody.
- **Hints:** From sigil four, the dashed hint path fades out a few seconds in. You must remember the shape before it dims.
- **Decoys:** From sigil three, extra stars appear that look identical. Touching one resets your stroke and adds a mistake to your record.
- **Time pressure:** From sigil six, a timer ticks down. Run out and the sigil fails — but the run is just one sigil at a time; retry is one button away.
- **Persistence:** Decoded fragments are saved in `localStorage`. Quit and come back — the title screen still reads `RECOVERED 4 / 10` and the next sigil is queued.
- **Completion:** All ten decoded triggers a soft fanfare and the title permanently reads `ARTEFACT WHOLE`.

---

## How to run

No build step. No backend. No dependencies. Pure HTML/CSS/JS.

```bash
# from the repo root
python3 -m http.server 8080
# then visit http://<your-mac-ip>:8080 on your iPhone (same Wi-Fi)
```

Or deploy via GitHub Pages — open the URL in Safari on iPhone, **Add to Home Screen** for the full-screen safe-area experience.

---

## Files

- `index.html` — markup, screens, safe-area aware HUD
- `styles.css` — dark minimal UI
- `game.js` — engine, level generation, audio synthesis, state machine
- `README.md` — you are here

---

## Notes

- 60 FPS on iPhone Safari via canvas 2D with devicePixelRatio scaling.
- Respects `prefers-reduced-motion` (reduced star count, no scanline animation).
- Persists progress, mistakes streak, audio preference, tutorial flag in `localStorage`.
- Generative audio via Web Audio API. No external sound files.
- Optional haptics on supported devices via `navigator.vibrate`.

### Limitations

- Web Audio on iOS requires a user gesture; first tap on **Begin** unlocks audio.
- DeviceOrientation is not used — the game is intentionally one-thumb, touch only.

### Possible next improvements

- Daily seeded sigils for a shared "today's puzzle" feel.
- A speedrun mode unlocked after completion: all ten sigils back-to-back, scored by total time.
- Optional reverse-order sigils — trace the path *from end to start*.
- Two-finger sigils for the last three levels, requiring two simultaneous strokes.
