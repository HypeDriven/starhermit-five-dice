// Five Dice — render module (Three.js r160, vendored, fully local).
// Owns the lodge scene graph, semantic dice views, authored camera presets,
// lighting, image-based reflections, pooled ember VFX, the post-processing
// chain and the graphics quality model (js/gfx.js). Consumes immutable rules
// snapshots; cosmetic randomness comes from decoration streams that never
// touch rules state. Rendering is never the only UI — js/ui.js mirrors
// every interactive element in semantic HTML.

import * as THREE from '/vendor/three.module.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createStream, DICE_COUNT } from './rules.js';
import { detectPreset, resolve, SHADOW_MAP, PARTICLES } from './gfx.js';

// Authored framing constants (no magic offsets scattered in code).
export const CAMERA_PRESETS = {
  standard: { pos: [0, 6.4, 7.6], look: [0, 0.35, -0.4], fov: 42 },
  low:      { pos: [0, 4.2, 8.8], look: [0, 0.5, -0.6], fov: 46 },
  overhead: { pos: [0, 10.5, 1.6], look: [0, 0, -0.2], fov: 38 },
};

const DIE_SIZE = 0.72;
const DIE_SPREAD = 0.92;      // spacing between dice home slots
const HELD_LIFT = 0.55;
const ROLL_MS = 620;          // authored roll animation duration
const LAYER_ENV = 0;          // default layer
const LAYER_GAME = 1;         // dice + selection markers (raycast layer)
const FIRE_POS = new THREE.Vector3(4.6, 0.55, -7.2); // fireplace opening centre
const TABLE_RADIUS = 3.7;     // shadow frustum is fitted to this

// Face assignment on the box (opposites sum to 7): material order +x,-x,+y,-y,+z,-z.
const FACE_TEXTURE = { 5: 0, 2: 1, 1: 2, 6: 3, 3: 4, 4: 5 }; // face value -> material index
const FACE_NORMAL = {
  1: new THREE.Vector3(0, 1, 0),  6: new THREE.Vector3(0, -1, 0),
  2: new THREE.Vector3(-1, 0, 0), 5: new THREE.Vector3(1, 0, 0),
  3: new THREE.Vector3(0, 0, 1),  4: new THREE.Vector3(0, 0, -1),
};

const PIP_LAYOUTS = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [-1, 1], [1, -1], [1, 1]],
  5: [[-1, -1], [-1, 1], [0, 0], [1, -1], [1, 1]],
  6: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 0], [1, 1]],
};

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInOutQuad(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

// Colour grade + vignette (display-space colours in, display-space out):
// gentle S-curve contrast, a touch of saturation, warm highlights / cool
// shadows, slightly lifted blacks so the room never crushes to pure black.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 1.0 }, uVignette: { value: 0.28 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount; uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      vec3 c = clamp(src.rgb, 0.0, 1.0);
      vec3 s = mix(c, c * c * (3.0 - 2.0 * c), 0.22);
      float l = dot(s, vec3(0.299, 0.587, 0.114));
      s = mix(vec3(l), s, 1.1);
      s *= mix(vec3(0.95, 0.98, 1.06), vec3(1.05, 1.0, 0.95), smoothstep(0.15, 0.8, l));
      s = s * 0.975 + 0.018;
      c = mix(c, s, uAmount);
      float d = length((vUv - 0.5) * vec2(1.1, 1.0));
      c *= 1.0 - uVignette * smoothstep(0.32, 0.85, d);
      gl_FragColor = vec4(c, src.a);
    }`,
};

// --- procedural textures (deterministic decoration streams) -------------------

function canvasTex(size, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = size[0]; c.height = size[1];
  draw(c.getContext('2d'), c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  tex.anisotropy = 4;
  return tex;
}

// Near-white detail maps: they multiply the theme colour, so themes still tint.
function feltTexture() {
  const r = createStream('decor:tex:felt');
  return canvasTex([256, 256], (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const v = 228 + r.next() * 27;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    g.globalAlpha = 0.08;
    g.strokeStyle = '#000';
    for (let i = 0; i < 500; i++) { // fibres
      const x = r.next() * w, y = r.next() * h, a = r.next() * Math.PI;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5); g.stroke();
    }
  }, { repeat: [5, 5] });
}

function woodTexture(seed = 'wood', planks = 1) {
  const r = createStream(`decor:tex:${seed}`);
  return canvasTex([256, 256], (g, w, h) => {
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, h);
    const ph = h / planks;
    for (let p = 0; p < planks; p++) {
      const shade = 225 + r.next() * 30;
      g.fillStyle = `rgb(${shade},${shade},${shade})`;
      g.fillRect(0, p * ph, w, ph);
      for (let i = 0; i < 26; i++) { // grain lines
        const y0 = p * ph + r.next() * ph, amp = 1 + r.next() * 3, f = 0.01 + r.next() * 0.03;
        g.strokeStyle = `rgba(60,40,20,${0.08 + r.next() * 0.14})`;
        g.lineWidth = 0.6 + r.next() * 1.4;
        g.beginPath();
        for (let x = 0; x <= w; x += 8) g.lineTo(x, y0 + Math.sin(x * f + i) * amp);
        g.stroke();
      }
      if (planks > 1) { g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, p * ph, w, 2); }
    }
  }, { repeat: [planks > 1 ? 3 : 8, 1] });
}

function stoneTexture() {
  const r = createStream('decor:tex:stone');
  return canvasTex([256, 256], (g, w, h) => {
    g.fillStyle = '#6a6a6a'; g.fillRect(0, 0, w, h);
    const rows = 6, rh = h / rows;
    for (let row = 0; row < rows; row++) {
      let x = -r.next() * 40;
      while (x < w) {
        const sw = 34 + r.next() * 40;
        const v = 175 + r.next() * 70;
        g.fillStyle = `rgb(${v},${v - 4},${v - 10})`;
        g.beginPath();
        g.roundRect(x + 3, row * rh + 3, sw - 6, rh - 6, 9);
        g.fill();
        x += sw;
      }
    }
  }, { repeat: [1, 1] });
}

function glowTexture(inner = 'rgba(255,255,255,1)') {
  return canvasTex([64, 64], (g, w) => {
    const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    grd.addColorStop(0, inner);
    grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
}

function flameTexture() {
  const r = createStream('decor:tex:flame');
  return canvasTex([128, 128], (g, w, h) => {
    const base = g.createRadialGradient(w / 2, h, 4, w / 2, h * 0.9, h * 0.75);
    base.addColorStop(0, 'rgba(255,240,200,1)');
    base.addColorStop(0.4, 'rgba(255,170,70,0.85)');
    base.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 7; i++) { // flame tongues
      const x = w * (0.2 + r.next() * 0.6), top = h * (0.15 + r.next() * 0.35), bw = 10 + r.next() * 12;
      const grd = g.createLinearGradient(0, h, 0, top);
      grd.addColorStop(0, 'rgba(255,220,150,0.9)');
      grd.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - bw, h); g.quadraticCurveTo(x - bw * 0.3, h * 0.6, x, top);
      g.quadraticCurveTo(x + bw * 0.3, h * 0.6, x + bw, h); g.fill();
    }
  });
}

function trayTexture() {
  return canvasTex([256, 64], (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.roundRect(4, 4, w - 8, h - 8, 26); g.fill();
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.beginPath(); g.roundRect(6, 6, w - 12, h - 12, 24); g.stroke();
  });
}

export class Renderer {
  constructor(canvas, settings, theme) {
    this.canvas = canvas;
    this.settings = settings;
    this.theme = theme;
    this.scene = null;
    this.camera = null;
    this.gl = null;
    this.dice = [];            // { group, body, marker, home, value, targetQuat, anim }
    this.tweens = [];
    this.deco = createStream('decor:scene');
    this.running = false;
    this.hidden = false;
    this.lastTime = 0;
    this.raycaster = new THREE.Raycaster();
    this.raycaster.layers.set(LAYER_GAME);
    this.pointer = new THREE.Vector2();
    this.contextLost = false;
    this.onContextLost = null;
    this._ro = null;
    this.disposed = false;
    // Graphics quality state (see setGraphics / js/gfx.js).
    this.q = null;
    this.gpu = '';
    this.detected = 'balanced';
    this.composer = null;
    this.postKey = null;
    this.postFailed = false;
    this.adaptiveScale = 1;
    this.pixelRatio = 1;
    this.size = [0, 0];
    this._frames = [];
    this.fps = 0;
  }

  get reduced() {
    return !!this.settings.reducedMotion ||
      !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  // --- lifecycle ---------------------------------------------------------------

  init() {
    let renderer;
    try {
      // No canvas MSAA: anti-aliasing is chosen per quality tier and applied
      // by the post chain (FXAA/SMAA or a multisampled composer target).
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: false, powerPreference: 'high-performance',
      });
    } catch (err) {
      throw new Error('webgl-unavailable');
    }
    this.gl = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this._detectGpu();

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    // Dice and their held markers live on the gameplay layer (raycast
    // target); the camera must render that layer as well as the environment.
    this.camera.layers.enable(LAYER_GAME);
    this.applyCameraPreset(this.settings.cameraTilt || 'standard', true);

    this.buildEnvironment();
    this.buildDice();
    this.applyTheme(this.theme);
    this._gfxJson = null;
    this.setGraphics(this.settings.graphics);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.stop();
      this.onContextLost?.();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      // GPU resources are rebuilt from retained CPU descriptors by a full
      // renderer re-init; rules/session state is untouched.
      this.contextLost = false;
      this.rebuild();
    });

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.canvas.parentElement || this.canvas);
    this.resize();
    this.start();
    return this;
  }

  _detectGpu() {
    let gpu = '';
    try {
      const ctx = this.gl.getContext();
      // Firefox exposes the real renderer through RENDERER and warns on the
      // debug extension; other browsers need the extension.
      const ext = /firefox/i.test(navigator.userAgent) ? null : ctx.getExtension('WEBGL_debug_renderer_info');
      gpu = String(ctx.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : ctx.RENDERER) || '');
    } catch { gpu = ''; }
    this.gpu = gpu;
    const mobile = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) ||
      /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent || '');
    this.detected = detectPreset(gpu, { mobile });
  }

  rebuild() {
    // Dispose and recreate GPU-side resources after context loss.
    this.disposeScene();
    const canvas = this.canvas;
    const fresh = document.createElement('canvas');
    fresh.id = canvas.id;
    fresh.className = canvas.className;
    fresh.setAttribute('aria-hidden', 'true');
    canvas.replaceWith(fresh);
    this.canvas = fresh;
    this.dice = [];
    this.tweens = [];
    this.init();
    if (this._lastState) this.updateState(this._lastState.state, this._lastState.opts);
  }

  disposeScene() {
    this.composer?.dispose();
    this.composer = null;
    this.postKey = null;
    this.envTex?.dispose();
    this.envTex = null;
    const seen = new Set();
    const disposeMat = (m) => {
      if (!m || seen.has(m)) return;
      seen.add(m);
      for (const k of ['map', 'bumpMap', 'roughnessMap', 'alphaMap']) m[k]?.dispose?.();
      m.dispose?.();
    };
    this.scene?.traverse((obj) => {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(disposeMat);
    });
    (this.dieMatSets || []).flat().forEach(disposeMat);
    this.dieGeos?.box.dispose();
    this.dieGeos?.rounded.dispose();
    this.gl?.dispose();
  }

  dispose() {
    this.stop();
    this._ro?.disconnect();
    this.disposeScene();
    this.disposed = true;
  }

  // --- scene construction --------------------------------------------------------

  buildEnvironment() {
    const t = this.theme;
    this.scene.background = new THREE.Color();
    this.scene.fog = new THREE.Fog(0x000000, 14, 30);
    this.detailGroup = new THREE.Group(); // props shown only at "detailed"
    this.scene.add(this.detailGroup);
    this.tex = {
      felt: feltTexture(), wood: woodTexture('wood'), wall: woodTexture('logs', 7),
      floor: woodTexture('floor', 5), stone: stoneTexture(),
    };
    this.tex.floor.repeat.set(6, 6);

    // Felt table top.
    const feltGeo = new THREE.CylinderGeometry(3.4, 3.6, 0.32, 64);
    this.feltMat = new THREE.MeshStandardMaterial({ color: t.felt, roughness: 0.95, metalness: 0 });
    const felt = new THREE.Mesh(feltGeo, this.feltMat);
    felt.position.y = -0.16;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // Wood rim.
    const rimGeo = new THREE.TorusGeometry(3.5, 0.22, 16, 96);
    this.woodMat = new THREE.MeshStandardMaterial({ color: t.wood, roughness: 0.55, metalness: 0.05 });
    const rim = new THREE.Mesh(rimGeo, this.woodMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    rim.receiveShadow = true;
    rim.castShadow = true;
    this.scene.add(rim);

    // Brass inlay just inside the rim (catches the lamp in reflections).
    this.brassMat = new THREE.MeshStandardMaterial({ color: 0xc9a060, roughness: 0.3, metalness: 1 });
    const inlay = new THREE.Mesh(new THREE.TorusGeometry(3.27, 0.025, 8, 128), this.brassMat);
    inlay.rotation.x = Math.PI / 2;
    inlay.position.y = 0.005;
    this.detailGroup.add(inlay);

    // Table pedestal.
    const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.5, 2.2, 32), this.woodMat);
    ped.position.y = -1.45;
    this.scene.add(ped);

    // Room: floor + back wall, kept simple and warm.
    this.floorMat = new THREE.MeshStandardMaterial({ color: t.wall, roughness: 0.9 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.56;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.wallMat = new THREE.MeshStandardMaterial({ color: t.wall, roughness: 0.95 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(24, 10), this.wallMat);
    wall.position.set(0, 2.2, -7.5);
    this.scene.add(wall);

    // Window with night sky (deterministic star scatter).
    this.skyMat = new THREE.MeshBasicMaterial({ color: t.sky, fog: false });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), this.skyMat);
    sky.position.set(-3.2, 2.6, -7.45);
    this.scene.add(sky);
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(60 * 3);
    const starStream = createStream('decor:stars');
    for (let i = 0; i < 60; i++) {
      starPos[i * 3] = -3.2 + (starStream.next() - 0.5) * 3.1;
      starPos[i * 3 + 1] = 2.6 + (starStream.next() - 0.5) * 2.1;
      starPos[i * 3 + 2] = -7.42;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xf6f0ff, size: 0.035, sizeAttenuation: true, transparent: true, fog: false });
    this.scene.add(new THREE.Points(starGeo, this.starMat));
    // Detailed window: moon glow, mountain silhouette, timber frame and sill.
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(1.6, 1.55, 1.4), transparent: true, depthWrite: false, fog: false }));
    moon.position.set(-2.3, 3.25, -7.41);
    this.detailGroup.add(moon);
    const ridge = new THREE.Shape();
    ridge.moveTo(-1.7, -1.2);
    for (const [x, y] of [[-1.7, -0.3], [-1.1, 0.25], [-0.7, -0.05], [-0.1, 0.55], [0.5, 0.0], [0.9, 0.3], [1.7, -0.35], [1.7, -1.2]]) ridge.lineTo(x, y);
    this.ridgeMat = new THREE.MeshBasicMaterial({ color: 0x0b1116, fog: false });
    const mountains = new THREE.Mesh(new THREE.ShapeGeometry(ridge), this.ridgeMat);
    mountains.position.set(-3.2, 2.6, -7.405);
    this.detailGroup.add(mountains);
    this.frameMat = new THREE.MeshStandardMaterial({ color: t.wood, roughness: 0.7 });
    const bar = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.16), this.frameMat);
      m.position.set(x, y, -7.36);
      this.detailGroup.add(m);
    };
    bar(3.7, 0.16, -3.2, 3.85); bar(3.9, 0.22, -3.2, 1.35);
    bar(0.16, 2.6, -4.97, 2.6); bar(0.16, 2.6, -1.43, 2.6);
    bar(0.08, 2.4, -3.2, 2.6); bar(3.4, 0.08, -3.2, 2.6);

    // Fireplace (right side): dark opening, flame card, stone surround + mantel.
    const opening = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.7),
      new THREE.MeshBasicMaterial({ color: 0x0a0604 }));
    opening.position.set(FIRE_POS.x, FIRE_POS.y + 0.25, -7.44);
    this.scene.add(opening);
    this.fireGlowMat = new THREE.MeshBasicMaterial({
      map: flameTexture(), color: 0xffffff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    });
    this.flame = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.3), this.fireGlowMat);
    this.flame.position.set(FIRE_POS.x, FIRE_POS.y + 0.05, -7.4);
    this.scene.add(this.flame);
    this.stoneMat = new THREE.MeshStandardMaterial({ color: 0x5e554c, envMapIntensity: 0.1, roughness: 0.9, map: this.tex.stone, bumpMap: this.tex.stone, bumpScale: 3 });
    const stone = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.5), this.stoneMat);
      m.position.set(x, y, -7.3);
      m.receiveShadow = true;
      this.detailGroup.add(m);
    };
    stone(0.6, 2.4, FIRE_POS.x - 1.45, FIRE_POS.y + 0.4);
    stone(0.6, 2.4, FIRE_POS.x + 1.45, FIRE_POS.y + 0.4);
    stone(3.5, 0.55, FIRE_POS.x, FIRE_POS.y + 1.35);
    const mantel = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.18, 0.7), this.frameMat);
    mantel.position.set(FIRE_POS.x, FIRE_POS.y + 1.7, -7.15);
    this.detailGroup.add(mantel);

    // Lighting: warm key (the table lamp) with shadows fitted to the table,
    // the fire as a flickering point light, and a soft hemisphere fill.
    this.keyLight = new THREE.DirectionalLight(0xffcf98, 1.7);
    this.keyLight.position.set(2.6, 7.5, 3.4);
    this.keyLight.target.position.set(0, 0, -0.3);
    const sc = this.keyLight.shadow.camera;
    Object.assign(sc, { left: -TABLE_RADIUS, right: TABLE_RADIUS, top: TABLE_RADIUS, bottom: -TABLE_RADIUS, near: 4, far: 13 });
    sc.updateProjectionMatrix();
    this.keyLight.shadow.bias = -0.0004;
    this.keyLight.shadow.normalBias = 0.02;
    this.scene.add(this.keyLight, this.keyLight.target);

    this.lampLight = new THREE.PointLight(0xffb066, 7, 10, 2); // pooled warmth over the felt
    this.lampLight.position.set(0.4, 4.2, 0.8);
    this.scene.add(this.lampLight);

    this.fireLight = new THREE.PointLight(0xff7733, 26, 16, 2);
    this.fireLight.position.set(FIRE_POS.x - 0.3, FIRE_POS.y + 0.3, -6.2);
    this.scene.add(this.fireLight);

    this.fillLight = new THREE.HemisphereLight(0xbcd0e8, 0x2a2018, 0.5);
    this.scene.add(this.fillLight);

    // Held-dice tray: grounded dashed inlay (selection is never bloom alone).
    this.trayMat = new THREE.MeshBasicMaterial({
      color: t.select, map: trayTexture(), transparent: true, opacity: 0.55, depthWrite: false,
    });
    const tray = new THREE.Mesh(new THREE.PlaneGeometry(DIE_SPREAD * 5.2, 1.1), this.trayMat);
    tray.rotation.x = -Math.PI / 2;
    tray.position.set(0, 0.015, -1.9);
    this.scene.add(tray);
  }

  makePipTexture(faceValue, bump = false) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = bump ? '#fff' : this.theme.die;
    g.fillRect(0, 0, 128, 128);
    const r = faceValue === 1 ? 15 : 11;
    for (const [px, py] of PIP_LAYOUTS[faceValue]) {
      const x = 64 + px * 32, y = 64 + py * 32;
      if (bump) {
        const grd = g.createRadialGradient(x, y, r * 0.2, x, y, r + 2);
        grd.addColorStop(0, '#000'); grd.addColorStop(0.8, '#222'); grd.addColorStop(1, '#fff');
        g.fillStyle = grd;
      } else {
        g.fillStyle = this.theme.pip;
      }
      g.beginPath();
      g.arc(x, y, bump ? r + 2 : r, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    if (!bump) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  buildDice() {
    this.dieGeos = {
      box: new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE),
      rounded: new RoundedBoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE, 4, 0.085),
    };
    // Two material sets: plain (standard, flat faces) and detailed
    // (clearcoated physical material with recessed pips).
    this.dieMatsPlain = [];
    this.dieMatsDetailed = [];
    for (let face = 1; face <= 6; face++) {
      const idx = FACE_TEXTURE[face];
      this.dieMatsPlain[idx] = new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.02 });
      this.dieMatsDetailed[idx] = new THREE.MeshPhysicalMaterial({
        roughness: 0.38, metalness: 0, clearcoat: 0.8, clearcoatRoughness: 0.22,
        bumpMap: this.makePipTexture(face, true), bumpScale: 2.5, envMapIntensity: 0.3,
      });
    }
    this.dieMatSets = [this.dieMatsPlain, this.dieMatsDetailed];
    const markerGeo = new THREE.RingGeometry(DIE_SIZE * 0.62, DIE_SIZE * 0.78, 32);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: this.theme.select, transparent: true, opacity: 0.9, depthWrite: false,
    });
    for (let i = 0; i < DICE_COUNT; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(this.dieGeos.box, this.dieMatsPlain);
      body.castShadow = true;
      body.receiveShadow = true;
      body.layers.set(LAYER_GAME);
      body.userData.dieIndex = i;
      group.add(body);
      const marker = new THREE.Mesh(markerGeo, this.markerMat);
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = -DIE_SIZE / 2 + 0.02;
      marker.visible = false;
      marker.layers.set(LAYER_GAME);
      group.add(marker);
      const home = new THREE.Vector3((i - 2) * DIE_SPREAD, DIE_SIZE / 2, 0.4);
      group.position.copy(home);
      this.scene.add(group);
      this.dice.push({ group, body, marker, home, value: 0, anim: null });
    }
  }

  buildEmbers(count) {
    // Pooled fireplace ember particles; cosmetic layer only, never raycast.
    if (this.emberPoints) {
      this.scene.remove(this.emberPoints);
      this.emberPoints.geometry.dispose();
      this.emberPoints.material.map?.dispose();
      this.emberPoints.material.dispose();
      this.emberPoints = null;
    }
    this._emberCount = count;
    if (!count) return;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seedAttr = new Float32Array(count);
    const stream = createStream(`decor:embers:${count}`);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = FIRE_POS.x + (stream.next() - 0.5) * 1.4;
      pos[i * 3 + 1] = FIRE_POS.y - 0.3 + stream.next() * 2.6;
      pos[i * 3 + 2] = -7.1 + stream.next() * 0.9;
      seedAttr[i] = stream.next();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.emberSeeds = seedAttr;
    // HDR colour so the bloom pass picks the sparks up.
    this.emberMat = new THREE.PointsMaterial({
      color: new THREE.Color(3.2, 1.4, 0.45), size: 0.08, map: glowTexture(), transparent: true,
      opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    });
    this.emberPoints = new THREE.Points(geo, this.emberMat);
    this.emberPoints.layers.set(LAYER_ENV);
    this.scene.add(this.emberPoints);
  }

  // --- theming / graphics / camera -------------------------------------------------

  applyTheme(theme) {
    this.theme = theme;
    if (!this.scene) return;
    this.feltMat.color.set(theme.felt);
    this.woodMat.color.set(theme.wood);
    this.frameMat.color.set(theme.wood);
    this.floorMat.color.set(theme.wall);
    this.wallMat.color.set(theme.wall);
    this.skyMat.color.set(theme.sky);
    this.ridgeMat.color.set(theme.sky).multiplyScalar(0.45);
    this.scene.background.set(theme.wall).multiplyScalar(0.35);
    this.scene.fog.color.copy(this.scene.background);
    // Fire tint follows the theme accent, pushed into HDR for bloom.
    this.fireGlowMat.color.set(theme.accent).lerp(new THREE.Color(0xffa040), 0.5).multiplyScalar(2.2);
    this.markerMat.color.set(theme.select);
    this.trayMat.color.set(theme.select);
    for (let face = 1; face <= 6; face++) {
      const idx = FACE_TEXTURE[face];
      this.dieMatsPlain[idx].map?.dispose();
      this.dieMatsDetailed[idx].map?.dispose();
      this.dieMatsPlain[idx].map = this.makePipTexture(face);
      this.dieMatsDetailed[idx].map = this.makePipTexture(face);
      this.dieMatsPlain[idx].needsUpdate = true;
      this.dieMatsDetailed[idx].needsUpdate = true;
    }
  }

  /** Apply saved graphics settings (settings.graphics object; {} = Auto). Live, no reload. */
  setGraphics(saved) {
    const json = JSON.stringify(saved || {});
    if (json === this._gfxJson && this.q) return; // unrelated settings changed
    this._gfxJson = json;
    const g = resolve(saved || {}, this.detected);
    this.q = g;
    if (!this.gl) return;
    document.body.dataset.gfxPreset = g.preset;
    document.body.dataset.gfxAuto = String(g.auto);
    this.canvas.dataset.gfxPreset = g.preset;

    // Shadows: enable + map size; lit materials recompile for the new state.
    const size = SHADOW_MAP[g.shadows];
    this.gl.shadowMap.enabled = size > 0;
    this.keyLight.castShadow = size > 0;
    if (size > 0 && this.keyLight.shadow.mapSize.x !== size) {
      this.keyLight.shadow.mapSize.set(size, size);
      this.keyLight.shadow.map?.dispose();
      this.keyLight.shadow.map = null;
    }
    this.keyLight.shadow.radius = g.shadows === 'high' ? 3 : 2;

    // Reflections: image-based lighting from a PMREM-filtered RoomEnvironment.
    if (g.reflections === 'on') {
      if (!this.envTex) {
        const pmrem = new THREE.PMREMGenerator(this.gl);
        const room = new RoomEnvironment(this.gl);
        this.envTex = pmrem.fromScene(room, 0.04).texture;
        room.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
        pmrem.dispose();
      }
      this.scene.environment = this.envTex;
    } else {
      this.scene.environment = null;
    }
    this.fillLight.intensity = g.reflections === 'on' ? 0.3 : 0.5;

    // Detail: rounded clearcoated dice with recessed pips, textured felt,
    // wood grain, log wall, stone fireplace, window frame, brass inlay.
    const detailed = g.detail === 'detailed';
    for (const d of this.dice) {
      d.body.geometry = detailed ? this.dieGeos.rounded : this.dieGeos.box;
      d.body.material = detailed ? this.dieMatsDetailed : this.dieMatsPlain;
    }
    this.detailGroup.visible = detailed;
    const maps = [
      [this.feltMat, this.tex.felt, 0.12], [this.woodMat, this.tex.wood, 0.3],
      [this.wallMat, this.tex.wall, 0.08], [this.floorMat, this.tex.floor, 0.1],
      [this.frameMat, this.tex.wood, 0.3],
    ];
    for (const [m, tex, env] of maps) {
      m.map = detailed ? tex : null;
      m.bumpMap = detailed ? tex : null;
      m.bumpScale = 1.5;
      m.envMapIntensity = env;
    }

    // Particles.
    if (this._emberCount !== PARTICLES[g.particles]) this.buildEmbers(PARTICLES[g.particles]);

    this.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m) m.needsUpdate = true;
    });
    for (const m of this.dieMatSets.flat()) m.needsUpdate = true;

    this.adaptiveScale = 1;
    this._frames = [];
    this.postKey = null; // rebuild the post chain on the next frame
    this.postFailed = false;
    this._fpsVisible(g.showFps);
  }

  /** What the Graphics panel shows: GPU, auto choice, resolved tiers, pixels, frame rate. */
  graphicsInfo() {
    return {
      gpu: this.gpu,
      detected: this.detected,
      resolved: this.q,
      pixels: [Math.round(this.size[0] * this.pixelRatio), Math.round(this.size[1] * this.pixelRatio)],
      fps: Math.round(this.fps || 0),
      adaptiveScale: Math.round(this.adaptiveScale * 100) / 100,
      postFailed: !!this.postFailed,
    };
  }

  _fpsVisible(on) {
    let el = document.getElementById('fps-meter');
    if (on && !el) {
      el = document.createElement('div');
      el.id = 'fps-meter';
      el.className = 'fps-meter';
      el.setAttribute('aria-hidden', 'true');
      el.textContent = '… fps';
      document.body.append(el);
    }
    if (el) el.hidden = !on;
  }

  _postKey(w, h) {
    const g = this.q;
    return g.post && !this.postFailed ? [g.ao, g.bloom, g.grade, g.antialias, w, h, this.pixelRatio].join('|') : 'none';
  }

  _buildPost(w, h) {
    const g = this.q;
    this.composer?.dispose();
    this.composer = null;
    if (!g.post || this.postFailed) return;
    try {
      const pw = Math.max(1, Math.round(w * this.pixelRatio));
      const ph = Math.max(1, Math.round(h * this.pixelRatio));
      const target = new THREE.WebGLRenderTarget(pw, ph, {
        type: THREE.HalfFloatType, samples: g.antialias === 'msaa' ? 4 : 0,
      });
      const composer = new EffectComposer(this.gl, target);
      composer.setPixelRatio(this.pixelRatio);
      composer.setSize(w, h);
      composer.addPass(new RenderPass(this.scene, this.camera));
      if (g.ao !== 'off') {
        const ao = new GTAOPass(this.scene, this.camera, pw, ph);
        ao.output = GTAOPass.OUTPUT.Default;
        ao.blendIntensity = 0.75;
        ao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.5, thickness: 1.0, scale: 1.0, samples: g.ao === 'high' ? 16 : 8 });
        ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: g.ao === 'high' ? 6 : 4, rings: 2, samples: g.ao === 'high' ? 16 : 8 });
        composer.addPass(ao);
      }
      if (g.bloom === 'on') {
        // High threshold: only the fire, embers, moon and specular glints bloom.
        composer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.45, 1.25));
      }
      composer.addPass(new OutputPass());
      if (g.grade === 'on') composer.addPass(new ShaderPass(GradeShader));
      if (g.antialias === 'smaa') composer.addPass(new SMAAPass(pw, ph));
      if (g.antialias === 'fxaa') {
        const fxaa = new ShaderPass(FXAAShader);
        fxaa.material.uniforms.resolution.value.set(1 / pw, 1 / ph);
        composer.addPass(fxaa);
      }
      this.composer = composer;
    } catch {
      // Post-processing is an enhancement: render directly if the chain
      // cannot be built (the Graphics panel shows a note).
      this.postFailed = true;
      this.composer = null;
    }
  }

  // Adaptive resolution: step the render scale down when frames are slow,
  // back up when fast (90-frame average).
  _adapt(dt) {
    const f = this._frames;
    f.push(dt);
    if (f.length < 90) return false;
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    f.length = 0;
    this.fps = 1000 / avg;
    const el = document.getElementById('fps-meter');
    if (el && !el.hidden) el.textContent = `${Math.round(this.fps)} fps · ${Math.round(this.pixelRatio * 100) / 100}×`;
    if (!this.q.adaptive) return false;
    const before = this.adaptiveScale;
    if (avg > 26) this.adaptiveScale = Math.max(0.6, this.adaptiveScale - 0.1);
    else if (avg < 14 && this.adaptiveScale < 1) this.adaptiveScale = Math.min(1, this.adaptiveScale + 0.05);
    return before !== this.adaptiveScale;
  }

  applyCameraPreset(name, instant = false) {
    const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.standard;
    this._presetName = name;
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    const to = new THREE.Vector3(...p.pos);
    const look = new THREE.Vector3(...p.look);
    if (instant || this.settings.reducedMotion) {
      this.camera.position.copy(to);
      this.camera.lookAt(look);
      this._camLook = look;
      this._fitAspect();
      return;
    }
    // Authored interruptible transition (fixed duration, absolute targets —
    // never cumulative per-frame lerp).
    const from = this.camera.position.clone();
    const fromLook = (this._camLook || look).clone();
    this.addTween(900, easeInOutQuad, (t) => {
      this.camera.position.lerpVectors(from, to, t);
      this._camLook = fromLook.clone().lerp(look, t);
      this.camera.lookAt(this._camLook);
    }, () => this._fitAspect());
    this.tweens[this.tweens.length - 1].camera = true;
  }

  // --- tweens -----------------------------------------------------------------------

  addTween(durMs, ease, apply, done) {
    // Replace tweens on the same target implicitly by caller management.
    this.tweens.push({ start: performance.now(), durMs, ease, apply, done });
  }

  stepTweens(now) {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      const t = Math.min(1, (now - tw.start) / tw.durMs);
      tw.apply(tw.ease(t));
      if (t >= 1) {
        this.tweens.splice(i, 1);
        tw.done?.();
      }
    }
  }

  // --- state sync ---------------------------------------------------------------------

  orientFor(value, yaw) {
    const q = new THREE.Quaternion().setFromUnitVectors(FACE_NORMAL[value], new THREE.Vector3(0, 1, 0));
    const yq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return yq.multiply(q);
  }

  // Consume an immutable rules snapshot; opts: { animate, rollEvent }
  updateState(state, opts = {}) {
    this._lastState = { state, opts };
    if (!this.scene) return;
    for (let i = 0; i < DICE_COUNT; i++) {
      const die = this.dice[i];
      const value = state.dice[i];
      const held = state.held[i];
      const homePos = held
        ? new THREE.Vector3((i - 2) * DIE_SPREAD, DIE_SIZE / 2 + HELD_LIFT, -1.9)
        : die.home;
      die.marker.visible = held;
      if (value !== die.value && value > 0) {
        die.value = value;
        const yaw = this.deco.next() * Math.PI * 2; // decoration stream only
        const targetQuat = this.orientFor(value, yaw);
        if (opts.animate && !this.settings.reducedMotion && opts.rolled?.includes(i)) {
          const fromPos = die.group.position.clone();
          const toPos = homePos.clone().add(new THREE.Vector3(
            (this.deco.next() - 0.5) * 0.5, 0, (this.deco.next() - 0.5) * 0.4));
          const fromQuat = die.body.quaternion.clone();
          const spin = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(this.deco.next() - 0.5, 1, this.deco.next() - 0.5).normalize(),
            Math.PI * (1.5 + this.deco.next()));
          const midQuat = fromQuat.clone().multiply(spin);
          this.addTween(ROLL_MS + this.deco.next() * 160, easeOutCubic, (t) => {
            const arc = Math.sin(t * Math.PI) * 1.5;
            die.group.position.lerpVectors(fromPos, toPos, t);
            die.group.position.y = Math.max(DIE_SIZE / 2, die.group.position.y * (1 - arc * 0) + arc);
            die.body.quaternion.slerpQuaternions(midQuat, targetQuat, easeInOutQuad(t));
          }, () => {
            // Skip/settle lands every die in the exact deterministic end state.
            die.group.position.copy(toPos);
            die.body.quaternion.copy(targetQuat);
          });
        } else {
          die.group.position.copy(homePos);
          die.body.quaternion.copy(targetQuat);
        }
      } else {
        // Hold lift / release settle (authored short transition).
        if (!this.settings.reducedMotion && opts.animate) {
          const fromPos = die.group.position.clone();
          this.addTween(180, easeInOutQuad, (t) => {
            die.group.position.lerpVectors(fromPos, homePos, t);
          });
        } else {
          die.group.position.copy(homePos);
        }
      }
    }
  }

  onGameEvent(e) {
    if (e.type === 'roll' && this._lastState) {
      this.updateState(this._lastState.state, { animate: true, rolled: e.rolled });
    }
  }

  // --- picking (raycast only the explicit gameplay layer) ---------------------------

  pickDie(clientX, clientY) {
    if (!this.gl || this.contextLost) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(
      this.dice.map((d) => d.body), false);
    return hits.length ? hits[0].object.userData.dieIndex : null;
  }

  // --- loop ----------------------------------------------------------------------------

  resize() {
    if (!this.gl) return;
    const el = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._fitAspect();
    this._applySize(true);
  }

  // Pixel ratio = min(dpr, preset cap) × preset scale × render scale × adaptive scale.
  _applySize(force = false) {
    const el = this.canvas.parentElement || this.canvas;
    const w = Math.max(1, el.clientWidth);
    const h = Math.max(1, el.clientHeight);
    const q = this.q || { maxRatio: 1.5, scale: 1 };
    const ratio = Math.min(window.devicePixelRatio || 1, q.maxRatio) * q.scale * this.adaptiveScale;
    if (force || w !== this.size[0] || h !== this.size[1] || ratio !== this.pixelRatio) {
      this.size = [w, h];
      this.pixelRatio = ratio;
      this.gl.setPixelRatio(ratio);
      this.gl.setSize(w, h, false);
    }
  }

  // Narrow (portrait) aspects: pull the camera back along its line of sight
  // until all five dice home slots fit horizontally with a margin.
  _fitAspect() {
    const look = this._camLook || new THREE.Vector3(...CAMERA_PRESETS.standard.look);
    const preset = CAMERA_PRESETS[this._presetName] || CAMERA_PRESETS.standard;
    const base = new THREE.Vector3(...preset.pos);
    const dir = base.clone().sub(look).normalize();
    const baseDist = base.distanceTo(look);
    const halfW = DIE_SPREAD * 2 + 0.9; // outer die centre plus a die width
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.aspect;
    const need = halfW / (tanH * 0.9);
    const dist = Math.max(baseDist, need);
    if (this.tweens.some((tw) => tw.camera)) return; // a preset transition owns the camera right now
    this.camera.position.copy(look).addScaledVector(dir, dist);
    this.camera.lookAt(look);
  }

  start() {
    if (this.running || this.contextLost) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(100, now - this.lastTime);
      this.lastTime = now;
      this.stepTweens(now);
      this.animateAmbient(now, dt);
      this.renderFrame(dt);
    };
    this._raf = requestAnimationFrame(loop);
  }

  renderFrame(dt) {
    const rescale = this._adapt(dt);
    this._applySize(rescale);
    const key = this._postKey(this.size[0], this.size[1]);
    if (key !== this.postKey) {
      this.postKey = key;
      this._buildPost(this.size[0], this.size[1]);
    }
    if (this.composer) {
      try {
        this.composer.render(dt / 1000);
        return;
      } catch {
        this.postFailed = true;
        this.composer = null;
        this.postKey = null;
      }
    }
    this.gl.render(this.scene, this.camera);
  }

  animateAmbient(now, dt) {
    if (this.hidden) return; // decorative motion paused while hidden
    if (this.reduced) {
      // Reduced motion: steady light, no drifting sparks or twinkle.
      this.fireLight.intensity = 26;
      this.flame.scale.set(1, 1, 1);
      this.fireGlowMat.opacity = 0.9;
      this.starMat.opacity = 1;
      return;
    }
    // Fire light flicker (low amplitude) drives the flame card too.
    const flicker = 0.9 + 0.1 * Math.sin(now * 0.011) * Math.sin(now * 0.0047 + 1.7);
    this.fireLight.intensity = 26 * flicker;
    this.fireGlowMat.opacity = 0.75 + 0.25 * flicker;
    this.flame.scale.set(1 + 0.03 * Math.sin(now * 0.007), 0.94 + 0.12 * flicker * Math.sin(now * 0.013 + 0.5) ** 2, 1);
    this.starMat.opacity = 0.8 + 0.2 * Math.sin(now * 0.0021);
    // Ember drift: bounded, pooled, cosmetic.
    if (this.emberPoints) {
      const pos = this.emberPoints.geometry.attributes.position;
      const top = FIRE_POS.y + 2.3;
      for (let i = 0; i < pos.count; i++) {
        const speed = 0.0004 + this.emberSeeds[i] * 0.0008;
        let y = pos.getY(i) + speed * dt;
        if (y > top) y = FIRE_POS.y - 0.3;
        pos.setY(i, y);
        pos.setX(i, pos.getX(i) + Math.sin(now * 0.001 + this.emberSeeds[i] * 9) * 0.0006 * dt);
      }
      pos.needsUpdate = true;
    }
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    if (hidden) this.stop();
    else if (!this.contextLost) this.start();
  }
}
