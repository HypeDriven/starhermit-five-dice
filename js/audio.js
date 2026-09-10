// Five Dice — audio module.
// Sounds are original: authored sample one-shots (sfx/*.opus, listed in
// sfx/manifest.json) preferred per event, with WebAudio synthesis as the
// fallback while a sample loads or when it is unavailable — dice rattles and
// felt landings tied to logical events, quiet fire-crackle ambience, and an
// adaptive generative music stem. Buses: music / effects / ambience / voice,
// each with an independent slider. Seeded variants keep replays consistent.

import { createStream, getCategory, UPPER_BONUS_THRESHOLD } from './rules.js';

export class AudioEngine {
  constructor(settings, emitCaption = () => {}) {
    this.settings = settings;       // live settings object (volumes 0..1, muted)
    this.emitCaption = emitCaption; // text cues for meaningful audio
    this.ctx = null;
    this.buses = {};
    this.musicTimer = null;
    this.ambienceSrc = null;
    this.crackleTimer = null;
    this.stream = createStream('audio-variants');
    this.started = false;
    this.sfxNames = null;      // Set of clip basenames from sfx/manifest.json
    this.sfxCache = new Map(); // name -> AudioBuffer | Promise (loading) | null (failed)
    this.ambienceSample = null; // looping authored hearth loop once decoded
  }

  // Must be called from a user gesture.
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
    for (const bus of ['music', 'effects', 'ambience', 'voice']) {
      const g = this.ctx.createGain();
      g.connect(this.master);
      this.buses[bus] = g;
    }
    this.applyVolumes();
    this.startAmbience();
    this.startMusic();
    this.started = true;
    this.loadSfxManifest();
  }

  // --- authored sample one-shots -------------------------------------------------
  // Clips from sfx/manifest.json are fetched/decoded/cached lazily on first use,
  // after the user-gesture unlock above. Events prefer their mapped sample; the
  // synthesized sound runs only while the sample is loading or if it failed.

  async loadSfxManifest() {
    try {
      const res = await fetch('sfx/manifest.json');
      if (!res.ok) throw new Error(`sfx manifest ${res.status}`);
      const list = await res.json();
      this.sfxNames = new Set(list.map((c) => c.name));
      this.startSampledAmbience();
    } catch {
      this.sfxNames = new Set();
    }
  }

  // Authored hearth loop (sfx/ambience-hearth.opus) replaces the synthesized
  // room noise + crackle once decoded; the synth keeps running until then and
  // stays as the permanent fallback if the clip is missing or fails to decode.
  async startSampledAmbience() {
    if (!this.ctx || this.ambienceSample || !this.sfxNames?.has('ambience-hearth')) return;
    try {
      const res = await fetch('sfx/ambience-hearth.opus');
      if (!res.ok) throw new Error(`ambience ${res.status}`);
      const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
      if (!this.ctx || this.ambienceSample) return;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = this.ctx.createGain();
      g.gain.value = 1.6; // loop is normalized to -20 LUFS; lift toward the synth level
      src.connect(g).connect(this.buses.ambience);
      src.start();
      this.ambienceSample = src;
      this.ambienceSrc?.stop();
      this.ambienceSrc = null;
      clearInterval(this.crackleTimer);
      this.crackleTimer = null;
    } catch { /* synth ambience remains */ }
  }

  // Play a cached sample through the effects bus (current mute/volume apply via
  // the bus gain); kick off a lazy load on first use. Returns true only when a
  // decoded sample actually played, so callers fall back to synthesis otherwise.
  playSfx(name) {
    if (!this.ctx || !this.sfxNames || !this.sfxNames.has(name)) return false;
    const cached = this.sfxCache.get(name);
    if (cached instanceof AudioBuffer) {
      const src = this.ctx.createBufferSource();
      src.buffer = cached;
      src.connect(this.buses.effects);
      src.start();
      return true;
    }
    if (cached === undefined) {
      this.sfxCache.set(name, (async () => {
        try {
          const res = await fetch(`sfx/${name}.opus`);
          if (!res.ok) throw new Error(`sfx ${name} ${res.status}`);
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
          this.sfxCache.set(name, buf);
        } catch {
          this.sfxCache.set(name, null); // permanent fallback to synthesis
        }
      })());
    }
    return false;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.settings;
    this.master.gain.value = s.muted ? 0 : 1;
    this.buses.music.gain.value = (s.volMusic ?? 0.5) * 0.45;
    this.buses.effects.gain.value = (s.volEffects ?? 0.8);
    this.buses.ambience.gain.value = (s.volAmbience ?? 0.4) * 0.4;
    this.buses.voice.gain.value = (s.volVoice ?? 0.8);
  }

  caption(text) {
    if (this.settings.captions) this.emitCaption(text);
  }

  // --- synth primitives -------------------------------------------------------

  blip(bus, { freq = 440, dur = 0.08, type = 'sine', gain = 0.25, slide = 0, delay = 0 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.buses[bus]);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  noiseHit(bus, { dur = 0.05, freq = 1200, gain = 0.2, delay = 0, q = 1.5 }) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = 0x2f6e2b1;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i] = ((s / 0x3fffffff) - 1) * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t0);
  }

  // A die landing on felt: short knock + filtered rattle tap.
  dieTick(delay = 0, variant = 1) {
    this.noiseHit('effects', { dur: 0.04, freq: 1500 * variant, gain: 0.16, delay });
    this.blip('effects', { freq: 190 * variant, dur: 0.07, type: 'triangle', gain: 0.14, slide: -70, delay });
  }

  // --- event mapping ------------------------------------------------------------

  onGameEvent(e) {
    if (!this.ctx) return;
    const v = 0.94 + this.stream.next() * 0.12; // seeded pitch variant
    switch (e.type) {
      case 'roll': {
        if (!this.playSfx('dice-roll')) {
          const n = e.rolled?.length || 5;
          for (let i = 0; i < n; i++) {
            this.dieTick(0.03 + i * 0.07 + this.stream.next() * 0.03, v + i * 0.05);
          }
        }
        const n = e.rolled?.length || 5;
        this.caption(`${n} ${n === 1 ? 'die' : 'dice'} rolled`);
        break;
      }
      case 'hold':
        if (!this.playSfx(e.held ? 'die-hold' : 'die-release')) {
          this.blip('effects', { freq: e.held ? 540 * v : 360 * v, dur: 0.06, type: 'sine', gain: 0.12 });
        }
        this.caption(e.held ? 'Die held' : 'Die released');
        break;
      case 'score': {
        const cat = getCategory(e.category);
        // Fixed-point lower hands (Full Lodge, Ridge Path, Summit Trail) get
        // their own "hand made" cue; Avalanche keeps its cascade.
        const madeHand = e.points > 0 && cat && cat.points != null && cat.id !== 'avalanche';
        const key = e.category === 'avalanche' && e.points > 0 ? 'score-avalanche'
          : madeHand ? 'score-hand'
          : e.points > 0 ? 'score-points' : 'score-zero';
        if (!this.playSfx(key)) {
          const base = 392 * Math.pow(1.0595, Math.min(10, Math.floor(e.points / 5)));
          this.blip('effects', { freq: base * v, dur: 0.16, type: 'sine', gain: 0.2 });
          this.blip('effects', { freq: base * 1.5 * v, dur: 0.2, type: 'sine', gain: 0.14, delay: 0.07 });
          if (e.category === 'avalanche' && e.points > 0) {
            [523, 659, 784, 1047].forEach((f, i) =>
              this.blip('effects', { freq: f, dur: 0.3, type: 'sine', gain: 0.18, delay: 0.15 + i * 0.1 }));
          }
        }
        this.caption(`${e.points} points scored`);
        // Upper bonus crossed on this very score: layer the lodge-bonus cue.
        const b = e.breakdown;
        if (b && b.bonus > 0 && cat?.section === 'upper' && b.upper - e.points < UPPER_BONUS_THRESHOLD) {
          if (!this.playSfx('score-bonus')) {
            [523, 659, 784].forEach((f, i) =>
              this.blip('effects', { freq: f, dur: 0.25, type: 'sine', gain: 0.16, delay: 0.25 + i * 0.09 }));
          }
          this.caption('Lodge bonus earned');
        }
        break;
      }
      case 'turn':
        if (!this.playSfx('turn-start')) {
          this.blip('effects', { freq: 300 * v, dur: 0.1, type: 'triangle', gain: 0.1, slide: 60 });
        }
        break;
      case 'invalid':
        if (!this.playSfx('invalid-move')) {
          this.blip('effects', { freq: 160, dur: 0.15, type: 'square', gain: 0.08, slide: -40 });
        }
        this.caption('That action is not legal');
        break;
      case 'finish':
        if (e.reason === 'cards-complete') {
          if (!this.playSfx('finish-cards')) {
            [523, 659, 784, 1047].forEach((f, i) =>
              this.blip('effects', { freq: f, dur: 0.3, type: 'sine', gain: 0.2, delay: i * 0.11 }));
          }
          this.caption('All cards complete — table finished');
        } else {
          if (!this.playSfx('finish-table')) {
            [392, 330, 262].forEach((f, i) =>
              this.blip('effects', { freq: f, dur: 0.3, type: 'sine', gain: 0.18, delay: i * 0.14 }));
          }
          this.caption('Table over');
        }
        break;
      case 'hint':
        if (!this.playSfx('hint-chime')) {
          this.blip('effects', { freq: 880, dur: 0.1, type: 'sine', gain: 0.12 });
        }
        break;
      case 'undo':
        if (!this.playSfx('undo-sweep')) {
          this.blip('effects', { freq: 340, dur: 0.09, type: 'triangle', gain: 0.14, slide: -80 });
        }
        break;
      default:
        break;
    }
  }

  uiClick() {
    this.ensure(); // always invoked from a click/tap: safe to unlock here
    if (!this.ctx) return;
    if (!this.playSfx('ui-click')) {
      this.blip('effects', { freq: 660, dur: 0.04, type: 'sine', gain: 0.08 });
    }
  }

  // --- presentation cues (not rules events) -----------------------------------------

  // Pre-round countdown: one tick per number, a brighter "go" when the table opens.
  countdownTick(final = false) {
    if (!this.ctx) return;
    if (final) {
      if (!this.playSfx('countdown-go')) {
        this.blip('effects', { freq: 660, dur: 0.12, type: 'triangle', gain: 0.14 });
        this.blip('effects', { freq: 990, dur: 0.16, type: 'triangle', gain: 0.12, delay: 0.09 });
      }
      this.caption('Go');
      return;
    }
    if (!this.playSfx('countdown-tick')) {
      this.blip('effects', { freq: 440, dur: 0.08, type: 'triangle', gain: 0.12 });
    }
  }

  // Results verdict, played when the results overlay opens (after the finish cue).
  result(won) {
    if (!this.ctx) return;
    if (!this.playSfx(won ? 'result-win' : 'result-lose')) {
      const seq = won ? [523, 659, 784, 1047, 1319] : [440, 392, 330];
      seq.forEach((f, i) => this.blip('effects', { freq: f, dur: 0.28, type: 'sine', gain: 0.16, delay: i * 0.12 }));
    }
    this.caption(won ? 'You take the table' : 'The lodge keeps its crown');
  }

  achievement() {
    if (!this.ctx) return;
    if (!this.playSfx('achievement-unlock')) {
      [880, 1109, 1319, 1760].forEach((f, i) =>
        this.blip('effects', { freq: f, dur: 0.22, type: 'sine', gain: 0.12, delay: i * 0.07 }));
    }
    this.caption('Achievement unlocked');
  }

  lessonComplete() {
    if (!this.ctx) return;
    if (!this.playSfx('lesson-complete')) {
      this.blip('effects', { freq: 784, dur: 0.12, type: 'sine', gain: 0.12 });
      this.blip('effects', { freq: 1047, dur: 0.18, type: 'sine', gain: 0.12, delay: 0.1 });
    }
    this.caption('Lesson complete');
  }

  // --- ambience: quiet fire-crackle over low room noise --------------------------

  startAmbience() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    let s = 987654321;
    for (let i = 0; i < len; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      data[i] = ((s / 0x3fffffff) - 1) * 0.3;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260;
    src.connect(f).connect(this.buses.ambience);
    src.start();
    this.ambienceSrc = src;
    // Sparse seeded crackle pops.
    const crackle = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      if (this.stream.next() < 0.5) {
        this.noiseHit('ambience', {
          dur: 0.02 + this.stream.next() * 0.03,
          freq: 1800 + this.stream.next() * 2200,
          gain: 0.05 + this.stream.next() * 0.06,
        });
      }
    };
    this.crackleTimer = setInterval(crackle, 700);
  }

  // --- adaptive generative music stem --------------------------------------------
  // Slow fireside pentatonic; density rises with scored points.

  startMusic() {
    if (this.musicTimer) return;
    const scale = [262, 294, 330, 392, 440, 523, 587];
    let step = 0;
    this.intensity = 0;
    const tick = () => {
      if (!this.ctx || this.ctx.state !== 'running') return;
      step++;
      const dense = this.intensity > 0 ? 2 : 4;
      if (step % dense === 0) {
        const note = scale[Math.floor(this.stream.next() * scale.length)];
        this.blip('music', { freq: note, dur: 0.55, type: 'sine', gain: 0.11 });
        if (this.stream.next() < 0.3 + this.intensity * 0.2) {
          this.blip('music', { freq: note * 1.5, dur: 0.4, type: 'sine', gain: 0.06, delay: 0.18 });
        }
      }
      if (step % 16 === 0) {
        this.blip('music', { freq: 131, dur: 1.3, type: 'triangle', gain: 0.09 });
      }
      this.intensity = Math.max(0, this.intensity - 0.02);
    };
    this.musicTimer = setInterval(tick, 320);
  }

  excite() { this.intensity = Math.min(1, this.intensity + 0.4); }

  setBackgrounded(hidden) {
    // Background tabs: keep the graph but suspend to save battery.
    if (!this.ctx) return;
    if (hidden) this.ctx.suspend();
    else this.ctx.resume();
  }
}
