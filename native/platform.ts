// The game's data and the StarHermit platform, on the runtime's modules:
// - progress (journey stars and bests, challenges, daily bests,
//   achievements, lifetime totals, active days) is the browser build's
//   progress document {v: 1, rev, journey, challenges, achievements, totals,
//   streakDays, bestDaily}, unchanged (js/progress.js): it is the game's save
//   (starhermit:storage `saves`) on the device and in the player's cloud
//   slot, two devices' copies merged on a conflict (mergeProgress: progress
//   only grows). The slot the browser build wrote (the JS SDK's saveJSON of
//   the same document, key game:<slug>) shows as foreign and is merged in and
//   replaced once;
// - the round history (the last 200 finished tables, this device's casual
//   boards), the saved table (js/session.js autosave) and the guest's display
//   name stay on the device (starhermit:storage `storage`), as the browser
//   build kept them in localStorage;
// - the game's own options (table theme, colour-vision palette, camera,
//   captions, left-handed trays, hold to confirm, haptics, timing assistance,
//   finished lessons) are `settings` (game.<key>, synced with the account);
//   the browser build's account settings (its settings document mirrored key
//   by key, the language helper's ui.language and the options panel's
//   audio.options / graphics.gpu.* slots) are migrated, then the old keys
//   removed. Volumes, mute, graphics, language, reduced motion, high contrast,
//   text size and the bindings are the runtime's Options;
// - the player (signed in or a guest), the invite link, the platform's clock
//   (the daily's UTC date, the replay envelope's offset), the global
//   high-score board, and posting a finished table's grand total through
//   score-script.js (a practice session whose socket carries
//   { type: 'result', scores }, as the JS SDK's submitScores did; the script
//   range-checks it) with the rank on that board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions,
  type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import {
  OPTION_DEFAULTS, asProgress as parse, checkOption, freshProgress as fresh, isBrowserKey, mergeProgress, readForeign,
} from "../js/progress.js";

export interface Progress {
  v: number; rev: number;
  journey: Record<string, { done: boolean; best: number; stars: number }>;
  challenges: Record<string, { done: boolean; best: number }>;
  achievements: Record<string, { at: number }>;
  totals: { games: number; wins: number; points: number; avalanches: number };
  streakDays: string[]; bestDaily: Record<string, number>;
}
export const freshProgress = fresh as () => Progress;
export const asProgress = parse as (doc: unknown) => Progress | null;

export const RESULTS_KEY = "fivedice:results";
export const PROFILE_KEY = "fivedice:profile";

// --- the save ------------------------------------------------------------------------
let current: Progress = freshProgress();
let lastSavedAt = 0;
let adoptHook: (() => void) | null = null;
/** fn() when the account's copy (another device, the browser build) was merged in. */
export function onAdopt(fn: () => void): void { adoptHook = fn; }
/** The live progress document (finished tables update it in place, then call saveProgress). */
export function progress(): Progress { return current; }
export function saveProgress(): void {
  try { saves.save(current as unknown as JsonValue, { schema: 1 }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
function replaceProgress(next: Progress): void {
  const s = current as unknown as Record<string, unknown>;
  for (const k of Object.keys(s)) delete s[k];
  Object.assign(s, next);
}
/** Merges another copy into the device's (and saves); whether anything changed. */
function adopt(other: unknown): boolean {
  const remote = asProgress(other);
  if (!remote) return false;
  const next = asProgress(mergeProgress(remote, current))!;
  // mergeProgress bumps rev: compare without it so an unchanged copy does not loop save → status → merge.
  const same = (a: Progress, b: Progress): boolean => JSON.stringify({ ...a, rev: 0 }) === JSON.stringify({ ...b, rev: 0 });
  if (same(next, current)) return false;
  replaceProgress(next);
  saveProgress();
  adoptHook?.();
  return true;
}
saves.onConflict((local, remote) => {
  const merged = mergeProgress(asProgress(remote.data), asProgress(local?.data ?? null));
  return { merged: (asProgress(merged) ?? freshProgress()) as unknown as JsonValue };
});
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    adopt(cur.data);
  }
});
/** The browser build's cloud save (its progress document as JSON text): merged in, saved over it once. */
export function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  adopt(readForeign(old.text ?? null));
  try { saves.save(current as unknown as JsonValue, { schema: 1, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
}
/** For the status line: offline (a guest) | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "uploading" || st === "foreign" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the device's documents (the saved table, history, the guest's name) ------------------
/** The browser build's Platform.saveLocal / loadLocal over the device's storage (js/session.js calls them). */
export const local = {
  saveLocal(key: string, value: unknown): void {
    const k = key.startsWith("fivedice:") ? key : `fivedice:${key}`;
    try {
      if (value == null) storage.remove(k);
      else storage.set(k, JSON.stringify(value));
    } catch (e) { console.warn(`storage ${k}: ${String(e)}`); }
  },
  loadLocal(key: string): unknown {
    const k = key.startsWith("fivedice:") ? key : `fivedice:${key}`;
    try {
      const raw = storage.getText(k);
      return raw == null ? null : JSON.parse(raw);
    } catch { return null; }
  },
  /** The platform's clock minus the device's, for the replay envelope. */
  serverOffsetMs(): number { return nowMs() - Date.now(); },
  /** Set by the round controller (native/main.ts): the finished table's record and replay envelope. */
  recordResult(_result: unknown, _envelope: unknown): void { /* replaced in main.ts */ },
};

// --- the game's options ------------------------------------------------------------------
export interface Options {
  theme: string; palette: string; cameraTilt: string; captions: boolean; leftHanded: boolean;
  holdToConfirm: boolean; haptics: boolean; timingAssist: boolean; tutorialsDone: Record<string, boolean>;
}
export const options: Options = { ...OPTION_DEFAULTS, tutorialsDone: {} } as Options;
type Key = keyof Options;
const KEYS = Object.keys(options) as Key[];
const optionListeners = new Set<() => void>();
export function onOptionsChange(fn: () => void): void { optionListeners.add(fn); }
function optionsChanged(): void { for (const fn of optionListeners) fn(); }
const check = (key: Key, v: unknown): unknown => checkOption(key, v);
function readOption(key: Key): boolean {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return false; }
  const ok = check(key, v);
  if (ok === undefined) return false;
  (options as unknown as Record<string, unknown>)[key] = ok;
  return true;
}
/** A migrated value, kept unless this game set the key since. */
function adoptOption(key: Key, value: unknown): void {
  const v = check(key, value);
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v as JsonValue);
    (options as unknown as Record<string, unknown>)[key] = v;
    optionsChanged();
  } catch { /* keep the device's */ }
}
/** Changes one of the game's options (device and account). */
export function setOption<K extends Key>(key: K, value: Options[K]): void {
  if (JSON.stringify(options[key]) === JSON.stringify(value)) return;
  options[key] = value;
  try { store.set(key, value as unknown as JsonValue); } catch (e) { console.warn(`option ${key}: ${String(e)}`); }
  optionsChanged();
}
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) if ((KEYS as string[]).includes(key)) adoptOption(key as Key, store.legacy(key));
  for (const key of keys) if (isBrowserKey(key)) store.removeLegacy(key);
}

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  replaceProgress(asProgress(cur?.data ?? null) ?? freshProgress());
  for (const k of KEYS) readOption(k);
  store.onChange((key) => {
    if (!(KEYS as string[]).includes(key)) return;
    readOption(key as Key);
    optionsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  optionsChanged();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player and the clock -----------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
let playerHook: (() => void) | null = null;
/** fn() when the player signs in or out. */
export function onPlayer(fn: () => void): void { playerHook = fn; }
function refreshPlayer(): void {
  invite = null;
  board = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => { refreshPlayer(); playerHook?.(); });

/** Now in ms by the platform's clock when it has answered, else the device's. */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}
/** Today's UTC date (YYYY-MM-DD) by nowMs(): the daily's seed. */
export function todayUTC(): string { return new Date(nowMs()).toISOString().slice(0, 10); }

// --- the StarHermit high-score board ------------------------------------------------------
let board: Leaderboard | null = null;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}
export interface Posted { posted: boolean; rank: number | null }

/** Signed in only: post a finished table's grand total through score-script.js; never rejects. */
export async function postLeaderboard(total: number): Promise<Posted> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (v: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(v);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}

export interface BoardEntry { name: string; me: boolean; score: number }
/** Signed in: the global high-score board (every hosted board of the browser build read it), else null. */
export async function globalBoard(): Promise<BoardEntry[] | null> {
  const me = player();
  if (!me) return null;
  const b = await highScoreBoard();
  if (!b) return null;
  const r = await leaderboards.entries(b.id, { pageSize: 50 });
  return r.items.map((e) => ({ name: String(e.displayName || e.username || "Player").slice(0, 24), me: e.userId === me.userId, score: e.score }));
}
