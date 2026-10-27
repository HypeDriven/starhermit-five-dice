// Five Dice — translation helpers for the shared modules and the engine
// client: T() over js/i18n.js, the generic seat names, N() for deferred keys.
import { T as translate, getLocale } from './i18n.js';

/** Translate an English source string. */
export function T(key, vars) { return translate(key, vars); }

/** The effective game locale. */
export function lang() { return getLocale(); }

/** Seat names that are generic labels rather than proper names. */
export function playerName(name) {
  const n = String(name ?? '');
  if (n === 'You' || n === 'Lodge Guide' || n === 'Guest') return T(n);
  const m = /^Player (\d+)$/.exec(n);
  return m ? T('Player {n}', { n: m[1] }) : n;
}

/** Marks an English source string translated later with T() (keeps it visible to the i18n test). */
export const N = (key) => key;
