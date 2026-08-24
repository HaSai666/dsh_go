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
  createRunBoard,
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

const CARD_MODE_PACE = 0.62;

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
    this.tutorialPaused = false;
    this.tutorialPendingTurn = null;
    this.tutorialTarget = null;

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
    ui.onDirectorContinue(() => this.continueTutorial());
    ui.onDirectorSkip(() => this.skipTutorial());
    ui.onDirectorAction((action, payload) => this.handleTutorialAction(action, payload));
    ui.onDirectorStep((step) => this.handleDirectorStep(step));
    ui.onDirectorFinish(() => this.finishTutorial());
    ui.onTutorialReplay(() => this.replayTutorial());

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

  classicTutorialSteps() {
    return [
      {
        id: 'goal',
        kicker: '经典模式 · 1',
        title: '先学会夹击',
        copy: '你的棋子要把对手棋子夹在两端。夹住的棋子会翻成你的颜色,棋盘上最后谁的棋子多谁赢。',
        mark: '1',
      },
      {
        id: 'move',
        kicker: '经典模式 · 2',
        title: '跟着发光圈落子',
        copy: '发光格就是合法落点。先看橙色指环,再点击任意一个发光格试试。',
        action: 'move',
        mark: '点',
      },
      {
        id: 'flip',
        kicker: '经典模式 · 3',
        title: '看,中间的棋子翻面了',
        copy: '落子后,被两端夹住的棋子会连锁翻面。这就是黑白棋最核心的一步。',
        mark: '翻',
      },
      {
        id: 'corner',
        kicker: '经典模式 · 4',
        title: '角落是安全位置',
        copy: '角落没有相邻外侧,一旦占住就不会再被翻回。中盘先争角,通常比贪多翻几子更重要。',
        mark: '角',
      },
      {
        id: 'ready',
        kicker: '经典模式 · 完成',
        title: '现在可以自己下了',
        copy: '继续点击发光格落子。棋盘、比分和翻面动画会一直告诉你发生了什么。',
        mark: 'GO',
        nextLabel: '开始对局',
      },
    ];
  }

  cardsTutorialSteps() {
    return [
      {
        id: 'goal',
        kicker: '无尽卡牌 · 1',
        title: '边下棋,边用战术牌',
        copy: '先用普通落子夹击棋子,再把卡牌排成一条小连招。行动力用完前,你可以按顺序选多张牌。',
        mark: '1',
      },
      {
        id: 'card',
        kicker: '无尽卡牌 · 2',
        title: '先选一张低费牌',
        copy: '橙色边框标出建议牌。点击它,卡牌会出现序号,代表触发顺序。',
        action: 'card',
        mark: '卡',
      },
      {
        id: 'board',
        kicker: '无尽卡牌 · 3',
        title: '再点一个发光格',
        copy: '选牌后,点击棋盘上的合法格。棋子先落下,随后卡牌效果会依次结算。',
        action: 'board',
        mark: '点',
      },
      {
        id: 'combo',
        kicker: '无尽卡牌 · 4',
        title: '顺序就是策略',
        copy: '先用爆裂或播种铺路,再接回响复制上一张;连击会给你额外一手,但行动力会变少。',
        mark: '链',
      },
      {
        id: 'loot',
        kicker: '无尽卡牌 · 5',
        title: '赢下这一关,挑一件战利品',
        copy: '过关后会出现三选一:新卡、遗物或手牌上限。选完立刻进入下一关,整局没有固定终点。',
        mark: '奖',
      },
      {
        id: 'ready',
        kicker: '无尽卡牌 · 完成',
        title: '准备好冲下一关',
        copy: '每关都很短,但对手会逐渐获得特权。留意行动力和角落,三分钟内就能完成一局。',
        mark: 'GO',
        nextLabel: '开始闯关',
      },
    ];
  }

  beginTutorial(force = false) {
    this.tutorialPaused = false;
    this.tutorialPendingTurn = null;
    this.tutorialTarget = null;
    if (this.mode === 'cards') {
      this.tutorialTarget = this.hands[BLACK].includes('seed')
        ? 'seed'
        : this.hands[BLACK][0] || null;
    }
    const started = this.ui.startDirector(
      this.mode,
      this.mode === 'cards' ? this.cardsTutorialSteps() : this.classicTutorialSteps(),
      { force }
    );
    if (started) {
      this.handleDirectorStep(this.ui.directorStep());
    } else {
      this.ctx.setDirectorTarget(null);
      this.ui.setDirectorTarget(null);
    }
    return started;
  }

  handleDirectorStep(step) {
    if (!step || !this.ui.isDirectorActive()) {
      this.ctx.setDirectorTarget(null);
      this.ui.setDirectorTarget(null);
      return;
    }
    if (step.action === 'card') {
      this.ctx.setDirectorTarget(null);
      this.ui.setDirectorTarget({ type: 'card', id: this.tutorialTarget || this.hands[BLACK][0] });
      return;
    }
    this.ui.setDirectorTarget(null);
    if (step.action === 'move' || step.action === 'board') {
      const [r, c] = this.legal[0] || [];
      if (Number.isInteger(r) && Number.isInteger(c)) this.ctx.setDirectorTarget({ r, c });
      else this.ctx.setDirectorTarget(null);
    } else {
      this.ctx.setDirectorTarget(null);
    }
  }

  handleTutorialAction(action) {
    const step = this.ui.directorStep();
    if (!step || step.action !== action) return;
    if (action === 'card') {
      // 选牌完成后立即把导演镜头交给棋盘。
      this.ui.advanceDirector();
    }
  }

  continueTutorial() {
    if (!this.ui.isDirectorActive()) return;
    const step = this.ui.directorStep();
    if (step?.action) return;
    this.ui.advanceDirector();
  }

  skipTutorial() {
    if (this.ui.isDirectorActive()) this.ui.skipDirector();
  }

  finishTutorial() {
    this.ctx.setDirectorTarget(null);
    this.ui.setDirectorTarget(null);
    if (!this.tutorialPaused || !this.tutorialPendingTurn) return;
    const nextTurn = this.tutorialPendingTurn;
    this.tutorialPaused = false;
    this.tutorialPendingTurn = null;
    this.turn = nextTurn;
    this.phase = 'idle';
    this.ui.setLocked(false);
    this.refreshLegal();
  }

  replayTutorial() {
    if (this.mode !== 'classic' && this.mode !== 'cards') return;
    this.newGame({ tutorialForce: true });
  }

  // ---------- 肉鸽闯关 ----------

  runCfg() {
    return this.run ? runConfigFor(this.run.level) : null;
  }

  aiDifficulty() {
    if (this.run) return this.runCfg().diff;
    return this.difficulty;
  }

  animationPace() {
    return this.mode === 'cards' ? CARD_MODE_PACE : 1;
  }

  wait(ms) {
    return delay(ms * this.animationPace());
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
    if (this.phase !== 'idle' || this.turn !== BLACK || this.tutorialPaused) return;
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
    if (this.tutorialPaused) return;
    const cards = this.ui.getSelectedCards();
    if (this.mode === 'cards' && cardEnergy(cards) > this.currentCardEnergy) {
      this.ui.toast('选牌超过本回合行动力');
      this.audio.error();
      return;
    }
    const tutorialStep = this.ui.directorStep();
    if (tutorialStep?.action === 'move' || tutorialStep?.action === 'board') {
      this.ui.directorAction(tutorialStep.action, { r, c, cards });
    }
    this.ui.clearCardSelection();
    this.commitMove(r, c, BLACK, cards);
  }

  handleBoardKey(event) {
    if (this.phase !== 'idle' || this.turn !== BLACK || this.tutorialPaused || this.legal.length === 0) return false;
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
    if (this.phase !== 'idle' || this.turn !== BLACK || this.tutorialPaused || !this.legal.length) return;
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
      !this.tutorialPaused &&
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

  newGame({ tutorialForce = false } = {}) {
    this.generation++;
    this.trace = [];
    this.tutorialPaused = false;
    this.tutorialPendingTurn = null;
    this.tutorialTarget = null;
    // 经典模式固定 12×12;无尽模式使用 8~10 格快局与富开局。
    const size = this.mode === 'cards' && this.run ? boardSizeFor(this.run.level) : 12;
    this.board =
      this.mode === 'cards' && this.run
        ? createRunBoard(
            this.run.level,
            RICH_PATTERNS[Math.floor(Math.random() * RICH_PATTERNS.length)]
          )
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
      const needsCardTutorial =
        tutorialForce || localStorage.getItem('othello3d-tutorial-cards') !== '1';
      if (needsCardTutorial && !this.hands[BLACK].includes('seed')) {
        const cap = this.handCapFor(BLACK);
        if (this.hands[BLACK].length >= cap) this.hands[BLACK].pop();
        this.hands[BLACK].push('seed');
      }
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
    const tutorialStarted = this.beginTutorial(tutorialForce);
    this.ctx.renderer.domElement.focus({ preventScroll: true });
    this.audio.click();
    if (!tutorialStarted) {
      this.ui.toast(
        this.mode === 'cards'
          ? `第 ${this.run.level} 关 · 开局 ${this.handCapFor(BLACK)} 张 · 此后每回合抽 1 张 · 先手行动力 1`
          : '新的一局,黑棋先行'
      );
    }
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
    await this.ctx.dropPiece(piece, this.animationPace());
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
      await this.wait(i === 0 ? 120 : 55);
      if (gen !== this.generation) return;
      const f = flipsSorted[i];
      const p = this.ctx.pieceAt(f.r, f.c);
      if (p) {
        this.audio.flip(i);
        this.ctx.flipPiece(p, player, -(f.c - c), f.r - r, this.animationPace());
      }
    }
    await this.wait(260);
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
      await this.wait(450);
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
      await this.wait(400);
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

    const directorStep = this.ui.directorStep();
    if (
      player === BLACK &&
      (directorStep?.action === 'move' || directorStep?.action === 'board')
    ) {
      this.tutorialPaused = true;
      this.tutorialPendingTurn = extraTurn ? BLACK : WHITE;
      this.phase = 'idle';
      this.ui.setLocked(true);
      this.ui.advanceDirector();
      this.setTurnUi();
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
      this.ctx.flipPiece(p, player, -(mc - c) || 1, mr - r, this.animationPace());
      await this.wait(200);
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
    await this.wait(120);
    if (gen !== this.generation) return false;

    if (id === 'echo') {
      if (!prevCard || prevCard === 'echo') {
        this.ui.toast('🔁 回响落空:本步没有可重复的卡', 2000);
        return false;
      }
      this.ui.toast(`🔁 回响!重复「${CARD_META[prevCard].name}」`, 2000);
      await this.wait(150);
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
      await this.wait(110);
      if (gen !== this.generation) return false;
      if (effect === 'grow') {
        this.board[tr][tc] = player;
        const np = this.ctx.placePiece(tr, tc, player);
        this.audio.flip(i);
        this.ctx.dropPiece(np, this.animationPace());
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
          this.ctx.popPiece(p, this.animationPace());
        }
      } else {
        this.board[tr][tc] = player;
        const p = this.ctx.pieceAt(tr, tc);
        if (p) {
          this.audio.flip(i);
          this.ctx.flipPiece(p, player, -(tc - c) || 1, tr - r, this.animationPace());
        }
      }
      i++;
    }
    await this.wait(320);
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
    }, (this.mode === 'cards' ? 120 : 380) * (window.__QA_SLOWMO || 1));
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
        await this.wait(500);
        for (let i = 0; i < cells.length; i++) {
          if (gen !== this.generation) return;
          const { r, c } = cells[i];
          const p = this.ctx.pieceAt(r, c);
          if (p) {
            this.audio.flip(i);
            this.ctx.flipPiece(p, winner, 1, 0, this.animationPace());
          }
          await this.wait(40);
        }
        if (gen !== this.generation) return;
        this.audio.boom();
        await this.wait(400);
      }
    } else {
      await this.wait(400);
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
    if (this.phase !== 'idle' || this.turn !== BLACK || this.tutorialPaused) return;
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
    if (this.tutorialPaused) {
      this.ui.setTurn('跟着导演提示', false);
    } else if (this.phase === 'ai') {
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
