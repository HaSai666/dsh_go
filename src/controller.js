// 对局流程:落子→拍击→连锁翻面→结算卡牌→换手→AI→终局仪式。
// 支持经典模式与卡牌模式(按行动力预算组合手牌)。
import {
  BLACK,
  WHITE,
  EMPTY,
  initialBoard,
  createBoard,
  cloneBoard,
  legalMoves,
  applyMove,
  isGameOver,
  countDiscs,
  playerName,
  opponent,
  cellName,
  spawnBoard,
  RICH_PATTERNS,
  drawCard,
  cardBlast,
  cardLucky,
  cardSeed,
  cardBomb,
  cardChain,
  cornerBonus,
  cardEnergy,
  cardEnergyForTurn,
  comebackActive,
  TURN_CARD_DRAW,
  CARD_META,
  RELIC_META,
} from './game.js';
import { chooseMove, chooseCards } from './ai.js';
import {
  boardSizeFor,
  createRun,
  extraSpotsFor,
  grantReward,
  handCapFor,
  rewardOptionsFor,
  runConfigFor,
  startingHandFor,
} from './run.js';

// QA 慢动作因子:无头调试时把流程延迟拉长,便于定点抓拍(生产恒为 1)。
const delay = (ms) =>
  new Promise((r) =>
    setTimeout(
      r,
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : ms) *
        (window.__QA_SLOWMO || 1)
    )
  );

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
    this.keyboardMoveIndex = 0;
    this.startingPlayer = BLACK;
    this.movesPlayed = { [BLACK]: 0, [WHITE]: 0 };
    this.currentCardEnergy = 0;

    const dom = ctx.renderer.domElement;
    dom.tabIndex = 0;
    dom.setAttribute('role', 'application');
    dom.setAttribute('aria-label', '3D 黑白棋棋盘');
    dom.setAttribute('aria-describedby', 'game-instructions');
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
    dom.addEventListener('focus', () => {
      if (dom.matches(':focus-visible')) this.previewKeyboardMove(false);
    });
    dom.addEventListener('blur', () => this.ctx.hover(null, null));

    window.addEventListener('keydown', (e) => {
      if (e.target === dom && this.handleBoardKey(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
      if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        this.toggleMute();
      } else if (!ui.isHomeVisible() && (e.key === 'r' || e.key === 'R')) {
        if (this.phase === 'idle' || this.phase === 'over') {
          e.preventDefault();
          this.newGame();
        }
      } else if (!ui.isHomeVisible() && (e.key === 'u' || e.key === 'U')) {
        e.preventDefault();
        this.undo();
      }
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
      const accepted = this.applyReward(opt);
      if (accepted) this.nextLevel();
      return accepted;
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
      this.run = createRun(); // 无尽:失败即止,连关数无上限
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
    this.ui.setShield(null);
    this.ui.showHome(true);
    this.audio.click();
  }

  // ---------- 肉鸽闯关 ----------

  runCfg() {
    return this.run ? runConfigFor(this.run.level) : null;
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
    return rewardOptionsFor(this.run);
  }

  applyReward(opt) {
    if (!grantReward(this.run, opt)) {
      this.ui.toast('这件战利品无法生效,请重新选择', 2200);
      this.audio.error();
      return false;
    }
    if (opt.kind === 'relic') {
      this.ui.toast(`获得遗物 ${RELIC_META[opt.id].emoji} ${RELIC_META[opt.id].name}!`, 2200);
    } else if (opt.kind === 'handcap') {
      this.ui.toast(`🀄 手牌上限 +1(现在 ${this.run.handCap}),可以保留更多战术牌!`, 2200);
    } else {
      this.ui.toast(
        `获得卡牌 ${CARD_META[opt.id].emoji} ${CARD_META[opt.id].name},已加入后续关卡起始手牌!`,
        2400
      );
    }
    this.audio.win();
    return true;
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
      this.commitPlayerMove(cell.r, cell.c);
    } else {
      this.audio.error();
      this.ui.toast('这里不能落子');
    }
  }

  commitPlayerMove(r, c) {
    const cards = this.ui.getSelectedCards();
    if (this.mode === 'cards' && cardEnergy(cards) > this.currentCardEnergy) {
      this.ui.toast('选牌超过本回合行动力');
      this.audio.error();
      return;
    }
    this.ui.clearCardSelection();
    this.commitMove(r, c, BLACK, cards);
  }

  handleBoardKey(event) {
    if (this.phase !== 'idle' || this.turn !== BLACK || this.legal.length === 0) return false;
    if (['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
      this.keyboardMoveIndex =
        (this.keyboardMoveIndex + direction + this.legal.length) % this.legal.length;
      this.previewKeyboardMove(true);
      return true;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const [r, c] = this.legal[this.keyboardMoveIndex] || this.legal[0];
      this.commitPlayerMove(r, c);
      return true;
    }
    return false;
  }

  previewKeyboardMove(announce = true) {
    if (this.phase !== 'idle' || this.turn !== BLACK || !this.legal.length) return;
    this.keyboardMoveIndex = Math.min(this.keyboardMoveIndex, this.legal.length - 1);
    const [r, c] = this.legal[this.keyboardMoveIndex];
    this.ctx.hover(r, c, BLACK);
    const label = `${cellName(r, c)},第 ${this.keyboardMoveIndex + 1} 个合法落点,共 ${this.legal.length} 个`;
    this.ctx.renderer.domElement.setAttribute('aria-label', `3D 黑白棋棋盘。当前 ${label}`);
    if (announce) this.ui.announce(label);
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
    if (this.mode !== 'cards') return 0;
    return handCapFor(this.run, player);
  }

  // 开局补到上限;此后每回合只抽 1 张。🍀幸运草触发时额外抽 1 张。
  refill(player, opening = false) {
    if (this.mode !== 'cards' || !this.run) return;
    const cap = this.handCapFor(player);
    const lucky = player === BLACK && this.run.relics.includes('clover') && Math.random() < 0.3;
    const limit = cap + (lucky ? 1 : 0);
    let count = opening ? Math.max(0, limit - this.hands[player].length) : TURN_CARD_DRAW + (lucky ? 1 : 0);
    let drawn = 0;
    while (count-- > 0 && this.hands[player].length < limit) {
      if (drawCard(this.hands[player], limit)) drawn++;
    }
    if (player === BLACK && drawn > 0) this.audio.cardDraw();
    return drawn;
  }

  energyFor(player, penalty = 0) {
    if (this.mode !== 'cards') return 0;
    return Math.max(
      0,
      cardEnergyForTurn(
        this.board,
        player,
        this.movesPlayed[player],
        this.startingPlayer
      ) - penalty
    );
  }

  energyHintFor(player) {
    if (this.movesPlayed[player] === 0) {
      return player === this.startingPlayer ? '先手首轮' : '后手补偿';
    }
    return comebackActive(this.board, player) ? '逆风 +1' : '';
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
    this.hands = {
      [BLACK]: this.mode === 'cards' ? startingHandFor(this.run) : [],
      [WHITE]: [],
    };
    this.shieldOwner = null;
    this.ui.setShield(null);
    if (this.mode === 'cards' && this.run) {
      // 开局补满双方手牌(上限:玩家 handCap / 敌方 4+特权)
      this.refill(BLACK, true);
      this.refill(WHITE, true);
      // 敌方开局加子特权:从预设边线位依次放置(避开开局阵型)
      const cfg = this.runCfg();
      const spots = extraSpotsFor(size);
      for (let i = 0; i < Math.min(cfg.extraDiscs, spots.length); i++) {
        const [r, c] = spots[i];
        if (this.board[r][c] === EMPTY) this.board[r][c] = WHITE;
      }
    }
    this.turn = BLACK;
    this.startingPlayer = BLACK;
    this.movesPlayed = { [BLACK]: 0, [WHITE]: 0 };
    this.currentCardEnergy = 0;
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
      this.ui.setRunInfo(
        this.run.level,
        this.board.length,
        this.run.relics,
        this.handCapFor(BLACK),
        this.run.bonus.length,
        this.enemyPerksText()
      );
    }
    this.ui.clearCardSelection();
    this.updateScore();
    this.refreshLegal(true);
    this.ctx.renderer.domElement.focus({ preventScroll: true });
    this.audio.click();
    this.ui.toast(
      this.mode === 'cards'
        ? `第 ${this.run.level} 关 · 开局 ${this.handCapFor(BLACK)} 张 · 此后每回合抽 1 张 · 先手行动力 1`
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
      movesPlayed: { ...this.movesPlayed },
    });
    this.movesPlayed[player]++;
    this.consumeCards(player, cards);
    if (this.mode === 'cards') {
      if (player === BLACK) {
        this.ui.renderHand(this.hands[BLACK], false);
      } else {
        this.ui.renderAiHand(
          this.hands[WHITE].length,
          this.currentCardEnergy,
          this.energyHintFor(WHITE),
          cardEnergy(cards)
        );
      }
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
    this.audio.place(flips.length);
    this.ctx.shake(0.045 + Math.min(flips.length, 10) * 0.0025);
    this.ctx.punch(Math.min(flips.length / 5, 2));
    this.ctx.bounceNeighbors(r, c);
    this.ctx.impactAt(r, c, player === BLACK ? 0xf0b84e : 0x8fb6ff);
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
      this.ui.setShield(null);
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

    const n = this.board.length;
    const corner = (r === 0 || r === n - 1) && (c === 0 || c === n - 1);
    this.ui.showMoveFeedback({
      player: player === BLACK ? '你' : '电脑',
      flips: flips.length,
      cards,
      shielded: shieldBlocked,
      corner,
      extraTurn,
    });
    this.audio.moveResult({ flips: flips.length, cards: cards.length, corner, extraTurn });

    this.updateScore();
    if (isGameOver(this.board)) {
      this.endGame();
      return;
    }

    if (extraTurn) {
      this.phase = 'idle';
      this.refreshLegal(false, { drawCards: false, energyPenalty: 1 });
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
    const cardColors = {
      combo: 0xffd27a,
      blast: 0xff8a55,
      lucky: 0x8fd8ff,
      seed: 0x72d68f,
      shield: 0x8fb6ff,
      bomb: 0xff655f,
      echo: 0xd0a7ff,
      chain: 0xffc96b,
    };
    this.ctx.burst.spawn(
      this.ctx.cellX(c),
      this.ctx.cellY + 0.32,
      this.ctx.cellZ(r),
      id === 'combo' || id === 'shield' ? 48 : 34,
      cardColors[id] || 0xffc96b
    );
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
      this.ui.setShield(player);
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
          this.ctx.burst.spawn(
            this.ctx.cellX(tc),
            this.ctx.cellY + 0.3,
            this.ctx.cellZ(tr),
            60,
            0xff655f
          );
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

  refreshLegal(isFirst = false, { drawCards = true, energyPenalty = 0 } = {}) {
    if (this.phase === 'over') return;
    const moves = legalMoves(this.board, this.turn);
    this.legal = moves;

    if (moves.length > 0) {
      this.setTurnUi();
      if (this.turn === BLACK) {
        this.phase = 'idle';
        this.keyboardMoveIndex = 0;
        this.ui.setLocked(false);
        this.ctx.setLegal(moves);
        if (this.mode === 'cards') {
          if (!isFirst && drawCards) this.refill(BLACK);
          this.currentCardEnergy = this.energyFor(BLACK, energyPenalty);
          this.ui.setCardEnergy(this.currentCardEnergy, this.energyHintFor(BLACK));
          this.ui.renderHand(this.hands[BLACK], true);
        }
        if (this.ctx.renderer.domElement.matches(':focus-visible')) this.previewKeyboardMove(false);
      } else {
        this.scheduleAI({ drawCards: !isFirst && drawCards, energyPenalty });
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
      this.keyboardMoveIndex = 0;
      this.ui.setLocked(false);
      this.setTurnUi();
      this.ctx.setLegal(next);
      if (this.mode === 'cards') {
        this.refill(BLACK);
        this.currentCardEnergy = this.energyFor(BLACK);
        this.ui.setCardEnergy(this.currentCardEnergy, this.energyHintFor(BLACK));
        this.ui.renderHand(this.hands[BLACK], true);
      }
      if (this.ctx.renderer.domElement.matches(':focus-visible')) this.previewKeyboardMove(false);
    } else {
      this.scheduleAI();
    }
  }

  scheduleAI({ drawCards = true, energyPenalty = 0 } = {}) {
    if (this.phase === 'over') return;
    const gen = this.generation;
    this.phase = 'ai';
    this.logTrace('think');
    this.ctx.clearLegal();
    this.setTurnUi();
    this.ui.setLocked(true);
    let energy = 0;
    if (this.mode === 'cards') {
      if (drawCards) this.refill(WHITE);
      energy = this.energyFor(WHITE, energyPenalty);
      this.currentCardEnergy = energy;
      this.ui.renderAiHand(this.hands[WHITE].length, energy, this.energyHintFor(WHITE));
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
        cards = chooseCards(
          this.board,
          this.hands[WHITE],
          WHITE,
          mv[0],
          mv[1],
          this.aiDifficulty(),
          energy
        );
        for (const id of cards) {
          const idx = this.hands[WHITE].indexOf(id);
          if (idx >= 0) this.hands[WHITE].splice(idx, 1);
        }
        this.ui.renderAiHand(
          this.hands[WHITE].length,
          energy,
          this.energyHintFor(WHITE),
          cardEnergy(cards)
        );
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
    this.ui.setShield(null);
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
      for (let r = 0; r < this.board.length; r++) {
        for (let c = 0; c < this.board.length; c++) {
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
        this.movesPlayed = { ...snap.movesPlayed };
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
    this.ui.setShield(this.shieldOwner);
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
