// 移动端冒烟:竖屏/横屏下主页可见、进入无尽模式、触屏点击落子成功、棋盘完整可见。
// 用法: node mobile-smoke.mjs   (URL 环境变量可指向线上站点)
import { chromium } from 'file:///D:/wk_github/dsh_test/othello3d/node_modules/playwright-core/index.mjs';

const URL = process.env.URL || 'http://localhost:5173/';
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-gpu', '--hide-scrollbars', '--ignore-gpu-blocklist'],
});

let fails = 0;
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) fails++;
};

async function probe(viewport, label) {
  const context = await browser.newContext({
    viewport,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
    userAgent: UA,
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(m.text());
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1200);
  const homeVisible = (await page.locator('#home:not(.hidden)').count()) === 1;
  ok(`${label} 主页可见`, homeVisible);

  await page.tap('#mode-cards');
  await page.waitForTimeout(1800);
  const runbarVisible = await page.locator('#runbar').isVisible();
  ok(`${label} 关卡栏可见`, runbarVisible);

  // 棋盘四角全部在屏幕内(构图自适应)
  const fit = await page.evaluate(() => {
    const g = window.__game;
    const ctx = window.__ctx;
    const proj = (r, c) => {
      const v = new window.__THREE.Vector3(ctx.cellX(c), ctx.cellY, ctx.cellZ(r));
      v.project(ctx.camera);
      return { r, c, x: ((v.x + 1) / 2) * innerWidth, y: ((-v.y + 1) / 2) * innerHeight };
    };
    const pts = [proj(0, 0), proj(0, 11), proj(11, 0), proj(11, 11)];
    return {
      ok: pts.every((p) => p.x > 4 && p.x < innerWidth - 4 && p.y > 4 && p.y < innerHeight - 4),
      pts: pts.map((p) => `(${p.r},${p.c})->(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '),
    };
  });
  ok(`${label} 棋盘完整可见`, fit.ok, fit.pts);

  // 触屏点击合法落点
  const pt = await page.evaluate(() => {
    const g = window.__game;
    const ctx = window.__ctx;
    const [r, c] = g.legal[0];
    const v = new window.__THREE.Vector3(ctx.cellX(c), ctx.cellY + 0.1, ctx.cellZ(r));
    v.project(ctx.camera);
    return { r, c, x: ((v.x + 1) / 2) * innerWidth, y: ((-v.y + 1) / 2) * innerHeight };
  });
  const probeInfo = await page.evaluate(
    (p) => {
      const ctx = window.__ctx;
      const info = {
        inner: [innerWidth, innerHeight],
        dpr: devicePixelRatio,
        camPos: ctx.camera.position.toArray(),
        target: ctx.controls.target.toArray(),
      };
      // 反查:该屏幕点应该命中哪个格子
      const ndc = new window.__THREE.Vector2(
        (p.x / innerWidth) * 2 - 1,
        -(p.y / innerHeight) * 2 + 1
      );
      const ray = new window.__THREE.Raycaster();
      ray.setFromCamera(ndc, ctx.camera);
      const cells = [];
      window.__ctx.scene.traverse((o) => {
        if (o.userData && o.userData.r !== undefined) cells.push(o);
      });
      const hits = ray.intersectObjects(cells, false);
      info.rayHits = hits.length ? [hits[0].object.userData.r, hits[0].object.userData.c] : null;
      return info;
    },
    pt
  );
  console.log(`   [${label}] 投影目标=(${pt.r},${pt.c}) 屏幕=(${pt.x.toFixed(0)},${pt.y.toFixed(0)})`);
  console.log(`   [${label}] inner=${probeInfo.inner} dpr=${probeInfo.dpr} 射线反查=${JSON.stringify(probeInfo.rayHits)}`);
  await page.touchscreen.tap(pt.x, pt.y);
  await page.waitForTimeout(800);
  // 用事件轨迹断言"玩家"的落子(电脑应手可能已经发生,不能看 lastMove)
  const touched = await page.evaluate(
    ([r, c]) => {
      const g = window.__game;
      return g.trace.some(
        (e) => e.mark === 'move' && e.args[0] === 'black' && e.args[1] === r && e.args[2] === c
      );
    },
    [pt.r, pt.c]
  );
  ok(`${label} 触屏落子成功`, touched, `目标(${pt.r},${pt.c})`);

  // 手牌上限拉满(10 张)时全部可见(自动换行,不溢出)
  await page.evaluate(() => {
    const g = window.__game;
    g.run.handCap = 10;
    g.refill(1);
    window.__ui.renderHand(g.hands[1], true);
  });
  await page.waitForTimeout(400);
  const manyCards = await page.evaluate(() => {
    const w = innerWidth;
    const els = [...document.querySelectorAll('#cardbar-cards .card')];
    const allVisible = els.every((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.left >= -2 && r.right <= w + 2;
    });
    return { count: els.length, allVisible };
  });
  ok(
    `${label} 10 张手牌完整显示`,
    manyCards.count === 10 && manyCards.allVisible,
    `cards=${manyCards.count} allVisible=${manyCards.allVisible}`
  );

  ok(`${label} 无运行错误`, errs.length === 0, errs.join(' | '));
  await context.close();
}

await probe({ width: 390, height: 844 }, '竖屏 390×844');
await probe({ width: 844, height: 390 }, '横屏 844×390');

await browser.close();
console.log(fails === 0 ? '✅ 移动端冒烟全部通过' : `❌ ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
