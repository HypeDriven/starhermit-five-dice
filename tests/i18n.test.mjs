// Localization coverage: every English key the markup and code use (T('…'),
// N('…'), hint keys, and the content/rules/achievement names shown through
// T(variable)) is translated in every locale (en-GB → en-US, es-ES → es-419,
// fr-CA → fr-FR inherit), placeholders survive, and the language follows
// sh-language.js and switches live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadTables, codeKeys, htmlKeys, audit, bootI18n, LOCALES } from './i18n-common.mjs';
import { CATEGORIES } from '../js/rules.js';
import { THEMES, LESSONS, PRACTICE_DIFFICULTIES, TRAILS, STAGE_NAMES, CHALLENGES } from '../js/content.js';
import { ACHIEVEMENTS } from '../js/platform.js';
import { gfxStrings, GFX_LOCALES } from '../js/gfx-i18n.js';
import { platformStrings } from '../js/platform-i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

// Overlay kinds double as their localized aria-label ('Five Dice' is the name).
const KINDS = ['Confirm', 'Practice setup', 'Learn', 'Journey', 'Challenges', 'Help & Rules', 'Settings', 'Profile & Scores', 'Paused', 'Results'];
// Generic seat names passed through playerName().
const SEATS = ['You', 'Lodge Guide', 'Guest'];

function usedKeys() {
  const keys = new Set([...htmlKeys(read('index.html')), ...KINDS, ...SEATS]);
  for (const f of readdirSync(new URL('js/', ROOT)).filter((n) => n.endsWith('.js') && !/strings|i18n/.test(n))) {
    const src = read('js/' + f);
    codeKeys(src).forEach((k) => keys.add(k));
    for (const m of src.matchAll(/reasonKey: '([^']+)'/g)) keys.add(m[1]);
  }
  for (const c of CATEGORIES) { keys.add(c.name); keys.add(c.desc); }
  for (const t of THEMES) keys.add(t.name);
  for (const l of LESSONS) { keys.add(l.name); for (const s of l.tutorial.steps) keys.add(s.text); }
  for (const d of Object.values(PRACTICE_DIFFICULTIES)) { keys.add(d.name); keys.add(d.blurb); }
  for (const t of TRAILS) keys.add(t.name);
  STAGE_NAMES.slice(0, 7).forEach((n) => keys.add(n));
  for (const c of CHALLENGES) { keys.add(c.name); keys.add(c.blurb); }
  for (const a of ACHIEVEMENTS) { keys.add(a.name); keys.add(a.desc); }
  return [...keys].filter((k) => /[A-Za-z]/.test(k)).sort();
}

const tables = () => loadTables(ROOT, 'js/strings.js', 'FD_STRINGS');

test('every used key is translated in every locale; placeholders intact', () => {
  assert.deepEqual(audit(tables(), usedKeys()), []);
});

test('the locale follows sh-language and switches live', () => {
  const { I18N, events, doc } = bootI18n(ROOT, { strings: 'js/strings.js', i18n: 'js/i18n.js', global: 'FDI18N', languages: ['de-DE'] });
  assert.equal(I18N.lang, 'de-DE');
  assert.equal(doc.documentElement.lang, 'de-DE');
  assert.equal(I18N.T('Leave table'), 'Tisch verlassen');
  I18N.language.setChoice('fr-CA');
  assert.equal(I18N.lang, 'fr-CA');
  assert.equal(events.at(-1), 'fr-CA');
  assert.equal(I18N.T('Leave table'), 'Quitter la table');
  I18N.language.setChoice('es-ES');
  assert.equal(I18N.T('Roll ({n})', { n: 2 }), 'Tirar (2)');
  I18N.language.setChoice('en-GB');
  assert.equal(I18N.T('Color-vision palette'), 'Colour-vision palette');
});

test('graphics and platform strings cover all nine locales', () => {
  for (const l of LOCALES) {
    assert.ok(GFX_LOCALES.includes(l), l);
    for (const [k, v] of Object.entries(platformStrings('en-US'))) assert.ok(platformStrings(l)[k], `${l} ${k}`);
    assert.ok(gfxStrings(l)('title'));
  }
});
