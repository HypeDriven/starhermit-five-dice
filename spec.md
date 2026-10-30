# Five Dice — Game Design Document (running spec)

Present tense: this document describes what the shipped game does today. Anything the design wants but the code does not yet do is listed only under "Design intent not yet implemented" at the end.

## 1. Overview

**Pitch.** A cozy mountain-lodge dice table: roll five wooden dice up to three times, hold the keepers, fill one of thirteen lodge-flavoured scoring rows per turn, and take the table with the highest grand total.

| | |
|---|---|
| Genre | Turn-based dice / scorecard game (classic five-dice math, original names and setting) |
| Players | 1–4 seats per table: solo target climbs, 1 human vs 1–3 lodge AI, or two humans pass-and-play on one screen |
| Session | 13 rounds per player; ~4–6 min vs one AI, ~8 min four-handed; a Learn lesson ~3 min |
| Platforms | StarHermit engine 1.30.0 script game (host API 1.32): natively in the StarHermit client and in desktop and mobile browsers through the engine's web runtime (portrait and landscape); keyboard, mouse, touch, gamepad |
| Rendering | `starhermit:scene` lodge table (three.js-style scene graph) behind a `starhermit:ui` immediate-mode HUD; every play action also exists as a UI control |
| Persistence | `starhermit:storage`: the progress save (device + the player's cloud slot), the game's options (synced with the account), the saved table and round history on the device |

### File map

| Path | Responsibility |
|---|---|
| `starhermit.txt` | Manifest: `name`, `description`, `owner`, `server=score-script.js`, `cover=cover.jpg`, `launch=index.html`, `engine.api=1`, `engine.entry=native/main.ts`, `engine.version=1.30.0`, `engine.minor=32`, `engine.capabilities=platform,storage,clipboard`, one `control.<action>` and `engine.gamepad.<action>` line per action, `engine.group.*` headings for Options |
| `native/main.ts` | Entry module: the overlay stack and flow, the round lifecycle, turn controls, AI pacing, countdown, results delay and clock heartbeat on the runtime's fixed steps, session-event presentation (sounds, captions, announcements, toasts, haptics, dice animation), progression and achievements, posting scores, input (actions, taps on the 3D dice), lifecycle (suspend/resume/quit) |
| `native/screens.ts` | `starhermit:ui` built every frame: top bar, scorecard and table rails (or drawers), stage HUD (lesson banner, action tray, dice tray, countdown), title page over the key art, every dialog, toast and captions |
| `native/render.ts` | The lodge scene on `starhermit:scene`: table, room, window, fireplace, embers, dice and their animation, camera presets, the look per graphics level, die picking |
| `native/quality.ts` | The old Low/Balanced/High/Ultra presets and budgets keyed by the runtime's quality tier and level index |
| `native/audio.ts` | Opus one-shots, the hearth loop and the rendered fireside music on the runtime's buses; captions |
| `native/platform.ts` | Progress save with cloud merge and foreign-save migration, device storage, the game's options with legacy-settings migration, player, invite link, platform clock, score posting and the global board |
| `native/style.ts`, `native/i18n.ts` | Theme tokens over `assets/ui-style.json` and the runtime widgets' theme; the interface language → `js/i18n.js` |
| `js/rules.js` | Pure deterministic rules engine: categories, scoring, legality, `applyCommand`, rankings, hashing, replay, serialization |
| `js/ai.js` | Deterministic lodge AI (`ember`, `hearth`, `summit`) using the rules legality API |
| `js/content.js` | Versioned content: 5 themes, 4 lessons, 40 journey stages, 5 challenges, daily table, practice factory, offline validators |
| `js/session.js` | Session controller: state machine, validated dispatch, undo snapshots, lesson gating, session clock (`clock.now` / `clock.wall`, injected by the engine client), autosave, replay envelope, results record |
| `js/progress.js` | Pure save parts: progress document, foreign-save reader, merge, a finished table's progression and achievements, device boards, option validation and the browser build's legacy keys |
| `js/strings.js`, `js/i18n.js`, `js/t.js` | Translation tables (ES modules), `T`/`setLocale`, and the `T`/`N`/`playerName` helpers |
| `assets/ui-style.json` | UI styles converted from `tools/ui-style.css` (`npm run css`) |
| `assets/textures/*.png` | The procedural room/flame/glow/tray textures and pip bump maps baked once from the browser build's canvas code (`npm run textures`) |
| `assets/key-art.webp`, `results-win.webp`, `results-lose.webp` | Title backdrop, results illustrations |
| `index.html`, `starhermit-files.json` | The engine's web loader and file index, written by `npm run package` (never edited) |
| `score-script.js` | StarHermit platform script (`server=`): range-checks a finished table's grand total and posts it to the `high-score` board (canonical copy in the games repo's `tools/score-script.js`) |
| `server.js` | Local dev host with legacy `/api/v1` routes and replay validation the client no longer calls (left out of the package) |
| `sfx/` | 22 Opus clips; `manifest.txt` (canonical event binding), `manifest.json` (generator input), `manifest.md` (generator output) |
| `cover.jpg`, `coverart.png`, `icon.png` | Store cover (manifest), cover source, icon |
| `tests/run.js`, `tests/progress.test.mjs`, `tests/i18n.test.mjs` | Rules/content/session/server unit tests; save, merge, migration and options tests; localization coverage |
| `tests/native.mjs`, `tests/native/*.play` | Engine checks: web index, `tsc`, `starhermit check`, play scripts driving the real UI |
| `tools/` | `package-web.mjs`, `css.mjs` + `ui-style.css`, `bake-textures.mjs`, `gen-plays.mjs`, `browser-play.mjs` |
| `data/` | Runtime JSON stores of `server.js`; git-ignored, never packaged |

## 2. Vision and design pillars

1. **The table is the whole world.** One round felt table, one fireplace, one window. Everything the player needs — dice, card, whose turn — is on or beside the table; there is no map, inventory or meta-screen during play. Rules in: the scorecard as a permanent rail, previews on every open row. Rules out: modal pop-ups during a turn, hidden information, animated distractions on the felt.
2. **Every roll is honest and inspectable.** Dice come from a seeded rules stream (`hashSeed(seed + ':rules')` in `rules.js`), every command is logged, and a finished table can be replayed to the same hash on the client and the server. Rules in: seeds shown as shared dailies, hints that use the exact legality API. Rules out: rerolls the player did not ask for, cosmetic randomness touching outcomes, client-trusted scores on a leaderboard.
3. **Three rolls, one decision.** The whole skill of the game is the hold/reroll decision and the sacrifice choice when nothing scores. Rules in: zero-point sacrifices as first-class actions, a Full-Lodge/straight tier of feedback above plain points, an upper-bonus meter. Rules out: extra dice, power-ups, bonus rolls purchased or earned.
4. **Warm, unhurried, never punishing.** The AI opponents are named lodge guests, losing reads as "the lodge keeps its crown", and the fire keeps burning. Rules in: undo on practice/journey tables, generous pacing (650 ms per AI batch), captions for every meaningful cue. Rules out: streak loss, timers outside the explicitly named Blizzard Clock challenge, ads or purchases.
5. **The UI is the game; the 3D is the mood.** Every interactive element exists as a UI control; the 3D table adds atmosphere and a second way to tap a die. Rules in: full keyboard, gamepad and screen-reader paths. Rules out: any action that only exists in the scene.

## 3. Player experience

**Target player.** Someone who knows or can learn a five-dice scorecard in one game, plays in 5-minute sittings on a phone or a laptop, and enjoys a slow-burn mastery curve (upper bonus pace, sacrifice order) without competitive pressure unless they seek it in Daily or Challenges.

**First 60 seconds.** The title card states the rules in one sentence and puts *Practice* first (or *Resume Table* when an autosave exists). Practice → *Ember* starts a 3-2-1 countdown (`native/main.ts` runCountdown), then the status line reads "Your turn · rolls left 3", the only enabled control is the amber **Roll (3)** button, and all thirteen rows on the card show "·". After the first roll every open row previews its points in green with a ◆ marker, the dice buttons become pressable, and the toast/announcer explains any illegal action ("Roll the dice first.", "No rolls left — choose a category to score."). *Learn* offers four lessons that gate the player to exactly one action at a time with a banner (`session.js:lessonGate`); Help & Rules lists every row with its rule and every key binding. There is no forced tutorial.

**Session shape.** Countdown → 13 alternating turns (AI turns play out at 650 ms per command batch, visibly holding and rerolling) → the results card with a per-player Upper/Bonus/Lower/Total breakdown, par, newly unlocked achievements and a recommended next action (next journey stage, play again, back to title). Backgrounding pauses solo play and autosaves; the title offers *Resume Table* on return.

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
- `note`: heartbeat that only advances the clock (and so can trigger the time limit); sent once a second by `native/main.ts` startClockTicker on time-limited tables only.

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

Actions are declared in `starhermit.txt` (`control.*` keys, `engine.gamepad.*` pads); players rebind them in the runtime's Options (Settings → *Change keys and buttons* opens the rebinding screen). Action names are lower-case; the browser build's `focusPrev` / `focusNext` became `focus_prev` / `focus_next`, so bindings saved for those two under the old names are not carried over.

| Action | Keyboard | Touch / pointer | Gamepad | Feedback |
|---|---|---|---|---|
| Roll | **R** or Roll button (action tray, table rail) | tap Roll | West (X) | dice tumble 620–780 ms, `dice-roll` clip, 12 ms haptic, status line updates |
| Hold / release die *n* | **1–5**, or ←/→ to focus a die button then Enter/Space | tap the die button, or tap the 3D die (<12 px, <500 ms) | D-pad / left stick ◀▶ to focus, South (A) | button lifts 8 px with a HELD caption; 3D die rises onto the held strip with a ring; `die-hold` / `die-release` |
| Score a row | focus a ◆ row and Enter, or click it | open the *Card* drawer (narrow windows), tap the row | focus + South | row closes, `score-*` clip, 30 ms haptic, announcement "You scored 25 on Full Lodge" |
| Hint | **H** or Hint | tap Hint | North (Y) | toast + `hint-chime`; disabled where the content forbids hints |
| Undo turn | **U** or Undo turn | tap Undo turn | East (B) during play | table restored to the turn start, `undo-sweep`, toast "Turn restored" |
| Pause / resume | **Esc** or the ‖ top-bar button | tap ‖ | Start | Paused dialog (Resume, Settings, Help, Leave table) |
| Camera preset | **C** | Settings → Camera | right-stick press | 900 ms authored camera move (instant with reduced motion) |
| Close a dialog | Esc, ✕ | tap ✕ | East (B) | back to the dialog under it (menus return to the title) |

F1 opens the runtime's Options. Game keys are ignored while a dialog is open or a text field has focus. **Input locking**: play inputs are guarded by `session.isHumanTurn()`; during AI turns, the countdown, pause and results the Roll and die controls are disabled; a tap on a 3D die out of turn toasts "Wait for your turn." Lesson gates block any action other than the required one and toast the lesson text. Duplicate commits are prevented by command ids. **Hold to confirm**: with *Hold to confirm scoring* on, scoring opens a Yes/Cancel dialog.

## 7. Screens and UI flow

`session.machine` (`session.js:MACHINE_STATES`) is the authoritative table state; `native/main.ts` keeps an overlay stack over it.

```
title ─▶ Practice / Journey / Learn / Challenges / Daily ─▶ (countdown 3·700 ms | tutorial) ─▶ active ◀──▶ paused
active/tutorial ──(terminal command)──▶ resolving ──(1400 ms / 200 ms)──▶ results ──▶ title | next stage | play again
Resume Table ──▶ restoreSnapshot ──▶ paused (reason "reconnect") ──(Resume)──▶ active/tutorial
```

The title is a card over the lodge key art (Resume Table when a saved table exists, Practice, Daily Table with today's date or best, Journey with stages cleared, Learn, Challenges, Profile & Scores, Sign in with StarHermit for guests, Invite a friend when signed in, Help & Rules, Settings, the content-version line). Practice setup, Learn, Journey, Challenges, Help & Rules, Settings, Profile & Scores, Paused, Confirm and Results are `ui.dialog`s; all but Results close with ✕ / Esc / B and return to the one under them (a menu opened from the title returns to the title). Dialogs taller than the window scroll with a pinned footer. Settings holds: *Open Options* (volumes, mute, graphics, frame rate, language, reduced motion, high contrast and text size are the runtime's), Captions for audio cues, Theme, Camera, Colour-vision palette, Left-handed controls, Hold to confirm scoring, Timing assistance, Haptics, Change keys and buttons, Replay tutorials.

Layouts are picked from the window's logical size (the old media queries):

- **Wide (≥1024 px).** Scorecard rail 320 px · stage · table rail 300 px, under the top bar (Five Dice, the status line — account and sync state on the title, turn · rolls left · round · table and ⏱ remaining in play — Pause, Help, Settings). The stage holds the lesson banner (top centre), the countdown numeral, the dice tray (bottom centre) and the action tray above it; the table rail lists the seats (▶ current, 🤖 AI) and repeats the actions.
- **Narrow portrait.** Rails become drawers (`min(85 %, 320 px)`) behind the *Card* and *Table* buttons at the stage's top corners (swapped by *Left-handed controls*); the drawer keeps its top clear of the buttons. The action tray (Roll / Hint / Undo, 52 px tall, wrapping) sits at the bottom, the dice above it; the status line wraps to two lines and the game title is hidden.
- **Narrow landscape.** Drawers as above; the dice tray is a column at the right edge, the action tray (all five actions) at the bottom left.
- The scorecard's rows shrink (39 → 24 px) to fit a short rail or drawer; below that it scrolls. Safe-area margins are painted in the page colour. The runtime's interface size and text size scale everything.

Must never be cut off: Roll, the five die buttons, the drawer buttons, the status line's actor/rolls text, the results total column and the Resume button.

## 8. Art direction

**Hero.** The felt table with five cream dice, lit by a warm key light and the fireplace to the right; the lodge key art (`assets/key-art.webp`) shows the same table, window and hearth behind the title card.

**Palette.** Themes are content data (`content.js:THEMES`) applied to the scene materials and the UI tokens (`felt wood wall accent select legal danger text page`); panels are `#2c2016` / `#382a1c` on the dark themes, and on the light Pinewood Morning they are drawn from its page colour (the browser build kept them dark, which left its dark text on dark panels). The die buttons are `#f4ead8` / `#33241a`. The colour-vision palette replaces the select and legal colours (Deuteranopia-safe `#e69f00` / `#56b4e9`, Protanopia-safe `#f0e442` / `#0094e0`, Tritanopia-safe `#ff8fb8` / `#00b38a`) on the held markers, the tray, the HELD caption and the legal rows.

| Theme | felt | wood | wall | accent | die / pip | select | legal | danger | sky | text | page |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Hearthglow Lodge (default) | #3e5c4b | #6b4a2f | #2e2118 | #e8a54b | #f4ead8 / #33241a | #7fc8a9 | #8fd6a0 | #d95745 | #1a2a33 | #f2e9da | #241a12 |
| Pinewood Morning | #4a6b52 | #8a6a44 | #33402e | #d98e4a | #fbf6e8 / #2e3b2a | #4f9d8f | #6fbf73 | #c0503c | #cfe0e8 | #243020 | #eef0e4 |
| Frostfall Cabin | #3a4d6b | #5c4632 | #1c2431 | #8fb8e8 | #eef2f8 / #22304a | #9ac8f0 | #7fd6c2 | #e06a5a | #0e1520 | #e4ecf6 | #161e2a |
| Starlit Refuge | #463a63 | #4a3626 | #1d1626 | #c9a0e8 | #f2ecf8 / #352347 | #b08fe0 | #8fd6a0 | #e06a7a | #0c0916 | #ece4f6 | #1a1424 |
| Ember Night | #5c3a3a | #3c2a20 | #18100c | #f0764a | #f8efe2 / #402014 | #f0a35e | #a0d690 | #e0483c | #0a0605 | #f6e8dc | #201410 |

Lights (the browser build's three.js r160 intensities): warm key directional light `#ffcf98` (1.7, the only shadow caster, its orthographic shadow box fitted to the table), a pooled lamp point light `#ffb066` over the felt, fire point light `#ff7733` flickering 90–100 %, hemisphere fill `#bcd0e8` / `#2a2018`; reflections give each lit material the RoomEnvironment(renderer) room as its own envMap at its page envMapIntensity; ACES filmic tone mapping at exposure 1.0, sRGB output; the background and distance fog are the theme wall colour at 35 %.

**Shape language.** Round table (cylinder felt, torus rim, pedestal), cubes with circular pips (canvas textures, 128 px, larger single pip), ring markers under held dice, a dashed rounded held-row strip at the back of the table. Rectangular window with a deterministic 60-star scatter; a fireplace opening with an additive flame card. At *Detailed* table detail the dice are rounded (RoundedBoxGeometry) with a clearcoat and recessed pips (bump map), the felt, rim, log wall and plank floor carry procedural canvas textures, and the window gains a timber frame, moon glow and mountain ridge, the fireplace a stone surround and mantel, the rim a brass inlay. The procedural canvas textures are baked once into `assets/textures/*.png` by `tools/bake-textures.mjs` (the browser build's painters, run in Chrome); only the theme-coloured pip faces are painted at run time on `starhermit:canvas`.

**Graphics.** The runtime's Options choose the graphics level (Auto by default) and own render scale, the pixel-ratio cap, adaptive resolution, the frame-rate limit and readout, the shadow-map size and MSAA samples. `native/quality.ts` maps the frame's quality tier to the browser build's presets: Low (no shadows, no post, plain dice and room, Lambert room materials, 0.6 × 70 embers), Balanced (1024² shadows, bloom, grade, FXAA, reflections, detailed), High (2048², AO, SMAA, clear-coated dice, 320-tier embers), Ultra (4096², full AO, MSAA, 1.5× budgets). Embers scale within the tier by the level index (≤ 2×). Effects: key-light shadows, `renderer.ao` (contact darkening), `renderer.bloom` limited to HDR emitters (flame, embers, moon; threshold 1.25), `renderer.grade` in display space (S-curve contrast, saturation 1.1, warm highlights / cool shadows, 0.28 vignette), anti-aliasing, image-based reflections from `RoomEnvironment` through `PMREMGenerator`. Ambient motion (fire flicker, flame sway, star twinkle, ember drift) stops with reduced motion. Per-tier budgets (die-face texture 64/128/256/512 px, bevel 2/3/4/6, round-geometry LOD ½/¾/1/1.5, window stars 40/60/90/140, bloom/AO resolution ½ or full) are the browser build's `BUDGETS`.

**Typography.** The runtime's sans at 16 px base (the runtime's text size scales it), accent-coloured headings.

**Motion.** Authored, interruptible tweens with absolute targets: roll 620 ms + up to 160 ms per die with an arc and a spin quaternion; hold lift/settle 180 ms; camera preset 900 ms ease-in-out; ember drift and fire flicker as bounded ambient motion; drawers open at once. With the runtime's reduced motion: dice snap to their end state, the countdown is skipped, AI pacing drops to 120 ms, the results delay drops to 200 ms, camera moves are instant, ember drift stops. Selection is never colour alone: held dice lift, show a ring marker, a HELD caption and are announced as pressed toggles; legal rows show a ◆ and bold green preview.

**Visual assets called for by the design** (all shipped, see §15): title key art, results illustrations for win and loss, store cover art, icon and favicon. No hero 3D model: the dice are deliberately procedural so their faces and orientation come from rules state.

## 9. Audio direction

**Mix.** The runtime's buses (Options → Audio owns the volumes and the mute): the old `music` bus → `music`, `effects` and `ambience` → `effects` (the `voice` bus carried nothing); the old default levels (music 50 % × 0.45, effects 80 %, ambience 40 % × 0.4) are folded into each sound's gain. Clips load once the mixer runs (natively at once; in a browser after the first press), one at a time. Music is the generative fireside pentatonic (one sine note per 1.28 s, denser and with fifths after each score, a low triangle every 16 steps), its notes rendered once into clips with the old envelope. The hearth loop plays from the first press. The browser build's synthesized stand-ins (played while a clip decoded, and the synthesized room noise before the hearth loop) are not ported: a live synthesis graph breaks clip loading on the web runtime, so a clip still loading is silent. Captions (Settings → *Captions for audio cues*) show each meaningful cue as "♪ …" at the stage's bottom left. Hint and Undo play their chimes (the browser build's routing never reached them).

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
| `result-win` | result-win.opus | fireside fanfare | results overlay opens, local seat won (`native/main.ts`) |
| `result-lose` | result-lose.opus | descending marimba with wind | results overlay opens, local seat did not win (`native/main.ts`) |
| `hint` | hint-chime.opus | single glass chime | hint delivered |
| `undo` | undo-sweep.opus | reversed felt whoosh | turn restored |
| `uiClick` | ui-click.opus | fingernail tap on a wooden button | every menu button and guarded play input |
| `countdown` | countdown-tick.opus | mallet on a wooden block | each 3-2-1 numeral (`native/main.ts` runCountdown) |
| `countdown-go` | countdown-go.opus | two bright bell taps | table goes active |
| `achievement` | achievement-unlock.opus | sparkling bells | first-time achievement grant (`native/main.ts`) |
| `lesson-complete` | lesson-complete.opus | two-note glass chime | final lesson step satisfied (`native/main.ts`) |
| `ambience` (loop) | ambience-hearth.opus | log fire in a stone hearth, faint wind | looped on the ambience bus after unlock |

## 10. Localization

Every player-facing string ships in nine locales: **en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT**.

- **Tables.** English source strings are the keys. `js/strings.js` holds rows of [English, es-419, de-DE, fr-FR, pt-BR, it-IT]; en-GB, es-ES and fr-CA list only their differences and fall back to en-US, es-419 and fr-FR. The StarHermit account strings are rows of the same table. "Five Dice", "StarHermit" and the opponents' names are names; the generic seats *You*, *Lodge Guide*, *Guest* and *Player N* are translated.
- **Language.** The runtime's interface language (`preferences().language`: the player's choice in Options → Language, else the account's preferred language or the device's) picks the nearest shipped locale (`native/i18n.ts`: `en-AU → en-GB`, `es-ES`, `fr-CA` by region, other `es/fr/pt/de/it` to their primary locale) and switches live: every frame is built from the current language, so open dialogs and the HUD follow at once. The runtime's Options replaced the game's own Language selector (`sh-language.js`); the browser build's `ui.language` setting is removed from the account during migration.
- **What is translated.** Every dialog, the HUD (status line, scorecard rows and their accessible names, bonus meter, table rail, actions, die buttons and HELD), toasts and announcements, invalid-action and hint text (the rules engine returns a `reasonKey`), lesson banners, audio captions, content names and descriptions, status and sync lines.

## 11. Accessibility

- **Keyboard and gamepad.** Every control is a runtime widget with focus order, focus ring and Enter/Space/South activation; 1–5/R/H/U/Esc/C shortcuts; ←/→ (D-pad) move focus across the dice; dialogs focus their first control, trap focus while open and return to the one under them.
- **Screen reader.** Turn, score, hint, lesson and result text go to `ui.announce`; die buttons are toggles named "Die 3, showing 5, held. Activate to release"; legal rows are named "Score Full Lodge" and read on with "25 points. Three of one face, two of another — 25"; filled rows read their value.
- **Visual.** 44 px minimum targets (52 px tray buttons on phones), accent focus ring, the runtime's high contrast and text size, a thicker held border under high contrast, *Left-handed controls* (swaps the drawer buttons), five themes including a light one, colour-vision palettes. Colour is always paired with shape/text (◆, HELD, ▶ current player).
- **Motion and timing.** The runtime's reduced motion; *Timing assistance* slows AI turns and lengthens captions by 1.6×; no gameplay timer except the opt-in Blizzard Clock, whose clock stops while paused.
- **Audio.** The runtime's volumes and mute, captions for every cue; no audio-only information.
- **Other.** *Hold to confirm scoring*, haptics toggle, tutorial replay.

## 12. StarHermit integration

| Feature | Status |
|---|---|
| Engine | Script game on the StarHermit engine 1.30.0 (`engine.minor=32`), capabilities `platform`, `storage`, `clipboard`; browsers load `index.html` (the engine's loader, pinned by hash on wiki.starhermit.com) |
| Player | `starhermit:platform` `player()`: the display name in the status line and Profile & Scores; guests edit a local display name (≤20 chars) kept on the device |
| Sign-in / invite | Guests see **Sign in with StarHermit** on the title (`requestSignIn`); signed-in players **Invite a friend** (copies `inviteLink()` to the clipboard). Signing out mid-session toasts that progress keeps saving on this device |
| Cloud save | The progress document (`v`, `rev`, journey, challenges, achievements, totals, streakDays, bestDaily) is the game's `saves` save (schema 1): on the device and, signed in, in the account slot. A conflict between devices merges both (larger of each lifetime total, union of cleared stages/challenges, achievements with the earliest unlock, active days, the better best score and stars, `rev` above both); the account's copy replacing the device's is merged in the same way. The browser build's cloud save (the JS SDK's `saveJSON` of the same document, key `game:<slug>`) shows as foreign: it is read, merged into this device's progress and replaced once (`replaceForeign`). Guests' old browser `localStorage` progress cannot be migrated |
| Device storage | `fivedice:autosave` (the saved table), `fivedice:results` (last 200 finished tables, for this device's boards), `fivedice:profile` (the guest's name) |
| Options sync | Theme, palette, camera, captions, left-handed, hold to confirm, haptics, timing assistance and finished lessons are `settings` (`game.<key>`, synced with the account). The browser build's account settings (its mirrored settings keys, `ui.language`, `audio.options`, `graphics.gpu.*`) are adopted where they are still the game's and then removed |
| Platform clock | `serverNow()` (device clock until it answers): the daily table's UTC date, achievements' unlock times, the replay envelope's offset |
| Leaderboards | Signed in, every finished table except lessons and forfeits posts its grand total through `score-script.js` (a practice session whose socket carries `{ type: 'result', scores: { 'high-score': n } }`; the script range-checks 0–10,000 and answers `result-ack`), and Results shows "Leaderboard rank: #N" (or posted / not posted). Profile & Scores' Daily and Challenge tabs list the global `high-score` board when signed in; Journey wins and guests see this device's tables |
| Achievements | Six keys granted idempotently in the progress document and toasted (no platform achievements) |
| Runtime-owned | Options (volumes, mute, graphics level, frame rate, language, reduced motion, high contrast, text size, key/pad rebinding), report a problem, crash reports, large-screen scaling, safe areas, WebGL context loss |
| Not used | Rooms, matchmaking, chat, voice, replays; pass-and-play stays on one screen. Results are not server-refereed beyond the score script's range check (single-player tables; see Known limitations) |

## 13. Technical architecture

- **Module boundaries.** `rules.js`, `ai.js`, `content.js` are pure and shared by the engine client, the node tests and `server.js`. `session.js` is the only caller of `applyCommand` in the client; the UI, scene and audio consume its snapshots and events. The engine client imports the `js/*.js` ES modules directly (`allowJs`).
- **Time.** The runtime's fixed steps (60 a second) drive the session clock (`clock.now`), the countdown, AI pacing (650 ms per batch, 120 ms with reduced motion, ×1.6 with timing assistance), the results delay, the time-limit heartbeat and toasts, so play scripts replay exactly; the scene's tweens follow the rendered frames.
- **Determinism and replay.** Envelope `{ schema: 1, build, contentV, contentId, seed, init, initHash, timestampOffset, commands, checkpoints, result }`; the AI is deterministic per state hash (which includes the clock).
- **Lifecycle.** A suspended window pauses the table, saves its snapshot and flushes the save; quitting saves the snapshot. Autosave is also written on pause and cleared when a table ends.
- **Rendering budget.** ~14 meshes (~30 detailed), one star cloud and one ember cloud, one shadow-casting light, the runtime's post chain per level.

## 14. Testing and acceptance criteria

`npm test` runs:
- `tests/run.js` (36 tests): scoring, legality and reasons, command idempotency, bounds, hints, terminal states, tie-breaks, goals, result ordering, serialization, 50-session replay equality, tampered envelopes, 2000-command fuzz, AI determinism and termination, content validators and launch scope, daily immutability, practice bounds, golden replays, streams, session pause/resume, undo, hint gating, autosave round-trip, and `server.js` replay validation.
- `tests/progress.test.mjs`: progress documents, the browser build's foreign save migrated and merged, the merge rules, a finished table's progression and achievements, this device's boards, option validation and legacy keys.
- `tests/i18n.test.mjs`: every key used by `native/*.ts`, `js/*.js`, the audio captions and the content is translated in all nine locales with intact placeholders, no stale rows, live switching.
- `tests/native.mjs`: the web index matches the files, `tsc` (strict, the generated `.starhermit/starhermit.d.ts`), `starhermit check .` with zero warnings, and every `tests/native/*.play` as a signed-out `--render-check`: `screens.play` (every title dialog, a Practice table with pause/resume, roll, holds by key and die button, camera, the Table drawer, Leave table cancelled, Settings from pause, a forfeit to its results), `learn-first-roll.play`, `journey-stage.play` (countdown, whole table, Play again), `challenge-two-roll.play` and `challenge-lone-summit.play` — whole tables played through the real UI to their results (`tools/gen-plays.mjs`: each turn rolls, holds the first die, rolls again and scores the next row in card order, since the AI's choices depend on the clock).

`npm run test:browser` (`tools/browser-play.mjs`) serves the package on loopback and plays it in Chrome on the machine's GPU (`~/games/tools/gpu-chrome.mjs`) at 1366×768, a 390×844 phone (DPR 3) and an 844×390 landscape phone: a Practice table from the title, a roll, a hold, a scored row (keys and clicks on the desktop, taps and the Card drawer on the phones), then the pause dialog; it fails on console errors or warnings or the runtime's error screen. `npm run package` rewrites `index.html` and `starhermit-files.json` after every change.

**QA bar (checkable).**
- First table: the title sentence and the Learn lessons explain play; the first illegal action produces a toast and an announcement.
- Every menu item, setting, overlay and play control is reachable by mouse, touch and keyboard; no console errors or warnings on load, play, pause, results, title return.
- No text or control cut off at 1366×768, 390×844 portrait and 844×390 landscape; the six results columns fit at 390 px.
- All 22 SFX clips exist, are 48 kHz mono Opus and are bound to an event that `native/audio.ts` plays.
- `npm test` and `npm run test:browser` pass.

## 15. Asset inventory

| Path | Purpose | Source | Status |
|---|---|---|---|
| `assets/key-art.webp` (1280×720, 56 KB) | Title backdrop (the title card's key art) | FLUX.2 klein, seed 8901, 1536×864, 28 steps | generated in this pass, wired |
| `assets/results-win.webp` (1024×576, 43 KB) | Results overlay illustration when the local seat wins | FLUX.2 klein, seed 8902, 28 steps | generated in this pass, wired |
| `assets/results-lose.webp` (1024×576, 30 KB) | Results overlay illustration for loss / forfeit / time-out | FLUX.2 klein, seed 8903, 28 steps | generated in this pass, wired |
| `coverart.png` (1200×675, 417 KB) | Cover source (`cover.jpg` is the manifest's cover) | key art + ffmpeg title/tagline, 256-colour PNG | replaced in this pass |
| `icon.png` (256×256) | Icon | authored earlier | shipped |
| `assets/textures/*.png` | Baked room, flame, glow and tray textures, pip bump maps | `tools/bake-textures.mjs` from the browser build's canvas painters | shipped |
| `sfx/dice-roll … ui-click` (13 clips) | Rules/UI cues | MOSS-SoundEffect v2, 100 steps | shipped |
| `sfx/countdown-tick, countdown-go, score-bonus, score-hand, result-win, result-lose, achievement-unlock, lesson-complete` | New presentation cues | MOSS-SoundEffect v2, 100 steps | generated in this pass, wired |
| `sfx/ambience-hearth.opus` (12 s loop) | Hearth ambience | MOSS-SoundEffect v2, 100 steps | generated in this pass, wired |
| `sfx/manifest.txt` / `manifest.json` / `manifest.md` | Canonical binding / generator input / generator output | — | in sync, 22 entries |
| 3D models / character animation | none | — | not called for (procedural dice, no characters) |

## 16. Known limitations

- The `voice` bus never had sources; there is no voice-over.
- `session.stats.upperBonuses` increments on every score event after the bonus is earned rather than once, so the Lodge Keeper achievement is correct but the stat over-counts (kept: replays and the server validator depend on the rules as they are).
- Journey stage cards show "n. Mastery" for mastery stages and just "n." otherwise; stage names appear in the accessible name and the status line.
- On-platform there is one global `high-score` board for all modes; Journey wins and guests' boards are this device's tables.
- Solo scores are client totals range-checked by `score-script.js` (accepted for this port); there is no server-side replay verification of posted scores.
- The Blizzard Clock is enforced when a command or the once-a-second heartbeat arrives, so expiry can register up to one second late.
- The old per-effect graphics overrides, render-scale slider and GPU summary line are gone: the runtime's Options choose a graphics level.
- Guests' progress kept in the browser build's `localStorage` cannot be migrated; signed-in players' cloud saves are.
- Key bindings saved for the browser build's `focusPrev` / `focusNext` are not carried over (actions renamed `focus_prev` / `focus_next`).
- Clips still loading play silently (no synthesized stand-ins on the engine).

## Design intent not yet implemented

- Platform achievements and hosted pass-and-play across devices (would need a refereeing server script).
- Machine states `title`, `mode-select`, `reconnecting` driven by the UI so the state machine mirrors every screen.
