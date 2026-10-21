
import * as THREE from 'three';
import { io } from 'socket.io-client';
import './style.css';

// ============================================================
// SAMBALPUR CAMPUS RUN 3D — ENHANCED CAMPUS EDITION
// ============================================================

const $ = (id) => document.getElementById(id);
const socket = io({ autoConnect: false, reconnection: true });

const ROAD_WIDTH = 9.5;
const ROAD_LENGTH = 30;
const CAMPUS_GAP = 27;
const LANE_WIDTH = 2.3;
const START_SPEED = 15;
const MAX_HITS = 2;

let playerName = '';
let character = 'Smruti';
let roomCode = '';
let mode = 'solo';
let isHost = false;
let running = false;
let paused = false;
let raceStarted = false;

let distance = 0;
let coins = 0;
let speed = START_SPEED;
let lane = 1;
let hits = 0;
let scoreMultiplier = 1;
let boostUntil = 0;
let jumpUntil = 0;
let slideUntil = 0;
let lastTime = 0;
let lastSync = 0;
let toastTimer;
let countdownTimer;

const roadSegments = [];
const campusSegments = [];
const obstacles = [];
const pickups = [];
const remoteRunners = new Map();

let universityGate;
let player;

// ============================================================
// SCENE, CAMERA AND LIGHTING
// ============================================================

const scene = new THREE.Scene();
scene.background = new THREE.Color('#b8d2e0');
scene.fog = new THREE.Fog('#b8d2e0', 65, 190);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  300
);
camera.position.set(0, 5.2, 10);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: false
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

$('game-canvas').appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x4a5439, 2.1));

const sun = new THREE.DirectionalLight(0xffe9c7, 3);
sun.position.set(-12, 25, 10);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -30;
sun.shadow.camera.right = 30;
sun.shadow.camera.top = 35;
sun.shadow.camera.bottom = -35;
scene.add(sun);

// ============================================================
// MATERIALS AND REUSABLE GEOMETRIES
// ============================================================

const mat = (color, roughness = 0.8, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

const materials = {
  grass: mat('#547b43'),
  grassLight: mat('#6d914e'),
  road: mat('#343a42'),
  pavement: mat('#aaa99f'),
  white: mat('#f5f0e5'),
  tree: mat('#27633c'),
  treeLight: mat('#397b45'),
  treeBright: mat('#4a8c4a'),
  trunk: mat('#765039'),
  branch: mat('#65432e'),
  wall: mat('#e4d9c5'),
  roof: mat('#a65f46'),
  glass: mat('#6d9faf', 0.25, 0.2),
  gold: mat('#ffd45e', 0.3, 0.45),
  iron: mat('#202a2a', 0.45, 0.6),
  brick: mat('#a9513c'),
  flowerPink: mat('#ed7795'),
  flowerYellow: mat('#f3ce57'),
  flowerWhite: mat('#fff0dc'),
  sign: mat('#204d3a'),
  signBorder: mat('#d8b96d', 0.45, 0.2),
  lampPost: mat('#343b40', 0.45, 0.5),
  bench: mat('#795139')
};

const trunkGeometry = new THREE.CylinderGeometry(0.17, 0.28, 2.4, 8);
const branchGeometry = new THREE.CylinderGeometry(0.055, 0.09, 1.1, 6);
const foliageGeometry = new THREE.IcosahedronGeometry(0.9, 1);
const smallFoliageGeometry = new THREE.IcosahedronGeometry(0.62, 1);
const flowerGeometry = new THREE.SphereGeometry(0.11, 7, 6);
const lampGlowMaterial = new THREE.MeshBasicMaterial({ color: '#fff2bf' });

function addBox(parent, w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    material
  );
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addText(text, width, color, x, y, z, parent) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 180;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 1024, 180);
  ctx.font = 'bold 70px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 4;
  ctx.fillText(text, 512, 90, 970);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, width * 0.176),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      side: THREE.DoubleSide
    })
  );

  mesh.position.set(x, y, z);
  parent.add(mesh);
  return mesh;
}

function makeArch(parent, points, radius, material) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, y, z]) => new THREE.Vector3(x, y, z))
  );

  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 56, radius, 10, false),
    material
  );

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

// ============================================================
// UNIVERSITY ENTRANCE GATE
// ============================================================

function buildUniversityGate() {
  universityGate = new THREE.Group();

  // Offset aligns the side-gate opening with the running road.
  universityGate.position.set(3.9, 0, -30);

  const concrete = mat('#e6e1d6');
  const concreteShade = mat('#c8c6bd');
  const plaque = mat('#783d31');
  const darkGlass = mat('#263b43', 0.25, 0.2);
  const lightBrick = mat('#bb674f');

  addBox(
    universityGate, 5.2, 8.2, 1.05,
    materials.brick, 0, 4.1, 0
  );

  for (let row = 0; row < 9; row++) {
    for (let col = 0; col < 4; col++) {
      addBox(
        universityGate, 1.12, 0.035, 0.035,
        lightBrick,
        -1.75 + col * 1.17,
        0.8 + row * 0.78,
        0.55
      );
    }
  }

  for (const x of [-2.75, 2.75]) {
    addBox(
      universityGate, 0.22, 8.6, 1.25,
      concrete, x, 4.3, 0.02
    );
  }

  addBox(
    universityGate, 3.6, 2.05, 0.08,
    darkGlass, 0, 7.1, 0.57
  );

  for (let x = -1.3; x <= 1.31; x += 0.65) {
    addBox(
      universityGate, 0.035, 2, 0.04,
      concrete, x, 7.1, 0.63
    );
  }

  makeArch(universityGate, [
    [-10.5, 2.7, 0.15],
    [-8, 2.7, 0.15],
    [-6, 3, 0.15],
    [-4.5, 4, 0.15],
    [-3, 5.7, 0.15],
    [-1.8, 7.5, 0.15],
    [-0.5, 8.9, 0.15],
    [1.2, 9, 0.15],
    [3.3, 7.7, 0.15],
    [5, 6, 0.15],
    [6.2, 4.4, 0.15],
    [8, 3, 0.15],
    [10.5, 2.7, 0.15]
  ], 0.28, concrete);

  makeArch(universityGate, [
    [-10.5, 2.3, 0.35],
    [-8, 2.35, 0.35],
    [-5.8, 2.65, 0.35],
    [-4, 3.7, 0.35],
    [-2.5, 5.5, 0.35],
    [-1.2, 7.5, 0.35],
    [0.2, 8.4, 0.35],
    [2, 7.9, 0.35],
    [3.8, 6.2, 0.35],
    [5.6, 4.3, 0.35],
    [7.6, 2.8, 0.35],
    [10.5, 2.3, 0.35]
  ], 0.13, concreteShade);

  for (const side of [-1, 1]) {
    addBox(
      universityGate, 0.32, 3, 0.8,
      concrete, side * 9.6, 1.5, 0
    );

    addBox(
      universityGate, 0.28, 2.8, 0.7,
      concrete, side * 5, 1.4, 0
    );
  }

  // Metal sections leave the central-side entrance gap open.
  for (const side of [-1, 1]) {
    const centerX = side * 7.25;

    for (const y of [0.35, 1.05, 1.8, 2.45]) {
      addBox(
        universityGate, 4.1, 0.09, 0.13,
        materials.iron, centerX, y, 0.45
      );
    }

    for (let i = 0; i <= 12; i++) {
      const x = side * (5.25 + i * 0.335);

      addBox(
        universityGate, 0.075, 2.5, 0.12,
        materials.iron, x, 1.35, 0.45
      );

      const finial = new THREE.Mesh(
        new THREE.ConeGeometry(0.075, 0.18, 5),
        materials.gold
      );

      finial.position.set(x, 2.72, 0.45);
      universityGate.add(finial);
    }
  }

  addBox(
    universityGate, 3.7, 1, 0.12,
    plaque, 0, 4, 0.63
  );

  addText(
    'SAMBALPUR UNIVERSITY',
    3.45, '#fff6e5', 0, 4.18, 0.71, universityGate
  );

  addText(
    'JYOTI VIHAR • ODISHA',
    2.25, '#fff6e5', 0, 3.78, 0.71, universityGate
  );

  addBox(
    universityGate, 1.15, 1.05, 0.12,
    concrete, 0, 1.75, 0.62
  );

  addBox(
    universityGate, 0.88, 0.78, 0.06,
    darkGlass, 0, 1.78, 0.71
  );

  addBox(
    universityGate, 0.08, 0.78, 0.04,
    concrete, 0, 1.78, 0.75
  );

  addBox(
    universityGate, 0.88, 0.07, 0.04,
    concrete, 0, 1.78, 0.75
  );

  addBox(
    universityGate, 24, 0.08, 8,
    materials.pavement, 0, -0.13, 2
  );

  addBox(
    universityGate, 5.7, 0.16, 2,
    mat('#a6a08c'), 0, -0.03, 3.4
  );

  addBox(
    universityGate, 5.1, 0.1, 1.4,
    materials.grass, 0, 0.08, 3.4
  );

  scene.add(universityGate);
}

// ============================================================
// ROAD AND ROAD MARKINGS
// ============================================================

function createRoadSegment(z) {
  const group = new THREE.Group();
  group.position.z = z;

  addBox(
    group, 200, 0.2, ROAD_LENGTH,
    materials.grass, 0, -0.22, 0
  );

  addBox(
    group, ROAD_WIDTH + 3.5, 0.08, ROAD_LENGTH,
    materials.pavement, 0, -0.06, 0
  );

  addBox(
    group, ROAD_WIDTH, 0.12, ROAD_LENGTH,
    materials.road, 0, 0, 0
  );

  for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
    addBox(
      group, 0.07, 0.025, ROAD_LENGTH,
      materials.white, x, 0.075, 0
    );
  }

  for (const x of [
    -ROAD_WIDTH / 2 + 0.15,
    ROAD_WIDTH / 2 - 0.15
  ]) {
    addBox(
      group, 0.11, 0.03, ROAD_LENGTH,
      materials.white, x, 0.078, 0
    );
  }

  scene.add(group);
  roadSegments.push(group);
}

function buildRoad() {
  for (let i = 0; i < 9; i++) {
    createRoadSegment(-10 - i * ROAD_LENGTH);
  }
}

// ============================================================
// REALISTIC-STYLE TREES
// ============================================================

function createTree(parent, x, z, scale = 1, variant = 0) {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);

  // Main trunk.
  const trunk = new THREE.Mesh(trunkGeometry, materials.trunk);
  trunk.position.y = 1.2;
  trunk.castShadow = true;
  tree.add(trunk);

  // Visible branches.
  for (const side of [-1, 1]) {
    const branch = new THREE.Mesh(branchGeometry, materials.branch);
    branch.position.set(side * 0.34, 1.75, 0);
    branch.rotation.z = side * -0.65;
    branch.castShadow = true;
    tree.add(branch);
  }

  const foliageMaterials = [
    materials.tree,
    materials.treeLight,
    materials.treeBright
  ];

  const foliage = foliageMaterials[variant % foliageMaterials.length];

  // Broad, overlapping foliage creates a fuller tree crown.
  const crownPositions = [
    [0, 3.05, 0, 1.05],
    [-0.48, 3.2, 0.03, 0.78],
    [0.48, 3.35, -0.04, 0.82],
    [0.03, 3.75, 0.04, 0.82],
    [-0.2, 4.12, 0, 0.62]
  ];

  for (const [cx, cy, cz, size] of crownPositions) {
    const crown = new THREE.Mesh(
      size > 0.8 ? foliageGeometry : smallFoliageGeometry,
      foliage
    );

    crown.position.set(cx, cy, cz);
    crown.scale.set(1.05, 0.94, 0.96);
    crown.castShadow = true;
    crown.receiveShadow = true;
    tree.add(crown);
  }

  // A few lighter leaves add visual depth.
  const highlight = new THREE.Mesh(
    smallFoliageGeometry,
    materials.treeBright
  );
  highlight.scale.setScalar(0.52);
  highlight.position.set(0.48, 3.85, 0.23);
  highlight.castShadow = true;
  tree.add(highlight);

  parent.add(tree);
  return tree;
}

// ============================================================
// LANDSCAPING, FLOWER BEDS AND STREETLIGHTS
// ============================================================

function createFlowerBed(parent, x, z, seed = 0) {
  const bed = new THREE.Group();
  bed.position.set(x, 0, z);

  addBox(
    bed, 2.2, 0.16, 1.2,
    materials.grassLight, 0, 0.08, 0
  );

  const flowerMaterials = [
    materials.flowerPink,
    materials.flowerYellow,
    materials.flowerWhite
  ];

  for (let i = 0; i < 9; i++) {
    const flower = new THREE.Mesh(
      flowerGeometry,
      flowerMaterials[(i + seed) % flowerMaterials.length]
    );

    flower.position.set(
      -0.85 + (i % 3) * 0.82,
      0.28 + (i % 2) * 0.04,
      -0.35 + Math.floor(i / 3) * 0.34
    );

    flower.castShadow = true;
    bed.add(flower);
  }

  parent.add(bed);
}

function createStreetlight(parent, x, z) {
  const light = new THREE.Group();
  light.position.set(x, 0, z);

  const pole = addBox(
    light, 0.12, 4.3, 0.12,
    materials.lampPost, 0, 2.15, 0
  );

  pole.castShadow = true;

  addBox(
    light, 0.9, 0.1, 0.12,
    materials.lampPost, x < 0 ? 0.32 : -0.32, 4.25, 0
  );

  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 10, 8),
    lampGlowMaterial
  );

  bulb.position.set(x < 0 ? 0.65 : -0.65, 4.12, 0);
  light.add(bulb);

  parent.add(light);
}

function createBench(parent, x, z) {
  const bench = new THREE.Group();
  bench.position.set(x, 0, z);

  addBox(
    bench, 1.65, 0.13, 0.48,
    materials.bench, 0, 0.65, 0
  );

  addBox(
    bench, 1.65, 0.55, 0.12,
    materials.bench, 0, 1, -0.2
  );

  for (const legX of [-0.58, 0.58]) {
    addBox(
      bench, 0.12, 0.58, 0.12,
      materials.iron, legX, 0.32, 0
    );
  }

  parent.add(bench);
}

// ============================================================
// DEPARTMENT SIGNBOARDS
// ============================================================

function createDepartmentSign(parent, x, z, title, subtitle = 'SAMBALPUR UNIVERSITY') {
  const sign = new THREE.Group();
  sign.position.set(x, 0, z);

  // Two supports.
  for (const postX of [-1.35, 1.35]) {
    addBox(
      sign, 0.13, 2.45, 0.13,
      materials.trunk, postX, 1.22, 0
    );

    addBox(
      sign, 0.25, 0.12, 0.25,
      materials.pavement, postX, 0.08, 0
    );
  }

  // Sign frame and green board.
  addBox(
    sign, 3.05, 1.18, 0.16,
    materials.signBorder, 0, 2.05, 0.02
  );

  addBox(
    sign, 2.85, 0.98, 0.12,
    materials.sign, 0, 2.05, 0.12
  );

  addText(
    title, 2.72, '#fff5d9',
    0, 2.18, 0.2, sign
  );

  addText(
    subtitle, 2.58, '#f2d783',
    0, 1.86, 0.2, sign
  );

  parent.add(sign);
  return sign;
}

// ============================================================
// CAMPUS BUILDINGS
// ============================================================

function createBuilding(parent, x, z, name, labelColor = '#ffffff') {
  const building = new THREE.Group();
  building.position.set(x, 0, z);

  addBox(
    building, 7, 5.5, 9,
    materials.wall, 0, 2.75, 0
  );

  addBox(
    building, 7.5, 0.35, 9.5,
    materials.roof, 0, 5.55, 0
  );

  // Front windows.
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 3; col++) {
      addBox(
        building, 0.9, 1, 0.08,
        materials.glass,
        -2 + col * 2,
        1.7 + row * 1.8,
        4.56
      );
    }
  }

  // Side windows.
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 2; col++) {
      addBox(
        building, 0.08, 0.9, 1,
        materials.glass,
        3.56,
        1.7 + row * 1.8,
        -1.8 + col * 2.5
      );
    }
  }

  addBox(
    building, 7.1, 0.75, 0.12,
    mat('#28353b'), 0, 4.6, 4.7
  );

  addText(
    name, 4.5, labelColor,
    0, 4.62, 4.77, building
  );

  // Entrance steps.
  addBox(
    building, 2.5, 0.2, 1.2,
    materials.pavement, 0, 0.1, 5
  );

  addBox(
    building, 2.1, 0.18, 0.65,
    materials.pavement, 0, 0.25, 5.65
  );

  parent.add(building);
}

// ============================================================
// CAMPUS SEGMENTS
// ============================================================

const departments = [
  'BIOTECHNOLOGY',
  'PG COUNCIL',
  'COMPUTER SCIENCE',
  'HISTORY',
  'PHYSICS DEPARTMENT',
  'CHEMISTRY DEPARTMENT',
  'MATHEMATICS',
  'MANAGEMENT STUDIES',
  'CENTRAL LIBRARY',
  'ACADEMIC BLOCK',
  'ADMINISTRATION',
  'LIFE SCIENCES',
  'COMMERCE DEPARTMENT',
  'ENGLISH DEPARTMENT',
  'STUDENT CENTRE',
  'SUIIT'
];

function createCampusSegment(z, index) {
  const group = new THREE.Group();
  group.position.z = z;

  // Dense roadside trees, with irregular spacing and varied sizes.
  const treePositions = [
    [-8.2, -1, 0.9],
    [8.4, -3.5, 1.05],
    [-9.2, -8, 1.12],
    [9.1, -11, 0.92],
    [-8.1, -16, 0.95],
    [8.3, -19, 1.15],
    [-9.4, -24, 1.08],
    [9.2, -26, 0.9]
  ];

  treePositions.forEach(([x, treeZ, scale], i) => {
    createTree(group, x, treeZ, scale, (index + i) % 3);
  });

  // Two department buildings per campus section.
  const leftDepartment = departments[(index * 2) % departments.length];
  const rightDepartment = departments[
    (index * 2 + 1) % departments.length
  ];

  createBuilding(
    group, -14, -9, leftDepartment, '#fff6df'
  );

  createBuilding(
    group, 14, -21, rightDepartment, '#fff6df'
  );

  // Department signboards closer to the roadside.
  createDepartmentSign(
    group, -7.3, -7,
    leftDepartment
  );

  createDepartmentSign(
    group, 7.3, -20,
    rightDepartment
  );

  // Flower beds along the pedestrian edges.
  createFlowerBed(group, -6.4, -3.5, index);
  createFlowerBed(group, 6.4, -15, index + 1);
  createFlowerBed(group, -6.4, -24, index + 2);

  // Streetlights and campus benches.
  createStreetlight(group, -6.7, -11);
  createStreetlight(group, 6.7, -25);

  if (index % 2 === 0) {
    createBench(group, -6.6, -19);
  } else {
    createBench(group, 6.6, -8);
  }

  // Small information pillar at the campus entrance.
  addBox(
    group, 0.3, 1.7, 0.3,
    materials.signBorder, -5.9, 0.85, -3
  );

  addBox(
    group, 0.22, 1.4, 0.22,
    materials.sign, -5.9, 0.9, -3
  );

  scene.add(group);
  campusSegments.push(group);
}

function buildCampus() {
  for (let i = 0; i < 10; i++) {
    createCampusSegment(-45 - i * CAMPUS_GAP, i);
  }
}

// ============================================================
// RUNNER CHARACTERS
// ============================================================

function makeRunner(name, color) {
  const group = new THREE.Group();
  const outfit = mat(color);
  const dark = mat('#202b38');
  const skin = mat('#b77e5b');
  const shoes = mat('#e9edf0');

  addBox(
    group, 0.65, 0.85, 0.35,
    outfit, 0, 1.65, 0
  );

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.3, 14, 12),
    skin
  );
  head.position.y = 2.65;
  head.castShadow = true;
  group.add(head);

  addBox(
    group, 0.63, 0.13, 0.37,
    dark, 0, 2.91, 0
  );

  const leftArm = addBox(
    group, 0.18, 0.7, 0.19,
    outfit, -0.45, 1.65, 0
  );

  const rightArm = addBox(
    group, 0.18, 0.7, 0.19,
    outfit, 0.45, 1.65, 0
  );

  const leftLeg = addBox(
    group, 0.23, 0.65, 0.25,
    dark, -0.19, 0.65, 0
  );

  const rightLeg = addBox(
    group, 0.23, 0.65, 0.25,
    dark, 0.19, 0.65, 0
  );

  addBox(
    group, 0.27, 0.14, 0.4,
    shoes, -0.19, 0.25, -0.06
  );

  addBox(
    group, 0.27, 0.14, 0.4,
    shoes, 0.19, 0.25, -0.06
  );

  group.userData = {
    name,
    leftArm,
    rightArm,
    leftLeg,
    rightLeg
  };

  group.position.set(0, 0, 2);
  scene.add(group);
  return group;
}

function setCharacter(name) {
  character = name === 'Swastik' ? 'Swastik' : 'Smruti';

  document.querySelectorAll('.character-option').forEach((button) => {
    button.classList.toggle(
      'selected',
      button.dataset.character === character
    );
  });
}

// ============================================================
// INITIALIZE WORLD
// ============================================================

buildRoad();
buildUniversityGate();
buildCampus();

player = makeRunner('Smruti', '#168c68');
player.visible = false;

document.querySelectorAll('.character-option').forEach((button) => {
  button.addEventListener('click', () => {
    setCharacter(button.dataset.character);
  });
});

// ============================================================
// SCREENS, LOGIN AND NOTIFICATIONS
// ============================================================

const screenIds = [
  'login-screen',
  'home-screen',
  'room-screen',
  'pause-screen',
  'over-screen',
  'countdown-screen'
];

function hideScreens() {
  screenIds.forEach((id) => $(id)?.classList.add('hidden'));
}

function showScreen(id) {
  hideScreens();
  $(id)?.classList.remove('hidden');
}

function showToast(message) {
  const toast = $('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove('hidden');

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 2600);
}

function safeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 18);
}

$('login-form').addEventListener('submit', (event) => {
  event.preventDefault();

  const name = safeName($('player-name').value);

  if (name.length < 2 || !/^[\p{L}\p{N} _.-]+$/u.test(name)) {
    $('login-error').textContent =
      'Enter a valid name using 2–18 characters.';
    return;
  }

  playerName = name;
  $('login-error').textContent = '';
  $('welcome-player-name').textContent = playerName;
  $('change-name-button').classList.remove('hidden');
  showScreen('home-screen');
});

$('change-name-button').addEventListener('click', () => {
  $('player-name').value = playerName;
  showScreen('login-screen');
});

// ============================================================
// OBSTACLES, COINS AND POWER-UPS
// ============================================================

function clearRaceObjects() {
  for (const item of obstacles) scene.remove(item.mesh);
  for (const item of pickups) scene.remove(item.mesh);

  obstacles.length = 0;
  pickups.length = 0;
}

function makeCoin(x, z, type = 'coin') {
  const isBoost = type === 'boost';

  const mesh = new THREE.Mesh(
    isBoost
      ? new THREE.OctahedronGeometry(0.42, 0)
      : new THREE.TorusGeometry(0.32, 0.11, 8, 16),
    isBoost
      ? mat('#42e9ff', 0.25, 0.4)
      : materials.gold
  );

  mesh.position.set(x, isBoost ? 1.3 : 1.15, z);
  mesh.rotation.y = Math.PI / 2;
  mesh.castShadow = true;

  scene.add(mesh);
  pickups.push({ mesh, taken: false, type });
}

function makeObstacle(z) {
  const laneIndex = Math.floor(Math.random() * 3);
  const type = ['barrier', 'block', 'coin-line'][
    Math.floor(Math.random() * 3)
  ];
  const x = (laneIndex - 1) * LANE_WIDTH;

  if (type === 'coin-line') {
    for (let i = 0; i < 4; i++) {
      makeCoin(x, z - i * 1.35);
    }

    if (Math.random() < 0.3) {
      const boostLane = Math.floor(Math.random() * 3);
      makeCoin((boostLane - 1) * LANE_WIDTH, z - 7, 'boost');
    }

    return;
  }

  const group = new THREE.Group();

  if (type === 'barrier') {
    addBox(
      group, 1.55, 0.65, 0.55,
      mat('#ff8b48'), 0, 0.65, 0
    );

    addBox(
      group, 0.12, 1.1, 0.15,
      mat('#e8e9e4'), -0.6, 0.55, 0
    );

    addBox(
      group, 0.12, 1.1, 0.15,
      mat('#e8e9e4'), 0.6, 0.55, 0
    );
  } else {
    addBox(
      group, 1.4, 1.55, 1.1,
      mat('#3c6579'), 0, 0.78, 0
    );

    addBox(
      group, 1.48, 0.13, 1.18,
      mat('#8bb9c7'), 0, 1.45, 0
    );
  }

  group.position.set(x, 0, z);
  scene.add(group);

  obstacles.push({
    mesh: group,
    laneIndex,
    type,
    hit: false
  });
}

function populateRace() {
  clearRaceObjects();

  for (let i = 0; i < 25; i++) {
    makeObstacle(-40 - i * 9);
  }
}

// ============================================================
// INPUT AND CONTROLS
// ============================================================

function moveLane(amount) {
  if (!running || paused) return;
  lane = Math.max(0, Math.min(2, lane + amount));
}

function jump() {
  if (running && !paused) {
    jumpUntil = performance.now() + 650;
  }
}

function slide() {
  if (running && !paused) {
    slideUntil = performance.now() + 600;
  }
}

window.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();

  if ([
    'arrowleft',
    'arrowright',
    'arrowdown',
    'arrowup',
    ' '
  ].includes(key)) {
    event.preventDefault();
  }

  if (event.repeat) return;

  if (key === 'arrowleft' || key === 'a') moveLane(-1);
  if (key === 'arrowright' || key === 'd') moveLane(1);
  if (key === 'arrowup' || key === 'w' || key === ' ') jump();
  if (key === 'arrowdown' || key === 's') slide();
  if (key === 'escape' && running) togglePause();
});

function bindControl(id, action) {
  $(id)?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    action();
  });
}

bindControl('left-control', () => moveLane(-1));
bindControl('right-control', () => moveLane(1));
bindControl('jump-control', jump);
bindControl('slide-control', slide);

// ============================================================
// RESET AND COUNTDOWN
// ============================================================

function resetRace() {
  running = false;
  paused = false;
  raceStarted = false;

  distance = 0;
  coins = 0;
  speed = START_SPEED;
  lane = 1;
  hits = 0;
  scoreMultiplier = 1;

  boostUntil = 0;
  jumpUntil = 0;
  slideUntil = 0;

  clearRaceObjects();

  for (const runner of remoteRunners.values()) {
    scene.remove(runner);
  }
  remoteRunners.clear();

  universityGate.position.set(3.9, 0, -30);
  universityGate.visible = true;

  campusSegments.forEach((segment, i) => {
    segment.position.z = -45 - i * CAMPUS_GAP;
  });

  roadSegments.forEach((segment, i) => {
    segment.position.z = -10 - i * ROAD_LENGTH;
  });

  player.position.set(0, 0, 2);
  player.rotation.set(0, 0, 0);
  player.scale.set(1, 1, 1);
  player.visible = true;

  $('distance-value').textContent = '0';
  $('coins-value').textContent = '0';
  $('hud').classList.remove('hidden');
  $('mobile-controls').classList.remove('hidden');
}

function startCountdown(callback) {
  clearTimeout(countdownTimer);
  hideScreens();

  $('hud').classList.remove('hidden');
  $('countdown-screen').classList.remove('hidden');

  let number = 3;
  $('countdown-number').textContent = number;

  function tick() {
    number--;

    if (number > 0) {
      $('countdown-number').textContent = number;
      countdownTimer = setTimeout(tick, 700);
    } else {
      $('countdown-number').textContent = 'GO!';

      countdownTimer = setTimeout(() => {
        $('countdown-screen').classList.add('hidden');
        callback();
      }, 450);
    }
  }

  countdownTimer = setTimeout(tick, 700);
}

function startSolo() {
  mode = 'solo';
  roomCode = '';

  resetRace();
  populateRace();

  startCountdown(() => {
    running = true;
    raceStarted = true;
    lastTime = performance.now();

    showToast('Run! Jump over barriers, slide under blocks.');
  });
}

$('solo-button').addEventListener('click', startSolo);

// ============================================================
// MULTIPLAYER ROOMS
// ============================================================

$('multiplayer-button').addEventListener('click', () => {
  if (!socket.connected) socket.connect();

  $('room-error').textContent = '';
  $('room-lobby').classList.add('hidden');
  showScreen('room-screen');
});

$('back-home-button').addEventListener('click', () => {
  socket.emit('room:leave');
  roomCode = '';
  showScreen('home-screen');
});

$('create-room-button').addEventListener('click', () => {
  if (!socket.connected) socket.connect();

  $('room-error').textContent = '';
  socket.emit('room:create', { character, name: playerName });
});

$('join-room-form').addEventListener('submit', (event) => {
  event.preventDefault();

  const code = $('room-code').value.trim().toUpperCase();

  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) {
    $('room-error').textContent =
      'Enter a valid five-character room code.';
    return;
  }

  if (!socket.connected) socket.connect();

  $('room-error').textContent = '';
  socket.emit('room:join', {
    roomCode: code,
    character,
    name: playerName
  });
});

function renderRoom(state) {
  if (!state || state.roomCode !== roomCode) return;

  isHost = state.hostId === socket.id;

  $('room-code-display').textContent = state.roomCode;
  $('room-lobby').classList.remove('hidden');

  const list = $('player-list');
  list.replaceChildren();

  for (const p of state.players) {
    const row = document.createElement('div');
    row.className = 'player-row';

    const label = document.createElement('span');
    label.textContent = p.id === socket.id
      ? `${playerName} (You)`
      : (p.name || p.character || 'Runner');

    const status = document.createElement('small');
    status.textContent = p.id === state.hostId ? 'HOST' : 'RUNNER';

    row.append(label, status);
    list.appendChild(row);
  }

  const canStart =
    isHost && state.players.length === 2 && !state.started;

  $('start-race-button').classList.toggle('hidden', !canStart);

  $('lobby-message').textContent = state.players.length < 2
    ? 'Waiting for another runner to join...'
    : isHost
      ? 'Both runners are connected. Start the race!'
      : 'Waiting for the host to start the race.';
}

$('copy-room-code-button').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(roomCode);
    showToast('Room code copied.');
  } catch {
    showToast(`Room code: ${roomCode}`);
  }
});

$('start-race-button').addEventListener('click', () => {
  if (!roomCode || !isHost) return;
  socket.emit('race:start', { roomCode, character });
});

// ============================================================
// SOCKET EVENTS
// ============================================================

socket.on('connect', () => {
  $('connection-status').textContent = 'ONLINE';
  $('connection-status').classList.add('online');
});

socket.on('disconnect', () => {
  $('connection-status').textContent = 'OFFLINE';
  $('connection-status').classList.remove('online');
});

socket.on('connect_error', () => {
  $('room-error').textContent =
    'Cannot connect to the game server. Try again.';
});

socket.on('room:created', (data) => {
  roomCode = data.roomCode;
  isHost = true;
  showToast('Room created. Share the code with your friend.');
});

socket.on('room:joined', (data) => {
  roomCode = data.roomCode;
  isHost = false;
  showToast('Joined room successfully.');
});

socket.on('room:state', renderRoom);

socket.on('room:error', (data) => {
  $('room-error').textContent =
    data.message || 'Unable to join this room.';
});

socket.on('room:player-left', () => {
  showToast('The other player left the room.');
});

socket.on('race:started', (data) => {
  if (data.roomCode !== roomCode || raceStarted) return;

  raceStarted = true;
  mode = 'multi';

  resetRace();
  raceStarted = true;
  populateRace();

  startCountdown(() => {
    running = true;
    raceStarted = true;
    lastTime = performance.now();
  });
});

socket.on('race:state', (data) => {
  if (mode !== 'multi' || !data?.players) return;

  for (const p of data.players) {
    if (p.id === socket.id) continue;

    let runner = remoteRunners.get(p.id);

    if (!runner) {
      runner = makeRunner(p.character || 'Swastik', '#9376ff');
      remoteRunners.set(p.id, runner);
    }

    const targetX = ((Number(p.lane) || 1) - 1) * LANE_WIDTH;
    runner.position.x += (targetX - runner.position.x) * 0.35;
    runner.position.z = -1.2;
  }
});

// ============================================================
// PAUSE AND GAME OVER
// ============================================================

function togglePause() {
  if (!running) return;

  paused = !paused;

  if (paused) {
    showScreen('pause-screen');
  } else {
    hideScreens();
    $('hud').classList.remove('hidden');
    lastTime = performance.now();
  }
}

$('pause-button').addEventListener('click', togglePause);
$('resume-button').addEventListener('click', togglePause);

function finishRace(reason = 'Nice Run') {
  if (!running && !raceStarted) return;

  running = false;
  paused = false;
  raceStarted = false;

  player.visible = false;

  $('hud').classList.add('hidden');
  $('mobile-controls').classList.add('hidden');

  const finalScore = Math.floor(distance) + coins * 50;

  $('final-distance').textContent = `${Math.floor(distance)} m`;
  $('final-coins').textContent = String(coins);

  if ($('final-score')) {
    $('final-score').textContent = String(finalScore);
  }

  if ($('game-over-reason')) {
    $('game-over-reason').textContent = reason;
  }

  if (mode === 'multi' && roomCode) {
    socket.emit('race:finished', {
      roomCode,
      distance: Math.floor(distance),
      coins,
      score: finalScore
    });
  }

  showScreen('over-screen');
}

$('quit-button').addEventListener('click', () => {
  running = false;
  paused = false;
  raceStarted = false;

  socket.emit('room:leave');
  roomCode = '';

  $('hud').classList.add('hidden');
  $('mobile-controls').classList.add('hidden');
  player.visible = false;

  showScreen('home-screen');
});

$('menu-button').addEventListener('click', () => {
  running = false;
  paused = false;
  raceStarted = false;

  $('hud').classList.add('hidden');
  $('mobile-controls').classList.add('hidden');
  player.visible = false;

  showScreen('home-screen');
});

$('retry-button').addEventListener('click', () => {
  if (mode === 'multi' && roomCode) {
    showScreen('room-screen');
    $('hud').classList.add('hidden');
    $('mobile-controls').classList.add('hidden');
  } else {
    startSolo();
  }
});

// ============================================================
// MOVING WORLD
// ============================================================

function updateMovingRoad(delta) {
  for (const segment of roadSegments) {
    segment.position.z += speed * delta;

    if (segment.position.z > 20) {
      const farthestZ = Math.min(
        ...roadSegments.map((s) => s.position.z)
      );

      segment.position.z = farthestZ - ROAD_LENGTH;
    }
  }
}

function updateMovingGate(delta) {
  if (!universityGate.visible) return;

  universityGate.position.z += speed * delta;

  if (universityGate.position.z > 25) {
    universityGate.visible = false;
  }
}

function updateMovingCampus(delta) {
  for (const segment of campusSegments) {
    segment.position.z += speed * delta;

    if (segment.position.z > 25) {
      const farthestZ = Math.min(
        ...campusSegments.map((s) => s.position.z)
      );

      segment.position.z = farthestZ - CAMPUS_GAP * 1.5;
    }
  }
}

// ============================================================
// RUNNER ANIMATION
// ============================================================

function updateRunner(now, delta) {
  const targetX = (lane - 1) * LANE_WIDTH;

  player.position.x +=
    (targetX - player.position.x) * Math.min(1, delta * 12);

  const jumping = now < jumpUntil;
  const sliding = now < slideUntil;

  const jumpProgress = Math.max(
    0,
    Math.min(1, (jumpUntil - now) / 650)
  );

  player.position.y = jumping
    ? Math.sin(jumpProgress * Math.PI) * 1.65
    : 0;

  player.scale.y = sliding ? 0.55 : 1;

  const swing = running && !jumping && !sliding
    ? Math.sin(now * 0.014) * 0.65
    : 0;

  player.userData.leftLeg.rotation.x = swing;
  player.userData.rightLeg.rotation.x = -swing;
  player.userData.leftArm.rotation.x = -swing * 0.7;
  player.userData.rightArm.rotation.x = swing * 0.7;

  // Smoothly recover the runner's tilt after a collision.
  player.rotation.z += (0 - player.rotation.z) * Math.min(1, delta * 5);
}

// ============================================================
// COLLISIONS, COINS AND BOOSTS
// ============================================================

function updateObstacles(delta, now) {
  for (const item of obstacles) {
    const previousZ = item.mesh.position.z;
    item.mesh.position.z += speed * delta;

    // Check the complete movement step to avoid tunnelling through
    // an obstacle when the game runs at a lower frame rate.
    const collisionFront = player.position.z + 0.8;
    const collisionBack = player.position.z - 0.8;

    const crossedRunner =
      previousZ <= collisionFront &&
      item.mesh.position.z >= collisionBack;

    const inLane =
      Math.abs(item.mesh.position.x - player.position.x) < 1.05;

    if (!item.hit && crossedRunner && inLane) {
      const jumping = now < jumpUntil;
      const sliding = now < slideUntil;

      const avoided =
        (item.type === 'barrier' && jumping) ||
        (item.type === 'block' && sliding);

      if (!avoided) {
        // Mark the obstacle immediately so it cannot count twice.
        item.hit = true;
        hits++;

        if (hits >= MAX_HITS) {
          showToast('Second collision! Game over.');
          finishRace('You hit two obstacles!');
          return;
        }

        // First collision: a small, temporary slowdown.
        speed = Math.max(13, speed - 1.5);
        showToast('First hit! Avoid the next obstacle.');

        player.rotation.z =
          player.position.x < item.mesh.position.x ? 0.12 : -0.12;
      }
    }
  }

  // Remove obstacles that have passed the runner.
  for (let i = obstacles.length - 1; i >= 0; i--) {
    if (obstacles[i].mesh.position.z > 12) {
      scene.remove(obstacles[i].mesh);
      obstacles.splice(i, 1);
    }
  }

  // Coins and temporary speed boosts.
  for (const item of pickups) {
    item.mesh.position.z += speed * delta;
    item.mesh.rotation.z += delta * 2;
    item.mesh.rotation.y += delta * 2;

    if (
      !item.taken &&
      Math.abs(item.mesh.position.z - player.position.z) < 1.1 &&
      Math.abs(item.mesh.position.x - player.position.x) < 1.1
    ) {
      item.taken = true;
      item.mesh.visible = false;

      if (item.type === 'boost') {
        boostUntil = now + 2500;
        scoreMultiplier = 2;
        showToast('Speed boost! Double coin value temporarily.');
      } else {
        coins++;
        showToast(`Coin collected! x${scoreMultiplier}`);
      }
    }
  }

  for (let i = pickups.length - 1; i >= 0; i--) {
    if (
      pickups[i].mesh.position.z > 12 ||
      pickups[i].taken
    ) {
      scene.remove(pickups[i].mesh);
      pickups.splice(i, 1);
    }
  }

  // Maintain a supply of obstacles in front of the runner.
  if (obstacles.length < 15) {
    const farthestZ = Math.min(
      -30,
      ...obstacles.map((item) => item.mesh.position.z)
    );

    makeObstacle(farthestZ - 8 - Math.random() * 7);
  }
}

// ============================================================
// WORLD UPDATE
// ============================================================

function updateWorld(delta, now) {
  const boosted = now < boostUntil;
  scoreMultiplier = boosted ? 2 : 1;

  // Gradually increase speed instead of jumping to full speed.
  const targetSpeed = boosted ? 23 : 25;
  speed = Math.min(targetSpeed, speed + delta * 0.12);

  distance += speed * delta;

  $('distance-value').textContent = String(Math.floor(distance));
  $('coins-value').textContent = String(coins);

  updateMovingRoad(delta);
  updateMovingGate(delta);
  updateMovingCampus(delta);
  updateObstacles(delta, now);

  if (!running) return;

  camera.position.x +=
    (player.position.x * 0.25 - camera.position.x) * delta * 2;

  camera.lookAt(player.position.x * 0.18, 1.2, -8);

  if (mode === 'multi' && roomCode && now - lastSync > 150) {
    lastSync = now;

    socket.emit('player:update', {
      roomCode,
      character,
      lane,
      distance: Math.floor(distance),
      coins
    });
  }

  if (distance >= 1000) {
    finishRace('You completed 1000 metres!');
  }
}

// ============================================================
// RENDER LOOP
// ============================================================

function animate(now = 0) {
  requestAnimationFrame(animate);

  const delta = lastTime
    ? Math.min((now - lastTime) / 1000, 0.05)
    : 0;

  if (running && !paused) {
    updateRunner(now, delta);
    updateWorld(delta, now);
  }

  renderer.render(scene, camera);
  lastTime = now;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.7));
});

window.addEventListener('beforeunload', () => {
  socket.emit('room:leave');
});

animate();
