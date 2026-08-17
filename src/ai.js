// 三档 AI:简单=贪心+随机、普通=浅层 α-β 剪枝、困难=迭代加深+时限。
// 卡牌模式下由 chooseCards 决定打哪几张牌。
import {
  BLACK,
  SIZE,
  countDiscs,
  legalMoves,
  applyMove,
  flipsFor,
  opponent,
  cardBlast,
  cardSeed,
} from './game.js';

// 位置权重表:按棋盘尺寸生成 —— 角 100,边 10,X 位(角旁斜格)-40,次外圈 -8,内部 0。
function makeWeights(size) {
  const W = [];
  for (let r = 0; r < size; r++) {
    const row = [];
    for (let c = 0; c < size; c++) {
      const rEdge = Math.min(r, size - 1 - r);
      const cEdge = Math.min(c, size - 1 - c);
      const ring = Math.min(rEdge, cEdge);
      if (ring === 0) {
        row.push(rEdge === 0 && cEdge === 0 ? 100 : 10);
      } else if (rEdge === 1 && cEdge === 1) {
        row.push(-40);
      } else if (ring === 1) {
        row.push(-8);
      } else {
        row.push(0);
      }
    }
    W.push(row);
  }
  return W;
}

const W = makeWeights(SIZE);

function evaluate(board, player) {
  const opp = opponent(player);
  let s = 0;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = board[r][c];
      if (v === player) s += W[r][c];
      else if (v === opp) s -= W[r][c];
    }
  }
  // 机动性:可选落点数差,中盘权重高(经典黑白棋评估项)。
  const counts = countDiscs(board);
  const filled = counts.black + counts.white;
  if (filled <= Math.floor(SIZE * SIZE * 0.65)) {
    s += 2 * (legalMoves(board, player).length - legalMoves(board, opp).length);
  }
  return s;
}

// 走法排序:角优先,其次翻子多 —— 大幅提升剪枝效率。
function orderedMoves(board, player, moves) {
  return moves
    .map((m) => {
      const [r, c] = m;
      const corner = (r === 0 || r === SIZE - 1) && (c === 0 || c === SIZE - 1);
      const flips = flipsFor(board, r, c, player).length;
      return { m, key: (corner ? 1000 : 0) + flips };
    })
    .sort((a, b) => b.key - a.key)
    .map((x) => x.m);
}

const TimeUp = Symbol('time-up');

function negamax(board, player, depth, alpha, beta, nodes, deadline) {
  if (++nodes.count % 512 === 0 && performance.now() > deadline) {
    throw TimeUp;
  }
  const moves = legalMoves(board, player);
  if (moves.length === 0) {
    if (legalMoves(board, opponent(player)).length === 0) {
      const { black, white } = countDiscs(board);
      const d = player === BLACK ? black - white : white - black;
      return d > 0 ? 100000 + d : d < 0 ? -100000 + d : 0;
    }
    return -negamax(board, opponent(player), depth - 1, -beta, -alpha, nodes, deadline);
  }
  if (depth <= 0) return evaluate(board, player);
  let best = -Infinity;
  for (const [r, c] of orderedMoves(board, player, moves)) {
    const { board: next } = applyMove(board, r, c, player);
    const v = -negamax(next, opponent(player), depth - 1, -beta, -alpha, nodes, deadline);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

function bestAtDepth(board, player, depth, deadline = Infinity) {
  const moves = legalMoves(board, player);
  const nodes = { count: 0 };
  let best = -Infinity;
  let bestMoves = [];
  for (const [r, c] of orderedMoves(board, player, moves)) {
    const { board: next } = applyMove(board, r, c, player);
    const v = -negamax(next, opponent(player), depth - 1, -Infinity, Infinity, nodes, deadline);
    if (v > best) {
      best = v;
      bestMoves = [[r, c]];
    } else if (v === best) {
      bestMoves.push([r, c]);
    }
  }
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}

// difficulty: easy | normal | hard
export function chooseMove(board, player, difficulty, timeMs = 700) {
  const moves = legalMoves(board, player);
  if (moves.length === 0) return null;

  if (difficulty === 'easy') {
    if (Math.random() < 0.15) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    return orderedMoves(board, player, moves)[0];
  }

  if (difficulty === 'normal') {
    return bestAtDepth(board, player, 3);
  }

  // hard: 迭代加深 + 时限;空位 ≤10 时搜到终局(残局精确解)。
  const start = performance.now();
  const deadline = start + timeMs;
  const counts = countDiscs(board);
  const empties = SIZE * SIZE - counts.black - counts.white;
  const maxDepth = empties <= 10 ? empties : 8;
  let move = null;
  for (let d = 1; d <= maxDepth; d++) {
    try {
      move = bestAtDepth(board, player, d, deadline);
    } catch (e) {
      if (e === TimeUp) break;
      throw e;
    }
    if (performance.now() > deadline) break;
  }
  return move || bestAtDepth(board, player, 1);
}

// 卡牌模式:决定本步打出哪些牌(返回 hand 的子集)。
export function chooseCards(board, hand, player, r, c, difficulty = 'normal') {
  const opp = opponent(player);
  const counts = countDiscs(board);
  const oppCount = opp === BLACK ? counts.black : counts.white;
  const adj = cardBlast(board, r, c, player).length;
  const cap = difficulty === 'hard' ? 3 : difficulty === 'normal' ? 2 : 1;
  const picks = [];
  for (const id of hand) {
    if (picks.length >= cap) break;
    if (id === 'blast' && adj >= 2) picks.push(id);
    else if (id === 'lucky' && oppCount >= 4) picks.push(id);
    else if (id === 'chain' && oppCount >= 6) picks.push(id);
    else if (id === 'seed' && cardSeed(board, player)) picks.push(id);
    else if (id === 'shield' && oppCount >= 18) picks.push(id);
    else if (id === 'bomb' && oppCount >= 14) picks.push(id);
    else if (id === 'combo' && difficulty !== 'easy' && Math.random() < 0.5) picks.push(id);
    else if (id === 'echo' && picks.length > 0) picks.push(id); // 回响重复上一张
  }
  return picks;
}
