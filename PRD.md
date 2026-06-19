# TabulaRasa — PRD

## Problem Statement
Obsidian has no native, natural-feeling way to sketch with a finger or Apple Pencil. Existing options break the vault model (external image files, no re-editability) or feel like a drawing app bolted onto a notes tool.

## Goals
- Native-Notes-app-quality sketching inside Obsidian
- Sketches stay re-editable (vector, not raster) and live in the vault as first-class files
- Works well on mobile (iPhone/iPad), not just desktop

## Non-Goals
- Not a full illustration/design tool — no layers, no advanced vector editing
- Not replacing Excalidraw-style diagramming; this is freehand sketching

## Users
See `PERSONAS.md`.

| Persona | Primary Need |
|---|---|
| Obsidian mobile user | Native-feeling sketching without leaving the vault |
| Apple Pencil user | Natural, pressure-tapered ink |
| Vault purist | Re-editable vector sketches, not a pile of PNGs |

## User Stories
- As an Obsidian user, I want to sketch directly in a note so I don't have to switch apps.
- As a Pencil user, I want pressure-sensitive strokes so my sketches feel natural.
- As a vault purist, I want sketches stored as re-editable files, not flattened images.

## Success Metrics
| Metric | Target |
|---|---|
| Community plugin store acceptance | Approved |
| Crash-free sketching sessions | No data loss on autosave |
