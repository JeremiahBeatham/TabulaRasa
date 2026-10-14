// Sub-brand discovery. A sub-brand is a folder brand/subbrands/<name>/ with a subbrand.json
// manifest; the core is the implicit sub-brand "core" (brand/core.json, no layers of its own).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const brandDir = path.join(repoRoot, 'brand');
export const subbrandsDir = path.join(brandDir, 'subbrands');

const readJson = (abs) => {
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (err) {
    throw new Error(`${path.relative(repoRoot, abs)}: ${err.message}`);
  }
};

const REQUIRED = ['name', 'label', 'status', 'thesis', 'platforms', 'palettes', 'proportion', 'do', 'dont'];
const IDENTITY_SLOTS = ['wordmark', 'icon', 'logo', 'rules'];
const STATUSES = ['core', 'locked', 'proposal'];
const PLATFORMS = ['web', 'ios', 'macos', 'watchos', 'print'];

function validate(m, where) {
  const missing = REQUIRED.filter((k) => m[k] === undefined);
  if (missing.length) throw new Error(`${where}: missing ${missing.join(', ')}`);
  if (!STATUSES.includes(m.status)) throw new Error(`${where}: status must be one of ${STATUSES.join(', ')}`);
  const unknown = m.platforms.filter((p) => !PLATFORMS.includes(p));
  if (unknown.length) throw new Error(`${where}: unknown platform ${unknown.join(', ')} (use ${PLATFORMS.join(', ')})`);
  for (const system of [m.proportion, ...(m.proportion.alternates ?? [])]) {
    const sum = system.parts.reduce((s, p) => s + p.pct, 0);
    if (sum !== 100) throw new Error(`${where}: proportion "${system.name}" sums to ${sum}, not 100`);
  }
  for (const slot of IDENTITY_SLOTS) {
    if (!m.identity?.[slot]?.status) throw new Error(`${where}: identity.${slot} needs a status (not-defined, provisional or defined)`);
  }
  for (const prof of m.profiles ?? []) {
    for (const k of ['name', 'label', 'summary', 'display', 'colours']) if (prof[k] === undefined) throw new Error(`${where}: profile "${prof.name ?? '?'}" is missing ${k}`);
    if (prof.display.levels && prof.colours.length !== prof.display.levels) throw new Error(`${where}: profile "${prof.name}" declares ${prof.display.levels} levels but lists ${prof.colours.length} colours`);
    for (const c of prof.colours) if (!/^#[0-9a-fA-F]{6}$/.test(c.hex)) throw new Error(`${where}: profile "${prof.name}" colour "${c.name}" needs a #RRGGBB hex`);
  }
  if (m.status === 'proposal' && !(m.openQuestions?.length > 0)) {
    throw new Error(`${where}: a proposal sub-brand must list openQuestions for Jeremiah`);
  }
  return m;
}

/** The core, as a sub-brand with no layers. */
export function coreSubbrand() {
  const abs = path.join(brandDir, 'core.json');
  const manifest = validate(readJson(abs), 'brand/core.json');
  return { name: 'core', dir: brandDir, manifest, isCore: true };
}

/** Every sub-brand folder with a manifest, sorted by name (core not included). */
export function listSubbrands() {
  if (!fs.existsSync(subbrandsDir)) return [];
  return fs
    .readdirSync(subbrandsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(subbrandsDir, e.name, 'subbrand.json')))
    .map((e) => {
      const dir = path.join(subbrandsDir, e.name);
      const where = `brand/subbrands/${e.name}/subbrand.json`;
      const manifest = validate(readJson(path.join(dir, 'subbrand.json')), where);
      if (manifest.name !== e.name) throw new Error(`${where}: name "${manifest.name}" must match its folder "${e.name}"`);
      return { name: e.name, dir, manifest, isCore: false };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Core first, then every sub-brand; or just the one named (core included as "core"). */
export function selectSubbrands(only) {
  const all = [coreSubbrand(), ...listSubbrands()];
  if (!only) return all;
  const hit = all.filter((s) => s.name === only);
  if (!hit.length) throw new Error(`No sub-brand "${only}". Known: ${all.map((s) => s.name).join(', ')}`);
  return hit;
}

/** Reads one of a sub-brand's layers (path relative to its folder). */
export function readSubbrandLayer(sb, rel) {
  return readJson(path.join(sb.dir, rel));
}

/** The 9-step colour ramps (color.<name>.10…90, literal hex) a sub-brand defines in its own layers. */
export function subbrandColourRamps(sb) {
  const out = [];
  for (const rel of sb.manifest.layers ?? []) {
    const layer = readSubbrandLayer(sb, rel);
    for (const [name, group] of Object.entries(layer.color ?? {})) {
      if (name.startsWith('$') || !group || typeof group !== 'object') continue;
      const steps = Object.keys(group).filter((k) => /^\d0$/.test(k));
      if (steps.length < 9) continue;
      const values = Object.fromEntries(steps.map((s) => [s, group[s].$value]));
      if (Object.values(values).every((v) => typeof v === 'string' && v.startsWith('#'))) out.push([name, values]);
    }
  }
  return out;
}

/** Parses `--subbrand <name>` (or `--subbrand=<name>`) from argv. */
export function argSubbrand(argv = process.argv) {
  const eq = argv.find((a) => a.startsWith('--subbrand='));
  if (eq) return eq.split('=')[1];
  const i = argv.indexOf('--subbrand');
  return i >= 0 ? argv[i + 1] : null;
}
