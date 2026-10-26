# Bonsai 3D

A bonsai-growing game that runs in your web browser. You start with a young Japanese maple seedling in a pot and shape it over years of fast-forwarded time: prune, pinch, wire, repot and develop the roots. The tree grows realistically. It reaches for the light, branches where you cut, thickens where its leaves feed it, and follows the seasons of a Japanese maple in the Pacific Northwest.

---

## Contents

- [Getting started](#getting-started)
- [The screen](#the-screen)
- [Controls](#controls)
- [Time and the calendar](#time-and-the-calendar)
- [Tools](#tools)
  - [Prune](#-prune)
  - [Pinch](#-pinch)
  - [Wire](#-wire)
  - [Fertilize](#fertilize)
- [How the tree grows](#how-the-tree-grows)
- [Roots, nebari and repotting](#roots-nebari-and-repotting)
- [Tree health](#tree-health)
- [The stats panel](#the-stats-panel)
- [New trees, pots and saved forms](#new-trees-pots-and-saved-forms)
- [Saving your progress](#saving-your-progress)
- [A year of bonsai care, month by month](#a-year-of-bonsai-care-month-by-month)
- [Techniques and tips](#techniques-and-tips)
- [Troubleshooting](#troubleshooting)
- [Files](#files)

---

## Getting started

1. Open `index.html` in a modern browser (Firefox, Chrome, Safari or Edge). From a terminal on macOS:
   ```
   open -a Firefox ~/bonsai-game/index.html
   ```
   No installation, server or internet connection is needed.
2. Read the **Growing your bonsai** guide and click **Start growing**.
3. Your seedling starts on **January 1**, dormant and bare. Time runs at one week per second; click **1m/s** to reach spring faster.

Your progress saves automatically, so you can close the tab at any time and pick up where you left off. Time does not pass while the game is closed.

---

## The screen

- **The 3D view** (left) shows your tree on a wooden table, with a sky and landscape that change with the seasons. Season changes and yearly milestones are announced in the sky.
- **The side panel** (right) holds:
  - **Date**: season, calendar date, *Year N · Day N* (years since planting and day of the year), and a progress bar for the year.
  - **Time**: pause and speed controls.
  - **Tools**: Prune, Pinch, Wire, plus Fertilize and Undo.
  - **Roots**: a nebari hint and the Repot button.
  - **View**: turn the tree 45° either way, or fit it in view.
  - **Tree**: live statistics and a health bar.
  - **Progress**: save, export or import a save file, start a new tree, save the tree's form.
- **Notices** appear at the bottom left, for example back buds appearing or a wire biting.
- **The ? button** reopens the in-game guide.

---

## Controls

### Mouse

| Action | What it does |
|---|---|
| **Drag** empty space | Rotate the view around the tree |
| **Right-drag** or **Shift-drag** | Pan the view |
| **Scroll** | Zoom in and out |
| **Hover** | Preview what the current tool will do (shown in red for cuts, copper for wire) |
| **Click** (without dragging) | Use the current tool: cut, pinch, wire or remove wire |
| **Drag** a wired branch | Bend it (Wire tool) |
| **Drag** a root | Swing it around the trunk (while repotting) |

### Keyboard

| Key | Action |
|---|---|
| **Space** | Pause or resume time |
| **1** / **2** / **3** | Prune / Pinch / Wire tool |
| **Ctrl+Z** or **Cmd+Z** | Undo (also rewinds time to before that action) |
| **F** | Fit the tree in view and reset the tilt |
| **Q** / **E** | Tilt the view |
| **←** / **→** | Turn the tree 45° |
| **Esc** | Close a dialog, or cancel repotting |

---

## Time and the calendar

### Speed

| Button | Speed | A full year takes |
|---|---|---|
| ❚❚ | Paused | — |
| 1d/s | 1 day per second | about 6 minutes |
| 1w/s | 1 week per second | about 52 seconds |
| 1m/s | 1 month per second | about 12 seconds |

Pause whenever you want to work carefully. Every tool works while paused.

### The calendar

The game uses a real 365-day calendar starting on **January 1**. Seasons follow the calendar months:

- **Spring:** March–May
- **Summer:** June–August
- **Autumn:** September–November
- **Winter:** December–February

The tree's yearly cycle follows a **Japanese maple in the Pacific Northwest** (Seattle / Portland):

| When | What happens |
|---|---|
| Dec – Feb | Dormant and bare. Snow may settle from mid-December to mid-February. |
| ~Feb 15 | *Late winter* notice: the last weeks for big structural cuts. |
| Feb 1 – Apr 10 | Repotting window. |
| ~Mar 26 | **Buds break.** Leaves unfold through April; cherry petals drift past. |
| Apr – May | The spring flush: the strongest growth of the year. |
| June | Growth slows to about half. |
| ~Jul 10 | Shoots harden off. Little new extension, but wood keeps thickening. |
| Early Sept | Wood growth stops. |
| ~Sep 30 | Leaves start to turn, peaking in late October. |
| November | Leaves fall. |
| ~Nov 29 | Bare and dormant again: time for structural pruning and wiring. |

---

## Tools

### ✂ Prune

Click anywhere on a branch or the trunk to cut it **at that point**.

- Hovering shows everything that would be removed **in red**, with a white ring at the cut. The tooltip tells you how many shoots and what share of the foliage you'd remove.
- Clicking near the base of a shoot removes the whole shoot.
- Buds just below a cut wake up and grow. If you cut the top of the trunk or a branch, the bud nearest the cut takes over as the new leader, usually at a new angle. This is how you build **taper and movement**.
- Dead twigs turn pale grey; prune them off as deadwood.
- The trunk can't be cut at the soil line.

### ✋ Pinch

Selecting Pinch shows all the buds and growing tips.

- **Click a growing tip** to stop that shoot extending. The buds below it then break, giving more, shorter shoots. This is the main way to build fine branching without cutting.
- **Click a bud** to rub it off, so that bud will never grow.

### ➰ Wire

Wire lets you position branches. Leaves fade while the Wire tool is selected so you can see the branch structure.

1. **Apply wire:** hover a branch or the trunk to see a copper preview, then click. The wire runs from that point out to the tip of that branch (not into its side branches).
2. **Bend:** hover a wired section (it highlights, and a white dot marks its pivot), then **drag**. The tip of the section follows your pointer, swinging about the pivot in the plane facing you.
   - To bend toward or away from you, rotate the view so that direction runs across your screen, then drag again.
   - Grab different points along a wired branch to make curves.
   - Drag sideways across the branch; dragging along it does almost nothing.
3. **Bend limits:** young shoots bend a lot; thick wood only a little. When you reach the limit the tooltip says *"This wood won't bend any further yet."* As the bend sets, you can bend further.
4. **Setting:** a bend sets gradually, quickly during the growing season and slowly in winter. Hover a wired section to see how many degrees are *still setting*.
5. **Removing wire:** click a wired section without dragging. Any part of the bend that hasn't set **springs back**.
6. **Wire bite:** as the branch thickens, the wire starts to cut in and turns **red**, and you get a warning. If you're running at 1 month/second, time drops to 1 week/second so you can react. Leave it on much longer and the branch is **scarred** with a permanent dark spiral in the bark.

The wire is drawn wrapped at **55°** to the branch, the usual bonsai wiring angle.

### Fertilize

Click **Fertilize** for 45 days of extra vigor (50% more growth). It does little while the tree is dormant. **Don't apply it again while it's still active.** That burns the roots and costs 12 health.

### Undo

**Undo** (Ctrl+Z) reverses your last action, up to 25 steps. It restores the whole tree, so it also rewinds any time that has passed since.

---

## How the tree grows

The tree is a living simulation, not an animation. Understanding these rules is the key to good bonsai.

### Energy and apical dominance
- Leaves make energy. More leaf mass means more growth.
- **The top and outer tips grow strongest.** Left alone, the tree becomes tall and leggy, with long bare branches. Pruning and pinching redistribute that energy inward.

### Growing toward the light
- Shoots bend toward the light: up toward the sky, out toward gaps in the canopy, and outward from the trunk.
- Most new branches angle upward or sideways. A few stay flat or droop at first and then turn up.
- Branches grow in all directions around the trunk, including toward you and away from you, so rotate the view to check every side.

### Buds and branching
- Maple buds come in **opposite pairs**, each pair at right angles to the one below.
- **Dormant buds** are held back by the growing tips above them. Cut or pinch the tips and the buds just below wake up.
- **Every spring** the buds near the tips of last year's shoots break, so each shoot branches a little more each year (the *spring flush*).
- **Back buds** (bright green) appear on older wood, much more often after pruning. They let you grow new branches close to the trunk.

### Ramification and leaf size
- Vigorous, unpruned shoots grow long internodes (the stretches between buds) and **big leaves**.
- Repeatedly cutting back and pinching gives **short internodes, small leaves and fine twigs**. This is called ramification, and the **Ramification** stat shows how many levels of branching you've built.

### Shade and dieback
- Leaves crowded together shade each other. **Shaded interior shoots weaken, stop budding and eventually die back.** Thin a dense canopy to keep the inside alive.

### Thickening and taper
- Every part of the trunk and branches lays down wood in proportion to the **leaf mass it feeds**, so the trunk thickens fastest when the tree is allowed to grow.
- Each section of wood also swells toward the combined thickness of the branches it carries, so the trunk always stays thicker than any branch.
- **Sacrifice branches:** a big unpruned branch thickens the trunk *below* where it attaches but not above it. Let one grow for a few years, then cut it off to leave a thick, tapering base.

---

## Roots, nebari and repotting

**Nebari** is the visible flare of surface roots spreading from the base of the trunk. It's one of the most admired features of a mature bonsai, and it takes years to build.

### How roots grow
- A seedling starts with a **taproot** heading down and 3–5 roots spreading out sideways near the surface.
- From **mid-March to late October** the roots grow and branch through the pot. They stay below the soil, and when they reach the pot wall they turn to run along it, producing **circling roots** in an old root ball.
- **Each main root thickens with the leaves on its side of the tree.** Roots and branches on the same side are linked, as in real trees. An even canopy builds an even nebari; a lopsided canopy builds a lopsided one.
- A downward taproot takes more than its share, drawing strength away from the surface roots.
- Thick surface roots show above the soil near the trunk, and the trunk flares down onto them.

### The pot fills up
- The **Roots** stat shows how full the pot is. Roots fill it over **about three years**.
- Above about **75% full**, the tree is pot-bound: growth and thickening slow, down to about 40% of normal when the pot is completely full. Root growth stops once the pot is full.
- In early February a notice warns you if the roots fill more than 80% of the pot.

### Repotting
You can repot between **February 1 and April 10**, in late winter before the buds break. The button reads **Repot now** during that window.

1. Click **Repot now**. Time pauses and the tree lifts out of its pot so you can see the whole root ball.
2. **Hover** a root to see in red what a cut would remove and its share of the root mass.
3. **Click** a root to cut it. Cutting the **taproot** or other thick downward roots is the classic way to encourage roots to spread sideways.
4. **Drag** a root to **swing it around the trunk**, to fill a gap in the nebari.
5. Drag empty space to rotate the view and inspect every side.
6. Click **Done**. The long and circling fine roots are combed out and trimmed automatically, and the tree goes back into fresh soil with the pot about **30% full**.
   - Roots you cut **sprout new roots at the cut the next spring**, spreading outward. This is how a nebari is built.
   - Cutting more than **about a third of the root mass** yourself costs health and slows growth for that season. The automatic combing-out doesn't count against you.
7. **Cancel** (or Esc) puts everything back exactly as it was. **Undo** after Done reverses the whole repot.

### The nebari score
The **Nebari** stat (0–100) rates your surface roots:
- how **evenly** they spread around the trunk (as seen from the front of the pot);
- how many directions they **cover**;
- how **thick** they are compared with the trunk;
- minus a penalty for **downward roots** and for roots **crowded** together.

The hint under the Repot button suggests what to work on, for example:
- *"A thick downward root is drawing strength from the nebari. Cut it when repotting."*
- *"Gap at the back-right. Swing a root there or let a cut root sprout."*
- *"Surface roots are still thin. Let the tree grow to thicken them."*
- *"Nice, even spread."*

---

## Tree health

The health bar under the stats shows how the tree is doing. Low health slows all growth, and if health reaches zero **the tree dies**.

| Hurts health | Notes |
|---|---|
| Heavy pruning in the growing season | Removing more than 30% of the foliage at once between late March and early September |
| Very heavy dormant pruning | Removing more than 50% of the foliage at once in autumn or winter |
| Too few leaves for the size of the trunk | Health drains steadily during the growing season |
| Double-fertilizing | −12 health |
| Heavy root pruning | Cutting more than about a third of the root mass when repotting |

Health recovers steadily while the tree has enough leaves. If your tree dies you can **Undo** your last action or **plant a new tree**.

---

## The stats panel

| Stat | Meaning |
|---|---|
| Age | Age of the tree (seedlings start at 2 years) |
| Height / Spread | Size of the tree in centimetres |
| Trunk diameter | Thickness at the base |
| Roots | How full the pot is |
| Nebari | Surface-root score, 0–100 |
| Growing tips | Shoots currently extending |
| Leafy shoots | Young shoots carrying leaves |
| Dormant buds | Buds waiting to break |
| Back buds | Buds that appeared on old wood |
| Ramification | Levels of branching (higher means finer twigs) |
| Wired sections | Branch sections with wire on (and how many are biting) |
| Fertilizer | Days of fertilizer remaining |

---

## New trees, pots and saved forms

### Starting a new tree
Click **New tree**:

1. **Choose a pot:** 12 options, rectangular or round, in indigo, celadon, cream, terracotta, oxblood or charcoal. Your current pot is labeled.
2. **Choose your tree:** six random two-year-old seedlings planted in that pot, each with a different trunk style (informal upright, slanting or formal upright), height, thickness, curves and branch layout. The previews show bare branches so you can compare structure.
   - **↻ Generate 6 more** gives new seedlings in the same pot.
   - **Change pot** goes back to the pot choice.
   - **Plant this** starts that tree. You're asked to confirm if your current tree has grown past its first month.

Planting replaces your current tree. Save its form or export it first if you want to keep it.

### Saved forms
A *form* is a saved snapshot of a tree's shape that you can start new trees from.

- In the picker, click **☆ Save form** on any seedling you like.
- In the side panel, click **Save form** to keep your *current* tree as it is now, at its current age and with any wiring. This lets you try different approaches from the same starting point.
- Open **New tree → Saved forms** to see them. **Plant a copy** starts a fresh copy (the saved form is never changed), and **Delete** removes one.

---

## Saving your progress

- The game **saves automatically** every 15 seconds, and whenever you close or switch away from the tab. **Save** saves immediately.
- Saves are stored in your browser, so they belong to that browser on that computer.
- **Export** downloads your tree as a `.json` file, a backup you can keep or move to another computer. **Import** loads one.
- Time does not pass while the game is closed.

---

## A year of bonsai care, month by month

| Month | Suggested work |
|---|---|
| **January** | Structural pruning: remove unwanted branches and shorten the trunk. Wire branches into position. |
| **February** | Last weeks for big cuts. **Repot** if the roots fill the pot (every 2–3 years): cut the taproot, swing roots into gaps. |
| **March** | Finish repotting before buds break (window closes Apr 10). Check wires. |
| **April – May** | Strong growth. **Pinch** strong tips and let the inner shoots develop. Avoid heavy cuts (health cost). Watch wires for bite as branches thicken. |
| **June** | Cut back long shoots to two pairs of buds to build ramification. Thin crowded areas. |
| **July – August** | Growth slows; wood thickens. Light trimming only. Remove wires that are biting. |
| **September** | Little growth. Plan next winter's structural work. |
| **October** | Enjoy the autumn color. |
| **November – December** | Leaves fall. Remove deadwood and start structural pruning and wiring. |

---

## Techniques and tips

- **Thicken first, refine later.** A young trunk only thickens if the tree has lots of leaves. Let the tree grow freely for a few years, then cut it back hard in winter.
- **Build taper with trunk chops.** Cut the trunk back in winter; a bud below takes over as the new leader. Repeat every few years for a trunk that narrows toward the top.
- **Use a sacrifice branch.** Keep one low branch unpruned to fatten the trunk below it, then remove it.
- **Build fine branching** by cutting shoots back to two pairs of buds, or pinching tips, again and again. Leaves get smaller as branching gets finer.
- **Keep the inside alive.** Thin the outer canopy so light reaches inner shoots and back buds.
- **Wire in winter** when the branches are bare. Take wire off as soon as it starts to bite (red), usually during the next growing season.
- **Balance the canopy all the way around** for an even nebari, since each root feeds the branches on its side.
- **Cut the taproot** at your first repotting, and swing surface roots into any gaps.
- **Prune in stages.** Removing too much at once, especially in spring and summer, weakens the tree.
- **Experiment safely.** Save a form or export before a risky change, and use Undo freely.

---

## Troubleshooting

**The page is blank.**
If Firefox has been open a long time it may have updated itself in the background, and new tabs then come up blank. **Quit Firefox completely (Cmd+Q) and reopen it**, then open `index.html` again.

**The 3D view doesn't appear.**
The game needs WebGL. Try a different browser. If it still won't load from a local file, serve the folder instead and open the address it prints:
```
cd ~/bonsai-game && python3 -m http.server 8000
```
Then visit http://localhost:8000.

**My tree from the 2D version isn't here.**
The 2D game and its saves are kept separately in `~/bonsai-game-2d/`. 2D trees can't be converted to 3D.

**Time isn't moving.**
Time is paused while a dialog is open, while repotting, or when the ❚❚ button is selected. Press **Space** or pick a speed.

**The game is slow with a very large tree.**
Huge, unpruned trees with thousands of branches take more work to draw. Pruning helps, and so does running at a slower speed.

---

## Files

| File | Purpose |
|---|---|
| `index.html` | The page layout, panel and dialogs |
| `style.css` | Styling for the panel and overlays |
| `sim.js` | The growth simulation: tree, buds, light, thickening, wiring, roots, calendar, saving |
| `render3d.js` | The 3D scene: textures, tree and root meshes, leaves, pots, sky, camera, picking |
| `game.js` | Input, time control, the panel, notices, saving, the new-tree picker and saved forms |
| `lib/three.min.js` | The Three.js 3D library (r159) |

The original 2D anime-style version is in `~/bonsai-game-2d/`.
