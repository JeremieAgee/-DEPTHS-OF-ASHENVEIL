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

  const TORCH_COLOR   = 0xff8822;
  const LANTERN_COLOR = 0xffaa33;
  const AMBIENT_INT   = 0.04;

  /* ── Init renderer + scene ───────────────────── */
  function init() {
    const mount = document.getElementById('canvasMount');

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000);
    mount.appendChild(renderer.domElement);

    resize(); // set canvas size
    window.addEventListener('resize', resize);

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000000, 0.09);

    // Camera — third-person top-angled
    camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 120);

    // Minimal ambient so pitch-black areas stay dark
    ambientLight = new THREE.AmbientLight(0x110800, AMBIENT_INT);
    scene.add(ambientLight);
  }

  function resize() {
    const mount = document.getElementById('canvasMount');
    const w     = mount.clientWidth;
    const h     = Math.round(w * 9 / 16);
    mount.style.height = h + 'px';
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
    const floorMat = new THREE.MeshLambertMaterial({
      color: 0x1c1008,
      map: makeStoneTexture(),
    });
    const ceilMat = new THREE.MeshLambertMaterial({ color: 0x0d0803 });

    // ── Build walls + floor tiles ───────────────
    // Merge walls into fewer draw calls via instancing groups
    const wallGeo   = new THREE.BoxGeometry(TILE, WALL_H, TILE);
    const floorGeo  = new THREE.BoxGeometry(TILE, 0.2, TILE);

    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const wx = col * TILE + TILE / 2;
        const wz = row * TILE + TILE / 2;

        if (grid[row][col] === 1) {
          // Wall
          const wall = new THREE.Mesh(wallGeo, wallMat);
          wall.position.set(wx, WALL_H / 2, wz);
          wall.castShadow    = true;
          wall.receiveShadow = true;
          dungeonGroup.add(wall);
        } else {
          // Floor
          const floor = new THREE.Mesh(floorGeo, floorMat);
          floor.position.set(wx, -0.1, wz);
          floor.receiveShadow = true;
          dungeonGroup.add(floor);
          // Ceiling (thin)
          const ceil = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.15, TILE), ceilMat);
          ceil.position.set(wx, WALL_H + 0.07, wz);
          dungeonGroup.add(ceil);
        }
      }
    }

    scene.add(dungeonGroup);

    // ── Lanterns ────────────────────────────────
    const lanternGeo  = new THREE.BoxGeometry(0.18, 0.28, 0.18);
    const lanternMat  = new THREE.MeshBasicMaterial({ color: 0x3a1a00 });
    const flameMat    = new THREE.MeshBasicMaterial({ color: 0xff8822 });
    const flameGeo    = new THREE.SphereGeometry(0.12, 6, 5);

    for (const lan of dungeon.lanterns) {
      const wx = lan.x * TILE + TILE / 2;
      const wz = lan.y * TILE + TILE / 2;

      const body = new THREE.Mesh(lanternGeo, lanternMat);
      body.position.set(wx, WALL_H * 0.7, wz);
      scene.add(body);

      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(wx, WALL_H * 0.72, wz);
      flame.userData.isFlame = true;
      scene.add(flame);

      // Point light
      const light = new THREE.PointLight(LANTERN_COLOR, 1.2, 14);
      light.position.set(wx, WALL_H * 0.72, wz);
      light.userData.baseIntensity = 1.2;
      light.userData.flameOffset   = Math.random() * Math.PI * 2;
      scene.add(light);
      lanternLights.push(light);
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

    // Body
    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 10);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xc87020 });
    const body    = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7;
    group.add(body);

    // Head
    const headGeo = new THREE.SphereGeometry(0.28, 10, 8);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xd4a060 });
    const head    = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.55;
    group.add(head);

    // Cape
    const capeGeo = new THREE.PlaneGeometry(0.55, 0.9);
    const capeMat = new THREE.MeshLambertMaterial({ color: 0x1a0800, side: THREE.DoubleSide });
    const cape    = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, 0.8, 0.32);
    cape.rotation.x = 0.2;
    group.add(cape);

    // Torch (back-mounted)
    const torchGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.6, 6);
    const torchMat = new THREE.MeshLambertMaterial({ color: 0x5a2e08 });
    const torch    = new THREE.Mesh(torchGeo, torchMat);
    torch.position.set(0.3, 1.2, 0.3);
    torch.rotation.z = 0.3;
    group.add(torch);

    // Torch flame (emissive sphere)
    const fGeo = new THREE.SphereGeometry(0.12, 6, 5);
    const fMat = new THREE.MeshBasicMaterial({ color: 0xffcc44 });
    const flame = new THREE.Mesh(fGeo, fMat);
    flame.position.set(0.42, 1.55, 0.42);
    flame.userData.isTorchFlame = true;
    group.add(flame);

    playerMesh = group;
    scene.add(playerMesh);

    // Player torch light
    if (torchLight) scene.remove(torchLight);
    torchLight = new THREE.PointLight(TORCH_COLOR, 2.8, 18);
    torchLight.castShadow = true;
    torchLight.shadow.mapSize.set(512, 512);
    torchLight.shadow.camera.near = 0.2;
    torchLight.shadow.camera.far  = 20;
    scene.add(torchLight);

    return playerMesh;
  }

  /* ── Enemy mesh ──────────────────────────────── */
  function buildEnemyMesh(enemy) {
    const group = new THREE.Group();
    const def   = Enemies.TYPES[enemy.typeKey] || Enemies.BOSS_TYPE;
    const color = def.color;
    const h     = enemy.height;
    const r     = enemy.radius;

    if (enemy.isBoss) {
      // Boss: larger, horned silhouette
      const bodyGeo = new THREE.CylinderGeometry(r * 0.85, r, h * 0.75, 12);
      const bodyMat = new THREE.MeshLambertMaterial({ color });
      const body    = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = h * 0.4;
      group.add(body);
      const headGeo = new THREE.SphereGeometry(r * 0.75, 10, 8);
      const head    = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: 0xff3300 }));
      head.position.y = h * 0.85;
      group.add(head);
      // Horns
      const hornGeo = new THREE.ConeGeometry(0.1, 0.5, 5);
      const hornMat = new THREE.MeshLambertMaterial({ color: 0x220000 });
      [-0.25, 0.25].forEach(ox => {
        const horn = new THREE.Mesh(hornGeo, hornMat);
        horn.position.set(ox, h * 1.1, 0);
        horn.rotation.z = ox > 0 ? -0.4 : 0.4;
        group.add(horn);
      });
    } else {
      const bodyGeo = new THREE.CylinderGeometry(r * 0.8, r * 0.9, h * 0.7, 8);
      const bodyMat = new THREE.MeshLambertMaterial({ color });
      const body    = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = h * 0.38;
      group.add(body);
      const headGeo = new THREE.SphereGeometry(r * 0.6, 8, 6);
      const head    = new THREE.Mesh(headGeo, new THREE.MeshLambertMaterial({ color: lightenHex(color, 0.3) }));
      head.position.y = h * 0.82;
      group.add(head);
    }

    // HP bar sprite (CSS billboard) — done via canvas texture
    const canvas = document.createElement('canvas');
    canvas.width  = 128; canvas.height = 16;
    const ctx2    = canvas.getContext('2d');
    ctx2.fillStyle = '#300'; ctx2.fillRect(0, 0, 128, 16);
    ctx2.fillStyle = enemy.isBoss ? '#ff2200' : '#cc2200';
    ctx2.fillRect(1, 1, 126, 14);
    const hpTex  = new THREE.CanvasTexture(canvas);
    const hpMat  = new THREE.SpriteMaterial({ map: hpTex, depthTest: false });
    const hpSprite = new THREE.Sprite(hpMat);
    hpSprite.scale.set(enemy.isBoss ? 2.4 : 1.4, 0.22, 1);
    hpSprite.position.y = h + 0.4;
    hpSprite.userData.isHpBar = true;
    hpSprite.userData.hpTex   = hpTex;
    hpSprite.userData.canvas  = canvas;
    hpSprite.userData.ctx     = ctx2;
    hpSprite.userData.enemy   = enemy;
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

  /* ── Camera update ───────────────────────────── */
  function updateCamera(player) {
    // Third-person, slightly top-down angle behind player
    const camDist = 9;
    const camH    = 7;
    camera.position.set(
      player.x - Math.cos(aimAngle) * camDist * 0.4,
      camH,
      player.z - Math.sin(aimAngle) * camDist * 0.4 + camDist * 0.6
    );
    camera.lookAt(player.x, 1.0, player.z);
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
      if (child.isMesh && child.material) {
        const orig = child.material.color.getHex();
        child.material.emissive = new THREE.Color(0xff4422);
        child.material.emissiveIntensity = 1.0;
        setTimeout(() => {
          if (child.material) {
            child.material.emissive = new THREE.Color(0x000000);
            child.material.emissiveIntensity = 0;
          }
        }, 80);
      }
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

  function makeStoneTexture() {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c1008';
    ctx.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 64, y = Math.random() * 64;
      ctx.fillStyle = `rgba(30,18,8,${0.3+Math.random()*0.4})`;
      ctx.beginPath(); ctx.arc(x, y, 2+Math.random()*4, 0, Math.PI*2); ctx.fill();
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
  function updateAimFromMouse(mx, my, player) {
    const mount  = document.getElementById('canvasMount');
    const rect   = mount.getBoundingClientRect();
    const ndcX   = ((mx - rect.left)  / rect.width)  * 2 - 1;
    const ndcY   = -((my - rect.top)  / rect.height) * 2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    // intersect y=0 plane
    const plane  = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const target = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, target)) {
      aimAngle = Math.atan2(target.z - player.z, target.x - player.x);
    }
    return aimAngle;
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
    chestMeshes,
    get aimAngle()  { return aimAngle; },
    get scene()     { return scene; },
    get camera()    { return camera; },
    get renderer()  { return renderer; },
    clock,
  };

})();
