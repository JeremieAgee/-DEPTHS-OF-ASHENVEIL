/* ═══════════════════════════════════════════════════
   engine.js  —  Three.js scene, renderer, lighting,
                 geometry, particles, camera
   Exports: Engine (namespace)
════════════════════════════════════════════════════ */
const Engine = (() => {

  /* ── Internal state ──────────────────────────── */
  let renderer, scene, camera;
  let playerMesh, torchLight, ambientLight;
  let enemyMeshes   = {};   // id → THREE.Group
  let particles     = [];
  let chestMeshes   = [];
  let exitPortal    = null;
  let portalGlow    = null;
  let clock         = new THREE.Clock();
  let dungeonGroup  = null;
  let lanternLights = [];
  let aimAngle      = 0;    // radians, updated each frame
  let debugCube     = null;

  const TORCH_COLOR   = 0xff8822;
  const LANTERN_COLOR = 0xffaa33;
  const AMBIENT_INT   = 0.6; // Increased for testing

  /* ── Init renderer + scene ───────────────────── */
  function init() {
    const mount = document.getElementById('canvasMount');

    initPointerLock();
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, .25); // subtle transparent black for depth perception
    mount.appendChild(renderer.domElement);

    resize(); // set canvas size
    window.addEventListener('resize', resize);

    scene = new THREE.Scene();
     scene.fog = new THREE.FogExp2(0x000000, 0.01); // subtle fog for depth perception

    // Camera — third-person top-angled
    camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 100);

    // Brighter ambient light for testing
    ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INT); // temporary test light
    scene.add(ambientLight);
    window.addEventListener('mouseleave', () => { lastMouseX = null; });
  }

 function resize() {
  const mount = document.getElementById('canvasMount');
  const w = mount.clientWidth;
  const h = mount.clientHeight;
  mount.style.height = ''; // remove any inline height override
  if (renderer) renderer.setSize(w, h);
  if (camera)   { camera.aspect = w / h; camera.updateProjectionMatrix(); }
}

/* ── Build dungeon geometry ──────────────────── */
function buildDungeon(dungeon) {
  if (dungeonGroup) scene.remove(dungeonGroup);
  lanternLights.forEach(l => scene.remove(l));
  lanternLights = [];

  dungeonGroup = new THREE.Group();
  const TILE   = dungeon.TILE;
  const WALL_H = dungeon.WALL_H;
  const grid   = dungeon.grid;
  const COLS   = dungeon.COLS;
  const ROWS   = dungeon.ROWS;

  // ── Materials ──────────────────────────────
  const brickTex = makeBrickTexture();
  brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping;

  const wallMat = new THREE.MeshLambertMaterial({
    map: brickTex,
    color: 0x8a6a4a,
  });

  // Enhanced floor material with brick and grass
  const floorTex = makeFloorTexture();
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  const floorMat = new THREE.MeshLambertMaterial({
  color: 0x6a5a48,  // lighter base
  map: floorTex,
});

  // ── Build walls + floor tiles ───────────────
  const wallGeo   = new THREE.BoxGeometry(TILE, WALL_H, TILE);
  const floorGeo  = new THREE.BoxGeometry(TILE, 0.2, TILE);

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const wx = col * TILE + TILE / 2;
      const wz = row * TILE + TILE / 2;

      if (grid[row][col] === 1) {
        const wall = new THREE.Mesh(wallGeo, wallMat);
        wall.position.set(wx, WALL_H / 2, wz);
        wall.castShadow    = true;
        wall.receiveShadow = true;
        dungeonGroup.add(wall);
      } else {
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.position.set(wx, -0.1, wz);
        floor.receiveShadow = true;
        floor.castShadow = true;
        dungeonGroup.add(floor);
      }
    }
  }

  scene.add(dungeonGroup);

  // ── Lanterns ────────────────────────────────
// ── Lanterns (wall-mounted, facing outward) ─────────
const lanternGeo  = new THREE.BoxGeometry(0.18, 0.28, 0.18);
const lanternMat  = new THREE.MeshBasicMaterial({ color: 0x3a1a00 });
const flameMat    = new THREE.MeshBasicMaterial({ color: 0xff8822 });
const flameGeo    = new THREE.SphereGeometry(0.12, 6, 5);
const bracketMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });

for (const lan of dungeon.lanterns) {
  const gx = lan.x;
  const gy = lan.y;
  const wx = gx * TILE + TILE / 2;
  const wz = gy * TILE + TILE / 2;
  
  // Determine which wall this lantern is on
  // Check the 4 adjacent tiles - if one is a wall, mount on that wall
  let wallDirection = null;  // 'north', 'south', 'east', 'west'
  let offsetX = 0, offsetZ = 0;
  let rotationY = 0;
  
  // Check north wall (wall above in grid)
  if (gy > 0 && grid[gy - 1][gx] === 1) {
    wallDirection = 'north';
    offsetZ = -TILE / 2 + 0.3;  // Stick out from north wall
    rotationY = 0;
  }
  // Check south wall
  else if (gy < ROWS - 1 && grid[gy + 1][gx] === 1) {
    wallDirection = 'south';
    offsetZ = TILE / 2 - 0.3;   // Stick out from south wall
    rotationY = Math.PI;
  }
  // Check west wall
  else if (gx > 0 && grid[gy][gx - 1] === 1) {
    wallDirection = 'west';
    offsetX = -TILE / 2 + 0.3;  // Stick out from west wall
    rotationY = Math.PI / 2;
  }
  // Check east wall
  else if (gx < COLS - 1 && grid[gy][gx + 1] === 1) {
    wallDirection = 'east';
    offsetX = TILE / 2 - 0.3;   // Stick out from east wall
    rotationY = -Math.PI / 2;
  }
  
  // Only add lantern if it's on a wall
  if (wallDirection) {
    const lanternX = wx + offsetX;
    const lanternZ = wz + offsetZ;

    // Metal bracket arm
    const bracketGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
    const bracket = new THREE.Mesh(bracketGeo, bracketMat);
    bracket.position.set(lanternX - Math.cos(rotationY) * 0.15, WALL_H * 0.7, lanternZ - Math.sin(rotationY) * 0.15);
    bracket.rotation.y = rotationY;
    bracket.castShadow = true;
    bracket.receiveShadow = true;
    scene.add(bracket);

    // Lantern body
    const body = new THREE.Mesh(lanternGeo, lanternMat);
    body.position.set(lanternX, WALL_H * 0.7, lanternZ);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);

    // Flame
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(lanternX, WALL_H * 0.72, lanternZ);
    flame.userData.isFlame = true;
    scene.add(flame);

    // Light source
    const light = new THREE.PointLight(LANTERN_COLOR, 1.5, 14);
    light.position.set(lanternX, WALL_H * 0.72, lanternZ);
    light.userData.baseIntensity = 1.5;
    light.userData.flameOffset   = Math.random() * Math.PI * 2;
    scene.add(light);
    lanternLights.push(light);
  }
}

  // ── Chests ──────────────────────────────────
  chestMeshes = [];
  const chestGeo = new THREE.BoxGeometry(0.6, 0.5, 0.6);
  const chestMat = new THREE.MeshLambertMaterial({ color: 0x8a5a20 });
  const lidGeo   = new THREE.BoxGeometry(0.6, 0.2, 0.6);
  const lidMat   = new THREE.MeshLambertMaterial({ color: 0x5a3a10 });

  for (const chest of dungeon.chests) {
    const w = dungeon.toWorld(chest.gx, chest.gy);
    const g = new THREE.Group();
    const body = new THREE.Mesh(chestGeo, chestMat);
    body.position.y = 0.25;
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.y = 0.6;
    g.add(body); g.add(lid);
    g.position.set(w.x, 0, w.z);
    g.userData.chestData = chest;
    scene.add(g);
    chestMeshes.push(g);
  }
}

  /* ── Player mesh ─────────────────────────────── */
 function buildPlayerMesh() {
  if (playerMesh) scene.remove(playerMesh);

  const group = new THREE.Group();

  // Body - leather tunic
  const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 10);
  const bodyMat = new THREE.MeshLambertMaterial({ 
    color: 0xc87020,
    roughness: 0.7
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.7;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // Chest plate - metallic armor
  const chestplateGeo = new THREE.BoxGeometry(0.35, 0.7, 0.15);
  const chestplateMat = new THREE.MeshStandardMaterial({
    color: 0x888888,
    metalness: 0.8,
    roughness: 0.2
  });
  const chestplate = new THREE.Mesh(chestplateGeo, chestplateMat);
  chestplate.position.set(0, 0.8, -0.1);
  chestplate.castShadow = true;
  chestplate.receiveShadow = true;
  group.add(chestplate);

  // Head - with better detail
  const headGeo = new THREE.SphereGeometry(0.28, 10, 8);
  const headMat = new THREE.MeshLambertMaterial({ color: 0xd4a060 });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.55;
  head.castShadow = true;
  head.receiveShadow = true;
  group.add(head);

  // Helmet (optional metallic top)
  const helmetGeo = new THREE.ConeGeometry(0.3, 0.35, 8);
  const helmetMat = new THREE.MeshStandardMaterial({
    color: 0x666666,
    metalness: 0.7,
    roughness: 0.3
  });
  const helmet = new THREE.Mesh(helmetGeo, helmetMat);
  helmet.position.y = 1.75;
  helmet.castShadow = true;
  helmet.receiveShadow = true;
  group.add(helmet);

  // Cape - cloth material
  const capeGeo = new THREE.PlaneGeometry(0.55, 0.9);
  const capeMat = new THREE.MeshLambertMaterial({ 
    color: 0x2a1800, 
    side: THREE.DoubleSide,
    roughness: 0.9
  });
  const cape = new THREE.Mesh(capeGeo, capeMat);
  cape.position.set(0, 0.8, 0.32);
  cape.rotation.x = 0.2;
  cape.castShadow = true;
  group.add(cape);

  // Torch handle - wood
  const torchHandleGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8);
  const torchHandleMat = new THREE.MeshLambertMaterial({ color: 0x4a2e08 });
  const torchHandle = new THREE.Mesh(torchHandleGeo, torchHandleMat);
  torchHandle.position.set(0.3, 1.2, 0.3);
  torchHandle.rotation.z = 0.3;
  torchHandle.castShadow = true;
  group.add(torchHandle);

  // Torch flame - emissive glow
  const flameGeo = new THREE.SphereGeometry(0.14, 6, 5);
  const flameMat = new THREE.MeshBasicMaterial({ 
    color: 0xffcc44,
    emissive: 0xff8800,
    emissiveIntensity: 1.0
  });
  const flame = new THREE.Mesh(flameGeo, flameMat);
  flame.position.set(0.42, 1.55, 0.42);
  flame.userData.isTorchFlame = true;
  group.add(flame);

  // Sword - metallic blade
  const swordBladeGeo = new THREE.BoxGeometry(0.08, 0.8, 0.02);
  const swordBladeMat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    metalness: 0.9,
    roughness: 0.1,
    emissive: 0x222222
  });
  const swordBlade = new THREE.Mesh(swordBladeGeo, swordBladeMat);
  swordBlade.position.set(-0.25, 0.9, 0.1);
  swordBlade.rotation.z = 0.3;
  swordBlade.castShadow = true;
  group.add(swordBlade);

  // Sword guard - gold/brass
  const guardGeo = new THREE.BoxGeometry(0.25, 0.08, 0.08);
  const guardMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.8,
    roughness: 0.3
  });
  const guard = new THREE.Mesh(guardGeo, guardMat);
  guard.position.set(-0.25, 0.5, 0.1);
  guard.castShadow = true;
  group.add(guard);

  // Sword hilt - wrapped leather
  const hiltGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6);
  const hiltMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
  const hilt = new THREE.Mesh(hiltGeo, hiltMat);
  hilt.position.set(-0.25, 0.3, 0.1);
  hilt.rotation.z = 0.3;
  hilt.castShadow = true;
  group.add(hilt);

  playerMesh = group;
  scene.add(playerMesh);

  if (torchLight) scene.remove(torchLight);
  torchLight = new THREE.PointLight(TORCH_COLOR, 5.0, 28);
  torchLight.castShadow = true;
  torchLight.shadow.mapSize.set(512, 512);
  torchLight.shadow.camera.near = 0.2;
  torchLight.shadow.camera.far  = 30;
  scene.add(torchLight);

  return playerMesh;
}

  /* ── Camera update ───────────────────────────── */
  function updateCamera(player) {
    const camDist = 6; // reduced for testing
    const camH    = 7;
    
     // Update player facing direction based on aim angle
  if (playerMesh) {
    playerMesh.rotation.y = -aimAngle + Math.PI / 2;
  }

    camera.position.set(
      player.x - Math.cos(aimAngle) * camDist * 0.4,
      camH,
      player.z - Math.sin(aimAngle) * camDist * 0.4 + camDist * 0.6
    );
    camera.lookAt(player.x, 2.0, player.z);
  }

  /* ── Enemy mesh ──────────────────────────────── */
  function buildEnemyMesh(enemy) {
  const group = new THREE.Group();
  const def   = Enemies.TYPES[enemy.typeKey] || Enemies.BOSS_TYPE;
  const color = def.color;
  const h     = enemy.height;
  const r     = enemy.radius;

  if (enemy.isBoss) {
    // Boss body - darker, menacing
    const bodyGeo = new THREE.CylinderGeometry(r * 0.85, r, h * 0.75, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.4,
      roughness: 0.6,
      emissive: 0x220000,
      emissiveIntensity: 0.3
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h * 0.4;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Boss head - glowing red
    const headGeo = new THREE.SphereGeometry(r * 0.75, 10, 8);
    const headMat = new THREE.MeshStandardMaterial({
      color: 0xff3300,
      emissive: 0xff0000,
      emissiveIntensity: 0.5,
      metalness: 0.5,
      roughness: 0.4
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = h * 0.85;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);

    // Horns - darker, sharper
    const hornGeo = new THREE.ConeGeometry(0.1, 0.5, 5);
    const hornMat = new THREE.MeshStandardMaterial({
      color: 0x1a0000,
      metalness: 0.6,
      roughness: 0.2
    });
    [-0.25, 0.25].forEach(ox => {
      const horn = new THREE.Mesh(hornGeo, hornMat);
      horn.position.set(ox, h * 1.1, 0);
      horn.rotation.z = ox > 0 ? -0.4 : 0.4;
      horn.castShadow = true;
      group.add(horn);
    });
  } else {
    // Regular enemy body - scaly/chitinous
    const bodyGeo = new THREE.CylinderGeometry(r * 0.8, r * 0.9, h * 0.7, 8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.7
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = h * 0.38;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Enemy head
    const headGeo = new THREE.SphereGeometry(r * 0.6, 8, 6);
    const headColor = lightenHex(color, 0.3);
    const headMat = new THREE.MeshStandardMaterial({
      color: headColor,
      metalness: 0.2,
      roughness: 0.8
    });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = h * 0.82;
    head.castShadow = true;
    head.receiveShadow = true;
    group.add(head);
  }

  // HP bar
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 16;
  const ctx2 = canvas.getContext('2d');
  ctx2.fillStyle = '#300'; ctx2.fillRect(0, 0, 128, 16);
  ctx2.fillStyle = enemy.isBoss ? '#ff2200' : '#cc2200';
  ctx2.fillRect(1, 1, 126, 14);
  const hpTex = new THREE.CanvasTexture(canvas);
  const hpMat = new THREE.SpriteMaterial({ map: hpTex, depthTest: false });
  hpMat.userData.isHpBar = true;
  const hpSprite = new THREE.Sprite(hpMat);
  hpSprite.scale.set(enemy.isBoss ? 2.4 : 1.4, 0.22, 1);
  hpSprite.position.y = h + 0.4;
  hpSprite.userData.isHpBar = true;
  hpSprite.userData.hpTex = hpTex;
  hpSprite.userData.canvas = canvas;
  hpSprite.userData.ctx = ctx2;
  hpSprite.userData.enemy = enemy;
  group.add(hpSprite);

  group.position.set(enemy.x, 0, enemy.z);
  scene.add(group);
  enemyMeshes[enemy.id] = group;
  enemy.mesh = group;
  return group;
}

  function updateEnemyHpBar(enemy) {
    const group = enemyMeshes[enemy.id];
    if (!group) return;
    const sprite = group.children.find(c => c.userData.isHpBar);
    if (!sprite) return;
    const { canvas, ctx, hpTex } = sprite.userData;
    const pct = Math.max(0, enemy.hp / enemy.maxHp);
    ctx.fillStyle = '#300'; ctx.fillRect(0, 0, 128, 16);
    ctx.fillStyle = enemy.isBoss ? '#ff2200' : '#882200';
    ctx.fillRect(1, 1, Math.round(126 * pct), 14);
    hpTex.needsUpdate = true;
  }

  function removeEnemyMesh(id) {
    const m = enemyMeshes[id];
    if (m) { scene.remove(m); delete enemyMeshes[id]; }
  }

  /* ── Exit portal ─────────────────────────────── */
  function buildExitPortal(dungeon) {
    if (exitPortal) scene.remove(exitPortal);
    const { cx, cy } = dungeon.roomCenter(dungeon.bossRoom);
    const w = dungeon.toWorld(cx, cy);
    const geo = new THREE.TorusGeometry(1.0, 0.18, 12, 40);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8844ff });
    exitPortal = new THREE.Mesh(geo, mat);
    exitPortal.position.set(w.x, 1.4, w.z);
    exitPortal.rotation.x = Math.PI / 2;

    portalGlow = new THREE.PointLight(0x8844ff, 2.0, 8);
    portalGlow.position.set(w.x, 1.4, w.z);
    scene.add(exitPortal);
    scene.add(portalGlow);
  }

  function removeExitPortal() {
    if (exitPortal) { scene.remove(exitPortal); exitPortal = null; }
    if (portalGlow) { scene.remove(portalGlow); portalGlow = null; }
  }

  /* ── Particles ───────────────────────────────── */
  function spawnParticles(x, y, z, color, count = 8, speed = 3, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const geo = new THREE.SphereGeometry(0.06 + Math.random() * 0.08, 4, 3);
      const mat = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      const a  = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.5) * Math.PI;
      const s  = speed * (0.5 + Math.random() * 0.8);
      mesh.userData.vx    = Math.cos(a) * Math.cos(el) * s;
      mesh.userData.vy    = Math.sin(el) * s + 2;
      mesh.userData.vz    = Math.sin(a) * Math.cos(el) * s;
      mesh.userData.life  = life;
      mesh.userData.maxL  = life;
      scene.add(mesh);
      particles.push(mesh);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.userData.life -= dt;
      if (p.userData.life <= 0) {
        scene.remove(p);
        particles.splice(i, 1);
        continue;
      }
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.userData.vy -= 6 * dt; // gravity
      const a = p.userData.life / p.userData.maxL;
      p.scale.setScalar(a);
    }
  }

 function updateCamera(player) {
  const camDist = 9;
  const camH    = 7;

  // Position camera behind and above the player
  camera.position.set(
    player.x - Math.cos(aimAngle) * camDist,
    camH,
    player.z - Math.sin(aimAngle) * camDist
  );
  
  // Always look at a fixed point ahead of player on the ground
  // Don't use lookAhead - keep it simple and stable
  camera.lookAt(player.x, 0.5, player.z);

}
  /* ── Torch flicker ───────────────────────────── */
  function updateTorchFlicker(t) {
    if (!torchLight) return;
    const flicker = Math.sin(t * 4.3) * 0.18 + Math.sin(t * 7.1) * 0.12;
    torchLight.intensity = 2.8 + flicker * 0.8;

    // Lantern flicker
    for (const l of lanternLights) {
      const f = Math.sin(t * 3.5 + l.userData.flameOffset) * 0.15 +
                Math.sin(t * 6.2 + l.userData.flameOffset) * 0.08;
      l.intensity = l.userData.baseIntensity + f * 0.5;
    }
  }

  /* ── Hit flash on enemy ──────────────────────── */
 function flashEnemy(enemy) {
  const group = enemyMeshes[enemy.id];
  if (!group) return;
  group.traverse(child => {
    if (!child.isMesh) return;                          // skip sprites, groups
    const mat = child.material;
    if (!mat || mat.isMeshBasicMaterial) return;        // skip BasicMaterial — no emissive support
    mat.emissive = new THREE.Color(0xff4422);
    mat.emissiveIntensity = 1.0;
    setTimeout(() => {
      if (mat) {
        mat.emissive = new THREE.Color(0x000000);
        mat.emissiveIntensity = 0;
      }
    }, 80);
  });
}

  /* ── Player flash (when hit) ─────────────────── */
  function flashPlayer(on) {
    if (!playerMesh) return;
    playerMesh.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.emissive          = on ? new THREE.Color(0xff0000) : new THREE.Color(0x000000);
        child.material.emissiveIntensity = on ? 0.9 : 0;
      }
    });
  }

  /* ── Main render step ────────────────────────── */
  function render(player, t) {
    // Torch follows player
    if (torchLight && playerMesh) {
      torchLight.position.set(player.x + 0.4, 1.6, player.z + 0.4);
    }

    // Player mesh position + facing
    if (playerMesh) {
      playerMesh.position.set(player.x, 0, player.z);
      playerMesh.rotation.y = -aimAngle + Math.PI / 2;
    }

    // Portal spin
    if (exitPortal) {
      exitPortal.rotation.z += 0.025;
      if (portalGlow) {
        portalGlow.intensity = 2.0 + Math.sin(t * 3) * 0.5;
      }
    }

    updateCamera(player);
    renderer.render(scene, camera);
  }

  /* ── Texture helpers ─────────────────────────── */
  function makeBrickTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a0d06';
    ctx.fillRect(0, 0, 128, 128);
    const brickW = 32, brickH = 16;
    for (let row = 0; row < 8; row++) {
      const offset = (row % 2) * 16;
      for (let col = -1; col < 5; col++) {
        const bx = col * brickW + offset, by = row * brickH;
        const shade = 20 + Math.floor(Math.random() * 25);
        ctx.fillStyle = `rgb(${55+shade},${30+shade},${15+shade})`;
        ctx.fillRect(bx + 1, by + 1, brickW - 2, brickH - 2);
      }
    }
    ctx.strokeStyle = '#0f0805';
    ctx.lineWidth = 1;
    for (let row = 0; row <= 8; row++) {
      ctx.beginPath(); ctx.moveTo(0, row * brickH); ctx.lineTo(128, row * brickH); ctx.stroke();
    }
    return new THREE.CanvasTexture(c);
  }

 function makeFloorTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  
  // Lighter base stone color
  ctx.fillStyle = '#5a4a38';
  ctx.fillRect(0, 0, 256, 256);
  
  // Brick tiles with lighter variation
  const tileSize = 32;
  for (let y = 0; y < 256; y += tileSize) {
    for (let x = 0; x < 256; x += tileSize) {
      const shade = 50 + Math.floor(Math.random() * 50);
      ctx.fillStyle = `rgb(${88+shade},${68+shade},${48+shade})`;
      ctx.fillRect(x + 1, y + 1, tileSize - 2, tileSize - 2);
    }
  }
  
  // Grout lines
  ctx.strokeStyle = '#4a3a2a';
  ctx.lineWidth = 2;
  for (let y = 0; y <= 256; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  for (let x = 0; x <= 256; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  
  // Grass patches - more visible on lighter floor
  for (let i = 0; i < 100; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const size = 12 + Math.random() * 18;
    ctx.fillStyle = `rgba(100,160,80,${0.6 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  }
  
  return new THREE.CanvasTexture(c);
}
  function lightenHex(hex, factor) {
    const r = Math.min(255, ((hex >> 16) & 0xff) + Math.floor(((hex >> 16) & 0xff) * factor));
    const g = Math.min(255, ((hex >> 8)  & 0xff) + Math.floor(((hex >> 8)  & 0xff) * factor));
    const b = Math.min(255, ((hex)       & 0xff) + Math.floor(((hex)       & 0xff) * factor));
    return (r << 16) | (g << 8) | b;
  }

  /* ── Clear scene for new floor ───────────────── */
  function clearDynamic() {
    Object.values(enemyMeshes).forEach(m => scene.remove(m));
    enemyMeshes = {};
    chestMeshes.forEach(m => scene.remove(m));
    chestMeshes = [];
    particles.forEach(p => scene.remove(p));
    particles = [];
    removeExitPortal();
  }

  /* ── Mouse → world aim angle ─────────────────── */
// Replace the whole updateAimFromMouse function + lastMouseX:
let mouseDX = 0;  // raw delta from pointer lock

function updateAimFromMouse() {
  aimAngle += mouseDX * 0.004;  // sensitivity — tweak this
  mouseDX = 0;                  // consume the delta
  return aimAngle;
}

function initPointerLock() {
  const mount = document.getElementById('canvasMount');

  mount.addEventListener('click', () => {
    if (!document.pointerLockElement) {
      mount.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === mount) {
      document.addEventListener('mousemove', onLockedMouseMove);
    } else {
      document.removeEventListener('mousemove', onLockedMouseMove);
      mouseDX = 0;
      // Open pause menu when lock is lost (but only if game started)
      if (typeof UI !== 'undefined' && typeof Game !== 'undefined' && Game.getPlayer()) {
        UI.openPauseMenu();
      }
    }
  });
}function initPointerLock() {
  const mount = document.getElementById('canvasMount');

  mount.addEventListener('click', () => {
    if (!document.pointerLockElement) {
      mount.requestPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === mount) {
      document.addEventListener('mousemove', onLockedMouseMove);
    } else {
      document.removeEventListener('mousemove', onLockedMouseMove);
      mouseDX = 0;
      // Open pause menu when lock is lost (but only if game started)
      if (typeof UI !== 'undefined' && typeof Game !== 'undefined' && Game.getPlayer()) {
        UI.openPauseMenu();
      }
    }
  });
}
function onLockedMouseMove(e) {
  mouseDX += e.movementX;
}

function isPointerLocked() {
  return document.pointerLockElement === document.getElementById('canvasMount');
}
  return {
    init,
    resize,
    buildDungeon,
    buildPlayerMesh,
    buildEnemyMesh,
    updateEnemyHpBar,
    removeEnemyMesh,
    buildExitPortal,
    removeExitPortal,
    spawnParticles,
    updateParticles,
    updateTorchFlicker,
    flashEnemy,
    flashPlayer,
    render,
    clearDynamic,
    updateAimFromMouse,
    getAimAngle: () => aimAngle,
    isPointerLocked,
    chestMeshes,
    scene,
    camera,
    renderer,
    clock,
  };

})();
