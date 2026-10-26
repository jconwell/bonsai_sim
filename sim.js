// Bonsai growth simulation (3D). Pure logic, no DOM, so it can be tested
// headlessly.
//
// The tree is a list of segments (internodes). Each segment hangs off its
// parent at a fraction `t` along the parent's length (t = 1 is the node at the
// parent's tip; t < 1 is a back bud that broke on old wood). Segments are kept
// in creation order, so a parent always comes before its children.
//
// Coordinates: y is up, the trunk base sits at the origin on the soil, and
// x/z are horizontal. Each segment has a unit direction `d` and a unit
// reference vector `u` perpendicular to it; bud positions around the stem are
// measured as angles from `u`.
(function (global) {
  'use strict';

  // Calendar: day 0 is January 1 (no leap years). The yearly cycle follows
  // a Japanese maple in the Pacific Northwest (Seattle / Portland).
  const YEAR = 365;
  const LEAF_LIFE = 548;       // shoots carry leaves for ~1.5 years
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const SEASON_STARTS = [59, 151, 243, 334];  // Mar 1, Jun 1, Sep 1, Dec 1
  const BUD_BREAK = 84;        // ~Mar 25: buds break, leaves expand through April
  const HARDEN = 190;          // ~Jul 10: shoots harden off, extension slows
  const COLOR = 272;           // ~Sep 30: leaves begin to turn, peak late October
  const BARE = 332;            // ~Nov 28: last leaves down
  const LATE_WINTER = 45;      // ~Feb 15
  const GROW_START = BUD_BREAK, GROW_END = 245;  // wood stops growing ~Sep 2
  const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];
  const POT_GLAZES = 6;
  const SAVE_VERSION = 6;
  const ROOT_START = 75, ROOT_END = 300;       // roots grow mid-March to late October
  const REPOT_START = 31, REPOT_END = 100;     // repot Feb 1 – Apr 10
  const POT_BOUND_NOTICE = 35;                 // ~Feb 5
  // Inside of the pot (root space), in world units.
  const POT_SPACE = { rect: { hx: 63, hz: 43, depth: 27 }, round: { r: 63, depth: 27 } };
  // Compass words for the 8 sectors around the trunk, as seen from the
  // pot's front (+z faces the viewer by default).
  const SIDES = ['left', 'back-left', 'back', 'back-right', 'right', 'front-right', 'front', 'front-left'];

  // Meteorological seasons: Spring Mar–May, Summer Jun–Aug, Autumn Sep–Nov,
  // Winter Dec–Feb. Returns an index into SEASONS.
  function seasonOf(d) {
    if (d >= SEASON_STARTS[3] || d < SEASON_STARTS[0]) return 3;
    return d < SEASON_STARTS[1] ? 0 : d < SEASON_STARTS[2] ? 1 : 2;
  }

  function dateOf(d) {
    let m = 0;
    while (d >= MONTH_DAYS[m]) d -= MONTH_DAYS[m++];
    return { month: m, day: d + 1 };
  }

  const rand = Math.random;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const between = (a, b) => a + rand() * (b - a);

  // ---- Vector helpers (arrays [x, y, z]) ------------------------------------

  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const length = (a) => Math.hypot(a[0], a[1], a[2]);
  function norm(a) {
    const l = length(a) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  // Polar angle from straight up, and compass direction around the y axis.
  const polar = (d) => Math.acos(clamp(d[1], -1, 1));
  const azimuth = (d) => Math.atan2(d[2], d[0]);
  const fromAngles = (pol, az) => [Math.sin(pol) * Math.cos(az), Math.cos(pol), Math.sin(pol) * Math.sin(az)];
  const horizontal = (az) => [Math.cos(az), 0, Math.sin(az)];

  // Rotate v about unit axis k by angle (Rodrigues).
  function rotate(v, k, angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const kv = cross(k, v), kd = dot(k, v) * (1 - c);
    return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
  }

  // Any unit vector perpendicular to d.
  function perp(d) {
    const ref = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    return norm(cross(d, ref));
  }

  // Carry a reference vector onto the plane perpendicular to a new direction,
  // so bud angles stay consistent along a shoot.
  function transport(u, d) {
    const v = add(u, scale(d, -dot(u, d)));
    return length(v) < 1e-3 ? perp(d) : norm(v);
  }

  // Random small turn of a direction (noise of roughly ±amount radians).
  function jitter(d, amount) {
    const axis = rotate(perp(d), d, rand() * Math.PI * 2);
    return norm(rotate(d, axis, (rand() - 0.5) * 2 * amount));
  }

  // Keep a direction from pointing further down than maxPolar.
  function limitDroop(d, maxPolar) {
    return polar(d) > maxPolar ? fromAngles(maxPolar, azimuth(d)) : d;
  }

  // Fraction of full leaf cover contributing to photosynthesis on a day of year.
  function leafOut(d) {
    if (d < BUD_BREAK) return 0;
    if (d < BUD_BREAK + 26) return (d - BUD_BREAK) / 26;
    if (d < COLOR) return 1;
    if (d < BARE) return 1 - (d - COLOR) / (BARE - COLOR);
    return 0;
  }

  // Light-grid cells (world units) used for shading and phototropism.
  const CELL = 9;
  const cellKey = (i, j, k) => ((i + 512) * 1024 + (j + 128)) * 1024 + (k + 512);

  class Bonsai {
    constructor() {
      this.reset();
    }

    reset() {
      this.day = 0;
      this.nextId = 0;
      this.segs = [];
      this.byId = new Map();
      this.health = 100;
      this.stress = 0;
      this.fert = 0;
      this.dead = false;
      this.startAge = 2;
      this.events = [];
      this.roots = [];
      this.rootById = new Map();
      this.nextRootId = 0;
      this.repotted = -9999;
      this.rootRecover = 0;
      this._seed();
      this.layout();
      this._seedRoots(1);
      this.refresh();
    }

    get dayOfYear() { return this.day % YEAR; }
    get year() { return Math.floor(this.day / YEAR); }
    get season() { return SEASONS[seasonOf(this.dayOfYear)]; }
    get growing() { const d = this.dayOfYear; return d >= GROW_START && d < GROW_END; }

    add(p, t, d, u, len, order, born) {
      const s = { id: this.nextId++, p, t, d, u, len, tLen: len, g: 0.5, born,
        apex: false, order, dead: false, sg: 0, buds: [], w: null, wb: [0, 0, 0], scar: false,
        ph: 0.35 + rand() * 0.4, phy: rand() * Math.PI * 2 };
      this.segs.push(s);
      this.byId.set(s.id, s);
      return s;
    }

    // Unit vector pointing out from the stem toward a bud at angle r.
    budOut(s, r) {
      const v = cross(s.d, s.u);
      return add(scale(s.u, Math.cos(r)), scale(v, Math.sin(r)));
    }

    // A randomly generated two-year-old seedling. Trunk style, height,
    // thickness, curves and branch layout differ for every new tree.
    _seed() {
      const pick = (list) => list[Math.floor(rand() * list.length)];
      const style = pick(['informal', 'informal', 'slanting', 'upright']);
      this.style = style;
      this.pot = { shape: rand() < 0.6 ? 'rect' : 'round', glaze: Math.floor(rand() * POT_GLAZES) };

      const n = 5 + Math.floor(rand() * 3);
      const lean = style === 'slanting' ? between(0.22, 0.4) : between(0, 0.05);
      const leanDir = horizontal(rand() * Math.PI * 2);
      const curve = style === 'informal' ? between(0.16, 0.3) : style === 'slanting' ? between(0.06, 0.14) : between(0.02, 0.06);
      // Curves swing mostly back and forth in one plane, drifting a little.
      let curveAz = rand() * Math.PI * 2;
      const baseG = between(3.8, 5.2);
      const tall = between(0.85, 1.2);
      let phase = rand() < 0.5 ? -1 : 1;
      const trunk = [];
      let p = -1, u = [1, 0, 0];
      for (let i = 0; i < n; i++) {
        const sway = scale(horizontal(curveAz), curve * phase * between(0.6, 1.2));
        const d = norm(add(add([0, 1, 0], scale(leanDir, lean * (1 - i / (n * 1.6)))), sway));
        if (rand() < 0.8) phase = -phase;
        curveAz += between(-0.5, 0.5);
        u = transport(u, d);
        const s = this.add(p, 1, d, u, (13 - i * 1.1) * tall * between(0.85, 1.15), 0, -720 + i * 100);
        s.g = baseG * (1 - (i / n) * 0.8);
        trunk.push(s);
        p = s.id;
      }
      trunk[n - 1].apex = true;

      const branch = (from, az, count, len) => {
        let parent = from;
        let d = fromAngles(between(0.8, 1.25), az);
        let u = transport(from.u, d);
        for (let i = 0; i < count; i++) {
          const s = this.add(parent.id, 1, d, u, Math.max(4, len - i * 1.5), 1, -330 + i * 100);
          s.g = Math.max(0.5, between(1.0, 1.5) - i * 0.3);
          s.phy = i * Math.PI / 2;
          if (i < count - 1) s.buds.push({ t: 1, r: s.phy, born: -200, back: 0, wake: 0 });
          parent = s;
          d = norm(add(d, scale(add(fromAngles(0.95, az), scale(d, -1)), 0.1)));
          d = jitter(d, 0.11);
          u = transport(u, d);
        }
        parent.apex = true;
      };
      // Branches spiral up the trunk, roughly 90–150° apart, with the odd gap
      // and the occasional opposite pair.
      let az = rand() * Math.PI * 2;
      let branches = 0;
      for (let i = rand() < 0.5 ? 1 : 2; i < n - 1; i++) {
        const len = (11 - i * 0.8) * between(0.75, 1.2);
        if (rand() < 0.8 || branches < 2) {
          branch(trunk[i], az, 2 + Math.floor(rand() * 2), len);
          branches++;
          if (rand() < 0.2) branch(trunk[i], az + Math.PI, 2, len * 0.8);
        } else {
          trunk[i].buds.push({ t: 1, r: rand() * Math.PI * 2, born: -200, back: 0, wake: 0 });
        }
        az += between(1.6, 2.6);
        if (rand() < 0.6) trunk[i].buds.push({ t: 1, r: rand() * Math.PI * 2, born: -200, back: 0, wake: 0 });
      }
    }

    refresh() {
      this.layout();
      this.analyze();
      this.layoutRoots();
      this.analyzeRoots();
    }

    layout() {
      let maxY = 0, radius = 0, minX = 0, maxX = 0, minZ = 0, maxZ = 0;
      for (const s of this.segs) {
        let x0 = 0, y0 = 0, z0 = 0;
        if (s.p >= 0) {
          const p = this.byId.get(s.p);
          x0 = p.x0 + (p.x1 - p.x0) * s.t;
          y0 = p.y0 + (p.y1 - p.y0) * s.t;
          z0 = p.z0 + (p.z1 - p.z0) * s.t;
        }
        s.x0 = x0; s.y0 = y0; s.z0 = z0;
        s.x1 = x0 + s.d[0] * s.len;
        s.y1 = y0 + s.d[1] * s.len;
        s.z1 = z0 + s.d[2] * s.len;
        if (s.y1 > maxY) maxY = s.y1;
        const r = Math.hypot(s.x1, s.z1);
        if (r > radius) radius = r;
        if (s.x1 < minX) minX = s.x1;
        if (s.x1 > maxX) maxX = s.x1;
        if (s.z1 < minZ) minZ = s.z1;
        if (s.z1 > maxZ) maxZ = s.z1;
      }
      this.bounds = { maxY, radius, minX, maxX, minZ, maxZ };
    }

    // Per-segment subtree totals: is there a growing tip above this point,
    // how many internodes away, and how much leaf mass and buds it supports.
    analyze() {
      const segs = this.segs;
      let leafy = 0, apices = 0, buds = 0, back = 0, orderSum = 0, maxOrder = 0, wired = 0, biting = 0;
      for (const s of segs) {
        s.leafy = !s.dead && this.day - s.born < LEAF_LIFE;
        s.subApex = s.apex && !s.dead;
        s.apexDist = s.subApex ? 0 : 99;
        s.subBud = s.buds.length;
        if (s.leafy) leafy++;
        if (s.subApex) { apices++; orderSum += s.order; if (s.order > maxOrder) maxOrder = s.order; }
        buds += s.buds.length;
        for (const b of s.buds) if (b.back) back++;
        if (s.w) { wired++; if (s.w.bit) biting++; }
      }
      this._light();
      for (let i = segs.length - 1; i > 0; i--) {
        const s = segs[i];
        const p = this.byId.get(s.p);
        if (s.subApex) p.subApex = true;
        if (s.apexDist + 1 < p.apexDist) p.apexDist = s.apexDist + 1;
        p.subLeaf += s.subLeaf;
        p.subBud += s.subBud;
      }
      this.stats = {
        leafy, apices, buds, back, maxOrder, wired, biting,
        avgOrder: apices ? orderSum / apices : 0,
        segments: segs.length,
        height: this.bounds.maxY,
        spread: this.bounds.radius * 2,
        trunk: segs.length ? segs[0].g * 2 : 0,
      };
    }

    // Advance the simulation by one day.
    step() {
      if (this.dead) return;
      const d = this.dayOfYear;
      if (SEASON_STARTS.includes(d)) this.events.push({ type: 'season', name: this.season });
      if (d === GROW_START) for (const s of this.segs) s.sg = 0;
      const phase = { [LATE_WINTER]: 'latewinter', [BUD_BREAK]: 'budbreak', [HARDEN]: 'harden', [COLOR]: 'color', [BARE]: 'dormant' }[d];
      if (phase) this.events.push({ type: 'phase', name: phase });
      this.refresh();

      const st = this.stats;
      const lo = leafOut(d);
      const hm = 0.3 + 0.7 * this.health / 100;
      const fm = this.fert > 0 ? 1.5 : 1;
      const L = this.lightSum * lo;
      // Roots filling the pot, or recovering from heavy root pruning, hold
      // the whole tree back.
      const pm = this.potFactor * (this.rootRecover > 0 ? 0.6 : 1);
      const E = 15 * L / (L + 120) * hm * fm * pm * Math.min(1, 5000 / this.segs.length);
      this.energy = E;

      if (this.growing) {
        const apices = this.segs.filter((s) => s.apex && !s.dead);
        const vigor = clamp(E / (apices.length * 0.45 + 1), 0.25, 2);
        this.vigor = vigor;
        this._extend(apices, E, d);
        this._thicken(lo * hm * fm * pm);
        this._thickenRoots(lo * hm * fm * pm);
        this._breakBuds(vigor * hm * (1 + this.stress * 0.5), d);
        if (d >= GROW_START + 12) this._backBuds(vigor * hm);
      }

      if (d === GROW_END) {
        // Weak shoots that barely grew this season stop extending.
        for (const s of this.segs) {
          if (s.apex && s.sg < 0.8 && s.p >= 0 && rand() < 0.5) s.apex = false;
        }
      }
      if (d === YEAR - 1) this._yearEnd();
      this._wireDay();
      if (d >= ROOT_START && d < ROOT_END) this._growRoots(d, hm);
      if (d === POT_BOUND_NOTICE && this.rootFill > 0.8) this.events.push({ type: 'phase', name: 'potbound' });
      if (this.rootRecover > 0) this.rootRecover--;

      const req = 2 + this.segs[0].g * 2;
      const ratio = st.leafy / req;
      if (this.growing) this.health += ratio < 0.6 ? -(0.6 - ratio) : 0.12;
      else this.health += 0.03;
      this.health = clamp(this.health, 0, 100);
      if (this.fert > 0) this.fert--;
      this.stress *= 0.988;
      if (this.health <= 0 || this.segs[0].dead) {
        this.dead = true;
        this.events.push({ type: 'died' });
      }
      this.day++;
    }

    // Leaves crowded into the same patch of canopy shade each other.
    // Shaded shoots grow weakly, rarely bud, and eventually die back, so a
    // dense interior has to be thinned to stay healthy.
    _light() {
      const key = (s) => cellKey(Math.floor(s.x1 / CELL), Math.floor(s.y1 / CELL), Math.floor(s.z1 / CELL));
      const count = new Map();
      for (const s of this.segs) {
        if (!s.leafy) continue;
        const k = key(s);
        count.set(k, (count.get(k) || 0) + 1);
      }
      let sum = 0;
      for (const s of this.segs) {
        const c = count.get(key(s)) || 0;
        s.light = 1 / (1 + Math.max(0, c - 4) * 0.3);
        // Vigorous shoots (long internodes) carry bigger leaves.
        s.subLeaf = s.leafy ? (0.5 + s.tLen / 8) * s.light : 0;
        sum += s.subLeaf;
      }
      this.lightSum = sum;
      this.leafCells = count;
    }

    // Direction a shoot at (x, y, z) sees the most light from: mostly the sky
    // above, pulled sideways toward gaps in the canopy and outward from the
    // trunk.
    _lightDir(x, y, z) {
      const i = Math.floor(x / CELL), j = Math.floor(y / CELL), k = Math.floor(z / CELL);
      const c = (di, dj, dk) => this.leafCells.get(cellKey(i + di, j + dj, k + dk)) || 0;
      const gx = c(-1, 0, 0) - c(1, 0, 0) + 0.5 * (c(-1, 1, 0) + c(-1, -1, 0) - c(1, 1, 0) - c(1, -1, 0));
      const gz = c(0, 0, -1) - c(0, 0, 1) + 0.5 * (c(0, 1, -1) + c(0, -1, -1) - c(0, 1, 1) - c(0, -1, 1));
      const gy = c(0, -1, 0) - c(0, 1, 0);
      const R = Math.max(15, this.bounds.radius);
      return norm([gx * 0.12 + x / R * 0.4, 1 + gy * 0.08, gz * 0.12 + z / R * 0.4]);
    }

    // Phototropism: each new section turns part way toward the light. Side
    // branches are held out from the leader at an angle, keeping their own
    // compass direction, so most end up angled up or sideways. Each shoot
    // has its own light-seeking strength (s.ph): a few stay flatter or droop.
    _phototrope(s) {
      const sun = this._lightDir(s.x1, s.y1, s.z1);
      let target;
      if (s.order === 0) {
        target = norm(add([0, 1, 0], sun));
      } else {
        const flat = Math.hypot(s.d[0], s.d[2]) < 0.05;
        const az = flat ? rand() * Math.PI * 2 : azimuth(s.d);
        const held = fromAngles(s.order === 1 ? 1.0 : 1.15, az);
        target = norm(add(scale(held, 1 - s.ph), scale(sun, s.ph)));
        if (polar(target) < 0.3) target = fromAngles(0.3, az);
      }
      const turned = norm(add(s.d, scale(add(target, scale(s.d, -1)), 0.18)));
      return limitDroop(jitter(turned, 0.13), 1.9);
    }

    // Growing tips share the tree's energy. Higher, outer tips get more
    // (apical dominance), so an unpruned tree gets leggy at the top.
    _extend(apices, E, d) {
      if (!apices.length) return;
      const H = Math.max(20, this.bounds.maxY);
      const R = Math.max(10, this.bounds.radius);
      const w = apices.map((s) => Math.exp(1.6 * s.y1 / H + 0.5 * Math.hypot(s.x1, s.z1) / R) * s.light);
      const sum = w.reduce((a, b) => a + b, 0);
      // Strong spring flush in April and May, slowing through June, little
      // extension once shoots harden off in July and August.
      const flush = d < 150 ? 1.45 : d < HARDEN ? 0.8 : 0.28;
      apices.forEach((s, i) => {
        const rate = Math.min(0.85, E * w[i] / sum) * flush;
        s.len += rate;
        s.sg += rate;
        if (s.len >= s.tLen) this._node(s, rate);
      });
    }

    // The tip reaches its internode length: set a pair of buds at the node
    // and keep growing from a new segment. Maple buds come in opposite pairs,
    // each pair at right angles to the one below (decussate). Vigorous shoots
    // make long internodes.
    _node(s, rate) {
      const extra = s.len - s.tLen;
      s.len = s.tLen;
      s.apex = false;
      if (rand() < 0.95) s.buds.push({ t: 1, r: s.phy, born: this.day, back: 0, wake: 0 });
      if (rand() < 0.5) s.buds.push({ t: 1, r: s.phy + Math.PI, born: this.day, back: 0, wake: 0 });
      const d = this._phototrope(s);
      const c = this.add(s.id, 1, d, transport(s.u, d), 0.2 + extra, s.order, this.day);
      c.ph = s.ph;
      c.phy = s.phy + Math.PI / 2;
      c.tLen = clamp(3 + rate * 8, 3, 12);
      c.apex = true;
      c.g = Math.min(0.5, s.g);
    }

    // Each section of wood lays down a ring in proportion to the leaf mass
    // whose sap flows through it, so a big unpruned (sacrifice) branch
    // thickens the trunk below it but not above it.
    _thicken(k) {
      const segs = this.segs;
      for (const s of segs) {
        s.childArea = 0;
        if (!s.dead && s.subLeaf) s.g = Math.sqrt(s.g * s.g + 0.0012 * s.subLeaf * k);
      }
      // Pipe model: wood must carry the sap for every limb above it, so it
      // swells toward the combined cross-section of the limbs it feeds.
      for (let i = segs.length - 1; i >= 0; i--) {
        const s = segs[i];
        const floor = Math.sqrt(0.85 * s.childArea);
        if (floor > s.g) s.g += (floor - s.g) * 0.04;
        if (s.p >= 0) this.byId.get(s.p).childArea += s.g * s.g;
      }
    }

    // Dormant buds are held back by growing tips above them. Remove the tips
    // (prune or pinch) and the buds near the cut wake up. Each spring, the
    // buds set last season near the shoot tips also break, so every shoot
    // branches a little more each year.
    _breakBuds(k, d) {
      const flush = d < GROW_START + 40;
      const n = this.segs.length;
      for (let i = 0; i < n; i++) {
        const s = this.segs[i];
        if (s.dead || !s.buds.length) continue;
        for (let j = s.buds.length - 1; j >= 0; j--) {
          const b = s.buds[j];
          const age = this.day - b.born;
          if (age < 20) continue;
          let p;
          if (!s.subApex || b.wake) {
            // Buds released by a cut respond even when vigour is spread thin.
            p = 0.035 * Math.max(0.7, k) / k;
          } else {
            p = 0.00022 * Math.min(s.apexDist, 8);
            if (flush && age > 120 && age < 420) p += 0.55 * Math.exp(-(s.apexDist - 1) / 2.5) / 37;
          }
          if (b.back) p *= 1.6;
          if (rand() < p * k * s.light * s.light) {
            s.buds.splice(j, 1);
            this._sprout(s, b);
            s.subApex = true;
            s.apexDist = 1;
          }
        }
      }
    }

    _sprout(s, b) {
      // With no tip left above it, the new shoot takes over as the leader of
      // this branch (or the trunk). Otherwise it is a new side branch.
      const leader = !s.subApex;
      const order = leader ? s.order : s.order + 1;
      const spread = leader ? 0.45 : 0.75 + rand() * 0.35;
      const out = this.budOut(s, b.r);
      let d = norm(add(scale(s.d, Math.cos(spread)), scale(out, Math.sin(spread))));
      // Buds on the underside of a sideways branch mostly push up from the
      // top side instead; a few still start out drooping.
      if (polar(d) > 1.5 && rand() < 0.8) d = norm(add(scale(s.d, Math.cos(spread)), scale(out, -Math.sin(spread))));
      d = limitDroop(d, 1.9);
      const c = this.add(s.id, b.t, d, transport(s.u, d), 0.2, order, this.day);
      c.ph = rand() < 0.15 ? 0.1 + rand() * 0.2 : 0.35 + rand() * 0.4;
      c.apex = true;
      c.tLen = 4 + rand() * 3;
      c.g = 0.4;
      this.events.push({ type: 'sprout', back: !!b.back, seg: c.id });
    }

    // Old wood occasionally pushes new buds, much more so after pruning
    // redirects vigour back into the tree.
    _backBuds(k) {
      const n = this.segs.length;
      for (let i = 0; i < n; i++) {
        const s = this.segs[i];
        if (s.dead || s.g < 0.6 || this.day - s.born < YEAR || s.buds.length >= 2) continue;
        const p = 0.0004 * k * s.light * (1 + 3 * this.stress) * (s.subApex ? 1 : 2.5);
        if (rand() < p) {
          s.buds.push({ t: 0.15 + rand() * 0.75, r: rand() * Math.PI * 2, born: this.day, back: 1, wake: 0 });
          this.events.push({ type: 'backbud', seg: s.id });
        }
      }
    }

    // Wired bends slowly set, fastest while the wood is growing. Meanwhile
    // the branch thickens under the wire, which eventually bites in.
    _wireDay() {
      const rate = this.growing ? 0.025 : 0.006;
      for (const s of this.segs) {
        if (!s.w) continue;
        s.wb = scale(s.wb, 1 - rate);
        if (!s.w.bit && s.g > s.w.g0 * 1.25) {
          s.w.bit = 1;
          this.events.push({ type: 'bite', seg: s.id });
        }
        if (s.g > s.w.g0 * 1.8 && !s.scar) {
          s.scar = true;
          this.events.push({ type: 'scar', seg: s.id });
        }
      }
    }

    _yearEnd() {
      for (const s of this.segs) {
        for (const b of s.buds) b.wake = 0;
        const shaded = s.light < 0.35;
        s.buds = s.buds.filter((b) => !(shaded && rand() < 0.5) && (this.day - b.born < 2 * YEAR || rand() < 0.2));
        if (shaded && s.apex && s.p >= 0 && rand() < 0.5) s.apex = false;
      }
      this.analyze();
      let died = 0;
      for (const s of this.segs) {
        if (!s.dead && !s.subApex && !s.subBud && !s.subLeaf) { s.dead = true; died++; }
      }
      if (died) this.events.push({ type: 'dieback', count: died });
    }

    // ---- Player actions -------------------------------------------------

    // Segments removed by cutting `id` at fraction t (ids of whole segments).
    cutSet(id, t) {
      const s = this.byId.get(id);
      if (!s) return new Set();
      const rm = new Set();
      if (t < 0.12 && s.p >= 0) rm.add(id);
      else for (const c of this.segs) if (c.p === id && c.t > t) rm.add(c.id);
      for (const c of this.segs) if (rm.has(c.p)) rm.add(c.id);
      return rm;
    }

    canCut(id, t) {
      const s = this.byId.get(id);
      return !!s && !(s.p < 0 && t < 0.25);
    }

    cut(id, t) {
      if (!this.canCut(id, t)) return null;
      const s = this.byId.get(id);
      const before = this.stats.leafy;
      const whole = t < 0.12 && s.p >= 0;
      this._remove(this.cutSet(id, t));
      if (!whole) {
        t = Math.min(t, 0.97);
        for (const c of this.segs) if (c.p === id) c.t = Math.min(1, c.t / t);
        s.buds = s.buds.filter((b) => b.t <= t + 0.03).map((b) => ({ ...b, t: Math.min(1, b.t / t) }));
        s.len *= t;
        s.tLen = s.len;
        s.apex = false;
        if (!s.buds.length && !s.dead && rand() < 0.8) {
          s.buds.push({ t: 0.85, r: rand() * Math.PI * 2, born: this.day - 20, back: 0, wake: 0 });
        }
      }
      this._wake(whole ? s.p : id, 3);
      this.refresh();
      const frac = before ? (before - this.stats.leafy) / before : 0;
      this.stress = Math.min(3, this.stress + frac * 1.5);
      // Heavy pruning in the growing season costs health; dormant-season
      // pruning is much gentler, as with real deciduous bonsai.
      let hit = 0;
      if (this.growing && frac > 0.3) hit = (frac - 0.3) * 40;
      else if (!this.growing && frac > 0.5) hit = (frac - 0.5) * 20;
      this.health = Math.max(0, this.health - hit);
      return { frac, hit, removed: before - this.stats.leafy };
    }

    // Cutting or pinching removes the hormone signal from the tip, so the
    // dormant buds just below wake up.
    _wake(id, levels) {
      for (let s = this.byId.get(id); s && levels > 0; s = this.byId.get(s.p), levels--) {
        for (const b of s.buds) b.wake = 1;
      }
    }

    _remove(rm) {
      if (!rm.size) return;
      this.segs = this.segs.filter((s) => !rm.has(s.id));
      this.byId = new Map(this.segs.map((s) => [s.id, s]));
    }

    // ---- Wiring --------------------------------------------------------

    // A wire runs from the clicked section out to the tip of that branch
    // (sections of the same branch order), not into side branches.
    wireChain(id) {
      const s = this.byId.get(id);
      const chain = new Set();
      if (!s) return chain;
      chain.add(id);
      for (const c of this.segs) {
        if (chain.has(c.p) && c.order === s.order) chain.add(c.id);
      }
      return chain;
    }

    applyWire(id) {
      let n = 0;
      for (const cid of this.wireChain(id)) {
        const c = this.byId.get(cid);
        if (c.dead || c.w) continue;
        c.w = { d: this.day, g0: c.g, bit: 0 };
        c.wb = [0, 0, 0];
        n++;
      }
      this.refresh();
      return n;
    }

    // Removes the whole wire run containing `id`. Whatever part of the bend
    // has not set yet springs back.
    removeWire(id) {
      let top = this.byId.get(id);
      if (!top || !top.w) return { n: 0, sprang: 0 };
      for (let p = this.byId.get(top.p); p && p.w && p.order === top.order; p = this.byId.get(p.p)) top = p;
      let n = 0, sprang = 0;
      for (const cid of this.wireChain(top.id)) {
        const c = this.byId.get(cid);
        if (!c.w) continue;
        if (c.w.bit) c.scar = c.scar || c.g > c.w.g0 * 1.5;
        const unset = length(c.wb);
        if (unset > 0.01) {
          this._rotate(c.id, norm(c.wb), -unset);
          sprang = Math.max(sprang, unset);
        }
        c.w = null;
        c.wb = [0, 0, 0];
        n++;
      }
      this.refresh();
      return { n, sprang };
    }

    // How far a section can be bent beyond its set position. Young shoots
    // are flexible; thick wood barely moves.
    maxBend(s) {
      return 1.4 / (1 + 0.8 * s.g);
    }

    // Bend a wired section about its base: rotate by `angle` radians about
    // unit `axis`. The section and everything growing from it rotate
    // together. The unset bend is kept as a rotation vector (axis × angle).
    bend(id, axis, angle) {
      const s = this.byId.get(id);
      if (!s || !s.w || s.dead) return null;
      // Shorten the requested move, keeping its direction, so the unset bend
      // stays within the limit. (Rescaling the total instead would swing the
      // branch off the direction the player is dragging.)
      const max = this.maxBend(s);
      const a = scale(axis, angle);
      let k = 1;
      const after = add(s.wb, a);
      if (dot(after, after) > max * max) {
        const A = dot(a, a), B = 2 * dot(s.wb, a), C = dot(s.wb, s.wb) - max * max;
        const D = B * B - 4 * A * C;
        k = D < 0 ? 0 : clamp((-B + Math.sqrt(D)) / (2 * A), 0, 1);
      }
      const applied = angle * k;
      s.wb = add(s.wb, scale(axis, applied));
      if (Math.abs(applied) > 1e-6) this._rotate(id, axis, applied);
      this.layout();
      return { applied, limited: k < 1 - 1e-6 };
    }

    _rotate(id, axis, angle) {
      const sub = new Set([id]);
      for (const c of this.segs) {
        if (sub.has(c.p)) sub.add(c.id);
        if (sub.has(c.id)) {
          c.d = norm(rotate(c.d, axis, angle));
          c.u = transport(rotate(c.u, axis, angle), c.d);
          // Unset bends further out are stored in world space; carry them
          // round too, so their spring-back still undoes their own bend.
          if (c.id !== id && c.w) c.wb = rotate(c.wb, axis, angle);
        }
      }
    }

    pinchTip(id) {
      const s = this.byId.get(id);
      if (!s || !s.apex) return false;
      s.apex = false;
      this._wake(id, 2);
      this.stress = Math.min(3, this.stress + 0.03);
      this.refresh();
      return true;
    }

    removeBud(id, index) {
      const s = this.byId.get(id);
      if (!s || !s.buds[index]) return false;
      s.buds.splice(index, 1);
      this.refresh();
      return true;
    }

    fertilize() {
      if (this.fert > 0) {
        this.health = Math.max(0, this.health - 12);
        return 'burn';
      }
      this.fert = 45;
      return this.growing ? 'ok' : 'dormant';
    }

    // ---- Roots and nebari ---------------------------------------------------
    //
    // Roots are a second list of segments, laid out from the trunk base.
    // Main roots (p = -1) attach around the trunk at compass angle `az`.

    addRoot(p, t, d, len, order, born, az) {
      const r = { id: this.nextRootId++, p, t, d, u: perp(d), len, tLen: len, g: 0.4, born,
        tip: false, order, dead: false, cutDay: -1, az: az ?? azimuth(d) };
      this.roots.push(r);
      this.rootById.set(r.id, r);
      return r;
    }

    // A taproot heading down plus 3–5 roots spreading out just below the soil.
    _seedRoots(scale) {
      const chain = (az, pol, count, g, len) => {
        let p = -1, d = fromAngles(pol, az);
        for (let i = 0; i < count; i++) {
          const r = this.addRoot(p, 1, d, len, 0, -300 + i * 60, az);
          r.g = Math.max(0.4, (g - i * 0.3) * scale);
          p = r.id;
          // Main roots stay nearly level for their first sections (the nebari),
          // then start to sink; the taproot keeps heading down.
          const nextPol = pol > 2.4 ? polar(d) : i < 2 ? 1.6 : Math.min(2.3, polar(d) + 0.12);
          d = jitter(fromAngles(nextPol, azimuth(d)), i < 2 ? 0.06 : 0.12);
          if (polar(d) < 1.62) d = fromAngles(1.62, azimuth(d));
          if (i === count - 1) r.tip = true;
        }
      };
      const n = 3 + Math.floor(rand() * 3);
      let az = rand() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        chain(az, between(1.57, 1.63), 2 + Math.floor(rand() * 2), between(0.9, 1.4), 7);
        az += (Math.PI * 2) / n + between(-0.5, 0.5);
      }
      chain(rand() * Math.PI * 2, Math.PI - 0.25, 2, 1.6, 6);
    }

    get potSpace() { return POT_SPACE[this.pot?.shape === 'round' ? 'round' : 'rect']; }

    // How much root length the pot holds before it is full.
    get rootCapacity() {
      const p = this.potSpace;
      return p.r ? (Math.PI * p.r * p.r * p.depth * 0.7) / 95 : (4 * p.hx * p.hz * p.depth) / 95;
    }

    // Outward normal of the nearest pot wall if (x, y, z) is within `margin`
    // of it (or past it), else null.
    _wall(x, y, z, margin) {
      const p = this.potSpace;
      if (y < -p.depth + margin) return [0, -1, 0];
      if (p.r) {
        const allow = p.r - (-y) * 0.6;
        const rr = Math.hypot(x, z);
        if (rr > allow - margin) return norm([x / (rr || 1), -0.3, z / (rr || 1)]);
        return null;
      }
      if (Math.abs(x) > p.hx - margin) return [Math.sign(x), 0, 0];
      if (Math.abs(z) > p.hz - margin) return [0, 0, Math.sign(z)];
      return null;
    }

    layoutRoots() {
      // Main roots attach close to the trunk's centre; their own thickness
      // forms the flare. (Tying this to trunk girth would shift the whole
      // root system outward as the trunk thickens.)
      const R0 = 1.2;
      for (const r of this.roots) {
        if (r.p < 0) {
          const down = polar(r.d) > 2.2;
          r.x0 = Math.cos(r.az) * R0 * (down ? 0.3 : 1);
          // Surface roots sit with roughly their top half above the soil
          // (at y ≈ 1.2): this is the visible nebari.
          r.y0 = down ? -1.5 : Math.min(-0.2, 1.2 - r.g * 0.45);
          r.z0 = Math.sin(r.az) * R0 * (down ? 0.3 : 1);
        } else {
          const p = this.rootById.get(r.p);
          r.x0 = p.x0 + (p.x1 - p.x0) * r.t;
          r.y0 = p.y0 + (p.y1 - p.y0) * r.t;
          r.z0 = p.z0 + (p.z1 - p.z0) * r.t;
        }
        r.x1 = r.x0 + r.d[0] * r.len;
        r.y1 = r.y0 + r.d[1] * r.len;
        r.z1 = r.z0 + r.d[2] * r.len;
      }
    }

    // Root totals, pot fullness and the nebari score.
    analyzeRoots() {
      const roots = this.roots;
      let length = 0, mass = 0;
      for (const r of roots) {
        r.subLen = r.len;
        r.kids = 0;
        length += r.len;
        mass += r.g * r.g * r.len;
      }
      for (let i = roots.length - 1; i >= 0; i--) {
        const r = roots[i];
        if (r.p >= 0) {
          const p = this.rootById.get(r.p);
          p.subLen += r.subLen;
          p.kids++;
        }
      }
      this.rootLength = length;
      this.rootMass = mass;
      this.rootFill = length / this.rootCapacity;
      this.potFactor = 1 - 0.6 * clamp((this.rootFill - 0.75) / 0.25, 0, 1);
      this.nebari = this._nebariScore();
      if (this.stats) {
        this.stats.rootFill = this.rootFill;
        this.stats.nebari = this.nebari.score;
      }
    }

    _sector(az) {
      return ((Math.floor(((az + Math.PI) / (Math.PI * 2)) * 8) % 8) + 8) % 8;
    }

    // Nebari: how evenly the surface roots spread around the trunk, how
    // thick they are next to it, minus downward roots and crowding.
    _nebariScore() {
      const main = this.roots.filter((r) => r.p < 0 && !r.dead);
      const surface = main.filter((r) => polar(r.d) <= 2.2);
      const down = main.filter((r) => polar(r.d) > 2.2);
      const sec = new Array(8).fill(0);
      let surfaceArea = 0;
      for (const r of surface) {
        const a = r.g * r.g, i = this._sector(r.az);
        sec[i] += a * 0.6;
        sec[(i + 1) % 8] += a * 0.2;
        sec[(i + 7) % 8] += a * 0.2;
        surfaceArea += a;
      }
      const downArea = down.reduce((t, r) => t + r.g * r.g, 0);
      const mean = surfaceArea / 8;
      if (!mean) return { score: 0, hint: 'No surface roots yet' };
      const sd = Math.sqrt(sec.reduce((t, v) => t + (v - mean) ** 2, 0) / 8);
      const evenness = clamp(1 - (sd / mean) * 0.8, 0, 1);
      const coverage = sec.filter((v) => v > mean * 0.3).length / 8;
      const trunkG = this.segs[0] ? this.segs[0].g : 1;
      const thick = clamp(Math.sqrt(surfaceArea) / trunkG / 1.1, 0, 1);
      let penalty = clamp(downArea / (downArea + surfaceArea), 0, 1) * 0.5;
      for (let i = 0; i < surface.length; i++) {
        for (let j = i + 1; j < surface.length; j++) {
          const da = Math.abs(Math.atan2(Math.sin(surface[i].az - surface[j].az), Math.cos(surface[i].az - surface[j].az)));
          if (da < 0.25) penalty += 0.04;
        }
      }
      penalty = Math.min(0.6, penalty);
      const score = Math.round(100 * (0.45 * evenness + 0.25 * coverage + 0.3 * thick) * (1 - penalty));
      let hint;
      const gap = sec.indexOf(Math.min(...sec));
      if (downArea > surfaceArea * 0.25) hint = 'A thick downward root is drawing strength from the nebari. Cut it when repotting';
      else if (sec[gap] < mean * 0.3) hint = `Gap at the ${SIDES[gap]}. Swing a root there or let a cut root sprout`;
      else if (thick < 0.6) hint = 'Surface roots are still thin. Let the tree grow to thicken them';
      else hint = 'Nice, even spread';
      return { score, hint, sectors: sec };
    }

    // Root tips extend through the pot from mid-March to October. They stay
    // below the soil, turn to run along the pot walls, and branch.
    _growRoots(d, hm) {
      if (d === ROOT_START + 5) this._sproutCutRoots();
      const tips = this.roots.filter((r) => r.tip && !r.dead);
      if (!tips.length) return;
      // Growth stops once the pot is full.
      const space = clamp(1.05 - this.rootFill, 0, 1);
      if (!space) return;
      const total = (0.8 + 0.02 * (this.lightSum || 0)) * hm * space * (this.rootRecover > 0 ? 0.5 : 1);
      const per = Math.min(0.7, total / tips.length);
      for (const r of tips) {
        r.len += per;
        const x = r.x0 + r.d[0] * r.len, y = r.y0 + r.d[1] * r.len, z = r.z0 + r.d[2] * r.len;
        const wall = this._wall(x, y, z, 1);
        if (wall) {
          r.len -= per;
          // A fresh tip that hits the wall turns to run along it; one that
          // keeps hitting walls (a corner) stops.
          if (r.len < 1 && (r.turns = (r.turns || 0) + 1) <= 3) this._aimAlong(r, wall);
          else if (r.len < 1) r.tip = false;
          else this._rootNode(r);
        } else if (r.len >= r.tLen) {
          this._rootNode(r);
        }
        r.x1 = r.x0 + r.d[0] * r.len;
        r.y1 = r.y0 + r.d[1] * r.len;
        r.z1 = r.z0 + r.d[2] * r.len;
      }
    }

    // Turn a root to run along a wall instead of into it: this is how
    // circling roots form.
    _aimAlong(r, wall) {
      r.d = this._slide(r.d, wall);
      r.u = perp(r.d);
    }

    // Remove the part of a direction heading into a wall, and keep roots
    // level or heading down: roots don't grow upward.
    _slide(d, wall) {
      if (wall) d = add(d, scale(wall, -Math.max(0, dot(d, wall))));
      if (Math.hypot(d[0], d[2]) < 0.15 && d[1] > -0.5) d = wall && wall[1] === 0 ? cross(wall, [0, 1, 0]) : [d[0] || 1, d[1], d[2]];
      d = norm(d);
      return d[1] > -0.03 ? norm([d[0], -0.03, d[2]]) : d;
    }

    _rootNode(r) {
      r.tip = false;
      const ex = r.x0 + r.d[0] * r.len, ey = r.y0 + r.d[1] * r.len, ez = r.z0 + r.d[2] * r.len;
      const place = (c) => {
        c.x0 = ex; c.y0 = ey; c.z0 = ez;
        c.x1 = ex + c.d[0] * c.len; c.y1 = ey + c.d[1] * c.len; c.z1 = ez + c.d[2] * c.len;
      };
      // Keep a new direction out of the walls and below the soil.
      const steer = (d) => {
        d = this._slide(d, this._wall(ex, ey, ez, 4));
        return ey > -1 && d[1] > -0.15 ? norm([d[0], -0.15, d[2]]) : d;
      };
      // Roots sink gradually (gravitropism) and wander. Main roots run out
      // near the surface first, which is what makes a nebari.
      const near = r.order === 0 && Math.hypot(ex, ez) < 22;
      const sink = near ? 1.6 : Math.min(r.order === 0 ? 2.0 : 2.2, polar(r.d) + 0.07);
      const d = steer(jitter(fromAngles(sink, azimuth(r.d)), near ? 0.08 : 0.15));
      const c = this.addRoot(r.id, 1, d, 0.2, r.order, this.day);
      c.tLen = 5 + rand() * 3;
      c.g = Math.min(0.4, r.g);
      c.tip = !(r.order >= 3 && rand() < 0.2);
      place(c);
      if (this.roots.length < 1200 && r.order < 4 && rand() < 0.4) {
        const side = rotate(perp(d), d, rand() * Math.PI * 2);
        let ld = norm(add(scale(d, Math.cos(1.1)), scale(side, Math.sin(1.1))));
        if (polar(ld) < 1.62) ld = fromAngles(1.62, azimuth(ld));
        const l = this.addRoot(r.id, 1, steer(ld), 0.2, r.order + 1, this.day);
        l.tLen = 4 + rand() * 3;
        l.g = 0.3;
        l.tip = true;
        place(l);
      }
    }

    // Roots cut at repotting push a few new roots from the cut end the next
    // spring, spreading outward: this is how a nebari is built up. Roots the
    // player cut push 2–3; ends trimmed by combing out push at most one.
    // Sprouting stops at the same root cap as normal growth.
    _sproutCutRoots() {
      const cut = this.roots.filter((r) => r.cutDay >= 0 && !r.dead);
      for (const r of cut) {
        const combed = r.cutDay % 1 !== 0;
        r.cutDay = -1;
        if (this.roots.length >= 1200) continue;
        const n = combed ? (rand() < 0.5 ? 1 : 0) : 2 + (rand() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          const az = azimuth(r.d) + (i - (n - 1) / 2) * 0.6 + between(-0.15, 0.15);
          const c = this.addRoot(r.id, 1, fromAngles(between(1.6, 1.85), az), 0.2, r.order + 1, this.day);
          const wall = this._wall(r.x1, r.y1, r.z1, 4);
          if (wall) this._aimAlong(c, wall);
          c.tLen = 5 + rand() * 2;
          c.g = 0.35;
          c.tip = true;
        }
      }
    }

    // Each main root thickens with the leaf mass on its side of the canopy
    // (roots and branches on the same side are linked), shared with any other
    // main roots on that side; downward roots take more than their share.
    // The thickening runs from the trunk out along the root, then the same
    // pipe-model floor as the branches applies.
    _thickenRoots(k) {
      const mass = new Array(8).fill(0);
      let total = 0;
      for (const s of this.segs) {
        if (!s.leafy) continue;
        const m = (0.5 + s.tLen / 8) * s.light;
        mass[this._sector(Math.atan2(s.z1, s.x1))] += m;
        total += m;
      }
      const smooth = mass.map((m, i) => 0.7 * (0.5 * m + 0.25 * mass[(i + 1) % 8] + 0.25 * mass[(i + 7) % 8]) + 0.3 * total / 8);
      const main = this.roots.filter((r) => r.p < 0 && !r.dead);
      const weight = (r) => (polar(r.d) > 2.2 ? 1.5 : 1);
      const share = new Array(8).fill(0);
      for (const r of main) share[this._sector(r.az)] += weight(r);
      const inc = new Map();
      for (const r of main) {
        const i = this._sector(r.az);
        inc.set(r.id, 0.0012 * smooth[i] * weight(r) / share[i] * k);
      }
      const primaryOf = new Map();
      for (const r of this.roots) {
        const top = r.p < 0 ? r.id : primaryOf.get(r.p);
        primaryOf.set(r.id, top);
        const p = this.rootById.get(top);
        if (!r.dead && p && inc.has(top)) r.g = Math.sqrt(r.g * r.g + inc.get(top) * (r.subLen / p.subLen));
      }
      for (const r of this.roots) r.childArea = 0;
      for (let i = this.roots.length - 1; i >= 0; i--) {
        const r = this.roots[i];
        const floor = Math.sqrt(0.85 * r.childArea);
        if (floor > r.g) r.g += (floor - r.g) * 0.04;
        if (r.p >= 0) this.rootById.get(r.p).childArea += r.g * r.g;
      }
    }

    // ---- Repotting ----

    get canRepot() {
      const d = this.dayOfYear;
      return d >= REPOT_START && d < REPOT_END;
    }

    startRepot() {
      this.repotMass0 = this.rootMass;
    }

    rootCutSet(id, t) {
      const r = this.rootById.get(id);
      if (!r) return new Set();
      const rm = new Set();
      if (t < 0.12) rm.add(id);
      else for (const c of this.roots) if (c.p === id && c.t > t) rm.add(c.id);
      for (const c of this.roots) if (rm.has(c.p)) rm.add(c.id);
      return rm;
    }

    cutRoot(id, t) {
      const r = this.rootById.get(id);
      if (!r) return null;
      const whole = t < 0.12;
      const rm = this.rootCutSet(id, t);
      this.roots = this.roots.filter((x) => !rm.has(x.id));
      this.rootById = new Map(this.roots.map((x) => [x.id, x]));
      if (!whole) {
        for (const c of this.roots) if (c.p === id) c.t = Math.min(1, c.t / t);
        r.len *= t;
        r.tLen = r.len;
        r.tip = false;
        r.cutDay = this.day;
      } else if (r.p >= 0) {
        this.rootById.get(r.p).cutDay = this.day;
      }
      this.refresh();
    }

    // Swing a main root (and everything on it) around the trunk.
    swingRoot(id, angle) {
      let top = this.rootById.get(id);
      while (top && top.p >= 0) top = this.rootById.get(top.p);
      if (!top) return;
      const sub = new Set([top.id]);
      for (const r of this.roots) {
        if (sub.has(r.p)) sub.add(r.id);
        if (sub.has(r.id)) {
          r.d = norm(rotate(r.d, [0, 1, 0], angle));
          r.u = transport(rotate(r.u, [0, 1, 0], angle), r.d);
        }
      }
      top.az -= angle;
      this.refresh();
    }

    // Back into fresh soil: long and circling fine roots are combed out and
    // trimmed until the pot is about a third full. Removing too much root
    // mass in total costs health and slows growth this season.
    finishRepot() {
      // Only the player's own cuts count as root loss; combing out fine
      // roots is a normal part of repotting.
      const loss = this.repotMass0 ? 1 - this.rootMass / this.repotMass0 : 0;
      const target = 0.3 * this.rootCapacity;
      let len = this.rootLength;
      const kids = new Map();
      for (const r of this.roots) if (r.p >= 0) kids.set(r.p, (kids.get(r.p) || 0) + 1);
      for (let pass = 0; pass < 20 && len > target; pass++) {
        const ends = this.roots.filter((r) => !kids.get(r.id) && r.p >= 0)
          .sort((a, b) => (Math.hypot(b.x1, b.z1) - b.y1) - (Math.hypot(a.x1, a.z1) - a.y1));
        if (!ends.length) break;
        const rm = new Set();
        for (const r of ends) {
          if (len <= target) break;
          rm.add(r.id);
          len -= r.len;
          const p = this.rootById.get(r.p);
          // A fractional day marks a root trimmed by combing (not the player).
          p.cutDay = this.day + 0.5;
          kids.set(p.id, kids.get(p.id) - 1);
        }
        this.roots = this.roots.filter((r) => !rm.has(r.id));
      }
      this.rootById = new Map(this.roots.map((r) => [r.id, r]));
      this.refresh();
      const hit = loss > 0.35 ? (loss - 0.35) * 60 : 0;
      this.health = Math.max(0, this.health - hit);
      if (loss > 0.35) this.rootRecover = 120;
      this.repotted = this.day;
      return { loss, hit };
    }

    // ---- Saving -----------------------------------------------------------

    // Segment record: [id, parent, t, d, u, len, tLen, g, born, apex, order,
    //   dead, sg, buds, wire, wb, scar, ph, phy]
    // Bud record: [t, r, born, back, wake]
    serialize() {
      const v = (a) => a.map(r3);
      return JSON.stringify({
        v: SAVE_VERSION, day: this.day, pot: this.pot, style: this.style, nextId: this.nextId,
        health: r3(this.health), stress: r3(this.stress), fert: this.fert, dead: this.dead,
        startAge: this.startAge, nextRootId: this.nextRootId, repotted: this.repotted,
        rootRecover: this.rootRecover,
        // Root record: [id, parent, t, d, len, tLen, g, born, tip, order, dead, cutDay, az]
        roots: this.roots.map((r) => [r.id, r.p, r3(r.t), v(r.d), r3(r.len), r3(r.tLen), r3(r.g), r.born,
          r.tip ? 1 : 0, r.order, r.dead ? 1 : 0, r.cutDay, r3(r.az)]),
        segs: this.segs.map((s) => [s.id, s.p, r3(s.t), v(s.d), v(s.u), r3(s.len), r3(s.tLen), r3(s.g),
          s.born, s.apex ? 1 : 0, s.order, s.dead ? 1 : 0, r3(s.sg),
          s.buds.map((b) => [r3(b.t), r3(b.r), b.born, b.back ? 1 : 0, b.wake ? 1 : 0]),
          s.w ? [s.w.d, r3(s.w.g0), s.w.bit] : 0, v(s.wb), s.scar ? 1 : 0, r3(s.ph), r3(s.phy)]),
      });
    }

    static fromJSON(text) {
      const d = JSON.parse(text);
      if (![5, SAVE_VERSION].includes(d.v) || !Array.isArray(d.segs) || !d.segs.length) throw new Error('Not a 3D bonsai save');
      const b = Object.create(Bonsai.prototype);
      Object.assign(b, { day: d.day, nextId: d.nextId, health: d.health, stress: d.stress,
        fert: d.fert, dead: !!d.dead, startAge: d.startAge ?? 2, events: [],
        pot: d.pot || { shape: 'rect', glaze: 0 }, style: d.style || 'informal' });
      b.segs = d.segs.map(([id, p, t, dir, u, len, tLen, g, born, apex, order, dead, sg, buds, w, wb, scar, ph, phy]) => ({
        id, p, t, d: norm(dir), u: transport(u, norm(dir)), len, tLen, g, born, apex: !!apex, order, dead: !!dead, sg: sg || 0,
        buds: buds.map(([bt, r, bborn, back, wake]) => ({ t: bt, r: r || 0, born: bborn, back: back || 0, wake: wake || 0 })),
        w: w ? { d: w[0], g0: w[1], bit: w[2] } : null, wb: Array.isArray(wb) ? wb : [0, 0, 0], scar: !!scar,
        ph: ph ?? 0.5, phy: phy ?? 0,
      }));
      b.byId = new Map(b.segs.map((s) => [s.id, s]));
      b.roots = (d.roots || []).map(([id, p, t, dir, len, tLen, g, born, tip, order, dead, cutDay, az]) => ({
        id, p, t, d: norm(dir), u: perp(norm(dir)), len, tLen, g, born, tip: !!tip, order, dead: !!dead,
        cutDay: cutDay ?? -1, az: az ?? azimuth(norm(dir)),
      }));
      b.rootById = new Map(b.roots.map((r) => [r.id, r]));
      b.nextRootId = d.nextRootId || 0;
      b.repotted = d.repotted ?? -9999;
      b.rootRecover = d.rootRecover || 0;
      b.layout();
      // Trees saved before roots existed get a root system sized to the trunk.
      if (!b.roots.length) b._seedRoots(Math.max(1, b.segs[0].g / 4.5));
      b.refresh();
      return b;
    }
  }

  global.Bonsai = Bonsai;
  global.BonsaiConst = { YEAR, SEASONS, LEAF_LIFE, POT_GLAZES, MONTHS, SEASON_STARTS, REPOT_START, REPOT_END,
    BUD_BREAK, COLOR, BARE, leafOut, seasonOf, dateOf };
  global.BonsaiVec = { add, scale, dot, cross, norm, length, rotate, perp, polar, azimuth };
})(typeof window !== 'undefined' ? window : globalThis);
