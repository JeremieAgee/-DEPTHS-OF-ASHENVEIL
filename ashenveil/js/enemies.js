/* ═══════════════════════════════════════════════════
   enemies.js  —  Enemy types, AI, spawning
   Exports: Enemies (namespace)
════════════════════════════════════════════════════ */
const Enemies = (() => {

  /* ── Type definitions ────────────────────────── */
  const TYPES = {
    skeleton: {
      name:    'Skeleton',
      color:   0xccccaa,
      radius:  0.45,
      height:  1.6,
      baseHp:  22,
      baseAtk: 6,
      spd:     2.4,
      xp:      15,
      aggroR:  10,
      atkR:    1.0,
      atkCD:   55,
    },
    goblin: {
      name:    'Goblin',
      color:   0x44cc44,
      radius:  0.35,
      height:  1.2,
      baseHp:  16,
      baseAtk: 8,
      spd:     3.2,
      xp:      18,
      aggroR:  12,
      atkR:    0.9,
      atkCD:   45,
    },
    wraith: {
      name:    'Wraith',
      color:   0x8844ff,
      radius:  0.5,
      height:  1.8,
      baseHp:  35,
      baseAtk: 14,
      spd:     2.0,
      xp:      28,
      aggroR:  14,
      atkR:    1.1,
      atkCD:   60,
    },
    troll: {
      name:    'Troll',
      color:   0x885522,
      radius:  0.8,
      height:  2.2,
      baseHp:  70,
      baseAtk: 18,
      spd:     1.4,
      xp:      45,
      aggroR:  9,
      atkR:    1.3,
      atkCD:   70,
    },
  };

  const BOSS_TYPE = {
    name:    'Dungeon Lord',
    color:   0xff2200,
    radius:  1.2,
    height:  3.0,
    baseHp:  220,
    baseAtk: 28,
    spd:     1.6,
    xp:      160,
    aggroR:  18,
    atkR:    1.8,
    atkCD:   65,
    isBoss:  true,
  };

  const TYPE_KEYS = Object.keys(TYPES);

  /* ── Create an enemy instance ────────────────── */
  function create(typeKey, gx, gy, floor, dungeon) {
    const def   = TYPES[typeKey] || TYPES.skeleton;
    const scale = 1 + (floor - 1) * 0.22;
    const world = dungeon.toWorld(gx, gy);

    return {
      ...def,
      typeKey,
      x:          world.x,
      y:          0,
      z:          world.z,
      hp:         Math.round(def.baseHp  * scale),
      maxHp:      Math.round(def.baseHp  * scale),
      atk:        Math.round(def.baseAtk * (1 + (floor - 1) * 0.18)),
      xp:         Math.round(def.xp      * (1 + (floor - 1) * 0.1)),
      state:      'idle',   // idle | chase | attack | dead
      atkTimer:   0,
      hitFlash:   0,
      dead:       false,
      mesh:       null,     // set by engine.js
      id:         Math.random().toString(36).slice(2),
    };
  }

  function createBoss(bossRoom, floor, dungeon) {
    const def   = BOSS_TYPE;
    const scale = 1 + (floor - 1) * 0.35;
    const { cx, cy } = dungeon.roomCenter(bossRoom);
    const world = dungeon.toWorld(cx, cy);

    return {
      ...def,
      typeKey:    'boss',
      x:          world.x,
      y:          0,
      z:          world.z,
      hp:         Math.round(def.baseHp  * scale),
      maxHp:      Math.round(def.baseHp  * scale),
      atk:        Math.round(def.baseAtk * (1 + (floor - 1) * 0.25)),
      xp:         Math.round(def.xp      * floor),
      state:      'idle',
      atkTimer:   0,
      hitFlash:   0,
      dead:       false,
      mesh:       null,
      id:         'boss',
    };
  }

  /* ── Spawn enemies from dungeon spawn list ───── */
  function spawnAll(dungeon, floor) {
    return dungeon.spawns.map(s => {
      const typeKey = TYPE_KEYS[Math.floor(Math.random() * TYPE_KEYS.length)];
      return create(typeKey, s.gx, s.gy, floor, dungeon);
    });
  }

  /* ── AI tick (called each frame) ────────────── */
  // Returns { attacked: bool, dmg: number } if enemy attacks player
  function tick(enemy, player, dungeon, dt) {
    if (enemy.dead) return null;

    if (enemy.atkTimer  > 0) enemy.atkTimer  -= dt * 60;
    if (enemy.hitFlash  > 0) enemy.hitFlash  -= dt * 60;

    const dx   = player.x - enemy.x;
    const dz   = player.z - enemy.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < enemy.aggroR) {
      enemy.state = 'chase';

      if (dist > enemy.atkR + 0.1) {
        // Move toward player
        const spd = enemy.spd * dt;
        const inv = 1 / dist;
        const nx  = enemy.x + dx * inv * spd;
        const nz  = enemy.z + dz * inv * spd;

        // Collision with walls
        const TILE = dungeon.TILE;
        const tx   = Math.floor(nx / TILE);
        const tz   = Math.floor(nz / TILE);
        const r    = enemy.radius;

        if (tx >= 0 && tx < dungeon.COLS && tz >= 0 && tz < dungeon.ROWS && dungeon.grid[tz][tx] === 0)
          enemy.x = nx;
        const tx2  = Math.floor(enemy.x / TILE);
        const tz2  = Math.floor((enemy.z + (nz - enemy.z)) / TILE);
        if (tx2 >= 0 && tx2 < dungeon.COLS && tz2 >= 0 && tz2 < dungeon.ROWS && dungeon.grid[tz2][tx2] === 0)
          enemy.z = enemy.z + (nz - enemy.z);

        // Update mesh position
        if (enemy.mesh) {
          enemy.mesh.position.x = enemy.x;
          enemy.mesh.position.z = enemy.z;
        }
      }

      // Attack
      if (dist <= enemy.atkR + 0.1 && enemy.atkTimer <= 0) {
        enemy.atkTimer = enemy.atkCD;
        return { attacked: true, dmg: enemy.atk };
      }
    } else {
      enemy.state = 'idle';
    }

    return null;
  }

  return { create, createBoss, spawnAll, tick, TYPES, BOSS_TYPE };

})();
