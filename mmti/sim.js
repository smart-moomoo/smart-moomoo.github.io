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
  const SAVE_KEY = 'mmti-colony-v4';
  const MAX_COLONISTS = 8;
  const CARRY = 40;
  const SEASON_DAYS = 5, YEAR_DAYS = 20;
  const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
  const SEASON_MID_TEMPS = [[2.5, 13], [7.5, 21], [12.5, 11], [17.5, -6]];
  const START_T = 2 * 24 + 16; // spring, day 3, 16:00: the first evening
  const CROP_HOURS = 56;      // hours of warm daylight for potatoes to ripen
  const CROP_YIELD = 2;

  const ITEMS = {
    wood: { label: 'Wood', stack: 75 },
    berries: { label: 'Berries', stack: 50, spoil: 48, food: 0.3, raw: true },
    potato: { label: 'Potatoes', stack: 50, spoil: 480, food: 0.3, raw: true },
    meal: { label: 'Meals', stack: 20, spoil: 96, food: 0.9 },
    medicine: { label: 'Medicine', stack: 25 },
    preserved: { label: 'Preserved food', stack: 50, spoil: 720, food: 0.3 },
  };

  const DEFS = {
    wall: { label: 'Wall', cost: 4, work: 0.4, blocks: true, boundary: true },
    door: { label: 'Door', cost: 6, work: 0.6, boundary: true },
    bed: { label: 'Bed', cost: 15, work: 1.5 },
    table: { label: 'Table', cost: 10, work: 1 },
    campfire: { label: 'Campfire', cost: 10, work: 1.5, heat: 30, fuelCap: 6, burnH: 3, always: true, cook: true, startFuel: 3 },
    stove: { label: 'Wood stove', cost: 20, work: 3, heat: 45, fuelCap: 10, burnH: 4, cook: true, startFuel: 4 },
    heater: { label: 'Heater', heat: 45, fuelCap: 10, burnH: 5 },
    tree: { label: 'Tree', natural: true },
    bush: { label: 'Berry bush', natural: true },
    keeper: { label: 'The Archivist' },
    grave: { label: 'Grave' },
    bench: { label: 'Research bench', cost: 25, work: 2 },
    smoker: { label: 'Smokehouse', cost: 25, work: 2, fuelCap: 10, burnH: 5, research: 'smoking' },
    windmill: { label: 'Windmill', cost: 40, work: 3, power: 60, research: 'windmill' },
    cooler: { label: 'Cooler', cost: 30, work: 2, power: -40, research: 'refrigeration' },
    eheater: { label: 'Electric heater', cost: 30, work: 2, power: -50, heat: 45, research: 'electricheat' },
    barricade: { label: 'Barricade', cost: 8, work: 0.5, blocks: true, research: 'palisade' },
    trap: { label: 'Spike trap', cost: 15, work: 1, research: 'palisade' },
  };
  const RESEARCH = {
    smoking: { label: 'Smoking', hours: 10, requires: [], branch: 'Preservation', desc: 'Build a smokehouse that turns raw food into preserved food, which keeps for a month. It burns wood.' },
    refrigeration: { label: 'Refrigeration', hours: 20, requires: ['smoking', 'windmill'], branch: 'Preservation', desc: 'Build coolers that freeze a room so food in it stops spoiling. They need steady power.' },
    windmill: { label: 'Wind power', hours: 12, requires: [], branch: 'Power', desc: 'Build windmills. Power rises and falls with the wind.' },
    electricheat: { label: 'Electric heating', hours: 16, requires: ['windmill'], branch: 'Power', desc: 'Build electric heaters that burn no wood, but go cold when the wind drops.' },
    palisade: { label: 'Fortification', hours: 10, requires: [], branch: 'Defense', desc: 'Build barricades that give cover, and spike traps that wound raiders who step on them.' },
    bows: { label: 'Recurve bows', hours: 16, requires: ['palisade'], branch: 'Defense', desc: 'Colonists shoot straighter and hit harder, which makes fighting and rescues less costly.' },
    herbalism: { label: 'Herbalism', hours: 12, requires: [], branch: 'Medicine', desc: 'Plant healroot in fields. Each ripe plant gives one medicine, but grows slowly.' },
  };
  const FLAMMABLE = new Set(['door', 'bed', 'table', 'tree', 'bush', 'grave']);
  const BUILDABLE = ['wall', 'door', 'bed', 'table', 'campfire', 'stove', 'bench', 'smoker', 'windmill', 'cooler', 'eheater', 'barricade', 'trap'];
  const researched = (s, key) => !!(s.research && s.research.done.includes(key));
  const canPlace = (s, kind) => BUILDABLE.includes(kind) && (!DEFS[kind].research || researched(s, DEFS[kind].research));
  const WORK_TYPES = ['doctor', 'build', 'repair', 'cook', 'grow', 'chop', 'haul', 'research'];

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
    nodes: { C: [96, 300], R1: [214, 318], R2: [330, 332], R3: [470, 318], X: [640, 262], P1: [352, 200], P2: [470, 150], P3: [586, 176], MB: [300, 440] },
    hours: { 'C-R1': 0.8, 'R1-R2': 0.7, 'R2-R3': 1, 'R3-X': 1, 'R2-P1': 1.4, 'P1-P2': 1.4, 'P2-P3': 1.3, 'P3-X': 0.9, 'R1-MB': 2.7 },
  };
  const ROUTES = { start: ['C', 'R1', 'R2'], road: ['R2', 'R3', 'X'], pass: ['R2', 'P1', 'P2', 'P3', 'X'], mill: ['C', 'R1', 'MB'] };
  const TRADE_VALUE = { wood: 1, potato: 1, berries: 0.7, meal: 3, preserved: 1.2, medicine: 8 };
  const NEIGHBOR = 'Millbrook';

  const PEOPLE = [
    { name: 'Mara', traits: ['hardworker', 'homebody'], shirt: '#c0533a', hair: '#3b2a20', skills: { build: 1.3, repair: 1, plants: 0.9, cook: 0.9 }, prio: { doctor: 3, build: 1, repair: 2, cook: 3, grow: 3, chop: 2, haul: 3 } },
    { name: 'Tobin', traits: ['greenthumb', 'sensitive'], shirt: '#3d6f9e', hair: '#d9a441', skills: { build: 0.9, repair: 0.8, plants: 1.3, cook: 1 }, prio: { doctor: 3, build: 3, repair: 3, cook: 3, grow: 1, chop: 2, haul: 2 } },
    { name: 'Ines', traits: ['wanderer', 'kind'], shirt: '#7a5aa0', hair: '#1c1c1c', skills: { build: 1, repair: 1.3, plants: 1, cook: 1.3, doctor: 1.3 }, prio: { doctor: 1, build: 2, repair: 1, cook: 1, grow: 3, chop: 3, haul: 2 } },
  ];
  const TRAVELERS = [
    { name: 'Dusk', role: 'trader', traits: ['wanderer', 'gourmand'], shirt: '#5b8a3a', hair: '#8a5a3c' },
    { name: 'Ansel', role: 'medic', skills: { doctor: 1.6 }, traits: ['kind', 'hardy'], shirt: '#e0e0d8', hair: '#6b4a2b' },
    { name: 'Kit', role: 'surveyor', traits: ['wanderer', 'lazy'], shirt: '#c99a2e', hair: '#2a2018' },
    { name: 'Bo', role: 'young herder', traits: ['sensitive', 'greenthumb'], shirt: '#8f3f6a', hair: '#b5543c' },
    { name: 'Rhea', role: 'smith', traits: ['hardworker', 'hardy'], shirt: '#4a5a6a', hair: '#e8d8b0' },
  ];
  const TRAITS = {
    hardworker: { label: 'Hard worker', desc: 'Works 20% faster.' },
    lazy: { label: 'Lazy', desc: 'Works 20% slower, but is easily content.' },
    greenthumb: { label: 'Green thumb', desc: 'Plants, harvests, picks, and chops 40% faster.' },
    hardy: { label: 'Hardy', desc: 'Gets hypothermia half as fast.' },
    coldhater: { label: 'Hates the cold', desc: 'Unhappy whenever it is below 12°C around them.' },
    gourmand: { label: 'Gourmand', desc: 'Loves cooked meals and hates raw food.' },
    homebody: { label: 'Homebody', desc: 'Unhappy away from the colony.' },
    wanderer: { label: 'Wanderer', desc: 'Happy on the road; restless after days at home.' },
    sensitive: { label: 'Sensitive', desc: 'Good and bad memories hit twice as hard.' },
    kind: { label: 'Kind', desc: 'Hates turning people away; cheers up whoever works near them.' },
  };
  const REL_LABEL = { partner: 'Partner', sibling: 'Sibling', friend: 'Friend', rival: 'Rival' };

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
      id: s.nextId++, name: p.name, shirt: p.shirt, hair: p.hair, traits: (p.traits || []).slice(),
      mood: 55, memories: [], breakUntil: 0,
      x, y, path: [], job: null, duty: null, carry: null,
      food: 0.8, rest: 0.9, cold: 0, weak: 0,
      skills: { build: 1, repair: 1, plants: 1, cook: 1, doctor: 1, ...(p.skills || {}) },
      prio: { doctor: 3, build: 3, repair: 3, cook: 3, grow: 3, chop: 3, haul: 3, research: 3, ...(p.prio || {}) },
      away: false, bed: null, sleeping: false, facing: 1, injuries: [], blood: 1, downed: false, drafted: false,
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
      story: { nextAt: 1e9, counts: {}, travelers: 0, nextThreatAt: 1e9 },
      intro: { stage: 'order' }, unlocks: ['pick'], lastTroubleT: -1e9,
      raiders: [], raid: null, fires: {}, shots: [], terrainVersion: 0, dead: [],
      research: { done: [], active: null, progress: {} }, wind: 0.6, windAt: START_T,
      world: { goodwill: 10, lastGiftT: -1e9, nextWorldAt: 1e9, giftsReceived: 0 }, trade: null, history: [],
      roomTemps: [], lastDay: dayIndex(START_T), warn: {}, relations: [], chatter: [], nextChat: START_T + 0.5,
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
    s.items.push({ id: s.nextId++, kind: 'wood', n: 75, x: 15, y: 15, age: 0 });
    s.items.push({ id: s.nextId++, kind: 'wood', n: 15, x: 15, y: 16, age: 0 });
    s.items.push({ id: s.nextId++, kind: 'potato', n: 30, x: 16, y: 15, age: 0 });
    s.items.push({ id: s.nextId++, kind: 'meal', n: 8, x: 17, y: 15, age: 0 });
    s.items.push({ id: s.nextId++, kind: 'medicine', n: 5, x: 18, y: 15, age: 0 });

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
    defaultRelations(s);
    letter(s, {
      kind: 'info', title: 'The first evening', read: true,
      body: 'Mara, Tobin, and Ines have a warm bedroom, a campfire, and a little food. Night falls at ten.\n\nYou do not control them directly: you give orders, and they decide who does the work. The note at the top of the map says what needs doing.',
    });
    return s;
  }

  function defaultRelations(s) {
    const by = (n) => s.colonists.find((c) => c.name === n);
    const [m, t, i] = [by('Mara'), by('Tobin'), by('Ines')];
    s.relations = [];
    if (m && t) s.relations.push({ a: m.id, b: t.id, kind: 'sibling' });
    if (t && i) s.relations.push({ a: t.id, b: i.id, kind: 'partner' });
  }

  // ---------- people: traits, relationships, memories, mood ----------
  const has = (c, trait) => !!(c.traits && c.traits.includes(trait));
  function relationsOf(s, c) {
    return (s.relations || [])
      .filter((r) => r.a === c.id || r.b === c.id)
      .map((r) => ({ kind: r.kind, other: s.colonists.find((o) => o.id === (r.a === c.id ? r.b : r.a)) }))
      .filter((r) => r.other);
  }
  function addMemory(s, c, key, label, value, hours) {
    c.memories = (c.memories || []).filter((m) => m.key !== key);
    c.memories.push({ key, label, value: has(c, 'sensitive') ? value * 2 : value, until: s.t + hours });
  }
  function sameRoom(a, b) {
    const ra = roomAt(Math.round(a.x), Math.round(a.y)), rb = roomAt(Math.round(b.x), Math.round(b.y));
    return !!ra && ra === rb && !ra.outdoors;
  }
  function thoughts(s, c) {
    const out = [];
    const add = (key, label, value, who) => out.push({ key, label, value, who });
    const [x, y] = tileOf(c);
    const temp = c.away ? outdoorTemp(s) : tempAt(s, x, y);
    if (c.food < 0.1) add('starving', 'Starving', -18);
    else if (c.food < 0.25) add('hungry', 'Hungry', -6);
    if (c.rest < 0.15) add('exhausted', 'Exhausted', -8);
    if (c.cold > 0.2) add('hypothermia', 'Hypothermia', -10);
    if (c.weak > 0.3) add('weak', 'Weak and sore', -6);
    if (has(c, 'coldhater') && temp < 12) add('cold', 'Hates this cold', -8);
    if (c.away) {
      if (has(c, 'homebody')) add('farhome', 'Far from home', -10);
      if (has(c, 'wanderer')) add('road', 'On the road', 8);
    } else if (has(c, 'wanderer') && s.t - (c.lastTripT != null ? c.lastTripT : START_T - 48) > 96) add('restless', 'Restless at home', -5);
    if (has(c, 'lazy')) add('easy', 'Takes it easy', 6);
    for (const r of relationsOf(s, c)) {
      const o = r.other;
      if (r.kind === 'partner' || r.kind === 'sibling') {
        const w = r.kind === 'partner' ? 1 : 0.6;
        if (o.away && !c.away) add('misses', `Misses ${o.name}`, Math.round(-8 * w), o.name);
        if (health(o) < 0.6 || o.food < 0.1) add('worried', `Worried about ${o.name}`, Math.round(-10 * w), o.name);
        if (r.kind === 'partner' && !c.away && !o.away && c.sleeping && o.sleeping && sameRoom(c, o)) add('near', `Sleeping near ${o.name}`, 4, o.name);
      }
      if (r.kind === 'rival' && !c.away && !o.away && sameRoom(c, o)) add('rival', `Stuck with ${o.name}`, -4, o.name);
    }
    if (!c.away && s.colonists.some((o) => o !== c && !o.away && has(o, 'kind') && Math.hypot(o.x - c.x, o.y - c.y) < 4)) add('kindco', 'Kind company', 3);
    for (const m of c.memories || []) if (m.until > s.t) add(m.key, m.label, m.value);
    return out;
  }
  function moodStep(s, c, dt) {
    c.memories = (c.memories || []).filter((m) => m.until > s.t);
    const sum = thoughts(s, c).reduce((a, t) => a + t.value, 0);
    const target = Math.max(0, Math.min(100, 50 + sum));
    c.mood += (target - c.mood) * (1 - Math.exp(-dt / 2));
    if (c.away || c.breakUntil > s.t) return;
    if (c.mood < 20 && s.t >= (c.breakCheck || 0)) {
      c.breakCheck = s.t + 1;
      if (Math.random() < 0.25) {
        c.breakUntil = s.t + 3;
        endJob(s, c);
        const worst = thoughts(s, c).filter((t) => t.value < 0).sort((a, b) => a.value - b.value).slice(0, 2).map((t) => t.label.toLowerCase());
        letter(s, { kind: 'threat', title: `${c.name} is sulking`, body: `${c.name} has had enough and stopped working for a few hours.${worst.length ? ` What is getting to them: ${worst.join(' and ')}.` : ''}`, focus: { colonistId: c.id } });
        addMemory(s, c, 'vented', 'Let it all out', 6, 12);
      }
    }
  }

  const CHAT = {
    cold: () => 'Why is it always this cold?', hungry: () => 'When do we eat?', starving: () => 'I can’t keep going like this.',
    exhausted: () => 'I need to sleep.', hypothermia: () => 'I can’t feel my fingers.', weak: () => 'Everything aches.',
    misses: (t) => `I hope ${t.who} is safe out there.`, worried: (t) => `${t.who}, hang in there.`, near: (t) => `Night, ${t.who}.`,
    rival: (t) => `Of course ${t.who} is here.`, farhome: () => 'I want to go home.', road: () => 'Nothing like the open road.',
    restless: () => 'Same walls, same fields…', easy: () => 'No rush.', kindco: () => 'Thanks for the help.',
    rawfood: () => 'Raw potatoes again…', goodmeal: () => 'That was a good meal.', notable: () => 'Eating off my knees again.',
    froze: () => 'I couldn’t feel my feet last night.', fed: () => 'Thank you for the food.', coldnight: () => 'That was a cold night.', slept: () => 'Slept well.',
    ground: () => 'My back hurts from the ground.', rescued: () => 'I owe you all.', rescuer: () => 'We made it in time.',
    toolate: () => 'We were too late.', turnedaway: () => 'We should have helped them.', gaveup: () => 'We left them out there.',
    vented: () => 'Sorry. I needed that.', welcomed: () => 'Good to have another pair of hands.', helped: () => 'Glad we could help them.',
  };
  function chatterStep(s) {
    s.chatter = (s.chatter || []).filter((b) => b.until > s.t);
    if (s.t < (s.nextChat || 0)) return;
    s.nextChat = s.t + rand(0.8, 2);
    const pool = s.colonists.filter((c) => !c.away && !c.sleeping);
    if (!pool.length) return;
    const c = pick(pool);
    const ts = thoughts(s, c).filter((t) => CHAT[t.key]).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    if (!ts.length) return;
    const t = ts[Math.floor(Math.random() * Math.min(2, ts.length))];
    s.chatter.push({ cid: c.id, text: CHAT[t.key](t), until: s.t + 0.35 });
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
  // Standing within two tiles of a lit fire or heater keeps you warm even outdoors.
  function feltTemp(s, x, y) {
    const base = tempAt(s, x, y);
    for (const th of s.things) if (heating(th) && Math.abs(th.x - x) <= 2 && Math.abs(th.y - y) <= 2) return base + 12;
    return base;
  }
  function warmSpots(s) {
    const spots = [];
    for (const th of s.things) if (heating(th)) for (const [dx, dy] of DIRS8) spots.push({ x: th.x + dx, y: th.y + dy, exact: true });
    return spots;
  }
  const heating = (th) => !!DEFS[th.type].heat && !th.bp && !th.broken && (DEFS[th.type].power ? th.powered : th.lit);
  function heatSourcesIn(s, roomId, countUnlit) {
    let n = 0;
    for (const th of s.things) {
      if (!DEFS[th.type].heat || th.bp || th.broken) continue;
      if (!countUnlit && !(DEFS[th.type].power ? th.powered : th.fuel > 0)) continue;
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
    const cool = new Map();
    for (const th of s.things) {
      if (th.type !== 'cooler' || th.bp || !th.powered) continue;
      const r = roomOf[idx(th.x, th.y)];
      if (r >= 0 && !rooms[r].outdoors) cool.set(r, (cool.get(r) || 0) + 40);
    }
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
      let target = h > 0 ? Math.max(out, Math.min(21, out + h / sf)) : out;
      const cl = cool.get(r.id) || 0;
      if (cl) target = Math.max(-8, Math.min(target, out - cl / sf));
      r.temp += (target - r.temp) * k;
    }
  }

  function powerStep(s) {
    if (s.t >= (s.windAt || 0)) {
      s.windAt = s.t + 2;
      s.wind = Math.max(0.05, Math.min(1, (s.wind == null ? 0.6 : s.wind) * 0.5 + Math.random() * 0.6));
    }
    let supply = 0;
    for (const th of s.things) if (th.type === 'windmill' && !th.bp) supply += DEFS.windmill.power * s.wind;
    s.power = { supply: Math.round(supply), demand: 0 };
    const users = s.things.filter((th) => DEFS[th.type].power < 0 && !th.bp).sort((a, b) => a.id - b.id);
    for (const th of users) {
      const need = -DEFS[th.type].power;
      s.power.demand += need;
      const was = th.powered;
      th.powered = supply >= need;
      if (th.powered) supply -= need;
      if (was && !th.powered && !th.offWarned && s.t >= (s.warn.powerAt || 0)) {
        th.offWarned = true;
        s.warn.powerAt = s.t + 12;
        letter(s, { kind: 'threat', title: `${DEFS[th.type].label} lost power`, body: `The wind dropped and there is not enough power for the ${DEFS[th.type].label.toLowerCase()}. More windmills would help.`, focus: { thingId: th.id } });
      }
      if (th.powered) th.offWarned = false;
    }
  }

  function burnFuel(s, dt) {
    const out = outdoorTemp(s);
    for (const th of s.things) {
      const d = DEFS[th.type];
      if (!d.fuelCap || th.bp) continue;
      // Fires burn only when they are needed: cooking, cold weather, and (for the campfire) evenings.
      const hr = s.t % 24;
      const wants = !th.broken && (th.type === 'smoker' ? !!th.busy
        : th.type === 'campfire' ? !!th.busy || hr >= 19 || hr < 7 || out < 14
          : !!th.busy || out < 16);
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
    const c = { wood: 0, berries: 0, potato: 0, meal: 0, medicine: 0, preserved: 0 };
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
  function bfs(sx, sy, isGoal, ignoreStart, blockGrid) {
    const blk = blockGrid || blocked;
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
        if (prev[n] !== -2 || blk[n]) continue;
        if (dx && dy && (blk[idx(cx + dx, cy)] || blk[idx(cx, cy + dy)])) continue;
        prev[n] = cur;
        q.push(n);
      }
    }
    return ignoreStart ? null : null;
  }

  const tileOf = (c) => [Math.round(c.x), Math.round(c.y)];
  const pain = (c) => (c.injuries || []).reduce((a, i) => a + i.sev * (i.tended ? 0.5 : 1), 0);
  const health = (c) => 1 - Math.min(0.95, 0.9 * c.cold + 0.9 * c.weak + pain(c) + (1 - (c.blood == null ? 1 : c.blood)) * 0.9);
  const workFactor = (c) => (0.35 + 0.65 * health(c)) * (has(c, 'hardworker') ? 1.2 : has(c, 'lazy') ? 0.8 : 1) * (c.mood < 25 ? 0.75 : c.mood > 70 ? 1.1 : 1);
  const plantSkill = (c) => c.skills.plants * (has(c, 'greenthumb') ? 1.4 : 1);

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
    for (const o of s.colonists) {
      if (o.resTend === c.id) o.resTend = null;
      if (o.resRescue === c.id) o.resRescue = null;
      if (o.resFeed === c.id) o.resFeed = null;
      if (o.carriedBy === c.id) o.carriedBy = null;
    }
    for (const th of s.things) { if (th.res === c.id) { th.res = null; th.busy = false; } if (th.resF === c.id) th.resF = null; if (th.resD === c.id) th.resD = null; }
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
    const items = s.items.filter(itemPred);
    const itPath = pathTo(from, items);
    if (!itPath) return null;
    const tg = tgPath.tg;
    c.path = itPath.path;
    return { kind, targetId: tg.id != null ? tg.id : null, tile: tg.tile != null ? tg.tile : null, itemId: itPath.tg.id, need: amountFor(tg, itPath.tg), stage: 'fetch', work: 0, ...extra, _tg: tg };
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
      case 'doctor': {
        const safe = (o) => !enemiesNear(s, o.x, o.y, 7).length;
        const downed = s.colonists.filter((o) => o !== c && o.downed && !o.away && !o.carriedBy && !o.resRescue && !inBed(o) && safe(o) && freeBedFor(s, o));
        let j = goJob(s, c, 'rescue', downed.map((o) => ({ x: Math.round(o.x), y: Math.round(o.y), pid: o.id })));
        if (j) { j.patientId = j._tg.pid; colonistById(s, j.patientId).resRescue = c.id; return j; }
        const hungry = s.colonists.filter((o) => o !== c && o.downed && !o.away && !o.carriedBy && !o.resFeed && o.food < 0.35);
        if (hungry.length) {
          const jf = fetchJob(s, c, 'feed', hungry.map((o) => ({ x: Math.round(o.x), y: Math.round(o.y), pid: o.id })), (it) => ITEMS[it.kind].food, (tg, it) => (it.kind === 'meal' ? 1 : 3));
          if (jf) { jf.patientId = jf._tg.pid; colonistById(s, jf.patientId).resFeed = c.id; return jf; }
        }
        const patients = s.colonists.filter((o) => !o.away && !o.carriedBy && !o.resTend && (o.injuries || []).some((i) => !i.tended)
          && (o.downed || (o.job && o.job.kind === 'bedrest' && o.job.stage === 'work')) && (o !== c || !o.downed));
        const targets = patients.map((o) => ({ x: Math.round(o.x), y: Math.round(o.y), pid: o.id, self: o === c }));
        if (!targets.length) return null;
        j = cnt.medicine > 0 ? fetchJob(s, c, 'tend', targets, (it) => it.kind === 'medicine', () => 1) : null;
        if (!j) j = goJob(s, c, 'tend', targets);
        if (j) { j.patientId = j._tg.pid; colonistById(s, j.patientId).resTend = c.id; }
        return j;
      }
      case 'build': {
        const ready = s.things.filter((th) => th.bp && !th.res && (th.delivered || 0) >= DEFS[th.type].cost);
        let j = goJob(s, c, 'build', ready);
        if (j) { j._tg.res = c.id; return j; }
        const needy = s.things.filter((th) => th.bp && !th.resD && (th.delivered || 0) < DEFS[th.type].cost);
        const total = needy.reduce((a, th) => a + DEFS[th.type].cost - (th.delivered || 0), 0);
        j = fetchJob(s, c, 'deliver', needy, (it) => it.kind === 'wood', () => Math.min(CARRY, total));
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
      case 'research': {
        const act = s.research.active;
        if (!act) return null;
        const benches = s.things.filter((th) => th.type === 'bench' && !th.bp && !th.res);
        const j = goJob(s, c, 'study', benches);
        if (j) j._tg.res = c.id;
        return j;
      }
      case 'cook': {
        if (cnt.meal >= mealTarget(s)) {
          if (cnt.preserved >= 20 * s.colonists.length) return null;
          const smokers = s.things.filter((th) => th.type === 'smoker' && !th.bp && !th.res && th.fuel > 0);
          const js = fetchJob(s, c, 'smoke', smokers, (it) => ITEMS[it.kind].raw && it.n >= 3, () => 3);
          if (js) byId.get(js.targetId).res = c.id;
          return js;
        }
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
    const foods = s.items.filter((it) => ITEMS[it.kind].food);
    const meals = foods.filter((it) => it.kind === 'meal');
    const res = pathTo(tileOf(c), meals.length ? meals : foods);
    if (!res) return null;
    c.path = res.path;
    const per = ITEMS[res.tg.kind].food;
    const need = res.tg.kind === 'meal' ? 1 : Math.max(1, Math.min(3, Math.ceil((0.95 - c.food) / per)));
    return { kind: 'eat', itemId: res.tg.id, need, stage: 'fetch', work: 0 };
  }

  function assignJob(s, c) {
    if (c.drafted) {
      if (c.moveTo) {
        const [mx, my] = c.moveTo;
        c.moveTo = null;
        const j = goJob(s, c, 'drafted', [{ x: mx, y: my, exact: true }]);
        if (j) return j;
      }
      return { kind: 'drafted', targetId: null, stage: 'work', work: 0 };
    }
    // While raiders are on the map, undrafted colonists shelter indoors; fighting is a choice made by drafting.
    if ((s.raiders || []).length || (s.raid && !s.raid.spawned && s.t >= s.raid.arriveAt - 0.5)) {
      const [cx, cy] = tileOf(c);
      const here = roomAt(cx, cy);
      if (!here || here.outdoors) {
        const indoor = [];
        for (const r of rooms) if (!r.outdoors) for (const t of r.tiles) if (!blocked[t]) indoor.push({ tile: t });
        const j = goJob(s, c, 'flee', indoor);
        if (j) return j;
      } else {
        const inRoom = (x, y) => roomAt(Math.round(x), Math.round(y)) === here;
        if ((c.injuries || []).some((i) => !i.tended && i.bleed > 0)) {
          const b = freeBedFor(s, c);
          if (b && inRoom(b.x, b.y)) { c.bed = b.id; const j = goJob(s, c, 'bedrest', [{ id: b.id, x: b.x, y: b.y, exact: true }]); if (j) return j; }
        }
        if (c.prio.doctor > 0) {
          const pts = s.colonists.filter((o) => o !== c && !o.away && !o.resTend && inRoom(o.x, o.y) && o.injuries.some((i) => !i.tended)
            && (o.downed || (o.job && o.job.kind === 'bedrest' && o.job.stage === 'work')));
          const j = goJob(s, c, 'tend', pts.map((o) => ({ x: Math.round(o.x), y: Math.round(o.y), pid: o.id })));
          if (j) { j.patientId = j._tg.pid; colonistById(s, j.patientId).resTend = c.id; return j; }
        }
        return { kind: 'hide', targetId: null, stage: 'work', work: 0 };
      }
    }
    const fire = homeFires(s);
    if (fire.length) {
      const j = goJob(s, c, 'firefight', fire.map((i) => ({ x: i % W, y: (i / W) | 0, fi: i })));
      if (j) { j.fire = j._tg.fi; return j; }
    }
    if ((c.injuries || []).some((i) => !i.tended && i.bleed > 0)) {
      const bed = c.bed != null ? byId.get(c.bed) : null;
      const b = bed && !bed.bp ? bed : freeBedFor(s, c);
      if (b) { c.bed = b.id; const j = goJob(s, c, 'bedrest', [{ id: b.id, x: b.x, y: b.y, exact: true }]); if (j) return j; }
      return { kind: 'bedrest', targetId: null, stage: 'work', work: 0 };
    }
    if (c.food < 0.3) { const j = eatJob(s, c); if (j) return j; }
    {
      const [cx, cy] = tileOf(c);
      if (c.cold > 0.15 && feltTemp(s, cx, cy) < 5) {
        const j = goJob(s, c, 'warmup', warmSpots(s));
        if (j) return j;
      }
    }
    if (c.rest < 0.15 || (isNight(s) && c.rest < 0.95)) {
      let bed = c.bed != null ? byId.get(c.bed) : null;
      if (!bed || bed.bp) {
        const owned = new Set(s.colonists.filter((o) => o !== c && o.bed != null).map((o) => o.bed));
        bed = s.things.find((th) => th.type === 'bed' && !th.bp && !owned.has(th.id)) || null;
        c.bed = bed ? bed.id : null;
      }
      if (bed && tempAt(s, bed.x, bed.y) < 0) {
        const j = goJob(s, c, 'sleep', warmSpots(s));
        if (j) return j;
      }
      const j = bed && goJob(s, c, 'sleep', [{ id: bed.id, x: bed.x, y: bed.y, exact: true }]);
      return j || { kind: 'sleep', targetId: null, stage: 'work', work: 0 };
    }
    if (c.breakUntil > s.t) {
      const [bx, by] = tileOf(c);
      for (let n = 0; n < 6; n++) {
        const x = bx + Math.round(rand(-4, 4)), y = by + Math.round(rand(-4, 4));
        if (!inb(x, y) || blocked[idx(x, y)]) continue;
        const j = goJob(s, c, 'sulk', [{ x, y, exact: true }]);
        if (j) return j;
      }
      return { kind: 'sulk', targetId: null, stage: 'work', work: 0 };
    }
    if (c.duty) {
      const th = byId.get(c.duty.targetId);
      const j = th && goJob(s, c, c.duty.kind, [th]);
      if (j) return j;
      c.duty = null;
    }
    // Someone down or bleeding is an emergency: anyone allowed to doctor handles it before other work.
    if (c.prio.doctor > 0 && s.colonists.some((o) => o !== c && !o.away && (o.downed || o.injuries.some((i) => !i.tended && i.bleed > 0)))) {
      const j = workJob(s, c, 'doctor');
      if (j) return j;
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
    if (j.kind === 'haul') it.res = null;
    const got = takeItem(s, it, j.need);
    if (!got) return endJob(s, c);
    c.carry = { kind, n: got, age };
    const from = tileOf(c);
    let res = null;
    if (j.kind === 'haul') {
      const spot = bfs(from[0], from[1], (x, y) => stockSet.has(idx(x, y)) && holdable(s, idx(x, y), kind));
      if (spot) { res = { path: spot.path }; j.tile = idx(spot.end[0], spot.end[1]); }
    } else if (j.kind === 'tend' || j.kind === 'feed') {
      const pt = colonistById(s, j.patientId);
      res = pt ? pathTo(from, [{ x: Math.round(pt.x), y: Math.round(pt.y) }]) : null;
      if (pt && Math.round(pt.x) === from[0] && Math.round(pt.y) === from[1]) res = { path: [] };
    } else if (j.kind === 'eat') {
      const tables = s.things.filter((th) => th.type === 'table' && !th.bp);
      const t = pathTo(from, tables);
      j.atTable = !!(t && t.path.length < 15);
      res = j.atTable ? t : { path: [] };
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
      case 'sulk':
        j.work += dt;
        if (j.work >= 0.4) endJob(s, c);
        return;
      case 'eat':
        j.work += dt;
        if (j.work >= 0.4) {
          if (c.carry) {
            c.food = Math.min(1, c.food + c.carry.n * ITEMS[c.carry.kind].food);
            if (c.carry.kind === 'meal') {
              if (j.atTable) addMemory(s, c, 'goodmeal', 'Ate a good meal', has(c, 'gourmand') ? 8 : 4, 10);
              else addMemory(s, c, 'notable', 'Ate without a table', -3, 10);
            } else addMemory(s, c, 'rawfood', 'Ate raw food', has(c, 'gourmand') ? -10 : -3, 10);
          }
          c.carry = null;
          endJob(s, c);
        }
        return;
      case 'sleep': {
        c.sleeping = true;
        c.rest = Math.min(1, c.rest + dt / 7);
        const [bx, by] = tileOf(c);
        j.minTemp = Math.min(j.minTemp == null ? 99 : j.minTemp, feltTemp(s, bx, by));
        if (c.cold > 0.25 && feltTemp(s, bx, by) < 2) {
          addMemory(s, c, 'froze', 'Woke up freezing', -10, 24);
          return endJob(s, c);
        }
        if ((!isNight(s) && c.rest >= 0.9) || c.food < 0.12) {
          const bed = structAt[idx(bx, by)];
          if (j.minTemp < 0) addMemory(s, c, 'froze', 'Froze in bed', -12, 24);
          else if (j.minTemp < 10) addMemory(s, c, 'coldnight', 'Slept in the cold', -5, 12);
          else if (bed && bed.type === 'bed') addMemory(s, c, 'slept', 'Slept well', 3, 12);
          if (!bed || bed.type !== 'bed') addMemory(s, c, 'ground', 'Slept on the ground', -6, 12);
          endJob(s, c);
        }
        return;
      }
      case 'deliver': {
        if (th && th.bp && c.carry) {
          const need = DEFS[th.type].cost - (th.delivered || 0);
          const put = Math.min(need, c.carry.n);
          th.delivered = (th.delivered || 0) + put;
          c.carry.n -= put;
          if (c.carry.n <= 0) c.carry = null;
        }
        if (th && th.resD === c.id) th.resD = null;
        // Still carrying wood: take it on to the next plan that needs some.
        if (c.carry) {
          const next = s.things.filter((o) => o.bp && !o.resD && (o.delivered || 0) < DEFS[o.type].cost);
          const res = pathTo(tileOf(c), next);
          if (res && res.path.length < 30) {
            res.tg.resD = c.id;
            j.targetId = res.tg.id;
            c.path = res.path;
            j.stage = 'walk';
            return;
          }
        }
        return endJob(s, c);
      }
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
      case 'study': {
        const key = s.research.active;
        if (!th || !key) return endJob(s, c);
        s.research.progress[key] = (s.research.progress[key] || 0) + dt * wf * (has(c, 'lazy') ? 0.9 : 1);
        if (s.research.progress[key] >= RESEARCH[key].hours) {
          s.research.done.push(key);
          if (M.observe && M.observe.logDecision) {
            const started = (s.research.started || {})[key];
            M.observe.logDecision('research-done', { key, branch: RESEARCH[key].branch, startedAt: started, trouble: started != null && s.lastTroubleT > started }, s);
          }
          s.research.active = null;
          chronicle(s, `The colony learned ${RESEARCH[key].label.toLowerCase()}.`);
          letter(s, { kind: 'good', title: `Research complete: ${RESEARCH[key].label}`, body: `${RESEARCH[key].desc}\n\nChoose the next project in Research.` });
          return endJob(s, c);
        }
        j.work += dt;
        if (j.work >= 2) endJob(s, c);
        return;
      }
      case 'smoke':
        if (!th || !(th.fuel > 0) || !c.carry) { if (th) th.busy = false; return endJob(s, c); }
        th.busy = true;
        j.work += dt * c.skills.cook * wf;
        if (j.work >= 1) {
          const n = c.carry.n;
          c.carry = null;
          th.busy = false;
          dropItem(s, 'preserved', n, Math.round(c.x), Math.round(c.y));
          endJob(s, c);
        }
        return;
      case 'cook':
        if (!th || !(th.fuel > 0) || !c.carry) return endJob(s, c);
        th.busy = true;
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
        j.work += dt * plantSkill(c) * wf;
        if (j.work >= 0.3) { p.sown = true; p.growth = 0; endJob(s, c); }
        return;
      }
      case 'harvestCrop': {
        const p = s.zones.grow[j.tile];
        if (!p || !p.sown || p.growth < 1) return endJob(s, c);
        j.work += dt * plantSkill(c) * wf;
        if (j.work >= 0.4) {
          const crop = p.crop;
          p.sown = false;
          p.growth = 0;
          p.crop = crop;
          dropItem(s, p.crop === 'healroot' ? 'medicine' : 'potato', p.crop === 'healroot' ? 1 : CROP_YIELD, j.tile % W, (j.tile / W) | 0);
          endJob(s, c);
        }
        return;
      }
      case 'pick':
        if (!th || !th.berries || th.des !== 'harvest') return endJob(s, c);
        th.progress = (th.progress || 0) + dt * plantSkill(c) * wf;
        if (th.progress >= 0.6) {
          th.berries = false;
          th.progress = 0;
          th.regrowAt = s.t + 72;
          dropItem(s, 'berries', 4, th.x, th.y);
          if (s.intro) s.intro.picked = (s.intro.picked || 0) + 1;
          endJob(s, c);
        }
        return;
      case 'chop':
        if (!th || th.des !== 'chop') return endJob(s, c);
        th.progress = (th.progress || 0) + dt * plantSkill(c) * wf;
        if (th.progress >= 1.2) {
          const wood = Math.max(1, Math.round(12 * (th.growth == null ? 1 : th.growth)));
          s.things.splice(s.things.indexOf(th), 1);
          reindex(s);
          endJob(s, c);
          dropItem(s, 'wood', wood, th.x, th.y);
        }
        return;
      case 'drafted':
        if (!c.drafted) endJob(s, c);
        return;
      case 'warmup': {
        j.work += dt;
        const [wx, wy] = tileOf(c);
        if (c.cold < 0.05 || j.work > 3 || feltTemp(s, wx, wy) < 5) endJob(s, c);
        return;
      }
      case 'feed': {
        const pt = colonistById(s, j.patientId);
        if (!pt || !c.carry) return endJob(s, c);
        j.work += dt;
        if (j.work >= 0.3) {
          pt.food = Math.min(1, pt.food + c.carry.n * ITEMS[c.carry.kind].food);
          c.carry = null;
          if (pt !== c) addMemory(s, pt, 'fed', `${c.name} fed me`, 4, 24);
          endJob(s, c);
        }
        return;
      }
      case 'hide':
      case 'flee':
        j.work += dt;
        if (j.work >= 0.3 || !(s.raiders || []).length) endJob(s, c);
        return;
      case 'firefight': {
        const f = s.fires[j.fire];
        if (!f) return endJob(s, c);
        f.i -= dt * 1.6 * wf;
        if (f.i <= 0) { delete s.fires[j.fire]; endJob(s, c); }
        return;
      }
      case 'bedrest': {
        c.sleeping = true;
        c.rest = Math.min(1, c.rest + dt / 9);
        j.work += dt;
        const bleeding = c.injuries.some((i) => !i.tended && i.bleed > 0);
        // Nobody came: tend your own wounds, less well.
        if (bleeding && j.work > 0.6 && !c.resTend && c.prio.doctor > 0) {
          j.self = (j.self || 0) + dt;
          if (j.self >= 0.6) for (const i of c.injuries) if (!i.tended) { i.tended = true; i.med = false; i.sev *= 1.15; }
        }
        if ((!bleeding && j.work > 1) || j.work > 12 || c.food < 0.12) endJob(s, c);
        return;
      }
      case 'rescue': {
        const pt = colonistById(s, j.patientId);
        if (!pt || !pt.downed) return endJob(s, c);
        if (!j.carrying) {
          const bed = freeBedFor(s, pt);
          if (!bed) return endJob(s, c);
          const res = pathTo(tileOf(c), [{ x: bed.x, y: bed.y, exact: true }]);
          if (!res) return endJob(s, c);
          pt.carriedBy = c.id;
          pt.bed = bed.id;
          j.carrying = true;
          c.path = res.path;
          j.stage = 'walk';
          return;
        }
        pt.carriedBy = null;
        const bed = byId.get(pt.bed);
        if (bed) { pt.x = bed.x; pt.y = bed.y; }
        return endJob(s, c);
      }
      case 'tend': {
        const pt = colonistById(s, j.patientId);
        if (!pt || !pt.injuries.some((i) => !i.tended)) return endJob(s, c);
        j.work += dt * (c.skills.doctor || 1) * wf;
        if (j.work >= 0.5) {
          const med = !!(c.carry && c.carry.kind === 'medicine');
          for (const i of pt.injuries) if (!i.tended) { i.tended = true; i.med = med; }
          if (med) c.carry = null;
          if (pt !== c) addMemory(s, pt, 'tended', `${c.name} tended my wounds`, 4, 24);
          endJob(s, c);
        }
        return;
      }
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
    if (c.carriedBy) {
      const r = colonistById(s, c.carriedBy);
      if (r && !r.away) { c.x = r.x; c.y = r.y; } else c.carriedBy = null;
    }
    if (bodyStep(s, c, dt)) return;
    if (c.downed) {
      c.food = Math.max(0, c.food - dt / 20);
      c.rest = Math.min(1, c.rest + dt / 12);
      if (c.food <= 0) c.weak = Math.min(1, c.weak + dt * 0.02);
      moodStep(s, c, dt);
      return;
    }
    if (!c.sleeping) c.rest = Math.max(0, c.rest - dt / 18);
    c.food = Math.max(0, c.food - dt / 20);
    const [x, y] = tileOf(c);
    const temp = feltTemp(s, x, y);
    // Awake colonists are dressed for the season; asleep in a freezing room they are not.
    if ((c.sleeping && temp < 0) || temp < -12) c.cold = Math.min(1, c.cold + dt * (has(c, 'hardy') ? 0.07 : 0.14) * Math.min(3, (5 - temp) / 5));
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
    moodStep(s, c, dt);
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
      else if (out >= 6 && hour >= 6 && hour < 20) p.growth = Math.min(1, p.growth + dt / (p.crop === 'healroot' ? CROP_HOURS * 1.5 : CROP_HOURS));
    }
    if (frost) s.warn.frost = (s.warn.frost || 0) + frost;
    for (const th of s.things) {
      if (th.type === 'bush' && !th.berries && s.t >= th.regrowAt && out > 5) th.berries = true;
      if (th.type === 'tree' && th.growth != null && th.growth < 1 && out > 5) th.growth = Math.min(1, th.growth + dt / 72);
    }
  }

  function dailyTick(s) {
    const day = dayIndex(s.t);
    if (day === s.lastDay) return;
    s.lastDay = day;
    for (const [k, until] of Object.entries(s.burnt || {})) {
      if (s.t < until) continue;
      if (s.terrain[k] === T.DIRT) s.terrain[k] = T.GRASS;
      delete s.burnt[k];
      s.terrainVersion = (s.terrainVersion || 0) + 1;
    }
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
    const open = (x, y) => {
      const i = idx(x, y);
      return s.terrain[i] === T.GRASS && !structAt[i] && !itemAt.has(i) && !s.zones.grow[i] && !stockSet.has(i) && !(x >= 4 && x <= 27 && y >= 1 && y <= 16);
    };
    let planted = 0, fallen = 0;
    for (let n = 0; n < 30 && (planted < (cal.season === 'Winter' ? 0 : 2) || fallen < 2); n++) {
      const x = Math.floor(Math.random() * W), y = Math.floor(Math.random() * H);
      if (!open(x, y)) continue;
      if (planted < (cal.season === 'Winter' ? 0 : 2)) { makeThing(s, 'tree', x, y, { variant: Math.floor(Math.random() * 2), growth: 0.05 }); reindex(s); planted++; }
      else { dropItem(s, 'wood', 3 + Math.floor(Math.random() * 4), x, y); fallen++; }
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
      trouble(s, 'food');
      letter(s, { kind: 'threat', title: 'Food is running low', body: 'There is less than about a day of food left. Pick berries, harvest the fields, or cook what is left.' });
      s.warn.lowFoodAt = s.t + 36;
    }
    if (cnt.wood < 15 && s.t >= (s.warn.lowWoodAt || 0)) {
      letter(s, { kind: 'threat', title: 'Wood is running low', body: 'Fires and heaters need wood to keep burning. Colonists chop trees you mark, and haul in fallen branches on their own.', actions: [{ label: 'Mark 6 trees to chop', cmd: { type: 'auto-chop', n: 6 } }] });
      s.warn.lowWoodAt = s.t + 36;
    }
  }

  // ---------- danger: injuries, death, raids, fire ----------
  const colonistById = (s, id) => s.colonists.find((o) => o.id === id);
  function inBed(c) {
    const th = structAt[idx(Math.round(c.x), Math.round(c.y))];
    return !!(th && th.type === 'bed' && !th.bp);
  }
  function freeBedFor(s, c) {
    const own = c.bed != null ? byId.get(c.bed) : null;
    if (own && !own.bp) return own;
    const owned = new Set(s.colonists.filter((o) => o !== c && o.bed != null).map((o) => o.bed));
    return s.things.find((th) => th.type === 'bed' && !th.bp && !owned.has(th.id)) || null;
  }
  function enemiesNear(s, x, y, r) { return (s.raiders || []).filter((e) => Math.hypot(e.x - x, e.y - y) <= r); }

  function injure(s, c, label, sev, bleed) {
    const same = c.injuries.find((i) => i.label === label && !i.tended);
    if (same && label === 'Burn') { same.sev = Math.min(0.9, same.sev + sev); return; }
    c.injuries.push({ label, sev, bleed, tended: false, med: false });
  }

  function bodyStep(s, c, dt) {
    const bleed = c.injuries.reduce((a, i) => a + (i.tended ? 0 : i.bleed), 0) * (c.downed ? 0.5 : 1);
    if (bleed > 0) c.blood = Math.max(0, c.blood - bleed * dt);
    else c.blood = Math.min(1, c.blood + dt * 0.03);
    const resting = c.sleeping || c.downed;
    for (const i of c.injuries) i.sev -= dt * (i.tended ? (i.med ? 0.03 : 0.015) : 0.004) * (resting ? 1.5 : 1);
    c.injuries = c.injuries.filter((i) => i.sev > 0.01);
    const hh = health(c);
    if (!c.downed && (hh < 0.2 || c.blood < 0.35)) {
      c.downed = true;
      trouble(s, 'downed');
      c.drafted = false;
      endJob(s, c);
      letter(s, { kind: 'threat', title: `${c.name} is down`, body: `${c.name} collapsed and cannot move. ${c.injuries.some((i) => !i.tended && i.bleed > 0) ? 'They are bleeding and need a doctor soon. ' : ''}Someone has to carry them to a bed.`, focus: { colonistId: c.id } });
    } else if (c.downed && hh >= 0.3 && c.blood >= 0.45) c.downed = false;
    c.coldH = c.cold >= 1 ? (c.coldH || 0) + dt : 0;
    c.starveH = c.weak >= 1 ? (c.starveH || 0) + dt : 0;
    const cause = c.blood <= 0.05 ? 'bled to death' : c.coldH > 6 ? 'froze to death' : c.starveH > 36 ? 'starved to death' : null;
    if (cause) { die(s, c, cause); return true; }
    return false;
  }

  function die(s, c, cause) {
    trouble(s, 'death');
    endJob(s, c);
    const [x, y] = tileOf(c);
    for (const r of relationsOf(s, c)) {
      const o = r.other;
      if (r.kind === 'partner') addMemory(s, o, 'lost', `Lost ${c.name}`, -25, 24 * 7);
      else if (r.kind === 'sibling') addMemory(s, o, 'lost', `Lost ${c.name}`, -18, 24 * 6);
      else if (r.kind === 'friend') addMemory(s, o, 'lost', `Lost ${c.name}`, -12, 24 * 4);
    }
    s.colonists.splice(s.colonists.indexOf(c), 1);
    for (const o of s.colonists) {
      if (!o.memories.some((m) => m.key === 'lost')) addMemory(s, o, 'death', `${c.name} died`, -8, 72);
      if (o.carriedBy === c.id) o.carriedBy = null;
    }
    s.relations = s.relations.filter((r) => r.a !== c.id && r.b !== c.id);
    const i = idx(x, y);
    if (!structAt[i] && !blocked[i]) { makeThing(s, 'grave', x, y, { name: c.name }); reindex(s); }
    s.dead.push({ name: c.name, t: r2(s.t), cause });
    chronicle(s, `${c.name} ${cause}.`);
    s.story.nextThreatAt = Math.max(s.story.nextThreatAt || 0, s.t + 48);
    letter(s, { kind: 'threat', title: `${c.name} has died`, body: `${c.name} ${cause}.${s.colonists.length ? ' The others will feel this for days.' : ''}` });
    if (!s.colonists.length) letter(s, { kind: 'threat', title: 'The colony has fallen', body: 'Nobody is left. Open the menu to start a new colony. What the Archivist has learned about you is kept.' });
  }

  function losClear(x0, y0, x1, y1) {
    let x = Math.round(x0), y = Math.round(y0);
    const tx = Math.round(x1), ty = Math.round(y1);
    const dx = Math.abs(tx - x), dy = -Math.abs(ty - y), sx = x < tx ? 1 : -1, sy = y < ty ? 1 : -1;
    let err = dx + dy;
    while (x !== tx || y !== ty) {
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
      if (x === tx && y === ty) break;
      const th = structAt[idx(x, y)];
      if (th && !th.bp && DEFS[th.type].boundary) return false;
    }
    return true;
  }
  function inCover(x, y) {
    const [tx, ty] = [Math.round(x), Math.round(y)];
    return DIRS4.some(([dx, dy]) => { const th = inb(tx + dx, ty + dy) && structAt[idx(tx + dx, ty + dy)]; return th && !th.bp && DEFS[th.type].blocks; });
  }

  function combatStep(s, dt) {
    s.shots = (s.shots || []).filter((sh) => sh.until > s.t);
    if (!s.raiders.length) return;
    const shoot = (a, targets, hitFn, range) => {
      a.cd = Math.max(0, (a.cd || 0) - dt);
      if (a.cd > 0) return;
      let best = null, bd = range;
      for (const t of targets) {
        const d = Math.hypot(t.x - a.x, t.y - a.y);
        if (d <= bd && losClear(a.x, a.y, t.x, t.y)) { bd = d; best = t; }
      }
      if (!best) return;
      a.cd = 0.1;
      const skill = a.hp != null ? 1 : 0.5 + 0.5 * health(a);
      const base = a.hp != null ? 0.5 : researched(s, 'bows') ? 0.76 : 0.66;
      const chance = Math.max(0.1, Math.min(0.85, (base - 0.035 * bd - (inCover(best.x, best.y) ? 0.3 : 0)) * skill));
      const hit = Math.random() < chance;
      s.shots.push({ x0: a.x, y0: a.y, x1: best.x, y1: best.y, hit, until: s.t + 0.04, side: a.hp != null ? 'raid' : 'col' });
      if (hit) hitFn(best);
    };
    for (const c of s.colonists) {
      if (c.away || c.downed || !c.drafted) continue;
      shoot(c, s.raiders, (r) => { r.hp -= rand(0.25, 0.4) + (researched(s, 'bows') ? 0.1 : 0); }, 7);
    }
    const exposed = s.colonists.filter((c) => !c.away && !c.downed);
    for (const r of s.raiders) {
      if (r.hp <= 0) continue;
      // Raiders fire at anyone armed within range, but only at unarmed colonists who come close.
      const targets = exposed.filter((c) => c.drafted || Math.hypot(c.x - r.x, c.y - r.y) <= 4);
      shoot(r, targets, (c) => { const sev = rand(0.08, 0.18); injure(s, c, 'Arrow wound', sev, sev * 0.45); s.raid.wounded = (s.raid.wounded || 0) + 1; }, 7);
    }
  }

  let raidBlocked = null;
  function raidGrid(s) {
    raidBlocked = new Uint8Array(blocked);
    for (const th of s.things) if (th.type === 'door' && !th.bp) raidBlocked[idx(th.x, th.y)] = 1;
  }

  function raiderStep(s, r, dt) {
    if (r.path && r.path.length) {
      const next = r.path[0];
      if (raidBlocked[idx(next[0], next[1])]) r.path = null;
      else {
        let budget = 34 * dt;
        while (budget > 0 && r.path.length) {
          const [tx, ty] = r.path[0];
          const dx = tx - r.x, dy = ty - r.y, d = Math.hypot(dx, dy);
          if (dx) r.facing = Math.sign(dx);
          if (d <= budget) { r.x = tx; r.y = ty; budget -= d; r.path.shift(); } else { r.x += (dx / d) * budget; r.y += (dy / d) * budget; budget = 0; }
        }
      }
    }
    if (r.state !== 'flee' && (r.hp < 0.5 || s.t >= s.raid.leaveAt)) { r.state = 'flee'; r.path = null; }
    const [x, y] = [Math.round(r.x), Math.round(r.y)];
    const trap = structAt[idx(x, y)];
    if (trap && trap.type === 'trap' && !trap.bp) {
      r.hp -= 0.5;
      s.things.splice(s.things.indexOf(trap), 1);
      reindex(s);
      raidGrid(s);
      s.shots.push({ x0: x, y0: y - 0.5, x1: x, y1: y, hit: true, until: s.t + 0.05, side: 'trap' });
    }
    if (r.state === 'flee') {
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) {
        if (r.carry) s.raid.stolen[r.carry.kind] = (s.raid.stolen[r.carry.kind] || 0) + r.carry.n;
        r.gone = true;
        s.raid.fled++;
        return;
      }
      if (!r.path || !r.path.length) {
        const res = bfs(x, y, (tx, ty) => tx === 0 || ty === 0 || tx === W - 1 || ty === H - 1, false, raidBlocked);
        r.path = res ? res.path : [];
      }
      return;
    }
    const visible = s.colonists.some((c) => !c.away && !c.downed && Math.hypot(c.x - r.x, c.y - r.y) <= 7 && losClear(r.x, r.y, c.x, c.y));
    if (visible && !r.carry) { r.path = null; return; }
    if (r.path && r.path.length) return;
    const it = itemAt.get(idx(x, y));
    if (it && !r.carry) {
      const kind = it.kind;
      r.carry = { kind, n: takeItem(s, it, 30) };
      r.state = 'flee';
      return;
    }
    const loot = s.items.filter((i) => i.kind !== 'wood' || s.items.every((o) => o.kind === 'wood'));
    const res = bfs(x, y, (tx, ty) => loot.some((i) => i.x === tx && i.y === ty), false, raidBlocked);
    if (res) r.path = res.path;
    else {
      const target = s.colonists.find((c) => !c.away && !c.downed);
      const toward = target && bfs(x, y, (tx, ty) => Math.hypot(tx - target.x, ty - target.y) < 5, false, raidBlocked);
      r.path = toward ? toward.path : [];
      if (!toward) r.state = 'flee';
    }
  }

  function raidTick(s, dt) {
    const raid = s.raid;
    if (!raid) return;
    // Call everyone in shortly before the raiders arrive.
    if (!raid.calledIn && s.t >= raid.arriveAt - 0.5) {
      raid.calledIn = true;
      for (const c of s.colonists) if (!c.away && !c.drafted && !c.downed) endJob(s, c);
    }
    if (!raid.spawned) {
      if (s.t < raid.arriveAt) return;
      raid.spawned = true;
      raid.leaveAt = s.t + 8;
      const spots = [];
      for (let k = 0; k < H; k++) {
        const [x, y] = raid.edge === 'east' ? [W - 1, k] : raid.edge === 'north' ? [Math.min(W - 1, k + 8), 0] : [Math.min(W - 1, k + 8), H - 1];
        if (!blocked[idx(x, y)]) spots.push([x, y]);
      }
      for (let n = 0; n < raid.n; n++) {
        const [x, y] = spots[Math.floor(Math.random() * spots.length)];
        s.raiders.push({ id: s.nextId++, x, y, hp: 1, state: 'raid', path: null, cd: rand(0, 0.1), facing: -1 });
      }
      letter(s, { kind: 'threat', title: 'The raiders are here', body: `${raid.n} raiders have reached the colony. Anyone outside is in danger.` });
      return;
    }
    raidGrid(s);
    for (const r of s.raiders) {
      if (r.hp <= 0) {
        if (r.carry) dropItem(s, r.carry.kind, r.carry.n, Math.round(r.x), Math.round(r.y));
        if (Math.random() < 0.5) dropItem(s, 'medicine', 1 + Math.floor(Math.random() * 2), Math.round(r.x), Math.round(r.y));
        r.gone = true;
        raid.killed++;
        continue;
      }
      raiderStep(s, r, dt);
    }
    s.raiders = s.raiders.filter((r) => !r.gone);
    if (!s.raiders.length) {
      const stolen = Object.entries(raid.stolen).map(([k, n]) => `${n} ${ITEMS[k].label.toLowerCase()}`);
      letter(s, {
        kind: raid.killed ? 'good' : 'info', title: 'The raiders are gone',
        body: `${raid.killed ? `${raid.killed} raider${raid.killed > 1 ? 's' : ''} fell. ` : ''}${raid.fled ? `${raid.fled} got away${stolen.length ? ` with ${stolen.join(' and ')}` : ''}. ` : ''}${raid.killed ? 'They left some medicine behind.' : ''}`.trim() || 'They left.',
      });
      if (M.observe && M.observe.logDecision) {
        M.observe.logDecision('raid-outcome', {
          raiders: raid.n, killed: raid.killed, fled: raid.fled, stolen: raid.stolen, wounded: raid.wounded || 0,
          drafted: raid.drafted || [], deaths: s.dead.filter((d) => d.t >= raid.startT).map((d) => d.name),
        }, s);
      }
      chronicle(s, `Raiders attacked: ${raid.killed} fell, ${raid.fled} escaped${Object.keys(raid.stolen).length ? ` with ${Object.entries(raid.stolen).map(([k, n]) => `${n} ${ITEMS[k].label.toLowerCase()}`).join(' and ')}` : ''}.`);
      if (raid.wounded) s.story.nextThreatAt = Math.max(s.story.nextThreatAt, s.t + 48);
      s.raid = null;
    }
  }

  function trouble(s, kind) { s.lastTroubleT = s.t; s.lastTrouble = kind; }
  function startRaid(s) {
    trouble(s, 'raid');
    unlock(s, ['draft']);
    const n = Math.max(2, Math.round(s.colonists.length * 0.7));
    const edge = pick(['east', 'north', 'south']);
    const warned = s.world && s.world.goodwill >= 30;
    s.raid = { startT: s.t, arriveAt: s.t + (warned ? 3 : 1.5), n, edge, spawned: false, leaveAt: null, killed: 0, fled: 0, stolen: {}, drafted: [] };
    letter(s, {
      kind: 'threat', title: 'Raiders are coming',
      body: `${warned ? `${NEIGHBOR} sent word early: ` : 'Scouts spotted '}${n} raiders coming from the ${edge}. They will be here in about ${warned ? 3 : 1.5} hours and will take whatever supplies they can reach.

`
        + 'Draft colonists to fight (select a colonist, then Draft; right-click to move them; standing next to a wall gives cover), bring everyone indoors behind doors, or keep working and let them take what they want.',
    });
  }

  function flammable(s, i, dry) {
    const th = structAt[i];
    if (th && !th.bp && FLAMMABLE.has(th.type)) return true;
    if (itemAt.has(i)) return true;
    const g = s.zones.grow[i];
    if (g && g.sown) return true;
    return dry && s.terrain[i] === T.GRASS && !(s.burnt && s.burnt[i]);
  }
  function homeFires(s) {
    const keys = Object.keys(s.fires || {});
    if (!keys.length) return [];
    const home = s.things.filter((th) => !DEFS[th.type].natural && th.type !== 'grave');
    return keys.map(Number).filter((i) => {
      const x = i % W, y = (i / W) | 0;
      return home.some((th) => Math.abs(th.x - x) + Math.abs(th.y - y) <= 10) || s.zones.stock.includes(i);
    });
  }
  function fireStep(s, dt) {
    const keys = Object.keys(s.fires || {});
    if (!keys.length) return;
    const dry = outdoorTemp(s) >= 15;
    let changed = false;
    for (const k of keys) {
      const i = Number(k), f = s.fires[k];
      if (!f) continue;
      f.i = Math.min(1.5, f.i + dt * 0.6);
      f.age += dt;
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of DIRS4) {
        if (!inb(x + dx, y + dy)) continue;
        const n = idx(x + dx, y + dy);
        const grassOnly = !structAt[n] && !itemAt.has(n) && !(s.zones.grow[n] && s.zones.grow[n].sown);
        if (!s.fires[n] && flammable(s, n, dry) && Math.random() < dt * 0.8 * f.i * (grassOnly ? 0.4 : 1)) s.fires[n] = { i: 0.2, age: 0 };
      }
      if (f.age > 1 && !f.burned) {
        f.burned = true;
        const th = structAt[i];
        if (th && !th.bp && FLAMMABLE.has(th.type)) { s.things.splice(s.things.indexOf(th), 1); changed = true; }
        const it = itemAt.get(i);
        if (it) { s.items.splice(s.items.indexOf(it), 1); itemAt.delete(i); }
        const g = s.zones.grow[i];
        if (g) { g.sown = false; g.growth = 0; }
        if (s.terrain[i] === T.GRASS) {
          s.terrain[i] = T.DIRT;
          s.burnt = s.burnt || {};
          s.burnt[i] = s.t + 72;
          s.terrainVersion = (s.terrainVersion || 0) + 1;
        }
      }
      if (f.age > 1.4) delete s.fires[k];
    }
    if (changed) { reindex(s); recomputeRooms(s); }
    for (const c of s.colonists) {
      if (c.away) continue;
      if (s.fires[idx(Math.round(c.x), Math.round(c.y))]) injure(s, c, 'Burn', 0.25 * dt, 0);
    }
    if (!Object.keys(s.fires).length) letter(s, { kind: 'info', title: 'The fire is out', body: 'The fire has burned out or been put out.' });
  }
  function startFire(s) {
    trouble(s, 'fire');
    const dry = outdoorTemp(s) >= 15;
    const cands = [];
    for (const th of s.things) {
      if ((th.type === 'campfire' || th.type === 'stove') && th.lit) {
        for (const [dx, dy] of DIRS8) { const x = th.x + dx, y = th.y + dy; if (inb(x, y) && flammable(s, idx(x, y), dry)) cands.push([x, y, `a spark from the ${DEFS[th.type].label.toLowerCase()}`]); }
      }
      if (th.type === 'tree' && dry) cands.push([th.x, th.y, 'lightning striking a tree']);
    }
    if (!cands.length) return false;
    const [x, y, why] = pick(cands);
    s.fires[idx(x, y)] = { i: 0.4, age: 0 };
    letter(s, { kind: 'threat', title: 'Fire!', body: `A fire started from ${why}. Colonists drop what they are doing to fight fires near home; fires spread through dry grass, crops, doors, beds, and stored goods.`, focus: { tile: idx(x, y) } });
    return true;
  }

  function threatTick(s) {
    if (s.t < (s.story.nextThreatAt || Infinity) || s.incident || s.caravan || s.raid || Object.keys(s.fires).length) return;
    if (s.colonists.filter((c) => !c.away).length < 2) { s.story.nextThreatAt = s.t + 12; return; }
    const cnt = counts(s);
    const wealth = Object.entries(cnt).reduce((a, [k, n]) => a + n * (TRADE_VALUE[k] || 1), 0);
    const pRaid = Math.max(0.3, Math.min(0.85, 0.3 + wealth / 500));
    const dry = outdoorTemp(s) >= 15;
    const ok = Math.random() < pRaid || !dry ? (startRaid(s), true) : startFire(s) || (startRaid(s), true);
    if (ok) s.story.nextThreatAt = s.t + rand(4, 6) * 24;
  }

  // ---------- the outside world ----------
  function chronicle(s, text) {
    s.history.push({ t: r2(s.t), text });
    if (s.history.length > 200) s.history.shift();
  }
  function goodwill(s, delta, why) {
    const w = s.world;
    const before = w.goodwill;
    w.goodwill = Math.max(-100, Math.min(100, w.goodwill + delta));
    if (why) chronicle(s, `${why} (${NEIGHBOR} goodwill ${before} → ${w.goodwill}).`);
  }
  function tradeRate(s) { return Math.max(0.35, Math.min(1.05, 0.7 + s.world.goodwill / 300)); }
  function takeFromStock(s, kind, n) {
    let left = n;
    for (const it of s.items.slice().sort((a, b) => b.n - a.n)) {
      if (it.kind !== kind || left <= 0) continue;
      left -= takeItem(s, it, left);
    }
    return n - left;
  }
  const tradeLeg = () => segHours('C', 'R1') + segHours('R1', 'MB');

  function tradeTick(s, dt) {
    const tr = s.trade;
    if (!tr) return;
    tr.prog += dt;
    if (tr.status === 'outbound' && tr.prog >= tradeLeg()) {
      tr.status = 'returning';
      tr.prog = 0;
      const value = Object.entries(tr.give).reduce((a, [k, n]) => a + n * TRADE_VALUE[k], 0);
      tr.got = Math.floor((value * tradeRate(s)) / TRADE_VALUE[tr.want]);
      goodwill(s, 3);
      letter(s, { kind: 'good', title: `Traded at ${NEIGHBOR}`, body: `The caravan traded ${Object.entries(tr.give).map(([k, n]) => `${n} ${ITEMS[k].label.toLowerCase()}`).join(', ')} for ${tr.got} ${ITEMS[tr.want].label.toLowerCase()} and is heading home.`, focus: { world: 'trade' } });
    } else if (tr.status === 'returning' && tr.prog >= tradeLeg()) {
      tr.members.forEach((id, n) => {
        const c = colonistById(s, id);
        if (!c) return;
        c.away = false;
        [c.x, c.y] = [[1, 12], [1, 13]][n % 2];
        endJob(s, c);
        if (has(c, 'wanderer')) addMemory(s, c, 'road', 'Enjoyed the trip', 6, 24);
      });
      if (tr.got) dropItem(s, tr.want, tr.got, 1, 13);
      chronicle(s, `A trade caravan came back from ${NEIGHBOR} with ${tr.got} ${ITEMS[tr.want].label.toLowerCase()}.`);
      s.trade = null;
    }
  }

  function worldTick(s) {
    const w = s.world;
    const cnt = counts(s);
    const homeN = s.colonists.filter((c) => !c.away).length;
    const food = rawFood(cnt) * 0.3 + cnt.meal * 0.9 + cnt.preserved * 0.3;
    // Neighbors who like you help when you're in trouble.
    if (w.goodwill >= 25 && s.t - w.lastGiftT > 96 && (food < homeN * 1.5 || cnt.medicine === 0) && homeN) {
      w.lastGiftT = s.t;
      w.giftsReceived = (w.giftsReceived || 0) + 1;
      const kind = cnt.medicine === 0 ? 'medicine' : 'preserved';
      const n = kind === 'medicine' ? 4 : 30;
      dropItem(s, kind, n, W - 2, 13);
      letter(s, { kind: 'good', title: `${NEIGHBOR} sent help`, body: `Word of your trouble reached ${NEIGHBOR}. They sent ${n} ${ITEMS[kind].label.toLowerCase()}, left at the east edge of the map.` });
      chronicle(s, `${NEIGHBOR} sent ${n} ${ITEMS[kind].label.toLowerCase()} when the colony was short.`);
    }
    if (s.t < w.nextWorldAt || s.incident || s.raid || w.request) return;
    w.nextWorldAt = s.t + rand(4, 7) * 24;
    const cal = calendar(s.t);
    const kind = cal.season === 'Fall' || cal.season === 'Winter' ? 'food' : pick(['food', 'wood']);
    const amount = kind === 'food' ? 30 : 40;
    w.request = { id: s.nextId++, kind, amount, t: s.t, until: s.t + 36 };
    letter(s, {
      kind: 'quest', title: `${NEIGHBOR} asks for help`, forRequest: w.request.id,
      body: `${NEIGHBOR} is short of ${kind} and asks for ${amount}${kind === 'food' ? ' food (a meal counts as 3)' : ' wood'}. A runner would carry it today.\n\nYou have ${kind === 'food' ? `${rawFood(cnt) + cnt.meal * 3 + cnt.preserved} food` : `${cnt.wood} wood`} now. How ${NEIGHBOR} feels about you affects trade prices, warnings about raids, and whether they help when you are in trouble.`,
      actions: [{ label: `Send ${amount} ${kind}`, cmd: { type: 'request-answer', id: w.request.id, accept: true } }, { label: 'Refuse', cmd: { type: 'request-answer', id: w.request.id, accept: false } }],
    });
  }
  function requestTick(s) {
    const r = s.world.request;
    if (r && s.t >= r.until) answerRequest(s, r, false, true);
  }
  function answerRequest(s, r, accept, expired) {
    const cnt = counts(s);
    const have = r.kind === 'food' ? rawFood(cnt) + cnt.meal * 3 + cnt.preserved : cnt.wood;
    if (M.observe && M.observe.logDecision) {
      const perDay = r.kind === 'food' ? Math.max(1, s.colonists.length) * 4 : 12;
      M.observe.logDecision('neighbor-request', {
        resource: r.kind, amount: r.amount, accept: !!accept, expired: !!expired, have, affordable: have >= r.amount,
        daysLeftAfter: r2((have - r.amount) / perDay), colonists: s.colonists.length, season: calendar(s.t).season,
        goodwill: s.world.goodwill, giftsReceived: s.world.giftsReceived || 0,
      }, s);
    }
    closeLetters(s, (l) => l.forRequest === r.id, expired ? 'This request expired before you answered.' : accept ? 'You sent it.' : 'You refused.');
    s.world.request = null;
    if (accept) {
      if (r.kind === 'food') {
        let left = r.amount;
        for (const k of ['berries', 'potato', 'preserved']) left -= takeFromStock(s, k, left);
        if (left > 0) takeFromStock(s, 'meal', Math.ceil(left / 3));
      } else takeFromStock(s, 'wood', r.amount);
      goodwill(s, 20, `The colony sent ${r.amount} ${r.kind} to ${NEIGHBOR}`);
      for (const c of s.colonists) if (has(c, 'kind')) addMemory(s, c, 'helped', `Helped ${NEIGHBOR}`, 6, 48);
      letter(s, { kind: 'good', title: `${NEIGHBOR} is grateful`, body: `The runner delivered ${r.amount} ${r.kind}. ${NEIGHBOR} will remember it.` });
    } else {
      goodwill(s, expired ? -8 : -12, expired ? `The colony ignored ${NEIGHBOR}'s request for ${r.kind}` : `The colony refused ${NEIGHBOR}'s request for ${r.kind}`);
      for (const c of s.colonists) if (has(c, 'kind')) addMemory(s, c, 'turnedaway', `Refused ${NEIGHBOR}`, -8, 48);
    }
  }

  // ---------- the opening and progressive controls ----------
  const ALL_UNLOCKS = ['pick', 'chop', 'cancel', 'zones', 'architect', 'work', 'research', 'world', 'draft', 'archivist', 'chronicle', 'evidence', 'propose'];
  function unlock(s, keys, title, body) {
    if (!s.unlocks) s.unlocks = ALL_UNLOCKS.slice();
    const fresh = keys.filter((k) => !s.unlocks.includes(k));
    if (!fresh.length) return;
    s.unlocks.push(...fresh);
    if (title) letter(s, { kind: 'info', title, body });
  }
  function candidateInfo(s, c) {
    const fit = health(c) * (has(c, 'hardworker') ? 1.2 : has(c, 'lazy') ? 0.8 : 1);
    return {
      name: c.name, traits: c.traits, mood: Math.round(c.mood), fit: r2(fit), hours: r2(errandHours(c)),
      willing: has(c, 'wanderer'), reluctant: has(c, 'homebody'),
      relations: relationsOf(s, c).map((r) => `${r.kind}:${r.other.name}`),
    };
  }
  function errandHours(c) { return r2(1.6 * (has(c, 'hardworker') ? 0.65 : 1) * (has(c, 'lazy') ? 1.25 : 1) / (0.5 + 0.5 * health(c))); }

  function introTick(s) {
    const it = s.intro;
    if (!it || it.stage === 'done') return;
    if (it.stage === 'order' && s.things.some((th) => th.type === 'bush' && th.des === 'harvest')) it.stage = 'watch';
    if (it.stage === 'watch' && (it.picked || 0) > 0) {
      if (it.requestAt == null) it.requestAt = s.t + 0.4;
      if (s.t >= it.requestAt) {
        it.stage = 'request';
        const meals = counts(s).meal;
        it.mealsAtAsk = meals;
        letter(s, {
          kind: 'quest', title: `${NEIGHBOR} asks for two meals`, open: true, forIntro: 'request',
          body: `A runner from ${NEIGHBOR}, the village down the road, reaches you at dusk. The miller's son is sick and they have no cooked food left. She asks for 2 meals.\n\nSend two and your colony keeps ${Math.max(0, meals - 2)}${meals - 2 < 6 ? '' : ', enough for tonight and tomorrow'}. Someone will have to carry them.`,
          actions: [{ label: 'Send 2 meals', cmd: { type: 'intro-answer', accept: true } }, { label: 'Not this time', cmd: { type: 'intro-answer', accept: false } }],
        });
      }
    }
    if (it.stage === 'errand-out' && s.t >= it.returnAt) {
      const c = colonistById(s, it.courier);
      if (c) {
        c.away = false;
        c.x = 12;
        c.y = H - 1;
        endJob(s, c);
        if (has(c, 'wanderer')) addMemory(s, c, 'road', 'Enjoyed the walk to ' + NEIGHBOR, 6, 24);
        if (has(c, 'homebody')) addMemory(s, c, 'homebody', 'Glad to be home', 2, 12);
      }
      if (it.accepted) {
        goodwill(s, 8, `${c ? c.name : 'A colonist'} carried two meals to ${NEIGHBOR}`);
      } else {
        dropItem(s, 'potato', 6, 12, H - 2);
        chronicle(s, `${c ? c.name : 'A colonist'} fetched the seed potatoes ${NEIGHBOR} owed.`);
      }
      it.stage = 'reflect';
      letter(s, {
        kind: 'good', title: `${c ? c.name : 'The courier'} is back`,
        body: it.accepted ? `${c ? c.name : 'They'} delivered the meals. The miller sends her thanks.` : `${c ? c.name : 'They'} came back with 6 seed potatoes ${NEIGHBOR} owed you.`,
      });
    }
  }
  function completeIntro(s, all) {
    if (!s.intro || s.intro.stage === 'done') { if (all) unlock(s, ALL_UNLOCKS); return; }
    s.intro.stage = 'done';
    s.intro.doneT = s.t;
    unlock(s, all ? ALL_UNLOCKS : ['chop', 'cancel', 'world', 'archivist', 'chronicle', 'evidence', 'propose']);
    s.story.nextAt = s.t + 10;
    s.story.nextThreatAt = s.t + 4 * 24;
    s.world.nextWorldAt = s.t + 2.5 * 24;
    if (!all) {
      letter(s, {
        kind: 'info', title: 'The colony is yours',
        body: 'From here the colony runs on its own. New controls appear when you need them: Architect when someone needs a bed, fields before winter, work priorities when jobs compete, research once things are calm. The Menu can show every control now.\n\nChop is ready: mark trees and colonists will cut firewood.',
      });
    }
  }
  function unlockTick(s) {
    const it = s.intro;
    if (!it || it.stage !== 'done' || !s.unlocks || s.unlocks.length >= ALL_UNLOCKS.length) return;
    const since = s.t - (it.doneT || 0);
    const beds = s.things.filter((th) => th.type === 'bed' && !th.bp).length;
    if (!s.unlocks.includes('zones') && since > 12 && s.t % 24 >= 8) {
      unlock(s, ['zones'], 'New: fields and stockpiles', 'Winter comes in about ten days, and nothing grows then. Zones lets you mark more fields for potatoes and stockpiles where goods are stored. Food keeps longer in a stockpile indoors.');
    }
    if (!s.unlocks.includes('architect') && (s.colonists.length > beds || since > 30)) {
      const need = s.colonists.length > beds;
      unlock(s, ['architect'], 'New: Architect', need ? `${s.colonists[s.colonists.length - 1].name} has no bed. Plan one with Architect; colonists carry wood to build it.` : 'Plan walls, doors, beds, and fires. Colonists carry wood to build them.');
    }
    if (!s.unlocks.includes('work') && since > 40) {
      unlock(s, ['work'], 'New: work priorities', 'When two jobs compete, everyone does them in their own order. Work lets you choose who does what first.');
    }
    if (!s.unlocks.includes('research') && since > 72 && !s.incident && !s.raid && s.t - (s.lastTroubleT || -1e9) > 24) {
      unlock(s, ['research'], 'New: research', 'Things are calm. A research bench (Architect) lets colonists spend time learning: better food storage, power, defenses, or medicine. Time at the bench is time not spent on anything else.');
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
  function caravanViable(s) { return !s.caravan && !s.trade && home(s).filter((c) => health(c) > 0.5).length >= 3; }

  function storyTick(s) {
    if (s.incident || s.caravan || s.raid || Object.keys(s.fires || {}).length || s.t < s.story.nextAt) return;
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
    s.story.nextAt = s.t + rand(14, 22);
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
      if (s.t >= inc.requestT + 16) declineCaravan(s, inc, true);
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
        goodwill(s, -6, `The caravan gave up on ${inc.traveler.name}`);
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
    goodwill(s, late ? 4 : 12, late ? `The colony reached ${inc.traveler.name} late` : `The colony rescued ${inc.traveler.name}`);
    for (const id of cv.members) {
      const c = s.colonists.find((o) => o.id === id);
      if (c) addMemory(s, c, late ? 'toolate' : 'rescuer', late ? `Too late for ${inc.traveler.name}` : `Reached ${inc.traveler.name} in time`, late ? -8 : 8, 48);
    }
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
    if (inc.failed) {
      for (const id of cv.members) { const c = s.colonists.find((o) => o.id === id); if (c) addMemory(s, c, 'gaveup', `Gave up on ${inc.traveler.name}`, -10, 48); }
    } else {
      if (s.colonists.length < MAX_COLONISTS) {
        const t = inc.traveler;
        const c = makeColonist(s, { name: t.name, shirt: t.shirt, hair: t.hair, traits: t.traits }, W - 2, 13);
        c.weak = inc.late ? 0.6 : 0.1;
        c.lastTripT = s.t;
        addMemory(s, c, 'rescued', 'Rescued by the colony', inc.late ? 6 : 12, 96);
        for (const id of cv.members) s.relations.push({ a: c.id, b: id, kind: 'friend' });
        for (const o of s.colonists) if (!cv.members.includes(o.id)) addMemory(s, o, 'welcomed', `${t.name} joined us`, 3, 24);
        s.colonists.push(c);
        chronicle(s, `${t.name}, a ${t.role}, joined the colony${inc.late ? ' after a rescue that came almost too late' : ''}.`);
        letter(s, { kind: 'good', title: `${t.name} joined the colony`, body: `${t.name} decided to stay${inc.late ? ' once they recover' : ''}. Another pair of hands, and another mouth to feed.`, focus: { colonistId: c.id } });
      } else {
        dropItem(s, 'potato', 15, W - 2, 13);
        letter(s, { kind: 'good', title: 'The caravan is home', body: `${inc.traveler.name} thanked the colony with 15 potatoes and went on their way.` });
      }
    }
    s.caravan = null;
    s.incident = null;
    s.story.nextAt = s.t + rand(14, 22);
  }

  function logRescueRequest(s, inc, accept, expired) {
    if (!M.observe || !M.observe.logDecision) return;
    M.observe.logDecision('rescue-request', { accept, expired, traveler: inc.traveler.name, deadlineKind: inc.deadlineKind, home: home(s).length, giftsReceived: s.world.giftsReceived || 0, goodwill: s.world.goodwill }, s);
  }
  function declineCaravan(s, inc, expired) {
    logRescueRequest(s, inc, false, expired);
    closeLetters(s, (l) => l.forIncident === inc.id, expired ? 'This request expired before you answered.' : 'You declined.');
    goodwill(s, -8, expired ? `The colony ignored a call for help from ${inc.traveler.name}` : `The colony turned ${inc.traveler.name} away`);
    for (const c of home(s)) addMemory(s, c, 'turnedaway', expired ? `Ignored ${inc.traveler.name}’s call for help` : `Turned ${inc.traveler.name} away`, has(c, 'kind') ? -10 : -3, 48);
    letter(s, { kind: 'info', title: expired ? 'The request expired' : 'Request declined', body: `${inc.traveler.name} will have to manage without the colony.` });
    s.incident = null;
    s.story.nextAt = s.t + rand(14, 20);
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
      people: s.colonists.map((c) => ({ name: c.name, traits: c.traits, mood: Math.round(c.mood), away: c.away })),
    };
  }

  function commit(s, inc, action, alternatives) {
    if (inc.committed) return;
    inc.committed = { action, t: s.t };
    obs('commit', inc, { action, alternatives, snapshot: snapshot(s, inc) });
  }
  function consult(s, inc, via) { if (inc && inc.reportIn) obs('consulted', inc, via); }

  // ---------- letters ----------
  const IMPORTANT = /raiders|fire!|is down|has died|broke down|road is blocked|freezing|fallen|starving|running low|asks|needs help|report|who should go/i;
  function letter(s, l) {
    const important = l.important != null ? l.important : !!(l.actions || l.reportFor || l.forIntro || l.kind === 'quest' || IMPORTANT.test(l.title));
    s.letters.push({ id: s.nextId++, t: s.t, read: false, ...l, important });
    while (s.letters.length > 12) {
      let i = s.letters.findIndex((x) => !x.actions && (x.read || !x.important));
      if (i < 0) i = s.letters.findIndex((x) => !x.actions);
      if (i < 0) break;
      archiveLetter(s, i);
    }
  }
  function archiveLetter(s, i) {
    const [l] = s.letters.splice(i, 1);
    s.letterLog = s.letterLog || [];
    s.letterLog.push(l);
    if (s.letterLog.length > 80) s.letterLog.shift();
  }
  function closeLetters(s, pred, note) {
    for (const l of s.letters.concat(s.letterLog || [])) if (pred(l)) { delete l.actions; l.read = true; l.closed = note; }
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
        if (!canPlace(s, cmd.kind)) return fail('Research this first');
        const { x, y } = cmd;
        if (!inb(x, y)) return fail('Outside the map');
        const i = idx(x, y);
        if (s.terrain[i] === T.WATER) return fail('Cannot build on water');
        if (structAt[i]) return fail('Something is already there');
        if (s.zones.grow[i]) return fail('That is part of a field');
        const before = inc && inc.kind === 'heating' ? heatingAlternatives(s, inc) : null;
        const th = makeThing(s, cmd.kind, x, y, { bp: true, progress: 0, delivered: 0, placedT: s.t });
        if (['barricade', 'trap', 'smoker', 'cooler'].includes(cmd.kind) && M.observe && M.observe.logDecision) {
          M.observe.logDecision('build-plan', { build: cmd.kind, protective: true, calm: s.t - (s.lastTroubleT || -1e9) > 48 }, s);
        }
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
              if (th.delivered && M.observe && M.observe.logDecision) {
                M.observe.logDecision('plan-cancel', { build: th.type, invested: th.delivered, investedShare: r2(th.delivered / DEFS[th.type].cost), trouble: th.placedT != null && s.lastTroubleT > th.placedT }, s);
              }
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
            if (s.zones.grow[i] && !s.zones.grow[i].sown && cmd.crop) { s.zones.grow[i].crop = cmd.crop === 'healroot' && researched(s, 'herbalism') ? 'healroot' : 'potato'; n++; continue; }
            if (s.zones.grow[i] || th || (s.terrain[i] !== T.GRASS && s.terrain[i] !== T.DIRT)) continue;
            if (stockSet.has(i)) s.zones.stock.splice(s.zones.stock.indexOf(i), 1);
            s.zones.grow[i] = { sown: false, growth: 0, crop: cmd.crop === 'healroot' && researched(s, 'herbalism') ? 'healroot' : 'potato' };
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
        archiveLetter(s, i);
        return ok();
      }
      case 'auto-chop': {
        const hub = s.zones.stock.length ? [s.zones.stock[0] % W, (s.zones.stock[0] / W) | 0] : [W / 2, H / 2];
        const trees = s.things.filter((th) => th.type === 'tree' && th.des !== 'chop' && (th.growth == null || th.growth >= 0.5))
          .sort((a, b) => Math.hypot(a.x - hub[0], a.y - hub[1]) - Math.hypot(b.x - hub[0], b.y - hub[1])).slice(0, cmd.n || 6);
        if (!trees.length) return fail('No trees are big enough to chop yet');
        for (const th of trees) th.des = 'chop';
        unlock(s, ['chop', 'cancel']);
        return ok({ note: `Marked ${trees.length} trees to chop.` });
      }
      case 'inspect': {
        const tg = cmd.target || {};
        if (inc && inc.kind === 'heating' && tg.kind === 'thing' && tg.id === inc.heaterId) consult(s, inc, 'heater');
        if (inc && inc.kind === 'caravan' && tg.kind === 'world' && tg.what === 'blockage') consult(s, inc, 'blockage');
        return ok();
      }
      case 'trade-send': {
        if (s.trade || s.caravan) return fail('A caravan is already out');
        const eligible = home(s).filter((c) => health(c) > 0.5);
        const members = [...new Set(cmd.members || [])].map((id) => eligible.find((c) => c.id === id)).filter(Boolean);
        if (members.length < 1 || members.length > 2) return fail('Choose one or two healthy colonists');
        if (!TRADE_VALUE[cmd.want]) return fail('Choose what to ask for');
        const cnt = counts(s);
        const give = {};
        for (const [k, n] of Object.entries(cmd.give || {})) if (n > 0 && TRADE_VALUE[k] && k !== cmd.want) give[k] = Math.min(n, cnt[k]);
        if (!Object.values(give).some((n) => n > 0)) return fail('Choose goods to trade');
        const worth = Object.entries(give).reduce((a, [k, n]) => a + n * TRADE_VALUE[k], 0);
        if (Math.floor((worth * tradeRate(s)) / TRADE_VALUE[cmd.want]) < 1) return fail(`That load is not worth even one ${ITEMS[cmd.want].label.toLowerCase()}`);
        for (const [k, n] of Object.entries(give)) give[k] = takeFromStock(s, k, n);
        for (const c of members) { endJob(s, c); c.duty = null; c.drafted = false; c.moveTo = null; c.away = true; c.lastTripT = s.t; }
        s.trade = { members: members.map((c) => c.id), give, want: cmd.want, status: 'outbound', prog: 0 };
        if (M.observe && M.observe.logDecision) M.observe.logDecision('trade', { members: members.map((c) => c.name), candidates: eligible.map((c) => candidateInfo(s, c)), give, want: cmd.want, goodwill: s.world.goodwill, stock: cnt, calm: s.t - (s.lastTroubleT || -1e9) > 48 }, s);
        letter(s, { kind: 'info', title: `A trade caravan left for ${NEIGHBOR}`, body: `${members.map((c) => c.name).join(' and ')} are carrying goods to ${NEIGHBOR}. Back in about ${Math.round(tradeLeg() * 2)} hours.`, focus: { world: 'trade' } });
        return ok();
      }
      case 'request-answer': {
        const r = s.world.request;
        if (!r || r.id !== cmd.id) return fail('That request is over');
        if (cmd.accept) {
          const cnt = counts(s);
          const have = r.kind === 'food' ? rawFood(cnt) + cnt.meal * 3 + cnt.preserved : cnt.wood;
          if (have < r.amount) return fail(`You only have ${have}`);
        }
        answerRequest(s, r, !!cmd.accept, false);
        return ok();
      }
      case 'research': {
        const r = RESEARCH[cmd.key];
        if (!r) return fail();
        if (researched(s, cmd.key)) return fail('Already researched');
        if (!r.requires.every((k) => researched(s, k))) return fail('Research what it builds on first');
        if (M.observe && M.observe.logDecision) {
          const cnt = counts(s);
          const prev = s.research.active;
          const started = (s.research.started || {})[prev];
          M.observe.logDecision('research-choice', {
            key: cmd.key, branch: r.branch, previous: prev, previousBranch: prev ? RESEARCH[prev].branch : null,
            invested: prev ? r2(s.research.progress[prev] || 0) : 0, investedShare: prev ? r2((s.research.progress[prev] || 0) / RESEARCH[prev].hours) : 0,
            troubleSincePrevious: !!(prev && started != null && s.lastTroubleT > started),
            calm: s.t - (s.lastTroubleT || -1e9) > 48,
            available: Object.keys(RESEARCH).filter((k) => !researched(s, k) && RESEARCH[k].requires.every((q) => researched(s, q))),
            season: calendar(s.t).season, wood: cnt.wood, food: rawFood(cnt) + cnt.meal + cnt.preserved, medicine: cnt.medicine, colonists: s.colonists.length,
          }, s);
        }
        s.research.started = s.research.started || {};
        if (s.research.started[cmd.key] == null) s.research.started[cmd.key] = s.t;
        s.research.active = cmd.key;
        return ok();
      }
      case 'intro-answer': {
        const it = s.intro;
        if (!it || it.stage !== 'request') return fail('That has been answered');
        const cnt = counts(s);
        if (cmd.accept && cnt.meal < 2) return fail('There are fewer than 2 meals left');
        it.accepted = !!cmd.accept;
        if (M.observe && M.observe.logDecision) {
          M.observe.logDecision('neighbor-request', {
            intro: true, resource: 'meals', amount: 2, accept: !!cmd.accept, expired: false, have: cnt.meal, affordable: cnt.meal >= 2,
            daysLeftAfter: r2(((cnt.meal - 2) * 3 + rawFood(cnt)) / (s.colonists.length * 4)), colonists: s.colonists.length,
            goodwill: s.world.goodwill, giftsReceived: 0,
          }, s);
        }
        closeLetters(s, (l) => l.forIntro === 'request', cmd.accept ? 'You agreed to send two meals.' : 'You said not this time.');
        if (!cmd.accept) goodwill(s, -4, `The colony could not spare meals for ${NEIGHBOR}`);
        it.stage = 'errand';
        letter(s, {
          kind: 'quest', title: 'Who should go?', open: true, forIntro: 'errand',
          body: cmd.accept
            ? `Someone has to carry the meals to ${NEIGHBOR} before dark. Whoever goes stops what they are doing until they are back.`
            : `The runner mentions that ${NEIGHBOR} still owes you a sack of seed potatoes from last fall. Someone could fetch it before dark. Whoever goes stops what they are doing until they are back.`,
          actions: [{ label: 'Choose who goes', cmd: { type: 'open-errand' } }],
        });
        return ok();
      }
      case 'errand-send': {
        const it = s.intro;
        if (!it || it.stage !== 'errand') return fail('Nobody needs to go now');
        const c = colonistById(s, cmd.id);
        if (!c || c.away || c.downed || health(c) <= 0.5) return fail('They cannot go right now');
        const eligible = home(s).filter((o) => health(o) > 0.5);
        if (M.observe && M.observe.logDecision) {
          M.observe.logDecision('errand', { intro: true, chosen: [c.name], candidates: eligible.map((o) => ({ ...candidateInfo(s, o), busy: o.job ? o.job.kind : null })), purpose: it.accepted ? 'deliver' : 'fetch' }, s);
        }
        if (it.accepted) takeFromStock(s, 'meal', 2);
        endJob(s, c);
        c.duty = null;
        c.drafted = false;
        c.away = true;
        c.lastTripT = s.t;
        it.courier = c.id;
        it.returnAt = s.t + errandHours(c);
        it.stage = 'errand-out';
        closeLetters(s, (l) => l.forIntro === 'errand', `You sent ${c.name}.`);
        letter(s, { kind: 'info', title: `${c.name} set off`, body: `${c.name} is walking to ${NEIGHBOR}${it.accepted ? ' with two meals' : ''}. Back in about ${Math.round(errandHours(c) * 60)} minutes.` });
        return ok();
      }
      case 'intro-reflected':
        if (s.intro && s.intro.stage === 'reflect') completeIntro(s, false);
        return ok();
      case 'intro-skip':
        completeIntro(s, true);
        return ok();
      case 'unlock-all':
        unlock(s, ALL_UNLOCKS);
        return ok();
      case 'draft': {
        const c = colonistById(s, cmd.id);
        if (!c || c.away || c.downed) return fail('They cannot be drafted right now');
        c.drafted = !!cmd.on;
        c.moveTo = null;
        endJob(s, c);
        if (s.raid && c.drafted && !s.raid.drafted.includes(c.name)) s.raid.drafted.push(c.name);
        if (s.raid && M.observe && M.observe.logDecision) M.observe.logDecision('draft', { name: c.name, on: c.drafted, raidArrived: s.raid.spawned, traits: c.traits, mood: Math.round(c.mood) }, s);
        return ok();
      }
      case 'move': {
        const c = colonistById(s, cmd.id);
        if (!c || !c.drafted) return fail('Draft a colonist to move them by hand');
        if (!inb(cmd.x, cmd.y) || blocked[idx(cmd.x, cmd.y)]) return fail('They cannot stand there');
        c.moveTo = [cmd.x, cmd.y];
        endJob(s, c);
        return ok();
      }
      case 'rescue': {
        const pt = colonistById(s, cmd.id);
        if (!pt || !pt.downed || pt.carriedBy) return fail('Nobody to rescue');
        if (!freeBedFor(s, pt)) return fail('There is no free bed');
        const helpers = s.colonists.filter((o) => o !== pt && !o.away && !o.downed);
        if (!helpers.length) return fail('Nobody can help');
        const from = [Math.round(pt.x), Math.round(pt.y)];
        helpers.sort((a, b) => Math.hypot(a.x - from[0], a.y - from[1]) - Math.hypot(b.x - from[0], b.y - from[1]));
        const r = helpers[0];
        endJob(s, r);
        const j = goJob(s, r, 'rescue', [{ x: from[0], y: from[1], pid: pt.id }]);
        if (!j) return fail('They cannot reach them');
        delete j._tg;
        j.patientId = pt.id;
        pt.resRescue = r.id;
        r.drafted = false;
        r.job = j;
        if (M.observe && M.observe.logDecision) M.observe.logDecision('rescue-order', { rescuer: r.name, patient: pt.name, enemiesNear: enemiesNear(s, pt.x, pt.y, 8).length, rescuerTraits: r.traits, relation: (relationsOf(s, r).find((x) => x.other === pt) || {}).kind || null }, s);
        return ok({ rescuer: r.name });
      }
      case 'caravan-send': {
        if (!inc || inc.kind !== 'caravan' || inc.stage !== 'request') return fail();
        if (s.trade) return fail('The trade caravan is still out');
        const eligible = home(s).filter((c) => health(c) > 0.5);
        const members = Array.isArray(cmd.members)
          ? [...new Set(cmd.members)].map((id) => eligible.find((c) => c.id === id)).filter(Boolean)
          : caravanCandidates(s);
        if (members.length !== 2) return fail('Choose two healthy colonists who are at home');
        if (M.observe && M.observe.logDecision) {
          M.observe.logDecision('caravan-members', {
            incidentId: inc.id, deadlineKind: inc.deadlineKind, traveler: inc.traveler.name,
            chosen: members.map((c) => c.name),
            candidates: eligible.map((c) => candidateInfo(s, c)),
          }, s);
        }
        for (const c of members) { endJob(s, c); c.duty = null; c.drafted = false; c.moveTo = null; c.away = true; c.lastTripT = s.t; }
        s.caravan = { members: members.map((c) => c.id), route: ROUTES.start.slice(), seg: 0, prog: 0, status: 'outbound', clear: 0 };
        inc.stage = 'travel';
        logRescueRequest(s, inc, true, false);
        closeLetters(s, (l) => l.forIncident === inc.id, `You sent ${members.map((c) => c.name).join(' and ')}.`);
        letter(s, { kind: 'info', title: 'The caravan set out', body: `${members.map((c) => c.name).join(' and ')} left along the old road toward ${inc.traveler.name}.`, focus: { world: 'caravan' } });
        return ok();
      }
      case 'caravan-decline': {
        if (!inc || inc.kind !== 'caravan' || inc.stage !== 'request') return fail();
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
    powerStep(s);
    burnFuel(s, dt);
    updateTemps(s, dt);
    for (const c of s.colonists.slice()) if (!c.away) stepColonist(s, c, dt);
    raidTick(s, dt);
    combatStep(s, dt);
    fireStep(s, dt);
    natureStep(s, dt);
    spoilItems(s, dt);
    dailyTick(s);
    warnings(s);
    chatterStep(s);
    const inc = s.incident;
    if (inc) {
      if (inc.kind === 'heating') heatingTick(s, inc);
      else caravanTick(s, inc, dt);
    }
    storyTick(s);
    threatTick(s);
    tradeTick(s, dt);
    worldTick(s);
    requestTick(s);
    introTick(s);
    unlockTick(s);
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
    const known = [...PEOPLE, ...TRAVELERS];
    for (const c of s.colonists) {
      if (!c.traits) { const p = known.find((k) => k.name === c.name); c.traits = p && p.traits ? p.traits.slice() : []; }
      if (c.mood == null) c.mood = 55;
      if (!c.memories) c.memories = [];
    }
    if (!s.relations) defaultRelations(s);
    if (!s.chatter) s.chatter = [];
    if (!s.raiders) s.raiders = [];
    if (!s.fires) s.fires = {};
    if (!s.dead) s.dead = [];
    if (!s.research) s.research = { done: [], active: null, progress: {} };
    if (!s.world) s.world = { goodwill: 10, lastGiftT: -1e9, nextWorldAt: s.t + 48 };
    if (!s.history) s.history = [];
    if (!s.intro) s.intro = { stage: 'done', doneT: s.t };
    if (!s.unlocks) s.unlocks = ALL_UNLOCKS.slice();
    if (s.lastTroubleT == null) s.lastTroubleT = -1e9;
    if (s.wind == null) { s.wind = 0.6; s.windAt = s.t; }
    for (const c of s.colonists) if (c.prio.research == null) c.prio.research = 3;
    s.shots = [];
    if (s.story.nextThreatAt == null) s.story.nextThreatAt = s.t + 3 * 24;
    for (const c of s.colonists) {
      if (!c.injuries) c.injuries = [];
      if (c.blood == null) c.blood = 1;
      if (c.prio.doctor == null) c.prio.doctor = 3;
      if (c.skills.doctor == null) c.skills.doctor = 1;
      c.carriedBy = null; c.resTend = null; c.resRescue = null; c.resFeed = null;
    }
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
    W, H, T, DEFS, ITEMS, TRAITS, REL_LABEL, RESEARCH, TRADE_VALUE, NEIGHBOR, BUILDABLE, WORK_TYPES, WORLD, ROUTES, HEATER_CAUSES, BLOCK_CAUSES, CLEAR_HOURS, RETURN_HOURS, CROP_HOURS,
    advance(hours) {
      let left = hours;
      while (left > 1e-9) { const dt = Math.min(STEP, left); step(S, dt); left -= dt; }
    },
    command(cmd) {
      if (!S) return fail('No colony');
      const res = apply(S, cmd);
      if (res.ok && cmd.letterId != null) closeLetters(S, (l) => l.id === cmd.letterId, res.note || 'Done.');
      return res;
    },
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
    dev: { startRaid: () => startRaid(S), startFire: () => startFire(S), injure: (c, sev) => injure(S, c, 'Arrow wound', sev, sev * 0.45) },
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
      canBuild: (kind, x, y) => inb(x, y) && canPlace(S, kind) && S.terrain[idx(x, y)] !== T.WATER && !structAt[idx(x, y)] && !S.zones.grow[idx(x, y)],
      caravanCandidates: () => caravanCandidates(S),
      eligibleForCaravan: () => home(S).filter((c) => health(c) > 0.5),
      thoughts: (c) => thoughts(S, c),
      raiders: () => S.raiders,
      researched: (k) => researched(S, k),
      tradeRate: () => tradeRate(S),
      unlocked: (k) => !S.unlocks || S.unlocks.includes(k),
      intro: () => S.intro,
      errandHours: (c) => errandHours(c),
      candidateInfo: (c) => candidateInfo(S, c),
      tradeLeg: () => tradeLeg(),
      canPlace: (k) => canPlace(S, k),
      fires: () => S.fires,
      relationsOf: (c) => relationsOf(S, c),
      spoilFactor: (x, y) => { const t = tempAt(S, x, y), r = roomAt(x, y); return t < 0 ? 0 : r && !r.outdoors ? (t < 10 ? 0.4 : 1) : 1.5; },
      segHours,
    },
  });
})();
