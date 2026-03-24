/* ═══════════════════════════════════════════════════
   dungeon.js  —  Procedural dungeon generation
   Exports: Dungeon (namespace)
════════════════════════════════════════════════════ */
const Dungeon = (() => {

  const TILE   = 4;      // world-units per tile
  const WALL_H = 3.5;    // wall height in world units
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
    // horizontal then vertical (L-shaped)
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

  /* ── Lantern placement ───────────────────────── */
  function placeLanterns(g, rooms) {
    const lanterns = [];
    for (const room of rooms) {
      // Four corners just inside the room on wall tiles
      const candidates = [
        { x: room.x,             y: room.y },
        { x: room.x + room.w - 1, y: room.y },
        { x: room.x,             y: room.y + room.h - 1 },
        { x: room.x + room.w - 1, y: room.y + room.h - 1 },
      ];
      for (const c of candidates) {
        if (Math.random() < 0.65) lanterns.push(c);
      }
      // One lantern per long wall
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
    // Skip room 0 (start) and last room (boss room)
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
  function chestPositions(rooms) {
    const chests = [];
    for (let i = 1; i < rooms.length - 1; i++) {
      if (Math.random() < 0.45) {
        const r = rooms[i];
        chests.push({
          gx: r.x + 1 + Math.floor(Math.random() * (r.w - 2)),
          gy: r.y + 1 + Math.floor(Math.random() * (r.h - 2)),
          opened: false,
        });
      }
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
    const g           = grid();
    const rooms       = [];
    const MIN_W = 4, MAX_W = 9;
    const MIN_H = 4, MAX_H = 8;
    const TARGET      = 8 + Math.min(floor * 2, 12);

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

    // Connect in order with corridors
    for (let i = 1; i < rooms.length; i++) {
      const a = roomCenter(rooms[i - 1]);
      const b = roomCenter(rooms[i]);
      carveCorridor(g, a.cx, a.cy, b.cx, b.cy);
    }
    // A few random extra connections for loops
    for (let i = 0; i < Math.ceil(rooms.length / 3); i++) {
      const a = roomCenter(rooms[Math.floor(Math.random() * rooms.length)]);
      const b = roomCenter(rooms[Math.floor(Math.random() * rooms.length)]);
      carveCorridor(g, a.cx, a.cy, b.cx, b.cy);
    }

    const startRoom = rooms[0];
    const bossRoom  = rooms[rooms.length - 1];
    const lanterns  = placeLanterns(g, rooms);
    const spawns    = enemySpawnPoints(rooms, floor);
    const chests    = chestPositions(rooms);

    return {
      grid:       g,
      rooms,
      startRoom,
      bossRoom,
      lanterns,
      spawns,
      chests,
      TILE,
      WALL_H,
      COLS,
      ROWS,
      toWorld,
      roomCenter,
    };
  }

  return { generate, TILE, WALL_H, COLS, ROWS, toWorld };

})();
