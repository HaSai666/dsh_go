// HUD:比分、回合指示、难度选择、悔棋/重开/静音/主页、提示条与终局弹窗;
// 管理主页(模式选择)、卡牌手牌栏(悬浮介绍 + 触发顺序队列)、肉鸽关卡栏与战利品面板。
import { CARD_META, RELIC_META } from './game.js';

const ORDER_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

export class UI {
  constructor() {
    this.el = document.getElementById('hud');
    this.el.innerHTML = `
      <div class="panel top-left">
        <div>黑白棋<span class="sub">3D 解压版</span></div>
        <div id="runbar" class="runbar hidden"></div>
      </div>
      <div class="panel top-center scoreboard">
        <div class="score black">
          <span class="disc black"></span><b id="num-black">2</b>
        </div>
        <div class="turnbox"><span id="turn-text">你的回合</span></div>
        <div class="score white">
          <b id="num-white">2</b><span class="disc white"></span>
        </div>
      </div>
      <div class="panel top-right controls">
        <select id="sel-diff" title="电脑难度">
          <option value="easy">简单</option>
          <option value="normal" selected>普通</option>
          <option value="hard">困难</option>
        </select>
        <button id="btn-undo" title="悔棋 (U)">悔棋</button>
        <button id="btn-restart" title="重新开始 (R)">重开</button>
        <button id="btn-mute" title="音效 (M)">🔊</button>
        <button id="btn-home" title="返回主页">主页</button>
      </div>
      <div id="toast" class="toast"></div>
      <div id="cardbar" class="cardbar hidden">
        <div id="cardbar-label" class="cardbar-label"></div>
        <div id="cardbar-cards" class="cardbar-cards"></div>
      </div>
      <div id="tooltip" class="tooltip hidden"></div>
      <div id="hint" class="hint">点击发光格子落子 · 拖拽旋转视角 · 滚轮缩放 · R 重开 / U 悔棋 / M 静音</div>
      <div id="rotate-hint" class="rotate-hint">🔄 横屏体验更佳</div>
      <div id="overlay" class="overlay hidden">
        <div class="overlay-card">
          <div id="over-title" class="over-title">你赢了!</div>
          <div id="over-score" class="over-score">33 : 31</div>
          <div id="over-sub" class="over-sub">漂亮!再下一局?</div>
          <button id="btn-again" class="btn-primary">再来一局</button>
        </div>
      </div>
      <div id="reward" class="overlay hidden">
        <div class="overlay-card">
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
      turn: document.getElementById('turn-text'),
      diff: document.getElementById('sel-diff'),
      undo: document.getElementById('btn-undo'),
      restart: document.getElementById('btn-restart'),
      mute: document.getElementById('btn-mute'),
      home: document.getElementById('btn-home'),
      toast: document.getElementById('toast'),
      cardbar: document.getElementById('cardbar'),
      cardLabel: document.getElementById('cardbar-label'),
      cardCards: document.getElementById('cardbar-cards'),
      tooltip: document.getElementById('tooltip'),
      runbar: document.getElementById('runbar'),
      overlay: document.getElementById('overlay'),
      overTitle: document.getElementById('over-title'),
      overScore: document.getElementById('over-score'),
      overSub: document.getElementById('over-sub'),
      again: document.getElementById('btn-again'),
      reward: document.getElementById('reward'),
      rewardTitle: document.getElementById('reward-title'),
      rewardScore: document.getElementById('reward-score'),
      rewardOptions: document.getElementById('reward-options'),
    };
    this.homeEl = document.getElementById('home');
    this.cardsMode = false;
    this.runMode = false;
    this.cardQueue = []; // 选牌顺序队列:顺序即触发顺序
    this._lastHand = [];
    this._lastSelectable = false;
    this._toastTimer = null;
  }

  setScores(b, w) {
    this.els.numBlack.textContent = b;
    this.els.numWhite.textContent = w;
  }

  setTurn(text, thinking = false) {
    this.els.turn.textContent = text;
    this.els.turn.classList.toggle('thinking-dots', thinking);
  }

  toast(msg, dur = 1700) {
    const t = this.els.toast;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), dur);
  }

  setLocked(locked) {
    this.els.undo.disabled = locked;
    this.els.restart.disabled = locked;
    this.els.diff.disabled = locked;
  }

  getDifficulty() {
    return this.els.diff.value;
  }

  setMuted(muted) {
    this.els.mute.textContent = muted ? '🔇' : '🔊';
  }

  showGameOver({ title, score, sub }) {
    this.els.overTitle.textContent = title;
    this.els.overScore.textContent = score;
    this.els.overSub.textContent = sub;
    this.els.overlay.classList.remove('hidden');
  }

  hideGameOver() {
    this.els.overlay.classList.add('hidden');
    this.els.reward.classList.add('hidden');
  }

  // ---------- 卡牌栏 ----------

  setCardsMode(on) {
    this.cardsMode = on;
    if (!on) this.els.cardbar.classList.add('hidden');
  }

  // 肉鸽模式:关卡栏 + 隐藏难度选择(难度随关卡升级)
  setRunMode(on) {
    this.runMode = on;
    this.els.diff.style.display = on ? 'none' : '';
  }

  setRunInfo(level, size, relics, handCap, enemyText = '') {
    if (!this.runMode) {
      this.els.runbar.classList.add('hidden');
      return;
    }
    this.els.runbar.classList.remove('hidden');
    const relicsText = relics.map((r) => RELIC_META[r].emoji).join(' ');
    this.els.runbar.textContent =
      `无尽 · 第 ${level} 关 · ${size}×${size} · 🀄×${handCap}` +
      `${relicsText ? ' ' + relicsText : ''}${enemyText ? ' · ' + enemyText : ''}`;
  }

  renderHand(hand, selectable) {
    if (!this.cardsMode) return;
    this._lastHand = hand;
    this._lastSelectable = selectable;
    this.els.cardbar.classList.remove('hidden');
    this.els.cardCards.innerHTML = '';
    hand.forEach((id, idx) => {
      const meta = CARD_META[id];
      const btn = document.createElement('button');
      btn.className = 'card';
      btn.dataset.id = id;
      btn.dataset.index = idx;
      btn.innerHTML = `<span class="card-emoji">${meta.emoji}</span><span class="card-name">${meta.name}</span>`;
      if (selectable) {
        const order = this.cardQueue.indexOf(id);
        if (order >= 0) {
          btn.classList.add('selected');
          btn.insertAdjacentHTML('beforeend', `<span class="card-order">${ORDER_MARKS[order]}</span>`);
        }
        btn.addEventListener('click', () => {
          if (this.cardQueue.includes(id)) {
            this.cardQueue = this.cardQueue.filter((x) => x !== id);
          } else {
            this.cardQueue.push(id);
          }
          this.renderHand(this._lastHand, this._lastSelectable);
        });
        btn.addEventListener('mouseenter', (e) => this.showTooltip(e.currentTarget, this.cardTip(meta)));
        btn.addEventListener('mouseleave', () => this.hideTooltip());
      } else {
        btn.classList.add('disabled');
      }
      this.els.cardCards.appendChild(btn);
    });
    this.els.cardLabel.textContent = selectable
      ? '你的手牌 · 依次点击排队(顺序即触发顺序)· 再点一次取消 · 选完点击棋盘落子'
      : '你的手牌 · 动画结算中…';
  }

  cardTip(meta) {
    return `<b>${meta.emoji} ${meta.name}</b><br>${meta.desc}`;
  }

  showTooltip(el, html) {
    const tip = this.els.tooltip;
    tip.innerHTML = html;
    tip.classList.remove('hidden');
    const r = el.getBoundingClientRect();
    tip.style.left = `${Math.min(r.left + r.width / 2, window.innerWidth - 190)}px`;
    tip.style.top = `${r.top - 8}px`;
    tip.style.transform = 'translate(-50%, -100%)';
  }

  hideTooltip() {
    this.els.tooltip.classList.add('hidden');
  }

  renderAiHand(count) {
    if (!this.cardsMode) return;
    this.els.cardbar.classList.remove('hidden');
    this.els.cardCards.innerHTML = '';
    this.els.cardLabel.textContent = `电脑手牌 · ${count} 张`;
  }

  getSelectedCards() {
    return [...this.cardQueue];
  }

  clearCardSelection() {
    this.cardQueue = [];
    if (this.cardsMode && this._lastHand.length) {
      this.renderHand(this._lastHand, this._lastSelectable);
    }
  }

  // ---------- 肉鸽战利品 ----------

  showLevelClear(level, score, options) {
    this.els.rewardTitle.textContent = `第 ${level} 关通过! 🎉`;
    this.els.rewardScore.textContent = score;
    this.els.rewardOptions.innerHTML = '';
    for (const opt of options) {
      let meta;
      if (opt.kind === 'handcap') {
        meta = { emoji: '🀄', name: '手牌上限', desc: '永久 +1:每回合补满手牌的上限' };
      } else {
        meta = opt.kind === 'relic' ? RELIC_META[opt.id] : CARD_META[opt.id];
      }
      const kindText = opt.kind === 'relic' ? '遗物' : opt.kind === 'handcap' ? '成长' : '卡牌';
      const btn = document.createElement('button');
      btn.className = 'reward-opt';
      btn.innerHTML = `<span class="reward-emoji">${meta.emoji}</span>
        <span class="reward-text"><b>${kindText} · ${meta.name}</b><span>${meta.desc}</span></span>`;
      btn.addEventListener('click', () => this._onReward?.(opt));
      btn.addEventListener('mouseenter', (e) => this.showTooltip(e.currentTarget, this.cardTip(meta)));
      btn.addEventListener('mouseleave', () => this.hideTooltip());
      this.els.rewardOptions.appendChild(btn);
    }
    this.els.reward.classList.remove('hidden');
  }

  showRunOver(level, score) {
    this.els.overTitle.textContent = '闯关失败 💔';
    this.els.overScore.textContent = score;
    this.els.overSub.textContent = `无尽模式 · 止步第 ${level} 关 · 遗物和卡牌都丢了,再闯一次!`;
    this.els.again.textContent = '再闯一次';
    this.els.overlay.classList.remove('hidden');
  }

  showRunComplete(score) {
    this.els.overTitle.textContent = '通关成功! 🏆';
    this.els.overScore.textContent = score;
    this.els.overSub.textContent = '四关全部征服,再闯一次刷新纪录!';
    this.els.again.textContent = '再闯一次';
    this.els.overlay.classList.remove('hidden');
  }

  onReward(cb) {
    this._onReward = cb;
  }

  // ---------- 主页 ----------

  showHome() {
    this.homeEl.classList.remove('hidden');
    this.els.hud.classList.add('inactive');
    this.hideGameOver();
  }

  hideHome() {
    this.homeEl.classList.add('hidden');
    this.els.hud.classList.remove('inactive');
  }

  onModeSelect(cb) {
    document.getElementById('mode-classic').addEventListener('click', () => cb('classic'));
    document.getElementById('mode-cards').addEventListener('click', () => cb('cards'));
  }

  onDifficulty(cb) {
    this.els.diff.addEventListener('change', () => cb(this.getDifficulty()));
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
}
