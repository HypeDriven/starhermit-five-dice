// Five Dice — session controller.
// Owns the game-state machine and every transition's reason; routes all rules
// changes through validated commands; keeps undo snapshots, the replay
// envelope, tutorial gating, and the authoritative session clock.

import {
  createGame, applyCommand, serialize, deserialize, hashState, replay,
  checkScore, getHint, listLegalActions, canRoll, currentPlayer, rankPlayers,
  playerWon, totalsBreakdown, enabledCategories,
} from './rules.js';
import { aiStep } from './ai.js';

export const MACHINE_STATES = [
  'boot', 'title', 'profile-ready', 'mode-select', 'preparing',
  'tutorial', 'countdown', 'active', 'paused', 'reconnecting',
  'resolving', 'results', 'progression',
];

const AUTOSAVE_KEY = 'fivedice:autosave';

export class Session {
  constructor(platform, emit) {
    this.platform = platform;   // persistence + hosted adapter
    this.emit = emit;           // (event) => void  UI/render/audio sink
    this.machine = 'boot';
    this.machineReason = 'init';
    this.def = null;
    this.state = null;          // rules state (immutable snapshots)
    this.undoStack = [];        // snapshots taken at the start of human turns
    this.commands = [];         // ordered applied commands (replay log)
    this.checkpoints = [];      // periodic state hashes
    this.sessionId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    this.startStamp = 0;        // perf clock when round went active
    this.pauseAccum = null;     // session-clock base (ms); set on first start
    this.pauseStart = 0;
    this.pausedFrom = null;     // machine state to return to on resume
    this.tutorialStep = 0;
    this.stats = { avalanches: 0, upperBonuses: 0, holdsUsed: 0 };
    this.onTransition = null;
  }

  transition(to, reason) {
    if (!MACHINE_STATES.includes(to)) throw new Error(`unknown machine state ${to}`);
    const from = this.machine;
    this.machine = to;
    this.machineReason = reason;
    this.onTransition?.(from, to, reason);
    this.emit({ type: 'machine', from, to, reason });
  }

  // --- clock ---------------------------------------------------------------
  nowMs() {
    const running = this.machine === 'active' || this.machine === 'resolving' || this.machine === 'tutorial';
    if (!running) return this.state?.clock ?? 0;
    return this.pauseAccum + (performance.now() - this.startStamp);
  }

  // --- round lifecycle -----------------------------------------------------
  startRound(def) {
    this.def = def;
    this.state = createGame(def);
    this.undoStack = [];
    this.commands = [];
    this.checkpoints = [{ after: 0, hash: hashState(this.state) }];
    this.tutorialStep = 0;
    this.stats = { avalanches: 0, upperBonuses: 0, holdsUsed: 0 };
    this.pauseAccum = 0;
    this.startStamp = performance.now();
    this.snapshotTurnStart();
    this.transition(def.mode === 'learn' ? 'tutorial' : 'countdown', `start:${def.id}`);
    this.emit({ type: 'round', def, state: this.state });
  }

  beginActive() {
    this.startStamp = performance.now();
    this.pauseAccum = this.state?.clock ?? 0;
    this.transition('active', 'countdown-complete');
  }

  pause(reason = 'user') {
    if (this.machine !== 'active' && this.machine !== 'tutorial') return;
    this.pausedFrom = this.machine;
    this.pauseAccum = this.nowMs();
    this.pauseStart = performance.now();
    this.transition('paused', reason);
    this.saveSnapshot();
  }

  resume() {
    if (this.machine !== 'paused' && this.machine !== 'reconnecting') return;
    this.startStamp = performance.now();
    const back = this.pausedFrom === 'tutorial' ? 'tutorial' : 'active';
    this.pausedFrom = null;
    this.transition(back, `resume:${this.machineReason}`);
  }

  // Backgrounding pauses solo simulation.
  background() {
    if (this.machine === 'active' || this.machine === 'tutorial') this.pause('background');
  }

  // --- commands ------------------------------------------------------------
  dispatch(cmd) {
    if (!this.state) return { error: 'no-round' };
    const withMeta = { id: this.state.nextCmdId, at: Math.floor(this.nowMs()), ...cmd };
    const r = applyCommand(this.state, withMeta);
    if (r.error) return r;
    this.state = r.state;
    this.commands.push(withMeta);
    if (this.commands.length % 8 === 0 || this.state.status !== 'active') {
      this.checkpoints.push({ after: withMeta.id, hash: hashState(this.state) });
    }
    for (const e of r.events || []) {
      if (e.type === 'score') {
        if (e.category === 'avalanche' && e.points > 0) this.stats.avalanches += 1;
        if (e.breakdown.bonus > 0) this.stats.upperBonuses += 1;
      }
      if (e.type === 'hold') this.stats.holdsUsed += 1;
      this.emit({ type: 'game-event', event: e, state: this.state });
    }
    if (this.state.status !== 'active') {
      this.transition('resolving', this.state.terminalReason);
      this.saveResult();
      this.clearAutosave();
      this.emit({ type: 'round-end', state: this.state, def: this.def });
    } else if (r.events?.some((e) => e.type === 'turn')) {
      this.snapshotTurnStart();
    }
    return r;
  }

  // --- player actions (with lesson gating and invalid explanations) ---------
  isHumanTurn() {
    return this.state && this.state.status === 'active' &&
      !currentPlayer(this.state).isAI &&
      (this.machine === 'active' || this.machine === 'tutorial');
  }

  roll() {
    if (!this.isHumanTurn()) return { error: 'not-your-turn' };
    const gate = this.lessonGate({ type: 'roll' });
    if (gate) {
      this.emit({ type: 'lesson-blocked', message: gate });
      return { error: 'lesson-gated' };
    }
    if (!canRoll(this.state)) {
      this.emit({ type: 'invalid', reason: 'no-rolls-left' });
      return { error: 'no-rolls-left' };
    }
    const r = this.dispatch({ type: 'roll' });
    if (!r.error) this.advanceLesson({ type: 'roll' });
    return r;
  }

  toggleHold(index) {
    if (!this.isHumanTurn()) return { error: 'not-your-turn' };
    const gate = this.lessonGate({ type: 'hold' });
    if (gate) {
      this.emit({ type: 'lesson-blocked', message: gate });
      return { error: 'lesson-gated' };
    }
    const r = this.dispatch({ type: 'hold', index });
    if (!r.error) this.advanceLesson({ type: 'hold' });
    return r;
  }

  scoreCategory(category) {
    if (!this.isHumanTurn()) return { error: 'not-your-turn' };
    const gate = this.lessonGate({ type: 'score', category });
    if (gate) {
      this.emit({ type: 'lesson-blocked', message: gate });
      return { error: 'lesson-gated' };
    }
    const legality = checkScore(this.state, category);
    if (!legality.ok) {
      // Rules still record the invalid try (tiebreaker); UI explains why.
      this.dispatch({ type: 'score', category });
      this.emit({ type: 'invalid', reason: legality.reason, category });
      return { error: legality.reason };
    }
    const r = this.dispatch({ type: 'score', category });
    if (!r.error) this.advanceLesson({ type: 'score', category });
    return r;
  }

  giveUp() {
    if (!this.state || this.state.status !== 'active') return { error: 'round-over' };
    return this.dispatch({ type: 'giveUp' });
  }

  hint() {
    if (!this.def?.assists?.hints) return { error: 'hints-disabled' };
    if (!this.isHumanTurn()) return { error: 'not-your-turn' };
    const h = getHint(this.state);
    if (h) this.emit({ type: 'hint', ...h });
    return h;
  }

  legalActions() {
    return listLegalActions(this.state);
  }

  // --- AI turns --------------------------------------------------------------
  // Returns the next batch of AI commands for the current seat, or null when
  // the current seat is human / the round is over. The caller dispatches them
  // (with presentation pacing) through this.dispatch.
  aiCommands() {
    if (!this.state || this.state.status !== 'active') return null;
    const me = currentPlayer(this.state);
    if (!me.isAI) return null;
    return aiStep(this.state, me.difficulty || 'hearth');
  }

  // --- undo ------------------------------------------------------------------
  // Undo restores the start of the current human turn. The stack top is the
  // current turn's restore point (pushed on every human turn-start); AI
  // commands since then are truncated from the replay log (already re-decided
  // by then — the snapshot sits after the last completed AI turn).
  undoAllowed() {
    const top = this.undoStack[this.undoStack.length - 1];
    return !!this.def?.assists?.undo && !!top &&
      this.state?.status === 'active' &&
      (this.machine === 'active' || this.machine === 'tutorial') &&
      this.commands.length > top.commands;
  }

  snapshotTurnStart() {
    if (!this.def?.assists?.undo) return;
    const me = currentPlayer(this.state);
    if (me?.isAI) return; // only human turn-starts are restore points
    this.undoStack.push({ state: serialize(this.state), commands: this.commands.length, stats: { ...this.stats } });
    if (this.undoStack.length > 60) this.undoStack.shift();
  }

  undo() {
    if (!this.undoAllowed()) return { error: 'undo-unavailable' };
    const snap = this.undoStack[this.undoStack.length - 1];
    this.state = deserialize(snap.state);
    this.stats = { ...snap.stats };
    this.commands.length = snap.commands;
    // Drop checkpoints that belong to the truncated commands.
    const lastId = this.commands.length ? this.commands[this.commands.length - 1].id : 0;
    this.checkpoints = this.checkpoints.filter((c) => c.after <= lastId);
    this.emit({ type: 'undo', state: this.state });
    return { ok: true };
  }

  // --- lessons ---------------------------------------------------------------
  currentLessonStep() {
    const steps = this.def?.tutorial?.steps;
    if (!steps || this.tutorialStep >= steps.length) return null;
    return steps[this.tutorialStep];
  }

  lessonGate(action) {
    const step = this.currentLessonStep();
    if (!step) return null;
    const req = step.require;
    if (req.type === 'any') return null;
    if ((action.type === 'roll' || action.type === 'score') && this.state.rollsLeft === 0) {
      // Last roll of the turn: no further actions are possible — never gate.
      return null;
    }
    if (req.type === 'roll' && action.type === 'roll') return null;
    if (req.type === 'hold' && action.type === 'hold') return null;
    if (req.type === 'score' && action.type === 'score') {
      if (!req.category || req.category === action.category) return null;
    }
    return 'Follow the lesson: ' + step.text;
  }

  advanceLesson(action) {
    const step = this.currentLessonStep();
    if (!step) return;
    // Only performing the required action advances the lesson.
    if (this.lessonGate(action) !== null && step.require.type !== 'any') return;
    this.tutorialStep += 1;
    const next = this.currentLessonStep();
    this.emit({ type: 'lesson-step', index: this.tutorialStep, step: next, done: !next });
  }

  // --- results -----------------------------------------------------------------
  outcome() {
    // The first seat is always the local player by construction.
    const state = this.state;
    const rankings = rankPlayers(state);
    const me = rankings.find((r) => r.player === 0);
    const won = playerWon(state, 0);
    return {
      won, rankings, me,
      status: won ? 'won' : 'lost',
      breakdown: totalsBreakdown(state.players[0].scores,
        enabledCategories(state).map((c) => c.id)),
    };
  }

  // --- persistence / replay --------------------------------------------------
  saveSnapshot() {
    if (!this.state || this.state.status !== 'active') return;
    const snap = {
      v: 1, def: this.def, state: serialize(this.state),
      commands: this.commands.filter((c) => c.id > 0),
      stats: { ...this.stats },
      savedAt: Date.now(), sessionId: this.sessionId,
    };
    this.platform.saveLocal(AUTOSAVE_KEY, snap);
  }

  // Reconnect from the durable snapshot, not from cached client memory.
  restoreSnapshot() {
    const snap = this.platform.loadLocal(AUTOSAVE_KEY);
    if (!snap) return null;
    try {
      this.def = snap.def;
      this.state = deserialize(snap.state);
      this.commands = snap.commands || [];
      this.sessionId = snap.sessionId || this.sessionId;
      this.undoStack = [];
      this.checkpoints = [{ after: 0, hash: hashState(createGame(this.def)) }];
      this.stats = { avalanches: 0, upperBonuses: 0, holdsUsed: 0, ...(snap.stats || {}) };
      const awayMs = Date.now() - (snap.savedAt || Date.now());
      this.transition('paused', 'reconnect');
      this.emit({ type: 'round', def: this.def, state: this.state });
      this.emit({
        type: 'while-away',
        summary: `Table restored. You were away ${Math.max(1, Math.round(awayMs / 60000))} min; ` +
          `round ${this.state.round}, ${currentPlayer(this.state).name} to act.`,
      });
      return snap;
    } catch {
      this.clearAutosave();
      return null;
    }
  }

  hasSnapshot() {
    return !!this.platform.loadLocal(AUTOSAVE_KEY);
  }

  clearAutosave() {
    this.platform.saveLocal(AUTOSAVE_KEY, null);
  }

  replayEnvelope() {
    return {
      schema: 1,
      build: this.def?.rulesV ?? 1,
      contentV: this.def?.v ?? 1,
      contentId: this.def?.id ?? null,
      seed: this.def?.seed,
      init: {
        seed: this.def.seed, players: this.def.players, mode: this.def.mode,
        contentId: this.def.id, rollsPerTurn: this.def.rollsPerTurn,
        disabledCategories: this.def.disabledCategories,
        goal: this.def.goal, limits: this.def.limits, par: this.def.par,
        ranked: this.def.ranked, mechanics: this.def.mechanics,
      },
      initHash: this.checkpoints[0]?.hash,
      timestampOffset: this.platform.serverOffsetMs?.() ?? 0,
      commands: this.commands.filter((c) => c.id > 0),
      checkpoints: this.checkpoints,
      result: this.state ? this.resultRecord() : null,
    };
  }

  resultRecord() {
    const out = this.outcome();
    return {
      contentId: this.def.id, mode: this.def.mode, seed: this.def.seed,
      status: out.status, reason: this.state.terminalReason,
      score: { ...out.breakdown },
      invalid: this.state.players[0].invalid,
      elapsedMs: this.state.clock,
      rankings: out.rankings.map((r) => ({
        player: r.player, name: r.name, grand: r.grand,
        upper: r.upper, bonus: r.bonus, lower: r.lower,
      })),
      stats: { ...this.stats },
      sessionId: this.sessionId, at: Date.now(),
      assists: this.def.assists, rulesV: this.def.rulesV, contentV: this.def.v,
      durationMs: this.state.clock,
    };
  }

  verifyOwnReplay() {
    const env = this.replayEnvelope();
    const r = replay(env);
    return r.ok && r.finalHash === this.checkpoints[this.checkpoints.length - 1]?.hash;
  }

  saveResult() {
    this.platform.recordResult(this.resultRecord(), this.replayEnvelope());
  }
}
