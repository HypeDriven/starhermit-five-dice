// Five Dice — deterministic rules engine.
// Pure module: no DOM, no rendering, no I/O. Same file runs in browser and Node.
//
// Rules contract:
//  - 2–4 players share one table. On a turn you roll five dice up to
//    `rollsPerTurn` times, hold chosen dice between rolls, then fill exactly
//    one open scoring category on your card. When every card is full the game
//    ends and the highest grand total wins.
//  - Legal actions are exposed via listLegalActions(); play, hints, tutorials
//    and the AI all use the same API. State changes happen only through
//    applyCommand(); identical (version, seed, command list) always yields
//    identical state hashes.
//  - Scores are integers; formatting lives in presentation.
//  - Tiebreak order: primary objective completion (upper bonuses), fewer
//    invalid actions, lower authoritative elapsed time, then stable seat id.

export const RULES_VERSION = 1;
export const DICE_COUNT = 5;
export const DEFAULT_ROLLS = 3;
export const UPPER_BONUS_THRESHOLD = 63;
export const UPPER_BONUS = 35;

// ---------------------------------------------------------------------------
// Scoring categories (original lodge-flavored names; classic dice math)
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  { id: 'kindling',     name: 'Kindling',      section: 'upper', kind: 'face',      face: 1, desc: 'Total of 1s' },
  { id: 'embers',       name: 'Embers',        section: 'upper', kind: 'face',      face: 2, desc: 'Total of 2s' },
  { id: 'flames',       name: 'Flames',        section: 'upper', kind: 'face',      face: 3, desc: 'Total of 3s' },
  { id: 'timbers',      name: 'Timbers',       section: 'upper', kind: 'face',      face: 4, desc: 'Total of 4s' },
  { id: 'beams',        name: 'Beams',         section: 'upper', kind: 'face',      face: 5, desc: 'Total of 5s' },
  { id: 'peaks',        name: 'Peaks',         section: 'upper', kind: 'face',      face: 6, desc: 'Total of 6s' },
  { id: 'triple-hearth',name: 'Triple Hearth', section: 'lower', kind: 'ofKind',    n: 3, desc: 'Three of a kind — total of all dice' },
  { id: 'grand-hearth', name: 'Grand Hearth',  section: 'lower', kind: 'ofKind',    n: 4, desc: 'Four of a kind — total of all dice' },
  { id: 'full-lodge',   name: 'Full Lodge',    section: 'lower', kind: 'fullHouse', points: 25, desc: 'Three of one face, two of another — 25' },
  { id: 'ridge-path',   name: 'Ridge Path',    section: 'lower', kind: 'straight',  n: 4, points: 30, desc: 'Run of four — 30' },
  { id: 'summit-trail', name: 'Summit Trail',  section: 'lower', kind: 'straight',  n: 5, points: 40, desc: 'Run of five — 40' },
  { id: 'avalanche',    name: 'Avalanche',     section: 'lower', kind: 'ofKind',    n: 5, points: 50, desc: 'Five of a kind — 50' },
  { id: 'open-snow',    name: 'Open Snow',     section: 'lower', kind: 'chance',    desc: 'Any roll — total of all dice' },
];

export function getCategory(id) {
  return CATEGORIES.find((c) => c.id === id) || null;
}

// ---------------------------------------------------------------------------
// Seeded random streams (rules / decoration / audiovisual stay separate)
// ---------------------------------------------------------------------------

export function hashSeed(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createStream(seed) {
  // mulberry32
  let s = (typeof seed === 'string' ? hashSeed(seed) : seed >>> 0) || 0x9e3779b9;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), // inclusive
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    getState: () => s,
  };
}

// ---------------------------------------------------------------------------
// Dice math
// ---------------------------------------------------------------------------

export function faceCounts(dice) {
  const counts = [0, 0, 0, 0, 0, 0, 0]; // index = face value
  for (const d of dice) if (d >= 1 && d <= 6) counts[d]++;
  return counts;
}

export function diceSum(dice) {
  let s = 0;
  for (const d of dice) s += d;
  return s;
}

export function longestRun(dice) {
  // Length of the longest straight run among distinct faces.
  const seen = new Set(dice);
  let best = 0;
  let cur = 0;
  for (let f = 1; f <= 6; f++) {
    if (seen.has(f)) { cur++; best = Math.max(best, cur); }
    else cur = 0;
  }
  return best;
}

// Points the given dice would earn in a category. Pure; never null.
export function scoreCategory(dice, catId) {
  const cat = getCategory(catId);
  if (!cat) throw new Error(`scoreCategory: unknown category ${catId}`);
  const counts = faceCounts(dice);
  switch (cat.kind) {
    case 'face':
      return counts[cat.face] * cat.face;
    case 'ofKind': {
      const has = counts.some((c) => c >= cat.n);
      if (!has) return 0;
      return cat.points != null ? cat.points : diceSum(dice);
    }
    case 'fullHouse': {
      const sorted = counts.filter((c) => c > 0).sort((a, b) => a - b);
      return (sorted.length === 2 && sorted[0] === 2 && sorted[1] === 3) ? cat.points : 0;
    }
    case 'straight':
      return longestRun(dice) >= cat.n ? cat.points : 0;
    case 'chance':
      return diceSum(dice);
    default:
      throw new Error(`scoreCategory: bad kind ${cat.kind}`);
  }
}

// Full score breakdown for a card (null entries count as zero).
export function totalsBreakdown(scores, enabledIds = CATEGORIES.map((c) => c.id)) {
  let upper = 0;
  let lower = 0;
  for (const cat of CATEGORIES) {
    if (!enabledIds.includes(cat.id)) continue;
    const v = scores[cat.id];
    if (v == null) continue;
    if (cat.section === 'upper') upper += v; else lower += v;
  }
  const bonus = upper >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS : 0;
  return { upper, bonus, lower, grand: upper + bonus + lower };
}

export function upperProgress(scores) {
  let upper = 0;
  for (const cat of CATEGORIES) {
    if (cat.section === 'upper' && scores[cat.id] != null) upper += scores[cat.id];
  }
  return upper;
}

// ---------------------------------------------------------------------------
// Game creation
// ---------------------------------------------------------------------------

// def: {
//   seed, mode, contentId, rulesV, v (content version),
//   players: [{ name, isAI, difficulty }],
//   rollsPerTurn, disabledCategories: [], ranked,
//   goal: { type:'win'|'score', target } — 'win' default for tables,
//   limits: { totalMs }, par: { score }, mechanics: [],
//   assists: { undo, hints }
// }
export function createGame(def) {
  if (!def || typeof def !== 'object') throw new Error('createGame: def required');
  if (!Array.isArray(def.players) || def.players.length < 1 || def.players.length > 4) {
    throw new Error('createGame: 1–4 players required');
  }
  const disabled = Array.isArray(def.disabledCategories) ? def.disabledCategories.slice() : [];
  const enabled = CATEGORIES.map((c) => c.id).filter((id) => !disabled.includes(id));
  if (enabled.length === 0) throw new Error('createGame: no categories enabled');
  const rollsPerTurn = def.rollsPerTurn ?? DEFAULT_ROLLS;
  if (rollsPerTurn < 1 || rollsPerTurn > 5) throw new Error('createGame: bad rollsPerTurn');
  return {
    v: RULES_VERSION,
    seed: String(def.seed ?? 'table'),
    contentId: def.contentId || null,
    mode: def.mode || 'practice',
    ranked: !!def.ranked,
    rng: hashSeed(`${def.seed}:rules`) || 0x9e3779b9, // rules stream state
    tick: 0,
    nextCmdId: 1,
    status: 'active',          // active | finished | aborted
    terminalReason: null,      // cards-complete | time-limit | gave-up
    clock: 0,                  // authoritative elapsed ms (max of cmd.at)
    turnStartAt: 0,
    round: 1,
    current: 0,
    rollsLeft: rollsPerTurn,
    dice: new Array(DICE_COUNT).fill(0),
    held: new Array(DICE_COUNT).fill(false),
    hasRolled: false,
    rollsPerTurn,
    disabledCategories: disabled,
    goal: def.goal?.type === 'score'
      ? { type: 'score', target: Math.floor(def.goal.target) }
      : { type: 'win' },
    limits: { totalMs: def.limits?.totalMs ?? null },
    par: { score: def.par?.score ?? null },
    mechanics: Array.isArray(def.mechanics) ? def.mechanics.slice() : [],
    players: def.players.map((p, i) => ({
      name: String(p.name || `Player ${i + 1}`).slice(0, 24),
      isAI: !!p.isAI,
      difficulty: p.difficulty || null,
      scores: Object.fromEntries(enabled.map((id) => [id, null])),
      invalid: 0,
      elapsedMs: 0,
    })),
  };
}

export function enabledCategories(state) {
  return CATEGORIES.filter((c) => !state.disabledCategories.includes(c.id));
}

export function cardIsFull(state, playerIdx) {
  const p = state.players[playerIdx];
  return Object.values(p.scores).every((v) => v !== null);
}

export function currentPlayer(state) {
  return state.players[state.current];
}

// ---------------------------------------------------------------------------
// Legality queries (shared by play, hints, tutorials and the AI)
// ---------------------------------------------------------------------------

export function canRoll(state) {
  return state.status === 'active' && state.rollsLeft > 0;
}

export function canHold(state, index) {
  return state.status === 'active' && state.hasRolled && state.rollsLeft > 0 &&
    Number.isInteger(index) && index >= 0 && index < DICE_COUNT;
}

export function checkScore(state, category) {
  if (state.status !== 'active') return { ok: false, reason: 'round-over' };
  const cat = getCategory(category);
  if (!cat) return { ok: false, reason: 'unknown-category' };
  if (state.disabledCategories.includes(category)) return { ok: false, reason: 'category-disabled' };
  if (!state.hasRolled) return { ok: false, reason: 'must-roll-first' };
  if (currentPlayer(state).scores[category] !== null) return { ok: false, reason: 'category-closed' };
  return { ok: true, reason: null };
}

// One legal-action snapshot for UI, hints, tutorials and the AI.
export function listLegalActions(state) {
  if (state.status !== 'active') {
    return { canRoll: false, holdable: [], scoreable: [], mustScore: false };
  }
  const scoreable = state.hasRolled
    ? enabledCategories(state)
        .filter((c) => currentPlayer(state).scores[c.id] === null)
        .map((c) => c.id)
    : [];
  return {
    canRoll: canRoll(state),
    holdable: state.hasRolled && state.rollsLeft > 0
      ? Array.from({ length: DICE_COUNT }, (_, i) => i) : [],
    scoreable,
    mustScore: state.hasRolled && state.rollsLeft === 0,
  };
}

// Points each open category would earn the current player right now.
export function previewScores(state) {
  const out = {};
  if (state.status !== 'active' || !state.hasRolled) return out;
  for (const id of listLegalActions(state).scoreable) {
    out[id] = scoreCategory(state.dice, id);
  }
  return out;
}

// Hints call the exact same legality/scoring API as play.
export function getHint(state) {
  const legal = listLegalActions(state);
  if (state.status !== 'active') return null;
  if (!state.hasRolled) return { action: 'roll', reason: 'Start your turn by rolling all five dice.' };
  let best = null;
  for (const id of legal.scoreable) {
    const pts = scoreCategory(state.dice, id);
    if (!best || pts > best.points) best = { category: id, points: pts };
  }
  if (legal.canRoll && (!best || best.points === 0)) {
    const holds = suggestHolds(state);
    return { action: 'roll', hold: holds, reason: 'Nothing scores yet — keep the promising dice and reroll.' };
  }
  if (legal.canRoll && best && best.points < 10 && legal.scoreable.length > 6) {
    const holds = suggestHolds(state);
    return { action: 'roll', hold: holds, reason: `${getCategory(best.category).name} only scores ${best.points}; one more roll may do better.` };
  }
  return {
    action: 'score', category: best.category, points: best.points,
    reason: `${getCategory(best.category).name} scores ${best.points} right now.`,
  };
}

// Simple hold suggestion toward the strongest current plan.
export function suggestHolds(state) {
  const dice = state.dice;
  const counts = faceCounts(dice);
  let bestFace = 6;
  for (let f = 6; f >= 1; f--) if (counts[f] > counts[bestFace]) bestFace = f;
  const open = new Set(listLegalActions(state).scoreable);
  // Straight chase when a run of 4 exists and a straight is open.
  if ((open.has('ridge-path') || open.has('summit-trail')) && longestRun(dice) >= 4 && counts[bestFace] < 3) {
    const seen = new Set();
    return dice.map((d) => (seen.has(d) ? false : (seen.add(d), true)));
  }
  return dice.map((d) => d === bestFace);
}

// ---------------------------------------------------------------------------
// Command application — the only way rules state ever changes
// ---------------------------------------------------------------------------

function cloneState(state) {
  return {
    ...state,
    dice: state.dice.slice(),
    held: state.held.slice(),
    disabledCategories: state.disabledCategories.slice(),
    goal: { ...state.goal },
    limits: { ...state.limits },
    par: { ...state.par },
    mechanics: state.mechanics.slice(),
    players: state.players.map((p) => ({ ...p, scores: { ...p.scores } })),
  };
}

// Deterministic die roll from the serialized rules stream.
function rollDie(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return 1 + Math.floor(u * 6);
}

function recordInvalid(state, events, reason) {
  currentPlayer(state).invalid += 1;
  events.push({ type: 'invalid', reason, player: state.current });
}

function advanceTurn(state, events) {
  state.current = (state.current + 1) % state.players.length;
  if (state.current === 0) state.round += 1;
  state.rollsLeft = state.rollsPerTurn;
  state.dice = new Array(DICE_COUNT).fill(0);
  state.held = new Array(DICE_COUNT).fill(false);
  state.hasRolled = false;
  state.turnStartAt = state.clock;
  events.push({ type: 'turn', player: state.current, round: state.round });
}

function finish(state, events, reason) {
  state.status = reason === 'gave-up' ? 'aborted' : 'finished';
  state.terminalReason = reason;
  const me = state.players[state.current];
  me.elapsedMs += Math.max(0, state.clock - state.turnStartAt);
  events.push({ type: 'finish', reason, rankings: rankPlayers(state) });
}

// cmd: { id, at, type:'roll'|'hold'|'score'|'giveUp', index?, category? }
// Returns { state, events } on success or { state, error } on rejection.
// The input state is never mutated; the returned state is a new object.
export function applyCommand(state, cmd) {
  if (!cmd || typeof cmd !== 'object') return { state, error: 'malformed-command' };
  if (!Number.isInteger(cmd.id) || cmd.id < 1) return { state, error: 'bad-command-id' };
  if (cmd.id < state.nextCmdId) return { state, error: 'duplicate-command' }; // idempotent reject
  if (cmd.id > state.nextCmdId) return { state, error: 'out-of-order-command' };
  const at = Number.isFinite(cmd.at) && cmd.at >= 0 ? Math.floor(cmd.at) : state.clock;

  const s = cloneState(state);
  s.nextCmdId = cmd.id + 1;
  s.tick += 1;
  s.clock = Math.max(s.clock, at);
  const events = [];

  if (s.status !== 'active') return { state, error: 'round-over' };

  // Authoritative clock: total time limit enforced on every command.
  if (s.limits.totalMs != null && s.clock > s.limits.totalMs) {
    finish(s, events, 'time-limit');
    return { state: s, events };
  }

  switch (cmd.type) {
    case 'roll': {
      if (!canRoll(s)) {
        recordInvalid(s, events, 'no-rolls-left');
        return { state: s, events };
      }
      const rolledIdx = [];
      for (let i = 0; i < DICE_COUNT; i++) {
        if (!s.held[i]) { s.dice[i] = rollDie(s); rolledIdx.push(i); }
      }
      s.rollsLeft -= 1;
      s.hasRolled = true;
      events.push({ type: 'roll', dice: s.dice.slice(), rolled: rolledIdx, rollsLeft: s.rollsLeft, player: s.current });
      return { state: s, events };
    }
    case 'hold': {
      if (!Number.isInteger(cmd.index) || cmd.index < 0 || cmd.index >= DICE_COUNT) {
        return { state, error: 'out-of-bounds' };
      }
      if (!canHold(s, cmd.index)) {
        recordInvalid(s, events, state.hasRolled ? 'no-rolls-left' : 'must-roll-first');
        return { state: s, events };
      }
      s.held[cmd.index] = !s.held[cmd.index];
      events.push({ type: 'hold', index: cmd.index, held: s.held[cmd.index], player: s.current });
      return { state: s, events };
    }
    case 'score': {
      const check = checkScore(s, cmd.category);
      if (!check.ok) {
        if (check.reason === 'round-over') return { state, error: 'round-over' };
        if (check.reason === 'unknown-category') return { state, error: 'unknown-category' };
        recordInvalid(s, events, check.reason);
        return { state: s, events };
      }
      const me = currentPlayer(s);
      const points = scoreCategory(s.dice, cmd.category);
      me.scores[cmd.category] = points;
      me.elapsedMs += Math.max(0, s.clock - s.turnStartAt);
      s.turnStartAt = s.clock;
      events.push({
        type: 'score', player: s.current, category: cmd.category, points,
        dice: s.dice.slice(), breakdown: totalsBreakdown(me.scores, categoriesOn(s)),
      });
      if (s.players.every((_, i) => cardIsFull(s, i))) {
        finish(s, events, 'cards-complete');
      } else {
        advanceTurn(s, events);
      }
      return { state: s, events };
    }
    case 'giveUp': {
      finish(s, events, 'gave-up');
      return { state: s, events };
    }
    case 'note': // heartbeat / clock sync; affects only the clock + limits
      return { state: s, events };
    default:
      return { state, error: 'unknown-command' };
  }
}

function categoriesOn(state) {
  return CATEGORIES.map((c) => c.id).filter((id) => !state.disabledCategories.includes(id));
}

// ---------------------------------------------------------------------------
// Rankings and result mapping
// ---------------------------------------------------------------------------

// Sorted player indexes, best first. Tiebreaks: grand total, upper bonuses
// (primary objective completion), fewer invalid actions, lower elapsed time,
// then stable seat id.
export function rankPlayers(state) {
  const rows = state.players.map((p, i) => {
    const b = totalsBreakdown(p.scores, categoriesOn(state));
    return {
      player: i, name: p.name, isAI: p.isAI, ...b,
      invalid: p.invalid, elapsedMs: p.elapsedMs,
    };
  });
  rows.sort((a, b) =>
    b.grand - a.grand ||
    b.bonus - a.bonus ||
    a.invalid - b.invalid ||
    a.elapsedMs - b.elapsedMs ||
    a.player - b.player);
  return rows;
}

// Did the given seat "win" under the table's goal?
export function playerWon(state, playerIdx) {
  if (state.status !== 'finished') return false;
  if (state.goal.type === 'score') {
    const b = totalsBreakdown(state.players[playerIdx].scores, categoriesOn(state));
    return b.grand >= state.goal.target;
  }
  const ranked = rankPlayers(state);
  return ranked.length > 0 && ranked[0].player === playerIdx;
}

// Leaderboard ordering of two finished results (negative = a ranks above b).
export function compareResults(a, b) {
  const rank = (r) => (r.status === 'won' ? 0 : r.status === 'lost' ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (a.score.grand !== b.score.grand) return b.score.grand - a.score.grand;
  if (a.invalid !== b.invalid) return a.invalid - b.invalid;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
  return String(a.sessionId).localeCompare(String(b.sessionId));
}

// ---------------------------------------------------------------------------
// Serialization, migration, hashing (replay + persistence)
// ---------------------------------------------------------------------------

export function serialize(state) {
  return JSON.stringify(state);
}

const MIGRATIONS = {
  // version N -> N+1 handlers live here as the schema evolves
};

export function deserialize(json) {
  const s = typeof json === 'string' ? JSON.parse(json) : json;
  if (!s || typeof s !== 'object' || !Array.isArray(s.players) || !Array.isArray(s.dice)) {
    throw new Error('deserialize: not a Five Dice state');
  }
  let v = s.v ?? 1;
  while (v < RULES_VERSION) {
    const mig = MIGRATIONS[v];
    if (!mig) throw new Error(`deserialize: no migration from v${v}`);
    Object.assign(s, mig(s));
    v = s.v;
  }
  return s;
}

export function hashState(state) {
  // Stable FNV-1a over the authoritative fields.
  const scorePart = state.players
    .map((p) => Object.values(p.scores).map((v) => (v == null ? '-' : v)).join(','))
    .join(';');
  const parts = [
    state.v, state.tick, state.status, state.terminalReason ?? '-',
    state.rng, state.round, state.current, state.rollsLeft, state.hasRolled ? 1 : 0,
    state.dice.join(','), state.held.map((h) => (h ? 1 : 0)).join(''),
    state.clock, scorePart,
    state.players.map((p) => `${p.invalid}.${p.elapsedMs}`).join(';'),
  ].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < parts.length; i++) {
    h ^= parts.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// Replay an envelope and report per-checkpoint validity (used by the
// authoritative validation script and by the property tests).
export function replay(envelope) {
  const def = envelope.init;
  let state = createGame(def);
  const checkpoints = [{ after: 0, hash: hashState(state) }];
  const events = [];
  for (const cmd of envelope.commands) {
    const r = applyCommand(state, cmd);
    if (r.error) return { ok: false, error: r.error, atCommand: cmd.id };
    state = r.state;
    events.push(...(r.events || []));
    checkpoints.push({ after: cmd.id, hash: hashState(state) });
  }
  return {
    ok: true,
    final: state,
    finalHash: hashState(state),
    checkpoints,
    events,
  };
}
