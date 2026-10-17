// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics
// from the title menu, starts Practice → Ember and keeps playing through the visible Roll button and
// scorecard rows, so the dice tumble while the fire, embers and stars animate.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  const menu = (text) => page.locator('.overlay .menu-list button', { hasText: text });
  await menu('Settings').click();
  await page.waitForSelector('.overlay[aria-label="Settings"] #gfx-section');
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.locator('.overlay .overlay-close').click();
}

export async function start(page, { mobile } = {}) {
  const menu = (text) => page.locator('.overlay .menu-list button', { hasText: text });
  await menu('Practice').click();
  await page.waitForSelector('.overlay[aria-label="Practice setup"]');
  await menu('Ember').click();
  await page.waitForSelector('#action-tray:not([hidden])', { timeout: 15000 });
  let stopped = false;
  page.once('close', () => { stopped = true; });
  (async () => {
    while (!stopped) {
      try {
        if (await page.locator('.overlay .menu-list button', { hasText: 'Play again' }).count()) {
          await page.locator('.overlay .menu-list button', { hasText: 'Play again' }).first().click();
        } else if (await page.locator('#action-tray #btn-roll:enabled').count()) {
          await page.click('#action-tray #btn-roll');
        } else if (await page.locator('#rail-left button.cat.legal').count()) {
          if (mobile) await page.click('#drawer-left-toggle');
          await page.locator('#rail-left button.cat.legal').first().click({ timeout: 2000 });
          if (mobile && await page.evaluate(() => document.body.classList.contains('drawer-left-open'))) await page.click('#drawer-left-toggle');
        }
      } catch { /* screen changing */ }
      await new Promise((r) => setTimeout(r, 700));
    }
  })();
  await page.waitForTimeout(500);
}
