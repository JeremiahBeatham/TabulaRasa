# TabulaRasa — CLAUDE.md

## Project Overview
Obsidian community plugin for finger/Apple Pencil sketching directly inside a vault. Pressure-tapered strokes, live inline previews, re-editable `.sketch` files; images only generated on export.

- **Repo:** `JeremiahBeatham/TabulaRasa` (public)
- **Vault ID:** unassigned — needs a {Project B-###} number
- **Live:** distributed via BRAT; community-plugins submission in progress
- **Hosting:** n/a (Obsidian plugin, bundled with esbuild)
- **Tier:** Product/App

## Dev Constraints
- Mobile-only dev (iPhone) — no terminal, no local preview.
- Plugin is TypeScript, bundled via esbuild; standard Obsidian plugin scaffolding (manifest.json, versions.json).
- Phases/status live in `docs/PHASES.md`, which supersedes the old `ROADMAP.md` (no longer in the repo).

## Working Style (default)
- Short, direct answers. No preamble.
- Trunk-based, one branch at a time, Jeremiah names every branch.
- Commit directly to active branch. No PR unless asked.
- Always update this file first when direction changes.

## Where things live
| Jeremiah says... | File |
|---|---|
| status / phases | `docs/PHASES.md` |
| architecture | `docs/ARCHITECTURE.md` |
| team / branch ownership | `docs/TEAM.md` |
| personas | `docs/PERSONAS.md` |
| product requirements | `docs/PRD.md` |

---

## Reorg Status

**Campaign:** BeathamBase doc standard + light refactor (multi-repo reorg across all 20 repos)
**Status:** Complete and merged. Docs live in `docs/`, routing table above is current, README links fixed.

Root keeps only `README.md`, `CLAUDE.md`, `LICENSE`. Everything else goes in `docs/`.

- `ROADMAP.md` confirmed absent; stale references removed (README points at `docs/PHASES.md`).
- `npm audit` was 1 moderate — `esbuild <=0.24.2` dev-server advisory (GHSA-67mh-4wv8-2f99).
  Resolved by bumping `esbuild` `^0.20.0` → `^0.28.1` (dev-only); now 0 vulnerabilities.
  Shipped as **v0.8.0**.

---

## Current Work

**Issue #7 — toolbar rebuild.** The sketch view's toolbar is now four circular buttons
(brush · size · colour · more), down from 19 controls across 3 rows. Measured 169px → 49px.

Conventions worth knowing before touching this area:

- **The toolbar must never wrap.** If something needs a second row it belongs in the "more" sheet.
- **Visual button size ≠ tap target.** The circle follows the 24/32/40 setting; the hit box stays
  ≥44px. Don't collapse those back together.
- **Colour is the operating system's job.** The button clicks a hidden `<input type="color">`,
  which raises the native iOS Colors sheet. Don't rebuild a palette or recents list.
- **Two-finger gestures are reserved** for pan/zoom/rotate. Undo/redo are three-finger, and are
  also surfaced in the "more" sheet so they remain discoverable.
- **Per-tool stroke feel lives in one table** (`TOOL_STROKE_OPTIONS` in `src/export.ts`) so the
  live canvas and both export paths stay in agreement.

**No published artifacts.** Interactive tools and mockups are deployed by Jeremiah himself; don't
publish work to hosted artifact URLs.
