// Bakes the browser build's procedural canvas textures (js/render.js before
// the engine port: feltTexture, woodTexture, stoneTexture, glowTexture,
// flameTexture, trayTexture and the pips' bump maps) into assets/textures/*.png,
// by running that canvas code unchanged in Chrome (~/games/tools/gpu-chrome.mjs).
// The felt's per-pixel noise and the thousands of grain strokes paint far too
// slowly on the engine's canvas at start-up, so the engine client loads these
// images instead (native/render.ts). The room maps are near-white detail maps
// that multiply the theme's colours, baked at Ultra's 512 px (the runtime holds
// textures to the graphics level's size). Run once; commit the PNGs.
//   node tools/bake-textures.mjs
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function findPlaywright() {
  const roots = [root, resolve(root, '..'), ...readdirSync(resolve(root, '..')).map((d) => resolve(root, '..', d))];
  for (const r of roots) {
    const p = join(r, 'node_modules', 'playwright-core');
    if (existsSync(p)) return createRequire(join(r, 'package.json'))('playwright-core');
  }
  throw new Error('playwright-core not found');
}
const { chromium } = findPlaywright();
const rules = readFileSync(join(root, 'js/rules.js'), 'utf8');

// The old js/render.js texture painters, verbatim but returning canvases.
const painters = String.raw`
function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = size[0]; c.height = size[1];
  draw(c.getContext('2d'), c.width, c.height);
  return c;
}
function feltTexture(n = 256) {
  const r = createStream('decor:tex:felt');
  return canvasTex([n, n], (g, w, h) => {
    const k = w / 256;
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 228 + r.next() * 27;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.08;
    g.strokeStyle = '#000';
    g.lineWidth = k;
    for (let i = 0; i < Math.round(500 * k * k); i++) {
      const x = r.next() * w, y = r.next() * h, a = r.next() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 5 * k, y + Math.sin(a) * 5 * k); g.stroke();
    }
  });
}
function woodTexture(seed = 'wood', planks = 1, n = 256) {
  const r = createStream('decor:tex:' + seed);
  return canvasTex([n, n], (g, w, h) => {
    const k = w / 256;
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    const ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const shade = 225 + r.next() * 30;
      g.fillStyle = 'rgb(' + shade + ',' + shade + ',' + shade + ')';
      g.fillRect(0, p * ph, w, ph);
      for (let i = 0; i < 26; i++) {
        const y0 = p * ph + r.next() * ph, amp = (1 + r.next() * 3) * k, f = (0.01 + r.next() * 0.03) / k;
        g.strokeStyle = 'rgba(60,40,20,' + (0.08 + r.next() * 0.14) + ')';
        g.lineWidth = (0.6 + r.next() * 1.4) * k;
        g.beginPath();
        for (let x = 0; x <= w; x += 8 * k) g.lineTo(x, y0 + Math.sin(x * f + i) * amp);
        g.stroke();
      }
      if (planks > 1) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, p * ph, w, 2 * k); }
    }
  });
}
function stoneTexture(n = 256) {
  const r = createStream('decor:tex:stone');
  return canvasTex([n, n], (g, w, h) => {
    const k = w / 256;
    g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, w, h);
    const rows = 6, rh = h / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r.next() * 40 * k;
      while (x < w) {
        const sw = (34 + r.next() * 40) * k;
        const v = 175 + r.next() * 70;
        g.fillStyle = 'rgb(' + v + ',' + (v - 4) + ',' + (v - 10) + ')';
        g.beginPath();
        g.roundRect(x + 3 * k, row * rh + 3 * k, sw - 6 * k, rh - 6 * k, 9 * k);
        g.fill();
        x += sw;
      }
    }
  });
}
function glowTexture(inner = 'rgba(255,255,255,1)') {
  return canvasTex([64, 64], (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
}
function flameTexture() {
  const r = createStream('decor:tex:flame');
  return canvasTex([128, 128], (g, w, h) => {
    const base = g.createRadialGradient(w / 2, h, 4, w / 2, h * 0.9, h * 0.75);
    base.addColorStop(0, 'rgba(255,240,200,1)');
    base.addColorStop(0.4, 'rgba(255,170,70,0.85)');
    base.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) {
      const x = w * (0.2 + r.next() * 0.6), top = h * (0.15 + r.next() * 0.35), bw = 10 + r.next() * 12;
      const grd = g.createLinearGradient(0, h, 0, top);
      grd.addColorStop(0, 'rgba(255,220,150,0.9)');
      grd.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - bw, h); g.quadraticCurveTo(x - bw * 0.3, h * 0.6, x, top);
      g.quadraticCurveTo(x + bw * 0.3, h * 0.6, x + bw, h); g.fill();
    }
  });
}
function trayTexture() {
  return canvasTex([256, 64], (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 26); g.fill();
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 24); g.stroke();
  });
}
const PIP_LAYOUTS = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]], 5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
// makePipTexture(face, bump = true): the recessed pips' bump map (theme-independent).
function pipBump(faceValue, n = 256) {
  return canvasTex([n, n], (g) => {
    g.scale(n / 128, n / 128);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 128, 128);
    const r = faceValue === 1 ? 15 : 11;
    for (const [px, py] of PIP_LAYOUTS[faceValue]) {
      const x = 64 + px * 32, y = 64 + py * 32;
      const grd = g.createRadialGradient(x, y, r * 0.2, x, y, r + 2);
      grd.addColorStop(0, '#000'); grd.addColorStop(0.8, '#222'); grd.addColorStop(1, '#fff');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r + 2, 0, Math.PI * 2); g.fill();
    }
  });
}
const out = {
  felt: feltTexture(512), wood: woodTexture('wood', 1, 512), logs: woodTexture('logs', 7, 512),
  floor: woodTexture('floor', 5, 512), stone: stoneTexture(512), glow: glowTexture(), flame: flameTexture(), tray: trayTexture(),
};
for (let f = 1; f <= 6; f++) out['pip-bump-' + f] = pipBump(f);
window.__baked = Object.fromEntries(Object.entries(out).map(([k, c]) => [k, c.toDataURL('image/png')]));
`;

const { launchChrome } = await import('/home/albert/games/tools/gpu-chrome.mjs');
const { browser, close } = await launchChrome(chromium);
const page = await (await browser.newContext()).newPage();
await page.setContent('<!doctype html><body></body>');
await page.addScriptTag({ type: 'module', content: rules + '\n' + painters });
await page.waitForFunction(() => !!window.__baked, null, { timeout: 60000 });
const baked = await page.evaluate(() => window.__baked);
await close();
const dir = join(root, 'assets/textures');
mkdirSync(dir, { recursive: true });
for (const [name, url] of Object.entries(baked)) {
  writeFileSync(join(dir, `${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(`assets/textures/${name}.png`);
}
