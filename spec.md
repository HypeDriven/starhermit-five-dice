# Five Dice — Game Design Document (running spec)

Present tense: this document describes what the shipped game does today. Anything the design wants but the code does not yet do is listed only under "Design intent not yet implemented" at the end.

## 1. Overview

**Pitch.** A cozy mountain-lodge dice table: roll five wooden dice up to three times, hold the keepers, fill one of thirteen lodge-flavoured scoring rows per turn, and take the table with the highest grand total.

| | |
|---|---|
| Genre | Turn-based dice / scorecard game (classic five-dice math, original names and setting) |
| Players | 1–4 seats per table: solo target climbs, 1 human vs 1–3 lodge AI, or two humans pass-and-play on one screen |
| Session | 13 rounds per player; ~4–6 min vs one AI, ~8 min four-handed; a Learn lesson ~3 min |
| Platforms | Desktop and mobile browsers (portrait and landscape), keyboard, mouse, touch, gamepad |
| Rendering | Three.js r160 (vendored) lodge scene on a `<canvas>`, mirrored 1:1 by a semantic HTML shell; the game is fully playable with WebGL unavailable |
| Persistence | `localStorage` (guest-first), optional same-origin `/api/v1` host routes served by `server.js` |

### File map

| Path | Responsibility |
|---|---|
| `index.html` | Shell: top bar, left scorecard rail, centre stage (canvas, lesson banner, countdown, dice tray, action tray), right table rail, drawer toggles, overlay root, toast, live regions |
| `css/style.css` | Responsive layout, theme CSS variables, safe-area insets, drawers, overlays, results art, narrow-phone rules |
| `js/main.js` | Bootstrap: platform handshake, module wiring, renderer with compatibility fallback, event routing, countdown, AI pacing, clock ticker, canvas tap picking, lifecycle (visibility, pagehide, resize), `window.__fivedice` harness |
| `js/rules.js` | Pure deterministic rules engine: categories, scoring, legality, `applyCommand`, rankings, hashing, replay, serialization |
| `js/ai.js` | Deterministic practice AI (`ember`, `hearth`, `summit`) using the rules legality API |
| `js/content.js` | Versioned content: 5 themes, 4 lessons, 40 journey stages, 5 challenges, daily table, practice factory, offline validators |
| `js/session.js` | Session controller: state machine, validated dispatch, undo snapshots, lesson gating, session clock, autosave, replay envelope, results record |
| `js/platform.js` | Local persistence, host detection, `/api/v1` adapter, progress document + checksum, achievements, leaderboards, presence, telemetry |
| `js/render.js` | Three.js scene: felt table, room, window with stars, fireplace glow and embers, five dice with pip textures, held-row markers, camera presets, quality tiers, context-loss rebuild |
| `js/audio.js` | WebAudio engine: four buses, authored Opus one-shots with synth fallbacks, hearth ambience loop, generative fireside music, captions |
| `js/ui.js` | DOM shell: title/menus/help/settings/profile/pause/results overlays, HUD (scorecard, dice tray, action tray, table rail), keyboard + gamepad, live announcements |
| `server.js` | Static host + authoritative `/api/v1` routes (time, save, presence, activity, events, leaderboard read/submit with replay validation) |
| `sfx/` | 22 Opus clips; `manifest.txt` (canonical event binding), `manifest.json` (generator input), `manifest.md` (generator output) |
| `assets/` | `key-art.webp` (title backdrop), `results-win.webp`, `results-lose.webp` |
| `coverart.png`, `icon.png`, `favicon.svg` | Store cover (1200×675), 256 px icon, SVG favicon |
| `vendor/three.module.js` | Three.js r160 |
| `tests/run.js`, `tests/e2e.mjs` | 36 unit/property/golden/server tests; Playwright playthrough at desktop and mobile viewports |
| `tests/smoke.html`, `tests/smoke-driver.js` | Manual in-browser smoke driver (not part of `npm test`) |
| `data/` | Runtime JSON stores written by `server.js` (`leaderboard.json`, `saves.json`); git-ignored, never served |
| `starhermit.txt` | `name=Five Dice`, `launch=index.html`, `owner=…`, `server=server.js`, `cover=coverart.png` |

## 2. Vision and design pillars

1. **The table is the whole world.** One round felt table, one fireplace, one window. Everything the player needs — dice, card, whose turn — is on or beside the table; there is no map, inventory or meta-screen during play. Rules in: the scorecard as a permanent rail, previews on every open row. Rules out: modal pop-ups during a turn, hidden information, animated distractions on the felt.
2. **Every roll is honest and inspectable.** Dice come from a seeded rules stream (`hashSeed(seed + ':rules')` in `rules.js`), every command is logged, and a finished table can be replayed to the same hash on the client and the server. Rules in: seeds shown as shared dailies, hints that use the exact legality API. Rules out: rerolls the player did not ask for, cosmetic randomness touching outcomes, client-trusted scores on a leaderboard.
3. **Three rolls, one decision.** The whole skill of the game is the hold/reroll decision and the sacrifice choice when nothing scores. Rules in: zero-point sacrifices as first-class actions, a Full-Lodge/straight tier of feedback above plain points, an upper-bonus meter. Rules out: extra dice, power-ups, bonus rolls purchased or earned.
4. **Warm, unhurried, never punishing.** The AI opponents are named lodge guests, losing reads as "the lodge keeps its crown", and the fire keeps burning. Rules in: undo on practice/journey tables, generous pacing (650 ms per AI batch), captions for every meaningful cue. Rules out: streak loss, timers outside the explicitly named Blizzard Clock challenge, ads or purchases.
5. **The HTML is the game; the 3D is the mood.** Every interactive element exists as a DOM control; the canvas adds atmosphere and a second way to tap a die. Rules in: full keyboard, gamepad and screen-reader paths, a compatibility panel when WebGL fails. Rules out: any action that only exists on the canvas.

## 3. Player experience

**Target player.** Someone who knows or can learn a five-dice scorecard in one game, plays in 5-minute sittings on a phone or a laptop, and enjoys a slow-burn mastery curve (upper bonus pace, sacrifice order) without competitive pressure unless they seek it in Daily or Challenges.

**First 60 seconds.** The title overlay states the rules in one sentence and puts *Practice* first (or *Resume Table* when an autosave exists). Practice → *Ember* starts a 3-2-1 countdown (`main.js:runCountdown`), then the status line reads "You to act · rolls left 3", the only enabled control is the amber **Roll (3)** button, and all thirteen rows on the card show "·". After the first roll every open row previews its points in green with a ◆ marker, the dice buttons become pressable, and the toast/announcer explains any illegal action ("Roll the dice first.", "No rolls left — choose a category to score."). *Learn* offers four lessons that gate the player to exactly one action at a time with a banner (`session.js:lessonGate`); the Help overlay lists every row with its rule and every key binding. There is no forced tutorial.

**Session shape.** Countdown → 13 alternating turns (AI turns play out at 650 ms per command batch, visibly holding and rerolling) → results overlay with a per-player Upper/Bonus/Lower/Total breakdown, par, newly unlocked achievements and a recommended next action (next journey stage, play again, back to title). Backgrounding pauses solo play and autosaves; the title offers *Resume Table* on return.

**Emotional beat.** The pause before the third roll with two dice held and Summit Trail open — and the "hand made" xylophone cue when it lands. The secondary beat is crossing 63 upper points and hearing the lodge-bonus bell.

## 4. Core loop and rules contract

All rules live in `js/rules.js`; nothing else mutates rules state (session, AI and server all call `applyCommand`).

### Entities

- **Table state** (`createGame`): `seed`, `mode`, `rng` (mulberry32 state seeded from `hashSeed(seed + ':rules')`), `tick`, `nextCmdId`, `status` (`active | finished | aborted`), `terminalReason`, `clock` (authoritative ms), `round`, `current` seat, `rollsLeft`, `dice[5]`, `held[5]`, `hasRolled`, `rollsPerTurn` (1–5, default 3), `disabledCategories`, `goal` (`win` or `score:target`), `limits.totalMs`, `par.score`, `mechanics`, `players[]`.
- **Player**: `name` (≤24 chars), `isAI`, `difficulty`, `scores` (category id → integer or `null`), `invalid` count, `elapsedMs`.
- **Categories** (`CATEGORIES`): six upper rows and seven lower hands.

| Row | Section | Rule | Points |
|---|---|---|---|
| Kindling / Embers / Flames / Timbers / Beams / Peaks | upper | total of 1s / 2s / 3s / 4s / 5s / 6s | face × count |
| Triple Hearth | lower | three of a kind | sum of all dice |
| Grand Hearth | lower | four of a kind | sum of all dice |
| Full Lodge | lower | three of one face + two of another | 25 |
| Ridge Path | lower | run of four distinct consecutive faces | 30 |
| Summit Trail | lower | run of five | 40 |
| Avalanche | lower | five of a kind | 50 |
| Open Snow | lower | any dice | sum of all dice |

Upper bonus (`totalsBreakdown`): upper sum ≥ 63 adds 35. Grand = upper + bonus + lower.

**Worked example.** Dice `3 3 3 5 5`: Flames 9, Beams 10, Triple Hearth 19, Full Lodge 25, Open Snow 19, Grand Hearth 0, Ridge Path 0 (longest run is 1), Summit Trail 0, Avalanche 0, other upper rows 0. Scoring Full Lodge writes 25 into that row; a card holding three of every face upstairs (3+6+9+12+15+18 = 63) earns the bonus, so 63 + 35 + 25 = 123 so far.

### Commands and resolution order (`applyCommand`)

Every command carries `{ id, at, type }`. Validation order: malformed → `bad-command-id` → `id < nextCmdId` rejected as `duplicate-command` (idempotent) → `id > nextCmdId` rejected `out-of-order-command` → state cloned, `tick += 1`, `clock = max(clock, at)` → `round-over` if not active → **time limit** (`clock > limits.totalMs` finishes with `time-limit` before the command is looked at) → the command:

- `roll`: requires `rollsLeft > 0`, otherwise records an *invalid* (`no-rolls-left`, `player.invalid += 1`) and returns without error. Rerolls every unheld die from the rules stream, `rollsLeft -= 1`, `hasRolled = true`, emits `roll { dice, rolled, rollsLeft }`.
- `hold { index }`: index outside 0–4 is an error (`out-of-bounds`); holding before the first roll or after the last records an invalid (`must-roll-first` / `no-rolls-left`); otherwise toggles `held[index]` and emits `hold { index, held }`.
- `score { category }` (`checkScore`): unknown category is an error; disabled row, not yet rolled, or already-filled row records an invalid (`category-disabled`, `must-roll-first`, `category-closed`). Legal scores write `scoreCategory(dice, category)`, add turn time to `elapsedMs`, emit `score { points, dice, breakdown }`, then either finish (`cards-complete`, when every seat's card is full) or `advanceTurn` (next seat; `round += 1` when seat 0 comes back around; dice cleared, holds cleared, `rollsLeft = rollsPerTurn`) with a `turn` event.
- `giveUp`: finishes with `gave-up`; status becomes `aborted`.
- `note`: heartbeat that only advances the clock (and so can trigger the time limit); sent once a second by `main.js:startClockTicker` on time-limited tables only.

A turn is therefore: roll (mandatory) → optional holds and up to two more rolls → exactly one score. The engine never auto-scores; with zero rolls left the only legal action is scoring (`listLegalActions().mustScore`).

### Terminal states, winners, tie-breaks

- `finished/cards-complete`, `finished/time-limit`, `aborted/gave-up`.
- `rankPlayers`: grand total desc → upper bonus desc → fewer invalid actions → lower `elapsedMs` → lower seat index.
- `playerWon(state, seat)`: false unless `status === 'finished'`; `score` goals check `grand ≥ target` for that seat alone; `win` goals check `rankPlayers()[0]`. A forfeit never wins.
- Leaderboard order (`compareResults`): won → lost → other, then grand desc, invalid asc, elapsed asc, session id.

### RNG, hints, undo

- Rules RNG is the only stream that affects outcomes. Decoration (`decor:*`), audio variants (`audio-variants`) and AI choice streams (`ai:<difficulty>:<tick>:<stateHash>`) are separate `createStream` instances.
- `getHint` (Hint button / H): "roll" before the first roll; otherwise the best-paying open row, except that with rolls left it recommends rerolling (with `suggestHolds`: keep the most frequent face, or one of each face when a 4-run exists and a straight is open) when the best row pays 0, or pays under 10 while more than six rows remain open.
- Undo (`session.js:undo`) restores the snapshot taken at the start of the current human turn, truncates the command log and checkpoints, and is available only when `def.assists.undo` is true and at least one command has been played this turn. AI turns are never undone.
- `serialize`/`deserialize` (with a migration table keyed by `v`), `hashState` (FNV-1a over every authoritative field) and `replay(envelope)` give identical hashes for identical `(rules version, seed, commands)`.

## 5. Modes and progression

| Mode (title menu) | Definition | Seats | Assists | Ranked | Notes |
|---|---|---|---|---|---|
| Practice | `practiceDef` | You vs Pip (Ember), Bram (Hearth) or Halla (Summit); or "Two players, one screen" pass-and-play (2 humans, no AI) | undo + hints | no | seed `practice:<difficulty>:<time>`; solo tables (none exposed in UI) use a 200-point goal |
| Daily Table | `dailyForDate(serverNow)` | You vs Pip (Sat/Sun, ember), Bram (Mon–Wed, hearth) or Polaris (Thu/Fri, summit) | none | yes | seed `daily:<UTC yyyy-mm-dd>`; par 170; title shows today's date and your best once played |
| Journey | `JOURNEY` (40 stages) | see below | undo except mastery; hints | no | sequential unlock: a stage is playable once every earlier stage is done |
| Learn | `LESSONS` (4) | You vs Lodge Guide (ember; hearth in lesson 4) | undo + hints | no | starts in `tutorial` state, no countdown |
| Challenges | `CHALLENGES` (5) | varies | varies | yes | constrained tables |

**Journey.** Five trails × eight stages, each trail with its own theme: Trail of Sparks (hearth theme, ember AI), Emberwalk (ember-night, hearth AI), Timberline (pinewood, hearth AI), Frost Ridge (frostfall, summit AI), Summit of Lights (starlit, summit AI). Stage 3 and 6 of each trail are solo target climbs (`target = 140 + 25·trail + 10·step`); stage 8 is a mastery stage (undo off; two opponents from Timberline on; only two rolls per turn on Frost Ridge and Summit of Lights). Summit of Lights stages 5–7 close Open Snow. Par is `150 + 20·trail + 5·step`. A won stage records `done`, best score and stars (3 with zero invalid actions, otherwise 2).

**Challenges.** Two-Roll Table (2 rolls, vs Flint), Blizzard Clock (six-minute table clock, vs Skadi), Lone Summit (solo, reach 240), No Safe Snow (Open Snow closed, vs Polaris), Cabin Council (four-handed vs Nova, Vega, Mira). All ranked; undo off everywhere, hints only on Blizzard Clock and Lone Summit.

**Difficulty curve.** AI strength is the main dial: `ember` settles early and holds impulsively; `hearth` holds toward the best face, chases 4-runs and scores at par+4; `summit` also chases 3-runs, values fixed-point hands and stops at par+2 (`ai.js:shouldScoreNow`, `planHolds`, `SACRIFICE_ORDER`). Content layers two rolls, closed Open Snow, target scores, extra opponents and the clock one at a time along the journey. There are no unlockable cosmetics; themes are free in Settings.

## 6. Controls and interaction

| Action | Desktop | Touch | Gamepad | Feedback |
|---|---|---|---|---|
| Roll | **R** or Roll button (action tray, right rail) | tap Roll | X (button 2) | dice tumble 620–780 ms, `dice-roll` clip, 12 ms haptic, status line updates |
| Hold / release die *n* | **1–5**, or ←/→ to focus a die then Enter/Space, or click the die on the canvas | tap the die button or the 3D die (tap = <12 px, <500 ms) | D-pad ◀▶ (14/15) to focus, A (0) to toggle | button lifts 8 px with a HELD caption; 3D die rises 0.55 units onto the marker strip; `die-hold` / `die-release` |
| Score a row | click a green ◆ row on the card | open the *Card* drawer, tap the row | — (rows are focusable buttons; confirm with Enter) | row closes, `score-*` clip, 30 ms haptic, announcer "You scored 25 on Full Lodge" |
| Hint | **H** or Hint | tap Hint | Y (3) | toast + `hint-chime`; disabled where the content forbids hints |
| Undo turn | **U** or Undo turn | tap Undo turn | B (1) during play | table restored to the turn start, `undo-sweep`, toast "Turn restored" |
| Pause / resume | **Esc** or the ‖ top-bar button | tap ‖ | Start (9) | Paused overlay (Resume, Settings, Help, Leave table) |
| Camera preset | **C** | Settings → Camera | — | 900 ms authored camera move (instant under reduced motion) |
| Close overlay | Esc, ✕, or tap outside (dismissible overlays only) | same | B (1) | focus returns to the element that opened it |

Bindings are `DEFAULT_BINDINGS` in `ui.js`, overridable through `settings.bindings` (no UI for remapping yet). Keyboard shortcuts are ignored while an overlay is open or while typing in an input; Esc blurs inputs.

**Input locking.** Play inputs are guarded by `session.isHumanTurn()` (active/tutorial machine state, current seat human, table active). The AI's turns, the countdown, pause and results all disable the Roll and die buttons; the DOM disables them (`disabled` attribute), the canvas path returns `not-your-turn` and toasts "Wait for your turn." Lesson gates block any action other than the required one and toast the lesson text. There is no animation lock: a roll can be scored while the dice are still tumbling and the tween settles to the exact final orientation. Duplicate commits are prevented by command ids, not debounce timers.

**Hold-to-confirm.** With *Hold to confirm scoring* on, scoring opens a Yes/Cancel confirm overlay.

## 7. Screens and UI flow

`session.machine` (`session.js:MACHINE_STATES`) is the authoritative state; the UI layers overlays on top of it.

```
boot ──(startRound)──▶ countdown ──(3·700 ms or reduced motion)──▶ active ◀──▶ paused
                    └─(learn mode)─▶ tutorial ◀────────────────────────────────┘
active/tutorial ──(terminal command)──▶ resolving ──(1400 ms / 200 ms)──▶ results ──▶ progression
restoreSnapshot ──▶ paused (reason "reconnect") ──(Resume)──▶ active/tutorial
```

Title, Practice setup, Learn, Journey, Challenges, Profile & Scores, Help & Rules, Settings, Paused, Confirm and Results are `role="dialog"` overlays created by `ui.js:openOverlay`; Title and Results are not dismissible, the rest close with ✕/Esc/backdrop. `title`, `profile-ready`, `mode-select`, `preparing` and `reconnecting` are declared machine states that the current UI never enters (the machine stays in `boot` until the first table and in `progression` after results).

**Desktop (≥1024 px).** Three-column grid: scorecard rail `minmax(240px, 320px)` · stage · table rail `minmax(220px, 300px)`. The stage holds the canvas, the lesson banner (top centre), the countdown numeral, the dice tray (bottom centre) and the action tray above it; the right rail repeats the actions as a vertical stack with Pause and Leave table. Top bar: title, status line (mode · round · actor · rolls left · ⏱ remaining on timed tables), Pause, Help, Settings.

**Compact / portrait mobile (<1024 px).** Rails become off-canvas drawers (`min(85vw, 320px)`) opened by the *Card* and *Table* buttons at the top corners (z-index 8, above the open rail so they stay tappable). The dice tray sits `8.2rem + safe-area` above the bottom; the action tray wraps below it with 52 px-tall Roll/Hint/Undo; Pause and Leave table are hidden from the tray (reachable from the top bar and the Paused overlay). The toast sits 7 rem from the bottom so it never covers the trays.

**Landscape mobile.** The dice tray becomes a vertical column on the right edge; the action tray sits along the bottom.

**Safe areas.** `env(safe-area-inset-*)` pads the top bar, drawer toggles, trays, lesson banner and toast; `viewport-fit=cover` is set. Overlays are `min(94vw, 40rem)` wide, at most `88dvh` tall and scroll internally; the results ranking table shrinks to 0.85 em with tighter cells under 480 px so all six columns fit.

**Must never be cut off.** Roll button, all five die buttons, the drawer toggles, the status line's actor/rolls text, the results grand total row, and the Resume button of the Paused overlay.

**Compatibility.** If `render.js` fails to import or `WebGLRenderer` throws, the canvas is hidden and `#compat-message` explains that the table is shown as the accessible card-and-dice panel; play continues unchanged. Boot failure writes the error into the same panel.

## 8. Art direction

**Hero.** The felt table with five cream dice, lit by a warm key light and the fireplace to the right; the lodge key art (`assets/key-art.webp`) shows the same table, window and hearth behind the title card.

**Palette.** Themes are content data (`content.js:THEMES`) applied to both the Three.js materials and the CSS variables (`--felt --wood --wall --accent --select --legal --danger --text --page`); panel colours `--panel #2c2016`, `--panel-2 #382a1c` and the die button `#f4ead8` / `#33241a` are fixed.

| Theme | felt | wood | wall | accent | die / pip | select | legal | danger | sky | text | page |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hearthglow Lodge (default) | #3e5c4b | #6b4a2f | #2e2118 | #e8a54b | #f4ead8 / #33241a | #7fc8a9 | #8fd6a0 | #d95745 | #1a2a33 | #f2e9da | #241a12 |
| Pinewood Morning | #4a6b52 | #8a6a44 | #33402e | #d98e4a | #fbf6e8 / #2e3b2a | #4f9d8f | #6fbf73 | #c0503c | #cfe0e8 | #243020 | #eef0e4 |
| Frostfall Cabin | #3a4d6b | #5c4632 | #1c2431 | #8fb8e8 | #eef2f8 / #22304a | #9ac8f0 | #7fd6c2 | #e06a5a | #0e1520 | #e4ecf6 | #161e2a |
| Starlit Refuge | #463a63 | #4a3626 | #1d1626 | #c9a0e8 | #f2ecf8 / #352347 | #b08fe0 | #8fd6a0 | #e06a7a | #0c0916 | #ece4f6 | #1a1424 |
| Ember Night | #5c3a3a | #3c2a20 | #18100c | #f0764a | #f8efe2 / #402014 | #f0a35e | #a0d690 | #e0483c | #0a0605 | #f6e8dc | #201410 |

Lights: key point light `#ffb066` (intensity 60, shadows 1024²), fire point light `#ff7733` flickering 90–100 %, hemisphere fill `#bcd0e8` / `#2a2018`; ACES filmic tone mapping at exposure 1.05, sRGB output.

**Shape language.** Round table (cylinder felt, torus rim, pedestal), cubes with circular pips (canvas textures, 128 px, larger single pip), ring markers under held dice, a translucent held-row strip at the back of the table. Rectangular window with a deterministic 60-star scatter; a soft fireplace glow plane. Everything is procedural geometry; no texture files.

**Typography.** System sans (`"Segoe UI", system-ui, …`), 1 rem base (1.18 rem with *Larger text*), tabular numerals on every score, accent-coloured headings, 70 ch max line length in overlays.

**Motion.** Authored, interruptible tweens with absolute targets: roll 620 ms + up to 160 ms per die with an arc and a spin quaternion; hold lift/settle 180 ms; camera preset 900 ms ease-in-out; ember drift and fire flicker as bounded ambient motion; drawers slide 220 ms. Under *Reduced motion* (setting or `prefers-reduced-motion`): dice snap to their end state, the countdown is skipped, AI pacing drops to 120 ms, the results delay drops to 200 ms, camera moves are instant, ember drift stops, drawer transitions are removed. Selection is never colour alone: held dice lift, show a ring marker, a HELD caption and `aria-pressed`; legal rows show a ◆ and bold green preview.

**Visual assets called for by the design** (all shipped, see §15): title key art, results illustrations for win and loss, store cover art, icon and favicon. No hero 3D model: the dice are deliberately procedural so their faces and orientation come from rules state.

## 9. Audio direction

**Mix.** Four gain buses under a master mute: `music` (slider × 0.45), `effects` (slider), `ambience` (slider × 0.4), `voice` (slider; no sources yet). The context is created on the first click/tap (`AudioEngine.ensure`, also called by every `uiClick`), suspended while the tab is hidden. Music is a generative fireside pentatonic (C major pentatonic, one note per 1.28 s, denser and with fifths for a few seconds after each score via `excite()`, a low triangle drone every 16 steps). Ambience starts as synthesized low-passed room noise with seeded crackle pops and is replaced by the authored `ambience-hearth` loop once it decodes. Every one-shot prefers its Opus clip and falls back to a WebAudio synth voice while loading or if the file is missing; seeded pitch variants keep synth cues consistent across replays. Captions (Settings → *Captions for audio cues*) surface each meaningful cue as a "♪ …" toast.

**SFX event table** (source of `sfx/manifest.txt`; caller in `js/audio.js` unless noted).

| Event id | File | Sound | Usage |
|---|---|---|---|
| `roll` | dice-roll.opus | five wooden dice from a leather cup onto felt | every roll event (human or AI) |
| `hold` (held) | die-hold.opus | die pressed onto felt | die enters the held row |
| `hold` (released) | die-release.opus | die lifted off felt | die returns to the rolling row |
| `score` (points > 0) | score-points.opus | brass bell over a wooden knock | plain positive score |
| `score-hand` | score-hand.opus | three ascending xylophone notes, token knock | Full Lodge / Ridge Path / Summit Trail made |
| `score` (Avalanche) | score-avalanche.opus | stones and tokens cascading down a chute | five of a kind, 50 points |
| `score` (0) | score-zero.opus | dull token knock | sacrificing a row |
| `score-bonus` | score-bonus.opus | rising glockenspiel chord + bell | layered on the upper-row score that crosses 63 |
| `turn` | turn-start.opus | card sliding to a stop on felt | seat passes |
| `invalid` | invalid-move.opus | piece bumped against the table edge | any rules-recorded invalid action |
| `finish` (cards-complete) | finish-cards.opus | bells and chimes over a fire | every card full |
| `finish` (time-limit / gave-up) | finish-table.opus | descending marimba | blizzard expiry or forfeit |
| `result-win` | result-win.opus | fireside fanfare | results overlay opens, local seat won (`main.js`) |
| `result-lose` | result-lose.opus | descending marimba with wind | results overlay opens, local seat did not win (`main.js`) |
| `hint` | hint-chime.opus | single glass chime | hint delivered |
| `undo` | undo-sweep.opus | reversed felt whoosh | turn restored |
| `uiClick` | ui-click.opus | fingernail tap on a wooden button | every menu button and guarded play input |
| `countdown` | countdown-tick.opus | mallet on a wooden block | each 3-2-1 numeral (`main.js:runCountdown`) |
| `countdown-go` | countdown-go.opus | two bright bell taps | table goes active |
| `achievement` | achievement-unlock.opus | sparkling bells | first-time achievement grant (`main.js`) |
| `lesson-complete` | lesson-complete.opus | two-note glass chime | final lesson step satisfied (`ui.js`) |
| `ambience` (loop) | ambience-hearth.opus | log fire in a stone hearth, faint wind | looped on the ambience bus after unlock |

## 10. Localization

The shipped build is **English only**. `index.html` declares `lang="en"`; UI strings are literals in `js/ui.js` (menus, settings, help, results, invalid-action text), `js/content.js` (category, lesson, trail, stage and challenge names and blurbs), `js/rules.js` (category names, hint reasons) and `js/audio.js` (captions). There is no language selector and no locale detection. Layout already tolerates ~30 % expansion: menu rows wrap their sub-labels, scorecard names use `overflow-wrap: anywhere`, overlays scroll. Shipping en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR and it-IT is listed under design intent.

## 11. Accessibility

- **Keyboard-only path.** Skip link to the action tray; every control is a native `<button>`, `<input>` or `<select>`; 1–5/R/H/U/Esc/C shortcuts; ←/→ move focus across enabled dice; overlays focus their first control and restore focus on close (`openOverlay`/`closeOverlay`); no focus traps (Tab order is native inside overlays).
- **Screen reader.** Polite live region for turn/score/hint/lesson text, assertive region for invalid actions and the results verdict; dice buttons expose "Die 3, showing 5, held. Activate to release" and `aria-pressed`; rows expose "Score Full Lodge for 25 points"; canvas is `aria-hidden`; drawers use `aria-controls`/`aria-expanded`.
- **Visual.** 44×44 px minimum targets (52 px tall tray buttons on phones), 8 px gaps, 3 px accent focus ring, *High contrast* (stronger lines, +8 % contrast, dashed outline on held dice), *Larger text*, *Left-handed controls* (swaps drawer toggles), five themes including a light one (Pinewood Morning). Colour is always paired with shape/text (◆, HELD, ▶ current player).
- **Motion and timing.** *Reduced motion* setting plus `prefers-reduced-motion`; no gameplay timer except the opt-in Blizzard Clock challenge, whose remaining time is in the status line and whose clock stops while paused.
- **Audio.** Independent sliders, master mute, captions for every cue; no audio-only information.
- **Other.** *Hold to confirm scoring*, haptics toggle, tutorial replay, telemetry opt-in.

## 12. StarHermit integration

Conventions follow https://wiki.starhermit.com/ (manifest, same-origin `/api/v1`, server script, replay-validated boards).

| Feature | Status |
|---|---|
| Manifest `starhermit.txt` | `name`, `launch=index.html`, `owner`, `server=server.js`, `cover=coverart.png` |
| Launch token | `?launch=` is read at boot and stripped from the address bar; never stored (`platform.js:readLaunchToken`) |
| Host detection / time | `GET /api/v1/time` within 2.5 s marks the session *hosted* and sets a round-trip-adjusted offset used for the daily boundary (`serverNow`) |
| Identity / profile | Local guest profile (display name ≤20 chars) in `localStorage`; no account sign-in or avatar use |
| Presence | `POST /api/v1/presence` every 30 s while hosted |
| Activity | `POST /api/v1/activity/start` at boot, `/end` on `pagehide` |
| Cloud save | Progress document (`v`, `rev`, journey, challenges, achievements, totals, streakDays, bestDaily) with a local checksum; `POST/GET /api/v1/save?game=five-dice`; higher `rev` wins, the losing copy is kept (`progress:pre-reconcile` locally, `:conflict:` key on the server) |
| Leaderboards | Daily and Challenge results submit `{ name, result, envelope }` to `/api/v1/leaderboard/submit`; the server replays the envelope with the shared rules module and rejects stale versions, unknown or altered content, impossible scores, hash or score mismatches and unfinished rounds; boards `daily:<id>` / `challenge:<id>` keep the top 100, idempotent by session id. Profile shows Daily / Challenge / Journey-wins boards (global when hosted, local results otherwise) |
| Achievements | Six static keys (`first_table`, `lodge_keeper`, `avalanche_caller`, `weekly_regular`, `mastery_stage`, `century_nights`) granted idempotently in the local progress document and toasted; not pushed to a platform achievements endpoint |
| Telemetry | Funnel events `start`, `tutorial-step`, `round-end`, `retry`, `settings-change`, `error` to `/api/v1/events`, only with the *Anonymous usage telemetry* consent and only when hosted |
| Server script | `server.js`: static host that refuses `data/`, 120 req/min/IP rate limit with `retry-after`, 256 KB payload cap, structured `{ "error": … }` responses |
| Not used | Friends, invitations, matchmaking, hosted multiplayer sessions, chat, voice, peer relay, platform achievement/leaderboard APIs beyond the game's own routes |

## 13. Technical architecture

- **Module boundaries.** `rules.js`, `ai.js`, `content.js` are pure and shared byte-for-byte by browser, tests and server. `session.js` is the only caller of `applyCommand` on the client; UI, renderer and audio consume immutable snapshots and events. `platform.js` isolates storage and network. `render.js` is loaded lazily by `main.js` and is optional.
- **Determinism and replay.** Envelope: `{ schema: 1, build, contentV, contentId, seed, init, initHash, timestampOffset, commands, checkpoints, result }`; checkpoints every 8 commands and at the terminal state; `session.verifyOwnReplay()` re-runs the log. The AI is deterministic per state hash, so a replay reproduces AI turns without storing decisions.
- **Session clock.** `nowMs()` accumulates only in `active`/`tutorial`/`resolving`; pausing or backgrounding freezes it; command `at` stamps feed the rules clock and `elapsedMs` tie-breaks.
- **Persistence.** `localStorage` keys `fivedice:settings`, `profile`, `progress`, `progress:checksum`, `results` (last 200), `autosave` (def, serialized state, commands, stats, savedAt, sessionId). Autosave on pause, hidden tab and `pagehide`; cleared when a table ends. Corrupted progress is set aside as `progress:corrupt` and replaced by a fresh document.
- **Rendering budget.** ~14 meshes, one 60-point star cloud, one ember point cloud (60/220/480 by tier), one shadow-casting light. Quality tiers cap device pixel ratio at 1 / 1.5 / 2 with 0.85 render scale on Low and shadows off on Low. The loop stops while the tab is hidden; context loss rebuilds the scene from CPU-side descriptors and re-applies the last state.
- **Performance targets.** 60 fps desktop and recent phones, 30 fps floor on Low; input acknowledgement (DOM update + click clip) within one frame; roll animation never blocks scoring.
- **Automation hooks.** `window.__fivedice = { session, platform, startContent, ui }` is read-only synchronization for tests; every test action goes through visible controls.
- **Serving.** `server.js` (default port 8000, `PORT` env) serves the tree with explicit MIME types for html/js/css/json/txt/opus/webp/png/svg/ico and blocks `data/`.

## 14. Testing and acceptance criteria

`npm test` runs `tests/run.js` (36 tests, zero dependencies): scoring per category, breakdown and bonus, legality and reasons, command id idempotency, bounds, hints, terminal states, tie-breaks, score goals, result ordering, serialization round-trip, 50 random-session replay equality, tampered-envelope detection, 2000-command fuzz, AI determinism and AI-vs-AI termination for every difficulty, content validators and launch-scope counts (40 stages, 4 lessons, 5 challenges, 5 themes), daily immutability, practice bounds, golden easy/medium/hard and interrupted-resumed replays, stream determinism, session pause/resume, undo, hint gating, autosave round-trip, and server validation (valid envelope accepted, forged/tampered rejected).

`npm run test:e2e` (`tests/e2e.mjs`, playwright-core + local Chrome, `PORT` env optional) serves the folder with stubbed `/api/v1` routes and, at 1280×800 and again in a fresh touch context at 390×844: loads, checks the status line, starts Practice → Ember, rolls, holds die 1, rerolls, scores the first legal row, pauses, toggles *Reduced motion* in Settings, resumes, plays every remaining turn through the visible Roll/die/row buttons (opening and closing the Card drawer on mobile each turn), waits for the Results overlay, checks the breakdown text and ranking rows, verifies `fivedice:progress` persisted, returns to the title, and fails on any page error or console error (GPU driver noise excepted). Screenshots land in `/tmp/five-dice-e2e-*.png`.

**QA bar (checkable).**
- First table: the title sentence and the Learn lessons explain play; the first illegal action produces a toast and an announcement.
- Every menu item, setting, overlay and play control is reachable by mouse, touch and keyboard; no console errors or warnings on load, play, pause, results, title return.
- No text or control cut off at 1280×800, 390×844 portrait and 844×390 landscape; the six results columns fit at 390 px.
- All 22 SFX clips exist, are 48 kHz mono Opus and are bound to an event that `js/audio.js` emits.
- `node --check` passes on every `.js`/`.mjs`; `npm test` and the e2e pass.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1280×720, 56 KB) | Title overlay backdrop (`.overlay-backdrop.title-backdrop`) | FLUX.2 klein, seed 8901, 1536×864, 28 steps | generated in this pass, wired |
| `assets/results-win.webp` (1024×576, 43 KB) | Results overlay illustration when the local seat wins | FLUX.2 klein, seed 8902, 28 steps | generated in this pass, wired |
| `assets/results-lose.webp` (1024×576, 30 KB) | Results overlay illustration for loss / forfeit / time-out | FLUX.2 klein, seed 8903, 28 steps | generated in this pass, wired |
| `coverart.png` (1200×675, 417 KB) | Store cover named in `starhermit.txt` | key art + ffmpeg title/tagline, 256-colour PNG | replaced in this pass |
| `icon.png` (256×256), `favicon.svg` | Icon and favicon | authored earlier | shipped |
| `sfx/dice-roll … ui-click` (13 clips) | Rules/UI cues | MOSS-SoundEffect v2, 100 steps | shipped |
| `sfx/countdown-tick, countdown-go, score-bonus, score-hand, result-win, result-lose, achievement-unlock, lesson-complete` | New presentation cues | MOSS-SoundEffect v2, 100 steps | generated in this pass, wired with synth fallbacks |
| `sfx/ambience-hearth.opus` (12 s loop) | Hearth ambience | MOSS-SoundEffect v2, 100 steps | generated in this pass, wired (synth fallback retained) |
| `sfx/manifest.txt` / `manifest.json` / `manifest.md` | Canonical binding / generator input / generator output | — | in sync, 22 entries |
| 3D models / character animation | none | — | not called for (procedural dice, no characters) |

## 16. Known limitations

- English only; no locale switch (see §10).
- The colour-vision palette selector sets `data-palette` on `<body>` but no palette-specific CSS exists, and *Timing assistance* has no effect on any rule or animation.
- The `voice` bus has no sources; there is no voice-over.
- `session.stats.upperBonuses` increments on every score event after the bonus is earned rather than once, so the Lodge Keeper achievement is correct but the stat over-counts.
- *Play again* after a pass-and-play practice table restarts a one-human vs AI table (the difficulty is derived from the content id).
- Journey stage cards show "n. Mastery" for mastery stages and just "n." otherwise; trail names are headings, stage names appear only in the aria-label and the status line.
- In portrait phones the outer dice can sit outside the 3D camera frustum; the DOM dice tray is authoritative.
- `server.js` serves `tests/` and dotfiles (only `data/` is refused); `tests/smoke.html` depends on this and is not part of `npm test`.
- Leaderboards in local mode list only the current device's results; hosted boards need the game's own `server.js` routes.
- The Blizzard Clock is enforced when a command or the once-a-second heartbeat arrives, so expiry can register up to one second late.

## Design intent not yet implemented

- Localization into en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT with a string table and a language selector.
- Colour-vision-safe palette variants and a real timing-assistance mode (slower AI pacing, longer confirm windows).
- Key-binding remap UI on top of the existing `settings.bindings` override.
- Platform achievements and friends-filtered boards through the host APIs; hosted invitations and pass-and-play across devices.
- Machine states `title`, `mode-select`, `reconnecting` driven by the UI so the state machine mirrors every screen.
