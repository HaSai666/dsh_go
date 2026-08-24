// WebGL 帧时间回归:覆盖无尽模式的 8×8 常规盘面与 10×10 后期盘面。
import { chromium } from 'playwright-core';

const URL = process.env.URL || 'http://localhost:5173/';
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-gpu', '--hide-scrollbars', '--ignore-gpu-blocklist'],
});

let fails = 0;

async function measure(label, viewport, deviceScaleFactor) {
  const context = await browser.newContext({ viewport, deviceScaleFactor });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.click('#mode-cards');
  await page.waitForFunction(() => window.__game?.phase === 'idle');

  const sample = (size) => page.evaluate(async (boardSize) => {
    const size = boardSize;
    const board = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => ((r + c) % 4 === 0 ? 0 : (r + c) % 2 + 1))
    );
    const legal = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (board[r][c] === 0) legal.push([r, c]);
      }
    }
    window.__ctx.resizeBoard(size);
    window.__ctx.syncBoard(board);
    window.__ctx.setLegal(legal);

    const sampleFrames = (count) => new Promise((resolve) => {
      const stamps = [];
      const tick = (time) => {
        stamps.push(time);
        if (stamps.length >= count + 1) {
          resolve(stamps.slice(1).map((stamp, index) => stamp - stamps[index]));
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await sampleFrames(30);
    const intervals = await sampleFrames(180);
    const ordered = [...intervals].sort((a, b) => a - b);
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const p95 = ordered[Math.floor(ordered.length * 0.95)];
    const slowRatio = intervals.filter((value) => value > 25).length / intervals.length;
    return {
      mean,
      p95,
      slowRatio,
      pixelRatio: window.__ctx.renderer.getPixelRatio(),
      calls: window.__ctx.renderer.info.render.calls,
      triangles: window.__ctx.renderer.info.render.triangles,
    };
  }, size);

  const profiles = [
    {
      name: '常规 8×8',
      size: 8,
      limits: { mean: 20.5, p95: 34, slowRatio: 0.15 },
    },
    {
      name: '后期 10×10',
      size: 10,
      limits: label === '桌面'
        ? { mean: 28, p95: 55, slowRatio: 0.5 }
        : { mean: 20.5, p95: 28, slowRatio: 0.08 },
    },
  ];

  for (const profile of profiles) {
    const result = await sample(profile.size);
    const pass =
      result.mean <= profile.limits.mean &&
      result.p95 <= profile.limits.p95 &&
      result.slowRatio <= profile.limits.slowRatio;
    if (!pass) fails++;
    console.log(
      `${pass ? '✅' : '❌'} ${label} ${profile.name}` +
      ` — 平均 ${result.mean.toFixed(2)}ms | P95 ${result.p95.toFixed(2)}ms | 慢帧 ${(result.slowRatio * 100).toFixed(1)}%` +
      ` | DPR ${result.pixelRatio.toFixed(2)} | draw calls ${result.calls} | triangles ${result.triangles}`
    );
  }
  if (errors.length) {
    fails++;
    console.log(`❌ ${label}运行错误: ${errors.join(' | ')}`);
  }
  await context.close();
}

await measure('桌面', { width: 1440, height: 900 }, 2);
await measure('移动端', { width: 390, height: 844 }, 3);
await browser.close();

if (fails) process.exit(1);
console.log('✅ WebGL 性能预算全部通过');
