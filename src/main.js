import * as THREE from 'three';
import { io } from 'socket.io-client';
import './style.css';

// ============================================================
// SAMBALPUR CAMPUS RUN 3D
// Three.js | Solo + Multiplayer | Desktop + Mobile
// ============================================================

const $ = (id) => document.getElementById(id);

const socketUrl = import.meta.env.DEV
  ? `${window.location.protocol}//${window.location.hostname}:3000`
  : window.location.origin;

const socket = io(socketUrl, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: 8,
  timeout: 10000
});

const LANES = [-2.8, 0, 2.8];

// Side lane the runner starts in: 0 = left, 2 = right.
// The gate shifts so its entrance arch lines up with this lane.
const START_LANE = 2;
const START_SIDE = LANES[START_LANE] < 0 ? -1 : 1;
const ARCH_CENTER_X = 6.0;
const GATE_OFFSET_X = LANES[START_LANE] - START_SIDE * ARCH_CENTER_X;

const ROAD_WIDTH = 10;
const SEGMENT_LENGTH = 48;
const SEGMENT_COUNT = 7;

// ---- Speed (slower than the original 17 / 27 / 0.0024) ----
const START_SPEED = 15;
const MAX_SPEED = 22;
const SPEED_RAMP = 0.003;      // speed gained per distance unit
const SCORE_RATE = 1.7;        // score points per world unit travelled
const MAX_DISTANCE = 1000000;
const GRAVITY = 24;

// ---- Campus layout (world units) ----
// The runner now starts OUTSIDE the main gate, on the approach road, and
// runs towards the gate and through its right arch. The gate scrolls
// towards the runner and away behind them.
const GATE_Z = 4.5;
const PLAYER_START_Z = 34;     // run-up before the gate (gate is at GATE_Z)
const SEGMENT_WRAP_Z = SEGMENT_LENGTH * 2;

// Obstacles spawn this far ahead of the runner and are spaced by distance,
// so the slower speed doesn't pack them tighter.
const SPAWN_Z = PLAYER_START_Z - 107;
const OBSTACLE_SPACING = 30;
const OBSTACLE_SPACING_MIN = 22;
const INITIAL_OBSTACLE_OFFSET = 22;   // first obstacles sit this far beyond the gate (bigger = more run-up)
const COIN_SPACING = 60;              // world units between single bonus coins
const BEST_KEY = 'sambalpurCampusRunBest';

// Camera while running
const CAM_BACK = 7.5;           // distance behind the runner
const GATE_CAM_HEIGHT = 3.2;    // camera dips under the arch beam (beam bottom = 3.9)

// Lane lock around the gate so the runner always goes through the right arch
const GATE_LOCK_AHEAD = 9;
const GATE_LOCK_BEHIND = 2.5;

const FRONT_X = 12.5;   // distance from road centre to every building facade
const WALL_X = 23.8;    // campus boundary wall (lines up with the gate's pink wall)
const AVENUE_X = 8.9;   // roadside avenue trees

// Extra road in front of the main gate (outside the campus), joined to the
// end of the plaza segment so the approach to the gate feels long.
const APPROACH_LENGTH = 96;

// SUIIT building: stands to the right of the main gate, just outside the
// campus wall, facing the road. A branch road runs from its entrance back to
// the main road in front of the main gate (z = 10 is outside the gate, level
// with the gate's brick apron).
const SUIIT_X = 40;
const SUIIT_Z = 10;

// Building slots along each side of a segment (local z of building centre).
// Left and right are staggered so the road never feels mirrored.
const LEFT_SLOTS = [-12, -36];
const RIGHT_SLOTS = [-18, -42];

// Intro camera: starts pulled back outside the gate, then swoops in at "GO".
const INTRO_BACK = 14;
const INTRO_UP = 1.0;

// Menu camera (login / home / character select / room): looks down the
// approach road at the main gate with the SUIIT building beside it.
const MENU_LOOK = new THREE.Vector3(14, 4, 0);

// Camera shake (kept very small so the map stays steady)
const CAMERA_BOB = 0.004;     // running bob amplitude
const HIT_SHAKE = 0.07;       // collision shake amplitude
const HIT_SHAKE_MS = 220;     // collision shake length

const COLORS = {
  sky: 0x9dd7ec,
  grass: 0x4b9253,
  road: 0x343d46,
  line: 0xf3f1d9,
  blue: 0x2784f5,
  orange: 0xff7b28,
  gold: 0xffca45
};

let scene;
let camera;
let renderer;
let clock;
let skyMesh;
let dust;
let gateFlame = null;

let player;
let remotePlayer;
let world = [];
let obstacles = [];
let coins = [];
let decorations = [];

let currentScreen = 'login';
let playerName = 'Player';
let selectedCharacter = 'Smruti';
let gameMode = 'solo';
let roomCode = '';
let isHost = false;

let running = false;
let paused = false;
let raceStarted = false;
let raceFinished = false;

let lane = START_LANE;
let jumpVelocity = 0;
let isJumping = false;
let isSliding = false;
let slideUntil = 0;
let speed = START_SPEED;
let distance = 0;
let coinCount = 0;
let elapsed = 0;
let spawnTimer = 0;
let coinTimer = 0;
let lastNetworkUpdate = 0;
let lastToast = 0;
let invulnerableUntil = 0;
let hitCount = 0;
let shakeUntil = 0;
let introBlend = 1;
let menuBlend = 1;

// Reusable vectors for the camera
const _camTarget = new THREE.Vector3();
const _menuTarget = new THREE.Vector3();
const _lookGame = new THREE.Vector3();
const _lookMenu = new THREE.Vector3();
const _lookCur = new THREE.Vector3();

const heldKeys = new Set();

const ui = {
  canvas: $('game-canvas'),
  login: $('login-screen'),
  home: $('home-screen'),
  room: $('room-screen'),
  hud: $('hud'),
  countdown: $('countdown-screen'),
  countdownNumber: $('countdown-number'),
  pause: $('pause-screen'),
  over: $('over-screen'),
  playerName: $('player-name'),
  loginForm: $('login-form'),
  loginError: $('login-error'),
  welcomeName: $('welcome-player-name'),
  connection: $('connection-status'),
  changeName: $('change-name-button'),
  solo: $('solo-button'),
  multiplayer: $('multiplayer-button'),
  backHome: $('back-home-button'),
  createRoom: $('create-room-button'),
  joinForm: $('join-room-form'),
  roomInput: $('room-code'),
  roomLobby: $('room-lobby'),
  roomCodeDisplay: $('room-code-display'),
  copyRoom: $('copy-room-code-button'),
  playerList: $('player-list'),
  lobbyMessage: $('lobby-message'),
  startRace: $('start-race-button'),
  roomError: $('room-error'),
  distance: $('distance-value'),
  coins: $('coins-value'),
  pauseButton: $('pause-button'),
  resume: $('resume-button'),
  quit: $('quit-button'),
  finalDistance: $('final-distance'),
  finalCoins: $('final-coins'),
  retry: $('retry-button'),
  menu: $('menu-button'),
  toast: $('toast'),
  // On-screen control buttons were removed. Keyboard and swipe still work.
  mobile: $('mobile-controls')
};

function showScreen(name) {
  currentScreen = name;

  for (const element of [
    ui.login, ui.home, ui.room, ui.hud,
    ui.countdown, ui.pause, ui.over
  ]) {
    element?.classList.add('hidden');
  }

  if (name === 'login') ui.login?.classList.remove('hidden');
  if (name === 'home') ui.home?.classList.remove('hidden');
  if (name === 'room') ui.room?.classList.remove('hidden');
  if (name === 'game') ui.hud?.classList.remove('hidden');

  // The control buttons below the game are never shown any more.
  ui.mobile?.classList.add('hidden');
}

function showToast(message) {
  if (!ui.toast) return;
  ui.toast.textContent = message;
  ui.toast.classList.remove('hidden');
  lastToast = performance.now();
}

function hideToast() {
  if (ui.toast && performance.now() - lastToast > 2400) {
    ui.toast.classList.add('hidden');
  }
}

function setConnection(text) {
  if (ui.connection) ui.connection.textContent = text;
}

function random(min, max) {
  return min + Math.random() * (max - min);
}

function choose(array) {
  return array[Math.floor(Math.random() * array.length)];
}

// ---- Seeded track generator -------------------------------------------
// In multiplayer both players derive the same seed from the room code, so
// they get the same sequence of obstacle waves and coins. Solo uses
// Math.random. (Decorations stay random: they never affect gameplay.)
let trackRng = Math.random;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function resetTrackRng() {
  trackRng = gameMode === 'multi' && roomCode
    ? mulberry32(seedFromString(roomCode))
    : Math.random;
}

function trackRandom(min, max) {
  return min + trackRng() * (max - min);
}

// ---- Best score (saved in the browser) --------------------------------
function loadBest() {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // storage unavailable (private mode etc.): ignore
  }
}

function showBestLine(text) {
  let el = $('best-score');

  if (!el) {
    el = document.createElement('p');
    el.id = 'best-score';
    el.style.cssText = 'margin:8px 0 0;font-weight:700;color:#ffca45;text-align:center;';

    const anchor = ui.finalCoins?.parentElement;
    if (anchor?.parentElement) anchor.insertAdjacentElement('afterend', el);
    else ui.over?.appendChild(el);
  }

  el.textContent = text;
}

function makeMaterial(color, roughness = 0.85, extra = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    ...extra
  });
}

// ------------------------------------------------------------
// PROCEDURAL TEXTURES
// ------------------------------------------------------------

function makeNoiseTexture({
  size = 256,
  base = [60, 64, 70],
  variance = 22,
  specks = 0.02,
  repeat = [1, 1],
  blades = false
} = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);

  for (let i = 0; i < size * size; i++) {
    const n = (Math.random() - 0.5) * variance;
    const s = Math.random() < specks ? Math.random() * 45 : 0;
    img.data[i * 4] = base[0] + n + s;
    img.data[i * 4 + 1] = base[1] + n + s;
    img.data[i * 4 + 2] = base[2] + n + s;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  if (blades) {
    for (let i = 0; i < size * 6; i++) {
      g.strokeStyle = `rgba(${20 + Math.random() * 40 | 0},${90 + Math.random() * 60 | 0},${30 + Math.random() * 30 | 0},0.35)`;
      const x = Math.random() * size;
      const y = Math.random() * size;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (Math.random() - 0.5) * 3, y - 3 - Math.random() * 4);
      g.stroke();
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// Embossed gold coin face. kind 'color' = the gold colour map,
// kind 'bump' = a grey height map so the design looks stamped into the metal.
function makeCoinFaceTexture(kind) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const cx = size / 2;
  const color = kind === 'color';

  if (color) {
    const grad = g.createRadialGradient(cx * 0.8, cx * 0.7, 8, cx, cx, cx * 1.05);
    grad.addColorStop(0, '#fff1a8');
    grad.addColorStop(0.45, '#f4c542');
    grad.addColorStop(1, '#b5830c');
    g.fillStyle = grad;
  } else {
    g.fillStyle = '#404040';
  }
  g.fillRect(0, 0, size, size);

  const design = (ink, dx, dy) => {
    g.save();
    g.translate(dx, dy);
    g.strokeStyle = ink;
    g.fillStyle = ink;

    g.lineWidth = 12;
    g.beginPath(); g.arc(cx, cx, 112, 0, Math.PI * 2); g.stroke();

    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      g.beginPath();
      g.arc(cx + Math.cos(a) * 94, cx + Math.sin(a) * 94, 3.6, 0, Math.PI * 2);
      g.fill();
    }

    g.lineWidth = 5;
    g.beginPath(); g.arc(cx, cx, 76, 0, Math.PI * 2); g.stroke();

    g.font = 'bold 92px Georgia, serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('SU', cx, cx + 6);

    // small stars above and below the lettering
    const star = (sx, sy, r) => {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const rr = i % 2 ? r * 0.45 : r;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        g.lineTo(sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
      }
      g.closePath();
      g.fill();
    };
    star(cx, cx - 52, 11);
    star(cx, cx + 62, 11);

    g.restore();
  };

  if (color) {
    design('#fff4b8', -2, -2);   // light edge (top-left)
    design('#8a5a00', 2, 2);     // shadow edge (bottom-right)
    design('#c9921a', 0, 0);     // stamped face
  } else {
    design('#ffffff', 0, 0);
  }

  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const materials = {
  grass: new THREE.MeshStandardMaterial({
    map: makeNoiseTexture({ base: [62, 128, 58], variance: 34, specks: 0.01, repeat: [70, 110], blades: true }),
    roughness: 1
  }),
  // Brighter, well-kept campus lawn (sits just above the base grass)
  lawn: new THREE.MeshStandardMaterial({
    map: makeNoiseTexture({ base: [88, 158, 68], variance: 30, specks: 0.01, repeat: [8, 7], blades: true }),
    roughness: 1
  }),
  road: new THREE.MeshStandardMaterial({
    map: makeNoiseTexture({ base: [58, 62, 68], variance: 24, specks: 0.04, repeat: [3, 12] }),
    roughness: 0.92
  }),
  sidewalk: new THREE.MeshStandardMaterial({
    map: makeNoiseTexture({ base: [176, 172, 160], variance: 18, specks: 0.01, repeat: [1, 12] }),
    roughness: 0.9
  }),
  white: makeMaterial(0xffffff),
  line: makeMaterial(COLORS.line),
  concrete: makeMaterial(0xb8c1c7),
  darkConcrete: makeMaterial(0x65717b),
  glass: new THREE.MeshPhysicalMaterial({
    color: 0x8ec9de,
    roughness: 0.08,
    metalness: 0.6,
    clearcoat: 1,
    envMapIntensity: 1.6
  }),
  tree: makeMaterial(0x277243),
  treeLight: makeMaterial(0x4d9850),
  trunk: makeMaterial(0x795237),
  hedge: makeMaterial(0x2d7a3a, 1),
  wallPink: makeMaterial(0xd78aa0, 0.9),
  bench: makeMaterial(0x8a5a35, 0.8),
  tank: makeMaterial(0x2b3a46, 0.6),
  gold: new THREE.MeshStandardMaterial({
    color: COLORS.gold,
    roughness: 0.22,
    metalness: 0.95,
    emissive: 0x6b4a00,
    emissiveIntensity: 0.35,
    envMapIntensity: 1.4
  }),
  black: makeMaterial(0x202b35),
  red: makeMaterial(0xd74438),
  barrierWhite: makeMaterial(0xf0eee6),
  blue: makeMaterial(COLORS.blue),
  orange: makeMaterial(COLORS.orange),
  // Shiny stamped gold coin face
  coinFace: new THREE.MeshStandardMaterial({
    map: makeCoinFaceTexture('color'),
    bumpMap: makeCoinFaceTexture('bump'),
    bumpScale: 2.2,
    metalness: 0.92,
    roughness: 0.28,
    emissive: 0x5a3b00,
    emissiveIntensity: 0.22,
    envMapIntensity: 1.5
  })
};

const foliageMats = [0x2a7a45, 0x3a8c4a, 0x1f6a3c, 0x4a9a4c].map((c) => makeMaterial(c, 0.9));

// Shared (never disposed) materials
const sharedMats = new Set([...Object.values(materials), ...foliageMats]);

// Shared geometries
const blobGeos = Array.from({ length: 6 }, () => lumpyBlob(1));
const windowGeo = new THREE.BoxGeometry(0.62, 0.48, 0.04);
const laneGeo = new THREE.BoxGeometry(0.09, 0.025, 2.7);
const zebraGeo = new THREE.BoxGeometry(0.55, 0.03, 3.4);
const lawnGeo = new THREE.PlaneGeometry(WALL_X - 7.2, SEGMENT_LENGTH);

// Realistic coin: thick disc with a milled edge, a raised rim and a stamped face
const coinBodyGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.08, 48);
const coinFaceGeo = new THREE.CircleGeometry(0.3, 48);
const coinRingGeo = new THREE.TorusGeometry(0.325, 0.028, 10, 48);

// Free GPU memory of anything that is removed from the scene.
function disposeObject(root) {
  if (!root) return;

  root.traverse((o) => {
    if (!o.isMesh) return;

    o.geometry?.dispose();

    const list = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (!m || sharedMats.has(m)) continue;
      m.map?.dispose();
      m.dispose();
    }
  });
}

// ------------------------------------------------------------
// THREE.JS INITIALIZATION
// ------------------------------------------------------------

// Camera pose used behind the menus. It sits high up on the approach road,
// far enough back to see the main gate AND the SUIIT building beside it.
// Narrow (portrait) screens pull back further so both still fit.
function getMenuCameraPose(timeSec, outPos, outLook) {
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const back = Math.max(0, 1.4 - aspect) * 18;

  outPos.set(
    10 + Math.sin(timeSec * 0.12) * 2.0,
    11 + back * 0.15 + Math.sin(timeSec * 0.17) * 0.25,
    72 + back
  );

  outLook.copy(MENU_LOOK);
}

function initThree() {
  scene = new THREE.Scene();

  // Near plane 0.5: better depth precision, so the ground and road
  // no longer flicker/shimmer in the distance.
  camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.5,
    400
  );

  // Start on the menu view: approach road, main gate and SUIIT.
  getMenuCameraPose(performance.now() / 1000, camera.position, _lookCur);
  camera.lookAt(_lookCur);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  ui.canvas?.replaceChildren(renderer.domElement);

  setupRealisticRendering();

  clock = new THREE.Clock();

  createWorld();
  createPlayer();

  window.addEventListener('resize', resizeRenderer);
}

function setupRealisticRendering() {
  // Gradient sky dome with a sun glow
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(0x2f78c4) },
      mid: { value: new THREE.Color(0x8fcbea) },
      bottom: { value: new THREE.Color(0xdfeaea) },
      sunDir: { value: new THREE.Vector3(-24, 42, 18).normalize() }
    },
    vertexShader: `
      varying vec3 vP;
      void main() {
        vP = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 top, mid, bottom, sunDir;
      varying vec3 vP;
      void main() {
        float h = clamp(vP.y, 0.0, 1.0);
        vec3 c = mix(bottom, mid, smoothstep(0.0, 0.25, h));
        c = mix(c, top, smoothstep(0.25, 0.9, h));
        float s = max(dot(normalize(vP), sunDir), 0.0);
        c += vec3(1.0, 0.85, 0.55) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`
  });

  skyMesh = new THREE.Mesh(new THREE.SphereGeometry(350, 32, 16), skyMat);
  skyMesh.renderOrder = -1;
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);

  scene.fog = new THREE.Fog(0xcfe3ea, 45, 230);

  // Sky reflections for glass, gold and metal
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x4a6a3c, 0.9));

  const sun = new THREE.DirectionalLight(0xfff0d0, 3.0);

  // The shadow box follows the runner's start position (the runner now
  // starts well in front of the gate).
  const SHADOW_CENTER_Z = PLAYER_START_Z - 2;
  sun.position.set(-24, 42, 18 + SHADOW_CENTER_Z);
  sun.target.position.set(0, 0, SHADOW_CENTER_Z);
  scene.add(sun.target);

  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -35;
  sun.shadow.camera.right = 35;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -35;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);

  createDust();
}

function createDust() {
  const N = 160;
  const pos = new Float32Array(N * 3);

  for (let i = 0; i < N; i++) {
    pos[i * 3] = random(-12, 12);
    pos[i * 3 + 1] = random(0.3, 7);
    pos[i * 3 + 2] = random(PLAYER_START_Z - 100, PLAYER_START_Z + 8);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  dust = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.45,
      depthWrite: false
    })
  );
  dust.frustumCulled = false;
  scene.add(dust);
}

function updateDust(delta) {
  if (!dust) return;

  const a = dust.geometry.attributes.position;

  for (let i = 0; i < a.count; i++) {
    let z = a.getZ(i) + speed * delta * 0.9;

    if (z > PLAYER_START_Z + 10) {
      z = PLAYER_START_Z - 90;
      a.setX(i, random(-12, 12));
      a.setY(i, random(0.3, 7));
    }

    a.setZ(i, z);
  }

  a.needsUpdate = true;
}

function resizeRenderer() {
  if (!camera || !renderer) return;

  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
}

function addMesh(parent, geometry, material, position, options = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);

  if (options.rotation) {
    mesh.rotation.set(...options.rotation);
  }

  if (options.scale) {
    mesh.scale.set(...options.scale);
  }

  mesh.castShadow = options.castShadow ?? true;
  mesh.receiveShadow = options.receiveShadow ?? true;

  parent.add(mesh);
  return mesh;
}

function addBox(parent, position, size, material, options = {}) {
  return addMesh(
    parent,
    new THREE.BoxGeometry(...size),
    material,
    position,
    options
  );
}

function addCylinder(parent, position, radiusTop, radiusBottom, height, material, segments = 10) {
  return addMesh(
    parent,
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments),
    material,
    position
  );
}

// Many copies of one shape in a single draw call (windows, road markings).
const _dummy = new THREE.Object3D();

function addInstanced(parent, geometry, material, items, options = {}) {
  if (!items.length) return null;

  const mesh = new THREE.InstancedMesh(geometry, material, items.length);

  items.forEach((item, i) => {
    _dummy.position.set(...item.p);
    _dummy.rotation.set(0, item.ry || 0, 0);
    _dummy.scale.set(...(item.s || [1, 1, 1]));
    _dummy.updateMatrix();
    mesh.setMatrixAt(i, _dummy.matrix);
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? true;
  mesh.frustumCulled = false;

  parent.add(mesh);
  return mesh;
}

// ------------------------------------------------------------
// HUMAN CHARACTER MODEL (Swastik + Smruti)
// ------------------------------------------------------------

function createCharacter(characterName, color = COLORS.blue) {
  const root = new THREE.Group();
  const rig = new THREE.Group();
  root.add(rig);

  // Smruti: ponytail + slimmer shoulders. Swastik: short hair.
  const female = characterName === 'Smruti';

  const skin = makeMaterial(female ? 0xc48a64 : 0xb57c58, 0.6);
  const shirt = makeMaterial(color, 0.85);
  const pants = makeMaterial(female ? 0x2a3140 : 0x2c3d5c, 0.9);
  const shoeM = makeMaterial(0xf1f1ee, 0.7);
  const soleM = makeMaterial(0x2a2a2a, 0.9);
  const hairM = makeMaterial(0x1a1412, 0.55);
  const darkM = makeMaterial(0x15100e, 0.4);
  const whiteM = makeMaterial(0xf4f4f0, 0.4);
  const lipM = makeMaterial(0x8a4a3e, 0.6);
  const bagM = makeMaterial(female ? 0x7b2d4a : 0x173e7b, 0.8);

  const FX = { castShadow: false };
  const H = 0.97;
  const sx = female ? 0.22 : 0.26;

  const pivot = (parent, x, y, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };

  // Pelvis + upper body (upper pivots at the hips for a natural lean)
  addMesh(rig, new THREE.SphereGeometry(0.16, 12, 10), pants, [0, 0.99, 0], { scale: [1.2, 0.75, 0.85] });

  const upper = pivot(rig, 0, H);
  addMesh(upper, new THREE.CapsuleGeometry(0.17, 0.24, 6, 12), shirt, [0, 1.26 - H, 0],
    { scale: [female ? 1.1 : 1.28, 1, 0.85] });
  addMesh(upper, new THREE.CylinderGeometry(0.052, 0.06, 0.12, 10), skin, [0, 1.6 - H, 0]);

  // Backpack with front straps
  addBox(upper, [0, 1.28 - H, -0.19], [0.3, 0.36, 0.14], bagM);
  for (const s of [-1, 1]) {
    addBox(upper, [s * 0.1, 1.34 - H, 0.15], [0.05, 0.3, 0.025], bagM);
  }

  // Head with face
  const head = pivot(upper, 0, 1.66 - H);
  addMesh(head, new THREE.SphereGeometry(0.105, 20, 16), skin, [0, 0.12, 0], { scale: [0.92, 1.15, 1.0] });
  addMesh(head, new THREE.SphereGeometry(0.07, 12, 10), skin, [0, 0.03, 0.035], { scale: [0.95, 0.8, 0.9] });
  addMesh(head, new THREE.SphereGeometry(0.02, 8, 8), skin, [0, 0.1, 0.104], { scale: [0.9, 1.2, 1.2], ...FX });
  addBox(head, [0, 0.065, 0.092], [0.05, 0.009, 0.01], lipM, FX);

  for (const s of [-1, 1]) {
    addMesh(head, new THREE.SphereGeometry(0.017, 10, 8), whiteM, [s * 0.04, 0.128, 0.091], { scale: [1.2, 0.9, 0.6], ...FX });
    addMesh(head, new THREE.SphereGeometry(0.009, 8, 8), darkM, [s * 0.04, 0.128, 0.1], FX);
    addBox(head, [s * 0.04, 0.152, 0.093], [0.05, 0.009, 0.012], hairM, { rotation: [0, 0, -s * 0.08], ...FX });
    addMesh(head, new THREE.SphereGeometry(0.024, 8, 8), skin, [s * 0.098, 0.115, -0.005], { scale: [0.5, 1, 0.8] });
  }

  // Hair: top cap + back volume
  addMesh(head, new THREE.SphereGeometry(0.113, 20, 14, 0, Math.PI * 2, 0, 1.12), hairM, [0, 0.12, -0.004], { scale: [0.92, 1.15, 1.0] });
  addMesh(head, new THREE.SphereGeometry(0.105, 16, 12), hairM, [0, 0.115, -0.035], { scale: [0.9, 1.1, 0.95] });

  let ponytail = null;
  if (female) {
    ponytail = pivot(head, 0, 0.17, -0.1);
    addMesh(ponytail, new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), hairM, [0, -0.14, 0]);
    addMesh(ponytail, new THREE.SphereGeometry(0.04, 8, 8), makeMaterial(0xd74438), [0, -0.01, 0]);
  }

  // Jointed arms and legs
  const j = {};

  for (const s of [-1, 1]) {
    const k = s < 0 ? 'l' : 'r';

    const shoulder = pivot(upper, s * sx, 1.47 - H);
    addMesh(shoulder, new THREE.SphereGeometry(0.075, 10, 8), shirt, [0, 0, 0]);
    addMesh(shoulder, new THREE.CapsuleGeometry(0.05, 0.2, 4, 8), skin, [0, -0.15, 0]);
    addMesh(shoulder, new THREE.CapsuleGeometry(0.062, 0.09, 4, 8), shirt, [0, -0.1, 0]);
    const elbow = pivot(shoulder, 0, -0.3);
    addMesh(elbow, new THREE.CapsuleGeometry(0.043, 0.2, 4, 8), skin, [0, -0.14, 0]);
    addMesh(elbow, new THREE.SphereGeometry(0.05, 10, 8), skin, [0, -0.31, 0.01], { scale: [0.9, 1.1, 0.9] });

    const hip = pivot(rig, s * 0.095, H);
    addMesh(hip, new THREE.CapsuleGeometry(0.085, 0.28, 4, 10), pants, [0, -0.22, 0]);
    const knee = pivot(hip, 0, -0.44);
    addMesh(knee, new THREE.CapsuleGeometry(0.065, 0.3, 4, 10), pants, [0, -0.21, 0]);
    const ankle = pivot(knee, 0, -0.42);
    addMesh(ankle, new THREE.BoxGeometry(0.11, 0.08, 0.27), shoeM, [0, -0.065, 0.05]);
    addMesh(ankle, new THREE.BoxGeometry(0.115, 0.03, 0.285), soleM, [0, -0.09, 0.05]);

    j[k + 'Shoulder'] = shoulder;
    j[k + 'Elbow'] = elbow;
    j[k + 'Hip'] = hip;
    j[k + 'Knee'] = knee;
    j[k + 'Ankle'] = ankle;
  }

  // Model front is +Z; rotating by PI makes the runner face -Z (down the road).
  root.rotation.y = Math.PI;

  root.userData = {
    rig,
    upper,
    head,
    ponytail,
    joints: j,
    characterName,
    baseColor: color,
    phaseOffset: Math.random() * Math.PI * 2,
    lastT: undefined
  };

  return root;
}

function createPlayer() {
  player = createCharacter(
    selectedCharacter,
    selectedCharacter === 'Swastik' ? COLORS.orange : COLORS.blue
  );

  player.position.set(LANES[START_LANE], 0, PLAYER_START_Z);
  scene.add(player);
}

function replacePlayerCharacter() {
  if (!player) return;

  const oldPosition = player.position.clone();
  scene.remove(player);

  player = createCharacter(
    selectedCharacter,
    selectedCharacter === 'Swastik' ? COLORS.orange : COLORS.blue
  );

  player.position.copy(oldPosition);
  scene.add(player);
}

// Natural run cycle: hip swing, knee fold on recovery, opposite-arm pump,
// torso counter-twist, forward lean, foot-strike bob, jump and slide poses.
function animateRunner(model, time, active = true) {
  const u = model?.userData;
  if (!u?.rig) return;

  const j = u.joints;
  const isPlayer = model === player;
  const sliding = isPlayer && isSliding;
  const airborne = isPlayer && isJumping;

  const dt = Math.min(0.05, time - (u.lastT ?? time));
  u.lastT = time;
  const ease = 1 - Math.exp(-dt * 22);

  // Lower cadence to match the slower run speed (no foot sliding)
  const cadence = 8 + Math.max(0, speed - START_SPEED) * 0.33;
  const p = time * cadence + u.phaseOffset;

  // hip/shoulder = forward swing, knee/elbow = bend
  const pose = {
    lHip: 0, rHip: 0, lKnee: 0.05, rKnee: 0.05, lAnkle: 0, rAnkle: 0,
    lSh: 0, rSh: 0, lEl: 0.15, rEl: 0.15,
    lean: 0.02 + Math.sin(time * 2) * 0.01, twist: 0, headPitch: 0,
    rigX: 0, rigY: 0, rigZ: 0
  };

  if (sliding) {
    pose.lHip = 0.1; pose.rHip = 0.1; pose.lKnee = 0.15; pose.rKnee = 0.25;
    pose.lAnkle = 0.3; pose.rAnkle = 0.3;
    pose.lSh = 0.2; pose.rSh = 0.2; pose.lEl = 0.3; pose.rEl = 0.3;
    pose.lean = 0; pose.headPitch = 1.0;
    pose.rigX = -1.3; pose.rigY = 0.22; pose.rigZ = 0.85;
  } else if (airborne) {
    pose.lHip = 1.0; pose.lKnee = 1.2; pose.lAnkle = 0.2;
    pose.rHip = -0.35; pose.rKnee = 1.5; pose.rAnkle = 0.5;
    pose.lSh = 1.5; pose.rSh = -0.5; pose.lEl = 0.5; pose.rEl = 0.9;
    pose.lean = 0.1; pose.headPitch = -0.1;
  } else if (active) {
    const leg = (phi) => ({
      hip: 0.25 + 0.65 * Math.sin(phi),
      knee: 0.35 + 1.15 * Math.max(0, Math.cos(phi)),
      ankle: 0.45 * Math.max(0, -Math.sin(phi))
    });
    const L = leg(p);
    const R = leg(p + Math.PI);

    pose.lHip = L.hip; pose.lKnee = L.knee; pose.lAnkle = L.ankle;
    pose.rHip = R.hip; pose.rKnee = R.knee; pose.rAnkle = R.ankle;

    pose.lSh = 0.15 - 0.7 * Math.sin(p);
    pose.rSh = 0.15 + 0.7 * Math.sin(p);
    pose.lEl = 1.3 + 0.25 * Math.sin(p);
    pose.rEl = 1.3 - 0.25 * Math.sin(p);

    pose.lean = 0.2;
    pose.twist = -0.14 * Math.sin(p);
    pose.headPitch = -0.18;
    pose.rigY = 0.08 * Math.abs(Math.sin(p));
  }

  const set = (obj, axis, v) => {
    obj.rotation[axis] += (v - obj.rotation[axis]) * ease;
  };

  set(j.lHip, 'x', -pose.lHip);       set(j.rHip, 'x', -pose.rHip);
  set(j.lKnee, 'x', pose.lKnee);      set(j.rKnee, 'x', pose.rKnee);
  set(j.lAnkle, 'x', pose.lAnkle);    set(j.rAnkle, 'x', pose.rAnkle);
  set(j.lShoulder, 'x', -pose.lSh);   set(j.rShoulder, 'x', -pose.rSh);
  set(j.lShoulder, 'z', -0.08);       set(j.rShoulder, 'z', 0.08);
  set(j.lElbow, 'x', -pose.lEl);      set(j.rElbow, 'x', -pose.rEl);

  set(u.upper, 'x', pose.lean);
  set(u.upper, 'y', pose.twist);
  set(u.head, 'x', pose.headPitch);
  set(u.head, 'y', -pose.twist * 0.8);

  set(u.rig, 'x', pose.rigX);
  u.rig.position.y += (pose.rigY - u.rig.position.y) * ease;
  u.rig.position.z += (pose.rigZ - u.rig.position.z) * ease;

  if (u.ponytail) {
    const swing = active && !sliding ? 0.15 + 0.25 * Math.sin(p * 2 + 1) : 0;
    u.ponytail.rotation.x = (airborne ? 0.6 : 0.35) + swing;
    u.ponytail.rotation.z = active ? Math.sin(p) * 0.12 : 0;
  }
}

// ------------------------------------------------------------
// CAMPUS WORLD
// ------------------------------------------------------------

function createWorld() {
  world = [];
  obstacles = [];
  coins = [];
  decorations = [];

  // Long grass base (extended towards +z so the longer approach road and the
  // menu camera never see the edge of the ground)
  addBox(
    scene,
    [0, -0.38, -80],
    [240, 0.5, 440],
    materials.grass,
    { castShadow: false }
  );

  // Repeating road segments. Segment 0 is the plaza OUTSIDE the gate; the
  // runner now starts on it. The rest are campus segments.
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    world.push(
      createCampusSegment(SEGMENT_LENGTH - i * SEGMENT_LENGTH, { plaza: i === 0 })
    );
  }

  buildMainGate();
  buildApproachRoad();

  // SUIIT stands to the right of the main gate, just outside the boundary
  // wall, with its front facing the road.
  buildIITBuilding(SUIIT_X, SUIIT_Z, -Math.PI / 2);

  // Billboard named SUIIT beside the road that leads to the building
  buildSuiitBillboard();

  buildDistantHills();
}

// Extra road in front of the main gate. It continues the plaza segment
// straight back (+z) and scrolls away with the world after the run starts.
function buildApproachRoad() {
  const g = new THREE.Group();
  g.name = 'ApproachRoad';
  g.userData.scroll = true;
  // The group origin starts at z = SEGMENT_LENGTH; its geometry lies further
  // back, so it is safe to remove once the origin is well past the camera.
  g.userData.removeZ = SEGMENT_LENGTH + 40;

  // Plaza segment 0 ends at world z = SEGMENT_LENGTH, so this joins it.
  g.position.z = SEGMENT_LENGTH;

  const L = APPROACH_LENGTH;
  const cz = L / 2;

  // Same textures as the normal road, repeated over the longer length
  const stretch = (base, rx, ry) => {
    const m = base.clone();
    m.map = base.map.clone();
    m.map.repeat.set(rx, ry);
    m.map.needsUpdate = true;
    return m;
  };

  const k = L / SEGMENT_LENGTH;
  const roadMat = stretch(materials.road, 3, 12 * k);
  const walkMat = stretch(materials.sidewalk, 1, 12 * k);
  const lawnMat = stretch(materials.lawn, 8, 7 * k);
  const longLawn = new THREE.PlaneGeometry(WALL_X - 7.2, L);

  addBox(g, [0, -0.08, cz], [ROAD_WIDTH, 0.2, L], roadMat);

  for (const side of [-1, 1]) {
    addBox(g, [side * 6.1, -0.02, cz], [2.2, 0.24, L], walkMat);
    addBox(g, [side * 5.05, 0.04, cz], [0.12, 0.06, L], materials.white, { castShadow: false });

    addMesh(
      g,
      longLawn,
      lawnMat,
      [side * (7.2 + (WALL_X - 7.2) / 2), -0.1, cz],
      { rotation: [-Math.PI / 2, 0, 0], castShadow: false }
    );
  }

  // Broken lane markings (continue the pattern of the plaza segment)
  const laneItems = [];
  for (let zz = 4; zz < L; zz += 7) {
    laneItems.push({ p: [-1.55, 0.035, zz] });
    laneItems.push({ p: [1.55, 0.035, zz] });
  }
  addInstanced(g, laneGeo, materials.line, laneItems, { receiveShadow: false });

  // Zebra crossing in front of the gate
  const stripes = [];
  for (let x = -4.2; x <= 4.21; x += 1.05) {
    stripes.push({ p: [x, 0.03, 18] });
  }
  addInstanced(g, zebraGeo, materials.line, stripes, { receiveShadow: false });

  // Lamps and avenue trees all along the approach
  for (let zz = 10; zz < L; zz += 16) {
    createLamp(g, -6.5, zz);
    createLamp(g, 6.5, zz);
  }

  for (let zz = 8; zz < L; zz += 13) {
    createTree(g, -(AVENUE_X + random(-0.3, 0.3)), zz + random(-2, 2), choose(['round', 'spread', 'tall']));
    createTree(g, AVENUE_X + random(-0.3, 0.3), zz + 6.5 + random(-2, 2), choose(['round', 'spread', 'tall']));
  }

  scene.add(g);
  decorations.push(g);
  return g;
}

const BUILDING_NAMES_LEFT = [
  'ACADEMIC BLOCK',
  'COMPUTER SCIENCE',
  'CENTRAL LIBRARY',
  'SCIENCE DEPARTMENT',
  'STUDENT HOSTEL',
  'LABORATORY',
  'ADMINISTRATION'
];

const BUILDING_NAMES_RIGHT = [
  'LECTURE HALL',
  'RESEARCH CENTRE',
  'DEPARTMENT BLOCK',
  'CAMPUS AUDITORIUM',
  'STUDENT CENTRE',
  'COMMERCE BLOCK',
  'EXAM HALL'
];

function createCampusSegment(z, { plaza = false } = {}) {
  const group = new THREE.Group();
  group.position.z = z;
  group.userData.plaza = plaza;

  // Main road
  addBox(group, [0, -0.08, -SEGMENT_LENGTH / 2], [ROAD_WIDTH, 0.2, SEGMENT_LENGTH], materials.road);

  for (const side of [-1, 1]) {
    // Sidewalks
    addBox(group, [side * 6.1, -0.02, -SEGMENT_LENGTH / 2], [2.2, 0.24, SEGMENT_LENGTH], materials.sidewalk);

    // Road edge lines
    addBox(group, [side * 5.05, 0.04, -SEGMENT_LENGTH / 2], [0.12, 0.06, SEGMENT_LENGTH], materials.white, { castShadow: false });

    // Maintained lawn between the sidewalk and the boundary wall
    addMesh(
      group,
      lawnGeo,
      materials.lawn,
      [side * (7.2 + (WALL_X - 7.2) / 2), -0.1, -SEGMENT_LENGTH / 2],
      { rotation: [-Math.PI / 2, 0, 0], castShadow: false }
    );
  }

  // Broken white lane markings (one draw call)
  const laneItems = [];
  for (let zLine = -3; zLine > -SEGMENT_LENGTH; zLine -= 7) {
    laneItems.push({ p: [-1.55, 0.035, zLine] });
    laneItems.push({ p: [1.55, 0.035, zLine] });
  }
  addInstanced(group, laneGeo, materials.line, laneItems, { receiveShadow: false });

  // Campus lamps on both sidewalks
  for (const lz of [-9, -25.6, -42.2]) {
    createLamp(group, -6.5, lz);
    createLamp(group, 6.5, lz);
  }

  if (plaza) {
    // Outside the gate: only the short strip behind the gate (world z 0 -> 4.5)
    // belongs to the campus, so close the boundary wall there.
    for (const side of [-1, 1]) {
      addBox(group, [side * WALL_X, 0.75, -45.75], [0.4, 1.5, 4.5], materials.wallPink);
    }
  } else {
    buildCampusFrontage(group);
  }

  scene.add(group);
  return group;
}

// Buildings, walkways, hedges, trees and benches for one campus segment.
// Buildings face the road. Trees live in the gaps BETWEEN buildings (and in
// front of facades, away from the entrance walkways), never inside a building.
function buildCampusFrontage(group) {
  for (const side of [-1, 1]) {
    const slots = side < 0 ? LEFT_SLOTS : RIGHT_SLOTS;
    const names = side < 0 ? BUILDING_NAMES_LEFT : BUILDING_NAMES_RIGHT;

    const blds = slots.map((c) => ({
      c,
      w: random(10.5, 13),   // facade width (runs along the road)
      d: random(8.5, 10),    // depth away from the road
      h: random(5.5, 8.5),
      name: choose(names)
    }));

    for (const b of blds) {
      createBuilding(
        group,
        [side * (FRONT_X + b.d / 2), 0, b.c],
        b.w, b.h, b.d, b.name, side
      );

      createWalkway(group, side, b.c);
      createHedges(group, side, b);

      // One avenue tree in front of the facade, beside (not on) the entrance path
      const sgn = Math.random() < 0.5 ? -1 : 1;
      createTree(
        group,
        side * (AVENUE_X + random(-0.3, 0.3)),
        b.c + sgn * random(4.4, 5.1),
        choose(['round', 'spread'])
      );
    }

    // Gap between the two buildings of this segment
    const near = blds[0];
    const far = blds[1];
    const gapFrom = far.c + far.w / 2;
    const gapTo = near.c - near.w / 2;
    createGapCluster(group, side, (gapFrom + gapTo) / 2, (gapTo - gapFrom) / 2, true);

    // Gap between this segment's buildings and the next segment's
    createGapCluster(group, side, side < 0 ? -1 : -6, 5, false);

    // Boundary wall
    addBox(group, [side * WALL_X, 0.75, -SEGMENT_LENGTH / 2], [0.4, 1.5, SEGMENT_LENGTH], materials.wallPink);
    addBox(group, [side * WALL_X, 1.55, -SEGMENT_LENGTH / 2], [0.55, 0.1, SEGMENT_LENGTH], materials.concrete, { castShadow: false });
  }

  // Zebra crossing between the two gaps
  const stripes = [];
  for (let x = -4.2; x <= 4.21; x += 1.05) {
    stripes.push({ p: [x, 0.03, -27] });
  }
  addInstanced(group, zebraGeo, materials.line, stripes, { receiveShadow: false });
}

// Paved path from the sidewalk to a building's front steps
function createWalkway(parent, side, z) {
  addBox(
    parent,
    [side * 9.2, 0, z],
    [4.0, 0.14, 2.4],
    materials.sidewalk,
    { castShadow: false }
  );
}

// Low hedges either side of the entrance path
function createHedges(parent, side, b) {
  const length = b.w / 2 - 0.8 - 2.2;
  if (length < 1) return;

  for (const s of [-1, 1]) {
    addBox(
      parent,
      [side * 11.3, 0.4, b.c + s * (2.2 + length / 2)],
      [0.9, 0.8, length],
      materials.hedge
    );
  }
}

// Trees, shrubs and a bench filling the open ground between two buildings
function createGapCluster(parent, side, zc, halfWidth, withBench) {
  const spread = Math.max(0.8, Math.min(2.0, halfWidth - 3.2));

  createTree(parent, side * random(13, 14.2), zc - spread, 'spread');
  createTree(parent, side * random(17.5, 19.5), zc + spread * 0.6, choose(['round', 'tall']));

  if (withBench) {
    createBench(parent, side * 9.7, zc, side);
    createBush(parent, side * 11.4, zc - 1.6, random(0.6, 0.8));
    createBush(parent, side * 11.4, zc + 1.6, random(0.6, 0.8));
  } else {
    createTree(parent, side * random(9.4, 10), zc + spread * 0.2, 'round');
    createBush(parent, side * 11.6, zc - spread - 1.4, random(0.6, 0.8));
  }
}

function lumpyBlob(radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const p = geo.attributes.position;

  for (let i = 0; i < p.count; i++) {
    const k = 1 + (Math.random() - 0.5) * 0.28;
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.9, p.getZ(i) * k);
  }

  geo.computeVertexNormals();
  return geo;
}

// kind: 'round' (mango-like), 'spread' (neem/banyan-like, wide and low),
//       'tall' (ashoka-like, narrow)
function createTree(parent, x, z, kind = choose(['round', 'round', 'spread', 'tall'])) {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.rotation.y = Math.random() * Math.PI * 2;

  const s = random(0.85, 1.15);
  const trunkH = kind === 'tall' ? 3.4 : 2.8;

  const trunk = addCylinder(tree, [0, trunkH / 2, 0], 0.14 * s, 0.28 * s, trunkH, materials.trunk, 8);
  trunk.rotation.z = (Math.random() - 0.5) * 0.08;

  // [x, y, z, radius, vertical stretch]
  let blobs;
  if (kind === 'tall') {
    blobs = [
      [0, trunkH + 0.4, 0, 0.95 * s, 1.5],
      [0.12, trunkH + 1.6, 0.1, 0.78 * s, 1.4],
      [0, trunkH + 2.6, 0, 0.5 * s, 1.3]
    ];
  } else if (kind === 'spread') {
    blobs = [
      [0, 3.0, 0, 1.5 * s, 0.7],
      [1.2 * s, 2.9, 0.4, 1.1 * s, 0.7],
      [-1.1 * s, 3.0, -0.5, 1.2 * s, 0.7],
      [0.2, 3.6, 0.1, 1.0 * s, 0.75]
    ];
  } else {
    blobs = [
      [0, 3.1, 0, 1.3 * s, 1],
      [0.8 * s, 3.4, 0.3, 0.9 * s, 1],
      [-0.7 * s, 3.5, -0.2, 0.95 * s, 1],
      [0.1, 4.1, 0.1, 0.8 * s, 1]
    ];
  }

  for (const [bx, by, bz, r, ys] of blobs) {
    addMesh(tree, choose(blobGeos), choose(foliageMats), [bx, by, bz], {
      scale: [r, r * ys, r]
    });
  }

  parent.add(tree);
  return tree;
}

function createBush(parent, x, z, size = 0.7) {
  return addMesh(
    parent,
    choose(blobGeos),
    choose(foliageMats),
    [x, size * 0.55, z],
    { scale: [size * 1.1, size * 0.8, size * 1.1] }
  );
}

function createBench(parent, x, z, side) {
  const bench = new THREE.Group();
  bench.position.set(x, 0, z);
  // Seat faces the road
  bench.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;

  addBox(bench, [0, 0.5, 0], [1.7, 0.1, 0.5], materials.bench);
  addBox(bench, [0, 0.86, -0.22], [1.7, 0.5, 0.07], materials.bench);
  for (const sx of [-0.7, 0.7]) {
    addBox(bench, [sx, 0.25, 0], [0.08, 0.5, 0.45], materials.black);
  }

  parent.add(bench);
  return bench;
}

function createLamp(parent, x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  addCylinder(group, [0, 1.75, 0], 0.055, 0.075, 3.5, materials.black, 8);

  addBox(
    group,
    [0, 3.55, 0],
    [0.42, 0.22, 0.42],
    makeMaterial(0xffe4a0, 0.3, {
      emissive: 0xffd06a,
      emissiveIntensity: 0.6
    })
  );

  parent.add(group);
}

// side: -1 = building on the left of the road, +1 = on the right.
// The facade (local +z) is rotated to face the road.
function createBuilding(parent, position, width, height, depth, label, side = 1) {
  const group = new THREE.Group();
  group.position.set(...position);
  group.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;

  const buildingColor = choose([0xd9d2c0, 0xd5dce0, 0xc6d1d8, 0xe3dfd3]);

  addBox(
    group,
    [0, height / 2, 0],
    [width, height, depth],
    makeMaterial(buildingColor)
  );

  // Plinth
  addBox(
    group,
    [0, 0.3, 0],
    [width + 0.12, 0.6, depth + 0.12],
    materials.darkConcrete
  );

  // Flat roof
  addBox(
    group,
    [0, height + 0.12, 0],
    [width + 0.3, 0.25, depth + 0.3],
    materials.darkConcrete
  );

  // Rooftop water tank
  addCylinder(
    group,
    [width * 0.25, height + 0.95, -depth * 0.2],
    0.5, 0.5, 1.2,
    materials.tank,
    10
  );

  // Windows: front rows plus both side walls (the sides are what you see
  // in the gaps between buildings), all drawn as one instanced mesh.
  const winItems = [];
  const rows = Math.max(2, Math.floor((height - 0.8) / 1.6));
  const colsF = Math.max(3, Math.floor(width / 2.1));
  const spanF = width - 1.8;
  const colsS = Math.max(2, Math.floor(depth / 2.4));
  const spanS = depth - 1.8;

  for (let r = 0; r < rows; r++) {
    const wy = 1.5 + r * 1.55;
    if (wy > height - 0.7) break;

    for (let c = 0; c < colsF; c++) {
      const wx = -spanF / 2 + (spanF * c) / (colsF - 1);
      if (r === 0 && Math.abs(wx) < 1.5) continue; // keep the doorway clear
      winItems.push({ p: [wx, wy, depth / 2 + 0.02] });
    }

    for (const s of [-1, 1]) {
      for (let c = 0; c < colsS; c++) {
        const wz = -spanS / 2 + (spanS * c) / (colsS - 1);
        winItems.push({ p: [s * (width / 2 + 0.02), wy, wz], ry: Math.PI / 2 });
      }
    }
  }

  addInstanced(group, windowGeo, materials.glass, winItems, { castShadow: false });

  // Entrance
  addBox(
    group,
    [0, 1.1, depth / 2 + 0.07],
    [1.45, 2.2, 0.18],
    materials.darkConcrete
  );

  addBox(
    group,
    [0, 1.05, depth / 2 + 0.18],
    [1.05, 2.0, 0.05],
    materials.glass,
    { castShadow: false }
  );

  // Label board
  addBox(
    group,
    [0, height + 0.75, depth / 2 + 0.1],
    [Math.min(width - 0.8, 8.5), 0.72, 0.15],
    makeMaterial(0x174e3a)
  );

  // Canvas texture provides legible text without external assets.
  const texture = createTextTexture(label, '#ffffff', '#174e3a');
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.min(width - 1, 8.2), 0.55),
    new THREE.MeshBasicMaterial({ map: texture, transparent: false })
  );
  sign.position.set(0, height + 0.75, depth / 2 + 0.19);
  group.add(sign);

  // Building steps
  addBox(
    group,
    [0, 0.14, depth / 2 + 0.65],
    [3.3, 0.28, 1.25],
    materials.sidewalk
  );

  parent.add(group);
  return group;
}

function createTextTexture(text, foreground = '#ffffff', background = '#174e3a') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 96;

  const context = canvas.getContext('2d');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = foreground;
  context.font = 'bold 30px Arial';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  context.fillText(text, canvas.width / 2, canvas.height / 2, 490);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ------------------------------------------------------------
// MAIN GATE (Sambalpur University) - matched to the reference photo
// ------------------------------------------------------------
// A central red tower monument with the flame sculpture, COME TO LEARN /
// GO TO SERVE plaques and a brick base, flanked by two lettered side arches
// with yellow-black iron gates and stone pillars.
//
// The gate is shifted sideways so that ONE of the two entrance arches sits on
// the runner's start lane (START_LANE). The runner starts on the road OUTSIDE
// the gate, runs towards it and through that arch; the gate then scrolls away
// behind them.

function buildMainGate() {
  const gate = new THREE.Group();
  gate.name = 'SambalpurUniversityMainGate';
  gate.userData.isGate = true;
  gate.userData.scroll = true;
  gate.userData.removeZ = 60;

  const OX = GATE_OFFSET_X;     // world x of the central monument
  const PILLAR_X = 9.3;         // outer stone pillar centre
  const PILLAR_H = 5.9;         // pillars are LOW in the photo (about 6 units)
  const PLAT_Y = 1.0;           // top of the brick platform

  // Side arch: straight lettered beam + quarter-ellipse leg that swoops to the ground
  const BEAM_BOT = 3.9;
  const BEAM_TOP = 5.0;
  const BEAM_END = 10.3;        // beam overhangs the pillar on the outside
  const ARCH_XC = 4.2;          // where the beam turns into the curved leg
  const LEG_RX_OUT = 2.0;       // leg horizontal radius (outer edge)
  const LEG_RX_IN = 1.15;       // leg horizontal radius (inner edge)

  const mat = (opts) => new THREE.MeshStandardMaterial(opts);

  function canvasTex(w, h, draw, rx = 1, ry = 1) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    return t;
  }

  function brickTex(bw, bh, light, rx, ry) {
    return canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#cdbfae';
      g.fillRect(0, 0, w, h);
      let seed = 7;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let r = 0; r < h / bh; r++) {
        const off = (r % 2) * bw / 2;
        for (let x = -bw; x < w + bw; x += bw) {
          g.fillStyle = `hsl(10, 55%, ${light + rnd() * 9}%)`;
          g.fillRect(x + off + 1, r * bh + 1, bw - 2, bh - 2);
        }
      }
    }, rx, ry);
  }

  function stoneTex(rx, ry) {
    return canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = '#c9c3b4';
      g.fillRect(0, 0, w, h);
      let seed = 11;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 700; i++) {
        g.fillStyle = rnd() < 0.5 ? 'rgba(80,75,65,0.12)' : 'rgba(255,250,240,0.12)';
        g.fillRect(rnd() * w, rnd() * h, 2, 2);
      }
      g.strokeStyle = 'rgba(70,65,55,0.35)';
      g.lineWidth = 2;
      for (let y = 0; y < h; y += 64) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
      }
    }, rx, ry);
  }

  function latticeTex(w, h, step) {
    return canvasTex(w, h, (g) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = '#8d949a';
      g.lineWidth = 4;
      for (let i = -h; i < w + h; i += step) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke();
        g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke();
      }
      g.lineWidth = 12;
      g.beginPath(); g.moveTo(0, 6); g.lineTo(w, 6); g.stroke();
      g.beginPath(); g.moveTo(0, h - 6); g.lineTo(w, h - 6); g.stroke();
    });
  }

  // ---------- materials ----------
  const stoneMat  = mat({ map: stoneTex(1, 2), roughness: 0.9 });
  const brickMat  = mat({ map: brickTex(64, 16, 34, 3, 0.25), roughness: 0.9 });
  const paveMat   = mat({ map: brickTex(32, 16, 38, 24, 8), roughness: 0.95 });
  const concrete  = mat({ color: 0xb4b3ad, roughness: 0.9 });
  const concreteL = mat({ color: 0xd2d1cb, roughness: 0.88 });
  const white     = mat({ color: 0xe9e8e2, roughness: 0.8 });
  const pink      = mat({ color: 0xd78aa0, roughness: 0.9 });
  const red       = mat({ color: 0xc2452c, roughness: 0.75 });
  const dark      = mat({ color: 0x1a1b1d, roughness: 0.45, metalness: 0.5 });
  const yellow    = mat({ color: 0xf2b705, roughness: 0.55 });

  const stripeTex = canvasTex(128, 32, (g) => {
    for (let i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? '#111111' : '#f2c100';
      g.fillRect(i * 32, 0, 32, 32);
    }
  }, 3, 1);
  const curbMat = mat({ map: stripeTex, roughness: 0.8 });

  const checkerMat = mat({
    map: canvasTex(128, 128, (g) => {
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
          g.fillStyle = (r + c) % 2 ? '#ffffff' : '#c9302c';
          g.fillRect(c * 32, r * 32, 32, 32);
        }
      }
    }),
    roughness: 0.8
  });

  const tileMat = mat({
    map: canvasTex(256, 384, (g, w, h) => {
      g.fillStyle = '#b7bcc0';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#7d848a';
      g.lineWidth = 4;
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(i * w / 4, 0); g.lineTo(i * w / 4, h); g.stroke();
      }
      for (let j = 0; j <= 6; j++) {
        g.beginPath(); g.moveTo(0, j * h / 6); g.lineTo(w, j * h / 6); g.stroke();
      }
    }),
    roughness: 0.3,
    metalness: 0.3
  });

  // ---------- helpers ----------
  const boxCache = new Map();
  function boxGeo(w, h, d) {
    const k = `${w}|${h}|${d}`;
    if (!boxCache.has(k)) boxCache.set(k, new THREE.BoxGeometry(w, h, d));
    return boxCache.get(k);
  }

  function box(material, x, y, z, w, h, d, shadow = true) {
    const m = new THREE.Mesh(boxGeo(w, h, d), material);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    m.receiveShadow = true;
    gate.add(m);
    return m;
  }

  function plane(texture, w, h, x, y, z, extra = {}) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      mat({ map: texture, transparent: true, alphaTest: 0.05, roughness: 0.7, ...extra })
    );
    m.position.set(x, y, z);
    gate.add(m);
    return m;
  }

  // ---------- red brick pavement apron ----------
  box(paveMat, -OX, 0.05, 4.5, 48, 0.12, 17, false);

  // =====================================================
  // CENTRAL MONUMENT
  // =====================================================

  // upper brick platform
  box(brickMat, 0, 0.5, 0.2, 6.0, 1.0, 2.4);
  box(concreteL, 0, 0.1, 0.2, 6.2, 0.2, 2.6, false);
  box(concreteL, 0, PLAT_Y + 0.04, 0.2, 6.2, 0.08, 2.6, false);

  // wide low brick step in front (the red-brick base seen in the photo)
  box(brickMat, 0, 0.28, 2.0, 7.4, 0.56, 1.3);
  box(white, 0, 0.6, 2.0, 7.6, 0.08, 1.5, false);

  // red tower slab: top cut diagonally, taller on the left
  const slabShape = new THREE.Shape();
  slabShape.moveTo(-1.5, 0);
  slabShape.lineTo(1.5, 0);
  slabShape.lineTo(1.5, 6.1);
  slabShape.lineTo(-1.5, 8.4);
  slabShape.closePath();
  const slabGeo = new THREE.ExtrudeGeometry(slabShape, { depth: 1.0, bevelEnabled: false });
  slabGeo.translate(0, 0, -0.5);
  const slab = new THREE.Mesh(slabGeo, red);
  slab.position.set(0, PLAT_Y, 0);
  slab.castShadow = slab.receiveShadow = true;
  gate.add(slab);

  // grey tile block at the top right, behind the cut
  box(tileMat, 0.65, 8.2, -0.1, 1.7, 2.4, 0.9);

  // tall stone columns either side of the tower
  box(stoneMat, -1.95, 5.4, 0.1, 0.4, 8.8, 0.5);
  box(stoneMat, 2.1, 4.25, 0.1, 0.5, 6.5, 0.5);

  // two sweeping concrete arcs
  function sweepArc(cx, cy, R) {
    const m = new THREE.Mesh(new THREE.TorusGeometry(R, 0.27, 10, 40, Math.PI / 2), concrete);
    m.rotation.z = Math.PI / 2;
    m.scale.set(1, 1, 2.2);
    m.position.set(cx, cy, 0.85);
    m.castShadow = true;
    gate.add(m);
  }
  sweepArc(1.5, 1.6, 3.4);
  sweepArc(3.0, 2.6, 4.9);
  box(concrete, 1.85, 5.0, 0.85, 0.7, 0.54, 0.6);

  // canopy arms: left one slopes DOWN toward the right, right one is flat
  box(concreteL, -2.2, 9.0, 0.1, 2.0, 0.32, 1.2).rotation.z = -0.3;
  box(concreteL, 2.7, 7.55, 0.1, 1.9, 0.32, 1.2);

  // emblem (small, as in the photo)
  const emblemTex = canvasTex(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    g.fillStyle = '#ece6d6';
    g.beginPath(); g.arc(128, 128, 120, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2b3a55'; g.lineWidth = 10;
    g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 4;
    g.beginPath(); g.arc(128, 128, 74, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#2b3a55';
    g.font = 'bold 64px Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SU', 128, 132);
  });
  plane(emblemTex, 0.85, 0.85, 0.1, 5.6, 0.53);

  // small dark caption under the emblem
  const labelTex = canvasTex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#2a0f0c';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 44px Arial, sans-serif';
    g.fillText('SAMBALPUR UNIVERSITY', w / 2, 38, w - 20);
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText("ACCREDITED 'A' GRADE  2015", w / 2, 92, w - 20);
  });
  plane(labelTex, 2.0, 0.5, 0.1, 4.85, 0.53);

  // flame sculpture on a white pedestal between the plaques
  const torch = new THREE.Group();
  torch.position.set(0.1, 0, 0.95);
  gate.add(torch);

  const pedestal = new THREE.Mesh(boxGeo(0.9, 0.8, 0.8), white);
  pedestal.position.y = 1.4;
  pedestal.castShadow = true;
  torch.add(pedestal);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.6, 10), dark);
  stem.position.y = 2.1;
  torch.add(stem);

  const bowl = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 20), dark);
  bowl.rotation.x = Math.PI;
  bowl.position.y = 2.8;
  bowl.castShadow = true;
  torch.add(bowl);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 1.0, 16),
    mat({ color: 0xff5a1f, emissive: 0xff4a10, emissiveIntensity: 1.4, roughness: 0.5 })
  );
  flame.position.y = 3.65;
  torch.add(flame);

  const flameCore = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.65, 12),
    mat({ color: 0xffc043, emissive: 0xffa020, emissiveIntensity: 1.6, roughness: 0.5 })
  );
  flameCore.position.y = 3.55;
  torch.add(flameCore);

  gateFlame = flame;

  // COME TO LEARN / GO TO SERVE plaques
  function plaque(x, line1, line2) {
    const t = canvasTex(256, 160, (g, w, h) => {
      g.fillStyle = '#16181b'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#e8e8e8'; g.lineWidth = 6;
      g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#ffffff';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 52px Arial, sans-serif';
      g.fillText(line1, w / 2, 55, w - 30);
      g.fillText(line2, w / 2, 112, w - 30);
    });
    const faceMat = mat({ map: t, roughness: 0.6 });
    const m = new THREE.Mesh(boxGeo(1.5, 0.95, 0.25), [dark, dark, dark, dark, faceMat, dark]);
    m.position.set(x, PLAT_Y + 0.55, 1.0);
    m.castShadow = true;
    gate.add(m);
  }
  plaque(-1.45, 'COME TO', 'LEARN');
  plaque(1.35, 'GO TO', 'SERVE');

  // grey lattice railing around the front of the platform
  const frontLattice = latticeTex(1024, 160, 40);
  plane(frontLattice, 5.8, 0.9, 0, PLAT_Y + 0.5, 1.25, { side: THREE.DoubleSide });
  for (const s of [-1, 1]) {
    const sideLattice = latticeTex(512, 160, 40);
    const p = plane(sideLattice, 2.0, 0.9, s * 2.9, PLAT_Y + 0.5, 0.25, { side: THREE.DoubleSide });
    p.rotation.y = Math.PI / 2;
  }

  // =====================================================
  // SIDE ARCHES (left = Odia text, right = English text)
  // =====================================================

  // Yellow + black sliding iron gate leaf
  function leaf(sx, outer, w) {
    const H = 1.7;
    const inner = outer - sx * w;
    const cx = (outer + inner) / 2;
    box(dark, cx, 0.3, 0, w, 0.5, 0.12, false);        // solid lower panel
    box(dark, cx, 0.62, 0, w, 0.08, 0.12, false);      // middle rail
    box(dark, cx, H - 0.06, 0, w, 0.12, 0.12, false);  // top rail
    box(dark, outer, H / 2, 0, 0.1, H, 0.14, false);   // end posts
    box(dark, inner, H / 2, 0, 0.1, H, 0.14, false);
    const bars = Math.max(2, Math.round(w / 0.16));
    for (let i = 1; i < bars; i++) {
      box(yellow, outer - sx * (w * i / bars), 1.15, 0, 0.06, 1.0, 0.06, false);
    }
  }

  for (const s of [-1, 1]) {
    const PX = s * PILLAR_X;

    // stone pillar with cap and footing
    box(stoneMat, PX, PILLAR_H / 2, 0, 1.5, PILLAR_H, 1.4);
    box(concreteL, PX, PILLAR_H + 0.12, 0, 1.8, 0.25, 1.7);
    box(concrete, PX, 0.2, 0, 1.8, 0.4, 1.7, false);

    // lettered beam: overhangs the pillar, runs inward to the start of the curve
    const xEnd = s * BEAM_END;
    const xc = s * ARCH_XC;
    const beamLen = Math.abs(xEnd - xc);

    // Visible part of the beam is between the pillar's inner face and the curve.
    // Centre the lettering there (u runs along +x on the front face).
    const visA = Math.min(s * (PILLAR_X - 0.75), xc);
    const visB = Math.max(s * (PILLAR_X - 0.75), xc);
    const u0 = Math.min(xEnd, xc);
    const centreU = ((visA + visB) / 2 - u0) / beamLen;

    const textTex = canvasTex(1024, 176, (g, w, h) => {
      g.fillStyle = '#d0cfca';
      g.fillRect(0, 0, w, h);
      const text = s < 0 ? 'ସମ୍ବଲପୁର ବିଶ୍ୱବିଦ୍ୟାଳୟ' : 'SAMBALPUR UNIVERSITY';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = s < 0
        ? "bold 100px 'Nirmala UI','Noto Sans Oriya','Kalinga','Lohit Odia',sans-serif"
        : 'bold 100px Arial, sans-serif';
      const tx = w * centreU;
      g.fillStyle = '#12561f';
      g.fillText(text, tx + 3, h / 2 + 4, w * 0.64);
      g.fillStyle = '#1e9e3a';
      g.fillText(text, tx, h / 2, w * 0.64);
    });
    const textMat = mat({ map: textTex, roughness: 0.85 });

    const beam = new THREE.Mesh(
      boxGeo(beamLen, BEAM_TOP - BEAM_BOT, 1.2),
      [concreteL, concreteL, concreteL, concreteL, textMat, concreteL]
    );
    beam.position.set((xEnd + xc) / 2, (BEAM_TOP + BEAM_BOT) / 2, 0);
    beam.castShadow = beam.receiveShadow = true;
    gate.add(beam);

    // curved leg: quarter-ellipse band, tangent to the beam at the top,
    // vertical-ish at the ground, about 0.85 thick at the foot
    const shape = new THREE.Shape();
    if (s < 0) {
      shape.absellipse(0, 0, LEG_RX_OUT, BEAM_TOP, 0, Math.PI / 2, false, 0);
      shape.absellipse(0, 0, LEG_RX_IN, BEAM_BOT, Math.PI / 2, 0, true, 0);
    } else {
      shape.absellipse(0, 0, LEG_RX_OUT, BEAM_TOP, Math.PI / 2, Math.PI, false, 0);
      shape.absellipse(0, 0, LEG_RX_IN, BEAM_BOT, Math.PI, Math.PI / 2, true, 0);
    }
    shape.closePath();
    const legGeo = new THREE.ExtrudeGeometry(shape, {
      depth: 1.2, bevelEnabled: false, curveSegments: 32
    });
    legGeo.translate(0, 0, -0.6);
    const leg = new THREE.Mesh(legGeo, concreteL);
    leg.position.set(xc, 0, 0);
    leg.castShadow = leg.receiveShadow = true;
    gate.add(leg);

    // Iron gate leaf next to the pillar.
    // Left arch: wide leaf like the photo. Right arch (the runner's lane):
    // a short leaf so the camera sightline through the opening stays clear.
    leaf(s, s * (PILLAR_X - 0.75), s < 0 ? 3.4 : 1.5);

    // yellow-black striped curb at the foot of the pillar
    box(curbMat, PX, 0.18, 1.2, 2.2, 0.36, 0.6, false);

    // red and white checker panel at the outer end
    box(checkerMat, s * (PILLAR_X + 1.75), 0.55, 0.55, 1.5, 1.1, 0.8);

    // security guard inside the entrance
    createSecurityGuard(gate, s * 7.8, 1.3);
  }

  // boundary wall continues from each outer pillar to the campus wall
  function wall(x0, x1) {
    const len = x1 - x0;
    if (len < 0.2) return;
    const cx = (x0 + x1) / 2 - OX;
    box(pink, cx, 0.75, 0, len, 1.5, 0.5);
    box(concrete, cx, 1.55, 0, len + 0.1, 0.12, 0.6, false);
  }
  wall(-WALL_X, OX - PILLAR_X - 0.75);
  wall(OX + PILLAR_X + 0.75, WALL_X);

  // Black LED display board on a yellow pole, just outside the right pillar
  const ledX = 11.2;
  const ledTex = canvasTex(256, 200, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#0b0e13');
    gr.addColorStop(1, '#1b2431');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.05)';
    g.beginPath();
    g.moveTo(0, h * 0.55); g.lineTo(w * 0.6, 0); g.lineTo(w, 0); g.lineTo(w * 0.3, h);
    g.lineTo(0, h); g.closePath(); g.fill();
  });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 3.1, 8), yellow);
  pole.position.set(ledX, 1.55, 1.2);
  gate.add(pole);
  box(dark, ledX, 3.85, 1.2, 2.25, 1.75, 0.2);
  plane(ledTex, 2.05, 1.55, ledX, 3.85, 1.31, { transparent: false, alphaTest: 0 });

  // The gate stands ahead of the runner's start; it scrolls towards the
  // runner, who runs through the right arch, and then it scrolls away behind.
  gate.position.set(OX, 0, GATE_Z);
  scene.add(gate);
  decorations.push(gate);
  return gate;
}

// ------------------------------------------------------------
// SUIIT BUILDING (beside the main gate)
// Sambalpur University Institute of Information Technology
// ------------------------------------------------------------

function buildIITBuilding(x = SUIIT_X, z = SUIIT_Z, rotY = -Math.PI / 2) {
  const b = new THREE.Group();
  b.name = 'SUIITBuilding';
  b.userData.isBuilding = true;
  b.userData.scroll = true;
  b.userData.removeZ = 60;

  function tex(w, h, draw, rx = 1, ry = 1) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.anisotropy = 8;
    return t;
  }
  const mat = (o) => new THREE.MeshStandardMaterial(o);

  const boxCache = new Map();
  const boxGeo = (w, h, d) => {
    const k = `${w}|${h}|${d}`;
    if (!boxCache.has(k)) boxCache.set(k, new THREE.BoxGeometry(w, h, d));
    return boxCache.get(k);
  };
  function box(material, bx, by, zz, w, h, d, shadow = true) {
    const m = new THREE.Mesh(boxGeo(w, h, d), material);
    m.position.set(bx, by, zz);
    m.castShadow = shadow;
    m.receiveShadow = true;
    b.add(m);
    return m;
  }
  function plane(material, w, h, px, py, zz) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    m.position.set(px, py, zz);
    b.add(m);
    return m;
  }

  // glass facade with mullions, drawn on a canvas
  function glassMat(cols, rows, pw, ph, base = ['#6f9fc4', '#3f6f96']) {
    const t = tex(pw, ph, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, base[0]); gr.addColorStop(1, base[1]);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#e8eef2'; g.lineWidth = 6;
      for (let i = 0; i <= cols; i++) { g.beginPath(); g.moveTo(i * w / cols, 0); g.lineTo(i * w / cols, h); g.stroke(); }
      for (let j = 0; j <= rows; j++) { g.beginPath(); g.moveTo(0, j * h / rows); g.lineTo(w, j * h / rows); g.stroke(); }
    });
    return mat({ map: t, roughness: 0.2, metalness: 0.35 });
  }

  // materials
  const cream   = mat({ color: 0xe2c68c, roughness: 0.9 });
  const white   = mat({ color: 0xf1efe9, roughness: 0.85 });
  const orange  = mat({ color: 0xc9733c, roughness: 0.9 });
  const trim    = mat({ color: 0xd8d4c8, roughness: 0.9 });
  const dark    = mat({ color: 0x1e2a33, roughness: 0.6 });
  const carpet  = mat({ color: 0xb3202a, roughness: 1 });
  const potMat  = mat({ color: 0xb5603a, roughness: 0.9 });
  const leaf    = mat({ color: 0x2f7d32, roughness: 1 });
  const flowers = [0xe8485f, 0xf2b632, 0xf06fa8, 0xffffff].map((c) => mat({ color: c, roughness: 0.8 }));

  // central block
  box(white, 0, 4.8, 0, 6.4, 9.6, 11);
  for (const s of [-1, 1]) {
    box(cream, s * 4.9, 6.0, 0, 3.4, 12, 10);
    box(trim, s * 4.9, 12.1, 0, 3.6, 0.25, 10.2);
  }
  box(trim, 0, 9.7, 0, 6.6, 0.2, 11.2);

  // blue glass front
  plane(glassMat(6, 6, 512, 512), 5.2, 5.0, 0, 5.9, 5.52);

  // name banner
  const signMat = mat({
    map: tex(2048, 297, (g, w, h) => {
      g.fillStyle = '#f6f5f0'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#1f3a73'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
      g.fillStyle = '#1f3a73'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = 'bold 96px Arial, sans-serif';
      g.fillText('SAMBALPUR UNIVERSITY', w / 2, 90);
      g.font = 'bold 72px Arial, sans-serif';
      g.fillText('INSTITUTE OF INFORMATION TECHNOLOGY', w / 2, 205);
    }),
    roughness: 0.7
  });
  box(trim, 0, 9.0, 5.52, 6.4, 1.0, 0.12);
  plane(signMat, 6.2, 0.9, 0, 9.0, 5.6);

  // entrance: dark doorway, canopy with flower garland, steps
  box(dark, 0, 1.9, 5.5, 2.8, 2.6, 0.2);
  box(trim, 0, 3.3, 6.2, 4.2, 0.25, 1.6);
  for (let i = 0; i < 12; i++) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 6), flowers[i % 4]);
    f.position.set(-1.9 + i * 0.345, 3.1, 6.95);
    b.add(f);
  }
  [[0.6, 6.2], [0.4, 7.1], [0.2, 8.0]].forEach(([h, zz]) =>
    box(trim, 0, h / 2, zz, 7.2, h, 0.9));

  // cream mid wings
  const winTex = tex(512, 352, (g, w, h) => {
    g.fillStyle = '#e2c68c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#34505f';
    for (const y of [40, 200]) for (let i = 0; i < 4; i++) g.fillRect(14 + i * 124, y, 112, 110);
  });
  const winMat = mat({ map: winTex, roughness: 0.35, metalness: 0.2 });

  for (const s of [-1, 1]) {
    box(cream, s * 10.8, 4.25, -1, 8.4, 8.5, 10);
    box(trim, s * 10.8, 8.6, -1, 8.6, 0.2, 10.2);
    plane(winMat, 7.6, 5.2, s * 10.8, 5.0, 4.02);

    // orange end wings
    box(orange, s * 19.5, 2.7, 0.5, 9, 5.4, 11);
    box(trim, s * 19.5, 5.5, 0.5, 9.2, 0.2, 11.2);
    plane(glassMat(4, 2, 512, 280, ['#5d8aa8', '#2f566f']), 7.6, 3.6, s * 19.5, 2.6, 6.02);
    box(cream, s * 19.5, 7.5, -1, 9, 4, 8);
    plane(glassMat(4, 1, 512, 140, ['#5d8aa8', '#2f566f']), 7.6, 2.0, s * 19.5, 7.5, 3.02);
  }

  // Lawn court with red carpet. Kept shallow (about 12 deep) so the whole
  // building fits between the campus wall and the camera view.
  const courtMat = mat({
    map: tex(1024, 260, (g, w, h) => {
      g.fillStyle = '#2f9e4a'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 5;
      g.strokeRect(14, 14, w - 28, h - 28);
      g.beginPath(); g.moveTo(w / 2, 14); g.lineTo(w / 2, h - 14); g.stroke();
      g.strokeRect(14, 60, 170, h - 120); g.strokeRect(w - 184, 60, 170, h - 120);
    }),
    roughness: 1
  });
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(46, 11.7), courtMat);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.set(0, 0.03, 9.65);   // covers local z 3.8 -> 15.5
  lawn.receiveShadow = true;
  b.add(lawn);

  // ---- Road from the SUIIT entrance to the main road in front of the main gate ----
  // Local +z points at the main road (world -x). The road runs from the
  // entrance steps to the main road's right edge (world x = 5). Its top sits
  // above the gate's brick apron and the sidewalk, so it crosses them cleanly
  // and nothing flickers.
  const ROAD_FROM = 8.45;
  const ROAD_TO = x - 5.0;
  const roadLen = ROAD_TO - ROAD_FROM;
  const roadMid = (ROAD_FROM + ROAD_TO) / 2;

  const branchMat = materials.road.clone();
  branchMat.map = materials.road.map.clone();
  branchMat.map.repeat.set(1.5, roadLen / 4);
  branchMat.map.needsUpdate = true;

  box(branchMat, 0, 0.07, roadMid, 5, 0.14, roadLen, false);

  // edge lines, raised kerbs and a dashed centre line
  const lineMat = mat({ color: 0xf3f1d9, roughness: 0.8 });
  for (const s of [-1, 1]) {
    box(white, s * 2.3, 0.15, roadMid, 0.1, 0.02, roadLen, false);
    box(trim, s * 2.75, 0.1, roadMid, 0.5, 0.2, roadLen, false);
  }
  for (let lz = ROAD_FROM + 2; lz < ROAD_TO - 1; lz += 4) {
    box(lineMat, 0, 0.15, lz, 0.1, 0.02, 1.8, false);
  }

  // street lamps along the SUIIT road
  for (const lz of [14, 22, 30]) {
    createLamp(b, -3.5, lz);
    createLamp(b, 3.5, lz);
  }

  // red carpet at the entrance, laid on the road end
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3), carpet);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.16, 9.95);    // from the steps outwards
  b.add(rug);

  // potted plants along the facade
  const potGeo = new THREE.CylinderGeometry(0.25, 0.2, 0.4, 8);
  const bushGeo = new THREE.SphereGeometry(0.42, 8, 8);
  const bloomGeo = new THREE.SphereGeometry(0.1, 6, 6);
  for (let i = -11; i <= 11; i++) {
    const px = i * 2.0;
    if (Math.abs(px) < 4.2) continue;
    const pz = Math.abs(px) > 15 ? 7.0 : 5.5;
    const pot = new THREE.Mesh(potGeo, potMat);
    pot.position.set(px, 0.2, pz); b.add(pot);
    const bush = new THREE.Mesh(bushGeo, leaf);
    bush.position.set(px, 0.75, pz); bush.castShadow = true; b.add(bush);
    const bloom = new THREE.Mesh(bloomGeo, flowers[Math.abs(i) % 4]);
    bloom.position.set(px + 0.2, 1.0, pz + 0.2); b.add(bloom);
  }

  // place in the world: local +z (front) faces the road
  b.position.set(x, 0, z);
  b.rotation.y = rotY;
  scene.add(b);
  decorations.push(b);
  return b;
}

// ------------------------------------------------------------
// SUIIT BILLBOARD (on the lawn in front of the gate, beside the SUIIT road)
// ------------------------------------------------------------

function buildSuiitBillboard() {
  const g = new THREE.Group();
  g.name = 'SUIITBillboard';
  g.userData.scroll = true;
  g.userData.removeZ = 60;

  const W = 11;
  const H = 5;

  // board artwork
  const c = document.createElement('canvas');
  c.width = 1536;
  c.height = 700;
  const t = c.getContext('2d');

  const bg = t.createLinearGradient(0, 0, c.width, c.height);
  bg.addColorStop(0, '#0b2559');
  bg.addColorStop(1, '#1d56ad');
  t.fillStyle = bg;
  t.fillRect(0, 0, c.width, c.height);

  t.strokeStyle = '#ffffff';
  t.lineWidth = 16;
  t.strokeRect(14, 14, c.width - 28, c.height - 28);
  t.strokeStyle = '#ff8a2b';
  t.lineWidth = 8;
  t.strokeRect(38, 38, c.width - 76, c.height - 76);

  t.textAlign = 'center';
  t.textBaseline = 'middle';

  // big SUIIT lettering
  t.font = "900 380px 'Arial Black', Arial, sans-serif";
  t.lineJoin = 'round';
  t.lineWidth = 22;
  t.strokeStyle = '#0a1c40';
  t.strokeText('SUIIT', 650, 270, 1100);
  t.fillStyle = '#ffffff';
  t.fillText('SUIIT', 650, 270, 1100);

  // arrow towards the SUIIT road
  t.fillStyle = '#ff8a2b';
  t.fillRect(1235, 248, 150, 46);
  t.beginPath();
  t.moveTo(1380, 200);
  t.lineTo(1480, 271);
  t.lineTo(1380, 342);
  t.closePath();
  t.fill();

  t.fillStyle = '#ffffff';
  t.font = 'bold 72px Arial, sans-serif';
  t.fillText('SAMBALPUR UNIVERSITY', 768, 525, 1360);
  t.fillStyle = '#ffcf7a';
  t.font = 'bold 56px Arial, sans-serif';
  t.fillText('INSTITUTE OF INFORMATION TECHNOLOGY', 768, 605, 1360);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;

  const steel = makeMaterial(0x39424b, 0.6, { metalness: 0.5 });
  const faceMat = new THREE.MeshStandardMaterial({
    map: tex,
    emissive: 0xffffff,
    emissiveMap: tex,
    emissiveIntensity: 0.4,
    roughness: 0.6
  });

  const put = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    return m;
  };

  const BOARD_Y = 7.5;

  // board: index 4 is the front (+z) face
  put(new THREE.BoxGeometry(W, H, 0.3), [steel, steel, steel, steel, faceMat, steel], 0, BOARD_Y, 0);

  // orange frame
  const frame = makeMaterial(0xff8a2b, 0.5);
  put(new THREE.BoxGeometry(W + 0.5, 0.25, 0.45), frame, 0, BOARD_Y + H / 2 + 0.12, 0);
  put(new THREE.BoxGeometry(W + 0.5, 0.25, 0.45), frame, 0, BOARD_Y - H / 2 - 0.12, 0);
  for (const s of [-1, 1]) {
    put(new THREE.BoxGeometry(0.25, H, 0.45), frame, s * (W / 2 + 0.12), BOARD_Y, 0);
  }

  // posts + concrete footings
  const concrete = makeMaterial(0xb8b6ae, 0.9);
  for (const s of [-1, 1]) {
    put(new THREE.CylinderGeometry(0.22, 0.26, 7.4, 10), steel, s * 3.9, 3.7, -0.45);
    put(new THREE.BoxGeometry(1.3, 0.5, 1.3), concrete, s * 3.9, 0.25, -0.45);
  }
  put(new THREE.BoxGeometry(8.4, 0.2, 0.2), steel, 0, 5.4, -0.3);

  // spot lamps on top, shining down on the board
  const lampMat = makeMaterial(0xfff1c2, 0.3, { emissive: 0xffe9a8, emissiveIntensity: 0.9 });
  for (const x of [-3.5, 0, 3.5]) {
    put(new THREE.BoxGeometry(0.1, 0.1, 0.8), steel, x, BOARD_Y + H / 2 + 0.35, 0.35);
    put(new THREE.BoxGeometry(0.55, 0.22, 0.4), lampMat, x, BOARD_Y + H / 2 + 0.32, 0.8);
  }

  // Stands on the lawn between the main road and the SUIIT road, turned a
  // little towards the menu camera so the lettering reads from far away.
  g.position.set(16, 0, 18);
  g.rotation.y = -0.15;

  scene.add(g);
  decorations.push(g);
  return g;
}

function buildDistantHills() {
  for (let i = 0; i < 14; i++) {
    const hill = addMesh(
      scene,
      new THREE.SphereGeometry(1, 8, 6),
      makeMaterial(choose([0x78a979, 0x669b70, 0x8dbb88])),
      [
        random(-105, 105),
        random(3, 8),
        random(-180, -85)
      ],
      { scale: [random(9, 20), random(5, 12), random(12, 24)], castShadow: false }
    );
    decorations.push(hill);
  }
}

// ------------------------------------------------------------
// SECURITY GUARDS
// ------------------------------------------------------------

function createSecurityGuard(parent, x, z) {
  const guard = new THREE.Group();
  guard.position.set(x, 0, z);

  const uniform = makeMaterial(0x354f43);
  const skin = makeMaterial(0xb77d59);
  const dark = makeMaterial(0x202a2b);

  addMesh(
    guard,
    new THREE.CapsuleGeometry(0.25, 0.42, 3, 8),
    uniform,
    [0, 1.15, 0]
  );

  addMesh(
    guard,
    new THREE.SphereGeometry(0.19, 12, 10),
    skin,
    [0, 1.72, 0]
  );

  // Cap
  addMesh(
    guard,
    new THREE.CylinderGeometry(0.21, 0.21, 0.1, 12),
    dark,
    [0, 1.91, 0]
  );

  addBox(
    guard,
    [0, 1.32, 0.25],
    [0.1, 0.16, 0.035],
    materials.gold
  );

  for (const side of [-1, 1]) {
    addMesh(
      guard,
      new THREE.CapsuleGeometry(0.065, 0.28, 3, 6),
      uniform,
      [side * 0.3, 1.1, 0]
    );

    addMesh(
      guard,
      new THREE.CapsuleGeometry(0.085, 0.32, 3, 6),
      dark,
      [side * 0.13, 0.43, 0]
    );
  }

  parent.add(guard);
  return guard;
}

// ------------------------------------------------------------
// OBSTACLES AND COLLECTIBLES
// ------------------------------------------------------------

function createBarrier(laneIndex, z) {
  const group = new THREE.Group();
  group.position.set(LANES[laneIndex], 0, z);

  addBox(group, [0, 0.65, 0], [1.9, 0.95, 0.42], materials.red);

  for (let x = -0.6; x <= 0.61; x += 0.6) {
    addBox(
      group,
      [x, 0.65, 0.225],
      [0.3, 0.94, 0.03],
      materials.barrierWhite,
      { rotation: [0, 0, -0.3] }
    );
  }

  addBox(group, [-0.65, 0.15, 0], [0.12, 0.3, 0.55], materials.black);
  addBox(group, [0.65, 0.15, 0], [0.12, 0.3, 0.55], materials.black);

  scene.add(group);

  const item = {
    group,
    lane: laneIndex,
    z,
    type: 'barrier',
    passed: false
  };

  obstacles.push(item);
  return item;
}

function createCrate(laneIndex, z) {
  const group = new THREE.Group();
  group.position.set(LANES[laneIndex], 0, z);

  const crateMaterial = makeMaterial(0x98653a);
  addBox(group, [0, 0.7, 0], [1.35, 1.4, 1.05], crateMaterial);
  addBox(group, [0, 0.7, 0.54], [1.15, 0.12, 0.05], materials.gold);
  addBox(group, [0, 0.7, -0.54], [1.15, 0.12, 0.05], materials.gold);

  scene.add(group);

  const item = {
    group,
    lane: laneIndex,
    z,
    type: 'crate',
    passed: false
  };

  obstacles.push(item);
  return item;
}

// High bar on two posts: you must SLIDE under it. Jumping does not help.
function createOverhead(laneIndex, z) {
  const group = new THREE.Group();
  group.position.set(LANES[laneIndex], 0, z);

  const postMat = materials.black;
  for (const x of [-0.85, 0.85]) {
    addBox(group, [x, 0.9, 0], [0.14, 1.8, 0.14], postMat);
  }

  // Bar bottom sits at y = 1.3, so a standing runner hits it
  addBox(group, [0, 1.55, 0], [1.9, 0.5, 0.3], materials.red);
  for (let x = -0.6; x <= 0.61; x += 0.6) {
    addBox(
      group,
      [x, 1.55, 0.16],
      [0.3, 0.46, 0.03],
      materials.barrierWhite,
      { rotation: [0, 0, -0.3] }
    );
  }

  scene.add(group);

  const item = {
    group,
    lane: laneIndex,
    z,
    type: 'overhead',
    passed: false
  };

  obstacles.push(item);
  return item;
}

function createCoin(laneIndex, z, y = 1.25) {
  const group = new THREE.Group();
  group.position.set(LANES[laneIndex], y, z);

  // The spinner turns around the vertical axis, like a real coin on its edge.
  const coin = new THREE.Group();
  coin.rotation.y = Math.random() * Math.PI * 2;
  group.add(coin);

  // Disc body (cylinder axis turned to z so the faces look along the road)
  const body = new THREE.Mesh(coinBodyGeo, materials.gold);
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  coin.add(body);

  // Raised rim + stamped face on both sides
  for (const side of [1, -1]) {
    const ring = new THREE.Mesh(coinRingGeo, materials.gold);
    ring.position.z = side * 0.04;
    ring.castShadow = true;
    coin.add(ring);

    const face = new THREE.Mesh(coinFaceGeo, materials.coinFace);
    face.position.z = side * 0.0415;
    if (side < 0) face.rotation.y = Math.PI;
    coin.add(face);
  }

  scene.add(group);

  coins.push({
    group,
    coin,
    lane: laneIndex,
    z,
    baseY: y,
    collected: false
  });
}

// Regular waves spawn at SPAWN_Z (107 units ahead of the runner's start).
// baseZ lets the same patterns be placed anywhere on the road.
function spawnObstacleWave(baseZ = SPAWN_Z) {
  const first = Math.floor(trackRng() * 3);
  const pattern = trackRng();

  if (pattern < 0.22) {
    // low barrier: jump over it
    createBarrier(first, baseZ);
    createCoin((first + 1) % 3, baseZ + 1, 1.2);
  } else if (pattern < 0.42) {
    // crate: jump over it
    createCrate(first, baseZ);
    createCoin((first + 2) % 3, baseZ + 1, 1.2);
  } else if (pattern < 0.58) {
    // overhead bar: slide under it
    createOverhead(first, baseZ);
    createCoin((first + 1) % 3, baseZ + 1, 1.2);
  } else if (pattern < 0.77) {
    const second = (first + 1) % 3;
    createBarrier(first, baseZ);
    createBarrier(second, baseZ);
    createCoin((first + 2) % 3, baseZ + 1, 1.2);
  } else {
    for (let i = 0; i < 6; i++) {
      createCoin(first, baseZ - i * 2.6, 1.2 + Math.sin(i * 0.6) * 0.2);
    }
    createBarrier((first + 1) % 3, baseZ - 14);
  }
}

// Obstacles already on the road at GO, just beyond the gate, so there is
// something to dodge right after passing through it.
function spawnInitialObstacles() {
  const firstZ = GATE_Z - INITIAL_OBSTACLE_OFFSET;
  for (let z = firstZ; z >= SPAWN_Z + 15; z -= OBSTACLE_SPACING) {
    spawnObstacleWave(z);
  }
}

// ------------------------------------------------------------
// GAME FLOW
// ------------------------------------------------------------

function resetRace() {
  running = false;
  paused = false;
  raceStarted = false;
  raceFinished = false;

  lane = START_LANE;
  jumpVelocity = 0;
  isJumping = false;
  isSliding = false;
  slideUntil = 0;
  speed = START_SPEED;
  distance = 0;
  coinCount = 0;
  elapsed = 0;
  spawnTimer = OBSTACLE_SPACING;   // first wave spawns right at GO
  coinTimer = 0;
  hitCount = 0;
  invulnerableUntil = 0;
  shakeUntil = 0;

  // Same seed for both players in a multiplayer room
  resetTrackRng();

  for (const item of obstacles) { scene.remove(item.group); disposeObject(item.group); }
  for (const item of coins) { scene.remove(item.group); disposeObject(item.group); }

  obstacles = [];
  coins = [];

  for (const group of world) { scene.remove(group); disposeObject(group); }
  world = [];

  for (const item of decorations) { scene.remove(item); disposeObject(item); }
  decorations = [];

  createWorld();

  if (player) {
    player.position.set(LANES[START_LANE], 0, PLAYER_START_Z);
    player.rotation.set(0, Math.PI, 0);
    player.visible = true;
  }

  if (remotePlayer) {
    scene.remove(remotePlayer);
    remotePlayer = null;
  }

  // The camera is NOT teleported here. It glides on its own:
  // menu view -> pulled-back view behind the runner during the countdown ->
  // behind the runner at "GO" -> under the gate arch as the runner passes it.
  introBlend = 1;

  updateHUD();
}

function beginSolo() {
  gameMode = 'solo';
  roomCode = '';
  resetRace();
  startCountdown();
}

function startCountdown() {
  showScreen('game');
  ui.countdown?.classList.remove('hidden');

  let count = 3;
  if (ui.countdownNumber) ui.countdownNumber.textContent = String(count);

  const tick = () => {
    if (paused || raceFinished) return;

    if (count <= 0) {
      ui.countdown?.classList.add('hidden');
      running = true;
      raceStarted = true;
      clock.getDelta();
      spawnInitialObstacles();
      const best = loadBest();
      showToast(best > 0
        ? `GO! Best: ${best}. Jump low blocks, slide under high bars.`
        : 'GO! Jump low blocks, slide under high bars.');
      return;
    }

    if (ui.countdownNumber) {
      ui.countdownNumber.textContent = String(count);
    }

    count--;
    window.setTimeout(tick, 750);
  };

  window.setTimeout(tick, 250);
}

function beginMultiplayerRace() {
  resetRace();
  startCountdown();
}

function finishRace() {
  if (raceFinished) return;

  running = false;
  raceFinished = true;
  if (player) player.visible = true;

  if (gameMode === 'multi' && socket.connected && roomCode) {
    socket.emit('race:finished', {
      roomCode,
      distance: Math.floor(distance),
      coins: coinCount
    });
  }

  ui.finalDistance && (ui.finalDistance.textContent = String(Math.floor(distance)));
  ui.finalCoins && (ui.finalCoins.textContent = String(coinCount));

  const finalScore = Math.floor(distance);
  const previousBest = loadBest();
  if (finalScore > previousBest) {
    saveBest(finalScore);
    showBestLine(`New best: ${finalScore}!`);
  } else {
    showBestLine(`Best: ${previousBest}`);
  }

  ui.hud?.classList.add('hidden');
  ui.over?.classList.remove('hidden');
}

function pauseGame() {
  if (!running || paused) return;

  paused = true;
  running = false;
  ui.pause?.classList.remove('hidden');
}

function resumeGame() {
  if (!paused || raceFinished) return;

  paused = false;
  running = true;
  ui.pause?.classList.add('hidden');
  clock.getDelta();
}

function quitRun() {
  running = false;
  paused = false;
  raceStarted = false;

  ui.pause?.classList.add('hidden');
  ui.countdown?.classList.add('hidden');
  ui.hud?.classList.add('hidden');
  ui.over?.classList.add('hidden');

  if (gameMode === 'multi' && roomCode) {
    socket.emit('room:leave');
  }

  roomCode = '';
  isHost = false;

  // Rebuild the start scene so the menu shows the gate, road and SUIIT again
  resetRace();
  showScreen('home');
}

function updateHUD() {
  if (ui.distance) ui.distance.textContent = String(Math.floor(distance));
  if (ui.coins) ui.coins.textContent = String(coinCount);
}

// ------------------------------------------------------------
// MOVEMENT AND COLLISIONS
// ------------------------------------------------------------

function getGate() {
  return decorations.find((d) => d.userData?.isGate) || null;
}

// True while the runner is approaching / passing through the gate.
// The runner is locked to the start lane so they always use the right arch.
function isInGateZone() {
  const gate = getGate();
  if (!gate || !player) return false;

  const d = player.position.z - gate.position.z; // > 0 = gate still ahead
  return d < GATE_LOCK_AHEAD && d > -GATE_LOCK_BEHIND;
}

function moveLane(direction) {
  if (!running || paused || raceFinished) return;
  if (isInGateZone()) return;

  lane = THREE.MathUtils.clamp(lane + direction, 0, 2);
}

function jump() {
  if (!running || paused || isJumping || raceFinished) return;

  isJumping = true;
  jumpVelocity = 9.2;
}

function slide() {
  if (!running || paused || raceFinished) return;

  isSliding = true;
  slideUntil = performance.now() + 680;
}

function updatePlayer(delta, time) {
  if (!player) return;

  if (isInGateZone()) lane = START_LANE;

  const targetX = LANES[lane];
  player.position.x = THREE.MathUtils.damp(
    player.position.x,
    targetX,
    13,
    delta
  );

  // Lean into lane changes
  player.rotation.z = THREE.MathUtils.damp(
    player.rotation.z,
    (targetX - player.position.x) * 0.09,
    10,
    delta
  );

  if (isJumping) {
    player.position.y += jumpVelocity * delta;
    jumpVelocity -= GRAVITY * delta;

    if (player.position.y <= 0) {
      player.position.y = 0;
      isJumping = false;
      jumpVelocity = 0;
    }
  }

  if (isSliding && performance.now() >= slideUntil) {
    isSliding = false;
  }

  // Blink while invulnerable after a hit
  const now = performance.now();
  player.visible = now >= invulnerableUntil || Math.floor(now / 90) % 2 === 0;

  animateRunner(player, time, true);
}

function updateWorld(delta) {
  const movement = speed * delta;

  for (let i = 0; i < world.length; i++) {
    const segment = world[i];
    segment.position.z += movement;

    if (segment.position.z > SEGMENT_WRAP_Z) {
      const newZ = segment.position.z - SEGMENT_LENGTH * SEGMENT_COUNT;

      if (segment.userData.plaza) {
        // The outside-the-gate plaza turns into a normal campus segment
        // when it recycles to the far end of the road.
        scene.remove(segment);
        disposeObject(segment);
        world[i] = createCampusSegment(newZ);
      } else {
        segment.position.z = newZ;
      }
    }
  }

  // Move the gate, the approach road and the SUIIT building with the
  // scrolling world. Remove them permanently once they are far behind.
  for (const item of [...decorations]) {
    if (!item.userData?.scroll) continue;

    item.position.z += movement;

    if (item.position.z > (item.userData.removeZ ?? 60)) {
      scene.remove(item);
      disposeObject(item);

      const index = decorations.indexOf(item);
      if (index !== -1) decorations.splice(index, 1);
    }
  }

  for (const obstacle of obstacles) {
    obstacle.z += movement;
    obstacle.group.position.z = obstacle.z;
  }

  for (const item of coins) {
    item.z += movement;
    item.group.position.z = item.z;
    item.coin.rotation.y += delta * 4.5;
    item.group.rotation.y = Math.sin(elapsed * 3 + item.z) * 0.16;
    item.group.position.y = item.baseY + Math.sin(elapsed * 3 + item.z * 0.4) * 0.07;
  }

  // Remove things once they are well behind the runner
  const cleanupZ = PLAYER_START_Z + 13;

  obstacles = obstacles.filter((item) => {
    if (item.z > cleanupZ) {
      scene.remove(item.group);
      disposeObject(item.group);
      return false;
    }
    return true;
  });

  coins = coins.filter((item) => {
    if (item.z > cleanupZ || item.collected) {
      scene.remove(item.group);
      disposeObject(item.group);
      return false;
    }
    return true;
  });
}

function checkCollisions() {
  if (!player || performance.now() < invulnerableUntil) return;

  for (const obstacle of obstacles) {
    if (obstacle.passed) continue;

    if (Math.abs(obstacle.z - player.position.z) > 1.2) continue;
    if (Math.abs(player.position.x - LANES[obstacle.lane]) > 1.2) continue;

    if (obstacle.type === 'overhead') {
      // High bar: only sliding gets under it (jumping does not help).
      if (isSliding) {
        obstacle.passed = true;
        continue;
      }
    } else {
      // Low barrier (0.95 tall) or crate (1.4 tall): jump over it.
      // Sliding no longer passes them.
      const clearY = obstacle.type === 'crate' ? 1.25 : 0.9;
      if (isJumping && player.position.y > clearY) {
        obstacle.passed = true;
        continue;
      }
    }

    obstacle.passed = true;
    hitCount++;
    invulnerableUntil = performance.now() + 1100;
    shakeUntil = performance.now() + HIT_SHAKE_MS;
    speed = Math.max(START_SPEED * 0.72, speed - 2.5);

    showToast(hitCount >= 3
      ? 'Too many collisions! Run over.'
      : 'Collision! Watch the road.');

    if (hitCount >= 3) finishRace();
    break;
  }

  for (const item of coins) {
    if (item.collected) continue;

    const nearZ = Math.abs(item.z - player.position.z) < 1.5;
    const nearX = Math.abs(player.position.x - LANES[item.lane]) < 1.15;
    const nearY = Math.abs(player.position.y + 1.0 - item.group.position.y) < 1.8;

    if (nearZ && nearX && nearY) {
      item.collected = true;
      coinCount++;
      updateHUD();
    }
  }
}

// ------------------------------------------------------------
// CAMERA AND GAME LOOP
// ------------------------------------------------------------

function smoothRange(from, to, x) {
  const t = THREE.MathUtils.clamp((x - from) / (to - from), 0, 1);
  return t * t * (3 - 2 * t);
}

function updateCamera(delta) {
  if (!player) return;

  const now = performance.now();
  const timeSec = now / 1000;

  // menuBlend: 1 on the login / home / character-select / room screens
  // (camera looks at the main gate + SUIIT), 0 while playing.
  const inMenu = currentScreen !== 'game';
  menuBlend = THREE.MathUtils.damp(menuBlend, inMenu ? 1 : 0, 2.2, delta);

  // introBlend: 1 before "GO" (camera pulled back), 0 once running.
  introBlend = THREE.MathUtils.damp(introBlend, raceStarted ? 0 : 1, 2.6, delta);

  // gateBlend: 0..1 while the camera approaches and passes through the gate.
  // The camera lines up with the runner and dips under the arch beam.
  const gate = getGate();
  let gateBlend = 0;
  if (gate) {
    const dist = camera.position.z - gate.position.z;
    gateBlend = smoothRange(18, 9, dist) * (1 - smoothRange(-3, -9, dist));
  }

  const introFollow = 0.22 + 0.78 * Math.min(1, introBlend * 4);
  const follow = THREE.MathUtils.lerp(introFollow, 1, gateBlend);

  _camTarget.set(
    player.position.x * follow,
    THREE.MathUtils.lerp(4.4, GATE_CAM_HEIGHT, gateBlend)
      + player.position.y * 0.07 + introBlend * INTRO_UP,
    player.position.z + CAM_BACK + introBlend * INTRO_BACK
  );

  getMenuCameraPose(timeSec, _menuTarget, _lookMenu);
  _camTarget.lerp(_menuTarget, menuBlend);

  // Slower follow = steadier picture
  camera.position.lerp(_camTarget, 1 - Math.exp(-delta * 2.6));

  // Very subtle motion while running
  if (running) {
    camera.position.y += Math.sin(now * 0.008) * CAMERA_BOB;
  }

  // Short, gentle shake after a collision
  if (now < shakeUntil) {
    const k = (shakeUntil - now) / HIT_SHAKE_MS;
    camera.position.x += (Math.random() - 0.5) * HIT_SHAKE * k;
    camera.position.y += (Math.random() - 0.5) * HIT_SHAKE * k;
  }

  // Field of view widens a little with speed. A little wider on portrait
  // screens in the menu so the gate and SUIIT both fit.
  const aspect = window.innerWidth / Math.max(1, window.innerHeight);
  const baseFov = window.innerWidth < 700 ? 68 : 62;
  const menuExtra = aspect < 1 ? 6 * menuBlend : 0;
  const targetFov = baseFov + menuExtra + (running ? (speed - START_SPEED) * 0.3 : 0);
  camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 4, delta);
  camera.updateProjectionMatrix();

  // Where the camera looks. Before GO it frames the runner from further back;
  // while running it looks down the road; at the gate it looks straight
  // through the arch; in the menus it looks at gate + SUIIT.
  const lookX = THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(player.position.x * 0.25, GATE_OFFSET_X * 0.8, introBlend),
    player.position.x,
    gateBlend
  );

  _lookGame.set(
    lookX,
    1.1 + player.position.y * 0.12 + introBlend * 1.0 + gateBlend * 0.7,
    player.position.z - 9 - introBlend * 12
  );
  _lookGame.lerp(_lookMenu, menuBlend);

  // Smooth the look target too, so lane changes never jerk the picture
  _lookCur.lerp(_lookGame, 1 - Math.exp(-delta * 6));
  camera.lookAt(_lookCur);

  // Keep the sky dome centred on the camera
  if (skyMesh) skyMesh.position.copy(camera.position);
}

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.04);
  const time = performance.now() / 1000;

  if (running && !paused && raceStarted && !raceFinished) {
    elapsed += delta;
    distance += speed * delta * SCORE_RATE;
    speed = Math.min(MAX_SPEED, START_SPEED + distance * SPEED_RAMP);

    updatePlayer(delta, time);
    updateWorld(delta);
    updateDust(delta);
    checkCollisions();

    // Obstacle waves are spaced by distance travelled, so the slower speed
    // doesn't pack them tighter.
    spawnTimer += speed * delta;
    if (spawnTimer > Math.max(OBSTACLE_SPACING_MIN, OBSTACLE_SPACING - distance * 0.008)) {
      spawnTimer = 0;
      spawnObstacleWave();
    }

    coinTimer += speed * delta;
    if (coinTimer > COIN_SPACING) {
      coinTimer = 0;
      createCoin(Math.floor(trackRng() * 3), SPAWN_Z, trackRandom(1.1, 1.8));
    }

    updateCamera(delta);
    updateHUD();

    if (gameMode === 'multi' && socket.connected && roomCode) {
      if (performance.now() - lastNetworkUpdate > 100) {
        lastNetworkUpdate = performance.now();

        socket.emit('player:update', {
          roomCode,
          lane,
          distance: Math.floor(distance),
          coins: coinCount,
          character: selectedCharacter
        });
      }
    }

    if (distance >= MAX_DISTANCE) finishRace();
  } else {
    if (player && !isJumping) {
      animateRunner(player, time, false);
    }
    updateCamera(delta);
  }

  if (remotePlayer) {
    animateRunner(remotePlayer, time, true);
  }

  // Flickering flame on the gate monument
  if (gateFlame) {
    gateFlame.scale.set(
      1 + Math.sin(time * 11) * 0.06,
      1 + Math.sin(time * 7.3) * 0.12,
      1 + Math.sin(time * 9) * 0.06
    );
  }

  hideToast();

  if (renderer && scene && camera) {
    renderer.render(scene, camera);
  }
}

// ------------------------------------------------------------
// MULTIPLAYER
// ------------------------------------------------------------

function openRoomScreen() {
  gameMode = 'multi';
  roomCode = '';
  isHost = false;

  ui.roomError && (ui.roomError.textContent = '');
  ui.roomLobby?.classList.add('hidden');

  showScreen('room');

  if (!socket.connected) {
    setConnection('Connecting...');
    socket.connect();
  }
}

function renderRoomState(state) {
  if (!state || !state.players) return;

  if (state.roomCode) {
    roomCode = state.roomCode;
  }

  if (ui.roomCodeDisplay) {
    ui.roomCodeDisplay.textContent = roomCode || '-----';
  }

  ui.roomLobby?.classList.remove('hidden');

  if (ui.playerList) {
    ui.playerList.replaceChildren();

    for (const person of state.players) {
      const li = document.createElement('li');
      li.textContent = `${person.name}${person.id === state.hostId ? ' (Host)' : ''}`;
      ui.playerList.appendChild(li);
    }
  }

  isHost = state.hostId === socket.id;

  if (ui.startRace) {
    ui.startRace.disabled = !isHost || state.players.length !== 2 || state.started;
    ui.startRace.textContent = state.started ? 'RACE STARTED' : 'START RACE';
  }

  if (ui.lobbyMessage) {
    ui.lobbyMessage.textContent = state.players.length < 2
      ? 'Share the room code with a friend. Waiting for player 2...'
      : 'Two runners are ready. The host can start the race!';
  }
}

function showRoomError(message) {
  if (ui.roomError) ui.roomError.textContent = message || 'Something went wrong.';
}

function syncRemotePlayers(players) {
  if (!Array.isArray(players)) return;

  const other = players.find((p) => p.id !== socket.id);

  if (!other) {
    if (remotePlayer) scene.remove(remotePlayer);
    remotePlayer = null;
    return;
  }

  if (!remotePlayer || remotePlayer.userData.characterName !== other.character) {
    if (remotePlayer) scene.remove(remotePlayer);

    remotePlayer = createCharacter(
      other.character,
      other.character === 'Swastik' ? COLORS.orange : COLORS.blue
    );

    remotePlayer.scale.setScalar(0.92);
    scene.add(remotePlayer);
  }

  remotePlayer.position.x = LANES[THREE.MathUtils.clamp(other.lane, 0, 2)];
  remotePlayer.position.z = PLAYER_START_Z - 3.5;
  remotePlayer.position.y = 0;
}

socket.on('connect', () => {
  setConnection('Online');
});

socket.on('disconnect', () => {
  setConnection('Offline mode');

  if (gameMode === 'multi' && roomCode && !raceFinished) {
    showToast('Connection lost. Multiplayer may be interrupted.');
  }
});

socket.on('connect_error', () => {
  setConnection('Offline mode');
});

socket.on('room:created', (data) => {
  roomCode = data.roomCode;
  isHost = true;

  if (ui.roomCodeDisplay) ui.roomCodeDisplay.textContent = roomCode;
  ui.roomLobby?.classList.remove('hidden');
  showRoomError('');
});

socket.on('room:joined', (data) => {
  roomCode = data.roomCode;
  isHost = false;

  if (ui.roomCodeDisplay) ui.roomCodeDisplay.textContent = roomCode;
  ui.roomLobby?.classList.remove('hidden');
  showRoomError('');
});

socket.on('room:state', (state) => {
  if (state.roomCode && roomCode && state.roomCode !== roomCode) return;
  renderRoomState(state);
});

socket.on('room:error', (data) => {
  showRoomError(data?.message || 'Multiplayer error.');
});

socket.on('room:player-left', () => {
  showToast('The other player left the room.');
});

socket.on('race:started', () => {
  gameMode = 'multi';
  beginMultiplayerRace();
});

socket.on('race:state', (state) => {
  syncRemotePlayers(state?.players);
});

// ------------------------------------------------------------
// UI EVENT HANDLERS
// ------------------------------------------------------------

ui.loginForm?.addEventListener('submit', (event) => {
  event.preventDefault();

  const name = ui.playerName?.value?.trim() || '';

  if (name.length < 2 || name.length > 18) {
    if (ui.loginError) {
      ui.loginError.textContent = 'Please enter a name between 2 and 18 characters.';
    }
    return;
  }

  if (!/^[\p{L}\p{N} _.-]+$/u.test(name)) {
    if (ui.loginError) {
      ui.loginError.textContent = 'Use letters, numbers, spaces, dots or hyphens.';
    }
    return;
  }

  playerName = name;
  if (ui.welcomeName) ui.welcomeName.textContent = playerName;

  if (ui.loginError) ui.loginError.textContent = '';
  showScreen('home');
});

document.querySelectorAll('.character-option').forEach((button) => {
  button.addEventListener('click', () => {
    selectedCharacter = button.dataset.character === 'Swastik'
      ? 'Swastik'
      : 'Smruti';

    document.querySelectorAll('.character-option').forEach((option) => {
      option.classList.toggle('selected', option === button);
    });

    replacePlayerCharacter();
  });
});

ui.solo?.addEventListener('click', beginSolo);
ui.multiplayer?.addEventListener('click', openRoomScreen);

ui.backHome?.addEventListener('click', () => {
  if (roomCode) socket.emit('room:leave');
  roomCode = '';
  showScreen('home');
});

ui.changeName?.addEventListener('click', () => {
  running = false;
  paused = false;
  showScreen('login');
});

ui.createRoom?.addEventListener('click', () => {
  if (!socket.connected) socket.connect();

  socket.emit('room:create', {
    name: playerName,
    character: selectedCharacter
  });
});

ui.joinForm?.addEventListener('submit', (event) => {
  event.preventDefault();

  const code = ui.roomInput?.value?.trim().toUpperCase() || '';

  if (code.length !== 5) {
    showRoomError('Enter the five-character room code.');
    return;
  }

  if (!socket.connected) socket.connect();

  socket.emit('room:join', {
    roomCode: code,
    name: playerName,
    character: selectedCharacter
  });
});

ui.copyRoom?.addEventListener('click', async () => {
  if (!roomCode) return;

  try {
    await navigator.clipboard.writeText(roomCode);
    showToast('Room code copied!');
  } catch {
    showToast(`Room code: ${roomCode}`);
  }
});

ui.startRace?.addEventListener('click', () => {
  if (!roomCode || !isHost) {
    showRoomError('Only the room host can start the race.');
    return;
  }

  socket.emit('race:start', {
    roomCode,
    character: selectedCharacter
  });
});

ui.pauseButton?.addEventListener('click', pauseGame);
ui.resume?.addEventListener('click', resumeGame);
ui.quit?.addEventListener('click', quitRun);

ui.retry?.addEventListener('click', () => {
  if (gameMode === 'multi') {
    showToast('Return to the lobby to start another multiplayer race.');
    quitRun();
  } else {
    beginSolo();
  }
});

ui.menu?.addEventListener('click', quitRun);

// Keyboard controls
window.addEventListener('keydown', (event) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(event.key)) {
    event.preventDefault();
  }

  if (heldKeys.has(event.key)) return;
  heldKeys.add(event.key);

  if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
    moveLane(-1);
  }

  if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
    moveLane(1);
  }

  if (event.key === 'ArrowUp' || event.key === ' ' || event.key.toLowerCase() === 'w') {
    jump();
  }

  if (event.key === 'ArrowDown' || event.key.toLowerCase() === 's') {
    slide();
  }

  if (event.key === 'Escape') {
    if (paused) resumeGame();
    else pauseGame();
  }
});

window.addEventListener('keyup', (event) => {
  heldKeys.delete(event.key);
});

// Pause automatically when the tab is hidden so you don't crash unseen
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseGame();
});

// The on-screen control buttons (left / right / jump / slide) were removed.
// Controls: keyboard (arrows / WASD / space) and swipe on touch screens.

// Swipe controls
// (touchstart is bound on window: the renderer doesn't exist yet at this point in the file)
let touchStartX = 0;
let touchStartY = 0;

window.addEventListener('touchstart', (event) => {
  const touch = event.changedTouches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}, { passive: true });

window.addEventListener('touchend', (event) => {
  if (currentScreen !== 'game' || !running) return;

  const touch = event.changedTouches[0];
  const dx = touch.clientX - touchStartX;
  const dy = touch.clientY - touchStartY;

  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 35) {
    moveLane(dx > 0 ? 1 : -1);
  } else if (Math.abs(dy) > 35) {
    if (dy < 0) jump();
    else slide();
  }
}, { passive: true });

// ------------------------------------------------------------
// START APPLICATION
// ------------------------------------------------------------

function startApp() {
  // Remove the control-button bar from the page completely
  ui.mobile?.remove();

  initThree();

  showScreen('login');
  setConnection('Offline mode');

  animate();
}

startApp();