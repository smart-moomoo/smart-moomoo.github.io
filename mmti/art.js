// MMTI pixel art. Every sprite is painted into a small pixel buffer at RES art
// pixels per logical pixel (a 16-unit tile is 32x32 art pixels), lit from the
// top-left, outlined automatically, then baked into a cached canvas.
window.MMTI = window.MMTI || {};
(() => {
  'use strict';
  const M = window.MMTI;
  const RES = 2;
  const INK = '#171512';

  // ---------- color helpers ----------
  const rgbCache = new Map();
  function rgb(hex) {
    let v = rgbCache.get(hex);
    if (!v) {
      const n = parseInt(hex.slice(1, 7), 16);
      v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, hex.length > 7 ? parseInt(hex.slice(7, 9), 16) : 255];
      rgbCache.set(hex, v);
    }
    return v;
  }
  const toHex = (r, g, b) => `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
  function shade(hex, f) {
    const [r, g, b] = rgb(hex);
    return f <= 1 ? toHex(r * f, g * f, b * f) : toHex(r + (255 - r) * (f - 1), g + (255 - g) * (f - 1), b + (255 - b) * (f - 1));
  }
  const ramp = (hex) => [shade(hex, 0.55), shade(hex, 0.75), hex, shade(hex, 1.18), shade(hex, 1.38)];
  function hash(x, y, k = 0) {
    let v = (x * 374761393 + y * 668265263 + k * 1442695041) | 0;
    v = Math.imul(v ^ (v >>> 13), 1274126177);
    return ((v ^ (v >>> 16)) >>> 0) / 4294967296;
  }
  function vnoise(x, y, k) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(x0, y0, k), b = hash(x0 + 1, y0, k), c = hash(x0, y0 + 1, k), d = hash(x0 + 1, y0 + 1, k);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  // Pick from a dark-to-light ramp by a surface normal, lit from the top-left, with a little dither.
  function lit(pal, nx, ny, x, y, k = 0, bias = 0) {
    const l = 0.5 - (nx + ny) * 0.36 - (nx * nx + ny * ny) * 0.18 + bias + (hash(x, y, k) - 0.5) * 0.22;
    return pal[Math.max(0, Math.min(pal.length - 1, Math.floor(l * pal.length)))];
  }

  const PAL = {
    leaf: ['#1c421a', '#285e24', '#357a2e', '#47933b', '#63b04c', '#86cc66'],
    pine: ['#15361c', '#1f4d27', '#2a6533', '#377d40', '#4c9853'],
    bark: ['#33200f', '#4a2f17', '#63411f', '#7c552b', '#94693a'],
    wood: ['#4e3218', '#6b4524', '#87592f', '#a3703d', '#bf8a52', '#d8a86e'],
    stone: ['#43403b', '#58544e', '#6e6a63', '#86817a', '#a09a91', '#bbb5aa'],
    metal: ['#232327', '#34343a', '#4b4b53', '#66666f', '#8a8a94', '#b4b4bd'],
    red: ['#5e1a12', '#83271b', '#a93627', '#cc4c38', '#e87458'],
    fire: ['#a82e18', '#dc4d1d', '#ff7a2e', '#ffab40', '#ffd86a', '#fff6d2'],
    skin: ['#9a6645', '#c48a60', '#e8b58a', '#f6d2b0'],
    cloth: ['#1f3a57', '#2c5279', '#3a6a98', '#5689ba', '#82acd4'],
    white: ['#9d978a', '#c6c0b2', '#e4dfd3', '#f6f3ea', '#ffffff'],
    sand: ['#8a7a52', '#a8966d', '#c2b088', '#d6c7a0', '#e6dab8'],
    potato: ['#6e4f28', '#8c6a38', '#ac874d', '#c9a466', '#dfbe85'],
    berry: ['#6e0f18', '#a3182a', '#d02c3c', '#f05a64', '#ffb0b4'],
    mint: ['#2b6b52', '#3b8a6a', '#58a986', '#83c9a6', '#b4e6cc'],
  };

  // ---------- the painter ----------
  const cache = new Map();
  function art(key, lw, lh, paint, opts = {}) {
    const hit = cache.get(key);
    if (hit) return hit;
    const w = Math.round(lw * RES), h = Math.round(lh * RES);
    let buf = new Array(w * h).fill(null);
    const P = {
      w, h,
      set(x, y, col) {
        x = Math.floor(x); y = Math.floor(y);
        if (col && x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] = col;
      },
      get(x, y) { return x >= 0 && y >= 0 && x < w && y < h ? buf[y * w + x] : null; },
      erase(x, y) { if (x >= 0 && y >= 0 && x < w && y < h) buf[y * w + x] = null; },
      rect(x, y, rw, rh, col) {
        for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++) P.set(x + i, y + j, typeof col === 'function' ? col(i, j, x + i, y + j) : col);
      },
      ellipse(cx, cy, rx, ry, col) {
        for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny;
            if (d <= 1) P.set(x, y, typeof col === 'function' ? col(nx, ny, d, x, y) : col);
          }
        }
      },
      line(x0, y0, x1, y1, col, thick = 1) {
        const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        for (let i = 0; i <= n; i++) {
          const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
          for (let a = 0; a < thick; a++) for (let b = 0; b < thick; b++) P.set(x + a - (thick >> 1), y + b - (thick >> 1), typeof col === 'function' ? col(i / n) : col);
        }
      },
    };
    paint(P);
    if (opts.outline !== false) {
      const oc = opts.outline || INK;
      const out = buf.slice();
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (buf[y * w + x]) continue;
        if ((x > 0 && buf[y * w + x - 1]) || (x < w - 1 && buf[y * w + x + 1]) || (y > 0 && buf[(y - 1) * w + x]) || (y < h - 1 && buf[(y + 1) * w + x])) out[y * w + x] = oc;
      }
      buf = out;
    }
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
      const col = buf[i];
      if (!col) continue;
      const [r, gg, b, a] = rgb(col);
      img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
    g.putImageData(img, 0, 0);
    c.lw = lw;
    c.lh = lh;
    cache.set(key, c);
    return c;
  }

  // ---------- structures ----------
  const wall = (v) => art(`wall${v}`, 16, 16, (P) => {
    const S = PAL.stone;
    P.rect(0, 0, 32, 10, (i, j, x, y) => (j === 0 ? S[5] : j === 9 ? S[1] : hash(x, y, 3) < 0.12 ? S[3] : S[4]));
    for (let row = 0; row < 3; row++) {
      const y0 = 10 + row * 7, off = (row + v) % 2 ? 6 : 0;
      for (let bx = -12 + off; bx < 32; bx += 12) {
        const tint = hash(bx, row, v + 7) < 0.5 ? S[2] : S[3];
        P.rect(bx, y0, 12, 7, (i, j) => (j === 6 || i === 11 ? S[0] : i === 0 || j === 0 ? S[4] : j === 5 || i === 10 ? S[1] : hash(bx + i, y0 + j, 9) < 0.08 ? S[1] : tint));
      }
    }
    P.rect(0, 31, 32, 1, '#2a2825');
  }, { outline: false });

  const door = () => art('door', 16, 16, (P) => {
    const Wd = PAL.wood, Mt = PAL.metal;
    P.rect(0, 0, 32, 32, Wd[0]);
    for (let k = 0; k < 4; k++) {
      const x0 = 3 + k * 6.5;
      P.rect(Math.round(x0), 2, 6, 30, (i, j, x, y) => (i === 0 ? Wd[4] : i === 5 ? Wd[1] : hash(x, Math.floor(y / 3), 2) < 0.18 ? Wd[2] : Wd[3]));
    }
    for (const y of [8, 23]) P.rect(3, y, 26, 3, (i, j) => (j === 0 ? Mt[4] : j === 2 ? Mt[1] : Mt[2]));
    P.ellipse(24, 16.5, 2, 2, (nx, ny, d, x, y) => lit(['#8a6a1a', '#c9a032', '#f0cf5c', '#fff0a8'], nx, ny, x, y));
  }, { outline: false });

  // ---------- natural things ----------
  const tree = (v) => art(`tree${v}`, 16, 22, (P) => {
    const B = PAL.bark;
    P.rect(13, 27, 7, 16, (i, j, x, y) => lit(B, (i - 3) / 3.5, 0, x, Math.floor(y / 2), 4, 0.1));
    P.rect(10, 40, 13, 3, (i, j, x, y) => lit(B, (i - 6) / 6.5, 0.3, x, y, 4));
    if (v === 1) {
      const L = PAL.pine;
      for (const [cy, rx, ry] of [[30, 15, 6], [23, 13, 6], [16, 10, 6], [9, 7, 5], [4, 4, 4]]) {
        P.ellipse(16, cy, rx, ry, (nx, ny, d, x, y) => (ny > 0.55 ? L[0] : lit(L, nx, ny - 0.3, x, y, 5)));
      }
      return;
    }
    const L = PAL.leaf;
    const blob = (cx, cy, rx, ry) => P.ellipse(cx, cy, rx, ry, (nx, ny, d, x, y) => {
      const gx = (x - 16) / 15, gy = (y - 15) / 14;
      const hole = hash(x >> 1, y >> 1, 11) < 0.07 && d < 0.8;
      return hole ? L[1] : lit(L, gx * 0.8 + nx * 0.4, gy * 0.8 + ny * 0.4, x, y, 6);
    });
    blob(9, 20, 8, 7);
    blob(23, 20, 8, 7);
    blob(16, 13, 13, 11);
    blob(12, 7, 7, 6);
    blob(21, 8, 6, 5);
  });

  const bush = (ripe) => art(`bush${ripe}`, 16, 16, (P) => {
    const L = PAL.leaf;
    const blob = (cx, cy, rx, ry) => P.ellipse(cx, cy, rx, ry, (nx, ny, d, x, y) => lit(L, (x - 16) / 13 + nx * 0.3, (y - 19) / 10 + ny * 0.3, x, y, 8));
    blob(9, 22, 8, 7);
    blob(23, 22, 8, 7);
    blob(16, 16, 10, 9);
    if (ripe) {
      for (const [x, y] of [[8, 18], [14, 13], [20, 16], [24, 22], [12, 23], [18, 24], [26, 17]]) {
        P.ellipse(x, y, 2, 2, (nx, ny, d, px, py) => lit(PAL.berry, nx, ny, px, py, 2));
        P.set(x - 1, y - 1, '#ffd8da');
      }
    }
  });

  // ---------- furniture and machines ----------
  const bed = () => art('bed', 16, 16, (P) => {
    const Wd = PAL.wood, C = PAL.cloth, Wt = PAL.white;
    P.rect(3, 0, 26, 32, (i, j) => (i === 0 || j === 0 ? Wd[3] : i === 25 || j === 31 ? Wd[0] : Wd[2]));
    P.rect(3, 0, 26, 5, (i, j) => (j === 0 ? Wd[4] : j === 4 ? Wd[0] : Wd[1]));
    P.ellipse(16, 9, 10, 3.6, (nx, ny, d, x, y) => lit(Wt, nx, ny, x, y, 3, 0.1));
    P.rect(5, 13, 22, 17, (i, j, x, y) => {
      if (j < 3) return j === 0 ? Wt[4] : j === 2 ? Wt[1] : Wt[3];
      const stripe = (i + j) % 8 < 1;
      return stripe ? C[3] : lit(C, (i - 11) / 12, (j - 8) / 10, x, y, 5, 0.05);
    });
  });

  const table = () => art('table', 16, 16, (P) => {
    const Wd = PAL.wood;
    P.rect(4, 22, 4, 9, (i) => (i === 0 ? Wd[3] : Wd[1]));
    P.rect(24, 22, 4, 9, (i) => (i === 0 ? Wd[3] : Wd[1]));
    P.rect(2, 7, 28, 14, (i, j, x, y) => (j === 0 ? Wd[5] : j >= 12 ? Wd[1] : hash(x >> 2, y, 3) < 0.15 ? Wd[2] : lit(Wd, (i - 14) / 16, (j - 6) / 10, x, y, 3, 0.1)));
    P.ellipse(11, 12, 4, 2, (nx, ny, d, x, y) => lit(PAL.white, nx, ny, x, y, 1));
    P.ellipse(22, 11.5, 2, 2, (nx, ny, d, x, y) => lit(PAL.metal, nx, ny, x, y, 1, 0.2));
  });

  const heater = (on, f) => art(`heater${on}${f}`, 16, 16, (P) => {
    const R = on ? PAL.red : ['#3e2b27', '#56403b', '#6e5650', '#86706a', '#9a8680'];
    P.rect(12, 1, 4, 4, (i) => (i === 0 ? PAL.metal[3] : PAL.metal[1]));
    P.rect(6, 5, 20, 23, (i, j, x, y) => (j === 0 ? R[4] : i === 0 ? R[3] : i === 19 || j === 22 ? R[0] : lit(R, (i - 10) / 11, (j - 11) / 12, x, y, 2, 0.1)));
    for (let k = 0; k < 4; k++) {
      const y = 10 + k * 4;
      P.rect(9, y, 14, 2, (i, j) => (on ? (j === 0 ? PAL.fire[f ? 4 : 3] : PAL.fire[f ? 3 : 2]) : j === 0 ? '#1e1412' : '#2a1e1b'));
    }
    P.rect(7, 28, 3, 3, PAL.metal[1]);
    P.rect(22, 28, 3, 3, PAL.metal[1]);
  });

  const stove = (f, on) => art(`stove${f}${on}`, 16, 16, (P) => {
    const Mt = PAL.metal;
    P.rect(13, 0, 5, 9, (i) => (i === 0 ? Mt[4] : i === 4 ? Mt[1] : Mt[2]));
    P.rect(5, 9, 22, 20, (i, j, x, y) => (j === 0 ? Mt[4] : i === 0 ? Mt[3] : i === 21 || j === 19 ? Mt[0] : lit(Mt, (i - 11) / 12, (j - 9) / 11, x, y, 3, -0.05)));
    P.rect(9, 15, 14, 9, (i, j) => (i === 0 || j === 0 || i === 13 || j === 8 ? Mt[1] : '#1a1412'));
    if (on) {
      P.ellipse(16, 21, 5, 3, (nx, ny, d, x, y) => PAL.fire[Math.min(5, Math.floor((1 - d) * 4 + (f ? 1.5 : 1) + hash(x, y, f) * 0.8))]);
    }
    P.rect(7, 29, 3, 3, Mt[1]);
    P.rect(22, 29, 3, 3, Mt[1]);
  });

  const campfire = (f, on) => art(`campfire${f}${on}`, 16, 16, (P) => {
    const S = PAL.stone, Wd = PAL.wood;
    P.line(7, 26, 25, 21, Wd[on ? 2 : 0], 3);
    P.line(7, 21, 25, 26, Wd[on ? 1 : 0], 3);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const cx = 16 + Math.cos(a) * 12, cy = 25 + Math.sin(a) * 5;
      P.ellipse(cx, cy, 3, 2.2, (nx, ny, d, x, y) => lit(S, nx, ny, x, y, k));
    }
    if (!on) { P.ellipse(16, 24, 6, 2, (nx, ny, d, x, y) => (hash(x, y, 4) < 0.5 ? '#5a5650' : '#3e3b37')); return; }
    const F = PAL.fire;
    const flames = f ? [[16, 13, 5.5, 11], [11, 17, 3.5, 7], [21, 16, 3.5, 8]] : [[16, 12, 5, 12], [11, 16, 3.5, 8], [21, 17, 3.5, 7]];
    for (const [cx, cy, rx, ry] of flames) {
      P.ellipse(cx, cy, rx, ry, (nx, ny, d, x, y) => {
        const taper = Math.abs(nx) > 0.9 - ny * 0.25 ? null : 1;
        if (!taper) return null;
        return F[Math.min(5, Math.floor((1 - d) * 4 + (ny + 1) * 0.9 + hash(x, y, f) * 0.6))];
      });
    }
  });

  const keeper = () => art('keeper', 16, 16, (P) => {
    person(P, { shirt: '#2f7a5f', hair: '#3b2a20', style: 2, glasses: true, book: true }, 0, false, false, 6, 3);
  });

  // ---------- items ----------
  const logs = () => art('logs', 16, 16, (P) => {
    const B = PAL.bark, Wd = PAL.wood;
    const log = (x0, y0, len) => {
      P.rect(x0, y0, len, 7, (i, j, x, y) => (j === 0 ? B[4] : j === 6 ? B[0] : hash(x >> 1, y, 5) < 0.2 ? B[1] : B[2 + (j < 3 ? 1 : 0)]));
      P.ellipse(x0, y0 + 3.5, 3, 3.5, (nx, ny, d) => (d < 0.25 ? Wd[2] : d < 0.55 ? Wd[4] : d < 0.8 ? Wd[3] : Wd[1]));
    };
    log(5, 21, 23);
    log(7, 14, 21);
    log(10, 7, 16);
  });

  const potato = () => art('potato', 16, 16, (P) => {
    const Pt = PAL.potato;
    for (const [x, y, rx, ry] of [[10, 22, 6, 5], [21, 23, 6, 4.5], [16, 16, 6, 5], [8, 15, 4.5, 4], [24, 16, 4.5, 4]]) {
      P.ellipse(x, y, rx, ry, (nx, ny, d, px, py) => (hash(px, py, 3) < 0.05 ? Pt[0] : lit(Pt, nx, ny, px, py, 7)));
    }
  });

  const berries = () => art('berries', 16, 16, (P) => {
    const Wd = PAL.wood;
    P.rect(4, 17, 24, 12, (i, j, x, y) => ((i + (j >> 1)) % 4 === 0 ? Wd[1] : j === 0 ? Wd[4] : lit(Wd, (i - 12) / 13, (j - 6) / 8, x, y, 2, 0.05)));
    for (let k = 0; k < 11; k++) {
      const x = 7 + (k % 6) * 3.5 + (k > 5 ? 1.7 : 0), y = k > 5 ? 11 : 15;
      P.ellipse(x, y, 2.2, 2.2, (nx, ny, d, px, py) => lit(PAL.berry, nx, ny, px, py, k));
    }
  });

  const meal = () => art('meal', 16, 16, (P) => {
    const Wt = PAL.white;
    P.ellipse(16, 21, 13, 6, (nx, ny, d, x, y) => lit(Wt, nx, ny, x, y, 1, 0.05));
    P.ellipse(16, 18, 9, 3.5, (nx, ny, d, x, y) => (hash(x, y, 8) < 0.12 ? '#6fae47' : hash(x, y, 9) < 0.1 ? '#c0533a' : lit(['#8a4f1a', '#b36b24', '#d68a38', '#ecac5c'], nx, ny, x, y, 5)));
    for (const x of [12, 17, 21]) for (let k = 0; k < 4; k++) P.set(x + (k % 2), 12 - k * 2, '#ffffff88');
  });

  const medicine = () => art('medicine', 16, 16, (P) => {
    P.rect(5, 9, 22, 17, (i, j, x, y) => (j === 0 ? '#ffffff' : i === 21 || j === 16 ? '#a7a193' : lit(PAL.white, (i - 11) / 12, (j - 8) / 9, x, y, 2, 0.1)));
    P.rect(12, 6, 8, 3, PAL.metal[2]);
    P.rect(14, 11, 4, 12, PAL.red[2]);
    P.rect(10, 15, 12, 4, PAL.red[2]);
    P.rect(14, 11, 1, 12, PAL.red[4]);
  });

  const preserved = () => art('preserved', 16, 16, (P) => {
    P.rect(9, 4, 14, 4, (i, j) => (j === 0 ? PAL.metal[4] : PAL.metal[2]));
    P.rect(7, 8, 18, 21, (i, j, x, y) => {
      if (i === 1 || i === 2) return '#e8f4f8';
      return j < 3 ? '#c9dfe6' : lit(['#8a4a12', '#b0621c', '#d17e2e', '#ec9d4c'], (i - 9) / 10, (j - 10) / 11, x, y, 4);
    });
    P.rect(9, 15, 14, 6, (i, j) => (j === 0 || j === 5 ? '#6b4a2b' : '#e8dcc0'));
  });

  const crate = () => art('crate', 16, 16, (P) => {
    const Wd = PAL.wood;
    P.rect(3, 8, 26, 21, (i, j, x, y) => (i < 2 || i > 23 || j < 2 || j > 18 ? Wd[1] : j % 6 === 0 ? Wd[1] : hash(x >> 2, y, 4) < 0.2 ? Wd[2] : Wd[3]));
    for (const [x, y] of [[8, 7], [13, 5], [19, 6], [24, 7], [10, 3], [17, 2]]) P.ellipse(x, y, 2.4, 2.4, (nx, ny, d, px, py) => lit(PAL.berry, nx, ny, px, py, 1));
  });

  // ---------- crops, zones, marks ----------
  const soil = () => art('soil', 16, 16, (P) => {
    P.rect(0, 0, 32, 32, (i, j, x, y) => {
      const r = j % 8;
      if (r === 0) return '#7e5c38';
      if (r === 1) return '#6b4a2b';
      if (r >= 6) return '#4a3019';
      return hash(x, y, 7) < 0.15 ? '#5a3c20' : '#62432a';
    });
  }, { outline: false });

  const crop = (stage) => art(`crop${stage}`, 16, 16, (P) => {
    const L = PAL.leaf;
    const leaf = (cx, cy, rx, ry) => P.ellipse(cx, cy, rx, ry, (nx, ny, d, x, y) => lit(L, nx, ny, x, y, 3, 0.15));
    if (stage === 0) { leaf(14, 22, 2, 3); leaf(18, 22, 2, 3); P.rect(16, 23, 1, 4, L[2]); return; }
    if (stage === 1) { P.rect(15, 16, 2, 10, L[1]); leaf(11, 18, 4, 2.5); leaf(21, 17, 4, 2.5); leaf(16, 14, 3, 3); return; }
    if (stage === 3) for (const x of [9, 22]) P.ellipse(x, 27, 3, 2.3, (nx, ny, d, px, py) => lit(PAL.potato, nx, ny, px, py, 2));
    P.rect(15, 12, 2, 14, L[1]);
    leaf(9, 17, 6, 4); leaf(23, 16, 6, 4); leaf(16, 11, 6, 5); leaf(11, 23, 5, 3); leaf(21, 23, 5, 3);
    if (stage === 3) for (const [x, y] of [[11, 10], [20, 9], [16, 6]]) { P.ellipse(x, y, 2, 2, '#f4f0e8'); P.set(x, y, '#ffd23d'); }
  });

  const healroot = (stage) => art(`heal${stage}`, 16, 16, (P) => {
    const L = PAL.mint;
    const leaf = (cx, cy, rx, ry) => P.ellipse(cx, cy, rx, ry, (nx, ny, d, x, y) => lit(L, nx, ny, x, y, 5, 0.1));
    if (stage === 0) { leaf(16, 23, 2, 3); return; }
    P.rect(15, 11, 2, 15, L[1]);
    leaf(10, 16, 5, 2.5); leaf(22, 14, 5, 2.5);
    if (stage >= 2) { leaf(11, 22, 5, 2.5); leaf(21, 21, 5, 2.5); }
    if (stage === 3) { P.ellipse(16, 8, 4, 3.5, (nx, ny, d, x, y) => lit(PAL.white, nx, ny, x, y, 1)); P.ellipse(16, 8, 1.5, 1.5, PAL.red[3]); }
  });

  const stockTile = () => art('stockTile', 16, 16, (P) => {
    P.rect(0, 0, 32, 32, '#ffd66e18');
    for (let i = 0; i < 32; i += 6) { P.rect(i, 0, 3, 1, '#ffd66e70'); P.rect(0, i, 1, 3, '#ffd66e70'); }
  }, { outline: false });

  const axe = () => art('axe', 8, 8, (P) => {
    P.ellipse(8, 8, 7.5, 7.5, '#fffefa');
    P.line(5, 12, 10, 4, PAL.wood[2], 2);
    P.ellipse(11, 5, 3, 2.5, (nx, ny, d, x, y) => lit(PAL.metal, nx, ny, x, y, 1, 0.2));
  });

  const pickMark = () => art('pick', 8, 8, (P) => {
    P.ellipse(8, 8, 7.5, 7.5, '#fffefa');
    for (const [x, y] of [[6, 7], [10, 7], [8, 10]]) P.ellipse(x, y, 2.2, 2.2, (nx, ny, d, px, py) => lit(PAL.berry, nx, ny, px, py, 3));
    P.rect(7, 3, 2, 3, PAL.leaf[3]);
  });

  const fire = (f) => art(`fire${f}`, 16, 16, (P) => {
    const F = PAL.fire;
    const tongues = f ? [[8, 18, 5, 12], [17, 14, 6, 15], [25, 19, 5, 11]] : [[9, 16, 5, 14], [18, 17, 6, 13], [25, 15, 5, 14]];
    for (const [cx, cy, rx, ry] of tongues) {
      P.ellipse(cx, cy, rx, ry, (nx, ny, d, x, y) => (Math.abs(nx) > 0.95 - ny * 0.3 ? null : F[Math.min(5, Math.floor((1 - d) * 3.5 + (ny + 1) + hash(x, y, f + 3) * 0.7))]));
    }
  });

  const grave = () => art('grave', 16, 16, (P) => {
    P.ellipse(16, 27, 12, 4, (nx, ny, d, x, y) => lit(['#3e2a17', '#553a20', '#6b4a2b', '#7e5c38'], nx, ny, x, y, 2));
    P.rect(10, 4, 12, 21, (i, j, x, y) => (j < 3 && (i < 2 || i > 9) ? null : lit(PAL.stone, (i - 5.5) / 6, (j - 10) / 11, x, y, 3, 0.1)));
    P.rect(15, 8, 2, 10, PAL.stone[1]);
    P.rect(12, 11, 8, 2, PAL.stone[1]);
  });

  const bench = () => art('bench', 16, 16, (P) => {
    const Wd = PAL.wood;
    P.rect(3, 22, 3, 9, Wd[1]);
    P.rect(26, 22, 3, 9, Wd[1]);
    P.rect(1, 12, 30, 10, (i, j, x, y) => (j === 0 ? Wd[5] : j > 7 ? Wd[1] : lit(Wd, (i - 15) / 16, (j - 4) / 6, x, y, 2, 0.1)));
    const books = [['#a93627', 5], ['#3a6a98', 4], ['#2f7a5f', 5], ['#c9a032', 3]];
    let x = 4;
    for (const [col, bw] of books) { P.rect(x, 5, bw, 7, (i, j) => (i === 0 ? shade(col, 1.25) : j === 1 ? '#f0e6c8' : col)); x += bw; }
    P.rect(19, 9, 9, 3, (i, j) => (j === 0 ? '#ffffff' : '#e4dfd3'));
    P.rect(24, 2, 2, 7, '#f4efe4');
    P.ellipse(25, 1.5, 1.5, 1.5, PAL.fire[4]);
  });

  const smoker = (on) => art(`smoker${on}`, 16, 16, (P) => {
    const Wd = PAL.wood;
    P.rect(22, 1, 4, 8, PAL.stone[2]);
    for (let j = 0; j < 9; j++) P.rect(3 + j, 8 - j, 26 - j * 2, 1, j === 8 ? Wd[4] : lit(PAL.red, -0.2, (j - 4) / 5, 0, 0, 0, -0.1));
    P.rect(4, 9, 24, 21, (i, j, x, y) => (i % 6 === 0 ? Wd[1] : hash(x, y >> 2, 3) < 0.15 ? Wd[2] : lit(Wd, (i - 12) / 13, (j - 10) / 11, x, y, 4)));
    P.rect(12, 16, 8, 14, (i, j) => (i === 0 || j === 0 ? Wd[0] : on && i === 4 ? PAL.fire[3] : Wd[1]));
  });

  const windmill = (f) => art(`windmill${f}`, 16, 16, (P) => {
    const Wd = PAL.wood;
    for (let j = 0; j < 19; j++) {
      const half = 3 + j * 0.25;
      P.rect(Math.round(16 - half), 13 + j, Math.round(half * 2), 1, (i) => (i === 0 ? Wd[4] : Wd[2 + (j % 4 === 0 ? -1 : 0)]));
    }
    const a0 = (f / 4) * (Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k * Math.PI) / 2;
      const x1 = 16 + Math.cos(a) * 14, y1 = 11 + Math.sin(a) * 14;
      P.line(16, 11, x1, y1, (t) => (t < 0.25 ? Wd[1] : PAL.white[3]), 3);
    }
    P.ellipse(16, 11, 2.5, 2.5, PAL.red[3]);
  });

  const cooler = (on) => art(`cooler${on}`, 16, 16, (P) => {
    const C = on ? ['#4a6a80', '#6a8ea6', '#8fb8d8', '#b6d6ee', '#e0f2ff'] : PAL.metal;
    P.rect(4, 5, 24, 22, (i, j, x, y) => (j === 0 ? C[4] : i === 23 || j === 21 ? C[0] : lit(C, (i - 11) / 12, (j - 10) / 11, x, y, 2, 0.05)));
    P.ellipse(16, 16, 8, 8, (nx, ny, d, x, y) => (d > 0.8 ? C[0] : (Math.atan2(ny, nx) * 3 / Math.PI + 6) % 2 < 1 ? C[1] : C[3]));
    if (on) for (const [x, y] of [[6, 7], [25, 9], [7, 24], [24, 24]]) { P.set(x, y, '#ffffff'); P.set(x + 1, y, '#e0f2ff'); }
  });

  const eheater = (on) => art(`eheater${on}`, 16, 16, (P) => {
    const Mt = PAL.metal;
    P.rect(4, 6, 24, 22, (i, j, x, y) => (j === 0 ? Mt[5] : i === 23 || j === 21 ? Mt[0] : lit(Mt, (i - 11) / 12, (j - 10) / 11, x, y, 3, 0.1)));
    for (let k = 0; k < 5; k++) P.rect(7 + k * 4, 10, 2, 14, (i, j) => (on ? PAL.fire[(j + k) % 3 === 0 ? 4 : 3] : Mt[1]));
    P.rect(22, 2, 3, 4, '#ffd23d');
  });

  const barricade = () => art('barricade', 16, 16, (P) => {
    const Sd = PAL.sand;
    for (const [x, y] of [[8, 25], [16, 25], [24, 25], [12, 18], [20, 18], [16, 11]]) {
      P.ellipse(x, y, 5, 3.6, (nx, ny, d, px, py) => (Math.abs(nx) < 0.08 ? Sd[1] : lit(Sd, nx, ny, px, py, 2)));
    }
  });

  const trap = () => art('trap', 16, 16, (P) => {
    P.rect(4, 25, 24, 4, (i, j) => (j === 0 ? PAL.wood[4] : PAL.wood[1]));
    for (const x of [7, 13, 19, 25]) {
      for (let j = 0; j < 9; j++) {
        const hw = Math.max(0, Math.floor((9 - j) / 3));
        P.rect(x - hw, 16 + j, hw * 2 + 1, 1, (i) => (i <= hw ? PAL.metal[5 - Math.min(3, j >> 1)] : PAL.metal[2]));
      }
    }
  });

  // ---------- people ----------
  const HAIRSTYLE = (name) => Math.floor(hash(name.length, name.charCodeAt(0), 3) * 3);
  // Paints a person into P with its top-left at (ox, oy) in art pixels. 20x28 art pixels.
  function person(P, look, frame, flip, headOnly, ox = 0, oy = 0) {
    const shirt = ramp(look.shirt), hair = ramp(look.hair), S = PAL.skin;
    const pants = ['#1e2233', '#2a2f45', '#3b4160', '#4e5578'];
    const X = (x) => ox + (flip ? 19 - x : x);
    const set = (x, y, c) => P.set(X(x), oy + y, c);
    const rect = (x, y, w, h, fn) => { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) set(x + i, y + j, typeof fn === 'function' ? fn(i, j, x + i, y + j) : fn); };
    const ell = (cx, cy, rx, ry, fn) => {
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry, d = nx * nx + ny * ny;
        if (d <= 1) set(x, y, fn(nx, ny, d, x, y));
      }
    };
    if (!headOnly) {
      const legA = frame ? [5, 22, 5] : [6, 22, 6];
      const legB = frame ? [11, 22, 7] : [11, 22, 6];
      for (const [lx, ly, lh] of [legA, legB]) {
        rect(lx, ly, 4, lh, (i) => pants[i === 0 ? 3 : i === 3 ? 0 : 2]);
        rect(lx, ly + lh, 4, 2, (i) => (i === 0 ? '#5a4030' : '#3a2818'));
      }
      rect(3, 14, 3, 7, (i, j) => (j >= 6 ? S[2] : shirt[i === 0 ? 2 : 1]));
      rect(14, 14, 3, 7, (i, j) => (j >= 6 ? S[1] : shirt[i === 2 ? 0 : 1]));
      rect(5, 13, 10, 10, (i, j, x, y) => (j === 0 && i > 2 && i < 7 ? S[2] : lit(shirt, (i - 4.5) / 5, (j - 4) / 6, x, y, 2, 0.05)));
      rect(8, 13, 4, 2, shirt[4]);
      if (look.book) rect(13, 16, 5, 6, (i, j) => (i === 0 ? '#f0e6c8' : j === 0 ? '#c9533a' : '#a93627'));
    }
    ell(10, 7, 5.5, 6, (nx, ny, d, x, y) => lit(S, nx, ny, x, y, 1, 0.15));
    const style = look.style != null ? look.style : HAIRSTYLE(look.name || 'x');
    ell(10, 4, 6, 4.2, (nx, ny, d, x, y) => (ny > 0.45 ? null : lit(hair, nx, ny, x, y, 3, 0.05)));
    rect(4, 4, 2, style === 1 ? 9 : 5, (i) => hair[i === 0 ? 1 : 2]);
    rect(14, 4, 2, style === 1 ? 9 : 5, (i) => hair[i === 1 ? 1 : 2]);
    if (style === 2) ell(10, 0.8, 2.5, 2, (nx, ny, d, x, y) => lit(hair, nx, ny, x, y, 4));
    if (look.hood) {
      ell(10, 5, 6.5, 5.5, (nx, ny, d, x, y) => (ny > 0.35 && Math.abs(nx) < 0.75 ? null : lit(ramp(look.hood), nx, ny, x, y, 5)));
      rect(5, 10, 10, 3, (i, j) => (j === 0 ? '#2a1e1e' : '#3a2828'));
    }
    set(7, 8, INK); set(7, 9, INK); set(12, 8, INK); set(12, 9, INK);
    set(7, 7, '#ffffff'); set(12, 7, '#ffffff');
    if (look.glasses) { for (const gx of [6, 11]) { rect(gx, 7, 3, 1, '#cfd6dc'); rect(gx, 10, 3, 1, '#cfd6dc'); } }
    if (!look.hood) { set(9, 11, '#b5543c'); set(10, 11, '#b5543c'); }
  }
  const colonist = (look, frame, flip, headOnly) => art(`p${look.shirt}${look.hair}${look.name || ''}${look.hood || ''}${frame}${flip}${headOnly}`, 10, headOnly ? 7 : 14, (P) => person(P, look, frame, flip, headOnly));

  // ---------- terrain: painted once for the whole map ----------
  function terrainCanvas(terrain, W, H, T, TS) {
    const cw = W * TS * RES, ch = H * TS * RES, tp = TS * RES;
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    const img = g.createImageData(cw, ch);
    const d = img.data;
    const at = (x, y) => terrain[Math.min(H - 1, Math.max(0, Math.floor(y / tp))) * W + Math.min(W - 1, Math.max(0, Math.floor(x / tp)))];
    const put = (i, hex) => { const [r, gg, b] = rgb(hex); d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255; };
    const GR = ['#528a34', '#5b973b', '#64a342', '#6dad49', '#77b651'];
    const DI = ['#735636', '#7f613d', '#8a6b44', '#96764c'];
    const SA = ['#c4ae74', '#cdb97f', '#d6c48b', '#dfce98'];
    const WA = ['#2c6292', '#326da0', '#3877ab'];
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        // soften borders: sample a jittered neighbor near tile edges
        const jx = x + Math.round((hash(x, y, 21) - 0.5) * 5), jy = y + Math.round((hash(x, y, 22) - 0.5) * 5);
        let t = at(x, y);
        const tj = at(jx, jy);
        if (tj !== t && t !== T.FLOOR && tj !== T.FLOOR && t !== T.WATER) t = tj;
        const n = vnoise(x / 11, y / 11, 1) * 0.7 + hash(x >> 1, y >> 1, 2) * 0.3;
        if (t === T.GRASS) put(i, GR[Math.min(4, Math.floor(n * 5))]);
        else if (t === T.DIRT) put(i, DI[Math.min(3, Math.floor(n * 4))]);
        else if (t === T.SAND) put(i, SA[Math.min(3, Math.floor(n * 4))]);
        else if (t === T.WATER) {
          const shore = at(x - 4, y) !== T.WATER || at(x + 4, y) !== T.WATER || at(x, y - 4) !== T.WATER || at(x, y + 4) !== T.WATER;
          put(i, shore ? (hash(x, y, 5) < 0.5 ? '#6ea3d6' : '#4a8ac0') : WA[Math.min(2, Math.floor(vnoise(x / 17, y / 17, 3) * 3))]);
        } else if (t === T.FLOOR) {
          const row = Math.floor(y / 8), r = y % 8;
          const seam = (x + row * 13) % 40 === 0;
          const tone = PAL.wood[2 + (hash(Math.floor((x + row * 13) / 40), row, 4) < 0.5 ? 0 : 1)];
          put(i, r === 7 || seam ? PAL.wood[0] : r === 0 ? PAL.wood[4] : hash(x >> 3, y, 6) < 0.1 ? PAL.wood[1] : tone);
        }
      }
    }
    // grass blades and flowers, pebbles on dirt
    for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
      const t = terrain[ty * W + tx];
      const bx = tx * tp, by = ty * tp;
      if (t === T.GRASS) {
        for (let k = 0; k < 7; k++) {
          const x = bx + Math.floor(hash(tx, ty, k) * (tp - 2)), y = by + Math.floor(hash(tx, ty, k + 30) * (tp - 4));
          const col = hash(tx, ty, k + 60) < 0.5 ? '#86c45e' : '#467a2c';
          for (let j = 0; j < 3; j++) put(((y + j) * cw + x + (j === 0 && k % 2 ? 1 : 0)) * 4, col);
        }
        if (hash(tx, ty, 99) < 0.1) {
          const x = bx + 6 + Math.floor(hash(tx, ty, 98) * 18), y = by + 6 + Math.floor(hash(tx, ty, 97) * 18);
          const col = hash(tx, ty, 96) < 0.5 ? '#f1d24a' : '#f4f0e8';
          for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) put(((y + dy) * cw + x + dx) * 4, col);
          put((y * cw + x) * 4, '#e0a020');
        }
      } else if (t === T.DIRT) {
        for (let k = 0; k < 3; k++) {
          const x = bx + 2 + Math.floor(hash(tx, ty, k + 5) * (tp - 5)), y = by + 2 + Math.floor(hash(tx, ty, k + 40) * (tp - 5));
          put((y * cw + x) * 4, '#b0a28c'); put((y * cw + x + 1) * 4, '#9a8c76'); put(((y + 1) * cw + x) * 4, '#5e4a33'); put(((y + 1) * cw + x + 1) * 4, '#5e4a33');
        }
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }

  const SPR = {
    tree, bush, bed, table, heater, stove, campfire, keeper, logs, crate, axe, pick: pickMark, potato, berries, meal, medicine, preserved,
    grave, fire, stockTile, soil, crop, healroot, bench, smoker, windmill, cooler, eheater, barricade, trap, wall, door,
  };
  M.art = { RES, SPR, colonist, terrainCanvas, shade, cache };
})();
