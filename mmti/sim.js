// MMTI colony simulation. Runs independently of rendering: a clock advances
// seasons, colonist needs, jobs, room temperatures, fuel, crops, spoilage, and
// incidents. Every player order goes through MMTI.command(), where incidents
// capture the state and alternatives at the moment of decision.
window.MMTI = window.MMTI || {};
(() => {
  'use strict';
  const M = window.MMTI;

  const W = 40, H = 24;
  const T = { GRASS: 0, DIRT: 1, WATER: 2, FLOOR: 3, SAND: 4 };
  const TAU = 6;          // hours for an unheated room to close ~63% of the gap to outside
  const WALK = 40;        // tiles per game hour
  const STEP = 0.01;      // simulation substep, game hours
  const SAVE_KEY = 'mmti-colony-v3';
  const MAX_COLONISTS = 8;
  const CARRY = 40;
  const SEASON_DAYS = 5, YEAR_DAYS = 20;
  const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
  const SEASON_MID_TEMPS = [[2.5, 13], [7.5, 21], [12.5, 11], [17.5, -6]];
  const START_T = 2 * 24 + 8; // spring, day 3, 08:00
  const CROP_HOURS = 56;      // hours of warm daylight for potatoes to ripen
  const CROP_YIELD = 2;

  const ITEMS = {
    wood: { label: 'Wood', stack: 75 },
    berries: { label: 'Berries', stack: 50, spoil: 48, food: 0.3, raw: true },
    potato: { label: 'Potatoes', stack: 50, spoil: 480, food: 0.3, raw: true },
    meal: { label: 'Meals', stack: 20, spoil: 96, food: 0.9 },
  };

  const DEFS = {
    wall: { label: 'Wall', cost: 4, work: 0.4, blocks: true, boundary: true },
    door: { label: 'Door', cost: 6, work: 0.6, boundary: true },
    bed: { label: 'Bed', cost: 15, work: 1.5 },
    table: { label: 'Table', cost: 10, work: 1 },
    campfire: { label: 'Campfire', cost: 10, work: 1.5, heat: 30, fuelCap: 6, burnH: 3, always: true, cook: true, startFuel: 3 },
    stove: { label: 'Wood stove', cost: 20, work: 3, heat: 45, fuelCap: 10, burnH: 4, cook: true, startFuel: 4 },
    heater: { label: 'Heater', heat: 45, fuelCap: 10, burnH: 4 },
    tree: { label: 'Tree', natural: true },
    bush: { label: 'Berry bush', natural: true },
    keeper: { label: 'The Archivist' },
  };
  const BUILDABLE = ['wall', 'door', 'bed', 'table', 'campfire', 'stove'];
  const WORK_TYPES = ['build', 'repair', 'cook', 'grow', 'chop', 'haul'];

  const HEATER_CAUSES = {
    flue: { finding: 'The flue is clogged with soot. Cleaning it will fix the heater: about 1 hour of work.', work: 1, wood: 0, p: 0.6 },
    firebox: { finding: 'The firebox is cracked. Replacing it takes about 3 hours of work and 10 wood.', work: 3, wood: 10, p: 0.4 },
  };
  const BLOCK_CAUSES = {
    tree: { finding: 'A fallen tree blocks the old road. The caravan can clear it in about 1.5 hours and carry on.', clearable: true, p: 0.55 },
    rockslide: { finding: 'A rockslide has buried the old road. It cannot be cleared quickly.', clearable: false, p: 0.45 },
  };
  const CLEAR_HOURS = 1.5;
  const RETURN_HOURS = 3;

  const WORLD = {
    nodes: { C: [96, 300], R1: [214, 318], R2: [330, 332], R3: [470, 318], X: [640, 262], P1: [352, 200], P2: [470, 150], P3: [586, 176] },
    hours: { 'C-R1': 0.8, 'R1-R2': 0.7, 'R2-R3': 1, 'R3-X': 1, 'R2-P1': 1.4, 'P1-P2': 1.4, 'P2-P3': 1.3, 'P3-X': 0.9 },
  };
  const ROUTES = { start: ['C', 'R1', 'R2'], road: ['R2', 'R3', 'X'], pass: ['R2', 'P1', 'P2', 'P3', 'X'] };

  const PEOPLE = [
    { name: 'Mara', shirt: '#c0533a', hair: '#3b2a20', skills: { build: 1.3, repair: 1, plants: 0.9, cook: 0.9 }, prio: { build: 1, repair: 2, cook: 3, grow: 3, chop: 2, haul: 3 } },
    { name: 'Tobin', shirt: '#3d6f9e', hair: '#d9a441', skills: { build: 0.9, repair: 0.8, plants: 1.3, cook: 1 }, prio: { build: 3, repair: 3, cook: 3, grow: 1, chop: 2, haul: 2 } },
    { name: 'Ines', shirt: '#7a5aa0', hair: '#1c1c1c', skills: { build: 1, repair: 1.3, plants: 1, cook: 1.3 }, prio: { build: 2, repair: 1, cook: 1, grow: 3, chop: 3, haul: 2 } },
  ];
  const TRAVELERS = [
    { name: 'Dusk', role: 'trader', shirt: '#5b8a3a', hair: '#8a5a3c' },
    { name: 'Ansel', role: 'medic', shirt: '#e0e0d8', hair: '#6b4a2b' },
    { name: 'Kit', role: 'surveyor', shirt: '#c99a2e', hair: '#2a2018' },
    { name: 'Bo', role: 'young herder', shirt: '#8f3f6a', hair: '#b5543c' },
    { name: 'Rhea', role: 'smith', shirt: '#4a5a6a', hair: '#e8d8b0' },
  ];

  const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const idx = (x, y) => y * W + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const rand = (a, b) => a + Math.random() * (b - a);
  const half = (x) => Math.round(x * 2) / 2;
  const r2 = (x) => Math.round(x * 100) / 100;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function weighted(table) {
    let r = Math.random();
    const keys = Object.keys(table);
    for (const k of keys) if ((r -= table[k].p) < 0) return k;
    return keys[keys.length - 1];
  }
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let S = null;
  let blocked, structAt, byId, itemAt, stockSet, roomOf = null, rooms = null;
  const growRes = new Map();

  // ---------- calendar ----------
  const dayIndex = (t) => Math.floor(t / 24);
  function calendar(t) {
    const d = dayIndex(t) % YEAR_DAYS;
    return { season: SEASONS[Math.floor(d / SEASON_DAYS)], day: (d % SEASON_DAYS) + 1, year: Math.floor(dayIndex(t) / YEAR_DAYS) + 1 };
  }
  function seasonTemp(t) {
    const d = (t / 24) % YEAR_DAYS;
    const pts = SEASON_MID_TEMPS;
    for (let k = 0; k < pts.length; k++) {
      const [d0, v0] = pts[k];
      const [d1raw, v1] = pts[(k + 1) % pts.length];
      const d1 = d1raw <= d0 ? d1raw + YEAR_DAYS : d1raw;
      const dd = d < d0 ? d + YEAR_DAYS : d;
      if (dd >= d0 && dd <= d1) return v0 + ((v1 - v0) * (dd - d0)) / (d1 - d0);
    }
    return pts[0][1];
  }

  // ---------- world creation ----------
  function makeThing(s, type, x, y, extra) {
    const th = { id: s.nextId++, type, x, y, ...extra };
    const d = DEFS[type];
    if (d.fuelCap && th.fuel == null) th.fuel = extra && extra.bp ? 0 : d.fuelCap;
    s.things.push(th);
    return th;
  }

  function makeColonist(s, p, x, y) {
    return {
      id: s.nextId++, name: p.name, shirt: p.shirt, hair: p.hair,
      x, y, path: [], job: null, duty: null, carry: null,
      food: 0.8, rest: 0.9, cold: 0, weak: 0,
      skills: { build: 1, repair: 1, plants: 1, cook: 1, ...(p.skills || {}) },
      prio: { build: 3, repair: 3, cook: 3, grow: 3, chop: 3, haul: 3, ...(p.prio || {}) },
      away: false, bed: null, sleeping: false, facing: 1,
    };
  }

  function newColony() {
    const rnd = mulberry(20260922);
    const s = {
      version: 3, t: START_T, nextId: 1,
      terrain: new Array(W * H).fill(T.GRASS),
      things: [], colonists: [], items: [],
      zones: { stock: [], grow: {} },
      weather: { override: null, label: null, until: null },
      incident: null, caravan: null, letters: [],
      story: { nextAt: START_T + 7, counts: {}, travelers: 0 },
      roomTemps: [], lastDay: dayIndex(START_T), warn: {},
    };
    const set = (x, y, t) => { if (inb(x, y)) s.terrain[idx(x, y)] = t; };

    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const dx = (x - 33) / 4.8, dy = (y - 19) / 2.7, d = dx * dx + dy * dy;
      if (d < 1) set(x, y, T.WATER); else if (d < 1.45) set(x, y, T.SAND);
    }
    for (let x = 2; x < W; x++) {
      const y = 13 + (x > 26 && x % 9 < 4 ? 1 : 0);
      set(x, y, T.DIRT);
      if (x > 13 && x < 21) set(x, 12, T.DIRT);
    }
    for (let y = 10; y <= 12; y++) set(10, y, T.DIRT);
    for (let y = 8; y <= 12; y++) set(23, y, T.DIRT);

    const building = (x0, y0, x1, y1, dx, dy) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1;
        set(x, y, T.FLOOR);
        if (!edge) continue;
        makeThing(s, x === dx && y === dy ? 'door' : 'wall', x, y);
      }
    };
    building(6, 3, 13, 9, 10, 9);
    makeThing(s, 'bed', 7, 4);
    makeThing(s, 'bed', 9, 4);
    makeThing(s, 'bed', 11, 4);
    makeThing(s, 'heater', 12, 7);
    building(21, 3, 25, 7, 23, 7);
    makeThing(s, 'keeper', 23, 5);
    makeThing(s, 'table', 16, 11);
    makeThing(s, 'campfire', 20, 10, { fuel: 6 });

    for (let y = 15; y <= 16; y++) for (let x = 15; x <= 20; x++) s.zones.stock.push(idx(x, y));
    for (let y = 8; y <= 10; y++) for (let x = 28; x <= 32; x++) s.zones.grow[idx(x, y)] = { sown: false, growth: 0 };
    s.items.push({ id: s.nextId++, kind: 'wood', n: 60, x: 15, y: 15, age: 0 });
    s.items.push({ id: s.nextId++, kind: 'potato', n: 30, x: 16, y: 15, age: 0 });
    s.items.push({ id: s.nextId++, kind: 'meal', n: 4, x: 17, y: 15, age: 0 });

    const taken = new Set(s.things.map((th) => idx(th.x, th.y)));
    for (const i of s.zones.stock) taken.add(i);
    for (const k of Object.keys(s.zones.grow)) taken.add(Number(k));
    const free = (x, y) => inb(x, y) && s.terrain[idx(x, y)] === T.GRASS && !taken.has(idx(x, y));
    let placed = 0;
    for (let n = 0; n < 400 && placed < 9; n++) {
      const x = 2 + Math.floor(rnd() * 10), y = 16 + Math.floor(rnd() * 7);
      if (!free(x, y)) continue;
      makeThing(s, 'bush', x, y, { berries: true, regrowAt: 0 });
      taken.add(idx(x, y));
      placed++;
    }
    placed = 0;
    for (let n = 0; n < 900 && placed < 34; n++) {
      const x = Math.floor(rnd() * W), y = Math.floor(rnd() * H);
      if (!free(x, y)) continue;
      if (x >= 4 && x <= 33 && y >= 1 && y <= 16) continue;
      if (x <= 13 && y >= 15) continue;
      if (y >= 11 && y <= 14) continue;
      makeThing(s, 'tree', x, y, { variant: Math.floor(rnd() * 2), growth: 1 });
      taken.add(idx(x, y));
      placed++;
    }

    s.colonists.push(makeColonist(s, PEOPLE[0], 15, 12), makeColonist(s, PEOPLE[1], 16, 13), makeColonist(s, PEOPLE[2], 14, 13));
    letter(s, {
      kind: 'info', title: 'Welcome to the colony',
      body: 'Mara, Tobin, and Ines have a heated bedroom, a campfire for cooking, a field ready to plant, and a stockpile with some wood and potatoes.\n\n'
        + '• Click colonists and objects to see what they are doing.\n'
        + '• Zones: mark stockpiles, where goods are stored, and fields, where colonists plant potatoes.\n'
        + '• Architect: plan walls, doors, beds, tables, campfires, or a wood stove. Colonists carry wood to build them.\n'
        + '• Orders: mark trees to chop and berry bushes to pick.\n'
        + '• Fires and heaters burn wood. Food spoils, more slowly indoors and in the cold.\n'
        + '• Winter comes in 12 days: crops stop growing and the heater burns wood day and night.\n'
        + '• Space pauses. Keys 1, 2, 3 change speed.\n\n'
        + 'Things will go wrong. Handle them however you like. The Archivist, in the small hut, will tell you what she has noticed about you.',
    });
    return s;
  }

  // ---------- indexes, rooms, temperature ----------
  function reindex(s) {
    blocked = new Uint8Array(W * H);
    structAt = new Array(W * H).fill(null);
    byId = new Map();
    for (let i = 0; i < W * H; i++) if (s.terrain[i] === T.WATER) blocked[i] = 1;
    for (const th of s.things) {
      byId.set(th.id, th);
      const i = idx(th.x, th.y);
      structAt[i] = th;
      if (!th.bp && DEFS[th.type].blocks) blocked[i] = 1;
    }
    reindexItems(s);
    stockSet = new Set(s.zones.stock);
  }
  function reindexItems(s) {
    itemAt = new Map();
    for (const it of s.items) itemAt.set(idx(it.x, it.y), it);
  }

  function isBoundary(i) {
    const th = structAt[i];
    return !!(th && !th.bp && DEFS[th.type].boundary);
  }

  function outdoorTemp(s) {
    if (s.weather.override != null) return s.weather.override;
    return seasonTemp(s.t) + 5 * Math.sin((((s.t % 24) - 9) / 24) * 2 * Math.PI);
  }

  function recomputeRooms(s, saved) {
    const out = outdoorTemp(s);
    const prevOf = roomOf, prev = rooms;
    const prevTemp = (i) => {
      const r = prev && prev[prevOf[i]];
      return r && !r.outdoors ? r.temp : out;
    };
    const nextOf = new Int16Array(W * H).fill(-1);
    const next = [];
    for (let i = 0; i < W * H; i++) {
      if (nextOf[i] !== -1 || isBoundary(i)) continue;
      const id = next.length, tiles = [], stack = [i];
      let outdoors = false;
      nextOf[i] = id;
      while (stack.length) {
        const j = stack.pop();
        tiles.push(j);
        const x = j % W, y = (j / W) | 0;
        if (x === 0 || y === 0 || x === W - 1 || y === H - 1) outdoors = true;
        for (const [dx, dy] of DIRS4) {
          const nx = x + dx, ny = y + dy;
          if (!inb(nx, ny)) continue;
          const n = idx(nx, ny);
          if (nextOf[n] === -1 && !isBoundary(n)) { nextOf[n] = id; stack.push(n); }
        }
      }
      let temp = null;
      if (!outdoors) {
        if (prev) temp = tiles.reduce((a, t) => a + prevTemp(t), 0) / tiles.length;
        else {
          const hit = (saved || []).find(([ti]) => tiles.includes(ti));
          temp = hit ? hit[1] : out;
        }
      }
      next.push({ id, tiles, outdoors, temp });
    }
    roomOf = nextOf;
    rooms = next;
  }

  function roomAt(x, y) {
    if (!inb(x, y)) return null;
    const r = roomOf[idx(x, y)];
    return r >= 0 ? rooms[r] : null;
  }
  function tempAt(s, x, y) {
    const r = roomAt(x, y);
    return r && !r.outdoors ? r.temp : outdoorTemp(s);
  }
  const heating = (th) => !!DEFS[th.type].heat && !th.bp && !th.broken && th.lit;
  function heatSourcesIn(s, roomId, countUnlit) {
    let n = 0;
    for (const th of s.things) {
      if (!DEFS[th.type].heat || th.bp || th.broken) continue;
      if (!countUnlit && !(th.fuel > 0)) continue;
      if (roomOf[idx(th.x, th.y)] === roomId) n++;
    }
    return n;
  }
  function roomName(r) {
    if (!r || r.outdoors) return 'Outdoors';
    const set = new Set(r.tiles);
    const has = (type) => S.things.some((th) => th.type === type && !th.bp && set.has(idx(th.x, th.y)));
    if (has('keeper')) return 'Reflection hut';
    if (has('bed')) return 'Bedroom';
    if (r.tiles.some((t) => stockSet.has(t))) return 'Storeroom';
    return 'Room';
  }

  function updateTemps(s, dt) {
    const out = outdoorTemp(s);
    const heat = new Map();
    for (const th of s.things) {
      if (!heating(th)) continue;
      const r = roomOf[idx(th.x, th.y)];
      if (r >= 0 && !rooms[r].outdoors) heat.set(r, (heat.get(r) || 0) + DEFS[th.type].heat);
    }
    const k = 1 - Math.exp(-dt / TAU);
    for (const r of rooms) {
      if (r.outdoors) continue;
      const h = heat.get(r.id) || 0;
      const sf = Math.max(1, r.tiles.length / 30);
      const target = h > 0 ? Math.max(out, Math.min(21, out + h / sf)) : out;
      r.temp += (target - r.temp) * k;
    }
  }

  function burnFuel(s, dt) {
    const out = outdoorTemp(s);
    for (const th of s.things) {
      const d = DEFS[th.type];
      if (!d.fuelCap || th.bp) continue;
      const wants = !th.broken && (d.always || out < 18);
      th.lit = wants && th.fuel > 0;
      if (th.lit) th.fuel = Math.max(0, th.fuel - dt / d.burnH);
      if (wants && th.fuel <= 0 && !th.outWarned) {
        th.outWarned = true;
        const r = roomAt(th.x, th.y);
        letter(s, { kind: 'threat', title: `${d.label} out of fuel`, body: `The ${d.label.toLowerCase()}${r && !r.outdoors ? ` in the ${roomName(r).toLowerCase()}` : ''} has burned through its wood. Colonists refuel fires as hauling work, if there is wood in a stockpile.`, focus: { thingId: th.id } });
      }
      if (th.fuel > 1) th.outWarned = false;
    }
  }

  // ---------- items ----------
  function holdable(s, i, kind) {
    if (blocked[i] || structAt[i]) return false;
    const it = itemAt.get(i);
    return !it || (it.kind === kind && it.n < ITEMS[kind].stack);
  }
  function putOn(s, i, kind, n, age) {
    let it = itemAt.get(i);
    if (!it) {
      it = { id: s.nextId++, kind, n: 0, x: i % W, y: (i / W) | 0, age: 0 };
      s.items.push(it);
      itemAt.set(i, it);
    }
    const put = Math.min(n, ITEMS[kind].stack - it.n);
    it.age = (it.age * it.n + age * put) / (it.n + put);
    it.n += put;
    return n - put;
  }
  function dropItem(s, kind, n, x, y, age = 0) {
    let guard = 0;
    while (n > 0 && guard++ < 20) {
      const res = bfs(x, y, (tx, ty) => holdable(s, idx(tx, ty), kind), true);
      if (!res) return;
      n = putOn(s, idx(res.end[0], res.end[1]), kind, n, age);
    }
  }
  function takeItem(s, it, n) {
    const got = Math.min(n, it.n);
    it.n -= got;
    if (it.n <= 0) {
      s.items.splice(s.items.indexOf(it), 1);
      itemAt.delete(idx(it.x, it.y));
    }
    return got;
  }
  function counts(s) {
    const c = { wood: 0, berries: 0, potato: 0, meal: 0 };
    for (const it of s.items) c[it.kind] += it.n;
    for (const col of s.colonists) if (col.carry && !col.away) c[col.carry.kind] += col.carry.n;
    return c;
  }
  const rawFood = (c) => c.berries + c.potato;

  function spoilItems(s, dt) {
    for (let k = s.items.length - 1; k >= 0; k--) {
      const it = s.items[k];
      const d = ITEMS[it.kind];
      if (!d.spoil) continue;
      const temp = tempAt(s, it.x, it.y);
      const r = roomAt(it.x, it.y);
      const f = temp < 0 ? 0 : r && !r.outdoors ? (temp < 10 ? 0.4 : 1) : 1.5;
      it.age += dt * f;
      if (it.age >= d.spoil) {
        s.warn.rot = s.warn.rot || {};
        s.warn.rot[it.kind] = (s.warn.rot[it.kind] || 0) + it.n;
        s.items.splice(k, 1);
        itemAt.delete(idx(it.x, it.y));
      }
    }
  }

  // ---------- movement ----------
  function bfs(sx, sy, isGoal, ignoreStart) {
    const prev = new Int32Array(W * H).fill(-2);
    const start = idx(sx, sy);
    const q = [start];
    prev[start] = -1;
    for (let head = 0; head < q.length; head++) {
      const cur = q[head];
      const cx = cur % W, cy = (cur / W) | 0;
      if (isGoal(cx, cy)) {
        const path = [];
        for (let p = cur; p !== start; p = prev[p]) path.push([p % W, (p / W) | 0]);
        path.reverse();
        return { path, end: [cx, cy] };
      }
      for (const [dx, dy] of DIRS8) {
        const nx = cx + dx, ny = cy + dy;
        if (!inb(nx, ny)) continue;
        const n = idx(nx, ny);
        if (prev[n] !== -2 || blocked[n]) continue;
        if (dx && dy && (blocked[idx(cx + dx, cy)] || blocked[idx(cx, cy + dy)])) continue;
        prev[n] = cur;
        q.push(n);
      }
    }
    return ignoreStart ? null : null;
  }

  const tileOf = (c) => [Math.round(c.x), Math.round(c.y)];
  const health = (c) => 1 - Math.min(0.85, 0.9 * c.cold + 0.9 * c.weak);
  const workFactor = (c) => 0.35 + 0.65 * health(c);

  function moveAlong(c, dt) {
    let budget = WALK * (0.5 + 0.5 * health(c)) * dt;
    while (budget > 0 && c.path.length) {
      const [tx, ty] = c.path[0];
      const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
      if (dx) c.facing = Math.sign(dx);
      if (d <= budget) { c.x = tx; c.y = ty; budget -= d; c.path.shift(); }
      else { c.x += (dx / d) * budget; c.y += (dy / d) * budget; budget = 0; }
    }
    return c.path.length === 0;
  }

  function around(x, y, self) {
    const out = self ? [[x, y]] : [];
    for (const [dx, dy] of DIRS8) out.push([x + dx, y + dy]);
    return out;
  }
  // stand tiles for a target: things are worked from beside them (natural ones also from on top),
  // items and zone tiles from on top.
  function standTiles(tg) {
    if (tg.tile != null) return [[tg.tile % W, (tg.tile / W) | 0]];
    if (tg.kind && ITEMS[tg.kind]) return [[tg.x, tg.y]];
    if (tg.exact) return [[tg.x, tg.y]];
    return around(tg.x, tg.y, tg.type && DEFS[tg.type].natural);
  }
  function pathTo(from, targets) {
    if (!targets.length) return null;
    const stand = new Map();
    for (const tg of targets) {
      for (const [x, y] of standTiles(tg)) {
        if (!inb(x, y)) continue;
        const i = idx(x, y);
        if (!blocked[i] && !stand.has(i)) stand.set(i, tg);
      }
    }
    const res = bfs(from[0], from[1], (x, y) => stand.has(idx(x, y)));
    return res ? { path: res.path, tg: stand.get(idx(res.end[0], res.end[1])), end: res.end } : null;
  }

  function dropCarry(s, c) {
    if (!c.carry) return;
    const [x, y] = tileOf(c);
    dropItem(s, c.carry.kind, c.carry.n, x, y, c.carry.age || 0);
    c.carry = null;
  }

  function releaseRes(s, c) {
    for (const th of s.things) { if (th.res === c.id) th.res = null; if (th.resF === c.id) th.resF = null; if (th.resD === c.id) th.resD = null; }
    for (const it of s.items) if (it.res === c.id) it.res = null;
    for (const [k, v] of growRes) if (v === c.id) growRes.delete(k);
  }

  function endJob(s, c) {
    releaseRes(s, c);
    dropCarry(s, c);
    c.job = null;
    c.path = [];
    c.sleeping = false;
  }

  function bumpColonists(s) {
    for (const c of s.colonists) {
      if (c.away) continue;
      const [x, y] = tileOf(c);
      if (!blocked[idx(x, y)]) continue;
      const res = bfs(x, y, (tx, ty) => !blocked[idx(tx, ty)]);
      if (res) { c.x = res.end[0]; c.y = res.end[1]; }
      endJob(s, c);
    }
  }

  // ---------- jobs ----------
  const freeItems = (s, pred) => s.items.filter((it) => !it.res && pred(it));
  const isNight = (s) => { const h = s.t % 24; return h >= 22 || h < 6; };

  // A job whose first leg fetches items. Picks the target nearest the colonist, then the item nearest the colonist.
  function fetchJob(s, c, kind, targets, itemPred, amountFor, extra) {
    const from = tileOf(c);
    const tgPath = pathTo(from, targets);
    if (!tgPath) return null;
    const items = freeItems(s, itemPred);
    const itPath = pathTo(from, items);
    if (!itPath) return null;
    const tg = tgPath.tg;
    c.path = itPath.path;
    itPath.tg.res = c.id;
    return { kind, targetId: tg.id != null ? tg.id : null, tile: tg.tile != null ? tg.tile : null, itemId: itPath.tg.id, need: amountFor(tg, itPath.tg), stage: 'fetch', work: 0, ...extra };
  }
  function goJob(s, c, kind, targets, extra) {
    const res = pathTo(tileOf(c), targets);
    if (!res) return null;
    c.path = res.path;
    return { kind, targetId: res.tg.id != null ? res.tg.id : null, tile: res.tg.tile != null ? res.tg.tile : null, stage: 'walk', work: 0, ...extra, _tg: res.tg };
  }

  function mealTarget(s) { return 2 + 3 * s.colonists.filter((c) => !c.away).length; }

  function workJob(s, c, type) {
    const cnt = counts(s);
    switch (type) {
      case 'build': {
        const ready = s.things.filter((th) => th.bp && !th.res && (th.delivered || 0) >= DEFS[th.type].cost);
        let j = goJob(s, c, 'build', ready);
        if (j) { j._tg.res = c.id; return j; }
        const needy = s.things.filter((th) => th.bp && !th.resD && (th.delivered || 0) < DEFS[th.type].cost);
        j = fetchJob(s, c, 'deliver', needy, (it) => it.kind === 'wood', (tg) => Math.min(CARRY, DEFS[tg.type].cost - (tg.delivered || 0)));
        if (j) byId.get(j.targetId).resD = c.id;
        return j;
      }
      case 'repair': {
        const ordered = s.things.filter((th) => th.repairOrdered && th.broken && th.diagnosis);
        const ready = ordered.filter((th) => !th.res && (th.repairDelivered || 0) >= HEATER_CAUSES[th.diagnosis].wood);
        let j = goJob(s, c, 'repair', ready);
        if (j) { j._tg.res = c.id; return j; }
        const needy = ordered.filter((th) => !th.resD && (th.repairDelivered || 0) < HEATER_CAUSES[th.diagnosis].wood);
        j = fetchJob(s, c, 'deliverRepair', needy, (it) => it.kind === 'wood', (tg) => HEATER_CAUSES[tg.diagnosis].wood - (tg.repairDelivered || 0));
        if (j) byId.get(j.targetId).resD = c.id;
        return j;
      }
      case 'cook': {
        if (cnt.meal >= mealTarget(s)) return null;
        const stations = s.things.filter((th) => DEFS[th.type].cook && !th.bp && !th.res && th.fuel > 0);
        const j = fetchJob(s, c, 'cook', stations, (it) => ITEMS[it.kind].raw && it.n >= 2, () => 2);
        if (j) byId.get(j.targetId).res = c.id;
        return j;
      }
      case 'grow': {
        const targets = [];
        for (const [k, p] of Object.entries(s.zones.grow)) {
          const i = Number(k);
          if (growRes.has(i) || blocked[i] || structAt[i]) continue;
          const x = i % W, y = (i / W) | 0;
          if (p.sown && p.growth >= 1) targets.push({ tile: i, task: 'harvestCrop' });
          else if (!p.sown && !itemAt.has(i) && tempAt(s, x, y) > 4 && calendar(s.t).season !== 'Winter') targets.push({ tile: i, task: 'sow' });
        }
        for (const th of s.things) if (th.type === 'bush' && th.des === 'harvest' && th.berries && !th.res) targets.push(th);
        const j = goJob(s, c, 'grow', targets);
        if (!j) return null;
        if (j._tg.tile != null) { growRes.set(j._tg.tile, c.id); j.kind = j._tg.task; }
        else { j._tg.res = c.id; j.kind = 'pick'; }
        return j;
      }
      case 'chop': {
        const j = goJob(s, c, 'chop', s.things.filter((th) => th.type === 'tree' && th.des === 'chop' && !th.res && (th.growth == null || th.growth >= 0.5)));
        if (j) j._tg.res = c.id;
        return j;
      }
      case 'haul': {
        const fuelNeeds = s.things.filter((th) => DEFS[th.type].fuelCap && !th.bp && !th.resF && th.fuel < DEFS[th.type].fuelCap * 0.5);
        let j = fetchJob(s, c, 'refuel', fuelNeeds, (it) => it.kind === 'wood', (tg) => Math.ceil(DEFS[tg.type].fuelCap - tg.fuel));
        if (j) { byId.get(j.targetId).resF = c.id; return j; }
        if (!s.zones.stock.length) return null;
        const loose = freeItems(s, (it) => !stockSet.has(idx(it.x, it.y)) && s.zones.stock.some((i) => holdable(s, i, it.kind)));
        j = goJob(s, c, 'haul', loose);
        if (j) { j._tg.res = c.id; j.itemId = j._tg.id; j.stage = 'fetch'; j.need = CARRY; }
        return j;
      }
      default: return null;
    }
  }

  function eatJob(s, c) {
    const foods = freeItems(s, (it) => ITEMS[it.kind].food);
    const meals = foods.filter((it) => it.kind === 'meal');
    const res = pathTo(tileOf(c), meals.length ? meals : foods);
    if (!res) return null;
    c.path = res.path;
    res.tg.res = c.id;
    const per = ITEMS[res.tg.kind].food;
    const need = res.tg.kind === 'meal' ? 1 : Math.max(1, Math.min(3, Math.ceil((0.95 - c.food) / per)));
    return { kind: 'eat', itemId: res.tg.id, need, stage: 'fetch', work: 0 };
  }

  function assignJob(s, c) {
    if (c.food < 0.3) { const j = eatJob(s, c); if (j) return j; }
    if (c.rest < 0.15 || (isNight(s) && c.rest < 0.95)) {
      let bed = c.bed != null ? byId.get(c.bed) : null;
      if (!bed || bed.bp) {
        const owned = new Set(s.colonists.filter((o) => o !== c && o.bed != null).map((o) => o.bed));
        bed = s.things.find((th) => th.type === 'bed' && !th.bp && !owned.has(th.id)) || null;
        c.bed = bed ? bed.id : null;
      }
      const j = bed && goJob(s, c, 'sleep', [{ id: bed.id, x: bed.x, y: bed.y, exact: true }]);
      return j || { kind: 'sleep', targetId: null, stage: 'work', work: 0 };
    }
    if (c.duty) {
      const th = byId.get(c.duty.targetId);
      const j = th && goJob(s, c, c.duty.kind, [th]);
      if (j) return j;
      c.duty = null;
    }
    for (let p = 1; p <= 4; p++) {
      for (const w of WORK_TYPES) {
        if (c.prio[w] !== p) continue;
        const j = workJob(s, c, w);
        if (j) return j;
      }
    }
    const [cx, cy] = tileOf(c);
    const r = roomAt(cx, cy);
    for (let n = 0; n < 8; n++) {
      const x = cx + Math.round(rand(-5, 5)), y = cy + Math.round(rand(-5, 5));
      if (!inb(x, y) || blocked[idx(x, y)] || roomAt(x, y) !== r) continue;
      const j = goJob(s, c, 'wander', [{ x, y, exact: true }]);
      if (j) return j;
    }
    return { kind: 'wander', targetId: null, stage: 'work', work: 0 };
  }

  function afterFetch(s, c, j) {
    const it = s.items.find((x) => x.id === j.itemId);
    if (!it) return endJob(s, c);
    const kind = it.kind, age = it.age;
    const got = takeItem(s, it, j.need);
    it.res = null;
    c.carry = { kind, n: got, age };
    const from = tileOf(c);
    let res = null;
    if (j.kind === 'haul') {
      const spot = bfs(from[0], from[1], (x, y) => stockSet.has(idx(x, y)) && holdable(s, idx(x, y), kind));
      if (spot) { res = { path: spot.path }; j.tile = idx(spot.end[0], spot.end[1]); }
    } else if (j.kind === 'eat') {
      const tables = s.things.filter((th) => th.type === 'table' && !th.bp);
      const t = pathTo(from, tables);
      res = t && t.path.length < 15 ? t : { path: [] };
    } else {
      const th = byId.get(j.targetId);
      if (th) res = pathTo(from, [th]);
    }
    if (!res) return endJob(s, c);
    c.path = res.path;
    j.stage = 'walk';
  }

  function runJob(s, c, dt) {
    const j = c.job;
    if (j.stage === 'fetch' || j.stage === 'walk') {
      const next = c.path[0];
      if (next && blocked[idx(next[0], next[1])]) return endJob(s, c);
      if (!moveAlong(c, dt)) return;
      if (j.stage === 'fetch') return afterFetch(s, c, j);
      j.stage = 'work';
      return;
    }
    const th = j.targetId != null ? byId.get(j.targetId) : null;
    const wf = workFactor(c);
    switch (j.kind) {
      case 'wander':
        j.work += dt;
        if (j.work >= 0.4) endJob(s, c);
        return;
      case 'eat':
        j.work += dt;
        if (j.work >= 0.4) {
          if (c.carry) c.food = Math.min(1, c.food + c.carry.n * ITEMS[c.carry.kind].food);
          c.carry = null;
          endJob(s, c);
        }
        return;
      case 'sleep':
        c.sleeping = true;
        c.rest = Math.min(1, c.rest + dt / 7);
        if ((!isNight(s) && c.rest >= 0.9) || c.food < 0.12) endJob(s, c);
        return;
      case 'deliver':
        if (th && th.bp && c.carry) {
          const need = DEFS[th.type].cost - (th.delivered || 0);
          const put = Math.min(need, c.carry.n);
          th.delivered = (th.delivered || 0) + put;
          c.carry.n -= put;
          if (c.carry.n <= 0) c.carry = null;
        }
        return endJob(s, c);
      case 'deliverRepair':
        if (th && th.broken && th.diagnosis && c.carry) {
          const need = HEATER_CAUSES[th.diagnosis].wood - (th.repairDelivered || 0);
          const put = Math.min(need, c.carry.n);
          th.repairDelivered = (th.repairDelivered || 0) + put;
          c.carry.n -= put;
          if (c.carry.n <= 0) c.carry = null;
        }
        return endJob(s, c);
      case 'refuel':
        if (th && c.carry) {
          const cap = DEFS[th.type].fuelCap;
          const put = Math.min(Math.ceil(cap - th.fuel), c.carry.n);
          th.fuel = Math.min(cap, th.fuel + put);
          c.carry.n -= put;
          if (c.carry.n <= 0) c.carry = null;
        }
        return endJob(s, c);
      case 'haul':
        if (c.carry && j.tile != null) {
          const left = holdable(s, j.tile, c.carry.kind) ? putOn(s, j.tile, c.carry.kind, c.carry.n, c.carry.age) : c.carry.n;
          c.carry.n = left;
          if (left <= 0) c.carry = null;
        }
        return endJob(s, c);
      case 'build': {
        if (!th || !th.bp) return endJob(s, c);
        const d = DEFS[th.type];
        th.progress = (th.progress || 0) + dt * c.skills.build * wf;
        if (th.progress >= d.work) {
          th.bp = false;
          delete th.progress;
          delete th.delivered;
          if (d.fuelCap) th.fuel = d.startFuel || 0;
          endJob(s, c);
          reindex(s);
          if (d.boundary) recomputeRooms(s);
          bumpColonists(s);
        }
        return;
      }
      case 'repair': {
        if (!th || !th.broken || !th.repairOrdered) return endJob(s, c);
        const cause = HEATER_CAUSES[th.diagnosis];
        th.repairProgress = (th.repairProgress || 0) + dt * c.skills.repair * wf;
        if (th.repairProgress >= cause.work) {
          th.broken = false;
          th.repairOrdered = false;
          th.repairProgress = 0;
          th.repairDelivered = 0;
          th.diagnosis = null;
          letter(s, { kind: 'good', title: 'Heater repaired', body: `${c.name} got the heater working again.`, focus: { thingId: th.id } });
          endJob(s, c);
        }
        return;
      }
      case 'cook':
        if (!th || !(th.fuel > 0) || !c.carry) return endJob(s, c);
        j.work += dt * c.skills.cook * wf;
        if (j.work >= 0.6) {
          c.carry = null;
          dropItem(s, 'meal', 1, Math.round(c.x), Math.round(c.y));
          endJob(s, c);
        }
        return;
      case 'sow': {
        const p = s.zones.grow[j.tile];
        if (!p || p.sown) return endJob(s, c);
        j.work += dt * c.skills.plants * wf;
        if (j.work >= 0.3) { p.sown = true; p.growth = 0; endJob(s, c); }
        return;
      }
      case 'harvestCrop': {
        const p = s.zones.grow[j.tile];
        if (!p || !p.sown || p.growth < 1) return endJob(s, c);
        j.work += dt * c.skills.plants * wf;
        if (j.work >= 0.4) {
          p.sown = false;
          p.growth = 0;
          dropItem(s, 'potato', CROP_YIELD, j.tile % W, (j.tile / W) | 0);
          endJob(s, c);
        }
        return;
      }
      case 'pick':
        if (!th || !th.berries || th.des !== 'harvest') return endJob(s, c);
        th.progress = (th.progress || 0) + dt * c.skills.plants * wf;
        if (th.progress >= 0.6) {
          th.berries = false;
          th.progress = 0;
          th.regrowAt = s.t + 72;
          dropItem(s, 'berries', 4, th.x, th.y);
          endJob(s, c);
        }
        return;
      case 'chop':
        if (!th || th.des !== 'chop') return endJob(s, c);
        th.progress = (th.progress || 0) + dt * c.skills.plants * wf;
        if (th.progress >= 1.2) {
          const wood = Math.max(1, Math.round(10 * (th.growth == null ? 1 : th.growth)));
          s.things.splice(s.things.indexOf(th), 1);
          reindex(s);
          endJob(s, c);
          dropItem(s, 'wood', wood, th.x, th.y);
        }
        return;
      case 'inspect': {
        const inc = s.incident;
        if (!th || !inc || inc.reportIn) { c.duty = null; return endJob(s, c); }
        j.work += dt;
        return;
      }
      default:
        endJob(s, c);
    }
  }

  function stepColonist(s, c, dt) {
    if (!c.sleeping) c.rest = Math.max(0, c.rest - dt / 18);
    c.food = Math.max(0, c.food - dt / 20);
    const [x, y] = tileOf(c);
    const temp = tempAt(s, x, y);
    // Awake colonists are dressed for the season; asleep in a freezing room they are not.
    if ((c.sleeping && temp < 0) || temp < -12) c.cold = Math.min(1, c.cold + dt * 0.14 * Math.min(3, (5 - temp) / 5));
    else c.cold = Math.max(0, c.cold - dt * (temp > 12 ? 0.05 : 0.02));
    if (c.food <= 0) c.weak = Math.min(1, c.weak + dt * 0.02);
    else c.weak = Math.max(0, c.weak - dt * 0.02);
    if (c.cold > 0.3 && !c.coldWarned) {
      c.coldWarned = true;
      letter(s, { kind: 'threat', title: `${c.name} has hypothermia`, body: `${c.name} got dangerously cold and is working and walking slowly until they warm up.`, focus: { colonistId: c.id } });
    }
    if (c.cold === 0) c.coldWarned = false;
    if (c.food <= 0 && !c.hungerWarned) {
      c.hungerWarned = true;
      letter(s, { kind: 'threat', title: `${c.name} is starving`, body: `${c.name} has nothing to eat and is getting weaker.`, focus: { colonistId: c.id } });
    }
    if (c.food > 0.3) c.hungerWarned = false;
    if (!c.job) { c.job = assignJob(s, c); if (c.job) delete c.job._tg; }
    runJob(s, c, dt);
  }

  // ---------- nature ----------
  function natureStep(s, dt) {
    const out = outdoorTemp(s);
    const hour = s.t % 24;
    let frost = 0;
    for (const p of Object.values(s.zones.grow)) {
      if (!p.sown || p.growth >= 1) continue;
      if (out < -6) { p.sown = false; p.growth = 0; frost++; }
      else if (out >= 6 && hour >= 6 && hour < 20) p.growth = Math.min(1, p.growth + dt / CROP_HOURS);
    }
    if (frost) s.warn.frost = (s.warn.frost || 0) + frost;
    for (const th of s.things) {
      if (th.type === 'bush' && !th.berries && s.t >= th.regrowAt && out > 5) th.berries = true;
      if (th.type === 'tree' && th.growth != null && th.growth < 1 && out > 5) th.growth = Math.min(1, th.growth + dt / 120);
    }
  }

  function dailyTick(s) {
    const day = dayIndex(s.t);
    if (day === s.lastDay) return;
    s.lastDay = day;
    const cal = calendar(s.t);
    if (cal.day === 1) {
      const notes = {
        Spring: 'The ground has thawed. Fields can be planted again and the heater can rest during warm days.',
        Summer: 'Long warm days. Crops grow fastest now.',
        Fall: 'Winter comes in 5 days. Crops still in the ground then will be lost to frost, and the heater will burn wood day and night. Store food and wood.',
        Winter: 'Winter has arrived. Nothing grows until spring, and unheated rooms freeze at night.',
      };
      letter(s, { kind: cal.season === 'Fall' || cal.season === 'Winter' ? 'threat' : 'info', title: `${cal.season} has begun`, body: notes[cal.season] });
    }
    if (cal.season !== 'Winter') {
      for (let n = 0; n < 3; n++) {
        const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * H);
        const i = idx(x, y);
        if (s.terrain[i] !== T.GRASS || structAt[i] || itemAt.has(i) || s.zones.grow[i] || stockSet.has(i)) continue;
        if (x >= 4 && x <= 27 && y >= 1 && y <= 16) continue;
        makeThing(s, 'tree', x, y, { variant: Math.floor(Math.random() * 2), growth: 0.05 });
        reindex(s);
        break;
      }
    }
  }

  function warnings(s) {
    if (s.warn.rot && s.t >= (s.warn.rotAt || 0)) {
      const parts = Object.entries(s.warn.rot).map(([k, n]) => `${n} ${ITEMS[k].label.toLowerCase()}`);
      letter(s, { kind: 'threat', title: 'Food spoiled', body: `${parts.join(' and ')} rotted away. Food keeps longer indoors, and much longer below freezing.` });
      s.warn.rot = null;
      s.warn.rotAt = s.t + 12;
    }
    if (s.warn.frost && s.t >= (s.warn.frostAt || 0)) {
      letter(s, { kind: 'threat', title: 'Frost killed crops', body: `${s.warn.frost} unripe potato plants froze.` });
      s.warn.frost = 0;
      s.warn.frostAt = s.t + 12;
    }
    const cnt = counts(s);
    const home = s.colonists.filter((c) => !c.away).length;
    const nutrition = rawFood(cnt) * 0.3 + cnt.meal * 0.9;
    if (nutrition < home * 1.5 && s.t >= (s.warn.lowFoodAt || 0)) {
      letter(s, { kind: 'threat', title: 'Food is running low', body: 'There is less than about a day of food left. Pick berries, harvest the fields, or cook what is left.' });
      s.warn.lowFoodAt = s.t + 36;
    }
    if (cnt.wood < 10 && s.t >= (s.warn.lowWoodAt || 0)) {
      letter(s, { kind: 'threat', title: 'Wood is running low', body: 'Fires and heaters need wood to keep burning. Mark trees to chop.' });
      s.warn.lowWoodAt = s.t + 36;
    }
  }

  // ---------- incidents ----------
  function obs(name, inc, extra) {
    const o = M.observe;
    if (o && typeof o[name] === 'function') o[name](inc, extra, S);
  }

  function dormHeater(s) { return s.things.find((th) => th.type === 'heater' && !th.bp) || null; }
  const home = (s) => s.colonists.filter((c) => !c.away);

  function heatingViable(s) {
    const heater = dormHeater(s);
    if (!heater || heater.broken || !(heater.fuel > 2)) return false;
    const r = roomAt(heater.x, heater.y);
    return !!r && !r.outdoors && heatSourcesIn(s, r.id) === 1 && counts(s).wood >= 30 && home(s).length >= 2;
  }
  function caravanViable(s) { return !s.caravan && home(s).filter((c) => health(c) > 0.5).length >= 3; }

  function storyTick(s) {
    if (s.incident || s.caravan || s.t < s.story.nextAt) return;
    const ok = { heating: heatingViable(s), caravan: caravanViable(s) };
    let cell;
    if (M.review) {
      if (!ok[M.review.type]) { s.story.nextAt = s.t + 0.5; return; }
      cell = { type: M.review.type, deadline: M.review.deadline, review: true };
      M.review = null;
    } else {
      const cells = [];
      for (const type of ['heating', 'caravan']) if (ok[type]) for (const d of ['urgent', 'none']) cells.push({ type, deadline: d });
      if (!cells.length) { s.story.nextAt = s.t + 2; return; }
      const count = (c) => s.story.counts[`${c.type}|${c.deadline}`] || 0;
      const min = Math.min(...cells.map(count));
      cell = pick(cells.filter((c) => count(c) === min));
      s.story.counts[`${cell.type}|${cell.deadline}`] = count(cell) + 1;
    }
    if (cell.type === 'heating') startHeating(s, cell.deadline, !!cell.review);
    else startCaravanRequest(s, cell.deadline, !!cell.review);
  }

  function startHeating(s, deadlineKind, review) {
    const heater = dormHeater(s);
    const room = roomAt(heater.x, heater.y);
    const inspector = home(s).slice().sort((a, b) => b.skills.repair - a.skills.repair)[0];
    const reportIn = half(rand(2.5, 3.5));
    const cause = weighted(HEATER_CAUSES);
    let deadlineT = null;
    if (deadlineKind === 'urgent') {
      // Choose the cold snap so the bedroom reaches 0°C exactly D hours from now:
      // waiting for the report and doing the slowest repair still fits, with slack for walking and hauling.
      const D = half(reportIn + 3 + rand(3, 4));
      const e = Math.exp(-D / TAU);
      const t0 = room.temp;
      s.weather = { override: Math.round((-t0 * e / (1 - e)) * 10) / 10, label: 'Cold snap', until: null };
      deadlineT = s.t + D;
    } else {
      s.weather = { override: 11, label: 'Mild spell', until: null };
    }
    heater.broken = true;
    heater.diagnosis = null;
    heater.repairOrdered = false;
    heater.repairDelivered = 0;
    const inc = {
      id: s.nextId++, kind: 'heating', deadlineKind, review, startT: s.t,
      reportT: s.t + reportIn, deadlineT, cause, heaterId: heater.id, inspectorId: inspector.id,
      reportIn: false, committed: null, frozeAt: null,
    };
    s.incident = inc;
    inspector.duty = { kind: 'inspect', targetId: heater.id };
    endJob(s, inspector);
    const D = deadlineT != null ? r2(deadlineT - s.t) : null;
    letter(s, {
      kind: 'threat', title: 'The heater broke down',
      body: `The bedroom heater has stopped working. ${inspector.name} is inspecting it; a report should come in about ${reportIn} hours.`
        + (D != null ? `\n\nA cold snap has set in. The bedroom will drop below freezing in about ${D} hours.` : '\n\nThe weather is mild for now, so nobody is in danger, but the bedroom will get chilly.'),
      focus: { thingId: heater.id },
    });
    obs('episodeStart', inc);
  }

  function heatingAlternatives(s, inc) {
    const heater = byId.get(inc.heaterId);
    const wood = counts(s).wood;
    return { repair: !!(heater && heater.diagnosis), buildHeat: ['campfire', 'stove'].filter((k) => wood >= DEFS[k].cost), wood };
  }

  function heatingTick(s, inc) {
    const heater = byId.get(inc.heaterId);
    if (!heater) return finishHeating(s, inc, 'heater-removed');
    if (!inc.reportIn && s.t >= inc.reportT) {
      inc.reportIn = true;
      heater.diagnosis = inc.cause;
      const who = s.colonists.find((c) => c.id === inc.inspectorId);
      letter(s, {
        kind: 'info', title: 'Inspection report', reportFor: inc.id,
        body: `${who ? who.name : 'The inspector'} finished looking at the heater.\n\n${HEATER_CAUSES[inc.cause].finding}\n\nSelect the heater to order the repair.`,
        focus: { thingId: heater.id },
      });
      obs('reportArrived', inc);
    }
    const r = roomAt(heater.x, heater.y);
    if (r && !r.outdoors && r.temp < 0 && inc.frozeAt == null) {
      inc.frozeAt = s.t;
      letter(s, { kind: 'threat', title: 'The bedroom is freezing', body: 'The bedroom has dropped below 0°C. Anyone sleeping there will get hypothermia.', focus: { thingId: heater.id } });
    }
    const warm = r && !r.outdoors && s.things.some((th) => heating(th) && roomOf[idx(th.x, th.y)] === r.id) && r.temp >= 12;
    if (warm && inc.committed) return finishHeating(s, inc, 'warm');
    if (s.t >= inc.startT + 30) return finishHeating(s, inc, 'timeout');
  }

  function finishHeating(s, inc, how) {
    s.weather.until = s.t + (inc.deadlineKind === 'urgent' ? 4 : 1);
    const inspector = s.colonists.find((c) => c.id === inc.inspectorId);
    if (inspector) inspector.duty = null;
    obs('episodeEnd', inc, { how, resolvedAt: r2(s.t), froze: inc.frozeAt != null, frozeAt: inc.frozeAt != null ? r2(inc.frozeAt) : null });
    if (how === 'warm') letter(s, { kind: 'good', title: 'The bedroom is warm again', body: inc.frozeAt != null ? 'Heat is back, though the room froze for a while first.' : 'Heat came back before the room froze.' });
    s.incident = null;
    s.story.nextAt = s.t + rand(10, 16);
  }

  function caravanCandidates(s) {
    // Send the two healthy colonists least needed for construction at home.
    return home(s).filter((c) => health(c) > 0.5).sort((a, b) => a.prio.build - b.prio.build).slice(-2);
  }

  function startCaravanRequest(s, deadlineKind, review) {
    const traveler = TRAVELERS[s.story.travelers++ % TRAVELERS.length];
    const inc = {
      id: s.nextId++, kind: 'caravan', stage: 'request', deadlineKind, review, requestT: s.t,
      traveler, cause: weighted(BLOCK_CAUSES), reportIn: false, committed: null,
    };
    s.incident = inc;
    letter(s, {
      kind: 'quest', title: 'A traveler needs help', forIncident: inc.id,
      body: (deadlineKind === 'urgent'
        ? `${traveler.name}, a ${traveler.role}, is stranded east of here and running out of water. A caravan of two colonists could reach them along the old road.`
        : `${traveler.name}, a ${traveler.role}, is waiting at a well-stocked camp east of here and asks for an escort. A caravan of two colonists could bring them back along the old road.`)
        + '\n\nWhile the caravan is away, its two colonists do no work at home.',
      actions: [{ label: 'Form a caravan', cmd: { type: 'caravan-send' } }, { label: 'Decline', cmd: { type: 'caravan-decline' } }],
    });
  }

  const segHours = (a, b) => WORLD.hours[`${a}-${b}`] || WORLD.hours[`${b}-${a}`] || 1;

  function caravanTick(s, inc, dt) {
    if (inc.stage === 'request') {
      if (s.t >= inc.requestT + 8) declineCaravan(s, inc, true);
      return;
    }
    const cv = s.caravan;
    if (!cv) return;
    if (cv.status === 'outbound') {
      cv.prog += dt;
      const seg = segHours(cv.route[cv.seg], cv.route[cv.seg + 1]);
      if (cv.prog >= seg) {
        cv.prog = 0;
        cv.seg++;
        const at = cv.route[cv.seg];
        if (at === 'R2' && inc.stage === 'travel') return setback(s, inc, cv);
        if (at === 'X') return arrive(s, inc, cv);
      }
    } else if (cv.status === 'clearing') {
      cv.clear += dt;
      if (cv.clear >= CLEAR_HOURS) { cv.status = 'outbound'; cv.route = ROUTES.road.slice(); cv.seg = 0; cv.prog = 0; inc.cleared = true; }
    } else if (cv.status === 'returning') {
      cv.prog += dt;
      if (cv.prog >= RETURN_HOURS) return returnHome(s, inc, cv);
    }
    if (inc.stage === 'setback') {
      if (!inc.reportIn && s.t >= inc.reportT) {
        inc.reportIn = true;
        const scout = s.colonists.find((c) => c.id === cv.members[0]);
        letter(s, {
          kind: 'info', title: 'Scout report', reportFor: inc.id,
          body: `${scout ? scout.name : 'The scout'} came back from the blockage.\n\n${BLOCK_CAUSES[inc.cause].finding}`,
          focus: { world: 'blockage' },
        });
        obs('reportArrived', inc);
      }
      if (cv.status === 'blocked' && s.t >= inc.startT + 24) {
        obs('episodeEnd', inc, { how: 'gave-up', reason: 'no-decision' });
        letter(s, { kind: 'threat', title: 'The caravan turned back', body: `After a day at the blockage, the caravan gave up on ${inc.traveler.name} and is heading home.` });
        cv.status = 'returning';
        cv.prog = 0;
        inc.stage = 'returning';
        inc.failed = true;
      }
    }
  }

  function setback(s, inc, cv) {
    cv.status = 'blocked';
    inc.stage = 'setback';
    inc.startT = s.t;
    const reportIn = half(rand(2, 3));
    inc.reportT = s.t + reportIn;
    inc.deadlineT = inc.deadlineKind === 'urgent' ? s.t + half(reportIn + 5 + rand(1.5, 2.5)) : null;
    const names = cv.members.map((id) => s.colonists.find((c) => c.id === id).name);
    const D = inc.deadlineT != null ? r2(inc.deadlineT - s.t) : null;
    letter(s, {
      kind: 'threat', title: 'The road is blocked',
      body: `${names.join(' and ')} found the old road blocked. ${names[0]} has gone ahead to look; a report should come in about ${reportIn} hours.\n\n`
        + (D != null ? `${inc.traveler.name} has water for about ${D} more hours. The mountain pass goes around the blockage, about 5 hours to the camp.`
          : `${inc.traveler.name} is safe at camp. The mountain pass goes around the blockage, about 5 hours to the camp.`),
      focus: { world: 'caravan' },
    });
    obs('episodeStart', inc);
  }

  function arrive(s, inc, cv) {
    const late = inc.deadlineT != null && s.t > inc.deadlineT;
    inc.late = late;
    obs('episodeEnd', inc, { how: 'arrived', arrivedAt: r2(s.t), late, route: inc.cleared ? 'road' : 'pass' });
    letter(s, late
      ? { kind: 'threat', title: `Reached ${inc.traveler.name}, late`, body: `The caravan reached ${inc.traveler.name} after the water ran out. They are badly dehydrated and will need rest. Everyone is heading home.` }
      : { kind: 'good', title: `Reached ${inc.traveler.name}`, body: `The caravan reached ${inc.traveler.name}. Everyone is heading home.` });
    cv.status = 'returning';
    cv.prog = 0;
    inc.stage = 'returning';
  }

  function returnHome(s, inc, cv) {
    const edge = [[W - 1, 12], [W - 1, 13], [W - 1, 14]];
    cv.members.forEach((id, n) => {
      const c = s.colonists.find((o) => o.id === id);
      if (!c) return;
      c.away = false;
      [c.x, c.y] = edge[n % edge.length];
      endJob(s, c);
    });
    if (!inc.failed) {
      if (s.colonists.length < MAX_COLONISTS) {
        const t = inc.traveler;
        const c = makeColonist(s, { name: t.name, shirt: t.shirt, hair: t.hair }, W - 2, 13);
        c.weak = inc.late ? 0.6 : 0.1;
        s.colonists.push(c);
        letter(s, { kind: 'good', title: `${t.name} joined the colony`, body: `${t.name} decided to stay${inc.late ? ' once they recover' : ''}. Another pair of hands, and another mouth to feed.`, focus: { colonistId: c.id } });
      } else {
        dropItem(s, 'potato', 15, W - 2, 13);
        letter(s, { kind: 'good', title: 'The caravan is home', body: `${inc.traveler.name} thanked the colony with 15 potatoes and went on their way.` });
      }
    }
    s.caravan = null;
    s.incident = null;
    s.story.nextAt = s.t + rand(10, 16);
  }

  function declineCaravan(s, inc, expired) {
    letter(s, { kind: 'info', title: expired ? 'The request expired' : 'Request declined', body: `${inc.traveler.name} will have to manage without the colony.` });
    s.incident = null;
    s.story.nextAt = s.t + rand(6, 10);
  }

  function caravanAlternatives(s, inc) {
    return { reroute: !!(s.caravan && s.caravan.status === 'blocked'), clear: !!(inc.reportIn && BLOCK_CAUSES[inc.cause].clearable) };
  }

  function snapshot(s, inc) {
    const heater = inc.heaterId != null ? byId.get(inc.heaterId) : null;
    const r = heater ? roomAt(heater.x, heater.y) : null;
    const cnt = counts(s);
    return {
      t: r2(s.t), season: calendar(s.t).season, wood: cnt.wood, food: rawFood(cnt), meals: cnt.meal, outdoor: r2(outdoorTemp(s)),
      roomTemp: r && !r.outdoors ? r2(r.temp) : null,
      home: home(s).length, deadlineIn: inc.deadlineT != null ? r2(inc.deadlineT - s.t) : null,
      reportIn: !!inc.reportIn,
    };
  }

  function commit(s, inc, action, alternatives) {
    if (inc.committed) return;
    inc.committed = { action, t: s.t };
    obs('commit', inc, { action, alternatives, snapshot: snapshot(s, inc) });
  }
  function consult(s, inc, via) { if (inc && inc.reportIn) obs('consulted', inc, via); }

  // ---------- letters ----------
  function letter(s, l) {
    s.letters.push({ id: s.nextId++, t: s.t, read: false, ...l });
    while (s.letters.length > 14) {
      const i = s.letters.findIndex((x) => x.read && !x.actions);
      s.letters.splice(i >= 0 ? i : 0, 1);
    }
  }

  // ---------- the one command path ----------
  const ok = (extra) => ({ ok: true, ...extra });
  const fail = (reason) => ({ ok: false, reason });
  const rect = (cmd) => [Math.min(cmd.x0, cmd.x1), Math.min(cmd.y0, cmd.y1), Math.max(cmd.x0, cmd.x1), Math.max(cmd.y0, cmd.y1)];

  function apply(s, cmd) {
    const inc = s.incident;
    switch (cmd.type) {
      case 'build': {
        const d = DEFS[cmd.kind];
        if (!BUILDABLE.includes(cmd.kind)) return fail('Unknown building');
        const { x, y } = cmd;
        if (!inb(x, y)) return fail('Outside the map');
        const i = idx(x, y);
        if (s.terrain[i] === T.WATER) return fail('Cannot build on water');
        if (structAt[i]) return fail('Something is already there');
        if (s.zones.grow[i]) return fail('That is part of a field');
        const before = inc && inc.kind === 'heating' ? heatingAlternatives(s, inc) : null;
        const th = makeThing(s, cmd.kind, x, y, { bp: true, progress: 0, delivered: 0 });
        reindex(s);
        const loose = itemAt.get(i);
        if (loose && d.blocks) { s.items.splice(s.items.indexOf(loose), 1); reindexItems(s); dropItem(s, loose.kind, loose.n, x, y, loose.age); }
        if (before && d.heat) {
          const heater = byId.get(inc.heaterId);
          if (heater && roomOf[i] >= 0 && roomOf[i] === roomOf[idx(heater.x, heater.y)]) commit(s, inc, `build-${cmd.kind}`, before);
        }
        return ok({ id: th.id });
      }
      case 'designate': {
        const [x0, y0, x1, y1] = rect(cmd);
        let n = 0;
        for (const th of s.things.slice()) {
          if (th.x < x0 || th.x > x1 || th.y < y0 || th.y > y1) continue;
          if (cmd.mode === 'chop' && th.type === 'tree' && th.des !== 'chop') { th.des = 'chop'; n++; }
          else if (cmd.mode === 'harvest' && th.type === 'bush' && th.des !== 'harvest') { th.des = 'harvest'; n++; }
          else if (cmd.mode === 'cancel') {
            if (th.bp) {
              if (th.delivered) dropItem(s, 'wood', th.delivered, th.x, th.y);
              s.things.splice(s.things.indexOf(th), 1);
              n++;
            } else if (th.des) { th.des = null; n++; }
          }
        }
        if (cmd.mode === 'cancel') reindex(s);
        return n ? ok({ n }) : fail('Nothing to change there');
      }
      case 'zone': {
        const [x0, y0, x1, y1] = rect(cmd);
        let n = 0;
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          if (!inb(x, y)) continue;
          const i = idx(x, y);
          if (cmd.mode === 'clear') {
            if (stockSet.has(i)) { s.zones.stock.splice(s.zones.stock.indexOf(i), 1); n++; }
            if (s.zones.grow[i]) { delete s.zones.grow[i]; n++; }
            continue;
          }
          if (blocked[i] || s.terrain[i] === T.WATER) continue;
          const th = structAt[i];
          if (cmd.mode === 'stock') {
            if (stockSet.has(i) || th) continue;
            if (s.zones.grow[i]) delete s.zones.grow[i];
            s.zones.stock.push(i);
            n++;
          } else if (cmd.mode === 'grow') {
            if (s.zones.grow[i] || th || (s.terrain[i] !== T.GRASS && s.terrain[i] !== T.DIRT)) continue;
            if (stockSet.has(i)) s.zones.stock.splice(s.zones.stock.indexOf(i), 1);
            s.zones.grow[i] = { sown: false, growth: 0 };
            n++;
          }
        }
        stockSet = new Set(s.zones.stock);
        return n ? ok({ n }) : fail(cmd.mode === 'grow' ? 'Fields need open grass or dirt' : 'Nothing to change there');
      }
      case 'repair': {
        const th = byId.get(cmd.id);
        if (!th || !th.broken) return fail('Nothing to repair');
        if (!th.diagnosis) return fail('Waiting for the inspection report');
        if (th.repairOrdered) return fail('Repair already ordered');
        const before = inc && inc.kind === 'heating' && inc.heaterId === th.id ? heatingAlternatives(s, inc) : null;
        th.repairOrdered = true;
        if (before) commit(s, inc, 'repair', before);
        return ok();
      }
      case 'cancel-repair': {
        const th = byId.get(cmd.id);
        if (!th || !th.repairOrdered) return fail();
        th.repairOrdered = false;
        return ok();
      }
      case 'priority': {
        const c = s.colonists.find((o) => o.id === cmd.colonistId);
        if (!c || !WORK_TYPES.includes(cmd.work)) return fail();
        c.prio[cmd.work] = Math.max(0, Math.min(4, cmd.value | 0));
        return ok();
      }
      case 'read-letter': {
        const l = s.letters.find((x) => x.id === cmd.id);
        if (!l) return fail();
        l.read = true;
        if (inc && l.reportFor === inc.id) consult(s, inc, 'letter');
        return ok();
      }
      case 'dismiss-letter': {
        const i = s.letters.findIndex((x) => x.id === cmd.id);
        if (i < 0 || s.letters[i].actions) return fail();
        s.letters.splice(i, 1);
        return ok();
      }
      case 'inspect': {
        const tg = cmd.target || {};
        if (inc && inc.kind === 'heating' && tg.kind === 'thing' && tg.id === inc.heaterId) consult(s, inc, 'heater');
        if (inc && inc.kind === 'caravan' && tg.kind === 'world' && tg.what === 'blockage') consult(s, inc, 'blockage');
        return ok();
      }
      case 'caravan-send': {
        if (!inc || inc.kind !== 'caravan' || inc.stage !== 'request') return fail();
        const members = caravanCandidates(s);
        if (members.length < 2) return fail('Not enough healthy colonists at home');
        for (const c of members) { endJob(s, c); c.duty = null; c.away = true; }
        s.caravan = { members: members.map((c) => c.id), route: ROUTES.start.slice(), seg: 0, prog: 0, status: 'outbound', clear: 0 };
        inc.stage = 'travel';
        for (const l of s.letters) if (l.forIncident === inc.id) { delete l.actions; l.read = true; }
        letter(s, { kind: 'info', title: 'The caravan set out', body: `${members.map((c) => c.name).join(' and ')} left along the old road toward ${inc.traveler.name}.`, focus: { world: 'caravan' } });
        return ok();
      }
      case 'caravan-decline': {
        if (!inc || inc.kind !== 'caravan' || inc.stage !== 'request') return fail();
        for (const l of s.letters) if (l.forIncident === inc.id) { delete l.actions; l.read = true; }
        declineCaravan(s, inc, false);
        return ok();
      }
      case 'caravan-reroute': {
        const cv = s.caravan;
        if (!inc || inc.kind !== 'caravan' || inc.stage !== 'setback' || !cv || cv.status !== 'blocked') return fail('The caravan is not waiting at the blockage');
        const before = caravanAlternatives(s, inc);
        cv.route = ROUTES.pass.slice();
        cv.seg = 0;
        cv.prog = 0;
        cv.status = 'outbound';
        commit(s, inc, 'reroute-pass', before);
        return ok();
      }
      case 'caravan-clear': {
        const cv = s.caravan;
        if (!inc || inc.kind !== 'caravan' || inc.stage !== 'setback' || !cv || cv.status !== 'blocked') return fail('The caravan is not waiting at the blockage');
        if (!inc.reportIn) return fail('Waiting for the scout report');
        if (!BLOCK_CAUSES[inc.cause].clearable) return fail('The rockslide cannot be cleared quickly');
        const before = caravanAlternatives(s, inc);
        cv.status = 'clearing';
        cv.clear = 0;
        commit(s, inc, 'clear-road', before);
        return ok();
      }
      default:
        return fail('Unknown order');
    }
  }

  // ---------- clock ----------
  function step(s, dt) {
    s.t += dt;
    if (s.weather.until != null && s.t >= s.weather.until) s.weather = { override: null, label: null, until: null };
    burnFuel(s, dt);
    updateTemps(s, dt);
    for (const c of s.colonists) if (!c.away) stepColonist(s, c, dt);
    natureStep(s, dt);
    spoilItems(s, dt);
    dailyTick(s);
    warnings(s);
    const inc = s.incident;
    if (inc) {
      if (inc.kind === 'heating') heatingTick(s, inc);
      else caravanTick(s, inc, dt);
    }
    storyTick(s);
  }

  function init(s, loaded) {
    S = s;
    M.state = s;
    roomOf = null;
    rooms = null;
    growRes.clear();
    for (const th of s.things) { th.res = null; th.resF = null; th.resD = null; }
    for (const it of s.items) it.res = null;
    reindex(s);
    for (const c of s.colonists) {
      c.x = Math.round(c.x);
      c.y = Math.round(c.y);
      c.job = null;
      c.path = [];
      c.sleeping = false;
      if (c.carry && !c.away) dropCarry(s, c);
    }
    recomputeRooms(s, s.roomTemps);
    if (!loaded) for (const r of rooms) if (!r.outdoors && heatSourcesIn(s, r.id)) r.temp = 21;
    return s;
  }

  // ---------- public API ----------
  Object.assign(M, {
    W, H, T, DEFS, ITEMS, BUILDABLE, WORK_TYPES, WORLD, ROUTES, HEATER_CAUSES, BLOCK_CAUSES, CLEAR_HOURS, RETURN_HOURS, CROP_HOURS,
    advance(hours) {
      let left = hours;
      while (left > 1e-9) { const dt = Math.min(STEP, left); step(S, dt); left -= dt; }
    },
    command(cmd) { return S ? apply(S, cmd) : fail('No colony'); },
    save() {
      if (!S) return;
      S.roomTemps = rooms.filter((r) => !r.outdoors).map((r) => [r.tiles[0], r2(r.temp)]);
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch {}
    },
    load() {
      try {
        const s = JSON.parse(localStorage.getItem(SAVE_KEY));
        if (s && s.version === 3 && Array.isArray(s.things)) return init(s, true);
      } catch {}
      return init(newColony(), false);
    },
    newColony() { init(newColony(), false); M.save(); },
    SAVE_KEY,
    query: {
      outdoorTemp: () => outdoorTemp(S),
      calendar: () => calendar(S.t),
      tempAt: (x, y) => tempAt(S, x, y),
      roomAt, roomName, rooms: () => rooms,
      thingAt: (x, y) => (inb(x, y) ? structAt[idx(x, y)] : null),
      itemAt: (x, y) => (inb(x, y) ? itemAt.get(idx(x, y)) || null : null),
      growAt: (x, y) => (inb(x, y) ? S.zones.grow[idx(x, y)] || null : null),
      isStock: (x, y) => inb(x, y) && stockSet.has(idx(x, y)),
      byId: (id) => byId.get(id),
      counts: () => counts(S),
      health, isNight: () => isNight(S),
      canBuild: (kind, x, y) => inb(x, y) && BUILDABLE.includes(kind) && S.terrain[idx(x, y)] !== T.WATER && !structAt[idx(x, y)] && !S.zones.grow[idx(x, y)],
      caravanCandidates: () => caravanCandidates(S),
      spoilFactor: (x, y) => { const t = tempAt(S, x, y), r = roomAt(x, y); return t < 0 ? 0 : r && !r.outdoors ? (t < 10 ? 0.4 : 1) : 1.5; },
      segHours,
    },
  });
})();
