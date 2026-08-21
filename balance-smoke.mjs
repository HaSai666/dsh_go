// 固定种子的卡牌模式平衡冒烟:同强度 AI 对弈,监控先手是否重新形成压倒性优势。
import {
  BLACK,
  WHITE,
  EMPTY,
  RICH_PATTERNS,
  CARD_META,
  applyMove,
  cardBlast,
  cardBomb,
  cardChain,
  cardEnergyForTurn,
  cardLucky,
  cardSeed,
  cloneBoard,
  countDiscs,
  drawCard,
  isGameOver,
  legalMoves,
  opponent,
  spawnBoard,
} from './src/game.js';
import { chooseCards, chooseMove } from './src/ai.js';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fillOpening(hand, cap) {
  while (hand.length < cap) drawCard(hand, cap);
}

function drawTurn(hand, cap) {
  if (hand.length < cap) drawCard(hand, cap);
}

function consume(hand, cards) {
  for (const id of cards) {
    const index = hand.indexOf(id);
    if (index >= 0) hand.splice(index, 1);
  }
}

function applyCards(state, cards, r, c, player) {
  let extraTurn = false;
  let previous = null;

  const play = (id, previousId) => {
    if (id === 'echo') {
      if (!previousId || previousId === 'echo') return false;
      return play(previousId, null);
    }
    if (id === 'combo') return true;
    if (id === 'shield') {
      state.shieldOwner = player;
      return false;
    }

    let targets = [];
    let effect = 'flip';
    if (id === 'blast') targets = cardBlast(state.board, r, c, player);
    else if (id === 'lucky') targets = cardLucky(state.board, player, 2);
    else if (id === 'chain') targets = cardChain(state.board, player, 3);
    else if (id === 'seed') {
      const target = cardSeed(state.board, player);
      if (target) {
        targets = [target];
        effect = 'grow';
      }
    } else if (id === 'bomb') {
      targets = cardBomb(state.board, player, 2);
      effect = 'remove';
    }

    for (const [tr, tc] of targets) {
      state.board[tr][tc] = effect === 'remove' ? EMPTY : player;
    }
    return false;
  };

  for (const id of cards) {
    if (play(id, previous)) extraTurn = true;
    previous = id;
  }
  return extraTurn;
}

function playGame(seed) {
  const originalRandom = Math.random;
  Math.random = seededRandom(seed);
  try {
    const state = {
      board: spawnBoard(RICH_PATTERNS[Math.floor(Math.random() * RICH_PATTERNS.length)]),
      hands: { [BLACK]: [], [WHITE]: [] },
      handCaps: { [BLACK]: 4, [WHITE]: 4 }, // 第 1 关同上限,后手只获行动力补偿
      movesPlayed: { [BLACK]: 0, [WHITE]: 0 },
      shieldOwner: null,
      turn: BLACK,
      drawOnTurn: false,
      energyPenalty: 0,
    };
    fillOpening(state.hands[BLACK], state.handCaps[BLACK]);
    fillOpening(state.hands[WHITE], state.handCaps[WHITE]);

    let steps = 0;
    while (!isGameOver(state.board) && steps < 400) {
      let moves = legalMoves(state.board, state.turn);
      if (!moves.length) {
        state.turn = opponent(state.turn);
        state.drawOnTurn = state.movesPlayed[state.turn] > 0;
        state.energyPenalty = 0;
        moves = legalMoves(state.board, state.turn);
        if (!moves.length) break;
      }

      const player = state.turn;
      if (state.drawOnTurn) drawTurn(state.hands[player], state.handCaps[player]);
      state.drawOnTurn = false;
      const energy = Math.max(
        0,
        cardEnergyForTurn(state.board, player, state.movesPlayed[player], BLACK) -
          state.energyPenalty
      );
      state.energyPenalty = 0;
      const move = chooseMove(state.board, player, 'easy');
      if (!move) break;
      const [r, c] = move;
      const cards = chooseCards(state.board, state.hands[player], player, r, c, 'hard', energy);
      consume(state.hands[player], cards);

      const result = applyMove(state.board, r, c, player);
      if (!result) throw new Error(`非法模拟落子 ${player}@${r},${c}`);
      if (state.shieldOwner === opponent(player)) {
        state.board = cloneBoard(state.board);
        state.board[r][c] = player;
        state.shieldOwner = null;
      } else {
        state.board = result.board;
      }
      state.movesPlayed[player]++;

      const extraTurn = applyCards(state, cards, r, c, player);
      if (extraTurn && legalMoves(state.board, player).length) {
        state.turn = player;
        state.energyPenalty = 1;
      } else {
        state.turn = opponent(player);
        state.drawOnTurn = state.movesPlayed[state.turn] > 0;
      }
      steps++;
    }

    const { black, white } = countDiscs(state.board);
    return black > white ? BLACK : white > black ? WHITE : null;
  } finally {
    Math.random = originalRandom;
  }
}

const games = 96;
let firstWins = 0;
let secondWins = 0;
let draws = 0;
for (let seed = 1; seed <= games; seed++) {
  const winner = playGame(0x9e3779b9 ^ seed);
  if (winner === BLACK) firstWins++;
  else if (winner === WHITE) secondWins++;
  else draws++;
}

const decisive = firstWins + secondWins;
const firstRate = decisive ? firstWins / decisive : 0;
console.log(
  `卡牌平衡模拟 ${games} 局:先手 ${firstWins} 胜,后手 ${secondWins} 胜,平局 ${draws},先手胜率 ${(firstRate * 100).toFixed(1)}%`
);
const passed = decisive >= 48 && firstRate >= 0.35 && firstRate <= 0.65;
console.log(passed ? '✅ 先后手胜率处于回归区间' : '❌ 先后手胜率超出 35%~65% 回归区间');
process.exit(passed ? 0 : 1);
