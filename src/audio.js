const STORAGE_KEY = 'othello3d-muted';
const BASE_URL = import.meta.env?.BASE_URL || '/';

// A small CC0 foley palette. The procedural layer gives the sounds a shared
// identity while the recordings keep the board and cards feeling physical.
const SAMPLE_POOLS = Object.freeze({
  place: {
    dir: 'assets/kenney/casino-audio/Audio',
    files: ['chip-lay-1.ogg', 'chip-lay-2.ogg', 'chip-lay-3.ogg'],
  },
  flip: {
    dir: 'assets/kenney/casino-audio/Audio',
    files: ['chips-collide-1.ogg', 'chips-collide-2.ogg', 'chips-collide-3.ogg', 'chips-collide-4.ogg'],
  },
  draw: {
    dir: 'assets/kenney/casino-audio/Audio',
    files: [
      'card-fan-1.ogg',
      'card-fan-2.ogg',
      'card-slide-1.ogg',
      'card-slide-2.ogg',
      'card-slide-3.ogg',
      'card-slide-4.ogg',
    ],
  },
  cardPlay: {
    dir: 'assets/kenney/casino-audio/Audio',
    files: ['card-place-1.ogg', 'card-place-2.ogg', 'card-place-3.ogg', 'card-place-4.ogg'],
  },
  shield: {
    dir: 'assets/kenney/casino-audio/Audio',
    files: ['chips-stack-1.ogg', 'chips-stack-2.ogg', 'chips-stack-3.ogg'],
  },
  boom: {
    dir: 'assets/kenney/impact-sounds/Audio',
    files: [
      'impactSoft_medium_000.ogg',
      'impactSoft_medium_001.ogg',
      'impactSoft_heavy_000.ogg',
      'impactSoft_heavy_001.ogg',
      'impactPunch_heavy_000.ogg',
      'impactPunch_heavy_001.ogg',
    ],
  },
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const randomBetween = (min, max) => min + Math.random() * (max - min);

function readMuted() {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = readMuted();
    this.masterLevel = 0.72;
    this.activeVoices = 0;
    this.maxVoices = 36;
    this.sampleBuffers = new Map();
    this.samplePromises = new Map();
    this.lastSamples = new Map();
    this.lastEvents = new Map();
    this.sampleWarmup = null;
  }

  // Browsers only allow an AudioContext after a user gesture.
  ensure() {
    if (!this.ctx) {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;

      this.ctx = new AC();
      const compressor = this.ctx.createDynamicsCompressor();
      compressor.threshold.value = -20;
      compressor.knee.value = 16;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.004;
      compressor.release.value = 0.16;
      compressor.connect(this.ctx.destination);

      this.master = this.ctx.createGain();
      this.master.gain.setValueAtTime(this.muted ? 0 : this.masterLevel, this.ctx.currentTime);
      this.master.connect(compressor);

      const length = Math.floor(this.ctx.sampleRate * 1.25);
      this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

      // Start decoding in the background. The synth fallback is still used
      // for the very first interaction while the OGG buffers are arriving.
      this.sampleWarmup = this._primeSamples();
    }

    if (this.ctx.state === 'suspended') {
      const resume = this.ctx.resume();
      resume?.catch?.(() => {});
    }
    return true;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, this.muted ? '1' : '0');
    } catch {
      // Private browsing can expose a read-only localStorage.
    }
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterLevel, now, 0.025);
    }
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _out() {
    return this.master;
  }

  _canVoice() {
    return Boolean(this.ctx && this.master && !this.muted && this.activeVoices < this.maxVoices);
  }

  _markVoice(source) {
    this.activeVoices++;
    let ended = false;
    const release = () => {
      if (ended) return;
      ended = true;
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    };
    source.addEventListener?.('ended', release, { once: true });
    source.onended = release;
  }

  _allow(event, intervalMs = 0) {
    const now = globalThis.performance?.now?.() ?? Date.now();
    const last = this.lastEvents.get(event) ?? -Infinity;
    if (now - last < intervalMs) return false;
    this.lastEvents.set(event, now);
    return true;
  }

  _poolKey(pool, file) {
    return `${pool}:${file}`;
  }

  async _loadPool(poolName) {
    if (this.samplePromises.has(poolName)) return this.samplePromises.get(poolName);
    const pool = SAMPLE_POOLS[poolName];
    if (!pool || !this.ctx) return false;

    const promise = Promise.all(
      pool.files.map(async (file) => {
        const key = this._poolKey(poolName, file);
        try {
          const url = `${BASE_URL}${pool.dir}/${file}`;
          const response = await fetch(url);
          if (!response.ok) throw new Error(`audio asset ${response.status}`);
          const bytes = await response.arrayBuffer();
          const buffer = await this.ctx.decodeAudioData(bytes);
          this.sampleBuffers.set(key, buffer);
        } catch {
          // A missing/unsupported OGG never blocks play; synths remain usable.
        }
      })
    ).then(() => true);
    this.samplePromises.set(poolName, promise);
    return promise;
  }

  _primeSamples() {
    if (!this.ctx) return Promise.resolve(false);
    const immediate = ['place', 'flip', 'draw', 'cardPlay'];
    const deferred = ['shield', 'boom'];
    const warmDeferred = () => {
      const load = () => void Promise.all(deferred.map((name) => this._loadPool(name)));
      if (globalThis.requestIdleCallback) globalThis.requestIdleCallback(load, { timeout: 1400 });
      else globalThis.setTimeout(load, 900);
    };
    return Promise.all(immediate.map((name) => this._loadPool(name)))
      .then(() => {
        warmDeferred();
        return true;
      })
      .catch(() => false);
  }

  _pickSample(poolName) {
    const pool = SAMPLE_POOLS[poolName];
    if (!pool) return null;
    const loaded = pool.files
      .map((file) => this._poolKey(poolName, file))
      .filter((key) => this.sampleBuffers.has(key));
    if (!loaded.length) return null;

    const previous = this.lastSamples.get(poolName);
    const candidates = loaded.length > 1 ? loaded.filter((key) => key !== previous) : loaded;
    const key = candidates[Math.floor(Math.random() * candidates.length)];
    this.lastSamples.set(poolName, key);
    return this.sampleBuffers.get(key);
  }

  _sample(poolName, { gain = 0.25, rate = 1, when = 0, pan = 0, lowpass = 0 } = {}) {
    if (!this._canVoice()) return false;
    if (!this.samplePromises.has(poolName)) void this._loadPool(poolName);
    const buffer = this._pickSample(poolName);
    if (!buffer) return false;

    const t = this.ctx.currentTime + Math.max(0, when);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const playbackRate = clamp(rate * randomBetween(0.985, 1.015), 0.55, 1.8);
    source.playbackRate.setValueAtTime(playbackRate, t);

    const gainNode = this.ctx.createGain();
    const duration = Math.max(0.025, buffer.duration / playbackRate);
    const attack = Math.min(0.012, duration * 0.25);
    const level = Math.max(0.0001, gain);
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(level, t + attack);
    gainNode.gain.setValueAtTime(level, t + Math.max(attack, duration * 0.35));
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);

    let tail = gainNode;
    if (lowpass > 0) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(lowpass, t);
      filter.Q.value = 0.45;
      source.connect(filter);
      tail = filter;
    } else {
      source.connect(gainNode);
    }
    if (tail !== gainNode) tail.connect(gainNode);

    if (pan && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(pan, -1, 1), t);
      gainNode.connect(panner);
      panner.connect(this._out());
    } else {
      gainNode.connect(this._out());
    }

    this._markVoice(source);
    source.start(t);
    source.stop(t + duration + 0.035);
    return true;
  }

  _tone({ type = 'triangle', f0, f1 = f0, dur = 0.12, gain = 0.1, when = 0, pan = 0, cutoff = 4200 }) {
    if (!this._canVoice()) return false;
    const t = this.ctx.currentTime + Math.max(0, when);
    const duration = Math.max(0.025, dur);
    const attack = Math.min(0.012, duration * 0.24);
    const oscillator = this.ctx.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(20, f0), t);
    if (f1 && f1 !== f0) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + duration);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(Math.max(240, cutoff), t);
    filter.Q.value = 0.35;
    const gainNode = this.ctx.createGain();
    const level = Math.max(0.0001, gain);
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(level, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);

    oscillator.connect(filter);
    filter.connect(gainNode);
    if (pan && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(pan, -1, 1), t);
      gainNode.connect(panner);
      panner.connect(this._out());
    } else {
      gainNode.connect(this._out());
    }

    this._markVoice(oscillator);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.025);
    return true;
  }

  _noiseBurst({ dur = 0.05, gain = 0.08, freq = 1800, f1 = 0, q = 0.7, type = 'bandpass', when = 0, pan = 0 } = {}) {
    if (!this._canVoice() || !this.noise) return false;
    const t = this.ctx.currentTime + Math.max(0, when);
    const duration = Math.max(0.018, dur);
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(Math.max(40, freq), t);
    if (f1) filter.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + duration);
    filter.Q.value = q;
    const gainNode = this.ctx.createGain();
    const level = Math.max(0.0001, gain);
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(level, t + Math.min(0.008, duration * 0.25));
    gainNode.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter);
    filter.connect(gainNode);
    if (pan && this.ctx.createStereoPanner) {
      const panner = this.ctx.createStereoPanner();
      panner.pan.setValueAtTime(clamp(pan, -1, 1), t);
      gainNode.connect(panner);
      panner.connect(this._out());
    } else {
      gainNode.connect(this._out());
    }
    this._markVoice(source);
    source.start(t);
    source.stop(t + duration + 0.025);
    return true;
  }

  _pluck({ f0, f1 = f0 * 0.94, dur = 0.11, gain = 0.07, when = 0, pan = 0, texture = false } = {}) {
    this._tone({ type: 'triangle', f0, f1, dur, gain, when, pan, cutoff: Math.max(1200, f0 * 7) });
    this._tone({ type: 'sine', f0: f0 * 2.01, f1: f1 * 1.98, dur: dur * 0.58, gain: gain * 0.2, when, pan, cutoff: 7600 });
    if (texture) {
      this._noiseBurst({ dur: Math.min(0.035, dur * 0.3), gain: gain * 0.22, freq: f0 * 5.4, q: 1.2, when, pan });
    }
  }

  _thump({ f0 = 120, f1 = 42, dur = 0.24, gain = 0.18, when = 0, pan = 0 } = {}) {
    this._tone({ type: 'sine', f0, f1, dur, gain, when, pan, cutoff: 1100 });
    this._tone({ type: 'triangle', f0: f0 * 1.65, f1: f1 * 1.2, dur: dur * 0.35, gain: gain * 0.18, when, pan, cutoff: 1800 });
    this._noiseBurst({ dur: Math.min(0.09, dur * 0.45), gain: gain * 0.2, freq: 520, f1: 100, type: 'lowpass', q: 0.5, when, pan });
  }

  place(flips = 0) {
    const power = clamp(flips, 0, 10);
    this._sample('place', {
      gain: 0.32 + power * 0.012,
      rate: 0.96 + randomBetween(-0.025, 0.025),
      pan: randomBetween(-0.12, 0.12),
    });
    this._thump({
      f0: 148 - power * 4.5,
      f1: 58,
      dur: 0.2 + power * 0.008,
      gain: 0.1 + power * 0.006,
      pan: randomBetween(-0.08, 0.08),
    });
  }

  flip(index = 0) {
    if (!this._allow('flip', 24)) return;
    const scale = [392, 440, 494, 587, 659, 784];
    const note = scale[(Math.max(0, index) + Math.floor(randomBetween(0, 2.5))) % scale.length];
    const pan = randomBetween(-0.22, 0.22);
    this._sample('flip', { gain: 0.115, rate: 0.97 + randomBetween(-0.025, 0.025), pan });
    this._pluck({ f0: note, f1: note * 0.96, dur: 0.095, gain: 0.045, pan, texture: false });
  }

  boom() {
    if (!this._allow('boom', 90)) return;
    this._sample('boom', { gain: 0.34, rate: 0.88 + randomBetween(-0.025, 0.02), pan: randomBetween(-0.08, 0.08), lowpass: 3600 });
    this._thump({ f0: 92, f1: 30, dur: 0.44, gain: 0.22 });
    this._noiseBurst({ dur: 0.26, gain: 0.1, freq: 760, f1: 120, type: 'lowpass', q: 0.45 });
    this._pluck({ f0: 176, f1: 110, dur: 0.16, gain: 0.035, when: 0.035, texture: true });
  }

  moveResult({ flips = 0, cards = 0, corner = false, extraTurn = false } = {}) {
    if (!corner && flips < 3 && cards < 1 && !extraTurn) return;
    let notes;
    if (corner) notes = [523.25, 659.25, 783.99, 1046.5];
    else if (flips >= 10) notes = [392, 493.88, 587.33, 783.99];
    else if (flips >= 6) notes = [440, 523.25, 659.25];
    else if (flips >= 3) notes = [440, 587.33];
    else notes = [493.88, 659.25];

    notes.forEach((note, index) => {
      this._pluck({
        f0: note * randomBetween(0.995, 1.005),
        f1: note * 0.985,
        dur: corner ? 0.2 : 0.15,
        gain: corner ? 0.095 : 0.065,
        when: index * 0.072 + randomBetween(-0.008, 0.008),
        pan: randomBetween(-0.18, 0.18),
        texture: index === 0,
      });
    });
    if (extraTurn) {
      this._pluck({ f0: 1046.5, f1: 988, dur: 0.23, gain: 0.1, when: notes.length * 0.072 + 0.03, texture: true });
    }
  }

  pass() {
    if (!this._allow('pass', 120)) return;
    this._tone({ type: 'triangle', f0: 258, f1: 184, dur: 0.2, gain: 0.055, cutoff: 1800 });
    this._noiseBurst({ dur: 0.08, gain: 0.018, freq: 1200, f1: 420, type: 'bandpass', q: 0.45 });
  }

  error() {
    if (!this._allow('error', 90)) return;
    this._pluck({ f0: 196, f1: 170, dur: 0.085, gain: 0.05, texture: true });
    this._pluck({ f0: 156, f1: 132, dur: 0.1, gain: 0.04, when: 0.075, texture: false });
  }

  click() {
    if (!this._allow('click', 28)) return;
    this._tone({ type: 'triangle', f0: 620, f1: 440, dur: 0.055, gain: 0.045, cutoff: 4200 });
    this._noiseBurst({ dur: 0.018, gain: 0.025, freq: 2600, q: 1.1 });
  }

  win() {
    if (!this._allow('win', 300)) return;
    this._sample('shield', { gain: 0.2, rate: 1.08, pan: randomBetween(-0.08, 0.08) });
    const notes = [523.25, 587.33, 659.25, 783.99, 987.77];
    const times = [0, 0.085, 0.17, 0.28, 0.42];
    notes.forEach((note, index) => {
      this._pluck({ f0: note, f1: note * 0.99, dur: 0.24, gain: 0.09 - index * 0.006, when: times[index] + randomBetween(-0.006, 0.006), pan: randomBetween(-0.16, 0.16), texture: index === 0 });
    });
    this._noiseBurst({ dur: 0.2, gain: 0.025, freq: 5000, f1: 1800, q: 0.55, when: 0.36 });
  }

  lose() {
    if (!this._allow('lose', 300)) return;
    this._thump({ f0: 112, f1: 48, dur: 0.3, gain: 0.12 });
    this._pluck({ f0: 330, f1: 246, dur: 0.28, gain: 0.065, when: 0.05, texture: false });
    this._pluck({ f0: 247, f1: 185, dur: 0.34, gain: 0.055, when: 0.2, texture: false });
  }

  cardDraw() {
    if (!this._allow('cardDraw', 55)) return;
    this._sample('draw', { gain: 0.28, rate: 1.02 + randomBetween(-0.035, 0.035), pan: randomBetween(-0.16, 0.16) });
    this._noiseBurst({ dur: 0.045, gain: 0.018, freq: 3400, f1: 1800, q: 0.45 });
  }

  cardPlay(type = 'combo') {
    const profiles = {
      combo: [523.25, 659.25, 783.99],
      blast: [392, 329.63, 261.63],
      lucky: [659.25, 783.99],
      seed: [493.88, 587.33, 659.25],
      shield: [440, 554.37, 659.25],
      bomb: [311.13, 233.08, 174.61],
      echo: [783.99, 659.25, 783.99],
      chain: [392, 493.88, 587.33, 783.99],
    };
    const notes = profiles[type] || profiles.combo;
    this._sample('cardPlay', { gain: 0.25, rate: 0.96 + randomBetween(-0.025, 0.025), pan: randomBetween(-0.12, 0.12) });
    notes.forEach((note, index) => {
      this._pluck({
        f0: note,
        f1: note * 0.98,
        dur: 0.14,
        gain: type === 'bomb' ? 0.045 : 0.06,
        when: index * 0.065 + randomBetween(-0.006, 0.006),
        pan: randomBetween(-0.16, 0.16),
        texture: index === 0,
      });
    });
    if (type === 'bomb') this._thump({ f0: 106, f1: 38, dur: 0.26, gain: 0.12, when: 0.08 });
    if (type === 'shield') this._noiseBurst({ dur: 0.12, gain: 0.035, freq: 4200, f1: 1800, q: 1.4, when: 0.09 });
  }

  shield() {
    if (!this._allow('shield', 80)) return;
    this._sample('shield', { gain: 0.3, rate: 1.02 + randomBetween(-0.025, 0.025), pan: randomBetween(-0.1, 0.1) });
    this._pluck({ f0: 880, f1: 660, dur: 0.16, gain: 0.065, texture: true });
    this._noiseBurst({ dur: 0.1, gain: 0.03, freq: 4800, f1: 2200, q: 1.3 });
  }

  bomb() {
    if (!this._allow('bomb', 55)) return;
    this._sample('boom', { gain: 0.24, rate: 0.92 + randomBetween(-0.03, 0.02), pan: randomBetween(-0.14, 0.14), lowpass: 2600 });
    this._thump({ f0: 118, f1: 42, dur: 0.24, gain: 0.14 });
    this._noiseBurst({ dur: 0.14, gain: 0.065, freq: 900, f1: 180, type: 'lowpass', q: 0.55 });
  }
}
