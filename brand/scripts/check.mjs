#!/usr/bin/env node
// Every brand check, for core and every sub-brand (or one). Exit 1 if any fails.
//   npm run brand:check                      everything
//   npm run brand:check -- --subbrand <name> one sub-brand (plus the values lint)
//
//   palettes   generated ramps are fresh; every sub-brand ramp is lightness-matched (step-gap rule)
//   build      every generated file is byte-identical to a fresh render (never hand-edited)
//   contrast   every pair passes WCAG AA (7:1 / 4.5:1 in high contrast); every colour paired or exempt
//   roles      hue budget, accent rule, grants; gold, brown and palettes never fill a role
//   projects   brand/projects.json lists every project and every sub-brand once
//   values     hand-written source uses tokens, never literal colours, px, font stacks or shadows
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argSubbrand } from './lib/subbrands.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const only = argSubbrand();
const sub = only ? ['--subbrand', only] : [];
const steps = [
  ['palettes', ['palettes.mjs', '--check', ...sub]],
  ['build', ['build.mjs', '--check', ...sub]],
  ['contrast', ['check-contrast.mjs', ...sub]],
  ['roles', ['check-roles.mjs', ...sub]],
  ...(fs.existsSync(path.join(here, '..', 'projects.json')) ? [['projects', ['check-projects.mjs']]] : []), // BeathamBase only: a pruned project copy has no projects.json
  ['values', ['check-values.mjs']],
];
const failed = [];
for (const [name, [script, ...args]] of steps) {
  console.log(`\n▸ ${name}`);
  const r = spawnSync(process.execPath, [path.join(here, script), ...args], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(name);
}
console.log(failed.length ? `\n✗ brand:check failed: ${failed.join(', ')}` : `\n✓ brand:check passed${only ? ` for ${only}` : ' for core and every sub-brand'}.`);
process.exit(failed.length ? 1 : 0);
