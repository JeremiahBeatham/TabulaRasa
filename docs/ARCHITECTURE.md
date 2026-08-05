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
  canvas.ts      — drawing surface, pan/zoom/rotate, erasers, undo stack
  export.ts      — stroke geometry (perfect-freehand) + PNG/SVG rendering
  gestures.ts    — three-finger undo/redo recognition (pure, unit-testable)
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
- **Four-button toolbar** (brush, size, colour, more). The bar deliberately does not wrap — anything
  that would need a second row belongs in the "more" sheet instead. It previously ran to three rows
  and 169px on a phone; it is now one row and 49px.
- **Button size is decoupled from tap target.** The drawn circle follows the user's 24/32/40 setting
  while the button's hit box stays at ≥44px, so a small toolbar never becomes a hard-to-hit one.
- **The system owns colour.** The colour button clicks a hidden `<input type="color">`, which on iOS
  raises the native Colors sheet (grid, spectrum, sliders, eyedropper, swatches). No in-plugin
  palette or recents list competes with it.
- **Undo/redo are three-finger gestures.** Two-finger input is already pan/zoom/rotate, so it cannot
  be overloaded; three fingers also matches iOS convention. Both actions are additionally listed in
  the "more" sheet, because a gesture with no visible affordance is undiscoverable.
- **Per-tool stroke parameters** live in one table in `export.ts`, so a tool's feel is defined once
  and applies identically to the live canvas, PNG export and SVG export.
- **BRAT-first distribution** ahead of community-store approval.
