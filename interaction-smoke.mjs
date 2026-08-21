// 快速浏览器回归:键盘棋盘、重复卡牌、模态焦点、设置记忆与减少动态效果。
// 用法: node interaction-smoke.mjs   (需 dev 服务器在 5173 运行)
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

async function openPage(context) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 });
  return { page, errors };
}

const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const { page, errors } = await openPage(context);

const initialA11y = await page.evaluate(() => ({
  appInert: document.getElementById('app').inert,
  hudHidden: document.getElementById('hud').getAttribute('aria-hidden'),
  dialogsHidden: [...document.querySelectorAll('[role="dialog"]')].every(
    (dialog) => dialog.hidden
  ),
}));
ok(
  '主页正确隔离游戏控件',
  initialA11y.appInert && initialA11y.hudHidden === 'true' && initialA11y.dialogsHidden
);

// 从真实 Tab/Enter 路径进入游戏,确保 focus-visible 与棋盘键盘预览同时生效。
await page.keyboard.press('Tab');
ok('Tab 首先聚焦经典模式', (await page.evaluate(() => document.activeElement?.id)) === 'mode-classic');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.__game?.phase === 'idle' && window.__game?.legal.length > 0);
const firstLabel = await page.locator('#app canvas').getAttribute('aria-label');
ok('进入游戏后键盘焦点落到棋盘', await page.locator('#app canvas').evaluate((el) => el === document.activeElement));
ok('棋盘播报当前合法落点', firstLabel?.includes('合法落点'), firstLabel || '无标签');

await page.keyboard.press('ArrowRight');
const nextLabel = await page.locator('#app canvas').getAttribute('aria-label');
ok('方向键切换合法落点', Boolean(nextLabel && nextLabel !== firstLabel), nextLabel || '无标签');
await page.keyboard.press('Enter');
await page.waitForFunction(
  () =>
    window.__game.trace.some((event) => event.mark === 'move' && event.args[0] === 'black') &&
    ((window.__game.phase === 'idle' && window.__game.turn === 1) || window.__game.phase === 'over'),
  null,
  { timeout: 20000 }
);
ok('Enter 在所选合法格落子', true);

await page.selectOption('#sel-diff', 'hard');
await page.reload({ waitUntil: 'networkidle' });
ok('难度设置跨刷新保留', (await page.locator('#sel-diff').inputValue()) === 'hard');

await page.click('#mode-cards');
await page.waitForFunction(() => window.__game?.phase === 'idle' && window.__game?.mode === 'cards');
await page.evaluate(() => {
  window.__ui.setCardEnergy(1, '先手首轮');
  window.__ui.renderHand(['combo', 'seed'], true);
});
await page.locator('#cardbar-cards .card').nth(0).evaluate((button) => button.click());
const openingBudget = await page.evaluate(() => ({
  selected: window.__ui.getSelectedCards(),
  unaffordable: document.querySelectorAll('#cardbar-cards .card.unaffordable').length,
}));
ok(
  '首轮行动力会阻止高费爆发',
  openingBudget.selected.length === 0 && openingBudget.unaffordable === 1,
  JSON.stringify(openingBudget)
);
await page.locator('#cardbar-cards .card').nth(1).click();
ok('首轮仍可选择低费卡', JSON.stringify(await page.evaluate(() => window.__ui.getSelectedCards())) === '["seed"]');

await page.evaluate(() => {
  window.__ui.clearCardSelection();
  window.__ui.setCardEnergy(3);
  window.__ui.renderHand(['echo', 'blast'], true);
});
ok(
  '回响不能作为队列首牌',
  (await page.locator('#cardbar-cards .card').nth(0).getAttribute('aria-disabled')) === 'true'
);
await page.locator('#cardbar-cards .card').nth(1).click();
await page.locator('#cardbar-cards .card').nth(0).click();
ok(
  '回响可接在有效前置卡之后',
  JSON.stringify(await page.evaluate(() => window.__ui.getSelectedCards())) === '["blast","echo"]'
);

await page.evaluate(() => {
  window.__ui.clearCardSelection();
  window.__ui.setCardEnergy(4, '逆风 +1');
  window.__ui.renderHand(['blast', 'blast', 'combo'], true);
});
await page.locator('#cardbar-cards .card').nth(0).click();
await page.locator('#cardbar-cards .card').nth(1).click();
const duplicateCards = await page.evaluate(() => ({
  selected: window.__ui.getSelectedCards(),
  pressed: [...document.querySelectorAll('#cardbar-cards .card[aria-pressed="true"]')].length,
}));
ok(
  '同名卡牌可逐张独立选择',
  duplicateCards.pressed === 2 &&
    duplicateCards.selected.length === 2 &&
    duplicateCards.selected.every((id) => id === 'blast'),
  JSON.stringify(duplicateCards)
);

await page.evaluate(() => window.__ui.setShield(2));
const shieldStatus = await page.evaluate(() => ({
  visible: !document.getElementById('statusbar').classList.contains('hidden'),
  text: document.getElementById('statusbar').textContent,
}));
ok('护盾归属持续可见', shieldStatus.visible && shieldStatus.text.includes('电脑'));
await page.evaluate(() => window.__ui.setShield(null));

await page.evaluate(() =>
  window.__ui.showGameOver({ title: '测试结束', score: '1 : 0', sub: '焦点检查' })
);
await page.waitForTimeout(50);
const dialogOpen = await page.evaluate(() => ({
  hidden: document.getElementById('overlay').hidden,
  active: document.activeElement?.id,
  appInert: document.getElementById('app').inert,
}));
ok(
  '终局对话框接管焦点并隔离背景',
  !dialogOpen.hidden && dialogOpen.active === 'btn-again' && dialogOpen.appInert,
  JSON.stringify(dialogOpen)
);
await page.keyboard.press('Tab');
ok('单按钮对话框焦点保持在内部', (await page.evaluate(() => document.activeElement?.id)) === 'btn-again');
await page.evaluate(() => window.__ui.hideGameOver());
const dialogClosed = await page.evaluate(() => ({
  hidden: document.getElementById('overlay').hidden,
  appInert: document.getElementById('app').inert,
}));
ok('关闭对话框后恢复棋盘交互', dialogClosed.hidden && !dialogClosed.appInert);
ok('标准交互流程无运行错误', errors.length === 0, errors.join(' | '));
await context.close();

const reducedContext = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  reducedMotion: 'reduce',
});
const { page: reducedPage, errors: reducedErrors } = await openPage(reducedContext);
const rotationBefore = await reducedPage.evaluate(() => window.__ctx.boardGroup.rotation.y);
await reducedPage.waitForTimeout(500);
const rotationAfter = await reducedPage.evaluate(() => window.__ctx.boardGroup.rotation.y);
ok(
  '减少动态效果时主页棋盘保持静止',
  Math.abs(rotationAfter - rotationBefore) < 0.00001,
  `Δ=${Math.abs(rotationAfter - rotationBefore).toFixed(6)}`
);
await reducedPage.click('#mode-classic');
const reducedDrop = await reducedPage.evaluate(async () => {
  const ctx = window.__ctx;
  const piece = ctx.placePiece(0, 0, window.__consts.BLACK);
  const before = piece.mesh.position.y;
  await ctx.dropPiece(piece);
  return { before, after: piece.mesh.position.y, cellY: ctx.cellY };
});
ok(
  '减少动态效果时落子立即就位',
  reducedDrop.before > reducedDrop.after && Math.abs(reducedDrop.after - (reducedDrop.cellY + 0.05)) < 0.001,
  JSON.stringify(reducedDrop)
);
ok('减少动态效果流程无运行错误', reducedErrors.length === 0, reducedErrors.join(' | '));
await reducedContext.close();

await browser.close();
console.log(fails === 0 ? '✅ 交互冒烟全部通过' : `❌ ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);
