// Localization coverage: every English key the engine client and the shared
// modules use (T('…'), N('…'), hint keys, and the content/rules/achievement
// names shown through T(variable)) is translated in every locale (en-GB →
// en-US, es-ES → es-419, fr-CA → fr-FR inherit), placeholders survive, no
// table carries rows nothing uses, and the locale switches live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { codeKeys, audit, LOCALES } from './i18n-common.mjs';
import { CATEGORIES } from '../js/rules.js';
import { THEMES, LESSONS, PRACTICE_DIFFICULTIES, TRAILS, STAGE_NAMES, CHALLENGES } from '../js/content.js';
import { ACHIEVEMENTS } from '../js/progress.js';
import { FD_STRINGS } from '../js/strings.js';
import { T, setLocale, LOCALES as SHIPPED } from '../js/i18n.js';

const ROOT = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');
// Generic seat names passed through playerName().
const SEATS = ['You', 'Lodge Guide', 'Guest'];

export function usedKeys() {
  const keys = new Set(SEATS);
  const files = [
    ...readdirSync(new URL('js/', ROOT)).filter((n) => n.endsWith('.js') && !/strings|i18n/.test(n)).map((n) => 'js/' + n),
    ...readdirSync(new URL('native/', ROOT)).filter((n) => n.endsWith('.ts')).map((n) => 'native/' + n),
  ];
  for (const f of files) {
    const src = read(f);
    codeKeys(src).forEach((k) => keys.add(k));
    for (const m of src.matchAll(/reasonKey: '([^']+)'/g)) keys.add(m[1]);
  }
  // native/audio.ts captions: English keys the UI translates.
  for (const m of read('native/audio.ts').matchAll(/caption\("([^"]+)"/g)) keys.add(m[1]);
  for (const m of read('native/audio.ts').matchAll(/caption\(\w[^?]*\? "([^"]+)" : "([^"]+)"/g)) { keys.add(m[1]); keys.add(m[2]); }
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

test('every used key is translated in every locale; placeholders intact; no stale rows', () => {
  assert.deepEqual(audit(FD_STRINGS, usedKeys()), []);
});

test('the locale switches live and regional tables inherit', () => {
  assert.deepEqual(SHIPPED, LOCALES);
  setLocale('de-DE');
  assert.equal(T('Leave table'), 'Tisch verlassen');
  setLocale('fr-CA');
  assert.equal(T('Leave table'), 'Quitter la table');
  assert.equal(T('Score posted to the leaderboard.'), 'Pointage publié au classement.');
  setLocale('es-ES');
  assert.equal(T('Roll ({n})', { n: 2 }), 'Tirar (2)');
  setLocale('en-GB');
  assert.equal(T('Color-vision palette'), 'Colour-vision palette');
  setLocale('xx');
  assert.equal(T('Leave table'), 'Leave table');
  setLocale('en-US');
});
