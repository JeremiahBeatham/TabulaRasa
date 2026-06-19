# TabulaRasa — Architecture

## Tech Stack
- **Plugin:** TypeScript, Obsidian Plugin API
- **Bundler:** esbuild (`esbuild.config.mjs`)
- **Rendering:** `perfect-freehand` for pressure-tapered stroke geometry; Pointer Events with coalesced-event handling

## File Structure
```
src/            — plugin source (TypeScript)
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
- **BRAT-first distribution** ahead of community-store approval.
