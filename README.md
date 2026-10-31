# KNUCKLE HUCK

An arcade snowboarding game about one thing: hitting the knuckle of a massive Big Air jump and doing something spectacular with it. Mobile-first web game (iPhone Safari + desktop), by **HaveAnApp**.

## Play

- **Touch:** drag the left side to steer (up = tuck, down = check speed; on the deck up/down = nose/tail press). Hold **POP** on the right to load, release on the blue knuckle line. In the air the stick spins (left/right) and flips (up/down), and the POP button becomes a **grab wheel** laid out like your board: nose up, tail down, toe edge left, heel edge right. Drag past the rim to tweak. Let go of everything before touchdown.
- **Keyboard:** arrows/WASD, hold & release `Space` to pop, `E` switch stance, grabs `J` indy · `U` mute · `O` melon · `P` method · `L` stalefish · `I` nose · `K` tail, `Shift` tweak, `Esc` pause, `Enter`/`R` next run.
- **Gamepad:** left stick, `A` pop; in the air `X/Y/B/A/LB/RB/LT` grab, `RT` tweak.

Modes: **Big Air Jam** (4 attempts, best two different tricks count, vs. a field of rivals), **Score Attack** (6 levels), **Trick Challenges** (12), **Free Ride**, **Daily Huck** (date-seeded setup: loaner board, wind, snow speed, bonus grab).

## Develop

```bash
npm install
npm run dev      # vite dev server
npm run build    # type-check + production build to dist/ (includes offline service worker)
```

Automated visual testing: `?bot=0|1|2` drives runs with a scripted rider.

## Architecture

Vite + TypeScript + Three.js. No image or audio assets — textures, venue, rider, sound effects and music are all generated at runtime, so the game works offline and installs to the iPhone Home Screen.

| System | File | Notes |
| --- | --- | --- |
| Course / knuckle geometry | `src/physics/course.ts` | Slope key points → integrated height profile with continuous curvature. Deck, rounded knuckle, landing, landing transition, side walls. |
| Rider physics | `src/physics/rider.ts` | Grounded carving with gravity, friction, scrub and drag; a ballistic test each step lets the convex knuckle launch you on its own; pop impulse along the surface normal scaled by charge and timing. |
| Trick controller | `src/tricks/tricks.ts` | Integrated spin/flip with arcade "commit" assist, grab chains, tweaks, late detection, switch, nollie, naming (Cab, Rodeo, Cork, Misty, Double…). |
| Scoring + Sick Meter | `src/scoring/scoring.ts` | Amplitude, Difficulty, Style, Creativity, Progression × Execution × Combo × Sick. Landing evaluation (impact, rotation error, prep, zone). |
| Run state machine | `src/game/run.ts` | One attempt: ready → ride → air → landed/crash. Produces rider transform + pose, records replay frames. Pure simulation, no rendering. |
| Orchestration / modes | `src/game/game.ts` | Fixed 120 Hz sim, events → audio/HUD/FX, sessions, persistence, replays, menu demo, adaptive quality. |
| Rider | `src/render/riderModel.ts` | Procedural puppet with 2-bone IK legs/arms; grabs move hands to real points on the board, tweaks rotate the board about the centre of mass. |
| Camera | `src/render/camera.ts` | Approach, launch, air, landing, crash, and 4 replay angles. |
| Venue | `src/render/environment.ts` | Aspen-inspired Big Air venue: terrain, dye lines, mountains, trees, start tower, fences, banners, judges tower, crowd, chairlift, snowfall. |
| Input | `src/input/input.ts` | Touch (floating stick, pop button, grab wheel), keyboard, gamepad → one state. |
| Audio | `src/audio/audio.ts` | WebAudio synthesis for snow, pops, landings, crowd; generative soundtrack; Web Speech announcer with captions. |
| UI | `src/ui/*` | HUD and screens in plain DOM/CSS. |
| Save | `src/state/save.ts` | localStorage progress, loadout, unlocks, personal bests. |

Tuning helpers: `scripts/sim.ts` and `scripts/runsim.ts` run the physics headless (`npx esbuild scripts/runsim.ts --bundle --platform=node --format=esm --outfile=/tmp/runsim.mjs && node /tmp/runsim.mjs`).
