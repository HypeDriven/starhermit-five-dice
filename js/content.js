// Five Dice — versioned content: themes, lessons, journey, daily, practice,
// challenges, and offline validators. Pure module (browser + Node).

import { RULES_VERSION, CATEGORIES } from './rules.js';

export const CONTENT_VERSION = 1;

// ---------------------------------------------------------------------------
// Visual themes (presentation only — never affect rules or information)
// ---------------------------------------------------------------------------

export const THEMES = [
  {
    id: 'hearth', name: 'Hearthglow Lodge',
    felt: '#3e5c4b', wood: '#6b4a2f', wall: '#2e2118', accent: '#e8a54b',
    die: '#f4ead8', pip: '#33241a', select: '#7fc8a9', legal: '#8fd6a0',
    danger: '#d95745', sky: '#1a2a33', text: '#f2e9da', page: '#241a12',
  },
  {
    id: 'pinewood', name: 'Pinewood Morning',
    felt: '#4a6b52', wood: '#8a6a44', wall: '#33402e', accent: '#d98e4a',
    die: '#fbf6e8', pip: '#2e3b2a', select: '#4f9d8f', legal: '#6fbf73',
    danger: '#c0503c', sky: '#cfe0e8', text: '#243020', page: '#eef0e4',
  },
  {
    id: 'frostfall', name: 'Frostfall Cabin',
    felt: '#3a4d6b', wood: '#5c4632', wall: '#1c2431', accent: '#8fb8e8',
    die: '#eef2f8', pip: '#22304a', select: '#9ac8f0', legal: '#7fd6c2',
    danger: '#e06a5a', sky: '#0e1520', text: '#e4ecf6', page: '#161e2a',
  },
  {
    id: 'starlit', name: 'Starlit Refuge',
    felt: '#463a63', wood: '#4a3626', wall: '#1d1626', accent: '#c9a0e8',
    die: '#f2ecf8', pip: '#352347', select: '#b08fe0', legal: '#8fd6a0',
    danger: '#e06a7a', sky: '#0c0916', text: '#ece4f6', page: '#1a1424',
  },
  {
    id: 'ember-night', name: 'Ember Night',
    felt: '#5c3a3a', wood: '#3c2a20', wall: '#18100c', accent: '#f0764a',
    die: '#f8efe2', pip: '#402014', select: '#f0a35e', legal: '#a0d690',
    danger: '#e0483c', sky: '#0a0605', text: '#f6e8dc', page: '#201410',
  },
];

export function getTheme(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ---------------------------------------------------------------------------
// Lessons (Learn mode): interactive, one rule at a time, player must act
// ---------------------------------------------------------------------------

export const LESSONS = [
  {
    id: 'learn-roll', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'First Roll', mode: 'learn', seed: 'lesson-roll',
    players: [{ name: 'You' }, { name: 'Lodge Guide', isAI: true, difficulty: 'ember' }],
    assists: { undo: true, hints: true }, ranked: false,
    tutorial: {
      steps: [
        { require: { type: 'roll' }, text: 'Welcome to the lodge! Press Roll to throw all five dice.' },
        { require: { type: 'any' }, text: 'Those are your dice. Finish the turn by scoring any highlighted category on your card.' },
      ],
    },
  },
  {
    id: 'learn-hold', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'Hold and Reroll', mode: 'learn', seed: 'lesson-hold',
    players: [{ name: 'You' }, { name: 'Lodge Guide', isAI: true, difficulty: 'ember' }],
    assists: { undo: true, hints: true }, ranked: false,
    tutorial: {
      steps: [
        { require: { type: 'roll' }, text: 'Roll the dice to begin.' },
        { require: { type: 'hold' }, text: 'Tap any die to hold it — held dice stay put on the next roll.' },
        { require: { type: 'roll' }, text: 'Now roll again. Only the unheld dice move.' },
        { require: { type: 'any' }, text: 'Score any open category to end your turn.' },
      ],
    },
  },
  {
    id: 'learn-categories', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'Reading the Card', mode: 'learn', seed: 'lesson-card',
    players: [{ name: 'You' }, { name: 'Lodge Guide', isAI: true, difficulty: 'ember' }],
    assists: { undo: true, hints: true }, ranked: false,
    tutorial: {
      steps: [
        { require: { type: 'roll' }, text: 'Each category scores differently. Roll and watch the previews on your card.' },
        { require: { type: 'score', category: 'open-snow' }, text: 'Open Snow scores the total of all dice — always a safe fallback. Score it now.' },
        { require: { type: 'any' }, text: 'Upper rows (Kindling…Peaks) reward matching faces. Fill your card over 13 rounds!' },
      ],
    },
  },
  {
    id: 'learn-bonus', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'The Upper Bonus', mode: 'learn', seed: 'lesson-bonus',
    players: [{ name: 'You' }, { name: 'Lodge Guide', isAI: true, difficulty: 'hearth' }],
    assists: { undo: true, hints: true }, ranked: false,
    tutorial: {
      steps: [
        { require: { type: 'any' }, text: 'Score 63+ across the six upper rows and the lodge adds a 35-point bonus. Play a full table and try to earn it!' },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Practice difficulties
// ---------------------------------------------------------------------------

export const PRACTICE_DIFFICULTIES = {
  ember:  { id: 'ember',  name: 'Ember',  blurb: 'A relaxed table. The AI settles early.' },
  hearth: { id: 'hearth', name: 'Hearth', blurb: 'A fair game. The AI plans its holds.' },
  summit: { id: 'summit', name: 'Summit', blurb: 'A sharp rival. Chases straights and the bonus.' },
};

// ---------------------------------------------------------------------------
// Journey: five trails of eight stages; every eighth is a mastery stage
// ---------------------------------------------------------------------------

const TRAILS = [
  { id: 'sparks',     name: 'Trail of Sparks',  theme: 'hearth' },
  { id: 'emberwalk',  name: 'Emberwalk',        theme: 'ember-night' },
  { id: 'timberline', name: 'Timberline',       theme: 'pinewood' },
  { id: 'frostridge', name: 'Frost Ridge',      theme: 'frostfall' },
  { id: 'summits',    name: 'Summit of Lights', theme: 'starlit' },
];

const STAGE_NAMES = [
  'Warming Up', 'First Steps', 'Steady Hands', 'Quiet Focus',
  'Trail Marker', 'Halfway Hearth', 'Long Shadows', 'Mastery',
];

function stageDef(trailIdx, step) {
  const n = trailIdx * 8 + step + 1;
  const trail = TRAILS[trailIdx];
  const mastery = step === 7;
  const id = `j${String(n).padStart(2, '0')}`;
  const difficulty = trailIdx < 1 ? 'ember' : trailIdx < 3 ? 'hearth' : 'summit';
  const opponents = [{ name: oppName(trailIdx, step), isAI: true, difficulty }];
  if (mastery && trailIdx >= 2) {
    opponents.push({ name: oppName(trailIdx, step, 1), isAI: true, difficulty });
  }
  const soloScore = !mastery && (step === 2 || step === 5);
  const def = {
    id, v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: `${trail.name} ${step + 1} — ${STAGE_NAMES[step]}${mastery ? ' Stage' : ''}`,
    mode: 'journey', seed: `journey-${n}`, theme: trail.theme,
    trail: trail.id, trailIdx, stage: n, mastery,
    players: [{ name: 'You' }, ...opponents],
    assists: { undo: !mastery, hints: true }, ranked: false,
    par: { score: 150 + trailIdx * 20 + step * 5 },
    mechanics: [],
  };
  if (mastery) {
    def.rollsPerTurn = trailIdx >= 3 ? 2 : 3;
    if (def.rollsPerTurn === 2) def.mechanics.push('two-rolls');
    def.goal = { type: 'win' };
  } else if (soloScore) {
    def.players = [{ name: 'You' }];
    def.goal = { type: 'score', target: 140 + trailIdx * 25 + step * 10 };
    def.mechanics.push('target-score');
  } else {
    def.goal = { type: 'win' };
  }
  if (trailIdx === 4 && !mastery && step >= 4) {
    def.disabledCategories = ['open-snow'];
    def.mechanics.push('no-chance');
  }
  return def;
}

function oppName(trailIdx, step, alt) {
  const NAMES = [
    ['Pip', 'Marta', 'Bram', 'Odell', 'Sorrel', 'Juniper', 'Fen', 'Halla'],
    ['Ash', 'Cinder', 'Cole', 'Emberly', 'Flint', 'Hestia', 'Pyre', 'Vesta'],
    ['Alder', 'Birch', 'Cedar', 'Rowan', 'Larch', 'Aspen', 'Willow', 'Hazel'],
    ['Frost', 'Iver', 'Skadi', 'Nieve', 'Boreal', 'Crystal', 'Tundra', 'Wren'],
    ['Nova', 'Lyra', 'Orion', 'Vega', 'Altair', 'Mira', 'Polaris', 'Comet'],
  ];
  const row = NAMES[trailIdx % NAMES.length];
  return row[(step + (alt ? 3 : 0)) % row.length];
}

export const JOURNEY = [];
for (let t = 0; t < TRAILS.length; t++) {
  for (let s = 0; s < 8; s++) JOURNEY.push(stageDef(t, s));
}
export { TRAILS };

// ---------------------------------------------------------------------------
// Challenges: constrained tables
// ---------------------------------------------------------------------------

export const CHALLENGES = [
  {
    id: 'two-roll-table', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'Two-Roll Table', mode: 'challenge', seed: 'ch-two-roll',
    blurb: 'Only two rolls per turn. Every hold matters.',
    players: [{ name: 'You' }, { name: 'Flint', isAI: true, difficulty: 'hearth' }],
    rollsPerTurn: 2, mechanics: ['two-rolls'],
    assists: { undo: false, hints: false }, ranked: true,
    par: { score: 160 },
  },
  {
    id: 'blizzard-clock', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'Blizzard Clock', mode: 'challenge', seed: 'ch-blizzard',
    blurb: 'The storm gives the whole table six minutes. Score fast.',
    players: [{ name: 'You' }, { name: 'Skadi', isAI: true, difficulty: 'hearth' }],
    limits: { totalMs: 6 * 60 * 1000 }, mechanics: ['total-clock'],
    assists: { undo: false, hints: true }, ranked: true,
    par: { score: 140 },
  },
  {
    id: 'lone-summit', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'Lone Summit', mode: 'challenge', seed: 'ch-summit',
    blurb: 'Solo climb: reach 240 points on one card.',
    players: [{ name: 'You' }],
    goal: { type: 'score', target: 240 }, mechanics: ['target-score'],
    assists: { undo: false, hints: true }, ranked: true,
    par: { score: 240 },
  },
  {
    id: 'no-open-snow', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'No Safe Snow', mode: 'challenge', seed: 'ch-nosnow',
    blurb: 'Open Snow is closed — there is no safety net. Beat Polaris.',
    players: [{ name: 'You' }, { name: 'Polaris', isAI: true, difficulty: 'summit' }],
    disabledCategories: ['open-snow'], mechanics: ['no-chance'],
    assists: { undo: false, hints: false }, ranked: true,
    par: { score: 170 },
  },
  {
    id: 'cabin-council', v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: 'Cabin Council', mode: 'challenge', seed: 'ch-council',
    blurb: 'Three sharp rivals at one table. Outlast them all.',
    players: [
      { name: 'You' },
      { name: 'Nova', isAI: true, difficulty: 'summit' },
      { name: 'Vega', isAI: true, difficulty: 'summit' },
      { name: 'Mira', isAI: true, difficulty: 'hearth' },
    ],
    mechanics: ['four-handed'],
    assists: { undo: false, hints: false }, ranked: true,
    par: { score: 180 },
  },
];

// ---------------------------------------------------------------------------
// Daily table: one shared seed per UTC day, immutable after publication
// ---------------------------------------------------------------------------

export function dailyForDate(date) {
  const day = date.toISOString().slice(0, 10); // UTC day boundary
  // Opponent difficulty rotates deterministically with the day-of-week.
  const dow = date.getUTCDay();
  const difficulty = dow === 0 || dow === 6 ? 'ember' : dow >= 4 ? 'summit' : 'hearth';
  const names = { ember: 'Pip', hearth: 'Bram', summit: 'Polaris' };
  return {
    id: `daily-${day}`, v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: `Daily Table — ${day}`, mode: 'daily', seed: `daily:${day}`,
    players: [{ name: 'You' }, { name: names[difficulty], isAI: true, difficulty }],
    assists: { undo: false, hints: false }, ranked: true,
    par: { score: 170 }, day,
  };
}

// ---------------------------------------------------------------------------
// Def factories
// ---------------------------------------------------------------------------

// Practice setup: { difficulty, humans, aiOpponents, seed }
export function practiceDef(opts = {}) {
  const difficulty = PRACTICE_DIFFICULTIES[opts.difficulty] ? opts.difficulty : 'hearth';
  const humans = Math.min(4, Math.max(1, opts.humans ?? 1));
  const aiCount = Math.min(4 - humans, Math.max(0, opts.aiOpponents ?? (humans === 1 ? 1 : 0)));
  const players = [];
  for (let i = 0; i < humans; i++) players.push({ name: humans > 1 ? `Player ${i + 1}` : 'You' });
  const firstName = { ember: 'Pip', hearth: 'Bram', summit: 'Halla' }[difficulty];
  const pool = ['Pip', 'Bram', 'Halla'];
  for (let i = 0; i < aiCount; i++) {
    const name = i === 0 ? firstName : pool.find((n) => !players.some((p) => p.name === n));
    players.push({ name, isAI: true, difficulty });
  }
  const solo = players.length === 1;
  return {
    id: `practice-${difficulty}-${humans}v${aiCount}`, v: CONTENT_VERSION, rulesV: RULES_VERSION,
    name: solo ? `Practice — ${PRACTICE_DIFFICULTIES[difficulty].name} (solo)`
      : `Practice — ${PRACTICE_DIFFICULTIES[difficulty].name}`,
    mode: 'practice', seed: opts.seed || `practice:${difficulty}:${Date.now().toString(36)}`,
    players, assists: { undo: true, hints: true }, ranked: false,
    goal: solo ? { type: 'score', target: 200 } : { type: 'win' },
    par: { score: 170 },
  };
}

export function findContent(id) {
  return LESSONS.find((d) => d.id === id) ||
    JOURNEY.find((d) => d.id === id) ||
    CHALLENGES.find((d) => d.id === id) || null;
}

// ---------------------------------------------------------------------------
// Offline validators: basic legality, reachable goals, bounded duration,
// absence of soft locks. Run in tests and at boot in development.
// ---------------------------------------------------------------------------

const MAX_SOLO_SCORE = 375; // rough perfect card ceiling for sanity checks

export function validateDef(def) {
  const errors = [];
  if (!def.id || !def.seed) errors.push('missing id/seed');
  if (def.rulesV !== RULES_VERSION) errors.push('rules-version-mismatch');
  if (!Array.isArray(def.players) || def.players.length < 1 || def.players.length > 4) {
    errors.push('bad player count');
  }
  const enabled = CATEGORIES.length - (def.disabledCategories?.length || 0);
  if (enabled < 1) errors.push('no categories');
  if (def.rollsPerTurn != null && (def.rollsPerTurn < 1 || def.rollsPerTurn > 5)) {
    errors.push('bad rollsPerTurn');
  }
  if (def.goal?.type === 'score') {
    if (!Number.isFinite(def.goal.target) || def.goal.target <= 0) errors.push('bad target');
    if (def.goal.target > MAX_SOLO_SCORE) errors.push('target unreachable');
  }
  // Bounded duration: players × categories × rolls is finite by construction;
  // assert the turn budget is representable.
  const turns = (def.players?.length || 0) * enabled;
  if (!Number.isFinite(turns) || turns < 1) errors.push('unbounded');
  if (def.tutorial && (!Array.isArray(def.tutorial.steps) || !def.tutorial.steps.length)) {
    errors.push('bad tutorial');
  }
  return errors;
}

export function validateContent() {
  const report = [];
  const seen = new Set();
  for (const def of [...LESSONS, ...JOURNEY, ...CHALLENGES]) {
    if (seen.has(def.id)) report.push({ id: def.id, errors: ['duplicate id'] });
    seen.add(def.id);
    const errors = validateDef(def);
    if (errors.length) report.push({ id: def.id, errors });
  }
  return report;
}
