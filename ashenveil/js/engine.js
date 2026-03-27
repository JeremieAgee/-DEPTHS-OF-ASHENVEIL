/* ═══════════════════════════════════════════════════
   engine.js  —  Three.js scene, renderer, lighting,
                 geometry, particles, camera
   Exports: Engine (namespace)
════════════════════════════════════════════════════ */
const Engine = (() => {

  /* ── Internal state ──────────────────────────── */
  let renderer, scene, camera;
  let playerMesh, torchLight, ambientLight;
  let enemyMeshes   = {};
  let particles     = [];
  let chestMeshes   = [];
  let stairsMesh    = null;
  let doorMesh      = null;
  let doorOpen      = false;
  let clock         = new THREE.Clock();
  let dungeonGroup  = null;
  let lanternLights = [];
  let aimAngle      = 0;

  // Stair descent animation
  let stairDescending      = false;
  let stairDescentTime     = 0;
  let stairDescentDone     = false;
  let stairDescentCallback = null;
  let stairDescentOrigin   = { x: 0, z: 0 };
  let stairDescentTarget   = { x: 0, z: 0 };

  const TORCH_COLOR   = 0xff8822;
  const LANTERN_COLOR = 0xffaa33;
  const AMBIENT_INT   = 0.6;

  /* ── Init ────────────────────────────────────── */
  function init() {
    const mount = document.getElementById('canvasMount');
    initPointerLock();

    if (!renderer) {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type    = THREE.PCFSoftShadowMap;
      renderer.setClearColor(0x000000, 0.25);
      mount.appendChild(renderer.domElement);
      window.addEventListener('resize', resize);
    }

    if (!scene) {
      scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x000000, 0.01);
    }

    if (!camera) {
      camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 100);
    }

    if (!ambientLight) {
      ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INT);
      scene.add(ambientLight);
    }

    resize();
  }

  function resize() {
    const mount = document.getElementById('canvasMount');
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (renderer) renderer.setSize(w, h);
    if (camera)   { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  }

  /* ── Build dungeon geometry ──────────────────── */
  function buildDungeon(dungeon) {
    // Remove old dungeon group and lanterns
    if (dungeonGroup) scene.remove(dungeonGroup);
    lanternLights.forEach(l => scene.remove(l));
    lanternLights = [];
    if (doorMesh)  { scene.remove(doorMesh);  doorMesh  = null; doorOpen = false; }
    if (stairsMesh){ scene.remove(stairsMesh); stairsMesh = null; }

    dungeonGroup = new THREE.Group();
    const { TILE, WALL_H, grid, COLS, ROWS } = dungeon;

    // ── Materials ──────────────────────────────
    const brickTex = makeBrickTexture();
    brickTex.wrapS = brickTex.wrapT = THREE.RepeatWrapping;
    const wallMat  = new THREE.MeshLambertMaterial({ map: brickTex, color: 0x8a6a4a });

    const floorTex = makeFloorTexture();
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x6a5a48, map: floorTex });

    const bossFloorMat = new THREE.MeshLambertMaterial({
      color: 0x3a2a1a,
      map: makeBossFloorTexture(),
    });

    const br = dungeon.bossRoom;
    function isBossRoom(row, col) {
      return row >= br.y && row < br.y + br.h &&
             col >= br.x && col < br.x + br.w;
    }

    const wallGeo  = new THREE.BoxGeometry(TILE, WALL_H, TILE);
    const floorGeo = new THREE.BoxGeometry(TILE, 0.25, TILE);

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
          const mat   = isBossRoom(row, col) ? bossFloorMat : floorMat;
          const floor = new THREE.Mesh(floorGeo, mat);
          floor.position.set(wx, -0.1, wz);
          floor.receiveShadow = true;
          dungeonGroup.add(floor);
        }
      }
    }

    scene.add(dungeonGroup);

    // ── Lanterns ────────────────────────────────
    const lanternGeo = new THREE.BoxGeometry(0.18, 0.28, 0.18);
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0x3a1a00 });
    const flameMat   = new THREE.MeshBasicMaterial({ color: 0xff8822 });
    const flameGeo   = new THREE.SphereGeometry(0.12, 6, 5);
    const bracketMat = new THREE.MeshLambertMaterial({ color: 0x4a3a2a });

    for (const lan of dungeon.lanterns) {
      const gx = lan.x, gy = lan.y;
      const wx = gx * TILE + TILE / 2;
      const wz = gy * TILE + TILE / 2;

      let wallDirection = null, offsetX = 0, offsetZ = 0, rotationY = 0;

      if      (gy > 0       && grid[gy-1][gx] === 1) { wallDirection='north'; offsetZ=-TILE/2+0.3; rotationY=0; }
      else if (gy < ROWS-1  && grid[gy+1][gx] === 1) { wallDirection='south'; offsetZ= TILE/2-0.3; rotationY=Math.PI; }
      else if (gx > 0       && grid[gy][gx-1] === 1) { wallDirection='west';  offsetX=-TILE/2+0.3; rotationY=Math.PI/2; }
      else if (gx < COLS-1  && grid[gy][gx+1] === 1) { wallDirection='east';  offsetX= TILE/2-0.3; rotationY=-Math.PI/2; }

      if (wallDirection) {
        const lx = wx + offsetX;
        const lz = wz + offsetZ;

        const bracketGeo = new THREE.BoxGeometry(0.12, 0.08, 0.4);
        const bracket = new THREE.Mesh(bracketGeo, bracketMat);
        bracket.position.set(lx - Math.cos(rotationY)*0.15, WALL_H*0.7, lz - Math.sin(rotationY)*0.15);
        bracket.rotation.y = rotationY;
        scene.add(bracket);

        const body = new THREE.Mesh(lanternGeo, lanternMat);
        body.position.set(lx, WALL_H*0.7, lz);
        scene.add(body);

        const flame = new THREE.Mesh(flameGeo, flameMat);
        flame.position.set(lx, WALL_H*0.72, lz);
        scene.add(flame);

        const light = new THREE.PointLight(LANTERN_COLOR, 1.5, 14);
        light.position.set(lx, WALL_H*0.72, lz);
        light.userData.baseIntensity = 1.5;
        light.userData.flameOffset   = Math.random() * Math.PI * 2;
        scene.add(light);
        lanternLights.push(light);
      }
    }

    // ── Boss door ────────────────────────────────
    buildBossDoor(dungeon);

    // ── Chests ──────────────────────────────────
    buildChests(dungeon);
  }

  /* ── Boss room door ──────────────────────────── */
  // Door sits in the WALL tile just outside the entrance opening,
  // oriented so it fills the gap and blocks passage until opened.
  function buildBossDoor(dungeon) {
    const { bossEntrance, TILE, WALL_H } = dungeon;
    if (!bossEntrance) return;

    // Place the door at the wall tile outside the entrance (wallTx, wallTy)
    // That tile is still a wall tile in the grid — the door stands there visually
    // and the player collision keeps them out until the door swings open.
    const wx = bossEntrance.wallTx * TILE + TILE / 2; // 
    const wz = bossEntrance.wallTy * TILE + TILE / 2; //

    const doorGroup = new THREE.Group();

    // Stone archway / frame embedded in the wall
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, metalness: 0.5, roughness: 0.6 });
    const frameGeo = new THREE.BoxGeometry(TILE - 0.3, WALL_H, TILE / 2);
    const frame    = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = WALL_H / 2;
    doorGroup.add(frame);

    // Two door planks
    const plankMat = new THREE.MeshLambertMaterial({ color: 0x2c1200 });
    for (let s = -1; s <= 1; s += 2) {
      const plankGeo = new THREE.BoxGeometry(TILE / 2 - 0.1, WALL_H - 0.2, -0.2);
      const plank    = new THREE.Mesh(plankGeo, plankMat);
      plank.position.set(s * (TILE / 4), WALL_H / 2, -1);
      plank.castShadow = true;
      doorGroup.add(plank);

      // Iron crossbars
      const barMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.9, roughness: 0.2 });
      [WALL_H * 0.55, WALL_H * 0.33].forEach(barY => {
        const barGeo = new THREE.BoxGeometry(TILE / 2 - 0.15, 0.1, 0.2);
        const bar    = new THREE.Mesh(barGeo, barMat);
        bar.position.set(s * (TILE / 4), barY, 0);
        doorGroup.add(bar);
      });
    }

    // Skull above
    const skullGeo = new THREE.SphereGeometry(0.22, 8, 6);
    const skullMat = new THREE.MeshLambertMaterial({ color: 0xddccaa });
    const skull    = new THREE.Mesh(skullGeo, skullMat);
    skull.position.set(0, WALL_H + 0.1, 0);
    skull.scale.set(1, 1.15, 0.85);
    doorGroup.add(skull);

    // Red glow
    const doorLight = new THREE.PointLight(0x990000, 1.2, 8);
    doorLight.position.set(0, WALL_H * 0.8, 0.5);
    doorGroup.add(doorLight);

    // Orient: door face should be perpendicular to the corridor direction
    const side = bossEntrance.side;
    // north/south entrance → corridor runs N-S → door faces N-S → rotate 0
    // east/west entrance   → corridor runs E-W → door faces E-W → rotate 90°
    doorGroup.rotation.y = (side === 'east' || side === 'west') ? Math.PI / 2 : 0;
    doorGroup.position.set(wx, 0, wz);

    doorGroup.userData.isDoor      = true;
    doorGroup.userData.side        = side;
    doorGroup.userData.openAngle   = 0;
    doorGroup.userData.targetAngle = 0;
    scene.add(doorGroup);
    doorMesh = doorGroup;
    doorOpen = false;
  }

  function openBossDoor() {
    if (!doorMesh || doorOpen) return;
    doorOpen = true;
    doorMesh.userData.targetAngle = Math.PI / 2;
  }

  function updateDoor(dt) {
    if (!doorMesh) return;
    const d = doorMesh.userData;
    if (Math.abs(d.openAngle - d.targetAngle) > 0.005) {
      d.openAngle += (d.targetAngle - d.openAngle) * Math.min(dt * 3, 1);
      // Swing around Y — pivot is at door position
      const side = d.side;
      const baseY = (side === 'east' || side === 'west') ? Math.PI / 2 : 0;
      doorMesh.rotation.y = baseY + d.openAngle;
    }
  }

  /* ── Stairs (only built after boss dies) ─────── */
  function buildStairs(dungeon) {
    if (stairsMesh) { scene.remove(stairsMesh); stairsMesh = null; }
    const { stairsPos, TILE, WALL_H } = dungeon;
    if (!stairsPos) return;

    const w   = dungeon.toWorld(stairsPos.gx, stairsPos.gy);
    const grp = new THREE.Group();

    const STEP_COUNT = -7;
    const STEP_W     = 2.2;
    const STEP_H     = -0.22;
    const STEP_D     = 0.40;
    const stoneMat   = new THREE.MeshLambertMaterial({ color: 0x2a1f14 });
    const edgeMat    = new THREE.MeshLambertMaterial({ color: 0x5a4a30 });

    for (let i = 0; i < STEP_COUNT; i++) {
      const stepGeo = new THREE.BoxGeometry(STEP_W, STEP_H, STEP_D);
      const step    = new THREE.Mesh(stepGeo, stoneMat);
      step.position.set(0, i * STEP_H, -i * STEP_D);
      step.castShadow    = true;
      step.receiveShadow = true;
      grp.add(step);

      // Edge highlight
      const edgeGeo = new THREE.BoxGeometry(STEP_W + 0.04, 0.04, 0.04);
      const edge    = new THREE.Mesh(edgeGeo, edgeMat);
      edge.position.set(0, i * STEP_H + STEP_H / 2, -i * STEP_D - STEP_D / 2);
      grp.add(edge);
    }

    // Railing posts
    const postMat = new THREE.MeshStandardMaterial({ color: 0x7a5020, metalness: 0.5, roughness: 0.5 });
    for (let i = 0; i < STEP_COUNT; i += 2) {
      for (const ox of [-STEP_W / 2 - 0.1, STEP_W / 2 + 0.1]) {
        const postGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.65, 6);
        const post    = new THREE.Mesh(postGeo, postMat);
        post.position.set(ox, i * STEP_H + 0.32, -i * STEP_D);
        grp.add(post);
      }
    }

    // Purple glow light above stairs
    const stairLight = new THREE.PointLight(0x6622cc, 2.0, 10);
    stairLight.position.set(0, STEP_COUNT * STEP_H + 0.8, 0);
    grp.add(stairLight);

    // Portal disc at the bottom step
    const portalGeo  = new THREE.CircleGeometry(1.0, 32);
    const portalMat  = new THREE.MeshBasicMaterial({ color: 0x8844ff, side: THREE.DoubleSide });
    const portalDisc = new THREE.Mesh(portalGeo, portalMat);
    portalDisc.rotation.x = -Math.PI / 2;
    portalDisc.position.set(0, 0.06, -(STEP_COUNT - 1) * STEP_D);
    portalDisc.userData.isPortalDisc = true;
    grp.add(portalDisc);

    const ringGeo = new THREE.TorusGeometry(1.0, 0.09, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xaa66ff });
    const ring    = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.14, -(STEP_COUNT - 1) * STEP_D);
    ring.userData.isPortalRing = true;
    grp.add(ring);

    grp.position.set(w.x, 0, w.z);
    grp.userData.isStairs = true;
    grp.userData.STEP_COUNT = STEP_COUNT;
    grp.userData.STEP_D     = STEP_D;
    scene.add(grp);
    stairsMesh = grp;
  }

  /* ── Stair descent animation ─────────────────── */
  function startStairDescent(player, dungeon, onComplete) {
    if (stairDescending) return;
    stairDescending      = true;
    stairDescentTime     = 0;
    stairDescentDone     = false;
    stairDescentCallback = onComplete;

    const w = dungeon.toWorld(dungeon.stairsPos.gx, dungeon.stairsPos.gy);
    const STEP_COUNT = stairsMesh ? stairsMesh.userData.STEP_COUNT : 7;
    const STEP_D     = stairsMesh ? stairsMesh.userData.STEP_D     : 0.40;

    stairDescentOrigin = { x: player.x, z: player.z };
    stairDescentTarget = { x: w.x, z: w.z - (STEP_COUNT - 1) * STEP_D };
  }

  function tickStairDescent(player, dt) {
    if (!stairDescending || stairDescentDone) return;
    const DURATION = 2.2;
    stairDescentTime = Math.min(stairDescentTime + dt, DURATION);
    const t    = stairDescentTime / DURATION;
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;

    player.x = stairDescentOrigin.x + (stairDescentTarget.x - stairDescentOrigin.x) * ease;
    player.z = stairDescentOrigin.z + (stairDescentTarget.z - stairDescentOrigin.z) * ease;
    player._descentY = -ease * 1.8;

    const overlay = document.getElementById('stairOverlay');
    if (overlay) overlay.style.opacity = ease > 0.5 ? '1' : String(ease * 2);

    if (stairDescentTime >= DURATION) {
      stairDescentDone = true;
      stairDescending  = false;
      player._descentY = 0;
      if (stairDescentCallback) stairDescentCallback();
    }
  }

  /* ── Chests ──────────────────────────────────── */
  function buildChests(dungeon) {
    chestMeshes.forEach(m => scene.remove(m));
    chestMeshes = [];

    const chestBodyGeo = new THREE.BoxGeometry(0.7, 0.45, 0.55);
    const chestMat     = new THREE.MeshLambertMaterial({ color: 0x7a4810 });
    const chestLidGeo  = new THREE.BoxGeometry(0.7, 0.20, 0.55);
    const lidMat       = new THREE.MeshLambertMaterial({ color: 0x5a3008 });
    const bandMat      = new THREE.MeshStandardMaterial({ color: 0xb87820, metalness: 0.8, roughness: 0.3 });
    const bandGeo      = new THREE.BoxGeometry(0.72, 0.06, 0.57);

    for (const chest of dungeon.chests) {
      const w  = dungeon.toWorld(chest.gx, chest.gy);
      const grp = new THREE.Group();

      const body = new THREE.Mesh(chestBodyGeo, chestMat);
      body.position.y = 0.225;
      body.castShadow = true;
      grp.add(body);

      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.set(0, 0.25, 0);
      grp.add(band);

      // Lid as direct child — we animate its rotation.x
      // Pivot point is at the back top edge of the body.
      // We position the lid group at the hinge point.
      const lidGroup = new THREE.Group();
      lidGroup.position.set(0, 0.45, 0.275);  // back top edge of chest body
      const lid = new THREE.Mesh(chestLidGeo, lidMat);
      lid.position.set(0, 0, -0.275);          // lid hangs forward from hinge
      lid.castShadow = true;
      lidGroup.add(lid);
      grp.add(lidGroup);

      // Lock
      const lockGeo = new THREE.BoxGeometry(0.12, 0.12, 0.06);
      const lockMat = new THREE.MeshStandardMaterial({ color: 0xd4a010, metalness: 0.9, roughness: 0.2 });
      const lock    = new THREE.Mesh(lockGeo, lockMat);
      lock.position.set(0, 0.3, -0.28);
      grp.add(lock);

      grp.position.set(w.x, 0, w.z);
      grp.userData.chestData   = chest;
      grp.userData.lidGroup    = lidGroup;
      grp.userData.lidOpenT    = 0;
      grp.userData.isOpening   = false;
      scene.add(grp);
      chestMeshes.push(grp);
    }
  }

  function updateChests(dt) {
    for (const g of chestMeshes) {
      if (!g.userData.isOpening) continue;
      g.userData.lidOpenT = Math.min(g.userData.lidOpenT + dt * 2.0, 1);
      const t    = g.userData.lidOpenT;
      const ease = 1 - Math.pow(1 - t, 3);
      const lg   = g.userData.lidGroup;
      if (lg) lg.rotation.x = -ease * (Math.PI * 0.85); // open ~153°
      if (t >= 1) g.userData.isOpening = false;
    }
  }

  /* ── Proximity prompts ───────────────────────── */
  function updateChestPrompt(player) {
    const el = document.getElementById('chestPrompt');
    if (!el) return;
    let near = false;
    for (const g of chestMeshes) {
      if (g.userData.chestData.opened) continue;
      const dx = player.x - g.position.x;
      const dz = player.z - g.position.z;
      if (dx*dx + dz*dz < 6.25) { near = true; break; } // 2.5^2
    }
    el.style.opacity = near ? '1' : '0';
  }

  function updateStairPrompt(player, exitOpen, dungeon) {
    const el = document.getElementById('stairPrompt');
    if (!el) return;
    if (!exitOpen || !dungeon.stairsPos || !stairsMesh) { el.style.opacity = '0'; return; }
    const w  = dungeon.toWorld(dungeon.stairsPos.gx, dungeon.stairsPos.gy);
    const dx = player.x - w.x, dz = player.z - w.z;
    el.style.opacity = (dx*dx + dz*dz) < (dungeon.TILE * 2.5) ** 2 ? '1' : '0';
  }

  /* ── Player mesh ─────────────────────────────── */
  function buildPlayerMesh() {
    if (playerMesh) scene.remove(playerMesh);

    const group = new THREE.Group();

    const bodyGeo = new THREE.CylinderGeometry(0.3, 0.3, 1.2, 10);
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0xc87020 });
    const body    = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.7; body.castShadow = true;
    group.add(body);

    const cpGeo = new THREE.BoxGeometry(0.35, 0.7, 0.15);
    const cpMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
    const cp    = new THREE.Mesh(cpGeo, cpMat);
    cp.position.set(0, 0.8, -0.1);
    group.add(cp);

    const headGeo = new THREE.SphereGeometry(0.28, 10, 8);
    const headMat = new THREE.MeshLambertMaterial({ color: 0xd4a060 });
    const head    = new THREE.Mesh(headGeo, headMat);
    head.position.y = 1.55;
    group.add(head);

    const helmGeo = new THREE.ConeGeometry(0.3, 0.35, 8);
    const helmMat = new THREE.MeshStandardMaterial({ color: 0x666666, metalness: 0.7, roughness: 0.3 });
    const helm    = new THREE.Mesh(helmGeo, helmMat);
    helm.position.y = 1.75;
    group.add(helm);

    const capeGeo = new THREE.PlaneGeometry(0.55, 0.9);
    const capeMat = new THREE.MeshLambertMaterial({ color: 0x2a1800, side: THREE.DoubleSide });
    const cape    = new THREE.Mesh(capeGeo, capeMat);
    cape.position.set(0, 0.8, 0.32); cape.rotation.x = 0.2;
    group.add(cape);

    const thGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8);
    const thMat = new THREE.MeshLambertMaterial({ color: 0x4a2e08 });
    const th    = new THREE.Mesh(thGeo, thMat);
    th.position.set(0.3, 1.2, 0.3); th.rotation.z = 0.3;
    group.add(th);

    const fGeo = new THREE.SphereGeometry(0.14, 6, 5);
    const fMat = new THREE.MeshBasicMaterial({ color: 0xffcc44 });
    const f    = new THREE.Mesh(fGeo, fMat);
    f.position.set(0.42, 1.55, 0.42);
    group.add(f);

    const sbGeo = new THREE.BoxGeometry(0.08, 0.8, 0.02);
    const sbMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.1 });
    const sb    = new THREE.Mesh(sbGeo, sbMat);
    sb.position.set(-0.25, 0.9, 0.1); sb.rotation.z = 0.3;
    group.add(sb);

    const gGeo = new THREE.BoxGeometry(0.25, 0.08, 0.08);
    const gMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 });
    const gd   = new THREE.Mesh(gGeo, gMat);
    gd.position.set(-0.25, 0.5, 0.1);
    group.add(gd);

    const hGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.25, 6);
    const hMat = new THREE.MeshLambertMaterial({ color: 0x5a3a20 });
    const h    = new THREE.Mesh(hGeo, hMat);
    h.position.set(-0.25, 0.3, 0.1); h.rotation.z = 0.3;
    group.add(h);

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

  /* ── Enemy mesh ──────────────────────────────── */
  function buildEnemyMesh(enemy) {
    const group = new THREE.Group();
    const def   = Enemies.TYPES[enemy.typeKey] || Enemies.BOSS_TYPE;
    const color = def.color;
    const h     = enemy.height;
    const r     = enemy.radius;

    if (enemy.isBoss) {
      const bodyGeo = new THREE.CylinderGeometry(r*0.85, r, h*0.75, 12);
      const bodyMat = new THREE.MeshStandardMaterial({ color, metalness:0.4, roughness:0.6, emissive:0x220000, emissiveIntensity:0.3 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = h*0.4; body.castShadow = true;
      group.add(body);

      const headGeo = new THREE.SphereGeometry(r*0.75, 10, 8);
      const headMat = new THREE.MeshStandardMaterial({ color:0xff3300, emissive:0xff0000, emissiveIntensity:0.5, metalness:0.5, roughness:0.4 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = h*0.85;
      group.add(head);

      const hornGeo = new THREE.ConeGeometry(0.1, 0.5, 5);
      const hornMat = new THREE.MeshStandardMaterial({ color:0x1a0000, metalness:0.6, roughness:0.2 });
      [-0.25, 0.25].forEach(ox => {
        const horn = new THREE.Mesh(hornGeo, hornMat);
        horn.position.set(ox, h*1.1, 0);
        horn.rotation.z = ox > 0 ? -0.4 : 0.4;
        group.add(horn);
      });
    } else {
      const bodyGeo = new THREE.CylinderGeometry(r*0.8, r*0.9, h*0.7, 8);
      const bodyMat = new THREE.MeshStandardMaterial({ color, metalness:0.3, roughness:0.7 });
      const body = new THREE.Mesh(bodyGeo, bodyMat);
      body.position.y = h*0.38; body.castShadow = true;
      group.add(body);

      const headGeo = new THREE.SphereGeometry(r*0.6, 8, 6);
      const headMat = new THREE.MeshStandardMaterial({ color: lightenHex(color, 0.3), metalness:0.2, roughness:0.8 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = h*0.82;
      group.add(head);
    }

    // HP bar sprite
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 16;
    const ctx2 = canvas.getContext('2d');
    ctx2.fillStyle = '#300'; ctx2.fillRect(0, 0, 128, 16);
    ctx2.fillStyle = enemy.isBoss ? '#ff2200' : '#cc2200';
    ctx2.fillRect(1, 1, 126, 14);
    const hpTex    = new THREE.CanvasTexture(canvas);
    const hpMat    = new THREE.SpriteMaterial({ map: hpTex, depthTest: false });
    const hpSprite = new THREE.Sprite(hpMat);
    hpSprite.scale.set(enemy.isBoss ? 2.4 : 1.4, 0.22, 1);
    hpSprite.position.y = h + 0.4;
    hpSprite.userData = { isHpBar: true, hpTex, canvas, ctx: ctx2, enemy };
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

  /* ── Exit (build stairs after boss dies) ─────── */
  function buildExitPortal(dungeon) {
    buildStairs(dungeon);
  }

  function removeExitPortal() {
    if (stairsMesh) { scene.remove(stairsMesh); stairsMesh = null; }
  }

  /* ── Particles ───────────────────────────────── */
  function spawnParticles(x, y, z, color, count = 8, speed = 3, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const geo  = new THREE.SphereGeometry(0.06 + Math.random()*0.08, 4, 3);
      const mat  = new THREE.MeshBasicMaterial({ color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      const a  = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.5) * Math.PI;
      const s  = speed * (0.5 + Math.random() * 0.8);
      mesh.userData = {
        vx: Math.cos(a)*Math.cos(el)*s,
        vy: Math.sin(el)*s + 2,
        vz: Math.sin(a)*Math.cos(el)*s,
        life, maxL: life,
      };
      scene.add(mesh);
      particles.push(mesh);
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.userData.life -= dt;
      if (p.userData.life <= 0) { scene.remove(p); particles.splice(i, 1); continue; }
      p.position.x += p.userData.vx * dt;
      p.position.y += p.userData.vy * dt;
      p.position.z += p.userData.vz * dt;
      p.userData.vy -= 6 * dt;
      p.scale.setScalar(p.userData.life / p.userData.maxL);
    }
  }

  /* ── Torch / lantern flicker ─────────────────── */
  function updateTorchFlicker(t) {
    if (!torchLight) return;
    const flicker = Math.sin(t*4.3)*0.18 + Math.sin(t*7.1)*0.12;
    torchLight.intensity = 2.8 + flicker * 0.8;

    for (const l of lanternLights) {
      const f = Math.sin(t*3.5 + l.userData.flameOffset)*0.15 +
                Math.sin(t*6.2 + l.userData.flameOffset)*0.08;
      l.intensity = l.userData.baseIntensity + f * 0.5;
    }
  }

  /* ── Camera ──────────────────────────────────── */
  function updateCamera(player) {
    const camDist  = 9;
    const camH     = 7;
    const descentY = player._descentY || 0;

    camera.position.set(
      player.x - Math.cos(aimAngle) * camDist,
      camH + descentY,
      player.z - Math.sin(aimAngle) * camDist
    );
    camera.lookAt(player.x, 0.5 + descentY, player.z);
  }

  /* ── Flash player ────────────────────────────── */
  function flashPlayer(on) {
    if (!playerMesh) return;
    playerMesh.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.emissive          = on ? new THREE.Color(0xff0000) : new THREE.Color(0x000000);
        child.material.emissiveIntensity = on ? 0.9 : 0;
      }
    });
  }

  /* ── Main render ─────────────────────────────── */
  function render(player, t, dt) {
    if (torchLight && playerMesh) {
      torchLight.position.set(player.x + 0.4, 1.6, player.z + 0.4);
    }
    if (playerMesh) {
      playerMesh.position.set(player.x, player._descentY || 0, player.z);
      playerMesh.rotation.y = -aimAngle + Math.PI / 2;
    }

    // Spin stair portal
    if (stairsMesh) {
      stairsMesh.children.forEach(c => {
        if (c.userData.isPortalDisc) c.rotation.z += 0.02;
        if (c.userData.isPortalRing) c.rotation.z -= 0.015;
      });
    }

    updateDoor(dt || 0.016);
    updateCamera(player);
    renderer.render(scene, camera);
  }

  /* ── Clear dynamic objects ───────────────────── */
  function clearDynamic() {
    Object.values(enemyMeshes).forEach(m => scene.remove(m));
    enemyMeshes = {};
    chestMeshes.forEach(m => scene.remove(m));
    chestMeshes = [];
    particles.forEach(p => scene.remove(p));
    particles = [];
    if (stairsMesh) { scene.remove(stairsMesh); stairsMesh = null; }
    if (doorMesh)   { scene.remove(doorMesh);   doorMesh  = null; doorOpen = false; }
    stairDescending  = false;
    stairDescentDone = false;
  }

  /* ── Texture helpers ─────────────────────────── */
  function makeBrickTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a0d06'; ctx.fillRect(0, 0, 128, 128);
    const bW = 32, bH = 16;
    for (let row = 0; row < 8; row++) {
      const off = (row % 2) * 16;
      for (let col = -1; col < 5; col++) {
        const shade = 20 + Math.floor(Math.random() * 25);
        ctx.fillStyle = `rgb(${55+shade},${30+shade},${15+shade})`;
        ctx.fillRect(col*bW+off+1, row*bH+1, bW-2, bH-2);
      }
    }
    ctx.strokeStyle = '#0f0805'; ctx.lineWidth = 1;
    for (let row = 0; row <= 8; row++) { ctx.beginPath(); ctx.moveTo(0,row*bH); ctx.lineTo(128,row*bH); ctx.stroke(); }
    return new THREE.CanvasTexture(c);
  }

  function makeFloorTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#5a4a38'; ctx.fillRect(0, 0, 256, 256);
    const ts = 32;
    for (let y = 0; y < 256; y += ts) {
      for (let x = 0; x < 256; x += ts) {
        const shade = 50 + Math.floor(Math.random() * 50);
        ctx.fillStyle = `rgb(${88+shade},${68+shade},${48+shade})`;
        ctx.fillRect(x+1, y+1, ts-2, ts-2);
      }
    }
    ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 2;
    for (let y = 0; y <= 256; y += ts) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(256,y); ctx.stroke(); }
    for (let x = 0; x <= 256; x += ts) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,256); ctx.stroke(); }
    for (let i = 0; i < 60; i++) {
      const x = Math.random()*256, y = Math.random()*256, sz = 8+Math.random()*14;
      ctx.fillStyle = `rgba(70,110,50,${0.3+Math.random()*0.3})`;
      ctx.beginPath(); ctx.arc(x,y,sz,0,Math.PI*2); ctx.fill();
    }
    return new THREE.CanvasTexture(c);
  }

  function makeBossFloorTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1a1208'; ctx.fillRect(0, 0, 256, 256);
    const ts = 40;
    for (let y = 0; y < 256; y += ts) {
      for (let x = 0; x < 256; x += ts) {
        const shade = Math.floor(Math.random()*20);
        ctx.fillStyle = `rgb(${28+shade},${18+shade},${10+shade})`;
        ctx.fillRect(x+1, y+1, ts-2, ts-2);
      }
    }
    ctx.strokeStyle = '#3a0808'; ctx.lineWidth = 1.5;
    for (let y = 0; y <= 256; y += ts) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(256,y); ctx.stroke(); }
    for (let x = 0; x <= 256; x += ts) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,256); ctx.stroke(); }
    ctx.fillStyle = 'rgba(120,0,0,0.18)';
    ctx.beginPath(); ctx.arc(128,128,60,0,Math.PI*2); ctx.fill();
    return new THREE.CanvasTexture(c);
  }

  function lightenHex(hex, factor) {
    const r = Math.min(255, ((hex>>16)&0xff) + Math.floor(((hex>>16)&0xff)*factor));
    const g = Math.min(255, ((hex>>8) &0xff) + Math.floor(((hex>>8) &0xff)*factor));
    const b = Math.min(255, ((hex)    &0xff) + Math.floor(((hex)    &0xff)*factor));
    return (r<<16)|(g<<8)|b;
  }

  /* ── Pointer lock ────────────────────────────── */
  let mouseDX = 0;

  function updateAimFromMouse() {
    aimAngle += mouseDX * 0.004;
    mouseDX = 0;
    return aimAngle;
  }

  function initPointerLock() {
    const mount = document.getElementById('canvasMount');
    mount.addEventListener('click', () => {
      if (!document.pointerLockElement) mount.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === mount) {
        document.addEventListener('mousemove', onLockedMouseMove);
      } else {
        document.removeEventListener('mousemove', onLockedMouseMove);
        mouseDX = 0;
        if (typeof UI !== 'undefined' && typeof Game !== 'undefined' && Game.getPlayer()) {
          UI.openPauseMenu();
        }
      }
    });
  }

  function onLockedMouseMove(e) { mouseDX += e.movementX; }
  function isPointerLocked() {
    return document.pointerLockElement === document.getElementById('canvasMount');
  }

  return {
    init, resize,
    buildDungeon,
    buildPlayerMesh,
    buildEnemyMesh, updateEnemyHpBar, removeEnemyMesh,
    buildExitPortal, removeExitPortal,
    openBossDoor,
    startStairDescent, tickStairDescent,
    updateChests, updateChestPrompt, updateStairPrompt,
    spawnParticles, updateParticles,
    updateTorchFlicker,
    flashPlayer,
    render,
    clearDynamic,
    updateAimFromMouse,
    getAimAngle: () => aimAngle,
    isPointerLocked,
    chestMeshes,
    scene, camera, renderer, clock,
  };

})();