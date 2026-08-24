// 无尽模式的纯规则:关卡成长、手牌上限与战利品。
// 保持无 DOM/Three.js 依赖,便于直接用 Node 回归测试。
import {
  BLACK,
  WHITE,
  CARD_META,
  CARD_POOL,
  RELIC_META,
  RELIC_POOL,
  spawnBoard,
} from './game.js';

export const BASE_HAND_CAP = 4;
export const MAX_HAND_CAP = 10;

export function createRun() {
  return { level: 1, relics: [], bonus: [], handCap: BASE_HAND_CAP };
}

export function runConfigFor(level) {
  const l = Math.max(1, level);
  return {
    diff: 'hard',
    handBonus: Math.min(Math.floor((l - 1) / 2), 6),
    magnet: l >= 2,
    extraDiscs: l >= 3 ? Math.min(2 + (l - 3), 10) : 0,
    // 小盘面不需要长时间穷举。限制同步搜索预算,避免电脑回合阻塞渲染。
    budget: Math.min(600 + (l - 1) * 50, 800),
  };
}

export function boardSizeFor(level) {
  return Math.max(1, level) < 4 ? 8 : 10;
}

// 快局保持约 40~48 个自然落子位:8×8 沿用 24 子富开局;
// 10×10 在中心阵外补一圈对称棋子,共 52 子,避免后期关卡拖长。
export function createRunBoard(level, variant) {
  const size = boardSizeFor(level);
  const board = spawnBoard(variant, size);
  if (size < 10) return board;

  const lo = 1;
  const hi = size - 2;
  for (let r = lo; r <= hi; r++) {
    for (let c = lo; c <= hi; c++) {
      if (r === lo || r === hi || c === lo || c === hi) {
        board[r][c] = (r + c) % 2 ? BLACK : WHITE;
      }
    }
  }
  return board;
}

export function extraSpotsFor(size) {
  const spots = [];
  for (let d = 2; d < size - 2 && spots.length < 16; d += 2) {
    spots.push([0, d]);
    spots.push([d, 0]);
    spots.push([size - 1, size - 1 - d]);
    spots.push([size - 1 - d, size - 1]);
  }
  return spots;
}

export function handCapFor(run, player) {
  if (!run) return 0;
  return player === BLACK
    ? run.handCap
    : BASE_HAND_CAP + runConfigFor(run.level).handBonus;
}

// 奖励卡会成为后续关卡的固定起始手牌;超过上限时优先保留最近获得的卡。
export function startingHandFor(run) {
  if (!run) return [];
  return run.bonus.slice(-handCapFor(run, BLACK));
}

function takeRandom(items, random) {
  if (!items.length) return null;
  const index = Math.min(Math.floor(random() * items.length), items.length - 1);
  return items.splice(Math.max(0, index), 1)[0];
}

function cardOption(cardIds, random) {
  return { kind: 'card', id: takeRandom(cardIds, random) };
}

// 始终返回三个有效且互不重复的选择。已拥有的遗物不会再次出现;
// 手牌满级后,成长位会自动替换成额外卡牌。
export function rewardOptionsFor(run, random = Math.random) {
  const options = [];
  const cardIds = CARD_POOL.map((card) => card.id);
  const relics = RELIC_POOL.filter(
    (relic) =>
      !run.relics.includes(relic.id) &&
      (relic.id !== 'hat' || run.handCap < MAX_HAND_CAP)
  );

  const relic = takeRandom(relics, random);
  options.push(relic ? { kind: 'relic', id: relic.id } : cardOption(cardIds, random));
  options.push(
    run.handCap < MAX_HAND_CAP ? { kind: 'handcap' } : cardOption(cardIds, random)
  );
  options.push(cardOption(cardIds, random));
  return options;
}

// 只负责更新 run 状态;界面提示和音效留给控制器。
export function grantReward(run, opt) {
  if (opt.kind === 'relic') {
    if (!RELIC_META[opt.id] || run.relics.includes(opt.id)) return false;
    if (opt.id === 'hat' && run.handCap >= MAX_HAND_CAP) return false;
    run.relics.push(opt.id);
    if (opt.id === 'hat') run.handCap++;
    return true;
  }
  if (opt.kind === 'handcap') {
    if (run.handCap >= MAX_HAND_CAP) return false;
    run.handCap++;
    return true;
  }
  if (opt.kind === 'card') {
    if (!CARD_META[opt.id]) return false;
    run.bonus.push(opt.id);
    return true;
  }
  return false;
}
