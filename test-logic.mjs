// 规则引擎 + AI 快速自测(node 直接运行,不依赖浏览器)。
import {
  BLACK,
  WHITE,
  EMPTY,
  SIZE,
  initialBoard,
  createBoard,
  legalMoves,
  applyMove,
  countDiscs,
  isGameOver,
  flipsFor,
  spawnBoard,
  BOARD_PATTERNS,
  RICH_PATTERNS,
} from './src/game.js';
import { chooseMove } from './src/ai.js';
import {
  MAX_HAND_CAP,
  boardSizeFor,
  createRunBoard,
  createRun,
  grantReward,
  handCapFor,
  rewardOptionsFor,
  runConfigFor,
  startingHandFor,
} from './src/run.js';

let fails = 0;
function check(name, cond, extra = '') {
  if (cond) {
    console.log(`  ok  ${name}`);
  } else {
    fails++;
    console.log(`FAIL  ${name} ${extra}`);
  }
}

// 初始局面(12×12,中心 (5,5))
const b0 = initialBoard();
check('初始 4 子', countDiscs(b0).black === 2 && countDiscs(b0).white === 2);
check('黑方初始合法步为 4', legalMoves(b0, BLACK).length === 4);

// 一步经典棋:(4,5) 黑 → 翻 (5,5)
const m1 = applyMove(b0, 4, 5, BLACK);
check('(4,5) 落子合法', m1 !== null);
check('(4,5) 翻 1 子(5,5)', JSON.stringify(m1.flipped) === '[[5,5]]');

// 多样化开局阵型:全部黑白对称且存在合法步(含 24 子富开局)
for (const variant of [...BOARD_PATTERNS, ...RICH_PATTERNS]) {
  const b = spawnBoard(variant);
  const c = countDiscs(b);
  check(
    `开局阵型 ${variant} 黑白对称且有合法步(${c.black + c.white} 子)`,
    c.black === c.white && legalMoves(b, BLACK).length > 0 && legalMoves(b, WHITE).length > 0
  );
}
// 富开局至少 20 子
for (const variant of RICH_PATTERNS) {
  const c = countDiscs(spawnBoard(variant));
  check(`富开局 ${variant} ≥20 子`, c.black + c.white >= 20);
}

// 快局棋盘尺寸:8/10 尺寸开局与阵型正常
for (const size of [8, 10]) {
  const b = initialBoard(size);
  check(
    `${size}×${size} 初始局面合法`,
    b.length === size && legalMoves(b, BLACK).length > 0 && legalMoves(b, WHITE).length > 0
  );
  const b2 = spawnBoard('cross', size);
  const c2 = countDiscs(b2);
  check(
    `${size}×${size} 十字阵对称且合法`,
    b2.length === size && c2.black === c2.white && legalMoves(b2, BLACK).length > 0
  );
}

// 走完一整局随机对局,验证不崩溃、终局一致
let board = initialBoard();
let player = BLACK;
let steps = 0;
while (!isGameOver(board) && steps < 200) {
  const mv = chooseMove(board, player, 'normal');
  if (mv) {
    const res = applyMove(board, mv[0], mv[1], player);
    if (!res) {
      check(`第 ${steps} 步 ${player} 非法落子`, false);
      break;
    }
    board = res.board;
  }
  player = player === BLACK ? WHITE : BLACK;
  steps++;
}
check('整局正常结束(无异常)', isGameOver(board), `steps=${steps}`);
check('整局步数足够(≥40,防止瞬间终局)', steps >= 40);
const end = countDiscs(board);
check(`终局子数合计 ${SIZE * SIZE}`, end.black + end.white === SIZE * SIZE);

// 每档 AI 都能在当前局面给出合法步
const mid = applyMove(b0, 4, 5, BLACK).board;
for (const d of ['easy', 'normal', 'hard']) {
  const mv = chooseMove(mid, WHITE, d);
  check(`${d} AI 给合法步`, mv !== null && flipsFor(mid, mv[0], mv[1], WHITE).length > 0, JSON.stringify(mv));
}

// 终局各档不崩
for (const d of ['easy', 'normal', 'hard']) {
  const mv = chooseMove(board, player, d);
  check(`${d} AI 终局返回 null`, mv === null);
}

// ---------- 卡牌模式纯逻辑 ----------
import {
  CARD_ENERGY_MAX,
  drawCard,
  HAND_MAX,
  CARD_POOL,
  cardEnergy,
  cardEnergyForTurn,
  comebackActive,
  cardBlast,
  cardLucky,
  cardSeed,
  cardBomb,
  cardChain,
  cornerBonus,
} from './src/game.js';
import { chooseCards } from './src/ai.js';

// 抽牌:上限与增长
{
  const hand = [];
  for (let i = 0; i < HAND_MAX + 3; i++) drawCard(hand);
  check('抽牌不超过手牌上限', hand.length === HAND_MAX);
  check('抽到的都是合法卡', hand.every((id) => CARD_POOL.some((c) => c.id === id)));
}
// 爆裂:落点 8 邻域对手子
{
  const b = createBoard();
  b[3][3] = BLACK;
  b[3][4] = WHITE;
  b[2][3] = WHITE;
  b[4][4] = WHITE;
  const hits = cardBlast(b, 3, 3, BLACK);
  check('爆裂翻 8 邻域对手子', hits.length === 3 && JSON.stringify(hits.sort()) === JSON.stringify([[2, 3], [3, 4], [4, 4]]));
}
// 天佑:随机 n 枚对手子
{
  const b = createBoard();
  b[0][0] = WHITE;
  b[7][7] = WHITE;
  b[5][5] = WHITE;
  const hits = cardLucky(b, BLACK, 2);
  check('天佑翻 2 枚对手子', hits.length === 2 && hits.every(([r, c]) => b[r][c] === WHITE));
}
// 播种:与己方相邻的空格
{
  const b = createBoard();
  b[0][0] = BLACK;
  const s = cardSeed(b, BLACK);
  check('播种选中相邻空格', s !== null && Math.max(Math.abs(s[0]), Math.abs(s[1])) === 1 && b[s[0]][s[1]] === EMPTY);
  check('无相邻空格时播种落空', cardSeed(createBoard(), BLACK) === null);
}
// 爆破:随机移除 2 枚对手子(全部选中对手子)
{
  const b = createBoard();
  b[0][0] = WHITE;
  b[7][7] = WHITE;
  b[5][5] = WHITE;
  b[2][2] = BLACK;
  const hits = cardBomb(b, BLACK, 2);
  check('爆破移除 2 枚对手子', hits.length === 2 && hits.every(([r, c]) => b[r][c] === WHITE));
}
// 连锁:只选与己方相邻的对手子
{
  const b = createBoard();
  b[0][0] = BLACK;
  b[0][1] = WHITE;
  b[1][0] = WHITE;
  b[7][7] = WHITE; // 不相邻,不应被选中
  const hits = cardChain(b, BLACK, 3);
  check('连锁只选相邻敌子', hits.length === 2 && hits.every(([r, c]) => b[r][c] === WHITE));
}
// 王冠角子计数
{
  const b = createBoard();
  b[0][0] = BLACK;
  b[0][SIZE - 1] = BLACK;
  b[SIZE - 1][0] = WHITE;
  check('角子计数', cornerBonus(b, BLACK) === 2 && cornerBonus(b, WHITE) === 1);
}
// 终局精确解:残局只剩一个合法步时,hard AI 必须走对
{
  const b = createBoard();
  b[3][3] = BLACK; // 唯一黑锚
  b[3][4] = WHITE;
  b[3][5] = WHITE;
  b[3][6] = EMPTY; // 唯一合法步:夹击翻 2 子并终局
  const mv = chooseMove(b, BLACK, 'hard');
  check('hard AI 终局精确解', mv !== null && mv[0] === 3 && mv[1] === 6, JSON.stringify(mv));
}
// AI 选牌:返回手牌子集且不超过难度上限
{
  const hand = ['blast', 'combo', 'lucky', 'shield'];
  const picks = chooseCards(initialBoard(), hand, WHITE, 4, 5, 'normal', 3);
  check(
    'AI 选牌是手牌子集且不超行动力',
    picks.every((id) => hand.includes(id)) && picks.length <= 2 && cardEnergy(picks) <= 3
  );
}
// AI 能识别顺序敏感的低费组合
{
  const b = createBoard();
  b[3][3] = BLACK;
  b[3][4] = WHITE;
  b[4][4] = WHITE;
  b[2][3] = WHITE;
  const hand = ['echo', 'blast', 'seed'];
  const picks = chooseCards(b, hand, BLACK, 3, 3, 'hard', 3);
  check(
    'hard AI 在预算内安排回响顺序',
    cardEnergy(picks) <= 3 && (!picks.includes('echo') || picks.indexOf('echo') > 0),
    JSON.stringify(picks)
  );
}
// 卡牌模式下 AI 正常出招
const midCard = applyMove(b0, 4, 5, BLACK).board;
for (const d of ['easy', 'normal', 'hard']) {
  const mv = chooseMove(midCard, WHITE, d);
  check(`${d} AI 卡牌模式给合法步`, mv !== null && flipsFor(midCard, mv[0], mv[1], WHITE).length > 0);
}

// ---------- 无尽模式成长 ----------
{
  const run = createRun();
  check(
    '无尽模式前 3 关为 8×8,随后封顶 10×10',
    boardSizeFor(1) === 8 && boardSizeFor(3) === 8 && boardSizeFor(4) === 10 && boardSizeFor(99) === 10
  );
  for (const level of [1, 4, 99]) {
    for (const variant of RICH_PATTERNS) {
      const board = createRunBoard(level, variant);
      const counts = countDiscs(board);
      const empty = board.length ** 2 - counts.black - counts.white;
      check(
        `快局 ${level} 关 ${variant} 对称且最多 48 个空位`,
        counts.black === counts.white &&
          empty <= 48 &&
          legalMoves(board, BLACK).length > 0 &&
          legalMoves(board, WHITE).length > 0,
        `${board.length}×${board.length},empty=${empty}`
      );
    }
  }
  check(
    '敌方成长配置按关卡递增并封顶',
    runConfigFor(1).handBonus === 0 &&
      runConfigFor(3).handBonus === 1 &&
      runConfigFor(99).handBonus === 6 &&
      runConfigFor(99).extraDiscs === 10 &&
      runConfigFor(99).budget === 800
  );

  check('手牌大师奖励可领取', grantReward(run, { kind: 'relic', id: 'hat' }));
  check('手牌大师只增加 1 手牌上限', run.handCap === 5 && handCapFor(run, BLACK) === 5);
  check('重复遗物不会再次生效', !grantReward(run, { kind: 'relic', id: 'hat' }) && run.handCap === 5);

  check('奖励卡加入后续关卡起始手牌', grantReward(run, { kind: 'card', id: 'blast' }) && startingHandFor(run).includes('blast'));
  run.bonus.push('combo', 'lucky', 'seed', 'shield', 'bomb');
  const opening = startingHandFor(run);
  check('起始奖励卡不突破手牌上限', opening.length === handCapFor(run, BLACK) && opening.at(-1) === 'bomb');

  run.relics = ['crown', 'hat', 'magnet', 'clover'];
  run.handCap = MAX_HAND_CAP;
  const opts = rewardOptionsFor(run, () => 0);
  const keys = opts.map((opt) => `${opt.kind}:${opt.id || ''}`);
  check('满成长时仍提供 3 个有效战利品', opts.length === 3 && opts.every((opt) => opt.kind === 'card'));
  check('同屏战利品不重复', new Set(keys).size === keys.length);
}

// ---------- 卡牌行动力与反雪球 ----------
{
  check('卡牌费用可组合计算', cardEnergy(['blast', 'echo']) === 3 && cardEnergy(['combo']) === 3);
  check(
    '首回合先手 1 点/后手 2 点行动力',
    cardEnergyForTurn(initialBoard(), BLACK, 0, BLACK) === 1 &&
      cardEnergyForTurn(initialBoard(), WHITE, 0, BLACK) === 2
  );
  check('常规回合为 3 点行动力', cardEnergyForTurn(initialBoard(), BLACK, 1, BLACK) === CARD_ENERGY_MAX);

  const trailing = createBoard();
  for (let c = 0; c < 14; c++) trailing[Math.floor(c / 12)][c % 12] = WHITE;
  trailing[5][5] = BLACK;
  check(
    '落后达到阈值时触发逆风行动力',
    comebackActive(trailing, BLACK) && cardEnergyForTurn(trailing, BLACK, 1, BLACK) === CARD_ENERGY_MAX + 1
  );
}

console.log(fails === 0 ? '\n全部通过 ✅' : `\n${fails} 项失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
