// The save's pure parts (node --test): the progress document, the browser
// build's cloud save read and merged into it (the engine shows it as foreign),
// the two-device merge, a finished table's progression and achievements, this
// device's boards, and the game options with the browser build's settings keys
// they are migrated from. The engine calls around them (native/platform.ts:
// saves, settings, storage) need a signed-in platform and are not run here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENTS, OPTION_DEFAULTS, RESULTS_MAX, applyResult, asProgress, checkOption, freshProgress, isBrowserKey, localBoard,
  mergeProgress, pushResult, readForeign,
} from '../js/progress.js';

const result = (over = {}) => ({
  contentId: 'practice-hearth-1v1', mode: 'practice', status: 'won', reason: 'cards-complete', invalid: 0,
  score: { upper: 60, bonus: 0, lower: 120, grand: 180 }, stats: { avalanches: 0, upperBonuses: 0, holdsUsed: 3 }, ...over,
});

test('a fresh document and partial documents read as full progress', () => {
  const f = freshProgress();
  assert.deepEqual(Object.keys(f).sort(), ['achievements', 'bestDaily', 'challenges', 'journey', 'rev', 'streakDays', 'totals', 'v']);
  const p = asProgress({ v: 1, totals: { games: 4 } });
  assert.equal(p.totals.games, 4);
  assert.equal(p.totals.wins, 0);
  assert.deepEqual(p.journey, {});
  assert.equal(asProgress({ v: 2 }), null);
  assert.equal(asProgress(null), null);
  assert.equal(asProgress([1]), null);
});

test("the browser build's cloud save (saveJSON text) migrates and merges with this device", () => {
  const old = JSON.stringify({
    v: 1, rev: 7, journey: { j01: { done: true, best: 190, stars: 3 } }, challenges: { 'lone-summit': { done: true, best: 251 } },
    achievements: { first_table: { at: 10 } }, totals: { games: 12, wins: 6, points: 2000, avalanches: 1 },
    streakDays: ['2026-09-30'], bestDaily: { 'daily-2026-09-30': 210 },
  });
  const foreign = readForeign(old);
  assert.equal(foreign.journey.j01.best, 190);
  const device = { ...freshProgress(), rev: 2, journey: { j02: { done: true, best: 150, stars: 2 } }, totals: { games: 3, wins: 1, points: 400, avalanches: 2 }, streakDays: ['2026-10-27'] };
  const m = asProgress(mergeProgress(foreign, device));
  assert.deepEqual(Object.keys(m.journey).sort(), ['j01', 'j02']);
  assert.equal(m.totals.games, 12);
  assert.equal(m.totals.avalanches, 2);
  assert.equal(m.rev, 8);
  assert.deepEqual(m.streakDays, ['2026-09-30', '2026-10-27']);
  assert.equal(m.challenges['lone-summit'].best, 251);
  assert.equal(readForeign('not json'), null);
  assert.equal(readForeign(''), null);
});

test('mergeProgress keeps the better side of every record and the earliest unlock', () => {
  const m = mergeProgress(
    { v: 1, journey: { j01: { done: true, best: 120, stars: 1 } }, achievements: { first_table: { at: 50 } }, bestDaily: { d: 100 } },
    { v: 1, journey: { j01: { done: false, best: 160, stars: 3 } }, achievements: { first_table: { at: 20 }, lodge_keeper: { at: 9 } }, bestDaily: { d: 90, e: 5 } });
  assert.deepEqual(m.journey.j01, { done: true, best: 160, stars: 3 });
  assert.deepEqual(m.achievements, { first_table: { at: 20 }, lodge_keeper: { at: 9 } });
  assert.deepEqual(m.bestDaily, { d: 100, e: 5 });
});

test('a finished table updates totals, stages, dailies, challenges and unlocks achievements once', () => {
  const p = freshProgress();
  let newly = applyResult(p, result({ stats: { avalanches: 1, upperBonuses: 1 } }), '2026-10-27', 1000);
  assert.deepEqual(newly.sort(), ['avalanche_caller', 'first_table', 'lodge_keeper']);
  assert.equal(p.totals.games, 1);
  assert.equal(p.totals.wins, 1);
  assert.equal(p.totals.points, 180);
  assert.deepEqual(p.streakDays, ['2026-10-27']);
  newly = applyResult(p, result(), '2026-10-27', 2000);
  assert.deepEqual(newly, [], 'idempotent unlocks');
  applyResult(p, result({ mode: 'journey', contentId: 'j08', invalid: 1 }), '2026-10-28', 3000);
  assert.deepEqual(p.journey.j08, { done: true, best: 180, stars: 2 });
  assert.ok(p.achievements.mastery_stage, 'every eighth stage is a mastery stage');
  applyResult(p, result({ mode: 'daily', contentId: 'daily-2026-10-28' }), '2026-10-28', 4000);
  assert.equal(p.bestDaily['daily-2026-10-28'], 180);
  applyResult(p, result({ mode: 'challenge', contentId: 'lone-summit', status: 'lost' }), '2026-10-28', 5000);
  assert.equal(p.challenges['lone-summit'], undefined, 'a lost challenge is not cleared');
  assert.equal(p.totals.games, 5);
  for (const k of Object.keys(p.achievements)) assert.ok(ACHIEVEMENTS.some((a) => a.key === k), k);
});

test("this device's boards and the capped history", () => {
  let rs = [];
  rs = pushResult(rs, result({ mode: 'daily', contentId: 'daily-a', score: { grand: 150 } }));
  rs = pushResult(rs, result({ mode: 'daily', contentId: 'daily-b', score: { grand: 210 } }));
  rs = pushResult(rs, result({ mode: 'journey', contentId: 'j01', status: 'lost', score: { grand: 99 } }));
  assert.deepEqual(localBoard(rs, 'daily', 'Ann').map((e) => e.score), [210, 150]);
  assert.deepEqual(localBoard(rs, 'journey', 'Ann'), [], 'journey wins only');
  assert.equal(localBoard(rs, 'daily:daily-a', 'Ann').length, 1);
  for (let i = 0; i < RESULTS_MAX + 5; i++) rs = pushResult(rs, result());
  assert.equal(rs.length, RESULTS_MAX);
});

test('game options: valid values pass, the rest are refused; browser keys are recognised', () => {
  assert.equal(checkOption('theme', 'frostfall'), 'frostfall');
  assert.equal(checkOption('theme', 'neon'), undefined);
  assert.equal(checkOption('palette', 'tritanopia'), 'tritanopia');
  assert.equal(checkOption('cameraTilt', 'overhead'), 'overhead');
  assert.equal(checkOption('cameraTilt', 'side'), undefined);
  assert.equal(checkOption('haptics', false), false);
  assert.equal(checkOption('leftHanded', 'yes'), undefined);
  assert.deepEqual(checkOption('tutorialsDone', { 'learn-roll': true, x: 1 }), { 'learn-roll': true });
  assert.equal(checkOption('tutorialsDone', [1]), undefined);
  assert.equal(checkOption('volMusic', 0.5), undefined);
  for (const k of Object.keys(OPTION_DEFAULTS)) if (k !== 'tutorialsDone') assert.ok(isBrowserKey(k), k);
  for (const k of ['volMusic', 'muted', 'graphics', 'largeText', 'ui.language', 'audio.options', 'graphics.gpu.AMD']) assert.ok(isBrowserKey(k), k);
  assert.ok(!isBrowserKey('game.theme'));
});
