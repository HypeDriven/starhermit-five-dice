// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.json) per rules event and presentation cue,
// the hearth's crackle loop (sfx/ambience-hearth.opus) from the first press,
// and the adaptive fireside music stem (slow pentatonic sine notes with a
// fifth above and a low triangle every sixteenth step, denser for a while
// after each score), with a caption for every meaningful cue when Settings ›
// Captions is on.
//
// The browser build's four buses become the runtime's (Options › Audio owns
// the volumes and the mute): music → "music", effects and ambience →
// "effects" (voice carried nothing); the old default bus levels (music
// 50 % × 0.45, effects 80 %, ambience 40 % × 0.4) are folded into each
// sound's gain. The music's oscillator notes are rendered once offline in
// onStart with the old envelope (8 ms attack, exponential decay); the
// synthesized stand-ins the browser build played while a sample decoded (and
// its synthesized room noise before the hearth loop) are not ported, so a
// clip still loading is silent. The clips all load at once in onStart; the
// hearth loop and the music start once the mixer runs (in a browser after the
// first press). Seeded variants
// (createStream('audio-variants')) keep the music the same on replays.
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { createStream, getCategory, UPPER_BONUS_THRESHOLD } from "../js/rules.js";

const LEVEL = { music: 0.5 * 0.45, effects: 0.8, ambience: 0.4 * 0.4 };
const CLIPS = [
  "dice-roll", "die-hold", "die-release", "score-points", "score-avalanche", "score-hand", "score-zero", "score-bonus",
  "turn-start", "invalid-move", "finish-cards", "finish-table", "hint-chime", "undo-sweep", "ui-click", "countdown-tick",
  "countdown-go", "result-win", "result-lose", "achievement-unlock", "lesson-complete",
];
const AMBIENCE = "ambience-hearth";

const clips = new Map<string, AudioClip>();
let suspended = false;
let captionHook: ((key: string, vars?: Record<string, string | number>) => void) | null = null;
/** fn(key, vars) for each cue's caption (an English key the UI translates; shown when captions are on). */
export function onCaption(fn: (key: string, vars?: Record<string, string | number>) => void): void { captionHook = fn; }
const caption = (key: string, vars?: Record<string, string | number>): void => captionHook?.(key, vars);

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of [AMBIENCE, ...CLIPS]) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
  renderNotes();
}

/** Plays a sample (once loaded). */
function sfx(name: string, gain = 1): void {
  const clip = clips.get(name);
  if (!clip || suspended) return;
  try { playClip(clip, { bus: "effects", gain: LEVEL.effects * gain }); }
  catch { /* the mixer is full this frame: skip it */ }
}

interface GameEvent { type: string; rolled?: number[]; held?: boolean; category?: string; points?: number; reason?: string; breakdown?: { bonus: number; upper: number } }
/** js/audio.js onGameEvent: the rules events' samples and captions. */
export function onGameEvent(e: GameEvent): void {
  switch (e.type) {
    case "roll": {
      sfx("dice-roll");
      const n = e.rolled?.length || 5;
      caption(n === 1 ? "1 die rolled" : "{n} dice rolled", { n });
      break;
    }
    case "hold":
      sfx(e.held ? "die-hold" : "die-release");
      caption(e.held ? "Die held" : "Die released");
      break;
    case "score": {
      const cat = getCategory(e.category) as { id: string; points?: number; section: string } | null;
      const pts = e.points ?? 0;
      // Fixed-point lower hands (Full Lodge, Ridge Path, Summit Trail) get their own "hand made" cue; Avalanche its cascade.
      const madeHand = pts > 0 && cat && cat.points != null && cat.id !== "avalanche";
      sfx(e.category === "avalanche" && pts > 0 ? "score-avalanche" : madeHand ? "score-hand" : pts > 0 ? "score-points" : "score-zero");
      caption("{n} points scored", { n: pts });
      const b = e.breakdown;
      // Upper bonus crossed on this very score: layer the lodge-bonus cue.
      if (b && b.bonus > 0 && cat?.section === "upper" && b.upper - pts < UPPER_BONUS_THRESHOLD) {
        bonusAt = context.currentTime + 0.25;
        caption("Lodge bonus earned");
      }
      excite();
      break;
    }
    case "turn": sfx("turn-start"); break;
    case "invalid": sfx("invalid-move"); caption("That action is not legal"); break;
    case "finish":
      if (e.reason === "cards-complete") { sfx("finish-cards"); caption("All cards complete — table finished"); }
      else { sfx("finish-table"); caption("Table over"); }
      break;
    case "hint": sfx("hint-chime"); break;
    case "undo": sfx("undo-sweep"); break;
    default:
  }
}
let bonusAt = -1;
export function uiClick(): void { sfx("ui-click"); }
/** Pre-round countdown: one tick per number, a brighter "go" when the table opens. */
export function countdownTick(final = false): void {
  if (final) { sfx("countdown-go"); caption("Go"); return; }
  sfx("countdown-tick");
}
/** Results verdict, as the results card opens (after the finish cue). */
export function result(won: boolean): void {
  sfx(won ? "result-win" : "result-lose");
  caption(won ? "You take the table" : "The lodge keeps its crown");
}
export function achievement(): void { sfx("achievement-unlock"); caption("Achievement unlocked"); }
export function lessonComplete(): void { sfx("lesson-complete"); caption("Lesson complete"); }
export function hint(): void { sfx("hint-chime"); }
export function undo(): void { sfx("undo-sweep"); }

// -- the hearth loop and the music stem -------------------------------------------------------
const RATE = 22050;
/** js/audio.js blip(): an oscillator with an 8 ms linear attack to `gain`, then an exponential decay to 0.0001 over `dur`. */
async function renderBlip(index: number, freq: number, dur: number, type: "sine" | "triangle"): Promise<void> {
  const off = new OfflineAudioContext(1, Math.round((dur + 0.02) * RATE), RATE);
  const osc = off.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const gain = off.createGain();
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, dur);
  osc.connect(gain).connect(off.destination);
  osc.start();
  const r = await off.startRendering();
  notes[index] = createClip(r);
  rendered++;
}
const SCALE = [262, 294, 330, 392, 440, 523, 587];
/** Rendered notes: index i < 7 the scale (0.55 s), 7..13 their fifths (0.4 s), 14 the low triangle (1.3 s). */
const notes: AudioClip[] = [];
const NOTE_COUNT = SCALE.length * 2 + 1;
let rendered = 0;
function renderNotes(): void {
  const failed = (e: unknown): void => console.warn(`audio: ${String(e)}`);
  SCALE.forEach((f, i) => {
    renderBlip(i, f, 0.55, "sine").catch(failed);
    renderBlip(SCALE.length + i, f * 1.5, 0.4, "sine").catch(failed);
  });
  renderBlip(SCALE.length * 2, 131, 1.3, "triangle").catch(failed);
}
const stream = createStream("audio-variants");
let ambience: Sound | null = null;
let nextStep = 0;
let step = 0;
let intensity = 0;
let fifthAt = -1;
let fifthNote = 0;
/** A score raises the music's density for a while (js/audio.js excite). */
export function excite(): void { intensity = Math.min(1, intensity + 0.4); }
/** A hidden window: the loop stops and the music holds (js/audio.js setBackgrounded). */
export function setSuspended(on: boolean): void {
  suspended = on;
  if (on) { try { ambience?.stop(); } catch { /* gone */ } ambience = null; }
}
function music(gainKey: number, clip: AudioClip | undefined): void {
  if (!clip) return;
  try { playClip(clip, { bus: "music", gain: gainKey * LEVEL.music }); } catch { /* the mixer is full */ }
}

/** Each frame once the mixer runs: the hearth loop, then the music's steps (every 320 ms) by mixer time. */
export function update(): void {
  if (context.state !== "running" || suspended) return; // starting the loop and the music still waits for the mixer
  const now = context.currentTime;
  if (bonusAt >= 0 && now >= bonusAt) { bonusAt = -1; sfx("score-bonus"); }
  try {
    const amb = clips.get(AMBIENCE);
    // The loop is normalized to -20 LUFS: lifted toward the old synth level (js/audio.js gain 1.6).
    if (amb && !ambience) { ambience = playClip(amb, { bus: "effects", gain: 1.6 * LEVEL.ambience, loop: true }); return; }
    if (rendered < NOTE_COUNT) return;
  } catch (e) { console.warn(`audio: ${String(e)}`); return; }
  if (fifthAt >= 0 && now >= fifthAt) { fifthAt = -1; music(0.06, notes[SCALE.length + fifthNote]); }
  if (now < nextStep) return;
  nextStep = Math.max(now, nextStep) + 0.32;
  step++;
  const dense = intensity > 0 ? 2 : 4;
  if (step % dense === 0) {
    const i = Math.floor(stream.next() * SCALE.length);
    music(0.11, notes[i]);
    if (stream.next() < 0.3 + intensity * 0.2) { fifthNote = i; fifthAt = now + 0.18; }
  }
  if (step % 16 === 0) music(0.09, notes[SCALE.length * 2]);
  intensity = Math.max(0, intensity - 0.02);
}
