#!/usr/bin/env node
// Compares a product's existing token data with a sub-brand's generated tokens.json, value by value
// and mode by mode — the check that a sub-brand reproduces what a product ships today.
//   node brand/scripts/compare.mjs <their tokens.data.json> --subbrand <name> [--all]
// Their file is the HandCAD studio format ({ tokens: [{ key, modeDependent, values }] }), which is
// also the format of brand/dist/<name>/tokens.json. Prints: values that differ, tokens only they have,
// tokens only the sub-brand has (grouped). Exits 1 if any shared semantic value differs.
import fs from 'node:fs';
import path from 'node:path';
import { argSubbrand, repoRoot } from './lib/subbrands.mjs';

const theirsPath = process.argv[2];
const name = argSubbrand();
if (!theirsPath || !name) {
  console.error('Usage: node brand/scripts/compare.mjs <their tokens.data.json> --subbrand <name>');
  process.exit(2);
}
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const theirs = read(path.resolve(theirsPath));
const ours = read(path.join(repoRoot, 'brand/dist', name, 'tokens.json'));
const MODES = ['dark', 'high-contrast-dark', 'light', 'high-contrast-light'];
const norm = (t, mode) => JSON.stringify(t.modeDependent ? t.values[mode] : t.values.all).toUpperCase();

const a = new Map(theirs.tokens.map((t) => [t.key, t]));
const b = new Map(ours.tokens.map((t) => [t.key, t]));
const differ = [];
for (const [key, t] of a) {
  const o = b.get(key);
  if (!o) continue;
  for (const m of MODES) {
    if (norm(t, m) !== norm(o, m)) differ.push(`${key} [${m}]: theirs ${norm(t, m)} · ${name} ${norm(o, m)}`);
  }
}
const group = (keys) => {
  const g = {};
  for (const k of keys) {
    const p = k.split('.');
    const head = p[0] === 'color' || p[0] === 'palette' ? `${p[0]}.${p[1]}` : p[0];
    (g[head] ??= []).push(k);
  }
  return Object.entries(g).map(([h, ks]) => `  ${h} (${ks.length})${process.argv.includes('--all') ? `: ${ks.join(', ')}` : ''}`);
};
const onlyTheirs = [...a.keys()].filter((k) => !b.has(k));
const onlyOurs = [...b.keys()].filter((k) => !a.has(k));
const shared = [...a.keys()].filter((k) => b.has(k));

console.log(`Compared ${shared.length} shared tokens × ${MODES.length} modes (${path.relative(process.cwd(), theirsPath)} vs brand/dist/${name}/tokens.json).`);
console.log(`\nValues that differ: ${differ.length}`);
differ.forEach((d) => console.log(`  ${d}`));
console.log(`\nOnly in theirs: ${onlyTheirs.length}`);
group(onlyTheirs).forEach((l) => console.log(l));
console.log(`\nOnly in ${name} (additions from the core): ${onlyOurs.length}`);
group(onlyOurs).forEach((l) => console.log(l));
process.exit(differ.length ? 1 : 0);
