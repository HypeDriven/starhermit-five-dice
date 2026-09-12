// Five Dice — platform adapter.
// Local-first: guest practice works fully offline after load. Hosted
// (StarHermit) mode activates only when a launch token was read from the URL;
// every platform call then carries the Bearer token, the account nickname and
// the single cloud-save slot. The game's own server.js keeps its save,
// leaderboard, presence, activity and events routes for local development
// (npm start) — those paths never run hosted. Tokens never persist to local
// storage; structured {"error":...} responses and rate limits are recoverable
// UI states.

const LS_PREFIX = 'fivedice:';
const TOKEN_REFRESH_MS = 45 * 60 * 1000; // launch tokens live 60 min
const TOKEN_RETRY_MS = 60 * 1000;
const CLOUD_DEBOUNCE_MS = 2000;

export class Platform {
  constructor() {
    this.hosted = false;         // true iff a launch token was read
    this.devApi = false;         // true when the game's own dev server answers
    this.offsetMs = 0;           // dev-server time offset (round-trip adjusted)
    this.launchToken = null;     // short-lived; read from launch, never stored
    this.userId = null;          // token sub
    this.slug = null;            // token game_scope (cloud-save key)
    this.syncState = 'offline';  // offline | saving | synced | error
    this.consent = { telemetry: false };
    this._hb = null;
    this._cloudTimer = null;
    this._cloudDirty = false;
    this._refreshTimer = null;
    this._retryTimer = null;
    this._nickCache = new Map();
    this._gameInfo = null;
  }

  // --- bootstrap ---------------------------------------------------------------

  async init() {
    this.readLaunchToken();
    // Merge over defaults so saves from older versions gain new keys.
    this.settings = { ...defaultSettings(), ...(this.loadLocal('settings') || {}) };
    this.consent.telemetry = !!this.settings.telemetryConsent;
    this.profile = this.loadLocal('profile') || {
      name: 'Guest', guest: true, createdAt: Date.now(),
    };
    this.progress = { ...freshProgress(), ...(this.loadLocal('progress') || {}) };
    this.results = this.loadLocal('results') || [];
    await this.detectDevServer();
    if (this.hosted) {
      this.fetchAccountProfile().catch(() => {});
      this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_MS);
    }
    return this;
  }

  readLaunchToken() {
    // The platform delivers the token in the URL fragment: #game_token=<jwt>
    // (optional &session_id=…). Read it once, then strip it from the address
    // bar. Query-param fallbacks exist for local development only and never
    // run on *.starhermit.com. Never persisted.
    let token = null;
    if (location.hash) {
      const frag = new URLSearchParams(location.hash.slice(1));
      token = frag.get('game_token');
      if (token && history.replaceState) {
        history.replaceState(null, '', location.pathname + location.search);
      }
    }
    if (!token && !/(^|\.)starhermit\.com$/i.test(location.hostname)) {
      const params = new URLSearchParams(location.search);
      token = params.get('game_token') || params.get('launch') || params.get('token');
      if (token && history.replaceState) history.replaceState(null, '', location.pathname);
    }
    this.launchToken = token;
    if (!token) return;
    const payload = decodeJwtPayload(token);
    this.userId = payload?.sub || null;
    this.slug = payload?.game_scope || null;
    this.hosted = true;
  }

  async detectDevServer() {
    if (this.hosted) return; // hosted iff a token was read; no probe needed
    try {
      const t0 = Date.now();
      const res = await fetch('/api/v1/time', { signal: AbortSignal.timeout(2500) });
      const t1 = Date.now();
      if (!res.ok) throw new Error(`time ${res.status}`);
      const body = await res.json();
      if (typeof body.now !== 'number') throw new Error('bad time payload');
      // Round-trip-adjusted offset: assume symmetric latency.
      this.offsetMs = body.now - (t0 + (t1 - t0) / 2);
      this.hosted = true;
    } catch {
      this.hosted = false;
      this.offsetMs = 0;
    }
  }

  serverNow() {
    return Date.now() + this.offsetMs;
  }

  serverOffsetMs() {
    return this.offsetMs;
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

  saveSettings() { this.saveLocal('settings', this.settings); }
  saveProfile() { this.saveLocal('profile', this.profile); }

  saveProgress({ cloud = true } = {}) {
    // Versioned, checksummed progression document.
    this.progress.v = 1;
    this.saveLocal('progress', this.progress);
    const body = JSON.stringify(this.progress);
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum = (sum + body.charCodeAt(i) * (i + 1)) % 1000003;
    this.saveLocal('progress:checksum', sum);
    if (!cloud) return;
    if (this.hosted) {
      this._cloudDirty = true;
      this._scheduleCloudSave();
    } else if (this.devApi) {
      this.ownServerSave(this.progress).catch(() => {});
    }
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

  // --- hosted API -------------------------------------------------------------------

  async api(path, opts = {}) {
    const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
    if (this.launchToken) headers.authorization = `Bearer ${this.launchToken}`;
    const res = await fetch(`/api/v1${path}`, {
      ...opts,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 429) {
      const err = new Error('rate-limited');
      err.recoverable = true;
      err.retryAfter = Number(res.headers.get('retry-after')) || 5;
      throw err;
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `http-${res.status}`);
      err.structured = !!body.error;
      throw err;
    }
    return body;
  }

  async _refreshToken() {
    // Scoped launch tokens may re-mint: swap the new token in and reschedule.
    clearTimeout(this._refreshTimer);
    clearTimeout(this._retryTimer);
    if (!this.hosted || !this.slug || !this.launchToken) return;
    try {
      const res = await this.api(`/games/${encodeURIComponent(this.slug)}/launch-token`, { method: 'POST' });
      if (res.token) this.launchToken = res.token;
      this._refreshTimer = setTimeout(() => this._refreshToken(), TOKEN_REFRESH_MS);
    } catch {
      this._retryTimer = setTimeout(() => this._refreshToken(), TOKEN_RETRY_MS);
    }
  }

  async fetchAccountProfile() {
    // Nickname from the platform profile; usernames are never displayed and
    // /api/v1/me is never called (403 for launch tokens).
    if (!this.hosted || !this.userId) return;
    let name = null;
    try {
      const prof = await this.api(`/users/${encodeURIComponent(this.userId)}/profile`);
      name = prof?.nickname || null;
    } catch { /* fall through to the id-based fallback */ }
    this.profile = {
      ...this.profile,
      name: String(name || `Player ${String(this.userId).slice(0, 8)}`).slice(0, 24),
      guest: false,
      account: true,
    };
    this.saveProfile();
    this.onStatusChange?.();
  }

  async nicknameFor(userId) {
    // Leaderboard entries resolve ids to nicknames via the profile helper.
    if (!userId) return 'Player';
    if (this._nickCache.has(userId)) return this._nickCache.get(userId);
    let name = `Player ${String(userId).slice(0, 8)}`;
    try {
      const prof = await this.api(`/users/${encodeURIComponent(userId)}/profile`);
      if (prof?.nickname) name = String(prof.nickname).slice(0, 24);
    } catch { /* keep fallback */ }
    this._nickCache.set(userId, name);
    return name;
  }

  async gameInfo() {
    if (this._gameInfo) return this._gameInfo;
    this._gameInfo = await this.api(`/games/${encodeURIComponent(this.slug)}`);
    return this._gameInfo;
  }

  statusLine() {
    if (this.hosted) {
      const sync = {
        synced: 'cloud synced', saving: 'saving to cloud…',
        error: 'cloud sync error', offline: 'offline',
      }[this.syncState] || 'cloud synced';
      return `Signed in as ${this.profile.name} · ${sync}`;
    }
    return this.devApi ? 'Connected to lodge servers' : 'Local play — fully offline-capable';
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

  // Platform cloud slot: ONE zip+base64 document mirrored from localStorage
  // (the local copy stays the offline cache). Skipped without a token/slug.
  _setSync(state) {
    if (this.syncState === state) return;
    this.syncState = state;
    this.onStatusChange?.();
  }

  _scheduleCloudSave() {
    if (!this.hosted || !this.slug) return;
    this._setSync('saving');
    clearTimeout(this._cloudTimer);
    this._cloudTimer = setTimeout(() => this.pushCloudSave(), CLOUD_DEBOUNCE_MS);
  }

  async pushCloudSave() {
    if (!this.hosted || !this.slug) return;
    clearTimeout(this._cloudTimer);
    if (!this._cloudDirty) { this._setSync('synced'); return; }
    this._cloudDirty = false;
    this._setSync('saving');
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(this.progress));
      await this.api(`/me/cloud-saves/${encodeURIComponent(this.slug)}`, {
        method: 'PUT',
        body: { dataBase64: bytesToBase64(zipStore('progress.json', bytes)) },
      });
      this._setSync('synced');
    } catch {
      this._cloudDirty = true;
      this._setSync('error');
    }
  }

  async pullCloudSave() {
    if (!this.hosted || !this.slug) return null;
    try {
      const res = await fetch(`/api/v1/me/cloud-saves/${encodeURIComponent(this.slug)}`, {
        headers: { authorization: `Bearer ${this.launchToken}` },
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`http-${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      return JSON.parse(new TextDecoder().decode(unzipFirstEntry(bytes)));
    } catch {
      return null;
    }
  }

  // Merge local + cloud progression. Both snapshots preserved on conflict;
  // the higher revision wins.
  async reconcileProgress() {
    if (this.hosted) {
      const remote = await this.pullCloudSave();
      if (!remote) {
        this._cloudDirty = true;
        this.pushCloudSave();
        return { source: 'local' };
      }
      const localRev = this.progress.rev || 0;
      const remoteRev = remote.rev || 0;
      if (remoteRev > localRev) {
        this.saveLocal('progress:pre-reconcile', this.progress); // preserve both
        this.progress = { ...freshProgress(), ...remote };
        this.saveProgress({ cloud: false });
        this._setSync('synced');
        return { source: 'cloud' };
      }
      if (localRev > remoteRev) {
        this._cloudDirty = true;
        await this.pushCloudSave();
        return { source: 'local-wins' };
      }
      this._setSync('synced');
      return { source: 'same' };
    }
    const remote = await this.ownServerLoad();
    if (!remote) return { source: 'local' };
    const localRev = this.progress.rev || 0;
    const remoteRev = remote.rev || 0;
    if (remoteRev > localRev) {
      this.saveLocal('progress:pre-reconcile', this.progress); // preserve both
      this.progress = remote;
      this.saveProgress();
      return { source: 'cloud' };
    }
    if (localRev > remoteRev) {
      await this.ownServerSave(this.progress);
      return { source: 'local-wins' };
    }
    return { source: 'same' };
  }

  // --- own dev server (npm start; local development only) ------------------------------

  async ownServerSave(doc) {
    if (!this.devApi) return null;
    return this.api('/save', { method: 'POST', body: { game: 'five-dice', doc } });
  }

  async ownServerLoad() {
    if (!this.devApi) return null;
    try {
      const res = await this.api('/save?game=five-dice');
      return res.doc || null;
    } catch {
      return null;
    }
  }

  // --- results / leaderboards ---------------------------------------------------------

  recordResult(result, envelope) {
    this.lastAchievements = [];
    this.results.push(result);
    if (this.results.length > 200) this.results = this.results.slice(-200);
    this.saveLocal('results', this.results);
    this.updateProgressFromResult(result);
    if (this.devApi && (result.mode === 'daily' || result.mode === 'challenge')) {
      // Replay-validated submission to the game's own dev server only;
      // hosted leaderboards are read-only on the platform.
      this.api('/leaderboard/submit', {
        method: 'POST',
        body: { name: this.profile.name, result, envelope },
      }).catch(() => { /* offline-tolerant: local record already kept */ });
    }
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

  async leaderboard(board, { friends = false } = {}) {
    // Local leaderboard always available; hosted adds read-only global boards.
    const local = this.results
      .filter((r) => boardMatches(board, r))
      .sort((a, b) => (b.score?.grand || 0) - (a.score?.grand || 0))
      .slice(0, 50)
      .map((r) => ({ name: this.profile.name, me: true, ...publicEntry(r) }));
    if (this.hosted) {
      // Clients can never submit scores. Journey wins have no platform board.
      if (board === 'journey') return { source: 'local', entries: local, label: 'casual (local)' };
      try {
        const info = await this.gameInfo();
        if (!info.leaderboardId) return { source: 'local', entries: local, label: 'casual (local)' };
        const q = `friendsOnly=${friends ? '1' : ''}&page=1&pageSize=50`;
        const res = await this.api(`/leaderboards/${encodeURIComponent(info.leaderboardId)}/entries?${q}`);
        const entries = [];
        for (const e of res.entries || []) {
          const userId = e.userId ?? e.user?.id ?? null;
          entries.push({
            name: await this.nicknameFor(userId),
            me: userId === this.userId,
            score: e.score ?? e.value ?? 0,
          });
        }
        return { source: 'global', entries, label: friends ? 'friends' : 'global' };
      } catch (e) {
        return { source: 'local', entries: local, label: 'casual (local)', error: e.message };
      }
    }
    if (this.devApi) {
      try {
        const res = await this.api(`/leaderboard?board=${encodeURIComponent(board)}${friends ? '&friends=1' : ''}`);
        return { source: 'global', entries: res.entries, label: res.validated ? 'validated' : 'casual' };
      } catch (e) {
        return { source: 'local', entries: local, label: 'casual (local)', error: e.message };
      }
    }
    return { source: 'local', entries: local, label: 'casual (local)' };
  }

  // --- presence + telemetry (own dev server only; no-ops hosted) ----------------------

  startPresence() {
    if (!this.devApi || this._hb) return;
    const beat = () => this.api('/presence', { method: 'POST', body: { game: 'five-dice' } }).catch(() => {});
    beat();
    this._hb = setInterval(beat, 30000); // throttled heartbeats while playing
  }

  stopPresence() {
    clearInterval(this._hb);
    this._hb = null;
  }

  track(eventName, data = {}) {
    // Anonymous funnel events only; no raw text or personal data.
    const ALLOWED = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
    if (!ALLOWED.includes(eventName)) return;
    if (!this.consent.telemetry || !this.devApi) return;
    this.api('/events', { method: 'POST', body: { game: 'five-dice', event: eventName, data } })
      .catch(() => {});
  }

  async activityStart() {
    if (!this.devApi) return;
    try { await this.api('/activity/start', { method: 'POST', body: { game: 'five-dice' } }); } catch {}
  }

  async activityEnd() {
    if (!this.devApi) return;
    try { await this.api('/activity/end', { method: 'POST', body: { game: 'five-dice' } }); } catch {}
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

// Launch-token payload (base64url decode only; the platform verifies).
function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    return JSON.parse(atob(b64 + pad));
  } catch {
    return null;
  }
}

// Minimal ZIP writer/reader (stored entries only, no compression).
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(name, dataBytes) {
  const enc = new TextEncoder();
  const nameB = enc.encode(name);
  const crc = crc32(dataBytes);
  const out = [];
  const u16 = (v) => out.push(v & 0xff, (v >> 8) & 0xff);
  const u32 = (v) => out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  u32(0x04034b50); u16(20); u16(0); u16(0); u16(0); u16(0);
  u32(crc); u32(dataBytes.length); u32(dataBytes.length);
  u16(nameB.length); u16(0);
  const head = new Uint8Array(out);
  const cd = [];
  const c16 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff);
  const c32 = (v) => cd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  c32(0x02014b50); c16(20); c16(20); c16(0); c16(0); c16(0); c16(0);
  c32(crc); c32(dataBytes.length); c32(dataBytes.length);
  c16(nameB.length); c16(0); c16(0); c16(0); c16(0); c32(0); c32(0);
  const cdHead = new Uint8Array(cd);
  const cdOff = head.length + nameB.length + dataBytes.length;
  const parts = [head, nameB, dataBytes, cdHead, nameB];
  const eocd = [];
  const e32 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff);
  const e16 = (v) => eocd.push(v & 0xff, (v >> 8) & 0xff);
  e32(0x06054b50); e16(0); e16(0); e16(1); e16(1);
  e32(cdHead.length + nameB.length); e32(cdOff); e16(0);
  parts.push(new Uint8Array(eocd));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
function unzipFirstEntry(zipBytes) {
  // Stored single-entry reader: scan local headers for compression 0.
  const dv = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let off = 0;
  while (off + 30 <= zipBytes.length && dv.getUint32(off, true) === 0x04034b50) {
    const method = dv.getUint16(off + 8, true);
    const size = dv.getUint32(off + 18, true);
    const nameLen = dv.getUint16(off + 26, true);
    const extraLen = dv.getUint16(off + 28, true);
    const dataOff = off + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('unsupported zip entry');
    return zipBytes.slice(dataOff, dataOff + size);
  }
  throw new Error('bad zip');
}
function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function defaultSettings() {
  return {
    v: 1,
    theme: 'hearth',
    quality: 'medium',
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
    bindings: null,           // player overrides for desktop action bindings
    telemetryConsent: false,
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
