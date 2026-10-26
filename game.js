// Bonsai UI: input, time control, panel, saving, picker. The 3D scene is in
// render3d.js and the growth simulation in sim.js.
(() => {
  'use strict';

  const { YEAR, MONTHS, dateOf } = BonsaiConst;
  const SAVE_KEY = 'bonsai3d-save-v1';
  const PREFS_KEY = 'bonsai3d-prefs-v1';
  const FORMS_KEY = 'bonsai3d-forms-v1';
  const CM_PER_UNIT = 0.25;
  const AUTOSAVE_MS = 15000;

  const $ = (id) => document.getElementById(id);
  const canvas = $('canvas');
  const view = BonsaiView.createView(canvas);

  const prefs = loadPrefs();
  let tree = loadSave();
  const firstRun = !tree;
  if (!tree) tree = new Bonsai();

  let speed = prefs.speed ?? 7;
  let pausedSpeed = speed || 7;
  let tool = ['prune', 'pinch', 'wire'].includes(prefs.tool) ? prefs.tool : 'prune';
  let undoStack = [];
  let hover = null;
  let hoverDirty = true;
  let mouse = null;
  let drag = null;
  let turn = 0;
  let acc = 0;
  let last = performance.now();
  let dirty = false;
  let lastSave = Date.now();
  let lastPanel = 0;
  let backBudToast = { count: 0, at: 0 };
  let repot = null;  // { snapshot, speed } while repotting

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
      // Mid-repot, keep the tree as it was before repotting: a half-done
      // repot (cuts made but not finished) must not be saved.
      localStorage.setItem(SAVE_KEY, repot ? repot.snapshot : tree.serialize());
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
    if (repot) exitRepotMode();
    tree = next;
    hover = null;
    view.clearOverlay();
    view.update(tree, true);
    view.cam.auto = true;
    view.fit(tree, true);
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
    tree = Bonsai.fromJSON(undoStack.pop());
    view.update(tree, true);
    $('deadModal').hidden = !tree.dead;
    dirty = true;
    hoverDirty = true;
    updatePanel();
    toast('Undone');
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    view.resize(Math.max(1, r.width), Math.max(1, r.height));
  }

  // ---- Hover and actions ----------------------------------------------------

  function updateHover() {
    hoverDirty = false;
    hover = null;
    const tip = $('tooltip');
    if (!mouse || drag?.moved || tree.dead || modalOpen()) {
      tip.hidden = true;
      view.clearOverlay();
      return;
    }
    if (repot) {
      const hit = view.pickRoot(mouse.x, mouse.y);
      if (hit) {
        const removed = tree.rootCutSet(hit.root.id, hit.t);
        let mass = 0;
        for (const id of removed) { const r = tree.rootById.get(id); mass += r.g * r.g * r.len; }
        if (!removed.has(hit.root.id)) mass += hit.root.g * hit.root.g * hit.root.len * (1 - hit.t);
        hover = { kind: 'root', root: hit.root, t: hit.t, removed, frac: tree.rootMass ? mass / tree.rootMass : 0 };
        view.showRootCut(tree, hit.root, hit.t, removed);
      }
    } else if (tool === 'wire') {
      const hit = view.pickWood(mouse.x, mouse.y);
      if (hit) {
        const seg = hit.seg;
        if (seg.w) {
          hover = { kind: 'wire', seg };
          view.showBendTarget(tree, seg);
        } else {
          hover = { kind: 'wire', seg, chain: tree.wireChain(seg.id) };
          if (!seg.dead) view.showWirePreview(tree, hover.chain);
          else view.clearOverlay();
        }
      }
    } else if (tool === 'prune') {
      const hit = view.pickWood(mouse.x, mouse.y);
      if (hit) {
        const removed = tree.cutSet(hit.seg.id, hit.t);
        let leaves = 0;
        for (const id of removed) if (tree.byId.get(id).leafy) leaves++;
        hover = { kind: 'cut', seg: hit.seg, t: hit.t, removed, leaves, ok: tree.canCut(hit.seg.id, hit.t) };
        view.showCut(tree, hit.seg, hit.t, removed, hover.ok);
      }
    } else {
      const e = view.pickBud(mouse.x, mouse.y);
      if (e) {
        hover = e;
        view.showRing(e.p, e.kind === 'tip' ? 1.8 : 1.5);
      }
    }
    if (!hover) {
      tip.hidden = true;
      view.clearOverlay();
      return;
    }
    tip.hidden = false;
    tip.style.left = mouse.x + 'px';
    tip.style.top = mouse.y + 'px';
    tip.textContent = hoverText();
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
    if (hover.kind === 'root') {
      const pct = Math.round(hover.frac * 100);
      const r = hover.root;
      const top = r.p < 0;
      const down = r.d[1] < -0.6;
      if (top && down) return `Cut the taproot: roots will spread sideways instead (${pct}% of root mass)`;
      const n = hover.removed.size;
      return `Cut root${n > 1 ? `: removes ${n} sections` : ''}, ${pct}% of root mass · drag to swing it around the trunk`;
    }
    if (hover.kind === 'wire') {
      const seg = hover.seg;
      if (seg.dead) return "Deadwood can't be wired";
      if (!seg.w) {
        const n = [...hover.chain].filter((id) => !tree.byId.get(id).w).length;
        return `Click to wire this ${seg.order === 0 ? 'trunk' : 'branch'} to its tip (${n} section${n === 1 ? '' : 's'})`;
      }
      let text = 'Drag to bend: the tip follows your pointer · click to remove wire';
      const unset = Math.round(Math.hypot(...seg.wb) * 180 / Math.PI);
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
    } else if (hover.kind === 'root') {
      tree.cutRoot(hover.root.id, hover.t);
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
    view.update(tree, true);
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
      ['Spread', `${(st.spread * CM_PER_UNIT).toFixed(1)} cm`],
      ['Trunk diameter', `${(st.trunk * CM_PER_UNIT).toFixed(1)} cm`],
      ['Roots', `${Math.round((st.rootFill || 0) * 100)}% of pot`],
      ['Nebari', `${st.nebari ?? 0}/100`],
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
    $('undoBtn').disabled = !undoStack.length || !!repot;
    $('nebariHint').textContent = tree.nebari ? tree.nebari.hint : '';
    const rb = $('repotBtn');
    rb.disabled = !tree.canRepot || !!repot || tree.dead;
    rb.title = tree.canRepot ? 'Lift the tree out to prune and arrange its roots, then replant in fresh soil'
      : 'Repot in late winter, Feb 1 – Apr 10';
    rb.textContent = tree.canRepot ? 'Repot now' : 'Repot (Feb 1 – Apr 10)';
    document.querySelectorAll('#speeds button').forEach((b) => b.classList.toggle('on', +b.dataset.speed === speed));
    document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === tool));
  }

  // ---- Events from the simulation ----------------------------------------

  // Milestones in the tree's year, announced in the sky.
  const PHASE_MSG = {
    latewinter: ['Late winter', 'Last weeks for big structural cuts before buds break', '#d6ecff'],
    budbreak: ['Buds are breaking', 'Spring growth has started', '#d9f7b0'],
    harden: ['Shoots are hardening off', 'Growth slows for summer', '#c6ef9e'],
    color: ['Leaves are turning', 'Autumn color is on the way', '#ffd29a'],
    dormant: ['Leaves are down', 'The tree is dormant: time for structural pruning and wiring', '#f0dcc0'],
    potbound: ['Roots fill the pot', 'Repot between now and early April to restore vigor', '#f0d8b4'],
  };
  const SEASON_STYLE = {
    Spring: { color: '#ffd3e0', kanji: '春' },
    Summer: { color: '#d4f5b8', kanji: '夏' },
    Autumn: { color: '#ffc58a', kanji: '秋' },
    Winter: { color: '#e2f1ff', kanji: '冬' },
  };

  // Banners shown in the sky one at a time: season changes and milestones.
  let banners = [];

  // At most one banner waits behind the one showing; a newer event replaces
  // it, so fast-forwarding never shows stale news.
  function queueBanner(b) {
    banners = banners.length && banners[0].at ? [banners[0], b] : [b];
  }

  function showSeasonBanner() {
    const { color, kanji } = SEASON_STYLE[tree.season];
    queueBanner({ title: tree.season, sub: `${kanji} · ${MONTHS[dateOf(tree.dayOfYear).month]}`, color, big: true, dur: 3.2 });
  }

  function showPhaseBanner(name) {
    const [title, sub, color] = PHASE_MSG[name];
    queueBanner({ title, sub, color, big: false, dur: 4.5 });
  }

  // The current banner rises into the sky, holds, then fades.
  function updateBanner() {
    const el = $('banner');
    const b = banners[0];
    if (!b) { el.hidden = true; return; }
    if (!b.at) {
      b.at = performance.now();
      el.querySelector('.b-title').textContent = b.title;
      el.querySelector('.b-sub').textContent = b.sub;
      el.classList.toggle('big', b.big);
      el.querySelector('.b-title').style.color = b.color;
    }
    const t = (performance.now() - b.at) / 1000;
    if (t > b.dur) { banners.shift(); el.hidden = true; return; }
    el.hidden = false;
    el.style.opacity = t < 0.4 ? t / 0.4 : t > b.dur - 0.8 ? (b.dur - t) / 0.8 : 1;
    el.style.transform = `translate(-50%, ${(1 - Math.min(1, t / 0.5)) * 14}px)`;
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
      } else if (e.type === 'scar') wireToast('🩹 Wire left on too long has scarred a branch');
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

  // ---- Saved forms and the new tree picker -----------------------------------

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

  // New tree: first choose a pot, then one of six random seedlings in it.
  let pickerTab = 'new';
  let pickerStep = 'pot';
  let chosenPot = null;
  let candidates = [];
  const potThumbs = new Map();

  function seedlings() {
    return Array.from({ length: 6 }, () => {
      const b = new Bonsai();
      b.pot = { ...chosenPot };
      return b;
    });
  }

  function potName(pot) {
    return `${GLAZE_NAMES[pot.glaze]} ${pot.shape === 'round' ? 'round' : 'rectangular'}`;
  }

  function openPicker(tab) {
    if (tab === 'new') pickerStep = 'pot';
    pickerTab = tab;
    $('picker').hidden = false;
    $('tooltip').hidden = true;
    view.clearOverlay();
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

  function card(src, title, detail, buttons) {
    const el = document.createElement('div');
    el.className = 'tree-card';
    const img = document.createElement('img');
    img.alt = title;
    img.src = src;
    el.appendChild(img);
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
    return el;
  }

  function renderPicker() {
    const grid = $('pickerGrid');
    grid.innerHTML = '';
    document.querySelectorAll('#pickerTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === pickerTab));
    const forms = loadForms();
    $('savedCount').textContent = forms.length ? ` (${forms.length})` : '';
    const choosingPot = pickerTab === 'new' && pickerStep === 'pot';
    $('pickerTitle').textContent = choosingPot ? 'Choose a pot' : pickerTab === 'new' ? 'Choose your tree' : 'Choose your next tree';
    $('pickerMore').hidden = pickerTab !== 'new' || choosingPot;
    grid.classList.toggle('pots', choosingPot);
    const bar = $('pickerPot');
    bar.hidden = pickerTab !== 'new' || choosingPot;
    if (choosingPot) {
      for (const shape of ['rect', 'round']) {
        for (let glaze = 0; glaze < GLAZE_NAMES.length; glaze++) {
          const pot = { shape, glaze };
          const key = shape + glaze;
          if (!potThumbs.has(key)) potThumbs.set(key, view.thumbnail({ pot }, 300, 220, { potOnly: true }));
          const current = tree.pot && tree.pot.shape === shape && tree.pot.glaze === glaze;
          const name = potName(pot);
          grid.appendChild(card(potThumbs.get(key), name[0].toUpperCase() + name.slice(1), current ? 'Your current pot' : '', [
            ['Choose', 'primary', () => {
              chosenPot = pot;
              candidates = seedlings();
              pickerStep = 'trees';
              renderPicker();
            }],
          ]));
        }
      }
      return;
    }
    if (pickerTab === 'new') {
      $('pickerPotName').textContent = potName(chosenPot);
      for (const b of candidates) {
        const { title, detail } = describe(b);
        grid.appendChild(card(view.thumbnail(b), title, detail, [
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
      grid.appendChild(card(view.thumbnail(b), f.name, `${detail} · saved ${when}`, [
        ['Plant a copy', 'primary', () => plant(Bonsai.fromJSON(f.data))],
        ['Delete', 'danger', () => {
          if (!confirm(`Delete the saved form "${f.name}"?`)) return;
          deleteForm(f.id);
          renderPicker();
        }],
      ]));
    }
  }

  // ---- Repotting ------------------------------------------------------------

  // Actions that change the tree outside repot mode are refused while
  // repotting; finish or cancel first.
  function blockedByRepot() {
    if (!repot) return false;
    toast('Finish or cancel repotting first');
    return true;
  }

  function startRepot() {
    if (!tree.canRepot || repot) return;
    pushUndo();
    repot = { snapshot: tree.serialize(), speed, undoLen: undoStack.length };
    speed = 0;
    tree.startRepot();
    view.setRootMode(true);
    view.update(tree, true);
    $('repotBar').hidden = false;
    document.querySelectorAll('#tools button, #speeds button').forEach((b) => { b.disabled = true; });
    hoverDirty = true;
    updatePanel();
  }

  // Leave repot mode without touching the tree (used when it's replaced).
  function exitRepotMode() {
    speed = repot.speed;
    repot = null;
    view.setRootMode(false);
    $('repotBar').hidden = true;
    document.querySelectorAll('#tools button, #speeds button').forEach((b) => { b.disabled = false; });
  }

  function endRepot() {
    exitRepotMode();
    view.update(tree, true);
    dirty = true;
    hoverDirty = true;
    updatePanel();
  }

  function finishRepot() {
    const r = tree.finishRepot();
    endRepot();
    const pct = Math.round(r.loss * 100);
    toast(r.hit >= 1
      ? `Repotted, but cutting ${pct}% of the root mass was heavy (−${Math.round(r.hit)} health, slower growth this season)`
      : `Repotted in fresh soil${pct ? ` (${pct}% of root mass cut)` : ''}. New roots will grow from the cuts this spring`);
  }

  function cancelRepot() {
    tree = Bonsai.fromJSON(repot.snapshot);
    // Drop the undo entry pushed when repotting began (and anything after it).
    undoStack.length = Math.max(0, repot.undoLen - 1);
    endRepot();
    toast('Repotting cancelled');
  }

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
        view.update(tree);
        dirty = true;
        hoverDirty = true;
      }
    }
    if (turn) {
      const stepTurn = Math.sign(turn) * Math.min(Math.abs(turn), dt * 3);
      view.cam.yaw += stepTurn;
      turn -= stepTurn;
    }
    view.render(dt, tree);
    if (hoverDirty && !drag) updateHover();
    updateBanner();
    if (now - lastPanel > 250) { updatePanel(); lastPanel = now; }
    if (dirty && Date.now() - lastSave > AUTOSAVE_MS) save();
    requestAnimationFrame(frame);
  }

  // ---- Input --------------------------------------------------------------

  function setSpeed(v) {
    if (repot) return;
    speed = v;
    if (v) pausedSpeed = v;
    updatePanel();
  }

  function setTool(t) {
    if (repot) return;
    tool = t;
    view.setBudMode(t === 'pinch' ? 'pinch' : 'normal');
    view.setFoliageFade(t === 'wire');
    hoverDirty = true;
    updatePanel();
  }

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Drag rotates the view (right-drag or shift-drag pans); a click without
  // dragging cuts or pinches whatever is under the pointer.
  canvas.addEventListener('mousemove', (e) => {
    mouse = canvasPoint(e);
    if (drag?.bend) {
      bendTo();
      return;
    }
    if (drag?.swing != null) {
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) {
        drag.moved = true;
        view.clearOverlay();
        $('tooltip').hidden = true;
      }
      if (drag.moved && dx) {
        tree.swingRoot(drag.swing, dx * 0.01);
        view.update(tree, true);
      }
      drag.x = e.clientX;
      return;
    }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 4) {
        drag.moved = true;
        canvas.classList.add('dragging');
        $('tooltip').hidden = true;
        view.clearOverlay();
      }
      if (drag.moved) {
        if (drag.pan) view.pan(dx, dy);
        else view.orbit(dx, dy);
      }
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    hoverDirty = true;
  });
  // Bending: the tip of the grabbed section follows the pointer. The pointer
  // is projected onto a plane through the tip that faces the viewer, and the
  // section swings about its base toward that point, so the branch moves in
  // the plane you are looking at. Turn the view to bend in another direction.
  const V3 = BonsaiVec;

  function pointerOnPlane(point, normal) {
    const { origin, dir } = view.rayAt(mouse.x, mouse.y);
    const denom = V3.dot(dir, normal);
    if (Math.abs(denom) < 1e-4) return null;
    const t = V3.dot(V3.add(point, V3.scale(origin, -1)), normal) / denom;
    return t > 0 ? V3.add(origin, V3.scale(dir, t)) : null;
  }

  function startBend(seg) {
    const tip = [seg.x1, seg.y1, seg.z1];
    const hit = pointerOnPlane(tip, view.viewDir());
    // Offset between pointer and tip, so the branch doesn't jump on the first move.
    drag.offset = hit ? V3.add(tip, V3.scale(hit, -1)) : [0, 0, 0];
  }

  function bendTo() {
    const seg = tree.byId.get(drag.id);
    if (!seg) return;
    if (!drag.moved) {
      if (Math.hypot(mouse.x - drag.mx0, mouse.y - drag.my0) <= 3) return;
      drag.moved = true;
      pushUndo();
      view.clearOverlay();
    }
    const base = [seg.x0, seg.y0, seg.z0];
    const lever = V3.scale(seg.d, seg.len);
    const hit = pointerOnPlane(V3.add(base, lever), view.viewDir());
    if (!hit) return;
    const target = V3.add(V3.add(hit, drag.offset), V3.scale(base, -1));
    const axis = V3.cross(lever, target);
    if (V3.length(axis) < 1e-6 || V3.length(target) < 0.5) return;
    const angle = Math.min(0.5, Math.acos(Math.max(-1, Math.min(1, V3.dot(V3.norm(lever), V3.norm(target))))));
    const r = tree.bend(drag.id, V3.norm(axis), angle);
    view.update(tree, true);
    const tip = $('tooltip');
    tip.hidden = !r?.limited;
    if (r?.limited) {
      tip.textContent = "This wood won't bend any further yet";
      tip.style.left = mouse.x + 'px';
      tip.style.top = mouse.y + 'px';
    }
    dirty = true;
  }

  canvas.addEventListener('mousedown', (e) => {
    mouse = canvasPoint(e);
    updateHover();
    drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, button: e.button,
      pan: e.button === 2 || e.button === 1 || e.shiftKey };
    if (e.button === 0 && repot && hover?.kind === 'root') drag.swing = hover.root.id;
    if (e.button === 0 && tool === 'wire' && hover?.kind === 'wire' && hover.seg.w && !tree.dead) {
      Object.assign(drag, { bend: true, id: hover.seg.id, mx0: mouse.x, my0: mouse.y });
      startBend(hover.seg);
    }
  });
  window.addEventListener('mouseup', () => {
    if (drag?.bend && drag.moved) tree.refresh();
    else if (drag && !drag.moved && drag.button === 0) act();
    drag = null;
    canvas.classList.remove('dragging');
    hoverDirty = true;
  });
  canvas.addEventListener('mouseleave', () => { mouse = null; hoverDirty = true; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    view.zoom(e.deltaY);
    hoverDirty = true;
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'Escape' && !$('help').hidden) { $('help').hidden = true; return; }
    if (e.key === 'Escape' && !$('picker').hidden) { $('picker').hidden = true; return; }
    if (modalOpen()) return;
    if (repot && e.key === 'Escape') { cancelRepot(); return; }
    const k = e.key.toLowerCase();
    if (repot && (e.key === ' ' || (e.metaKey || e.ctrlKey) && k === 'z')) return;
    if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); undo(); }
    else if (e.key === ' ') { e.preventDefault(); setSpeed(speed ? 0 : pausedSpeed); }
    else if (e.key === '1') setTool('prune');
    else if (e.key === '2') setTool('pinch');
    else if (e.key === '3') setTool('wire');
    else if (k === 'f') { view.cam.auto = true; view.cam.roll = 0; }
    else if (k === 'q') view.roll(-0.08);
    else if (k === 'e') view.roll(0.08);
    else if (e.key === 'ArrowLeft') turn -= Math.PI / 4;
    else if (e.key === 'ArrowRight') turn += Math.PI / 4;
  });

  document.querySelectorAll('#speeds button').forEach((b) => b.addEventListener('click', () => setSpeed(+b.dataset.speed)));
  document.querySelectorAll('#tools button').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('fitBtn').addEventListener('click', () => { view.cam.auto = true; view.cam.roll = 0; });
  $('turnLeft').addEventListener('click', () => { turn -= Math.PI / 4; });
  $('turnRight').addEventListener('click', () => { turn += Math.PI / 4; });
  $('undoBtn').addEventListener('click', undo);
  $('repotBtn').addEventListener('click', startRepot);
  $('repotDone').addEventListener('click', finishRepot);
  $('repotCancel').addEventListener('click', cancelRepot);
  $('fertBtn').addEventListener('click', () => {
    if (blockedByRepot()) return;
    pushUndo();
    const r = tree.fertilize();
    toast(r === 'burn' ? '🔥 Too much fertilizer burned the roots (−12 health)'
      : r === 'dormant' ? 'Fertilized. Little effect while the tree is dormant'
      : '🌿 Fertilized: extra vigour for 45 days');
    dirty = true;
    updatePanel();
  });
  $('saveBtn').addEventListener('click', () => { save(); toast('Progress saved'); });
  $('newBtn').addEventListener('click', () => { if (!blockedByRepot()) openPicker('new'); });
  $('saveFormBtn').addEventListener('click', () => {
    if (blockedByRepot()) return;
    if (addForm(tree, `${describe(tree).title}, ${(tree.startAge + tree.day / YEAR).toFixed(1)} years`)) {
      toast('Saved this tree\'s form. Start from it any time via New tree → Saved forms');
    }
  });
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([tree.serialize()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bonsai3d-age-${(tree.startAge + tree.day / YEAR).toFixed(1)}y.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('importBtn').addEventListener('click', () => { if (!blockedByRepot()) $('importFile').click(); });
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
      toast("That file isn't a valid 3D bonsai save");
    }
  });
  document.querySelectorAll('#pickerTabs button').forEach((b) => b.addEventListener('click', () => {
    pickerTab = b.dataset.tab;
    renderPicker();
  }));
  $('pickerMore').addEventListener('click', () => {
    candidates = seedlings();
    renderPicker();
  });
  $('changePot').addEventListener('click', () => {
    pickerStep = 'pot';
    renderPicker();
  });
  $('pickerClose').addEventListener('click', () => {
    $('picker').hidden = true;
    if (tree.dead) $('deadModal').hidden = false;
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
  view.update(tree, true);
  view.fit(tree, true);
  view.setBudMode(tool === 'pinch' ? 'pinch' : 'normal');
  view.setFoliageFade(tool === 'wire');
  // Handle for automated tests.
  window.bonsaiDebug = { view, tree: () => tree };
  if (firstRun) $('help').hidden = false;
  else toast(`Welcome back. Your tree is ${(tree.startAge + tree.day / YEAR).toFixed(1)} years old`);
  if (tree.dead) $('deadModal').hidden = false;
  updatePanel();
  view.render(0, tree);
  requestAnimationFrame(frame);
})();
