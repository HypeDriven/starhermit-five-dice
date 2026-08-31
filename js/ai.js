// Five Dice — deterministic practice AI.
// Decides with the same legality/scoring API as play; its commands flow
// through applyCommand() like any player's. Choice randomness comes from a
// stream seeded by the authoritative state hash, so identical states always
// produce identical decisions.

import {
  createStream, hashState, listLegalActions, scoreCategory, faceCounts,
  longestRun, getCategory, CATEGORIES, DICE_COUNT,
} from './rules.js';

export const AI_DIFFICULTIES = ['ember', 'hearth', 'summit'];

// Sacrifice order when nothing scores: cheapest long-shot categories first.
const SACRIFICE_ORDER = [
  'avalanche', 'kindling', 'embers', 'grand-hearth', 'ridge-path',
  'flames', 'summit-trail', 'full-lodge', 'triple-hearth', 'timbers',
  'beams', 'peaks', 'open-snow',
];

// Rough par values per category used as score-now thresholds.
const PAR_POINTS = {
  kindling: 2, embers: 4, flames: 7, timbers: 10, beams: 13, peaks: 16,
  'triple-hearth': 18, 'grand-hearth': 21, 'full-lodge': 25,
  'ridge-path': 30, 'summit-trail': 40, avalanche: 50, 'open-snow': 19,
};

function streamFor(state, difficulty, salt) {
  return createStream(`ai:${difficulty}:${salt}:${hashState(state)}`);
}

// Pick which open category to score with the current dice.
function pickScore(state, stream, difficulty) {
  const open = listLegalActions(state).scoreable;
  let best = null;
  for (const id of open) {
    const pts = scoreCategory(state.dice, id);
    if (!best || pts > best.points ||
        (pts === best.points && difficulty === 'summit' &&
         (PAR_POINTS[id] ?? 0) < (PAR_POINTS[best.category] ?? 0))) {
      best = { category: id, points: pts };
    }
  }
  if (best.points > 0) return best;
  // Nothing scores: sacrifice the least valuable open category.
  for (const id of SACRIFICE_ORDER) {
    if (open.includes(id)) return { category: id, points: 0 };
  }
  return { category: open[Math.floor(stream.next() * open.length)], points: 0 };
}

// Decide desired holds toward the strongest plan.
function planHolds(state, difficulty) {
  const dice = state.dice;
  const counts = faceCounts(dice);
  const open = new Set(listLegalActions(state).scoreable);

  // Best face: highest count, tie toward higher face (upper-section value).
  let bestFace = 6;
  for (let f = 6; f >= 1; f--) if (counts[f] > counts[bestFace]) bestFace = f;

  // A clearly strong hand? Hold everything (score will follow).
  const made = CATEGORIES.some((c) => open.has(c.id) &&
    scoreCategory(dice, c.id) >= (PAR_POINTS[c.id] ?? 0) + 8);
  if (made && difficulty !== 'ember') return dice.map(() => true);

  // Strong of-a-kind: commit to the face.
  if (counts[bestFace] >= 3) return dice.map((d) => d === bestFace);

  // Straight chase: a run of 4 (or 3 for summit) with an open straight.
  const run = longestRun(dice);
  const straightOpen = open.has('ridge-path') || open.has('summit-trail');
  if (straightOpen && run >= 4 && counts[bestFace] < 3) {
    const seen = new Set();
    return dice.map((d) => (seen.has(d) ? false : (seen.add(d), true)));
  }
  if (straightOpen && run === 3 && difficulty === 'summit' && counts[bestFace] < 2) {
    // Keep the three-run dice plus any pair toward an of-a-kind fallback.
    const seenSet = new Set(dice);
    let runFaces = [];
    for (let start = 1; start <= 4; start++) {
      const seq = [start, start + 1, start + 2];
      if (seq.every((f) => seenSet.has(f))) { runFaces = seq; break; }
    }
    if (runFaces.length) {
      const used = new Set();
      return dice.map((d) => {
        if (runFaces.includes(d) && !used.has(d)) { used.add(d); return true; }
        return d === bestFace && counts[d] >= 2;
      });
    }
  }

  // Pairs / upper chase: hold the best face (and a second face for ember chaos).
  if (difficulty === 'ember') {
    const second = dice.find((d) => d !== bestFace && counts[d] >= 1);
    return dice.map((d) => d === bestFace || (counts[bestFace] === 1 && d === second));
  }
  return dice.map((d) => d === bestFace);
}

// Should the AI stop rolling and score now?
function shouldScoreNow(state, difficulty, stream) {
  const legal = listLegalActions(state);
  if (legal.mustScore) return true;
  if (!legal.canRoll) return true;
  const pick = pickScore(state, stream, difficulty);
  const cat = getCategory(pick.category);
  const par = PAR_POINTS[pick.category] ?? 15;
  if (difficulty === 'ember') {
    // Impulsive: often settles early.
    return pick.points > 0 && (state.rollsLeft <= 1 || stream.next() < 0.55);
  }
  if (difficulty === 'hearth') {
    if (pick.points >= par + 4) return true;
    return state.rollsLeft <= 1 && pick.points >= Math.max(4, par - 6);
  }
  // summit: demanding, values fixed-point categories and upper bonus pace.
  if (pick.points >= par + 2) return true;
  if (cat.kind === 'straight' && pick.points >= cat.points) return true;
  if (cat.kind === 'ofKind' && cat.n >= 4 && pick.points > 0) return true;
  return state.rollsLeft <= 1 && pick.points >= par;
}

// One AI decision step. Returns an array of command objects (without id/at):
// either [{score}], or [hold toggles..., {roll}], or [{roll}].
export function aiStep(state, difficulty = 'hearth') {
  const legal = listLegalActions(state);
  if (state.status !== 'active') return [];
  const stream = streamFor(state, difficulty, state.tick);

  if (!state.hasRolled) return [{ type: 'roll' }];

  if (shouldScoreNow(state, difficulty, stream)) {
    const pick = pickScore(state, stream, difficulty);
    return [{ type: 'score', category: pick.category }];
  }

  if (legal.canRoll) {
    const want = planHolds(state, difficulty);
    const cmds = [];
    for (let i = 0; i < DICE_COUNT; i++) {
      if (want[i] !== state.held[i]) cmds.push({ type: 'hold', index: i });
    }
    cmds.push({ type: 'roll' });
    return cmds;
  }

  // Fallback (should be unreachable): score something.
  const pick = pickScore(state, stream, difficulty);
  return [{ type: 'score', category: pick.category }];
}

// The AI never mutates state itself; its commands are applied through the
// session's validated dispatch path like any player's.
