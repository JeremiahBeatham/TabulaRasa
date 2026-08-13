# TabulaRasa — Phases

> Supersedes `ROADMAP.md`. Phases are intent, not hard commitments, and may reorder based on feedback.

## Current Status
| Phase | Status |
|---|---|
| Shipped (v0.1.x → v0.13.5) | Done — see below |
| Next (UX polish) | Done — #7 and all 5 surface refinements |
| Later (bigger features) | Done — #13 selection, #14 snapping |
| Snapping massage pass | Done — v0.13.3 renders it clean, v0.13.5 settles the corners |
| **Community-plugin submission** | **Next up** |
| Post-MVP | Text tool, images in a sketch, layers — parked below |

**Active branch:** `main`
**Last updated:** 2026-08-12

---

## Shipped (v0.1.x → v0.13.5)
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
- [x] Polygon recognition made robust against real strokes rather than clean synthetic ones: corner
      count is no longer trusted, so squares with corners rounded over 30px and ±8px of wobble snap
      where they previously fell through (v0.13.2)
- [x] Snapped shapes now *draw* as cleanly as they're recognised. The stroke renderer's smoothing was
      re-curving their exact edges — 2.74px of stray on a 200px square, now 0.00px — while corners
      keep a soft shoulder and a snapped crayon keeps its grain (v0.13.3)
- [x] Snapped corners softened and made consistent: each is a true circular fillet sampled by angle,
      and the path now opens mid-edge instead of on a corner. A square's corners went from 100° of
      turn on a single vertex (and 80° of variation between them) to 30° apiece with none. The blob
      where the stroke's ends met is gone, as are the diagonal wedge one corner drew and the notch
      that forked a triangle's apex (v0.13.4)
- [x] Snapped shapes now get their own stroker instead of going through perfect-freehand, because
      v0.13.4's corners were reported as too soft — rounding the centreline makes a corner's outer
      radius `fillet + nib`, so at size 6 it was 17px round and rectangles read as rounded rectangles.
      A nib of constant width is now swept along a hard-cornered centreline: **the outside of a corner
      is an arc of exactly the brush radius and the inside is a clean crossing**, which is what a round
      pen physically does, and it means corner softness scales with the brush. Edges measure 0.000px
      off straight (v0.13.5)

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
  - **Snapped shapes are stroked by their own code**, not by perfect-freehand: a nib of constant
    half-width swept along a hard-cornered centreline, so the outside of a corner is an arc of exactly
    the brush radius and the inside is the plain crossing of the two band edges. That's what a round
    pen does, it keeps a rectangle reading as a rectangle, and the softness scales with the brush.
    Two earlier attempts are recorded because they were both wrong in instructive ways: a hard vertex
    through perfect-freehand drew corners as points, wedges, and once a hole through a triangle's
    apex; rounding the centreline instead fixed those but made corners `fillet + nib` and every
    rectangle looked like a rounded rectangle.

## Post-MVP — parked

Wanted, but deliberately after the community-plugin submission. None of these are started.

- [ ] **Text tool** — type into a sketch rather than drawing letters.
- [ ] **Add an image to a sketch** — bring a vault image or a photo onto the canvas to draw over.
- [ ] **Layers** — separate a sketch into layers that can be hidden, reordered and drawn on
      independently.

## Distribution
- [x] Rebrand to store-compliant id/name (`tabula-rasa` / "Tabula Rasa")
- [x] Add LICENSE, screenshots, final README polish
- [x] Submitted via [community.obsidian.md](https://community.obsidian.md). Obsidian retired the `community-plugins.json`
      PR model — a PR against `obsidianmd/obsidian-releases` no longer works (confirmed: the API itself 404s on PR
      creation there). The new flow signs in with an Obsidian account, connects GitHub, then submits by repo URL,
      and runs its own automated review against the source and the latest release.
- [x] **First automated review (v0.13.5) failed.** Fixed for v0.13.6:
  - `manifest.json`'s `authorUrl` pointed at the plugin's own repo — must be a personal/org profile instead. Now
    points at the GitHub profile.
  - Two deprecated Obsidian API calls: `ButtonComponent.setWarning()` → `.setDestructive()` (the "Clear sketch"
    button), and `SliderComponent.setDynamicTooltip()` removed entirely — the value is unconditionally inline as
    of 1.13.0, so the call was a no-op.
  - An `any`-typed unsafe assignment in `loadSettings()` — `loadData()`'s untrusted return is now asserted as
    `Partial<TabulaRasaSettings> | null` once at that boundary, rather than flowing through as `any`.
  - Release workflow now attests build provenance for `main.js`/`styles.css` (`actions/attest-build-provenance`),
    clearing a recommendation about unverifiable release assets.
  - **Deliberately not done:** the review also flagged that `PluginSettingTab` doesn't implement the new
    declarative `getSettingDefinitions()` API (1.13.0+), so this plugin's settings won't appear in Obsidian's
    global settings *search* on newest versions. `display()` is explicitly still supported as the pre-1.13.0
    fallback, and this plugin supports `minAppVersion: 1.4.0` — converting the whole hand-built settings sheet
    (card-sorted sections, custom vertical slider, colour swatch, popovers) to a declarative schema is a large,
    architecturally significant rewrite that may not even have widgets for some of these. Parked rather than
    rushed; the plugin works fully either way, it just won't show up in that one search box.
  - A `document.createElement` (vs. Obsidian's `createEl`) flag on the PNG-export canvas is correct as written —
    that canvas is never attached to the DOM, so `createEl`'s parent-append behaviour doesn't apply. Left as-is
    with a comment explaining why.
  - Two "Recommendation"-level vault-access disclosures (enumerating markdown files for the "add to note" picker,
    reading note content to embed a PNG) are legitimate, minimal, already-necessary usage — no change needed.
- [x] **Second review (v0.13.6) failed** on two real errors, plus warnings. Fixed for v0.13.7:
  - **Error, `no-static-styles-assignment`:** the disabled tool-row in the tool dropdown set `el.style.opacity`/
    `pointerEvents` directly. Now a `.is-disabled` class picked at creation, matching the existing
    `.tabula-rasa-btn.is-disabled` convention already used for the size/colour buttons.
  - **Error, `no-unsupported-api`:** the `setDestructive()` fix from v0.13.6 was itself a bug — that method is
    1.13.0+, and `minAppVersion` is 1.4.0, so it would throw on every version between the two. Fixed with the same
    runtime-guard pattern `setIconSafe` already uses for icon names: call `setDestructive()` if present, otherwise
    fall back to the deprecated-but-universal `setWarning()`. **Lesson: a deprecation notice doesn't mean the
    replacement is safe to call unconditionally — check it against `minAppVersion` first.**
  - Also deleted two more redundant inline `style.opacity`/`pointerEvents` sets on the size/colour buttons — same
    debugging leftover as the tool-row one, and already fully covered by the `.is-disabled` class one line above
    each via `toggleClass`. Not separately flagged this round, but the same defect.
  - `instanceof HTMLButtonElement` → `.instanceOf(HTMLButtonElement)`, Obsidian's cross-window-safe check.
  - Dropped the `builtin-modules` devDependency — `esbuild.config.mjs` only used it to build the bundler's
    `external` list; Node's own `node:module` `builtinModules` does the identical job with no added package.
  - `npm audit fix` while in there: two unrelated dev-tooling transitive vulnerabilities (brace-expansion,
    js-yaml), both DoS-only and build-time-only. 0 vulnerabilities now.
  - Same two deliberate non-fixes as before (declarative settings API, `document.createElement` in the PNG
    export) — still correct, still flagged because the reviewer doesn't read comments.
  - **Not verified on device:** the tool-row class-based dimming should look identical to the inline-style
    version it replaced, but hasn't been seen on a phone.
- Until published: install via [BRAT](https://github.com/TfTHacker/obsidian42-brat)
