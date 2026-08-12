# TabulaRasa — CLAUDE.md

## Project Overview
Obsidian community plugin for finger/Apple Pencil sketching directly inside a vault. Pressure-tapered strokes, live inline previews, re-editable `.sketch` files; images only generated on export.

- **Repo:** `JeremiahBeatham/TabulaRasa` (public)
- **Vault ID:** unassigned — needs a {Project B-###} number
- **Live:** distributed via BRAT; community-plugins submission in progress
- **Hosting:** n/a (Obsidian plugin, bundled with esbuild)
- **Tier:** Product/App

## Dev Constraints
- Mobile-only dev (iPhone) — no terminal, no local preview.
- Plugin is TypeScript, bundled via esbuild; standard Obsidian plugin scaffolding (manifest.json, versions.json).
- Phases/status live in `docs/PHASES.md`, which supersedes the old `ROADMAP.md` (no longer in the repo).

## Working Style (default)
- Short, direct answers. No preamble.
- Trunk-based, one branch at a time, Jeremiah names every branch.
- Commit directly to active branch. No PR unless asked.
- Always update this file first when direction changes.

## Where things live
| Jeremiah says... | File |
|---|---|
| status / phases | `docs/PHASES.md` |
| architecture | `docs/ARCHITECTURE.md` |
| team / branch ownership | `docs/TEAM.md` |
| personas | `docs/PERSONAS.md` |
| product requirements | `docs/PRD.md` |

---

## Reorg Status

**Campaign:** BeathamBase doc standard + light refactor (multi-repo reorg across all 20 repos)
**Status:** Complete and merged. Docs live in `docs/`, routing table above is current, README links fixed.

Root keeps only `README.md`, `CLAUDE.md`, `LICENSE`. Everything else goes in `docs/`.

- `ROADMAP.md` confirmed absent; stale references removed (README points at `docs/PHASES.md`).
- `npm audit` was 1 moderate — `esbuild <=0.24.2` dev-server advisory (GHSA-67mh-4wv8-2f99).
  Resolved by bumping `esbuild` `^0.20.0` → `^0.28.1` (dev-only); now 0 vulnerabilities.
  Shipped as **v0.8.0**.

---

## Current Work

**Issue #7 — toolbar rebuild.** The sketch view's toolbar is now four circular buttons
(brush · size · colour · more), down from 19 controls across 3 rows. Measured 169px → 49px.

Conventions worth knowing before touching this area:

- **The toolbar must never wrap.** If something needs a second row it belongs in the "more" sheet.
- **Visual button size ≠ tap target.** The circle follows the 24/32/40 setting; the hit box stays
  ≥44px. Don't collapse those back together.
- **Colour is the operating system's job.** The button clicks a hidden `<input type="color">`,
  which raises the native iOS Colors sheet. Don't rebuild a palette or recents list.
- **The bar lives in Obsidian's view header** (via `addAction()`), not in a strip of our own. The
  filename is hidden to make room and is renameable from the "more" sheet.
- **Gestures are double-taps**: two fingers undo, three redo. They're told apart from pan/zoom by
  *travel and spread*, not finger count. Two traps here, both hit once already: the centroid jumps
  when a finger joins (so re-baseline on every finger-count change, or taps read as 50px drags), and
  a pinch can hold its centroid still (so spread must be checked too). Both are also in the "more"
  sheet so they stay discoverable.
- **Never clear `redoStack` on finger-down** — every gesture starts with a touch, so that destroys
  redo history before the gesture can fire. Clear it when a stroke commits.
- **The colour control is a real, visible `<input type="color">`** restyled into the swatch, inside a
  `div` (never a `<button>` — nesting an input in one is invalid HTML). iOS only opens the native
  Colors sheet for a genuine tap on a genuine input; invisible inputs and scripted `.click()` are
  both ignored. Two attempts failed that way before this stuck.
- **Settings grouping came from a card sort**, not from code layout — sheet is Sketch / Canvas /
  Export, tab is General / Toolbar / Gestures / Drawing. Don't re-sort it casually; re-run
  `docs/tools/settings-card-sort.html` instead.
- **Per-tool stroke feel lives in one table** (`TOOL_STROKE_OPTIONS` in `src/export.ts`) so the
  live canvas and both export paths stay in agreement. Any randomness there (crayon's grain) must be
  seeded and deterministic — a real RNG makes a drawing shimmer on redraw and differ from its export.
  **Seed it by position, never by vertex index.** perfect-freehand returns the outline as one side
  forward then the other back, so appending a point renumbers every vertex on the return side; an
  index seed re-rolled their grain each frame and the edge visibly crawled while drawing (~2px at
  size 8). Quantise the position before hashing so float drift can't change the roll.
- **The size presets run largest at the top**, matching the vertical slider beside them, whose fill
  rises from the bottom. Top of the slider is `MAX_BRUSH_SIZE`, which is also the first preset, so
  the two columns agree at both ends. Flipping one without the other is a bug he'll spot.
- **The name field renames on idle, not on change.** It waits `RENAME_IDLE_MS` (1400) and shows no
  success toast: a shorter wait renamed the file on any pause mid-word, so one name produced several
  renames and several notices. Failures still notify.
- **Sliders in popovers must be vertical**, and hand-built. A horizontal drag inside Obsidian mobile
  is taken as the app's back-swipe and throws you out to file navigation; `<input type="range">` with
  `appearance: slider-vertical` renders in the webview as a grey block with no visible track.
- **`.tabula-rasa-canvas` and `-canvas-host` in `styles.css` are load-bearing.** Their sizing keeps
  the canvas from collapsing to a `<canvas>`'s intrinsic 300×150, and `touch-action: none` is what
  makes a drag draw rather than scroll Obsidian. A bulk CSS deletion removed them once and broke
  drawing entirely; verify the canvas still renders after any CSS surgery, not just the piece you
  were editing.
- **Obsidian's global `button`/`input` styles beat single-class selectors.** Anything that needs a
  transparent background or its own padding must double its class (`.x.x`) or it comes back filled
  and boxed. Test harnesses must emulate those defaults, or they will report alignment and styling
  the device contradicts — this has already happened twice.
- **`ToolName` keeps `"brush"`** purely so sketches saved by v0.9.0–v0.10.2 still render; it aliases
  to `crayon` and is not offered in the UI. `"select"` is also in the union but never lands on a
  saved stroke — it's what the brush setting holds while the selection tool is active.

**Issue #13 — selection tool.** Fifth entry in the tool list. Conventions that came out of building it:

- **The lasso is always closed.** Lifting a finger snaps the shape shut; the polygon is never given a
  duplicate first point, the ray-cast just treats it as closed. A stroke is caught at ≥50% coverage
  (`SELECTION_MIN_COVERAGE`) — requiring all of it makes long strokes uncatchable, accepting any
  overlap grabs what you lassoed *around*.
- **Selection is a set of indices and is meant to be short-lived.** Dropped by undo, clear, and
  leaving the tool. Don't make it survive those: the erasers rebuild `doc.strokes` wholesale.
- **Transforms rebuild strokes from the originals held at drag start**, never from the current state,
  or a drag back to where it began doesn't land there. An identity transform must restore the
  original objects *by reference*, which is how a no-op drag is detected and its undo entry dropped.
- **Scale handles move by the finger's travel, not to the finger.** Grabbing a handle 10px off-centre
  otherwise jerks the edge 10px before you've moved.
- **The middle of the box is tested for "move" before any handle.** At a 24px grab radius every
  handle on a small selection reaches its centre, which left a selection that could be scaled from
  every side and moved from nowhere. `insetBounds` caps the reserved band at a third of the short
  side so a movable core always exists.
- **Add/Remove modes don't drag-to-move.** Their boundaries almost always start inside the existing
  box, and treating that as a move made both modes unreachable.
- **Clear and Delete are two separate buttons, side by side.** Clear only puts the box away; Delete
  takes the ink. The bar is the only way to do either, so neither can stand in for the other.
- **There is no bar of its own — the selection reuses the size and colour slots.** Three separate
  attempts at a floating bar in `contentEl` never appeared on device and could not be diagnosed
  without a console. The header buttons demonstrably render, so with a selection live the size slot
  becomes selection mode and the colour slot becomes transform. Don't reintroduce a bar; if a control
  needs a home, it goes in a slot or on the long press.
- **Copy / cut / paste / delete are on a long press** (`LONG_PRESS_MS`, cancelled by
  `LONG_PRESS_MAX_TRAVEL` of drift so it can never eat a lasso). Paste is offered on a press outside
  the selection too, or a copy would have nowhere to land once its selection is gone.
- **A tap away deselects in every mode**, not just Replace: the mode shapes the next boundary, it
  shouldn't make tapping away conditional.
- **Icon names are checked at runtime** (`setIconSafe`), because which Lucide icons a given Obsidian
  version bundles isn't knowable at build time. An unknown name can also *throw*, and that took out
  the whole selection bar once: the box was already drawn, then the bar build died on its first icon,
  giving a dashed box with no controls. Each attempt is guarded, the last resort is plain
  `textContent` (not Obsidian's `setText`, which is the same class of dependency), and the canvas
  wraps its selection callback so a UI failure can never break drawing.

**Issue #14 — hold to snap.** Pause at the end of a stroke, without lifting, and a rough line or
circle is replaced by a clean one. Recognition lives in `src/shapes.ts`, DOM-free.

- **A still finger sends no pointer events**, so stillness can only be detected by a timer that each
  move re-arms. Drift under `SNAP_HOLD_DRIFT` deliberately leaves the running timer alone, or a hand
  that can't hold perfectly still never snaps.
- **Never judge straightness by path length over chord length.** Fine sampling of a shaky line
  inflates path length by ~40%, so that guard rejected exactly the strokes this feature exists to fix
  (measured: a realistic wobbly line came out at ratio 1.39). Overshoot is measured by *projecting*
  each point onto the chord instead — which is also a truer test of doubling back.
- **A false positive costs more than a miss.** A scribble that becomes an ellipse loses work; a circle
  that fails to snap costs a second try. Hence the four-quadrant check and the RMS *and* worst-case
  radial bounds. A pentagon, trapezoid, bowed-edge shape or scribble must come out unchanged.
- **Roundness is judged by radial RMS, never by counting corners.** A circle drawn with 8% wobble
  throws up five to seven *false* corners, so a corner count would reject exactly the shaky circles
  the feature exists for. Measured: pentagon 0.111, square 0.204, 8%-wobble circle 0.050, 12% 0.085 —
  hence the 0.10 bound. A hexagon (0.068) does read as a circle; that's accepted.
- **Corner *count* is never trusted; the fit is.** The recogniser proposes the sharpest well-separated
  turns, then tries four corners and then three, accepting whichever fitted shape passes close to the
  whole stroke. Thresholding the turn angle instead was brittle on real strokes: corners rounded over
  30px lost one and ±8px of wobble invented one, and either way the shape snapped to nothing.
- **Rectangles are fitted as an oriented box, not the bbox.** The orientation is the circular mean of
  the four edge angles taken modulo 90°, so a diamond becomes a square turned 45° instead of a
  mangled upright one; under 4° it snaps level. The fit is then rejected unless it passes close to
  every drawn point, which is what leaves a trapezoid or parallelogram alone.
- **Triangles keep the corners drawn.** Regularising to equilateral would invent a shape.
- **A snapped stroke stops accepting points**, sets `simulatePressure: false`, and sets
  `snapped: true`.
- **`snapped` is a rendering flag as much as a record, and it's persisted.** It switches
  `strokeToOutline` onto a different renderer entirely (below). It began as "turn streamline off" —
  streamline makes freehand feel good by dragging each sample toward the last, and on already-exact
  points it put the wobble straight back in, measured at **2.74px** of stray on a 200px square at
  size 6. That was reported as "the snapped square still looks wobbly", and it was the renderer, not
  the recogniser — as every corner complaint since has also turned out to be.
- **A snapped shape is stroked by our own code, not by perfect-freehand** (`snappedOutline` in
  `src/export.ts`). It sweeps a nib of constant half-width along the centreline: **outside of every
  corner is an arc of exactly the nib's radius, inside is the plain crossing of the two band edges.**
  That is what a round nib physically does, and it's the look — crisp geometry softened by the pen
  rather than by the geometry. Snapped strokes have constant pressure, so perfect-freehand was
  contributing nothing but bugs. Grain still applies, so a snapped crayon is still a crayon.
- **Never round the centreline.** v0.13.4 filleted corners at 12% of the shorter edge (max 14px) and
  it was reported as too soft: a centreline radius makes the outer radius `fillet + nib`, so at size 6
  a corner was **17px round instead of 3px** and rectangles read as rounded rectangles. Only a
  centreline radius of zero leaves the nib's own width as the whole of the roundness. Corner softness
  then scales with the brush for free, which is the behaviour that was actually wanted.
- **Why not perfect-freehand for these:** it emits one outline vertex per input sample, so a hard
  corner puts the entire turn on one vertex, which the canvas joins with `lineTo` and therefore draws
  as a point — 100° on one vertex with 80° of variation between a square's corners. On sharp corners
  it also folded the band through itself: rasterising found one corner drawn as a diagonal wedge and a
  triangle's apex forked with a hole in it.
- **Inner corners are mitred with a limit** (`SNAP_MITER_LIMIT`, 4 — SVG's own default), then
  bevelled. The miter runs `1 / cos(turn/2)` nib widths inward: 1.41 at a right angle, 2.0 at 60°,
  but 6.6 on a 17° sliver, which would spear a spike deep into the ink.
- **A closed stroke is an annulus, and its bridge must leave and re-enter at the same point.** One
  filled path describes a ring by walking both boundaries in opposite directions and crossing between
  them. Returning to the inner boundary at the *last* vertex instead of the first flipped the winding
  over the 33px in between and cut **134 samples of bare canvas through a 200px square's top edge** —
  on a shape whose every corner measured perfect. The crossing lands mid-edge because that's where
  `polygonRing` opens the ring; a corner is the worst place for it.
- **Test solidity, not just corner shape.** A hole in the ink is the worst failure mode here and it
  hides behind correct-looking corner measurements. Walk the centreline and assert every sample is
  inked, at the smallest and largest brush sizes and with grain on.
- **Measure edge wobble as *variation*, not distance from the ideal.** perfect-freehand does not apply
  `thinning` at constant pressure, so half-width is `size/2`; assuming otherwise put a flat 0.90px of
  phantom error into every figure in a first pass at this.
- Recognised: line, ellipse, rectangle (3 or 4 corners). Five or more corners is left alone.
- **A round cap is not edge wobble.** A cap sweeps from one side of the band to the other, so its
  vertices legitimately sit at every distance from 0 to `size/2`. A straightness metric that doesn't
  exclude the seam reported 2.84px of "wobble" on a geometrically perfect square. Assert cap
  *placement* separately instead.

**Next phase: community-plugin submission.** The snapping massage pass is done (v0.13.4). Text tool,
images in a sketch and layers are all post-MVP and parked in `docs/PHASES.md` — not started.

**Artifacts: only on request.** Jeremiah deploys his own interactive tools and doesn't want work
sitting at hosted URLs by default. Build tools as files in `docs/tools/` and publish only when he
explicitly asks for an artifact.
