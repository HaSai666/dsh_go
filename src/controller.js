// 对局流程:落子→拍击→连锁翻面→结算卡牌→换手→AI→终局仪式。
// 支持经典模式与卡牌模式(每步可打出任意张手牌)。
import {
  BLACK,
  WHITE,
  EMPTY,
  SIZE,
  initialBoard,
  createBoard,
  cloneBoard,
  legalMoves,
  applyMove,
  isGameOver,
  countDiscs,
  playerName,
  opponent,
  spawnBoard,
  BOARD_PATTERNS,
  RICH_PATTERNS,
  drawCard,
  cardBlast,
  cardLucky,
  cardSeed,
  cardBomb,
  cardChain,
  cornerBonus,
  CARD_POOL,
  CARD_META,
  RELIC_POOL,
  RELIC_META,
} from './game.js';
import { chooseMove, chooseCards } from './ai.js';

// QA 慢动作因子:无头调试时把流程延迟拉长,便于定点抓拍(生产恒为 1)。
const delay = (ms) =>
  new Promise((r) => setTimeout(r, ms * (window.__QA_SLOWMO || 1)));

// 无尽模式:敌方特权按关卡公式无限递增;棋盘随关卡增大。
function runCfgFor(level) {
  const l = Math.max(1, level);
  return {
    diff: 'hard',
    handBonus: Math.min(Math.ceil(l / 2), 6), // 1,1,2,2,3,3...封顶 6(敌方手牌上限 4+6=10)
    magnet: l >= 2,
    extraDiscs: l >= 3 ? Math.min(2 + (l - 3), 10) : 0, // 2,3,4...封顶 10
    budget: Math.min(600 + (l - 1) * 200, 2000), // 600,800,1000...封顶 2000ms
  };
}

// 棋盘尺寸:12×12 起步,每关 +1,封顶 18×18。
function boardSizeFor(level) {
  return Math.min(12 + Math.max(0, level - 1), 18);
}

// 敌方开局加子位置:四边中段交错(避开开局阵型与角)。
function extraSpotsFor(size) {
  const spots = [];
  for (let d = 2; d < size - 2 && spots.length < 16; d += 2) {
    spots.push([0, d]);
    spots.push([d, 0]);
    spots.push([size - 1, size - 1 - d]);
    spots.push([size - 1 - d, size - 1]);
  }
  return spots;
}

export class Game {
  constructor(ctx, ui, audio) {
    this.ctx = ctx;
    this.ui = ui;
    this.audio = audio;
    this.mode = 'classic';
    this.board = initialBoard();
    this.hands = { [BLACK]: [], [WHITE]: [] };
    this.shieldOwner = null; // 护盾持有者:其棋子免疫对手下一次翻转
    this.turn = BLACK;
    this.phase = 'idle'; // idle(玩家回合) | anim(动画中) | ai(电脑思考) | over
    this.history = [];
    this.lastMove = null;
    this.legal = [];
    this.generation = 0;
    this.difficulty = 'normal';
    this.trace = []; // 调试轨迹:关键事件时间线,供无头 QA 定点抓拍
    this.run = null; // 无尽闯关状态: { level, relics, bonus, handCap }

    const dom = ctx.renderer.domElement;
    let downX = 0;
    let downY = 0;
    dom.addEventListener('pointerdown', (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => {
      // 位移小于阈值视为点击(拖拽归 OrbitControls)。
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < 6) {
        this.handleClick(e);
      }
    });
    dom.addEventListener('pointermove', (e) => this.handleMove(e));
    dom.addEventListener('pointerleave', () => this.ctx.hover(null, null));

    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') this.newGame();
      else if (e.key === 'u' || e.key === 'U') this.undo();
      else if (e.key === 'm' || e.key === 'M') this.toggleMute();
    });

    ui.onModeSelect((mode) => this.start(mode));
    ui.onDifficulty((d) => {
      this.difficulty = d;
      ui.toast(`难度:${d === 'easy' ? '简单' : d === 'normal' ? '普通' : '困难'}`);
    });
    ui.onUndo(() => this.undo());
    ui.onRestart(() => this.newGame());
    ui.onMute(() => this.toggleMute());
    ui.onHome(() => this.exitToHome());
    ui.onAgain(() => this.start(this.mode));
    ui.onReward((opt) => {
      this.applyReward(opt);
      this.nextLevel();
    });

    this.difficulty = ui.getDifficulty();
  }

  // ---------- 调试轨迹 ----------

  logTrace(mark, ...args) {
    this.trace.push({ t: performance.now(), mark, args });
  }

  // ---------- 模式切换 ----------

  start(mode) {
    this.mode = mode;
    if (mode === 'cards') {
      this.run = { level: 1, relics: [], bonus: [], handCap: 4 }; // 无尽:失败即止,连关数无上限
      this.ui.setRunMode(true);
    } else {
      this.run = null;
      this.ui.setRunMode(false);
    }
    this.newGame();
  }

  exitToHome() {
    this.generation++;
    this.phase = 'over';
    this.ctx.clearLegal();
    this.ctx.hover(null, null);
    this.ctx.syncBoard(createBoard());
    this.ctx.clearLastMove();
    this.ctx.setIdleMode(true);
    this.ui.setCardsMode(false);
    this.ui.setRunMode(false);
    this.ui.showHome();
    this.audio.click();
  }

  // ---------- 肉鸽闯关 ----------

  runCfg() {
    return this.run ? runCfgFor(this.run.level) : null;
  }

  aiDifficulty() {
    if (this.run) return this.runCfg().diff;
    return this.difficulty;
  }

  enemyPerksText() {
    const cfg = this.runCfg();
    if (!cfg) return '';
    const parts = [];
    if (cfg.handBonus) parts.push(`手牌+${cfg.handBonus}`);
    if (cfg.magnet) parts.push('磁石');
    if (cfg.extraDiscs) parts.push(`开局+${cfg.extraDiscs}子`);
    return parts.length ? `敌方特权 · ${parts.join(' · ')}` : '';
  }

  rewardOptions() {
    const opts = [];
    const relic = RELIC_POOL[Math.floor(Math.random() * RELIC_POOL.length)];
    opts.push({ kind: 'relic', id: relic.id });
    // 核心成长项:手牌上限(封顶 10)
    if (this.run.handCap < 10) {
      opts.push({ kind: 'handcap' });
    }
    const card = CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
    opts.push({ kind: 'card', id: card.id });
    return opts;
  }

  applyReward(opt) {
    if (opt.kind === 'relic') {
      if (!this.run.relics.includes(opt.id)) {
        this.run.relics.push(opt.id);
        if (opt.id === 'hat') this.run.handCap += 1; // 🎩手牌大师:手牌上限 +1
      }
      this.ui.toast(`获得遗物 ${RELIC_META[opt.id].emoji} ${RELIC_META[opt.id].name}!`, 2200);
    } else if (opt.kind === 'handcap') {
      this.run.handCap += 1;
      this.ui.toast(`🀄 手牌上限 +1(现在 ${this.run.handCap}),每回合补满!`, 2200);
    } else {
      this.hands[BLACK].push(opt.id);
      this.ui.toast(`获得卡牌 ${CARD_META[opt.id].emoji} ${CARD_META[opt.id].name},立即入手!`, 2200);
    }
    this.audio.win();
  }

  nextLevel() {
    this.run.level++;
    this.newGame();
  }

  // ---------- 输入 ----------

  handleClick(event) {
    if (this.phase !== 'idle' || this.turn !== BLACK) return;
    const cell = this.ctx.cellFromPointer(event);
    if (!cell) return;
    if (this.legal.some(([r, c]) => r === cell.r && c === cell.c)) {
      const cards = this.ui.getSelectedCards();
      this.ui.clearCardSelection();
      this.commitMove(cell.r, cell.c, BLACK, cards);
    } else {
      this.audio.error();
      this.ui.toast('这里不能落子');
    }
  }

  handleMove(event) {
    const cell = this.ctx.cellFromPointer(event);
    const ok =
      this.phase === 'idle' &&
      this.turn === BLACK &&
      cell &&
      this.legal.some(([r, c]) => r === cell.r && c === cell.c);
    if (ok) {
      this.ctx.hover(cell.r, cell.c, BLACK);
      this.ctx.renderer.domElement.style.cursor = 'pointer';
    } else {
      this.ctx.hover(null, null);
      this.ctx.renderer.domElement.style.cursor = 'default';
    }
  }

  // ---------- 手牌 ----------

  handCapFor(player) {
    if (this.mode !== 'cards' || !this.run) return 0;
    if (player === BLACK) return this.run.handCap + (this.run.relics.includes('hat') ? 1 : 0);
    return 4 + this.runCfg().handBonus;
  }

  // 每回合开始补满手牌(🍀幸运草:30% 额外多补 1 张)。
  refill(player) {
    if (this.mode !== 'cards' || !this.run) return;
    const cap = this.handCapFor(player);
    const lucky = player === BLACK && this.run.relics.includes('clover') && Math.random() < 0.3;
    const target = cap + (lucky ? 1 : 0);
    while (this.hands[player].length < target) {
      drawCard(this.hands[player], target + 1);
    }
    if (player === BLACK) this.audio.cardDraw();
    return target;
  }

  consumeCards(player, cards) {
    if (this.mode !== 'cards' || player !== BLACK) return;
    for (const id of cards) {
      const idx = this.hands[player].indexOf(id);
      if (idx >= 0) this.hands[player].splice(idx, 1);
    }
  }

  // ---------- 对局 ----------

  newGame() {
    this.generation++;
    this.trace = [];
    // 经典模式固定 12×12 经典开局;无尽每关棋盘增大 + 富开局(24 子)随机二选一
    const size = this.mode === 'cards' && this.run ? boardSizeFor(this.run.level) : 12;
    this.board =
      this.mode === 'cards' && this.run
        ? spawnBoard(RICH_PATTERNS[Math.floor(Math.random() * RICH_PATTERNS.length)], size)
        : initialBoard(size);
    this.ctx.resizeBoard(size);
    this.hands = { [BLACK]: [], [WHITE]: [] };
    this.shieldOwner = null;
    if (this.mode === 'cards' && this.run) {
      // 开局补满双方手牌(上限:玩家 handCap / 敌方 4+特权)
      this.refill(BLACK);
      this.refill(WHITE);
      // 敌方开局加子特权:从预设边线位依次放置(避开开局阵型)
      const cfg = this.runCfg();
      const spots = extraSpotsFor(size);
      for (let i = 0; i < Math.min(cfg.extraDiscs, spots.length); i++) {
        const [r, c] = spots[i];
        if (this.board[r][c] === EMPTY) this.board[r][c] = WHITE;
      }
    }
    this.turn = BLACK;
    this.phase = 'idle';
    this.history = [];
    this.lastMove = null;
    this.ctx.syncBoard(this.board);
    this.ctx.setIdleMode(false);
    this.ctx.clearLastMove();
    this.ui.hideHome();
    this.ui.hideGameOver();
    this.ui.setLocked(false);
    this.ui.setCardsMode(this.mode === 'cards');
    this.ui.setRunMode(this.mode === 'cards');
    if (this.run) {
      this.ui.setRunInfo(this.run.level, this.board.length, this.run.relics, this.run.handCap, this.enemyPerksText());
    }
    this.ui.clearCardSelection();
    this.updateScore();
    this.refreshLegal(true);
    this.audio.click();
    this.ui.toast(
      this.mode === 'cards'
        ? `第 ${this.run.level} 关 · ${this.board.length}×${this.board.length}${this.enemyPerksText() ? ' · ' + this.enemyPerksText() : ''}:每回合补满手牌,选牌排队后落子!`
        : '新的一局,黑棋先行'
    );
  }

  async commitMove(r, c, player, cards = []) {
    const gen = this.generation;
    const res = applyMove(this.board, r, c, player);
    if (!res) return;

    this.phase = 'anim';
    this.ui.setLocked(true);
    this.ctx.clearLegal();
    this.logTrace('move', player === BLACK ? 'black' : 'white', r, c);
    this.history.push({
      board: cloneBoard(this.board),
      hands: { [BLACK]: [...this.hands[BLACK]], [WHITE]: [...this.hands[WHITE]] },
      shieldOwner: this.shieldOwner,
      turn: this.turn,
    });
    this.consumeCards(player, cards);
    if (this.mode === 'cards') {
      this.ui.renderHand(this.hands[BLACK], false);
    }

    // 护盾:对手的翻转被无效化(护盾随之消耗),盘面只落子不翻转
    let flips = res.flipped;
    let shieldBlocked = false;
    if (this.shieldOwner === opponent(player)) {
      flips = [];
      this.shieldOwner = null;
      shieldBlocked = true;
      this.board = cloneBoard(this.board);
      this.board[r][c] = player;
    } else {
      this.board = res.board;
    }
    this.lastMove = [r, c];

    // ① 坠落拍击
    const piece = this.ctx.placePiece(r, c, player);
    await this.ctx.dropPiece(piece);
    if (gen !== this.generation) return;
    this.logTrace('impact');
    this.audio.place();
    this.ctx.shake(0.055);
    this.ctx.punch();
    this.ctx.bounceNeighbors(r, c);
    this.ctx.setLastMove(r, c);

    // ② 连锁翻面:按离落点距离排序,像多米诺一样逐波翻过去。
    const flipsSorted = flips
      .map(([fr, fc]) => ({ r: fr, c: fc, d: Math.hypot(fr - r, fc - c) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < flipsSorted.length; i++) {
      await delay(i === 0 ? 120 : 55);
      if (gen !== this.generation) return;
      const f = flipsSorted[i];
      const p = this.ctx.pieceAt(f.r, f.c);
      if (p) {
        this.audio.flip(i);
        this.ctx.flipPiece(p, player, -(f.c - c), f.r - r);
      }
    }
    await delay(260);
    if (gen !== this.generation) return;
    this.logTrace('flips');

    // ②.5 🧲磁石(玩家遗物 / 敌方特权):每次落子额外翻 1 枚相邻敌子
    const hasMagnet =
      (this.run && this.run.relics.includes('magnet')) ||
      (this.run && player === WHITE && this.runCfg().magnet);
    if (hasMagnet) {
      await this.magnetFlip(r, c, player, gen);
      if (gen !== this.generation) return;
    }

    // ③ 护盾生效提示
    if (shieldBlocked) {
      this.logTrace('shield');
      this.audio.shield();
      this.ui.toast('🛡️ 护盾挡下了翻转!', 2200);
      await delay(450);
      if (gen !== this.generation) return;
    }

    // ④ 大翻盘:单步翻转 ≥8 子触发粒子 + 低音
    if (flips.length >= 8) {
      this.ctx.burst.spawn(
        this.ctx.cellX(c),
        this.ctx.cellY + 0.4,
        this.ctx.cellZ(r),
        Math.min(90 + flips.length * 12, 260)
      );
      this.audio.boom();
      this.ui.toast(`💥 大翻盘!一步翻 ${flips.length} 子`, 2200);
      await delay(400);
      if (gen !== this.generation) return;
    }

    // ⑤ 结算卡牌(按排队顺序逐张生效;连击可再走一手)
    let extraTurn = false;
    if (cards.length) {
      this.logTrace('cards', ...cards);
      let prevCard = null;
      for (const id of cards) {
        if (gen !== this.generation) return;
        if (await this.playCard(id, r, c, player, gen, prevCard)) extraTurn = true;
        prevCard = id;
      }
    }

    this.updateScore();
    if (isGameOver(this.board)) {
      this.endGame();
      return;
    }

    if (extraTurn) {
      this.phase = 'idle';
      this.refreshLegal();
      return;
    }
    this.turn = player === BLACK ? WHITE : BLACK;
    this.phase = 'idle';
    this.refreshLegal();
  }

  // 🧲磁石:额外翻 1 枚与落点 8 邻接的敌子(玩家遗物与敌方特权共用)。
  async magnetFlip(r, c, player, gen) {
    const m = cardBlast(this.board, r, c, player).slice(0, 1);
    if (!m.length) return;
    const [mr, mc] = m[0];
    this.board[mr][mc] = player;
    const p = this.ctx.pieceAt(mr, mc);
    if (p) {
      this.audio.flip(2);
      this.ctx.flipPiece(p, player, -(mc - c) || 1, mr - r);
      await delay(200);
      if (gen !== this.generation) return;
    }
  }

  // 结算单张卡牌:返回是否"连击"。prevCard 供🔁回响重复(顺序敏感)。
  async playCard(id, r, c, player, gen, prevCard) {
    this.audio.cardPlay(id);
    await delay(120);
    if (gen !== this.generation) return false;

    if (id === 'echo') {
      if (!prevCard || prevCard === 'echo') {
        this.ui.toast('🔁 回响落空:本步没有可重复的卡', 2000);
        return false;
      }
      this.ui.toast(`🔁 回响!重复「${CARD_META[prevCard].name}」`, 2000);
      await delay(150);
      if (gen !== this.generation) return false;
      return this.playCard(prevCard, r, c, player, gen);
    }
    if (id === 'combo') {
      this.ui.toast('⚡ 连击!再落一子', 2000);
      return true;
    }
    if (id === 'shield') {
      this.shieldOwner = player;
      this.audio.shield();
      this.ui.toast('🛡️ 护盾已激活:对手下一次翻转无效', 2200);
      return false;
    }

    this.ui.toast(`${CARD_META[id].emoji} ${CARD_META[id].name}:${CARD_META[id].desc}`, 2000);

    let targets = [];
    let effect = 'flip';
    if (id === 'blast') {
      targets = cardBlast(this.board, r, c, player);
    } else if (id === 'lucky') {
      targets = cardLucky(this.board, player, 2);
    } else if (id === 'chain') {
      targets = cardChain(this.board, player, 3);
    } else if (id === 'seed') {
      const s = cardSeed(this.board, player);
      if (s) {
        targets = [s];
        effect = 'grow';
      } else {
        this.ui.toast('🌱 播种落空:没有相邻空格', 2000);
      }
    } else if (id === 'bomb') {
      targets = cardBomb(this.board, player, 2);
      effect = 'remove';
    }

    let i = 0;
    for (const [tr, tc] of targets) {
      await delay(110);
      if (gen !== this.generation) return false;
      if (effect === 'grow') {
        this.board[tr][tc] = player;
        const np = this.ctx.placePiece(tr, tc, player);
        this.audio.flip(i);
        this.ctx.dropPiece(np);
      } else if (effect === 'remove') {
        this.board[tr][tc] = EMPTY;
        const p = this.ctx.pieceAt(tr, tc);
        if (p) {
          this.audio.bomb();
          this.ctx.burst.spawn(this.ctx.cellX(tc), this.ctx.cellY + 0.3, this.ctx.cellZ(tr), 60);
          this.ctx.popPiece(p);
        }
      } else {
        this.board[tr][tc] = player;
        const p = this.ctx.pieceAt(tr, tc);
        if (p) {
          this.audio.flip(i);
          this.ctx.flipPiece(p, player, -(tc - c) || 1, tr - r);
        }
      }
      i++;
    }
    await delay(320);
    return false;
  }

  refreshLegal(isFirst = false) {
    if (this.phase === 'over') return;
    const moves = legalMoves(this.board, this.turn);
    this.legal = moves;

    if (moves.length > 0) {
      this.setTurnUi();
      if (this.turn === BLACK) {
        this.phase = 'idle';
        this.ui.setLocked(false);
        this.ctx.setLegal(moves);
        if (this.mode === 'cards' && !isFirst) this.refill(BLACK);
        if (this.mode === 'cards') this.ui.renderHand(this.hands[BLACK], true);
      } else {
        this.scheduleAI();
      }
      return;
    }

    // 当前方无棋可下 → 自动跳过
    this.ctx.clearLegal();
    this.ui.toast(`${playerName(this.turn)}无棋可下,跳过`);
    this.audio.pass();
    this.turn = this.turn === BLACK ? WHITE : BLACK;
    const next = legalMoves(this.board, this.turn);
    if (next.length === 0) {
      this.endGame();
      return;
    }
    this.legal = next;
    if (this.turn === BLACK) {
      this.phase = 'idle';
      this.ui.setLocked(false);
      this.setTurnUi();
      this.ctx.setLegal(next);
      if (this.mode === 'cards') {
        this.refill(BLACK);
        this.ui.renderHand(this.hands[BLACK], true);
      }
    } else {
      this.scheduleAI();
    }
  }

  scheduleAI() {
    if (this.phase === 'over') return;
    const gen = this.generation;
    this.phase = 'ai';
    this.logTrace('think');
    this.ctx.clearLegal();
    this.setTurnUi();
    this.ui.setLocked(true);
    if (this.mode === 'cards') {
      this.refill(WHITE);
      this.ui.renderAiHand(this.hands[WHITE].length);
    }
    setTimeout(() => {
      if (gen !== this.generation || this.phase !== 'ai') return;
      const cfg = this.runCfg();
      const mv = chooseMove(this.board, WHITE, this.aiDifficulty(), cfg ? cfg.budget : 700);
      if (!mv) {
        this.refreshLegal();
        return;
      }
      let cards = [];
      if (this.mode === 'cards') {
        cards = chooseCards(this.board, this.hands[WHITE], WHITE, mv[0], mv[1], this.aiDifficulty());
        for (const id of cards) {
          const idx = this.hands[WHITE].indexOf(id);
          if (idx >= 0) this.hands[WHITE].splice(idx, 1);
        }
        this.ui.renderAiHand(this.hands[WHITE].length);
      }
      this.commitMove(mv[0], mv[1], WHITE, cards);
    }, 380 * (window.__QA_SLOWMO || 1));
  }

  async endGame() {
    const gen = this.generation;
    this.phase = 'over';
    this.ctx.clearLegal();
    this.ctx.hover(null, null);
    this.ui.setLocked(false);
    this.ui.setCardsMode(false);
    this.setTurnUi();

    const { black, white } = countDiscs(this.board);
    // 👑王冠遗物:玩家的角子终局额外 +2
    let blackScore = black;
    const whiteScore = white;
    if (this.run && this.run.relics.includes('crown')) {
      blackScore = black + 2 * cornerBonus(this.board, BLACK);
    }
    const winner = blackScore > whiteScore ? BLACK : whiteScore > blackScore ? WHITE : null;

    // 仪式:败方棋子整盘波浪式翻成胜方颜色
    if (winner) {
      const loser = winner === BLACK ? WHITE : BLACK;
      const cells = [];
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (this.board[r][c] === loser) cells.push({ r, c });
        }
      }
      if (cells.length) {
        await delay(500);
        for (let i = 0; i < cells.length; i++) {
          if (gen !== this.generation) return;
          const { r, c } = cells[i];
          const p = this.ctx.pieceAt(r, c);
          if (p) {
            this.audio.flip(i);
            this.ctx.flipPiece(p, winner, 1, 0);
          }
          await delay(40);
        }
        if (gen !== this.generation) return;
        this.audio.boom();
        await delay(400);
      }
    } else {
      await delay(400);
    }
    if (gen !== this.generation) return;

    // 无尽闯关:过关进入战利品三选一,失败整局重来(平局算过关)
    if (this.mode === 'cards' && this.run) {
      const scoreText = `黑 ${blackScore} : ${whiteScore} 白`;
      if (winner === BLACK || winner === null) {
        this.audio.win();
        this.ui.showLevelClear(this.run.level, scoreText, this.rewardOptions());
      } else {
        this.audio.lose();
        this.ui.showRunOver(this.run.level, scoreText);
      }
      return;
    }

    const youWin = winner === BLACK;
    this.ui.showGameOver({
      title: winner === null ? '平局!' : youWin ? '你赢了! 🎉' : '电脑获胜',
      score: `黑 ${blackScore} : ${whiteScore} 白`,
      sub: winner === null ? '势均力敌' : youWin ? '漂亮!再下一局?' : '再试一局,你行的',
    });
    if (winner === null) this.audio.pass();
    else if (youWin) this.audio.win();
    else this.audio.lose();
    this.ui.setScores(black, white);
  }

  undo() {
    if (this.phase !== 'idle' || this.turn !== BLACK) return;
    if (this.history.length === 0) {
      this.ui.toast('没有可悔的棋');
      this.audio.error();
      return;
    }
    this.generation++;
    // 撤回到"玩家回合开始前"的最近快照(棋盘/手牌/护盾一并回滚)
    let restored = false;
    while (this.history.length) {
      const snap = this.history.pop();
      if (snap.turn === BLACK) {
        this.board = snap.board;
        this.hands = {
          [BLACK]: [...snap.hands[BLACK]],
          [WHITE]: [...snap.hands[WHITE]],
        };
        this.shieldOwner = snap.shieldOwner;
        restored = true;
        break;
      }
    }
    if (!restored) return;
    this.lastMove = null;
    this.ctx.syncBoard(this.board);
    this.ctx.clearLastMove();
    this.turn = BLACK;
    this.phase = 'idle';
    this.ui.clearCardSelection();
    this.updateScore();
    this.audio.click();
    this.ui.toast('已悔棋');
    this.refreshLegal();
  }

  // ---------- 杂项 ----------

  updateScore() {
    const { black, white } = countDiscs(this.board);
    this.ui.setScores(black, white);
  }

  setTurnUi() {
    if (this.phase === 'ai') {
      this.ui.setTurn('电脑思考中', true);
    } else if (this.phase === 'over') {
      this.ui.setTurn('对局结束');
    } else {
      this.ui.setTurn(this.turn === BLACK ? '你的回合' : '电脑回合');
    }
  }

  toggleMute() {
    this.ui.setMuted(this.audio.toggleMuted());
  }
}
