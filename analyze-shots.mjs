// 截图像素级 QA:亮度/色彩构成、棋子对比、高亮与幽灵子可见性、阴影、
// 大翻盘粒子,以及动画逐帧差分(动态感量化)。
// 用法: node analyze-shots.mjs   (先跑 debug-headless.mjs 生成截图)
import fs from 'node:fs';
import { PNG } from 'pngjs';

const DIR = 'debug-shots';
const meta = JSON.parse(fs.readFileSync(`${DIR}/meta.json`, 'utf8'));

function load(name) {
  return PNG.sync.read(fs.readFileSync(`${DIR}/${name}.png`));
}

const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function px(png, x, y) {
  x = Math.max(0, Math.min(png.width - 1, Math.round(x)));
  y = Math.max(0, Math.min(png.height - 1, Math.round(y)));
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

function discMean(png, cx, cy, radius) {
  let L = 0, R = 0, G = 0, B = 0, n = 0;
  for (let dy = -radius; dy <= radius; dy += 2) {
    for (let dx = -radius; dx <= radius; dx += 2) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      const [r, g, b] = px(png, x, y);
      L += lum([r, g, b]);
      R += r;
      G += g;
      B += b;
      n++;
    }
  }
  return { L: L / n, R: R / n, G: G / n, B: B / n };
}

function ringMean(png, cx, cy, r0, r1) {
  let L = 0, n = 0;
  for (let dy = -r1; dy <= r1; dy += 2) {
    for (let dx = -r1; dx <= r1; dx += 2) {
      const d = Math.hypot(dx, dy);
      if (d < r0 || d > r1) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= png.width || y >= png.height) continue;
      L += lum(px(png, x, y));
      n++;
    }
  }
  return L / n;
}

function globalStats(png) {
  let Lsum = 0, n = 0, white = 0, green = 0, dark = 0;
  for (let y = 0; y < png.height; y += 4) {
    for (let x = 0; x < png.width; x += 4) {
      const [r, g, b] = px(png, x, y);
      const L = lum([r, g, b]);
      Lsum += L;
      n++;
      if (L > 150 && r > 135 && g > 135 && b > 115) white++;
      if (g > r + 10 && g > b + 10 && L > 30 && L < 170) green++;
      if (L < 45) dark++;
    }
  }
  return {
    meanL: Lsum / n,
    whitePct: (white / n) * 100,
    greenPct: (green / n) * 100,
    darkPct: (dark / n) * 100,
  };
}

const report = [];
let fails = 0;
function check(name, cond, detail) {
  report.push(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
}
function info(name, detail) {
  report.push(`ℹ️  ${name} — ${detail}`);
}

const c01 = load('c01-初始局面');
const c02 = load('c02-悬停预览');
const c07 = load('c07-中局');
const c08 = load('c08-大翻盘粒子');
const c09 = load('c09-大翻盘后');

// 棋盘放大后,采样半径按"格子间距"(像素)自适应。
const P = Math.abs(meta.cells['6,5'].y - meta.cells['5,5'].y);

// ① 全局亮度与色彩构成
for (const [name, img] of [['初始', c01], ['中局', c07], ['大翻盘', c08]]) {
  const s = globalStats(img);
  info(`全局(${name})`, `亮度 ${s.meanL.toFixed(1)} | 白子 ${s.whitePct.toFixed(1)}% | 棋盘绿 ${s.greenPct.toFixed(1)}% | 暗部 ${s.darkPct.toFixed(1)}%`);
}
const s0 = globalStats(c01);
check('整体亮度适中(35~125)', s0.meanL > 35 && s0.meanL < 125, `均值 ${s0.meanL.toFixed(1)}`);
check('棋盘绿色可见(>8%)', s0.greenPct > 8, `${s0.greenPct.toFixed(1)}%`);
check('白色棋子可见(>0.4%)', s0.whitePct > 0.4, `${s0.whitePct.toFixed(1)}%`);

// ② 棋子对比度(12×12:白子 (5,5),黑子 (6,5))
const w = discMean(c01, meta.cells['5,5'].x, meta.cells['5,5'].y, 0.32 * P);
const b = discMean(c01, meta.cells['6,5'].x, meta.cells['6,5'].y, 0.32 * P);
info('白子(5,5)中心', `L=${w.L.toFixed(1)} RGB=(${w.R.toFixed(0)},${w.G.toFixed(0)},${w.B.toFixed(0)})`);
info('黑子(6,5)中心', `L=${b.L.toFixed(1)} RGB=(${b.R.toFixed(0)},${b.G.toFixed(0)},${b.B.toFixed(0)})`);
check('白子足够亮(L>120)', w.L > 120);
check('黑子足够暗(L<74)', b.L < 74);
check('黑白棋子对比强烈(差>60)', w.L - b.L > 60, `差 ${(w.L - b.L).toFixed(1)}`);

// ③ 合法格高亮((4,5) 为合法步,(7,7) 为普通空格)
const hl = discMean(c01, meta.cells['4,5'].x, meta.cells['4,5'].y, 0.22 * P);
const off = discMean(c01, meta.cells['7,7'].x, meta.cells['7,7'].y, 0.22 * P);
const hlGain = hl.G - off.G;
info('高亮格(4,5) vs 普通格(7,7)', `绿通道 ${hl.G.toFixed(0)} vs ${off.G.toFixed(0)}`);
check('合法格发光明显(ΔG>10)', hlGain > 10, `ΔG=${hlGain.toFixed(1)}`);

// ④ 悬停幽灵子(用视差稳定后的实际屏幕坐标)
const meta2 = JSON.parse(fs.readFileSync(`${DIR}/meta2.json`, 'utf8'));
const h2 = discMean(c02, meta2.cells['4,5'].x, meta2.cells['4,5'].y, 0.24 * P);
check('幽灵子悬停可见(变暗>6)', hl.L - h2.L > 6, `ΔL=${(hl.L - h2.L).toFixed(1)}`);

// ⑤ 阴影验证:关闭投影与开启投影两帧在棋盘中心区域的局部差异。
function mad(a, b2) {
  let s = 0, n = 0;
  for (let y = 0; y < a.height; y += 6) {
    for (let x = 0; x < a.width; x += 6) {
      s += Math.abs(lum(px(a, x, y)) - lum(px(b2, x, y)));
      n++;
    }
  }
  return s / n;
}
function localMad(a, b2, cx, cy, half) {
  let s = 0, n = 0;
  for (let y = Math.max(0, cy - half); y < Math.min(a.height, cy + half); y += 2) {
    for (let x = Math.max(0, cx - half); x < Math.min(a.width, cx + half); x += 2) {
      s += Math.abs(lum(px(a, x, y)) - lum(px(b2, x, y)));
      n++;
    }
  }
  return n ? s / n : 0;
}
const boardCx = (meta.cells['5,5'].x + meta.cells['6,5'].x) / 2;
const boardCy = (meta.cells['5,5'].y + meta.cells['6,5'].y) / 2;
const shadowDiff = localMad(load('shadow-on'), load('shadow-off'), boardCx, boardCy, 2.2 * P);
info('阴影开关局部帧差', `${shadowDiff.toFixed(2)}`);
check('阴影参与渲染(局部帧差>0.4)', shadowDiff > 0.4);

// ⑥ 大翻盘粒子:粒子爆发时 (3,5) 附近亮度显著高于之后
const burst = discMean(c08, meta.cells['3,5'].x, meta.cells['3,5'].y, 0.36 * P);
const after = discMean(c09, meta.cells['3,5'].x, meta.cells['3,5'].y, 0.36 * P);
info('大翻盘粒子亮度', `爆发中 ${burst.L.toFixed(1)} vs 结束后 ${after.L.toFixed(1)}`);
check('粒子爆裂可见(ΔL>3)', burst.L - after.L > 3, `ΔL=${(burst.L - after.L).toFixed(1)}`);

// ⑦ 动画动态:轨迹引导的定点连拍(坠拍动感 / 思考静止 / 电脑应手)。
const dropDiff = localMad(
  load('drop1'),
  load('drop2'),
  meta.cells['4,5'].x,
  meta.cells['4,5'].y,
  1.4 * P
);
const lullDiff = mad(load('lull1'), load('lull2'));
const aiCell = JSON.parse(fs.readFileSync(`${DIR}/meta3.json`, 'utf8')).cell;
const aiDiff = aiCell
  ? localMad(load('ai1'), load('ai2'), aiCell.x, aiCell.y, 1.4 * P)
  : 0;
info(
  '动画动态(轨迹定点连拍)',
  `坠拍局部帧差 ${dropDiff.toFixed(2)} | 思考间歇 ${lullDiff.toFixed(2)} | 电脑应手局部 ${aiDiff.toFixed(2)}`
);
check('落子坠拍有动态(局部帧差>2)', dropDiff > 2);
check('电脑思考期静止(帧差<1.5)', lullDiff < 1.5);
check('电脑应手带动第二波动态(局部>2)', aiDiff > 2);

// ⑧ 静态画面稳定性:静止时连续帧应几乎无变化(帧率级频闪检测)。
// 12 帧连续截图,帧间最大差必须接近零。
const statics = [];
for (let f = 0; f < 12; f++) statics.push(load(`static/${String(f).padStart(2, '0')}`));
let staticMax = 0;
let staticSum = 0;
for (let i = 1; i < statics.length; i++) {
  const d = mad(statics[i], statics[i - 1]);
  staticMax = Math.max(staticMax, d);
  staticSum += d;
}
const staticMean = staticSum / (statics.length - 1);
info('静态画面帧间差', `最大 ${staticMax.toFixed(3)} | 平均 ${staticMean.toFixed(3)}`);
check('静止画面无频闪(最大帧差<0.6)', staticMax < 0.6);

console.log(report.join('\n'));
console.log(fails === 0 ? '\n✅ 质感/动态 QA 全部通过' : `\n❌ ${fails} 项未达标`);
process.exit(fails === 0 ? 0 : 1);
