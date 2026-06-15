# ObsidianBoard

Finger- and Apple Pencil-friendly sketching for [Obsidian](https://obsidian.md).
Draw the way you do in the native iOS Notes app — directly in your vault — then
embed sketches in notes or keep them as standalone, re-editable files.

## Features

- ✏️ **Natural drawing** with pressure-tapered strokes (perfect-freehand) using
  finger, Apple Pencil, mouse, or any stylus. Finger and mouse strokes taper from
  drawing speed, so lines look hand-drawn even without real pressure.
- 📱 **Mobile-first** — works on iPhone and iPad. Smooth Pointer-Event handling
  with coalesced events, no accidental page scrolling, and optional **palm
  rejection** when using a stylus.
- 🤏 **Pinch to zoom and two-finger pan** to draw at any scale; wheel-zoom on
  desktop, plus a *Fit to screen* button to recenter.
- 🎨 **Theme-aware pen** — starts white on dark themes and black on light themes
  so your strokes are always visible (toggleable in settings).
- 🧰 Pen, highlighter, and eraser; color palette; multiple brush sizes; undo/redo;
  clear.
- 💾 **Re-editable format** — sketches are saved as `.sketch` files (compact JSON
  of strokes). Reopen any sketch and keep drawing.
- 🖼️ **Embed anywhere** — a matching PNG is auto-exported next to each sketch and
  embedded with a standard `![[…]]` link, so it renders in reading view, search,
  and exports. SVG export is also available.

## Usage

- **New standalone sketch:** click the pencil ribbon icon, or run the command
  *"Create new sketch"*.
- **Embed in the current note:** run *"Create new sketch and embed in current
  note"*. This creates the sketch, inserts `![[Sketch ….png]]` at your cursor, and
  opens the editor.
- **Edit later:** open the `.sketch` file from the file explorer.
- **Zoom & pan:** pinch with two fingers (or scroll-wheel on desktop). Tap *Fit to
  screen* to recenter the page.
- **Save:** the embedded PNG refreshes automatically as you draw and on close. Tap
  the **✓ Save** button to write immediately and get a confirmation showing the
  separate image file that's embedded. The `.sketch` file always stays editable.
- **Export:** use the toolbar *Export PNG* button or the *"Export current sketch as
  SVG"* command for a one-off export.

Settings let you choose the sketch folder, default color/brush size, palm
rejection, canvas size, background, and PNG export resolution.

## Installation (manual / before community-store listing)

1. Build the plugin: `npm install && npm run build`.
2. Copy `manifest.json`, `main.js`, and `styles.css` into
   `<your-vault>/.obsidian/plugins/obsidianboard/`.
3. Reload Obsidian and enable **ObsidianBoard** in *Settings → Community plugins*.

To develop on iPhone, sync the plugin folder to your mobile vault (e.g. via
Obsidian Sync or a git client) and enable it there.

## Development

```bash
npm install
npm run dev     # watch build
npm run build   # type-check + production bundle
```

## License

MIT
