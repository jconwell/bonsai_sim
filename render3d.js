// Bonsai 3D view: Three.js scene, procedural textures, tree meshes, picking
// and camera. Knows nothing about the UI; game.js drives it.
(function (global) {
  'use strict';

  const T = global.THREE;
  const { BUD_BREAK, COLOR, BARE, seasonOf, SEASON_STARTS, YEAR } = global.BonsaiConst;
  const V = global.BonsaiVec;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const TABLE_Y = -37;

  const hash = (n) => {
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };

  // ---- Procedural textures --------------------------------------------------

  function canvasTexture(size, draw, srgb = true) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const tex = new T.CanvasTexture(c);
    tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.anisotropy = 4;
    if (srgb) tex.colorSpace = T.SRGBColorSpace;
    return tex;
  }

  // Smooth grey maple bark with fine vertical striations and lenticels.
  function barkTexture() {
    return canvasTexture(256, (g, S) => {
      g.fillStyle = '#c9c2b8';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 900; i++) {
        const x = Math.random() * S, y = Math.random() * S, h = 6 + Math.random() * 40;
        const shade = Math.random() < 0.5 ? 'rgba(80,70,60,' : 'rgba(255,250,240,';
        g.fillStyle = shade + (0.05 + Math.random() * 0.12) + ')';
        g.fillRect(x, y, 1 + Math.random() * 2, h);
        g.fillRect(x, y - S, 1 + Math.random() * 2, h);
      }
      for (let i = 0; i < 140; i++) {
        g.fillStyle = 'rgba(235,228,215,0.5)';
        g.fillRect(Math.random() * S, Math.random() * S, 3 + Math.random() * 4, 1);
      }
    });
  }

  function woodTexture() {
    return canvasTexture(512, (g, S) => {
      const planks = 6;
      for (let p = 0; p < planks; p++) {
        const y = (p / planks) * S, h = S / planks;
        g.fillStyle = `hsl(${26 + Math.random() * 6},${38 + Math.random() * 10}%,${36 + Math.random() * 8}%)`;
        g.fillRect(0, y, S, h);
        for (let i = 0; i < 60; i++) {
          g.strokeStyle = `rgba(60,35,20,${0.08 + Math.random() * 0.12})`;
          g.lineWidth = 1 + Math.random() * 1.5;
          g.beginPath();
          const yy = y + Math.random() * h;
          g.moveTo(0, yy);
          for (let x = 0; x <= S; x += 32) g.lineTo(x, yy + Math.sin(x / 50 + i) * 2);
          g.stroke();
        }
        g.fillStyle = 'rgba(30,18,10,0.6)';
        g.fillRect(0, y, S, 2);
      }
    });
  }

  function soilTexture() {
    return canvasTexture(256, (g, S) => {
      g.fillStyle = '#3d2c20';
      g.fillRect(0, 0, S, S);
      for (let i = 0; i < 2500; i++) {
        const l = 15 + Math.random() * 30;
        g.fillStyle = `hsla(${20 + Math.random() * 20},${20 + Math.random() * 25}%,${l}%,0.9)`;
        const r = 0.6 + Math.random() * 2.2;
        g.beginPath();
        g.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  function softDot(color) {
    return canvasTexture(64, (g, S) => {
      const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      r.addColorStop(0, color);
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, S, S);
    });
  }

  function cloudTexture() {
    return canvasTexture(256, (g, S) => {
      for (let i = 0; i < 14; i++) {
        const x = S * (0.2 + Math.random() * 0.6), y = S * (0.45 + Math.random() * 0.2);
        const r = S * (0.12 + Math.random() * 0.14);
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, 'rgba(255,255,255,0.9)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    });
  }

  // Japanese maple leaf: seven pointed lobes, drawn light grey so the
  // per-leaf colour tints it.
  const LEAF_LOBES = [[-112, 0.45], [-70, 0.78], [-34, 0.94], [0, 1], [34, 0.94], [70, 0.78], [112, 0.45]];
  function leafTexture() {
    return canvasTexture(256, (g, S) => {
      const palm = [S / 2, S * 0.62], R = S * 0.37;
      const pt = (deg, r) => {
        const a = deg * Math.PI / 180;
        return [palm[0] + Math.sin(a) * r * R, palm[1] - Math.cos(a) * r * R];
      };
      g.beginPath();
      g.moveTo(...pt(-150, 0.2));
      LEAF_LOBES.forEach(([a, len], i) => {
        const sinus = i ? (LEAF_LOBES[i - 1][0] + a) / 2 : -135;
        g.lineTo(...pt(sinus, 0.36));
        g.quadraticCurveTo(...pt(a - 16, len * 0.72), ...pt(a, len));
        g.quadraticCurveTo(...pt(a + 16, len * 0.72), ...pt(a + 15, len * 0.45));
      });
      g.lineTo(...pt(135, 0.36));
      g.lineTo(...pt(150, 0.2));
      g.closePath();
      const grad = g.createRadialGradient(palm[0], palm[1], 0, palm[0], palm[1], R);
      grad.addColorStop(0, '#d8d8d8');
      grad.addColorStop(1, '#f4f4f4');
      g.fillStyle = grad;
      g.fill();
      g.strokeStyle = 'rgba(120,120,120,0.55)';
      g.lineWidth = S * 0.012;
      g.beginPath();
      for (const [a, len] of LEAF_LOBES) {
        g.moveTo(...palm);
        g.lineTo(...pt(a, len * 0.85));
      }
      g.moveTo(...palm);
      g.lineTo(S / 2, S * 0.98);
      g.stroke();
    });
  }

  // ---- Season palettes --------------------------------------------------------

  // [sky top, horizon, ground, hills, sun intensity]
  const SEASON_ENV = [
    ['#6fa8dc', '#dfe8ee', '#7f9f5a', '#6d8a6a', 2.4],
    ['#4a8fd8', '#cfe2ee', '#6f8f45', '#5f7f58', 2.8],
    ['#8aa6c4', '#efe0c8', '#8e7f4c', '#8a7a5c', 2.1],
    ['#9eadbd', '#e3e8ec', '#8b9481', '#8a96a0', 1.5],
  ];

  function seasonalEnv(d) {
    const i = seasonOf(d);
    const start = SEASON_STARTS[i];
    const end = i === 3 ? SEASON_STARTS[0] + YEAR : SEASON_STARTS[i + 1];
    const dd = d < start ? d + YEAR : d;
    const k = smooth(0.75, 1, (dd - start) / (end - start));
    const a = SEASON_ENV[i], b = SEASON_ENV[(i + 1) % 4];
    const col = (j) => new T.Color(a[j]).lerp(new T.Color(b[j]), k);
    return { top: col(0), horizon: col(1), ground: col(2), hills: col(3), sun: lerp(a[4], b[4], k) };
  }

  const LEAF_SPRING = new T.Color('#a8dc5c');
  const LEAF_SUMMER = new T.Color('#5a9a3c');
  const LEAF_AUTUMN = [new T.Color('#d3332a'), new T.Color('#f07f26'), new T.Color('#e8b62a')];

  function snowCover(d) {
    if (d >= 344) return clamp((d - 344) / 15, 0, 1);
    if (d < 46) return 1;
    if (d < 56) return 1 - (d - 46) / 10;
    return 0;
  }

  const GLAZES = [
    { color: '#34507e', gloss: true }, { color: '#7ea893', gloss: true }, { color: '#ddd0b2', gloss: true },
    { color: '#9c5636', gloss: false }, { color: '#7c2629', gloss: true }, { color: '#4a4644', gloss: false },
  ];

  // ---- Geometry builders --------------------------------------------------------

  // Tapered bark tubes for every section, merged into one mesh. Each vertex
  // records its section id so a ray hit tells us which branch was clicked.
  function buildWood(tree, opts = {}) {
    const segs = opts.only ? tree.segs.filter((s) => opts.only.has(s.id)) : tree.segs;
    const grow = opts.grow || 0;
    const snow = opts.snow || 0;
    const day = tree.day;
    const endR = new Map(), next = new Map();
    for (const s of tree.segs) {
      if (s.p < 0 || s.t < 0.99) continue;
      const p = tree.byId.get(s.p);
      if (p && s.order === p.order) { endR.set(p.id, s.g); next.set(p.id, s); }
    }
    const path = new Map();
    const pos = [], nor = [], uv = [], col = [], sid = [], idx = [];
    for (const s of tree.segs) {
      const p = s.p >= 0 ? tree.byId.get(s.p) : null;
      path.set(s.id, p ? path.get(p.id) + p.len * s.t : 0);
    }
    for (const s of segs) {
      const r0 = s.g + grow;
      const r1 = (endR.has(s.id) ? endR.get(s.id) : s.g * (s.apex || s.tip ? 0.55 : 0.8)) + grow;
      const n = r0 < 0.7 ? 5 : r0 < 2 ? 7 : r0 < 5 ? 10 : 14;
      const d = s.d;
      // Where a section continues its parent, both share a joint ring angled
      // halfway between their directions, so the surface runs on without
      // seams or fins. Side branches overlap back into the wood they grow from.
      const parent = s.p >= 0 ? tree.byId.get(s.p) : null;
      const continues = parent && s.t > 0.99 && parent.order === s.order;
      const nx = next.get(s.id);
      const startN = continues ? V.norm(V.add(parent.d, d)) : d;
      const endN = nx ? V.norm(V.add(d, nx.d)) : d;
      const back = parent && !continues ? Math.min(r0 * 0.6, 2) : 0;
      const start = [s.x0 - d[0] * back, s.y0 - d[1] * back, s.z0 - d[2] * back];
      const end = [s.x1, s.y1, s.z1];
      const rings = [[start, r0, -back, startN], [end, r1, s.len, endN]];
      const tip = !endR.has(s.id);
      if (tip) rings.push([[end[0] + d[0] * r1, end[1] + d[1] * r1, end[2] + d[2] * r1], 0.01, s.len + r1, d]);
      // Colour runs from this section's bark into the next one's, so joints
      // don't show as bands.
      const color = opts.color || barkColor;
      const c0 = color(s, day);
      const c1 = next.has(s.id) ? color(next.get(s.id), day) : c0;
      const around = Math.max(1, Math.round((2 * Math.PI * r0) / 14));
      const slope = (r0 - r1) / Math.max(1, s.len);
      const base = pos.length / 3;
      rings.forEach(([center, r, along, rn], ri) => {
        const c = ri === 0 ? c0 : c1;
        // Ring basis in the joint plane, keeping this section's orientation.
        const k = V.dot(s.u, rn);
        const u = V.norm([s.u[0] - rn[0] * k, s.u[1] - rn[1] * k, s.u[2] - rn[2] * k]);
        const w = V.cross(rn, u);
        for (let j = 0; j <= n; j++) {
          const a = (j / n) * Math.PI * 2;
          const ca = Math.cos(a), sa = Math.sin(a);
          const dir = [u[0] * ca + w[0] * sa, u[1] * ca + w[1] * sa, u[2] * ca + w[2] * sa];
          pos.push(center[0] + dir[0] * r, center[1] + dir[1] * r, center[2] + dir[2] * r);
          const nn = V.norm([dir[0] + d[0] * slope, dir[1] + d[1] * slope, dir[2] + d[2] * slope]);
          nor.push(nn[0], nn[1], nn[2]);
          uv.push((j / n) * around, (path.get(s.id) + along) / 18);
          const white = snow * smooth(0.25, 0.75, nn[1]) * (s.g > 0.4 ? 1 : 0);
          col.push(lerp(c[0], 1.25, white), lerp(c[1], 1.25, white), lerp(c[2], 1.3, white));
          sid.push(s.id);
        }
      });
      for (let k = 0; k < rings.length - 1; k++) {
        for (let j = 0; j < n; j++) {
          const a = base + k * (n + 1) + j, b = a + n + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    // Nebari: the trunk flares into each main surface root with a tapered
    // buttress running from partway up the trunk down onto the root.
    if (opts.flare && !opts.only) {
      const trunkG = opts.flare;
      for (const r of tree.segs) {
        if (r.p >= 0 || r.dead || V.polar(r.d) > 2.2) continue;
        const h = V.norm([r.d[0], 0, r.d[2]]);
        const rise = Math.min(r.g, trunkG * 0.6);
        const top = [h[0] * trunkG * 0.55, 1.2 + rise * 1.1, h[2] * trunkG * 0.55];
        const reach = trunkG + r.g * 2.6;
        const foot = [r.x0 + h[0] * reach, r.y0, r.z0 + h[2] * reach];
        const d = V.norm([foot[0] - top[0], foot[1] - top[1], foot[2] - top[2]]);
        const u = V.perp(d), w = V.cross(d, u);
        const n = 12, base = pos.length / 3;
        const c = (opts.color || barkColor)(r, day);
        for (const [center, rad] of [[top, rise * 0.9], [foot, r.g * 0.98]]) {
          for (let j = 0; j <= n; j++) {
            const a = (j / n) * Math.PI * 2;
            const dir = [u[0] * Math.cos(a) + w[0] * Math.sin(a), u[1] * Math.cos(a) + w[1] * Math.sin(a), u[2] * Math.cos(a) + w[2] * Math.sin(a)];
            pos.push(center[0] + dir[0] * rad, center[1] + dir[1] * rad, center[2] + dir[2] * rad);
            nor.push(dir[0], dir[1], dir[2]);
            uv.push((j / n) * 2, center === top ? 0 : reach / 18);
            col.push(c[0], c[1], c[2]);
            sid.push(-1 - r.id);  // negative: flare, not the root itself (not pickable)
          }
        }
        for (let j = 0; j < n; j++) {
          const a = base + j, b = a + n + 1;
          idx.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
    geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    geo.setAttribute('segId', new T.Float32BufferAttribute(sid, 1));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
    return geo;
  }

  // Roots: pale tan while young, taking on bark colour as they age and
  // thicken (surface roots become part of the trunk's flare).
  function rootColor(r, day) {
    const age = clamp((day - r.born) / 400, 0, 1);
    const young = [0.86, 0.76, 0.6];
    const old = [0.74, 0.67, 0.6];
    const thick = [0.82, 0.8, 0.75];
    const o = clamp((r.g - 2) / 7, 0, 1);
    return young.map((v, i) => lerp(lerp(v, old[i], age), thick[i], o));
  }
  const rootTree = (tree) => ({ segs: tree.roots, byId: tree.rootById, day: tree.day });

  // Bark colour (multiplied with the bark texture). Young shoots are green or
  // red depending on the shoot; mature wood is maple grey-brown.
  function barkColor(s, day) {
    if (s.dead) return [0.85, 0.82, 0.76];
    const age = clamp((day - s.born) / 260, 0, 1);
    const red = ((s.ph * 1000) | 0) % 3 === 0;
    const young = red ? [0.62, 0.27, 0.22] : [0.45, 0.58, 0.26];
    const mature = [0.74, 0.67, 0.6];
    const old = [0.82, 0.8, 0.75];
    const o = clamp((s.g - 2) / 7, 0, 1);
    return young.map((v, i) => lerp(lerp(v, mature[i], age), old[i], o));
  }

  // A thin tube following a polyline (used for wire coils and scars).
  function tubeAlong(points, radius, pos, nor, idx) {
    const n = 5;
    const base = pos.length / 3;
    let u = null;
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      const t = V.norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      if (!u) u = V.perp(t);
      else {
        const k = V.dot(u, t);
        u = V.norm([u[0] - t[0] * k, u[1] - t[1] * k, u[2] - t[2] * k]);
      }
      const w = V.cross(t, u);
      for (let j = 0; j <= n; j++) {
        const ang = (j / n) * Math.PI * 2;
        const dir = [u[0] * Math.cos(ang) + w[0] * Math.sin(ang), u[1] * Math.cos(ang) + w[1] * Math.sin(ang), u[2] * Math.cos(ang) + w[2] * Math.sin(ang)];
        const p = points[i];
        pos.push(p[0] + dir[0] * radius, p[1] + dir[1] * radius, p[2] + dir[2] * radius);
        nor.push(dir[0], dir[1], dir[2]);
      }
    }
    for (let i = 0; i < points.length - 1; i++) {
      for (let j = 0; j < n; j++) {
        const a = base + i * (n + 1) + j, b = a + n + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  // Wire is wrapped at 55° to the branch: each turn advances 2πR / tan 55°
  // along it. kind: 'ok' | 'bite' | 'preview' | 'scar'.
  const WIRE_TAN = Math.tan(55 * Math.PI / 180);
  function buildCoils(tree, pick) {
    const out = {};
    const path = new Map();
    for (const s of tree.segs) {
      const p = s.p >= 0 ? tree.byId.get(s.p) : null;
      path.set(s.id, p ? path.get(p.id) + p.len * s.t : 0);
    }
    for (const s of tree.segs) {
      const kind = pick(s);
      if (!kind) continue;
      const scar = kind === 'scar';
      const R = scar ? s.g * 0.97 : s.g + Math.max(0.22, s.g * 0.11);
      const wireR = scar ? Math.max(0.12, s.g * 0.07) : Math.max(0.28, s.g * 0.12);
      const k = WIRE_TAN / R;
      const step = (Math.PI / 7) / k;
      const u = s.u, w = V.cross(s.d, u);
      const pts = [];
      for (let l = 0; l <= s.len + 1e-6; l += Math.min(step, s.len / 2 || 1)) {
        const th = k * (path.get(s.id) + l) + (scar ? 1.3 : 0);
        const c = Math.cos(th), sn = Math.sin(th);
        pts.push([s.x0 + s.d[0] * l + (u[0] * c + w[0] * sn) * R, s.y0 + s.d[1] * l + (u[1] * c + w[1] * sn) * R, s.z0 + s.d[2] * l + (u[2] * c + w[2] * sn) * R]);
      }
      if (pts.length < 2) continue;
      const o = out[kind] || (out[kind] = { pos: [], nor: [], idx: [] });
      tubeAlong(pts, wireR, o.pos, o.nor, o.idx);
    }
    const geos = {};
    for (const [kind, o] of Object.entries(out)) {
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.Float32BufferAttribute(o.pos, 3));
      g.setAttribute('normal', new T.Float32BufferAttribute(o.nor, 3));
      g.setIndex(o.idx);
      geos[kind] = g;
    }
    return geos;
  }

  // Free the GPU resources of a group built for one-off use (thumbnails, an
  // old pot). Shared materials (bark) and textures are left alone.
  const SHARED = new Set();
  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !SHARED.has(o.material)) o.material.dispose();
      if (o.isInstancedMesh) o.dispose();
    });
  }

  function roundedRect(w, h, r) {
    const s = new T.Shape();
    s.moveTo(-w / 2 + r, -h / 2);
    s.lineTo(w / 2 - r, -h / 2);
    s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    s.lineTo(w / 2, h / 2 - r);
    s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    s.lineTo(-w / 2 + r, h / 2);
    s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    s.lineTo(-w / 2, -h / 2 + r);
    s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    return s;
  }

  function makePot(pot, textures) {
    const group = new T.Group();
    const glaze = GLAZES[pot.glaze] || GLAZES[0];
    const mat = new T.MeshPhysicalMaterial({
      color: glaze.color, roughness: glaze.gloss ? 0.28 : 0.85,
      clearcoat: glaze.gloss ? 0.7 : 0, clearcoatRoughness: 0.25,
    });
    const footMat = new T.MeshStandardMaterial({ color: new T.Color(glaze.color).multiplyScalar(0.6), roughness: 0.8 });
    const soilMat = new T.MeshStandardMaterial({ map: textures.soil, roughness: 1 });
    textures.soil.repeat.set(3, 3);
    let soil;
    if (pot.shape === 'round') {
      const prof = [[0, -32], [26, -32], [48, -29], [61, -21], [67, -11], [70, -3], [73, 0], [73.5, 1.6], [69, 1.8], [68, 1]]
        .map(([x, y]) => new T.Vector2(x, y));
      const body = new T.Mesh(new T.LatheGeometry(prof, 64), mat);
      group.add(body);
      soil = new T.Mesh(new T.CircleGeometry(68.5, 48), soilMat);
      for (let k = 0; k < 3; k++) {
        const foot = new T.Mesh(new T.BoxGeometry(12, 6, 12), footMat);
        const a = k * Math.PI * 2 / 3 + Math.PI / 6;
        foot.position.set(Math.cos(a) * 26, TABLE_Y + 3, Math.sin(a) * 26);
        group.add(foot);
      }
    } else {
      const geo = new T.ExtrudeGeometry(roundedRect(140, 100, 12), {
        depth: 28, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 3, curveSegments: 10,
      });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, -30, 0);
      // Taper the sides inward toward the base.
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const f = 0.86 + 0.14 * clamp((p.getY(i) + 32) / 31, 0, 1);
        p.setX(i, p.getX(i) * f);
        p.setZ(i, p.getZ(i) * f);
      }
      geo.computeVertexNormals();
      group.add(new T.Mesh(geo, mat));
      const rimShape = roundedRect(148, 108, 14);
      rimShape.holes.push(roundedRect(134, 94, 10));
      const rim = new T.ExtrudeGeometry(rimShape, { depth: 3, bevelEnabled: true, bevelThickness: 0.8, bevelSize: 0.8, bevelSegments: 2 });
      rim.rotateX(-Math.PI / 2);
      rim.translate(0, -2, 0);
      group.add(new T.Mesh(rim, mat));
      soil = new T.Mesh(new T.ShapeGeometry(roundedRect(136, 96, 11)), soilMat);
      for (const [x, z] of [[-50, -32], [50, -32], [-50, 32], [50, 32]]) {
        const foot = new T.Mesh(new T.BoxGeometry(14, 6, 10), footMat);
        foot.position.set(x * 0.86, TABLE_Y + 3, z * 0.86);
        group.add(foot);
      }
    }
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 1.2;
    soil.receiveShadow = true;
    soil.name = 'soil';
    group.add(soil);
    // Moss: low cushions in a few patches, varied in shade.
    const MOSS = 120;
    const moss = new T.InstancedMesh(new T.SphereGeometry(1, 7, 5), new T.MeshStandardMaterial({ roughness: 1 }), MOSS);
    const m = new T.Matrix4(), mc = new T.Color();
    const patches = Array.from({ length: 5 }, () => [Math.random() * Math.PI * 2, 18 + Math.random() * 38]);
    for (let i = 0; i < MOSS; i++) {
      const [pa, pr] = patches[i % patches.length];
      const a = pa + (Math.random() - 0.5) * 0.5, r = pr + (Math.random() - 0.5) * 12;
      const x = Math.cos(a) * r, z = Math.sin(a) * r * (pot.shape === 'round' ? 1 : 0.68);
      const sc = 0.8 + Math.random() * 1.6;
      m.compose(new T.Vector3(x, 1.2, z), new T.Quaternion(), new T.Vector3(sc, sc * 0.3, sc));
      moss.setMatrixAt(i, m);
      moss.setColorAt(i, mc.setHSL(0.24 + Math.random() * 0.05, 0.45, 0.22 + Math.random() * 0.08));
    }
    moss.receiveShadow = true;
    group.add(moss);
    group.traverse((o) => { if (o.isMesh && o !== soil) { o.castShadow = true; o.receiveShadow = true; } });
    group.userData.soil = soil;
    return group;
  }

  // ---- The view --------------------------------------------------------------------

  function createView(canvas) {
    const renderer = new T.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.toneMapping = T.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(32, 1, 2, 9000);
    const textures = { bark: barkTexture(), wood: woodTexture(), soil: soilTexture(), leaf: leafTexture() };

    // Sky dome with a vertical gradient.
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new T.Color() }, horizon: { value: new T.Color() } },
      vertexShader: 'varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 horizon; varying vec3 vPos; void main(){ float h = max(vPos.y, 0.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.55)), 1.0); }',
    });
    const sky = new T.Mesh(new T.SphereGeometry(6000, 32, 16), skyMat);
    scene.add(sky);
    scene.fog = new T.Fog(0xffffff, 1200, 5200);

    const clouds = new T.Group();
    const cloudTex = cloudTexture();
    for (let i = 0; i < 12; i++) {
      const sp = new T.Sprite(new T.SpriteMaterial({ map: cloudTex, fog: false, transparent: true, opacity: 0.85, depthWrite: false }));
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4, r = 4200 + Math.random() * 900;
      sp.position.set(Math.cos(a) * r, 700 + Math.random() * 1100, Math.sin(a) * r);
      sp.scale.set(1400 + Math.random() * 1200, 600 + Math.random() * 400, 1);
      clouds.add(sp);
    }
    scene.add(clouds);

    // Distant hills and meadow.
    const ground = new T.Mesh(new T.CircleGeometry(6000, 48), new T.MeshLambertMaterial({ color: '#7f9f5a' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -260;
    scene.add(ground);
    const hillMat = new T.MeshLambertMaterial({ color: '#6d8a6a' });
    const hillGeo = (radius, amp, phase) => {
      const pts = [], N = 160;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const h = amp * (0.55 + 0.3 * Math.sin(a * 5 + phase) + 0.15 * Math.sin(a * 13 + phase * 2));
        pts.push(Math.cos(a) * radius, -260, Math.sin(a) * radius, Math.cos(a) * radius, -260 + h, Math.sin(a) * radius);
      }
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(pts, 3));
      const ix = [];
      for (let i = 0; i < N; i++) { const b = i * 2; ix.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      geo.setIndex(ix);
      geo.computeVertexNormals();
      return geo;
    };
    const hills = [new T.Mesh(hillGeo(4600, 900, 1.1), hillMat), new T.Mesh(hillGeo(3600, 500, 2.6), hillMat)];
    hills.forEach((h) => { h.material.side = T.DoubleSide; scene.add(h); });

    // Wooden table.
    textures.wood.repeat.set(1.5, 1);
    const table = new T.Mesh(new T.BoxGeometry(560, 14, 360), new T.MeshStandardMaterial({ map: textures.wood, roughness: 0.65 }));
    table.position.y = TABLE_Y - 7;
    table.receiveShadow = true;
    scene.add(table);

    // Lights.
    const hemi = new T.HemisphereLight(0xdfeaff, 0x6a5a4a, 1.1);
    scene.add(hemi);
    // Soft fill from the viewer's side so faces turned away from the sun
    // aren't lost in shadow.
    const fill = new T.DirectionalLight(0xffffff, 0.55);
    scene.add(fill);
    const sun = new T.DirectionalLight(0xfff3e0, 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    scene.add(sun);
    scene.add(sun.target);

    // Tree meshes.
    const barkMat = new T.MeshStandardMaterial({ map: textures.bark, bumpMap: textures.bark, bumpScale: 0.8, vertexColors: true, roughness: 0.92 });
    SHARED.add(barkMat);
    let wood = new T.Mesh(new T.BufferGeometry(), barkMat);
    wood.castShadow = wood.receiveShadow = true;
    // Everything belonging to the tree lives in one group so repot mode can
    // lift it out of the pot.
    const treeGroup = new T.Group();
    scene.add(treeGroup);
    treeGroup.add(wood);
    let roots = new T.Mesh(new T.BufferGeometry(), barkMat);
    roots.castShadow = roots.receiveShadow = true;
    treeGroup.add(roots);
    let lift = 0;

    const leafGeo = new T.PlaneGeometry(1, 1, 3, 3);
    leafGeo.translate(0, 0.5, 0);
    {
      const p = leafGeo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        p.setZ(i, 0.12 * x * x * 4 - 0.12 * y * y);
      }
      leafGeo.computeVertexNormals();
    }
    const leafMat = new T.MeshStandardMaterial({ map: textures.leaf, alphaTest: 0.5, side: T.DoubleSide, roughness: 0.7 });
    // Thin maple leaves glow when lit from behind: add a share of the leaf's
    // own colour so undersides seen from below aren't dark.
    leafMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;',
        'vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance + diffuseColor.rgb * 0.32;');
    };
    const leafDepth = new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking, map: textures.leaf, alphaTest: 0.5 });
    let leaves = null;
    function leafMesh(capacity) {
      if (leaves && leaves.instanceMatrix.count >= capacity) return leaves;
      if (leaves) { treeGroup.remove(leaves); leaves.dispose(); }
      leaves = new T.InstancedMesh(leafGeo, leafMat, Math.max(512, Math.ceil(capacity * 1.5)));
      leaves.customDepthMaterial = leafDepth;
      // Leaves cast shadows on the wood, pot and table but don't shade
      // themselves (alpha-cut cards self-shadow into black blotches).
      leaves.castShadow = true;
      leaves.receiveShadow = false;
      leaves.count = 0;
      treeGroup.add(leaves);
      return leaves;
    }

    // Wire coils (copper, red where biting) and old wire scars.
    const wireMats = {
      // Low metalness: with no environment map to reflect, real metal reads as black.
      ok: new T.MeshStandardMaterial({ color: '#d98a4e', metalness: 0.3, roughness: 0.38, emissive: '#2a1206' }),
      bite: new T.MeshStandardMaterial({ color: '#e0442c', metalness: 0.2, roughness: 0.4, emissive: '#5a1004' }),
      scar: new T.MeshStandardMaterial({ color: '#4a3a2e', roughness: 1 }),
      preview: new T.MeshBasicMaterial({ color: '#ffb066', transparent: true, opacity: 0.85, depthWrite: false }),
    };
    const wireGroup = new T.Group();
    treeGroup.add(wireGroup);
    function updateWire(tree) {
      for (const c of [...wireGroup.children]) { wireGroup.remove(c); c.geometry.dispose(); }
      if (!tree.stats.wired && !tree.segs.some((s) => s.scar)) return;
      const geos = buildCoils(tree, (s) => (s.w ? (s.w.bit ? 'bite' : 'ok') : s.scar ? 'scar' : null));
      for (const [kind, g] of Object.entries(geos)) {
        const m = new T.Mesh(g, wireMats[kind]);
        m.castShadow = kind !== 'scar';
        wireGroup.add(m);
      }
    }

    const budGeo = new T.SphereGeometry(1, 8, 6);
    const budMat = new T.MeshStandardMaterial({ roughness: 0.6 });
    let buds = null;
    function budMesh(capacity) {
      if (buds && buds.instanceMatrix.count >= capacity) return buds;
      if (buds) { treeGroup.remove(buds); buds.dispose(); }
      buds = new T.InstancedMesh(budGeo, budMat, Math.max(256, Math.ceil(capacity * 1.5)));
      buds.count = 0;
      treeGroup.add(buds);
      return buds;
    }

    let potGroup = null, potKey = '';
    const overlay = new T.Group();
    treeGroup.add(overlay);
    const cutMat = new T.MeshBasicMaterial({ color: 0xff3a2a, transparent: true, opacity: 0.55, depthWrite: false });
    const ringMat = new T.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });

    // Ambient particles.
    const snowPts = new T.Points(new T.BufferGeometry(), new T.PointsMaterial({
      size: 3.2, map: softDot('rgba(255,255,255,1)'), transparent: true, depthWrite: false, fog: false,
    }));
    const SNOW = 600;
    const snowPos = new Float32Array(SNOW * 3);
    for (let i = 0; i < SNOW; i++) {
      snowPos[i * 3] = (Math.random() - 0.5) * 700;
      snowPos[i * 3 + 1] = Math.random() * 600 - 40;
      snowPos[i * 3 + 2] = (Math.random() - 0.5) * 700;
    }
    snowPts.geometry.setAttribute('position', new T.BufferAttribute(snowPos, 3));
    scene.add(snowPts);
    const FLUTTER = 120;
    const flutter = new T.InstancedMesh(new T.PlaneGeometry(3, 3), new T.MeshStandardMaterial({
      map: textures.leaf, alphaTest: 0.5, side: T.DoubleSide,
    }), FLUTTER);
    const flutterState = Array.from({ length: FLUTTER }, () => ({ active: false }));
    flutter.count = FLUTTER;
    scene.add(flutter);

    // ---- Camera -------------------------------------------------------------
    const cam = { yaw: 0.35, pitch: 0.2, roll: 0, dist: 500, target: new T.Vector3(0, 40, 0), auto: true };
    let current = null;

    function fitFor(tree) {
      const b = tree.bounds;
      const h = Math.max(70, b.maxY);
      const r = Math.max(80, b.radius + 10);
      const rad = Math.hypot(h / 2 + 25, r);
      const dist = rad / Math.sin((camera.fov * Math.PI) / 360) * Math.max(1, 1.15 / Math.max(0.6, camera.aspect));
      return { target: new T.Vector3(0, h * 0.42, 0), dist: dist * 0.95 };
    }

    function placeCamera() {
      const cp = Math.cos(cam.pitch);
      camera.position.set(
        cam.target.x + cam.dist * cp * Math.sin(cam.yaw),
        cam.target.y + cam.dist * Math.sin(cam.pitch),
        cam.target.z + cam.dist * cp * Math.cos(cam.yaw),
      );
      camera.up.set(0, 1, 0);
      camera.lookAt(cam.target);
      if (cam.roll) camera.rotateZ(cam.roll);
    }

    // ---- Tree update --------------------------------------------------------
    let lastWood = 0;
    let stale = false;

    // Rebuilding the tree meshes is throttled to ~10 per second while time
    // runs; a skipped rebuild is caught up in render() so the view never
    // stays behind the simulation (e.g. after pausing).
    function update(tree, force) {
      current = tree;
      const now = performance.now();
      const d = tree.dayOfYear;
      stale = !(force || now - lastWood > 100);
      if (!stale) {
        lastWood = now;
        const geo = buildWood(tree, { snow: snowCover(d) });
        wood.geometry.dispose();
        wood.geometry = geo;
        roots.geometry.dispose();
        roots.geometry = buildWood(rootTree(tree), { color: rootColor, flare: tree.segs[0] ? tree.segs[0].g : 0 });
        updateLeaves(tree);
        updateBuds(tree);
        updateWire(tree);
      }
      const key = tree.pot.shape + tree.pot.glaze;
      if (key !== potKey) {
        if (potGroup) { scene.remove(potGroup); disposeGroup(potGroup); }
        potGroup = makePot(tree.pot, textures);
        potKey = key;
        scene.add(potGroup);
      }
      // Shadow camera follows the tree size.
      const b = tree.bounds;
      const ext = Math.max(120, b.radius + 60, b.maxY * 0.7);
      const sc = sun.shadow.camera;
      if (Math.abs(sc.right - ext) > 10) {
        sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext;
        sc.near = 1; sc.far = 4000;
        sc.updateProjectionMatrix();
      }
      sun.target.position.set(0, b.maxY * 0.4, 0);
      sun.position.set(-500, 900, 420);
    }

    // Leaves: a pair at each node of young shoots (plus a pair at growing
    // tips), facing mostly up toward the light.
    const tmpM = new T.Matrix4(), tmpC = new T.Color();
    const vx = new T.Vector3(), vy = new T.Vector3(), vz = new T.Vector3();
    let leavesVisible = true;
    function updateLeaves(tree) {
      const d = tree.dayOfYear;
      let count = 0;
      if (d >= BUD_BREAK && d < BARE) {
        const grow = clamp((d - BUD_BREAK) / 30, 0, 1);
        const fallen = clamp((d - (COLOR + 18)) / (BARE - COLOR - 20), 0, 1);
        const spring = clamp(1 - (d - BUD_BREAK - 16) / 45, 0, 1);
        const autumn = clamp((d - COLOR) / 32, 0, 1);
        const base = LEAF_SUMMER.clone().lerp(LEAF_SPRING, spring);
        const mesh = leafMesh(tree.stats.leafy * 4);
        for (const s of tree.segs) {
          if (!s.leafy) continue;
          const len = (2.6 + s.tLen * 0.35) * grow * 4.3;
          if (len < 0.5) continue;
          const region = Math.floor(hash((Math.floor(s.x1 / 22) + 500) * 977 + (Math.floor(s.y1 / 22) + 50) * 31 + Math.floor(s.z1 / 22)) * 3);
          const pairs = s.apex ? 2 : 1;
          for (let j = 0; j < pairs * 2; j++) {
            const h = hash(s.id * 4 + j + 1);
            if (h < fallen) continue;
            const terminal = j >= 2;
            const r = s.phy + (j % 2 ? Math.PI : 0) + (terminal ? Math.PI / 2 : 0);
            const out = tree.budOut(s, r);
            // Petiole points out and a little forward; blade faces the sky.
            const axis = V.norm([out[0] * 0.75 + s.d[0] * (terminal ? 0.8 : 0.35), out[1] * 0.75 + s.d[1] * 0.35 + 0.25, out[2] * 0.75 + s.d[2] * (terminal ? 0.8 : 0.35)]);
            let normal = V.norm([0 - axis[0] * axis[1], 1 - axis[1] * axis[1], 0 - axis[2] * axis[1]]);
            if (!isFinite(normal[0])) normal = V.perp(axis);
            const side = V.cross(axis, normal);
            vx.set(side[0], side[1], side[2]);
            vy.set(axis[0], axis[1], axis[2]);
            vz.set(normal[0], normal[1], normal[2]);
            const sc = len * (terminal ? 0.7 : 1) * (0.85 + 0.3 * hash(s.id * 9 + j));
            tmpM.makeBasis(vx.multiplyScalar(sc), vy.multiplyScalar(sc), vz.multiplyScalar(sc));
            tmpM.setPosition(s.x1, s.y1, s.z1);
            mesh.setMatrixAt(count, tmpM);
            tmpC.copy(base).lerp(LEAF_AUTUMN[region], autumn).multiplyScalar(0.88 + 0.24 * h);
            mesh.setColorAt(count, tmpC);
            count++;
          }
        }
        mesh.count = count;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      } else if (leaves) {
        leaves.count = 0;
      }
      if (leaves) leaves.visible = leavesVisible;
    }

    let budMode = 'normal';
    const BUD_COLORS = { dormant: new T.Color('#7a3a28'), back: new T.Color('#9ee05a'), tip: new T.Color('#c8e88a'), tipBare: new T.Color('#6b4a2a') };
    let budList = [];
    function budPos(tree, s, b) {
      const out = tree.budOut(s, b.r);
      const off = s.g * 0.85 + 0.4;
      return [s.x0 + (s.x1 - s.x0) * b.t + out[0] * off, s.y0 + (s.y1 - s.y0) * b.t + out[1] * off, s.z0 + (s.z1 - s.z0) * b.t + out[2] * off];
    }
    function updateBuds(tree) {
      const d = tree.dayOfYear;
      const bare = d < BUD_BREAK + 6 || d >= BARE - 12;
      const pinch = budMode === 'pinch';
      const mesh = budMesh(tree.stats.buds + tree.stats.apices + 8);
      budList = [];
      let n = 0;
      const put = (p, r, color, entry) => {
        tmpM.makeScale(r, r * 1.3, r);
        tmpM.setPosition(p[0], p[1], p[2]);
        mesh.setMatrixAt(n, tmpM);
        mesh.setColorAt(n, color);
        n++;
        budList.push(entry);
      };
      for (const s of tree.segs) {
        if (s.dead) continue;
        s.buds.forEach((b, i) => {
          if (!b.back && !(pinch || bare)) return;
          const p = budPos(tree, s, b);
          put(p, b.back ? 1.1 : pinch ? 0.9 : 0.6, b.back ? BUD_COLORS.back : BUD_COLORS.dormant, { kind: 'bud', seg: s, i, back: b.back, p });
        });
        if (s.apex && (pinch || bare)) {
          const p = [s.x1 + s.d[0] * 0.6, s.y1 + s.d[1] * 0.6, s.z1 + s.d[2] * 0.6];
          put(p, pinch ? 0.9 : 0.6, tree.growing ? BUD_COLORS.tip : BUD_COLORS.tipBare, { kind: 'tip', seg: s, p });
        }
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }

    // ---- Picking -------------------------------------------------------------
    const ray = new T.Raycaster();
    const ndc = new T.Vector2();

    function pickWood(x, y, w, h) {
      ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObject(wood, false)[0];
      if (!hit || !current) return null;
      const id = wood.geometry.attributes.segId.getX(hit.face.a);
      const s = current.byId.get(id);
      if (!s) return null;
      const p = hit.point.clone();
      p.y -= lift;
      const t = clamp(((p.x - s.x0) * s.d[0] + (p.y - s.y0) * s.d[1] + (p.z - s.z0) * s.d[2]) / Math.max(0.01, s.len), 0, 1);
      return { seg: s, t, point: p };
    }

    function pickRoot(x, y, w, h) {
      ndc.set((x / w) * 2 - 1, -(y / h) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      if (!current) return null;
      const ids = roots.geometry.attributes.segId;
      // Skip the trunk flare: it belongs to the trunk, and clicking it would
      // otherwise cut its whole root off at the base.
      const hit = ray.intersectObject(roots, false).find((h) => ids.getX(h.face.a) >= 0);
      if (!hit) return null;
      const r = current.rootById.get(ids.getX(hit.face.a));
      if (!r) return null;
      const p = hit.point.clone();
      p.y -= lift;
      const t = clamp(((p.x - r.x0) * r.d[0] + (p.y - r.y0) * r.d[1] + (p.z - r.z0) * r.d[2]) / Math.max(0.01, r.len), 0, 1);
      return { root: r, t };
    }

    const proj = new T.Vector3();
    function toScreen(p, w, h) {
      proj.set(p[0], p[1] + lift, p[2]).project(camera);
      return [(proj.x + 1) / 2 * w, (1 - proj.y) / 2 * h, proj.z];
    }

    function pickBud(x, y, w, h) {
      let best = null, bestD = 12;
      for (const e of budList) {
        const [sx, sy, z] = toScreen(e.p, w, h);
        if (z > 1) continue;
        const dd = Math.hypot(sx - x, sy - y);
        if (dd < bestD) { bestD = dd; best = e; }
      }
      return best;
    }

    // ---- Overlays: cut preview, hover ring -------------------------------------
    function clearOverlay() {
      for (const c of [...overlay.children]) {
        overlay.remove(c);
        c.geometry.dispose();
      }
    }

    function showCut(tree, seg, t, removed, ok) {
      clearOverlay();
      cutMat.color.set(ok ? 0xff3a2a : 0x888888);
      if (removed.size) overlay.add(new T.Mesh(buildWood(tree, { only: removed, grow: 0.35 }), cutMat));
      if (!removed.has(seg.id) && ok) {
        const part = { ...seg, x0: seg.x0 + seg.d[0] * seg.len * t, y0: seg.y0 + seg.d[1] * seg.len * t, z0: seg.z0 + seg.d[2] * seg.len * t, len: seg.len * (1 - t), p: -1 };
        const fake = { segs: [part], byId: new Map([[part.id, part]]), day: tree.day };
        overlay.add(new T.Mesh(buildWood(fake, { only: new Set([part.id]), grow: 0.35 }), cutMat));
      }
      const ring = new T.Mesh(new T.TorusGeometry(seg.g + 1.2, Math.max(0.25, seg.g * 0.12), 8, 32), ringMat);
      ring.position.set(seg.x0 + seg.d[0] * seg.len * t, seg.y0 + seg.d[1] * seg.len * t, seg.z0 + seg.d[2] * seg.len * t);
      ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...seg.d));
      ring.renderOrder = 10;
      overlay.add(ring);
    }

    // Repot mode hover: red preview of the roots a cut would remove.
    function showRootCut(tree, root, t, removed) {
      clearOverlay();
      cutMat.color.set(0xff3a2a);
      const rt = rootTree(tree);
      if (removed.size) overlay.add(new T.Mesh(buildWood(rt, { only: removed, grow: 0.3 }), cutMat));
      if (!removed.has(root.id)) {
        const part = { ...root, x0: root.x0 + root.d[0] * root.len * t, y0: root.y0 + root.d[1] * root.len * t, z0: root.z0 + root.d[2] * root.len * t, len: root.len * (1 - t), p: -1 };
        overlay.add(new T.Mesh(buildWood({ segs: [part], byId: new Map([[part.id, part]]), day: tree.day }, { only: new Set([part.id]), grow: 0.3 }), cutMat));
      }
      const ring = new T.Mesh(new T.TorusGeometry(root.g + 1, Math.max(0.25, root.g * 0.12), 8, 32), ringMat);
      ring.position.set(root.x0 + root.d[0] * root.len * t, root.y0 + root.d[1] * root.len * t, root.z0 + root.d[2] * root.len * t);
      ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), new T.Vector3(...root.d));
      ring.renderOrder = 10;
      overlay.add(ring);
    }

    // Repot mode: lift the tree out of the pot and show the whole root ball.
    const ROOT_LIFT = 46;
    function setRootMode(on) {
      lift = on ? ROOT_LIFT : 0;
      treeGroup.position.y = lift;
      cam.auto = !on;
      if (on) {
        cam.target.set(0, ROOT_LIFT - 6, 0);
        cam.dist = 330;
        cam.pitch = 0.32;
      }
    }

    // Wire tool hover: copper preview of the coil that would be applied.
    function showWirePreview(tree, ids) {
      clearOverlay();
      const geos = buildCoils(tree, (s) => (ids.has(s.id) && !s.w && !s.dead ? 'preview' : null));
      if (geos.preview) overlay.add(new T.Mesh(geos.preview, wireMats.preview));
    }

    // Wire tool hover on a wired section: highlight it and mark its pivot.
    const highlightMat = new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    function showBendTarget(tree, seg) {
      clearOverlay();
      overlay.add(new T.Mesh(buildWood(tree, { only: new Set([seg.id]), grow: 0.5 }), highlightMat));
      const pivot = new T.Mesh(new T.SphereGeometry(Math.max(0.8, seg.g * 0.35), 12, 8), ringMat);
      pivot.position.set(seg.x0, seg.y0, seg.z0);
      pivot.renderOrder = 10;
      overlay.add(pivot);
    }

    function showRing(p, r) {
      clearOverlay();
      const ring = new T.Mesh(new T.TorusGeometry(r, r * 0.15, 8, 24), ringMat);
      ring.position.set(p[0], p[1], p[2]);
      ring.lookAt(camera.position);
      ring.renderOrder = 10;
      overlay.add(ring);
    }

    // ---- Environment and animation ----------------------------------------------
    function setEnvironment(d) {
      const env = seasonalEnv(d);
      skyMat.uniforms.top.value.copy(env.top);
      skyMat.uniforms.horizon.value.copy(env.horizon);
      scene.fog.color.copy(env.horizon);
      ground.material.color.copy(env.ground);
      hillMat.color.copy(env.hills);
      sun.intensity = env.sun;
      hemi.intensity = 0.55 + (3 - env.sun) * 0.25;
      const winter = seasonOf(d) === 3;
      clouds.children.forEach((c) => { c.material.opacity = winter ? 0.95 : 0.8; c.material.color.set(winter ? '#e6e9ee' : '#ffffff'); });
      if (potGroup) potGroup.userData.soil.material.color.set('#ffffff').lerp(new T.Color('#f4f7fa').multiplyScalar(1.6), snowCover(d) * 0.85);
    }

    const tmpQ = new T.Quaternion(), tmpE = new T.Euler(), tmpV = new T.Vector3(), one = new T.Vector3(1, 1, 1);
    function animate(dt, d) {
      clouds.rotation.y += dt * 0.004;
      // Snow falls in the depth of winter.
      const snowing = d >= 349 || d < 40;
      snowPts.visible = snowing;
      if (snowing) {
        for (let i = 0; i < SNOW; i++) {
          snowPos[i * 3 + 1] -= dt * (25 + (i % 7) * 4);
          snowPos[i * 3] += Math.sin(performance.now() / 900 + i) * dt * 6;
          if (snowPos[i * 3 + 1] < TABLE_Y) snowPos[i * 3 + 1] = 560;
        }
        snowPts.geometry.attributes.position.needsUpdate = true;
      }
      // Cherry petals drift past in early spring; leaves fall in late autumn.
      const kind = d >= BUD_BREAK - 10 && d < BUD_BREAK + 30 ? 'petal' : d >= COLOR + 18 && d < BARE ? 'leaf' : null;
      for (let i = 0; i < FLUTTER; i++) {
        const f = flutterState[i];
        if (!f.active && kind && Math.random() < dt * (kind === 'leaf' ? 0.25 : 0.12)) {
          let start = [(Math.random() - 0.5) * 400, 250 + Math.random() * 150, (Math.random() - 0.5) * 400];
          if (kind === 'leaf' && current) {
            const s = current.segs[Math.floor(Math.random() * current.segs.length)];
            if (!s || !s.leafy) continue;
            start = [s.x1, s.y1, s.z1];
          }
          Object.assign(f, { active: true, p: start, kind, t: 0, spin: [Math.random() * 3, Math.random() * 3, Math.random() * 3],
            color: kind === 'petal' ? new T.Color(Math.random() < 0.5 ? '#f6c3d1' : '#fbe0e8') : LEAF_AUTUMN[Math.floor(Math.random() * 3)].clone() });
          flutter.setColorAt(i, f.color);
          if (flutter.instanceColor) flutter.instanceColor.needsUpdate = true;
        }
        if (f.active) {
          f.t += dt;
          f.p[0] += (Math.sin(f.t * 1.7 + i) * 8 - 6) * dt;
          f.p[1] -= (kind === 'petal' || f.kind === 'petal' ? 14 : 22) * dt;
          f.p[2] += Math.cos(f.t * 1.3 + i) * 6 * dt;
          if (f.p[1] < TABLE_Y + 1 || f.t > 30) f.active = false;
          tmpE.set(f.t * f.spin[0], f.t * f.spin[1], f.t * f.spin[2]);
          tmpQ.setFromEuler(tmpE);
          tmpM.compose(tmpV.set(f.p[0], f.p[1], f.p[2]), tmpQ, f.kind === 'petal' ? new T.Vector3(0.6, 0.4, 1) : new T.Vector3(1.4, 1.4, 1));
        } else {
          tmpM.makeScale(0, 0, 0);
        }
        flutter.setMatrixAt(i, tmpM);
      }
      flutter.instanceMatrix.needsUpdate = true;
    }

    // ---- Public API ---------------------------------------------------------------
    let W = 1, H = 1;
    const view = {
      cam,
      resize(w, h) {
        W = w; H = h;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      },
      update,
      setBudMode(mode) { budMode = mode; if (current) updateBuds(current); },
      setLeavesVisible(v) { leavesVisible = v; if (leaves) leaves.visible = v; },
      fit(tree, snap) {
        const f = fitFor(tree);
        if (snap) { cam.target.copy(f.target); cam.dist = f.dist; }
        return f;
      },
      render(dt, tree) {
        if (stale && tree && performance.now() - lastWood > 100) update(tree, true);
        if (cam.auto && tree) {
          const f = fitFor(tree);
          cam.target.lerp(f.target, 0.06);
          cam.dist = lerp(cam.dist, f.dist, 0.06);
        }
        placeCamera();
        fill.position.copy(camera.position).add(new T.Vector3(0, 200, 0));
        setEnvironment(tree ? tree.dayOfYear : 150);
        animate(dt, tree ? tree.dayOfYear : 150);
        renderer.render(scene, camera);
      },
      orbit(dx, dy) {
        cam.yaw -= dx * 0.008;
        cam.pitch = clamp(cam.pitch + dy * 0.006, -0.35, 1.45);
      },
      pan(dx, dy) {
        const k = cam.dist * 0.0016;
        const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
        cam.auto = false;
      },
      zoom(delta) {
        cam.dist = clamp(cam.dist * Math.exp(delta * 0.0012), 40, 4000);
        cam.auto = false;
      },
      roll(a) { cam.roll += a; },
      pickWood: (x, y) => pickWood(x, y, W, H),
      pickRoot: (x, y) => pickRoot(x, y, W, H),
      setRootMode, showRootCut,
      pickBud: (x, y) => pickBud(x, y, W, H),
      showCut, showRing, clearOverlay, showWirePreview, showBendTarget,
      // Leaves fade while wiring so the branch structure is visible.
      setFoliageFade(fade) {
        leafMat.transparent = fade;
        leafMat.opacity = fade ? 0.3 : 1;
        // Alpha is opacity × texture alpha, so the cut-out threshold must sit
        // below the faded opacity or every leaf would be discarded.
        leafMat.alphaTest = fade ? 0.12 : 0.5;
        leafMat.depthWrite = !fade;
        leafMat.needsUpdate = true;
      },
      // Ray from the camera through a point on the canvas.
      rayAt(x, y) {
        ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        const o = ray.ray.origin, d = ray.ray.direction;
        return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
      },
      viewDir() {
        const v = new T.Vector3();
        camera.getWorldDirection(v);
        return [v.x, v.y, v.z];
      },
      toScreen: (p) => toScreen(p, W, H),
    };

    // ---- Thumbnails: a small second renderer showing bare branches ---------------
    // Pass { potOnly: true } (with just tree.pot set) to show an empty pot.
    let thumbRenderer = null;
    view.thumbnail = function (tree, w = 300, h = 250, opts = {}) {
      if (!thumbRenderer) {
        thumbRenderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        thumbRenderer.outputColorSpace = T.SRGBColorSpace;
        thumbRenderer.toneMapping = T.ACESFilmicToneMapping;
        thumbRenderer.shadowMap.enabled = true;
      }
      thumbRenderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
      thumbRenderer.setSize(w, h, false);
      const saved = { snow: snowPts.visible, flutter: flutter.visible };
      const thumb = new T.Group();
      if (!opts.potOnly) {
        const w = new T.Mesh(buildWood(tree, {}), barkMat);
        const r = new T.Mesh(buildWood(rootTree(tree), { color: rootColor, flare: tree.segs[0] ? tree.segs[0].g : 0 }), barkMat);
        w.castShadow = w.receiveShadow = r.castShadow = r.receiveShadow = true;
        thumb.add(w, r);
      }
      thumb.add(makePot(tree.pot, textures));
      treeGroup.visible = false;
      if (potGroup) potGroup.visible = false;
      snowPts.visible = flutter.visible = false;
      scene.add(thumb);
      setEnvironment(180);
      const tcam = new T.PerspectiveCamera(32, w / h, 2, 9000);
      let dist, target, pitch = 0.22;
      if (opts.potOnly) {
        dist = 300;
        target = new T.Vector3(0, -16, 0);
        pitch = 0.42;
      } else {
        const h0 = Math.max(70, tree.bounds.maxY), r0 = Math.max(80, tree.bounds.radius + 10);
        const rad = Math.hypot(h0 / 2 + 25, r0);
        dist = rad / Math.sin((32 * Math.PI) / 360) * 0.68;
        target = new T.Vector3(0, h0 * 0.36, 0);
      }
      tcam.position.set(target.x + dist * Math.cos(pitch) * Math.sin(0.5), target.y + dist * Math.sin(pitch), target.z + dist * Math.cos(pitch) * Math.cos(0.5));
      tcam.lookAt(target);
      thumbRenderer.render(scene, tcam);
      const url = thumbRenderer.domElement.toDataURL('image/png');
      scene.remove(thumb);
      disposeGroup(thumb);
      treeGroup.visible = true;
      if (potGroup) potGroup.visible = true;
      snowPts.visible = saved.snow;
      flutter.visible = saved.flutter;
      return url;
    };

    return view;
  }

  global.BonsaiView = { createView, snowCover };
})(window);
