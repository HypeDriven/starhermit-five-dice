// Five Dice — UI module.
// Owns the responsive DOM shell: title, mode select, journey map, play HUD,
// pause/settings, results, help, profile/leaderboards, overlays, focus
// management, live-region announcements, keyboard and gamepad control. The
// Three.js canvas is never the only UI: every interactive element has a
// semantic DOM equivalent here. UI state is kept apart from simulation state.

import {
  CATEGORIES, getCategory, listLegalActions, previewScores, totalsBreakdown,
  upperProgress, UPPER_BONUS_THRESHOLD, UPPER_BONUS, currentPlayer, DICE_COUNT,
} from './rules.js';
import {
  THEMES, LESSONS, JOURNEY, TRAILS, CHALLENGES, PRACTICE_DIFFICULTIES,
  practiceDef, dailyForDate, CONTENT_VERSION,
} from './content.js';
import { ACHIEVEMENTS } from './platform.js';

const PIP_GLYPHS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

const DEFAULT_BINDINGS = {
  hold0: 'Digit1', hold1: 'Digit2', hold2: 'Digit3', hold3: 'Digit4', hold4: 'Digit5',
  roll: 'KeyR', hint: 'KeyH', undo: 'KeyU', pause: 'Escape', camera: 'KeyC',
};
const GAMEPAD_DEFAULTS = {
  confirm: 0, cancel: 1, roll: 2, hint: 3, prev: 14, next: 15, pause: 9,
};

export class UI {
  constructor(env) {
    this.env = env; // { platform, session, audio, getRenderer, startContent, resumeSaved, giveUp }
    this.overlay = null;         // current overlay element
    this.overlayKind = null;
    this.lastFocus = null;
    this.focusDie = 0;           // keyboard/gamepad focus among dice
    this.hudVisible = false;
    this.gamepad = { idx: null, prevButtons: [], axesCooldown: 0 };
    this._toastTimer = null;
    this._els = {};
    for (const id of [
      'session-status', 'btn-pause', 'btn-help-top', 'btn-settings-top',
      'rail-left', 'rail-right', 'stage', 'dice-stage', 'lesson-banner',
      'countdown', 'dice-tray', 'action-tray', 'overlay-root', 'toast',
      'live', 'live-assertive', 'compat-message',
      'drawer-left-toggle', 'drawer-right-toggle',
    ]) this._els[id] = document.getElementById(id);
    this.applySettingsClasses();
    this.bindGlobalInput();
    this.bindTopbar();
    this.pollGamepads = this.pollGamepads.bind(this);
    requestAnimationFrame(this.pollGamepads);
  }

  get session() { return this.env.session; }
  get platform() { return this.env.platform; }
  get settings() { return this.platform.settings; }

  // --- helpers ---------------------------------------------------------------

  h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, '');
      else if (v !== false && v != null) el.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      el.append(c.nodeType ? c : document.createTextNode(c));
    }
    return el;
  }

  announce(msg, assertive = false) {
    const el = this._els[assertive ? 'live-assertive' : 'live'];
    el.textContent = '';
    // Re-assign on the next tick so repeated messages are re-announced.
    setTimeout(() => { el.textContent = msg; }, 30);
  }

  toast(msg, ms = 2600) {
    const t = this._els.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  applySettingsClasses() {
    const s = this.settings;
    document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
    document.body.classList.toggle('high-contrast', !!s.highContrast);
    document.body.classList.toggle('large-text', !!s.largeText);
    document.body.classList.toggle('left-handed', !!s.leftHanded);
    document.body.dataset.palette = s.palette || 'default';
  }

  applyTheme(theme) {
    const root = document.documentElement.style;
    root.setProperty('--felt', theme.felt);
    root.setProperty('--wood', theme.wood);
    root.setProperty('--wall', theme.wall);
    root.setProperty('--accent', theme.accent);
    root.setProperty('--select', theme.select);
    root.setProperty('--legal', theme.legal);
    root.setProperty('--danger', theme.danger);
    root.setProperty('--text', theme.text);
    root.setProperty('--page', theme.page);
  }

  bindings() {
    return { ...DEFAULT_BINDINGS, ...(this.settings.bindings || {}) };
  }

  // --- top bar -----------------------------------------------------------------

  bindTopbar() {
    this._els['btn-settings-top'].addEventListener('click', () => { this.env.audio.uiClick(); this.showSettings(); });
    this._els['btn-help-top'].addEventListener('click', () => { this.env.audio.uiClick(); this.showHelp(); });
    this._els['btn-pause'].addEventListener('click', () => this.togglePause());
    const drawer = (btn, side) => {
      btn.addEventListener('click', () => {
        const open = document.body.classList.toggle(`drawer-${side}-open`);
        btn.setAttribute('aria-expanded', String(open));
        document.body.classList.remove(`drawer-${side === 'left' ? 'right' : 'left'}-open`);
      });
    };
    drawer(this._els['drawer-left-toggle'], 'left');
    drawer(this._els['drawer-right-toggle'], 'right');
  }

  setStatus(text) {
    this._els['session-status'].textContent = text;
  }

  // --- overlays -----------------------------------------------------------------

  openOverlay(kind, build, { dismissible = true } = {}) {
    this.closeOverlay();
    this.lastFocus = document.activeElement;
    const content = this.h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': kind });
    if (dismissible) {
      content.prepend(this.h('button', {
        type: 'button', class: 'btn overlay-close', 'aria-label': 'Close',
        text: '✕', onclick: () => this.closeOverlay(),
      }));
    }
    build(content);
    const backdrop = this.h('div', { class: 'overlay-backdrop' }, content);
    backdrop.addEventListener('pointerdown', (e) => {
      if (dismissible && e.target === backdrop) this.closeOverlay();
    });
    this._els['overlay-root'].append(backdrop);
    this.overlay = backdrop;
    this.overlayKind = kind;
    // Focus the first actionable control; restore focus on close (no traps).
    const first = content.querySelector('button:not(.overlay-close), [href], input, select') ||
      content.querySelector('.overlay-close');
    first?.focus();
    return content;
  }

  closeOverlay() {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.overlayKind = null;
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
  }

  confirm(message, onYes) {
    this.openOverlay('Confirm', (c) => {
      c.append(this.h('p', { text: message }));
      c.append(this.h('div', { class: 'btn-row' },
        this.h('button', {
          type: 'button', class: 'btn danger', text: 'Yes',
          onclick: () => { this.closeOverlay(); onYes(); },
        }),
        this.h('button', {
          type: 'button', class: 'btn', text: 'Cancel',
          onclick: () => this.closeOverlay(),
        })));
    });
  }

  // --- title / mode select -------------------------------------------------------

  showTitle() {
    const p = this.platform;
    const hasSave = this.session.hasSnapshot();
    const daily = dailyForDate(new Date(p.serverNow()));
    const doneToday = !!p.progress.bestDaily[daily.id];
    const journeyDone = Object.values(p.progress.journey).filter((j) => j.done).length;
    this.setStatus(p.statusLine());
    this.setHudVisible(false);

    const title = this.openOverlay('Five Dice', (c) => {
      c.append(this.h('p', {
        text: 'A cozy mountain-lodge dice table. Roll five dice up to three times, ' +
          'hold the keepers, and fill your card — highest total wins.',
      }));
      const list = this.h('ul', { class: 'menu-list' });
      const add = (label, sub, fn, primary = false) => {
        list.append(this.h('li', {}, this.h('button', {
          type: 'button', class: `btn${primary ? ' primary' : ''}`,
          onclick: () => { this.env.audio.uiClick(); fn(); },
        }, this.h('span', { text: label }), this.h('span', { class: 'sub', text: sub }))));
      };
      if (hasSave) add('Resume Table', 'continue your saved round', () => { this.closeOverlay(); this.env.resumeSaved(); }, true);
      add('Practice', 'quick table vs the lodge AI', () => this.showPracticeSetup(), !hasSave);
      add('Daily Table', doneToday ? `${daily.day} — played, best ${p.progress.bestDaily[daily.id]}` : `${daily.day} — shared seed`, () => {
        this.closeOverlay(); this.env.startContent(daily);
      });
      add('Journey', `${journeyDone} / ${JOURNEY.length} stages cleared`, () => this.showJourney());
      add('Learn', 'interactive lessons, one rule at a time', () => this.showLessons());
      add('Challenges', 'constrained tables for sharp players', () => this.showChallenges());
      add('Profile & Scores', 'achievements, leaderboards, stats', () => this.showProfile());
      add('Help & Rules', 'how a table works', () => this.showHelp());
      c.append(list);
      c.append(this.h('p', { class: 'muted', text: `Content v${CONTENT_VERSION} · Rules v1 · seed-fair: every table is replayable and inspectable.` }));
    }, { dismissible: false });
    // Lodge key art behind the title card (CSS background: a missing file
    // simply leaves the plain dimmed backdrop).
    title.parentElement?.classList.add('title-backdrop');
  }

  showPracticeSetup() {
    this.openOverlay('Practice setup', (c) => {
      c.append(this.h('p', { class: 'muted', text: 'Unranked. Undo and hints are on; restart freely.' }));
      const list = this.h('ul', { class: 'menu-list' });
      for (const d of Object.values(PRACTICE_DIFFICULTIES)) {
        list.append(this.h('li', {}, this.h('button', {
          type: 'button', class: 'btn',
          onclick: () => { this.closeOverlay(); this.env.startContent(practiceDef({ difficulty: d.id })); },
        }, this.h('span', { text: d.name }), this.h('span', { class: 'sub', text: d.blurb }))));
      }
      list.append(this.h('li', {}, this.h('button', {
        type: 'button', class: 'btn',
        onclick: () => { this.closeOverlay(); this.env.startContent(practiceDef({ difficulty: 'hearth', humans: 2, aiOpponents: 0 })); },
      }, this.h('span', { text: 'Two players, one screen' }), this.h('span', { class: 'sub', text: 'pass-and-play, no AI' }))));
      c.append(list);
    });
  }

  showLessons() {
    this.openOverlay('Learn', (c) => {
      const list = this.h('ul', { class: 'menu-list' });
      LESSONS.forEach((l, i) => {
        const done = this.settings.tutorialsDone[l.id];
        list.append(this.h('li', {}, this.h('button', {
          type: 'button', class: 'btn',
          onclick: () => { this.closeOverlay(); this.env.startContent(l); },
        }, this.h('span', { text: `${i + 1}. ${l.name}${done ? ' ✓' : ''}` }))));
      });
      c.append(list);
    });
  }

  showJourney() {
    this.openOverlay('Journey', (c) => {
      const progress = this.platform.progress.journey;
      let unlockedIdx = 0;
      while (unlockedIdx < JOURNEY.length && progress[JOURNEY[unlockedIdx].id]?.done) unlockedIdx++;
      TRAILS.forEach((trail, t) => {
        c.append(this.h('h3', { text: trail.name }));
        const grid = this.h('div', { class: 'card-grid' });
        for (let s = 0; s < 8; s++) {
          const stage = JOURNEY[t * 8 + s];
          const rec = progress[stage.id];
          const locked = t * 8 + s > unlockedIdx;
          grid.append(this.h('button', {
            type: 'button', class: `stage-card${stage.mastery ? ' mastery' : ''}`,
            disabled: locked, 'aria-label': `${stage.name}${locked ? ' (locked)' : ''}`,
            onclick: () => { this.closeOverlay(); this.env.startContent(stage); },
          },
            this.h('div', { text: `${stage.stage}. ${stage.mastery ? 'Mastery' : ''}` }),
            this.h('div', { class: 'stars', text: rec?.done ? '★'.repeat(rec.stars || 1) : (locked ? '🔒' : '—') }),
            this.h('div', { class: 'muted', text: stage.goal?.type === 'score' ? `Target ${stage.goal.target}` : `${stage.players.length}-handed` })));
        }
        c.append(grid);
      });
    });
  }

  showChallenges() {
    this.openOverlay('Challenges', (c) => {
      const list = this.h('ul', { class: 'menu-list' });
      for (const ch of CHALLENGES) {
        const rec = this.platform.progress.challenges[ch.id];
        list.append(this.h('li', {}, this.h('button', {
          type: 'button', class: 'btn',
          onclick: () => { this.closeOverlay(); this.env.startContent(ch); },
        },
          this.h('span', { text: `${ch.name}${rec?.done ? ' ✓' : ''}` }),
          this.h('span', { class: 'sub', text: ch.blurb }))));
      }
      c.append(list);
    });
  }

  // --- help ------------------------------------------------------------------------

  showHelp() {
    const b = this.bindings();
    const key = (code) => code.replace('Key', '').replace('Digit', '');
    this.openOverlay('Help & Rules', (c) => {
      c.append(this.h('h3', { text: 'How a table works' }));
      c.append(this.h('p', { text: 'Roll five dice. You may reroll any unheld dice twice more (three rolls total). Tap a die to hold it between rolls. Then choose exactly one open category on the card to score. When every category on every card is filled, the highest grand total wins.' }));
      c.append(this.h('h3', { text: 'The card' }));
      const ul = this.h('ul');
      for (const cat of CATEGORIES) {
        ul.append(this.h('li', { text: `${cat.name} — ${cat.desc}` }));
      }
      c.append(ul);
      c.append(this.h('p', { text: `Upper rows (Kindling…Peaks) totaling ${UPPER_BONUS_THRESHOLD}+ earn a ${UPPER_BONUS}-point lodge bonus.` }));
      c.append(this.h('h3', { text: 'Controls' }));
      c.append(this.h('p', { text: `Roll: ${key(b.roll)} or the Roll button. Hold die: 1–5 keys or tap. Hint: ${key(b.hint)}. Undo: ${key(b.undo)} where allowed. Pause: Esc. Camera: ${key(b.camera)}. Arrow keys move focus; Enter confirms. Gamepad: D-pad moves focus, A holds, X rolls, Start pauses.` }));
      c.append(this.h('p', { class: 'muted', text: 'Every table is seeded and replayable; the same seed and choices always produce the same dice.' }));
    });
  }

  // --- settings ---------------------------------------------------------------------

  showSettings() {
    const s = this.settings;
    this.openOverlay('Settings', (c) => {
      const grid = this.h('div', { class: 'settings-grid' });
      const save = () => { this.platform.saveSettings(); this.applySettingsClasses(); this.env.onSettingsChanged?.(); };
      const slider = (label, key) => {
        const input = this.h('input', {
          type: 'range', min: '0', max: '1', step: '0.05', value: String(s[key] ?? 0.5),
          'aria-label': label,
          oninput: (e) => { s[key] = Number(e.target.value); this.env.audio.applyVolumes(); save(); },
        });
        grid.append(this.h('label', {}, label, input));
      };
      const toggle = (label, key) => {
        const input = this.h('input', {
          type: 'checkbox', ...(s[key] ? { checked: true } : {}),
          onchange: (e) => { s[key] = e.target.checked; save(); },
        });
        grid.append(this.h('label', {}, label, input));
      };
      const select = (label, key, options) => {
        const sel = this.h('select', { 'aria-label': label, onchange: (e) => { s[key] = e.target.value; save(); } },
          options.map(([v, name]) => this.h('option', { value: v, ...(s[key] === v ? { selected: true } : {}), text: name })));
        grid.append(this.h('label', {}, label, sel));
      };

      c.append(this.h('h3', { text: 'Audio' }));
      slider('Music', 'volMusic');
      slider('Effects', 'volEffects');
      slider('Ambience', 'volAmbience');
      slider('Voice', 'volVoice');
      toggle('Mute all', 'muted');
      toggle('Captions for audio cues', 'captions');

      c.append(this.h('h3', { text: 'Graphics' }));
      select('Theme', 'theme', THEMES.map((t) => [t.id, t.name]));
      select('Quality tier', 'quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
      select('Camera', 'cameraTilt', [['standard', 'Standard'], ['low', 'Low'], ['overhead', 'Overhead']]);
      toggle('Reduced motion', 'reducedMotion');
      toggle('High contrast', 'highContrast');
      select('Color-vision palette', 'palette', [['default', 'Default'], ['deuteranopia', 'Deuteranopia-safe'], ['protanopia', 'Protanopia-safe'], ['tritanopia', 'Tritanopia-safe']]);

      c.append(this.h('h3', { text: 'Controls & access' }));
      toggle('Larger text', 'largeText');
      toggle('Left-handed controls', 'leftHanded');
      toggle('Hold to confirm scoring', 'holdToConfirm');
      toggle('Timing assistance', 'timingAssist');
      toggle('Haptics', 'haptics');

      c.append(this.h('h3', { text: 'Privacy' }));
      const consent = this.h('input', {
        type: 'checkbox', ...(this.platform.consent.telemetry ? { checked: true } : {}),
        onchange: (e) => {
          this.platform.consent.telemetry = e.target.checked;
          s.telemetryConsent = e.target.checked;
          save();
          this.toast(e.target.checked ? 'Anonymous funnel telemetry on' : 'Telemetry off');
        },
      });
      grid.append(this.h('label', {}, 'Anonymous usage telemetry', consent));

      c.append(grid);
      c.append(this.h('div', { class: 'btn-row', style: 'margin-top:0.8rem' },
        this.h('button', {
          type: 'button', class: 'btn', text: 'Replay tutorials',
          onclick: () => { s.tutorialsDone = {}; save(); this.toast('Tutorials reset'); },
        })));
    });
  }

  // --- profile / leaderboards ---------------------------------------------------------

  async showProfile() {
    const p = this.platform;
    this.openOverlay('Profile & Scores', async (c) => {
      if (p.profile.account) {
        // Account identity: platform nickname, read-only (never usernames).
        c.append(this.h('div', { class: 'settings-grid' },
          this.h('label', {}, 'Player', this.h('span', { text: p.profile.name }))));
      } else {
        const nameInput = this.h('input', {
          type: 'text', value: p.profile.name, maxlength: '20', 'aria-label': 'Display name',
          onchange: (e) => {
            p.profile.name = e.target.value.trim() || 'Guest';
            p.saveProfile();
            this.toast('Name saved');
          },
        });
        c.append(this.h('div', { class: 'settings-grid' }, this.h('label', {}, 'Display name', nameInput)));
      }
      c.append(this.h('p', { class: 'muted', text: p.profile.guest ? 'Guest profile — progress is stored on this device. Sign in from the host shell for durable cloud progress.' : 'Signed in with your account.' }));
      c.append(this.h('p', { class: 'muted', text: p.syncLabel() }));

      const t = p.progress.totals;
      c.append(this.h('h3', { text: 'Lifetime' }));
      c.append(this.h('p', { text: `${t.games} tables · ${t.wins} wins · ${t.points} total points · ${t.avalanches} avalanches · ${p.progress.streakDays.length} active days` }));

      c.append(this.h('h3', { text: 'Achievements' }));
      const ach = this.h('ul', { class: 'ach-list' });
      for (const a of ACHIEVEMENTS) {
        const got = p.progress.achievements[a.key];
        ach.append(this.h('li', { class: got ? '' : 'locked' },
          this.h('div', { class: 'ach-name', text: `${got ? '🏆' : '○'} ${a.name}` }),
          this.h('div', { class: 'muted', text: a.desc })));
      }
      c.append(ach);

      c.append(this.h('h3', { text: 'Leaderboards' }));
      const boardBox = this.h('div', {}, this.h('p', { class: 'muted', text: 'Loading…' }));
      const loadBoard = async (board, label) => {
        boardBox.replaceChildren(this.h('p', { class: 'muted', text: 'Loading…' }));
        const res = await p.leaderboard(board);
        const table = this.h('table', { class: 'results-table' },
          this.h('tr', {}, this.h('th', { text: '#' }), this.h('th', { text: 'Player' }), this.h('th', { class: 'num', text: 'Score' })));
        res.entries.slice(0, 10).forEach((e, i) => {
          table.append(this.h('tr', { class: e.me ? 'me' : '' },
            this.h('td', { text: String(i + 1) }),
            this.h('td', { text: e.name }),
            this.h('td', { class: 'num', text: String(e.score) })));
        });
        if (!res.entries.length) table.append(this.h('tr', {}, this.h('td', { colspan: '3', text: 'No entries yet — play a table!' })));
        boardBox.replaceChildren(this.h('p', { class: 'muted', text: `${label} · ${res.label}` }), table);
      };
      const tabs = this.h('div', { class: 'btn-row' },
        this.h('button', { type: 'button', class: 'btn', text: 'Daily', onclick: () => loadBoard('daily', 'Daily tables') }),
        this.h('button', { type: 'button', class: 'btn', text: 'Challenge', onclick: () => loadBoard('challenge', 'Challenge tables') }),
        this.h('button', { type: 'button', class: 'btn', text: 'Journey wins', onclick: () => loadBoard('journey', 'Journey wins') }));
      c.append(tabs, boardBox);
      loadBoard('daily', 'Daily tables');
    });
  }

  // --- HUD ------------------------------------------------------------------------------

  setHudVisible(v) {
    this.hudVisible = v;
    for (const id of ['dice-tray', 'action-tray']) this._els[id].hidden = !v;
    this._els['btn-pause'].hidden = !v;
    document.body.classList.toggle('in-game', v);
    if (!v) {
      this._els['rail-left'].replaceChildren();
      this._els['rail-right'].replaceChildren();
      this._els['lesson-banner'].hidden = true;
    }
  }

  updateHUD() {
    const st = this.session.state;
    if (!st || !this.hudVisible) return;
    const def = this.session.def;
    const me = currentPlayer(st);
    const legal = listLegalActions(st);
    const previews = previewScores(st);
    const humanTurn = this.session.isHumanTurn();

    // Status line: objective, progress, actor.
    const left = st.players[0].scores;
    const filled = Object.values(left).filter((v) => v != null).length;
    const total = Object.keys(left).length;
    // Turn-critical facts come first so a narrow status line never truncates them.
    let status = `${me.name}${me.isAI ? ' (AI)' : ''} to act · rolls left ${st.rollsLeft} · round ${st.round} — ${def.name}`;
    if (st.limits.totalMs != null) {
      const remain = Math.max(0, st.limits.totalMs - this.session.nowMs());
      status += ` · ⏱ ${Math.floor(remain / 60000)}:${String(Math.floor(remain / 1000) % 60).padStart(2, '0')}`;
    }
    this.setStatus(status);

    this.renderScorecard(st, legal, previews, humanTurn, filled, total);
    this.renderRightRail(st);
    this.renderDiceTray(st, legal, humanTurn);
    this.renderActionTray(st, legal, humanTurn);

    const step = this.session.currentLessonStep();
    const banner = this._els['lesson-banner'];
    if (step) {
      banner.textContent = step.text;
      banner.hidden = false;
    } else if (this.session.machine === 'tutorial' && !step) {
      banner.textContent = 'Lesson complete — finish the table!';
    } else {
      banner.hidden = true;
    }
  }

  renderScorecard(st, legal, previews, humanTurn, filled, total) {
    const me = currentPlayer(st);
    const rail = this._els['rail-left'];
    rail.replaceChildren();
    const canScore = humanTurn && st.hasRolled;
    const scoreable = new Set(legal.scoreable);

    const table = this.h('table', { class: 'scorecard' });
    table.append(this.h('caption', { text: `${me.name}'s card — ${filled}/${total} filled` }));
    let section = null;
    for (const cat of CATEGORIES) {
      if (st.disabledCategories.includes(cat.id)) continue;
      if (cat.section !== section) {
        section = cat.section;
        table.append(this.h('tr', { class: 'section-head' },
          this.h('th', { colspan: '2', text: section === 'upper' ? 'Upper — face totals' : 'Lower — hands' })));
      }
      const closed = me.scores[cat.id];
      const tr = this.h('tr', { class: closed != null ? 'row-closed' : '' });
      const isLegal = canScore && scoreable.has(cat.id);
      const tdBtn = this.h('td', {});
      if (closed != null) {
        tdBtn.append(this.h('span', { text: cat.name }));
        tr.append(tdBtn, this.h('td', { class: 'closed-val', text: String(closed) }));
      } else {
        const pv = previews[cat.id];
        const btn = this.h('button', {
          type: 'button', class: `cat${isLegal ? ' legal' : ''}`,
          disabled: !isLegal,
          'aria-label': isLegal
            ? `Score ${cat.name} for ${pv} points`
            : `${cat.name} — ${cat.desc}${st.hasRolled ? '' : ' (roll first)'}`,
          title: cat.desc,
          onclick: () => this.env.tryScore(cat.id),
        },
          this.h('span', { class: 'nm', text: cat.name }),
          this.h('span', { class: 'pv', text: pv != null ? String(pv) : '·' }));
        tdBtn.append(btn);
        tr.append(tdBtn, this.h('td', { class: 'points', text: pv != null && !isLegal ? String(pv) : '' }));
      }
      table.append(tr);
    }
    const b = totalsBreakdown(me.scores);
    table.append(this.h('tr', { class: 'totals' },
      this.h('td', { text: `Upper ${b.upper} · Bonus ${b.bonus} · Lower ${b.lower}` }),
      this.h('td', { class: 'points', text: `Σ ${b.grand}` })));
    rail.append(table);
    const up = upperProgress(me.scores);
    rail.append(this.h('p', {
      class: 'bonus-meter',
      text: b.bonus ? `Lodge bonus earned (+${UPPER_BONUS})` : `Upper bonus: ${up}/${UPPER_BONUS_THRESHOLD}`,
    }));
  }

  renderRightRail(st) {
    const rail = this._els['rail-right'];
    rail.replaceChildren();
    const sec = this.h('section', {});
    sec.append(this.h('h2', { text: 'Table' }));
    const ul = this.h('ul', { class: 'player-list' });
    st.players.forEach((pl, i) => {
      const b = totalsBreakdown(pl.scores);
      ul.append(this.h('li', { class: i === st.current ? 'current' : '' },
        this.h('span', { class: 'pl-name', text: pl.name + (pl.isAI ? ' 🤖' : '') }),
        this.h('span', { class: 'pl-score', text: String(b.grand) })));
    });
    sec.append(ul);
    rail.append(sec);

    const acts = this.h('section', {});
    acts.append(this.h('h2', { text: 'Actions' }));
    const stack = this.h('div', { class: 'actions-stack' });
    this.buildActionButtons(stack, st);
    acts.append(stack);
    rail.append(acts);
  }

  buildActionButtons(container, st) {
    const legal = listLegalActions(st);
    const humanTurn = this.session.isHumanTurn();
    const canRoll = humanTurn && legal.canRoll;
    const rollBtn = this.h('button', {
      type: 'button', class: 'btn primary', id: 'btn-roll',
      disabled: !canRoll,
      'aria-label': canRoll ? `Roll dice (${st.rollsLeft} left)` : 'Roll dice (unavailable)',
      text: `🎲 Roll (${st.rollsLeft})`,
      onclick: () => this.env.tryRoll(),
    });
    container.append(rollBtn);
    container.append(this.h('button', {
      type: 'button', class: 'btn', text: 'Hint', disabled: !humanTurn || !this.session.def?.assists?.hints,
      onclick: () => this.env.tryHint(),
    }));
    container.append(this.h('button', {
      type: 'button', class: 'btn', text: 'Undo turn', disabled: !this.session.undoAllowed(),
      onclick: () => this.env.tryUndo(),
    }));
    container.append(this.h('button', {
      type: 'button', class: 'btn tray-secondary', text: 'Pause',
      onclick: () => this.togglePause(),
    }));
    container.append(this.h('button', {
      type: 'button', class: 'btn danger tray-secondary', text: 'Leave table',
      onclick: () => this.confirm('Leave this table? The round will be recorded as a forfeit.', () => this.env.giveUp()),
    }));
  }

  renderDiceTray(st, legal, humanTurn) {
    const tray = this._els['dice-tray'];
    tray.replaceChildren();
    const canHold = humanTurn && legal.holdable.length > 0;
    for (let i = 0; i < DICE_COUNT; i++) {
      const v = st.dice[i];
      const held = st.held[i];
      const btn = this.h('button', {
        type: 'button', class: `die-btn${held ? ' held' : ''}`,
        disabled: !canHold || v === 0,
        'aria-label': v === 0 ? `Die ${i + 1}, not rolled` : `Die ${i + 1}, showing ${v}${held ? ', held' : ''}. ${canHold ? (held ? 'Activate to release' : 'Activate to hold') : ''}`,
        'aria-pressed': held ? 'true' : 'false',
        'data-die': String(i),
        onclick: () => this.env.tryHold(i),
      }, this.h('span', { class: 'pip', text: v > 0 ? PIP_GLYPHS[v - 1] : '–' }));
      tray.append(btn);
    }
  }

  renderActionTray(st, legal, humanTurn) {
    const tray = this._els['action-tray'];
    tray.replaceChildren();
    this.buildActionButtons(tray, st);
  }

  // --- pause / results -----------------------------------------------------------------

  togglePause() {
    const s = this.session;
    if (s.machine === 'active' || s.machine === 'tutorial') {
      s.pause('user');
      this.showPause();
    } else if (s.machine === 'paused') {
      this.closeOverlay();
      s.resume();
    }
  }

  showPause() {
    this.openOverlay('Paused', (c) => {
      const list = this.h('ul', { class: 'menu-list' });
      const add = (label, fn, primary = false) => list.append(this.h('li', {},
        this.h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, text: label, onclick: fn })));
      add('Resume', () => { this.closeOverlay(); this.session.resume(); }, true);
      add('Settings', () => this.showSettings());
      add('Help', () => this.showHelp());
      add('Leave table', () => this.confirm('Forfeit this table?', () => { this.closeOverlay(); this.env.giveUp(); }));
      c.append(list);
    });
  }

  showResults(record, outcome) {
    this.setHudVisible(false);
    const won = record.status === 'won';
    const b = record.score;
    this.openOverlay('Results', (c) => {
      // Verdict illustration; hides itself if the asset fails to load.
      const art = this.h('img', {
        class: 'results-art', alt: '', 'aria-hidden': 'true', decoding: 'async',
        src: won ? 'assets/results-win.webp' : 'assets/results-lose.webp',
      });
      art.addEventListener('error', () => art.remove());
      c.append(art);
      c.append(this.h('h2', { text: won ? '🏔 You take the table!' : record.reason === 'gave-up' ? 'Table forfeited' : record.reason === 'time-limit' ? '⏱ The blizzard wins' : 'The lodge keeps its crown' }));
      c.append(this.h('p', { text: `Your card: upper ${b.upper} + bonus ${b.bonus} + lower ${b.lower} = ${b.grand} points · ${record.invalid} invalid action${record.invalid === 1 ? '' : 's'} · ${(record.durationMs / 1000).toFixed(0)}s` }));
      if (this.session.def?.par?.score) {
        c.append(this.h('p', { class: 'muted', text: `Par for this table: ${this.session.def.par.score}` }));
      }
      const table = this.h('table', { class: 'results-table' });
      table.append(this.h('tr', {},
        this.h('th', { text: '#' }), this.h('th', { text: 'Player' }),
        this.h('th', { class: 'num', text: 'Upper' }), this.h('th', { class: 'num', text: 'Bonus' }),
        this.h('th', { class: 'num', text: 'Lower' }), this.h('th', { class: 'num', text: 'Total' })));
      record.rankings.forEach((r, i) => {
        table.append(this.h('tr', { class: r.player === 0 ? 'me' : '' },
          this.h('td', { text: String(i + 1) }),
          this.h('td', { text: r.name }),
          this.h('td', { class: 'num', text: String(r.upper ?? '') }),
          this.h('td', { class: 'num', text: String(r.bonus ?? '') }),
          this.h('td', { class: 'num', text: String(r.lower ?? '') }),
          this.h('td', { class: 'num', text: String(r.grand) })));
      });
      c.append(table);

      const newly = this.platform.lastAchievements || [];
      if (newly.length) {
        c.append(this.h('h3', { text: 'Achievements unlocked' }));
        const ul = this.h('ul', { class: 'ach-list' });
        for (const key of newly) {
          const meta = ACHIEVEMENTS.find((a) => a.key === key);
          if (meta) ul.append(this.h('li', {}, this.h('div', { class: 'ach-name', text: `🏆 ${meta.name}` }), this.h('div', { class: 'muted', text: meta.desc })));
        }
        c.append(ul);
      }

      // Next recommended action.
      const list = this.h('ul', { class: 'menu-list' });
      const def = this.session.def;
      const add = (label, fn, primary = false) => list.append(this.h('li', {},
        this.h('button', { type: 'button', class: `btn${primary ? ' primary' : ''}`, text: label, onclick: () => { this.closeOverlay(); fn(); } })));
      let recommended = false;
      if (def.mode === 'journey' && won) {
        const next = JOURNEY.find((j) => j.stage === def.stage + 1);
        if (next) { add(`Next: ${next.name}`, () => this.env.startContent(next), true); recommended = true; }
      }
      add('Play again', () => this.env.startContent(def.mode === 'practice' ? practiceDef({ difficulty: def.id.split('-')[1] || 'hearth' }) : def), !recommended);
      add('Back to title', () => this.showTitle());
      c.append(list);
    }, { dismissible: false });
    this.announce(won ? `You won with ${b.grand} points` : `Table over. You scored ${b.grand} points`, true);
  }

  // --- compatibility ----------------------------------------------------------------------

  showCompatibility(msg) {
    const el = this._els['compat-message'];
    el.textContent = msg;
    el.hidden = false;
  }

  // --- session events ------------------------------------------------------------------------

  handleSessionEvent(e) {
    switch (e.type) {
      case 'machine':
        if (e.to === 'results') { /* results overlay handled by main via round-end */ }
        break;
      case 'round':
        this.closeOverlay();
        this.setHudVisible(true);
        this.updateHUD();
        this.announce(`${e.def.name}. ${currentPlayer(e.state).name} to act.`);
        break;
      case 'game-event': {
        const ev = e.event;
        if (ev.type === 'score') {
          const cat = getCategory(ev.category);
          this.announce(`${e.state.players[ev.player].name} scored ${ev.points} on ${cat?.name ?? ev.category}`);
          if (this.settings.haptics && navigator.vibrate && ev.player === 0) navigator.vibrate(30);
        } else if (ev.type === 'invalid') {
          this.announce(`Invalid action: ${invalidText(ev.reason)}`, true);
          this.toast(invalidText(ev.reason));
        } else if (ev.type === 'turn') {
          this.announce(`${e.state.players[ev.player].name}'s turn`);
        } else if (ev.type === 'roll') {
          if (this.settings.haptics && navigator.vibrate && ev.player === 0) navigator.vibrate(12);
        }
        this.updateHUD();
        break;
      }
      case 'invalid':
        this.announce(invalidText(e.reason), true);
        this.toast(invalidText(e.reason));
        break;
      case 'lesson-blocked':
        this.toast(e.message);
        break;
      case 'lesson-step':
        if (e.done) {
          this.settings.tutorialsDone[this.session.def.id] = true;
          this.platform.saveSettings();
          this.env.audio.lessonComplete();
          this.toast('Lesson complete — finish the table!');
        }
        this.updateHUD();
        break;
      case 'hint':
        this.toast(e.reason || 'Try the highlighted option');
        this.announce(e.reason || 'Hint shown');
        break;
      case 'undo':
        this.toast('Turn restored');
        this.updateHUD();
        break;
      case 'while-away':
        this.toast(e.summary, 5000);
        this.announce(e.summary);
        break;
      default:
        break;
    }
  }

  // --- input: keyboard + gamepad ------------------------------------------------------

  bindGlobalInput() {
    window.addEventListener('keydown', (ev) => {
      if (ev.defaultPrevented) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        if (ev.code === 'Escape') document.activeElement.blur();
        return;
      }
      const b = this.bindings();
      const code = ev.code;
      if (code === b.pause) {
        ev.preventDefault();
        if (this.overlay && this.overlayKind === 'Paused') this.togglePause(); // close + resume
        else if (this.overlay && this.overlayKind !== 'Results') this.closeOverlay();
        else if (this.hudVisible) this.togglePause();
        return;
      }
      if (this.overlay || !this.hudVisible) {
        // Arrow-key navigation stays native (tab order) inside overlays.
        return;
      }
      for (let i = 0; i < DICE_COUNT; i++) {
        if (code === b[`hold${i}`]) { ev.preventDefault(); this.env.tryHold(i); return; }
      }
      if (code === b.roll) { ev.preventDefault(); this.env.tryRoll(); }
      else if (code === b.hint) { ev.preventDefault(); this.env.tryHint(); }
      else if (code === b.undo) { ev.preventDefault(); this.env.tryUndo(); }
      else if (code === b.camera) { ev.preventDefault(); this.env.cycleCamera?.(); }
      else if (code === 'ArrowLeft' || code === 'ArrowRight') {
        ev.preventDefault();
        this.moveDieFocus(code === 'ArrowRight' ? 1 : -1);
      } else if (code === 'Enter' || code === 'Space') {
        // Confirm focused die hold if focus is on a die button.
        const die = document.activeElement?.dataset?.die;
        if (die != null) { ev.preventDefault(); this.env.tryHold(Number(die)); }
      }
    });

    window.addEventListener('gamepadconnected', (e) => { this.gamepad.idx = e.gamepad.index; });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepad.idx === e.gamepad.index) this.gamepad.idx = null;
    });
  }

  moveDieFocus(delta) {
    const tray = this._els['dice-tray'];
    const btns = [...tray.querySelectorAll('.die-btn:not(:disabled)')];
    if (!btns.length) return;
    this.focusDie = (this.focusDie + delta + DICE_COUNT) % DICE_COUNT;
    const target = btns.find((b) => Number(b.dataset.die) === this.focusDie) || btns[0];
    target.focus();
  }

  pollGamepads() {
    requestAnimationFrame(this.pollGamepads);
    if (this.gamepad.idx == null || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[this.gamepad.idx];
    if (!gp) return;
    const map = { ...GAMEPAD_DEFAULTS, ...(this.settings.bindings?.gamepad || {}) };
    const pressed = (i) => gp.buttons[i]?.pressed;
    const justPressed = (i) => pressed(i) && !this.gamepad.prevButtons[i];
    if (this.overlay || !this.hudVisible) {
      if (justPressed(map.cancel)) this.closeOverlay();
    } else {
      if (justPressed(map.pause)) this.togglePause();
      if (justPressed(map.roll)) this.env.tryRoll();
      if (justPressed(map.hint)) this.env.tryHint();
      if (justPressed(map.prev)) this.moveDieFocus(-1);
      if (justPressed(map.next)) this.moveDieFocus(1);
      if (justPressed(map.confirm)) {
        const die = document.activeElement?.dataset?.die;
        if (die != null) this.env.tryHold(Number(die));
      }
      if (justPressed(map.cancel)) {
        // Secondary action: undo where valid.
        this.env.tryUndo();
      }
    }
    this.gamepad.prevButtons = gp.buttons.map((b) => b.pressed);
  }
}

function invalidText(reason) {
  const TEXT = {
    'no-rolls-left': 'No rolls left — choose a category to score.',
    'must-roll-first': 'Roll the dice first.',
    'category-closed': 'That category is already filled.',
    'category-disabled': 'That category is closed at this table.',
    'unknown-category': 'Unknown category.',
    'round-over': 'The table is over.',
  };
  return TEXT[reason] || `Action not allowed (${reason}).`;
}
