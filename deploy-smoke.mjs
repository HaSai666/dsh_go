// 部署冒烟测试:线上站点能否正常启动游戏(主页可见、经典模式可进入、无报错)。
import { chromium } from 'file:///D:/wk_github/dsh_test/othello3d/node_modules/playwright-core/index.mjs';

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--enable-gpu', '--hide-scrollbars', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text());
});
await page.goto('https://hasai666.github.io/dsh_go/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(1500);
const homeVisible = (await page.locator('#home:not(.hidden)').count()) === 1;
const title = await page.title();
console.log('title:', title);
console.log('home visible:', homeVisible);
console.log('errors:', errs.length, errs.join(' | '));
await page.click('#mode-classic');
await page.waitForTimeout(2500);
const phase = await page.evaluate(() => (window.__game ? window.__game.phase : 'no-game'));
console.log('game phase after classic start:', phase);
await browser.close();
process.exit(errs.length === 0 && homeVisible && phase === 'idle' ? 0 : 1);
