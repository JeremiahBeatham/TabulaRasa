# TabulaRasa — Phases

> Supersedes `ROADMAP.md`. Phases are intent, not hard commitments, and may reorder based on feedback.

## Current Status
| Phase | Status |
|---|---|
| Shipped (v0.1.x → v0.13.1) | Done — see below |
| Next (UX polish) | Done — #7 and all 5 surface refinements |
| Later (bigger features) | Done — #13 selection, #14 snapping |
| Distribution | Rebrand done; community-store submission pending |

**Active branch:** `main`
**Last updated:** 2026-08-11

---

## Shipped (v0.1.x → v0.13.1)
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
- [x] Toolbar moved into Obsidian's view header; gestures remapped to two-finger double-tap undo /
      three-finger double-tap redo; rename from the "more" sheet (v0.10.0)
- [x] Fixes from device testing: multi-finger taps were misread as drags (the centroid shifts when a
      finger joins), redo was cleared on every finger-down, the colour input is now a real visible
      input, and the bar reads brush → size → colour → settings (v0.10.1)
- [x] Colour swatch clipped to a true circle at button size; gesture tolerances eased by ~a third so
      double-taps don't demand perfect stillness; new sketches default to a portrait canvas the size
      of the screen (v0.10.2)
- [x] Black-on-black canvas with a hairline edge and 4px corners; tool list cut to pen / crayon /
      marker / eraser as an icon stack under the trigger; crayon replaces the brush with a textured,
      heavier stroke; size dropdown gets a **vertical** slider (a horizontal one was read as
      Obsidian's back-swipe); settings-sheet headings gain icons; rename auto-saves (v0.10.3)
- [x] Dropdown polish: option rows lose their fills so a panel no longer contains a grid of boxes,
      icon columns align to their trigger, and the native vertical slider is replaced by a
      hand-built one after it rendered as a grey block in Obsidian's webview (v0.10.4)
- [x] Settings regrouped from a card sort: sheet becomes Sketch / Canvas / Export, tab becomes
      General / Toolbar / Gestures / Drawing. Canvas resize and PNG-destination dialogs flattened
      into the sheet; palm rejection moved there too (v0.11.0)
- [x] **Fix:** restored the canvas sizing and `touch-action` rules dropped by an over-broad CSS
      deletion in v0.10.4 — without them the canvas collapsed to 300×150 and dragging scrolled the
      page instead of drawing. Canvas section trimmed to six controls; Export reduced to Add to note
      and Share (system share sheet, PNG or SVG) (v0.11.1)
- [x] Size presets flipped to largest-first so the column runs the same direction as the slider
      beside it; the name field waits for typing to stop and no longer toasts on every rename; the
      crayon's grain is seeded by position rather than vertex index, which stops the stroke edge
      shimmering as you draw (v0.11.2)
- [x] Selection tool: freehand boundary that closes itself, a bounding box with scale and rotate
      handles, and — after three attempts at a bottom bar never rendered on device — its controls in
      the toolbar's own size and colour slots, with copy/cut/paste/delete on a long press
      ([#13](https://github.com/JeremiahBeatham/TabulaRasa/issues/13), v0.12.0 → v0.12.4)
- [x] Hold-to-snap shape recognition: hold still at the end of a stroke and a rough line or circle
      becomes a clean one; anything else is left alone
      ([#14](https://github.com/JeremiahBeatham/TabulaRasa/issues/14), v0.13.0)
- [x] Snapping extended to rectangles and triangles, fitted as an oriented box so a tilted one keeps
      its tilt. Roundness tightened at the same time — a pentagon used to pass as a circle (v0.13.1)

## Next — UX Polish
- [x] [#7 — Which controls belong in settings vs. on the canvas](https://github.com/JeremiahBeatham/TabulaRasa/issues/7)
  - **Audit.** The old toolbar carried 19 controls in 4 groups. Because `.tabula-rasa-group` has no
    inner `flex-wrap`, groups wrap whole, so at 375px it measured **3 rows / 169px — 26% of the
    screen** before a stroke was drawn, and stayed 3 rows at 390px and 430px too.
  - **Rebuilt to four buttons** — brush, size, colour, settings. As a bar of its own that measured
    1 row / 49px against the old 169px; it then moved into Obsidian's view header, so the sketch now
    adds **no vertical chrome at all**. The bar never wraps by design.
  - Tools moved into a list behind the brush button: pen, **brush (new)**, highlighter/marker, and
    the two erasers (objects / pixels) promoted from a hidden re-tap to first-class entries.
  - Colour now opens the **native iOS Colors sheet** via `<input type="color">`; the 7-swatch
    palette and the in-plugin recents list are gone, since the system picker already provides both.
  - Undo/redo became **double-tap gestures** — two fingers to undo, three to redo — recognised by
    the fingers neither travelling nor changing spread, so they collide with neither two-finger pan
    nor pinch-zoom. Also listed in the settings sheet so they stay discoverable. The explicit Save
    button was dropped — autosave already covered it.
  - The four buttons live in **Obsidian's own view header**, seated left of its "..." menu and
    reading brush → size → colour → settings. The filename is hidden to make room and is renameable
    from the settings sheet.
  - Both audit gaps closed: **canvas colour** is now editable per sketch in the settings sheet, and
    eraser mode has a real home in the tool list.
  - Toolbar button size is a setting (24 / 32 / 40, default 32); the tap target stays ≥44px at all
    three so the smallest option is still usable.

## Next — Refine each surface

Now the bar is settled, each menu gets dissected on its own rather than designed in
one pass. Deliberately separate items so each can be looked at, argued about and
reworked in isolation.

- [x] **Tool dropdown** — settled at four drawing entries (pen, crayon, marker, eraser) as a
      left-aligned icon stack under the trigger, no description text. The pixel eraser was cut rather
      than kept as a second entry; size and colour stay their own buttons. Selection joined the list
      as a fifth entry in v0.12.0.
- [x] **Size dropdown** — presets stack under the button running largest to smallest, a vertical
      slider beside them (horizontal is Obsidian's back-swipe), and the px readout below taps into
      a text field. No live stroke preview: the presets' dots already show scale.
- [x] **Colour flow** — nothing belongs around the system sheet. No pinned colours, no recents:
      iOS Colors already has both, and duplicating them was what made the old bar wrap.
- [x] **Settings sheet** and **plugin settings tab** — regrouped from a card sort rather than from
      how the code was organised. The sheet is Sketch / Canvas / Export; the tab is General /
      Toolbar / Gestures / Drawing. Two dialogs were flattened away in the process (canvas resize
      and the PNG destination prompt), and palm rejection moved to the sheet, where you reach for it
      mid-drawing. Tool: [`docs/tools/settings-card-sort.html`](tools/settings-card-sort.html).

## Later — Bigger Features
- [x] [#13 — Selection tool](https://github.com/JeremiahBeatham/TabulaRasa/issues/13) (v0.12.0)
  - A fifth tool after the eraser, drawing a boundary rather than ink — so neither size nor colour
    applies, and both controls dim while it's active.
  - The boundary is freehand and dashed as you draw. It's **always closed**: lifting your finger
    snaps the shape shut instead of requiring you to meet your own starting point. A stroke is caught
    when at least half of it falls inside, which is the rule that survives both long strokes and
    lassoing *around* something.
  - The boundary is then replaced by an axis-aligned box with eight scale dots and a rotate handle
    above it. Handles are drawn and hit-tested in screen space, so they're a constant size at any
    zoom, and the box follows the page's rotation.
  - **No bar of its own.** While a selection is live the toolbar's size slot becomes selection mode
    (Replace / Add / Remove, with the button showing which is armed) and the colour slot becomes
    transform (flip horizontal, flip vertical, rotate 90°) — neither size nor colour applies to this
    tool anyway. Copy, cut, paste and delete are on a long press; a long press away from the
    selection offers paste alone, so a copy always has somewhere to land. Tapping away deselects.
    The clipboard lives on the plugin, so a copy can cross sketches.
    Three attempts at a floating bar along the bottom never rendered on device and couldn't be
    diagnosed without a console; the header buttons visibly work, so the controls moved there.
  - Dragging inside the box moves the selection; one drag is one undo step, and a drag that ends
    where it began leaves no undo entry at all.
- [x] [#14 — Smart snapping / shape recognition](https://github.com/JeremiahBeatham/TabulaRasa/issues/14) (v0.13.0)
  - **Hold to snap**, not automatic: pause at the end of a stroke without lifting and a rough line or
    circle becomes a clean one. Chosen over recognising every stroke because a drawing that reshapes
    itself as you lift is startling, and it makes every stroke a gamble.
  - Line, ellipse, rectangle and triangle. Five or more corners, a trapezoid, a bowed edge or a
    scribble come out unchanged — guessing wrong costs the user their drawing, while a missed snap
    costs one more try.
  - Rectangles are fitted as an oriented box, so a diamond becomes a square turned 45°; anything
    within 4° of level is snapped level. Triangles keep the corners you drew rather than being
    regularised.
  - Snapped shapes keep even width (`simulatePressure` off): velocity taper is what makes a freehand
    line lively and a snapped one lumpy.
  - Recognition is DOM-free in `src/shapes.ts`, so the judgement calls are testable.
  - Setting: **Hold to snap shapes** under Drawing, on by default.

## Distribution
- [x] Rebrand to store-compliant id/name (`tabula-rasa` / "Tabula Rasa")
- [ ] Add LICENSE, screenshots, final README polish
- [ ] Submit to the [Obsidian community plugins list](https://github.com/obsidianmd/obsidian-releases) (entry in `community-plugins.json` + PR)
- Until then: install via [BRAT](https://github.com/TfTHacker/obsidian42-brat)
