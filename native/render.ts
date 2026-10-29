// The mountain-lodge dice table on starhermit:scene, as the browser build's
// js/render.js drew it: the felt table with its wooden rim, brass inlay and
// pedestal on a log-walled floor, the night window (stars; on detailed looks
// the moon's glow, a mountain ridge and the timber frame), the fireplace (a
// flickering flame card and fire light; on detailed looks the stone surround
// and mantel) with its drifting embers, the warm key light with shadows, the
// lamp and a hemisphere fill, the dashed held-dice tray, and the five dice:
// rolled with an authored tumble (arc, spin, settle in the deterministic end
// orientation), lifted onto the tray when held, ringed by a marker in the
// theme's select colour. The theme recolours all of it; the look per graphics
// level (native/quality.ts) picks plain or detailed dice and room, the
// material class, shadows, reflections, embers and the post chain. The camera
// has the old three presets (standard, low, overhead) with the 900 ms
// transition, pulled back on narrow stages until all five dice fit.
//
// Gaps and changes from three.js: light intensities are three.js's ÷ π (the
// engine's convention); the stage sits between the HUD's rails and bars as
// the old canvas did, reproduced with setViewOffset over the whole window
// (blade-orbit's pattern); the post chain is renderer.ao / bloom / grade /
// antialias (the grade the browser build's GradeShader in display space);
// the procedural felt, wood, log, floor, stone, flame, glow, tray and pip
// bump canvases are baked once (tools/bake-textures.mjs →
// assets/textures/*.png) since the engine's canvas paints them too slowly at
// start-up; only the theme-coloured pip faces are painted here; the Low
// look's Lambert twins are built with the scene; adaptive resolution, the
// frame-rate meter, the pixel-ratio cap and WebGL context loss are the
// runtime's.
import {
  ACESFilmicToneMapping, AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, CircleGeometry, Color,
  CylinderGeometry, DirectionalLight, Fog, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshLambertMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, PMREMGenerator, PointLight, Points, PointsMaterial,
  Quaternion, Raycaster, RepeatWrapping, RingGeometry, RoomEnvironment, RoundedBoxGeometry, SRGBColorSpace, Shape, ShapeGeometry,
  TextureLoader, TorusGeometry, Vector2, Vector3, renderer, scene, type Material, type Texture,
} from "starhermit:scene";
import { OffscreenCanvas } from "starhermit:canvas";
import { createStream, DICE_COUNT } from "../js/rules.js";
import { EMBER_MAX, STAR_MAX, type Look } from "./quality.ts";

const PI = Math.PI;
export interface Theme {
  id: string; felt: string; wood: string; wall: string; accent: string; die: string; pip: string;
  select: string; legal: string; danger: string; sky: string; text: string; page: string;
}

// Authored framing constants (js/render.js).
export const CAMERA_PRESETS: Record<string, { pos: [number, number, number]; look: [number, number, number]; fov: number }> = {
  standard: { pos: [0, 6.4, 7.6], look: [0, 0.35, -0.4], fov: 42 },
  low: { pos: [0, 4.2, 8.8], look: [0, 0.5, -0.6], fov: 46 },
  overhead: { pos: [0, 10.5, 1.6], look: [0, 0, -0.2], fov: 38 },
};
const DIE_SIZE = 0.72;
const DIE_SPREAD = 0.92;
const HELD_LIFT = 0.55;
const ROLL_MS = 620;
const FIRE_POS = new Vector3(4.6, 0.55, -7.2);
// Face assignment on the box (opposites sum to 7): material order +x,-x,+y,-y,+z,-z.
const FACE_TEXTURE: Record<number, number> = { 5: 0, 2: 1, 1: 2, 6: 3, 3: 4, 4: 5 };
const FACE_NORMAL: Record<number, Vector3> = {
  1: new Vector3(0, 1, 0), 6: new Vector3(0, -1, 0), 2: new Vector3(-1, 0, 0), 5: new Vector3(1, 0, 0),
  3: new Vector3(0, 0, 1), 4: new Vector3(0, 0, -1),
};
const PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]], 6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeInOutQuad = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const seg = (n: number, k: number): number => Math.max(6, Math.round(n * (k || 1)));

// -- renderer, camera and lights (js/render.js init / buildEnvironment) -----------------------
renderer.toneMapping = ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
const camera = new PerspectiveCamera(42, 1, 0.1, 60);
const keyLight = new DirectionalLight(0xffcf98, 1.7);
keyLight.position.set(2.6, 7.5, 3.4);
keyLight.target.position.set(0, 0, -0.3);
keyLight.shadow.bias = -0.0004;
// js/render.js fitted the shadow frustum to the table (TABLE_RADIUS 3.7).
Object.assign(keyLight.shadow.camera, { left: -3.7, right: 3.7, top: 3.7, bottom: -3.7, near: 4, far: 13 });
keyLight.shadow.camera.updateProjectionMatrix();
keyLight.shadow.normalBias = 0.02;
const lampLight = new PointLight(0xffb066, 7, 10, 2); // pooled warmth over the felt
lampLight.position.set(0.4, 4.2, 0.8);
const fireLight = new PointLight(0xff7733, 26, 16, 2);
fireLight.position.set(FIRE_POS.x - 0.3, FIRE_POS.y + 0.3, -6.2);
const fillLight = new HemisphereLight(0xbcd0e8, 0x2a2018, 0.5);
scene.add(keyLight, keyLight.target, lampLight, fireLight, fillLight);
const env = new Group();
scene.add(env);

let look: Look | null = null;
let theme: Theme | null = null;
let reducedMotion = false;
/** The stage (x, y, w, h) and the window (W, H), logical px. */
let view = { x: 0, y: 0, w: 800, h: 600, W: 800, H: 600 };

// -- surfaces ------------------------------------------------------------------------------------
const loader = new TextureLoader();
const textures = new Map<string, Texture | "loading">();
/** A baked texture (assets/textures/<name>.png), or null until it has loaded (the scene is rebuilt then). */
function baked(name: string, srgb = true): Texture | null {
  const t = textures.get(name);
  if (t && t !== "loading") return t;
  if (!t) {
    textures.set(name, "loading");
    loader.loadAsync(`assets/textures/${name}.png`).then((tex) => {
      if (srgb) tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 4;
      textures.set(name, tex);
      dirty = true;
    }, (e: unknown) => console.warn(`texture ${name}: ${String(e)}`));
  }
  return null;
}
function repeat(t: Texture | null, x: number, y: number): Texture | null {
  if (!t) return null;
  const c = t.clone();
  c.wrapS = c.wrapT = RepeatWrapping;
  c.repeat.set(x, y);
  return c;
}
let envTex: Texture | null = null;
function envMap(): Texture | null {
  if (!envTex) {
    try { envTex = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture; }
    catch (e) { console.warn(`environment: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return envTex;
}
interface LitParams { color: number | string | Color; map?: Texture | null; bumpMap?: Texture | null; bumpScale?: number; roughness?: number; metalness?: number; envMapIntensity?: number }
/** The room's lit surfaces: Lambert twins on Low (the same colour and map), MeshStandardMaterial above. */
function litMaterial(p: LitParams): Material {
  const base = { color: new Color(p.color as never), map: p.map ?? null };
  if (look?.budget.material === "lambert") return new MeshLambertMaterial(base);
  return new MeshStandardMaterial({
    ...base, bumpMap: p.bumpMap ?? null, bumpScale: p.bumpScale ?? 1, roughness: p.roughness ?? 1, metalness: p.metalness ?? 0,
    envMapIntensity: p.envMapIntensity ?? 1,
  });
}

// -- the dice (persistent; their materials and geometry follow the look) ---------------------------
interface Tween { start: number; dur: number; ease: (t: number) => number; apply: (t: number) => void; done?: () => void; camera?: boolean }
interface Die { group: Group; body: Mesh<Material[]>; marker: Mesh; home: Vector3; value: number }
const dice: Die[] = [];
for (let i = 0; i < DICE_COUNT; i++) {
  const group = new Group();
  const body = new Mesh(new BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE), [] as Material[]);
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);
  const marker = new Mesh(new RingGeometry(DIE_SIZE * 0.62, DIE_SIZE * 0.78, 32), new MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }));
  marker.rotation.x = -PI / 2;
  marker.position.y = -DIE_SIZE / 2 + 0.02;
  marker.visible = false;
  group.add(marker);
  const home = new Vector3((i - 2) * DIE_SPREAD, DIE_SIZE / 2, 0.4);
  group.position.copy(home);
  scene.add(group);
  dice.push({ group, body, marker, home, value: 0 });
}
let tweens: Tween[] = [];
let clockMs = 0;
const deco = createStream("decor:scene");
const raycaster = new Raycaster();

/** makePipTexture(face): the die face in the theme's die colour with its pips, `n` px. */
function pipFace(face: number, th: Theme, n: number): Texture {
  const c = new OffscreenCanvas(n, n);
  const g = c.getContext("2d")!;
  g.scale(n / 128, n / 128);
  g.fillStyle = th.die;
  g.fillRect(0, 0, 128, 128);
  const r = face === 1 ? 15 : 11;
  g.fillStyle = th.pip;
  for (const [px, py] of PIP_LAYOUTS[face]!) {
    g.beginPath();
    g.arc(64 + px * 32, 64 + py * 32, r, 0, PI * 2);
    g.fill();
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// -- embers and stars --------------------------------------------------------------------------
const emberPos = new Float32Array(EMBER_MAX * 3);
const emberSeeds = new Float32Array(EMBER_MAX);
{
  const s = createStream("decor:embers");
  for (let i = 0; i < EMBER_MAX; i++) {
    emberPos[i * 3] = FIRE_POS.x + (s.next() - 0.5) * 1.4;
    emberPos[i * 3 + 1] = FIRE_POS.y - 0.3 + s.next() * 2.6;
    emberPos[i * 3 + 2] = -7.1 + s.next() * 0.9;
    emberSeeds[i] = s.next();
  }
}
const emberGeo = new BufferGeometry();
emberGeo.setAttribute("position", new BufferAttribute(emberPos, 3));
let embers: Points | null = null;
const starPos = new Float32Array(STAR_MAX * 3);
{
  const r = createStream("decor:stars");
  for (let i = 0; i < STAR_MAX; i++) {
    starPos[i * 3] = -3.2 + (r.next() - 0.5) * 3.1;
    starPos[i * 3 + 1] = 2.6 + (r.next() - 0.5) * 2.1;
    starPos[i * 3 + 2] = -7.42;
  }
}
const starGeo = new BufferGeometry();
starGeo.setAttribute("position", new BufferAttribute(starPos, 3));
let starMat: PointsMaterial | null = null;
let fireGlowMat: MeshBasicMaterial | null = null;
let flame: Mesh | null = null;

// -- the scene, rebuilt when the look or the theme changes ---------------------------------------
let dirty = false;
function build(): void {
  dirty = false;
  for (const c of [...env.children]) {
    env.remove(c);
    const m = c as Mesh;
    if (m.geometry && m.geometry !== emberGeo && m.geometry !== starGeo) m.geometry.dispose();
    (m.material as Material | undefined)?.dispose?.();
  }
  embers = null;
  if (!look || !theme) return;
  const t = theme;
  const b = look.budget;
  const detailed = look.detailed;
  const refl = look.reflections;
  const k = b.segments;
  const add = <T extends Mesh | Points>(o: T): T => { env.add(o); return o; };
  const bg = new Color(t.wall).multiplyScalar(0.35);
  scene.background = bg;
  scene.fog = new Fog(bg, 14, 30);
  scene.environment = null; // per-material envMaps below (end of build)
  fillLight.intensity = refl ? 0.3 : 0.5;
  const tex = detailed ? {
    felt: baked("felt"), wood: baked("wood"), logs: baked("logs"), floor: baked("floor"), stone: baked("stone"),
  } : null;
  const mapped = (key: "felt" | "wood" | "logs" | "floor", x: number, y: number): Texture | null => (tex ? repeat(tex[key], x, y) : null);
  // Felt table top, wood rim, pedestal.
  const feltMap = mapped("felt", 5, 5);
  const felt = add(new Mesh(new CylinderGeometry(3.4, 3.6, 0.32, seg(64, k)), litMaterial({ color: t.felt, roughness: 0.95, map: feltMap, bumpMap: feltMap, bumpScale: 1.5, envMapIntensity: 0.12 })));
  felt.position.y = -0.16;
  felt.receiveShadow = true;
  const woodMap = mapped("wood", 8, 1);
  const woodMat = (): Material => litMaterial({ color: t.wood, roughness: 0.55, metalness: 0.05, map: woodMap, bumpMap: woodMap, bumpScale: 1.5, envMapIntensity: 0.3 });
  const rim = add(new Mesh(new TorusGeometry(3.5, 0.22, seg(16, k), seg(96, k)), woodMat()));
  rim.rotation.x = PI / 2;
  rim.position.y = 0.02;
  rim.receiveShadow = true;
  rim.castShadow = true;
  const ped = add(new Mesh(new CylinderGeometry(1.1, 1.5, 2.2, seg(32, k)), woodMat()));
  ped.position.y = -1.45;
  // Room: floor + back wall.
  const floorMap = mapped("floor", 6, 6);
  const floor = add(new Mesh(new CircleGeometry(16, seg(48, k)), litMaterial({ color: t.wall, roughness: 0.9, map: floorMap, bumpMap: floorMap, bumpScale: 1.5, envMapIntensity: 0.1 })));
  floor.rotation.x = -PI / 2;
  floor.position.y = -2.56;
  floor.receiveShadow = true;
  const logMap = mapped("logs", 3, 1);
  const wall = add(new Mesh(new PlaneGeometry(24, 10), litMaterial({ color: t.wall, roughness: 0.95, map: logMap, bumpMap: logMap, bumpScale: 1.5, envMapIntensity: 0.08 })));
  wall.position.set(0, 2.2, -7.5);
  // Window with the night sky and its stars.
  const sky = add(new Mesh(new PlaneGeometry(3.4, 2.4), new MeshBasicMaterial({ color: new Color(t.sky), fog: false })));
  sky.position.set(-3.2, 2.6, -7.45);
  starMat = new PointsMaterial({ color: 0xf6f0ff, size: 0.035, sizeAttenuation: true, transparent: true, fog: false });
  starGeo.setDrawRange(0, Math.min(STAR_MAX, b.stars));
  add(new Points(starGeo, starMat)).frustumCulled = false;
  // Fireplace: dark opening, the flame card.
  const opening = add(new Mesh(new PlaneGeometry(2.3, 1.7), new MeshBasicMaterial({ color: 0x0a0604 })));
  opening.position.set(FIRE_POS.x, FIRE_POS.y + 0.25, -7.44);
  // Fire tint follows the theme accent, pushed into HDR for bloom.
  const fireColor = new Color(t.accent).lerp(new Color(0xffa040), 0.5).multiplyScalar(2.2);
  fireGlowMat = new MeshBasicMaterial({ map: baked("flame"), color: fireColor, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: false });
  flame = add(new Mesh(new PlaneGeometry(1.8, 1.3), fireGlowMat));
  flame.position.set(FIRE_POS.x, FIRE_POS.y + 0.05, -7.4);
  if (detailed) {
    // Brass inlay just inside the rim (catches the lamp in reflections).
    const inlay = add(new Mesh(new TorusGeometry(3.27, 0.025, seg(8, k), seg(128, k)), litMaterial({ color: 0xc9a060, roughness: 0.3, metalness: 1 })));
    inlay.rotation.x = PI / 2;
    inlay.position.y = 0.005;
    // Moon glow, mountain silhouette, timber frame and sill.
    const moon = add(new Mesh(new PlaneGeometry(0.9, 0.9), new MeshBasicMaterial({ map: baked("glow"), color: new Color(1.6, 1.55, 1.4), transparent: true, depthWrite: false, fog: false })));
    moon.position.set(-2.3, 3.25, -7.41);
    const ridge = new Shape();
    ridge.moveTo(-1.7, -1.2);
    for (const [x, y] of [[-1.7, -0.3], [-1.1, 0.25], [-0.7, -0.05], [-0.1, 0.55], [0.5, 0.0], [0.9, 0.3], [1.7, -0.35], [1.7, -1.2]] as const) ridge.lineTo(x, y);
    const mountains = add(new Mesh(new ShapeGeometry(ridge), new MeshBasicMaterial({ color: new Color(t.sky).multiplyScalar(0.45), fog: false })));
    mountains.position.set(-3.2, 2.6, -7.405);
    const frameMat = (): Material => litMaterial({ color: t.wood, roughness: 0.7, map: woodMap, bumpMap: woodMap, bumpScale: 1.5, envMapIntensity: 0.3 });
    const bar = (w: number, h: number, x: number, y: number): void => {
      const m = add(new Mesh(new BoxGeometry(w, h, 0.16), frameMat()));
      m.position.set(x, y, -7.36);
    };
    bar(3.7, 0.16, -3.2, 3.85); bar(3.9, 0.22, -3.2, 1.35);
    bar(0.16, 2.6, -4.97, 2.6); bar(0.16, 2.6, -1.43, 2.6);
    bar(0.08, 2.4, -3.2, 2.6); bar(3.4, 0.08, -3.2, 2.6);
    // Stone surround and mantel.
    const stoneTex = tex!.stone;
    const stone = (w: number, h: number, x: number, y: number): void => {
      const m = add(new Mesh(new BoxGeometry(w, h, 0.5), litMaterial({ color: 0x5e554c, envMapIntensity: 0.1, roughness: 0.9, map: stoneTex, bumpMap: stoneTex, bumpScale: 3 })));
      m.position.set(x, y, -7.3);
      m.receiveShadow = true;
    };
    stone(0.6, 2.4, FIRE_POS.x - 1.45, FIRE_POS.y + 0.4);
    stone(0.6, 2.4, FIRE_POS.x + 1.45, FIRE_POS.y + 0.4);
    stone(3.5, 0.55, FIRE_POS.x, FIRE_POS.y + 1.35);
    const mantel = add(new Mesh(new BoxGeometry(3.9, 0.18, 0.7), frameMat()));
    mantel.position.set(FIRE_POS.x, FIRE_POS.y + 1.7, -7.15);
  }
  // Held-dice tray: grounded dashed inlay (selection is never bloom alone).
  const tray = add(new Mesh(new PlaneGeometry(DIE_SPREAD * 5.2, 1.1), new MeshBasicMaterial({ color: new Color(t.select), map: baked("tray"), transparent: true, opacity: 0.55, depthWrite: false })));
  tray.rotation.x = -PI / 2;
  tray.position.set(0, 0.015, -1.9);
  // Embers: HDR colour so the bloom pass picks the sparks up.
  if (look.embers > 0) {
    emberGeo.setDrawRange(0, Math.min(EMBER_MAX, look.embers));
    embers = add(new Points(emberGeo, new PointsMaterial({
      color: new Color(3.2, 1.4, 0.45), size: 0.08, map: baked("glow"), transparent: true, opacity: 0.9, depthWrite: false,
      blending: AdditiveBlending, sizeAttenuation: true, fog: false,
    })));
    embers.frustumCulled = false;
  }
  // Dice: rounded clear-coated (physical budgets) or bumped standard dice with recessed pips when detailed,
  // flat-faced standard boxes otherwise.
  const pipSize = b.pips;
  const mats: Material[] = [];
  for (let face = 1; face <= 6; face++) {
    const idx = FACE_TEXTURE[face]!;
    const map = pipFace(face, t, pipSize);
    const bump = detailed ? baked(`pip-bump-${face}`, false) : null;
    if (!detailed) mats[idx] = new MeshStandardMaterial({ map, roughness: 0.35, metalness: 0.02 });
    else if (b.material === "physical") {
      mats[idx] = new MeshPhysicalMaterial({ map, roughness: 0.38, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.22, bumpMap: bump, bumpScale: 2.5, envMapIntensity: 0.3 });
    } else mats[idx] = new MeshStandardMaterial({ map, roughness: 0.38, metalness: 0, bumpMap: bump, bumpScale: 2.5, envMapIntensity: 0.3 });
  }
  const geo = detailed ? new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, b.bevel, 0.085) : new BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
  const ring = new RingGeometry(DIE_SIZE * 0.62, DIE_SIZE * 0.78, seg(32, k));
  const oldGeo = dice[0]!.body.geometry, oldRing = dice[0]!.marker.geometry;
  const oldMats = dice[0]!.body.material;
  for (const d of dice) {
    d.body.geometry = geo;
    d.body.material = mats;
    d.marker.geometry = ring;
    (d.marker.material as MeshBasicMaterial).color = new Color(t.select);
  }
  oldGeo.dispose();
  oldRing.dispose();
  for (const m of oldMats) m.dispose();
  // three r160 scaled scene.environment by each material's envMapIntensity; the engine (like
  // r163+) does not, so each lit material carries the room as its own envMap instead.
  const room = refl ? envMap() : null;
  scene.traverse((o) => {
    const m = (o as Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if (x instanceof MeshStandardMaterial) x.envMap = room;
  });
}

// -- camera (applyCameraPreset / _fitAspect) -------------------------------------------------------
let presetName = "standard";
let camLook = new Vector3(...CAMERA_PRESETS.standard!.look);
function addTween(dur: number, ease: (t: number) => number, apply: (t: number) => void, done?: () => void): Tween {
  const tw: Tween = { start: clockMs, dur, ease, apply, done };
  tweens.push(tw);
  return tw;
}
function stepTweens(): void {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]!;
    const t = Math.min(1, (clockMs - tw.start) / tw.dur);
    tw.apply(tw.ease(t));
    if (t >= 1) { tweens.splice(i, 1); tw.done?.(); }
  }
}
/** Pulls the camera back along its line of sight until all five dice home slots fit the stage's width. */
function fitAspect(): void {
  if (tweens.some((tw) => tw.camera)) return; // a preset transition owns the camera right now
  const preset = CAMERA_PRESETS[presetName] ?? CAMERA_PRESETS.standard!;
  const base = new Vector3(...preset.pos);
  const dir = base.clone().sub(camLook).normalize();
  const baseDist = base.distanceTo(camLook);
  const halfW = DIE_SPREAD * 2 + 0.9;
  const tanH = Math.tan((camera.fov / 2) * PI / 180) * (view.w / view.h);
  const dist = Math.max(baseDist, halfW / (tanH * 0.9));
  camera.position.copy(camLook).addScaledVector(dir, dist);
  camera.lookAt(camLook);
}
/** Moves the camera to a preset (900 ms authored transition; instant with reduced motion). */
export function applyCameraPreset(name: string, instant = false): void {
  const p = CAMERA_PRESETS[name] ?? CAMERA_PRESETS.standard!;
  presetName = CAMERA_PRESETS[name] ? name : "standard";
  camera.fov = p.fov;
  const look3 = new Vector3(...p.look);
  if (instant || reducedMotion) {
    tweens = tweens.filter((tw) => !tw.camera);
    camLook = look3;
    fitAspect();
    return;
  }
  const from = camera.position.clone();
  const fromLook = camLook.clone();
  const to = new Vector3(...p.pos);
  tweens = tweens.filter((tw) => !tw.camera);
  addTween(900, easeInOutQuad, (t) => {
    camera.position.copy(from).lerp(to, t);
    camLook = fromLook.clone().lerp(look3, t);
    camera.lookAt(camLook);
  }, () => fitAspect()).camera = true;
}
function frameCamera(): void {
  // The stage is a view.w × view.h image inside the window, at (view.x, view.y).
  camera.aspect = view.w / Math.max(1, view.h);
  camera.setViewOffset(view.w, view.h, -view.x, -view.y, view.W, view.H);
  fitAspect();
}

// -- state sync (updateState) -----------------------------------------------------------------------
function orientFor(value: number, yaw: number): Quaternion {
  const q = new Quaternion().setFromUnitVectors(FACE_NORMAL[value]!, new Vector3(0, 1, 0));
  const yq = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  return yq.multiply(q);
}
export interface DiceState { dice: number[]; held: boolean[] }
/** Consume a rules snapshot; opts.animate tweens the change, opts.rolled names the dice that tumble. */
export function updateState(state: DiceState, opts: { animate?: boolean; rolled?: number[] } = {}): void {
  for (let i = 0; i < DICE_COUNT; i++) {
    const die = dice[i]!;
    const value = state.dice[i]!;
    const held = !!state.held[i];
    const homePos = held ? new Vector3((i - 2) * DIE_SPREAD, DIE_SIZE / 2 + HELD_LIFT, -1.9) : die.home;
    die.marker.visible = held;
    tweens = tweens.filter((tw) => (tw as Tween & { die?: number }).die !== i);
    if (value !== die.value && value > 0) {
      die.value = value;
      const targetQuat = orientFor(value, deco.next() * PI * 2); // decoration stream only
      if (opts.animate && !reducedMotion && opts.rolled?.includes(i)) {
        const fromPos = die.group.position.clone();
        const toPos = homePos.clone().add(new Vector3((deco.next() - 0.5) * 0.5, 0, (deco.next() - 0.5) * 0.4));
        const fromQuat = die.body.quaternion.clone();
        const spin = new Quaternion().setFromAxisAngle(new Vector3(deco.next() - 0.5, 1, deco.next() - 0.5).normalize(), PI * (1.5 + deco.next()));
        const midQuat = fromQuat.clone().multiply(spin);
        const tw = addTween(ROLL_MS + deco.next() * 160, easeOutCubic, (t) => {
          const arc = Math.sin(t * PI) * 1.5;
          die.group.position.copy(fromPos).lerp(toPos, t);
          die.group.position.y = Math.max(DIE_SIZE / 2, arc);
          die.body.quaternion.copy(midQuat).slerp(targetQuat, easeInOutQuad(t));
        }, () => {
          // Skip/settle lands every die in the exact deterministic end state.
          die.group.position.copy(toPos);
          die.body.quaternion.copy(targetQuat);
        });
        (tw as Tween & { die?: number }).die = i;
      } else {
        die.group.position.copy(homePos);
        die.body.quaternion.copy(targetQuat);
      }
    } else if (!reducedMotion && opts.animate) {
      // Hold lift / release settle (authored short transition).
      const fromPos = die.group.position.clone();
      const tw = addTween(180, easeInOutQuad, (t) => { die.group.position.copy(fromPos).lerp(homePos, t); });
      (tw as Tween & { die?: number }).die = i;
    } else {
      die.group.position.copy(homePos);
    }
  }
}
/** The die under a window point (window px), or null. */
export function pickDie(x: number, y: number, W: number, H: number): number | null {
  if (!renderer.camera) return null;
  raycaster.setFromCamera(new Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), camera);
  const hits = raycaster.intersectObjects(dice.map((d) => d.body), false);
  if (!hits.length) return null;
  const i = dice.findIndex((d) => d.body === hits[0]!.object);
  return i >= 0 ? i : null;
}

// -- the game's calls ----------------------------------------------------------------------------
/** The stage (x, y, w, h) and the window (W, H), in logical px. */
export function setStage(x: number, y: number, w: number, h: number, W: number, H: number): void {
  const next = { x, y, w: Math.max(1, w), h: Math.max(1, h), W: Math.max(1, W), H: Math.max(1, H) };
  const moved = (Object.keys(next) as (keyof typeof next)[]).some((k) => Math.abs(next[k] - view[k]) >= 0.5);
  if (!moved) return;
  view = next;
  frameCamera();
}
export function setTheme(next: Theme): void {
  if (theme && JSON.stringify(theme) === JSON.stringify(next)) return;
  theme = next;
  dirty = true;
}
export function setActive(on: boolean): void { renderer.camera = on ? camera : null; }
export function setReducedMotion(on: boolean): void { reducedMotion = on; }
export function applyLook(next: Look): void {
  if (look && JSON.stringify(look) === JSON.stringify(next)) return;
  look = next;
  const shadows = next.shadows > 0;
  renderer.shadowMap.enabled = shadows;
  keyLight.castShadow = shadows;
  if (shadows) keyLight.shadow.mapSize = next.shadows;
  keyLight.shadow.radius = next.shadows >= 4096 ? 3 : 2;
  renderer.ao = next.ao === "off" ? null : {
    blendIntensity: 0.75, radius: 0.45, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: next.ao === "high" ? 16 : 8, resolution: next.budget.aoRes,
    denoise: { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: next.ao === "high" ? 6 : 4, rings: 2, samples: next.ao === "high" ? 16 : 8, radiusExponent: 2 },
  };
  // High threshold: only the fire, embers, moon and specular glints bloom (UnrealBloomPass 0.55, 0.45, 1.25).
  renderer.bloom = next.bloom ? { strength: 0.55, radius: 0.45, threshold: 1.25, resolution: next.budget.bloomRes } : null;
  // js/render.js GradeShader (display space): a gentle S-curve, a touch more saturation,
  // warm highlights / cool shadows and the 0.28 vignette (the old slight black lift has no counterpart).
  renderer.grade = next.grade ? {
    space: "display", contrast: 0.11, saturation: 1.1,
    shadows: [0.95, 0.98, 1.06], highlights: [1.05, 1.0, 0.95], split: [0.15, 0.8],
    vignette: { amount: 0.28, inner: 0.32, outer: 0.85, scale: [1.1, 1.0] },
  } : null;
  renderer.antialias = next.antialias;
  dirty = true;
}
/** Each frame (dt in seconds): tweens, the fire's flicker, star twinkle and ember drift. */
export function update(dt: number): void {
  if (dirty) build();
  const step = Math.min(100, Math.max(0, dt * 1000));
  clockMs += step;
  stepTweens();
  const now = clockMs;
  if (!fireGlowMat || !flame || !starMat) return;
  if (reducedMotion) {
    // Reduced motion: steady light, no drifting sparks or twinkle.
    fireLight.intensity = 26;
    flame.scale.set(1, 1, 1);
    fireGlowMat.opacity = 0.9;
    starMat.opacity = 1;
    return;
  }
  const flicker = 0.9 + 0.1 * Math.sin(now * 0.011) * Math.sin(now * 0.0047 + 1.7);
  fireLight.intensity = 26 * flicker;
  fireGlowMat.opacity = 0.75 + 0.25 * flicker;
  flame.scale.set(1 + 0.03 * Math.sin(now * 0.007), 0.94 + 0.12 * flicker * Math.sin(now * 0.013 + 0.5) ** 2, 1);
  starMat.opacity = 0.8 + 0.2 * Math.sin(now * 0.0021);
  if (embers && look) {
    const n = Math.min(EMBER_MAX, look.embers);
    const top = FIRE_POS.y + 2.3;
    for (let i = 0; i < n; i++) {
      const speed = 0.0004 + emberSeeds[i]! * 0.0008;
      let y = emberPos[i * 3 + 1]! + speed * step;
      if (y > top) y = FIRE_POS.y - 0.3;
      emberPos[i * 3 + 1] = y;
      emberPos[i * 3] = emberPos[i * 3]! + Math.sin(now * 0.001 + emberSeeds[i]! * 9) * 0.0006 * step;
    }
    (emberGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
  }
}
