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
// sound's gain. The music's oscillator notes are rendered once into clips
// (createClip) with the old envelope (8 ms attack, exponential decay); the
// synthesized stand-ins the browser build played while a sample decoded (and
// its synthesized room noise before the hearth loop) are not ported (a live
// synthesis graph makes clip loads fail on the engine's web runtime), so a
// clip still loading is silent. Clips load once the mixer runs (natively at
// once, in a browser after the first press), one at a time. Seeded variants
// (createStream('audio-variants')) keep the music the same on replays.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Sound } from "starhermit:audio";
import { createStream, getCategory, UPPER_BONUS_THRESHOLD } from "../js/rules.js";

const LEVEL = { music: 0.5 * 0.45, effects: 0.8, ambience: 0.4 * 0.4 };
const CLIPS = [
  "dice-roll", "die-hold", "die-release", "score-points", "score-avalanche", "score-hand", "score-zero", "score-bonus",
  "turn-start", "invalid-move", "finish-cards", "finish-table", "hint-chime", "undo-sweep", "ui-click", "countdown-tick",
  "countdown-go", "result-win", "result-lose", "achievement-unlock", "lesson-complete",
];
const AMBIENCE = "ambience-hearth";

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let suspended = false;
let captionHook: ((key: string, vars?: Record<string, string | number>) => void) | null = null;
/** fn(key, vars) for each cue's caption (an English key the UI translates; shown when captions are on). */
export function onCaption(fn: (key: string, vars?: Record<string, string | number>) => void): void { captionHook = fn; }
const caption = (key: string, vars?: Record<string, string | number>): void => captionHook?.(key, vars);

function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }
function pump(): void {
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }

/** Plays a sample (once loaded). */
function sfx(name: string, gain = 1): void {
  const clip = clips.get(name);
  if (!clip || suspended) return;
  try { playClip(clip, { bus: "effects", gain: LEVEL.effects * gain }); }
  catch { clips.delete(name); load(name); } // a clip the mixer lost: load it again
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
function blipClip(freq: number, dur: number, type: "sine" | "triangle"): AudioClip {
  const n = Math.round((dur + 0.02) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const ph = (t * freq) % 1;
    const wave = type === "sine" ? Math.sin(ph * 2 * Math.PI) : 1 - 4 * Math.abs(ph - 0.5);
    const env = t < 0.008 ? t / 0.008 : Math.pow(0.0001, Math.min(1, (t - 0.008) / Math.max(0.001, dur - 0.008)));
    out[i] = wave * env;
  }
  return createClip([out], RATE);
}
const SCALE = [262, 294, 330, 392, 440, 523, 587];
/** Rendered notes: index i < 7 the scale (0.55 s), 7..13 their fifths (0.4 s), 14 the low triangle (1.3 s). */
const notes: AudioClip[] = [];
const NOTE_COUNT = SCALE.length * 2 + 1;
function renderNote(i: number): AudioClip {
  if (i < SCALE.length) return blipClip(SCALE[i]!, 0.55, "sine");
  if (i < SCALE.length * 2) return blipClip(SCALE[i - SCALE.length]! * 1.5, 0.4, "sine");
  return blipClip(131, 1.3, "triangle");
}
const stream = createStream("audio-variants");
let ambience: Sound | null = null;
let nextStep = 0;
let step = 0;
let intensity = 0;
let nextRender = 0;
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

/** Each frame: the clips once the mixer runs (one at a time), the music's notes rendered one each 0.2 s after them,
 * the hearth loop, then the music's steps (every 320 ms) by mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    load(AMBIENCE);
    for (const name of CLIPS) load(name);
    return;
  }
  pump();
  if (suspended) return;
  const now = context.currentTime;
  if (bonusAt >= 0 && now >= bonusAt) { bonusAt = -1; sfx("score-bonus"); }
  try {
    const amb = clips.get(AMBIENCE);
    // The loop is normalized to -20 LUFS: lifted toward the old synth level (js/audio.js gain 1.6).
    if (amb && !ambience) { ambience = playClip(amb, { bus: "effects", gain: 1.6 * LEVEL.ambience, loop: true }); return; }
    if (loading || queue.length) return;
    if (notes.length < NOTE_COUNT) {
      if (now >= nextRender) { notes.push(renderNote(notes.length)); nextRender = now + 0.2; }
      return;
    }
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
