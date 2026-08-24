// 两套导演式新手指引回归:真实点击发光格/卡牌,确认暂停与恢复流程。
import { chromium } from 'playwright-core';

const URL = process.env.URL || 'http://localhost:5173/';
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-gpu', '--hide-scrollbars', '--ignore-gpu-blocklist'],
});

let fails = 0;
const ok = (name, condition, detail = '') => {
  console.log(`${condition ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!condition) fails++;
};

async function clickFirstLegal(page) {
  const point = await page.evaluate(() => {
    const [r, c] = window.__game.legal[0];
    const ctx = window.__ctx;
    const vector = new window.__THREE.Vector3(ctx.cellX(c), ctx.cellY + 0.05, ctx.cellZ(r));
    vector.project(ctx.camera);
    return {
      x: ((vector.x + 1) / 2) * innerWidth,
      y: ((-vector.y + 1) / 2) * innerHeight,
    };
  });
  await page.mouse.click(point.x, point.y);
}

async function freshPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  return { context, page, errors };
}

{
  const { context, page, errors } = await freshPage();
  await page.click('#mode-classic');
  await page.waitForFunction(() => window.__ui.isDirectorActive());
  ok('经典指引从目标说明开始', (await page.locator('#director-progress').textContent()) === '1 / 5');
  await page.click('#director-next');
  await clickFirstLegal(page);
  await page.waitForFunction(() => window.__game.tutorialPaused && window.__ui.directorStep()?.id === 'flip', null, { timeout: 20000 });
  ok('经典完成第一手后暂停并解释翻面', true);
  await page.click('#director-next');
  await page.click('#director-next');
  await page.click('#director-next');
  await page.waitForFunction(() => !window.__ui.isDirectorActive() && !window.__game.tutorialPaused);
  ok('经典指引完成后恢复对手回合', true);
  ok('经典指引完成状态已记忆', (await page.evaluate(() => localStorage.getItem('othello3d-tutorial-classic'))) === '1');
  ok('经典指引无运行错误', errors.length === 0, errors.join(' | '));
  await context.close();
}

{
  const { context, page, errors } = await freshPage();
  await page.click('#mode-cards');
  await page.waitForFunction(() => window.__ui.directorStep()?.id === 'goal');
  await page.click('#director-next');
  await page.waitForFunction(() => window.__ui.directorStep()?.id === 'card');
  const target = page.locator('.card.director-target');
  ok('无尽指引高亮建议卡牌', (await target.count()) === 1);
  await target.click({ force: true });
  await page.waitForFunction(() => window.__ui.directorStep()?.id === 'board');
  await clickFirstLegal(page);
  await page.waitForFunction(() => window.__game.tutorialPaused && window.__ui.directorStep()?.id === 'combo', null, { timeout: 20000 });
  ok('无尽完成出牌后暂停并解释连招', true);
  await page.click('#director-next');
  await page.click('#director-next');
  await page.click('#director-next');
  await page.waitForFunction(() => !window.__ui.isDirectorActive() && !window.__game.tutorialPaused);
  ok('无尽指引完成后恢复闯关', true);
  ok('无尽指引完成状态已记忆', (await page.evaluate(() => localStorage.getItem('othello3d-tutorial-cards'))) === '1');
  ok('无尽指引无运行错误', errors.length === 0, errors.join(' | '));
  await context.close();
}

await browser.close();
console.log(fails === 0 ? '✅ 导演指引回归全部通过' : `❌ ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
