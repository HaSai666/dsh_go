// 黑白棋(Reversi)纯规则引擎 —— 不依赖 three.js,可独立测试。
// 棋盘:SIZE×SIZE 二维数组,行 0 在上,值 EMPTY/BLACK/WHITE。

export const SIZE = 12; // 基础棋盘尺寸(无尽模式随关卡增长,最高 18)
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

export const CARD_ENERGY_MAX = 3;
export const FIRST_OPENING_ENERGY = 1;
export const SECOND_OPENING_ENERGY = 2;
export const COMEBACK_DISC_GAP = 12;
export const TURN_CARD_DRAW = 1;

export const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1],           [0, 1],
  [1, -1],  [1, 0],  [1, 1],
];

export function opponent(p) {
  return p === BLACK ? WHITE : BLACK;
}

export function playerName(p) {
  return p === BLACK ? '黑棋' : '白棋';
}

export function inBounds(r, c, n) {
  return r >= 0 && r < n && c >= 0 && c < n;
}

export function createBoard(size = SIZE) {
  return Array.from({ length: size }, () => Array(size).fill(EMPTY));
}

export function initialBoard(size = SIZE) {
  const b = createBoard(size);
  const m = (size >> 1) - 1;
  b[m][m] = WHITE;
  b[m + 1][m + 1] = WHITE;
  b[m][m + 1] = BLACK;
  b[m + 1][m] = BLACK;
  return b;
}

// 多样化开局阵型(黑白数量对称,公平但有差异)。
export const BOARD_PATTERNS = ['classic', 'cross', 'diagonal', 'twin'];
// 肉鸽模式的富开局:24 子(12 黑 + 12 白),从第一手就是中盘强度。
export const RICH_PATTERNS = ['bloom', 'grid'];

export function spawnBoard(variant = 'classic', size = SIZE) {
  const b = createBoard(size);
  const m = (size >> 1) - 1;
  const put = (cells, v) => {
    for (const [r, c] of cells) b[r][c] = v;
  };
  if (variant === 'bloom') {
    // 绽放:核心 + 三圈花瓣,180° 旋转对称,共 24 子
    put([[m, m], [m + 1, m + 1]], WHITE);
    put([[m, m + 1], [m + 1, m]], BLACK);
    put([[m - 1, m], [m, m - 1], [m + 1, m + 2], [m + 2, m + 1]], WHITE);
    put([[m - 1, m + 1], [m + 1, m - 1], [m, m + 2], [m + 2, m]], BLACK);
    put([[m - 1, m - 1], [m + 2, m + 2]], WHITE);
    put([[m - 1, m + 2], [m + 2, m - 1]], BLACK);
    put([[m - 2, m], [m, m - 2], [m + 1, m + 3], [m + 3, m + 1]], WHITE);
    put([[m - 2, m + 1], [m + 1, m - 2], [m, m + 3], [m + 3, m]], BLACK);
  } else if (variant === 'grid') {
    // 网格:4×6 棋盘格(12 白 + 12 黑),180° 旋转对称
    for (let r = m - 1; r <= m + 2; r++) {
      for (let c = m - 2; c <= m + 3; c++) {
        b[r][c] = (r + c) % 2 ? BLACK : WHITE;
      }
    }
  } else if (variant === 'cross') {
    put([[m, m], [m + 1, m + 1], [m - 1, m + 1], [m + 2, m]], WHITE);
    put([[m, m + 1], [m + 1, m], [m - 1, m], [m + 2, m + 1]], BLACK);
  } else if (variant === 'diagonal') {
    put([[m - 1, m - 1], [m, m], [m + 1, m + 1], [m + 2, m + 2]], WHITE);
    put([[m - 1, m + 2], [m, m + 1], [m + 1, m], [m + 2, m - 1]], BLACK);
  } else if (variant === 'twin') {
    put([[m - 1, m - 1], [m, m], [m + 1, m + 1], [m + 2, m + 2]], WHITE);
    put([[m - 1, m], [m, m - 1], [m + 1, m + 2], [m + 2, m + 1]], BLACK);
  } else {
    put([[m, m], [m + 1, m + 1]], WHITE);
    put([[m, m + 1], [m + 1, m]], BLACK);
  }
  return b;
}

export function cloneBoard(board) {
  return board.map((row) => row.slice());
}

// 在 (r,c) 落 player 的棋子会翻掉哪些子;非法落点返回空数组。
export function flipsFor(board, r, c, player) {
  const n = board.length;
  if (!inBounds(r, c, n) || board[r][c] !== EMPTY) return [];
  const opp = opponent(player);
  const flipped = [];
  for (const [dr, dc] of DIRS) {
    const line = [];
    let rr = r + dr;
    let cc = c + dc;
    while (inBounds(rr, cc, n) && board[rr][cc] === opp) {
      line.push([rr, cc]);
      rr += dr;
      cc += dc;
    }
    if (line.length > 0 && inBounds(rr, cc, n) && board[rr][cc] === player) {
      flipped.push(...line);
    }
  }
  return flipped;
}

export function legalMoves(board, player) {
  const n = board.length;
  const moves = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === EMPTY && flipsFor(board, r, c, player).length > 0) {
        moves.push([r, c]);
      }
    }
  }
  return moves;
}

export function applyMove(board, r, c, player) {
  const flipped = flipsFor(board, r, c, player);
  if (flipped.length === 0) return null;
  const next = cloneBoard(board);
  next[r][c] = player;
  for (const [fr, fc] of flipped) next[fr][fc] = player;
  return { board: next, flipped };
}

export function countDiscs(board) {
  let black = 0;
  let white = 0;
  for (const row of board) {
    for (const v of row) {
      if (v === BLACK) black++;
      else if (v === WHITE) white++;
    }
  }
  return { black, white };
}

export function isGameOver(board) {
  return legalMoves(board, BLACK).length === 0 && legalMoves(board, WHITE).length === 0;
}

export function cellName(r, c) {
  return String.fromCharCode(65 + c) + (r + 1);
}

// ---------- 卡牌模式(Buff 变体) ----------

export const CARD_POOL = [
  { id: 'combo', name: '连击', emoji: '⚡', cost: 3, desc: '立即再落一子;额外回合不抽牌' },
  { id: 'blast', name: '爆裂', emoji: '💥', cost: 2, desc: '落点周围敌子全翻' },
  { id: 'lucky', name: '天佑', emoji: '🎲', cost: 2, desc: '随机 2 枚敌子归顺' },
  { id: 'seed', name: '播种', emoji: '🌱', cost: 1, desc: '相邻空格长出己方棋子' },
  { id: 'shield', name: '护盾', emoji: '🛡️', cost: 2, desc: '对手下一次翻转无效' },
  { id: 'bomb', name: '爆破', emoji: '💣', cost: 2, desc: '随机炸飞 2 枚敌子' },
  { id: 'echo', name: '回响', emoji: '🔁', cost: 1, desc: '重复本步上一张卡的效果(顺序敏感!)' },
  { id: 'chain', name: '连锁', emoji: '🧨', cost: 2, desc: '随机再翻 3 枚与己方相邻的敌子' },
];
export const CARD_META = Object.fromEntries(CARD_POOL.map((c) => [c.id, c]));

export function cardEnergy(cards) {
  return cards.reduce((sum, id) => sum + (CARD_META[id]?.cost || 0), 0);
}

export function comebackActive(board, player) {
  const { black, white } = countDiscs(board);
  const own = player === BLACK ? black : white;
  const other = player === BLACK ? white : black;
  return other - own >= COMEBACK_DISC_GAP;
}

// firstPlayer 是本关先手。双方首回合都受限,后手多 1 点用于组织反制。
export function cardEnergyForTurn(board, player, movesPlayed, firstPlayer = BLACK) {
  if (movesPlayed === 0) {
    return player === firstPlayer ? FIRST_OPENING_ENERGY : SECOND_OPENING_ENERGY;
  }
  return CARD_ENERGY_MAX + (comebackActive(board, player) ? 1 : 0);
}

// 遗物:肉鸽闯关中整局生效的被动。
export const RELIC_POOL = [
  { id: 'crown', name: '王冠', emoji: '👑', desc: '终局计分:你的角子每个额外 +2' },
  { id: 'hat', name: '手牌大师', emoji: '🎩', desc: '手牌上限 +1' },
  { id: 'magnet', name: '磁石', emoji: '🧲', desc: '每次落子额外翻 1 枚相邻敌子' },
  { id: 'clover', name: '幸运草', emoji: '🍀', desc: '每回合补牌时 30% 概率额外多补 1 张' },
];
export const RELIC_META = Object.fromEntries(RELIC_POOL.map((r) => [r.id, r]));

export const HAND_MAX = 12;

export function drawCard(hand, max = HAND_MAX) {
  if (hand.length >= max) return null;
  const card = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
  hand.push(card.id);
  return card;
}

// 角子计数(王冠遗物用)。
export function cornerBonus(board, player) {
  const n = board.length;
  let cnt = 0;
  for (const [r, c] of [[0, 0], [0, n - 1], [n - 1, 0], [n - 1, n - 1]]) {
    if (board[r][c] === player) cnt++;
  }
  return cnt;
}

// 💥 爆裂:落点 8 邻域中的对手棋子全翻。
export function cardBlast(board, r, c, player) {
  const n = board.length;
  const opp = opponent(player);
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (inBounds(rr, cc, n) && board[rr][cc] === opp) out.push([rr, cc]);
    }
  }
  return out;
}

// 🎲 天佑:随机 k 枚对手棋子翻成己方。
export function cardLucky(board, player, k = 2) {
  const n = board.length;
  const opp = opponent(player);
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === opp) cells.push([r, c]);
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, k);
}

// 🌱 播种:随机一个与己方棋子 8 邻接的空格,无则返回 null。
export function cardSeed(board, player) {
  const n = board.length;
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== EMPTY) continue;
      let adj = false;
      for (let dr = -1; dr <= 1 && !adj; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (inBounds(rr, cc, n) && board[rr][cc] === player) {
            adj = true;
            break;
          }
        }
      }
      if (adj) cells.push([r, c]);
    }
  }
  return cells.length ? cells[Math.floor(Math.random() * cells.length)] : null;
}

// 💣 爆破:随机 k 枚对手棋子被炸飞(变为空格)。
export function cardBomb(board, player, k = 2) {
  const n = board.length;
  const opp = opponent(player);
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === opp) cells.push([r, c]);
    }
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, k);
}

// 🧨 连锁:随机 k 枚与己方棋子 8 邻接的对手棋子。
export function cardChain(board, player, k = 3) {
  const n = board.length;
  const opp = opponent(player);
  const cells = new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] !== opp) continue;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (inBounds(rr, cc, n) && board[rr][cc] === player) {
            cells.add(`${r},${c}`);
          }
        }
      }
    }
  }
  const list = [...cells].map((s) => s.split(',').map(Number));
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, k);
}
