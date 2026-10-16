// Five Dice — translation helpers for ES modules. The tables and the language
// choice live in js/i18n.js (window.FDI18N); outside the browser (unit tests)
// T() returns the English key with {placeholders} filled.

const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (vars && k in vars ? String(vars[k]) : m));

/** Translate an English source string. */
export function T(key, vars) {
  const I = globalThis.FDI18N;
  return I ? I.T(key, vars) : fill(key, vars);
}

/** The effective game locale (en-US outside the browser). */
export function lang() {
  return globalThis.FDI18N?.lang || 'en-US';
}

/** Seat names that are generic labels rather than proper names. */
export function playerName(name) {
  const n = String(name ?? '');
  if (n === 'You' || n === 'Lodge Guide' || n === 'Guest') return T(n);
  const m = /^Player (\d+)$/.exec(n);
  return m ? T('Player {n}', { n: m[1] }) : n;
}

/** Marks an English source string translated later with T() (keeps it visible to the i18n test). */
export const N = (key) => key;
