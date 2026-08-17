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
} from './src/game.js';
import { chooseMove } from './src/ai.js';

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

// 多样化开局阵型:四种全部黑白对称且存在合法步
for (const variant of BOARD_PATTERNS) {
  const b = spawnBoard(variant);
  const c = countDiscs(b);
  check(
    `开局阵型 ${variant} 黑白对称且有合法步`,
    c.black === c.white && legalMoves(b, BLACK).length > 0 && legalMoves(b, WHITE).length > 0
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
  drawCard,
  HAND_MAX,
  CARD_POOL,
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
  const picks = chooseCards(initialBoard(), hand, WHITE, 4, 5, 'normal');
  check('AI 选牌是手牌子集', picks.every((id) => hand.includes(id)) && picks.length <= 2);
}
// 卡牌模式下 AI 正常出招
const midCard = applyMove(b0, 4, 5, BLACK).board;
for (const d of ['easy', 'normal', 'hard']) {
  const mv = chooseMove(midCard, WHITE, d);
  check(`${d} AI 卡牌模式给合法步`, mv !== null && flipsFor(midCard, mv[0], mv[1], WHITE).length > 0);
}

console.log(fails === 0 ? '\n全部通过 ✅' : `\n${fails} 项失败 ❌`);
process.exit(fails === 0 ? 0 : 1);
