// Five Dice — authoritative server + static host.
// Serves the browser distribution and the same-origin /api/v1 routes the
// client adapter expects: platform time, cloud saves, presence, activity,
// telemetry funnel, and leaderboard submission with authoritative replay
// validation (the shared rules module runs server-side; client-supplied
// scores, winners and elapsed times are never trusted).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as rules from './js/rules.js';
import { CONTENT_VERSION, findContent, dailyForDate } from './js/content.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8000);
const DATA_DIR = path.join(ROOT, 'data');
const MAX_SCORE = 375; // physical ceiling of a perfect card
const PAYLOAD_LIMIT = 256 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.opus': 'audio/ogg',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// --- durable stores (JSON files, compact) ---------------------------------------

function loadStore(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
  catch { return fallback; }
}
function saveStore(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value));
}

const boards = loadStore('leaderboard.json', {});   // board -> entries[]
const saves = loadStore('saves.json', {});          // name -> { rev, doc }

// --- tiny helpers -----------------------------------------------------------------

const rateBuckets = new Map(); // ip -> { count, reset }
function rateLimited(ip) {
  const now = Date.now();
  let b = rateBuckets.get(ip);
  if (!b || now > b.reset) { b = { count: 0, reset: now + 60000 }; rateBuckets.set(ip, b); }
  b.count += 1;
  return b.count > 120 ? Math.ceil((b.reset - now) / 1000) : 0;
}

function send(res, code, body, headers = {}) {
  const data = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > PAYLOAD_LIMIT) { reject(new Error('payload-too-large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad-json')); }
    });
    req.on('error', reject);
  });
}

// --- leaderboard validation ---------------------------------------------------------
// Reject impossible or stale-version scores; the replay must reproduce the
// claimed terminal hash and breakdown exactly.

// The replay init must match the published content definition exactly on
// every rules-relevant field — otherwise a forged envelope (extra rolls,
// fewer opponents, softer goal) would replay cleanly with inflated scores.
function initMatchesDef(init, def) {
  const norm = {
    rolls: (v) => v ?? rules.DEFAULT_ROLLS,
    disabled: (v) => (Array.isArray(v) ? [...v].sort().join(',') : ''),
    goal: (g) => (g?.type === 'score' ? `score:${Math.floor(g.target)}` : 'win'),
    limit: (l) => l?.totalMs ?? null,
  };
  if (!Array.isArray(init.players) || !Array.isArray(def.players)) return false;
  if (init.players.length !== def.players.length) return false;
  for (let i = 0; i < def.players.length; i++) {
    if (!!init.players[i]?.isAI !== !!def.players[i]?.isAI) return false;
  }
  return norm.rolls(init.rollsPerTurn) === norm.rolls(def.rollsPerTurn) &&
    norm.disabled(init.disabledCategories) === norm.disabled(def.disabledCategories) &&
    norm.goal(init.goal) === norm.goal(def.goal) &&
    norm.limit(init.limits) === norm.limit(def.limits);
}

function validateSubmission(body) {
  const { result, envelope } = body || {};
  if (!result || !envelope) return { error: 'missing-fields' };
  if (!envelope.init || !Array.isArray(envelope.commands)) return { error: 'bad-envelope' };
  if (envelope.contentV !== CONTENT_VERSION) return { error: 'stale-content-version' };
  if (envelope.build !== rules.RULES_VERSION) return { error: 'stale-rules-version' };
  if (envelope.commands.length > 4000) return { error: 'unbounded-envelope' };
  const grand = result.score?.grand;
  if (!Number.isInteger(grand) || grand < 0 || grand > MAX_SCORE) return { error: 'impossible-score' };
  // The content definition must be one we published (immutability guard).
  const known = findContent(result.contentId) ||
    (result.mode === 'daily' && /^\d{4}-\d{2}-\d{2}$/.test(result.seed?.slice(6) || '')
      ? dailyForDate(new Date(`${result.seed.slice(6)}T00:00:00Z`)) : null);
  if (!known) return { error: 'unknown-content' };
  if (known.seed !== envelope.init.seed) return { error: 'seed-mismatch' };
  if (!initMatchesDef(envelope.init, known)) return { error: 'init-mismatch' };
  let rep;
  try { rep = rules.replay(envelope); }
  catch { return { error: 'replay-crashed' }; }
  if (!rep.ok) return { error: `replay-rejected:${rep.error}` };
  const me = rep.final.players[0];
  const breakdown = rules.totalsBreakdown(me.scores);
  if (breakdown.grand !== grand) return { error: 'score-mismatch' };
  if (rep.finalHash !== envelope.checkpoints?.[envelope.checkpoints.length - 1]?.hash) {
    return { error: 'checkpoint-mismatch' };
  }
  if (rep.final.status === 'active') return { error: 'unfinished-round' };
  return {
    ok: true,
    entry: {
      name: String(body.name || 'Guest').slice(0, 20),
      score: grand, status: rep.final.status === 'finished' &&
        rules.playerWon(rep.final, 0) ? 'won' : 'lost',
      invalid: me.invalid, elapsedMs: rep.final.clock,
      seed: envelope.seed, rulesV: envelope.build, contentV: envelope.contentV,
      assists: result.assists || {}, durationMs: rep.final.clock,
      sessionId: String(result.sessionId || '').slice(0, 40),
      at: Date.now(),
    },
    board: result.mode === 'daily' ? `daily:${result.contentId}` : `challenge:${result.contentId}`,
  };
}

function submitScore(board, entry) {
  const list = boards[board] || (boards[board] = []);
  // Idempotent by session id: a retried submission never duplicates.
  const existing = list.findIndex((e) => e.sessionId === entry.sessionId);
  if (existing >= 0) list[existing] = entry;
  else list.push(entry);
  list.sort((a, b) => rules.compareResults(a, b));
  boards[board] = list.slice(0, 100);
  saveStore('leaderboard.json', boards);
  return boards[board].findIndex((e) => e.sessionId === entry.sessionId) + 1;
}

// --- request handling ------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || 'anon';
  const retry = rateLimited(ip);
  if (retry) {
    send(res, 429, { error: 'rate-limited' }, { 'retry-after': String(retry) });
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/api/v1/time' && req.method === 'GET') {
      send(res, 200, { now: Date.now() });
      return;
    }
    if (p === '/api/v1/save' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || body.game || 'guest').slice(0, 40);
      const doc = body.doc;
      if (!doc || typeof doc !== 'object') { send(res, 400, { error: 'bad-doc' }); return; }
      const cur = saves[name];
      // Keep both snapshots on conflict instead of overwriting blindly.
      if (cur && (doc.rev ?? 0) < (cur.doc.rev ?? 0)) {
        saves[`${name}:conflict:${Date.now()}`] = doc;
        send(res, 200, { stored: 'conflict-copy' });
        return;
      }
      saves[name] = { doc };
      saveStore('saves.json', saves);
      send(res, 200, { stored: 'ok' });
      return;
    }
    if (p === '/api/v1/save' && req.method === 'GET') {
      const name = String(url.searchParams.get('name') || url.searchParams.get('game') || 'guest').slice(0, 40);
      send(res, 200, { doc: saves[name]?.doc || null });
      return;
    }
    if (p === '/api/v1/leaderboard/submit' && req.method === 'POST') {
      const body = await readBody(req);
      const v = validateSubmission(body);
      if (v.error) { send(res, 422, { error: v.error }); return; }
      const rank = submitScore(v.board, v.entry);
      send(res, 200, { accepted: true, board: v.board, rank, validated: true });
      return;
    }
    if (p === '/api/v1/leaderboard' && req.method === 'GET') {
      const board = String(url.searchParams.get('board') || 'daily');
      const key = board.includes(':') ? board : null;
      // Aggregate plain boards from their per-content boards.
      let entries = [];
      if (key) entries = boards[key] || [];
      else {
        for (const [k, list] of Object.entries(boards)) {
          if (k.startsWith(`${board}:`)) entries.push(...list);
        }
        entries.sort((a, b) => rules.compareResults(a, b));
        entries = entries.slice(0, 100);
      }
      send(res, 200, { entries, validated: true });
      return;
    }
    if (p === '/api/v1/presence' && req.method === 'POST') { send(res, 200, { ok: true }); return; }
    if (p === '/api/v1/activity/start' && req.method === 'POST') { send(res, 200, { ok: true }); return; }
    if (p === '/api/v1/activity/end' && req.method === 'POST') { send(res, 200, { ok: true }); return; }
    if (p === '/api/v1/events' && req.method === 'POST') {
      const body = await readBody(req);
      const ALLOWED = ['start', 'tutorial-step', 'round-end', 'retry', 'settings-change', 'error'];
      if (!ALLOWED.includes(body.event)) { send(res, 400, { error: 'event-not-allowed' }); return; }
      send(res, 200, { ok: true });
      return;
    }
    if (p.startsWith('/api/')) { send(res, 404, { error: 'not-found' }); return; }

    // Static distribution.
    const rel = p === '/' ? 'index.html' : p.replace(/^\//, '');
    const filePath = path.resolve(ROOT, rel);
    const insideRoot = filePath.startsWith(ROOT + path.sep);
    const inData = filePath.startsWith(path.join(DATA_DIR) + path.sep);
    if (!insideRoot || inData) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (err) {
    if (err.message === 'payload-too-large') send(res, 413, { error: 'payload-too-large' });
    else if (err.message === 'bad-json') send(res, 400, { error: 'bad-json' });
    else send(res, 500, { error: 'internal' });
  }
});

server.listen(PORT, () => console.log(`Five Dice server listening on http://localhost:${PORT}`));
