// HUD:比分、回合指示、难度选择、悔棋/重开/静音/主页、提示条与终局弹窗;
// 管理主页(模式选择)、卡牌手牌栏(悬浮介绍 + 触发顺序队列)、肉鸽关卡栏与战利品面板。
import { CARD_META, RELIC_META } from './game.js';
import {
  createIcons,
  ArrowRight,
  Bomb,
  Clover,
  Crown,
  Dices,
  Hand,
  House,
  Layers3,
  Magnet,
  Repeat2,
  RotateCcw,
  Shield,
  Sparkles,
  Sprout,
  Undo2,
  Volume2,
  VolumeX,
  Workflow,
  Zap,
} from 'lucide';

const ORDER_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const UI_ICONS = {
  ArrowRight,
  Bomb,
  Clover,
  Crown,
  Dices,
  Hand,
  House,
  Layers3,
  Magnet,
  Repeat2,
  RotateCcw,
  Shield,
  Sparkles,
  Sprout,
  Undo2,
  Volume2,
  VolumeX,
  Workflow,
  Zap,
};

function refreshIcons() {
  createIcons({
    icons: UI_ICONS,
    attrs: {
      'aria-hidden': 'true',
      'stroke-width': 1.8,
    },
  });
  document.querySelectorAll('svg[data-lucide]').forEach((icon) => {
    icon.removeAttribute('data-lucide');
  });
}

export class UI {
  constructor() {
    this.el = document.getElementById('hud');
    this.el.innerHTML = `
      <div class="panel top-left">
        <div class="brand-lockup">
          <span class="brand-lockup-mark" aria-hidden="true"><i></i><i></i></span>
          <span class="brand-lockup-copy"><b>黑白棋</b><span class="sub">3D 解压版</span></span>
        </div>
        <div id="runbar" class="runbar hidden"></div>
        <div id="statusbar" class="statusbar hidden"></div>
      </div>
      <div class="panel top-center scoreboard">
        <div class="score black" id="score-black" aria-label="黑棋 2 子">
          <span class="player-label">你</span><span class="disc black" aria-hidden="true"></span><b id="num-black">2</b>
        </div>
        <div class="turnbox" role="status" aria-live="polite"><span id="turn-text">你的回合</span></div>
        <div class="score white" id="score-white" aria-label="白棋 2 子">
          <b id="num-white">2</b><span class="disc white" aria-hidden="true"></span><span class="player-label">电脑</span>
        </div>
      </div>
      <div class="panel top-right controls">
        <label class="sr-only" for="sel-diff">电脑难度</label>
        <select id="sel-diff" title="电脑难度">
          <option value="easy">简单</option>
          <option value="normal" selected>普通</option>
          <option value="hard">困难</option>
        </select>
        <button id="btn-undo" class="tool-button" type="button" title="悔棋 (U)"><i data-lucide="undo-2"></i><span>悔棋</span></button>
        <button id="btn-restart" class="tool-button" type="button" title="重新开始 (R)"><i data-lucide="rotate-ccw"></i><span>重开</span></button>
        <button id="btn-tutorial" class="tool-button" type="button" title="重新观看指引"><i data-lucide="sparkles"></i><span>指引</span></button>
        <button id="btn-mute" class="tool-button" type="button" title="音效 (M)" aria-label="静音" aria-pressed="false"><i data-lucide="volume-2"></i><span>音效</span></button>
        <button id="btn-home" class="tool-button" type="button" title="返回主页"><i data-lucide="house"></i><span>主页</span></button>
      </div>
      <div id="toast" class="toast" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="move-feedback" class="move-feedback" role="status" aria-live="polite" aria-atomic="true">
        <b id="move-grade"></b><span id="move-detail"></span>
      </div>
      <aside id="director" class="director hidden" role="region" aria-label="导演式新手指引" aria-live="polite" aria-atomic="true">
        <div class="director-head"><span id="director-kicker" class="director-kicker">导演指引</span><span id="director-progress" class="director-progress"></span></div>
        <div class="director-body"><span id="director-mark" class="director-mark" aria-hidden="true">✦</span><div><h2 id="director-title"></h2><p id="director-copy"></p></div></div>
        <div class="director-actions"><button id="director-next" class="btn-primary" type="button">继续</button><button id="director-skip" class="director-skip" type="button">跳过指引</button></div>
      </aside>
      <div id="cardbar" class="cardbar hidden">
        <div class="cardbar-head">
          <div id="cardbar-label" class="cardbar-label"></div>
          <div id="card-energy" class="card-energy" role="progressbar" aria-label="行动力"></div>
        </div>
        <div id="cardbar-cards" class="cardbar-cards"></div>
      </div>
      <div id="tooltip" class="tooltip hidden" role="tooltip"></div>
      <div id="hint" class="hint">点击发光格子落子 · 拖拽旋转视角 · 滚轮缩放 · R 重开 / U 悔棋 / M 静音</div>
      <div id="game-instructions" class="sr-only">棋盘获得焦点后,使用方向键切换合法落点,按 Enter 或空格落子。</div>
      <div id="board-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
      <div id="rotate-hint" class="rotate-hint" aria-hidden="true">横屏体验更佳</div>
      <div id="overlay" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="over-title" aria-describedby="over-sub" hidden>
        <div class="overlay-card">
          <div class="overlay-kicker">对局结算</div>
          <div id="over-title" class="over-title">你赢了!</div>
          <div id="over-score" class="over-score">33 : 31</div>
          <div id="over-sub" class="over-sub">漂亮!再下一局?</div>
          <button id="btn-again" class="btn-primary" type="button">再来一局</button>
        </div>
      </div>
      <div id="reward" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="reward-title" aria-describedby="reward-sub" hidden>
        <div class="overlay-card">
          <div class="overlay-kicker">关卡战利品</div>
          <div id="reward-title" class="over-title">第 1 关通过!</div>
          <div id="reward-score" class="over-score">30 : 20</div>
          <div id="reward-sub" class="over-sub">选择一件战利品</div>
          <div id="reward-options" class="reward-options"></div>
        </div>
      </div>
    `;
    this.els = {
      hud: this.el,
      numBlack: document.getElementById('num-black'),
      numWhite: document.getElementById('num-white'),
      scoreBlack: document.getElementById('score-black'),
      scoreWhite: document.getElementById('score-white'),
      turn: document.getElementById('turn-text'),
      diff: document.getElementById('sel-diff'),
      undo: document.getElementById('btn-undo'),
      restart: document.getElementById('btn-restart'),
      tutorial: document.getElementById('btn-tutorial'),
      mute: document.getElementById('btn-mute'),
      home: document.getElementById('btn-home'),
      toast: document.getElementById('toast'),
      cardbar: document.getElementById('cardbar'),
      cardLabel: document.getElementById('cardbar-label'),
      cardEnergy: document.getElementById('card-energy'),
      cardCards: document.getElementById('cardbar-cards'),
      tooltip: document.getElementById('tooltip'),
      runbar: document.getElementById('runbar'),
      statusbar: document.getElementById('statusbar'),
      moveFeedback: document.getElementById('move-feedback'),
      moveGrade: document.getElementById('move-grade'),
      moveDetail: document.getElementById('move-detail'),
      director: document.getElementById('director'),
      directorKicker: document.getElementById('director-kicker'),
      directorProgress: document.getElementById('director-progress'),
      directorMark: document.getElementById('director-mark'),
      directorTitle: document.getElementById('director-title'),
      directorCopy: document.getElementById('director-copy'),
      directorNext: document.getElementById('director-next'),
      directorSkip: document.getElementById('director-skip'),
      overlay: document.getElementById('overlay'),
      overTitle: document.getElementById('over-title'),
      overScore: document.getElementById('over-score'),
      overSub: document.getElementById('over-sub'),
      again: document.getElementById('btn-again'),
      reward: document.getElementById('reward'),
      rewardTitle: document.getElementById('reward-title'),
      rewardScore: document.getElementById('reward-score'),
      rewardSub: document.getElementById('reward-sub'),
      rewardOptions: document.getElementById('reward-options'),
      boardStatus: document.getElementById('board-status'),
    };
    this.homeEl = document.getElementById('home');
    this.cardsMode = false;
    this.runMode = false;
    this.cardQueue = []; // 手牌索引队列:重复卡牌也能逐张选择
    this._lastHand = [];
    this._lastSelectable = false;
    this.cardEnergyMax = 0;
    this.cardEnergyHint = '';
    this._toastTimer = null;
    this._moveFeedbackTimer = null;
    this._activeDialog = null;
    this._director = null;
    this._directorTarget = null;

    const savedDifficulty = localStorage.getItem('othello3d-difficulty');
    if (['easy', 'normal', 'hard'].includes(savedDifficulty)) {
      this.els.diff.value = savedDifficulty;
    }
    refreshIcons();
    document.addEventListener('keydown', (event) => this.trapDialogFocus(event));
  }

  setScores(b, w) {
    const oldBlack = Number(this.els.numBlack.textContent);
    const oldWhite = Number(this.els.numWhite.textContent);
    this.els.numBlack.textContent = b;
    this.els.numWhite.textContent = w;
    this.els.scoreBlack.setAttribute('aria-label', `黑棋 ${b} 子`);
    this.els.scoreWhite.setAttribute('aria-label', `白棋 ${w} 子`);
    if (oldBlack !== b) this.pulseScore(this.els.scoreBlack);
    if (oldWhite !== w) this.pulseScore(this.els.scoreWhite);
  }

  pulseScore(score) {
    score.classList.remove('score-pop');
    void score.offsetWidth;
    score.classList.add('score-pop');
  }

  setTurn(text, thinking = false) {
    this.els.turn.textContent = text;
    this.els.turn.classList.toggle('thinking-dots', thinking);
    this.els.turn.closest('.turnbox')?.classList.toggle('thinking', thinking);
  }

  toast(msg, dur = 1700) {
    const t = this.els.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), dur);
  }

  announce(msg) {
    this.els.boardStatus.textContent = '';
    requestAnimationFrame(() => {
      this.els.boardStatus.textContent = msg;
    });
  }

  showMoveFeedback({ player, flips, cards = [], shielded = false, corner = false, extraTurn = false }) {
    let grade = '落子';
    let tone = 'plain';
    if (shielded) {
      grade = '护盾格挡';
      tone = 'guard';
    } else if (corner) {
      grade = '角位到手';
      tone = 'great';
    } else if (flips >= 10) {
      grade = '逆转';
      tone = 'great';
    } else if (flips >= 6) {
      grade = '强攻';
      tone = 'strong';
    } else if (flips >= 3) {
      grade = '好棋';
      tone = 'good';
    }

    const parts = [`${player} · 翻 ${flips} 子`];
    if (cards.length) {
      parts.push(cards.map((id) => CARD_META[id]?.name).filter(Boolean).join(' → '));
    }
    if (extraTurn) parts.push('获得额外回合');
    this.els.moveGrade.textContent = grade;
    this.els.moveDetail.textContent = parts.join(' · ');
    this.els.moveFeedback.className = `move-feedback ${tone}`;
    void this.els.moveFeedback.offsetWidth;
    this.els.moveFeedback.classList.add('show');
    clearTimeout(this._moveFeedbackTimer);
    this._moveFeedbackTimer = setTimeout(
      () => this.els.moveFeedback.classList.remove('show'),
      1500
    );
  }

  setLocked(locked) {
    this.els.undo.disabled = locked;
    this.els.restart.disabled = locked;
    this.els.diff.disabled = locked;
  }

  // ---------- 导演式新手指引 ----------

  tutorialKey(mode) {
    return mode === 'cards' ? 'othello3d-tutorial-cards' : 'othello3d-tutorial-classic';
  }

  startDirector(mode, steps, { force = false } = {}) {
    if (!force && localStorage.getItem(this.tutorialKey(mode)) === '1') return false;
    this._director = { mode, steps, index: 0, actionDone: false };
    this.els.director.classList.remove('hidden');
    this.els.director.dataset.mode = mode;
    this.renderDirector();
    return true;
  }

  renderDirector() {
    const director = this._director;
    if (!director?.steps?.length) return;
    const step = director.steps[director.index];
    this.els.directorKicker.textContent = step.kicker || '导演指引';
    this.els.directorProgress.textContent = `${director.index + 1} / ${director.steps.length}`;
    this.els.directorMark.textContent = step.mark || (step.action === 'card' ? '卡' : step.action === 'board' || step.action === 'move' ? '点' : '✦');
    this.els.directorTitle.textContent = step.title;
    this.els.directorCopy.textContent = step.copy;
    const actionStep = Boolean(step.action);
    this.els.directorNext.hidden = actionStep;
    this.els.directorNext.textContent = step.nextLabel || '继续';
    this.els.directorSkip.textContent = step.skipLabel || '跳过指引';
    this.applyDirectorTarget();
    this._onDirectorStep?.(step, director.index);
  }

  applyDirectorTarget() {
    document.querySelectorAll('.director-target').forEach((el) => el.classList.remove('director-target'));
    const target = this._directorTarget;
    if (!target || !this._director) return;
    if (target.type === 'card' && target.id) {
      const card = [...this.els.cardCards.querySelectorAll('.card')].find((el) => el.dataset.id === target.id);
      card?.classList.add('director-target');
    }
  }

  setDirectorTarget(target = null) {
    this._directorTarget = target;
    this.applyDirectorTarget();
  }

  directorAction(action, payload = null) {
    const director = this._director;
    const step = director?.steps?.[director.index];
    if (!director || !step || step.action !== action) return false;
    director.actionDone = true;
    this._onDirectorAction?.(action, payload, step, director.index);
    return true;
  }

  advanceDirector({ force = false } = {}) {
    const director = this._director;
    const step = director?.steps?.[director.index];
    if (!director || !step) return false;
    if (step.action && !director.actionDone && !force) return false;
    director.index += 1;
    director.actionDone = false;
    if (director.index >= director.steps.length) {
      this.finishDirector();
    } else {
      this.renderDirector();
    }
    return true;
  }

  finishDirector(markSeen = true, notify = true) {
    if (!this._director) return;
    if (markSeen) localStorage.setItem(this.tutorialKey(this._director.mode), '1');
    this._director = null;
    this._directorTarget = null;
    this.els.director.classList.add('hidden');
    this.applyDirectorTarget();
    if (notify) this._onDirectorFinish?.();
  }

  skipDirector() {
    if (!this._director) return;
    this.finishDirector(true);
    this._onDirectorSkip?.();
  }

  isDirectorActive() {
    return Boolean(this._director);
  }

  directorStep() {
    return this._director?.steps?.[this._director.index] || null;
  }

  getDifficulty() {
    return this.els.diff.value;
  }

  setMuted(muted) {
    this.els.mute.innerHTML = `<i data-lucide="${muted ? 'volume-x' : 'volume-2'}"></i><span>${muted ? '静音' : '音效'}</span>`;
    this.els.mute.setAttribute('aria-label', muted ? '开启音效' : '静音');
    this.els.mute.setAttribute('aria-pressed', String(muted));
    refreshIcons();
  }

  showGameOver({ title, score, sub }) {
    this.els.overTitle.textContent = title;
    this.els.overScore.textContent = score;
    this.els.overSub.textContent = sub;
    this.els.again.textContent = '再来一局';
    this.openDialog(this.els.overlay, this.els.again);
  }

  hideGameOver() {
    this.closeDialog(this.els.overlay);
    this.closeDialog(this.els.reward);
  }

  // ---------- 卡牌栏 ----------

  setCardsMode(on) {
    this.cardsMode = on;
    this.els.hud.classList.toggle('cards-active', on);
    if (!on) this.els.cardbar.classList.add('hidden');
  }

  // 肉鸽模式:关卡栏 + 隐藏难度选择(难度随关卡升级)
  setRunMode(on) {
    this.runMode = on;
    this.els.diff.style.display = on ? 'none' : '';
  }

  setRunInfo(level, size, relics, handCap, bonusCount = 0, enemyText = '') {
    if (!this.runMode) {
      this.els.runbar.classList.add('hidden');
      return;
    }
    this.els.runbar.classList.remove('hidden');
    this.els.runbar.textContent =
      `第 ${level} 关 · ${size}×${size} · 手牌 ${handCap}` +
      `${relics.length ? ` · 遗物 ${relics.length}` : ''}` +
      `${bonusCount ? ` · 奖励卡 ${bonusCount}` : ''}` +
      `${enemyText ? ' · ' + enemyText : ''}`;
    this.els.runbar.title = this.els.runbar.textContent;
  }

  setShield(owner) {
    if (!owner) {
      this.els.statusbar.classList.add('hidden');
      this.els.statusbar.textContent = '';
      return;
    }
    this.els.statusbar.classList.remove('hidden');
    this.els.statusbar.textContent = `护盾生效 · ${owner === 1 ? '你' : '电脑'}`;
  }

  setCardEnergy(max, hint = '') {
    this.cardEnergyMax = max;
    this.cardEnergyHint = hint;
  }

  selectedCardEnergy() {
    return this.cardQueue.reduce(
      (sum, index) => sum + (CARD_META[this._lastHand[index]]?.cost || 0),
      0
    );
  }

  renderCardEnergy(used = 0, max = this.cardEnergyMax, label = '你的行动力') {
    this.els.cardEnergy.innerHTML = '';
    for (let i = 0; i < max; i++) {
      const pip = document.createElement('span');
      pip.className = `energy-pip${i < used ? ' spent' : ''}`;
      this.els.cardEnergy.appendChild(pip);
    }
    this.els.cardEnergy.setAttribute('aria-valuemin', '0');
    this.els.cardEnergy.setAttribute('aria-valuemax', String(max));
    this.els.cardEnergy.setAttribute('aria-valuenow', String(Math.max(0, max - used)));
    this.els.cardEnergy.setAttribute('aria-label', `${label},剩余 ${Math.max(0, max - used)} / ${max}`);
  }

  renderHand(hand, selectable, focusIndex = null) {
    if (!this.cardsMode) return;
    this._lastHand = hand;
    this._lastSelectable = selectable;
    this.cardQueue = this.cardQueue.filter((index) => index >= 0 && index < hand.length);
    while (this.cardQueue.length && hand[this.cardQueue[0]] === 'echo') {
      this.cardQueue.shift();
    }
    const usedEnergy = this.selectedCardEnergy();
    this.els.cardbar.classList.remove('hidden');
    this.els.cardbar.classList.toggle('ai-turn', !selectable);
    this.els.cardCards.innerHTML = '';
    hand.forEach((id, idx) => {
      const meta = CARD_META[id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `card tone-${meta.tone}`;
      btn.dataset.id = id;
      btn.dataset.index = idx;
      btn.innerHTML = `<span class="card-cost" aria-hidden="true">${meta.cost}</span><span class="card-art" aria-hidden="true"><i data-lucide="${meta.icon}"></i></span><span class="card-name">${meta.name}</span>`;
      btn.setAttribute('aria-label', `${meta.name},费用 ${meta.cost}:${meta.desc}`);
      if (selectable) {
        const order = this.cardQueue.indexOf(idx);
        if (order >= 0) {
          btn.classList.add('selected');
          btn.insertAdjacentHTML('beforeend', `<span class="card-order">${ORDER_MARKS[order]}</span>`);
        }
        btn.setAttribute('aria-pressed', String(order >= 0));
        const previousId = this.cardQueue.length
          ? hand[this.cardQueue[this.cardQueue.length - 1]]
          : null;
        const echoHasNoTarget = id === 'echo' && (!previousId || previousId === 'echo');
        if (order < 0 && (usedEnergy + meta.cost > this.cardEnergyMax || echoHasNoTarget)) {
          btn.classList.add('unaffordable');
          btn.setAttribute('aria-disabled', 'true');
        }
        btn.addEventListener('click', () => {
          if (this.cardQueue.includes(idx)) {
            this.cardQueue = this.cardQueue.filter((index) => index !== idx);
          } else {
            const lastId = this.cardQueue.length
              ? this._lastHand[this.cardQueue[this.cardQueue.length - 1]]
              : null;
            if (id === 'echo' && (!lastId || lastId === 'echo')) {
              this.toast('「回响」必须排在另一张卡后面');
              return;
            }
            if (this.selectedCardEnergy() + meta.cost > this.cardEnergyMax) {
              this.toast(`行动力不足:「${meta.name}」需要 ${meta.cost} 点`);
              return;
          }
          this.cardQueue.push(idx);
          }
          this.renderHand(this._lastHand, this._lastSelectable, idx);
          if (this.cardQueue.length > 0) {
            this.directorAction('card', { id, index: idx, selected: true });
          }
        });
      } else {
        btn.classList.add('disabled');
        btn.disabled = true;
      }
      btn.addEventListener('mouseenter', (e) => this.showTooltip(e.currentTarget, this.cardTip(meta)));
      btn.addEventListener('mouseleave', () => this.hideTooltip());
      btn.addEventListener('focus', (e) => this.showTooltip(e.currentTarget, this.cardTip(meta)));
      btn.addEventListener('blur', () => this.hideTooltip());
      this.els.cardCards.appendChild(btn);
    });
    this.renderCardEnergy(usedEnergy);
    refreshIcons();
    this.applyDirectorTarget();
    this.els.cardLabel.textContent = selectable
      ? `你的手牌 · 已用 ${usedEnergy}/${this.cardEnergyMax}${this.cardEnergyHint ? ` · ${this.cardEnergyHint}` : ''} · 按触发顺序选牌`
      : '你的手牌 · 动画结算中…';
    if (focusIndex !== null) {
      requestAnimationFrame(() => this.els.cardCards.children[focusIndex]?.focus());
    }
  }

  cardTip(meta) {
    const cost = meta.cost ? ` · 行动力 ${meta.cost}` : '';
    return `<span class="tooltip-title tone-${meta.tone || 'amber'}"><i data-lucide="${meta.icon || 'sparkles'}"></i><b>${meta.name}${cost}</b></span><span class="tooltip-desc">${meta.desc}</span>`;
  }

  showTooltip(el, html) {
    const tip = this.els.tooltip;
    tip.innerHTML = html;
    refreshIcons();
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.min(r.left + r.width / 2, window.innerWidth - 190)}px`;
    tip.style.top = `${r.top - 8}px`;
    tip.style.transform = 'translate(-50%, -100%)';
  }

  hideTooltip() {
    this.els.tooltip.classList.add('hidden');
  }

  renderAiHand(count, energy = 0, hint = '', used = 0) {
    if (!this.cardsMode) return;
    this.els.cardbar.classList.remove('hidden');
    this.els.cardbar.classList.add('ai-turn');
    this.els.cardCards.innerHTML = '';
    this.els.cardLabel.textContent = `电脑手牌 · ${count} 张 · 已用 ${used}/${energy}${hint ? ` · ${hint}` : ''}`;
    this.renderCardEnergy(used, energy, '电脑行动力');
  }

  getSelectedCards() {
    return this.cardQueue.map((index) => this._lastHand[index]).filter(Boolean);
  }

  clearCardSelection() {
    this.cardQueue = [];
    if (this.cardsMode && this._lastHand.length) {
      this.renderHand(this._lastHand, this._lastSelectable);
    }
  }

  // ---------- 肉鸽战利品 ----------

  showLevelClear(level, score, options) {
    this.els.rewardTitle.textContent = `第 ${level} 关通过`;
    this.els.rewardScore.textContent = score;
    this.els.rewardOptions.innerHTML = '';
    for (const opt of options) {
      let meta;
      if (opt.kind === 'handcap') {
        meta = { icon: 'hand', tone: 'sky', name: '手牌上限', desc: '永久 +1:可以保留更多战术牌' };
      } else {
        meta = opt.kind === 'relic' ? RELIC_META[opt.id] : CARD_META[opt.id];
      }
      const kindText = opt.kind === 'relic' ? '遗物' : opt.kind === 'handcap' ? '成长' : '卡牌';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `reward-opt tone-${meta.tone || 'amber'}`;
      btn.innerHTML = `<span class="reward-icon" aria-hidden="true"><i data-lucide="${meta.icon || 'sparkles'}"></i></span>
        <span class="reward-text"><b>${kindText} · ${meta.name}</b><span>${meta.desc}</span></span>`;
      btn.setAttribute('aria-label', `${kindText} ${meta.name}:${meta.desc}`);
      btn.addEventListener('click', () => {
        this.els.rewardOptions.querySelectorAll('button').forEach((option) => {
          option.disabled = true;
        });
        const accepted = this._onReward?.(opt);
        if (accepted === false) {
          this.els.rewardOptions.querySelectorAll('button').forEach((option) => {
            option.disabled = false;
          });
        }
      });
      btn.addEventListener('mouseenter', (e) => this.showTooltip(e.currentTarget, this.cardTip(meta)));
      btn.addEventListener('mouseleave', () => this.hideTooltip());
      this.els.rewardOptions.appendChild(btn);
    }
    refreshIcons();
    this.openDialog(this.els.reward, this.els.rewardOptions.querySelector('button'));
  }

  showRunOver(level, score) {
    this.els.overTitle.textContent = '闯关失败';
    this.els.overScore.textContent = score;
    this.els.overSub.textContent = `无尽模式 · 止步第 ${level} 关 · 遗物和卡牌都丢了,再闯一次!`;
    this.els.again.textContent = '再闯一次';
    this.openDialog(this.els.overlay, this.els.again);
  }

  showRunComplete(score) {
    this.els.overTitle.textContent = '通关成功!';
    this.els.overScore.textContent = score;
    this.els.overSub.textContent = '四关全部征服,再闯一次刷新纪录!';
    this.els.again.textContent = '再闯一次';
    this.openDialog(this.els.overlay, this.els.again);
  }

  onReward(cb) {
    this._onReward = cb;
  }

  // ---------- 主页 ----------

  showHome(focusMode = false) {
    this.finishDirector(false, false);
    this.homeEl.classList.remove('hidden');
    this.els.hud.classList.add('inactive');
    this.els.hud.setAttribute('aria-hidden', 'true');
    this.els.hud.inert = true;
    document.getElementById('app').inert = true;
    this.homeEl.setAttribute('aria-hidden', 'false');
    this.homeEl.inert = false;
    this.hideGameOver();
    if (focusMode) {
      requestAnimationFrame(() => document.getElementById('mode-classic').focus());
    }
  }

  hideHome() {
    this.homeEl.classList.add('hidden');
    this.homeEl.setAttribute('aria-hidden', 'true');
    this.homeEl.inert = true;
    this.els.hud.classList.remove('inactive');
    this.els.hud.setAttribute('aria-hidden', 'false');
    this.els.hud.inert = false;
    document.getElementById('app').inert = false;
  }

  isHomeVisible() {
    return !this.homeEl.classList.contains('hidden');
  }

  openDialog(dialog, focusTarget) {
    dialog.hidden = false;
    dialog.classList.remove('hidden');
    this._activeDialog = dialog;
    document.getElementById('app').inert = true;
    [...this.el.children].forEach((child) => {
      if (child !== dialog) child.inert = true;
    });
    focusTarget?.focus();
    requestAnimationFrame(() => focusTarget?.focus());
  }

  closeDialog(dialog) {
    dialog.classList.add('hidden');
    dialog.hidden = true;
    if (this._activeDialog === dialog) {
      this._activeDialog = null;
      document.getElementById('app').inert = this.isHomeVisible();
      [...this.el.children].forEach((child) => {
        child.inert = false;
      });
    }
  }

  trapDialogFocus(event) {
    if (event.key !== 'Tab' || !this._activeDialog) return;
    const focusable = [...this._activeDialog.querySelectorAll('button:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!this._activeDialog.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onModeSelect(cb) {
    document.getElementById('mode-classic').addEventListener('click', () => cb('classic'));
    document.getElementById('mode-cards').addEventListener('click', () => cb('cards'));
  }

  onDifficulty(cb) {
    this.els.diff.addEventListener('change', () => {
      localStorage.setItem('othello3d-difficulty', this.getDifficulty());
      cb(this.getDifficulty());
    });
  }

  onUndo(cb) {
    this.els.undo.addEventListener('click', cb);
  }

  onRestart(cb) {
    this.els.restart.addEventListener('click', cb);
  }

  onMute(cb) {
    this.els.mute.addEventListener('click', cb);
  }

  onHome(cb) {
    this.els.home.addEventListener('click', cb);
  }

  onAgain(cb) {
    this.els.again.addEventListener('click', cb);
  }

  onDirectorContinue(cb) {
    this.els.directorNext.addEventListener('click', cb);
  }

  onDirectorSkip(cb) {
    this.els.directorSkip.addEventListener('click', cb);
  }

  onDirectorAction(cb) {
    this._onDirectorAction = cb;
  }

  onDirectorStep(cb) {
    this._onDirectorStep = cb;
  }

  onDirectorFinish(cb) {
    this._onDirectorFinish = cb;
  }

  onTutorialReplay(cb) {
    this.els.tutorial.addEventListener('click', cb);
  }
}
