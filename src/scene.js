// 3D 场景:绒布棋盘、瓷质棋子、合法落子高亮、幽灵跟手、拾取与动画接口。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Tweens, Burst, shakeBoard, easings } from './fx.js';
import { SIZE, EMPTY, BLACK, WHITE } from './game.js';

const CELL = 1;
const CELL_Y = 0.215; // 模块顶面高度
const PIECE_Y = CELL_Y + 0.05; // 动物脚底略离开模块,避免深度冲突
const PET_HEIGHT = 0.72;
const ACCENT = 0xff9b5f;

const ASSET_ROOT = `${import.meta.env.BASE_URL || '/'}assets/kenney`;
const SKYBOX_ASSET = `${ASSET_ROOT}/skyboxes/skybox-day-2k.png`;
const PET_ASSETS = {
  [BLACK]: `${ASSET_ROOT}/cube-pets/Models/GLB%20format/animal-cat.glb`,
  [WHITE]: `${ASSET_ROOT}/cube-pets/Models/GLB%20format/animal-panda.glb`,
};
const HOME_FOX_ASSET = `${ASSET_ROOT}/cube-pets/Models/GLB%20format/animal-fox.glb`;
const ARENA_ASSETS = {
  block: `${ASSET_ROOT}/mini-arena/Models/GLB%20format/block.glb`,
  column: `${ASSET_ROOT}/mini-arena/Models/GLB%20format/column.glb`,
  trophy: `${ASSET_ROOT}/mini-arena/Models/GLB%20format/trophy.glb`,
};

let curSize = SIZE; // 当前棋盘尺寸(无尽模式随关卡增长)

function cellX(c) {
  return c - (curSize - 1) / 2;
}

function cellZ(r) {
  return r - (curSize - 1) / 2;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// 程序纹理让绒布与木框在不加载外部素材的前提下拥有稳定的微表面细节。
function makeSurfaceTexture(renderer, { base, noise = 12, weave = false, grain = false, seed = 1 }) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  const random = seededRandom(seed);
  for (let i = 0; i < image.data.length; i += 4) {
    const variation = (random() - 0.5) * noise;
    image.data[i] = Math.max(0, Math.min(255, base[0] + variation));
    image.data[i + 1] = Math.max(0, Math.min(255, base[1] + variation));
    image.data[i + 2] = Math.max(0, Math.min(255, base[2] + variation));
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);

  if (weave) {
    context.globalCompositeOperation = 'soft-light';
    for (let p = 1; p < 256; p += 4) {
      context.strokeStyle = p % 8 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.14)';
      context.beginPath();
      context.moveTo(p, 0);
      context.lineTo(p, 256);
      context.stroke();
      context.beginPath();
      context.moveTo(0, p + 1);
      context.lineTo(256, p + 1);
      context.stroke();
    }
  }

  if (grain) {
    context.globalCompositeOperation = 'screen';
    for (let i = 0; i < 52; i++) {
      const y = random() * 256;
      context.strokeStyle = `rgba(190,150,108,${0.025 + random() * 0.045})`;
      context.lineWidth = 0.5 + random() * 1.2;
      context.beginPath();
      context.moveTo(0, y);
      context.bezierCurveTo(64, y + random() * 9 - 4.5, 192, y + random() * 9 - 4.5, 256, y);
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

function makeContactShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  const gradient = context.createRadialGradient(32, 32, 3, 32, 32, 31);
  gradient.addColorStop(0, 'rgba(255,255,255,.92)');
  gradient.addColorStop(0.62, 'rgba(255,255,255,.52)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

function makeBoardShadowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.filter = 'blur(14px)';
  context.fillStyle = 'rgba(255,255,255,.82)';
  context.fillRect(24, 24, 208, 208);
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

// Lightweight fallback used until the licensed skybox finishes decoding.
function makeFallbackSkyTexture(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#72a9e6');
  gradient.addColorStop(0.54, '#a9c9f0');
  gradient.addColorStop(1, '#e5c6a6');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  return texture;
}

export function buildScene(container) {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const memoryConstrained = (navigator.deviceMemory || 8) <= 4;
  const isCompactViewport = () => Math.min(window.innerWidth, window.innerHeight) < 700;
  const pixelRatioCap = (size) => {
    if (size >= 16) return 1;
    return isCompactViewport() && !memoryConstrained ? 1.2 : 1;
  };
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap(SIZE)));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fallbackSkyTexture = makeFallbackSkyTexture(renderer);
  scene.background = null;
  scene.fog = new THREE.Fog(0x35546d, 24, 96);

  const camera = new THREE.PerspectiveCamera(
    35, // 12×12 大棋盘:视角收窄 + 相机距离拉远,整盘尽收眼底
    window.innerWidth / window.innerHeight,
    1.2, // 近裁剪面推远:压缩深度范围,低精度深度缓冲下更稳
    100
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

  // Keep the sky outside the tone-mapped arena lighting so the licensed art
  // stays bright and readable. The sprite is resized and re-anchored to the
  // camera, which prevents gaps when the board or viewport changes size.
  const skyMaterial = new THREE.SpriteMaterial({
    map: fallbackSkyTexture,
    color: 0xc0d6f0,
    transparent: false,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    fog: false,
  });
  const skyPlate = new THREE.Sprite(skyMaterial);
  skyPlate.name = 'asset-skybox';
  skyPlate.renderOrder = -1;
  let skyAssetState = 'loading';
  skyPlate.visible = !document.querySelector('.sky-preload');
  scene.add(skyPlate);

  const skyDistance = 42;
  const skyDirection = new THREE.Vector3();
  function fitSky() {
    const viewHeight =
      2 * skyDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const viewWidth = viewHeight * camera.aspect;
    const spriteHeight = Math.max(viewHeight, viewWidth / 2) * 1.2;
    skyPlate.scale.set(spriteHeight * 2, spriteHeight, 1);
  }
  function updateSky(time, animate) {
    camera.getWorldDirection(skyDirection);
    skyPlate.position.copy(camera.position).addScaledVector(skyDirection, skyDistance);
    if (animate) {
      skyPlate.position.x += Math.sin(time * 0.07) * 0.65;
      skyPlate.position.y += Math.sin(time * 0.11 + 1.2) * 0.2;
    }
  }
  fitSky();

  const configureSkyTexture = (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.anisotropy = 1;
    texture.needsUpdate = true;
    return texture;
  };
  const activateSkyTexture = (texture) => {
    skyMaterial.map = configureSkyTexture(texture);
    skyMaterial.needsUpdate = true;
    fallbackSkyTexture.dispose();
    skyAssetState = 'ready';
    skyPlate.visible = true;
    skyPlate.userData.assetReady = true;
    document.querySelector('.sky-preload')?.remove();
  };
  const useFallbackSky = () => {
    // The gradient remains visible if a static host blocks the optional art.
    document.querySelector('.sky-preload')?.remove();
    skyAssetState = 'fallback';
    skyPlate.visible = true;
    skyPlate.userData.assetReady = false;
  };
  const preloadImage = document.querySelector('.sky-preload');
  if (preloadImage) {
    const usePreloadedImage = () => {
      if (skyAssetState !== 'loading' || !preloadImage.naturalWidth) return;
      activateSkyTexture(new THREE.Texture(preloadImage));
    };
    if (preloadImage.complete) {
      if (preloadImage.naturalWidth) usePreloadedImage();
      else useFallbackSky();
    }
    else {
      preloadImage.addEventListener('load', usePreloadedImage, { once: true });
      preloadImage.addEventListener('error', useFallbackSky, { once: true });
    }
  } else {
    const skyLoader = new THREE.TextureLoader();
    skyLoader.load(
      SKYBOX_ASSET,
      (texture) => activateSkyTexture(texture),
      undefined,
      useFallbackSky
    );
  }

  // 室内环境贴图:给釉面棋子和外框提供稳定反光。
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  // 暖色主光塑造棋子体积,冷色轮廓光把黑棋从暗场中分离出来。
  scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x29445b, 0.82));
  const sun = new THREE.DirectionalLight(0xffdfb2, 3.1);
  sun.position.set(5.5, 7.5, 6.5);
  sun.castShadow = true;
  const shadowSize = 1024;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 2;
  sun.shadow.camera.far = 40;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.015;
  scene.add(sun);

  function applyRenderQuality(size) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, pixelRatioCap(size)));
  }
  const rim = new THREE.DirectionalLight(0x86c8e0, 1.5);
  rim.position.set(-7, 5, -8);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0x8caeea, 0.52);
  fill.position.set(-3, 4, 7);
  scene.add(fill);

  const boardGroup = new THREE.Group();
  boardGroup.renderOrder = 5;
  scene.add(boardGroup);
  const baseGroup = new THREE.Group(); // 外框/底板/格子:换尺寸时整体重建
  const pieceGroup = new THREE.Group(); // 棋子/幽灵/标记:跨尺寸保留
  const decorGroup = new THREE.Group(); // 竞技场角柱与徽记,不参与棋盘拾取
  const homePetsGroup = new THREE.Group(); // 主页展示用的两只观众动物
  baseGroup.renderOrder = 5;
  pieceGroup.renderOrder = 6;
  decorGroup.renderOrder = 6;
  homePetsGroup.renderOrder = 7;
  boardGroup.add(baseGroup);
  boardGroup.add(pieceGroup);
  boardGroup.add(decorGroup);
  boardGroup.add(homePetsGroup);

  const arenaTemplates = new Map();
  let decorGeometries = [];
  let decorMaterials = [];
  const homePetSlots = [
    { position: [-4.55, 0.2, 3.1], rotation: [0, 0.55, 0], scale: 1.42 },
    { position: [4.65, 0.2, -2.65], rotation: [0, -0.65, 0], scale: 1.28 },
  ];

  function clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.traverse((node) => {
        if (node.geometry && node.userData?.disposeOnClear) node.geometry.dispose();
        if (node.material && node.userData?.disposeOnClear) {
          const materials = Array.isArray(node.material) ? node.material : [node.material];
          materials.forEach((material) => material.dispose());
        }
      });
    }
  }

  function makeArenaDecor(size) {
    decorGeometries.forEach((geometry) => geometry.dispose());
    decorGeometries = [];
    decorMaterials.forEach((material) => material.dispose());
    decorMaterials = [];
    clearGroup(decorGroup);
    const edge = size / 2 + 0.72;
    const cornerMat = new THREE.MeshStandardMaterial({
      color: 0x567187,
      roughness: 0.42,
      metalness: 0.18,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: ACCENT,
      roughness: 0.34,
      metalness: 0.4,
      emissive: ACCENT,
      emissiveIntensity: 0.08,
    });
    decorMaterials.push(cornerMat, capMat);
    const pillarGeo = new RoundedBoxGeometry(0.22, 0.74, 0.22, 3, 0.04);
    const capGeo = new THREE.CylinderGeometry(0.18, 0.22, 0.06, 12);
    decorGeometries.push(pillarGeo, capGeo);
    for (const [x, z] of [[-edge, -edge], [edge, -edge], [-edge, edge], [edge, edge]]) {
      const pillar = arenaTemplates.get('column')?.clone(true) || new THREE.Mesh(pillarGeo, cornerMat);
      if (pillar.isObject3D && !pillar.isMesh) {
        normalizeRoot(pillar, 0.8);
      } else {
        pillar.material = cornerMat;
      }
      pillar.position.set(x, 0.22, z);
      pillar.traverse((node) => {
        if (node.isMesh) {
          if (node.material?.color) node.material.color.setHex(0x6b8295);
          if (node.material?.roughness !== undefined) node.material.roughness = 0.62;
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      decorGroup.add(pillar);
      const cap = arenaTemplates.get('block')?.clone(true) || new THREE.Mesh(capGeo, capMat);
      if (cap.isObject3D && !cap.isMesh) normalizeRoot(cap, 0.34);
      else cap.material = capMat;
      cap.position.set(x, 0.62, z);
      cap.traverse((node) => {
        if (node.isMesh) {
          if (node.material?.color) node.material.color.setHex(ACCENT);
          if (node.material?.roughness !== undefined) node.material.roughness = 0.5;
          node.castShadow = true;
        }
      });
      decorGroup.add(cap);
    }
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(size * 0.33, 0.018, 6, 48),
      new THREE.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.28 })
    );
    decorMaterials.push(ring.material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = CELL_Y + 0.018;
    decorGroup.add(ring);
    decorGeometries.push(ring.geometry);
    const trophy = arenaTemplates.get('trophy')?.clone(true);
    if (trophy) {
      normalizeRoot(trophy, 0.58);
      trophy.position.set(0, 0.23, -edge - 0.28);
      trophy.traverse((node) => {
        if (node.isMesh) node.castShadow = true;
      });
      decorGroup.add(trophy);
    }
  }

  const tableTexture = makeSurfaceTexture(renderer, {
    base: [31, 53, 73],
    noise: 12,
    weave: true,
    seed: 31,
  });
  tableTexture.repeat.set(24, 24);
  const feltTexture = makeSurfaceTexture(renderer, {
    base: [58, 83, 103],
    noise: 11,
    weave: true,
    seed: 73,
  });
  feltTexture.repeat.set(1.4, 1.4);
  const woodTexture = makeSurfaceTexture(renderer, {
    base: [21, 29, 39],
    noise: 12,
    grain: true,
    seed: 109,
  });
  woodTexture.repeat.set(3.2, 1);
  const contactShadowTexture = makeContactShadowTexture();
  const boardShadowTexture = makeBoardShadowTexture();

  // 暗色赛台接住棋盘投影,材质细节只在光线掠过时显现。
  const table = new THREE.Mesh(
    new THREE.PlaneGeometry(80, 80),
    new THREE.MeshLambertMaterial({
      color: 0x2b4b66,
      map: tableTexture,
    })
  );
  table.rotation.x = -Math.PI / 2;
  table.position.y = -0.22;
  table.renderOrder = -2;
  table.receiveShadow = true;
  scene.add(table);

  const frameMat = new THREE.MeshPhysicalMaterial({
    color: 0x33485a,
    map: woodTexture,
    roughness: 0.34,
    metalness: 0.08,
    clearcoat: 0.46,
    clearcoatRoughness: 0.32,
  });
  const railMat = new THREE.MeshStandardMaterial({
    color: ACCENT,
    roughness: 0.32,
    metalness: 0.78,
  });
  const skirtMat = new THREE.MeshStandardMaterial({
    color: 0x0b111b,
    roughness: 0.58,
    metalness: 0.2,
  });
  const boardShadowMat = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: boardShadowTexture,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
  });
  const sharedBaseMaterials = new Set([frameMat, railMat, skirtMat, boardShadowMat]);

  // 按尺寸重建棋盘底座(外框 4 墙 + 绒布底板 + size² 个格子)。
  // 外框绝不能用实心盒子:实心盒子的顶面会与棋盘面板完全共面,导致整盘 z-fighting 频闪。
  let cellMesh = null;
  let boardShadow = null;
  let cellGeo = null;

  function buildBase(size) {
    // 清空旧底座
    const oldGeometries = new Set();
    for (const child of [...baseGroup.children]) {
      baseGroup.remove(child);
      if (child.geometry) oldGeometries.add(child.geometry);
      if (child.material && !sharedBaseMaterials.has(child.material)) child.material.dispose();
    }
    for (const geometry of oldGeometries) geometry.dispose();
    makeArenaDecor(size);
    cellMesh = null;
    boardShadow = null;
    cellGeo = new RoundedBoxGeometry(0.86, 0.105, 0.86, 2, 0.045);

    // 四块实木墙拼成真正的框
    const frameOuter = size + 1.35;
    const wallW = 0.42;
    const wallH = 0.48;
    const wallY = -0.06;
    const wallCenter = (frameOuter - wallW) / 2;
    const wallLong = new RoundedBoxGeometry(frameOuter, wallH, wallW, 3, 0.055);
    const wallShort = new RoundedBoxGeometry(wallW, wallH, frameOuter - 2 * wallW, 3, 0.055);
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

    // 内圈金属嵌条压住深色木框,也是视觉上判断棋盘边界的高光线。
    const railOffset = size / 2 + 0.17;
    const railY = 0.28;
    const railH = 0.035;
    const railW = 0.04;
    const railLong = new THREE.BoxGeometry(size + 0.44, railH, railW);
    const railShort = new THREE.BoxGeometry(railW, railH, size + 0.44);
    for (const [x, z, geo] of [
      [0, railOffset, railLong],
      [0, -railOffset, railLong],
      [railOffset, 0, railShort],
      [-railOffset, 0, railShort],
    ]) {
      const rail = new THREE.Mesh(geo, railMat);
      rail.position.set(x, railY, z);
      rail.castShadow = true;
      baseGroup.add(rail);
    }

    const skirt = new THREE.Mesh(
      new RoundedBoxGeometry(size + 0.74, 0.18, size + 0.74, 3, 0.06),
      skirtMat
    );
    skirt.position.y = -0.27;
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    baseGroup.add(skirt);

    boardShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(size + 1.65, size + 1.65),
      boardShadowMat
    );
    boardShadow.rotation.x = -Math.PI / 2;
    boardShadow.position.set(0.16, -0.211, 0.18);
    boardShadow.renderOrder = -1;
    baseGroup.add(boardShadow);

    // 绒布底板:下沉 0.145,格子像浮雕一样浮在底板上
    const slab = new THREE.Mesh(
      new RoundedBoxGeometry(size + 0.22, 0.22, size + 0.22, 4, 0.07),
      new THREE.MeshLambertMaterial({
        color: 0x263b4d,
        map: feltTexture,
      })
    );
    slab.position.y = 0.045;
    slab.receiveShadow = true;
    baseGroup.add(slab);

    // 格子合并为一次实例化绘制。颜色仍交替,高密盘面也不会逐格增加 draw call。
    const cellMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.64,
      metalness: 0.04,
    });
    cellMesh = new THREE.InstancedMesh(cellGeo, cellMaterial, size * size);
    const cellMatrix = new THREE.Matrix4();
    const darkCell = new THREE.Color(0x3e5d73);
    const lightCell = new THREE.Color(0x4b7088);
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const index = r * size + c;
        cellMatrix.makeTranslation(cellX(c), CELL_Y - 0.0525, cellZ(r));
        cellMesh.setMatrixAt(index, cellMatrix);
        cellMesh.setColorAt(index, (r + c) % 2 ? lightCell : darkCell);
      }
    }
    cellMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    cellMesh.instanceMatrix.needsUpdate = true;
    cellMesh.instanceColor.needsUpdate = true;
    cellMesh.receiveShadow = true;
    cellMesh.frustumCulled = false;
    baseGroup.add(cellMesh);
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
    const fittedDistance = Math.min(
      Math.max(distW, distH, mobile ? Math.max(distNearH, distNearV) : 0, 10),
      60
    );
    // 桌面给 HUD 和桌面留出呼吸区;移动端只轻微退后,保持触控目标足够大。
    const d = Math.min(fittedDistance * (mobile ? 1.12 : 1.27), 60);
    camera.position.set(0, a * d, b * d);
    controls.minDistance = d * 0.7;
    controls.maxDistance = d * 1.9;
    camera.updateProjectionMatrix();
    fitSky();
  }

  buildBase(SIZE);
  fitCamera(SIZE);

  // 素材尚未加载时使用轻量几何回退;GLB 到达后只替换 geometry/material,
  // 实例化与动画接口保持不变。
  const fallbackPieceGeo = new THREE.LatheGeometry(
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
    20
  );

  // 回退材质 + 半透明幽灵材质。
  const mats = {
    [BLACK]: new THREE.MeshPhongMaterial({
      color: 0x050807,
      specular: 0x55615d,
      shininess: 38,
    }),
    [WHITE]: new THREE.MeshPhongMaterial({
      color: 0xf4eedf,
      specular: 0xffffff,
      shininess: 68,
    }),
  };
  const ghostMats = {
    [BLACK]: new THREE.MeshPhongMaterial({
      color: 0x101719,
      specular: 0x34413c,
      shininess: 34,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    }),
    [WHITE]: new THREE.MeshPhongMaterial({
      color: 0xf4efe2,
      specular: 0xffffff,
      shininess: 52,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    }),
  };

  const pieceGeos = { [BLACK]: fallbackPieceGeo, [WHITE]: fallbackPieceGeo };
  const petMats = { [BLACK]: mats[BLACK], [WHITE]: mats[WHITE] };

  // 静止棋子按颜色合并为两次实例化绘制。正在坠落/翻转的棋子临时切回独立网格,
  // 动画结束后立即并回实例组,兼顾逐子动画与高密盘面的帧率。
  const pieceInstances = {
    [BLACK]: new THREE.InstancedMesh(pieceGeos[BLACK], petMats[BLACK], 18 * 18),
    [WHITE]: new THREE.InstancedMesh(pieceGeos[WHITE], petMats[WHITE], 18 * 18),
  };
  for (const instances of Object.values(pieceInstances)) {
    instances.count = 0;
    instances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    instances.castShadow = true;
    instances.frustumCulled = false;
    pieceGroup.add(instances);
  }
  const contactShadowGeo = new THREE.CircleGeometry(0.52, 16);
  contactShadowGeo.rotateX(-Math.PI / 2);
  const contactShadows = new THREE.InstancedMesh(
    contactShadowGeo,
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: contactShadowTexture,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
    18 * 18
  );
  contactShadows.count = 0;
  contactShadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  contactShadows.frustumCulled = false;
  contactShadows.renderOrder = 1;
  pieceGroup.add(contactShadows);
  const pieceMatrix = new THREE.Matrix4();
  const shadowMatrix = new THREE.Matrix4();
  const pieces = [];
  const pieceByCell = new Map();

  function rebuildPieceInstances() {
    const counts = { [BLACK]: 0, [WHITE]: 0 };
    let shadowCount = 0;
    for (const piece of pieces) {
      if (!piece.active) continue;
      shadowMatrix.makeTranslation(cellX(piece.c) + 0.075, CELL_Y + 0.007, cellZ(piece.r) + 0.1);
      contactShadows.setMatrixAt(shadowCount++, shadowMatrix);
      if (piece.animationRefs > 0) continue;
      const index = counts[piece.color]++;
      pieceMatrix.makeTranslation(cellX(piece.c), PIECE_Y, cellZ(piece.r));
      pieceInstances[piece.color].setMatrixAt(index, pieceMatrix);
    }
    for (const color of [BLACK, WHITE]) {
      pieceInstances[color].count = counts[color];
      pieceInstances[color].instanceMatrix.needsUpdate = true;
    }
    contactShadows.count = shadowCount;
    contactShadows.instanceMatrix.needsUpdate = true;
  }

  function beginPieceAnimation(piece) {
    piece.animationRefs++;
    if (piece.animationRefs > 1) return;
    piece.mesh.visible = true;
    piece.mesh.position.set(cellX(piece.c), PIECE_Y, cellZ(piece.r));
    rebuildPieceInstances();
  }

  function endPieceAnimation(piece) {
    piece.animationRefs = Math.max(0, piece.animationRefs - 1);
    if (piece.animationRefs > 0) return;
    piece.mesh.visible = false;
    rebuildPieceInstances();
  }

  function ensurePiece(r, c) {
    const key = r * curSize + c;
    let piece = pieceByCell.get(key);
    if (!piece) {
      const mesh = new THREE.Mesh(pieceGeos[BLACK], petMats[BLACK]);
      mesh.castShadow = false;
      mesh.position.set(cellX(c), PIECE_Y, cellZ(r));
      mesh.visible = false;
      pieceGroup.add(mesh);
      piece = { mesh, r, c, color: EMPTY, active: false, animationRefs: 0 };
      pieceByCell.set(key, piece);
      pieces.push(piece);
    }
    return piece;
  }

  function setPieceColor(piece, color) {
    piece.color = color;
    piece.mesh.geometry = pieceGeos[color] || fallbackPieceGeo;
    piece.mesh.material = petMats[color] || mats[color];
  }

  // 幽灵棋子:跟随鼠标在合法格上浮动预览。
  const ghost = new THREE.Mesh(pieceGeos[BLACK], ghostMats[BLACK]);
  ghost.visible = false;
  ghost.castShadow = false;
  ghost.receiveShadow = false;
  pieceGroup.add(ghost);

  const loader = new GLTFLoader();
  const ghostPetMats = { [BLACK]: ghostMats[BLACK], [WHITE]: ghostMats[WHITE] };
  const petRoots = new Map();
  const petAnimations = new Map();
  let homeMixers = [];

  function normalizePetGeometry(geometry) {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const size = new THREE.Vector3();
    box.getSize(size);
    if (!size.y || !Number.isFinite(size.y)) return geometry;
    const scale = PET_HEIGHT / size.y;
    geometry.scale(scale, scale, scale);
    geometry.computeBoundingBox();
    const normalized = geometry.boundingBox;
    geometry.translate(
      -(normalized.min.x + normalized.max.x) / 2,
      -normalized.min.y,
      -(normalized.min.z + normalized.max.z) / 2
    );
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  function mergedPetGeometry(root) {
    root.updateMatrixWorld(true);
    const geometries = [];
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry?.attributes?.position) return;
      const geometry = node.geometry.clone();
      geometry.applyMatrix4(node.matrixWorld);
      geometry.deleteAttribute('tangent');
      geometry.deleteAttribute('color');
      if (!geometry.attributes.normal) geometry.computeVertexNormals();
      geometries.push(geometry);
    });
    if (!geometries.length) return null;
    const merged = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    return merged ? normalizePetGeometry(merged) : null;
  }

  function usePetAsset(color, gltf) {
    const root = gltf.scene;
    petRoots.set(color, root);
    petAnimations.set(color, gltf.animations || []);
    const geometry = mergedPetGeometry(root);
    if (!geometry) return;
    const source = root.getObjectByProperty('isMesh', true);
    const material = source?.material?.clone?.() || mats[color].clone();
    material.roughness = 0.58;
    material.metalness = 0.08;
    material.envMapIntensity = 0.7;
    if (color === BLACK && material.color) {
      // 黑方仍保留猫咪的眼睛与轮廓,整体压到深蓝灰以保持两方一眼可分。
      material.color.setHex(0x263844);
    }
    material.needsUpdate = true;
    const ghostMaterial = material.clone();
    ghostMaterial.transparent = true;
    ghostMaterial.opacity = 0.64;
    ghostMaterial.depthWrite = false;
    ghostPetMats[color] = ghostMaterial;
    pieceGeos[color] = geometry;
    petMats[color] = material;
    pieceInstances[color].geometry = geometry;
    pieceInstances[color].material = material;
    for (const piece of pieces) {
      if (piece.color === color) {
        piece.mesh.geometry = geometry;
        piece.mesh.material = material;
      }
    }
    if (color === BLACK) ghost.geometry = geometry;
    rebuildPieceInstances();
    renderHomePets();
  }

  function loadAsset(url, onLoad) {
    loader.load(url, onLoad, undefined, () => {
      // 素材缺失时保留程序化回退,不打断游戏启动。
    });
  }

  function normalizeRoot(root, targetHeight = 1) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    if (size.y > 0) root.scale.multiplyScalar(targetHeight / size.y);
    root.updateMatrixWorld(true);
    const fitted = new THREE.Box3().setFromObject(root);
    root.position.y += -fitted.min.y;
  }

  function renderHomePets() {
    clearGroup(homePetsGroup);
    homeMixers = [];
    const roots = [petRoots.get(BLACK), petRoots.get('fox') || petRoots.get(WHITE)];
    const animationKeys = [BLACK, 'fox'];
    homePetSlots.forEach((slot, index) => {
      const source = roots[index];
      if (!source) return;
      const pet = source.clone(true);
      normalizeRoot(pet, slot.scale);
      pet.position.set(...slot.position);
      pet.rotation.set(...slot.rotation);
      pet.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });
      homePetsGroup.add(pet);
      if (!reduceMotion.matches) {
        const clips = petAnimations.get(animationKeys[index]) || [];
        const idle = clips.find((clip) => clip.name.toLowerCase() === 'idle');
        if (idle) {
          const mixer = new THREE.AnimationMixer(pet);
          const action = mixer.clipAction(idle);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.play();
          mixer.setTime(index * 0.72);
          homeMixers.push(mixer);
        }
      }
    });
  }

  function refreshArenaDecor() {
    if (!arenaTemplates.size) return;
    makeArenaDecor(curSize);
  }

  loadAsset(PET_ASSETS[BLACK], (gltf) => usePetAsset(BLACK, gltf));
  loadAsset(PET_ASSETS[WHITE], (gltf) => usePetAsset(WHITE, gltf));
  loadAsset(HOME_FOX_ASSET, (gltf) => {
    petRoots.set('fox', gltf.scene);
    petAnimations.set('fox', gltf.animations || []);
    renderHomePets();
  });
  Object.entries(ARENA_ASSETS).forEach(([name, url]) => {
    loadAsset(url, (gltf) => {
      arenaTemplates.set(name, gltf.scene);
      refreshArenaDecor();
    });
  });

  const legalMarkerGeo = new THREE.RingGeometry(0.11, 0.15, 16);
  legalMarkerGeo.rotateX(-Math.PI / 2);
  const legalMarkerMat = new THREE.MeshBasicMaterial({
    color: 0xe4b861,
    transparent: true,
    opacity: 0.74,
    depthWrite: false,
  });
  const legalMarkers = new THREE.InstancedMesh(legalMarkerGeo, legalMarkerMat, 18 * 18);
  const legalMarkerMatrix = new THREE.Matrix4();
  const legalFillMatrix = new THREE.Matrix4();
  legalMarkers.count = 0;
  legalMarkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  legalMarkers.frustumCulled = false;
  legalMarkers.renderOrder = 3;
  pieceGroup.add(legalMarkers);
  const legalFillGeo = new THREE.CircleGeometry(0.19, 16);
  legalFillGeo.rotateX(-Math.PI / 2);
  const legalFills = new THREE.InstancedMesh(
    legalFillGeo,
    new THREE.MeshBasicMaterial({
      color: 0x45c882,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    }),
    18 * 18
  );
  legalFills.count = 0;
  legalFills.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  legalFills.frustumCulled = false;
  legalFills.renderOrder = 2;
  pieceGroup.add(legalFills);

  const directorMarker = new THREE.Mesh(
    new THREE.TorusGeometry(0.31, 0.035, 8, 28),
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  directorMarker.rotation.x = -Math.PI / 2;
  directorMarker.position.y = CELL_Y + 0.045;
  directorMarker.visible = false;
  directorMarker.renderOrder = 4;
  pieceGroup.add(directorMarker);

  // 最后落子标记:棋子顶部的细金属光环。
  const lastMarker = new THREE.Mesh(
    new THREE.TorusGeometry(0.175, 0.022, 8, 32),
    new THREE.MeshBasicMaterial({
      color: 0xffd278,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  lastMarker.rotation.x = -Math.PI / 2;
  lastMarker.position.y = CELL_Y + 0.395;
  lastMarker.visible = false;
  pieceGroup.add(lastMarker);

  // 落点冲击波:每步只复用一个环,不持续占用新几何体。
  const impactRing = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.32, 48),
    new THREE.MeshBasicMaterial({
      color: 0xf0b84e,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  impactRing.rotation.x = -Math.PI / 2;
  impactRing.position.y = CELL_Y + 0.035;
  impactRing.visible = false;
  pieceGroup.add(impactRing);

  const impactGlow = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 40),
    new THREE.MeshBasicMaterial({
      color: 0xf0b84e,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  impactGlow.rotation.x = -Math.PI / 2;
  impactGlow.position.y = CELL_Y + 0.018;
  impactGlow.visible = false;
  pieceGroup.add(impactGlow);

  const tweens = new Tweens();
  const burst = new Burst(scene, () => reduceMotion.matches);
  const raycaster = new THREE.Raycaster();

  // ---- 高亮管理 ----
  function setLegal(moves) {
    clearLegal();
    moves.forEach(([r, c], index) => {
      legalMarkerMatrix.makeTranslation(cellX(c), CELL_Y + 0.012, cellZ(r));
      legalFillMatrix.makeTranslation(cellX(c), CELL_Y + 0.008, cellZ(r));
      legalMarkers.setMatrixAt(index, legalMarkerMatrix);
      legalFills.setMatrixAt(index, legalFillMatrix);
    });
    legalMarkers.count = moves.length;
    legalFills.count = moves.length;
    legalMarkers.instanceMatrix.needsUpdate = true;
    legalFills.instanceMatrix.needsUpdate = true;
  }

  function clearLegal() {
    legalMarkers.count = 0;
    legalFills.count = 0;
    ghost.visible = false;
    directorMarker.visible = false;
  }

  function setDirectorTarget(cell = null) {
    if (!cell) {
      directorMarker.visible = false;
      return;
    }
    directorMarker.visible = true;
    directorMarker.position.set(cellX(cell.c), CELL_Y + 0.045, cellZ(cell.r));
  }

  function hover(r, c, color) {
    if (r === null || c === null) {
      ghost.visible = false;
      return;
    }
    ghost.visible = true;
    ghost.geometry = pieceGeos[color] || fallbackPieceGeo;
    ghost.material = ghostPetMats[color] || ghostMats[color];
    ghost.position.set(cellX(c), CELL_Y + 0.07, cellZ(r));
  }

  // ---- 棋子动画 ----

  function placePiece(r, c, color) {
    const piece = ensurePiece(r, c);
    setPieceColor(piece, color);
    piece.active = true;
    beginPieceAnimation(piece);
    piece.mesh.position.y = PIECE_Y + 2.8;
    piece.mesh.scale.set(1, 1, 1);
    piece.mesh.rotation.set(0, 0, 0);
    return piece;
  }

  // 坠落拍击:自由落体曲线,Promise 在拍上棋盘时 resolve。
  // QA 慢动作下同步拉长,便于无头定点抓拍(生产恒为 1)。
  function dropPiece(piece, pace = 1) {
    if (reduceMotion.matches) {
      piece.mesh.position.y = PIECE_Y;
      endPieceAnimation(piece);
      return Promise.resolve();
    }
    const ts = window.__QA_SLOWMO || 1;
    return new Promise((resolve) => {
      tweens.add({
        dur: 0.3 * pace * ts,
        ease: easings.easeInQuad,
        update: (e) => {
          piece.mesh.position.y = PIECE_Y + 2.8 * (1 - e);
          const landing = Math.max(0, (e - 0.82) / 0.18);
          const squash = Math.sin(landing * Math.PI);
          piece.mesh.scale.set(1 + squash * 0.08, 1 - squash * 0.12, 1 + squash * 0.08);
          piece.mesh.rotation.z = Math.sin(e * Math.PI * 2.4) * 0.035 * (1 - e);
        },
        done: () => {
          piece.mesh.position.y = PIECE_Y;
          piece.mesh.scale.set(1, 1, 1);
          piece.mesh.rotation.z = 0;
          endPieceAnimation(piece);
          resolve();
        },
      });
    });
  }

  // 邻近棋子被震得跳一下。
  function bounceNeighbors(r, c) {
    if (reduceMotion.matches) return;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= curSize || cc < 0 || cc >= curSize) continue;
        const piece = pieceByCell.get(rr * curSize + cc);
        if (!piece || !piece.active) continue;
        if (piece.bouncing) continue;
        beginPieceAnimation(piece);
        const base = piece.mesh.position.y;
        piece.bouncing = true;
        tweens.add({
          dur: 0.26,
          update: (e) => {
            const wave = Math.sin(Math.PI * e);
            piece.mesh.scale.set(1 + 0.035 * wave, 1 - 0.13 * wave, 1 + 0.035 * wave);
            piece.mesh.position.y = base + 0.05 * wave;
            piece.mesh.rotation.x = Math.sin(Math.PI * e) * (dr * 0.018);
            piece.mesh.rotation.z = Math.sin(Math.PI * e) * (dc * 0.018);
          },
          done: () => {
            piece.mesh.scale.set(1, 1, 1);
            piece.mesh.position.y = base;
            piece.mesh.rotation.x = 0;
            piece.mesh.rotation.z = 0;
            piece.bouncing = false;
            endPieceAnimation(piece);
          },
        });
      }
    }
  }

  // 翻面:绕"垂直于 落点→棋子 方向"的水平轴翻转半圈,半程换色。
  // 翻转时小跳 + 横向收窄,防止棋子边缘在旋转中穿过格面造成穿插/闪烁。
  function flipPiece(piece, color, axisX, axisZ, pace = 1) {
    if (reduceMotion.matches) {
      piece.mesh.quaternion.identity();
      piece.mesh.position.y = PIECE_Y;
      piece.mesh.scale.set(1, 1, 1);
      piece.mesh.rotation.set(0, 0, 0);
      setPieceColor(piece, color);
      rebuildPieceInstances();
      return Promise.resolve();
    }
    beginPieceAnimation(piece);
    return new Promise((resolve) => {
      const axis = new THREE.Vector3(axisX, 0, axisZ).normalize();
      let swapped = false;
      tweens.add({
        dur: 0.22 * pace,
        update: (e) => {
          const s = Math.sin(Math.PI * e);
          piece.mesh.quaternion.setFromAxisAngle(axis, Math.PI * e);
          if (!piece.bouncing) {
            piece.mesh.position.y = PIECE_Y + 0.32 * s;
          }
          const sh = 1 - 0.5 * s;
          piece.mesh.scale.set(sh, 1 + 0.1 * s, sh);
          piece.mesh.rotation.z = Math.sin(Math.PI * e) * 0.025;
          if (!swapped && e >= 0.5) {
            swapped = true;
            setPieceColor(piece, color);
          }
        },
        done: () => {
          piece.mesh.quaternion.identity();
          piece.mesh.position.y = PIECE_Y;
          piece.mesh.scale.set(1, 1, 1);
          piece.mesh.rotation.z = 0;
          setPieceColor(piece, color);
          endPieceAnimation(piece);
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

  function impactAt(r, c, color = 0xf0b84e) {
    if (reduceMotion.matches) {
      impactRing.visible = false;
      impactGlow.visible = false;
      return;
    }
    const x = cellX(c);
    const z = cellZ(r);
    impactRing.visible = true;
    impactGlow.visible = true;
    impactRing.material.color.setHex(color);
    impactGlow.material.color.setHex(color);
    impactRing.material.opacity = 0.95;
    impactGlow.material.opacity = 0.34;
    impactRing.position.set(x, CELL_Y + 0.035, z);
    impactGlow.position.set(x, CELL_Y + 0.018, z);
    impactRing.scale.setScalar(0.7);
    impactGlow.scale.setScalar(0.8);
    tweens.add({
      dur: 0.52,
      ease: easings.easeOutCubic,
      update: (e) => {
        impactRing.scale.setScalar(0.7 + e * 2.85);
        impactGlow.scale.setScalar(0.8 + e * 1.35);
        impactRing.material.opacity = 0.95 * (1 - e);
        impactGlow.material.opacity = 0.34 * (1 - e) * (1 - e);
      },
      done: () => {
        impactRing.visible = false;
        impactGlow.visible = false;
        impactRing.material.opacity = 0;
        impactGlow.material.opacity = 0;
      },
    });
  }

  // 爆破卡:棋子被炸飞(放大+上升后消失)。
  function popPiece(piece, pace = 1) {
    if (reduceMotion.matches) {
      piece.active = false;
      piece.mesh.visible = false;
      rebuildPieceInstances();
      return Promise.resolve();
    }
    beginPieceAnimation(piece);
    return new Promise((resolve) => {
      tweens.add({
        dur: 0.28 * pace,
        ease: easings.easeOutBack,
        update: (e) => {
          const lift = Math.sin((Math.min(e, 1) * Math.PI) / 2);
          piece.mesh.scale.set(1 + 0.4 * e, 1 + 0.52 * e, 1 + 0.4 * e);
          piece.mesh.position.y = PIECE_Y + 0.6 * lift;
          piece.mesh.rotation.z = Math.sin(e * Math.PI * 2.2) * 0.12;
        },
        done: () => {
          piece.active = false;
          piece.mesh.visible = false;
          piece.mesh.scale.set(1, 1, 1);
          piece.mesh.position.y = PIECE_Y;
          piece.mesh.rotation.z = 0;
          endPieceAnimation(piece);
          resolve();
        },
      });
    });
  }

  // 立即同步到某个盘面(新局/悔棋用),打断所有进行中的动画。
  function syncBoard(board) {
    tweens.clear(true);
    clearLegal();
    for (const piece of pieces) {
      piece.active = false;
      piece.animationRefs = 0;
      piece.bouncing = false;
      piece.mesh.visible = false;
    }
    const n = board.length;
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r][c];
        if (v === EMPTY) continue;
        const piece = ensurePiece(r, c);
        piece.active = true;
        piece.mesh.visible = false;
        piece.mesh.position.set(cellX(c), PIECE_Y, cellZ(r));
        piece.mesh.scale.set(1, 1, 1);
        piece.mesh.quaternion.identity();
        setPieceColor(piece, v);
      }
    }
    rebuildPieceInstances();
  }

  // 清空全部棋子(棋盘尺寸变化时用)。
  function clearPieces() {
    for (const piece of pieces) {
      pieceGroup.remove(piece.mesh);
    }
    pieces.length = 0;
    pieceByCell.clear();
    pieceInstances[BLACK].count = 0;
    pieceInstances[WHITE].count = 0;
    contactShadows.count = 0;
  }

  // 无尽模式:随关卡重建棋盘并适配相机与阴影范围。
  function resizeBoard(size) {
    curSize = size;
    applyRenderQuality(size);
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
    const hits = cellMesh ? raycaster.intersectObject(cellMesh, false) : [];
    if (!hits.length || hits[0].instanceId === undefined) return null;
    const index = hits[0].instanceId;
    return { r: Math.floor(index / curSize), c: index % curSize };
  }

  // 落子"推冲":FOV 快速鼓一下再收回,配合拍击给镜头一个力量感。
  function punch(strength = 1) {
    if (reduceMotion.matches) return;
    const amount = 2.4 + Math.min(Math.max(strength, 0), 2) * 1.2;
    tweens.add({
      dur: 0.34,
      ease: easings.linear,
      update: (_, k) => {
        camera.fov = 35 + amount * Math.sin(Math.PI * k);
        camera.updateProjectionMatrix();
        fitSky();
      },
      done: () => {
        camera.fov = 35;
        camera.updateProjectionMatrix();
        fitSky();
      },
    });
  }

  function updateBackdrop(dt, time) {
    updateSky(time, idleMode && !reduceMotion.matches);
  }

  function update(dt, time) {
    // 静态画面下除了补间/粒子外不做任何周期性变化,从根源上杜绝频闪。
    tweens.update(dt);
    burst.update(dt);
    if (idleMode && !reduceMotion.matches) {
      for (const mixer of homeMixers) mixer.update(dt);
    }
    if (directorMarker.visible && !reduceMotion.matches) {
      const pulse = 1 + Math.sin(time * 4.2) * 0.12;
      directorMarker.scale.setScalar(pulse);
      directorMarker.material.opacity = 0.7 + (Math.sin(time * 4.2) + 1) * 0.13;
    }
    // 主页只做小幅摆动,持续保留正面构图;进入游戏后平滑归零。
    if (reduceMotion.matches) {
      boardGroup.rotation.y = 0;
      controls.enableDamping = false;
      controls.target.set(0, 0.1, 0);
    } else if (idleMode) {
      controls.enableDamping = true;
      const targetRotation = -0.035 + Math.sin(time * 0.32) * 0.055;
      boardGroup.rotation.y += (targetRotation - boardGroup.rotation.y) * Math.min(1, dt * 1.7);
    } else if (boardGroup.rotation.y !== 0) {
      controls.enableDamping = true;
      boardGroup.rotation.y *= Math.max(0, 1 - dt * 3);
      if (Math.abs(boardGroup.rotation.y) < 0.001) boardGroup.rotation.y = 0;
    } else {
      controls.enableDamping = true;
    }
    // 鼠标视差:镜头目标点柔和追随光标,盘面始终"活着"。
    if (!reduceMotion.matches) {
      const k = Math.min(1, dt * 4);
      controls.target.x += (mouseNdc.x * 0.55 - controls.target.x) * k;
      controls.target.y += (0.1 - mouseNdc.y * 0.3 - controls.target.y) * k;
    }
    contactShadows.visible = sun.castShadow;
    if (boardShadow) boardShadow.visible = sun.castShadow;
    controls.update();
    updateBackdrop(dt, time);
    renderer.render(scene, camera);
  }

  function resize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyRenderQuality(curSize);
    renderer.setSize(window.innerWidth, window.innerHeight);
    fitSky();
    fitCamera(curSize); // 旋转屏幕/改变窗口后重新构图
    if (idleMode) {
      camera.position.multiplyScalar(1.12);
      boardGroup.position.y = 0;
    }
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
    if (idleMode === on) return;
    idleMode = on;
    homePetsGroup.visible = on;
    skyPlate.visible = skyAssetState !== 'loading';
    container.classList.toggle('idle-scene', on);
    decorGroup.visible = true;
    boardGroup.scale.setScalar(on ? 0.84 : 1);
    boardGroup.position.y = 0;
    if (on) {
      camera.position.multiplyScalar(1.12);
      controls.target.set(0, 0.1, 0);
    } else {
      fitCamera(curSize);
    }
    fitSky();
    if (reduceMotion.matches) boardGroup.rotation.y = 0;
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
    setDirectorTarget,
    setIdleMode,
    hover,
    placePiece,
    dropPiece,
    bounceNeighbors,
    flipPiece,
    popPiece,
    setLastMove,
    clearLastMove,
    impactAt,
    syncBoard,
    cellFromPointer,
    pieceAt: (r, c) => pieceByCell.get(r * curSize + c) || null,
    shake: (strength) => {
      if (!reduceMotion.matches) shakeBoard(boardGroup, tweens, strength);
    },
    punch,
    resizeBoard,
    update,
    resize,
  };
}
