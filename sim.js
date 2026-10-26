// Bonsai growth simulation. Pure logic, no DOM, so it can be tested headlessly.
//
// The tree is a list of segments (internodes). Each segment hangs off its
// parent at a fraction `t` along the parent's length (t = 1 is the node at the
// parent's tip; t < 1 is a back bud that broke on old wood). Segments are kept
// in creation order, so a parent always comes before its children.
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
  const POT_GLAZES = 6;

  const rand = Math.random;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const r3 = (v) => Math.round(v * 1000) / 1000;

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
  const cellKey = (i, j) => (i + 2000) * 4096 + j + 100;

  // Branch direction drifts toward a preferred angle: the leader grows up,
  // side branches grow out and slightly up. Angles are radians from vertical.
  // Used for the starting seedling; growing shoots use Bonsai#_phototrope.
  function steer(a, order) {
    const side = a === 0 ? (rand() < 0.5 ? -1 : 1) : Math.sign(a);
    const target = order === 0 ? 0 : side * (order === 1 ? 0.95 : 1.15);
    return clamp(a + (target - a) * 0.1 + (rand() - 0.5) * 0.22, -1.7, 1.7);
  }

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
      this._seed();
      this.refresh();
    }

    get dayOfYear() { return this.day % YEAR; }
    get year() { return Math.floor(this.day / YEAR); }
    get season() { return SEASONS[seasonOf(this.dayOfYear)]; }
    get growing() { const d = this.dayOfYear; return d >= GROW_START && d < GROW_END; }

    add(p, t, a, len, order, born) {
      const s = { id: this.nextId++, p, t, a, len, tLen: len, g: 0.5, born,
        apex: false, order, dead: false, sg: 0, buds: [], w: null, wb: 0, scar: false,
        ph: 0.35 + rand() * 0.4 };
      this.segs.push(s);
      this.byId.set(s.id, s);
      return s;
    }

    // A randomly generated two-year-old seedling. Trunk style, height,
    // thickness, curves and branch layout differ for every new tree.
    _seed() {
      const pick = (list) => list[Math.floor(rand() * list.length)];
      const between = (a, b) => a + rand() * (b - a);
      const style = pick(['informal', 'informal', 'slanting', 'upright']);
      this.style = style;
      this.pot = { shape: rand() < 0.6 ? 'rect' : 'round', glaze: Math.floor(rand() * POT_GLAZES) };

      const n = 5 + Math.floor(rand() * 3);
      const leanSide = rand() < 0.5 ? -1 : 1;
      const lean = style === 'slanting' ? leanSide * between(0.22, 0.4) : between(-0.05, 0.05);
      const curve = style === 'informal' ? between(0.16, 0.3) : style === 'slanting' ? between(0.06, 0.14) : between(0.02, 0.06);
      const baseG = between(3.8, 5.2);
      const tall = between(0.85, 1.2);
      let phase = rand() < 0.5 ? -1 : 1;
      const trunk = [];
      let p = -1;
      for (let i = 0; i < n; i++) {
        const a = lean * (1 - i / (n * 1.6)) + curve * phase * between(0.6, 1.2);
        if (rand() < 0.8) phase = -phase;
        const s = this.add(p, 1, a, (13 - i * 1.1) * tall * between(0.85, 1.15), 0, -720 + i * 100);
        s.g = baseG * (1 - (i / n) * 0.8);
        trunk.push(s);
        p = s.id;
      }
      trunk[n - 1].apex = true;

      const branch = (from, side, count, len) => {
        let parent = from;
        let a = from.a + side * between(0.7, 1.15);
        for (let i = 0; i < count; i++) {
          const s = this.add(parent.id, 1, a, Math.max(4, len - i * 1.5), 1, -330 + i * 100);
          s.g = Math.max(0.5, between(1.0, 1.5) - i * 0.3);
          if (i < count - 1) s.buds.push({ t: 1, s: i % 2 ? side : -side, born: -200, back: 0 });
          parent = s;
          a = steer(a, 1);
        }
        parent.apex = true;
      };
      // Branches mostly alternate sides up the trunk, with the odd gap and
      // the occasional opposite pair.
      let side = rand() < 0.5 ? -1 : 1;
      let branches = 0;
      for (let i = rand() < 0.5 ? 1 : 2; i < n - 1; i++) {
        const len = (11 - i * 0.8) * between(0.75, 1.2);
        if (rand() < 0.8 || branches < 2) {
          branch(trunk[i], side, 2 + Math.floor(rand() * 2), len);
          branches++;
          if (rand() < 0.2) branch(trunk[i], -side, 2, len * 0.8);
        } else {
          trunk[i].buds.push({ t: 1, s: side, born: -200, back: 0 });
        }
        if (rand() < 0.85) side = -side;
        if (rand() < 0.6) trunk[i].buds.push({ t: 1, s: -side, born: -200, back: 0 });
      }
    }

    refresh() {
      this.layout();
      this.analyze();
    }

    layout() {
      let minX = 0, maxX = 0, maxY = 0;
      for (const s of this.segs) {
        let x0 = 0, y0 = 0;
        if (s.p >= 0) {
          const p = this.byId.get(s.p);
          x0 = p.x0 + (p.x1 - p.x0) * s.t;
          y0 = p.y0 + (p.y1 - p.y0) * s.t;
        }
        s.x0 = x0; s.y0 = y0;
        s.x1 = x0 + Math.sin(s.a) * s.len;
        s.y1 = y0 + Math.cos(s.a) * s.len;
        if (s.x1 < minX) minX = s.x1;
        if (s.x1 > maxX) maxX = s.x1;
        if (s.y1 > maxY) maxY = s.y1;
      }
      this.bounds = { minX, maxX, maxY };
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
      const E = 15 * L / (L + 120) * hm * fm * Math.min(1, 5000 / this.segs.length);
      this.energy = E;

      if (this.growing) {
        const apices = this.segs.filter((s) => s.apex && !s.dead);
        const vigor = clamp(E / (apices.length * 0.45 + 1), 0.25, 2);
        this.vigor = vigor;
        this._extend(apices, E, d);
        this._thicken(lo * hm * fm);
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
      const key = (x, y) => cellKey(Math.floor(x / CELL), Math.floor(y / CELL));
      const count = new Map();
      for (const s of this.segs) {
        if (!s.leafy) continue;
        const k = key(s.x1, s.y1);
        count.set(k, (count.get(k) || 0) + 1);
      }
      let sum = 0;
      for (const s of this.segs) {
        const c = count.get(key(s.x1, s.y1)) || 0;
        s.light = 1 / (1 + Math.max(0, c - 4) * 0.3);
        // Vigorous shoots (long internodes) carry bigger leaves.
        s.subLeaf = s.leafy ? (0.5 + s.tLen / 8) * s.light : 0;
        sum += s.subLeaf;
      }
      this.lightSum = sum;
      this.leafCells = count;
    }

    // Direction (radians from vertical) a shoot at (x, y) sees the most light
    // from: mostly the sky above, pulled sideways toward gaps in the canopy
    // and outward from the middle of the tree.
    _lightDir(x, y) {
      const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
      const c = (di, dj) => this.leafCells.get(cellKey(i + di, j + dj)) || 0;
      const gx = c(-1, 0) + 0.5 * (c(-1, 1) + c(-1, -1)) - c(1, 0) - 0.5 * (c(1, 1) + c(1, -1));
      const gy = c(0, -1) - c(0, 1);
      const W = Math.max(30, this.bounds.maxX - this.bounds.minX);
      const mid = (this.bounds.maxX + this.bounds.minX) / 2;
      return Math.atan2(gx * 0.12 + (x - mid) / W * 0.8, 1 + gy * 0.08);
    }

    // Phototropism: each new section turns part way toward the light. Side
    // branches are held out from the leader, so most end up angled up or
    // sideways. Each shoot has its own light-seeking strength (s.ph), so a
    // few stay flatter or droop while most bend up.
    _phototrope(s) {
      const sun = this._lightDir(s.x1, s.y1);
      let target;
      if (s.order === 0) {
        target = sun * 0.5;
      } else {
        const side = s.a === 0 ? (rand() < 0.5 ? -1 : 1) : Math.sign(s.a);
        const held = side * (s.order === 1 ? 1.0 : 1.15);
        target = held * (1 - s.ph) + sun * s.ph;
        if (Math.abs(target) < 0.3) target = side * 0.3;
      }
      return clamp(s.a + (target - s.a) * 0.18 + (rand() - 0.5) * 0.26, -1.9, 1.9);
    }

    // Growing tips share the tree's energy. Higher, outer tips get more
    // (apical dominance), so an unpruned tree gets leggy at the top.
    _extend(apices, E, d) {
      if (!apices.length) return;
      const H = Math.max(20, this.bounds.maxY);
      const W = Math.max(20, this.bounds.maxX - this.bounds.minX);
      const w = apices.map((s) => Math.exp(1.6 * s.y1 / H + 0.5 * Math.abs(s.x1) / W) * s.light);
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

    // The tip reaches its internode length: set buds at the node and keep
    // growing from a new segment. Vigorous shoots make long internodes.
    _node(s, rate) {
      const extra = s.len - s.tLen;
      s.len = s.tLen;
      s.apex = false;
      const side = s.id % 2 ? 1 : -1;
      if (rand() < 0.95) s.buds.push({ t: 1, s: side, born: this.day, back: 0 });
      if (rand() < 0.5) s.buds.push({ t: 1, s: -side, born: this.day, back: 0 });
      const c = this.add(s.id, 1, this._phototrope(s), 0.2 + extra, s.order, this.day);
      c.ph = s.ph;
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
      let a = s.a + b.s * spread;
      // Buds on the underside of a sideways branch mostly push up from the
      // top side instead; a few still start out drooping.
      if (Math.abs(a) > 1.5 && rand() < 0.8) a = s.a - b.s * spread;
      a = clamp(a, -1.9, 1.9);
      const c = this.add(s.id, b.t, a, 0.2, order, this.day);
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
          s.buds.push({ t: 0.15 + rand() * 0.75, s: rand() < 0.5 ? -1 : 1, born: this.day, back: 1 });
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
        s.wb *= 1 - rate;
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
          s.buds.push({ t: 0.85, s: rand() < 0.5 ? -1 : 1, born: this.day - 20, back: 0 });
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
        c.wb = 0;
        n++;
      }
      this.refresh();
      return n;
    }

    // Removes the whole wire run containing `id`. Whatever part of the bend
    // has not set yet springs back.
    removeWire(id) {
      let top = this.byId.get(id);
      if (!top || !top.w) return 0;
      for (let p = this.byId.get(top.p); p && p.w && p.order === top.order; p = this.byId.get(p.p)) top = p;
      let n = 0, sprang = 0;
      for (const cid of this.wireChain(top.id)) {
        const c = this.byId.get(cid);
        if (!c.w) continue;
        if (c.w.bit) c.scar = c.scar || c.g > c.w.g0 * 1.5;
        if (Math.abs(c.wb) > 0.01) { this._rotate(c.id, -c.wb); sprang = Math.max(sprang, Math.abs(c.wb)); }
        c.w = null;
        c.wb = 0;
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

    // Bend a wired section about its base by `delta` radians. The section
    // and everything growing from it rotate together.
    bend(id, delta) {
      const s = this.byId.get(id);
      if (!s || !s.w || s.dead) return null;
      const max = this.maxBend(s);
      const wb = clamp(s.wb + delta, -max, max);
      const applied = wb - s.wb;
      s.wb = wb;
      if (applied) this._rotate(id, applied);
      this.layout();
      return { applied, limited: Math.abs(applied - delta) > 1e-6 };
    }

    _rotate(id, delta) {
      const sub = new Set([id]);
      for (const c of this.segs) {
        if (sub.has(c.p)) sub.add(c.id);
        if (sub.has(c.id)) c.a += delta;
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

    // ---- Saving -----------------------------------------------------------

    serialize() {
      return JSON.stringify({
        v: 4, day: this.day, pot: this.pot, style: this.style, nextId: this.nextId, health: r3(this.health),
        stress: r3(this.stress), fert: this.fert, dead: this.dead, startAge: this.startAge,
        segs: this.segs.map((s) => [s.id, s.p, r3(s.t), r3(s.a), r3(s.len), r3(s.tLen), r3(s.g),
          s.born, s.apex ? 1 : 0, s.order, s.dead ? 1 : 0, r3(s.sg),
          s.buds.map((b) => [r3(b.t), b.s, b.born, b.back ? 1 : 0, b.wake ? 1 : 0]),
          s.w ? [s.w.d, r3(s.w.g0), s.w.bit] : 0, r3(s.wb), s.scar ? 1 : 0, r3(s.ph)]),
      });
    }

    static fromJSON(text) {
      const d = JSON.parse(text);
      if (![1, 2, 3, 4].includes(d.v) || !Array.isArray(d.segs) || !d.segs.length) throw new Error('Not a bonsai save');
      const b = Object.create(Bonsai.prototype);
      Object.assign(b, { day: d.day, nextId: d.nextId, health: d.health, stress: d.stress,
        fert: d.fert, dead: !!d.dead, startAge: d.startAge ?? 2, events: [],
        pot: d.pot || { shape: 'rect', glaze: 0 }, style: d.style || 'informal' });
      b.segs = d.segs.map(([id, p, t, a, len, tLen, g, born, apex, order, dead, sg, buds, w, wb, scar, ph]) => ({
        id, p, t, a, len, tLen, g, born, apex: !!apex, order, dead: !!dead, sg,
        buds: buds.map(([bt, s, bborn, back, wake]) => ({ t: bt, s, born: bborn, back, wake: wake || 0 })),
        w: w ? { d: w[0], g0: w[1], bit: w[2] } : null, wb: wb || 0, scar: !!scar, ph: ph ?? 0.5,
      }));
      if (d.v < 4) b._fromOldCalendar();
      b.byId = new Map(b.segs.map((s) => [s.id, s]));
      b.refresh();
      return b;
    }

    // Saves before v4 used a 360-day year starting at the first day of
    // spring. Map every timestamp onto the January-based calendar.
    _fromOldCalendar() {
      const map = (t) => Math.round(t * YEAR / 360) + SEASON_STARTS[0];
      this.day = map(this.day);
      this.startAge -= SEASON_STARTS[0] / YEAR;
      for (const s of this.segs) {
        s.born = map(s.born);
        for (const b of s.buds) b.born = map(b.born);
        if (s.w) s.w.d = map(s.w.d);
      }
    }
  }

  global.Bonsai = Bonsai;
  global.BonsaiConst = { YEAR, SEASONS, LEAF_LIFE, POT_GLAZES, MONTHS, SEASON_STARTS,
    BUD_BREAK, COLOR, BARE, leafOut, seasonOf, dateOf };
})(typeof window !== 'undefined' ? window : globalThis);
