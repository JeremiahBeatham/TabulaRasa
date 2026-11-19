#!/usr/bin/env node
// HandCAD mirror (ADR-0005: HandCAD owns its layer): HandCAD is the source of its design system, and
// BeathamBase keeps a verbatim copy of it at a recorded commit in brand/subbrands/handcad/mirror/.
// The copy is data for checks and the brand site; never edit it by hand (re-run this script).
//
//   node brand/scripts/mirror-handcad.mjs --from ../HandCAD [--ref <commit|branch>]   refresh the mirror (default ref origin/main)
//   node brand/scripts/mirror-handcad.mjs --check --from ../HandCAD [--ref <ref>]    exit 1 if HandCAD has moved past the mirror
//   node brand/scripts/mirror-handcad.mjs --check                                     no checkout: report the recorded commit, exit 0
//
// Reads HandCAD with `git archive` / `git rev-parse` only; it never writes to the HandCAD checkout.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mirrorDir = path.join(here, '..', 'subbrands', 'handcad', 'mirror');
const sourceFile = path.join(mirrorDir, 'SOURCE.json');

/** Every HandCAD path the brand site or a check reads. Generated files are mirrored so parity can be checked offline. */
export const MIRRORED = [
  'design/tokens',
  'design/glyphs',
  'design/icon/chosen',
  'design/analysis',
  'design/proposals',
  'design/fonts',
  'design/DECISIONS-2026-10-03.md',
  'docs/adr/0012-design-direction-instrument.md',
  'docs/adr/0016-tactile-controls-and-design-rework.md',
  'ios/HandCADKit/Sources/HandCADDesign/Tokens.swift',
  'studio/src/tokens.css',
  'site/app-tile.svg',
  'site/app-tile-dark.svg',
  'site/favicon.svg',
  'site/apple-touch-icon.png',
  'design/snippets',
  // The studio's generated data (HandCAD studio/scripts) and its hand-kept proposal data, read by the HandCAD system pages.
  'studio/src/tokens.data.json',
  'studio/src/analysis.data.json',
  'studio/src/ramps.data.json',
  'studio/src/palettes.data.json',
  'studio/src/proposals.data.json',
  'studio/src/glyphs.js',
  'studio/src/help.js',
];

/**
 * The app screenshots the Pages specs compare against: every `shot: '<pass>/<name>'` in pageEntries.jsx, plus the dark
 * C2 screens matching each page's `later` prefixes. A subset of docs/screenshots (all of it is ~140 MB).
 */
function screenshotFiles(dir, commit) {
  const src = git(dir, 'show', `${commit}:studio/src/routes/pageEntries.jsx`);
  const shots = new Set([...src.matchAll(/shot: '([^']+)'/g)].map((m) => `docs/screenshots/${m[1]}.png`));
  const later = [...src.matchAll(/later: \[([^\]]*)\]/g)].flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const c2 = git(dir, 'ls-tree', '--name-only', `${commit}:docs/screenshots/c2`).split('\n');
  c2.filter((f) => f.endsWith('-dark.png') && later.some((p) => f.startsWith(p))).forEach((f) => shots.add(`docs/screenshots/c2/${f}`));
  return [...shots].filter((f) => objectId(dir, commit, f)).sort();
}

const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};
const checkOnly = process.argv.includes('--check');
const from = arg('--from') ?? process.env.HANDCAD_DIR ?? null;

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const objectId = (dir, ref, p) => {
  try {
    return git(dir, 'rev-parse', `${ref}:${p}`);
  } catch {
    return null;
  }
};
const resolveRef = (dir, ref) => {
  if (ref) return ref;
  try {
    git(dir, 'rev-parse', '--verify', 'origin/main');
    return 'origin/main';
  } catch {
    return 'HEAD';
  }
};
const readSource = () => (fs.existsSync(sourceFile) ? JSON.parse(fs.readFileSync(sourceFile, 'utf8')) : null);

if (checkOnly) {
  const src = readSource();
  if (!src) {
    console.error('✗ HandCAD mirror missing: run node brand/scripts/mirror-handcad.mjs --from <HandCAD checkout>.');
    process.exit(1);
  }
  if (!from) {
    console.log(`  Mirror   handcad         HandCAD ${src.commit.slice(0, 7)} (${src.date}); no HandCAD checkout given, drift not checked (pass --from or HANDCAD_DIR).`);
    process.exit(0);
  }
  const ref = resolveRef(from, arg('--ref'));
  const head = git(from, 'rev-parse', ref);
  const drift = Object.entries(src.paths).filter(([p, id]) => objectId(from, ref, p) !== id).map(([p]) => p);
  const shots = screenshotFiles(from, ref);
  if (JSON.stringify(shots.map((f) => [f, objectId(from, ref, f)])) !== JSON.stringify(Object.entries(src.screenshots ?? {}))) drift.push('docs/screenshots (referenced subset)');
  if (drift.length) {
    console.error(`✗ Mirror   handcad         HandCAD ${ref} (${head.slice(0, 7)}) has moved past the mirror (${src.commit.slice(0, 7)}): ${drift.join(', ')}.`);
    console.error(`  Refresh: node brand/scripts/mirror-handcad.mjs --from ${from} --ref ${ref}`);
    process.exit(1);
  }
  console.log(`  Mirror   handcad         current with HandCAD ${ref} (${head.slice(0, 7)}); recorded ${src.commit.slice(0, 7)}.`);
  process.exit(0);
}

if (!from) {
  console.error('Usage: node brand/scripts/mirror-handcad.mjs --from <HandCAD checkout> [--ref <ref>] [--check]');
  process.exit(2);
}
const ref = resolveRef(from, arg('--ref'));
const commit = git(from, 'rev-parse', ref);
const date = git(from, 'show', '-s', '--format=%cs', commit);
const missing = MIRRORED.filter((p) => !objectId(from, commit, p));
if (missing.length) {
  console.error(`✗ Not in HandCAD ${commit.slice(0, 7)}: ${missing.join(', ')}`);
  process.exit(1);
}

const shots = screenshotFiles(from, commit);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handcad-mirror-'));
const tar = path.join(tmp, 'mirror.tar');
execFileSync('git', ['-C', from, 'archive', '--format=tar', '-o', tar, commit, ...MIRRORED, ...shots]);
fs.rmSync(mirrorDir, { recursive: true, force: true });
fs.mkdirSync(mirrorDir, { recursive: true });
execFileSync('tar', ['-xf', tar, '-C', mirrorDir]);
fs.rmSync(tmp, { recursive: true, force: true });

const source = {
  $description: 'Verbatim mirror of HandCAD design-system sources (HandCAD owns this layer, ADR-0005). Never edit; refresh with node brand/scripts/mirror-handcad.mjs.',
  repo: 'JeremiahBeatham/HandCAD',
  ref,
  commit,
  date,
  paths: Object.fromEntries(MIRRORED.map((p) => [p, objectId(from, commit, p)])),
  screenshots: Object.fromEntries(shots.map((f) => [f, objectId(from, commit, f)])),
};
fs.writeFileSync(sourceFile, `${JSON.stringify(source, null, 2)}\n`);
console.log(`Mirrored ${MIRRORED.length} HandCAD paths and ${shots.length} screenshots at ${commit.slice(0, 7)} (${date}) into brand/subbrands/handcad/mirror/.`);
