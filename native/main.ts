// Five Dice on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), the lodge AI (js/ai.js),
// content (js/content.js), the session with its state machine, undo, lesson
// gating, autosave and replay envelope (js/session.js) and the progression
// (js/progress.js) are the browser build's, unchanged in what they decide;
// this module is what js/main.js and js/ui.js did around them — the overlay
// flow (title → Practice / Daily / Journey / Learn / Challenges / Profile &
// Scores / Help / Settings; the table with its 3-2-1 countdown ⇄ pause →
// results → next / play again / title), the saved table (Resume Table on the
// title), the turn controls (Roll, hold by die buttons, keys 1–5 or taps on
// the 3D dice, score a category on the card, Hint, Undo turn, Leave table),
// the presentation-paced AI turns, the authoritative clock of time-limited
// tables, the event presentation (a sound with its caption, an announcement,
// a toast, haptics and the dice animation per rules event), progression and
// achievements, the round history and this device's boards, posting finished
// tables through score-script.js and the lifecycle (a hidden window pauses
// the table and saves its snapshot, as the browser build's visibilitychange
// did). The overlays and HUD are drawn by screens.ts (starhermit:ui), the
// table by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): the session's clock
// (js/session.js clock.now) reads them, and the countdown, the AI's pacing,
// the results' delay, the clock heartbeat and toasts wait on the same steps,
// so play scripts replay exactly.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onQuit, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onTouch, vibrate } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Session, clock } from "../js/session.js";
import { JOURNEY, PRACTICE_DIFFICULTIES, STAGE_NAMES, TRAILS, dailyForDate, getTheme, practiceDef, validateContent } from "../js/content.js";
import { currentPlayer, getCategory } from "../js/rules.js";
import { ACHIEVEMENTS, applyResult, localBoard, pushResult } from "../js/progress.js";
import * as audio from "./audio.ts";
import { N, T } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyTheme, initStyles } from "./style.ts";

// -- the shapes this client reads ------------------------------------------------------------
export interface Player { name: string; isAI: boolean; difficulty: string | null; scores: Record<string, number | null>; invalid: number }
export interface State {
  status: string; terminalReason: string | null; clock: number; round: number; current: number; rollsLeft: number;
  dice: number[]; held: boolean[]; hasRolled: boolean; rollsPerTurn: number; disabledCategories: string[];
  goal: { type: string; target?: number }; limits: { totalMs: number | null }; players: Player[];
}
export interface Def {
  id: string; name: string; mode: string; seed: string; players: { name: string; isAI?: boolean; difficulty?: string }[];
  assists: { undo: boolean; hints: boolean }; ranked: boolean; trail?: string; stage?: number; mastery?: boolean; day?: string;
  goal?: { type: string; target?: number }; par?: { score: number }; blurb?: string;
  tutorial?: { steps: { require: { type: string; category?: string }; text: string }[] };
}
export interface ResultRecord {
  contentId: string; mode: string; status: string; reason: string; invalid: number; durationMs: number;
  score: { upper: number; bonus: number; lower: number; grand: number };
  rankings: { player: number; name: string; grand: number; upper: number; bonus: number; lower: number }[];
}
interface SessionApi {
  machine: string; def: Def | null; state: State | null;
  startRound(def: Def): void; beginActive(): void; pause(reason?: string): void; resume(): void; background(): void;
  transition(to: string, reason: string): void;
  dispatch(cmd: Record<string, unknown>): { error?: string };
  isHumanTurn(): boolean; roll(): { error?: string }; toggleHold(i: number): { error?: string }; scoreCategory(c: string): { error?: string };
  giveUp(): { error?: string }; hint(): unknown; undoAllowed(): boolean; undo(): { error?: string };
  currentLessonStep(): { text: string } | null; aiCommands(): Record<string, unknown>[] | null;
  saveSnapshot(): void; restoreSnapshot(): unknown; hasSnapshot(): boolean; nowMs(): number;
  outcome(): { won: boolean }; resultRecord(): ResultRecord;
}
type Ev = Record<string, unknown> & { type: string };

export type Modal = "title" | "practice" | "learn" | "journey" | "challenges" | "help" | "settings" | "profile" | "pause" | "results" | "confirm";

const STEP_MS = 1000 / 60;
let fixedMs = 0;
clock.now = () => fixedMs;
clock.wall = () => platform.nowMs();

export const options = platform.options;
export const session = new Session(platform.local, (e: Ev) => onEvent(e)) as unknown as SessionApi;

export const app = {
  /** The overlay stack (the top one is shown; the title sits under its menus). */
  modals: [] as Modal[],
  modalOpened: 0,
  hud: false,
  countdown: null as number | null,
  toast: null as { text: string; until: number } | null,
  caption: null as { text: string; until: number } | null,
  confirm: null as { text: () => string; yes: () => void } | null,
  results: null as { record: ResultRecord; won: boolean; newly: string[] } | null,
  lb: null as null | "posting" | platform.Posted,
  board: null as null | { key: string; label: string; entries: platform.BoardEntry[] | null; source: string },
  drawer: null as null | "left" | "right",
  focusDie: 0,
  /** The stage's rectangle this frame (logical px, window coordinates). */
  stage: { x: 0, y: 0, w: 1, h: 1 },
  guestName: "Guest",
};
export let results: unknown[] = [];

// ------------------------------------------------------------------ helpers
export const now = (): number => fixedMs;
export function announce(text: string): void { if (text) ui.announce(String(text).slice(0, 500)); }
/** ui.js toast(): one at a time, 2.6 s by default. */
export function toast(text: string, ms = 2600): void { app.toast = { text, until: fixedMs + ms }; }
function haptic(ms: number): void { if (options.haptics) { try { vibrate(ms); } catch { /* no motor */ } } }
const CVD: Record<string, { select: string; legal: string }> = {
  // Colour-vision-safe selection and legal-move colours (always with shape/label cues as well).
  deuteranopia: { select: "#e69f00", legal: "#56b4e9" },
  protanopia: { select: "#f0e442", legal: "#0094e0" },
  tritanopia: { select: "#ff8fb8", legal: "#00b38a" },
};
/** The table theme in the chosen colour-vision palette. */
export function theme(): render.Theme {
  const t = getTheme(options.theme) as render.Theme;
  const p = CVD[options.palette];
  return p ? { ...t, ...p } : t;
}
/** Seat names that are generic labels rather than proper names. */
export function playerName(name: string): string {
  const n = String(name ?? "");
  if (n === "You" || n === "Lodge Guide" || n === "Guest") return T(n);
  const m = /^Player (\d+)$/.exec(n);
  return m ? T("Player {n}", { n: m[1]! }) : n;
}

// ------------------------------------------------------------------ overlays
export const topModal = (): Modal | null => app.modals[app.modals.length - 1] ?? null;
export function openModal(m: Modal): void {
  app.modals.push(m);
  app.modalOpened = frame().frame;
  ui.setFocus(null);
}
/** The top overlay closed: back to the one under it (a menu from the title returns to the title). */
export function closeModal(): void {
  const was = app.modals.pop();
  if (was === "confirm") app.confirm = null;
  app.modalOpened = frame().frame;
  ui.setFocus(null);
  if (!app.modals.length && !app.hud) openModal("title");
}
function clearModals(): void { app.modals.length = 0; app.confirm = null; }
export function showTitle(): void {
  clearModals();
  setHud(false);
  openModal("title");
}
/** `text` is a function so the question follows a language change. */
export function confirm(text: () => string, yes: () => void): void {
  app.confirm = { text, yes };
  openModal("confirm");
}
function setHud(on: boolean): void {
  app.hud = on;
  app.drawer = null;
  render.setActive(true);
}

// ------------------------------------------------------------------ the table
export function defTitle(def: Def | null): string {
  if (!def) return "";
  if (def.mode === "journey" && def.trail) {
    const trail = (TRAILS as { id: string; name: string }[]).find((t) => t.id === def.trail);
    const step = ((def.stage ?? 1) - 1) % 8;
    return T("{trail} {n} — {stage}", { trail: T(trail?.name ?? def.trail), n: step + 1, stage: def.mastery ? T("Mastery Stage") : T((STAGE_NAMES as string[])[step]!) });
  }
  if (def.mode === "daily" && def.day) return T("Daily Table — {day}", { day: def.day });
  if (def.mode === "practice") {
    const diff = (PRACTICE_DIFFICULTIES as Record<string, { name: string }>)[String(def.id).split("-")[1] ?? ""];
    const name = T(diff?.name ?? "Hearth");
    return def.players.length === 1 ? T("Practice — {name} (solo)", { name }) : T("Practice — {name}", { name });
  }
  return T(def.name);
}
export function startContent(def: Def): void {
  clearModals();
  app.countdown = null;
  app.results = null;
  app.lb = null;
  session.startRound(def);
}
/** Practice with a fresh seed by the platform's clock (content.js practiceDef's default seed). */
export function practice(opts: { difficulty: string; humans?: number; aiOpponents?: number }): Def {
  return practiceDef({ ...opts, seed: `practice:${opts.difficulty}:${Math.floor(platform.nowMs()).toString(36)}` }) as Def;
}
export function startDaily(): void { startContent(dailyForDate(new Date(platform.nowMs())) as Def); }
export function dailyDef(): Def { return dailyForDate(new Date(platform.nowMs())) as Def; }
export function resumeSaved(): void {
  const snap = session.restoreSnapshot();
  if (!snap) { toast(T("No saved table found.")); showTitle(); return; }
  clearModals();
  openModal("pause");
}

function guard(fn: () => void): void { audio.uiClick(); fn(); }
export function tryRoll(): void { guard(() => { const r = session.roll(); if (r.error === "not-your-turn") toast(T("Wait for your turn.")); }); }
export function tryHold(i: number): void {
  guard(() => {
    const r = session.toggleHold(i);
    if (r?.error === "not-your-turn") toast(T("Wait for your turn."));
    else if (r?.error === "lesson-gated") { /* the banner explains */ }
    else if (r?.error) toast(T("Hold is not available right now."));
  });
}
export function tryScore(cat: string): void {
  guard(() => {
    if (options.holdToConfirm) {
      const c = getCategory(cat) as { name: string } | null;
      confirm(() => T("Score {cat}?", { cat: T(c?.name ?? cat) }), () => { session.scoreCategory(cat); });
    } else session.scoreCategory(cat);
  });
}
export function tryHint(): void { session.hint(); }
export function tryUndo(): void {
  const r = session.undo();
  if (r.error) toast(T("Undo is not available here."));
  else {
    render.updateState(session.state!, {});
    scheduleAI();
  }
}
export function cycleCamera(): void {
  const order = ["standard", "low", "overhead"];
  platform.setOption("cameraTilt", order[(order.indexOf(options.cameraTilt) + 1) % order.length]!);
}
export function giveUp(): void {
  const r = session.giveUp();
  if (r.error) toast(T("Nothing to leave."));
}
export function leaveTable(): void {
  confirm(() => T("Leave this table? The round will be recorded as a forfeit."), () => giveUp());
}
export function togglePause(): void {
  if (session.machine === "active" || session.machine === "tutorial") {
    session.pause("user");
    clearModals();
    openModal("pause");
  } else if (session.machine === "paused") {
    clearModals();
    session.resume();
  }
}
export function resumeTable(): void { clearModals(); session.resume(); }
/** Keyboard / pad die focus (ui.js moveDieFocus). */
export function moveDieFocus(delta: number): void {
  if (!session.state) return;
  app.focusDie = (app.focusDie + delta + 5) % 5;
  ui.setFocus(`die-${app.focusDie}`);
}

// ------------------------------------------------------------------ timers on the fixed steps
const timers: { at: number; fn: () => void; id: number }[] = [];
let timerId = 0;
function after(ms: number, fn: () => void): number { timers.push({ at: fixedMs + ms, fn, id: ++timerId }); return timerId; }
function cancel(id: number): void { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); }
function runTimers(): void {
  for (;;) {
    const i = timers.findIndex((t) => t.at <= fixedMs);
    if (i < 0) return;
    const [t] = timers.splice(i, 1);
    t!.fn();
  }
}
const reduced = (): boolean => preferences().reducedMotion;
/** Timing assistance (Settings › Controls & access): slower AI turns and longer toasts. */
const pace = (ms: number): number => (options.timingAssist ? ms * 1.6 : ms);

// AI turns: presentation-paced, every command still flows through the session's validated dispatch path.
let aiTimer = 0;
function scheduleAI(): void {
  cancel(aiTimer);
  if (!session.state || session.state.status !== "active") return;
  if (session.machine !== "active" && session.machine !== "tutorial") return;
  const cmds = session.aiCommands();
  if (!cmds || !cmds.length) return;
  aiTimer = after(pace(reduced() ? 120 : 650), () => {
    if (session.machine !== "active" && session.machine !== "tutorial") return;
    let done = false;
    for (const cmd of cmds) {
      const r = session.dispatch(cmd);
      if (r.error) { done = true; break; }
      done = session.state!.status !== "active" || !currentPlayer(session.state!).isAI;
      if (done) break;
    }
    if (!done) scheduleAI();
  });
}
// The authoritative clock of time-limited tables: a 'note' heartbeat each second, so the rules enforce the limit.
let ticker = 0;
function startClockTicker(): void {
  stopClockTicker();
  const beat = (): void => {
    ticker = after(1000, beat);
    const st = session.state;
    if (!st || st.status !== "active") return;
    if (session.machine !== "active" && session.machine !== "tutorial") return;
    if (st.limits.totalMs != null) session.dispatch({ type: "note" });
  };
  ticker = after(1000, beat);
}
function stopClockTicker(): void { cancel(ticker); ticker = 0; }

function runCountdown(): void {
  if (reduced()) { session.beginActive(); scheduleAI(); return; }
  app.countdown = 3;
  announce(T("Table ready. Starting in 3."));
  audio.countdownTick();
  const tick = (): void => {
    if (app.countdown == null) return;
    app.countdown -= 1;
    if (app.countdown <= 0) {
      app.countdown = null;
      audio.countdownTick(true);
      session.beginActive();
      announce(T("Go!"));
      scheduleAI();
      return;
    }
    audio.countdownTick();
    after(700, tick);
  };
  after(700, tick);
}

// ------------------------------------------------------------------ session events (main.js handleEvent + ui.js handleSessionEvent)
function invalidText(reason: string): string {
  const TEXT: Record<string, string> = {
    "no-rolls-left": N("No rolls left — choose a category to score."),
    "must-roll-first": N("Roll the dice first."),
    "category-closed": N("That category is already filled."),
    "category-disabled": N("That category is closed at this table."),
    "unknown-category": N("Unknown category."),
    "round-over": N("The table is over."),
  };
  return TEXT[reason] ? T(TEXT[reason]!) : T("Action not allowed ({reason}).", { reason });
}
function catName(id: string): string { const c = getCategory(id) as { name: string } | null; return c ? T(c.name) : id; }
function onEvent(e: Ev): void {
  switch (e.type) {
    case "machine": {
      const to = String(e.to), reason = String(e.reason);
      if (to === "countdown") runCountdown();
      if (to === "resolving") {
        stopClockTicker();
        after(reduced() ? 200 : 1400, () => {
          const st = session.state!;
          session.transition("results", st.terminalReason ?? "");
          const won = session.outcome().won;
          audio.result(won);
          showResults(session.resultRecord(), won);
          session.transition("progression", "results-shown");
        });
      }
      if ((to === "active" || to === "tutorial") && reason.startsWith("resume")) scheduleAI();
      break;
    }
    case "round": {
      const st = e.state as State, def = e.def as Def;
      clearModals();
      setHud(true);
      render.updateState(st, {});
      startClockTicker();
      const me = currentPlayer(st);
      announce(me.name === "You" ? T("{table}. Your turn.", { table: defTitle(def) }) : T("{table}. {name} to act.", { table: defTitle(def), name: playerName(me.name) }));
      break;
    }
    case "game-event": {
      const ev = e.event as Ev & { player?: number; category?: string; points?: number; reason?: string; rolled?: number[] };
      const st = e.state as State;
      audio.onGameEvent(ev as never);
      if (ev.type === "roll") render.updateState(st, { animate: true, rolled: ev.rolled });
      else if (ev.type === "hold") render.updateState(st, { animate: true });
      else render.updateState(st, {});
      if (ev.type === "score") {
        const who = st.players[ev.player!]!.name;
        const vars = { name: playerName(who), n: ev.points!, cat: catName(ev.category!) };
        announce(who === "You" ? T("You scored {n} on {cat}", vars) : T("{name} scored {n} on {cat}", vars));
        if (ev.player === 0) haptic(30);
      } else if (ev.type === "invalid") {
        announce(T("Invalid action: {reason}", { reason: invalidText(String(ev.reason)) }));
        toast(invalidText(String(ev.reason)));
      } else if (ev.type === "turn") {
        const who = st.players[ev.player!]!.name;
        announce(who === "You" ? T("Your turn") : T("{name}'s turn", { name: playerName(who) }));
        scheduleAI();
      } else if (ev.type === "roll" && ev.player === 0) haptic(12);
      break;
    }
    case "round-end": stopClockTicker(); break;
    case "undo": audio.undo(); toast(T("Turn restored")); render.updateState(session.state!, {}); break;
    case "invalid": announce(invalidText(String(e.reason))); toast(invalidText(String(e.reason))); break;
    case "lesson-blocked": {
      const step = session.currentLessonStep();
      toast(step ? T("Follow the lesson: {text}", { text: T(step.text) }) : String(e.message));
      break;
    }
    case "lesson-step":
      if (e.done && session.def) {
        platform.setOption("tutorialsDone", { ...options.tutorialsDone, [session.def.id]: true });
        audio.lessonComplete();
        toast(T("Lesson complete — finish the table!"));
      }
      break;
    case "hint": {
      audio.hint();
      const h = e as Ev & { reasonKey?: string; reason?: string; category?: string; points?: number };
      const text = h.reasonKey ? T(h.reasonKey, { cat: h.category ? catName(h.category) : "", n: h.points ?? "" }) : h.reason;
      toast(text || T("Try the highlighted option"));
      announce(text || T("Hint shown"));
      break;
    }
    case "while-away": {
      const a = e.away as { min: number; round: number; name: string } | undefined;
      const summary = !a ? String(e.summary) : a.name === "You"
        ? T("Table restored. You were away {min} min; round {round}, your turn.", a)
        : T("Table restored. You were away {min} min; round {round}, {name} to act.", { ...a, name: playerName(a.name) });
      toast(summary, 5000);
      announce(summary);
      break;
    }
    default:
  }
}

// ------------------------------------------------------------------ results, progression, the boards
let lastAchievements: string[] = [];
platform.local.recordResult = (result: unknown): void => {
  results = pushResult(results, result);
  platform.local.saveLocal(platform.RESULTS_KEY, results);
  lastAchievements = applyResult(platform.progress(), result, platform.todayUTC(), Math.floor(platform.nowMs()));
  platform.saveProgress();
  if (lastAchievements.length) {
    audio.achievement();
    toast(T("🏆 Achievement unlocked: {names}", {
      names: lastAchievements.map((k) => T(ACHIEVEMENTS.find((a: { key: string }) => a.key === k)?.name ?? k)).join(", "),
    }));
  }
};
function showResults(record: ResultRecord, won: boolean): void {
  setHud(false);
  app.results = { record, won, newly: lastAchievements };
  app.lb = null;
  clearModals();
  openModal("results");
  // StarHermit high-score board: the finished card's grand total (signed in; not lessons or forfeits).
  if (record.mode !== "learn" && record.reason !== "gave-up" && platform.signedIn()) {
    app.lb = "posting";
    const mine = app.results;
    void platform.postLeaderboard(record.score.grand).then((p) => { if (app.results === mine) app.lb = p; });
  }
  announce(won ? T("You won with {n} points", { n: record.score.grand }) : T("Table over. You scored {n} points", { n: record.score.grand }));
}
export function leaderboardLine(): string | null {
  const lb = app.lb;
  if (!lb) return null;
  if (lb === "posting") return T("Posting score to the leaderboard…");
  if (!lb.posted) return T("Score not posted to the leaderboard.");
  return lb.rank ? T("Leaderboard rank: #{rank}", { rank: lb.rank }) : T("Score posted to the leaderboard.");
}
/** The results card's next table: the journey's next stage after a win, then Play again. */
export function nextStage(): Def | null {
  const def = session.def;
  if (def?.mode === "journey" && app.results?.won) return (JOURNEY.find((j: Def) => j.stage === (def.stage ?? 0) + 1) as Def) ?? null;
  return null;
}
export function playAgain(): void {
  const def = session.def;
  if (!def) return;
  startContent(def.mode === "practice" ? practice({ difficulty: def.id.split("-")[1] || "hearth", humans: def.players.filter((p) => !p.isAI).length, aiOpponents: def.players.filter((p) => p.isAI).length }) : def);
}
/** Profile & Scores: loads a board (this device's tables; signed in, the global high-score board). */
export function loadBoard(key: string, label: string): void {
  const name = platform.signedIn() ? platform.displayName() : app.guestName;
  const local = localBoard(results, key, name);
  const ticket = { key, label, entries: null as platform.BoardEntry[] | null, source: N("casual (local)") };
  app.board = ticket;
  if (!platform.signedIn() || key === "journey") { ticket.entries = local; return; }
  platform.globalBoard().then((g) => {
    if (app.board !== ticket) return;
    if (g) { ticket.entries = g; ticket.source = N("global"); } else ticket.entries = local;
  }, () => { if (app.board === ticket) ticket.entries = local; });
}
export function setGuestName(name: string): void {
  app.guestName = name.trim().slice(0, 20) || "Guest";
  platform.local.saveLocal(platform.PROFILE_KEY, { name: app.guestName, guest: true });
}

// ------------------------------------------------------------------ account
export function copyInvite(): void {
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(T("Invite link copied to clipboard")); }
  catch { toast(T("Could not copy the invite link")); }
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }
export function statusLine(): string {
  if (!platform.signedIn()) return T("Local play — fully offline-capable");
  const st = platform.syncState();
  const sync = { synced: N("cloud synced"), saving: N("saving to cloud…"), error: N("cloud sync error"), offline: N("offline") }[st];
  return T("Signed in as {name} · {sync}", { name: platform.displayName() || "…", sync: T(sync) });
}
export function syncLabel(): string {
  const st = platform.syncState();
  if (st === "synced") return T("Progress is synced to your account.");
  if (st === "saving") return T("Saving to the cloud…");
  if (st === "error") return T("Cloud sync failed — will retry; progress is safe on this device.");
  return T("Offline — progress is stored on this device.");
}

// ------------------------------------------------------------------ input
onAction((e) => {
  if (!e.pressed) return;
  if (topModal()) return; // dialogs and the title take their own keys
  if (!app.hud || !session.state) return;
  const fresh = frame().frame !== app.modalOpened;
  if (e.action === "pause") { if (fresh && !ui.capturingKeys()) togglePause(); return; }
  if (app.countdown != null) return;
  const hold = /^hold(\d)$/.exec(e.action);
  if (hold) { tryHold(Number(hold[1])); return; }
  switch (e.action) {
    case "roll": tryRoll(); break;
    case "hint": tryHint(); break;
    case "undo": tryUndo(); break;
    case "camera": cycleCamera(); break;
    case "focus_prev": moveDieFocus(-1); break;
    case "focus_next": moveDieFocus(1); break;
    default: // confirm: the focused die or button activates itself
  }
});
// Taps on the 3D dice (main.js canvas pointer input): a press and release within 12 px and 500 ms on the stage,
// decided after the frame's UI is built so presses on the HUD's widgets stay theirs.
const presses: { kind: "down" | "up"; x: number; y: number }[] = [];
let down: { x: number; y: number; t: number; overUi: boolean } | null = null;
let lastTouch = -1e9;
onPointerButton((e) => { if (e.button === 0 && fixedMs - lastTouch > 600) presses.push({ kind: e.pressed ? "down" : "up", x: e.x, y: e.y }); });
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = fixedMs;
  if (e.phase === "start") presses.push({ kind: "down", x: e.x, y: e.y });
  else if (e.phase === "end") presses.push({ kind: "up", x: e.x, y: e.y });
  else if (e.phase !== "move") down = null;
});
function stageInput(): void {
  const sc = ui.preferences().scale;
  const f = frame();
  for (const p of presses.splice(0)) {
    const lx = p.x / sc, ly = p.y / sc;
    const s = app.stage;
    const inStage = lx >= s.x && lx <= s.x + s.w && ly >= s.y && ly <= s.y + s.h;
    if (p.kind === "down") { down = inStage && app.hud && !topModal() ? { x: p.x, y: p.y, t: fixedMs, overUi: ui.pointerOver() } : null; continue; }
    const d = down;
    down = null;
    if (!d || d.overUi || !inStage || topModal() || !app.hud) continue;
    if (Math.hypot(p.x - d.x, p.y - d.y) >= 12 * sc || fixedMs - d.t >= 500) continue; // a drag: no commit
    const die = render.pickDie(p.x, p.y, f.width, f.height);
    if (die != null) {
      const r = session.toggleHold(die);
      if (r?.error === "not-your-turn") toast(T("Wait for your turn."));
      else if (r?.error && r.error !== "lesson-gated") toast(T("Hold is not available right now."));
    }
  }
}

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
let cameraTilt = "";
function applyOptions(): void {
  const t = theme();
  applyTheme(t);
  render.setTheme(t);
  if (cameraTilt !== options.cameraTilt) {
    render.applyCameraPreset(options.cameraTilt, cameraTilt === "");
    cameraTilt = options.cameraTilt;
  }
}
platform.onOptionsChange(applyOptions);
platform.onAdopt(() => toast(T("Progress is synced to your account.")));
let wasSignedIn = false;
platform.onPlayer(() => {
  if (wasSignedIn && !platform.signedIn()) toast(T("Signed out of StarHermit — progress keeps saving on this device."));
  wasSignedIn = platform.signedIn();
});
audio.onCaption((key, vars) => { if (options.captions) app.caption = { text: T(key, vars), until: fixedMs + pace(2600) }; });

onStart(() => {
  setFixedRate(60);
  initStyles(theme());
  platform.initPlatform();
  wasSignedIn = platform.signedIn();
  const r = platform.local.loadLocal(platform.RESULTS_KEY);
  results = Array.isArray(r) ? r : [];
  const prof = platform.local.loadLocal(platform.PROFILE_KEY) as { name?: string } | null;
  app.guestName = typeof prof?.name === "string" && prof.name ? prof.name.slice(0, 20) : "Guest";
  audio.loadSfx();
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  applyOptions();
  // Dev-time content validation surfaces problems loudly instead of silently.
  const problems = validateContent() as unknown[];
  if (problems.length) console.warn(`Content validation: ${problems.length} problem(s): ${JSON.stringify(problems).slice(0, 400)}`);
  showTitle();
  if (session.hasSnapshot()) toast(T("A saved table is waiting — Resume from the title menu."));
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(T("Signed out of StarHermit — progress keeps saving on this device.")));
let hidden = false;
onSuspend(() => {
  hidden = true;
  audio.setSuspended(true);
  // Backgrounding pauses solo simulation and keeps the snapshot (main.js visibilitychange).
  session.background();
  session.saveSnapshot();
  if (app.hud && session.machine === "paused" && !topModal()) openModal("pause");
  platform.flush();
});
onResume(() => { hidden = false; audio.setSuspended(false); });
onQuit(() => { session.saveSnapshot(); platform.flush(); });

onFixedUpdate(() => {
  if (hidden) return;
  fixedMs += STEP_MS;
  runTimers();
  if (app.toast && app.toast.until < fixedMs) app.toast = null;
  if (app.caption && app.caption.until < fixedMs) app.caption = null;
});
let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
});
onRender(() => {
  drawScreens();
  stageInput();
  render.update(frameDt);
});
