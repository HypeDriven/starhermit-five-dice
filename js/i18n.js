// Five Dice — localization (an ES module, shared by the engine client and the
// node tests).
//
// Nine locales: en-US, en-GB, es-419, es-ES, de-DE, fr-FR, fr-CA, pt-BR, it-IT.
// English source strings are the keys; js/strings.js holds the tables (en-GB,
// es-ES and fr-CA carry only their differences from en-US, es-419 and
// fr-FR). The engine client picks the locale from the runtime's interface
// language (native/i18n.ts → setLocale).

import { FD_STRINGS } from './strings.js';

export const LOCALES = ['en-US', 'en-GB', 'es-419', 'es-ES', 'de-DE', 'fr-FR', 'fr-CA', 'pt-BR', 'it-IT'];
const PARENT = { 'en-GB': 'en-US', 'es-ES': 'es-419', 'fr-CA': 'fr-FR' };
const hasOwn = Object.prototype.hasOwnProperty;
let lang = 'en-US';

function lookup(key) {
  for (let l = lang; l; l = PARENT[l]) {
    const t = FD_STRINGS[l];
    if (t && hasOwn.call(t, key)) return t[key];
  }
  return key;
}

/** Translate an English source string; {name} placeholders filled from vars. */
export function T(key, vars) {
  let s = lookup(String(key));
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (hasOwn.call(vars, k) ? String(vars[k]) : m));
  return s;
}

/** Switch the locale (unknown tags fall back to en-US). */
export function setLocale(next) { lang = LOCALES.includes(next) ? next : 'en-US'; }
/** The current locale. */
export function getLocale() { return lang; }
