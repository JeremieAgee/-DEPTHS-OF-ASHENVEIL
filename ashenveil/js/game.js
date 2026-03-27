/* ═══════════════════════════════════════════════════
   game.js  —  Main loop, state, floor transitions,
               input wiring, chest interaction

   Required HTML elements:
     <div id="stairOverlay"></div>
     <div id="chestPrompt">Press E to open chest</div>
     <div id="stairPrompt">Press E to descend the stairs</div>

   Required CSS:
     #stairOverlay {
       position:fixed; inset:0; background:#000;
       opacity:0; pointer-events:none; z-index:50;
       transition: opacity 0.1s;
     }
     #chestPrompt, #stairPrompt {
       position:fixed; bottom:22%; left:50%;
       transform:translateX(-50%);
       background:rgba(0,0,0,0.72); color:#e8d090;
       font-family:serif; font-size:1.1rem;
       padding:8px 20px; border-radius:4px;
       border:1px solid #7a5a20;
       opacity:0; pointer-events:none; z-index:40;
       transition: opacity 0.25s;
     }
     #stairPrompt { color:#b888ff; border-color:#7744cc; }
════════════════════════════════════════════════════ */
const Game = (() => {

  /* ── State ───────────────────────────────────── */
  let player  = null;
  let dungeon = null;
  let enemies = [];
  let floor   = 1;
  let running = false;

  let bossSpawned  = false;
  let bossDefeated = false;
  let exitOpen     = false;
  let stairActive  = false;

  const keys = {};
  let rafId  = null;
  let aimAngleVal = 0;

  /* ── Input ───────────────────────────────────── */
  function wireInput() {
    document.addEventListener('keydown', e => {
      keys[e.key.toLowerCase()] = true;
      if (!running) return;
      if (e.key.toLowerCase() === 'i') UI.togglePanel('inv');
      if (e.key.toLowerCase() === 'k') UI.togglePanel('skills');
      if (e.key.toLowerCase() === 'e') tryInteract();
      if (e.key === 'Escape') {
        if (UI.isPauseMenuOpen()) {
          UI.closePauseMenu();
          document.getElementById('canvasMount').requestPointerLock();
        }
      }
      if (['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase()))
        e.preventDefault();
    });

    document.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });

    const mount = document.getElementById('canvasMount');
    mount.addEventListener('mousedown', e => {
      if (e.button === 0 && running && !UI.isPanelOpen() && Engine.isPointerLocked()) doAttack();
    });
  }

  /* ── Start ───────────────────────────────────── */
  function start() {
    UI.hideTitleAndDeath();
    UI.clearMessages();
    UI.closePanel();
    UI.hideBossBar();

    floor        = 1;
    bossSpawned  = false;
    bossDefeated = false;
    exitOpen     = false;
    stairActive  = false;
    running      = true;

    player  = Player.create();
    dungeon = Dungeon.generate(floor);

    const { cx, cy } = dungeon.roomCenter(dungeon.startRoom);
    const w = dungeon.toWorld(cx, cy);
    player.x = w.x; player.z = w.z;
    player._descentY = 0;

    Engine.init();
    Engine.clearDynamic();
    Engine.buildDungeon(dungeon);
    Engine.buildPlayerMesh();

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
    bossSpawned  = false;
    bossDefeated = false;
    exitOpen     = false;
    stairActive  = false;

    dungeon = Dungeon.generate(floor);
    const { cx, cy } = dungeon.roomCenter(dungeon.startRoom);
    const w = dungeon.toWorld(cx, cy);
    player.x = w.x; player.z = w.z;
    player._descentY = 0;

    player.hp = Math.min(player.maxHp, player.hp + Math.floor(player.maxHp * 0.3));

    Engine.clearDynamic();
    Engine.buildDungeon(dungeon);

    enemies = Enemies.spawnAll(dungeon, floor);
    enemies.forEach(e => Engine.buildEnemyMesh(e));

    // Fade back in
    const overlay = document.getElementById('stairOverlay');
    if (overlay) {
      overlay.style.transition = 'opacity 0.8s';
      overlay.style.opacity    = '0';
      setTimeout(() => { overlay.style.transition = 'opacity 0.1s'; }, 900);
    }

    UI.hideBossBar();
    UI.setFloor(floor);
    UI.addMsg(`Floor ${floor}. The darkness deepens...`, 'warn');
    UI.refresh(player);
  }

  /* ── Main loop ───────────────────────────────── */
  function loop() {
    rafId = requestAnimationFrame(loop);
    if (!running) return;

    const dt = Math.min(Engine.clock.getDelta(), 0.05);
    const t  = Engine.clock.elapsedTime;

    aimAngleVal = Engine.updateAimFromMouse();

    // Stair descent — freeze everything else
    if (stairActive) {
      Engine.tickStairDescent(player, dt);
      Engine.updateTorchFlicker(t);
      Engine.render(player, t, dt);
      return;
    }

    if (!UI.isPanelOpen()) {
      Player.update(player, dungeon, keys, aimAngleVal, dt);
    }
    if (!running) return;

    if (UI.isPauseMenuOpen()) {
      Engine.render(player, t, dt);
      return;
    }

    checkBossEntry();

    enemies.forEach(e => {
      if (e.dead) return;
      const result = Enemies.tick(e, player, dungeon, dt);
      if (result && result.attacked) {
        const dmg = Player.takeDamage(player, result.dmg);
        if (dmg > 0) UI.addMsg(`${e.name} hits you for ${dmg}!`, 'combat');
        if (player.hp <= 0) { die(); return; }
      }
      Engine.updateEnemyHpBar(e);
      if (e.isBoss && bossSpawned) UI.updateBossBar(e);
    });

    enemies = enemies.filter(e => {
      if (e.dead) { Engine.removeEnemyMesh(e.id); return false; }
      return true;
    });

    Engine.updateParticles(dt);
    Engine.updateTorchFlicker(t);
    Engine.updateChests(dt);
    Engine.updateChestPrompt(player);
    Engine.updateStairPrompt(player, exitOpen, dungeon);

    Engine.render(player, t, dt);

    if (Math.round(t * 60) % 10 === 0) UI.refresh(player);
  }

  /* ── Boss entry ──────────────────────────────── */
  function checkBossEntry() {
    if (bossSpawned) return;
    const br  = dungeon.bossRoom;
    const tx  = Math.floor(player.x / dungeon.TILE);
    const tz  = Math.floor(player.z / dungeon.TILE);

    if (tx >= br.x && tx < br.x + br.w && tz >= br.y && tz < br.y + br.h) {
      bossSpawned = true;
      Engine.openBossDoor();
      const boss = Enemies.createBoss(br, floor, dungeon);
      enemies.push(boss);
      Engine.buildEnemyMesh(boss);
      UI.showBossBar(boss);
      UI.addMsg('⚠ THE DUNGEON LORD AWAKENS!', 'warn');
      Engine.spawnParticles(boss.x, 1.5, boss.z, 0xff2200, 30, 5, 1.5);
    }
  }

  /* ── Attack ──────────────────────────────────── */
  function doAttack() {
    const hits = Player.attack(player, enemies, aimAngleVal);

    hits.forEach(({ enemy, dmg, isCrit, killed }) => {
      Engine.spawnParticles(
        enemy.x, enemy.height * 0.7, enemy.z,
        isCrit ? 0xffff00 : 0xff3300,
        isCrit ? 14 : 8, isCrit ? 5 : 3, isCrit ? 0.8 : 0.5
      );
      if (isCrit) UI.addMsg(`Critical! ${dmg} damage`, 'combat');

      if (killed) {
        enemy.dead = true;
        Engine.spawnParticles(enemy.x, 1.0, enemy.z, enemy.color, 20, 4, 1.0);
        player.xp += enemy.xp;
        UI.addMsg(`${enemy.name} slain! +${enemy.xp} XP`, 'combat');

        if (Math.random() < 0.40 + floor * 0.02) {
          const item = Loot.genItem(floor);
          if (player.inventory.length < 24) {
            player.inventory.push(item);
            UI.addMsg(`Found: ${item.name} [${item.rarity}]`, 'loot');
          }
        }

        if (enemy.isBoss) {
          bossDefeated = true;
          exitOpen     = true;
          UI.hideBossBar();
          UI.addMsg('Boss defeated! Descend the stairs to continue...', 'level');
          // Stairs appear now for the first time
          Engine.buildExitPortal(dungeon);
          Engine.spawnParticles(enemy.x, 1.5, enemy.z, 0x8844ff, 40, 6, 2.0);
        }

        const leveled = Player.checkLevelUp(player);
        if (leveled) Engine.spawnParticles(player.x, 1.0, player.z, 0x4488ff, 24, 5, 1.2);
        UI.refresh(player);
      }
    });

    const a = aimAngleVal || 0;
    Engine.spawnParticles(
      player.x + Math.cos(a) * 1.5, 1.0, player.z + Math.sin(a) * 1.5,
      0xffcc44, 5, 2.5, 0.3
    );
  }

  /* ── Interact ────────────────────────────────── */
  function tryInteract() {
    // 1. Stair descent (only if exit is open and stairs exist)
    if (exitOpen && !stairActive && dungeon.stairsPos) {
      const w    = dungeon.toWorld(dungeon.stairsPos.gx, dungeon.stairsPos.gy);
      const dx   = player.x - w.x;
      const dz   = player.z - w.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < dungeon.TILE * 2.5) {
        stairActive = true;
        UI.addMsg('You descend the stairs into deeper darkness...', 'warn');
        Engine.spawnParticles(player.x, 1.0, player.z, 0x8844ff, 20, 4, 1.0);
        Engine.startStairDescent(player, dungeon, () => { nextFloor(); });
        return;
      }
    }

    // 2. Open nearby chest
    openNearbyChest();
  }

  /* ── Chest opening ───────────────────────────── */
  function openNearbyChest() {
    for (const grp of Engine.chestMeshes) {
      const cd = grp.userData.chestData;
      if (cd.opened) continue;
      const dx   = player.x - grp.position.x;
      const dz   = player.z - grp.position.z;
      const dist = Math.sqrt(dx*dx + dz*dz);
      if (dist < 2.5) {
        cd.opened                 = true;
        grp.userData.isOpening    = true;
        grp.userData.lidOpenT     = 0;

        const item = Loot.genItem(floor);
        player.inventory.push(item);
        UI.addMsg(`Chest opened! Found: ${item.name} [${item.rarity}]`, 'loot');
        Engine.spawnParticles(grp.position.x, 0.9, grp.position.z, 0xffcc44, 18, 3, 0.9);
        UI.refresh(player);
        return; // one chest at a time
      }
    }
  }

  /* ── Death ───────────────────────────────────── */
  function die() {
    running = false;
    UI.hideBossBar();
    UI.showDeath(floor, player.level);
  }

  function getPlayer() { return player; }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireInput);
  } else {
    wireInput();
  }

  return { start, getPlayer };

})();