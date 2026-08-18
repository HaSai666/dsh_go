// 无头调试:主页 → 经典模式全流程 → 返回主页 → 符文模式(Buff)验证。
// 采集控制台/网络错误,真实鼠标交互,分阶段截图与动画逐帧采样。
// 用法: node debug-headless.mjs   (需 dev 服务器在 5173 运行)
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = process.env.URL || 'http://localhost:5173/';
const SHOTS = 'debug-shots';
const ANIM = 'debug-shots/anim';
fs.mkdirSync(ANIM, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  // 尝试真实 GPU 渲染(与用户浏览器同路径);无 GPU 时自动退回 SwiftShader。
  args: ['--enable-gpu', '--hide-scrollbars', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
const pageErrors = [];
const badResponses = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
  else if (msg.type() === 'warning') consoleErrors.push('WARN: ' + msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err)));
page.on('response', (res) => {
  if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
});

// 任何异常都先打印已采集的错误与页面状态再退出,便于定位。
async function dumpFailure(err) {
  console.log(`❌ 脚本异常: ${err.message}`);
  for (const e of badResponses) console.log('   [http]', e);
  for (const e of consoleErrors) console.log('   [console]', e);
  for (const e of pageErrors) console.log('   [pageerror]', e);
  try {
    const s = await page.evaluate(() => ({
      phase: window.__game ? window.__game.phase : null,
      turn: window.__game ? window.__game.turn : null,
      trace: window.__game ? window.__game.trace.slice(-8) : null,
      legal: window.__game ? window.__game.legal.length : null,
      slowmo: window.__QA_SLOWMO,
      homeHidden: document.getElementById('home').classList.contains('hidden'),
    }));
    console.log('   页面状态:', JSON.stringify(s));
  } catch {
    console.log('   (页面状态读取失败)');
  }
  await browser.close();
  process.exit(1);
}
process.on('unhandledRejection', (err) => dumpFailure(err));
process.on('uncaughtException', (err) => dumpFailure(err));

const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const cshot = (name) =>
  page.locator('#app canvas').screenshot({ path: `${SHOTS}/${name}.png` });

async function cellScreen(r, c) {
  return page.evaluate(([r, c]) => {
    const ctx = window.__ctx;
    const v = new window.__THREE.Vector3(ctx.cellX(c), ctx.cellY + 0.1, ctx.cellZ(r));
    v.project(ctx.camera);
    return {
      x: ((v.x + 1) / 2) * window.innerWidth,
      y: ((-v.y + 1) / 2) * window.innerHeight,
    };
  }, [r, c]);
}

async function clickCell(r, c) {
  let p = await cellScreen(r, c);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(900); // 等视差镜头阻尼稳定
  p = await cellScreen(r, c);
  await page.mouse.click(p.x, p.y);
}

async function autoPlayMoves(n) {
  for (let i = 0; i < n; i++) {
    const mv = await page.evaluate(() => {
      const g = window.__game;
      if (g.phase !== 'idle' || g.turn !== window.__consts.BLACK) return null;
      return g.legal.length ? g.legal[0] : null;
    });
    if (!mv) break;
    await clickCell(mv[0], mv[1]);
    // 等电脑应手完整结束(含思考/打牌动画);对局提前结束也视为完成
    await page.waitForFunction(
      () =>
        (window.__game.phase === 'idle' && window.__game.turn === 1) ||
        window.__game.phase === 'over',
      null,
      { timeout: 25000 }
    );
    await page.waitForTimeout(600); // 补牌渲染余量
  }
}

console.log('→ 加载主页');
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await shot('home-主页');
await cshot('home-背景');

console.log('→ 进入经典模式');
await page.click('#mode-classic');
await page.waitForTimeout(1600); // 等主页旋转归零 + 新局就绪

const meta = {
  viewport: { w: 1440, h: 900 },
  cells: {
    '4,5': await cellScreen(4, 5),
    '5,5': await cellScreen(5, 5),
    '6,5': await cellScreen(6, 5),
    '7,7': await cellScreen(7, 7),
    '3,5': await cellScreen(3, 5),
  },
};
fs.writeFileSync(`${SHOTS}/meta.json`, JSON.stringify(meta, null, 2));

await shot('01-初始局面');
await cshot('c01-初始局面');

console.log('→ 静态稳定性采样(检测频闪)');
fs.mkdirSync(`${SHOTS}/static`, { recursive: true });
for (let f = 0; f < 12; f++) {
  await page.waitForTimeout(150);
  await cshot(`static/${String(f).padStart(2, '0')}`);
}

console.log('→ 阴影开关对比(验证投影真实渲染)');
await cshot('shadow-on');
await page.evaluate(() => {
  window.__ctx.sun.castShadow = false;
  window.__ctx.sun.shadow.needsUpdate = true;
  window.__ctx.renderer.shadowMap.needsUpdate = true;
});
await page.waitForTimeout(400);
await cshot('shadow-off');
await page.evaluate(() => {
  window.__ctx.sun.castShadow = true;
  window.__ctx.sun.shadow.needsUpdate = true;
  window.__ctx.renderer.shadowMap.needsUpdate = true;
});
await page.waitForTimeout(400);

console.log('→ 悬停 (4,5)');
let p = await cellScreen(4, 5);
await page.mouse.move(p.x, p.y);
await page.waitForTimeout(900);
p = await cellScreen(4, 5);
fs.writeFileSync(
  `${SHOTS}/meta2.json`,
  JSON.stringify({ viewport: { w: 1440, h: 900 }, cells: { '4,5': p } }, null, 2)
);
await shot('02-悬停预览');
await cshot('c02-悬停预览');

console.log('→ 落子 (4,5):轨迹引导定点抓拍(慢动作模式)');
await page.evaluate(() => { window.__QA_SLOWMO = 6; });
await page.mouse.click(p.x, p.y);
// ① 玩家坠拍动感:慢动作下坠落约 1.8s,棋子进入棋盘区域(1.4~0.35 高度)时两帧连拍
await page.waitForTimeout(1400);
await cshot('drop1');
await page.waitForTimeout(250);
await cshot('drop2');
// ② 电脑思考期:等 trace 出现 think(慢动作下窗口约 2.3s)
await page.waitForFunction(
  () => window.__game.trace.some((e) => e.mark === 'think') && window.__game.phase === 'ai',
  null,
  { timeout: 20000 }
);
await page.waitForTimeout(50);
await cshot('lull1');
await page.waitForTimeout(200);
await cshot('lull2');
// ③ 电脑落子:等 lastMove 变成电脑的落点
await page.waitForFunction(
  () => {
    const g = window.__game;
    return g.phase === 'anim' && g.lastMove && (g.lastMove[0] !== 4 || g.lastMove[1] !== 5);
  },
  null,
  { timeout: 20000 }
);
const aiMove = await page.evaluate(() => window.__game.lastMove);
const aiPos = await cellScreen(aiMove[0], aiMove[1]);
fs.writeFileSync(`${SHOTS}/meta3.json`, JSON.stringify({ cell: aiPos }, null, 2));
// 电脑棋子慢动作坠落约 1.8s,进入棋盘区域时两帧连拍
await page.waitForTimeout(1500);
await cshot('ai1');
await page.waitForTimeout(250);
await cshot('ai2');
// ④ 等回合回到玩家
await page.waitForFunction(
  () => window.__game.phase === 'idle' && window.__game.turn === 1,
  null,
  { timeout: 20000 }
);
await page.evaluate(() => { window.__QA_SLOWMO = 1; });
await page.waitForTimeout(400);
await shot('06-电脑应手');
await cshot('c06-电脑应手');

console.log('→ 经典模式自动对弈');
await autoPlayMoves(5);
await cshot('c07-中局');

console.log('→ 强制大翻盘(一步翻 10 子)');
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = BLACK;
  g.phase = 'idle';
  g.history = [];
  g.board = g.board.map((row) => row.slice().fill(0));
  const set = (r, c, v) => { g.board[r][c] = v; };
  set(3, 0, BLACK); set(0, 5, BLACK); set(0, 2, BLACK); set(5, 5, BLACK); set(5, 7, BLACK);
  set(3, 1, WHITE); set(3, 2, WHITE); set(3, 3, WHITE); set(3, 4, WHITE);
  set(1, 5, WHITE); set(2, 5, WHITE); set(4, 5, WHITE);
  set(1, 3, WHITE); set(2, 4, WHITE); set(4, 6, WHITE);
  window.__ctx.syncBoard(g.board);
  g.updateScore();
  g.commitMove(3, 5, BLACK);
});
await page.waitForTimeout(1000);
await cshot('c08-大翻盘粒子');
await page.waitForTimeout(900);
await cshot('c09-大翻盘后');
await page.evaluate(() => window.__game.newGame());
await page.waitForTimeout(600);
await cshot('c10-重开复位');

console.log('→ 返回主页');
await page.click('#btn-home');
await page.waitForTimeout(1200);
await shot('home2-返回主页');

console.log('→ 进入肉鸽卡牌模式');
await page.click('#mode-cards');
await page.waitForTimeout(1600);
const cardsInfo = await page.evaluate(() => ({
  mode: window.__game.mode,
  level: window.__game.run ? window.__game.run.level : null,
  hand: [...window.__game.hands[1]],
  aiHand: window.__game.hands[2].length,
}));
const uiCardCount = await page.locator('#cardbar-cards .card').count();
const runbarVisible = (await page.locator('#runbar:not(.hidden)').count()) === 1;
if (
  cardsInfo.mode !== 'cards' ||
  cardsInfo.level !== 1 ||
  cardsInfo.hand.length !== 4 ||
  cardsInfo.aiHand !== 5 ||
  uiCardCount !== 4 ||
  !runbarVisible
) {
  console.log(
    `❌ 肉鸽模式初始化异常: mode=${cardsInfo.mode} level=${cardsInfo.level} hand=${cardsInfo.hand.length} aiHand=${cardsInfo.aiHand} uiCards=${uiCardCount} runbar=${runbarVisible}`
  );
  process.exit(1);
}
await shot('cards-初始局面');
await cshot('cards-初始');

console.log('→ 卡牌悬浮介绍');
await page.locator('#cardbar-cards .card').first().hover();
await page.waitForTimeout(350);
const tipVisible = await page
  .locator('#tooltip')
  .evaluate((el) => !el.classList.contains('hidden'));
const tipText = await page.locator('#tooltip').innerText();
if (!tipVisible || tipText.length < 4) {
  console.log(`❌ 卡牌悬浮介绍异常: visible=${tipVisible} text="${tipText}"`);
  process.exit(1);
}
await page.mouse.move(10, 500); // 移开鼠标收起 tooltip

console.log('→ 卡牌触发顺序(顺序即触发顺序)');
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = BLACK;
  g.phase = 'idle';
  g.history = [];
  g.hands = { 1: ['blast', 'lucky', 'seed'], 2: [] };
  g.shieldOwner = null;
  g.board = g.board.map((row) => row.slice().fill(0));
  g.board[3][3] = WHITE; g.board[4][4] = WHITE; g.board[3][4] = BLACK; g.board[4][3] = BLACK;
  window.__ctx.syncBoard(g.board);
  g.legal = window.__gameMod.legalMoves(g.board, BLACK);
  window.__ctx.setLegal(g.legal);
  g.updateScore();
  window.__ui.hideGameOver();
  window.__ui.setCardsMode(true);
  window.__ui.clearCardSelection();
  window.__ui.renderHand(g.hands[1], true);
});
// 依次点 lucky(第 2 张)→ blast(第 1 张),断言队列顺序
await page.locator('#cardbar-cards .card').nth(1).click();
await page.locator('#cardbar-cards .card').nth(0).click();
const queue = await page.evaluate(() => window.__ui.getSelectedCards());
const badgeCount = await page.locator('#cardbar-cards .card-order').count();
if (JSON.stringify(queue) !== JSON.stringify(['lucky', 'blast']) || badgeCount !== 2) {
  console.log(`❌ 触发顺序异常: queue=${JSON.stringify(queue)} badges=${badgeCount}`);
  process.exit(1);
}
// 再点一次 lucky 取消 → 队列只剩 blast
await page.locator('#cardbar-cards .card').nth(1).click();
const queue2 = await page.evaluate(() => window.__ui.getSelectedCards());
if (JSON.stringify(queue2) !== JSON.stringify(['blast'])) {
  console.log(`❌ 取消选牌异常: queue=${JSON.stringify(queue2)}`);
  process.exit(1);
}
// 清空选牌,避免被随后的自动对弈消耗
await page.evaluate(() => window.__ui.clearCardSelection());

console.log('→ 无尽模式自动对弈');
await autoPlayMoves(2);
// 先快照轨迹(重开会清空),再处理对局可能提前结束的情况
const traceSnapshot = await page.evaluate(() =>
  window.__game.trace.map((e) => ({ m: e.mark, a: e.args }))
);
await page.evaluate(() => {
  const g = window.__game;
  if (g.phase === 'over') g.newGame();
});
await page.waitForTimeout(500);
// 每回合补满手牌:玩家补到 4,敌方补到 5
const refillInfo = await page.evaluate(() => ({
  hand: window.__game.hands[1].length,
  aiHand: window.__game.hands[2].length,
}));
if (refillInfo.hand !== 4 || refillInfo.aiHand !== 5) {
  console.log(`❌ 补满手牌异常: hand=${refillInfo.hand} aiHand=${refillInfo.aiHand}`);
  process.exit(1);
}

console.log('→ 强制出牌(💥爆裂:落点 8 邻域敌子全翻)');
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = BLACK;
  g.phase = 'idle';
  g.history = [];
  g.hands = { 1: ['blast'], 2: [] };
  g.shieldOwner = null;
  g.board = g.board.map((row) => row.slice().fill(0));
  const set = (r, c, v) => { g.board[r][c] = v; };
  set(3, 0, BLACK); set(5, 5, BLACK);
  set(3, 1, WHITE); set(3, 2, WHITE); set(3, 3, WHITE); set(3, 4, WHITE);
  set(2, 5, WHITE); set(4, 5, WHITE); set(4, 4, WHITE); set(4, 6, WHITE);
  window.__ctx.syncBoard(g.board);
  g.legal = window.__gameMod.legalMoves(g.board, BLACK);
  window.__ctx.setLegal(g.legal);
  g.updateScore();
  window.__ui.hideGameOver();
  window.__ui.setCardsMode(true);
  window.__ui.clearCardSelection();
  window.__ui.renderHand(g.hands[1], true);
});
await page.click('#cardbar-cards .card'); // 选中爆裂
const selected = await page.locator('#cardbar-cards .card.selected').count();
if (selected !== 1) {
  console.log(`❌ 选卡失败:selected=${selected}`);
  process.exit(1);
}
await clickCell(3, 5);
await page.waitForTimeout(4000);
await cshot('cards-爆裂生效');
const afterCards = await page.evaluate(() => {
  const g = window.__game;
  let black = 0;
  let white = 0;
  for (const row of g.board) {
    for (const v of row) {
      if (v === 1) black++;
      else if (v === 2) white++;
    }
  }
  return { black, white, hand: g.hands[1].length, phase: g.phase };
});
// 预期:夹击翻 5(行 4 + (4,5)),爆裂翻 3((2,5),(4,4),(4,6)) → 11 黑 0 白,手牌清空
const cardsOk =
  afterCards.black === 11 && afterCards.white === 0 && afterCards.hand === 0;
console.log(
  `→ 爆裂出牌校验: 黑=${afterCards.black} 白=${afterCards.white} 手牌=${afterCards.hand} phase=${afterCards.phase}`
);
if (!cardsOk) {
  console.log('❌ 爆裂卡效果校验失败');
  process.exit(1);
}

console.log('→ 强制护盾测试(对手翻转被挡下)');
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = WHITE;
  g.phase = 'anim';
  g.history = [];
  g.hands = { 1: [], 2: [] };
  g.board = g.board.map((row) => row.slice().fill(0));
  g.board[0][0] = WHITE;
  g.board[1][1] = BLACK;
  g.shieldOwner = BLACK; // 黑方护盾:白方下一步翻转无效
  window.__ctx.syncBoard(g.board);
  g.commitMove(2, 2, WHITE, []);
});
// 等护盾格挡事件(此时 AI 尚未行动,断言窗口安全)
await page.waitForFunction(
  () => window.__game.trace.some((e) => e.mark === 'shield'),
  null,
  { timeout: 8000 }
);
const shieldAfter = await page.evaluate(() => ({
  cell11: window.__game.board[1][1], // 期望 1(黑,未被翻)
  cell22: window.__game.board[2][2], // 期望 2(白,已落子)
  shield: window.__game.shieldOwner, // 期望 null(护盾已消耗)
}));
const shieldOk = shieldAfter.cell11 === 1 && shieldAfter.cell22 === 2 && shieldAfter.shield === null;
console.log(`→ 护盾校验: (1,1)=${shieldAfter.cell11} (2,2)=${shieldAfter.cell22} shield=${shieldAfter.shield}`);
if (!shieldOk) {
  console.log('❌ 护盾效果校验失败');
  process.exit(1);
}

console.log('→ 肉鸽过关流程(第 1 关 → 战利品三选一 → 第 2 关)');
await page.evaluate(() => window.__ui.hideGameOver()); // 收起之前的战利品面板
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = BLACK;
  g.phase = 'anim';
  g.history = [];
  g.hands = { 1: [], 2: [] };
  g.shieldOwner = null;
  g.board = g.board.map((row) => row.slice().fill(0));
  // 全盘黑,仅 (3,4)(3,5) 为白,黑落 (3,6) 夹击翻 2 子 → 终局黑大胜,过关
  for (let r = 0; r < g.board.length; r++) {
    for (let c = 0; c < g.board.length; c++) g.board[r][c] = BLACK;
  }
  g.board[3][4] = WHITE;
  g.board[3][5] = WHITE;
  g.board[3][6] = 0;
  window.__ctx.syncBoard(g.board);
  g.commitMove(3, 6, BLACK, []);
});
await page.waitForFunction(
  () => !document.getElementById('reward').classList.contains('hidden'),
  null,
  { timeout: 20000 }
);
const rewardCount = await page.locator('#reward-options .reward-opt').count();
if (rewardCount !== 3) {
  console.log(`❌ 战利品三选一异常: options=${rewardCount}`);
  process.exit(1);
}
await shot('run-过关战利品');
await page.locator('#reward-options .reward-opt').first().click();
await page.waitForTimeout(1500);
const runAfter = await page.evaluate(() => ({
  level: window.__game.run.level,
  relics: window.__game.run.relics.length,
  hand: window.__game.hands[1].length,
  rewardHidden: document.getElementById('reward').classList.contains('hidden'),
}));
console.log(
  `→ 过关流转校验: level=${runAfter.level} relics=${runAfter.relics} hand=${runAfter.hand} rewardHidden=${runAfter.rewardHidden}`
);
if (runAfter.level !== 2 || !runAfter.rewardHidden) {
  console.log('❌ 肉鸽过关流转失败');
  process.exit(1);
}

console.log('→ 肉鸽第 2 关 → 第 3 关(验证敌方特权递增)');
// 第 2 关敌方手牌 = 3 + 手牌+1 = 4
const l2Hand = await page.evaluate(() => window.__game.hands[2].length);
const l2Size = await page.evaluate(() => window.__game.board.length);
if (l2Hand !== 5 || l2Size !== 13) {
  console.log(`❌ 第 2 关敌方配置异常: aiHand=${l2Hand} size=${l2Size}`);
  process.exit(1);
}
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = BLACK;
  g.phase = 'anim';
  g.history = [];
  g.hands = { 1: [], 2: [] };
  g.shieldOwner = null;
  g.board = g.board.map((row) => row.slice().fill(0));
  for (let r = 0; r < g.board.length; r++) {
    for (let c = 0; c < g.board.length; c++) g.board[r][c] = BLACK;
  }
  g.board[3][4] = WHITE;
  g.board[3][5] = WHITE;
  g.board[3][6] = 0;
  window.__ctx.syncBoard(g.board);
  g.commitMove(3, 6, BLACK, []);
});
await page.waitForFunction(
  () => !document.getElementById('reward').classList.contains('hidden'),
  null,
  { timeout: 20000 }
);
await page.locator('#reward-options .reward-opt').first().click();
await page.waitForTimeout(1500);
const l3 = await page.evaluate(() => {
  const g = window.__game;
  let white = 0;
  for (const row of g.board) {
    for (const v of row) {
      if (v === 2) white++;
    }
  }
  return { level: g.run.level, aiHand: g.hands[2].length, white, size: g.board.length };
});
// 第 3 关:敌方手牌上限 4+2=6;白子 = 富开局 12 + 特权 2 = 14;棋盘 14×14
const l3Ok = l3.level === 3 && l3.aiHand === 6 && l3.white === 14 && l3.size === 14;
console.log(`→ 第 3 关特权校验: level=${l3.level} aiHand=${l3.aiHand} white=${l3.white} size=${l3.size}`);
if (!l3Ok) {
  console.log('❌ 第 3 关敌方特权异常');
  process.exit(1);
}

console.log('→ 肉鸽第 3 关 → 第 4 关(验证敌方特权)');
const l3Hand = await page.evaluate(() => window.__game.hands[2].length);
if (l3Hand !== 6) {
  console.log(`❌ 第 3 关敌方手牌异常: ${l3Hand}`);
  process.exit(1);
}
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = BLACK;
  g.phase = 'anim';
  g.history = [];
  g.hands = { 1: [], 2: [] };
  g.shieldOwner = null;
  g.board = g.board.map((row) => row.slice().fill(0));
  for (let r = 0; r < g.board.length; r++) {
    for (let c = 0; c < g.board.length; c++) g.board[r][c] = BLACK;
  }
  g.board[3][4] = WHITE;
  g.board[3][5] = WHITE;
  g.board[3][6] = 0;
  window.__ctx.syncBoard(g.board);
  g.commitMove(3, 6, BLACK, []);
});
// 第 3 关胜利 → 战利品面板
await page.waitForFunction(
  () => !document.getElementById('reward').classList.contains('hidden'),
  null,
  { timeout: 20000 }
);
await page.locator('#reward-options .reward-opt').first().click();
await page.waitForTimeout(1500);
const l4 = await page.evaluate(() => {
  const g = window.__game;
  let white = 0;
  for (const row of g.board) {
    for (const v of row) {
      if (v === 2) white++;
    }
  }
  return { level: g.run.level, aiHand: g.hands[2].length, white, size: g.board.length };
});
// 第 4 关:敌方手牌上限 4+2=6;白子 = 12 + 特权 3 = 15;棋盘 15×15
const l4Ok = l4.level === 4 && l4.aiHand === 6 && l4.white === 15 && l4.size === 15;
console.log(`→ 第 4 关特权校验: level=${l4.level} aiHand=${l4.aiHand} white=${l4.white} size=${l4.size}`);
if (!l4Ok) {
  console.log('❌ 第 4 关敌方特权异常');
  process.exit(1);
}

console.log('→ 无尽模式验证(第 4 关 → 第 5 关,特权持续递增)');
await page.evaluate(() => {
  const { BLACK, WHITE } = window.__consts;
  const g = window.__game;
  g.generation++;
  g.turn = BLACK;
  g.phase = 'anim';
  g.history = [];
  g.hands = { 1: [], 2: [] };
  g.shieldOwner = null;
  g.board = g.board.map((row) => row.slice().fill(0));
  for (let r = 0; r < g.board.length; r++) {
    for (let c = 0; c < g.board.length; c++) g.board[r][c] = BLACK;
  }
  g.board[3][4] = WHITE;
  g.board[3][5] = WHITE;
  g.board[3][6] = 0;
  window.__ctx.syncBoard(g.board);
  g.commitMove(3, 6, BLACK, []);
});
// 第 4 关胜利 → 战利品面板(无尽模式无通关庆祝)
await page.waitForFunction(
  () => !document.getElementById('reward').classList.contains('hidden'),
  null,
  { timeout: 20000 }
);
await page.locator('#reward-options .reward-opt').first().click();
await page.waitForTimeout(1500);
const l5 = await page.evaluate(() => {
  const g = window.__game;
  let white = 0;
  for (const row of g.board) {
    for (const v of row) {
      if (v === 2) white++;
    }
  }
  return { level: g.run.level, aiHand: g.hands[2].length, white, size: g.board.length };
});
// 第 5 关:敌方手牌上限 4+3=7;白子 = 12 + 特权 4 = 16;棋盘 16×16
const l5Ok = l5.level === 5 && l5.aiHand === 7 && l5.white === 16 && l5.size === 16;
console.log(`→ 第 5 关特权校验: level=${l5.level} aiHand=${l5.aiHand} white=${l5.white} size=${l5.size}`);
if (!l5Ok) {
  console.log('❌ 无尽模式特权递增异常');
  process.exit(1);
}

const traceOk =
  traceSnapshot.some((e) => e.m === 'think') &&
  traceSnapshot.some((e) => e.m === 'move' && e.a[0] === 'white');
console.log(`→ 事件轨迹: ${traceSnapshot.map((e) => e.m).join(' → ')}`);
if (!traceOk) {
  console.log('❌ 事件轨迹异常:缺少 think 或电脑落子事件');
  process.exit(1);
}

const gl = await page.evaluate(() => {
  const gl = window.__ctx.renderer.getContext();
  return {
    renderer: gl.getParameter(gl.RENDERER),
    version: gl.getParameter(gl.VERSION),
    depthBits: gl.getParameter(gl.DEPTH_BITS),
  };
});
console.log(`→ WebGL: ${gl.renderer} / ${gl.version} / 深度缓冲 ${gl.depthBits}bit`);
console.log(`→ 网络错误 ${badResponses.length} 条,控制台错误 ${consoleErrors.length} 条,页面异常 ${pageErrors.length} 条`);
for (const e of badResponses) console.log('   [http]', e);
for (const e of consoleErrors) console.log('   [console]', e);
for (const e of pageErrors) console.log('   [pageerror]', e);

await browser.close();
const ok = badResponses.length === 0 && consoleErrors.length === 0 && pageErrors.length === 0;
console.log(ok ? '✅ 调试完成,无报错' : '❌ 存在报错');
process.exit(ok ? 0 : 1);
