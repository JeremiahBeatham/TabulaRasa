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

## 🔜 Next (UX polish, ~v0.2–0.3)

- [#6 — Better tool icon (consistent, no fallback "?")](https://github.com/JeremiahBeatham/TabulaRasa/issues/6)
- [#7 — Audit: which controls belong in settings vs on the canvas](https://github.com/JeremiahBeatham/TabulaRasa/issues/7)
- [#8 — On-canvas canvas resize & aspect-ratio controls](https://github.com/JeremiahBeatham/TabulaRasa/issues/8)
- [#10 — Better brush-size selection UX](https://github.com/JeremiahBeatham/TabulaRasa/issues/10)
- [#11 — Better brush-color selection UX (custom picker + recents)](https://github.com/JeremiahBeatham/TabulaRasa/issues/11)

## 🧭 Later (bigger features)

- [#9 — Pinch-to-rotate ("twist") the canvas](https://github.com/JeremiahBeatham/TabulaRasa/issues/9)
- [#12 — Additional eraser modes (partial/segment + area)](https://github.com/JeremiahBeatham/TabulaRasa/issues/12)
- [#13 — Selection tool (lasso/rectangle + move/scale/delete/duplicate)](https://github.com/JeremiahBeatham/TabulaRasa/issues/13)
- [#14 — Smart snapping / shape recognition (straight line, circle)](https://github.com/JeremiahBeatham/TabulaRasa/issues/14)

## 🏪 Distribution

- Rebrand to a store-compliant id/name — **done** (`tabula-rasa` / "Tabula Rasa").
- Add `LICENSE`, screenshots, and final README polish.
- Submit to the [Obsidian community plugins list](https://github.com/obsidianmd/obsidian-releases)
  (add an entry to `community-plugins.json` and open a PR).
- Until then, install via [BRAT](https://github.com/TfTHacker/obsidian42-brat).
