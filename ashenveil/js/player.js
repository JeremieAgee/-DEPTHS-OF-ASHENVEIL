/* ═══════════════════════════════════════════════════
   player.js  —  Player state, input, movement, combat
   Exports: Player (namespace)
════════════════════════════════════════════════════ */
const Player = (() => {

  /* ── Initial state factory ───────────────────── */
  function create() {
    return {
      // World position
      x:           0,
      y:           0,
      z:           0,
      // Stats
      hp:          100,
      maxHp:       100,
      atk:         10,
      def:         2,
      speed:       4.0,
      // Progression
      level:       1,
      xp:          0,
      xpNext:      100,
      skillPoints: 0,
      // Combat flags
      critChance:  0,
      lifesteal:   0,
      atkSpeed:    1.0,   // multiplier (lower = faster)
      hasBlink:    false,
      hasWhirl:    false,
      hasRegen:    false,
      hasExecute:  false,
      atkTimer:    0,     // cooldown frames remaining
      iframes:     0,     // invincibility frames
      blinkCD:     0,
      regenAccum:  0,
      // Skills unlocked
      skills:      {},
      // Inventory
      inventory:   Loot.startingInventory(),
      // Active buffs [{stat, value, remaining}]
      buffs:       [],
    };
  }

  /* ── Equipped item helpers ───────────────────── */
  function equippedWeapon(p) {
    return p.inventory.find(i => i.type === 'weapon' && i.equipped) || null;
  }
  function equippedArmor(p) {
    return p.inventory.find(i => i.type === 'armor'  && i.equipped) || null;
  }
  function totalAtk(p) {
    const w = equippedWeapon(p);
    let base = p.atk + (w ? w.atk : 0);
    const b = p.buffs.find(b => b.stat === 'atk');
    if (b) base += b.value;
    return base;
  }
  function totalDef(p) {
    const a = equippedArmor(p);
    let base = p.def + (a ? a.def : 0);
    const b = p.buffs.find(b => b.stat === 'def');
    if (b) base += b.value;
    return base;
  }
  function atkRange(p) {
    const w = equippedWeapon(p);
    return w ? w.range || 1.6 : 1.6;
  }

  /* ── Equip an item by id ─────────────────────── */
  function equip(p, itemId) {
    const item = p.inventory.find(i => i.id === itemId);
    if (!item) return;
    if (item.type === 'consumable') {
      useConsumable(p, item);
      return;
    }
    p.inventory.forEach(i => { if (i.type === item.type) i.equipped = false; });
    item.equipped = true;
  }

  function useConsumable(p, item) {
    p.inventory = p.inventory.filter(i => i.id !== item.id);
    if (item.effect === 'heal') {
      p.hp = Math.min(p.maxHp, p.hp + item.value);
      UI.addMsg(`Used ${item.name}: +${item.value} HP`, 'loot');
    } else if (item.effect === 'buff') {
      p.buffs.push({ stat: item.stat, value: item.value, remaining: item.duration });
      UI.addMsg(`${item.name} active!`, 'level');
    }
    UI.refresh(p);
  }

  /* ── Level up check ──────────────────────────── */
  function checkLevelUp(p) {
    let leveled = false;
    while (p.xp >= p.xpNext) {
      p.xp    -= p.xpNext;
      p.level += 1;
      p.xpNext = Math.round(p.xpNext * 1.45);
      p.maxHp += 18;
      p.hp     = Math.min(p.hp + 18, p.maxHp);
      p.atk   += 2;
      p.def   += 1;
      p.skillPoints += 1;
      leveled  = true;
      UI.addMsg(`⬆ Level Up! Now level ${p.level}`, 'level');
    }
    return leveled;
  }

  /* ── Per-frame update ────────────────────────── */
  function update(p, dungeon, keys, aimAngle, dt) {
  // Timers
  if (p.atkTimer > 0) p.atkTimer  -= dt * 60;
  if (p.iframes  > 0) p.iframes   -= dt * 60;
  if (p.blinkCD  > 0) p.blinkCD   -= dt * 60;

  // Buff timers
  p.buffs = p.buffs.filter(b => {
    b.remaining -= dt * 60;
    return b.remaining > 0;
  });

  // Regen
  if (p.hasRegen && p.hp < p.maxHp) {
    p.regenAccum += dt;
    if (p.regenAccum >= 2.5) {
      p.regenAccum = 0;
      p.hp = Math.min(p.maxHp, p.hp + 4);
      UI.refresh(p);
    }
  }

  // Ensure aimAngle is valid
  if (typeof aimAngle !== 'number') aimAngle = 0;

  // Movement input
 const wPressed = keys['w'] || keys['arrowup'];
const sPressed = keys['s'] || keys['arrowdown'];
const dPressed = keys['d'] || keys['arrowright'];
const aPressed = keys['a'] || keys['arrowleft'];

// Only calculate if there's input
if (wPressed || sPressed || dPressed || aPressed) {
  // aimAngle = camera yaw (horizontal facing angle, in radians)
  // Forward vector: cos/sin of aimAngle
  // Right vector:   forward rotated +90° = (-sin, cos)
  
  const fwdX =  Math.cos(aimAngle);
  const fwdZ =  Math.sin(aimAngle);
  const rgtX = -Math.sin(aimAngle);  // right = fwd rotated +90°
  const rgtZ =  Math.cos(aimAngle);

  const forwardAmount = (wPressed ? 1 : 0) - (sPressed ? 1 : 0);
  const rightAmount   = (dPressed ? 1 : 0) - (aPressed ? 1 : 0);

  const worldDx = fwdX * forwardAmount + rgtX * rightAmount;
  const worldDz = fwdZ * forwardAmount + rgtZ * rightAmount;

  // Normalize if moving diagonally
  const moveLength = Math.sqrt(worldDx * worldDx + worldDz * worldDz);
  const normDx = moveLength > 0 ? worldDx / moveLength : 0;
  const normDz = moveLength > 0 ? worldDz / moveLength : 0;

  const spd  = p.speed * dt;
  const TILE = dungeon.TILE;
  const r    = 0.35;

  function tryMove(nx, nz) {
    const tx = Math.floor(nx / TILE);
    const tz = Math.floor(nz / TILE);
    return (
      tx >= 0 && tx < dungeon.COLS &&
      tz >= 0 && tz < dungeon.ROWS &&
      dungeon.grid[tz][tx] === 0
    );
  }

  const nx = p.x + normDx * spd;
  const nz = p.z + normDz * spd;
  if (tryMove(nx - r, p.z - r) && tryMove(nx + r, p.z - r) &&
      tryMove(nx - r, p.z + r) && tryMove(nx + r, p.z + r)) p.x = nx;
  if (tryMove(p.x - r, nz - r) && tryMove(p.x + r, nz - r) &&
      tryMove(p.x - r, nz + r) && tryMove(p.x + r, nz + r)) p.z = nz;
}
}

  /* ── Attack ──────────────────────────────────── */
  function attack(p, enemies, aimAngle) {
    const w    = equippedWeapon(p);
    const cd   = Math.max(18, 38 * p.atkSpeed - (w ? w.spd * 5 : 0));
    if (p.atkTimer > 0) return [];

    p.atkTimer = cd;
    const atk  = totalAtk(p);
    const range = atkRange(p) * 1.8;
    const hits  = [];

    enemies.forEach(e => {
      if (e.dead) return;
      const dist = Math.sqrt((e.x - p.x) ** 2 + (e.z - p.z) ** 2);
      if (dist > range) return;

      if (p.hasWhirl) {
        processHit(p, e, atk, hits);
      } else {
        // Cone check: ±70° in front of player
        const eAngle = Math.atan2(e.z - p.z, e.x - p.x);
        let angleDiff = eAngle - aimAngle;
        
        // Normalize to -PI to PI
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        
        if (Math.abs(angleDiff) < 1.22) { // ±70°
          processHit(p, e, atk, hits);
        }
      }
    });

    return hits;
  }

  function processHit(p, e, baseAtk, hits) {
    const isCrit   = Math.random() < p.critChance;
    const execBonus = p.hasExecute && (e.hp / e.maxHp) < 0.25 ? 2 : 1;
    let dmg = Math.round(baseAtk * (0.8 + Math.random() * 0.4) * (isCrit ? 2 : 1) * execBonus);
    dmg = Math.max(1, dmg);
    e.hp -= dmg;
    e.hitFlash = 8;
    if (p.lifesteal > 0) p.hp = Math.min(p.maxHp, p.hp + dmg * p.lifesteal);
    hits.push({ enemy: e, dmg, isCrit, killed: e.hp <= 0 });
  }

  /* ── Take damage ─────────────────────────────── */
  function takeDamage(p, raw) {
    if (p.iframes > 0) return 0;
    const reduced = Math.max(1, Math.round(raw - totalDef(p) * 0.45));
    p.hp      -= reduced;
    p.iframes  = 35;
    UI.refresh(p);
    return reduced;
  }

  /* ── Blink ───────────────────────────────────── */
  function blink(p, aimAngle, dungeon) {
    if (!p.hasBlink || p.blinkCD > 0) return false;
    const dist = 6.0;
    const nx   = p.x + Math.cos(aimAngle) * dist;
    const nz   = p.z + Math.sin(aimAngle) * dist;
    const TILE = dungeon.TILE;
    const tx   = Math.floor(nx / TILE);
    const tz   = Math.floor(nz / TILE);
    if (tx >= 0 && tx < dungeon.COLS && tz >= 0 && tz < dungeon.ROWS && dungeon.grid[tz][tx] === 0) {
      p.x = nx; p.z = nz;
      p.blinkCD = 90;
      return true;
    }
    return false;
  }

  return {
    create,
    equip,
    totalAtk,
    totalDef,
    atkRange,
    equippedWeapon,
    equippedArmor,
    update,
    attack,
    takeDamage,
    blink,
    checkLevelUp,
  };

})();