// Five Dice — graphics quality model: presets, per-category overrides, hardware-level
// detection, per-preset budgets and a cost summary. Pure (no three.js) so the settings panel, the
// renderer and the unit tests agree on what a setting means.

export const PRESETS = ['low', 'balanced', 'high', 'ultra'];

// Category → allowed tiers, cheapest first.
export const CATEGORIES = {
  shadows: ['off', 'low', 'medium', 'high'],
  ao: ['off', 'on', 'high'],
  bloom: ['off', 'on'],
  grade: ['off', 'on'],
  antialias: ['off', 'fxaa', 'smaa', 'msaa'],
  reflections: ['off', 'on'],
  particles: ['off', 'low', 'high'],
  detail: ['plain', 'detailed'],
};

// Each preset: a row of tiers, a render scale (multiplies the capped device
// pixel ratio) and the device-pixel-ratio cap.
const TABLE = {
  low: { scale: 0.85, maxRatio: 1, shadows: 'off', ao: 'off', bloom: 'off', grade: 'off', antialias: 'off', reflections: 'off', particles: 'low', detail: 'plain' },
  balanced: { scale: 1, maxRatio: 1.5, shadows: 'low', ao: 'off', bloom: 'on', grade: 'on', antialias: 'fxaa', reflections: 'on', particles: 'low', detail: 'detailed' },
  high: { scale: 1, maxRatio: 2, shadows: 'medium', ao: 'on', bloom: 'on', grade: 'on', antialias: 'smaa', reflections: 'on', particles: 'high', detail: 'detailed' },
  ultra: { scale: 1.25, maxRatio: 2, shadows: 'high', ao: 'high', bloom: 'on', grade: 'on', antialias: 'msaa', reflections: 'on', particles: 'high', detail: 'detailed' },
};

export const SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
export const PARTICLES = { off: 0, low: 70, high: 320 };

// StarHermit hardware level (0–20, js/gpu-level.js → window.StarHermitGpu) at which Auto starts
// choosing each preset. 0 = Galaxy S20 / Intel UHD or weaker, 20 = RTX 5090; phones, tablets and
// ≤ 4 GB machines are capped at level 9 (Balanced); software renderers are level 0 (Low).
export const LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };

/*
 * Per-preset asset and effect budgets, each tuned to hold 60 FPS on the weakest GPU Auto gives the
 * preset (Low: level 0 phones / Intel UHD; Balanced: level 4 Iris Xe; High: level 10 GTX 1070;
 * Ultra: level 17 RTX 4080; measured with tests/gfx-bench.mjs). Gameplay is identical on every preset.
 *   material  room and table surfaces: 'lambert' (Low) | 'standard'; detailed dice are clearcoated
 *             MeshPhysicalMaterial only where this is 'physical', else MeshStandardMaterial
 *   texture   procedural felt / wood / log / floor / stone texture size in px
 *   pips      die-face (pip colour and bump) texture size in px
 *   bevel     rounded-die bevel segments (Table detail: detailed)
 *   segments  round-geometry LOD: multiplies the radial segments of the felt, rim, inlay, pedestal,
 *             floor and held markers
 *   stars     stars in the window
 *   embers    multiplies the Embers tier count (low 70 / high 320), then scaled by the hardware level
 *             within the preset (≤ 2×)
 *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame
 */
export const BUDGETS = {
  low: { material: 'lambert', texture: 128, pips: 64, bevel: 2, segments: 0.5, stars: 40, embers: 0.6, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: 'standard', texture: 256, pips: 128, bevel: 3, segments: 0.75, stars: 60, embers: 1, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: 'physical', texture: 256, pips: 256, bevel: 4, segments: 1, stars: 90, embers: 1, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: 'physical', texture: 512, pips: 512, bevel: 6, segments: 1.5, stars: 140, embers: 1.5, bloomRes: 1, aoRes: 1 },
};

const gpuApi = () => globalThis.StarHermitGpu;

/** Hardware level 0–20 for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
export function detectLevel(gpu, system = {}) {
  const G = gpuApi();
  if (!G) return LEVELS.balanced;
  return G.detectLevel({ webgl: true, webgl2: true, ...system, gpu: String(gpu || '') });
}

/** Auto preset for a hardware level: Low 0, Balanced 4, High 10, Ultra 17. */
export function presetForLevel(level) {
  const G = gpuApi();
  if (G) return G.presetForLevel(level, LEVELS);
  return PRESETS.filter((p) => LEVELS[p] <= level).pop() || 'low';
}

/** Best preset for this GPU; phones and tablets are capped at Balanced by the hardware level. */
export function detectPreset(gpu, system = {}) {
  return presetForLevel(detectLevel(gpu, system));
}

/** A preset's concrete budget for a hardware level (embers scale within the preset, ≤ 2×). */
export function budget(preset, level) {
  const b = { ...(BUDGETS[preset] || BUDGETS.balanced) };
  const G = gpuApi(), floor = LEVELS[preset] ?? 0;
  const k = G ? Math.min(2, G.scaleBudget(1, Number.isFinite(level) ? level : floor, floor)) : 1;
  b.embers = Math.round(b.embers * k * 100) / 100;
  return b;
}

/** Ember count for an Embers tier under a budget. */
export function emberCount(tier, b) {
  return Math.round((PARTICLES[tier] || 0) * (b ? b.embers : 1));
}

/**
 * Resolve saved settings into concrete tiers.
 * `saved`: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: tier }.
 */
export function resolve(saved, detected, level) {
  const s = saved || {};
  const preset = PRESETS.includes(s.preset) ? s.preset : (PRESETS.includes(detected) ? detected : 'balanced');
  const row = TABLE[preset];
  const out = {
    preset,
    auto: !PRESETS.includes(s.preset),
    renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2),
    maxRatio: row.maxRatio,
  };
  out.scale = row.scale * out.renderScale;
  for (const [cat, tiers] of Object.entries(CATEGORIES)) {
    out[cat] = tiers.includes(s[cat]) ? s[cat] : row[cat];
  }
  out.level = Number.isFinite(level) ? level : LEVELS[preset];
  out.budget = budget(preset, out.level);
  out.adaptive = s.adaptive !== false;
  out.showFps = !!s.show_fps;
  // The composer only runs when an effect needs it (MSAA uses a multisampled
  // composer target, so the canvas itself never needs an antialiased context).
  out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' || out.antialias !== 'off';
  return out;
}

/** The preset's own tier for a category (for "From preset (…)" labels). */
export function presetTier(preset, cat) {
  return TABLE[preset]?.[cat];
}

/** Choosing a preset clears every per-category override; scale/adaptive/fps stay. */
export function choosePreset(saved, preset) {
  const s = { ...(saved || {}) };
  for (const cat of Object.keys(CATEGORIES)) delete s[cat];
  s.preset = PRESETS.includes(preset) ? preset : 'auto';
  return s;
}

const EN_WORDS = {
  noShadows: 'no shadows', shadows: 'shadows', ao: 'ambient occlusion', aoHigh: 'full ambient occlusion',
  bloom: 'bloom', noAA: 'no anti-aliasing', reflections: 'reflections', particles: 'embers',
};

/** Short cost summary. `words` lets the UI pass localized fragments. */
export function describe(r, pixels, words = EN_WORDS) {
  const w = { ...EN_WORDS, ...words };
  const parts = [
    r.shadows === 'off' ? w.noShadows : `${SHADOW_MAP[r.shadows]}² ${w.shadows}`,
    r.ao === 'off' ? null : r.ao === 'high' ? w.aoHigh : w.ao,
    r.bloom === 'on' ? w.bloom : null,
    r.reflections === 'on' ? w.reflections : null,
    r.particles === 'off' ? null : `${emberCount(r.particles, r.budget)} ${w.particles}`,
    r.antialias === 'off' ? w.noAA : r.antialias.toUpperCase(),
    pixels ? `${pixels[0]}×${pixels[1]} px` : null,
  ];
  return parts.filter(Boolean).join(' · ');
}

function clamp(v, a, b) {
  return Math.min(b, Math.max(a, v));
}
