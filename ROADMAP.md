# Tabula Rasa — Roadmap

Where the plugin is today and where it's headed. Items link to their tracking
issues. Phases are intent, not hard commitments, and may reorder based on feedback.

## ✅ Shipped (v0.1.x → v0.2.0 MVP)

- Natural, pressure-tapered drawing (perfect-freehand) for finger, Apple Pencil,
  mouse, or stylus — with velocity-based taper when there's no real pressure.
- Mobile-first input: Pointer Events with coalesced sampling, no accidental
  scrolling, optional palm rejection.
- Pen, highlighter, eraser (whole-stroke); color palette; brush sizes; undo/redo;
  clear.
- Pinch-to-zoom, two-finger pan, wheel-zoom, fit-to-screen.
- Theme-aware pen (white on dark, black on light).
- Re-editable `.sketch` (JSON) files with autosave + explicit save.
- On-demand PNG/SVG export (embed-in-note or save-only — no surprise image files).
- **Live inline previews** of `.sketch` embeds in notes (Reading view + Live
  Preview), kept in sync and click-to-edit.
- Rebrand to **Tabula Rasa** and community-store prep (LICENSE, compliant id/name).
- Consistent bundled tool icon across ribbon, view tab, and commands
  ([#6](https://github.com/JeremiahBeatham/TabulaRasa/issues/6), v0.2.1).
- On-canvas canvas resize: aspect presets (square, 4:3, 16:9, A4), anchor or
  scale-to-fit, and fit-to-drawing
  ([#8](https://github.com/JeremiahBeatham/TabulaRasa/issues/8), v0.3.0).
- Brush-size picker: slider, presets, and live preview in a popover
  ([#10](https://github.com/JeremiahBeatham/TabulaRasa/issues/10), v0.4.0).
- Color picker: custom color + recent colors alongside the palette
  ([#11](https://github.com/JeremiahBeatham/TabulaRasa/issues/11), v0.5.0).
- Pinch-to-rotate ("twist") the canvas to draw from any angle; Fit to screen
  resets it ([#9](https://github.com/JeremiahBeatham/TabulaRasa/issues/9), v0.6.0).

## 🔜 Next (UX polish)

- [#7 — Audit: which controls belong in settings vs on the canvas](https://github.com/JeremiahBeatham/TabulaRasa/issues/7)

## 🧭 Later (bigger features)

- [#12 — Additional eraser modes (partial/segment + area)](https://github.com/JeremiahBeatham/TabulaRasa/issues/12)
- [#13 — Selection tool (lasso/rectangle + move/scale/delete/duplicate)](https://github.com/JeremiahBeatham/TabulaRasa/issues/13)
- [#14 — Smart snapping / shape recognition (straight line, circle)](https://github.com/JeremiahBeatham/TabulaRasa/issues/14)

## 🏪 Distribution

- Rebrand to a store-compliant id/name — **done** (`tabula-rasa` / "Tabula Rasa").
- Add `LICENSE`, screenshots, and final README polish.
- Submit to the [Obsidian community plugins list](https://github.com/obsidianmd/obsidian-releases)
  (add an entry to `community-plugins.json` and open a PR).
- Until then, install via [BRAT](https://github.com/TfTHacker/obsidian42-brat).
