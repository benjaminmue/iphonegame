# ORBITAL

> _You are not the comet. You are the gravity._

A meditative arcade game built for iPhone Safari. Touch and hold anywhere on the screen to bend a luminous comet through glowing gates while avoiding drifting asteroids. Each gate sings a note. A perfect run plays a song.

---

## Concept

- **Title:** ORBITAL
- **Core idea:** Inverted control. Your finger is a gravity well, not the ship. You shepherd a comet through procedural space using only physics intuition.
- **Controls:** Touch and hold anywhere — gravity follows your finger. Lift to release. Multi-touch creates multiple gravity fields for advanced steering. Quick tap creates a short repulsive pulse to push the comet away.
- **Objective:** Thread the comet through as many gates as possible without colliding with an asteroid. Build combos. Collect stars. Set a high score.
- **Why it is unusual:**
  - You do not move the player object directly — you sculpt the field it lives in.
  - Audio is generative: every gate emits a pentatonic tone, so skilled play produces music.
  - Gravity is a resource the player must learn to spend sparingly to score "elegance" bonuses.
  - It uses multi-touch in a way most arcade games do not.

---

## How to play

1. Open `index.html` in mobile Safari on your iPhone (or any modern browser).
2. Tap **Begin**.
3. The built-in onboarding teaches you in three short steps:
   - **Pull** — touch and hold to attract the comet.
   - **Push** — quick tap to repel.
   - **Thread** — guide the comet through a gate.
4. Once the run starts, gates spawn endlessly. Pass three in a row to enter **Resonance**, a brief slow-motion bonus state where every gate is worth double.
5. Hitting an asteroid ends the run.

---

## Run it locally

No build step. No backend. No dependencies.

```bash
# from the repo root
python3 -m http.server 8080
# then visit http://<your-mac-ip>:8080 on your iPhone (same Wi-Fi)
```

Or just open `index.html` directly in your browser. Audio will start on first tap because iOS requires a user gesture.

For best results, **Add to Home Screen** on iPhone — it runs full-screen with safe-area support.

---

## Files

- `index.html` — markup, overlays, safe-area aware layout
- `styles.css` — dark UI, minimal premium aesthetic
- `game.js` — render loop, physics, procedural audio, state machine
- `README.md` — you are here

---

## The artefact feel

ORBITAL is intentionally framed as a small piece of strange firmware living inside the phone. That's not just dressing — it's wired into the design:

- A short "calibration" boot sequence runs on launch (TUNING → LINKING → ARTEFACT READY).
- Faint recovered-transmission glyphs drift across the screen during play.
- Silence is part of the soundtrack. The world hums quietly; music is only produced by the player's own threads.
- Earning **Resonance** shifts the colour spectrum and engages slow time, with a haptic pulse.
- Subtle vibrations punctuate gates, push pulses, and run-end.
- Optional tilt parallax: enable in the title and the starfield drifts as you tilt the device, as if you're looking into a small aquarium inside the glass.

## Notes

- Pure HTML / CSS / JS. Works fully offline / from a static server. No build step. No dependencies.
- Targets 60 FPS on iPhone Safari via canvas 2D with devicePixelRatio scaling.
- Respects `prefers-reduced-motion` (reduced effect intensity, no drifting fragments).
- Persists best score, total gates threaded, runs, audio and tilt preferences in `localStorage`.
- Generative audio via Web Audio API (oscillators + filtered noise, no external sound files).
- Optional haptics on supported devices via `navigator.vibrate`.
- Multi-touch: each finger is its own gravity well. Try two thumbs once you're confident.

### Limitations

- Web Audio on iOS requires a user gesture; first tap on **Begin** unlocks audio.
- DeviceOrientation on iOS 13+ requires explicit permission — the title screen's **tilt: on** toggle requests it. Tilt is decorative (parallax) only; it never controls the comet.
- Disabling tilt zeroes the parallax but does not remove the listener for the session (no-op next reload).

### Possible next improvements

- Daily seed mode for shared procedural runs.
- Unlockable comet trails earned by milestone (e.g. 50 / 250 / 1000 gates).
- A boss-rare-event: a passing rogue planet that bends spacetime around it.
- Co-op two-player on one phone (each player controls one gravity well).
