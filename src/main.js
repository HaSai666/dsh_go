// 入口:场景 + HUD + 音效 + 对局。启动即主页(空棋盘氛围背景),选模式后开局。
import * as THREE from 'three';
import * as gameMod from './game.js';
import { buildScene } from './scene.js';
import { UI } from './ui.js';
import { AudioFX } from './audio.js';
import { Game } from './controller.js';
import { EMPTY, BLACK, WHITE, createBoard } from './game.js';

const app = document.getElementById('app');
const ctx = buildScene(app);
const ui = new UI();
const audio = new AudioFX();
ui.setMuted(audio.muted);
const game = new Game(ctx, ui, audio);

// 无头调试钩子:供 debug-headless.mjs 驱动、校验与截图。
window.__THREE = THREE;
window.__ctx = ctx;
window.__game = game;
window.__ui = ui;
window.__audio = audio;
window.__consts = { EMPTY, BLACK, WHITE };
window.__gameMod = gameMod;

// 主页启动:空棋盘慢速自转作为背景氛围。
ctx.syncBoard(createBoard());
ctx.setIdleMode(true);
ui.showHome();

// 浏览器要求用户手势后才能出声:首次交互时创建/恢复 AudioContext。
window.addEventListener('pointerdown', () => audio.ensure());

const clock = new THREE.Clock();
function loop() {
  const dt = Math.min(clock.getDelta(), 0.05);
  ctx.update(dt, clock.elapsedTime);
  requestAnimationFrame(loop);
}
loop();
