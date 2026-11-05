// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, die-face textures, bevels, round-geometry LOD,
// window stars, reflections, embers, the detailed room) is the browser
// build's four presets and budgets (js/gfx.js TABLE / BUDGETS) keyed by the
// level's quality tier, with the embers scaled within the tier by the
// level's particle budget against the tier's anchor level (quantum,
// molecular, terrestrial, galactic), at most 2×. The runtime owns the rest
// of what the old Graphics panel did: Auto and the level choice, render
// scale and the pixel-ratio cap, adaptive resolution and the frame-rate
// limit and readout. The per-category overrides of the old panel are not
// offered (the runtime's Options choose a level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Room and table surfaces: Lambert, standard PBR; detailed dice clear-coated where "physical". */
  material: "lambert" | "standard" | "physical";
  /** Die-face texture size (px, within the level's largest texture), rounded-die bevel segments, round-geometry LOD, window stars. */
  pips: number;
  bevel: number;
  segments: number;
  stars: number;
}
export interface Look {
  preset: Preset;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
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

const ART: Record<Preset, Pick<Look, "reflections" | "detailed"> & { particles: "low" | "high" }> = {
  low: { reflections: false, particles: "low", detailed: false },
  balanced: { reflections: true, particles: "low", detailed: true },
  high: { reflections: true, particles: "high", detailed: true },
  ultra: { reflections: true, particles: "high", detailed: true },
};
const BUDGETS: Record<Preset, Budget & { embers: number }> = {
  low: { material: "lambert", pips: 64, bevel: 2, segments: 0.5, stars: 40, embers: 0.6 },
  balanced: { material: "standard", pips: 128, bevel: 3, segments: 0.75, stars: 60, embers: 1 },
  high: { material: "physical", pips: 256, bevel: 4, segments: 1, stars: 90, embers: 1 },
  ultra: { material: "physical", pips: 512, bevel: 6, segments: 1.5, stars: 140, embers: 1.5 },
};
/** js/gfx.js PARTICLES: embers per tier before the budget's factor. */
const PARTICLES = { low: 70, high: 320 };
/** The most embers ever drawn (ultra's high tier at 2×). */
export const EMBER_MAX = Math.round(PARTICLES.high * 1.5 * 2);
export const STAR_MAX = 140;
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const { particles, ...art } = ART[preset];
  const { embers: ek, ...b } = BUDGETS[preset];
  // Embers grow with the level's particle budget above the tier's anchor, at most 2×.
  const k = Math.min(2, s.particles / levelSettings(ANCHOR[preset]).particles);
  return {
    preset, ...art,
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    embers: Math.min(EMBER_MAX, Math.round(PARTICLES[particles] * ek * k)),
    budget: { ...b, pips: Math.min(b.pips, s.maxTextureSize) },
  };
}
