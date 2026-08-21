// 三档 AI:简单=贪心+随机、普通=浅层 α-β 剪枝、困难=迭代加深+时限。
// 卡牌模式下由 chooseCards 决定打哪几张牌。
import {
  BLACK,
  EMPTY,
  DIRS,
  inBounds,
  countDiscs,
  legalMoves,
  applyMove,
  flipsFor,
  opponent,
  cardBlast,
  cardSeed,
  CARD_META,
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

const wCache = { size: 0, w: null };

function weightsFor(size) {
  if (wCache.size !== size) {
    wCache.size = size;
    wCache.w = makeWeights(size);
  }
  return wCache.w;
}

// 前沿子数:与空格相邻的己方棋子(中盘是负担,标准黑白棋启发项)。
function frontierCount(board, player) {
  const n = board.length;
  let cnt = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== player) continue;
      for (const [dr, dc] of DIRS) {
        const rr = r + dr;
        const cc = c + dc;
        if (inBounds(rr, cc, n) && board[rr][cc] === EMPTY) {
          cnt++;
          break;
        }
      }
    }
  }
  return cnt;
}

function evaluate(board, player) {
  const n = board.length;
  const W = weightsFor(n);
  const opp = opponent(player);
  let s = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const v = board[r][c];
      if (v === player) s += W[r][c];
      else if (v === opp) s -= W[r][c];
    }
  }
  // 机动性(可选落点数差)+ 前沿惩罚,中盘权重高。
  const counts = countDiscs(board);
  const filled = counts.black + counts.white;
  const empty = n * n - filled;
  if (empty >= 12) {
    s += 3 * (legalMoves(board, player).length - legalMoves(board, opp).length);
    s -= 1.5 * (frontierCount(board, player) - frontierCount(board, opp));
  }
  return s;
}

// 走法排序:角优先,其次翻子多 —— 大幅提升剪枝效率。
function orderedMoves(board, player, moves) {
  const n = board.length;
  return moves
    .map((m) => {
      const [r, c] = m;
      const corner = (r === 0 || r === n - 1) && (c === 0 || c === n - 1);
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
export function chooseMove(board, player, difficulty, timeMs = 900) {
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
  const empties = board.length * board.length - counts.black - counts.white;
  const maxDepth = empties <= 10 ? empties : 10;
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

function adjacentChainTargets(board, player) {
  const n = board.length;
  const opp = opponent(player);
  let count = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== opp) continue;
      if (
        DIRS.some(([dr, dc]) => {
          const rr = r + dr;
          const cc = c + dc;
          return inBounds(rr, cc, n) && board[rr][cc] === player;
        })
      ) {
        count++;
      }
    }
  }
  return count;
}

// 卡牌模式:在行动力预算内搜索有顺序的卡牌组合;回响会按前一张牌估值。
export function chooseCards(board, hand, player, r, c, difficulty = 'normal', energy = 3) {
  const opp = opponent(player);
  const counts = countDiscs(board);
  const oppCount = opp === BLACK ? counts.black : counts.white;
  const empty = board.length * board.length - counts.black - counts.white;
  const adj = cardBlast(board, r, c, player).length;
  const chainTargets = adjacentChainTargets(board, player);
  const afterMove = applyMove(board, r, c, player)?.board || board;
  const nextMobility = legalMoves(afterMove, player).length;
  const canSeed = Boolean(cardSeed(board, player));
  const maxCards = difficulty === 'hard' ? 4 : difficulty === 'normal' ? 2 : 1;
  const threshold = difficulty === 'hard' ? 1.5 : difficulty === 'normal' ? 3.5 : 5.5;

  const utility = (id, previousId, previousValue) => {
    if (id === 'blast') return adj ? 2 + adj * 2.2 : -4;
    if (id === 'lucky') return oppCount >= 2 ? Math.min(oppCount, 2) * 2.4 : -3;
    if (id === 'chain') return chainTargets ? Math.min(chainTargets, 3) * 2.1 : -3;
    if (id === 'seed') return canSeed ? 2.8 : -3;
    if (id === 'shield') return empty <= 20 ? 6 : oppCount >= 20 ? 4.5 : 1.2;
    if (id === 'bomb') return oppCount >= 2 ? Math.min(oppCount, 2) * 2.8 : -3;
    if (id === 'combo') return nextMobility ? 6.5 + Math.min(nextMobility, 4) * 0.4 : -8;
    if (id === 'echo') {
      if (!previousId || ['echo', 'combo', 'shield'].includes(previousId)) return -6;
      return previousValue * 0.85;
    }
    return -6;
  };

  let best = [];
  let bestScore = 0;
  let bestCost = 0;

  function search(sequence, used, cost, score, previousId, previousValue) {
    if (
      score > bestScore + 0.001 ||
      (Math.abs(score - bestScore) < 0.001 && cost < bestCost)
    ) {
      best = [...sequence];
      bestScore = score;
      bestCost = cost;
    }
    if (sequence.length >= maxCards) return;
    for (let i = 0; i < hand.length; i++) {
      if (used.has(i)) continue;
      const id = hand[i];
      const nextCost = cost + (CARD_META[id]?.cost || 0);
      if (nextCost > energy) continue;
      const value = utility(id, previousId, previousValue);
      if (value <= 0) continue;
      used.add(i);
      sequence.push(id);
      search(sequence, used, nextCost, score + value, id, value);
      sequence.pop();
      used.delete(i);
    }
  }

  search([], new Set(), 0, 0, null, 0);
  return bestScore >= threshold ? best : [];
}
