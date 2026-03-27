/* ═══════════════════════════════════════════════════
   dungeon.js  —  Procedural dungeon generation
   Exports: Dungeon (namespace)
════════════════════════════════════════════════════ */
const Dungeon = (() => {

  const TILE   = 4;
  const WALL_H = 3.5;
  const COLS   = 40;
  const ROWS   = 40;

  /* ── Helpers ─────────────────────────────────── */
  function grid() {
    return Array.from({ length: ROWS }, () => new Uint8Array(COLS).fill(1));
  }

  function carveRect(g, x, y, w, h) {
    for (let row = y; row < y + h; row++)
      for (let col = x; col < x + w; col++)
        g[row][col] = 0;
  }

  function carveCorridor(g, x1, y1, x2, y2) {
    let cx = x1, cy = y1;
    while (cx !== x2) { g[cy][cx] = 0; cx += cx < x2 ? 1 : -1; }
    while (cy !== y2) { g[cy][cx] = 0; cy += cy < y2 ? 1 : -1; }
  }

  function roomCenter(room) {
    return {
      cx: Math.floor(room.x + room.w / 2),
      cy: Math.floor(room.y + room.h / 2),
    };
  }

  function roomsOverlap(a, b, pad = 2) {
    return (
      a.x < b.x + b.w + pad &&
      a.x + a.w + pad > b.x &&
      a.y < b.y + b.h + pad &&
      a.y + a.h + pad > b.y
    );
  }

  function roomDist(a, b) {
    const ca = roomCenter(a);
    const cb = roomCenter(b);
    return Math.sqrt((ca.cx - cb.cx) ** 2 + (ca.cy - cb.cy) ** 2);
  }

    /* ── Lantern placement ───────────────────────── */
  function placeLanterns(g, rooms) {
    const lanterns = [];
    for (const room of rooms) {
      const candidates = [
        { x: room.x,              y: room.y },
        { x: room.x + room.w - 1, y: room.y },
        { x: room.x,              y: room.y + room.h - 1 },
        { x: room.x + room.w - 1, y: room.y + room.h - 1 },
      ];
      for (const c of candidates) {
        if (Math.random() < 0.65) lanterns.push(c);
      }
      if (room.w >= 6) {
        lanterns.push({ x: room.x + Math.floor(room.w / 2), y: room.y });
        lanterns.push({ x: room.x + Math.floor(room.w / 2), y: room.y + room.h - 1 });
      }
    }
    return lanterns;
  }

  /* ── Enemy spawn points ──────────────────────── */
  function enemySpawnPoints(rooms, floor) {
    const spawns = [];
    // skip index 0 (start) and last (boss room)
    for (let i = 1; i < rooms.length - 1; i++) {
      const r = rooms[i];
      const count = 1 + Math.floor(Math.random() * (2 + Math.floor(floor / 2)));
      for (let k = 0; k < count; k++) {
        spawns.push({
          roomIndex: i,
          gx: r.x + 1 + Math.floor(Math.random() * (r.w - 2)),
          gy: r.y + 1 + Math.floor(Math.random() * (r.h - 2)),
        });
      }
    }
    return spawns;
  }

  /* ── Loot chest positions ────────────────────── */
  // ~1 chest per 3 rooms, never in start or boss room
  function chestPositions(rooms) {
    const chests = [];
    // eligible rooms: skip index 0 (start) and last (boss)
    const eligible = [];
    for (let i = 1; i < rooms.length - 1; i++) eligible.push(i);

    // shuffle
    for (let i = eligible.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
    }

    const count = Math.max(1, Math.floor(eligible.length / 3));
    for (let k = 0; k < count && k < eligible.length; k++) {
      const r = rooms[eligible[k]];
      chests.push({
        gx: r.x + 1 + Math.floor(Math.random() * (r.w - 2)),
        gy: r.y + 1 + Math.floor(Math.random() * (r.h - 2)),
        opened: false,
      });
    }
    return chests;
  }

  /* ── Convert grid coords → world coords ─────── */
  function toWorld(gx, gy) {
    return {
      x: gx * TILE + TILE / 2,
      z: gy * TILE + TILE / 2,
    };
  }

  /* ── Main generate function ──────────────────── */
  function generate(floor) {
    const g      = grid();
    const rooms  = [];
    const MIN_W = 5, MAX_W = 10;
    const MIN_H = 5, MAX_H = 9;
    const BOSS_MIN_W = 9, BOSS_MIN_H = 9;
    const TARGET = 8 + Math.min(floor * 2, 12);

    // ── Regular rooms ────────────────────────────
    for (let attempt = 0; attempt < 400 && rooms.length < TARGET; attempt++) {
      const w  = MIN_W + Math.floor(Math.random() * (MAX_W - MIN_W + 1));
      const h  = MIN_H + Math.floor(Math.random() * (MAX_H - MIN_H + 1));
      const x  = 2 + Math.floor(Math.random() * (COLS - w - 4));
      const y  = 2 + Math.floor(Math.random() * (ROWS - h - 4));
      const room = { x, y, w, h };
      if (!rooms.some(r => roomsOverlap(r, room))) {
        carveRect(g, x, y, w, h);
        rooms.push(room);
      }
    }

    if (rooms.length < 3) {
      rooms.length = 0;
      [{ x:2,y:2,w:6,h:6 },{ x:15,y:5,w:7,h:7 },{ x:28,y:2,w:9,h:9 }]
        .forEach(r => { carveRect(g, r.x, r.y, r.w, r.h); rooms.push(r); });
    }

    // ── Connect regular rooms ────────────────────
    for (let i = 1; i < rooms.length; i++) {
      const a = roomCenter(rooms[i - 1]);
      const b = roomCenter(rooms[i]);
      carveCorridor(g, a.cx, a.cy, b.cx, b.cy);
    }
    // A few extra loops
    for (let i = 0; i < Math.ceil(rooms.length / 3); i++) {
      const a = roomCenter(rooms[Math.floor(Math.random() * rooms.length)]);
      const b = roomCenter(rooms[Math.floor(Math.random() * rooms.length)]);
      carveCorridor(g, a.cx, a.cy, b.cx, b.cy);
    }

    const startRoom = rooms[0];

    // ── Boss room ────────────────────────────────
    // Must be far from start, isolated (no overlap with existing rooms)
    let bossRoom = null;
    const MIN_BOSS_DIST = Math.max(COLS, ROWS) * 0.40;

    for (let attempt = 0; attempt < 800 && !bossRoom; attempt++) {
      const w = BOSS_MIN_W + Math.floor(Math.random() * 3);
      const h = BOSS_MIN_H + Math.floor(Math.random() * 3);
      const x = 3 + Math.floor(Math.random() * (COLS - w - 6));
      const y = 3 + Math.floor(Math.random() * (ROWS - h - 6));
      const candidate = { x, y, w, h };
      if (roomDist(startRoom, candidate) < MIN_BOSS_DIST) continue;
      if (rooms.some(r => roomsOverlap(r, candidate, 3))) continue;
      bossRoom = candidate;
    }

    // Fallback: expand the farthest room
    if (!bossRoom) {
      let farthest = rooms[rooms.length - 1], maxDist = 0;
      for (const r of rooms) {
        const d = roomDist(startRoom, r);
        if (d > maxDist) { maxDist = d; farthest = r; }
      }
      const idx = rooms.indexOf(farthest);
      const bw = Math.max(farthest.w, BOSS_MIN_W);
      const bh = Math.max(farthest.h, BOSS_MIN_H);
      bossRoom = {
        x: Math.max(3, Math.min(farthest.x, COLS - bw - 3)),
        y: Math.max(3, Math.min(farthest.y, ROWS - bh - 3)),
        w: bw, h: bh,
      };
      rooms.splice(idx, 1);
    }

    // Connect boss room from the last regular room via one corridor only
    const lastRegular = rooms[rooms.length - 1];
    const lc = roomCenter(lastRegular);

    // We need bc for sealBossRoom — define it here so sealBossRoom can use it
    const bc = roomCenter(bossRoom);

    // Carve boss room
    carveRect(g, bossRoom.x, bossRoom.y, bossRoom.w, bossRoom.h);

    // Carve the single corridor into the boss room
    carveCorridor(g, lc.cx, lc.cy, bc.cx, bc.cy);

    // Seal to one entrance — returns entrance info
    // We need bc inside sealBossRoom, so pass it explicitly
    const entrance = sealBossRoomWithCenters(g, bossRoom, lc, bc);

    rooms.push(bossRoom);

    // stairs position = boss room center (built later, only after boss dies)
    const stairsPos = { gx: bc.cx, gy: bc.cy };

    const lanterns = placeLanterns(g, rooms);
    const spawns   = enemySpawnPoints(rooms, floor);
    const chests   = chestPositions(rooms);

    return {
      grid: g,
      rooms,
      startRoom,
      bossRoom,
      bossEntrance: entrance,
      lanterns,
      spawns,
      chests,
      stairsPos,    // where stairs appear after boss dies
      TILE,
      WALL_H,
      COLS,
      ROWS,
      toWorld,
      roomCenter,
    };
  }

  /* ── Seal with explicit centers passed in ────── */
function sealBossRoomWithCenters(g, bossRoom, lc, bc) {
  const { x, y, w, h } = bossRoom;

  // Restore all border walls
  for (let col = x; col < x + w; col++) {
    g[y][col]         = 1;
    g[y + h - 1][col] = 1;
  }
  for (let row = y; row < y + h; row++) {
    g[row][x]         = 1;
    g[row][x + w - 1] = 1;
  }

  let side, tx, ty, wallTx, wallTy;

  // Determine which side of the boss room to open the door
  if (lc.cy < y) {
    // corridor above → north wall
    side   = 'north';
    tx     = Math.max(x + 1, Math.min(x + w - 2, bc.cx)); // not corners
    ty     = y;
    wallTx = tx;
    wallTy = ty - 1;
  } else if (lc.cy >= y + h) {
    // corridor below → south wall
    side   = 'south';
    tx     = Math.max(x + 1, Math.min(x + w - 2, bc.cx));
    ty     = y + h - 1;
    wallTx = tx;
    wallTy = ty + 1;
  } else if (lc.cx < x) {
    // corridor left → west wall
    side   = 'west';
    tx     = x;
    ty     = Math.max(y + 1, Math.min(y + h - 2, bc.cy));
    wallTx = tx - 1;
    wallTy = ty;
  } else {
    // corridor right → east wall
    side   = 'east';
    tx     = x + w - 1;
    ty     = Math.max(y + 1, Math.min(y + h - 2, bc.cy));
    wallTx = tx + 1;
    wallTy = ty;
  }

  // Make sure entrance is always on a wall tile
  g[ty][tx] = 0;

  // Open tile just outside the boss room for corridor
  if (wallTx >= 0 && wallTx < COLS && wallTy >= 0 && wallTy < ROWS) {
    g[wallTy][wallTx] = 0;
  }

  return { side, tx, ty, wallTx, wallTy };
}

  return { generate, TILE, WALL_H, COLS, ROWS, toWorld };

})();