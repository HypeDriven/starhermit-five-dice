// Five Dice — platform adapter.
// Local-first: guest practice works fully offline after load. Hosted
// (StarHermit) mode activates only when a launch token was read from the URL;
// every platform call then carries the Bearer token, the account nickname and
// the single cloud-save slot. The game's own server.js keeps its save,
// leaderboard, presence, activity and events routes for local development
// (npm start) — those paths never run hosted. Tokens never persist to local
// storage; structured {"error":...} responses and rate limits are recoverable
// UI states.

// Five Dice — platform adapter over window.StarHermit (starhermit-sdk.js,
// loaded by index.html before the game modules).
// Local-first: guest practice works fully offline after load and makes no
// network request. Hosted (StarHermit) mode activates only when the SDK read a
// launch token (#game_token=… library launch or #access_token=… sign-in
// return); every platform call then carries the Bearer token, the account
// nickname, the single cloud-save slot game:<slug>, the per-player settings KV
// and the keyboard bindings. Tokens never persist to local storage.

const LS_PREFIX = 'fivedice:';
const REMOTE_BOOT_TIMEOUT_MS = 3000;

// Desktop keyboard actions (KeyboardEvent.code lists); mirrored as control.*
// lines in starhermit.txt. The platform may override any of them.
export const DEFAULT_KEYS = {
  hold0: ['Digit1'], hold1: ['Digit2'], hold2: ['Digit3'], hold3: ['Digit4'], hold4: ['Digit5'],
  roll: ['KeyR'], hint: ['KeyH'], undo: ['KeyU'], pause: ['Escape'], camera: ['KeyC'],
  focusPrev: ['ArrowLeft'], focusNext: ['ArrowRight'], confirm: ['Enter', 'Space', 'NumpadEnter'],
};

// Player preferences mirrored to the platform settings KV (same key names).
export const SYNCED_SETTINGS = [
  'theme', 'graphics', 'muted', 'volMusic', 'volEffects', 'volAmbience', 'volVoice', 'captions',
  'reducedMotion', 'highContrast', 'palette', 'largeText', 'leftHanded', 'holdToConfirm',
  'haptics', 'timingAssist', 'cameraTilt',
];

const withTimeout = (p, ms, fallback) => Promise.race([
  Promise.resolve(p).catch(() => fallback),
  new Promise((r) => setTimeout(() => r(fallback), ms)),
]);

export class Platform {
  constructor(sh = (typeof window !== 'undefined' ? window.StarHermit : null)) {
    this.sh = sh || null;
    this.hosted = false;         // true iff the SDK holds a launch token
    this.userId = null;          // token sub
    this.slug = null;            // token game_scope
    this.syncState = 'offline';  // offline | saving | synced | error
    this.keyBindings = { ...DEFAULT_KEYS };
    this._nickCache = new Map();
  }

  // --- bootstrap ---------------------------------------------------------------

  async init() {
    const sh = this.sh;
    if (sh && !sh.token && !sh.__fivediceInit) { sh.__fivediceInit = true; sh.init(); }
    // Merge over defaults so saves from older versions gain new keys.
    this.settings = { ...defaultSettings(), ...(this.loadLocal('settings') || {}) };
    this.guestProfile = this.loadLocal('profile') || {
      name: 'Guest', guest: true, createdAt: Date.now(),
    };
    if (this.guestProfile.account) this.guestProfile = { name: 'Guest', guest: true, createdAt: Date.now() };
    this.profile = this.guestProfile;
    this.progress = { ...freshProgress(), ...(this.loadLocal('progress') || {}) };
    this.results = this.loadLocal('results') || [];
    if (!sh) return this;
    sh.on('saved', (ok) => this._setSync(ok ? 'synced' : 'error'));
    sh.on('auth', (a) => {
      const was = this.hosted;
      this.hosted = !!a.signedIn;
      this.userId = sh.userId;
      if (was && !this.hosted) {
        this.profile = this.guestProfile;
        this.syncState = 'offline';
        this.onAuthChange?.(false);
        this.onStatusChange?.();
      }
    });
    this.hosted = !!sh.signedIn;
    this.userId = sh.userId;
    this.slug = sh.slug;
    if (this.hosted) {
      const [remote, keys] = await Promise.all([
        withTimeout(sh.getSettings(), REMOTE_BOOT_TIMEOUT_MS, {}),
        withTimeout(sh.loadBindings(DEFAULT_KEYS), REMOTE_BOOT_TIMEOUT_MS, DEFAULT_KEYS),
        withTimeout(this.fetchAccountProfile(), REMOTE_BOOT_TIMEOUT_MS, null),
      ]);
      this.applyRemoteSettings(remote);
      this.keyBindings = { ...DEFAULT_KEYS, ...(keys || {}) };
    }
    return this;
  }

  /** Platform values win over local defaults when signed in. */
  applyRemoteSettings(remote) {
    if (!remote || typeof remote !== 'object') return;
    const defs = defaultSettings();
    for (const key of SYNCED_SETTINGS) {
      const v = remote[key];
      if (v === undefined || v === null) continue;
      if (key === 'graphics' ? (typeof v === 'object' && !Array.isArray(v)) : typeof v === typeof defs[key]) this.settings[key] = v;
    }
    this.saveLocal('settings', this.settings);
  }

  get canSignIn() { return !!this.sh?.canSignIn(); }
  signIn() { return !!this.sh?.signIn(); }
  inviteLink() { return this.hosted ? this.sh.inviteLink() : null; }

  serverNow() {
    return Date.now();
  }

  serverOffsetMs() {
    return 0;
  }

  // --- local persistence ---------------------------------------------------------

  saveLocal(key, value) {
    try {
      const k = key.startsWith(LS_PREFIX) ? key : LS_PREFIX + key;
      if (value === null || value === undefined) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(value));
    } catch { /* storage full/blocked: play session continues without saves */ }
  }

  loadLocal(key) {
    try {
      const k = key.startsWith(LS_PREFIX) ? key : LS_PREFIX + key;
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  saveSettings() {
    this.saveLocal('settings', this.settings);
    if (!this.hosted) return;
    const patch = {};
    for (const key of SYNCED_SETTINGS) patch[key] = this.settings[key];
    const json = JSON.stringify(patch);
    if (json === this._lastSettingsPatch) return;
    this._lastSettingsPatch = json;
    clearTimeout(this._settingsTimer);
    this._settingsTimer = setTimeout(() => this.sh.patchSettings(patch), 400);
  }
  saveProfile() { if (!this.profile.account) { this.guestProfile = this.profile; this.saveLocal('profile', this.profile); } }

  saveProgress({ cloud = true } = {}) {
    // Versioned, checksummed progression document.
    this.progress.v = 1;
    this.saveLocal('progress', this.progress);
    const body = JSON.stringify(this.progress);
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i) * (i + 1)) % 1000003;
    this.saveLocal('progress:checksum', sum);
    if (!cloud || !this.hosted) return;
    this._setSync('saving');
    this.sh.saveJSON(this.progress);
  }

  verifyProgress() {
    const sum = this.loadLocal('progress:checksum');
    if (sum == null) return true; // nothing stored yet
    const body = JSON.stringify(this.progress);
    let calc = 0;
    for (let i = 0; i < body.length; i++) calc = (calc + body.charCodeAt(i) * (i + 1)) % 1000003;
    if (calc !== sum) {
      // Corrupted local copy: keep it aside and start clean rather than crash.
      this.saveLocal('progress:corrupt', this.progress);
      this.progress = freshProgress();
      return false;
    }
    return true;
  }

  // --- hosted identity -------------------------------------------------------------

  async fetchAccountProfile() {
    // Nickname from the platform profile ("Player <id>" fallback); usernames
    // are never displayed and /api/v1/me is never called.
    if (!this.hosted || !this.userId) return;
    const prof = await this.sh.profile(this.userId).catch(() => null);
    this.profile = {
      name: String(prof?.displayName || `Player ${String(this.userId).slice(0, 6)}`).slice(0, 24),
      guest: false,
      account: true,
    };
    this.onStatusChange?.();
  }

  async nicknameFor(userId) {
    // Leaderboard entries resolve ids to nicknames via the profile helper.
    if (!userId) return 'Player';
    const prof = await this.sh?.profile(userId).catch(() => null);
    return String(prof?.displayName || `Player ${String(userId).slice(0, 6)}`).slice(0, 24);
  }

  statusLine() {
    if (this.hosted) {
      const sync = {
        synced: 'cloud synced', saving: 'saving to cloud…',
        error: 'cloud sync error', offline: 'offline',
      }[this.syncState] || 'cloud synced';
      return `Signed in as ${this.profile.name} · ${sync}`;
    }
    return 'Local play — fully offline-capable';
  }

  syncLabel() {
    switch (this.syncState) {
      case 'synced': return this.hosted
        ? 'Progress is synced to your account.'
        : 'Progress is stored on this device.';
      case 'saving': return 'Saving to the cloud…';
      case 'error': return 'Cloud sync failed — will retry; progress is safe on this device.';
      default: return 'Offline — progress is stored on this device.';
    }
  }

  _setSync(state) {
    if (this.syncState === state) return;
    this.syncState = state;
    this.onStatusChange?.();
  }

  // Platform cloud slot game:<slug>: ONE JSON document mirrored from
  // localStorage (the local copy stays the offline cache).
  pushCloudSave() {
    if (!this.hosted) return Promise.resolve(false);
    return this.sh.flushSave(true);
  }

  async pullCloudSave() {
    if (!this.hosted) return null;
    const info = await this.sh.saveInfo();
    if (info && info.exists === false) return null;
    return this.sh.loadJSON();
  }

  // Merge local + cloud progression. Both snapshots preserved on conflict;
  // the higher revision wins.
  async reconcileProgress() {
    if (!this.hosted) return { source: 'local' };
    const remote = await this.pullCloudSave();
    const localRev = this.progress.rev || 0;
    const remoteRev = remote?.rev || 0;
    if (!remote || localRev > remoteRev) {
      if (localRev > 0 || !remote) { this._setSync('saving'); this.sh.saveJSON(this.progress, 0); }
      return { source: remote ? 'local-wins' : 'local' };
    }
    if (remoteRev > localRev) {
      this.saveLocal('progress:pre-reconcile', this.progress); // preserve both
      this.progress = { ...freshProgress(), ...remote };
      this.saveProgress({ cloud: false });
      this._setSync('synced');
      return { source: 'cloud' };
    }
    this._setSync('synced');
    return { source: 'same' };
  }

  // --- results / leaderboards ---------------------------------------------------------

  recordResult(result, envelope) {
    this.lastAchievements = [];
    this.results.push(result);
    if (this.results.length > 200) this.results = this.results.slice(-200);
    this.saveLocal('results', this.results);
    this.updateProgressFromResult(result);
  }

  updateProgressFromResult(r) {
    const p = this.progress;
    p.rev = (p.rev || 0) + 1;
    p.totals.games += 1;
    p.totals.points += r.score?.grand || 0;
    if (r.stats?.avalanches) p.totals.avalanches += r.stats.avalanches;
    if (r.status === 'won') {
      p.totals.wins += 1;
      const day = new Date(this.serverNow()).toISOString().slice(0, 10);
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
        p.challenges[r.contentId] = {
          done: true,
          best: Math.max(cur.best || 0, r.score?.grand || 0),
        };
      }
    }
    this.checkAchievements(r);
    this.saveProgress();
  }

  checkAchievements(r) {
    const p = this.progress;
    const grant = (key) => {
      if (p.achievements[key]) return null; // idempotent
      p.achievements[key] = { at: Date.now() };
      return key;
    };
    const newly = [];
    const push = (k) => { const g = grant(k); if (g) newly.push(g); };
    if (r.status === 'won') push('first_table');
    if (r.stats?.upperBonuses > 0) push('lodge_keeper');
    if (r.stats?.avalanches > 0) push('avalanche_caller');
    if (p.streakDays.length >= 7) push('weekly_regular');
    if (r.status === 'won' && r.mode === 'journey' && /^j\d+$/.test(r.contentId) &&
        Number(r.contentId.slice(1)) % 8 === 0) {
      push('mastery_stage');
    }
    if (p.totals.games >= 100) push('century_nights');
    if (newly.length) this.onAchievements?.(newly);
    return newly;
  }

  // Post a finished table's grand total to the high-score board (score-script.js);
  // resolves { posted, rank } — the player's rank on that board, or null.
  async submitScore(total) {
    const sh = this.sh;
    if (!sh || !this.hosted || typeof sh.submitScores !== 'function') return { posted: false, rank: null };
    let keys;
    try { keys = await sh.submitScores({ 'high-score': total }); } catch (e) { return { posted: false, rank: null }; }
    if (!keys || !keys.includes('high-score')) return { posted: false, rank: null };
    try {
      const r = await sh.leaderboard('high-score', { pageSize: 100 });
      const me = ((r && r.items) || []).find((i) => i.userId === sh.userId);
      return { posted: true, rank: me ? me.rank : null };
    } catch (e) { return { posted: true, rank: null }; }
  }

  async leaderboard(board, { friends = false } = {}) {
    // Local leaderboard always available; hosted adds read-only global boards.
    const local = this.results
      .filter((r) => boardMatches(board, r))
      .sort((a, b) => (b.score?.grand || 0) - (a.score?.grand || 0))
      .slice(0, 50)
      .map((r) => ({ name: this.profile.name, me: true, ...publicEntry(r) }));
    if (this.hosted) {
      // Finished tables post to the platform `high-score` board (submitScore);
      // every hosted board reads it. Journey wins have no separate platform board.
      if (board === 'journey') return { source: 'local', entries: local, label: 'casual (local)' };
      try {
        const boards = await this.sh.leaderboards();
        const meta = boards.find((x) => x.key === board) || boards[0];
        if (!meta) return { source: 'local', entries: local, label: 'casual (local)' };
        const res = await this.sh.leaderboardEntries(meta.id, { pageSize: 50, scope: friends ? 'friends' : undefined });
        const entries = [];
        for (const e of res.items || []) {
          const userId = e.userId ?? e.user?.id ?? null;
          entries.push({ name: await this.nicknameFor(userId), me: userId === this.userId, score: e.score ?? e.value ?? 0 });
        }
        return { source: 'global', entries, label: friends ? 'friends' : 'global' };
      } catch (e) {
        return { source: 'local', entries: local, label: 'casual (local)', error: e.message };
      }
    }
    return { source: 'local', entries: local, label: 'casual (local)' };
  }
}
function freshProgress() {
  return {
    v: 1, rev: 0, journey: {}, challenges: {}, achievements: {},
    totals: { games: 0, wins: 0, points: 0, avalanches: 0 },
    streakDays: [], bestDaily: {},
  };
}

function publicEntry(r) {
  return {
    score: r.score?.grand || 0, invalid: r.invalid,
    elapsedMs: r.elapsedMs, status: r.status,
    seed: r.seed, rulesV: r.rulesV, contentV: r.contentV,
    assists: r.assists, durationMs: r.durationMs,
  };
}

function boardMatches(board, r) {
  if (board === 'daily') return r.mode === 'daily';
  if (board === 'journey') return r.mode === 'journey' && r.status === 'won';
  if (board === 'challenge') return r.mode === 'challenge';
  if (board.startsWith('daily:')) return r.contentId === board.slice(6);
  if (board.startsWith('challenge:')) return r.contentId === board.slice(10);
  return r.mode === board;
}

export function defaultSettings() {
  return {
    v: 1,
    theme: 'hearth',
    graphics: {},             // js/gfx.js saved model: { preset: 'auto'|tier, render_scale, adaptive, show_fps, <category> }
    muted: false,
    volMusic: 0.5, volEffects: 0.8, volAmbience: 0.4, volVoice: 0.8,
    captions: false,
    reducedMotion: false,
    highContrast: false,
    palette: 'default',       // default | deuteranopia | protanopia | tritanopia
    largeText: false,
    leftHanded: false,
    holdToConfirm: false,     // hold-versus-toggle
    haptics: true,
    timingAssist: false,
    cameraTilt: 'standard',   // standard | low | overhead
    tutorialsDone: {},
    bindings: null,           // player overrides for gamepad buttons ({ gamepad: {...} })
  };
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
