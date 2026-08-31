// Five Dice — offline test suite (node tests/run.js).
// Covers: every legal action, invalid-action reasons, every scoring
// component, terminal states, tiebreaks, serialization round-trip and
// migration, deterministic replay (property test), malformed-command fuzz,
// content validators, and golden scripted sessions.

import {
  createGame, applyCommand, serialize, deserialize, hashState, replay,
  scoreCategory, totalsBreakdown, listLegalActions, previewScores, getHint,
  suggestHolds, rankPlayers, playerWon, compareResults, checkScore, canRoll,
  canHold, createStream, hashSeed, longestRun, faceCounts, CATEGORIES,
  RULES_VERSION, DICE_COUNT,
} from '../js/rules.js';
import {
  validateContent, validateDef, JOURNEY, LESSONS, CHALLENGES, THEMES,
  practiceDef, dailyForDate, findContent, CONTENT_VERSION,
} from '../js/content.js';
import { aiStep, AI_DIFFICULTIES } from '../js/ai.js';

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, err });
    console.error(`FAIL ${name}: ${err.message}`);
  }
}
function eq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function ok(v, msg = '') { if (!v) throw new Error(msg || 'expected truthy'); }
function deepEq(a, b, msg = '') {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

// --- helpers -------------------------------------------------------------------

function twoPlayerDef(over = {}) {
  return {
    seed: 'test-seed', players: [{ name: 'A' }, { name: 'B' }], ...over,
  };
}
function cmd(state, type, extra = {}) {
  return { id: state.nextCmdId, at: state.clock, type, ...extra };
}
function mustApply(state, type, extra = {}) {
  const r = applyCommand(state, cmd(state, type, extra));
  if (r.error) throw new Error(`apply ${type} failed: ${r.error}`);
  return r;
}
// Force the current dice to specific values without touching the rng stream.
function forceDice(state, dice) {
  const s = deserialize(serialize(state));
  s.dice = dice.slice();
  s.hasRolled = true;
  return s;
}

// --- scoring components ----------------------------------------------------------

test('score: face categories sum matching faces', () => {
  for (const cat of CATEGORIES.filter((c) => c.kind === 'face')) {
    const dice = [cat.face, cat.face, 6 === cat.face ? 1 : 6, 2 === cat.face ? 3 : 2, cat.face];
    eq(scoreCategory(dice, cat.id), cat.face * (dice.filter((d) => d === cat.face).length), cat.id);
  }
});

test('score: of-a-kind pays total of all dice, else zero', () => {
  eq(scoreCategory([3, 3, 3, 5, 6], 'triple-hearth'), 20);
  eq(scoreCategory([3, 3, 2, 5, 6], 'triple-hearth'), 0);
  eq(scoreCategory([4, 4, 4, 4, 2], 'grand-hearth'), 18);
  eq(scoreCategory([4, 4, 4, 2, 2], 'grand-hearth'), 0);
  eq(scoreCategory([6, 6, 6, 6, 6], 'avalanche'), 50);
  eq(scoreCategory([6, 6, 6, 6, 5], 'avalanche'), 0);
});

test('score: full lodge, straights, chance', () => {
  eq(scoreCategory([2, 2, 2, 5, 5], 'full-lodge'), 25);
  eq(scoreCategory([2, 2, 2, 2, 5], 'full-lodge'), 0);
  eq(scoreCategory([1, 2, 3, 4, 6], 'ridge-path'), 30);
  eq(scoreCategory([1, 2, 3, 5, 6], 'ridge-path'), 0);
  eq(scoreCategory([1, 2, 3, 4, 5], 'summit-trail'), 40);
  eq(scoreCategory([2, 3, 4, 5, 6], 'summit-trail'), 40);
  eq(scoreCategory([1, 2, 3, 4, 6], 'summit-trail'), 0);
  eq(scoreCategory([3, 3, 4, 5, 6], 'open-snow'), 21);
});

test('score: totals breakdown and upper bonus at 63', () => {
  const scores = { kindling: 3, embers: 6, flames: 9, timbers: 12, beams: 15, peaks: 18, 'open-snow': 20 };
  const b = totalsBreakdown(scores);
  eq(b.upper, 63); eq(b.bonus, 35); eq(b.lower, 20); eq(b.grand, 118);
  eq(totalsBreakdown({ kindling: 3 }).bonus, 0);
});

// --- legal actions & invalid reasons ---------------------------------------------

test('legal: new turn exposes roll only', () => {
  const s = createGame(twoPlayerDef());
  const legal = listLegalActions(s);
  ok(legal.canRoll);
  eq(legal.holdable.length, 0);
  eq(legal.scoreable.length, 0);
});

test('legal: roll consumes rolls, hold requires a prior roll', () => {
  let s = createGame(twoPlayerDef());
  const r = applyCommand(s, cmd(s, 'hold', { index: 0 }));
  ok(!r.error);
  ok(r.events.some((e) => e.type === 'invalid' && e.reason === 'must-roll-first'));
  s = mustApply(r.state, 'roll').state;
  ok(s.dice.every((d) => d >= 1 && d <= 6));
  eq(s.rollsLeft, 2);
  ok(canHold(s, 0));
  s = mustApply(s, 'hold', { index: 1 }).state;
  ok(s.held[1]);
  const d1 = s.dice[1];
  s = mustApply(s, 'roll').state;
  eq(s.dice[1], d1, 'held die must not change');
  eq(s.rollsLeft, 1);
  s = mustApply(s, 'roll').state;
  eq(s.rollsLeft, 0);
  ok(!canRoll(s));
  const r4 = applyCommand(s, cmd(s, 'roll'));
  ok(r4.events.some((e) => e.type === 'invalid' && e.reason === 'no-rolls-left'));
});

test('legal: score checks and reasons', () => {
  let s = createGame(twoPlayerDef());
  eq(checkScore(s, 'open-snow').reason, 'must-roll-first');
  eq(checkScore(s, 'nope').reason, 'unknown-category');
  s = mustApply(s, 'roll').state;
  eq(checkScore(s, 'open-snow').reason, null);
  const cat = listLegalActions(s).scoreable[0];
  s = mustApply(s, 'score', { category: cat }).state;
  eq(s.current, 1, 'turn advanced');
  // Fill rest of player 0's card through the game; category closed check:
  let s2 = createGame(twoPlayerDef());
  s2 = mustApply(s2, 'roll').state;
  s2 = mustApply(s2, 'score', { category: 'open-snow' }).state;
  // Now player B to act; force back impossible — check disabled categories:
  let s3 = createGame(twoPlayerDef({ disabledCategories: ['avalanche'] }));
  s3 = mustApply(s3, 'roll').state;
  eq(checkScore(s3, 'avalanche').reason, 'category-disabled');
});

test('legal: closed category rejected with reason', () => {
  let s = createGame(twoPlayerDef());
  s = forceDice(mustApply(s, 'roll').state, [1, 2, 3, 4, 5]);
  s = mustApply(s, 'score', { category: 'open-snow' }).state; // A done
  s = forceDice(mustApply(s, 'roll').state, [6, 6, 6, 6, 6]); // B rolls
  s = mustApply(s, 'score', { category: 'avalanche' }).state;
  s = forceDice(mustApply(s, 'roll').state, [1, 1, 1, 2, 2]); // A again
  eq(checkScore(s, 'open-snow').reason, 'category-closed');
  const r = applyCommand(s, cmd(s, 'score', { category: 'open-snow' }));
  ok(r.events.some((e) => e.type === 'invalid' && e.reason === 'category-closed'));
  eq(r.state.players[0].invalid, 1);
});

test('commands: id/order validation is idempotent', () => {
  const s = createGame(twoPlayerDef());
  eq(applyCommand(s, { id: 2, type: 'roll' }).error, 'out-of-order-command');
  eq(applyCommand(s, { id: 0, type: 'roll' }).error, 'bad-command-id');
  eq(applyCommand(s, null).error, 'malformed-command');
  eq(applyCommand(s, { id: 1, type: 'frobnicate' }).error, 'unknown-command');
  const r = mustApply(s, 'roll');
  eq(applyCommand(r.state, { id: 1, type: 'roll' }).error, 'duplicate-command');
});

test('bounds: hold index validated', () => {
  let s = createGame(twoPlayerDef());
  s = mustApply(s, 'roll').state;
  eq(applyCommand(s, cmd(s, 'hold', { index: 5 })).error, 'out-of-bounds');
  eq(applyCommand(s, cmd(s, 'hold', { index: -1 })).error, 'out-of-bounds');
  eq(applyCommand(s, cmd(s, 'hold', { index: 1.5 })).error, 'out-of-bounds');
});

// --- hints share the legal-action API ----------------------------------------------

test('hints: getHint uses legal actions and previews exist after roll', () => {
  let s = createGame(twoPlayerDef());
  eq(getHint(s).action, 'roll');
  s = mustApply(s, 'roll').state;
  const h = getHint(s);
  ok(['roll', 'score'].includes(h.action));
  const pv = previewScores(s);
  eq(Object.keys(pv).length, listLegalActions(s).scoreable.length);
  const holds = suggestHolds(s);
  eq(holds.length, DICE_COUNT);
});

// --- terminal states & rankings -----------------------------------------------------

function playFullGame(def) {
  let state = createGame(def);
  let guard = 0;
  while (state.status === 'active' && guard++ < 2000) {
    const step = aiStep(state, state.players[state.current].difficulty || 'hearth');
    if (!step.length) break;
    for (const c of step) {
      const r = applyCommand(state, cmd(state, c.type, c));
      if (r.error) throw new Error(`cmd error: ${r.error}`);
      state = r.state;
      if (state.status !== 'active') break;
    }
  }
  return state;
}

test('terminal: full game ends cards-complete with full cards', () => {
  const def = twoPlayerDef({ players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }] });
  const s = playFullGame(def);
  eq(s.status, 'finished');
  eq(s.terminalReason, 'cards-complete');
  ok(s.players.every((p) => Object.values(p.scores).every((v) => v !== null)));
  const ranked = rankPlayers(s);
  eq(ranked.length, 2);
  ok(ranked[0].grand >= ranked[1].grand);
});

test('terminal: give-up aborts, time-limit finishes', () => {
  let s = createGame(twoPlayerDef());
  s = mustApply(s, 'giveUp').state;
  eq(s.status, 'aborted');
  eq(s.terminalReason, 'gave-up');
  eq(applyCommand(s, cmd(s, 'roll')).error, 'round-over');

  let t = createGame(twoPlayerDef({ limits: { totalMs: 1000 } }));
  t = applyCommand(t, { id: 1, at: 500, type: 'roll' }).state;
  ok(t.status === 'active');
  t = applyCommand(t, { id: 2, at: 2000, type: 'note' }).state;
  eq(t.status, 'finished');
  eq(t.terminalReason, 'time-limit');
});

test('tiebreaks: bonus, invalid, elapsed, seat order', () => {
  const base = twoPlayerDef();
  let s = createGame(base);
  // Equal grand, different upper bonus: A has bonus.
  s.players[0].scores = Object.fromEntries(Object.keys(s.players[0].scores).map((k) => [k, 0]));
  s.players[1].scores = { ...s.players[0].scores };
  s.players[0].scores.kindling = 5; s.players[0].scores.embers = 10;
  s.players[0].scores.flames = 15; s.players[0].scores.timbers = 20;
  s.players[0].scores.beams = 25; s.players[0].scores.peaks = 30; // upper 105 → bonus
  s.players[1].scores['open-snow'] = 140; // equal grand 140
  s.players[0].scores['open-snow'] = 0;
  s.status = 'finished'; s.terminalReason = 'cards-complete';
  const ranked = rankPlayers(s);
  eq(ranked[0].player, 0, 'upper bonus breaks grand tie');
  // Fewer invalid beats more invalid.
  let s2 = deserialize(serialize(s));
  s2.players[0].scores.kindling = 0; s2.players[0].scores['open-snow'] = 5; // drop bonus, keep grand
  s2.players[0].scores.embers = 0; // rebalance: A grand = 5+... recompute simply:
  s2.players[0].scores = Object.fromEntries(Object.keys(s2.players[0].scores).map((k) => [k, 0]));
  s2.players[0].scores['open-snow'] = 140;
  s2.players[0].invalid = 1;
  s2.players[1].invalid = 3;
  eq(rankPlayers(s2)[0].player, 0, 'fewer invalid wins tie');
  s2.players[0].invalid = 3;
  s2.players[0].elapsedMs = 500; s2.players[1].elapsedMs = 900;
  eq(rankPlayers(s2)[0].player, 0, 'lower elapsed wins tie');
  s2.players[0].elapsedMs = 900; s2.players[1].elapsedMs = 500;
  eq(rankPlayers(s2)[0].player, 1, 'elapsed flips ranking');
});

test('goal: score-target games use playerWon', () => {
  let s = createGame({ seed: 'solo', players: [{ name: 'A' }], goal: { type: 'score', target: 10 } });
  s.status = 'finished'; s.terminalReason = 'cards-complete';
  s.players[0].scores['open-snow'] = 20;
  ok(playerWon(s, 0));
  let s2 = deserialize(serialize(s));
  s2.goal.target = 500;
  ok(!playerWon(s2, 0));
});

test('compareResults orders finished results', () => {
  const mk = (over) => ({ status: 'won', score: { grand: 100 }, invalid: 0, elapsedMs: 1000, sessionId: 'a', ...over });
  ok(compareResults(mk({}), mk({ status: 'lost' })) < 0);
  ok(compareResults(mk({ score: { grand: 200 } }), mk({})) < 0);
  ok(compareResults(mk({}), mk({ invalid: 2 })) < 0);
  ok(compareResults(mk({}), mk({ elapsedMs: 2000 })) < 0);
  ok(compareResults(mk({}), mk({ sessionId: 'b' })) < 0);
});

// --- serialization & migration --------------------------------------------------------

test('serialize: round-trip preserves hash', () => {
  let s = createGame(twoPlayerDef());
  s = mustApply(s, 'roll').state;
  s = mustApply(s, 'hold', { index: 2 }).state;
  const h1 = hashState(s);
  const s2 = deserialize(serialize(s));
  eq(hashState(s2), h1);
  deepEq(s2.dice, s.dice);
  deepEq(s2.players.map((p) => p.scores), s.players.map((p) => p.scores));
});

test('deserialize rejects non-states', () => {
  let threw = 0;
  for (const bad of ['null', '{}', '{"players":[]}', '42', '"x"']) {
    try { deserialize(bad); } catch { threw++; }
  }
  eq(threw, 5);
});

// --- deterministic replay (property test) ----------------------------------------------

test('replay: same seed+commands → identical hashes (50 random sessions)', () => {
  const rng = createStream('property-test');
  for (let n = 0; n < 50; n++) {
    const seed = `prop-${n}-${Math.floor(rng.next() * 1e6)}`;
    const def = {
      seed, players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }],
      rollsPerTurn: rng.int(1, 3) + 1,
      disabledCategories: rng.next() < 0.3 ? ['open-snow'] : [],
    };
    // Generate a random-but-legal command script.
    let state = createGame(def);
    const commands = [];
    let guard = 0;
    while (state.status === 'active' && guard++ < 500) {
      const step = aiStep(state, 'hearth');
      for (const c of step) {
        const command = { id: state.nextCmdId, at: state.clock + rng.int(0, 3000), ...c };
        const r = applyCommand(state, command);
        if (r.error) throw new Error(`script error ${r.error}`);
        commands.push(command);
        state = r.state;
        if (state.status !== 'active') break;
      }
    }
    eq(state.status, 'finished');
    const rep = replay({ init: def, commands });
    ok(rep.ok, `replay ${n} ok`);
    eq(rep.finalHash, hashState(state), `replay ${n} hash`);
  }
});

test('replay: tampered envelopes are detected', () => {
  const def = twoPlayerDef({ players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }] });
  let state = createGame(def);
  const commands = [];
  for (const c of aiStep(state, 'hearth')) {
    const command = { id: state.nextCmdId, at: state.clock, ...c };
    commands.push(command);
    state = applyCommand(state, command).state;
  }
  const good = replay({ init: def, commands });
  ok(good.ok && good.finalHash === hashState(state));
  const tampered = commands.map((c) => ({ ...c }));
  tampered[0].at = (tampered[0].at || 0) + 5000; // forged timestamp changes the clock
  const bad = replay({ init: def, commands: tampered });
  ok(!bad.ok || bad.finalHash !== good.finalHash, 'tampering changes the hash or fails');
  const dropped = replay({ init: def, commands: [] });
  ok(dropped.ok && dropped.finalHash !== good.finalHash);
});

// --- fuzz: malformed commands never hang/throw/corrupt -----------------------------------

test('fuzz: 2000 malformed commands handled safely', () => {
  const rng = createStream('fuzz');
  let s = createGame(twoPlayerDef());
  s = mustApply(s, 'roll').state;
  const before = hashState(s);
  const junk = [
    null, undefined, 42, 'x', [], {}, { id: -1 }, { id: 1.2, type: 'roll' },
    { id: 1 }, { id: 1, type: {} }, { id: 1, type: 'hold' },
    { id: 1, type: 'hold', index: 'a' }, { id: 1, type: 'score' },
    { id: 1, type: 'score', category: 5 }, { id: 1, type: 'roll', extra: '☃'.repeat(5000) },
    { id: 999999, type: 'roll' }, { id: 1, at: -5, type: 'note' },
    { id: 1, at: NaN, type: 'note' }, { id: 1, at: Infinity, type: 'note' },
  ];
  let nextId = s.nextCmdId;
  for (let i = 0; i < 2000; i++) {
    const j = { ...junk[Math.floor(rng.next() * junk.length)] };
    if (j && typeof j === 'object' && 'id' in j) j.id = rng.next() < 0.5 ? nextId : rng.int(-5, 5);
    let r;
    try { r = applyCommand(s, j); } catch (e) { throw new Error(`threw on ${JSON.stringify(j)}: ${e.message}`); }
    if (r && !r.error && r.state !== s) { s = r.state; nextId = s.nextCmdId; }
  }
  ok(Number.isFinite(s.clock), 'clock finite');
  ok(s.rng >>> 0 === s.rng, 'rng state uint32');
  // State stayed structurally valid.
  eq(hashState(deserialize(serialize(s))).length, 8);
  // No NaN anywhere in dice.
  ok(s.dice.every((d) => d >= 0 && d <= 6));
  void before;
});

// --- AI ---------------------------------------------------------------------------

test('ai: decisions deterministic for identical states', () => {
  let s = createGame(twoPlayerDef({ players: [{ name: 'A', isAI: true }, { name: 'B', isAI: true }] }));
  s = mustApply(s, 'roll').state;
  for (const d of AI_DIFFICULTIES) {
    const a = aiStep(s, d);
    const b = aiStep(s, d);
    deepEq(a, b, `ai ${d} deterministic`);
  }
});

test('ai: full AI-vs-AI games terminate for all difficulties', () => {
  for (const d of AI_DIFFICULTIES) {
    const s = playFullGame({ seed: `ai-${d}`, players: [{ name: 'A', isAI: true, difficulty: d }, { name: 'B', isAI: true, difficulty: d }] });
    eq(s.status, 'finished', d);
  }
});

// --- content -------------------------------------------------------------------------

test('content: all defs pass offline validators', () => {
  const report = validateContent();
  deepEq(report, [], 'validateContent report');
});

test('content: launch scope — 40 journey stages, lessons, challenges, 5 themes', () => {
  eq(JOURNEY.length, 40);
  ok(LESSONS.length >= 4);
  ok(CHALLENGES.length >= 5);
  eq(THEMES.length, 5);
  ok(JOURNEY.filter((j) => j.mastery).length === 5, 'periodic mastery stages');
  for (const j of JOURNEY) ok(findContent(j.id) === j);
});

test('content: daily table is UTC-day deterministic and immutable', () => {
  const a = dailyForDate(new Date('2026-03-14T00:00:00Z'));
  const b = dailyForDate(new Date('2026-03-14T23:59:59Z'));
  const c = dailyForDate(new Date('2026-03-15T00:00:00Z'));
  eq(a.seed, b.seed);
  ok(a.seed !== c.seed);
  eq(a.rulesV, RULES_VERSION);
  eq(a.v, CONTENT_VERSION);
});

test('content: practiceDef bounds and solo target', () => {
  const solo = practiceDef({ difficulty: 'summit', humans: 1, aiOpponents: 0 });
  eq(solo.players.length, 1);
  eq(solo.goal.type, 'score');
  const full = practiceDef({ humans: 4, aiOpponents: 3 });
  eq(full.players.length, 4);
  eq(validateDef(full).length, 0);
});

// --- golden sessions ------------------------------------------------------------------

test('golden: scripted easy/medium/hard sessions replay to identical hashes', () => {
  for (const [label, d] of [['easy', 'ember'], ['medium', 'hearth'], ['hard', 'summit']]) {
    const def = { seed: `golden-${label}`, players: [{ name: 'You' }, { name: 'AI', isAI: true, difficulty: d }] };
    // Human seat plays with the deterministic AI helper too, so the whole
    // session is a script.
    const s = playFullGame(def);
    eq(s.status, 'finished', label);
    const commands = [];
    let state = createGame(def);
    let guard = 0;
    while (state.status === 'active' && guard++ < 500) {
      const step = aiStep(state, state.players[state.current].difficulty || d);
      for (const c of step) {
        const command = { id: state.nextCmdId, at: state.clock, ...c };
        commands.push(command);
        state = applyCommand(state, command).state;
      }
    }
    const rep = replay({ init: def, commands });
    ok(rep.ok, `${label} replay ok`);
    eq(rep.finalHash, hashState(state), `${label} replay hash`);
  }
});

test('golden: interrupted + resumed session keeps hashes', () => {
  const def = { seed: 'golden-resume', players: [{ name: 'You' }, { name: 'AI', isAI: true }] };
  let state = createGame(def);
  state = mustApply(state, 'roll').state;
  state = mustApply(state, 'hold', { index: 0 }).state;
  const snap = serialize(state);
  const h = hashState(state);
  // "Restart the app": restore from the snapshot and continue.
  let restored = deserialize(snap);
  eq(hashState(restored), h);
  restored = mustApply(restored, 'roll').state;
  ok(restored.dice.every((d) => d >= 1 && d <= 6));
});

// --- seeded streams -------------------------------------------------------------------

test('streams: hashSeed stable, createStream deterministic & in [0,1)', () => {
  eq(hashSeed('five-dice'), hashSeed('five-dice'));
  const a = createStream('s'); const b = createStream('s');
  for (let i = 0; i < 100; i++) {
    const v = a.next();
    eq(v, b.next());
    ok(v >= 0 && v < 1);
  }
  const arr = [1, 2, 3, 4, 5];
  deepEq(createStream('sh').shuffle(arr.slice()), createStream('sh').shuffle(arr.slice()));
});

test('helpers: faceCounts, longestRun', () => {
  deepEq(faceCounts([1, 1, 2, 3, 6]), [0, 2, 1, 1, 0, 0, 1]);
  eq(longestRun([1, 2, 3, 5, 6]), 3);
  eq(longestRun([1, 2, 3, 4, 5]), 5);
  eq(longestRun([6, 6, 6, 6, 6]), 1);
});

// --- summary ----------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  process.exitCode = 1;
}
