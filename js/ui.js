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
  practiceDef, dailyForDate, CONTENT_VERSION, STAGE_NAMES,
} from './content.js';
import { ACHIEVEMENTS, DEFAULT_KEYS } from './platform.js';
import { platformStrings } from './platform-i18n.js';
import {
  PRESETS as GFX_PRESETS, CATEGORIES as GFX_CATEGORIES, resolve as gfxResolve,
  presetTier as gfxPresetTier, choosePreset as gfxChoosePreset, describe as gfxDescribe,
} from './gfx.js';
import { gfxStrings } from './gfx-i18n.js';
import { T, N, playerName } from './t.js';

const PIP_GLYPHS = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];

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
    this._reopen = null;         // rebuilds the open overlay in the current language
    this._compat = null;         // key of the compatibility message, if shown
    document.addEventListener('fd-language', () => this.relocalize());
  }

  // The game language changed (Settings › Language or the account preference
  // arriving): re-render every visible string in place. The round, the dice
  // and any open overlay keep their state; Settings re-renders only its own
  // boxes so the shared Language/Sound/Report sections stay mounted.
  relocalize() {
    if (!this.hudVisible) this.setStatus(this.platform.statusLine());
    else this.updateHUD();
    if (this._compat) this._els['compat-message'].textContent = T(this._compat);
    if (!this.overlay) return;
    this.overlay.querySelector('.overlay-close')?.setAttribute('aria-label', T('Close'));
    this.overlay.querySelector('.overlay')?.setAttribute('aria-label', T(this.overlayKind));
    if (this.overlayKind === 'Settings' && this._settingsParts?.root.isConnected) this.renderSettingsParts();
    else if (this._reopen) {
      const back = this.lastFocus, onClose = this._onClose;
      this._reopen();
      this.lastFocus = back;
      if (onClose) this._onClose = onClose;
    }
  }

  /** Localized display title of a content definition. */
  defTitle(def) {
    if (!def) return '';
    if (def.mode === 'journey' && def.trail) {
      const trail = TRAILS.find((t) => t.id === def.trail);
      const step = (def.stage - 1) % 8;
      return T('{trail} {n} — {stage}', {
        trail: T(trail?.name || def.trail), n: step + 1,
        stage: def.mastery ? T('Mastery Stage') : T(STAGE_NAMES[step]),
      });
    }
    if (def.mode === 'daily' && def.day) return T('Daily Table — {day}', { day: def.day });
    if (def.mode === 'practice') {
      const diff = PRACTICE_DIFFICULTIES[String(def.id).split('-')[1]];
      const name = T(diff?.name || 'Hearth');
      return def.players?.length === 1 ? T('Practice — {name} (solo)', { name }) : T('Practice — {name}', { name });
    }
    return T(def.name);
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

  // Effective keyboard bindings ({ action: [codes] }): platform overrides of
  // DEFAULT_KEYS (control.* in starhermit.txt) when signed in.
  bindings() {
    return { ...DEFAULT_KEYS, ...(this.platform.keyBindings || {}) };
  }

  actionForCode(code) {
    const b = this.bindings();
    for (const [action, codes] of Object.entries(b)) if (codes.includes(code)) return action;
    return null;
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

  openOverlay(kind, build, { dismissible = true, onClose = null } = {}) {
    this._onClose = null; // replacing an overlay never fires its close hook
    this.closeOverlay();
    this._onClose = onClose;
    this.lastFocus = document.activeElement;
    const content = this.h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': T(kind), 'data-overlay': kind });
    if (dismissible) {
      content.prepend(this.h('button', {
        type: 'button', class: 'btn overlay-close', 'aria-label': T('Close'),
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
    this._reopen = null;
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
    this._reopen = null;
    if (this.lastFocus && document.contains(this.lastFocus)) this.lastFocus.focus();
    const cb = this._onClose;
    this._onClose = null;
    cb?.();
  }

  // `message` may be a function so the text follows a language change.
  confirm(message, onYes) {
    this.openOverlay('Confirm', (c) => {
      c.append(this.h('p', { text: typeof message === 'function' ? message() : message }));
      c.append(this.h('div', { class: 'btn-row' },
        this.h('button', {
          type: 'button', class: 'btn danger', text: T('Yes'),
          onclick: () => { this.closeOverlay(); onYes(); },
        }),
        this.h('button', {
          type: 'button', class: 'btn', text: T('Cancel'),
          onclick: () => this.closeOverlay(),
        })));
    });
    this._reopen = () => this.confirm(message, onYes);
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
        text: T('A cozy mountain-lodge dice table. Roll five dice up to three times, hold the keepers, and fill your card — highest total wins.'),
      }));
      const list = this.h('ul', { class: 'menu-list' });
      const add = (label, sub, fn, primary = false) => {
        list.append(this.h('li', {}, this.h('button', {
          type: 'button', class: `btn${primary ? ' primary' : ''}`,
          onclick: () => { this.env.audio.uiClick(); fn(); },
        }, this.h('span', { text: label }), this.h('span', { class: 'sub', text: sub }))));
      };
      if (hasSave) add(T('Resume Table'), T('continue your saved round'), () => { this.closeOverlay(); this.env.resumeSaved(); }, true);
      add(T('Practice'), T('quick table vs the lodge AI'), () => this.showPracticeSetup(), !hasSave);
      add(T('Daily Table'), doneToday ? T('{day} — played, best {best}', { day: daily.day, best: p.progress.bestDaily[daily.id] }) : T('{day} — shared seed', { day: daily.day }), () => {
        this.closeOverlay(); this.env.startContent(daily);
      });
      add(T('Journey'), T('{n} / {total} stages cleared', { n: journeyDone, total: JOURNEY.length }), () => this.showJourney());
      add(T('Learn'), T('interactive lessons, one rule at a time'), () => this.showLessons());
      add(T('Challenges'), T('constrained tables for sharp players'), () => this.showChallenges());
      add(T('Profile & Scores'), T('achievements, leaderboards, stats'), () => this.showProfile());
      const ps = platformStrings();
      if (p.canSignIn) add(ps.signIn, ps.signInSub, () => p.signIn());
      if (p.hosted) add(ps.invite, ps.inviteSub, () => this.copyInvite());
      add(T('Help & Rules'), T('how a table works'), () => this.showHelp());
      add(T('Settings'), T('audio, display, language, graphics, controls'), () => this.showSettings({ onClose: () => this.showTitle() }));
      c.append(list);
      c.append(this.h('p', { class: 'muted', text: T('Content v{v} · Rules v1 · seed-fair: every table is replayable and inspectable.', { v: CONTENT_VERSION }) }));
    }, { dismissible: false });
    this._reopen = () => this.showTitle();
    // Lodge key art behind the title card (CSS background: a missing file
    // simply leaves the plain dimmed backdrop).
    title.parentElement?.classList.add('title-backdrop');
  }

  async copyInvite() {
    const link = this.platform.inviteLink();
    if (!link) return;
    const ps = platformStrings();
    try {
      await navigator.clipboard.writeText(link);
      this.toast(ps.inviteCopied);
    } catch {
      this.toast(ps.inviteFailed);
    }
  }

  showPracticeSetup() {
    this.openOverlay('Practice setup', (c) => {
      c.append(this.h('p', { class: 'muted', text: T('Unranked. Undo and hints are on; restart freely.') }));
      const list = this.h('ul', { class: 'menu-list' });
      for (const d of Object.values(PRACTICE_DIFFICULTIES)) {
        list.append(this.h('li', {}, this.h('button', {
          type: 'button', class: 'btn',
          onclick: () => { this.closeOverlay(); this.env.startContent(practiceDef({ difficulty: d.id })); },
        }, this.h('span', { text: T(d.name) }), this.h('span', { class: 'sub', text: T(d.blurb) }))));
      }
      list.append(this.h('li', {}, this.h('button', {
        type: 'button', class: 'btn',
        onclick: () => { this.closeOverlay(); this.env.startContent(practiceDef({ difficulty: 'hearth', humans: 2, aiOpponents: 0 })); },
      }, this.h('span', { text: T('Two players, one screen') }), this.h('span', { class: 'sub', text: T('pass-and-play, no AI') }))));
      c.append(list);
    });
    this._reopen = () => this.showPracticeSetup();
  }

  showLessons() {
    this.openOverlay('Learn', (c) => {
      const list = this.h('ul', { class: 'menu-list' });
      LESSONS.forEach((l, i) => {
        const done = this.settings.tutorialsDone[l.id];
        list.append(this.h('li', {}, this.h('button', {
          type: 'button', class: 'btn',
          onclick: () => { this.closeOverlay(); this.env.startContent(l); },
        }, this.h('span', { text: `${i + 1}. ${T(l.name)}${done ? ' ✓' : ''}` }))));
      });
      c.append(list);
    });
    this._reopen = () => this.showLessons();
  }

  showJourney() {
    this.openOverlay('Journey', (c) => {
      const progress = this.platform.progress.journey;
      let unlockedIdx = 0;
      while (unlockedIdx < JOURNEY.length && progress[JOURNEY[unlockedIdx].id]?.done) unlockedIdx++;
      TRAILS.forEach((trail, t) => {
        c.append(this.h('h3', { text: T(trail.name) }));
        const grid = this.h('div', { class: 'card-grid' });
        for (let s = 0; s < 8; s++) {
          const stage = JOURNEY[t * 8 + s];
          const rec = progress[stage.id];
          const locked = t * 8 + s > unlockedIdx;
          grid.append(this.h('button', {
            type: 'button', class: `stage-card${stage.mastery ? ' mastery' : ''}`,
            disabled: locked, 'aria-label': locked ? T('{name} (locked)', { name: this.defTitle(stage) }) : this.defTitle(stage),
            onclick: () => { this.closeOverlay(); this.env.startContent(stage); },
          },
            this.h('div', { text: `${stage.stage}. ${stage.mastery ? T('Mastery') : ''}` }),
            this.h('div', { class: 'stars', text: rec?.done ? '★'.repeat(rec.stars || 1) : (locked ? '🔒' : '—') }),
            this.h('div', { class: 'muted', text: stage.goal?.type === 'score' ? T('Target {n}', { n: stage.goal.target }) : T('{n}-handed', { n: stage.players.length }) })));
        }
        c.append(grid);
      });
    });
    this._reopen = () => this.showJourney();
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
          this.h('span', { text: `${T(ch.name)}${rec?.done ? ' ✓' : ''}` }),
          this.h('span', { class: 'sub', text: T(ch.blurb) }))));
      }
      c.append(list);
    });
    this._reopen = () => this.showChallenges();
  }

  // --- help ------------------------------------------------------------------------

  showHelp() {
    const b = this.bindings();
    const name = (code) => ({ Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', NumpadEnter: 'Enter' }[code] || code.replace(/^(Key|Digit|Numpad)/, ''));
    const key = (codes) => [...new Set(codes.map(name))].join('/');
    this.openOverlay('Help & Rules', (c) => {
      c.append(this.h('h3', { text: T('How a table works') }));
      c.append(this.h('p', { text: T('Roll five dice. You may reroll any unheld dice twice more (three rolls total). Tap a die to hold it between rolls. Then choose exactly one open category on the card to score. When every category on every card is filled, the highest grand total wins.') }));
      c.append(this.h('h3', { text: T('The card') }));
      const ul = this.h('ul');
      for (const cat of CATEGORIES) {
        ul.append(this.h('li', { text: `${T(cat.name)} — ${T(cat.desc)}` }));
      }
      c.append(ul);
      c.append(this.h('p', { text: T('Upper rows ({first}…{last}) totaling {n}+ earn a {bonus}-point lodge bonus.', { first: T('Kindling'), last: T('Peaks'), n: UPPER_BONUS_THRESHOLD, bonus: UPPER_BONUS }) }));
      c.append(this.h('h3', { text: T('Controls') }));
      c.append(this.h('p', { text: T('Roll: {roll} or the Roll button. Hold die: {hold} or tap. Hint: {hint}. Undo: {undo} where allowed. Pause: {pause}. Camera: {camera}. {prev}/{next} move focus; {confirm} confirms. Gamepad: D-pad moves focus, A holds, X rolls, Start pauses.', {
        roll: key(b.roll), hold: [0, 1, 2, 3, 4].map((i) => key(b[`hold${i}`])).join(', '), hint: key(b.hint), undo: key(b.undo),
        pause: key(b.pause), camera: key(b.camera), prev: key(b.focusPrev), next: key(b.focusNext), confirm: key(b.confirm),
      }) }));
      c.append(this.h('p', { class: 'muted', text: T('Every table is seeded and replayable; the same seed and choices always produce the same dice.') }));
    });
    this._reopen = () => this.showHelp();
  }

  // --- settings ---------------------------------------------------------------------

  // Settings: the game's own controls live in three boxes (before, graphics,
  // after) that re-render on their own; the shared game-options.js sections
  // (frame rate, Language, Sound, Report a problem) mount inside the graphics
  // <section> next to the inner box and are never redrawn by the game.
  showSettings({ onClose = null } = {}) {
    this.openOverlay('Settings', (c) => {
      const before = this.h('div', { class: 'settings-box' });
      const gfx = this.h('section', { id: 'gfx-section', class: 'gfx-section' });
      const gfxInner = this.h('div', { class: 'gfx-inner' });
      gfx.append(gfxInner);
      const after = this.h('div', { class: 'settings-box' });
      c.append(before, gfx, after);
      const save = () => { this.platform.saveSettings(); this.applySettingsClasses(); this.env.onSettingsChanged?.(); };
      this._settingsParts = { root: c, before, gfxInner, after, save };
      this.renderSettingsParts();
    }, { onClose });
  }

  renderSettingsParts() {
    const { before, gfxInner, after, save } = this._settingsParts;
    const s = this.settings;
    let box = before;
    let grid = null;
    const section = (title) => {
      box.append(this.h('h3', { text: title }));
      grid = this.h('div', { class: 'settings-grid' });
      box.append(grid);
    };
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

    before.replaceChildren();
    section(T('Audio'));
    slider(T('Music'), 'volMusic');
    slider(T('Effects'), 'volEffects');
    slider(T('Ambience'), 'volAmbience');
    slider(T('Voice'), 'volVoice');
    toggle(T('Mute all'), 'muted');
    toggle(T('Captions for audio cues'), 'captions');

    section(T('Display'));
    select(T('Theme'), 'theme', THEMES.map((t) => [t.id, T(t.name)]));
    select(T('Camera'), 'cameraTilt', [['standard', T('Standard')], ['low', T('Low')], ['overhead', T('Overhead')]]);
    toggle(T('Reduced motion'), 'reducedMotion');
    toggle(T('High contrast'), 'highContrast');
    select(T('Color-vision palette'), 'palette', [['default', T('Default')], ['deuteranopia', T('Deuteranopia-safe')], ['protanopia', T('Protanopia-safe')], ['tritanopia', T('Tritanopia-safe')]]);

    this.buildGraphicsSection(gfxInner, save);

    after.replaceChildren();
    box = after;
    section(T('Controls & access'));
    toggle(T('Larger text'), 'largeText');
    toggle(T('Left-handed controls'), 'leftHanded');
    toggle(T('Hold to confirm scoring'), 'holdToConfirm');
    toggle(T('Timing assistance'), 'timingAssist');
    toggle(T('Haptics'), 'haptics');

    after.append(this.h('div', { class: 'btn-row', style: 'margin-top:0.8rem' },
      this.h('button', {
        type: 'button', class: 'btn', text: T('Replay tutorials'),
        onclick: () => { s.tutorialsDone = {}; save(); this.toast(T('Tutorials reset')); },
      })));
  }

  // Graphics section (localized): quality preset, render scale, per-effect
  // overrides, adaptive resolution, frame-rate readout and a cost summary.
  // Rebuilt in place after each change so "From preset (…)" labels follow.
  buildGraphicsSection(root, save) {
    const t = gfxStrings();
    // Only the game's inner box is redrawn; game-options.js sections sit beside it.
    const s = this.settings;
    const saved = () => (s.graphics && typeof s.graphics === 'object' ? s.graphics : (s.graphics = {}));
    const renderer = this.env.getRenderer?.();
    const info = renderer?.graphicsInfo?.();
    const detected = info?.detected || 'balanced';
    const level = info?.level;
    const r = gfxResolve(saved(), detected, level);
    const commit = (next) => {
      s.graphics = next;
      document.body.dataset.gfxPreset = gfxResolve(next, detected, level).preset;
      save();
      const focusId = document.activeElement?.id;
      this.buildGraphicsSection(root, save);
      if (focusId) document.getElementById(focusId)?.focus();
    };
    const tierName = (tier) => t(tier);
    root.replaceChildren();
    root.append(this.h('h3', { text: t('title') }));
    const grid = this.h('div', { class: 'settings-grid' });
    root.append(grid);
    const row = (label, control) => grid.append(this.h('label', {}, label, control));

    const presetSel = this.h('select', {
      id: 'gfx-preset', 'data-gfx': 'preset', 'aria-label': t('quality'),
      onchange: (e) => commit(gfxChoosePreset(saved(), e.target.value)),
    }, [['auto', t('auto', { tier: tierName(detected) })], ...GFX_PRESETS.map((p) => [p, tierName(p)])]
      .map(([v, name]) => this.h('option', { value: v, text: name, ...((r.auto ? 'auto' : r.preset) === v ? { selected: true } : {}) })));
    row(t('quality'), presetSel);

    const pct = Math.round(r.renderScale * 100);
    const scaleOut = this.h('output', { class: 'range-value', id: 'gfx-scale-value', text: `${pct}%` });
    const scale = this.h('input', {
      type: 'range', id: 'gfx-scale', 'data-gfx': 'render_scale', min: '50', max: '200', step: '5',
      value: String(pct), 'aria-label': t('renderScale'),
      oninput: (e) => { scaleOut.textContent = `${e.target.value}%`; },
      onchange: (e) => commit({ ...saved(), render_scale: Number(e.target.value) / 100 }),
    });
    row(t('renderScale'), this.h('span', { class: 'range-wrap' }, scale, scaleOut));

    for (const [cat, tiers] of Object.entries(GFX_CATEGORIES)) {
      const own = tiers.includes(saved()[cat]) ? saved()[cat] : 'preset';
      const sel = this.h('select', {
        id: `gfx-${cat}`, 'data-gfx-cat': cat, 'aria-label': t(`cat_${cat}`),
        onchange: (e) => {
          const next = { ...saved() };
          if (e.target.value === 'preset') delete next[cat];
          else next[cat] = e.target.value;
          commit(next);
        },
      }, [['preset', t('fromPreset', { tier: tierName(gfxPresetTier(r.preset, cat)) })], ...tiers.map((v) => [v, tierName(v)])]
        .map(([v, name]) => this.h('option', { value: v, text: name, ...(own === v ? { selected: true } : {}) })));
      row(t(`cat_${cat}`), sel);
    }

    const check = (id, key, label, on) => row(label, this.h('input', {
      type: 'checkbox', id, 'data-gfx': key, ...(on ? { checked: true } : {}),
      onchange: (e) => commit({ ...saved(), [key]: e.target.checked }),
    }));
    check('gfx-adaptive', 'adaptive', t('adaptive'), r.adaptive);
    check('gfx-fps', 'show_fps', t('showFps'), r.showFps);

    const summary = this.h('p', { id: 'gfx-summary', class: 'muted gfx-summary' });
    const note = this.h('p', { id: 'gfx-note', class: 'muted gfx-note', hidden: true });
    root.append(summary, note);
    const words = {};
    for (const k of ['noShadows', 'shadows', 'ao', 'aoHigh', 'bloom', 'noAA', 'reflections', 'particles']) words[k] = t(`w_${k}`);
    const refresh = () => {
      const rr = this.env.getRenderer?.();
      const i = rr?.graphicsInfo?.();
      if (!i) {
        summary.textContent = `${t('unknownGpu')} · ${gfxDescribe(r, null, words)}`;
        note.textContent = t('no3d');
        note.hidden = false;
        return;
      }
      summary.textContent = `${i.gpu || t('unknownGpu')} · ${t('level', { level: i.level ?? 0 })} · ${gfxDescribe(i.resolved, i.pixels, words)}`;
      note.textContent = t('postFailed');
      note.hidden = !i.postFailed;
    };
    refresh();
    // Pixel size settles after the next frame(s); keep the line live while open.
    clearInterval(this._gfxTimer);
    this._gfxTimer = setInterval(() => {
      if (!root.isConnected) { clearInterval(this._gfxTimer); return; }
      refresh();
    }, 500);
  }

  // --- profile / leaderboards ---------------------------------------------------------

  async showProfile(board = null) {
    const p = this.platform;
    this._board = board;
    this.openOverlay('Profile & Scores', async (c) => {
      if (p.profile.account) {
        // Account identity: platform nickname, read-only (never usernames).
        c.append(this.h('div', { class: 'settings-grid' },
          this.h('label', {}, T('Player'), this.h('span', { text: p.profile.name }))));
      } else {
        const nameInput = this.h('input', {
          type: 'text', value: playerName(p.profile.name), maxlength: '20', 'aria-label': T('Display name'),
          onchange: (e) => {
            p.profile.name = e.target.value.trim() || 'Guest';
            p.saveProfile();
            this.toast(T('Name saved'));
          },
        });
        c.append(this.h('div', { class: 'settings-grid' }, this.h('label', {}, T('Display name'), nameInput)));
      }
      c.append(this.h('p', { class: 'muted', text: p.profile.guest ? T('Guest profile — progress is stored on this device. Sign in from the host shell for durable cloud progress.') : T('Signed in with your account.') }));
      c.append(this.h('p', { class: 'muted', text: p.syncLabel() }));

      const t = p.progress.totals;
      c.append(this.h('h3', { text: T('Lifetime') }));
      c.append(this.h('p', { text: T('{games} tables · {wins} wins · {points} total points · {avalanches} avalanches · {days} active days', { games: t.games, wins: t.wins, points: t.points, avalanches: t.avalanches, days: p.progress.streakDays.length }) }));

      c.append(this.h('h3', { text: T('Achievements') }));
      const ach = this.h('ul', { class: 'ach-list' });
      for (const a of ACHIEVEMENTS) {
        const got = p.progress.achievements[a.key];
        ach.append(this.h('li', { class: got ? '' : 'locked' },
          this.h('div', { class: 'ach-name', text: `${got ? '🏆' : '○'} ${T(a.name)}` }),
          this.h('div', { class: 'muted', text: T(a.desc) })));
      }
      c.append(ach);

      c.append(this.h('h3', { text: T('Leaderboards') }));
      const boardBox = this.h('div', {}, this.h('p', { class: 'muted', text: T('Loading…') }));
      const loadBoard = async (board, label) => {
        this._board = [board, label];
        boardBox.replaceChildren(this.h('p', { class: 'muted', text: T('Loading…') }));
        const res = await p.leaderboard(board);
        const table = this.h('table', { class: 'results-table' },
          this.h('tr', {}, this.h('th', { text: '#' }), this.h('th', { text: T('Player') }), this.h('th', { class: 'num', text: T('Score') })));
        res.entries.slice(0, 10).forEach((e, i) => {
          table.append(this.h('tr', { class: e.me ? 'me' : '' },
            this.h('td', { text: String(i + 1) }),
            this.h('td', { text: playerName(e.name) }),
            this.h('td', { class: 'num', text: String(e.score) })));
        });
        if (!res.entries.length) table.append(this.h('tr', {}, this.h('td', { colspan: '3', text: T('No entries yet — play a table!') })));
        boardBox.replaceChildren(this.h('p', { class: 'muted', text: `${T(label)} · ${T(res.label)}` }), table);
      };
      const tabs = this.h('div', { class: 'btn-row' },
        this.h('button', { type: 'button', class: 'btn', text: T('Daily'), onclick: () => loadBoard('daily', N('Daily tables')) }),
        this.h('button', { type: 'button', class: 'btn', text: T('Challenge'), onclick: () => loadBoard('challenge', N('Challenge tables')) }),
        this.h('button', { type: 'button', class: 'btn', text: T('Journey wins'), onclick: () => loadBoard('journey', N('Journey wins')) }));
      c.append(tabs, boardBox);
      loadBoard(...(this._board || ['daily', N('Daily tables')]));
    });
    this._reopen = () => this.showProfile(this._board);
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
    const vars = { name: playerName(me.name), rolls: st.rollsLeft, round: st.round, table: this.defTitle(def) };
    let status = me.isAI ? T('{name} (AI) to act · rolls left {rolls} · round {round} — {table}', vars)
      : me.name === 'You' ? T('Your turn · rolls left {rolls} · round {round} — {table}', vars)
        : T('{name} to act · rolls left {rolls} · round {round} — {table}', vars);
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
      banner.textContent = T(step.text);
      banner.hidden = false;
    } else if (this.session.machine === 'tutorial' && !step) {
      banner.textContent = T('Lesson complete — finish the table!');
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
    table.append(this.h('caption', { text: me.name === 'You' ? T('Your card — {filled}/{total} filled', { filled, total }) : T("{name}'s card — {filled}/{total} filled", { name: playerName(me.name), filled, total }) }));
    let section = null;
    for (const cat of CATEGORIES) {
      if (st.disabledCategories.includes(cat.id)) continue;
      if (cat.section !== section) {
        section = cat.section;
        table.append(this.h('tr', { class: 'section-head' },
          this.h('th', { colspan: '2', text: section === 'upper' ? T('Upper — face totals') : T('Lower — hands') })));
      }
      const closed = me.scores[cat.id];
      const tr = this.h('tr', { class: closed != null ? 'row-closed' : '' });
      const isLegal = canScore && scoreable.has(cat.id);
      const tdBtn = this.h('td', {});
      if (closed != null) {
        tdBtn.append(this.h('span', { text: T(cat.name) }));
        tr.append(tdBtn, this.h('td', { class: 'closed-val', text: String(closed) }));
      } else {
        const pv = previews[cat.id];
        const btn = this.h('button', {
          type: 'button', class: `cat${isLegal ? ' legal' : ''}`,
          disabled: !isLegal,
          'aria-label': isLegal
            ? T('Score {cat} for {n} points', { cat: T(cat.name), n: pv })
            : `${T(cat.name)} — ${T(cat.desc)}${st.hasRolled ? '' : ' ' + T('(roll first)')}`,
          title: T(cat.desc),
          'data-cat': cat.id,
          onclick: () => this.env.tryScore(cat.id),
        },
          this.h('span', { class: 'nm', text: T(cat.name) }),
          this.h('span', { class: 'pv', text: pv != null ? String(pv) : '·' }));
        tdBtn.append(btn);
        tr.append(tdBtn, this.h('td', { class: 'points', text: pv != null && !isLegal ? String(pv) : '' }));
      }
      table.append(tr);
    }
    const b = totalsBreakdown(me.scores);
    table.append(this.h('tr', { class: 'totals' },
      this.h('td', { text: T('Upper {upper} · Bonus {bonus} · Lower {lower}', b) }),
      this.h('td', { class: 'points', text: `Σ ${b.grand}` })));
    rail.append(table);
    const up = upperProgress(me.scores);
    rail.append(this.h('p', {
      class: 'bonus-meter',
      text: b.bonus ? T('Lodge bonus earned (+{n})', { n: UPPER_BONUS }) : T('Upper bonus: {n}/{target}', { n: up, target: UPPER_BONUS_THRESHOLD }),
    }));
  }

  renderRightRail(st) {
    const rail = this._els['rail-right'];
    rail.replaceChildren();
    const sec = this.h('section', {});
    sec.append(this.h('h2', { text: T('Table') }));
    const ul = this.h('ul', { class: 'player-list' });
    st.players.forEach((pl, i) => {
      const b = totalsBreakdown(pl.scores);
      ul.append(this.h('li', { class: i === st.current ? 'current' : '' },
        this.h('span', { class: 'pl-name', text: playerName(pl.name) + (pl.isAI ? ' 🤖' : '') }),
        this.h('span', { class: 'pl-score', text: String(b.grand) })));
    });
    sec.append(ul);
    rail.append(sec);

    const acts = this.h('section', {});
    acts.append(this.h('h2', { text: T('Actions') }));
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
      'aria-label': canRoll ? T('Roll dice ({n} left)', { n: st.rollsLeft }) : T('Roll dice (unavailable)'),
      text: `🎲 ${T('Roll ({n})', { n: st.rollsLeft })}`,
      onclick: () => this.env.tryRoll(),
    });
    container.append(rollBtn);
    container.append(this.h('button', {
      type: 'button', class: 'btn', text: T('Hint'), disabled: !humanTurn || !this.session.def?.assists?.hints,
      onclick: () => this.env.tryHint(),
    }));
    container.append(this.h('button', {
      type: 'button', class: 'btn', text: T('Undo turn'), disabled: !this.session.undoAllowed(),
      onclick: () => this.env.tryUndo(),
    }));
    container.append(this.h('button', {
      type: 'button', class: 'btn tray-secondary', text: T('Pause'),
      onclick: () => this.togglePause(),
    }));
    container.append(this.h('button', {
      type: 'button', class: 'btn danger tray-secondary', text: T('Leave table'),
      onclick: () => this.confirm(() => T('Leave this table? The round will be recorded as a forfeit.'), () => this.env.giveUp()),
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
        'aria-label': v === 0 ? T('Die {n}, not rolled', { n: i + 1 })
          : `${T(held ? 'Die {n}, showing {v}, held.' : 'Die {n}, showing {v}.', { n: i + 1, v })} ${canHold ? (held ? T('Activate to release') : T('Activate to hold')) : ''}`.trim(),
        'aria-pressed': held ? 'true' : 'false',
        'data-die': String(i),
        'data-held': T('HELD'),
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
      add(T('Resume'), () => { this.closeOverlay(); this.session.resume(); }, true);
      add(T('Settings'), () => this.showSettings());
      add(T('Help'), () => this.showHelp());
      add(T('Leave table'), () => this.confirm(() => T('Forfeit this table?'), () => { this.closeOverlay(); this.env.giveUp(); }));
      c.append(list);
    });
    this._reopen = () => this.showPause();
  }

  // `again` re-renders an open results card in a new language without
  // re-posting the score or repeating the announcement.
  showResults(record, outcome, again = false) {
    this.setHudVisible(false);
    if (!again) this._lb = null;
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
      c.append(this.h('h2', { text: won ? '🏔 ' + T('You take the table!') : record.reason === 'gave-up' ? T('Table forfeited') : record.reason === 'time-limit' ? '⏱ ' + T('The blizzard wins') : T('The lodge keeps its crown') }));
      const secs = (record.durationMs / 1000).toFixed(0);
      c.append(this.h('p', { text: T(record.invalid === 1
        ? 'Your card: upper {upper} + bonus {bonus} + lower {lower} = {grand} points · {invalid} invalid action · {secs}s'
        : 'Your card: upper {upper} + bonus {bonus} + lower {lower} = {grand} points · {invalid} invalid actions · {secs}s',
      { upper: b.upper, bonus: b.bonus, lower: b.lower, grand: b.grand, invalid: record.invalid, secs }) }));
      if (this.session.def?.par?.score) {
        c.append(this.h('p', { class: 'muted', text: T('Par for this table: {n}', { n: this.session.def.par.score }) }));
      }
      const table = this.h('table', { class: 'results-table' });
      table.append(this.h('tr', {},
        this.h('th', { text: '#' }), this.h('th', { text: T('Player') }),
        this.h('th', { class: 'num', text: T('Upper') }), this.h('th', { class: 'num', text: T('Bonus') }),
        this.h('th', { class: 'num', text: T('Lower') }), this.h('th', { class: 'num', text: T('Total') })));
      record.rankings.forEach((r, i) => {
        table.append(this.h('tr', { class: r.player === 0 ? 'me' : '' },
          this.h('td', { text: String(i + 1) }),
          this.h('td', { text: playerName(r.name) }),
          this.h('td', { class: 'num', text: String(r.upper ?? '') }),
          this.h('td', { class: 'num', text: String(r.bonus ?? '') }),
          this.h('td', { class: 'num', text: String(r.lower ?? '') }),
          this.h('td', { class: 'num', text: String(r.grand) })));
      });
      c.append(table);

      if (record.mode !== 'learn' && record.reason !== 'gave-up' && this.platform.hosted) {
        // StarHermit high-score board: the finished card's grand total.
        const lbText = () => {
          const ps = platformStrings();
          const r = this._lb;
          return !r ? ps.lbPosting : !r.posted ? ps.lbNotPosted
            : r.rank ? ps.lbRank.replace('{rank}', r.rank) : ps.lbPosted;
        };
        const lb = this.h('p', { class: 'muted lb-line', text: lbText() });
        lb.setAttribute('aria-live', 'polite');
        c.append(lb);
        if (!again) {
          this.platform.submitScore(b.grand).then((r) => {
            this._lb = r;
            if (lb.isConnected) lb.textContent = lbText();
            else if (this.overlayKind === 'Results') this.overlay.querySelector('.lb-line')?.replaceChildren(lbText());
          });
        }
      }

      const newly = this.platform.lastAchievements || [];
      if (newly.length) {
        c.append(this.h('h3', { text: T('Achievements unlocked') }));
        const ul = this.h('ul', { class: 'ach-list' });
        for (const key of newly) {
          const meta = ACHIEVEMENTS.find((a) => a.key === key);
          if (meta) ul.append(this.h('li', {}, this.h('div', { class: 'ach-name', text: `🏆 ${T(meta.name)}` }), this.h('div', { class: 'muted', text: T(meta.desc) })));
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
        if (next) { add(T('Next: {name}', { name: this.defTitle(next) }), () => this.env.startContent(next), true); recommended = true; }
      }
      add(T('Play again'), () => this.env.startContent(def.mode === 'practice' ? practiceDef({ difficulty: def.id.split('-')[1] || 'hearth' }) : def), !recommended);
      add(T('Back to title'), () => this.showTitle());
      c.append(list);
    }, { dismissible: false });
    this._reopen = () => this.showResults(record, outcome, true);
    if (!again) this.announce(won ? T('You won with {n} points', { n: b.grand }) : T('Table over. You scored {n} points', { n: b.grand }), true);
  }

  // --- compatibility ----------------------------------------------------------------------

  // `key` is an English source string; it re-renders on a language change.
  showCompatibility(key) {
    this._compat = key;
    const el = this._els['compat-message'];
    el.textContent = T(key);
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
        this.announce(currentPlayer(e.state).name === 'You' ? T('{table}. Your turn.', { table: this.defTitle(e.def) })
          : T('{table}. {name} to act.', { table: this.defTitle(e.def), name: playerName(currentPlayer(e.state).name) }));
        break;
      case 'game-event': {
        const ev = e.event;
        if (ev.type === 'score') {
          const cat = getCategory(ev.category);
          const who = e.state.players[ev.player].name;
          const vars = { name: playerName(who), n: ev.points, cat: cat ? T(cat.name) : ev.category };
          this.announce(who === 'You' ? T('You scored {n} on {cat}', vars) : T('{name} scored {n} on {cat}', vars));
          if (this.settings.haptics && navigator.vibrate && ev.player === 0) navigator.vibrate(30);
        } else if (ev.type === 'invalid') {
          this.announce(T('Invalid action: {reason}', { reason: invalidText(ev.reason) }), true);
          this.toast(invalidText(ev.reason));
        } else if (ev.type === 'turn') {
          const who = e.state.players[ev.player].name;
          this.announce(who === 'You' ? T('Your turn') : T("{name}'s turn", { name: playerName(who) }));
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
      case 'lesson-blocked': {
        const step = this.session.currentLessonStep();
        this.toast(step ? T('Follow the lesson: {text}', { text: T(step.text) }) : e.message);
        break;
      }
      case 'lesson-step':
        if (e.done) {
          this.settings.tutorialsDone[this.session.def.id] = true;
          this.platform.saveSettings();
          this.env.audio.lessonComplete();
          this.toast(T('Lesson complete — finish the table!'));
        }
        this.updateHUD();
        break;
      case 'hint': {
        const text = hintText(e);
        this.toast(text || T('Try the highlighted option'));
        this.announce(text || T('Hint shown'));
        break;
      }
      case 'undo':
        this.toast(T('Turn restored'));
        this.updateHUD();
        break;
      case 'while-away': {
        const summary = !e.away ? e.summary : e.away.name === 'You'
          ? T('Table restored. You were away {min} min; round {round}, your turn.', e.away)
          : T('Table restored. You were away {min} min; round {round}, {name} to act.', { ...e.away, name: playerName(e.away.name) });
        this.toast(summary, 5000);
        this.announce(summary);
        break;
      }
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
      const action = this.actionForCode(ev.code);
      if (action === 'pause') {
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
      const hold = /^hold(\d)$/.exec(action || '');
      if (hold && Number(hold[1]) < DICE_COUNT) { ev.preventDefault(); this.env.tryHold(Number(hold[1])); return; }
      if (action === 'roll') { ev.preventDefault(); this.env.tryRoll(); }
      else if (action === 'hint') { ev.preventDefault(); this.env.tryHint(); }
      else if (action === 'undo') { ev.preventDefault(); this.env.tryUndo(); }
      else if (action === 'camera') { ev.preventDefault(); this.env.cycleCamera?.(); }
      else if (action === 'focusPrev' || action === 'focusNext') {
        ev.preventDefault();
        this.moveDieFocus(action === 'focusNext' ? 1 : -1);
      } else if (action === 'confirm') {
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
    'no-rolls-left': N('No rolls left — choose a category to score.'),
    'must-roll-first': N('Roll the dice first.'),
    'category-closed': N('That category is already filled.'),
    'category-disabled': N('That category is closed at this table.'),
    'unknown-category': N('Unknown category.'),
    'round-over': N('The table is over.'),
  };
  return TEXT[reason] ? T(TEXT[reason]) : T('Action not allowed ({reason}).', { reason });
}

// Hint text from the rules engine's structured hint (key + values).
function hintText(h) {
  if (!h.reasonKey) return h.reason;
  const cat = h.category ? getCategory(h.category) : null;
  return T(h.reasonKey, { cat: cat ? T(cat.name) : '', n: h.points });
}
