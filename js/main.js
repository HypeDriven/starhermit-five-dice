// Five Dice — bootstrap.
// Host handshake, capability detection, module wiring, lifecycle (visibility,
// resize, context loss), the countdown transition, AI turn pacing, the
// authoritative-clock ticker, and one-input acknowledgment feedback.

import { Platform } from './platform.js';
import { Session } from './session.js';
import { AudioEngine } from './audio.js';
import { UI } from './ui.js';
import { getTheme, validateContent, dailyForDate } from './content.js';
import { currentPlayer } from './rules.js';

const AI_PACE_MS = 650; // presentation pacing between AI command batches

async function boot() {
  const platform = await new Platform().init();
  platform.verifyProgress();
  if (platform.hosted) {
    platform.reconcileProgress().catch(() => {});
  }
  if (platform.devApi) {
    platform.startPresence();
    platform.activityStart();
  }

  const audio = new AudioEngine(platform.settings, (text) => ui?.toast(`♪ ${text}`));
  const session = new Session(platform, (e) => handleEvent(e));
  platform.onAchievements = (keys) => {
    platform.lastAchievements = [...(platform.lastAchievements || []), ...keys];
    audio.achievement();
    ui?.toast(`🏆 Achievement unlocked: ${keys.join(', ')}`);
  };

  // Renderer: 3D is optional; the semantic UI remains fully usable without it.
  let renderer = null;
  const canvas = document.getElementById('dice-stage');
  let rendererFailed = false;
  async function initRenderer() {
    try {
      const { Renderer } = await import('./render.js');
      renderer = new Renderer(canvas, platform.settings, getTheme(platform.settings.theme));
      renderer.onContextLost = () => {
        ui?.toast('Graphics context lost — rebuilding… (your table is safe)');
      };
      renderer.init();
      if (session.state) renderer.updateState(session.state, {});
    } catch (err) {
      rendererFailed = true;
      document.getElementById('dice-stage').hidden = true;
      ui?.showCompatibility(
        '3D rendering is unavailable in this browser, so the table is shown as ' +
        'the accessible card-and-dice panel. Your progress and saves are unaffected.');
    }
  }

  const env = {
    platform, session, audio,
    getRenderer: () => renderer,
    startContent,
    resumeSaved,
    giveUp: () => {
      const r = session.giveUp();
      if (r.error) ui.toast('Nothing to leave.');
    },
    tryRoll: () => guard(() => session.roll()),
    tryHold: (i) => guard(() => session.toggleHold(i)),
    tryScore: (cat) => guard(() => {
      if (platform.settings.holdToConfirm) {
        ui.confirm(`Score ${cat}?`, () => session.scoreCategory(cat));
      } else {
        session.scoreCategory(cat);
      }
    }),
    tryHint: () => {
      audio.ensure();
      session.hint();
    },
    tryUndo: () => {
      const r = session.undo();
      if (r.error) ui.toast('Undo is not available here.');
      else {
        renderer?.updateState(session.state, {});
        scheduleAI();
      }
    },
    cycleCamera: () => {
      const order = ['standard', 'low', 'overhead'];
      const cur = platform.settings.cameraTilt;
      platform.settings.cameraTilt = order[(order.indexOf(cur) + 1) % order.length];
      platform.saveSettings();
      renderer?.applyCameraPreset(platform.settings.cameraTilt);
    },
    onSettingsChanged: () => {
      const s = platform.settings;
      ui.applyTheme(getTheme(s.theme));
      renderer?.applyTheme(getTheme(s.theme));
      renderer?.applyQuality(s.quality);
      renderer?.applyCameraPreset(s.cameraTilt);
      audio.applyVolumes();
      platform.track('settings-change', { key: 'any' });
    },
  };

  function guard(fn) {
    audio.ensure(); // one-input acknowledgment includes waking audio
    const r = fn();
    audio.uiClick();
    return r;
  }

  const ui = new UI(env);
  env.ui = ui;
  ui.applyTheme(getTheme(platform.settings.theme));
  // Account nickname / cloud sync arrived after boot: refresh the title status.
  platform.onStatusChange = () => { if (!ui.hudVisible) ui.setStatus(platform.statusLine()); };

  // --- session event routing ---------------------------------------------------

  let clockTimer = null;
  let aiTimer = null;

  function handleEvent(e) {
    ui.handleSessionEvent(e);
    if (e.type === 'game-event') {
      audio.onGameEvent(e.event);
      renderer?.onGameEvent?.(e.event);
      if (e.event.type === 'score') audio.excite();
      if (e.event.type === 'roll') renderer?.updateState(session.state, { animate: true, rolled: e.event.rolled });
    } else if (e.type === 'round') {
      renderer?.updateState(e.state, {});
      platform.track('start', { mode: e.def.mode });
      startClockTicker();
    } else if (e.type === 'machine') {
      if (e.to === 'countdown') runCountdown();
      if (e.to === 'tutorial') {
        // Lessons start immediately in interactive form.
        ui.updateHUD();
      }
      if (e.to === 'resolving') {
        stopClockTicker();
        platform.track('round-end', { mode: session.def?.mode });
        setTimeout(() => {
          session.transition('results', session.state.terminalReason);
          audio.result(session.outcome().won);
          ui.showResults(session.resultRecord(), session.outcome());
          session.transition('progression', 'results-shown');
        }, platform.settings.reducedMotion ? 200 : 1400);
      }
      if (e.to === 'active' && e.reason.startsWith('resume')) scheduleAI();
      if (e.to === 'tutorial' && e.reason.startsWith('resume')) scheduleAI();
      // Countdown may have completed while the tab was hidden: honor the
      // background-pauses-solo rule as soon as the round goes active.
      if (e.to === 'active' && document.hidden) session.pause('background');
    } else if (e.type === 'round-end') {
      stopClockTicker();
    } else if (e.type === 'undo') {
      renderer?.updateState(session.state, {});
    }
    if (e.type === 'game-event' && e.event.type === 'turn') scheduleAI();
  }

  function runCountdown() {
    const el = document.getElementById('countdown');
    if (platform.settings.reducedMotion) {
      session.beginActive();
      scheduleAI();
      return;
    }
    el.hidden = false;
    let n = 3;
    el.textContent = String(n);
    ui.announce('Table ready. Starting in 3.');
    audio.countdownTick();
    const tick = () => {
      n -= 1;
      if (n <= 0) {
        el.hidden = true;
        audio.countdownTick(true);
        session.beginActive();
        ui.announce('Go!');
        scheduleAI();
        return;
      }
      el.textContent = String(n);
      audio.countdownTick();
      setTimeout(tick, 700);
    };
    setTimeout(tick, 700);
  }

  // AI turns: presentation-paced, every command still flows through the
  // session's validated dispatch path.
  function scheduleAI() {
    clearTimeout(aiTimer);
    if (!session.state || session.state.status !== 'active') return;
    if (session.machine !== 'active' && session.machine !== 'tutorial') return;
    const cmds = session.aiCommands();
    if (!cmds || !cmds.length) return;
    aiTimer = setTimeout(() => {
      let done = false;
      for (const cmd of cmds) {
        const r = session.dispatch(cmd);
        if (r.error) { done = true; break; }
        done = session.state.status !== 'active' || !currentPlayer(session.state).isAI;
        if (done) break;
      }
      if (!done) scheduleAI();
    }, platform.settings.reducedMotion ? 120 : AI_PACE_MS);
  }

  // Authoritative-clock ticker for time-limited tables: sends 'note' heartbeats
  // so the rules engine itself enforces the limit.
  function startClockTicker() {
    stopClockTicker();
    clockTimer = setInterval(() => {
      if (!session.state || session.state.status !== 'active') return;
      if (session.machine !== 'active' && session.machine !== 'tutorial') return;
      if (session.state.limits.totalMs != null) {
        const r = session.dispatch({ type: 'note' });
        if (r.error) return;
      }
      ui.updateHUD();
    }, 1000);
  }
  function stopClockTicker() { clearInterval(clockTimer); clockTimer = null; }

  // --- content start ---------------------------------------------------------------

  function startContent(def) {
    session.startRound(def);
  }

  function resumeSaved() {
    const snap = session.restoreSnapshot();
    if (!snap) {
      ui.toast('No saved table found.');
      ui.showTitle();
      return;
    }
    ui.showPause();
  }

  // --- canvas pointer input -----------------------------------------------------------

  // Tap vs drag/camera-gesture thresholds: distance and time.
  let pointerDown = null;
  canvas.addEventListener('pointerdown', (e) => {
    audio.ensure();
    pointerDown = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    const dx = e.clientX - pointerDown.x;
    const dy = e.clientY - pointerDown.y;
    const dist = Math.hypot(dx, dy);
    const dt = performance.now() - pointerDown.t;
    const wasTap = dist < 12 && dt < 500;
    pointerDown = null;
    if (!wasTap) return; // drag/camera gesture: no commit
    const die = renderer?.pickDie(e.clientX, e.clientY);
    if (die != null) {
      const r = session.toggleHold(die);
      if (r?.error === 'not-your-turn') ui.toast('Wait for your turn.');
      else if (r?.error === 'lesson-gated') { /* banner explains */ }
      else if (r?.error) ui.toast('Hold is not available right now.');
    }
  });
  canvas.addEventListener('pointercancel', () => { pointerDown = null; });
  canvas.addEventListener('lostpointercapture', () => { pointerDown = null; });

  // --- lifecycle ------------------------------------------------------------------------

  document.addEventListener('visibilitychange', () => {
    const hidden = document.hidden;
    renderer?.setHidden(hidden);
    audio.setBackgrounded(hidden);
    if (hidden) {
      session.background(); // backgrounding pauses solo simulation
      session.saveSnapshot();
      platform.pushCloudSave(); // flush the debounced cloud save
    }
  });
  window.addEventListener('pagehide', () => {
    session.saveSnapshot();
    platform.pushCloudSave(); // flush the debounced cloud save
    platform.activityEnd();
  });
  window.addEventListener('resize', () => renderer?.resize());
  window.addEventListener('orientationchange', () => setTimeout(() => renderer?.resize(), 120));

  // Dev-time content validation surfaces problems loudly instead of silently.
  const problems = validateContent();
  if (problems.length) {
    console.error('Content validation failures:', problems);
    ui.toast(`Content validation: ${problems.length} problem(s) — see console`);
  }

  // --- go --------------------------------------------------------------------------------

  await initRenderer();
  if (rendererFailed) {
    // Keep the DOM table usable even without WebGL.
    document.getElementById('dice-stage').hidden = true;
  }
  ui.showTitle();
  if (session.hasSnapshot()) {
    ui.toast('A saved table is waiting — Resume from the title menu.');
  }

  // Expose a minimal deterministic harness for automated smoke tests.
  window.__fivedice = { session, platform, startContent, ui };
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('compat-message');
  if (el) {
    el.hidden = false;
    el.textContent = `Five Dice failed to start: ${err.message}. Your browser may be too old; saves are unaffected.`;
  }
});
