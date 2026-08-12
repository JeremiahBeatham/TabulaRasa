# TabulaRasa — Architecture

## Tech Stack
- **Plugin:** TypeScript, Obsidian Plugin API
- **Bundler:** esbuild (`esbuild.config.mjs`)
- **Rendering:** `perfect-freehand` for pressure-tapered stroke geometry; Pointer Events with coalesced-event handling

## File Structure
```
src/
  main.ts        — plugin entry, commands, .sketch embeds, export plumbing
  SketchView.ts  — the editor view: toolbar, popovers, modals, the "more" sheet
  canvas.ts      — drawing surface, pan/zoom/rotate, erasers, selection, undo stack
  export.ts      — stroke geometry (perfect-freehand) + PNG/SVG rendering
  gestures.ts    — three-finger undo/redo recognition (pure, unit-testable)
  selection.ts   — lasso hit-testing and transform matrices (pure, unit-testable)
  shapes.ts      — hold-to-snap shape recognition: line, ellipse, polygon (pure, unit-testable)
  model.ts       — .sketch document schema and (de)serialisation
  settings.ts    — settings schema, defaults, settings tab
manifest.json   — Obsidian plugin manifest
versions.json   — version compatibility map
version-bump.mjs
styles.css      — UI styling
```

## Data Schema
`.sketch` files — custom JSON stroke format, source of truth. PNG/SVG generated only on export, never stored as the canonical record.

## Integrations
- Obsidian community plugin API (markdown post-processor for live inline previews).
- BRAT (Beta Reviewers Auto-update Tool) for pre-community-store distribution.

## Design Decisions
- **`.sketch` (vector JSON) is the source of truth**, not images — keeps sketches re-editable, avoids image-file clutter in the vault.
- **Images only on export** with an explicit embed-vs-save choice, so users never accumulate files they didn't ask for.
- **Live inline preview by default**, plain-link as opt-in toggle.
- **Theme-aware pen color** (white on dark, black on light) so strokes stay visible.
- **Mobile-first input handling**: coalesced pointer events, scroll suppression, optional palm rejection.
- **Four-button toolbar** (brush, size, colour, more). It deliberately does not wrap — anything that
  would need a second row belongs in the "more" sheet instead. The old bar ran to three rows and
  169px of its own on a phone; the tools now sit in Obsidian's existing header and cost the sketch
  no vertical space at all.
- **Button size is decoupled from tap target.** The drawn circle follows the user's 24/32/40 setting
  while the button's hit box stays at ≥44px, so a small toolbar never becomes a hard-to-hit one.
- **The system owns colour.** The native iOS Colors sheet (grid, spectrum, sliders, eyedropper,
  swatches) is the picker; no in-plugin palette or recents list competes with it.
- **The toolbar lives in Obsidian's view header**, added via `addAction()`, next to Obsidian's own
  "..." menu. The sketch therefore adds no chrome of its own; the filename is hidden to make room
  and is instead read/edited in the "more" sheet.
- **Undo/redo are double-tap gestures**: two fingers to undo, three to redo. They are recognised by
  the fingers *not* travelling, which is what keeps them clear of two-finger pan/zoom/rotate — a tap
  and a drag are distinguished by movement, not by finger count. Both actions are additionally
  listed in the "more" sheet, because a gesture with no visible affordance is undiscoverable.
- **Colour is the input element itself.** The `<input type="color">` is stretched transparently over
  the colour swatch so a real finger tap lands on it. iOS only raises the system Colors sheet for a
  genuine user tap; a scripted `.click()` on a hidden input is ignored.
- **Per-tool stroke parameters** live in one table in `export.ts`, so a tool's feel is defined once
  and applies identically to the live canvas, PNG export and SVG export.
- **Selection is a tool, not a mode layered over drawing.** Picking it turns the same drag into a
  boundary; size and colour dim because neither applies. Its geometry (point-in-polygon, coverage,
  the transform matrices, handle placement) lives in `selection.ts` with no DOM, which is what makes
  "the selection drifted" answerable without a device.
- **A selection is a set of stroke indices, and it is deliberately short-lived.** Indices survive
  everything you can do *while* selecting — transform, paste — and the selection is dropped by
  anything that reshuffles the stroke array: undo, clear, or leaving the tool. Holding references
  instead would survive reordering but not transforms, which replace stroke objects so undo snapshots
  stay intact.
- **Selection chrome is drawn in screen space.** The box's corners are projected through the view
  transform, so it follows the page's rotation, but the handles are then drawn at a fixed CSS-pixel
  radius — a handle whose size tracked zoom would be untappable at one end and enormous at the other.
- **The middle of the box always means "move"**, checked before handles. A finger-sized grab radius
  on a small selection otherwise reaches the centre from every side, leaving something that can be
  scaled from anywhere and moved from nowhere.
- **Shape snapping is a hold, never automatic.** A stroke that reshapes itself the moment you lift
  makes every stroke a gamble; holding still is an explicit request. Recognition is also conservative
  by design — lines, ellipses, rectangles and triangles only, and a shape it isn't sure about is left
  exactly as drawn, because a wrong snap destroys work while a missed one costs one more attempt.
- **A snapped shape is rendered differently from a freehand one.** `Stroke.snapped` is persisted and
  turns off the stroke smoothing that exists to make hand-drawn input feel good: on points that are
  already exact, that smoothing only reintroduces the wobble the snap removed. The tool's weight and
  texture are kept, so a snapped crayon is still a crayon.
- **BRAT-first distribution** ahead of community-store approval.
