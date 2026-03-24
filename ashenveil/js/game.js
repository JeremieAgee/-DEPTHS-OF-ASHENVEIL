/* ═══════════════════════════════════════════════════
   game.js  —  Main loop, state, floor transitions,
               input wiring, chest interaction
   Exports: Game (namespace)
════════════════════════════════════════════════════ */
const Game = (() => {

  /* ── State ───────────────────────────────────── */
  let player    = null;
  let dungeon   = null;
  let enemies   = [];
  let floor     = 1;
  let running   = false;
  let bossSpawned   = false;
  let bossDefeated  = false;
  let exitOpen      = false;

  const keys    = {};
  let mouseX    = 0;
  let mouseY    = 0;
  let rafId     = null;

  /* ── Input ───────────────────────────────────── */
  function wireInput() {
    document.addEventListener('keydown', e => {
      keys[e.key.toLowerCase()] = true;
      if (!running) return;
      if (e.key.toLowerCase() === 'i') UI.togglePanel('inv');
      if (e.key.toLowerCase() === 'k') UI.togglePanel('skills');
      if (e.key.toLowerCase() === 'e') tryInteract();
      if (e.key === ' ')               tryBlink();
      // Prevent scroll on arrow keys
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))
        e.preventDefault();
    });
    document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

    const mount = document.getElementById('canvasMount');
    mount.addEventListener('mousemove', e => {
      mouseX = e.clientX;
      mouseY = e.clientY;
    });
    mount.addEventListener('mousedown', e => {
      if (e.button === 0 && running && !UI.isPanelOpen()) doAttack();
    });
  }

  /* ── Start / restart ─────────────────────────── */
  function start() {
    UI.hideTitleAndDeath();
    UI.clearMessages();
    UI.closePanel();
    UI.hideBossBar();

    floor         = 1;
    bossSpawned   = false;
    bossDefeated  = false;
    exitOpen      = false;
    running       = true;

    player  = Player.create();
    dungeon = Dungeon.generate(floor);

    // Position player in start room center
    const { cx, cy } = dungeon.roomCenter(dungeon.startRoom);
    const w = dungeon.toWorld(cx, cy);
    player.x = w.x; player.z = w.z;

    // Init Three.js engine (idempotent)
    Engine.init();
    Engine.buildDungeon(dungeon);
    Engine.buildPlayerMesh();
    Engine.clearDynamic();

    // Spawn enemies
    enemies = Enemies.spawnAll(dungeon, floor);
    enemies.forEach(e => Engine.buildEnemyMesh(e));

    UI.refresh(player);
    UI.setFloor(floor);
    UI.addMsg('You descend into the dungeon...', 'warn');

    if (rafId) cancelAnimationFrame(rafId);
    loop();
  }

  /* ── Next floor ──────────────────────────────── */
  function nextFloor() {
    floor++;
    bossSpawned   = false;
    bossDefeated  = false;
    exitOpen      = false;

    dungeon = Dungeon.generate(floor);
    const { cx, cy } = dungeon.roomCenter(dungeon.startRoom);
    const w = dungeon.toWorld(cx, cy);
    player.x = w.x; player.z = w.z;

    // Partial heal
    player.hp = Math.min(player.maxHp, player.hp + Math.floor(player.maxHp * 0.3));

    Engine.clearDynamic();
    Engine.buildDungeon(dungeon);

    enemies = Enemies.spawnAll(dungeon, floor);
    enemies.forEach(e => Engine.buildEnemyMesh(e));

    UI.hideBossBar();
    UI.setFloor(floor);
    UI.addMsg(`Descended to Floor ${floor}. Darkness deepens...`, 'warn');
    UI.refresh(player);
  }

  /* ── Main loop ───────────────────────────────── */
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!running) return;

    const dt = Math.min(Engine.clock.getDelta(), 0.05); // cap at 50ms
    const t  = Engine.clock.elapsedTime;

    // Update aim
    const aimAngleVal = Engine.updateAimFromMouse(mouseX, mouseY, player);

    // Player update (if panel closed)
    if (!UI.isPanelOpen()) {
      Player.update(player, dungeon, keys, null, dt);
    }

    // Check boss room entry
    checkBossEntry();

    // Check chests
    checkChestProximity();

    // Enemy ticks
    enemies.forEach(e => {
      if (e.dead) return;
      const result = Enemies.tick(e, player, dungeon, dt);
      if (result && result.attacked) {
        const dmg = Player.takeDamage(player, result.dmg);
        if (dmg > 0) {
          UI.addMsg(`${e.name} hits you for ${dmg}!`, 'combat');
          Engine.flashPlayer(true);
          setTimeout(() => Engine.flashPlayer(false), 150);
        }
        if (player.hp <= 0) { die(); return; }
      }
      // HP bar update
      Engine.updateEnemyHpBar(e);
      // Flash if hit
      if (e.hitFlash > 0) Engine.flashEnemy(e);

      // Boss bar update
      if (e.isBoss && bossSpawned) UI.updateBossBar(e);
    });

    // Remove dead enemies from scene
    enemies = enemies.filter(e => {
      if (e.dead) { Engine.removeEnemyMesh(e.id); return false; }
      return true;
    });

    // Particles
    Engine.updateParticles(dt);

    // Torch flicker
    Engine.updateTorchFlicker(t);

    // Render
    Engine.render(player, t);

    // Periodic HUD refresh (every ~10 frames)
    if (Math.round(t * 60) % 10 === 0) UI.refresh(player);
  }

  /* ── Boss entry check ────────────────────────── */
  function checkBossEntry() {
    if (bossSpawned) return;
    const br      = dungeon.bossRoom;
    const TILE    = dungeon.TILE;
    const playerTX = Math.floor(player.x / TILE);
    const playerTZ = Math.floor(player.z / TILE);

    if (
      playerTX >= br.x && playerTX < br.x + br.w &&
      playerTZ >= br.y && playerTZ < br.y + br.h
    ) {
      bossSpawned = true;
      const boss  = Enemies.createBoss(br, floor, dungeon);
      enemies.push(boss);
      Engine.buildEnemyMesh(boss);
      UI.showBossBar(boss);
      UI.addMsg('⚠ THE DUNGEON LORD AWAKENS!', 'warn');
      Engine.spawnParticles(boss.x, 1.5, boss.z, 0xff2200, 30, 5, 1.5);
    }
  }

  /* ── Attack ──────────────────────────────────── */
  function doAttack() {
    const hits = Player.attack(player, enemies, Engine.aimAngle);

    hits.forEach(({ enemy, dmg, isCrit, killed }) => {
      Engine.spawnParticles(
        enemy.x, enemy.height * 0.7, enemy.z,
        isCrit ? 0xffff00 : 0xff3300,
        isCrit ? 14 : 8, isCrit ? 5 : 3,
        isCrit ? 0.8 : 0.5
      );

      if (isCrit) UI.addMsg(`Critical! ${dmg} damage`, 'combat');

      if (killed) {
        enemy.dead = true;
        Engine.spawnParticles(enemy.x, 1.0, enemy.z, enemy.color, 20, 4, 1.0);
        player.xp += enemy.xp;
        UI.addMsg(`${enemy.name} slain! +${enemy.xp} XP`, 'combat');

        // Loot drop
        if (Math.random() < 0.40 + floor * 0.02) {
          const item = Loot.genItem(floor);
          if (player.inventory.length < 24) {
            player.inventory.push(item);
            UI.addMsg(`Found: ${item.name} [${item.rarity}]`, 'loot');
          }
        }

        // Boss kill
        if (enemy.isBoss) {
          bossDefeated = true;
          exitOpen     = true;
          UI.hideBossBar();
          UI.addMsg('Boss defeated! Find the exit portal!', 'level');
          Engine.buildExitPortal(dungeon);
          Engine.spawnParticles(enemy.x, 1.5, enemy.z, 0x8844ff, 40, 6, 2.0);
        }

        const leveled = Player.checkLevelUp(player);
        if (leveled) Engine.spawnParticles(player.x, 1.0, player.z, 0x4488ff, 24, 5, 1.2);
        UI.refresh(player);
      }
    });

    // Swing particle
    const a = Engine.aimAngle;
    Engine.spawnParticles(
      player.x + Math.cos(a) * 1.5,
      1.0,
      player.z + Math.sin(a) * 1.5,
      0xffcc44, 5, 2.5, 0.3
    );
  }

  /* ── Blink (Space) ───────────────────────────── */
  function tryBlink() {
    if (!running || UI.isPanelOpen()) return;
    const did = Player.blink(player, Engine.aimAngle, dungeon);
    if (did) {
      Engine.spawnParticles(player.x, 1.0, player.z, 0x8844ff, 18, 4, 0.7);
      UI.addMsg('Blink!', '');
    }
  }

  /* ── Interact / descend ──────────────────────── */
  function tryInteract() {
    if (!exitOpen) return;
    const br   = dungeon.bossRoom;
    const TILE = dungeon.TILE;
    const { cx, cy } = dungeon.roomCenter(br);
    const w = dungeon.toWorld(cx, cy);
    const dist = Math.sqrt((player.x - w.x) ** 2 + (player.z - w.z) ** 2);
    if (dist < TILE * 1.8) {
      Engine.spawnParticles(player.x, 1.0, player.z, 0x8844ff, 30, 5, 1.0);
      nextFloor();
    } else {
      UI.addMsg('Approach the portal to descend [E]', '');
    }
  }

  /* ── Chest interaction ───────────────────────── */
  function checkChestProximity() {
    if (!dungeon.chests) return;
    for (const chestGroup of Engine.chestMeshes) {
      const cd    = chestGroup.userData.chestData;
      if (cd.opened) continue;
      const dist  = Math.sqrt(
        (player.x - chestGroup.position.x) ** 2 +
        (player.z - chestGroup.position.z) ** 2
      );
      if (dist < 2.0 && keys['e']) {
        cd.opened = true;
        // Open lid animation (tilt)
        const lid = chestGroup.children[1];
        if (lid) lid.rotation.x = -Math.PI / 2.2;
        const item = Loot.genItem(floor);
        player.inventory.push(item);
        UI.addMsg(`Chest! Found: ${item.name} [${item.rarity}]`, 'loot');
        Engine.spawnParticles(chestGroup.position.x, 0.8, chestGroup.position.z, 0xffcc44, 16, 3, 0.8);
        UI.refresh(player);
      }
    }
  }

  /* ── Death ───────────────────────────────────── */
  function die() {
    running = false;
    UI.hideBossBar();
    UI.showDeath(floor, player.level);
  }

  /* ── Public accessors ────────────────────────── */
  function getPlayer() { return player; }

  // Boot input wiring on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireInput);
  } else {
    wireInput();
  }

  return { start, getPlayer };

})();
