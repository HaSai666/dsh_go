// 轻量补间动画、棋盘震动与粒子爆裂 —— 解压手感的核心。
import * as THREE from 'three';

function sparkTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const glow = context.createRadialGradient(32, 32, 1, 32, 32, 31);
  glow.addColorStop(0, 'rgba(255,255,255,1)');
  glow.addColorStop(0.22, 'rgba(255,255,255,.95)');
  glow.addColorStop(0.52, 'rgba(255,255,255,.42)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = glow;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const easings = {
  linear: (k) => k,
  easeInQuad: (k) => k * k,
  easeOutCubic: (k) => 1 - Math.pow(1 - k, 3),
  easeOutBack: (k) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  },
};

export class Tweens {
  constructor() {
    this.list = [];
  }

  add({ dur = 0.3, delay = 0, ease = easings.easeOutCubic, update, done } = {}) {
    const tw = { t: -delay, dur, ease, update, done };
    this.list.push(tw);
    return tw;
  }

  // runDone: 重置棋盘时让挂起的动画立即收尾(它们的 Promise 需要 resolve)。
  clear(runDone = false) {
    if (runDone) {
      for (const tw of this.list) {
        if (tw.done) tw.done();
      }
    }
    this.list.length = 0;
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const tw = this.list[i];
      tw.t += dt;
      if (tw.t < 0) continue;
      const k = Math.min(tw.t / tw.dur, 1);
      tw.update(tw.ease(k), k);
      if (k >= 1) {
        this.list.splice(i, 1);
        if (tw.done) tw.done();
      }
    }
  }
}

// 棋盘震动:落子拍击时调用。
export function shakeBoard(group, tweens, strength = 0.05) {
  tweens.add({
    dur: 0.4,
    ease: easings.linear,
    update: (_, k) => {
      const a = strength * (1 - k);
      group.position.y = Math.sin(k * Math.PI * 7) * a * 0.9;
      group.rotation.x = Math.sin(k * Math.PI * 5) * a * 0.35;
      group.rotation.z = Math.cos(k * Math.PI * 6) * a * 0.3;
    },
    done: () => {
      group.position.y = 0;
      group.rotation.x = 0;
      group.rotation.z = 0;
    },
  });
}

// 金色粒子爆裂:大翻盘时用。
export class Burst {
  constructor(scene, shouldReduceMotion = () => false) {
    this.shouldReduceMotion = shouldReduceMotion;
    this.max = 300;
    this.active = 0;
    this.age = 0;
    this.pos = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({
      color: 0xffc96b,
      size: 0.14,
      map: sparkTexture(),
      transparent: true,
      opacity: 1,
      alphaTest: 0.015,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.points.visible = false;
    scene.add(this.points);
  }

  spawn(x, y, z, count = 120, color = 0xffc96b) {
    if (this.shouldReduceMotion()) {
      this.points.visible = false;
      this.active = 0;
      return;
    }
    const n = Math.min(count, this.max);
    this.mat.color.setHex(color);
    this.active = n;
    this.age = 0;
    for (let i = 0; i < n; i++) {
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.random() * Math.PI * 0.45;
      const sp = 1.2 + Math.random() * 2.2;
      this.vel[i * 3] = Math.cos(th) * Math.sin(ph) * sp;
      this.vel[i * 3 + 1] = Math.cos(ph) * sp + 1.2;
      this.vel[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * sp;
      this.life[i] = 0.8 + Math.random() * 0.6;
    }
    this.points.visible = true;
    this.mat.opacity = 1;
  }

  update(dt) {
    if (!this.points.visible || this.active === 0) return;
    this.age += dt;
    let alive = 0;
    for (let i = 0; i < this.active; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= 5 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      alive++;
    }
    if (alive === 0) {
      this.points.visible = false;
      this.active = 0;
      return;
    }
    this.mat.opacity = Math.max(0, 1 - this.age / 0.9);
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}
