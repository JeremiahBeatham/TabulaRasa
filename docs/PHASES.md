# TabulaRasa — Phases

> Supersedes `ROADMAP.md`. Phases are intent, not hard commitments, and may reorder based on feedback.

## Current Status
| Phase | Status |
|---|---|
| Shipped (v0.1.x → v0.9.0) | Done — see below |
| Next (UX polish) | #7 done — toolbar rebuilt to 4 buttons, 169px → 49px |
| Later (bigger features) | 2 planned |
| Distribution | Rebrand done; community-store submission pending |

**Active branch:** `main`
**Last updated:** 2026-08-04

---

## Shipped (v0.1.x → v0.9.0)
- [x] Natural, pressure-tapered drawing (perfect-freehand) — finger, Apple Pencil, mouse, stylus; velocity-based taper when there's no real pressure
- [x] Mobile-first input: Pointer Events, coalesced sampling, no accidental scrolling, optional palm rejection
- [x] Pen, highlighter, whole-stroke eraser; color palette; brush sizes; undo/redo; clear
- [x] Pinch-to-zoom, two-finger pan, wheel-zoom, fit-to-screen
- [x] Theme-aware pen (white on dark, black on light)
- [x] Re-editable `.sketch` (JSON) files with autosave + explicit save
- [x] On-demand PNG/SVG export (embed-in-note or save-only — no surprise image files)
- [x] Live inline previews of `.sketch` embeds (Reading view + Live Preview), kept in sync, click-to-edit
- [x] Rebrand to **Tabula Rasa**, community-store prep (LICENSE, compliant id/name)
- [x] Consistent bundled tool icon across ribbon/view tab/commands ([#6](https://github.com/JeremiahBeatham/TabulaRasa/issues/6), v0.2.1)
- [x] On-canvas resize: aspect presets (square, 4:3, 16:9, A4), anchor/scale-to-fit, fit-to-drawing ([#8](https://github.com/JeremiahBeatham/TabulaRasa/issues/8), v0.3.0)
- [x] Brush-size picker: slider, presets, live preview popover ([#10](https://github.com/JeremiahBeatham/TabulaRasa/issues/10), v0.4.0)
- [x] Color picker: custom color + recent colors alongside palette ([#11](https://github.com/JeremiahBeatham/TabulaRasa/issues/11), v0.5.0)
- [x] Pinch-to-rotate ("twist") canvas to draw from any angle; Fit to screen resets it ([#9](https://github.com/JeremiahBeatham/TabulaRasa/issues/9), v0.6.0)
- [x] Eraser modes: whole-stroke and partial/segment erasing ([#12](https://github.com/JeremiahBeatham/TabulaRasa/issues/12), v0.7.0)
- [x] Maintenance: `esbuild` → `^0.28.1`, clearing the GHSA-67mh-4wv8-2f99 dev-server advisory (v0.8.0)
- [x] Four-button toolbar, new brush tool, native iOS colour picker, three-finger undo/redo
      ([#7](https://github.com/JeremiahBeatham/TabulaRasa/issues/7), v0.9.0)

## Next — UX Polish
- [x] [#7 — Which controls belong in settings vs. on the canvas](https://github.com/JeremiahBeatham/TabulaRasa/issues/7)
  - **Audit.** The old toolbar carried 19 controls in 4 groups. Because `.tabula-rasa-group` has no
    inner `flex-wrap`, groups wrap whole, so at 375px it measured **3 rows / 169px — 26% of the
    screen** before a stroke was drawn, and stayed 3 rows at 390px and 430px too.
  - **Rebuilt to four buttons** — brush, size, colour, more — measured at **1 row / 49px**, a 120px
    saving (−71%). The bar no longer wraps by design.
  - Tools moved into a list behind the brush button: pen, **brush (new)**, highlighter/marker, and
    the two erasers (objects / pixels) promoted from a hidden re-tap to first-class entries.
  - Colour now opens the **native iOS Colors sheet** via `<input type="color">`; the 7-swatch
    palette and the in-plugin recents list are gone, since the system picker already provides both.
  - Undo/redo became **three-finger gestures** (two fingers is pan/zoom, so it was unavailable), and
    are also listed in the "more" sheet so they stay discoverable. The explicit Save button was
    dropped — autosave already covered it.
  - Both audit gaps closed: **canvas colour** is now editable per sketch in the "more" sheet, and
    eraser mode has a real home in the tool list.
  - Toolbar button size is a setting (24 / 32 / 40, default 32); the tap target stays ≥44px at all
    three so the smallest option is still usable.

## Later — Bigger Features
- [ ] [#13 — Selection tool (lasso/rectangle + move/scale/delete/duplicate)](https://github.com/JeremiahBeatham/TabulaRasa/issues/13)
- [ ] [#14 — Smart snapping / shape recognition (straight line, circle)](https://github.com/JeremiahBeatham/TabulaRasa/issues/14)

## Distribution
- [x] Rebrand to store-compliant id/name (`tabula-rasa` / "Tabula Rasa")
- [ ] Add LICENSE, screenshots, final README polish
- [ ] Submit to the [Obsidian community plugins list](https://github.com/obsidianmd/obsidian-releases) (entry in `community-plugins.json` + PR)
- Until then: install via [BRAT](https://github.com/TfTHacker/obsidian42-brat)
