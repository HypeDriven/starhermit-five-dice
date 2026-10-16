// Five Dice — platform adapter on the real StarHermit SDK with a stubbed fetch
// and launch URL (node --test tests/platform.test.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Platform, DEFAULT_KEYS } from '../js/platform.js';

// The package is ESM, so the UMD SDK is evaluated with a CommonJS-style module object.
const SDK = (() => { const module = { exports: {} }; new Function('module', readFileSync(new URL('../starhermit-sdk.js', import.meta.url), 'utf8'))(module); return module.exports; })();
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = 'h.' + b64u({ sub: 'u-123456789', game_scope: 'five-dice-id', exp: Math.floor(Date.now() / 1000) + 3600 }) + '.s';

function harness(href, routes = {}, shared = { store: {}, etags: {} }) {
  const calls = []; const { store, etags } = shared; const url = new URL(href);
  const win = { location: { hash: url.hash, search: url.search, pathname: url.pathname, origin: url.origin, hostname: url.hostname, href }, history: { replaceState: (a, b, u) => { win.replaced = u; } } };
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET'; calls.push({ path, method, body: init.body });
    if (path.includes('/cloud-saves/')) {
      const key = decodeURIComponent(path.split('/cloud-saves/')[1]);
      if (key.endsWith('/info')) return new Response(JSON.stringify({ exists: !!store[key.slice(0, -5)], etag: etags[key.slice(0, -5)] || null }), { status: 200 });
      if (method === 'PUT') {
        // Conditional writes: If-Match must name the current version, If-None-Match: * needs an empty slot.
        const h = init.headers || {};
        const ifMatch = h['If-Match'], ifNone = h['If-None-Match'];
        if ((ifMatch && ifMatch !== etags[key]) || (ifNone === '*' && store[key])) return new Response(JSON.stringify({ error: 'precondition_failed', etag: etags[key] || null }), { status: 412 });
        store[key] = Buffer.from(JSON.parse(init.body).dataBase64, 'base64');
        etags[key] = '"v' + calls.length + '"';
        return new Response(JSON.stringify({ etag: etags[key] }), { status: 200 });
      }
      return store[key] ? new Response(store[key], { status: 200, headers: { etag: etags[key] } }) : new Response('', { status: 404 });
    }
    const hit = Object.entries(routes).find(([k]) => `${method} ${path}`.endsWith(k));
    return hit ? new Response(JSON.stringify(hit[1]), { status: 200 }) : new Response('', { status: 404 });
  };
  const sh = SDK.create({ window: win, fetch, setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; } });
  return { platform: new Platform(sh), sh, calls, store, win, shared };
}

test('hosted: token, nickname, settings KV, bindings and game:<slug> cloud save', async () => {
  const h = harness('https://five-dice-id.starhermit.com/#game_token=' + TOKEN, {
    'GET /api/v1/users/u-123456789/profile': { username: 'raw', nickname: 'Juniper' },
    'GET /api/v1/games/five-dice-id/settings': { settings: { theme: 'aurora', volMusic: 0.2, bogus: 1, muted: 'yes' } },
    'PATCH /api/v1/games/five-dice-id/settings': {},
    'GET /api/v1/games/five-dice-id/controls': { actions: [{ action: 'roll', codes: ['Space'] }] },
  });
  await h.platform.init();
  assert.equal(h.platform.hosted, true);
  assert.equal(h.platform.userId, 'u-123456789');
  assert.equal(h.win.replaced, '/');
  assert.equal(h.calls[0].path.startsWith('/api/v1/'), true);
  assert.equal(h.platform.profile.name, 'Juniper');
  assert.match(h.platform.statusLine(), /Signed in as Juniper/);
  assert.equal(h.platform.settings.theme, 'aurora');
  assert.equal(h.platform.settings.volMusic, 0.2);
  assert.equal(h.platform.settings.muted, false, 'mistyped remote values are ignored');
  assert.deepEqual(h.platform.keyBindings.roll, ['Space']);
  assert.deepEqual(h.platform.keyBindings.hint, DEFAULT_KEYS.hint);

  h.platform.settings.volEffects = 0.3;
  h.platform.saveSettings();
  await new Promise((r) => setTimeout(r, 450));
  const patch = h.calls.find((c) => c.method === 'PATCH');
  assert.equal(patch.path, '/api/v1/games/five-dice-id/settings');
  assert.equal(JSON.parse(patch.body).settings.volEffects, 0.3);

  h.platform.progress.rev = 4;
  h.platform.saveProgress();
  assert.equal(h.platform.syncState, 'saving');
  assert.equal(await h.platform.pushCloudSave(), true);
  assert.equal(h.platform.syncState, 'synced');
  assert.deepEqual(Object.keys(h.store), ['game:five-dice-id']);
  assert.equal(h.calls.find((c) => c.method === 'PUT').path, '/api/v1/me/cloud-saves/' + encodeURIComponent('game:five-dice-id'));
  assert.equal((await h.platform.pullCloudSave()).rev, 4);
  assert.match(h.platform.inviteLink(), /\/game-invite\/u-123456789\/five-dice-id$/);
});

test('reconcile: higher remote revision wins and keeps the local copy aside', async () => {
  const h = harness('https://x.example/#game_token=' + TOKEN);
  await h.platform.init();
  await h.sh.writeSave(JSON.stringify({ rev: 9, totals: { games: 9, wins: 1, points: 10, avalanches: 0 } }));
  assert.equal((await h.platform.reconcileProgress()).source, 'cloud');
  assert.equal(h.platform.progress.totals.games, 9);
});

test('renewal refused: signs out to local play', async () => {
  const h = harness('https://x.example/#game_token=' + TOKEN);
  await h.platform.init();
  let notified = false; h.platform.onAuthChange = () => { notified = true; };
  h.sh.signOut('expired');
  assert.equal(h.platform.hosted, false);
  assert.equal(notified, true);
  assert.equal(h.platform.profile.guest, true);
});

test('standalone: no network calls, guest profile, defaults', async () => {
  const h = harness('http://127.0.0.1:8000/');
  await h.platform.init();
  assert.equal(h.platform.hosted, false);
  assert.equal(h.platform.canSignIn, false);
  h.platform.saveSettings();
  h.platform.saveProgress();
  await h.platform.pushCloudSave();
  assert.equal(await h.platform.pullCloudSave(), null);
  assert.equal((await h.platform.leaderboard('daily')).source, 'local');
  assert.equal(h.platform.inviteLink(), null);
  assert.equal(h.calls.length, 0);
  assert.match(h.platform.statusLine(), /Local play/);
});

test('sign-in offered on the platform host without a token', async () => {
  const h = harness('https://0b9d6f2e-3c4a-4e5b-9a7c-1d2e3f405162.starhermit.com/');
  await h.platform.init();
  assert.equal(h.platform.canSignIn, true);
  assert.equal(h.calls.length, 0);
});

test('save conflict: a write that lost to another device reloads, merges both and saves again', async () => {
  const routes = {
    'GET /api/v1/games/five-dice-id/settings': { settings: {} },
    'GET /api/v1/games/five-dice-id/controls': { actions: [] },
  };
  const h = harness('https://five-dice-id.starhermit.com/#game_token=' + TOKEN, routes);
  await h.platform.init();
  assert.equal(await h.sh.loadJSON(), null, 'this device loaded an empty slot');
  // Another device saves first.
  const other = harness('https://five-dice-id.starhermit.com/#game_token=' + TOKEN, routes, h.shared);
  await other.platform.init();
  other.sh.saveJSON({ v: 1, rev: 9, journey: { j01: { done: true, best: 150, stars: 2 } }, challenges: {}, achievements: { first_table: { at: 5 } },
    totals: { games: 12, wins: 3, points: 2000, avalanches: 1 }, streakDays: ['2026-10-01'], bestDaily: { 'daily-2026-10-01': 180 } });
  await other.sh.flushSave(true);
  // This device's own progress, then its (now conflicting) save.
  let conflicts = 0;
  h.sh.on('saveconflict', () => { conflicts++; });
  h.platform.progress = { ...h.platform.progress, rev: 2, journey: { j01: { done: true, best: 200, stars: 1 }, j02: { done: true, best: 170, stars: 3 } },
    achievements: { lodge_keeper: { at: 7 } }, totals: { games: 4, wins: 4, points: 900, avalanches: 2 }, streakDays: ['2026-10-02'], bestDaily: { 'daily-2026-10-01': 150 } };
  h.platform.saveProgress();
  await h.sh.flushSave(true);
  assert.equal(conflicts, 1, 'the conditional write was refused');
  for (let i = 0; i < 20 && h.platform.progress.rev <= 9; i++) await new Promise((r) => setTimeout(r, 5));
  const p = h.platform.progress;
  assert.deepEqual(p.totals, { games: 12, wins: 4, points: 2000, avalanches: 2 });
  assert.deepEqual(p.journey.j01, { done: true, best: 200, stars: 2 });
  assert.equal(p.journey.j02.done, true);
  assert.deepEqual(Object.keys(p.achievements).sort(), ['first_table', 'lodge_keeper']);
  assert.deepEqual(p.streakDays, ['2026-10-01', '2026-10-02']);
  assert.equal(p.bestDaily['daily-2026-10-01'], 180);
  await h.sh.flushSave(true);
  const saved = await other.sh.loadJSON();
  assert.equal(saved.totals.wins, 4, 'the merged document is saved again');
  assert.equal(saved.totals.games, 12);
  assert.equal(h.sh.saveConflicted(), false);
});
