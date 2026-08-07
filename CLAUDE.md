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
- **"Clear selection" deselects; it doesn't delete.** The bar has no other way to dismiss a
  selection, and the eraser already deletes.
- **Icon names are checked at runtime** (`setIconSafe`), because which Lucide icons a given Obsidian
  version bundles isn't knowable at build time and `setIcon` silently leaves the element empty.

**Artifacts: only on request.** Jeremiah deploys his own interactive tools and doesn't want work
sitting at hosted URLs by default. Build tools as files in `docs/tools/` and publish only when he
explicitly asks for an artifact.
