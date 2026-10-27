// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the embers scaled within the tier by the level (frame().levelIndex),
// as the browser build scaled them by its hardware level (at most 2×). The
// runtime owns the rest of what the old Graphics panel did: Auto and the
// level choice, render scale and the pixel-ratio cap, adaptive resolution,
// the frame-rate limit and readout, and the shadow-map size and MSAA
// samples it holds to the level. The per-category overrides of the old
// panel are not offered (the runtime's Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Room and table surfaces: Lambert, standard PBR; detailed dice clear-coated where "physical". */
  material: "lambert" | "standard" | "physical";
  /** Die-face texture size (px), rounded-die bevel segments, round-geometry LOD, window stars. */
  pips: number;
  bevel: number;
  segments: number;
  stars: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: Preset;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based lighting from the room environment. */
  reflections: boolean;
  /** Fireplace embers drawn. */
  embers: number;
  /** Rounded clear-coated dice with recessed pips, textured felt, wood grain, log wall, stone
   * fireplace, window frame, moon and ridge, brass inlay. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget" | "embers"> & { particles: "low" | "high" }> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "off", reflections: false, particles: "low", detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particles: "low", detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particles: "high", detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<Preset, Budget & { embers: number }> = {
  low: { material: "lambert", pips: 64, bevel: 2, segments: 0.5, stars: 40, embers: 0.6, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", pips: 128, bevel: 3, segments: 0.75, stars: 60, embers: 1, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", pips: 256, bevel: 4, segments: 1, stars: 90, embers: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", pips: 512, bevel: 6, segments: 1.5, stars: 140, embers: 1.5, bloomRes: 1, aoRes: 1 },
};
/** js/gfx.js PARTICLES: embers per tier before the budget's factor. */
const PARTICLES = { low: 70, high: 320 };
/** The most embers ever drawn (ultra's high tier at 2×). */
export const EMBER_MAX = Math.round(PARTICLES.high * 1.5 * 2);
export const STAR_MAX = 140;
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const row = TABLE[preset];
  const { embers: ek, ...budget } = BUDGETS[preset];
  // Levels are about 1.64× apart in GPU throughput: embers grow with the level above the tier's first, at most 2×.
  const k = Math.min(2, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  const { particles, ...rest } = row;
  return { preset, ...rest, embers: Math.min(EMBER_MAX, Math.round(PARTICLES[particles] * ek * k)), budget };
}
