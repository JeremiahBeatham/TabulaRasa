#!/usr/bin/env node
// Generates every brand output from brand/tokens + brand/subbrands via Style Dictionary.
//   node brand/scripts/build.mjs                        write core + every sub-brand + the site bundle
//   node brand/scripts/build.mjs --subbrand handcad     write one sub-brand (core: --subbrand core)
//   node brand/scripts/build.mjs --check [--subbrand x] exit 1 if any generated file is missing or stale
import fs from 'node:fs';
import path from 'node:path';
import { renderAll } from './lib/render.mjs';
import { repoRoot } from './lib/tokens.mjs';
import { argSubbrand } from './lib/subbrands.mjs';

const check = process.argv.includes('--check');
const only = argSubbrand();
let files;
try {
  files = await renderAll(only);
} catch (err) {
  console.error(`✗ brand build: ${err.message}`);
  process.exit(1);
}

const stale = [];
let wrote = 0;
for (const [rel, contents] of Object.entries(files)) {
  const abs = path.join(repoRoot, rel);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (current === contents) continue;
  if (check) {
    stale.push(rel);
    console.error(`✗ stale       ${rel}`);
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents);
    wrote++;
    console.log(`  wrote       ${rel}`);
  }
}

if (stale.length) {
  console.error('\nGenerated brand files are out of date with brand/tokens or brand/subbrands.');
  console.error('Run `npm run brand:build` and commit the result. Never edit generated files by hand.');
  process.exit(1);
}
console.log(`Build: ${Object.keys(files).length} generated files${only ? ` for ${only}` : ''}, ${check ? 'all fresh' : `${wrote} written, the rest unchanged`}.`);
