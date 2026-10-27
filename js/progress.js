// Five Dice — the save's pure parts, shared by the engine client
// (native/platform.ts, native/main.ts) and the node tests: the progress
// document (the browser build's shape, unchanged: journey stars and bests,
// challenges, daily bests, achievements, lifetime totals, active days), the
// browser build's cloud save read as that document, the two-device merge,
// a finished table's progression and achievements, this device's casual
// boards from the round history, and the game options kept in the account's
// settings with the browser build's settings keys they are migrated from.

/** A fresh progress document. */
export function freshProgress() {
  return {
    v: 1, rev: 0, journey: {}, challenges: {}, achievements: {},
    totals: { games: 0, wins: 0, points: 0, avalanches: 0 },
    streakDays: [], bestDaily: {},
  };
}

/** A stored document as progress (missing fields filled), or null when it is not a v1 progress document. */
export function asProgress(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.v !== 1) return null;
  const f = freshProgress();
  return { ...f, ...doc, totals: { ...f.totals, ...(doc.totals && typeof doc.totals === 'object' ? doc.totals : {}) }, v: 1 };
}

/** The browser build's cloud save (the JS SDK's saveJSON text of the progress document), or null. */
export function readForeign(text) {
  if (!text) return null;
  try { return asProgress(JSON.parse(text)); } catch { return null; }
}

/**
 * Merge two progress documents: the larger total of each counter, the union of
 * cleared journey stages / challenges / achievements / active days, and the
 * better best score and star count per stage, challenge and daily table.
 */
export function mergeProgress(remote, local) {
  const a = { ...freshProgress(), ...(remote && typeof remote === 'object' ? remote : {}) };
  const b = { ...freshProgress(), ...(local && typeof local === 'object' ? local : {}) };
  const num = (x) => (Number.isFinite(x) ? x : 0);
  const out = freshProgress();
  out.rev = Math.max(num(a.rev), num(b.rev)) + 1;
  for (const k of Object.keys(out.totals)) out.totals[k] = Math.max(num(a.totals?.[k]), num(b.totals?.[k]));
  for (const key of ['journey', 'challenges']) {
    for (const id of new Set([...Object.keys(a[key] || {}), ...Object.keys(b[key] || {})])) {
      const x = a[key]?.[id] || {}, y = b[key]?.[id] || {};
      const rec = { done: !!(x.done || y.done), best: Math.max(num(x.best), num(y.best)) };
      if (key === 'journey') rec.stars = Math.max(num(x.stars), num(y.stars));
      out[key][id] = rec;
    }
  }
  for (const id of new Set([...Object.keys(a.achievements || {}), ...Object.keys(b.achievements || {})])) {
    const x = a.achievements?.[id], y = b.achievements?.[id];
    out.achievements[id] = x && y ? { at: Math.min(num(x.at) || Infinity, num(y.at) || Infinity) } : (x || y);
    if (out.achievements[id].at === Infinity) out.achievements[id] = { at: 0 };
  }
  out.streakDays = [...new Set([...(a.streakDays || []), ...(b.streakDays || [])])].sort().slice(-60);
  for (const id of new Set([...Object.keys(a.bestDaily || {}), ...Object.keys(b.bestDaily || {})])) {
    out.bestDaily[id] = Math.max(num(a.bestDaily?.[id]), num(b.bestDaily?.[id]));
  }
  return out;
}

// Static achievement metadata: stable lowercase keys, idempotent unlocks.
export const ACHIEVEMENTS = [
  { key: 'first_table',      name: 'First Table',      desc: 'Win your first table.' },
  { key: 'lodge_keeper',     name: 'Lodge Keeper',     desc: 'Earn the 35-point upper bonus.' },
  { key: 'avalanche_caller', name: 'Avalanche Caller', desc: 'Score an Avalanche (five of a kind).' },
  { key: 'weekly_regular',   name: 'Weekly Regular',   desc: 'Win tables on seven different days.' },
  { key: 'mastery_stage',    name: 'Mastery Stage',    desc: 'Win a journey mastery stage.' },
  { key: 'century_nights',   name: 'Century Nights',   desc: 'Finish 100 tables — at your own pace.' },
];

/**
 * A finished table's progression (the browser build's Platform.updateProgressFromResult
 * and checkAchievements, unchanged): updates `p` in place and returns the newly
 * unlocked achievement keys. `day` is the platform's UTC date, `now` its time in ms.
 */
export function applyResult(p, r, day, now) {
  p.rev = (p.rev || 0) + 1;
  p.totals.games += 1;
  p.totals.points += r.score?.grand || 0;
  if (r.stats?.avalanches) p.totals.avalanches += r.stats.avalanches;
  if (r.status === 'won') {
    p.totals.wins += 1;
    if (!p.streakDays.includes(day)) p.streakDays.push(day);
    if (p.streakDays.length > 60) p.streakDays = p.streakDays.slice(-60);
    if (r.mode === 'journey') {
      const cur = p.journey[r.contentId] || {};
      const stars = r.invalid === 0 ? 3 : (r.score?.grand || 0) > 0 ? 2 : 1;
      p.journey[r.contentId] = {
        done: true,
        best: Math.max(cur.best || 0, r.score?.grand || 0),
        stars: Math.max(cur.stars || 0, stars),
      };
    }
    if (r.mode === 'daily') {
      const cur = p.bestDaily[r.contentId] || 0;
      p.bestDaily[r.contentId] = Math.max(cur, r.score?.grand || 0);
    }
    if (r.mode === 'challenge') {
      const cur = p.challenges[r.contentId] || {};
      p.challenges[r.contentId] = { done: true, best: Math.max(cur.best || 0, r.score?.grand || 0) };
    }
  }
  const newly = [];
  const push = (key) => { if (!p.achievements[key]) { p.achievements[key] = { at: now }; newly.push(key); } };
  if (r.status === 'won') push('first_table');
  if (r.stats?.upperBonuses > 0) push('lodge_keeper');
  if (r.stats?.avalanches > 0) push('avalanche_caller');
  if (p.streakDays.length >= 7) push('weekly_regular');
  if (r.status === 'won' && r.mode === 'journey' && /^j\d+$/.test(r.contentId) && Number(r.contentId.slice(1)) % 8 === 0) push('mastery_stage');
  if (p.totals.games >= 100) push('century_nights');
  return newly;
}

/** Which finished tables a casual (this device's) board lists. */
export function boardMatches(board, r) {
  if (board === 'daily') return r.mode === 'daily';
  if (board === 'journey') return r.mode === 'journey' && r.status === 'won';
  if (board === 'challenge') return r.mode === 'challenge';
  if (board.startsWith('daily:')) return r.contentId === board.slice(6);
  if (board.startsWith('challenge:')) return r.contentId === board.slice(10);
  return r.mode === board;
}

/** This device's board: its finished tables of that kind, best grand total first (top 50). */
export function localBoard(results, board, name) {
  return (results || [])
    .filter((r) => boardMatches(board, r))
    .sort((a, b) => (b.score?.grand || 0) - (a.score?.grand || 0))
    .slice(0, 50)
    .map((r) => ({ name, me: true, score: r.score?.grand || 0 }));
}

/** The round history kept on the device (the browser build kept 200 results). */
export const RESULTS_MAX = 200;
export function pushResult(results, r) {
  const out = [...(Array.isArray(results) ? results : []), r];
  return out.length > RESULTS_MAX ? out.slice(-RESULTS_MAX) : out;
}

// --- the game's options --------------------------------------------------------------
export const THEME_IDS = ['hearth', 'pinewood', 'frostfall', 'starlit', 'ember-night'];
export const PALETTE_IDS = ['default', 'deuteranopia', 'protanopia', 'tritanopia'];
export const CAMERA_IDS = ['standard', 'low', 'overhead'];
/**
 * The game's options (the browser build's defaultSettings less what the
 * runtime's Options now own: volumes, mute, graphics, reduced motion, high
 * contrast, larger text and the key/pad bindings).
 */
export const OPTION_DEFAULTS = {
  theme: 'hearth', palette: 'default', cameraTilt: 'standard', captions: false,
  leftHanded: false, holdToConfirm: false, haptics: true, timingAssist: false, tutorialsDone: {},
};

/** A stored option value, or undefined when it is not one. */
export function checkOption(key, v) {
  if (key === 'theme') return typeof v === 'string' && THEME_IDS.includes(v) ? v : undefined;
  if (key === 'palette') return typeof v === 'string' && PALETTE_IDS.includes(v) ? v : undefined;
  if (key === 'cameraTilt') return typeof v === 'string' && CAMERA_IDS.includes(v) ? v : undefined;
  if (key === 'tutorialsDone') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
    const out = {};
    for (const [k, x] of Object.entries(v)) if (x === true) out[k] = true;
    return out;
  }
  if (key in OPTION_DEFAULTS) return typeof v === 'boolean' ? v : undefined;
  return undefined;
}

// The browser build's account settings: its settings document mirrored key by
// key (Platform.saveSettings → patchSettings: SYNCED_SETTINGS), the language
// helper's ui.language and the options panel's audio.options /
// graphics.gpu.<profile> slots.
export const BROWSER_KEYS = [
  'theme', 'graphics', 'muted', 'volMusic', 'volEffects', 'volAmbience', 'volVoice', 'captions',
  'reducedMotion', 'highContrast', 'palette', 'largeText', 'leftHanded', 'holdToConfirm',
  'haptics', 'timingAssist', 'cameraTilt', 'ui.language', 'audio.options',
];
/** Whether a legacy settings key is the browser build's (removed once migrated). */
export function isBrowserKey(k) { return BROWSER_KEYS.includes(k) || String(k).startsWith('graphics.gpu.'); }
