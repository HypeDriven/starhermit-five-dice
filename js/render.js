// Five Dice — render module (Three.js r160, vendored, fully local).
// Owns the lodge scene graph, semantic dice views, authored camera presets,
// lighting, pooled ember VFX, and quality tiers. Consumes immutable rules
// snapshots; cosmetic randomness comes from a decoration stream that never
// touches rules state. Rendering is never the only UI — js/ui.js mirrors
// every interactive element in semantic HTML.

import * as THREE from '/vendor/three.module.js';
import { createStream, DICE_COUNT } from './rules.js';

// Authored framing constants (no magic offsets scattered in code).
export const CAMERA_PRESETS = {
  standard: { pos: [0, 6.4, 7.6], look: [0, 0.35, -0.4], fov: 42 },
  low:      { pos: [0, 4.2, 8.8], look: [0, 0.5, -0.6], fov: 46 },
  overhead: { pos: [0, 10.5, 1.6], look: [0, 0, -0.2], fov: 38 },
};

export const QUALITY_TIERS = {
  low:    { pixelRatio: 1,    shadows: false, embers: 60,  antialias: false, renderScale: 0.85 },
  medium: { pixelRatio: 1.5,  shadows: true,  embers: 220, antialias: true,  renderScale: 1 },
  high:   { pixelRatio: 2,    shadows: true,  embers: 480, antialias: true,  renderScale: 1 },
};

const DIE_SIZE = 0.72;
const DIE_SPREAD = 0.92;      // spacing between dice home slots
const HELD_LIFT = 0.55;
const ROLL_MS = 620;          // authored roll animation duration
const LAYER_ENV = 0;          // default layer
const LAYER_GAME = 1;         // dice + selection markers (raycast layer)

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
  }

  // --- lifecycle ---------------------------------------------------------------

  init() {
    const tier = QUALITY_TIERS[this.settings.quality] || QUALITY_TIERS.medium;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas: this.canvas, antialias: tier.antialias, powerPreference: 'high-performance',
      });
    } catch (err) {
      throw new Error('webgl-unavailable');
    }
    this.gl = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = tier.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 60);
    this.applyCameraPreset(this.settings.cameraTilt || 'standard', true);

    this.buildEnvironment();
    this.buildDice();
    this.buildEmbers(tier.embers);
    this.applyTheme(this.theme);
    this.applyQuality(this.settings.quality);

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
    this.scene?.traverse((obj) => {
      obj.geometry?.dispose?.();
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m) continue;
        m.map?.dispose?.();
        m.dispose?.();
      }
    });
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
    // Felt table top.
    const feltGeo = new THREE.CylinderGeometry(3.4, 3.6, 0.32, 48);
    this.feltMat = new THREE.MeshStandardMaterial({ color: t.felt, roughness: 0.95, metalness: 0 });
    const felt = new THREE.Mesh(feltGeo, this.feltMat);
    felt.position.y = -0.16;
    felt.receiveShadow = true;
    this.scene.add(felt);

    // Wood rim.
    const rimGeo = new THREE.TorusGeometry(3.5, 0.22, 12, 48);
    this.woodMat = new THREE.MeshStandardMaterial({ color: t.wood, roughness: 0.7, metalness: 0.05 });
    const rim = new THREE.Mesh(rimGeo, this.woodMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    this.scene.add(rim);

    // Table pedestal.
    const ped = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.5, 2.2, 24),
      this.woodMat);
    ped.position.y = -1.45;
    this.scene.add(ped);

    // Room: floor + back wall with window, kept simple and warm.
    this.floorMat = new THREE.MeshStandardMaterial({ color: t.wall, roughness: 1 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 32), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.56;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.wallMat = new THREE.MeshStandardMaterial({ color: t.wall, roughness: 1 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(24, 10), this.wallMat);
    wall.position.set(0, 2.2, -7.5);
    this.scene.add(wall);

    // Window with night sky (deterministic star scatter).
    this.skyMat = new THREE.MeshBasicMaterial({ color: t.sky });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), this.skyMat);
    sky.position.set(-3.2, 2.6, -7.4);
    this.scene.add(sky);
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(60 * 3);
    const starStream = createStream('decor:stars');
    for (let i = 0; i < 60; i++) {
      starPos[i * 3] = -3.2 + (starStream.next() - 0.5) * 3.1;
      starPos[i * 3 + 1] = 2.6 + (starStream.next() - 0.5) * 2.1;
      starPos[i * 3 + 2] = -7.38;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xf6f0ff, size: 0.035, sizeAttenuation: true });
    this.scene.add(new THREE.Points(starGeo, this.starMat));

    // Fireplace glow plane (right side) + animated point light.
    this.fireGlowMat = new THREE.MeshBasicMaterial({ color: t.accent, transparent: true, opacity: 0.55 });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), this.fireGlowMat);
    glow.position.set(4.6, 0.9, -7.4);
    this.scene.add(glow);

    // Lighting: one dominant warm key, soft ambient/hemisphere fill.
    this.keyLight = new THREE.PointLight(0xffb066, 60, 30, 2);
    this.keyLight.position.set(2.4, 4.6, 2.6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.keyLight);

    this.fireLight = new THREE.PointLight(0xff7733, 26, 16, 2);
    this.fireLight.position.set(4.2, 0.8, -5.6);
    this.scene.add(this.fireLight);

    this.fillLight = new THREE.HemisphereLight(0xbcd0e8, 0x2a2018, 0.55);
    this.scene.add(this.fillLight);

    // Held-dice tray: grounded marker strip (selection is never bloom alone).
    this.trayMat = new THREE.MeshBasicMaterial({
      color: t.select, transparent: true, opacity: 0.18, depthWrite: false,
    });
    const tray = new THREE.Mesh(new THREE.PlaneGeometry(DIE_SPREAD * 5.2, 1.1), this.trayMat);
    tray.rotation.x = -Math.PI / 2;
    tray.position.set(0, 0.015, -1.9);
    this.scene.add(tray);
  }

  makePipTexture(faceValue) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = this.theme.die;
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = this.theme.pip;
    const r = faceValue === 1 ? 15 : 11;
    for (const [px, py] of PIP_LAYOUTS[faceValue]) {
      g.beginPath();
      g.arc(64 + px * 32, 64 + py * 32, r, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  buildDice() {
    const geo = new THREE.BoxGeometry(DIE_SIZE, DIE_SIZE, DIE_SIZE);
    this.dieMats = [];
    for (let face = 1; face <= 6; face++) {
      this.dieMats[FACE_TEXTURE[face]] = new THREE.MeshStandardMaterial({
        map: this.makePipTexture(face), roughness: 0.35, metalness: 0.02,
      });
    }
    const markerGeo = new THREE.RingGeometry(DIE_SIZE * 0.62, DIE_SIZE * 0.78, 24);
    this.markerMat = new THREE.MeshBasicMaterial({
      color: this.theme.select, transparent: true, opacity: 0.85, depthWrite: false,
    });
    for (let i = 0; i < DICE_COUNT; i++) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(geo, this.dieMats);
      body.castShadow = true;
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
      this.emberPoints.material.dispose();
    }
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seedAttr = new Float32Array(count);
    const stream = createStream(`decor:embers:${count}`);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = 4.2 + (stream.next() - 0.5) * 1.6;
      pos[i * 3 + 1] = stream.next() * 2.4 - 0.4;
      pos[i * 3 + 2] = -6.4 + (stream.next() - 0.5) * 1.2;
      seedAttr[i] = stream.next();
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.emberSeeds = seedAttr;
    this.emberMat = new THREE.PointsMaterial({
      color: 0xffa050, size: 0.05, transparent: true, opacity: 0.8,
      depthWrite: false, sizeAttenuation: true,
    });
    this.emberPoints = new THREE.Points(geo, this.emberMat);
    this.emberPoints.layers.set(LAYER_ENV);
    this.scene.add(this.emberPoints);
  }

  // --- theming / quality / camera -------------------------------------------------

  applyTheme(theme) {
    this.theme = theme;
    if (!this.scene) return;
    this.feltMat.color.set(theme.felt);
    this.woodMat.color.set(theme.wood);
    this.floorMat.color.set(theme.wall);
    this.wallMat.color.set(theme.wall);
    this.skyMat.color.set(theme.sky);
    this.fireGlowMat.color.set(theme.accent);
    this.markerMat.color.set(theme.select);
    this.trayMat.color.set(theme.select);
    for (let face = 1; face <= 6; face++) {
      const m = this.dieMats[FACE_TEXTURE[face]];
      m.map?.dispose();
      m.map = this.makePipTexture(face);
      m.needsUpdate = true;
    }
  }

  applyQuality(quality) {
    const tier = QUALITY_TIERS[quality] || QUALITY_TIERS.medium;
    if (!this.gl) return;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, tier.pixelRatio) * tier.renderScale);
    this.gl.shadowMap.enabled = tier.shadows;
    this.keyLight.castShadow = tier.shadows;
    this.buildEmbers(tier.embers);
  }

  applyCameraPreset(name, instant = false) {
    const p = CAMERA_PRESETS[name] || CAMERA_PRESETS.standard;
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    const to = new THREE.Vector3(...p.pos);
    const look = new THREE.Vector3(...p.look);
    if (instant || this.settings.reducedMotion) {
      this.camera.position.copy(to);
      this.camera.lookAt(look);
      this._camLook = look;
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
    });
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
    this.gl.setSize(w, h, false);
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
      this.gl.render(this.scene, this.camera);
    };
    this._raf = requestAnimationFrame(loop);
  }

  animateAmbient(now, dt) {
    if (this.hidden) return; // decorative motion paused while hidden
    // Fire light flicker (seeded phase per frame time; low amplitude).
    const flicker = 0.9 + 0.1 * Math.sin(now * 0.011) * Math.sin(now * 0.0047 + 1.7);
    this.fireLight.intensity = 26 * flicker;
    this.fireGlowMat.opacity = 0.45 + 0.15 * flicker;
    // Ember drift: bounded, pooled, cosmetic.
    if (this.emberPoints && !this.settings.reducedMotion) {
      const pos = this.emberPoints.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const speed = 0.0004 + this.emberSeeds[i] * 0.0008;
        let y = pos.getY(i) + speed * dt;
        if (y > 2.2) y = -0.4;
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
