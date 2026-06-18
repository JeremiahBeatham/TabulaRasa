# Tabula Rasa

Finger- and Apple Pencil-friendly sketching for [Obsidian](https://obsidian.md).
Draw the way you do in the native iOS Notes app — directly in your vault — then
embed sketches in notes or keep them as standalone, re-editable files.

> **Status:** working MVP (v0.2.0). Install via [BRAT](https://github.com/TfTHacker/obsidian42-brat)
> today; a community-plugins submission is in progress. See where we are and where
> we're going in **[ROADMAP.md](ROADMAP.md)**.

## Screenshots

<!-- TODO: add screenshots / a short GIF of drawing + an inline embed in a note.
     Drop images in an `assets/` folder and reference them here, e.g.:
     ![Drawing on iPhone](assets/draw.png)
     ![Inline preview in a note](assets/embed.png) -->

## Features

- ✏️ **Natural drawing** with pressure-tapered strokes (perfect-freehand) using
  finger, Apple Pencil, mouse, or any stylus. Finger and mouse strokes taper from
  drawing speed, so lines look hand-drawn even without real pressure.
- 📱 **Mobile-first** — works on iPhone and iPad. Smooth Pointer-Event handling
  with coalesced events, no accidental page scrolling, and optional **palm
  rejection** when using a stylus.
- 🤏 **Pinch to zoom and two-finger pan** to draw at any scale; wheel-zoom on
  desktop, plus a *Fit to screen* button to recenter.
- 📐 **Resizable canvas** — change the page size or aspect ratio from the toolbar
  (square, 4:3, 16:9, A4, or custom). Choose an anchor or scale your drawing to
  the new size, or *Fit to drawing* to wrap the canvas around your strokes.
  Resizing is undoable.
- 🎨 **Theme-aware pen** — starts white on dark themes and black on light themes
  so your strokes are always visible (toggleable in settings).
- 🧰 Pen, highlighter, and eraser; color palette; adjustable brush size with a
  slider, presets, and a live preview; undo/redo; clear.
- 💾 **Re-editable format** — sketches are saved as `.sketch` files (compact JSON
  of strokes). They autosave when you leave or close, and you can save anytime
  with the ✓ button. Reopen any sketch and keep drawing.
- 👁️ **Live inline previews** — create a sketch from a note and the canvas renders
  right inside the note (no image file), staying in sync as you edit. Prefer a
  plain link instead? Flip a toggle in settings.
- 🖼️ **Images on demand** — a PNG is created only when you export. Export asks
  whether to **embed it in a note** or **just save the image** to your vault, so
  you don't accumulate image files you didn't ask for. SVG export is also
  available.

## Usage

- **New standalone sketch:** click the brush ribbon icon, or run the command
  *"Create new sketch"*. It stands on its own as a `.sketch` file.
- **Sketch inside a note:** run *"Create new sketch in current note"*. This
  creates the sketch, inserts a reference to it at your cursor, and opens the
  editor. No image file is made — the sketch itself is shown. By default the note
  gets a **live inline preview** of the canvas (an `![[Sketch …]]` embed rendered
  by the plugin); switch to a plain link in settings (*"Insert sketches into notes
  as"*). Either way the sketch remembers which note it came from. Click an inline
  preview to open the sketch for editing.
- **Edit later:** open the `.sketch` file from the file explorer or its link.
- **Zoom & pan:** pinch with two fingers (or scroll-wheel on desktop). Tap *Fit to
  screen* to recenter the page.
- **Canvas size:** tap the resize button to change the page dimensions or aspect
  ratio (presets or custom), choose an anchor or scale your drawing to fit, or
  *Fit to drawing* to wrap the canvas around your strokes.
- **Save:** sketches autosave when you leave or close. Tap **✓ Save** to write
  immediately. Saving never creates an image — your `.sketch` is the source.
- **Export to an image:** tap the **Export** (download) button. You're asked
  whether to **add it to a note** (embeds `![[…]].png` — defaults to the note the
  sketch came from, otherwise pick one) or **just save the image** to your vault.
  The *"Export current sketch as SVG"* command is also available.

Settings let you choose the sketch folder, default color/brush size, palm
rejection, canvas size, background, and PNG export resolution.

## Installation

### Via BRAT (recommended for now)

Until Tabula Rasa is in the community store, install it with
[BRAT](https://github.com/TfTHacker/obsidian42-brat): add the beta plugin
`JeremiahBeatham/TabulaRasa`, then enable **Tabula Rasa** in
*Settings → Community plugins*. BRAT keeps it updated as new releases ship.

### Manual

1. Build the plugin: `npm install && npm run build`.
2. Copy `manifest.json`, `main.js`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/tabula-rasa/`.
3. Reload Obsidian and enable **Tabula Rasa** in *Settings → Community plugins*.

To use it on iPhone, sync the plugin folder to your mobile vault (e.g. via
Obsidian Sync or a git client) and enable it there.

## Roadmap

Tabula Rasa is an actively evolving MVP. See **[ROADMAP.md](ROADMAP.md)** for the
shipped feature set and what's planned next (canvas resize, richer brush/color
pickers, pinch-to-rotate, eraser modes, a selection tool, and smart shape
snapping).

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production bundle
```

## License

MIT
