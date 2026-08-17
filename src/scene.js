// 3D 场景:绒布棋盘、瓷质棋子、合法落子高亮、幽灵跟手、拾取与动画接口。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Tweens, Burst, shakeBoard, easings } from './fx.js';
import { SIZE, EMPTY, BLACK, WHITE } from './game.js';

const CELL = 1;
const CELL_Y = 0.215; // 格子表面高度
const PIECE_Y = CELL_Y + 0.05; // 棋子底面:与格面拉开 0.05,任何深度精度下都不共面

let curSize = SIZE; // 当前棋盘尺寸(无尽模式随关卡增长)

function cellX(c) {
  return c - (curSize - 1) / 2;
}

function cellZ(r) {
  return r - (curSize - 1) / 2;
}

export function buildScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x191410);
  scene.fog = new THREE.Fog(0x191410, 20, 55);

  const camera = new THREE.PerspectiveCamera(
    35, // 12×12 大棋盘:视角收窄 + 相机距离拉远,整盘尽收眼底
    window.innerWidth / window.innerHeight,
    1.2, // 近裁剪面推远:压缩深度范围,低精度深度缓冲下更稳
    60
  );
  camera.position.set(0, 9.2, 11.2);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.1, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.75;
  controls.minDistance = 10;
  controls.maxDistance = 24;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = 1.22;

  // 室内环境贴图:给瓷质棋子的 clearcoat 提供真实反光。
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // 灯光:半球环境光 + 暖色主光(投影) + 冷色轮廓光。
  scene.add(new THREE.HemisphereLight(0xfff2dd, 0x33251a, 0.75));
  const sun = new THREE.DirectionalLight(0xffe3bb, 2.4);
  sun.position.set(4, 5.5, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.015;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8fa3d8, 0.7);
  rim.position.set(-8, 6, -8);
  scene.add(rim);

  const boardGroup = new THREE.Group();
  scene.add(boardGroup);
  const baseGroup = new THREE.Group(); // 外框/底板/格子:换尺寸时整体重建
  const pieceGroup = new THREE.Group(); // 棋子/幽灵/标记:跨尺寸保留
  boardGroup.add(baseGroup);
  boardGroup.add(pieceGroup);

  // 大桌面:接阴影,让棋盘有"摆在家具上"的感觉。
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshStandardMaterial({ color: 0x241a12, roughness: 0.95 })
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.22;
  table.receiveShadow = true;
  scene.add(table);

  // 胡桃木外框材质(共享)。
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x3a2718,
    roughness: 0.55,
    metalness: 0.05,
  });

  // 按尺寸重建棋盘底座(外框 4 墙 + 绒布底板 + size² 个格子)。
  // 外框绝不能用实心盒子:实心盒子的顶面会与棋盘面板完全共面,导致整盘 z-fighting 频闪。
  let cells = [];
  let cellGeo = null;

  function buildBase(size) {
    // 清空旧底座
    for (const child of [...baseGroup.children]) {
      baseGroup.remove(child);
      if (child.material && child.material !== frameMat) child.material.dispose();
    }
    if (cellGeo) cellGeo.dispose();
    cells = [];
    cellGeo = new THREE.PlaneGeometry(0.92, 0.92);

    // 四块实木墙拼成真正的框
    const frameOuter = size + 1.4;
    const wallW = 0.45;
    const wallH = 0.62;
    const wallY = 0.01; // 顶面 0.32,高于格面 0.215,形成围边
    const wallCenter = (frameOuter - wallW) / 2;
    const wallLong = new THREE.BoxGeometry(frameOuter, wallH, wallW);
    const wallShort = new THREE.BoxGeometry(wallW, wallH, frameOuter - 2 * wallW);
    for (const [x, z, geo] of [
      [0, wallCenter, wallLong],
      [0, -wallCenter, wallLong],
      [wallCenter, 0, wallShort],
      [-wallCenter, 0, wallShort],
    ]) {
      const wall = new THREE.Mesh(geo, frameMat);
      wall.position.set(x, wallY, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      baseGroup.add(wall);
    }

    // 绒布底板:下沉 0.145,格子像浮雕一样浮在底板上
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(size + 0.35, 0.26, size + 0.35, 4, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x1f4433, roughness: 0.92 })
    );
    slab.position.y = -0.06;
    slab.receiveShadow = true;
    baseGroup.add(slab);

    // size² 个格子:双绿交替成网格,每格独立材质以便单独高亮。
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const m = new THREE.Mesh(
          cellGeo,
          new THREE.MeshStandardMaterial({
            color: (r + c) % 2 ? 0x2f6349 : 0x28553e,
            roughness: 0.95,
            emissive: 0x000000,
          })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(cellX(c), CELL_Y, cellZ(r));
        m.receiveShadow = true;
        m.userData = { r, c };
        baseGroup.add(m);
        cells.push(m);
      }
    }
  }

  // 相机自适应:棋盘(含外框)容纳进屏幕较窄维度;并用"近端边角"约束补偿透视放大,
  // 保证靠近相机的底行格子中心不被裁出屏幕(桌面与手机横竖屏通吃)。
  function fitCamera(size) {
    const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
    const boardWorld = size + 1.4;
    const hFovHalf = Math.atan(Math.tan((35 * Math.PI) / 360) * aspect);
    const tanH = Math.tan(hFovHalf);
    const distW = boardWorld / 2 / (tanH * 0.92);
    // 手机(窄屏/超宽屏)用更浅的俯角,近端边角垂直方向也能收进屏幕;
    // 桌面保持既有构图不变。
    const mobile = aspect < 1.2 || aspect > 2.1;
    const a = mobile ? 0.47 : 0.635;
    const b = mobile ? 0.88 : 0.773;
    const distH = (mobile ? 8.9 : 11.08) * (boardWorld / 13.4);
    const nearOff = (mobile ? 5.33 : 4.76) * (boardWorld / 13.4);
    const yNear = (mobile ? 2.7 : 3.66) * (boardWorld / 13.4);
    const distNearH = nearOff + (boardWorld / 2 - 1.2) / (0.95 * tanH);
    const distNearV = nearOff + yNear / (0.29925);
    const d = Math.min(
      Math.max(distW, distH, mobile ? Math.max(distNearH, distNearV) : 0, 10),
      60
    );
    camera.position.set(0, a * d, b * d);
    controls.minDistance = d * 0.7;
    controls.maxDistance = d * 1.9;
    camera.updateProjectionMatrix();
  }

  buildBase(SIZE);
  fitCamera(SIZE);

  // 棋子几何体:扁圆盘 + 拱顶(车削成形)。
  const pieceGeo = new THREE.LatheGeometry(
    [
      new THREE.Vector2(0.002, 0),
      new THREE.Vector2(0.4, 0.002),
      new THREE.Vector2(0.44, 0.03),
      new THREE.Vector2(0.45, 0.07),
      new THREE.Vector2(0.44, 0.12),
      new THREE.Vector2(0.36, 0.18),
      new THREE.Vector2(0.2, 0.24),
      new THREE.Vector2(0.002, 0.28),
    ],
    40
  );

  // 瓷质黑白双色材质 + 半透明幽灵材质。
  const mats = {
    [BLACK]: new THREE.MeshPhysicalMaterial({
      color: 0x050509,
      roughness: 0.55,
      clearcoat: 0.12,
      clearcoatRoughness: 0.45,
      envMapIntensity: 0.35,
    }),
    [WHITE]: new THREE.MeshPhysicalMaterial({
      color: 0xf4efe2,
      roughness: 0.2,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
    }),
  };
  const ghostMats = {
    [BLACK]: new THREE.MeshPhysicalMaterial({
      color: 0x16161c,
      roughness: 0.3,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
    [WHITE]: new THREE.MeshPhysicalMaterial({
      color: 0xf4efe2,
      roughness: 0.3,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  };

  const pieces = [];
  const pieceByCell = new Map();

  function ensurePiece(r, c) {
    const key = r * curSize + c;
    let piece = pieceByCell.get(key);
    if (!piece) {
      const mesh = new THREE.Mesh(pieceGeo, mats[BLACK]);
      mesh.castShadow = true;
      mesh.position.set(cellX(c), PIECE_Y, cellZ(r));
      mesh.visible = false;
      pieceGroup.add(mesh);
      piece = { mesh, r, c, color: EMPTY };
      pieceByCell.set(key, piece);
      pieces.push(piece);
    }
    return piece;
  }

  function setPieceColor(piece, color) {
    piece.color = color;
    piece.mesh.material = mats[color];
  }

  // 幽灵棋子:跟随鼠标在合法格上浮动预览。
  const ghost = new THREE.Mesh(pieceGeo, ghostMats[BLACK]);
  ghost.visible = false;
  ghost.castShadow = false;
  ghost.receiveShadow = false;
  pieceGroup.add(ghost);

  // 最后落子标记:悬浮在棋子顶部的琥珀色光晕(原先的环会被棋子盖住)。
  const lastMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.21, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffc94d,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  lastMarker.rotation.x = -Math.PI / 2;
  lastMarker.position.y = CELL_Y + 0.42;
  lastMarker.visible = false;
  pieceGroup.add(lastMarker);

  const tweens = new Tweens();
  const burst = new Burst(scene);
  const raycaster = new THREE.Raycaster();

  // ---- 高亮管理 ----
  const legalSet = new Set();

  function setLegal(moves) {
    clearLegal();
    for (const [r, c] of moves) {
      const m = cells[r * curSize + c];
      m.material.emissive.setHex(0x46d98a);
      m.material.emissiveIntensity = 0.5;
      legalSet.add(m);
    }
  }

  function clearLegal() {
    for (const m of legalSet) {
      m.material.emissive.setHex(0x000000);
      m.material.emissiveIntensity = 1;
    }
    legalSet.clear();
    ghost.visible = false;
  }

  function hover(r, c, color) {
    if (r === null || c === null) {
      ghost.visible = false;
      return;
    }
    ghost.visible = true;
    ghost.material = ghostMats[color];
    ghost.position.set(cellX(c), CELL_Y + 0.07, cellZ(r));
  }

  // ---- 棋子动画 ----

  function placePiece(r, c, color) {
    const piece = ensurePiece(r, c);
    setPieceColor(piece, color);
    piece.mesh.visible = true;
    piece.mesh.position.y = PIECE_Y + 2.8;
    piece.mesh.scale.set(1, 1, 1);
    return piece;
  }

  // 坠落拍击:自由落体曲线,Promise 在拍上棋盘时 resolve。
  // QA 慢动作下同步拉长,便于无头定点抓拍(生产恒为 1)。
  function dropPiece(piece) {
    const ts = window.__QA_SLOWMO || 1;
    return new Promise((resolve) => {
      tweens.add({
        dur: 0.3 * ts,
        ease: easings.easeInQuad,
        update: (e) => {
          piece.mesh.position.y = PIECE_Y + 2.8 * (1 - e);
        },
        done: () => {
          piece.mesh.position.y = PIECE_Y;
          resolve();
        },
      });
    });
  }

  // 邻近棋子被震得跳一下。
  function bounceNeighbors(r, c) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= curSize || cc < 0 || cc >= curSize) continue;
        const piece = pieceByCell.get(rr * curSize + cc);
        if (!piece || !piece.mesh.visible) continue;
        const base = piece.mesh.position.y;
        piece.bouncing = true;
        tweens.add({
          dur: 0.26,
          update: (e) => {
            piece.mesh.scale.y = 1 - 0.13 * Math.sin(Math.PI * e);
            piece.mesh.position.y = base + 0.05 * Math.sin(Math.PI * e);
          },
          done: () => {
            piece.mesh.scale.y = 1;
            piece.mesh.position.y = base;
            piece.bouncing = false;
          },
        });
      }
    }
  }

  // 翻面:绕"垂直于 落点→棋子 方向"的水平轴翻转半圈,半程换色。
  // 翻转时小跳 + 横向收窄,防止棋子边缘在旋转中穿过格面造成穿插/闪烁。
  function flipPiece(piece, color, axisX, axisZ) {
    return new Promise((resolve) => {
      const axis = new THREE.Vector3(axisX, 0, axisZ).normalize();
      let swapped = false;
      tweens.add({
        dur: 0.22,
        update: (e) => {
          const s = Math.sin(Math.PI * e);
          piece.mesh.quaternion.setFromAxisAngle(axis, Math.PI * e);
          if (!piece.bouncing) {
            piece.mesh.position.y = PIECE_Y + 0.32 * s;
          }
          const sh = 1 - 0.5 * s;
          piece.mesh.scale.set(sh, 1, sh);
          if (!swapped && e >= 0.5) {
            swapped = true;
            setPieceColor(piece, color);
          }
        },
        done: () => {
          piece.mesh.quaternion.identity();
          piece.mesh.position.y = PIECE_Y;
          piece.mesh.scale.set(1, 1, 1);
          setPieceColor(piece, color);
          resolve();
        },
      });
    });
  }

  function setLastMove(r, c) {
    lastMarker.visible = true;
    lastMarker.position.set(cellX(c), CELL_Y + 0.42, cellZ(r));
  }

  function clearLastMove() {
    lastMarker.visible = false;
  }

  // 爆破卡:棋子被炸飞(放大+上升后消失)。
  function popPiece(piece) {
    return new Promise((resolve) => {
      tweens.add({
        dur: 0.28,
        update: (e) => {
          piece.mesh.scale.setScalar(1 + 0.4 * e);
          piece.mesh.position.y = PIECE_Y + 0.6 * e;
        },
        done: () => {
          piece.mesh.visible = false;
          piece.mesh.scale.set(1, 1, 1);
          piece.mesh.position.y = PIECE_Y;
          resolve();
        },
      });
    });
  }

  // 立即同步到某个盘面(新局/悔棋用),打断所有进行中的动画。
  function syncBoard(board) {
    tweens.clear(true);
    clearLegal();
    const n = board.length;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r][c];
        if (v === EMPTY) {
          const existing = pieceByCell.get(r * curSize + c);
          if (existing) existing.mesh.visible = false;
          continue;
        }
        const piece = ensurePiece(r, c);
        piece.mesh.visible = true;
        piece.mesh.position.set(cellX(c), PIECE_Y, cellZ(r));
        piece.mesh.scale.set(1, 1, 1);
        piece.mesh.quaternion.identity();
        setPieceColor(piece, v);
      }
    }
  }

  // 清空全部棋子(棋盘尺寸变化时用)。
  function clearPieces() {
    for (const piece of pieces) {
      pieceGroup.remove(piece.mesh);
    }
    pieces.length = 0;
    pieceByCell.clear();
  }

  // 无尽模式:随关卡重建棋盘并适配相机与阴影范围。
  function resizeBoard(size) {
    curSize = size;
    buildBase(size);
    clearPieces();
    clearLegal();
    clearLastMove();
    fitCamera(size);
    const half = size / 2 + 3;
    sun.shadow.camera.left = -half;
    sun.shadow.camera.right = half;
    sun.shadow.camera.top = half;
    sun.shadow.camera.bottom = -half;
    sun.shadow.camera.updateProjectionMatrix();
  }

  function cellFromPointer(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(cells, false);
    return hits.length ? hits[0].object.userData : null;
  }

  // 落子"推冲":FOV 快速鼓一下再收回,配合拍击给镜头一个力量感。
  function punch() {
    tweens.add({
      dur: 0.34,
      ease: easings.linear,
      update: (_, k) => {
        camera.fov = 35 + 3.4 * Math.sin(Math.PI * k);
        camera.updateProjectionMatrix();
      },
      done: () => {
        camera.fov = 35;
        camera.updateProjectionMatrix();
      },
    });
  }

  function update(dt, time) {
    // 静态画面下除了补间/粒子外不做任何周期性变化,从根源上杜绝频闪。
    tweens.update(dt);
    burst.update(dt);
    // 主页氛围:空棋盘缓缓自转;进入游戏后平滑归零。
    if (idleMode) {
      boardGroup.rotation.y += dt * 0.2;
    } else if (boardGroup.rotation.y !== 0) {
      boardGroup.rotation.y *= Math.max(0, 1 - dt * 3);
      if (Math.abs(boardGroup.rotation.y) < 0.001) boardGroup.rotation.y = 0;
    }
    // 鼠标视差:镜头目标点柔和追随光标,盘面始终"活着"。
    const k = Math.min(1, dt * 4);
    controls.target.x += (mouseNdc.x * 0.55 - controls.target.x) * k;
    controls.target.y += (0.1 - mouseNdc.y * 0.3 - controls.target.y) * k;
    controls.update();
    renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    fitCamera(curSize); // 旋转屏幕/改变窗口后重新构图
  }
  window.addEventListener('resize', resize);

  // 视差用光标位置(NDC)。
  const mouseNdc = { x: 0, y: 0 };
  window.addEventListener('pointermove', (e) => {
    mouseNdc.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNdc.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  let idleMode = false;
  function setIdleMode(on) {
    idleMode = on;
  }

  return {
    renderer,
    scene,
    camera,
    controls,
    boardGroup,
    tweens,
    burst,
    sun,
    cellY: CELL_Y,
    cellX,
    cellZ,
    ghost,
    setLegal,
    clearLegal,
    setIdleMode,
    hover,
    placePiece,
    dropPiece,
    bounceNeighbors,
    flipPiece,
    popPiece,
    setLastMove,
    clearLastMove,
    syncBoard,
    cellFromPointer,
    pieceAt: (r, c) => pieceByCell.get(r * curSize + c) || null,
    shake: (strength) => shakeBoard(boardGroup, tweens, strength),
    punch,
    resizeBoard,
    update,
    resize,
  };
}
