/**
 * Five Dice — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   load → title menu → Practice (Ember vs lodge AI) → full table played
 *   through the on-screen Roll button, dice-tray hold buttons and scorecard
 *   category buttons until the Results overlay, plus pause/resume and
 *   settings open/change/close mid-game. Runs twice: desktop 1280x800 and
 *   a fresh mobile context at 390x844 with touch (scorecard drawer driven
 *   through its visible toggle).
 *
 * The game is local-first; this test embeds a minimal static server that
 * also stubs the same-origin /api/v1 routes (time/save/presence/activity/
 * events/leaderboard read) so the client boots in "hosted" mode without the
 * authoritative server. Practice tables are unranked, so no score submission
 * path is exercised. Page state (window.__fivedice) is read only for
 * synchronization; every action goes through the visible UI.
 *
 * Regression notes (both fixed in game code; any page error fails the run):
 * 1. js/ui.js showResults() referenced `won` outside the overlay-build
 *    callback where it was declared, throwing "ReferenceError: won is not
 *    defined" when the results screen showed. Fixed by hoisting the binding.
 * 2. Mobile layout: with the scorecard drawer open, #rail-left (z-index 7)
 *    covered its own #drawer-left-toggle (z-index 6) and the bottom action
 *    tray. Fixed by raising the toggle above the rails; the mobile pass now
 *    opens and closes the drawer by touch on every turn.
 * Any page error fails the run.
 *
 * Run: npm run test:e2e
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, tag) => `/tmp/five-dice-e2e-${stage}-${tag}.png`;

// Benign GPU/swiftshader console noise (matches tools/production_game_audit.mjs).
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.ts': 'application/javascript; charset=utf-8',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    // Minimal same-origin API stubs so the client boots hosted without 404 noise.
    if (p.startsWith('/api/')) {
      const json = (body) => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(body));
      };
      if (p === '/api/v1/time') return json({ now: Date.now() });
      if (p === '/api/v1/save' && req.method === 'GET') return json({ doc: null });
      if (p === '/api/v1/save') return json({ stored: 'ok' });
      if (p === '/api/v1/leaderboard') return json({ entries: [], validated: true });
      return json({ ok: true });
    }
    const rel = p === '/' ? 'index.html' : decodeURIComponent(p.replace(/^\//, ''));
    const filePath = path.join(ROOT, rel);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const step = async (name, fn) => {
  await fn();
  console.log(`ok - ${name}`);
};

async function playPass(browser, base, { tag, viewport, mobile }) {
  const context = await browser.newContext({
    viewport,
    ...(mobile ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  const checkErrors = () => {
    if (errors.length) throw new Error(`${tag} pass page errors:\n${errors.join('\n')}`);
  };

  try {
    await step(`[${tag}] load + title menu visible`, async () => {
      await page.goto(base, { waitUntil: 'load' });
      await page.waitForFunction(() => !!window.__fivedice, null, { timeout: 15000 });
      await page.waitForSelector('.overlay[aria-label="Five Dice"]', { timeout: 10000 });
      const status = await page.textContent('#session-status');
      if (!/Connected|offline/i.test(status)) throw new Error('unexpected session status: ' + status);
      await page.screenshot({ path: SHOT('title', tag) });
    });

    await step(`[${tag}] start Practice — Ember vs AI`, async () => {
      await page.locator('.overlay .menu-list button', { hasText: 'Practice' }).click();
      await page.waitForSelector('.overlay[aria-label="Practice setup"]');
      await page.locator('.overlay .menu-list button', { hasText: 'Ember' }).click();
      await page.waitForSelector('#action-tray:not([hidden])', { timeout: 10000 });
      await page.waitForFunction(() => window.__fivedice.session.machine === 'active', null, { timeout: 15000 });
      const st = await page.evaluate(() => ({
        players: window.__fivedice.session.state.players.map((p) => p.name),
        status: window.__fivedice.session.state.status,
      }));
      if (st.status !== 'active' || st.players.length !== 2) {
        throw new Error('bad round start: ' + JSON.stringify(st));
      }
    });

    // Wait until it is the human's turn (or the table ends).
    const waitHumanTurn = () => page.waitForFunction(() => {
      const f = window.__fivedice;
      if (!f?.session?.state) return false;
      if (f.session.state.status !== 'active') return true;
      return (f.session.machine === 'active' || f.session.machine === 'tutorial') && f.session.isHumanTurn();
    }, null, { timeout: 60000 });

    const rollEnabled = () => page.waitForFunction(
      () => document.querySelector('#action-tray #btn-roll')?.disabled === false,
      null, { timeout: 15000 });

    // All passes click the visible Roll button / die buttons. On mobile the
    // scorecard lives in a drawer: it is opened to score and tapped closed
    // again every turn, verifying the toggle stays reachable above the rail.
    const doRoll = () => page.locator('#action-tray #btn-roll').click();
    const doHold = (i) => page.locator(`#dice-tray .die-btn[data-die="${i}"]`).click();
    const openDrawer = async () => {
      if (!mobile) return;
      await page.click('#drawer-left-toggle');
      await page.waitForFunction(() => document.body.classList.contains('drawer-left-open'));
    };
    const closeDrawer = async () => {
      if (!mobile) return;
      await page.click('#drawer-left-toggle');
      await page.waitForFunction(() => !document.body.classList.contains('drawer-left-open'));
    };

    const playHumanTurn = async (turnNo) => {
      await rollEnabled();
      await doRoll();
      if (turnNo === 1) {
        // Exercise the hold mechanic: keep die 1 through a reroll.
        await page.waitForFunction(
          () => document.querySelector('#dice-tray .die-btn[data-die="0"]')?.disabled === false);
        await doHold(0);
        await page.waitForFunction(() => window.__fivedice.session.state.held[0] === true);
        await rollEnabled();
        await doRoll();
        await page.screenshot({ path: SHOT('play', tag) });
      }
      // Score the first legal category on the visible scorecard.
      await openDrawer();
      const cat = page.locator('#rail-left button.cat.legal').first();
      await cat.waitFor({ state: 'visible', timeout: 10000 });
      await cat.click();
      await closeDrawer();
    };

    await step(`[${tag}] first turn: roll, hold a die, reroll, score`, async () => {
      await waitHumanTurn();
      await playHumanTurn(1);
      const filled = await page.evaluate(() =>
        Object.values(window.__fivedice.session.state.players[0].scores).filter((v) => v != null).length);
      if (filled !== 1) throw new Error(`expected 1 scored category, got ${filled}`);
    });

    await step(`[${tag}] pause → settings (reduced motion) → resume`, async () => {
      await page.click('#btn-pause');
      await page.waitForSelector('.overlay[aria-label="Paused"]');
      await page.screenshot({ path: SHOT('pause', tag) });
      await page.locator('.overlay .menu-list button', { hasText: 'Settings' }).click();
      await page.waitForSelector('.overlay[aria-label="Settings"]');
      await page.locator('.overlay label', { hasText: 'Reduced motion' }).locator('input').click();
      const rm = await page.evaluate(() => window.__fivedice.platform.settings.reducedMotion);
      if (rm !== true) throw new Error('reduced motion setting did not apply');
      await page.screenshot({ path: SHOT('settings', tag) });
      await page.locator('.overlay .overlay-close').click();
      // Settings replaced the pause overlay; the session is still paused.
      await page.click('#btn-pause');
      await page.waitForFunction(() => window.__fivedice.session.machine === 'active', null, { timeout: 10000 });
    });

    await step(`[${tag}] play the full table to results`, async () => {
      for (let turn = 2; ; turn++) {
        await waitHumanTurn();
        const status = await page.evaluate(() => window.__fivedice.session.state.status);
        if (status !== 'active') break;
        if (turn > 30) throw new Error('table did not finish within 30 human turns');
        await playHumanTurn(turn);
      }
      await page.waitForSelector('.overlay[aria-label="Results"]', { timeout: 30000 });
      const text = await page.textContent('.overlay[aria-label="Results"]');
      if (!/points/.test(text)) throw new Error('results missing score breakdown');
      const rows = await page.locator('.overlay[aria-label="Results"] .results-table tr').count();
      if (rows < 3) throw new Error(`expected rankings rows, got ${rows}`);
      console.log('  result:', text.match(/= (\d+) points/)?.[0] || '(scored)');
      await page.screenshot({ path: SHOT('results', tag) });
    });

    await step(`[${tag}] progression persisted + back to title`, async () => {
      const games = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('fivedice:progress') || '{}')?.totals?.games ?? 0);
      if (games < 1) throw new Error('progress not persisted');
      await page.locator('.overlay .menu-list button', { hasText: 'Back to title' }).click();
      await page.waitForSelector('.overlay[aria-label="Five Dice"]', { timeout: 10000 });
      await page.screenshot({ path: SHOT('title-return', tag) });
    });

    checkErrors();
  } finally {
    await context.close();
  }
}

const { server, port } = await startServer();
const browser = await chromium.launch({
  executablePath: '/usr/bin/google-chrome',
  args: ['--no-sandbox', '--enable-unsafe-swiftshader'],
});
try {
  const base = `http://127.0.0.1:${port}`;
  console.log(`serving ${ROOT} on ${base}`);
  await playPass(browser, base, { tag: 'desktop', viewport: { width: 1280, height: 800 }, mobile: false });
  await playPass(browser, base, { tag: 'mobile', viewport: { width: 390, height: 844 }, mobile: true });
  console.log('\nE2E PASS — full Five Dice table completed on desktop and mobile, no unexpected page errors');
} finally {
  await browser.close();
  server.close();
}
