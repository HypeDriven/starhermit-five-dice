// Plays the web package in Chrome on the machine's GPU (~/games/tools/
// gpu-chrome.mjs; GPU_ADAPTER=software for headless SwiftShader), the loader
// index.html that `npm run package` writes, at a desktop viewport, a phone
// (DPR 3) and a phone held sideways: a Practice table against Pip from the
// title, a roll, a hold, and a category scored on the card — by keys and
// clicks on the desktop, by taps on the phones (the Card drawer) — then Escape
// to the pause menu. Fails on console errors or warnings or the runtime's
// error screen.
//   node tools/browser-play.mjs [GAME_DIR] [--shots OUT_DIR]
// Serves GAME_DIR on loopback (never tests/, tools/ or dot-names), the engine
// itself from wiki.starhermit.com as the loader pins it. playwright-core is
// resolved from GAME_DIR's node_modules or any sibling game's.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const dir = resolve(args[0] ?? '.');
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const shots = opt('--shots', null);

function findPlaywright() {
  const roots = [dir, resolve(dir, '..'), ...readdirSync(resolve(dir, '..')).map((d) => resolve(dir, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '') || 'index.html';
  // The platform's clock (platform.serverTime / serverNow), as the game host answers it.
  if (path === 'api/v1/time') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ serverTime: Date.now(), serverTimeIso: new Date().toISOString() })); return; }
  const parts = path.split('/');
  if (parts.some((p) => p.startsWith('.') || p === '..') || ['tests', 'tools', 'node_modules'].includes(parts[0])) { res.writeHead(404).end(); return; }
  const file = join(dir, path);
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, gpu, close } = await launchChrome(chromium);
console.log(`# chrome on ${gpu}`);
let failed = false;
// Positions (fractions of the viewport) read off the views' screenshots: Open Snow on the desktop's card rail;
// on the phones Practice, a difficulty, Roll, the first die, the Card drawer button and a category in the drawer.
const DESKTOP_CAT = [60 / 1366, 643 / 768];
const PHONE = [[0.5, 0.23], [0.5, 0.45], [0.25, 0.95], [0.2, 0.78], [0.08, 0.13], [0.2, 0.819]];
const LANDSCAPE = [[0.5, 0.3], [0.5, 0.5], [0.08, 0.92], [0.97, 0.36], [0.05, 0.23], [0.1, 0.45]];
// Desktop: Enter opens Practice (focused first on the title), Enter starts Ember; R rolls, 1 holds, a click scores.
const desktop = [['shot', 'title'], ['key', 'Enter'], ['wait', 1500], ['shot', 'practice'], ['key', 'Enter'], ['wait', 4000], ['shot', 'table'],
  ['key', 'KeyR'], ['wait', 1500], ['key', 'Digit1'], ['wait', 800], ['shot', 'held'], ['click', ...DESKTOP_CAT], ['wait', 1500], ['shot', 'scored'],
  ['key', 'Escape'], ['wait', 1500], ['shot', 'paused']];
// Phones: taps (fractions of the viewport) on Practice, Ember, Roll, a die, the Card drawer and a category.
const phone = (practice, ember, roll, die, card, cat) => [['shot', 'title'], ['tap', ...practice], ['wait', 1500], ['shot', 'practice'], ['tap', ...ember], ['wait', 4000], ['shot', 'table'],
  ['tap', ...roll], ['wait', 1500], ['tap', ...die], ['wait', 800], ['shot', 'held'], ['tap', ...card], ['wait', 1200], ['shot', 'card'], ['tap', ...cat], ['wait', 1500], ['shot', 'scored'],
  ['key', 'Escape'], ['wait', 1500], ['shot', 'paused']];
const views = [
  { name: 'desktop', viewport: { width: 1366, height: 768 }, steps: desktop },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: phone(...PHONE) },
  { name: 'landscape', viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, steps: phone(...LANDSCAPE) },
];
for (const v of views) {
  const ctx = await browser.newContext({ viewport: v.viewport, isMobile: v.isMobile, hasTouch: v.hasTouch, deviceScaleFactor: v.deviceScaleFactor });
  const page = await ctx.newPage();
  const problems = [];
  const environment = /^No available adapters\.$|GL Driver Message/;
  page.on('console', (m) => {
    const platformRoute = /\/api\//.test(m.location()?.url ?? '');
    if ((m.type() === 'error' || m.type() === 'warning') && !environment.test(m.text()) && !platformRoute) problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\//.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
  await page.goto(url, { waitUntil: 'load', timeout: 120000 });
  const started = await page.waitForFunction(() => ['running', 'error'].includes(document.documentElement.dataset.starhermit), null, { timeout: 90000 }).then(() => true, () => false);
  await page.waitForTimeout(3000);
  await page.mouse.click(4, 4);
  await page.waitForTimeout(1500);
  for (const [op, a, b, ...rest] of v.steps) {
    if (op === 'key') { await page.keyboard.down(a); await page.waitForTimeout(120); await page.keyboard.up(a); }
    if (op === 'down') await page.keyboard.down(a);
    if (op === 'up') await page.keyboard.up(a);
    if (op === 'press') { await page.mouse.move(v.viewport.width * a, v.viewport.height * b); await page.mouse.down(); }
    if (op === 'lift') await page.mouse.up();
    if (op === 'click') await page.mouse.click(v.viewport.width * a, v.viewport.height * b);
    if (op === 'tap') await page.touchscreen.tap(v.viewport.width * a, v.viewport.height * b);
    if (op === 'drag') {
      const [x0, y0, x1, y1] = [a * v.viewport.width, b * v.viewport.height, rest[0] * v.viewport.width, rest[1] * v.viewport.height];
      await page.mouse.move(x0, y0); await page.mouse.down();
      for (let k = 1; k <= 8; k++) { await page.mouse.move(x0 + (x1 - x0) * k / 8, y0 + (y1 - y0) * k / 8); await page.waitForTimeout(40); }
      await page.mouse.up();
    }
    if (op === 'wait') { await page.waitForTimeout(a); continue; }
    if (op === 'shot' && shots) { mkdirSync(shots, { recursive: true }); await page.screenshot({ path: join(shots, `${v.name}-${a}.png`) }); }
    await page.waitForTimeout(2000);
  }
  const state = await page.evaluate(() => document.documentElement.dataset.starhermit ?? '');
  const ok = started && state === 'running' && problems.length === 0;
  failed ||= !ok;
  console.log(`${ok ? 'ok' : 'not ok'} - ${v.name} played: started=${started} state=${state || '-'}`);
  for (const p of problems) console.log(`  ${p}`);
  await ctx.close();
}
await close();
server.close();
process.exit(failed ? 1 : 0);
