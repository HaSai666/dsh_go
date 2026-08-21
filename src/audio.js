// 全部音效用 WebAudio 实时合成,零素材。
export class AudioFX {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = localStorage.getItem('othello3d-muted') === '1';
  }

  // 浏览器要求用户手势后才能出声:首次交互时创建,之后恢复挂起的上下文。
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      comp.connect(this.ctx.destination);
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.9;
      this.master.connect(comp);
      // 0.5s 白噪声,各种音效共用。
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('othello3d-muted', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  toggleMuted() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _out() {
    return this.master;
  }

  _blip({ type = 'sine', f0, f1, dur = 0.1, gain = 0.2, when = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) {
      o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this._out());
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  _noiseBurst({ dur = 0.05, gain = 0.2, freq = 2000, q = 1, type = 'bandpass', f1, when = 0 }) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this._out());
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // 落子:低沉"啪" + 短促击打噪声。
  place(flips = 0) {
    const power = Math.min(Math.max(flips, 0), 10);
    this._blip({
      type: 'sine',
      f0: Math.max(125, 190 - power * 6),
      f1: 48,
      dur: 0.16 + power * 0.006,
      gain: 0.42 + power * 0.015,
    });
    this._noiseBurst({ dur: 0.05, gain: 0.24 + power * 0.01, freq: 2400, q: 1.4 });
  }

  // 翻面:五声音阶逐级升高,连锁越多音调越高。
  flip(i = 0) {
    const steps = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];
    const s = steps[Math.min(i, steps.length - 1)];
    const f = 523.25 * Math.pow(2, s / 12);
    this._blip({ type: 'triangle', f0: f, f1: f * 0.9, dur: 0.09, gain: 0.2 });
    this._noiseBurst({ dur: 0.03, gain: 0.12, freq: 3200, q: 0.8 });
  }

  // 大翻盘低音。
  boom() {
    this._blip({ type: 'sine', f0: 90, f1: 30, dur: 0.5, gain: 0.55 });
    this._noiseBurst({ dur: 0.35, gain: 0.3, freq: 900, f1: 120, type: 'lowpass' });
  }

  moveResult({ flips = 0, cards = 0, corner = false, extraTurn = false } = {}) {
    let notes = [];
    if (corner) notes = [659.25, 987.77, 1318.51];
    else if (flips >= 10) notes = [392, 587.33, 783.99, 1174.66];
    else if (flips >= 6) notes = [523.25, 659.25, 987.77];
    else if (flips >= 3) notes = [523.25, 783.99];
    else if (cards >= 2) notes = [440, 659.25];
    if (extraTurn) notes.push(1046.5);
    notes.forEach((f, i) => {
      this._blip({ type: 'triangle', f0: f, dur: 0.18, gain: 0.13, when: i * 0.055 });
    });
  }

  pass() {
    this._blip({ type: 'sine', f0: 220, f1: 160, dur: 0.22, gain: 0.14 });
  }

  error() {
    this._blip({ type: 'square', f0: 130, f1: 110, dur: 0.08, gain: 0.1 });
  }

  click() {
    this._noiseBurst({ dur: 0.03, gain: 0.15, freq: 1500, q: 0.7 });
  }

  win() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this._blip({ type: 'triangle', f0: f, dur: 0.34, gain: 0.22, when: i * 0.1 });
    });
    this._blip({ type: 'sine', f0: 1318.5, dur: 0.7, gain: 0.12, when: 0.45 });
  }

  lose() {
    this._blip({ type: 'sine', f0: 330, f1: 220, dur: 0.4, gain: 0.18 });
    this._blip({ type: 'sine', f0: 260, f1: 165, dur: 0.5, gain: 0.16, when: 0.25 });
  }

  // 抽牌:轻快的纸牌滑动声。
  cardDraw() {
    this._noiseBurst({ dur: 0.09, gain: 0.18, freq: 900, f1: 2600, type: 'bandpass', q: 0.5 });
  }

  // 出牌:每种卡一个标志性小乐句。
  cardPlay(type = 'combo') {
    const seq = {
      combo: [523.25, 659.25, 783.99, 1046.5],
      blast: [392, 311.13, 261.63],
      lucky: [659.25, 880],
      seed: [523.25, 659.25, 783.99],
      shield: [440, 554.37],
      bomb: [311.13, 233.08, 175],
      echo: [783.99, 523.25, 783.99],
      chain: [392, 523.25, 659.25, 783.99],
    }[type] || [523.25];
    seq.forEach((f, i) => {
      this._blip({ type: 'triangle', f0: f, dur: 0.16, gain: 0.22, when: i * 0.08 });
    });
    this._noiseBurst({ dur: 0.06, gain: 0.12, freq: 1800, q: 0.6, when: seq.length * 0.08 });
  }

  // 护盾格挡:金属撞击。
  shield() {
    this._blip({ type: 'square', f0: 880, f1: 440, dur: 0.12, gain: 0.14 });
    this._noiseBurst({ dur: 0.08, gain: 0.2, freq: 4200, q: 2.5 });
  }

  // 爆破:小型爆炸。
  bomb() {
    this._blip({ type: 'sine', f0: 120, f1: 45, dur: 0.25, gain: 0.45 });
    this._noiseBurst({ dur: 0.18, gain: 0.3, freq: 1500, f1: 200, type: 'lowpass' });
  }
}
