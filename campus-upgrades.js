
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

/*
  SAMBALPUR CAMPUS RUN 3D
  Complete campus environment upgrade.

  Features:
  - University entrance gate
  - Textured university name board
  - Department buildings
  - Building windows and signage
  - Improved GLB character loading
  - Character animation support
*/

const MATERIALS = {
  stone: new THREE.MeshStandardMaterial({
    color: 0xd8c6a5,
    roughness: 0.78
  }),

  trim: new THREE.MeshStandardMaterial({
    color: 0x252d32,
    metalness: 0.35,
    roughness: 0.45
  }),

  gold: new THREE.MeshStandardMaterial({
    color: 0xd5ae61,
    metalness: 0.55,
    roughness: 0.3
  }),

  glass: new THREE.MeshStandardMaterial({
    color: 0x8bd5ed,
    metalness: 0.35,
    roughness: 0.18,
    emissive: 0x173746,
    emissiveIntensity: 0.3
  })
};

function addBox(
  scene,
  dimensions,
  position,
  material,
  options = {}
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...dimensions),
    material
  );

  mesh.position.set(...position);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = true;

  scene.add(mesh);
  return mesh;
}

function createTextTexture(
  title,
  subtitle,
  width = 1536,
  height = 320
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(
    0, 0, width, height
  );

  gradient.addColorStop(0, "#102b25");
  gradient.addColorStop(1, "#203b31");

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#dfbd75";
  ctx.lineWidth = 12;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  ctx.fillStyle = "#ffe5a3";
  ctx.font = "bold 88px Georgia";
  ctx.fillText(title, width / 2, height * 0.38);

  ctx.fillStyle = "#ffffff";
  ctx.font = "36px Arial";
  ctx.fillText(subtitle, width / 2, height * 0.72);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return texture;
}

function addSign(
  scene,
  title,
  subtitle,
  position,
  dimensions
) {
  const material = new THREE.MeshStandardMaterial({
    map: createTextTexture(title, subtitle),
    roughness: 0.5,
    metalness: 0.12
  });

  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(...dimensions),
    material
  );

  sign.position.set(...position);
  scene.add(sign);

  return sign;
}

/* =========================================
   UNIVERSITY ENTRANCE
========================================= */

export function createUniversityGate(
  scene,
  z = -30
) {
  const group = new THREE.Group();

  const pillarPositions = [-5.8, 5.8];

  for (const x of pillarPositions) {
    addBox(
      group,
      [1.3, 6.2, 1.5],
      [x, 3.1, 0],
      MATERIALS.stone
    );

    addBox(
      group,
      [1.65, 0.35, 1.85],
      [x, 6.25, 0],
      MATERIALS.trim
    );

    addBox(
      group,
      [1.5, 0.3, 1.7],
      [x, 0.15, 0],
      MATERIALS.gold
    );

    // Gold decorative bands
    for (const y of [1.1, 4.9]) {
      addBox(
        group,
        [1.34, 0.13, 1.55],
        [x, y, 0],
        MATERIALS.gold
      );
    }
  }

  // Upper connecting beam
  addBox(
    group,
    [13.2, 1.05, 1.4],
    [0, 6.15, 0],
    MATERIALS.stone
  );

  // Main name board
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(10.5, 1.5, 0.25),
    new THREE.MeshStandardMaterial({
      map: createTextTexture(
        "SAMBALPUR UNIVERSITY",
        "JYOTI VIHAR • ODISHA"
      ),
      roughness: 0.42
    })
  );

  board.position.set(0, 6.05, -0.85);
  group.add(board);

  // Gate bars on either side of the entrance.
  // Leave the middle open for runners.
  const barMaterial = new THREE.MeshStandardMaterial({
    color: 0x303b43,
    metalness: 0.65,
    roughness: 0.3
  });

  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const x = side * (2.0 + i * 0.45);

      addBox(
        group,
        [0.09, 2.45, 0.12],
        [x, 1.35, 0],
        barMaterial
      );
    }

    addBox(
      group,
      [3.0, 0.12, 0.15],
      [side * 3.35, 2.55, 0],
      MATERIALS.gold
    );
  }

  // Decorative lights
  const lightMaterial = new THREE.MeshStandardMaterial({
    color: 0xffd991,
    emissive: 0xffad40,
    emissiveIntensity: 1.5
  });

  for (const x of pillarPositions) {
    const lamp = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 20, 20),
      lightMaterial
    );

    lamp.position.set(x, 6.8, 0);
    group.add(lamp);
  }

  group.position.z = z;
  scene.add(group);

  return group;
}

/* =========================================
   DEPARTMENT BUILDINGS
========================================= */

export function createDepartmentBuildings(
  scene,
  options = {}
) {
  const roadZ = options.roadZ ?? -44;
  const spacing = options.spacing ?? 22;
  const sideOffset = options.sideOffset ?? 12;

  const departments = [
    {
      name: "SUIIT",
      subtitle: "Information Technology",
      color: 0x315a78
    },
    {
      name: "COMPUTER SCIENCE",
      subtitle: "Computer Science & Applications",
      color: 0x41684c
    },
    {
      name: "MATHEMATICS",
      subtitle: "Department of Mathematics",
      color: 0x675184
    },
    {
      name: "PHYSICS",
      subtitle: "Department of Physics",
      color: 0x80583b
    },
    {
      name: "CHEMISTRY",
      subtitle: "Department of Chemistry",
      color: 0x34717b
    },
    {
      name: "MANAGEMENT",
      subtitle: "Management Studies",
      color: 0x81504f
    },
    {
      name: "LIFE SCIENCES",
      subtitle: "Research & Education",
      color: 0x47744b
    },
    {
      name: "LIBRARY",
      subtitle: "University Central Library",
      color: 0x69604a
    }
  ];

  const created = [];

  departments.forEach((dept, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);

    const x = side * sideOffset;
    const z = roadZ - row * spacing;

    const width = 9;
    const height = 5.5;
    const depth = 8;

    const group = new THREE.Group();

    const wallMaterial = new THREE.MeshStandardMaterial({
      color: dept.color,
      roughness: 0.76
    });

    addBox(
      group,
      [width, height, depth],
      [0, height / 2, 0],
      wallMaterial
    );

    // Roof
    addBox(
      group,
      [width + 0.5, 0.3, depth + 0.5],
      [0, height + 0.15, 0],
      MATERIALS.trim
    );

    // Foundation
    addBox(
      group,
      [width + 0.25, 0.35, depth + 0.25],
      [0, 0.175, 0],
      MATERIALS.stone
    );

    // Windows on the road-facing wall
    for (const wx of [-3, 0, 3]) {
      addBox(
        group,
        [1.35, 1.5, 0.12],
        [wx, 2.55, depth / 2 + 0.07],
        MATERIALS.glass
      );

      // Window dividers
      addBox(
        group,
        [0.06, 1.5, 0.15],
        [wx, 2.55, depth / 2 + 0.14],
        MATERIALS.trim
      );
    }

    // Entrance door
    addBox(
      group,
      [1.15, 2.15, 0.14],
      [0, 1.3, depth / 2 + 0.09],
      MATERIALS.trim
    );

    // Department name sign
    addSign(
      group,
      dept.name,
      dept.subtitle,
      [0, 4.25, depth / 2 + 0.1],
      [7.8, 1.35]
    );

    group.position.set(x, 0, z);
    scene.add(group);

    created.push({
      group,
      name: dept.name,
      position: { x, y: 0, z }
    });
  });

  return created;
}

/* =========================================
   IMPROVED PLAYER MODELS
========================================= */

export async function loadRunnerCharacter(
  scene,
  modelPath,
  position,
  options = {}
) {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(modelPath);

  const character = gltf.scene;

  const targetHeight = options.height ?? 2.0;

  // Normalize model height.
  const bounds = new THREE.Box3().setFromObject(character);
  const size = bounds.getSize(new THREE.Vector3());

  if (size.y > 0) {
    character.scale.multiplyScalar(targetHeight / size.y);
  }

  // Center the model horizontally around its origin.
  const center = bounds.getCenter(new THREE.Vector3());

  character.position.x -= center.x;
  character.position.z -= center.z;

  const normalizedBounds = new THREE.Box3().setFromObject(character);

  character.position.y -= normalizedBounds.min.y;

  character.position.x += position.x;
  character.position.y += position.y;
  character.position.z += position.z;

  character.traverse((object) => {
    if (!object.isMesh) return;

    object.castShadow = true;
    object.receiveShadow = true;

    if (object.material) {
      object.material.needsUpdate = true;
    }
  });

  scene.add(character);

  const mixer = gltf.animations.length
    ? new THREE.AnimationMixer(character)
    : null;

  let activeAction = null;

  if (mixer) {
    const runClip =
      gltf.animations.find((clip) =>
        /run|jog|sprint/i.test(clip.name)
      ) || gltf.animations[0];

    activeAction = mixer.clipAction(runClip);
    activeAction.play();
  }

  return {
    character,
    mixer,
    animations: gltf.animations,
    activeAction,

    update(deltaTime) {
      if (mixer) {
        mixer.update(deltaTime);
      }
    },

    setPosition(x, y, z) {
      character.position.set(x, y, z);
    },

    setRotation(y) {
      character.rotation.y = y;
    },

    dispose() {
      scene.remove(character);

      if (mixer) {
        mixer.stopAllAction();
      }
    }
  };
}

/* =========================================
   GRAPHICS UPGRADE
========================================= */

export function improveCampusLighting(scene, renderer) {
  scene.fog = new THREE.Fog(0xa9c4d4, 100, 320);

  const sunlight = new THREE.DirectionalLight(
    0xffedcf,
    2.5
  );

  sunlight.position.set(-35, 60, 25);
  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);

  sunlight.shadow.camera.left = -80;
  sunlight.shadow.camera.right = 80;
  sunlight.shadow.camera.top = 80;
  sunlight.shadow.camera.bottom = -80;

  scene.add(sunlight);

  scene.add(
    new THREE.HemisphereLight(
      0xe4f3ff,
      0x596047,
      1.6
    )
  );

  if (renderer) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  return sunlight;
}
