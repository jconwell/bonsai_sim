// Bonsai UI: rendering, input, time control and saving. Simulation is in sim.js.
(() => {
  'use strict';

  const { YEAR, MONTHS, SEASON_STARTS, BUD_BREAK, COLOR, BARE, seasonOf, dateOf } = BonsaiConst;
  const SAVE_KEY = 'bonsai-save-v1';
  const PREFS_KEY = 'bonsai-prefs-v1';
  const CM_PER_UNIT = 0.25;
  const AUTOSAVE_MS = 15000;

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  let ctx = canvas.getContext('2d');
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  const prefs = loadPrefs();
  let tree = loadSave();
  const firstRun = !tree;
  if (!tree) tree = new Bonsai();

  let speed = prefs.speed ?? 7;
  let pausedSpeed = speed || 7;
  let tool = prefs.tool || 'prune';
  let undoStack = [];
  let hover = null;
  let mouse = null;
  let drag = null;
  let acc = 0;
  let last = performance.now();
  let dirty = false;
  let lastSave = Date.now();
  let lastPanel = 0;
  let backBudToast = { count: 0, at: 0 };
  let W = 0, H = 0, dpr = 1;
  const cam = { x: 0, y: 60, s: 3, auto: true };

  // ---- Persistence --------------------------------------------------------

  function loadSave() {
    try {
      const text = localStorage.getItem(SAVE_KEY);
      return text ? Bonsai.fromJSON(text) : null;
    } catch (err) {
      console.warn('Could not load save', err);
      return null;
    }
  }

  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
  }

  function save() {
    try {
      localStorage.setItem(SAVE_KEY, tree.serialize());
      localStorage.setItem(PREFS_KEY, JSON.stringify({ speed, tool }));
      dirty = false;
      lastSave = Date.now();
      $('saved').textContent = 'Saved at ' + new Date().toLocaleTimeString();
    } catch (err) {
      console.error(err);
      toast('Could not save. Browser storage may be full. Try Export.');
    }
  }

  function setTree(next) {
    tree = next;
    hover = null;
    cam.auto = true;
    $('deadModal').hidden = !tree.dead;
    dirty = true;
    save();
    updatePanel();
    showSeasonBanner();
  }

  function pushUndo() {
    undoStack.push(tree.serialize());
    if (undoStack.length > 25) undoStack.shift();
  }

  function undo() {
    if (!undoStack.length) return;
    setTree(Bonsai.fromJSON(undoStack.pop()));
    cam.auto = false;
    toast('Undone');
  }

  // ---- Camera -------------------------------------------------------------

  const sx = (x) => W / 2 + (x - cam.x) * cam.s;
  const sy = (y) => H / 2 - (y - cam.y) * cam.s;
  const wx = (px) => (px - W / 2) / cam.s + cam.x;
  const wy = (py) => cam.y - (py - H / 2) / cam.s;

  function fitTarget() {
    const b = tree.bounds;
    const minX = Math.min(b.minX, -80) - 12, maxX = Math.max(b.maxX, 80) + 12;
    const minY = -48, maxY = Math.max(b.maxY, 60) + 16;
    const s = Math.min(W / (maxX - minX), H / (maxY - minY)) * 0.94;
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, s: Math.min(s, 9) };
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = canvas.getBoundingClientRect();
    W = r.width;
    H = r.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  // ---- Drawing ------------------------------------------------------------
  // Anime look: ink outlines, flat two-tone cel shading and a painted sky.

  const INK = '#2a1c16';
  const inkWidth = () => clamp(cam.s * 0.45, 1.2, 3);

  function hexRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
  function toHex(c) { return '#' + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join(''); }
  function mix(a, b, t) {
    const x = hexRgb(a), y = hexRgb(b);
    return toHex(x.map((v, i) => lerp(v, y[i], t)));
  }

  // Holds each season's palette, crossfading into the next over the last
  // fifth of the season.
  function seasonal(table) {
    const i = seasonOf(tree.dayOfYear);
    const start = SEASON_STARTS[i];
    const end = i === 3 ? SEASON_STARTS[0] + YEAR : SEASON_STARTS[i + 1];
    const d = tree.dayOfYear < start ? tree.dayOfYear + YEAR : tree.dayOfYear;
    const k = clamp(((d - start) / (end - start) - 0.8) / 0.2, 0, 1);
    return table[i].map((c, j) => mix(c, table[(i + 1) % 4][j], k));
  }

  // sky top, horizon, cloud, cloud shadow
  const SKY = [
    ['#7fbcec', '#fde3ee', '#fffafc', '#dccbe8'],
    ['#3f97e4', '#c4e8fb', '#ffffff', '#b4cfe9'],
    ['#de7a55', '#fbd6a4', '#fff4e4', '#e9ac8c'],
    ['#9db5d2', '#e9eff6', '#ffffff', '#c6d0de'],
  ];
  const HILLS = [
    ['#a7cfb0', '#86b996'],
    ['#86bba6', '#62a08a'],
    ['#d0a283', '#b38266'],
    ['#bcc8d8', '#9eaec3'],
  ];

  const clouds = Array.from({ length: 6 }, (_, i) => makeCloud(i / 6 * 1.4 - 0.2));
  function makeCloud(x) {
    const n = 4 + Math.floor(Math.random() * 3);
    const puffs = [];
    for (let j = 0; j < n; j++) {
      const middle = j > 0 && j < n - 1;
      puffs.push({ dx: (j - (n - 1) / 2) * 0.55 + (Math.random() - 0.5) * 0.2,
        dy: -Math.random() * 0.3 - (middle ? 0.25 : 0), r: 0.42 + Math.random() * 0.3 + (middle ? 0.1 : 0) });
    }
    return { x, y: 0.06 + Math.random() * 0.28, size: 26 + Math.random() * 34,
      speed: 0.004 + Math.random() * 0.006, n, puffs };
  }

  function drawSky() {
    const [top, horizon] = seasonal(SKY);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, top);
    g.addColorStop(0.7, horizon);
    g.addColorStop(1, horizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const sun = ctx.createRadialGradient(W * 0.16, H * 0.1, 0, W * 0.16, H * 0.1, Math.max(W, H) * 0.5);
    sun.addColorStop(0, 'rgba(255,255,236,0.6)');
    sun.addColorStop(1, 'rgba(255,255,236,0)');
    ctx.fillStyle = sun;
    ctx.fillRect(0, 0, W, H);
  }

  function cloudPath(c, dy) {
    const cx = c.x * W, cy = c.y * H + dy, s = c.size;
    const p = new Path2D();
    p.ellipse(cx, cy, s * c.n * 0.3, s * 0.32, 0, 0, Math.PI * 2);
    for (const f of c.puffs) {
      p.moveTo(cx + f.dx * s + f.r * s, cy + f.dy * s);
      p.arc(cx + f.dx * s, cy + f.dy * s, f.r * s, 0, Math.PI * 2);
    }
    return p;
  }

  function drawClouds() {
    const [, , light, dark] = seasonal(SKY);
    for (const c of clouds) {
      ctx.fillStyle = dark;
      ctx.fill(cloudPath(c, c.size * 0.14));
      ctx.fillStyle = light;
      ctx.fill(cloudPath(c, 0));
    }
  }

  function drawHills() {
    const hy = sy(-37);
    if (hy < 0) return;
    const [far, near] = seasonal(HILLS);
    const ridge = (amp, f1, f2, ph, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, hy);
      for (let x = 0; x <= W + 8; x += 8) {
        const u = x / W;
        ctx.lineTo(x, hy - amp * (0.55 + 0.3 * Math.sin(u * f1 + ph) + 0.15 * Math.sin(u * f2 + ph * 2)));
      }
      ctx.lineTo(W, hy);
      ctx.fill();
    };
    ridge(H * 0.16, 5.3, 13, 1.1, far);
    ridge(H * 0.08, 7.1, 19, 2.6, near);
  }

  function drawTable() {
    const ty = sy(-37);
    if (ty > H) return;
    ctx.fillStyle = '#b77f55';
    ctx.fillRect(0, ty, W, H - ty);
    ctx.fillStyle = '#d69d6e';
    ctx.fillRect(0, ty, W, Math.max(3, 1.8 * cam.s));
    ctx.strokeStyle = 'rgba(42,28,22,0.22)';
    ctx.lineWidth = 1;
    for (let k = 1; k < 5; k++) {
      const y = ty + k * Math.max(10, 5 * cam.s);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = inkWidth();
    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke();
    // Pot shadow
    ctx.fillStyle = 'rgba(60,30,15,0.25)';
    ctx.beginPath();
    ctx.ellipse(sx(4), sy(-37.5), 80 * cam.s, 3.5 * cam.s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function poly(points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(sx(x), sy(y)) : ctx.moveTo(sx(x), sy(y))));
    ctx.closePath();
  }

  function inked(points, fill) {
    poly(points);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.stroke();
  }

  // Pot glazes: body, shadow side, shine, rim, rim top, feet.
  const GLAZES = [
    ['#3e5b8c', '#2d4572', '#7397cc', '#4b6ba2', '#86a8dc', '#27324d'], // indigo
    ['#7fae96', '#5e8e77', '#bfe3d0', '#8dbea5', '#c9ecda', '#3d5c4d'], // celadon
    ['#e0d3b6', '#c2b392', '#fbf5e4', '#eadfc6', '#fffaf0', '#8a7d64'], // cream
    ['#a45a3a', '#82442a', '#d68d69', '#b2684a', '#de9d7d', '#5c3020'], // terracotta
    ['#8c2f33', '#6b2226', '#c75e60', '#9c3a3e', '#d67e7e', '#4a1618'], // oxblood
    ['#504c4a', '#3a3735', '#807a76', '#5e5a58', '#918b86', '#2a2726'], // charcoal
  ];
  const glaze = () => GLAZES[tree.pot?.glaze ?? 0] || GLAZES[0];

  function drawPot() {
    const [body, shade, shine, , , feet] = glaze();
    const round = tree.pot?.shape === 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = inkWidth();
    ctx.lineJoin = 'round';
    if (round) {
      // A deep, round bowl.
      inked([[-31, -29], [-19, -29], [-20, -37], [-30, -37]], feet);
      inked([[19, -29], [31, -29], [30, -37], [20, -37]], feet);
      const bowl = new Path2D();
      bowl.moveTo(sx(-68), sy(-6));
      bowl.lineTo(sx(68), sy(-6));
      bowl.ellipse(sx(0), sy(-6), 68 * cam.s, 26 * cam.s, 0, 0, Math.PI);
      bowl.closePath();
      ctx.fillStyle = body;
      ctx.fill(bowl);
      ctx.save();
      ctx.clip(bowl);
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.ellipse(sx(14), sy(-12), 62 * cam.s, 28 * cam.s, 0, -0.5, Math.PI * 0.75);
      ctx.lineTo(sx(80), sy(-40));
      ctx.lineTo(sx(80), sy(-6));
      ctx.fill();
      ctx.fillStyle = shine;
      ctx.beginPath();
      ctx.ellipse(sx(-46), sy(-14), 4 * cam.s, 8 * cam.s, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.stroke(bowl);
      return;
    }
    inked([[-50, -31], [-38, -31], [-39, -37], [-49, -37]], feet);
    inked([[38, -31], [50, -31], [49, -37], [39, -37]], feet);
    const outline = [[-66, -6], [66, -6], [57, -32], [-57, -32]];
    poly(outline); ctx.fillStyle = body; ctx.fill();
    poly([[24, -6], [66, -6], [57, -32], [20, -32]]); ctx.fillStyle = shade; ctx.fill();
    poly([[-59, -9], [-51, -9], [-45, -29], [-51, -29]]); ctx.fillStyle = shine; ctx.fill();
    poly(outline); ctx.stroke();
  }

  // Drawn after the wood so the trunk disappears into the soil.
  function drawRim() {
    const [, shade, , rimColor, rimTop] = glaze();
    ctx.strokeStyle = INK;
    ctx.lineWidth = inkWidth();
    const rim = [[-72, 1], [72, 1], [71, -6], [-71, -6]];
    poly(rim); ctx.fillStyle = rimColor; ctx.fill();
    poly([[30, 1], [72, 1], [71, -6], [28, -6]]); ctx.fillStyle = shade; ctx.fill();
    poly([[-72, 1], [72, 1], [72, -0.9], [-72, -0.9]]); ctx.fillStyle = rimTop; ctx.fill();
    poly(rim); ctx.stroke();
    inked([[-69, 2], [69, 2], [69, 0.4], [-69, 0.4]], '#4b3326');
    // Moss
    const moss = new Path2D();
    for (let x = -64; x <= 64; x += 7) {
      const r = (1.7 + ((x * 37) & 7) / 6) * cam.s;
      const cx = sx(x + ((x * 13) & 3)), cy = sy(2);
      moss.moveTo(cx + r, cy);
      moss.ellipse(cx, cy, r, r * 0.55, 0, Math.PI, 0);
    }
    ctx.fillStyle = '#86c159';
    ctx.fill(moss);
    ctx.lineWidth = Math.max(1, inkWidth() * 0.6);
    ctx.stroke(moss);
  }

  const BARK_YOUNG = [146, 184, 92], BARK = [142, 94, 60], BARK_OLD = [128, 108, 94], BARK_DEAD = [150, 140, 130];

  function barkRgb(seg) {
    if (seg.dead) return BARK_DEAD;
    const age = clamp((tree.day - seg.born) / 220, 0, 1);
    const old = clamp((seg.g - 2.5) / 8, 0, 1);
    return BARK_YOUNG.map((v, i) => lerp(lerp(v, BARK[i], age), BARK_OLD[i], old));
  }
  const rgb = (c) => `rgb(${c.map((v) => Math.round(clamp(v, 0, 255))).join(',')})`;
  const darker = (c) => c.map((v) => v * 0.7);
  const lighter = (c) => c.map((v) => v + (255 - v) * 0.28);

  function line(seg, t0, t1) {
    ctx.beginPath();
    ctx.moveTo(sx(lerp(seg.x0, seg.x1, t0)), sy(lerp(seg.y0, seg.y1, t0)));
    ctx.lineTo(sx(lerp(seg.x0, seg.x1, t1)), sy(lerp(seg.y0, seg.y1, t1)));
    ctx.stroke();
  }

  // A line along a section, shifted sideways by `off` world units
  // (positive = right-hand side, away from the light).
  function sideLine(seg, off, t0 = 0, t1 = 1) {
    const px = Math.cos(seg.a) * off, py = -Math.sin(seg.a) * off;
    ctx.beginPath();
    ctx.moveTo(sx(lerp(seg.x0, seg.x1, t0) + px), sy(lerp(seg.y0, seg.y1, t0) + py));
    ctx.lineTo(sx(lerp(seg.x0, seg.x1, t1) + px), sy(lerp(seg.y0, seg.y1, t1) + py));
    ctx.stroke();
  }

  function drawNebari() {
    const base = tree.segs[0];
    if (!base) return;
    const g = base.g;
    const c = barkRgb(base);
    ctx.strokeStyle = INK;
    ctx.lineWidth = inkWidth();
    for (const [dir, reach, rise] of [[-1, 3.3, 1.2], [1, 3.0, 1.1], [-1, 1.9, 0.8], [1, 2.3, 0.9]]) {
      ctx.beginPath();
      ctx.moveTo(sx(dir * g * 0.2), sy(g * rise * 1.4));
      ctx.quadraticCurveTo(sx(dir * g * 0.9), sy(g * 0.25), sx(dir * g * reach), sy(1.2));
      ctx.lineTo(sx(dir * g * 0.1), sy(1.2));
      ctx.fillStyle = rgb(dir > 0 ? darker(c) : c);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx(dir * g * 0.2), sy(g * rise * 1.4));
      ctx.quadraticCurveTo(sx(dir * g * 0.9), sy(g * 0.25), sx(dir * g * reach), sy(1.2));
      ctx.stroke();
    }
  }

  // Keep the trunk's rounded end from poking out below the soil.
  function clipAboveSoil() {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, sy(0.6));
    ctx.clip();
  }

  function drawWood() {
    const s = cam.s, ink = inkWidth();
    clipAboveSoil();
    ctx.lineCap = 'round';
    // Ink outline: thin twigs are drawn as plain ink lines, anime style.
    ctx.strokeStyle = INK;
    for (const seg of tree.segs) {
      const w = 2 * seg.g * s;
      ctx.lineWidth = w < 1.5 ? Math.max(1, w) : w + 2 * ink;
      line(seg, 0, 1);
    }
    for (const seg of tree.segs) {
      const w = 2 * seg.g * s;
      if (w < 1.5) continue;
      ctx.strokeStyle = rgb(barkRgb(seg));
      ctx.lineWidth = w;
      line(seg, 0, 1);
    }
    // Flat shadow on the side away from the light, and a highlight stripe.
    for (const seg of tree.segs) {
      const w = 2 * seg.g * s;
      if (w < 4) continue;
      const c = barkRgb(seg);
      ctx.strokeStyle = rgb(darker(c));
      ctx.lineWidth = w * 0.4;
      sideLine(seg, seg.g * 0.42);
      if (w < 16 || seg.dead) continue;
      ctx.strokeStyle = rgb(lighter(c));
      ctx.lineWidth = Math.max(1.2, w * 0.1);
      sideLine(seg, -seg.g * 0.5, 0.1, 0.9);
    }
    ctx.restore();
  }

  // Snow settles on the upper side of the more horizontal branches.
  function snowCover(d) {
    if (d >= 344) return clamp((d - 344) / 15, 0, 1);
    if (d < 46) return 1;
    if (d < 56) return 1 - (d - 46) / 10;
    return 0;
  }

  function drawSnow() {
    const c = snowCover(tree.dayOfYear);
    if (!c) return;
    const s = cam.s;
    ctx.lineCap = 'round';
    for (const seg of tree.segs) {
      const flat = Math.abs(Math.sin(seg.a));
      if (flat < 0.35 || seg.g * s < 0.8) continue;
      const up = Math.sin(seg.a) > 0 ? -1 : 1;
      ctx.lineWidth = Math.max(1.5, seg.g * 0.9 * s * c * flat);
      ctx.strokeStyle = '#cfe0f2';
      sideLine(seg, up * seg.g * 0.55, 0.12, 0.88);
      ctx.strokeStyle = '#ffffff';
      sideLine(seg, up * seg.g * 0.75, 0.12, 0.88);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = inkWidth() * 0.7;
    poly([[-72.5, 1], [72.5, 1], [72.5, 1 + 2.6 * c], [-72.5, 1 + 2.6 * c]]);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
  }

  const hash = (n) => {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  // Foliage tones [shadow, light]. Autumn has three variants so the canopy
  // turns a mix of crimson, orange and gold.
  const LEAF_SPRING = ['#6fb03e', '#b3e45f'];
  const LEAF_SUMMER = ['#2f7a36', '#5fb946'];
  const LEAF_AUTUMN = [
    ['#a3262b', '#e84a38'],
    ['#c4561a', '#f49a36'],
    ['#bf8a17', '#f5cb48'],
  ];

  function padColors(d) {
    const spring = clamp(1 - (d - BUD_BREAK - 16) / 45, 0, 1);
    const autumn = clamp((d - COLOR) / 32, 0, 1);
    const base = LEAF_SUMMER.map((c, j) => mix(c, LEAF_SPRING[j], spring));
    return LEAF_AUTUMN.map((a) => base.map((c, j) => mix(c, a[j], autumn)));
  }

  // Japanese maple leaf, drawn once per colour into a small image and then
  // stamped (rotated and scaled) for every leaf on the tree.
  const LEAF_PX = 96;
  const LEAF_LOBES = [[-112, 0.45], [-70, 0.78], [-34, 0.94], [0, 1], [34, 0.94], [70, 0.78], [112, 0.45]];
  const LEAF_PALM = [LEAF_PX / 2, LEAF_PX * 0.6];
  const LEAF_R = LEAF_PX * 0.36;
  const LEAF_STEM = LEAF_PX * 0.84;

  function leafPoint(deg, r) {
    const a = deg * Math.PI / 180;
    return [LEAF_PALM[0] + Math.sin(a) * r * LEAF_R, LEAF_PALM[1] - Math.cos(a) * r * LEAF_R];
  }

  function leafShape() {
    const p = new Path2D();
    p.moveTo(...leafPoint(-150, 0.2));
    LEAF_LOBES.forEach(([a, len], i) => {
      const sinus = i ? (LEAF_LOBES[i - 1][0] + a) / 2 : -135;
      p.lineTo(...leafPoint(sinus, 0.38));
      p.quadraticCurveTo(...leafPoint(a - 17, len * 0.72), ...leafPoint(a, len));
      p.quadraticCurveTo(...leafPoint(a + 17, len * 0.72), ...leafPoint(a + 15, len * 0.46));
    });
    p.lineTo(...leafPoint(135, 0.38));
    p.lineTo(...leafPoint(150, 0.2));
    p.closePath();
    return p;
  }

  function makeLeafSprite(light, shadow) {
    const c = document.createElement('canvas');
    c.width = c.height = LEAF_PX;
    const g = c.getContext('2d');
    const shape = leafShape();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = INK;
    g.lineWidth = LEAF_PX * 0.035;
    g.beginPath();
    g.moveTo(...LEAF_PALM);
    g.lineTo(LEAF_PX / 2, LEAF_STEM);
    g.stroke();
    g.fillStyle = light;
    g.fill(shape);
    // Flat cel shadow over one half of the leaf.
    g.save();
    g.clip(shape);
    g.fillStyle = shadow;
    g.fillRect(LEAF_PX / 2, 0, LEAF_PX / 2, LEAF_PX);
    g.restore();
    g.strokeStyle = shadow;
    g.lineWidth = LEAF_PX * 0.02;
    g.beginPath();
    for (const [a, len] of LEAF_LOBES) {
      g.moveTo(...LEAF_PALM);
      g.lineTo(...leafPoint(a, len * 0.78));
    }
    g.stroke();
    g.strokeStyle = INK;
    g.lineWidth = LEAF_PX * 0.028;
    g.stroke(shape);
    return c;
  }

  // Two shades per colour region, rebuilt only when the season's palette shifts.
  let leafSprites = { key: '', list: [] };
  function spritesFor(d) {
    const colors = padColors(d);
    const key = colors.flat().join();
    if (key !== leafSprites.key) {
      const list = [];
      for (const [shadow, light] of colors) {
        list.push(makeLeafSprite(light, shadow));
        list.push(makeLeafSprite(mix(light, '#ffffff', 0.15), mix(shadow, light, 0.25)));
      }
      leafSprites = { key, list };
    }
    return leafSprites.list;
  }

  // Leaves grow in opposite pairs at each node of the young shoots, with an
  // extra pair at growing tips. Vigorous shoots carry big leaves; finely
  // ramified twigs carry small ones.
  function drawLeaves() {
    const d = tree.dayOfYear;
    if (d < BUD_BREAK || d >= BARE) return;
    const grow = clamp((d - BUD_BREAK) / 30, 0, 1);
    const fallen = clamp((d - (COLOR + 18)) / (BARE - COLOR - 20), 0, 1);
    const sprites = spritesFor(d);
    const s = cam.s;
    for (const seg of tree.segs) {
      if (!seg.leafy) continue;
      const len = (2.6 + seg.tLen * 0.35) * grow * s;
      if (len < 1.5) continue;
      // Colour region, so whole parts of the tree turn the same shade in autumn.
      const k = Math.floor(hash((Math.floor(seg.x1 / 22) + 500) * 977 + Math.floor(seg.y1 / 22)) * 3);
      const x = sx(seg.x1), y = sy(seg.y1);
      const count = seg.apex ? 4 : 2;
      for (let j = 0; j < count; j++) {
        const h = hash(seg.id * 4 + j + 1);
        if (h < fallen) continue;
        const terminal = j >= 2;
        const side = j % 2 ? 1 : -1;
        const a = seg.a + side * (terminal ? 0.2 + h * 0.25 : 0.55 + h * 0.5);
        const scale = len * (terminal ? 0.7 : 1) * (0.85 + 0.3 * hash(seg.id * 9 + j)) / LEAF_R;
        const c = Math.cos(a) * scale * dpr, sn = Math.sin(a) * scale * dpr;
        ctx.setTransform(c, sn, -sn, c, x * dpr, y * dpr);
        ctx.drawImage(sprites[k * 2 + (h > 0.55 ? 1 : 0)], -LEAF_PX / 2, -LEAF_STEM);
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function circle(p, x, y, r) {
    p.moveTo(x + r, y);
    p.arc(x, y, r, 0, Math.PI * 2);
  }

  function budPos(seg, b) {
    const off = seg.g * 0.8 + 0.5;
    return [
      lerp(seg.x0, seg.x1, b.t) + Math.cos(seg.a) * b.s * off,
      lerp(seg.y0, seg.y1, b.t) - Math.sin(seg.a) * b.s * off,
    ];
  }

  // Dormant buds are drawn small (they are everywhere) and hidden inside the
  // foliage unless the Pinch tool is active. Back buds always stand out.
  function drawBuds() {
    const s = cam.s, d = tree.dayOfYear, pinch = tool === 'pinch';
    const bare = d < BUD_BREAK + 6 || d >= BARE - 12;
    const showDormant = pinch || bare;
    const dormant = new Path2D(), back = new Path2D(), glint = new Path2D(), tips = new Path2D();
    const rb = pinch ? Math.max(2.2, 0.85 * s) : Math.max(1.1, 0.5 * s);
    const rk = Math.max(2.8, 1.25 * s), rt = Math.max(1.6, 0.65 * s);
    for (const seg of tree.segs) {
      if (seg.dead) continue;
      for (const b of seg.buds) {
        if (!b.back && !showDormant) continue;
        const [x, y] = budPos(seg, b);
        if (b.back) {
          circle(back, sx(x), sy(y), rk);
          circle(glint, sx(x) - rk * 0.35, sy(y) - rk * 0.35, rk * 0.3);
        } else {
          circle(dormant, sx(x), sy(y), rb);
        }
      }
      if (seg.apex && (pinch || bare)) circle(tips, sx(seg.x1), sy(seg.y1), rt);
    }
    ctx.strokeStyle = INK;
    ctx.fillStyle = pinch ? '#d0583e' : '#6b3326';
    ctx.fill(dormant);
    if (pinch) { ctx.lineWidth = 1; ctx.stroke(dormant); }
    ctx.fillStyle = '#b8f56a';
    ctx.fill(back);
    ctx.lineWidth = 1.4;
    ctx.stroke(back);
    ctx.fillStyle = '#ffffff';
    ctx.fill(glint);
    ctx.fillStyle = tree.growing ? '#d8f7a0' : '#8a5e2e';
    ctx.fill(tips);
    if (pinch) { ctx.lineWidth = 1.2; ctx.stroke(tips); }
  }

  // ---- Ambient particles: petals, falling leaves, snow --------------------

  const particles = [];
  let spawnAcc = 0;

  function spawnParticle(kind) {
    let x = Math.random() * (W + 100), y = -10;
    if (kind === 'leaf') {
      const seg = tree.segs[Math.floor(Math.random() * tree.segs.length)];
      if (!seg || !seg.leafy) return;
      x = sx(seg.x1);
      y = sy(seg.y1);
    }
    const colors = { petal: ['#f9c4d2', '#fde2ea', '#f6aec2'], leaf: ['#d8402e', '#ee7a2e', '#f2b33a'], snow: ['#ffffff'] }[kind];
    particles.push({
      kind, x, y, t: 0, alpha: 1, ph: Math.random() * 6, wob: 1 + Math.random() * 2,
      vx: kind === 'snow' ? -10 : -22, vy: kind === 'snow' ? 28 + Math.random() * 30 : 30 + Math.random() * 25,
      sway: kind === 'snow' ? 14 : 34, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 4,
      size: kind === 'snow' ? 1.5 + Math.random() * 2 : 3 + Math.random() * 2.5,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  function updateScene(dt) {
    for (const c of clouds) {
      c.x += c.speed * dt;
      if (c.x > 1.3) Object.assign(c, makeCloud(-0.3));
    }
    const d = tree.dayOfYear;
    // Cherry petals drift past in early spring; leaves fall from the tree in
    // late autumn; snow falls in the depth of winter.
    const kind = d >= BUD_BREAK - 10 && d < BUD_BREAK + 30 ? 'petal'
      : d >= COLOR + 18 && d < BARE ? 'leaf'
      : d >= 349 || d < 40 ? 'snow' : null;
    const rate = { petal: 3, leaf: 7, snow: 20 }[kind] || 0;
    spawnAcc = kind ? spawnAcc + rate * dt : 0;
    while (spawnAcc >= 1) {
      spawnAcc--;
      if (particles.length < 180) spawnParticle(kind);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.t += dt;
      p.x += (p.vx + Math.sin(p.t * p.wob + p.ph) * p.sway) * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      // Fast-forwarding changes season quicker than things fall; fade out
      // particles that belong to a previous season.
      if (p.kind !== kind) p.alpha -= dt * 1.5;
      if (p.y > H + 20 || p.x < -40 || p.alpha <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = INK;
    for (const p of particles) {
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      if (p.kind === 'snow') {
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.ellipse(p.x, p.y, p.size, p.size * 0.55 * Math.abs(Math.cos(p.t * 2 + p.ph)) + 0.6, p.rot, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Wire is wrapped at 55° to the branch: each visible pass crosses the
  // front of the branch at that angle, then runs round the back.
  const WIRE_TAN = Math.tan(55 * Math.PI / 180);

  function spiral(seg, path, r, start) {
    const run = 2 * r / WIRE_TAN;
    const px = Math.cos(seg.a), py = -Math.sin(seg.a);
    for (let u = start * run; u < seg.len; u += 2 * run) {
      const end = Math.min(seg.len, u + run);
      const side = r - 2 * r * (end - u) / run;
      path.moveTo(sx(lerp(seg.x0, seg.x1, u / seg.len) + px * r), sy(lerp(seg.y0, seg.y1, u / seg.len) + py * r));
      path.lineTo(sx(lerp(seg.x0, seg.x1, end / seg.len) + px * side), sy(lerp(seg.y0, seg.y1, end / seg.len) + py * side));
    }
  }

  // Copper wire coiled around a section.
  function coil(seg, path) {
    spiral(seg, path, seg.g + 0.35, 0);
  }

  function drawWire() {
    const ok = new Path2D(), biting = new Path2D(), scars = new Path2D();
    let any = false;
    for (const seg of tree.segs) {
      if (seg.scar) {
        // Old wire scars: dark spiral marks left in the bark.
        spiral(seg, scars, seg.g * 0.8, 0.3);
      }
      if (seg.w) { coil(seg, seg.w.bit ? biting : ok); any = true; }
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(45,28,18,0.55)';
    ctx.lineWidth = Math.max(1, 0.45 * cam.s);
    ctx.stroke(scars);
    if (!any) return;
    ctx.lineWidth = Math.max(1.2, 0.5 * cam.s);
    ctx.strokeStyle = '#c8803f';
    ctx.stroke(ok);
    ctx.strokeStyle = '#e0452a';
    ctx.stroke(biting);
  }

  function drawHover() {
    if (!hover) return;
    const s = cam.s;
    if (hover.kind === 'wire') {
      ctx.lineCap = 'round';
      if (hover.seg.w) {
        // Highlight the section that will pivot, and its pivot point.
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = Math.max(2, 2 * hover.seg.g * s + 3);
        line(hover.seg, 0, 1);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(sx(hover.seg.x0), sy(hover.seg.y0), Math.max(3, 0.8 * s), 0, Math.PI * 2);
        ctx.fill();
      } else if (!hover.seg.dead) {
        const preview = new Path2D();
        for (const id of hover.chain) coil(tree.byId.get(id), preview);
        ctx.strokeStyle = 'rgba(200,128,63,0.7)';
        ctx.lineWidth = Math.max(1.2, 0.5 * s);
        ctx.stroke(preview);
      }
      return;
    }
    if (hover.kind === 'cut') {
      const seg = hover.seg;
      ctx.lineCap = 'round';
      ctx.strokeStyle = hover.ok ? 'rgba(220,50,40,0.75)' : 'rgba(120,120,120,0.6)';
      for (const other of tree.segs) {
        if (!hover.removed.has(other.id)) continue;
        ctx.lineWidth = Math.max(2, 2 * other.g * s + 1);
        line(other, 0, 1);
      }
      if (!hover.removed.has(seg.id) && hover.ok) {
        ctx.lineWidth = Math.max(2, 2 * seg.g * s + 1);
        line(seg, hover.t, 1);
      }
      // Cut mark across the branch
      const x = lerp(seg.x0, seg.x1, hover.t), y = lerp(seg.y0, seg.y1, hover.t);
      const half = seg.g * s + 5;
      const px = Math.cos(seg.a), py = Math.sin(seg.a);
      ctx.lineCap = 'butt';
      for (const [w, c] of [[4, 'rgba(40,30,20,0.8)'], [2, '#fff']]) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(sx(x) - px * half, sy(y) - py * half);
        ctx.lineTo(sx(x) + px * half, sy(y) + py * half);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx(hover.x), sy(hover.y), Math.max(6, 1.8 * s), 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSky();
    drawClouds();
    drawHills();
    drawTable();
    drawPot();
    drawWood();
    drawRim();
    drawNebari();
    drawSnow();
    drawWire();
    // Fade foliage while wiring so the branch structure is visible.
    if (tool === 'wire') ctx.globalAlpha = 0.4;
    drawLeaves();
    ctx.globalAlpha = 1;
    drawBuds();
    drawParticles();
    drawHover();
    drawBanner();
  }

  // ---- Picking ------------------------------------------------------------

  function updateHover() {
    hover = null;
    const tip = $('tooltip');
    if (drag?.bend) { tip.hidden = !drag.limited; return; }
    if (!mouse || drag?.moved || tree.dead) { tip.hidden = true; return; }
    const x = wx(mouse.x), y = wy(mouse.y);
    hover = tool === 'prune' ? pickCut(x, y) : tool === 'wire' ? pickWire(x, y) : pickBud(x, y);
    if (!hover) { tip.hidden = true; return; }
    tip.hidden = false;
    tip.style.left = mouse.x + 'px';
    tip.style.top = mouse.y + 'px';
    tip.textContent = hoverText();
  }

  function pickSeg(x, y) {
    let best = null, bestScore = Infinity;
    for (const seg of tree.segs) {
      const dx = seg.x1 - seg.x0, dy = seg.y1 - seg.y0;
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((x - seg.x0) * dx + (y - seg.y0) * dy) / len2, 0, 1);
      const d = Math.hypot(seg.x0 + dx * t - x, seg.y0 + dy * t - y);
      if (d > Math.max(7 / cam.s, seg.g + 3 / cam.s)) continue;
      const score = d - seg.g;
      if (score < bestScore) { bestScore = score; best = { seg, t }; }
    }
    return best;
  }

  function pickCut(x, y) {
    const best = pickSeg(x, y);
    if (!best) return null;
    const { seg, t } = best;
    const removed = tree.cutSet(seg.id, t);
    let leaves = 0;
    for (const id of removed) if (tree.byId.get(id).leafy) leaves++;
    return { kind: 'cut', seg, t, removed, leaves, ok: tree.canCut(seg.id, t) };
  }

  function pickWire(x, y) {
    const best = pickSeg(x, y);
    if (!best) return null;
    const chain = best.seg.w ? null : tree.wireChain(best.seg.id);
    return { kind: 'wire', seg: best.seg, chain };
  }

  function pickBud(x, y) {
    let best = null, bestD = Math.max(10 / cam.s, 2);
    const consider = (d, h) => { if (d < bestD) { bestD = d; best = h; } };
    for (const seg of tree.segs) {
      if (seg.dead) continue;
      if (seg.apex) consider(Math.hypot(seg.x1 - x, seg.y1 - y), { kind: 'tip', seg, x: seg.x1, y: seg.y1 });
      seg.buds.forEach((b, i) => {
        const [bx, by] = budPos(seg, b);
        consider(Math.hypot(bx - x, by - y), { kind: 'bud', seg, i, back: b.back, x: bx, y: by });
      });
    }
    return best;
  }

  function hoverText() {
    if (hover.kind === 'cut') {
      if (!hover.ok) return "The trunk can't be cut at the soil line";
      const total = tree.stats.leafy || 1;
      const pct = Math.round((hover.leaves / total) * 100);
      const n = hover.removed.size;
      let text = hover.seg.dead ? 'Remove deadwood'
        : n ? `Cut here: removes ${n} shoot${n === 1 ? '' : 's'}` : 'Cut here: shortens this shoot';
      if (hover.leaves) text += `, ${pct}% of foliage`;
      if (tree.growing && pct > 30) text += ' ⚠ heavy cut in growing season';
      return text;
    }
    if (hover.kind === 'wire') {
      const seg = hover.seg;
      if (seg.dead) return "Deadwood can't be wired";
      if (!seg.w) {
        const n = [...hover.chain].filter((id) => !tree.byId.get(id).w).length;
        return `Click to wire this ${seg.order === 0 ? 'trunk' : 'branch'} to its tip (${n} section${n === 1 ? '' : 's'})`;
      }
      let text = 'Drag to bend here · click to remove wire';
      const unset = Math.round(Math.abs(seg.wb) * 180 / Math.PI);
      if (unset >= 2) text += ` · ${unset}° still setting`;
      if (seg.w.bit) text += ' ⚠ wire is biting in';
      return text;
    }
    if (hover.kind === 'tip') return 'Pinch tip: stops this shoot extending so buds below break';
    return hover.back ? 'Back bud: click to rub off' : 'Dormant bud: click to rub off';
  }

  function act() {
    if (!hover || tree.dead) return;
    if (hover.kind === 'cut') {
      if (!hover.ok) { toast("The trunk can't be cut at the soil line"); return; }
      pushUndo();
      const r = tree.cut(hover.seg.id, hover.t);
      if (r && r.hit >= 2) toast(`Heavy pruning stressed the tree (−${Math.round(r.hit)} health)`);
    } else if (hover.kind === 'wire') {
      if (hover.seg.dead) return;
      pushUndo();
      if (hover.seg.w) {
        const r = tree.removeWire(hover.seg.id);
        const deg = Math.round(r.sprang * 180 / Math.PI);
        toast(deg >= 3 ? `Wire removed. The branch sprang back ${deg}° (the bend hadn't set yet)` : 'Wire removed');
      } else {
        tree.applyWire(hover.seg.id);
      }
    } else if (hover.kind === 'tip') {
      pushUndo();
      tree.pinchTip(hover.seg.id);
    } else {
      pushUndo();
      tree.removeBud(hover.seg.id, hover.i);
    }
    dirty = true;
    updateHover();
    updatePanel();
  }

  // ---- Panel --------------------------------------------------------------

  function updatePanel() {
    const st = tree.stats;
    const d = tree.dayOfYear;
    const date = dateOf(d);
    $('season').textContent = tree.season;
    $('date').textContent = `${MONTHS[date.month]} ${date.day}`;
    $('yearDay').textContent = `Year ${tree.year + 1} · Day ${d + 1}`;
    $('yearBar').style.width = ((d + 1) / YEAR) * 100 + '%';
    const rows = [
      ['Age', `${(tree.startAge + tree.day / YEAR).toFixed(1)} years`],
      ['Height', `${(st.height * CM_PER_UNIT).toFixed(1)} cm`],
      ['Trunk diameter', `${(st.trunk * CM_PER_UNIT).toFixed(1)} cm`],
      ['Growing tips', st.apices],
      ['Leafy shoots', st.leafy],
      ['Dormant buds', st.buds - st.back],
      ['Back buds', st.back],
      ['Ramification', `${st.maxOrder} level${st.maxOrder === 1 ? '' : 's'}`],
      ['Wired sections', st.wired ? `${st.wired}${st.biting ? ` (${st.biting} biting)` : ''}` : '—'],
      ['Fertilizer', tree.fert > 0 ? `${tree.fert} days left` : '—'],
    ];
    $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    const hb = $('healthBar');
    hb.style.width = tree.health + '%';
    hb.style.background = tree.health > 60 ? '#7a9a4a' : tree.health > 30 ? '#d0a03c' : '#c0533a';
    $('undoBtn').disabled = !undoStack.length;
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === speed));
    document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  }

  // ---- Events from the simulation ----------------------------------------

  // Milestones in the tree's year, announced in the sky.
  const PHASE_MSG = {
    latewinter: ['Late winter', 'Last weeks for big structural cuts before buds break', '#c4e4ff'],
    budbreak: ['Buds are breaking', 'Spring growth has started', '#b8f07a'],
    harden: ['Shoots are hardening off', 'Growth slows for summer', '#8ee06c'],
    color: ['Leaves are turning', 'Autumn color is on the way', '#ffa040'],
    dormant: ['Leaves are down', 'The tree is dormant: time for structural pruning and wiring', '#e8c9a0'],
  };

  // ---- Season banner --------------------------------------------------------

  const BANNER = {
    Spring: { color: '#ffb6cf', kanji: '春' },
    Summer: { color: '#8ee06c', kanji: '夏' },
    Autumn: { color: '#ffa040', kanji: '秋' },
    Winter: { color: '#c4e4ff', kanji: '冬' },
  };
  // Banners shown in the sky one at a time: season changes and milestones.
  let banners = [];

  function queueBanner(b) {
    // At top speed events can outpace the banners; keep only the latest few.
    if (banners.length >= 3) banners.splice(1, banners.length - 2);
    banners.push(b);
  }

  function showSeasonBanner() {
    const { color, kanji } = BANNER[tree.season];
    queueBanner({ title: tree.season, sub: `${kanji} · ${MONTHS[dateOf(tree.dayOfYear).month]}`,
      color, scale: 1, dur: 3.2 });
  }

  function showPhaseBanner(name) {
    const [title, sub, color] = PHASE_MSG[name];
    queueBanner({ title, sub, color, scale: 0.6, dur: 4.5 });
  }

  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

  // Outlined text, shrunk if needed to fit the view.
  function inkText(text, x, y, size, weight, fill) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    const fit = Math.min(1, (W * 0.9) / ctx.measureText(text).width);
    if (fit < 1) ctx.font = `${weight} ${size * fit}px ${FONT}`;
    ctx.lineWidth = size * fit * (weight >= 800 ? 0.14 : 0.2);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  // The current banner rises into the sky, holds, then fades.
  function drawBanner() {
    const b = banners[0];
    if (!b) return;
    b.at ??= performance.now();
    const t = (performance.now() - b.at) / 1000;
    if (t > b.dur) { banners.shift(); return; }
    const size = clamp(W * 0.08, 40, 96) * b.scale;
    const x = W / 2, y = H * 0.17 + (1 - Math.min(1, t / 0.5)) * 14;
    ctx.save();
    ctx.globalAlpha = t < 0.4 ? t / 0.4 : t > b.dur - 0.8 ? (b.dur - t) / 0.8 : 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    inkText(b.title, x, y, size, 800, b.color);
    const subSize = b.scale === 1 ? size * 0.3 : size * 0.45;
    inkText(b.sub, x, y + size * 0.62 + subSize * 0.6, subSize, 700, '#ffffff');
    ctx.restore();
  }

  function handleEvents() {
    for (const e of tree.events) {
      if (e.type === 'season') showSeasonBanner();
      else if (e.type === 'phase') showPhaseBanner(e.name);
      else if (e.type === 'backbud') backBudToast.count++;
      else if (e.type === 'bite') {
        if (wireToast('⚠️ Wire is biting into a thickening branch. Remove it soon') && speed > 7) {
          setSpeed(7);
          toast('Time slowed to 1 week/s so you can take the wire off');
        }
      }
      else if (e.type === 'scar') wireToast('🩹 Wire left on too long has scarred a branch');
      else if (e.type === 'dieback' && e.count >= 3) toast(`🍂 ${e.count} shaded or bare twigs died back`);
      else if (e.type === 'died') {
        speed = 0;
        $('deadModal').hidden = false;
        save();
      }
    }
    tree.events.length = 0;
    const now = performance.now();
    if (backBudToast.count && now - backBudToast.at > 6000) {
      const n = backBudToast.count;
      toast(n === 1 ? '🌿 A back bud appeared on old wood' : `🌿 ${n} back buds appeared on old wood`);
      backBudToast = { count: 0, at: now };
    }
  }

  // Several sections usually bite in the same week; announce each kind of
  // wire trouble at most once every few seconds. Returns whether it showed.
  const wireToastAt = {};
  function wireToast(text) {
    const now = performance.now();
    if (now - (wireToastAt[text] || -Infinity) < 8000) return false;
    wireToastAt[text] = now;
    toast(text);
    return true;
  }

  function toast(text) {
    const box = $('toasts');
    while (box.children.length >= 4) box.firstChild.remove();
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  // ---- Thumbnails ---------------------------------------------------------

  // Draws any tree into a small canvas by pointing the renderer at it
  // temporarily. Leaves are left off so the branch structure is easy to see.
  function renderThumb(b, cv, w = 300, h = 250) {
    const saved = { ctx, tree, W, H, dpr, cam: { ...cam } };
    try {
      dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx = cv.getContext('2d');
      W = w;
      H = h;
      tree = Object.create(b, { dayOfYear: { value: 180 }, growing: { value: true } });
      const fit = fitTarget();
      Object.assign(cam, fit, { s: fit.s * 1.12, y: fit.y + 4 });
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSky();
      drawHills();
      drawTable();
      drawPot();
      drawWood();
      drawRim();
      drawNebari();
      drawWire();
    } finally {
      ({ ctx, tree, W, H, dpr } = saved);
      Object.assign(cam, saved.cam);
    }
  }

  const STYLE_NAMES = { informal: 'Informal upright', slanting: 'Slanting', upright: 'Formal upright' };
  const GLAZE_NAMES = ['indigo', 'celadon', 'cream', 'terracotta', 'oxblood', 'charcoal'];

  function describe(b) {
    const st = b.stats;
    return {
      title: STYLE_NAMES[b.style] || 'Maple',
      detail: `${(st.height * CM_PER_UNIT).toFixed(0)} cm tall · trunk ${(st.trunk * CM_PER_UNIT).toFixed(1)} cm · `
        + `${GLAZE_NAMES[b.pot?.glaze ?? 0]} ${b.pot?.shape === 'round' ? 'round' : 'rectangular'} pot`,
    };
  }

  // ---- Saved forms ----------------------------------------------------------

  const FORMS_KEY = 'bonsai-forms-v1';

  function loadForms() {
    try { return JSON.parse(localStorage.getItem(FORMS_KEY)) || []; } catch { return []; }
  }

  function addForm(b, name) {
    const forms = loadForms();
    forms.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, saved: Date.now(), data: b.serialize() });
    try {
      localStorage.setItem(FORMS_KEY, JSON.stringify(forms));
      return true;
    } catch (err) {
      toast('Could not save the form. Browser storage is full; delete some saved forms.');
      return false;
    }
  }

  function deleteForm(id) {
    localStorage.setItem(FORMS_KEY, JSON.stringify(loadForms().filter((f) => f.id !== id)));
  }

  // ---- New tree picker ------------------------------------------------------

  let pickerTab = 'new';
  let candidates = [];

  function openPicker(tab) {
    if (tab === 'new' || !candidates.length) candidates = Array.from({ length: 6 }, () => new Bonsai());
    pickerTab = tab;
    $('picker').hidden = false;
    $('tooltip').hidden = true;
    renderPicker();
  }

  function plant(b) {
    const grown = !tree.dead && tree.day > 30;
    if (grown && !confirm('Plant this tree? Your current tree will be replaced. Save its form or Export it first to keep it.')) return;
    undoStack = [];
    $('picker').hidden = true;
    setTree(b);
    toast('A new tree has been potted');
  }

  function card(b, title, detail, buttons) {
    const el = document.createElement('div');
    el.className = 'tree-card';
    const cv = document.createElement('canvas');
    el.appendChild(cv);
    const info = document.createElement('div');
    info.className = 'tree-info';
    info.innerHTML = '<b></b><span></span>';
    info.querySelector('b').textContent = title;
    info.querySelector('span').textContent = detail;
    el.appendChild(info);
    const row = document.createElement('div');
    row.className = 'row';
    for (const [label, cls, onClick] of buttons) {
      const btn = document.createElement('button');
      btn.textContent = label;
      if (cls) btn.className = cls;
      btn.addEventListener('click', () => onClick(btn));
      row.appendChild(btn);
    }
    el.appendChild(row);
    renderThumb(b, cv);
    return el;
  }

  function renderPicker() {
    const grid = $('pickerGrid');
    grid.innerHTML = '';
    document.querySelectorAll('#pickerTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === pickerTab));
    const forms = loadForms();
    $('savedCount').textContent = forms.length ? ` (${forms.length})` : '';
    $('pickerMore').hidden = pickerTab !== 'new';
    if (pickerTab === 'new') {
      for (const b of candidates) {
        const { title, detail } = describe(b);
        grid.appendChild(card(b, title, detail, [
          ['Plant this', 'primary', () => plant(b)],
          ['☆ Save form', '', (btn) => {
            if (addForm(b, title)) {
              btn.textContent = '★ Saved';
              btn.disabled = true;
              $('savedCount').textContent = ` (${loadForms().length})`;
            }
          }],
        ]));
      }
      return;
    }
    if (!forms.length) {
      grid.innerHTML = '<p class="muted empty">No saved forms yet. Use ☆ Save form on a seedling you like, or "Save form" in the side panel to keep your current tree\'s shape.</p>';
      return;
    }
    for (const f of forms) {
      let b;
      try { b = Bonsai.fromJSON(f.data); } catch { continue; }
      const { detail } = describe(b);
      const when = new Date(f.saved).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      grid.appendChild(card(b, f.name, `${detail} · saved ${when}`, [
        ['Plant a copy', 'primary', () => plant(Bonsai.fromJSON(f.data))],
        ['Delete', 'danger', () => {
          if (!confirm(`Delete the saved form "${f.name}"?`)) return;
          deleteForm(f.id);
          renderPicker();
        }],
      ]));
    }
  }

  document.querySelectorAll('#pickerTabs button').forEach((b) => b.addEventListener('click', () => {
    pickerTab = b.dataset.tab;
    renderPicker();
  }));
  $('pickerMore').addEventListener('click', () => {
    candidates = Array.from({ length: 6 }, () => new Bonsai());
    renderPicker();
  });
  $('pickerClose').addEventListener('click', () => {
    $('picker').hidden = true;
    if (tree.dead) $('deadModal').hidden = false;
  });

  // ---- Main loop ----------------------------------------------------------

  const modalOpen = () => !$('help').hidden || !$('deadModal').hidden || !$('picker').hidden;

  function frame(now) {
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (speed > 0 && !tree.dead && !modalOpen()) {
      acc += dt * speed;
      let n = 0;
      while (acc >= 1 && n < 60) { tree.step(); acc -= 1; n++; }
      if (n) {
        tree.refresh();
        handleEvents();
        dirty = true;
        updateHover();
      }
    }
    if (cam.auto && W && !drag?.bend) {
      const f = fitTarget();
      cam.x = lerp(cam.x, f.x, 0.08);
      cam.y = lerp(cam.y, f.y, 0.08);
      cam.s = lerp(cam.s, f.s, 0.08);
    }
    updateScene(dt);
    render();
    if (now - lastPanel > 250) { updatePanel(); lastPanel = now; }
    if (dirty && Date.now() - lastSave > AUTOSAVE_MS) save();
    requestAnimationFrame(frame);
  }

  // ---- Input --------------------------------------------------------------

  function setSpeed(v) {
    speed = v;
    if (v) pausedSpeed = v;
    updatePanel();
  }

  function setTool(t) {
    tool = t;
    updateHover();
    updatePanel();
  }

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('mousemove', (e) => {
    mouse = canvasPoint(e);
    if (drag?.bend) {
      bendTo(e);
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) > 4) {
        drag.moved = true;
        canvas.classList.add('panning');
      }
      if (drag.moved) {
        cam.auto = false;
        cam.x -= dx / cam.s;
        cam.y += dy / cam.s;
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    }
    updateHover();
  });
  // Angle from a section's base to the pointer, in the tree's convention
  // (radians from vertical).
  function pointerAngle(seg, e) {
    const m = canvasPoint(e);
    return Math.atan2(wx(m.x) - seg.x0, wy(m.y) - seg.y0);
  }

  function bendTo(e) {
    const seg = tree.byId.get(drag.id);
    if (!seg) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 3) return;
      drag.moved = true;
      pushUndo();
    }
    const a = pointerAngle(seg, e);
    let delta = a - drag.angle;
    delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    drag.angle = a;
    const r = tree.bend(drag.id, delta);
    drag.limited = r?.limited;
    if (drag.limited) {
      const tip = $('tooltip');
      tip.textContent = "This wood won't bend any further yet";
      tip.style.left = mouse.x + 'px';
      tip.style.top = mouse.y + 'px';
    }
    dirty = true;
  }

  canvas.addEventListener('mousedown', (e) => {
    mouse = canvasPoint(e);
    updateHover();
    drag = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
    if (e.button === 0 && hover?.kind === 'wire' && hover.seg.w && !tree.dead) {
      Object.assign(drag, { bend: true, id: hover.seg.id, angle: pointerAngle(hover.seg, e) });
    }
  });
  window.addEventListener('mouseup', () => {
    if (drag?.bend && drag.moved) tree.refresh();
    else if (drag && !drag.moved && drag.button === 0) act();
    drag = null;
    canvas.classList.remove('panning');
    updateHover();
  });
  canvas.addEventListener('mouseleave', () => { mouse = null; updateHover(); });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const m = canvasPoint(e);
    const x = wx(m.x), y = wy(m.y);
    cam.s = clamp(cam.s * Math.exp(-e.deltaY * 0.0015), 0.3, 30);
    cam.x = x - (m.x - W / 2) / cam.s;
    cam.y = y + (m.y - H / 2) / cam.s;
    cam.auto = false;
    updateHover();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape' && !$('help').hidden) { $('help').hidden = true; return; }
    if (e.key === 'Escape' && !$('picker').hidden) { $('picker').hidden = true; return; }
    if (modalOpen()) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (e.key === ' ') { e.preventDefault(); setSpeed(speed ? 0 : pausedSpeed); }
    else if (e.key === '1') setTool('prune');
    else if (e.key === '2') setTool('pinch');
    else if (e.key === '3') setTool('wire');
    else if (e.key.toLowerCase() === 'f') cam.auto = true;
  });

  document.querySelectorAll('#speeds button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('fitBtn').addEventListener('click', () => { cam.auto = true; });
  $('undoBtn').addEventListener('click', undo);
  $('fertBtn').addEventListener('click', () => {
    pushUndo();
    const r = tree.fertilize();
    toast(r === 'burn' ? '🔥 Too much fertilizer burned the roots (−12 health)'
      : r === 'dormant' ? 'Fertilized. Little effect while the tree is dormant'
      : '🌿 Fertilized: extra vigour for 45 days');
    dirty = true;
    updatePanel();
  });
  $('saveBtn').addEventListener('click', () => { save(); toast('Progress saved'); });
  $('newBtn').addEventListener('click', () => openPicker('new'));
  $('saveFormBtn').addEventListener('click', () => {
    if (addForm(tree, `${describe(tree).title}, ${(tree.startAge + tree.day / YEAR).toFixed(1)} years`)) {
      toast('Saved this tree\'s form. Start from it any time via New tree → Saved forms');
    }
  });
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([tree.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bonsai-age-${(tree.startAge + tree.day / YEAR).toFixed(1)}y.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const next = Bonsai.fromJSON(await file.text());
      undoStack = [];
      setTree(next);
      toast('Tree loaded from file');
    } catch (err) {
      toast("That file isn't a valid bonsai save");
    }
  });
  $('helpBtn').addEventListener('click', () => { $('help').hidden = false; });
  $('helpClose').addEventListener('click', () => {
    $('help').hidden = true;
    if (firstRun) showSeasonBanner();
  });
  $('deadUndo').addEventListener('click', () => { if (undoStack.length) undo(); else toast('Nothing to undo'); });
  $('deadNew').addEventListener('click', () => {
    $('deadModal').hidden = true;
    openPicker('new');
  });

  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

  // ---- Start --------------------------------------------------------------

  resize();
  Object.assign(cam, fitTarget());
  if (firstRun) $('help').hidden = false;
  else toast(`Welcome back. Your tree is ${(tree.startAge + tree.day / YEAR).toFixed(1)} years old`);
  if (tree.dead) $('deadModal').hidden = false;
  updatePanel();
  render();
  requestAnimationFrame(frame);
})();
