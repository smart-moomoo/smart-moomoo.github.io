// MMTI view: draws the colony and world map as pixel art, turns clicks and drags
// into MMTI.command() orders, and hosts letters, the inspect pane, and the
// reflection room. Game time only advances while this tab is visible.
(() => {
  'use strict';
  const M = window.MMTI;
  const root = document.getElementById('mmti-app');
  if (!root || !M || !M.load || !M.observe) return;
  const O = M.observe;
  const q = M.query;

  const TS = 16, W = M.W, H = M.H, CW = W * TS, CH = H * TS;
  const HOUR_MS = 10000;
  const SPEEDS = [1, 3, 6];
  const INK = '#171512';
  const ISSUES_URL = 'https://github.com/smart-moomoo/smart-moomoo.github.io/issues/new';
  const WORK_LABEL = { research: 'Research', doctor: 'Doctor', build: 'Construct', repair: 'Repair', cook: 'Cook', grow: 'Grow', chop: 'Chop', haul: 'Haul' };
  const ZONE_TOOLS = { stock: 'stock', grow: 'grow', healroot: 'grow', clearzone: 'clear' };

  let hadSave = false;
  try { hadSave = !!localStorage.getItem('mmti-colony-v3'); } catch {}
  M.load();
  const S = () => M.state;

  const params = new URLSearchParams(location.search);
  const rType = params.get('mmti-event'), rDead = params.get('mmti-deadline');
  if ((rType === 'heating' || rType === 'caravan') && (rDead === 'urgent' || rDead === 'none')) {
    M.review = { type: rType, deadline: rDead };
    S().story.nextAt = Math.min(S().story.nextAt, S().t + 0.3);
  }

  const ui = { view: 'map', tool: null, sel: null, hover: null, paused: false, speed: 0, modal: null, drag: null, toast: null };

  // ---------- helpers ----------
  function h(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') node.className = v;
        else if (k === 'on') for (const [ev, fn] of Object.entries(v)) node.addEventListener(ev, fn);
        else node.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid.nodeType ? kid : String(kid));
    return node;
  }
  const R = (g, x, y, w, hh, c) => { g.fillStyle = c; g.fillRect(x, y, w, hh); };
  function hash(x, y, k = 0) {
    let v = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
  }
  const fmtH = (x) => `${Math.max(0, x).toFixed(1)}h`;
  const SEASONS = ['Spring', 'Summer', 'Fall', 'Winter'];
  const clock = (t) => {
    const hr = t % 24;
    const hh = Math.floor(hr), mm = Math.floor((hr - hh) * 60 / 10) * 10;
    const d = Math.floor(t / 24) % 20;
    return `${SEASONS[Math.floor(d / 5)]} ${(d % 5) + 1} · ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  // ---------- sprites ----------
  const cache = new Map();
  function sprite(key, w, hh, draw) {
    let c = cache.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = w;
      c.height = hh;
      draw(c.getContext('2d'));
      cache.set(key, c);
    }
    return c;
  }

  const SPR = {
    tree: (v) => sprite(`tree${v}`, 16, 22, (g) => {
      R(g, 6, 13, 4, 9, INK); R(g, 7, 13, 2, 8, '#6b4a23'); R(g, 7, 13, 1, 8, '#4a3218');
      const ry = v ? 7 : 7.8;
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = (x - 7.5) / 7.6, dy = (y - 7.5) / ry, d = dx * dx + dy * dy;
        if (d > 1) continue;
        let col = d > 0.78 ? '#1d3419' : x + y < 10 ? '#5ea447' : y > 10 || x > 11 ? '#2e5e27' : '#3f7f33';
        const n = hash(x, y, v + 7);
        if (col === '#3f7f33' && n < 0.15) col = '#5ea447';
        else if (col === '#3f7f33' && n > 0.88) col = '#2e5e27';
        R(g, x, y, 1, 1, col);
      }
    }),
    bush: (ripe) => sprite(`bush${ripe}`, 16, 16, (g) => {
      for (let y = 3; y < 16; y++) for (let x = 0; x < 16; x++) {
        const dx = (x - 7.5) / 6.8, dy = (y - 10) / 5.4, d = dx * dx + dy * dy;
        if (d > 1) continue;
        let col = d > 0.72 ? '#1d3a19' : x + y < 14 ? '#5a9e45' : '#3f7d34';
        if (col === '#3f7d34' && hash(x, y, 3) < 0.12) col = '#5a9e45';
        R(g, x, y, 1, 1, col);
      }
      if (ripe) for (const [x, y] of [[4, 8], [9, 7], [11, 11], [6, 12], [8, 10]]) { R(g, x, y, 2, 2, '#d8323c'); R(g, x, y, 1, 1, '#ff9a9a'); }
    }),
    bed: () => sprite('bed', 16, 16, (g) => {
      R(g, 1, 0, 14, 16, INK); R(g, 2, 1, 12, 14, '#7a5230'); R(g, 3, 2, 10, 4, '#f4efe4'); R(g, 3, 5, 10, 1, '#d8d0bf');
      R(g, 3, 6, 10, 8, '#3d6f9e'); R(g, 3, 6, 10, 1, '#6a9bd0'); R(g, 3, 13, 10, 1, '#2c5277');
    }),
    table: () => sprite('table', 16, 16, (g) => {
      R(g, 1, 3, 14, 9, INK); R(g, 2, 4, 12, 6, '#a8753f'); R(g, 2, 4, 12, 1, '#c48f55'); R(g, 2, 10, 12, 1, '#6e4726');
      R(g, 2, 11, 3, 4, INK); R(g, 11, 11, 3, 4, INK); R(g, 3, 11, 1, 3, '#6e4726'); R(g, 12, 11, 1, 3, '#6e4726');
    }),
    heater: (on, f) => sprite(`heater${on}${f}`, 16, 16, (g) => {
      R(g, 2, 2, 12, 13, INK); R(g, 3, 3, 10, 11, on ? '#a63d2e' : '#6e4a44'); R(g, 3, 3, 10, 2, on ? '#cf5a45' : '#86625b');
      for (const y of [7, 9, 11]) R(g, 5, y, 6, 1, on ? (f ? '#ffc86b' : '#ff9a3d') : '#2e1c19');
      R(g, 3, 14, 2, 2, INK); R(g, 11, 14, 2, 2, INK);
    }),
    stove: (f, lit = 1) => sprite(`stove${f}${lit}`, 16, 16, (g) => {
      R(g, 6, 0, 4, 5, INK); R(g, 7, 0, 2, 4, '#4a4a4a'); R(g, 2, 4, 12, 11, INK); R(g, 3, 5, 10, 9, '#3a3a3a'); R(g, 3, 5, 10, 1, '#5a5a5a');
      R(g, 5, 8, 6, 4, INK);
      if (lit) { R(g, 6, 9, 4, 2, f ? '#ffb347' : '#ff7a2e'); R(g, 7 + f, 9, 1, 1, '#ffe08a'); } else R(g, 6, 10, 4, 1, '#4a4a4a');
      R(g, 3, 14, 2, 2, INK); R(g, 11, 14, 2, 2, INK);
    }),
    campfire: (f, lit = 1) => sprite(`campfire${f}${lit}`, 16, 16, (g) => {
      R(g, 2, 11, 12, 4, INK); R(g, 3, 12, 2, 2, '#8a8a82'); R(g, 6, 13, 2, 1, '#9a9a92'); R(g, 9, 12, 2, 2, '#8a8a82'); R(g, 12, 12, 1, 2, '#9a9a92');
      R(g, 4, 10, 8, 2, lit ? '#6b4a23' : '#3a3a3a');
      if (!lit) return;
      const flame = f ? [[6, 5, 4, 5], [5, 7, 6, 3], [7, 3, 2, 2]] : [[5, 6, 5, 4], [6, 4, 4, 3], [8, 2, 1, 2]];
      for (const [x, y, w, hh] of flame) R(g, x, y, w, hh, '#ff7a2e');
      R(g, 7, 6, 2, 3, '#ffd35a');
    }),
    potato: () => sprite('potato', 16, 16, (g) => {
      R(g, 3, 5, 10, 10, INK); R(g, 4, 6, 8, 8, '#b08a4a'); R(g, 4, 6, 8, 2, '#c9a466'); R(g, 5, 4, 6, 2, INK); R(g, 6, 4, 4, 1, '#8a6a34');
      for (const [x, y] of [[5, 9], [8, 8], [10, 11], [6, 12]]) R(g, x, y, 2, 1, '#8a6a34');
    }),
    berries: () => sprite('berries', 16, 16, (g) => {
      R(g, 2, 8, 12, 7, INK); R(g, 3, 9, 10, 5, '#a8753f'); R(g, 3, 11, 10, 1, '#8a5a2b');
      for (const [x, y] of [[3, 6], [6, 5], [9, 6], [5, 7], [8, 7], [11, 7]]) { R(g, x, y, 2, 2, '#d8323c'); R(g, x, y, 1, 1, '#ff9a9a'); }
    }),
    meal: () => sprite('meal', 16, 16, (g) => {
      R(g, 1, 8, 14, 6, INK); R(g, 2, 9, 12, 3, '#f4efe4'); R(g, 3, 12, 10, 1, '#d8d0bf');
      R(g, 4, 6, 8, 4, INK); R(g, 5, 6, 6, 3, '#e0a040'); R(g, 6, 6, 2, 1, '#6fae47'); R(g, 9, 7, 1, 1, '#c0533a');
    }),
    bench: () => sprite('bench', 16, 16, (g) => {
      R(g, 1, 4, 14, 8, INK); R(g, 2, 5, 12, 5, '#8a5f37'); R(g, 2, 5, 12, 1, '#a8753f'); R(g, 2, 12, 2, 3, INK); R(g, 12, 12, 2, 3, INK);
      R(g, 4, 2, 4, 4, INK); R(g, 5, 3, 2, 2, '#f4efe4'); R(g, 9, 3, 4, 3, '#3d6f9e'); R(g, 9, 3, 4, 1, '#6a9bd0');
    }),
    smoker: (lit) => sprite(`smoker${lit}`, 16, 16, (g) => {
      R(g, 2, 3, 12, 12, INK); R(g, 3, 4, 10, 10, '#7a5230'); R(g, 3, 4, 10, 2, '#9a6a3c'); R(g, 5, 8, 6, 4, INK); R(g, 6, 9, 4, 2, lit ? '#ff7a2e' : '#3a3a3a');
      R(g, 7, 0, 2, 4, INK);
    }),
    windmill: (f) => sprite(`windmill${f}`, 16, 16, (g) => {
      R(g, 6, 7, 4, 9, INK); R(g, 7, 8, 2, 8, '#c9c2b0');
      const blades = f % 2 ? [[1, 6, 14, 2], [7, 0, 2, 14]] : [[2, 2, 3, 3], [11, 2, 3, 3], [2, 10, 3, 3], [11, 10, 3, 3]];
      for (const [x, y, w, hh] of blades) R(g, x, y, w, hh, '#f4efe4');
      R(g, 7, 6, 2, 2, '#c0533a');
    }),
    cooler: (on) => sprite(`cooler${on}`, 16, 16, (g) => {
      R(g, 2, 3, 12, 11, INK); R(g, 3, 4, 10, 9, '#8fb8d8'); for (const y of [6, 8, 10]) R(g, 4, y, 8, 1, on ? '#dff2ff' : '#5a7890');
    }),
    eheater: (on) => sprite(`eheater${on}`, 16, 16, (g) => {
      R(g, 2, 3, 12, 11, INK); R(g, 3, 4, 10, 9, '#6f6b64'); for (const y of [6, 8, 10]) R(g, 4, y, 8, 1, on ? '#ff9a3d' : '#3a3a3a'); R(g, 11, 1, 2, 3, '#ffd23d');
    }),
    barricade: () => sprite('barricade', 16, 16, (g) => {
      R(g, 0, 6, 16, 9, INK); R(g, 1, 7, 14, 3, '#b5a37a'); R(g, 1, 11, 14, 3, '#a8966d'); R(g, 5, 7, 1, 7, INK); R(g, 10, 7, 1, 7, INK);
    }),
    trap: () => sprite('trap', 16, 16, (g) => {
      for (const x of [3, 7, 11]) { R(g, x, 9, 2, 4, '#8d8a84'); R(g, x, 8, 2, 1, '#c9c2b0'); } R(g, 2, 13, 12, 1, '#5a3c20');
    }),
    preserved: () => sprite('preserved', 16, 16, (g) => {
      R(g, 3, 3, 10, 12, INK); R(g, 4, 4, 8, 10, '#c9a466'); R(g, 4, 7, 8, 2, '#8a5a2b'); R(g, 5, 2, 6, 2, INK);
    }),
    healroot: (stage) => sprite(`heal${stage}`, 16, 16, (g) => {
      if (stage === 0) { R(g, 7, 9, 2, 3, '#8fe0b0'); return; }
      R(g, 7, 5, 2, 8, '#2f7a5f'); R(g, 4, 6, 3, 2, '#8fe0b0'); R(g, 9, 5, 3, 2, '#8fe0b0');
      if (stage >= 2) { R(g, 5, 9, 2, 2, '#8fe0b0'); R(g, 9, 9, 2, 2, '#8fe0b0'); }
      if (stage === 3) { R(g, 6, 2, 4, 3, '#f4efe4'); R(g, 7, 3, 2, 1, '#d8323c'); }
    }),
    medicine: () => sprite('medicine', 16, 16, (g) => {
      R(g, 3, 5, 10, 9, INK); R(g, 4, 6, 8, 7, '#f4efe4'); R(g, 7, 7, 2, 5, '#d8323c'); R(g, 5, 8, 6, 2, '#d8323c');
    }),
    grave: () => sprite('grave', 16, 16, (g) => {
      R(g, 3, 11, 10, 4, '#6b4a2b'); R(g, 5, 2, 6, 10, INK); R(g, 6, 3, 4, 9, '#9b968c'); R(g, 6, 3, 4, 1, '#b3ada2'); R(g, 7, 5, 2, 1, '#6f6b64'); R(g, 7, 7, 2, 1, '#6f6b64');
    }),
    fire: (f) => sprite(`fire${f}`, 16, 16, (g) => {
      const shapes = f ? [[3, 6, 4, 9], [7, 2, 4, 13], [11, 7, 3, 8]] : [[2, 7, 4, 8], [6, 4, 5, 11], [11, 5, 3, 10]];
      for (const [x, y, w, hh] of shapes) { R(g, x, y, w, hh, '#ff7a2e'); R(g, x + 1, y + 3, Math.max(1, w - 2), hh - 3, '#ffd35a'); }
    }),
    stockTile: () => sprite('stockTile', 16, 16, (g) => { g.fillStyle = 'rgba(255,214,110,.13)'; g.fillRect(0, 0, 16, 16); for (let i = 0; i < 16; i += 4) { R(g, i, 0, 2, 1, 'rgba(255,214,110,.5)'); R(g, 0, i, 1, 2, 'rgba(255,214,110,.5)'); } }),
    soil: () => sprite('soil', 16, 16, (g) => { R(g, 0, 0, 16, 16, '#6b4a2b'); for (let y = 1; y < 16; y += 4) { R(g, 0, y, 16, 1, '#5a3c20'); R(g, 0, y + 1, 16, 1, '#7a5934'); } }),
    crop: (stage) => sprite(`crop${stage}`, 16, 16, (g) => {
      if (stage === 0) { R(g, 7, 9, 2, 3, '#6fae47'); return; }
      if (stage === 1) { R(g, 7, 7, 2, 6, '#4f8a33'); R(g, 5, 7, 2, 2, '#6fae47'); R(g, 9, 6, 2, 2, '#6fae47'); return; }
      R(g, 7, 4, 2, 9, '#3f7a2a'); R(g, 4, 5, 3, 3, '#5ea447'); R(g, 9, 4, 3, 3, '#5ea447'); R(g, 5, 9, 2, 2, '#4f8a33'); R(g, 9, 9, 3, 2, '#4f8a33');
      if (stage === 3) { R(g, 3, 12, 3, 2, '#c9a466'); R(g, 10, 12, 3, 2, '#c9a466'); R(g, 3, 12, 3, 1, INK); R(g, 10, 12, 3, 1, INK); }
    }),
    keeper: () => sprite('keeper', 16, 16, (g) => {
      if (window.PixelArt) window.PixelArt.draw(g, 'keeper_a', window.PixelArt.PEOPLE_PALETTE, 1, 1, 1);
    }),
    logs: () => sprite('logs', 16, 16, (g) => {
      R(g, 1, 8, 14, 7, INK); R(g, 2, 9, 12, 5, '#8a5a2b'); R(g, 2, 9, 12, 1, '#a8753f'); R(g, 2, 9, 2, 5, '#c9a06a'); R(g, 2, 11, 12, 1, INK);
      R(g, 4, 4, 9, 5, INK); R(g, 5, 5, 7, 3, '#8a5a2b'); R(g, 5, 5, 7, 1, '#a8753f'); R(g, 5, 5, 2, 3, '#c9a06a');
    }),
    crate: () => sprite('crate', 16, 16, (g) => {
      R(g, 1, 6, 14, 9, INK); R(g, 2, 7, 12, 7, '#a06b3a'); R(g, 2, 7, 12, 1, '#c08850'); R(g, 2, 10, 12, 1, '#7a4f28');
      for (const [x, y] of [[3, 3], [6, 2], [9, 3], [5, 4], [8, 4], [11, 4]]) { R(g, x, y, 2, 2, '#d8323c'); R(g, x, y, 1, 1, '#ff9a9a'); }
      R(g, 2, 4, 12, 2, 'rgba(0,0,0,0)');
    }),
    axe: () => sprite('axe', 8, 8, (g) => { R(g, 1, 1, 6, 6, '#fffefa'); R(g, 2, 2, 1, 5, '#6b4a23'); R(g, 3, 2, 3, 3, '#6e6e6e'); R(g, 0, 0, 8, 1, INK); R(g, 0, 7, 8, 1, INK); R(g, 0, 0, 1, 8, INK); R(g, 7, 0, 1, 8, INK); }),
    pick: () => sprite('pick', 8, 8, (g) => { R(g, 1, 1, 6, 6, '#fffefa'); R(g, 2, 3, 2, 2, '#d8323c'); R(g, 4, 2, 2, 2, '#d8323c'); R(g, 4, 4, 2, 2, '#c02030'); R(g, 0, 0, 8, 1, INK); R(g, 0, 7, 8, 1, INK); R(g, 0, 0, 1, 8, INK); R(g, 7, 0, 1, 8, INK); }),
  };

  const COL_A = ['...oooo...', '..ohhhho..', '.ohhhhhho.', '.ohsssssho', '.osesssseo', '.ossssssso', '..oossoo..', '.occcccco.', 'occcccccco', 'oscccccCso', '.occcccCo.', '.opppppppo', '.opo..opo.', '.obo..obo.'];
  const COL_B = COL_A.slice(0, 12).concat(['..opoopo..', '..oboobo..']);
  function colonistSprite(c, frame, flip, headOnly) {
    return sprite(`c${c.shirt}${c.hair}${frame}${flip}${headOnly}`, 10, 14, (g) => {
      const pal = { o: INK, h: c.hair, s: '#f0c39a', e: INK, c: c.shirt, C: shade(c.shirt, 0.72), p: '#3b3f58', b: '#2a2018' };
      const rows = (frame ? COL_B : COL_A).slice(0, headOnly ? 6 : 14);
      rows.forEach((row, y) => {
        for (let x = 0; x < 10; x++) {
          const ch = row[flip ? 9 - x : x];
          if (ch !== '.') R(g, x, y, 1, 1, pal[ch]);
        }
      });
    });
  }

  const RAIDER_LOOK = { shirt: '#3a2a2a', hair: '#8a1c1c' };

  function iconCanvas(kind, scale = 2) {
    const src = spriteFor(kind);
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    c.style.width = `${src.width * scale / (src.height > 16 ? 1.4 : 1)}px`;
    c.style.height = `${src.height * scale / (src.height > 16 ? 1.4 : 1)}px`;
    c.className = 'mm-icon';
    return c;
  }
  function spriteFor(kind) {
    switch (kind) {
      case 'bed': return SPR.bed();
      case 'table': return SPR.table();
      case 'stove': return SPR.stove(0);
      case 'campfire': return SPR.campfire(0);
      case 'logs': return SPR.logs();
      case 'crate': return SPR.crate();
      case 'medicine': return SPR.medicine();
      case 'preserved': return SPR.preserved();
      case 'bench': return SPR.bench();
      case 'smoker': return SPR.smoker(1);
      case 'windmill': return SPR.windmill(0);
      case 'cooler': return SPR.cooler(1);
      case 'eheater': return SPR.eheater(1);
      case 'barricade': return SPR.barricade();
      case 'trap': return SPR.trap();
      case 'healroot': return sprite('healicon', 16, 16, (g) => { g.drawImage(SPR.soil(), 0, 0); g.drawImage(SPR.healroot(2), 0, 0); });
      case 'potato': return SPR.potato();
      case 'meal': return SPR.meal();
      case 'berries': return SPR.berries();
      case 'stock': return sprite('stockicon', 16, 16, (g) => { R(g, 1, 1, 14, 14, '#c9a55a'); R(g, 2, 2, 12, 12, '#3a3f44'); g.drawImage(SPR.logs(), 0, 0); });
      case 'grow': return sprite('growicon', 16, 16, (g) => { g.drawImage(SPR.soil(), 0, 0); g.drawImage(SPR.crop(2), 0, 0); });
      case 'clearzone': return sprite('clearzone', 16, 16, (g) => { R(g, 1, 1, 14, 14, '#6b4a2b'); for (let i = 2; i < 14; i++) { R(g, i, i, 2, 2, '#b23a2a'); R(g, 15 - i, i, 2, 2, '#b23a2a'); } });
      case 'wall': return sprite('wallicon', 16, 16, (g) => drawWall(g, 0, 0, 0, 0));
      case 'door': return sprite('dooricon', 16, 16, (g) => drawDoor(g, 0, 0));
      case 'chop': return SPR.tree(0);
      case 'harvest': return SPR.bush(true);
      case 'cancel': return sprite('cancel', 16, 16, (g) => { for (let i = 2; i < 14; i++) { R(g, i, i, 2, 2, '#b23a2a'); R(g, 15 - i, i, 2, 2, '#b23a2a'); } });
      default: return sprite('none', 16, 16, () => {});
    }
  }

  function drawWall(g, px, py, x, y) {
    R(g, px, py, 16, 16, '#6f6b64');
    R(g, px, py, 16, 6, '#9b968c');
    R(g, px, py, 16, 1, '#b3ada2');
    R(g, px, py + 6, 16, 1, '#57544e');
    R(g, px, py + 10, 16, 1, '#5d5a54');
    R(g, px + ((x + y) % 2 ? 4 : 10), py + 7, 1, 3, '#5d5a54');
    R(g, px + ((x + y) % 2 ? 10 : 4), py + 11, 1, 5, '#5d5a54');
    R(g, px, py + 15, 16, 1, '#3f3c38');
  }
  function drawDoor(g, px, py) {
    R(g, px, py, 16, 16, '#4a2e17');
    R(g, px + 2, py + 1, 12, 15, '#8a5a2b');
    R(g, px + 2, py + 5, 12, 1, '#6e4520');
    R(g, px + 2, py + 10, 12, 1, '#6e4520');
    R(g, px + 11, py + 8, 2, 2, '#e0b64a');
  }

  // ---------- terrain ----------
  let terrainCanvas = null, terrainVersion = 0;
  function buildTerrain() {
    const s = S();
    const c = document.createElement('canvas');
    c.width = CW;
    c.height = CH;
    const g = c.getContext('2d');
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const t = s.terrain[y * W + x], px = x * TS, py = y * TS;
      const spk = (n, cols) => { for (let k = 0; k < n; k++) R(g, px + Math.floor(hash(x, y, k) * 16), py + Math.floor(hash(x, y, k + 40) * 16), 1, 1, cols[k % cols.length]); };
      if (t === M.T.GRASS) {
        R(g, px, py, TS, TS, '#5e9a3d');
        spk(9, ['#6eae4a', '#4f8733', '#68a545']);
        if (hash(x, y, 99) < 0.08) R(g, px + 6 + Math.floor(hash(x, y, 98) * 5), py + 5 + Math.floor(hash(x, y, 97) * 6), 1, 1, hash(x, y, 96) < 0.5 ? '#f1d24a' : '#f4f0e8');
        if (hash(x, y, 95) < 0.3) { const tx = px + Math.floor(hash(x, y, 94) * 13), ty = py + Math.floor(hash(x, y, 93) * 12); R(g, tx, ty, 1, 2, '#78b953'); R(g, tx + 2, ty + 1, 1, 2, '#78b953'); }
      } else if (t === M.T.DIRT) {
        R(g, px, py, TS, TS, '#8b6b45');
        spk(10, ['#9a7a51', '#77593a', '#a89a86']);
      } else if (t === M.T.SAND) {
        R(g, px, py, TS, TS, '#d7c38a');
        spk(8, ['#c8b27a', '#e3d29c']);
      } else if (t === M.T.WATER) {
        R(g, px, py, TS, TS, '#3a75ad');
        spk(5, ['#336a9e', '#4581b8']);
      } else if (t === M.T.FLOOR) {
        R(g, px, py, TS, TS, '#a9784a');
        for (const ly of [0, 4, 8, 12]) { R(g, px, py + ly, TS, 1, '#b98755'); R(g, px, py + ly + 3, TS, 1, '#8b5e36'); }
        for (const [ly, sx] of [[0, (x * 5) % 16], [4, (x * 5 + 7) % 16], [8, (x * 5 + 3) % 16], [12, (x * 5 + 11) % 16]]) R(g, px + sx, py + ly, 1, 4, '#8b5e36');
      }
    }
    terrainCanvas = c;
  }

  // ---------- DOM ----------
  const canvas = h('canvas', { class: 'mm-canvas', width: CW, height: CH, 'aria-label': 'Colony map' });
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const el = {
    clock: h('span', { class: 'mm-clock' }),
    weather: h('span', { class: 'mm-weather' }),
    wood: h('b'), food: h('b'), meal: h('b'), med: h('b'), pres: h('b'), power: h('span', { class: 'mm-chip mm-power' }),
    speed: [],
    bar: h('div', { class: 'mm-colonists', 'aria-label': 'Colonists' }),
    letters: h('div', { class: 'mm-letters', 'aria-label': 'Letters' }),
    hover: h('div', { class: 'mm-hover' }),
    toast: h('div', { class: 'mm-toast', hidden: true }),
    tip: h('div', { class: 'mm-tip' }),
    inspect: h('div', { class: 'mm-inspect' }),
    modal: h('div', { class: 'mm-modal', hidden: true }),
    viewBtn: null,
    toolBtns: new Map(),
  };
  const speedGroup = h('div', { class: 'mm-speed', role: 'group', 'aria-label': 'Game speed' });
  ['❚❚', '▶', '▶▶', '▶▶▶'].forEach((label, i) => {
    const b = h('button', { type: 'button', class: 'mm-btn mm-btn-s', 'aria-label': i ? `Speed ${i}` : 'Pause', on: { click: () => setSpeed(i - 1) } }, label);
    el.speed.push(b);
    speedGroup.append(b);
  });
  const top = h('div', { class: 'mm-top' },
    el.clock, el.weather,
    h('span', { class: 'mm-chip', title: 'Wood' }, iconCanvas('logs', 1.25), el.wood),
    h('span', { class: 'mm-chip', title: 'Raw food: potatoes and berries' }, iconCanvas('potato', 1.25), el.food),
    h('span', { class: 'mm-chip', title: 'Cooked meals' }, iconCanvas('meal', 1.25), el.meal),
    h('span', { class: 'mm-chip', title: 'Preserved food' }, iconCanvas('preserved', 1.25), el.pres),
    h('span', { class: 'mm-chip', title: 'Medicine' }, iconCanvas('medicine', 1.25), el.med),
    el.power,
    speedGroup,
    h('button', { type: 'button', class: 'mm-btn mm-btn-s', on: { click: openMenu } }, 'Menu'));
  const stage = h('div', { class: 'mm-stage' }, canvas, el.letters, el.hover, el.toast);

  function toolButton(kind, label, sub) {
    const b = h('button', { type: 'button', class: 'mm-tool', title: label, on: { click: () => setTool(ui.tool && ui.tool.kind === kind ? null : { kind }) } },
      iconCanvas(kind, 1.5), h('span', null, label), sub ? h('small', null, sub) : null);
    el.toolBtns.set(kind, b);
    return b;
  }
  el.viewBtn = h('button', { type: 'button', class: 'mm-btn', on: { click: () => setView(ui.view === 'map' ? 'world' : 'map') } }, 'World map');
  const tools = h('div', { class: 'mm-tools' },
    el.archRow = h('div', { class: 'mm-toolrow' }),
    el.zoneRow = h('div', { class: 'mm-toolrow' }),
    h('div', { class: 'mm-toolrow' }, h('span', { class: 'mm-toolhead' }, 'Orders'),
      toolButton('chop', 'Chop'), toolButton('harvest', 'Pick berries'), toolButton('cancel', 'Cancel')),
    h('div', { class: 'mm-toolrow mm-toolrow-views' },
      el.viewBtn,
      h('button', { type: 'button', class: 'mm-btn', on: { click: () => openModal('work') } }, 'Work'),
      el.researchBtn = h('button', { type: 'button', class: 'mm-btn', on: { click: () => openModal('research') } }, 'Research'),
      h('button', { type: 'button', class: 'mm-btn', on: { click: () => openModal('reflect') } }, 'Archivist'),
      h('button', { type: 'button', class: 'mm-btn', on: { click: () => openModal('chronicle') } }, 'Chronicle'),
      h('button', { type: 'button', class: 'mm-btn', on: { click: () => openModal('evidence') } }, 'Evidence'),
      h('button', { type: 'button', class: 'mm-btn', on: { click: () => openModal('propose') } }, 'Propose')),
    el.tip);
  let toolSig = null;
  function renderToolRows() {
    const sig = S().research.done.join();
    if (sig === toolSig) return;
    toolSig = sig;
    el.archRow.replaceChildren(h('span', { class: 'mm-toolhead' }, 'Architect'),
      ...M.BUILDABLE.filter((k) => q.canPlace(k)).map((k) => toolButton(k, M.DEFS[k].label, `${M.DEFS[k].cost} wood`)));
    el.zoneRow.replaceChildren(...[h('span', { class: 'mm-toolhead' }, 'Zones'),
      toolButton('stock', 'Stockpile'), toolButton('grow', 'Field'), q.researched('herbalism') ? toolButton('healroot', 'Healroot field') : null, toolButton('clearzone', 'Remove zone')].filter(Boolean));
    setTool(ui.tool);
  }
  renderToolRows();
  root.replaceChildren(h('div', { class: 'mm' }, top, el.bar, stage, h('div', { class: 'mm-bottom' }, el.inspect, tools), el.modal));

  // ---------- state changes ----------
  function setSpeed(i) {
    if (i < 0) ui.paused = !ui.paused;
    else { ui.speed = i; ui.paused = false; }
    renderSpeed();
  }
  function renderSpeed() {
    el.speed.forEach((b, i) => b.classList.toggle('is-on', i === 0 ? ui.paused : !ui.paused && ui.speed === i - 1));
  }
  function setTool(t) {
    ui.tool = t;
    ui.drag = null;
    for (const [k, b] of el.toolBtns) b.classList.toggle('is-on', !!t && t.kind === k);
    if (t && t.kind === 'move') return void (el.tip.textContent = 'Click where they should go. Right-click also moves a drafted colonist.');
    if (t && ui.view !== 'map') setView('map');
    const tips = {
      wall: 'Click or drag to plan walls.', door: 'Click a wall gap to plan a door.',
      chop: 'Drag over trees to mark them for chopping.', harvest: 'Drag over berry bushes to mark them for harvest.',
      cancel: 'Drag to remove plans and marks.',
      stock: 'Drag to mark a stockpile. Colonists haul goods there; indoors they keep longer.',
      grow: 'Drag over open ground to mark a field. Colonists plant potatoes there when it is warm.',
      clearzone: 'Drag to remove stockpiles and fields.',
      healroot: 'Drag over open ground or an unplanted field to grow healroot, which gives medicine.',
    };
    if (t && t.kind === 'move') { el.tip.textContent = 'Click where they should go. Right-click also moves a drafted colonist.'; return; }
    el.tip.textContent = t ? `${tips[t.kind] || `Click to place a ${M.DEFS[t.kind].label.toLowerCase()}.`} Right-click or Esc to stop.` : '';
  }
  function setView(v) {
    ui.view = v;
    el.viewBtn.textContent = v === 'map' ? 'World map' : 'Colony';
    canvas.setAttribute('aria-label', v === 'map' ? 'Colony map' : 'World map');
    if (v === 'world' && ui.tool) setTool(null);
    if (ui.sel && (v === 'world') !== (ui.sel.kind === 'world') && ui.sel.kind !== 'colonist') ui.sel = null;
    lastInspectSig = '';
  }
  function select(sel) {
    ui.sel = sel;
    lastInspectSig = '';
    if (!sel) return;
    if (sel.kind === 'thing') M.command({ type: 'inspect', target: { kind: 'thing', id: sel.id } });
    if (sel.kind === 'world') M.command({ type: 'inspect', target: { kind: 'world', what: sel.what } });
  }
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(ui.toast);
    ui.toast = setTimeout(() => { el.toast.hidden = true; }, 2200);
  }
  function order(cmd) {
    const res = M.command(cmd);
    if (!res.ok && res.reason) toast(res.reason);
    lastInspectSig = '';
    return res;
  }

  // ---------- input ----------
  function eventTile(e) {
    const r = canvas.getBoundingClientRect();
    const lx = ((e.clientX - r.left) / r.width) * CW, ly = ((e.clientY - r.top) / r.height) * CH;
    return { lx, ly, x: Math.floor(lx / TS), y: Math.floor(ly / TS) };
  }
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    const p = eventTile(e);
    if (e.button === 2) {
      const c = ui.sel && ui.sel.kind === 'colonist' && S().colonists.find((o) => o.id === ui.sel.id);
      if (c && c.drafted && ui.view === 'map') { order({ type: 'move', id: c.id, x: p.x, y: p.y }); ui.moveMark = { x: p.x, y: p.y, until: performance.now() + 700 }; return; }
      setTool(null);
      return;
    }
    if (ui.tool && ui.tool.kind === 'move') {
      order({ type: 'move', id: ui.tool.id, x: p.x, y: p.y });
      ui.moveMark = { x: p.x, y: p.y, until: performance.now() + 700 };
      setTool(null);
      return;
    }
    if (ui.view === 'world') { clickWorld(p); return; }
    if (!ui.tool) { clickMap(p); return; }
    canvas.setPointerCapture(e.pointerId);
    const k = ui.tool.kind;
    ui.drag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, placed: new Set() };
    if (M.BUILDABLE.includes(k)) placeAt(p.x, p.y);
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = eventTile(e);
    ui.hover = p;
    if (!ui.drag || !ui.tool) return;
    ui.drag.x1 = p.x;
    ui.drag.y1 = p.y;
    if (ui.tool.kind === 'wall') placeAt(p.x, p.y);
  });
  canvas.addEventListener('pointerleave', () => { ui.hover = null; });
  canvas.addEventListener('pointerup', () => {
    const d = ui.drag;
    ui.drag = null;
    if (!d || !ui.tool) return;
    const k = ui.tool.kind;
    if (ZONE_TOOLS[k]) {
      const res = M.command({ type: 'zone', mode: ZONE_TOOLS[k], crop: k === 'healroot' ? 'healroot' : k === 'grow' ? 'potato' : undefined, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 });
      if (!res.ok) toast(res.reason);
    } else if (k === 'chop' || k === 'harvest' || k === 'cancel') {
      const res = M.command({ type: 'designate', mode: k, x0: d.x0, y0: d.y0, x1: d.x1, y1: d.y1 });
      if (!res.ok) toast(k === 'chop' ? 'Drag over trees to mark them' : k === 'harvest' ? 'Drag over berry bushes to mark them' : 'Nothing to cancel there');
    }
    lastInspectSig = '';
  });
  function placeAt(x, y) {
    const d = ui.drag;
    const key = `${x},${y}`;
    if (d && d.placed.has(key)) return;
    if (d) d.placed.add(key);
    const res = M.command({ type: 'build', kind: ui.tool.kind, x, y });
    if (!res.ok && (!d || d.placed.size === 1)) toast(res.reason);
  }

  function clickMap(p) {
    const s = S();
    let best = null, bd = 0.75;
    for (const c of s.colonists) {
      if (c.away) continue;
      const d = Math.hypot(c.x + 0.5 - p.lx / TS, c.y + 0.5 - p.ly / TS);
      if (d < bd) { bd = d; best = c; }
    }
    for (const r of s.raiders || []) {
      if (Math.hypot(r.x + 0.5 - p.lx / TS, r.y + 0.5 - p.ly / TS) < 0.75) return select({ kind: 'raider', id: r.id });
    }
    if (best) return select({ kind: 'colonist', id: best.id });
    const th = q.thingAt(p.x, p.y);
    if (th) return select({ kind: 'thing', id: th.id });
    select({ kind: 'tile', x: p.x, y: p.y });
  }

  // ---------- world map ----------
  const WN = M.WORLD.nodes;
  const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  const blockagePos = () => lerp(WN.R2, WN.R3, 0.35);
  function caravanPos() {
    const cv = S().caravan;
    if (!cv) return null;
    if (cv.status === 'returning') return lerp(WN.X, WN.C, Math.min(1, cv.prog / M.RETURN_HOURS));
    if (cv.status === 'blocked' || cv.status === 'clearing') return WN.R2;
    const a = cv.route[cv.seg], b = cv.route[cv.seg + 1];
    if (!b) return WN[a];
    return lerp(WN[a], WN[b], Math.min(1, cv.prog / q.segHours(a, b)));
  }
  function tradePos() {
    const tr = S().trade;
    if (!tr) return null;
    const legs = [['C', 'R1'], ['R1', 'MB']];
    let t = tr.prog;
    const seq = tr.status === 'outbound' ? legs : legs.slice().reverse().map(([a, b]) => [b, a]);
    for (const [a, b] of seq) {
      const hrs = q.segHours(a, b);
      if (t <= hrs) return lerp(WN[a], WN[b], t / hrs);
      t -= hrs;
    }
    return tr.status === 'outbound' ? WN.MB : WN.C;
  }
  function distToRoute(nodes, x, y) {
    let best = Infinity;
    for (let i = 0; i < nodes.length - 1; i++) {
      const [ax, ay] = WN[nodes[i]], [bx, by] = WN[nodes[i + 1]];
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(ax + dx * t - x, ay + dy * t - y));
    }
    return best;
  }
  const WSX = 768 / CW, WSY = 480 / CH;
  function clickWorld(raw) {
    const p = { lx: raw.lx * WSX, ly: raw.ly * WSY };
    const inc = S().incident;
    const hits = [];
    const cp = caravanPos();
    if (cp) hits.push(['caravan', Math.hypot(cp[0] - p.lx, cp[1] - p.ly)]);
    if (inc && inc.kind === 'caravan' && (inc.stage === 'setback' || inc.stage === 'travel')) {
      const [bx, by] = blockagePos();
      hits.push(['blockage', Math.hypot(bx - p.lx, by - p.ly)]);
    }
    hits.push(['camp', Math.hypot(WN.X[0] - p.lx, WN.X[1] - p.ly)]);
    hits.push(['millbrook', Math.hypot(WN.MB[0] - p.lx, WN.MB[1] - p.ly)]);
    const tp = tradePos();
    if (tp) hits.push(['trade', Math.hypot(tp[0] - p.lx, tp[1] - p.ly) - 2]);
    hits.push(['colony', Math.hypot(WN.C[0] - p.lx, WN.C[1] - p.ly)]);
    hits.push(['pass', distToRoute(M.ROUTES.pass, p.lx, p.ly) + 6]);
    hits.push(['road', distToRoute(M.ROUTES.road, p.lx, p.ly) + 8]);
    hits.sort((a, b) => a[1] - b[1]);
    if (hits[0][1] < 22) select({ kind: 'world', what: hits[0][0] });
    else select(null);
  }

  let worldBg = null;
  function buildWorldBg() {
    const c = document.createElement('canvas');
    c.width = 768;
    c.height = 480;
    const g = c.getContext('2d');
    for (let y = 0; y < 480; y += 8) for (let x = 0; x < 768; x += 8) R(g, x, y, 8, 8, ((x + y) / 8) % 2 ? '#7aa257' : '#82ab5e');
    for (let y = 0; y < 480; y += 4) for (let x = 0; x < 768; x += 4) if (hash(x, y, 5) < 0.05) R(g, x, y, 2, 2, '#6c9449');
    const river = (y) => 404 + Math.sin(y / 60) * 18;
    for (let y = 0; y < 480; y += 2) { const x = river(y); R(g, x - 6, y, 12, 2, '#3a75ad'); R(g, x - 7, y, 1, 2, '#d7c38a'); R(g, x + 6, y, 1, 2, '#d7c38a'); if (hash(0, y, 8) < 0.2) R(g, x - 2, y, 3, 1, '#6ea3d6'); }
    const mountain = (mx, my, s) => {
      for (let i = 0; i < s; i += 2) {
        const w = Math.max(2, i * 2);
        R(g, mx - w / 2, my - s + i, w, 2, i < s * 0.25 ? '#f4f1ea' : '#8d8a84');
        R(g, mx - w / 2, my - s + i, 2, 2, INK);
        R(g, mx + w / 2 - 2, my - s + i, 2, 2, '#5f5c57');
      }
    };
    [[250, 150, 60], [320, 120, 50], [410, 100, 70], [540, 100, 56], [620, 130, 64], [700, 110, 48], [200, 100, 40], [470, 60, 40], [380, 60, 36], [660, 70, 40]].forEach(([x, y, s]) => mountain(x, y, s));
    const forest = (fx, fy) => { R(g, fx - 3, fy - 5, 7, 6, '#2e5e27'); R(g, fx - 2, fy - 6, 5, 2, '#3f7f33'); R(g, fx, fy + 1, 1, 2, '#4a3218'); };
    for (let n = 0; n < 160; n++) {
      const x = hash(n, 1, 11) * 768, y = 220 + hash(n, 2, 11) * 250;
      if (Math.abs(x - river(y)) < 18 || distToRoute(M.ROUTES.start.concat(['R3', 'X']), x, y) < 14) continue;
      forest(x, y);
    }
    // bridge where the road crosses the river
    const by = 326, bx = river(by);
    R(g, bx - 10, by - 4, 20, 8, INK); R(g, bx - 9, by - 3, 18, 6, '#8a5a2b');
    worldBg = c;
  }

  function dotted(g, nodes, color, step, size) {
    for (let i = 0; i < nodes.length - 1; i++) {
      const a = WN[nodes[i]], b = WN[nodes[i + 1]];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let d = 0; d < len; d += step) { const [x, y] = lerp(a, b, d / len); R(g, Math.round(x) - size / 2, Math.round(y) - size / 2, size, size, color); }
    }
  }

  function drawWorld(now) {
    ctx.save();
    ctx.scale(1 / WSX, 1 / WSY);
    try { drawWorldScaled(now); } finally { ctx.restore(); }
  }
  function drawWorldScaled(now) {
    const s = S(), g = ctx, inc = s.incident, cv = s.caravan;
    if (!worldBg) buildWorldBg();
    g.drawImage(worldBg, 0, 0);
    const blockedNow = cv && cv.status === 'blocked';
    const passSel = ui.sel && ui.sel.kind === 'world' && ui.sel.what === 'pass';
    if (blockedNow || passSel) dotted(g, M.ROUTES.pass, 'rgba(255,240,180,.55)', 5, 6);
    dotted(g, M.ROUTES.start.concat(['R3', 'X']), '#5a3c1e', 7, 4);
    dotted(g, ['R1', 'MB'], '#5a3c1e', 7, 4);
    {
      const [mx, my] = WN.MB;
      for (const [ox, oy] of [[-16, 0], [0, -6], [14, 2]]) {
        R(g, mx + ox - 8, my + oy - 6, 16, 12, INK); R(g, mx + ox - 7, my + oy - 3, 14, 8, '#c9b48a'); R(g, mx + ox - 9, my + oy - 9, 18, 5, INK); R(g, mx + ox - 8, my + oy - 8, 16, 3, '#6b4a2b'); R(g, mx + ox - 1, my + oy + 1, 3, 4, '#4a2e17');
      }
      const gw = s.world ? s.world.goodwill : 0;
      R(g, mx - 20, my + 14, 42, 6, INK); R(g, mx - 19, my + 15, Math.round(40 * (gw + 100) / 200), 4, gw >= 25 ? '#6fe07a' : gw >= 0 ? '#e0b64a' : '#d8323c');
    }
    const tpos = tradePos();
    if (tpos) {
      const [px, py] = tpos.map(Math.round);
      R(g, px - 7, py - 5, 14, 9, INK); R(g, px - 6, py - 4, 12, 5, '#c9a55a'); R(g, px - 5, py + 3, 3, 3, INK); R(g, px + 2, py + 3, 3, 3, INK);
    }
    dotted(g, M.ROUTES.pass, '#efeadf', 7, 3);
    // colony
    const [cx, cy] = WN.C;
    R(g, cx - 12, cy - 8, 24, 16, INK); R(g, cx - 11, cy - 4, 22, 11, '#9b968c'); R(g, cx - 13, cy - 12, 26, 6, INK); R(g, cx - 12, cy - 11, 24, 4, '#a63d2e'); R(g, cx - 2, cy + 1, 5, 6, '#4a2e17');
    // camp
    const [xx, xy] = WN.X;
    for (let i = 0; i < 12; i++) R(g, xx - i, xy - 12 + i, i * 2 + 1, 1, i === 11 ? INK : '#c9a55a');
    R(g, xx - 1, xy - 6, 3, 6, '#4a2e17');
    if (inc && inc.kind === 'caravan' && inc.stage !== 'returning') {
      R(g, xx + 14, xy - 8, 6, 9, INK); R(g, xx + 15, xy - 7, 4, 3, '#f0c39a'); R(g, xx + 15, xy - 4, 4, 4, inc.traveler.shirt);
      if (inc.deadlineT != null && inc.stage === 'setback') {
        const left = Math.max(0, (inc.deadlineT - s.t) / (inc.deadlineT - inc.startT));
        R(g, xx - 16, xy + 8, 34, 6, INK); R(g, xx - 15, xy + 9, 32 * left, 4, left > 0.3 ? '#4a9ad8' : '#d8323c');
      }
    }
    // blockage
    if (inc && inc.kind === 'caravan' && inc.stage === 'setback') {
      const [bx, by] = blockagePos();
      if (!inc.cleared) {
        if (inc.reportIn && inc.cause === 'tree') { R(g, bx - 10, by - 3, 20, 6, INK); R(g, bx - 9, by - 2, 18, 4, '#6b4a23'); R(g, bx + 5, by - 7, 6, 6, '#2e5e27'); }
        else if (inc.reportIn) { for (const [ox, oy, sz] of [[-8, 0, 7], [-1, -4, 8], [5, 1, 6]]) { R(g, bx + ox, by + oy - sz / 2, sz, sz, INK); R(g, bx + ox + 1, by + oy - sz / 2 + 1, sz - 2, sz - 2, '#8d8a84'); } }
        else { R(g, bx - 7, by - 7, 14, 14, INK); R(g, bx - 6, by - 6, 12, 12, '#d8c048'); g.fillStyle = INK; g.font = 'bold 11px monospace'; g.fillText('?', bx - 3, by + 4); }
        if (!inc.reportIn && cv && cv.status === 'blocked') {
          const f = (Math.sin(now / 400) + 1) / 2;
          const [sx, sy] = lerp(WN.R2, blockagePos(), 0.3 + 0.6 * f);
          R(g, sx - 2, sy - 6, 5, 7, INK); R(g, sx - 1, sy - 5, 3, 2, '#f0c39a');
        }
      }
    }
    // caravan
    const cp = caravanPos();
    if (cp) {
      const [px, py] = cp.map(Math.round);
      const bob = cv.status === 'outbound' || cv.status === 'returning' ? Math.round(Math.sin(now / 120)) : 0;
      R(g, px - 9, py - 7 + bob, 18, 10, INK); R(g, px - 8, py - 6 + bob, 16, 6, '#e8dcc0'); R(g, px - 8, py - 1 + bob, 16, 2, '#8a5a2b');
      R(g, px - 7, py + 3, 4, 4, INK); R(g, px + 3, py + 3, 4, 4, INK);
      cv.members.forEach((id, n) => {
        const c = s.colonists.find((o) => o.id === id);
        if (c) { R(g, px - 6 + n * 7, py - 11 + bob, 5, 5, INK); R(g, px - 5 + n * 7, py - 10 + bob, 3, 3, c.shirt); }
      });
      if (cv.status === 'clearing') {
        const f = Math.min(1, cv.clear / M.CLEAR_HOURS);
        R(g, px - 10, py - 16, 20, 4, INK); R(g, px - 9, py - 15, 18 * f, 2, '#6fe07a');
      }
      if (cv.status === 'blocked') { R(g, px + 8, py - 18, 7, 9, INK); R(g, px + 9, py - 17, 5, 7, '#ffd23d'); R(g, px + 11, py - 16, 1, 3, INK); R(g, px + 11, py - 12, 1, 1, INK); }
    }
    g.fillStyle = INK;
    g.font = '10px sans-serif';
    const label = (t, x, y) => { g.fillStyle = 'rgba(255,254,250,.85)'; const w = g.measureText(t).width; g.fillRect(x - 2, y - 9, w + 4, 12); g.fillStyle = INK; g.fillText(t, x, y); };
    label('Colony', cx - 16, cy + 22);
    label(inc && inc.kind === 'caravan' && inc.stage !== 'returning' ? `${inc.traveler.name}'s camp` : 'Eastern camp', xx - 26, xy + 26);
    label('Mountain pass', WN.P2[0] - 30, WN.P2[1] - 12);
    label('Old road', WN.R3[0] - 10, WN.R3[1] + 20);
    label(`${M.NEIGHBOR}`, WN.MB[0] - 24, WN.MB[1] + 32);
    if (ui.sel && ui.sel.kind === 'world') {
      const w = ui.sel.what;
      const pos = w === 'caravan' ? caravanPos() : w === 'blockage' ? blockagePos() : w === 'camp' ? WN.X : w === 'colony' ? WN.C : w === 'millbrook' ? WN.MB : w === 'trade' ? tradePos() : null;
      if (pos) brackets(g, pos[0] - 14, pos[1] - 14, 28, 28);
    }
  }

  // ---------- colony map drawing ----------
  function darkness(hr) {
    if (hr >= 7 && hr <= 18) return 0;
    if (hr > 18 && hr < 21) return ((hr - 18) / 3) * 0.55;
    if (hr >= 21 || hr < 5) return 0.55;
    return ((7 - hr) / 2) * 0.55;
  }
  function brackets(g, x, y, w, hh) {
    const c = '#ffd23d', L = 4;
    for (const [ax, ay, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + hh, 1, -1], [x + w, y + hh, -1, -1]]) {
      R(g, dx > 0 ? ax : ax - L, ay - (dy > 0 ? 0 : 1), L, 1, c);
      R(g, ax - (dx > 0 ? 0 : 1), dy > 0 ? ay : ay - L, 1, L, c);
    }
  }
  function bar(g, x, y, f, col) { R(g, x, y, 14, 3, INK); R(g, x + 1, y + 1, Math.round(12 * Math.max(0, Math.min(1, f))), 1, col); }

  function itemSprite(kind) {
    return kind === 'wood' ? SPR.logs() : kind === 'potato' ? SPR.potato() : kind === 'berries' ? SPR.berries() : kind === 'medicine' ? SPR.medicine() : kind === 'preserved' ? SPR.preserved() : SPR.meal();
  }

  function thingSprite(th, now) {
    const f = Math.floor(now / 250) % 2;
    switch (th.type) {
      case 'bed': return SPR.bed();
      case 'table': return SPR.table();
      case 'heater': return SPR.heater(th.lit ? 1 : 0, f);
      case 'stove': return SPR.stove(f, th.lit || th.bp ? 1 : 0);
      case 'campfire': return SPR.campfire(f, th.lit || th.bp ? 1 : 0);
      case 'bush': return SPR.bush(!!th.berries);
      case 'keeper': return SPR.keeper();
      case 'grave': return SPR.grave();
      case 'bench': return SPR.bench();
      case 'smoker': return SPR.smoker(th.lit ? 1 : 0);
      case 'windmill': return SPR.windmill(th.bp ? 0 : Math.floor(performance.now() / Math.max(80, 400 - 320 * (S().wind || 0))) % 2);
      case 'cooler': return SPR.cooler(th.powered ? 1 : 0);
      case 'eheater': return SPR.eheater(th.powered ? 1 : 0);
      case 'barricade': return SPR.barricade();
      case 'trap': return SPR.trap();
      default: return null;
    }
  }

  function drawThing(g, th, now) {
    const px = th.x * TS, py = th.y * TS;
    if (th.bp) g.globalAlpha = 0.45;
    if (th.type === 'wall') drawWall(g, px, py, th.x, th.y);
    else if (th.type === 'door') drawDoor(g, px, py);
    else if (th.type === 'tree') {
      const gr = th.growth == null ? 1 : th.growth;
      if (gr >= 0.5) g.drawImage(SPR.tree(th.variant || 0), px, py - 6);
      else g.drawImage(SPR.tree(th.variant || 0), px + 4, py + 4 - 3, 8, 11);
    }
    else { const sp = thingSprite(th, now); if (sp) g.drawImage(sp, px, py); }
    g.globalAlpha = 1;
    if (th.bp) {
      g.fillStyle = 'rgba(90,160,255,.28)';
      g.fillRect(px, py, TS, TS);
      R(g, px, py, TS, 1, '#8cc4ff'); R(g, px, py + 15, TS, 1, '#8cc4ff'); R(g, px, py, 1, TS, '#8cc4ff'); R(g, px + 15, py, 1, TS, '#8cc4ff');
    }
  }

  function drawOverlays(g, th, now) {
    const px = th.x * TS, py = th.y * TS;
    if (th.bp && th.progress > 0) bar(g, px + 1, py - 4, th.progress / M.DEFS[th.type].work, '#8cc4ff');
    if (th.des === 'chop') g.drawImage(SPR.axe(), px, py - 6);
    if (th.des === 'harvest') g.drawImage(SPR.pick(), px, py - 2);
    if (th.type === 'tree' && th.progress > 0) bar(g, px + 1, py - 9, th.progress / 1.2, '#e0b64a');
    const fd = M.DEFS[th.type];
    if (fd.fuelCap && !th.bp) {
      const f = th.fuel / fd.fuelCap;
      if (f < 0.5) bar(g, px + 1, py + 14, f, f < 0.2 ? '#d8323c' : '#e0b64a');
    }
    if (th.type === 'heater' && th.broken) {
      for (let k = 0; k < 3; k++) {
        const ph = ((now / 1400) + k / 3) % 1;
        const sx = px + 7 + Math.sin(ph * 6 + k) * 3, sy = py + 1 - ph * 14;
        g.fillStyle = `rgba(90,90,90,${0.7 * (1 - ph)})`;
        g.fillRect(Math.round(sx), Math.round(sy), 3, 3);
      }
      const badge = th.repairOrdered ? '#6fe07a' : th.diagnosis ? '#ffd23d' : '#d8323c';
      R(g, px + 11, py - 8, 7, 8, INK); R(g, px + 12, py - 7, 5, 6, badge); R(g, px + 14, py - 6, 1, 2, INK); R(g, px + 14, py - 3, 1, 1, INK);
      if (th.repairOrdered && th.repairProgress > 0) bar(g, px + 1, py - 12, th.repairProgress / M.HEATER_CAUSES[th.diagnosis].work, '#6fe07a');
    }
  }

  function jobProgress(c) {
    const j = c.job;
    if (!j || j.stage !== 'work') return null;
    const th = j.targetId != null ? q.byId(j.targetId) : null;
    const inc = S().incident;
    switch (j.kind) {
      case 'build': return th && th.progress != null ? th.progress / M.DEFS[th.type].work : null;
      case 'repair': return th && th.diagnosis ? (th.repairProgress || 0) / M.HEATER_CAUSES[th.diagnosis].work : null;
      case 'chop': return th ? (th.progress || 0) / 1.2 : null;
      case 'pick': return th ? (th.progress || 0) / 0.6 : null;
      case 'sow': return j.work / 0.3;
      case 'harvestCrop': return j.work / 0.4;
      case 'cook': return j.work / 0.6;
      case 'inspect': return inc && inc.reportT ? (S().t - inc.startT) / (inc.reportT - inc.startT) : null;
      default: return null;
    }
  }

  function drawLying(g, look, px, py) {
    g.save();
    g.translate(px + 15, py + 5);
    g.rotate(Math.PI / 2);
    g.drawImage(colonistSprite(look, 0, false, false), 0, 0);
    g.restore();
  }
  function drawColonist(g, c, now) {
    const px = Math.round(c.x * TS), py = Math.round(c.y * TS);
    if (c.downed) {
      const onBed = q.thingAt(Math.round(c.x), Math.round(c.y));
      if (onBed && onBed.type === 'bed' && !c.carriedBy) g.drawImage(colonistSprite(c, 0, false, true), px + 3, py);
      else drawLying(g, c, px, c.carriedBy ? py - 8 : py + 2);
      if (c.injuries.some((i) => !i.tended && i.bleed > 0)) { R(g, px + 12, py - 2, 3, 4, INK); R(g, px + 13, py - 1, 1, 2, '#d8323c'); }
      return;
    }
    const bedHere = c.sleeping && q.thingAt(Math.round(c.x), Math.round(c.y));
    if (c.sleeping && bedHere && bedHere.type === 'bed') {
      g.drawImage(colonistSprite(c, 0, false, true), px + 3, py);
      const ph = (now / 1600) % 1;
      g.fillStyle = `rgba(255,255,255,${1 - ph})`;
      g.font = 'bold 7px monospace';
      g.fillText('z', px + 12 + ph * 3, py + 2 - ph * 8);
      return;
    }
    const moving = c.job && c.job.stage === 'walk' && c.path.length;
    const frame = moving ? Math.floor(now / 160) % 2 : 0;
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(px + 3, py + 14, 10, 2);
    g.drawImage(colonistSprite(c, frame, c.facing < 0, false), px + 3, py + 1 - (moving && frame ? 1 : 0));
    if (c.carry) g.drawImage(itemSprite(c.carry.kind), px + 4, py - 5, 9, 9);
    const prog = jobProgress(c);
    if (prog != null) bar(g, px + 1, py - 4, prog, '#ffd23d');
    if (c.cold > 0.15) { const bx = px + 13, by = py - 1; R(g, bx, by + 1, 5, 1, '#bfe3ff'); R(g, bx + 2, by - 1, 1, 5, '#bfe3ff'); }
    if (c.drafted) { R(g, px + 1, py - 1, 4, 6, INK); R(g, px + 2, py, 2, 4, '#d8323c'); }
    if (c.injuries && c.injuries.some((i) => !i.tended && i.bleed > 0)) { R(g, px + 12, py + 4, 3, 4, INK); R(g, px + 13, py + 5, 1, 2, '#d8323c'); }
  }
  function drawRaider(g, r, now) {
    const px = Math.round(r.x * TS), py = Math.round(r.y * TS);
    const moving = r.path && r.path.length;
    const frame = moving ? Math.floor(now / 160) % 2 : 0;
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.fillRect(px + 3, py + 14, 10, 2);
    g.drawImage(colonistSprite(RAIDER_LOOK, frame, (r.facing || -1) < 0, false), px + 3, py + 1);
    if (r.hp < 1) bar(g, px + 1, py - 4, r.hp, '#d8323c');
    if (r.carry) g.drawImage(itemSprite(r.carry.kind), px + 4, py - 9, 9, 9);
  }

  function drawMap(now) {
    const s = S(), g = ctx;
    if (!terrainCanvas || terrainVersion !== (s.terrainVersion || 0)) { terrainVersion = s.terrainVersion || 0; buildTerrain(); }
    g.drawImage(terrainCanvas, 0, 0);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (s.terrain[y * W + x] !== M.T.WATER) continue;
      const k = hash(x, y, 1);
      const sx = Math.floor((k * 16 + now / 400) % 14);
      R(g, x * TS + sx, y * TS + 3 + Math.floor(k * 9), 3, 1, '#6ea3d6');
    }
    for (const [k, p] of Object.entries(s.zones.grow)) {
      const i = Number(k), px = (i % W) * TS, py = ((i / W) | 0) * TS;
      g.drawImage(SPR.soil(), px, py);
      const st = p.growth >= 1 ? 3 : p.growth > 0.6 ? 2 : p.growth > 0.25 ? 1 : 0;
      if (p.sown) g.drawImage(p.crop === 'healroot' ? SPR.healroot(st) : SPR.crop(st), px, py);
      else if (p.crop === 'healroot') R(g, px + 7, py + 7, 2, 2, '#8fe0b0');
    }
    for (const i of s.zones.stock) g.drawImage(SPR.stockTile(), (i % W) * TS, ((i / W) | 0) * TS);
    g.font = 'bold 6px sans-serif';
    for (const it of s.items) {
      const px = it.x * TS, py = it.y * TS;
      g.drawImage(itemSprite(it.kind), px, py);
      const label = String(it.n);
      g.fillStyle = 'rgba(23,21,18,.85)';
      g.fillRect(px + 15 - label.length * 4, py + 10, label.length * 4 + 1, 6);
      g.fillStyle = '#fffefa';
      g.fillText(label, px + 16 - label.length * 4, py + 15);
    }

    const drawables = [];
    for (const th of s.things) drawables.push([th.y + (th.type === 'tree' ? 0.2 : 0), 0, th]);
    for (const c of s.colonists) if (!c.away) drawables.push([c.y + (c.carriedBy ? 0.2 : 0.1), 1, c]);
    for (const r of s.raiders || []) drawables.push([r.y + 0.1, 2, r]);
    drawables.sort((a, b) => a[0] - b[0]);
    for (const [, kind, obj] of drawables) {
      if (kind === 0) drawThing(g, obj, now);
      else if (kind === 1) drawColonist(g, obj, now);
      else drawRaider(g, obj, now);
    }
    const ff = Math.floor(now / 180) % 2;
    for (const k of Object.keys(s.fires || {})) {
      const i = Number(k), f = s.fires[k];
      g.globalAlpha = Math.min(1, 0.5 + f.i / 2);
      g.drawImage(SPR.fire((ff + i) % 2), (i % W) * TS, ((i / W) | 0) * TS);
      g.globalAlpha = 1;
    }
    for (const sh of s.shots || []) {
      g.strokeStyle = sh.hit ? '#ffd23d' : 'rgba(255,255,255,.6)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(sh.x0 * TS + 8, sh.y0 * TS + 6);
      g.lineTo(sh.x1 * TS + 8, sh.y1 * TS + 6);
      g.stroke();
    }

    // frost on cold rooms
    for (const r of q.rooms()) {
      if (r.outdoors || r.temp >= 15) continue;
      const a = Math.min(0.5, (15 - r.temp) / 30);
      g.fillStyle = `rgba(200,232,255,${a})`;
      for (const i of r.tiles) g.fillRect((i % W) * TS, ((i / W) | 0) * TS, TS, TS);
      if (r.temp < 0) for (const i of r.tiles) {
        const x = i % W, y = (i / W) | 0;
        if (hash(x, y, 21) < 0.5) R(g, x * TS + Math.floor(hash(x, y, 22) * 14), y * TS + Math.floor(hash(x, y, 23) * 14), 2, 1, '#ffffff');
      }
    }

    const dark = darkness(s.t % 24);
    if (dark > 0) {
      g.fillStyle = `rgba(12,20,52,${dark})`;
      g.fillRect(0, 0, CW, CH);
      g.globalCompositeOperation = 'lighter';
      for (const th of s.things) {
        const hot = th.lit && !th.bp;
        if (!hot) continue;
        const cx = th.x * TS + 8, cy = th.y * TS + 8;
        const grd = g.createRadialGradient(cx, cy, 2, cx, cy, 56);
        grd.addColorStop(0, `rgba(255,170,80,${dark * 0.75})`);
        grd.addColorStop(1, 'rgba(255,170,80,0)');
        g.fillStyle = grd;
        g.fillRect(cx - 56, cy - 56, 112, 112);
      }
      g.globalCompositeOperation = 'source-over';
    }

    for (const th of s.things) drawOverlays(g, th, now);
    g.font = '7px sans-serif';
    g.textAlign = 'center';
    for (const c of s.colonists) {
      if (c.away) continue;
      const x = Math.round(c.x * TS) + 8, y = Math.round(c.y * TS) + 23;
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(23,21,18,.85)';
      g.strokeText(c.name, x, y);
      g.fillStyle = '#fffefa';
      g.fillText(c.name, x, y);
    }
    g.font = '7px sans-serif';
    for (const b of s.chatter || []) {
      const c = s.colonists.find((o) => o.id === b.cid);
      if (!c || c.away) continue;
      const w = Math.ceil(g.measureText(b.text).width) + 8;
      let x = Math.round(c.x * TS) + 8 - w / 2;
      x = Math.max(1, Math.min(CW - w - 1, x));
      const y = Math.max(1, Math.round(c.y * TS) - 17);
      R(g, x - 1, y - 1, w + 2, 12, INK);
      R(g, x, y, w, 10, '#fffefa');
      R(g, Math.round(c.x * TS) + 7, y + 10, 2, 2, INK);
      g.fillStyle = INK;
      g.fillText(b.text, x + w / 2, y + 8);
    }
    g.textAlign = 'start';

    if (ui.hover && ui.tool) {
      const { x, y } = ui.hover;
      if (M.BUILDABLE.includes(ui.tool.kind)) {
        const okHere = q.canBuild(ui.tool.kind, x, y);
        g.globalAlpha = 0.6;
        if (ui.tool.kind === 'wall') drawWall(g, x * TS, y * TS, x, y);
        else if (ui.tool.kind === 'door') drawDoor(g, x * TS, y * TS);
        else g.drawImage(spriteFor(ui.tool.kind), x * TS, y * TS);
        g.globalAlpha = 1;
        g.fillStyle = okHere ? 'rgba(111,224,122,.3)' : 'rgba(216,50,60,.35)';
        g.fillRect(x * TS, y * TS, TS, TS);
      }
    }
    if (ui.drag && ui.tool && !M.BUILDABLE.includes(ui.tool.kind)) {
      const d = ui.drag;
      const x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), x1 = Math.max(d.x0, d.x1), y1 = Math.max(d.y0, d.y1);
      g.fillStyle = ui.tool.kind === 'cancel' || ui.tool.kind === 'clearzone' ? 'rgba(216,50,60,.2)' : 'rgba(255,214,110,.22)';
      g.fillRect(x0 * TS, y0 * TS, (x1 - x0 + 1) * TS, (y1 - y0 + 1) * TS);
      g.strokeStyle = '#ffd23d';
      g.lineWidth = 1;
      g.strokeRect(x0 * TS + 0.5, y0 * TS + 0.5, (x1 - x0 + 1) * TS - 1, (y1 - y0 + 1) * TS - 1);
    }
    if (ui.moveMark && ui.moveMark.until > performance.now()) brackets(g, ui.moveMark.x * TS + 3, ui.moveMark.y * TS + 3, 10, 10);
    const sel = ui.sel;
    if (sel && sel.kind === 'raider') {
      const r = (s.raiders || []).find((o) => o.id === sel.id);
      if (r) brackets(g, Math.round(r.x * TS), Math.round(r.y * TS), TS, TS);
    }
    if (sel && sel.kind === 'colonist') {
      const c = s.colonists.find((o) => o.id === sel.id);
      if (c && !c.away) brackets(g, Math.round(c.x * TS), Math.round(c.y * TS), TS, TS);
    } else if (sel && sel.kind === 'thing') {
      const th = q.byId(sel.id);
      if (th) brackets(g, th.x * TS, th.y * TS, TS, TS);
    } else if (sel && sel.kind === 'tile') brackets(g, sel.x * TS, sel.y * TS, TS, TS);
  }

  function draw(now) {
    if (ui.view === 'map') drawMap(now);
    else drawWorld(now);
  }

  // ---------- HUD ----------
  let lastBarSig = '', lastLetterSig = '', lastInspectSig = '', inspectLive = null;

  function activity(c) {
    if (c.away && S().trade && S().trade.members.includes(c.id)) return `Trading at ${M.NEIGHBOR}`;
    if (c.away) {
      const cv = S().caravan;
      return cv && cv.status === 'blocked' ? 'With the caravan, waiting at the blockage' : cv && cv.status === 'returning' ? 'With the caravan, heading home' : 'With the caravan';
    }
    const j = c.job;
    if (c.downed) return c.carriedBy ? 'Down, being carried' : 'Down, cannot move';
    if (!j) return 'Idle';
    const th = j.targetId != null ? q.byId(j.targetId) : null;
    const going = j.stage === 'walk' ? 'Going to ' : '';
    const fetching = j.stage === 'fetch';
    switch (j.kind) {
      case 'deliver': return fetching ? `Fetching wood for a ${th ? M.DEFS[th.type].label.toLowerCase() : 'building'}` : `Carrying wood to a ${th ? M.DEFS[th.type].label.toLowerCase() : 'building'}`;
      case 'deliverRepair': return fetching ? 'Fetching wood for the heater repair' : 'Carrying wood to the heater';
      case 'refuel': return fetching ? `Fetching wood for the ${th ? M.DEFS[th.type].label.toLowerCase() : 'fire'}` : `Refueling the ${th ? M.DEFS[th.type].label.toLowerCase() : 'fire'}`;
      case 'haul': return fetching ? 'Going to pick up goods' : 'Hauling to the stockpile';
      case 'cook': return fetching ? 'Fetching food to cook' : j.stage === 'walk' ? 'Going to cook' : 'Cooking';
      case 'sow': return j.stage === 'walk' ? 'Going to plant' : 'Planting potatoes';
      case 'harvestCrop': return j.stage === 'walk' ? 'Going to harvest' : 'Harvesting potatoes';
      case 'pick': return j.stage === 'walk' ? 'Going to pick berries' : 'Picking berries';
      case 'sleep': return c.sleeping ? 'Sleeping' : 'Going to bed';
      case 'sulk': return 'Sulking, refusing to work';
      case 'eat': return j.stage === 'work' ? 'Eating' : 'Going to eat';
      case 'build': return `${going ? 'Going to build' : 'Building'} ${th ? M.DEFS[th.type].label.toLowerCase() : ''}`.trim();
      case 'repair': return j.stage === 'walk' ? 'Going to repair the heater' : 'Repairing the heater';
      case 'chop': return j.stage === 'walk' ? 'Going to chop a tree' : 'Chopping a tree';
      case 'harvest': return j.stage === 'walk' ? 'Going to pick berries' : 'Picking berries';
      case 'inspect': return j.stage === 'walk' ? 'Going to inspect the heater' : 'Inspecting the heater';
      case 'drafted': return j.stage === 'walk' ? 'Drafted, moving' : 'Drafted, holding position';
      case 'study': return j.stage === 'walk' ? 'Going to the research bench' : `Researching ${S().research.active ? M.RESEARCH[S().research.active].label.toLowerCase() : ''}`;
      case 'smoke': return fetching ? 'Fetching food to smoke' : j.stage === 'walk' ? 'Going to the smokehouse' : 'Smoking food';
      case 'flee': return 'Fleeing indoors';
      case 'warmup': return j.stage === 'walk' ? 'Going to warm up' : 'Warming up by the fire';
      case 'feed': { const pt = S().colonists.find((o) => o.id === j.patientId); return j.stage === 'fetch' ? 'Fetching food for someone who is down' : `Feeding ${pt ? pt.name : 'a patient'}`; }
      case 'hide': return 'Hiding from raiders';
      case 'firefight': return 'Fighting a fire';
      case 'bedrest': return 'Resting in bed with wounds';
      case 'rescue': { const pt = S().colonists.find((o) => o.id === j.patientId); return j.carrying ? `Carrying ${pt ? pt.name : 'someone'} to bed` : `Going to rescue ${pt ? pt.name : 'someone'}`; }
      case 'tend': { const pt = S().colonists.find((o) => o.id === j.patientId); return j.stage === 'fetch' ? 'Fetching medicine' : `Tending ${pt ? (pt === c ? 'their own wounds' : pt.name) : 'a patient'}`; }
      default: return 'Wandering';
    }
  }

  function updateBar() {
    const s = S();
    const moodClass = (c) => (c.breakUntil > s.t ? 'sulk' : c.mood < 25 ? 'low' : c.mood < 45 ? 'mid' : 'ok');
    const sig = s.colonists.map((c) => `${c.id}${c.away}${c.sleeping}${c.cold > 0.15}${moodClass(c)}${ui.sel && ui.sel.kind === 'colonist' && ui.sel.id === c.id}`).join('|');
    if (sig === lastBarSig) return;
    lastBarSig = sig;
    el.bar.replaceChildren(...s.colonists.map((c) => {
      const pic = document.createElement('canvas');
      pic.width = 10;
      pic.height = 14;
      pic.getContext('2d').drawImage(colonistSprite(c, 0, false, false), 0, 0);
      pic.className = 'mm-portrait';
      const on = ui.sel && ui.sel.kind === 'colonist' && ui.sel.id === c.id;
      return h('button', {
        type: 'button', class: `mm-col${on ? ' is-on' : ''}${c.away ? ' is-away' : ''}`,
        on: { click: () => { if (c.away) setView('world'); else setView('map'); select({ kind: 'colonist', id: c.id }); } },
      }, pic, h('i', { class: `mm-mood is-${moodClass(c)}`, title: `Mood ${Math.round(c.mood)}` }), h('span', null, c.name),
      c.breakUntil > s.t ? h('small', { class: 'is-cold' }, 'sulking') : c.away ? h('small', null, 'caravan') : c.sleeping ? h('small', null, 'asleep') : c.cold > 0.15 ? h('small', { class: 'is-cold' }, 'cold') : null);
    }));
  }

  function updateLetters() {
    const s = S();
    const sig = s.letters.map((l) => `${l.id}${l.read}${!!l.actions}`).join('|');
    if (sig === lastLetterSig) return;
    lastLetterSig = sig;
    el.letters.replaceChildren(...s.letters.slice().reverse().map((l) => h('button', {
      type: 'button', class: `mm-letter is-${l.kind}${l.read ? '' : ' is-new'}`, on: { click: () => openLetter(l.id) },
    }, l.title)));
  }

  function updateTop() {
    const s = S();
    el.clock.textContent = clock(s.t);
    const out = q.outdoorTemp();
    el.weather.textContent = `${s.weather.label ? `${s.weather.label} · ` : ''}${Math.round(out)}°C outside`;
    el.weather.classList.toggle('is-cold', out < 2);
    const cnt = q.counts();
    el.wood.textContent = cnt.wood;
    el.food.textContent = cnt.potato + cnt.berries;
    el.meal.textContent = cnt.meal;
    el.med.textContent = cnt.medicine;
    el.pres.textContent = cnt.preserved;
    const pw = s.power;
    el.power.hidden = !pw || (!pw.supply && !pw.demand);
    if (pw) el.power.textContent = `⚡ ${pw.supply}/${pw.demand} · wind ${Math.round((s.wind || 0) * 100)}%`;
    el.power.classList.toggle('is-short', !!pw && pw.demand > pw.supply);
    renderToolRows();
    el.researchBtn.textContent = s.research.active ? `Research: ${M.RESEARCH[s.research.active].label} ${Math.round(((s.research.progress[s.research.active] || 0) / M.RESEARCH[s.research.active].hours) * 100)}%` : 'Research';
  }

  function hoverText() {
    if (!ui.hover || ui.view !== 'map') return '';
    const { x, y } = ui.hover;
    if (x < 0 || y < 0 || x >= W || y >= H) return '';
    const r = q.roomAt(x, y);
    const th = q.thingAt(x, y);
    const place = r && !r.outdoors ? `${q.roomName(r)} · ${Math.round(r.temp)}°C` : `Outdoors · ${Math.round(q.outdoorTemp())}°C`;
    const it = q.itemAt(x, y), crop = q.growAt(x, y);
    const what = th ? `${M.DEFS[th.type].label}${th.bp ? ' (planned)' : ''}`
      : it ? `${M.ITEMS[it.kind].label} ×${it.n}`
        : crop ? (crop.sown ? `Potatoes, ${Math.round(crop.growth * 100)}% grown` : 'Field, unplanted')
          : q.isStock(x, y) ? 'Stockpile' : null;
    return what ? `${what} — ${place}` : place;
  }

  // inspect pane: rebuilt only when its signature changes, live numbers refreshed in between
  function gizmo(label, onClick, disabledReason) {
    return h('button', { type: 'button', class: 'mm-btn mm-gizmo', disabled: !!disabledReason, title: disabledReason || null, on: { click: onClick } },
      label, disabledReason ? h('small', null, disabledReason) : null);
  }
  function needBar(label, v, col) {
    const fill = h('span', { style: `width:${Math.round(v * 100)}%;background:${col}` });
    return h('div', { class: 'mm-need' }, h('span', null, label), h('i', null, fill));
  }

  function fuelLine(th) {
    const d = M.DEFS[th.type];
    const f = th.fuel || 0;
    return h('p', { class: f < d.fuelCap * 0.2 ? 'mm-warn' : null }, `Fuel: ${f.toFixed(1)} of ${d.fuelCap} wood · burns 1 wood every ${d.burnH}h.`);
  }

  function inspectContent() {
    const s = S(), sel = ui.sel, inc = s.incident;
    if (!sel) return { sig: 'none', build: () => [h('p', { class: 'mm-muted' }, ui.view === 'map' ? 'Click a colonist or an object to inspect it.' : 'Click the caravan, the road, the pass, or the camp.')] };
    if (sel.kind === 'colonist') {
      const c = s.colonists.find((o) => o.id === sel.id);
      if (!c) return { sig: 'gone', build: () => [] };
      const ths = q.thoughts(c).sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
      return {
        sig: `c${c.id}${c.drafted}${c.downed}${c.carriedBy}${(c.injuries || []).map((i) => `${i.tended}${Math.round(i.sev * 20)}`).join()}${Math.round((c.blood || 1) * 20)}${Math.round(c.food * 20)}${Math.round(c.rest * 20)}${Math.round(q.health(c) * 20)}${Math.round(c.mood / 4)}${activity(c)}${ths.map((t) => t.key + t.value).join()}`,
        build: () => {
          const conds = [];
          if (c.cold > 0.05) conds.push(`Hypothermia ${Math.round(c.cold * 100)}%`);
          if (c.weak > 0.05) conds.push(`Weakened ${Math.round(c.weak * 100)}%`);
          const rels = q.relationsOf(c);
          return [h('h4', null, c.name), h('p', null, activity(c)),
            h('p', { class: 'mm-traits' }, (c.traits || []).map((k) => h('span', { class: 'mm-trait', title: M.TRAITS[k].desc }, M.TRAITS[k].label))),
            rels.length ? h('p', { class: 'mm-muted' }, rels.map((r) => `${M.REL_LABEL[r.kind]}: ${r.other.name}`).join(' · ')) : null,
            needBar(`Mood`, c.mood / 100, c.mood < 25 ? '#d8323c' : c.mood < 45 ? '#e0b64a' : '#6fe07a'),
            needBar('Food', c.food, '#e0b64a'), needBar('Rest', c.rest, '#6a9bd0'), needBar('Health', q.health(c), '#6fe07a'),
            conds.length ? h('p', { class: 'mm-warn' }, conds.join(' · ')) : null,
            (c.injuries || []).length ? h('ul', { class: 'mm-thoughts' }, c.injuries.map((i) => h('li', { class: 'is-neg' }, h('span', null, `${i.label}${i.tended ? (i.med ? ', tended with medicine' : ', tended') : i.bleed > 0 ? ', bleeding' : ''}`), h('b', null, `${Math.round(i.sev * 100)}%`)))) : null,
            c.blood < 0.95 ? needBar('Blood', c.blood, '#d8323c') : null,
            h('div', { class: 'mm-gizmos' },
              c.downed ? gizmo('Rescue now', () => { const r = order({ type: 'rescue', id: c.id }); if (r.ok) toast(`${r.rescuer} is going`); }, c.carriedBy ? 'Already being carried' : null)
                : c.away ? null
                  : [gizmo(c.drafted ? 'Release' : 'Draft', () => order({ type: 'draft', id: c.id, on: !c.drafted })),
                    c.drafted ? gizmo('Move…', () => setTool({ kind: 'move', id: c.id })) : null]),
            ths.length ? h('ul', { class: 'mm-thoughts' }, ths.slice(0, 6).map((t) => h('li', { class: t.value < 0 ? 'is-neg' : 'is-pos' }, h('span', null, t.label), h('b', null, `${t.value > 0 ? '+' : ''}${t.value}`)))) : null];
        },
      };
    }
    if (sel.kind === 'tile') {
      const it = q.itemAt(sel.x, sel.y), crop = q.growAt(sel.x, sel.y), r = q.roomAt(sel.x, sel.y);
      const place = r && !r.outdoors ? `${q.roomName(r)} · ${Math.round(r.temp)}°C` : `Outdoors · ${Math.round(q.outdoorTemp())}°C`;
      return {
        sig: `t${sel.x},${sel.y}${it ? it.kind + it.n + Math.round(it.age) : ''}${crop ? `${crop.sown}${Math.round(crop.growth * 20)}` : ''}${place}`,
        build: () => {
          const out = [];
          if (it) {
            const d = M.ITEMS[it.kind];
            out.push(h('h4', null, `${d.label} ×${it.n}`));
            if (d.spoil) {
              const f = q.spoilFactor(sel.x, sel.y);
              out.push(h('p', null, f === 0 ? 'Frozen: not spoiling.' : `Spoils in about ${((d.spoil - it.age) / f / 24).toFixed(1)} days here.`));
              out.push(h('p', { class: 'mm-muted' }, 'Food keeps longer indoors, and stops spoiling below freezing.'));
            }
            if (!q.isStock(sel.x, sel.y)) out.push(h('p', { class: 'mm-muted' }, 'Lying loose; a hauler will carry it to a stockpile.'));
          } else if (crop) {
            out.push(h('h4', null, 'Field'));
            out.push(h('p', null, !crop.sown ? 'Unplanted. Colonists plant potatoes here when it is above 4°C, outside winter.'
              : crop.growth >= 1 ? `Potatoes, ripe. Harvest gives 2 potatoes.`
                : `Potatoes, ${Math.round(crop.growth * 100)}% grown. They grow in warm daylight and die in hard frost (below −6°C).`));
          } else out.push(h('h4', null, q.isStock(sel.x, sel.y) ? 'Stockpile' : r && !r.outdoors ? q.roomName(r) : 'Ground'));
          out.push(h('p', { class: 'mm-muted' }, place));
          return out;
        },
      };
    }
    if (sel.kind === 'thing') {
      const th = q.byId(sel.id);
      if (!th) return { sig: 'gone', build: () => [h('p', { class: 'mm-muted' }, 'Gone.')] };
      const d = M.DEFS[th.type];
      const r = q.roomAt(th.x, th.y);
      const where = r && !r.outdoors ? `${q.roomName(r)} · ${Math.round(r.temp)}°C` : null;
      if (th.bp) {
        return { sig: `bp${th.id}${Math.round((th.progress || 0) * 10)}${th.delivered}`, build: () => [
          h('h4', null, `${d.label} (planned)`),
          h('p', null, `Wood delivered: ${th.delivered || 0} of ${d.cost}${(th.delivered || 0) < d.cost && q.counts().wood < d.cost - (th.delivered || 0) ? ' — not enough wood in the colony' : ''}. ${Math.round(((th.progress || 0) / d.work) * 100)}% built.`),
          where ? h('p', { class: 'mm-muted' }, where) : null,
          h('div', { class: 'mm-gizmos' }, gizmo('Cancel plan', () => order({ type: 'designate', mode: 'cancel', x0: th.x, y0: th.y, x1: th.x, y1: th.y }))),
        ] };
      }
      if (th.type === 'heater') {
        const heatingInc = inc && inc.kind === 'heating' && inc.heaterId === th.id ? inc : null;
        const who = heatingInc && s.colonists.find((c) => c.id === heatingInc.inspectorId);
        return {
          sig: `h${th.id}${th.broken}${th.diagnosis}${th.repairOrdered}${!!heatingInc}${Math.round((th.repairProgress || 0) * 10)}${where}${Math.round(th.fuel)}${th.lit}${th.repairDelivered}`,
          build: () => {
            const out = [h('h4', null, 'Heater'), where ? h('p', { class: 'mm-muted' }, where) : null];
            out.push(fuelLine(th));
            if (!th.broken) out.push(h('p', null, th.lit ? 'Burning. Keeps the room around 21°C.' : th.fuel > 0 ? 'Idle while it is warm outside.' : 'Out of fuel.'));
            else if (!th.diagnosis) {
              const live = h('span');
              inspectLive = () => { live.textContent = heatingInc ? fmtH(heatingInc.reportT - S().t) : '—'; };
              out.push(h('p', null, 'Broken. ', who ? `${who.name} is inspecting it; report in ` : 'Report in ', live, '.'));
              if (heatingInc && heatingInc.deadlineT != null) {
                const dl = h('span');
                const prev = inspectLive;
                inspectLive = () => { prev(); dl.textContent = fmtH(heatingInc.deadlineT - S().t); };
                out.push(h('p', { class: 'mm-warn' }, 'Freezing in about ', dl, '.'));
              }
            } else {
              out.push(h('p', null, M.HEATER_CAUSES[th.diagnosis].finding));
              if (heatingInc && heatingInc.deadlineT != null) {
                const dl = h('span');
                inspectLive = () => { dl.textContent = fmtH(heatingInc.deadlineT - S().t); };
                out.push(h('p', { class: 'mm-warn' }, 'Freezing in about ', dl, '.'));
              }
            }
            if (th.broken) {
              out.push(h('div', { class: 'mm-gizmos' }, th.repairOrdered
                ? gizmo('Cancel repair', () => order({ type: 'cancel-repair', id: th.id }))
                : gizmo('Repair', () => order({ type: 'repair', id: th.id }), th.diagnosis ? null : 'Waiting for the inspection')));
              if (th.repairOrdered) {
                const need = M.HEATER_CAUSES[th.diagnosis].wood;
                out.push(h('p', { class: 'mm-muted' }, `Repair ordered.${need ? ` Wood delivered: ${th.repairDelivered || 0} of ${need}.` : ''} ${Math.round(((th.repairProgress || 0) / M.HEATER_CAUSES[th.diagnosis].work) * 100)}% done.`));
              }
            }
            return out;
          },
        };
      }
      if (th.type === 'tree') return { sig: `tr${th.id}${th.des}${Math.round((th.growth == null ? 1 : th.growth) * 20)}`, build: () => [h('h4', null, (th.growth == null ? 1 : th.growth) < 0.5 ? 'Sapling' : 'Tree'), h('p', null, `Gives about ${Math.max(1, Math.round(10 * (th.growth == null ? 1 : th.growth)))} wood when chopped.${(th.growth == null ? 1 : th.growth) < 0.5 ? ' Too young to chop yet.' : (th.growth == null ? 1 : th.growth) < 1 ? ' Still growing.' : ''}`), h('div', { class: 'mm-gizmos' }, gizmo(th.des === 'chop' ? 'Don’t chop' : 'Chop', () => order({ type: 'designate', mode: th.des === 'chop' ? 'cancel' : 'chop', x0: th.x, y0: th.y, x1: th.x, y1: th.y })))] };
      if (th.type === 'bush') return { sig: `bu${th.id}${th.des}${th.berries}`, build: () => [h('h4', null, 'Berry bush'), h('p', null, th.berries ? 'Ripe. Gives 4 berries, which spoil within about two days.' : `Regrowing${q.outdoorTemp() <= 5 ? ' when it warms up' : `, ripe in ${fmtH(th.regrowAt - s.t)}`}.`), h('div', { class: 'mm-gizmos' }, gizmo(th.des === 'harvest' ? 'Stop picking' : 'Pick berries', () => order({ type: 'designate', mode: th.des === 'harvest' ? 'cancel' : 'harvest', x0: th.x, y0: th.y, x1: th.x, y1: th.y })))] };
      if (th.type === 'bench') return { sig: `be${th.id}${S().research.active}`, build: () => [h('h4', null, 'Research bench'), h('p', null, S().research.active ? `Working on ${M.RESEARCH[S().research.active].label}.` : 'No project chosen.'), h('div', { class: 'mm-gizmos' }, gizmo('Choose research', () => openModal('research')))] };
      if (th.type === 'windmill') return { sig: `wm${th.id}${Math.round((S().wind || 0) * 20)}`, build: () => [h('h4', null, 'Windmill'), h('p', null, `Wind ${Math.round((S().wind || 0) * 100)}%: producing ${Math.round(60 * (S().wind || 0))} of up to 60 power.`)] };
      if (th.type === 'cooler' || th.type === 'eheater') return { sig: `pw${th.id}${th.powered}${where}`, build: () => [h('h4', null, d.label), where ? h('p', { class: 'mm-muted' }, where) : null, h('p', { class: th.powered ? null : 'mm-warn' }, th.powered ? `Powered (${-d.power}).` : `No power: needs ${-d.power}.`), h('p', null, th.type === 'cooler' ? 'Freezes the room it stands in, so food there stops spoiling.' : 'Heats the room without burning wood while it has power.')] };
      if (th.type === 'smoker') return { sig: `sm${th.id}${Math.round(th.fuel || 0)}${th.lit}`, build: () => [h('h4', null, 'Smokehouse'), fuelLine(th), h('p', null, 'Cooks smoke 3 raw food into 3 preserved food, which keeps for a month. Burns wood only while smoking.')] };
      if (th.type === 'barricade') return { sig: `ba${th.id}`, build: () => [h('h4', null, 'Barricade'), h('p', null, 'Colonists next to it are much harder to hit.')] };
      if (th.type === 'trap') return { sig: `tp${th.id}`, build: () => [h('h4', null, 'Spike trap'), h('p', null, 'Badly wounds the first raider who steps on it.')] };
      if (th.type === 'grave') return { sig: `g${th.id}`, build: () => [h('h4', null, 'Grave'), h('p', null, `${th.name || 'A colonist'} is buried here.`)] };
      if (th.type === 'keeper') return { sig: 'keeper', build: () => [h('h4', null, 'The Archivist'), h('p', null, 'She has been watching how the colony handles trouble.'), h('div', { class: 'mm-gizmos' }, gizmo('Talk to her', () => openModal('reflect')))] };
      return { sig: `o${th.id}${where}${Math.round(th.fuel || 0)}${th.lit}`, build: () => [h('h4', null, d.label), where ? h('p', { class: 'mm-muted' }, where) : null,
        d.fuelCap ? fuelLine(th) : null,
        d.heat ? h('p', null, `${th.lit ? 'Burning' : th.fuel > 0 ? 'Idle while it is warm outside' : 'Out of fuel'}. Heats the room it stands in${d.always ? ', and burns all the time' : ' when it is cool outside'}.`) : null,
        d.cook ? h('p', null, 'Colonists cook meals here while it has fuel: 2 raw food make 1 meal.') : null] };
    }
    if (sel.kind === 'raider') {
      const r = (s.raiders || []).find((o) => o.id === sel.id);
      if (!r) return { sig: 'rgone', build: () => [h('p', { class: 'mm-muted' }, 'Gone.')] };
      return { sig: `r${r.id}${Math.round(r.hp * 10)}${r.state}${!!r.carry}`, build: () => [h('h4', null, 'Raider'), needBar('Health', Math.max(0, r.hp), '#d8323c'),
        h('p', null, r.state === 'flee' ? (r.carry ? `Running off with ${r.carry.n} ${M.ITEMS[r.carry.kind].label.toLowerCase()}.` : 'Retreating.') : 'Looking for supplies and shooting anyone in the open.')] };
    }
    if (sel.kind === 'world') return worldInspect(sel.what);
    return { sig: 'x', build: () => [] };
  }

  function worldInspect(what) {
    const s = S(), inc = s.incident && s.incident.kind === 'caravan' ? s.incident : null, cv = s.caravan;
    const names = cv ? cv.members.map((id) => (s.colonists.find((c) => c.id === id) || {}).name).join(' and ') : '';
    const decisionGizmos = () => {
      if (!inc || inc.stage !== 'setback' || !cv || cv.status !== 'blocked') return null;
      const clearReason = !inc.reportIn ? 'Waiting for the scout report' : !M.BLOCK_CAUSES[inc.cause].clearable ? 'A rockslide can’t be cleared quickly' : null;
      return h('div', { class: 'mm-gizmos' },
        gizmo('Take the mountain pass', () => order({ type: 'caravan-reroute' })),
        gizmo('Clear the road', () => order({ type: 'caravan-clear' }), clearReason));
    };
    const deadlineLine = () => {
      if (!inc || inc.deadlineT == null || inc.stage !== 'setback') return null;
      const dl = h('span');
      const prev = inspectLive;
      inspectLive = () => { if (prev) prev(); dl.textContent = fmtH(inc.deadlineT - S().t); };
      return h('p', { class: 'mm-warn' }, `${inc.traveler.name} has water for about `, dl, '.');
    };
    const sigBase = `w${what}${inc && inc.stage}${cv && cv.status}${inc && inc.reportIn}${inc && inc.cleared}`;
    switch (what) {
      case 'caravan':
        if (!cv) return { sig: `${sigBase}none`, build: () => [h('h4', null, 'No caravan out'), h('p', { class: 'mm-muted' }, 'Caravans leave when a traveler asks for help.')] };
        return { sig: sigBase, build: () => {
          inspectLive = null;
          const eta = h('span');
          const st = cv.status === 'blocked' ? 'Waiting at the blockage on the old road.'
            : cv.status === 'clearing' ? 'Clearing the fallen tree.'
              : cv.status === 'returning' ? 'Heading home.'
                : cv.route.includes('P1') ? 'Travelling over the mountain pass.' : 'Travelling along the old road.';
          const out = [h('h4', null, 'Caravan'), h('p', null, names), h('p', null, st)];
          if (cv.status === 'outbound' || cv.status === 'returning') {
            inspectLive = () => { eta.textContent = fmtH(etaHours()); };
            out.push(h('p', { class: 'mm-muted' }, cv.status === 'returning' ? 'Home in about ' : 'At the camp in about ', eta, '.'));
          }
          out.push(deadlineLine(), decisionGizmos());
          return out;
        } };
      case 'blockage':
        return { sig: sigBase, build: () => {
          inspectLive = null;
          const out = [h('h4', null, 'Blockage on the old road')];
          if (!inc || inc.stage === 'travel') out.push(h('p', { class: 'mm-muted' }, 'Nothing known yet.'));
          else if (!inc.reportIn) {
            const live = h('span');
            inspectLive = () => { live.textContent = fmtH(inc.reportT - S().t); };
            out.push(h('p', null, 'Unknown. The scout is looking; report in ', live, '.'));
          } else out.push(h('p', null, M.BLOCK_CAUSES[inc.cause].finding));
          out.push(h('p', { class: 'mm-muted' }, 'Past the blockage: about 2 hours to the camp.'), deadlineLine(), decisionGizmos());
          return out;
        } };
      case 'pass':
        return { sig: sigBase, build: () => [h('h4', null, 'Mountain pass'), h('p', null, 'Goes around the old road. About 5 hours from the blockage to the camp.'), deadlineLine(),
          inc && inc.stage === 'setback' && cv && cv.status === 'blocked' ? h('div', { class: 'mm-gizmos' }, gizmo('Send the caravan this way', () => order({ type: 'caravan-reroute' }))) : null] };
      case 'millbrook': {
        const gw = s.world.goodwill;
        const mood = gw >= 50 ? 'close allies' : gw >= 25 ? 'friendly' : gw >= 0 ? 'cautious' : gw >= -30 ? 'cold' : 'hostile';
        return { sig: `${sigBase}${gw}${!!s.trade}${!!s.caravan}`, build: () => [h('h4', null, M.NEIGHBOR),
          h('p', null, `A farming village to the south. They are ${mood} toward the colony (goodwill ${gw}).`),
          h('p', { class: 'mm-muted' }, `Trade rate ${Math.round(q.tradeRate() * 100)}%. ${gw >= 30 ? 'They warn you early about raiders.' : 'At goodwill 30 they would warn you early about raiders.'} ${gw >= 25 ? 'They help when you are short.' : ''}`),
          h('div', { class: 'mm-gizmos' }, gizmo('Send a trade caravan', () => openModal('trade', { picked: [], give: {}, want: 'medicine' }), s.trade || s.caravan ? 'A caravan is already out' : q.eligibleForCaravan().length < 1 ? 'Nobody healthy at home' : null)),
          h('button', { type: 'button', class: 'mm-btn mm-btn-s', on: { click: () => openModal('chronicle') } }, 'Read the chronicle')] };
      }
      case 'trade': {
        const tr = s.trade;
        if (!tr) return { sig: `${sigBase}none`, build: () => [h('h4', null, 'No trade caravan out')] };
        return { sig: `${sigBase}${tr.status}`, build: () => [h('h4', null, 'Trade caravan'),
          h('p', null, tr.members.map((id) => (s.colonists.find((c) => c.id === id) || {}).name).join(' and ')),
          h('p', null, tr.status === 'outbound' ? `Carrying ${Object.entries(tr.give).map(([k, n]) => `${n} ${M.ITEMS[k].label.toLowerCase()}`).join(', ')} to ${M.NEIGHBOR} to trade for ${M.ITEMS[tr.want].label.toLowerCase()}.` : `Coming home with ${tr.got} ${M.ITEMS[tr.want].label.toLowerCase()}.`)] };
      }
      case 'road':
        return { sig: sigBase, build: () => [h('h4', null, 'Old road'), h('p', null, 'The usual way east. About 3.5 hours from the colony to the camp.')] };
      case 'camp':
        return { sig: sigBase, build: () => [h('h4', null, inc && inc.stage !== 'returning' ? `${inc.traveler.name}'s camp` : 'Eastern camp'),
          h('p', null, inc && inc.stage !== 'returning' ? (inc.deadlineKind === 'urgent' ? `${inc.traveler.name} is stranded and short on water.` : `${inc.traveler.name} is safe and well supplied.`) : 'Nobody is waiting here.'), deadlineLine()] };
      default:
        return { sig: sigBase, build: () => [h('h4', null, 'Colony'), h('p', null, `${s.colonists.filter((c) => !c.away).length} colonists at home.`)] };
    }
  }

  function etaHours() {
    const cv = S().caravan;
    if (!cv) return 0;
    if (cv.status === 'returning') return M.RETURN_HOURS - cv.prog;
    let left = 0;
    for (let i = cv.seg; i < cv.route.length - 1; i++) left += q.segHours(cv.route[i], cv.route[i + 1]);
    left -= cv.prog;
    if (!cv.route.includes('X')) left += q.segHours('R2', 'R3') + q.segHours('R3', 'X');
    return left;
  }

  function updateInspect() {
    const c = inspectContent();
    if (c.sig !== lastInspectSig) {
      lastInspectSig = c.sig;
      inspectLive = null;
      el.inspect.replaceChildren(...c.build().filter(Boolean));
    }
    if (inspectLive) inspectLive();
    // selecting the heater or blockage while the report arrives still counts as reading it
    const sel = ui.sel, inc = S().incident;
    if (sel && inc && inc.reportIn) {
      if (sel.kind === 'thing' && sel.id === inc.heaterId) M.command({ type: 'inspect', target: { kind: 'thing', id: sel.id } });
      if (sel.kind === 'world' && sel.what === 'blockage') M.command({ type: 'inspect', target: { kind: 'world', what: 'blockage' } });
    }
  }

  function updateUI() {
    updateTop();
    updateBar();
    updateLetters();
    updateInspect();
    el.hover.textContent = hoverText();
    el.hover.hidden = !el.hover.textContent;
  }

  // ---------- modals ----------
  function openModal(kind, arg) {
    ui.modal = { kind, arg };
    renderModal();
  }
  function closeModal() {
    ui.modal = null;
    el.modal.hidden = true;
    el.modal.replaceChildren();
    lastInspectSig = '';
  }
  function modalFrame(title, ...body) {
    return h('div', { class: 'mm-dialog', role: 'dialog', 'aria-label': title },
      h('div', { class: 'mm-dialog-head' }, h('strong', null, title), h('button', { type: 'button', class: 'mm-btn mm-btn-s', 'aria-label': 'Close', on: { click: closeModal } }, '✕')),
      h('div', { class: 'mm-dialog-body' }, ...body));
  }
  function renderModal() {
    const m = ui.modal;
    if (!m) return closeModal();
    let node;
    if (m.kind === 'letter') node = letterModal(m.arg);
    else if (m.kind === 'work') node = workModal();
    else if (m.kind === 'reflect') node = reflectModal();
    else if (m.kind === 'evidence') node = evidenceModal();
    else if (m.kind === 'propose') node = proposeModal();
    else if (m.kind === 'menu') node = menuModal();
    else if (m.kind === 'caravan') node = caravanModal(m.arg);
    else if (m.kind === 'research') node = researchModal();
    else if (m.kind === 'trade') node = tradeModal(m.arg);
    else if (m.kind === 'chronicle') node = chronicleModal();
    el.modal.replaceChildren(node);
    el.modal.hidden = false;
  }

  function openLetter(id) {
    M.command({ type: 'read-letter', id });
    lastLetterSig = '';
    openModal('letter', id);
  }
  function letterModal(id) {
    const s = S();
    const l = s.letters.find((x) => x.id === id);
    if (!l) return modalFrame('Letter', h('p', null, 'This letter is gone.'));
    const actions = (l.actions || []).map((a) => {
      let label = a.label;
      if (a.cmd.type === 'caravan-send') {
        return h('button', { type: 'button', class: 'mm-btn mm-btn-primary', disabled: q.eligibleForCaravan().length < 2, on: { click: () => openModal('caravan', { letterId: l.id, picked: [] }) } }, 'Choose who goes');
      }
      return h('button', { type: 'button', class: 'mm-btn mm-btn-primary', on: { click: () => { const r = order(a.cmd); if (r.ok) closeModal(); } } }, label);
    });
    const jump = l.focus ? h('button', { type: 'button', class: 'mm-btn', on: { click: () => { closeModal(); focusOn(l.focus); } } }, l.focus.world ? 'Show on world map' : 'Show') : null;
    return modalFrame(l.title,
      h('p', { class: 'mm-letter-meta' }, clock(l.t)),
      ...l.body.split('\n\n').map((p) => h('p', { class: 'mm-letter-body' }, p)),
      h('div', { class: 'mm-actions' }, actions, jump,
        !l.actions ? h('button', { type: 'button', class: 'mm-btn', on: { click: () => { M.command({ type: 'dismiss-letter', id: l.id }); lastLetterSig = ''; closeModal(); } } }, 'Dismiss') : null));
  }
  function tradeModal(arg) {
    const s = S();
    const cnt = q.counts();
    const kinds = Object.keys(M.TRADE_VALUE);
    const value = Object.entries(arg.give).reduce((a, [k, n]) => a + (k === arg.want ? 0 : n * M.TRADE_VALUE[k]), 0);
    const expect = Math.floor((value * q.tradeRate()) / M.TRADE_VALUE[arg.want]);
    const people = q.eligibleForCaravan().map((c) => {
      const on = arg.picked.includes(c.id);
      return h('button', { type: 'button', class: `mm-pick${on ? ' is-on' : ''}`, 'aria-pressed': String(on),
        on: { click: () => { const i = arg.picked.indexOf(c.id); if (i >= 0) arg.picked.splice(i, 1); else if (arg.picked.length < 2) arg.picked.push(c.id); renderModal(); } } },
      h('strong', null, c.name), h('span', { class: 'mm-traits' }, (c.traits || []).map((k) => h('span', { class: 'mm-trait' }, M.TRAITS[k].label))), h('small', null, `Mood ${Math.round(c.mood)}`));
    });
    const step = (k, d) => { arg.give[k] = Math.max(0, Math.min(cnt[k], (arg.give[k] || 0) + d)); renderModal(); };
    return modalFrame(`Trade with ${M.NEIGHBOR}`,
      h('p', null, `The trip takes about ${Math.round(q.tradeLeg() * 2)} hours there and back; the colonists who go do no work at home. ${M.NEIGHBOR} pays ${Math.round(q.tradeRate() * 100)}% of fair value right now.`),
      h('p', { class: 'mm-kicker' }, 'Who goes (one or two)'), h('div', { class: 'mm-picks' }, people),
      h('p', { class: 'mm-kicker' }, 'What to bring'),
      h('div', { class: 'mm-goods' }, kinds.filter((k) => k !== arg.want).map((k) => h('div', { class: 'mm-good' },
        h('span', null, `${M.ITEMS[k].label} (${cnt[k]})`),
        h('button', { type: 'button', class: 'mm-btn mm-btn-s', on: { click: () => step(k, -10) } }, '−10'),
        h('b', null, arg.give[k] || 0),
        h('button', { type: 'button', class: 'mm-btn mm-btn-s', on: { click: () => step(k, 10) } }, '+10')))),
      h('p', { class: 'mm-kicker' }, 'What to ask for'),
      h('div', { class: 'mm-actions' }, kinds.map((k) => h('button', { type: 'button', class: `mm-btn mm-btn-s${arg.want === k ? ' is-on' : ''}`, on: { click: () => { arg.want = k; delete arg.give[k]; renderModal(); } } }, M.ITEMS[k].label))),
      h('p', { class: expect < 1 ? 'mm-warn' : null }, expect < 1 ? `Not enough to buy any ${M.ITEMS[arg.want].label.toLowerCase()}: one is worth ${Math.ceil(M.TRADE_VALUE[arg.want] / q.tradeRate())} units of wood or potatoes at this rate.` : `Expected: about ${expect} ${M.ITEMS[arg.want].label.toLowerCase()}.`),
      h('div', { class: 'mm-actions' },
        h('button', { type: 'button', class: 'mm-btn mm-btn-primary', disabled: !arg.picked.length || expect < 1, on: { click: () => {
          const r = order({ type: 'trade-send', members: arg.picked.slice(), give: { ...arg.give }, want: arg.want });
          if (r.ok) { closeModal(); setView('world'); select({ kind: 'world', what: 'trade' }); }
        } } }, 'Send the caravan')));
  }

  function chronicleModal() {
    const hist = S().history.slice().reverse();
    return modalFrame('Chronicle',
      hist.length ? h('ul', { class: 'mm-chronicle' }, hist.map((e) => h('li', null, h('span', null, clock(e.t)), e.text))) : h('p', { class: 'mm-muted' }, 'Nothing worth writing down yet.'));
  }

  function researchModal() {
    const s = S();
    const hasBench = s.things.some((th) => th.type === 'bench' && !th.bp);
    const branches = {};
    for (const [k, r] of Object.entries(M.RESEARCH)) (branches[r.branch] = branches[r.branch] || []).push([k, r]);
    return modalFrame('Research',
      h('p', null, hasBench ? 'Colonists with Research work study at the bench. Time spent here is time not spent on food, wood, or repairs.' : 'Build a research bench (Architect) first. Colonists with Research work study there.'),
      h('div', { class: 'mm-research' }, Object.entries(branches).map(([b, list]) => h('div', { class: 'mm-branch' }, h('p', { class: 'mm-kicker' }, b),
        list.map(([k, r]) => {
          const done = q.researched(k), active = s.research.active === k;
          const ready = r.requires.every((x) => q.researched(x));
          const prog = (s.research.progress[k] || 0) / r.hours;
          return h('div', { class: `mm-proj${done ? ' is-done' : active ? ' is-active' : !ready ? ' is-locked' : ''}` },
            h('strong', null, r.label), h('span', null, r.desc),
            h('small', null, done ? 'Done' : !ready ? `Needs ${r.requires.filter((x) => !q.researched(x)).map((x) => M.RESEARCH[x].label).join(' and ')}` : `${Math.round(prog * 100)}% of ${r.hours} hours`),
            !done && ready && !active ? h('button', { type: 'button', class: 'mm-btn mm-btn-s', on: { click: () => { order({ type: 'research', key: k }); renderModal(); } } }, prog > 0 ? 'Resume' : 'Research this') : null,
            active ? h('em', null, 'In progress') : null);
        })))));
  }

  function caravanModal(arg) {
    const inc = S().incident;
    const picked = arg.picked;
    const rows = q.eligibleForCaravan().map((c) => {
      const on = picked.includes(c.id);
      const rels = q.relationsOf(c);
      return h('button', {
        type: 'button', class: `mm-pick${on ? ' is-on' : ''}`, 'aria-pressed': String(on),
        on: { click: () => { const i = picked.indexOf(c.id); if (i >= 0) picked.splice(i, 1); else if (picked.length < 2) picked.push(c.id); renderModal(); } },
      },
      h('strong', null, c.name),
      h('span', { class: 'mm-traits' }, (c.traits || []).map((k) => h('span', { class: 'mm-trait', title: M.TRAITS[k].desc }, M.TRAITS[k].label))),
      h('small', null, `Mood ${Math.round(c.mood)} · first choice: ${M.WORK_TYPES.filter((w) => c.prio[w] === 1).map((w) => WORK_LABEL[w].toLowerCase()).join(', ') || 'nothing in particular'}${rels.length ? ` · ${rels.map((r) => `${M.REL_LABEL[r.kind].toLowerCase()} of ${r.other.name}`).join(', ')}` : ''}`));
    });
    return modalFrame('Form a caravan',
      h('p', null, inc && inc.kind === 'caravan' ? `Choose two colonists to go after ${inc.traveler.name}. They will be away for most of a day and do no work at home.` : 'The request is gone.'),
      h('div', { class: 'mm-picks' }, rows),
      h('div', { class: 'mm-actions' },
        h('button', { type: 'button', class: 'mm-btn mm-btn-primary', disabled: picked.length !== 2, on: { click: () => {
          const r = order({ type: 'caravan-send', members: picked.slice() });
          if (r.ok) { closeModal(); setView('world'); select({ kind: 'world', what: 'caravan' }); }
        } } }, picked.length === 2 ? 'Send them' : `Pick ${2 - picked.length} more`),
        h('button', { type: 'button', class: 'mm-btn', on: { click: () => openLetter(arg.letterId) } }, 'Back')));
  }

  function focusOn(f) {
    if (f.world) { setView('world'); select({ kind: 'world', what: f.world }); return; }
    setView('map');
    if (f.thingId != null) select({ kind: 'thing', id: f.thingId });
    if (f.colonistId != null) select({ kind: 'colonist', id: f.colonistId });
    if (f.tile != null) select({ kind: 'tile', x: f.tile % W, y: (f.tile / W) | 0 });
  }

  function workModal() {
    const s = S();
    const cell = (c, w) => {
      const v = c.prio[w];
      return h('td', null, h('button', {
        type: 'button', class: `mm-prio p${v}`, 'aria-label': `${c.name} ${WORK_LABEL[w]} priority ${v || 'off'}`,
        on: { click: () => { M.command({ type: 'priority', colonistId: c.id, work: w, value: v === 0 ? 1 : v === 4 ? 0 : v + 1 }); renderModal(); } },
      }, v || ''));
    };
    return modalFrame('Work priorities',
      h('p', { class: 'mm-muted' }, '1 is done first. Click to cycle 1 → 2 → 3 → 4 → off.'),
      h('div', { class: 'mm-table-wrap' }, h('table', { class: 'mm-table mm-work' },
        h('thead', null, h('tr', null, h('th', null, ''), M.WORK_TYPES.map((w) => h('th', null, WORK_LABEL[w])))),
        h('tbody', null, s.colonists.map((c) => h('tr', null, h('th', null, c.name), M.WORK_TYPES.map((w) => cell(c, w))))))));
  }

  function menuModal() {
    return modalFrame('Menu',
      h('p', null, 'Your colony saves automatically in this browser.'),
      h('div', { class: 'mm-actions' },
        h('button', { type: 'button', class: 'mm-btn', on: { click: () => { M.save(); toast('Saved'); closeModal(); } } }, 'Save now'),
        h('button', { type: 'button', class: 'mm-btn', on: { click: () => {
          if (!confirm('Start a new colony? Your MMTI observations are kept.')) return;
          M.newColony();
          terrainCanvas = null;
          ui.sel = null;
          lastBarSig = lastLetterSig = lastInspectSig = '';
          closeModal();
        } } }, 'New colony')));
  }

  function reflectModal() {
    const m = O.computeModel();
    const cards = O.portraitCards(m);
    const keeper = document.createElement('canvas');
    keeper.width = 70;
    keeper.height = 70;
    const kg = keeper.getContext('2d');
    kg.imageSmoothingEnabled = false;
    if (window.PixelArt) window.PixelArt.draw(kg, 'keeper_a', window.PixelArt.PEOPLE_PALETTE, 5);
    keeper.className = 'mm-keeper';
    const idx = Math.min(ui.modal.arg || 0, Math.max(0, cards.length - 1));
    const body = [h('div', { class: 'mm-keeper-row' }, keeper, h('p', { class: 'mm-speech' }, cards.length
      ? 'I’ve been watching how you handle setbacks in the colony. Here is how I think you’d act somewhere else. Tell me whether it fits.'
      : 'I don’t know you well enough yet. Keep looking after the colony and come back.'))];
    if (cards.length) {
      const card = cards[idx];
      body.push(h('div', { class: 'mm-portrait-card' },
        h('p', { class: 'mm-kicker' }, `Your MMTI · inferred portrait ${idx + 1} of ${cards.length}`),
        h('blockquote', null, `“${card.text}”`),
        h('p', { class: 'mm-muted' }, card.source),
        feedbackRow(card, m),
        h('div', { class: 'mm-actions mm-actions-split' },
          h('button', { type: 'button', class: 'mm-btn', disabled: idx === 0, on: { click: () => { ui.modal.arg = idx - 1; renderModal(); } } }, '← Previous'),
          h('button', { type: 'button', class: 'mm-btn', disabled: idx === cards.length - 1, on: { click: () => { ui.modal.arg = idx + 1; renderModal(); } } }, 'Next →'))));
    }
    const forming = O.DEADLINES.filter((d) => !m[d].released);
    if (forming.length) {
      body.push(h('div', { class: 'mm-forming' }, h('p', { class: 'mm-kicker' }, 'Still forming'), forming.map((d) => {
        const b = m[d];
        const note = b.enough ? 'No clear pattern yet, so no description.' : `${Math.min(b.n, O.RELEASE.minEpisodes)} of ${O.RELEASE.minEpisodes} decisions · ${b.types.size} of ${O.RELEASE.minEventTypes} kinds of trouble`;
        return h('div', { class: 'mm-progress' },
          h('div', { class: 'mm-progress-top' }, h('span', null, d === 'urgent' ? 'With a deadline' : 'Without a deadline'), h('span', null, note)),
          h('div', { class: 'mm-progress-bar' }, h('span', { style: `width:${Math.min(100, (b.n / O.RELEASE.minEpisodes) * 100)}%` })));
      })));
    }
    return modalFrame('The Archivist', ...body);
  }

  function feedbackRow(card, m) {
    const prev = O.feedbackFor(card.key);
    let verdict = prev ? prev.verdict : null;
    const note = h('textarea', { class: 'mm-note', rows: '2', placeholder: 'Optional: what circumstance matters?', 'aria-label': 'Explanation' });
    if (prev && prev.note) note.value = prev.note;
    const status = h('span', { class: 'mm-saved' }, prev ? 'Saved.' : '');
    const record = () => {
      if (!verdict) return;
      O.addFeedback({ key: card.key, verdict, note: note.value.trim(), counts: Object.fromEntries(O.DEADLINES.map((d) => [d, { n: m[d].n, switches: m[d].switches }])) });
      status.textContent = 'Saved.';
    };
    const choices = [['fits', 'Fits'], ['doesnt_fit', 'Doesn’t fit'], ['depends', 'Depends']];
    const buttons = choices.map(([id, label]) => {
      const b = h('button', { type: 'button', class: `mm-btn mm-btn-s${verdict === id ? ' is-on' : ''}`, 'aria-pressed': String(verdict === id) }, label);
      b.addEventListener('click', () => {
        verdict = id;
        buttons.forEach((o, i) => { const on = choices[i][0] === id; o.classList.toggle('is-on', on); o.setAttribute('aria-pressed', String(on)); });
        record();
      });
      return b;
    });
    note.addEventListener('change', record);
    return h('div', { class: 'mm-feedback' }, h('div', { class: 'mm-actions' }, buttons, status), note);
  }

  function evidenceModal() {
    const m = O.computeModel();
    const pct = (x) => `${Math.round(x * 100)}%`;
    const eps = O.episodes().slice().reverse();
    const actionLabel = { 'build-stove': 'Planned a wood stove', 'build-campfire': 'Planned a campfire', repair: 'Ordered the repair', 'reroute-pass': 'Took the mountain pass', 'clear-road': 'Cleared the road' };
    const rel = (ep, t) => (t == null ? '—' : `+${(t - ep.startT).toFixed(1)}h`);
    return modalFrame('Evidence',
      h('p', null, 'Every description traces back to these counts. Rule ', h('code', null, O.RULE_VERSION),
        ': the first order that commits to a next approach is the response. Before the report arrived means “changed plan first”; after reading the report means “waited for the report”. Estimates use (changes + 1) / (decisions + 2); a description needs 8 decisions across both kinds of trouble and at least 75% one way.'),
      h('div', { class: 'mm-table-wrap' }, h('table', { class: 'mm-table' },
        h('thead', null, h('tr', null, ['Condition', 'Decisions', 'Changed plan first', 'Waited for report', 'P(change plan)', 'Status'].map((t) => h('th', null, t)))),
        h('tbody', null, O.DEADLINES.map((d) => {
          const b = m[d];
          return h('tr', null, h('td', null, d === 'urgent' ? 'Deadline' : 'No deadline'), h('td', null, b.n), h('td', null, b.switches), h('td', null, b.n - b.switches), h('td', null, pct(b.p)),
            h('td', null, b.released ? `Released: ${b.released === 'switch' ? 'changes plan first' : 'waits for the report'}` : 'Collecting'));
        })))),
      h('h5', { class: 'mm-subhead' }, `Episodes (${eps.length})`),
      eps.length ? h('div', { class: 'mm-table-wrap' }, h('table', { class: 'mm-table' },
        h('thead', null, h('tr', null, ['Day', 'Event', 'Deadline', 'Report', 'Read', 'Decided', 'Order', 'Response'].map((t) => h('th', null, t)))),
        h('tbody', null, eps.map((ep) => {
          const r = O.classify(ep);
          return h('tr', null,
            h('td', null, ep.day), h('td', null, ep.eventType === 'heating' ? 'Heater broke' : 'Road blocked'),
            h('td', null, ep.params.deadlineIn != null ? `+${ep.params.deadlineIn}h` : 'None'),
            h('td', null, rel(ep, ep.reportReceivedAt)), h('td', null, rel(ep, ep.consultedAt)), h('td', null, rel(ep, ep.commitAt)),
            h('td', null, actionLabel[ep.action] || '—'),
            h('td', null, r ? (r === 'switch' ? 'Changed plan first' : 'Waited for report') : `Not scored (${O.unscoredReason(ep)})`));
        })))) : h('p', { class: 'mm-muted' }, 'No episodes yet.'),
      h('div', { class: 'mm-actions' },
        h('button', { type: 'button', class: 'mm-btn', on: { click: exportData } }, 'Export data (JSON)'),
        h('button', { type: 'button', class: 'mm-btn', on: { click: () => { if (confirm('Erase all MMTI observations and feedback in this browser?')) { O.reset(); renderModal(); } } } }, 'Reset observations')));
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ ...O.exportData(), colony: S() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: 'mmti-data.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function proposeModal() {
    const kinds = [
      ['mmti-event.yml', 'Event or mechanic', 'Something that happens in the colony: what the player can do, and why it would be fun. Fun-only ideas are welcome; they may stay unscored.'],
      ['mmti-rule.yml', 'Interpretation rule', 'What a behavior means, or a missing condition that explains inconsistent responses.'],
      ['mmti-scene.yml', 'Result scene', 'An everyday situation and the conditional pattern it expresses.'],
    ];
    return modalFrame('Propose',
      h('p', null, 'MMTI grows through proposals, collected as GitHub Issues. Accepted ones are built into the next version.'),
      h('div', { class: 'mm-propose' }, kinds.map(([tpl, title, desc]) => h('a', { class: 'mm-propose-card', href: `${ISSUES_URL}?template=${tpl}`, target: '_blank', rel: 'noopener' },
        h('strong', null, title), h('span', null, desc), h('em', null, 'Open a proposal ↗')))));
  }

  function openMenu() { openModal('menu'); }

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (window.PlayActiveView !== 'mmti') return;
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
    if (e.key === 'Escape') { if (ui.modal) closeModal(); else if (ui.tool) setTool(null); else select(null); return; }
    if (ui.modal) return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(-1); }
    else if (e.key === '1' || e.key === '2' || e.key === '3') setSpeed(Number(e.key) - 1);
  });

  // ---------- loop ----------
  let last = performance.now(), sinceSave = 0, sinceUI = 0;
  function frame(now) {
    const dt = Math.min(100, now - last);
    last = now;
    const active = window.PlayActiveView === 'mmti' && !document.hidden;
    if (active) {
      if (!ui.paused && !ui.modal) M.advance((dt / HOUR_MS) * SPEEDS[ui.speed]);
      draw(now);
      sinceUI += dt;
      if (sinceUI > 200) { sinceUI = 0; updateUI(); }
      sinceSave += dt;
      if (sinceSave > 15000) { sinceSave = 0; M.save(); }
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) M.save(); });
  window.addEventListener('pagehide', () => M.save());

  renderSpeed();
  updateUI();
  draw(performance.now());
  requestAnimationFrame(frame);
  if (!hadSave) {
    const welcome = S().letters.find((l) => l.title === 'Welcome to the colony');
    if (welcome) openLetter(welcome.id);
  }

  M.debug = {
    render: () => { updateUI(); draw(performance.now()); },
    ui, setView, select, openModal, closeModal, openLetter, setTool,
  };
})();
