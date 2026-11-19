#!/usr/bin/env node
// HandCAD value parity (HandCAD owns its layer, ADR-0005): every token HandCAD generates must exist in
// BeathamBase's handcad output with the identical value, in Swift and in CSS. Compares the mirrored
// HandCAD files (brand/subbrands/handcad/mirror/, see mirror-handcad.mjs) with brand/dist/handcad/.
// Runs offline. BeathamBase may emit extra core tokens; those are listed, not failed (byte-identical
// output is not required: HandCAD builds its own, ADR-0005).
//   node brand/scripts/check-handcad-parity.mjs [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const brand = path.join(here, '..');
const mirror = path.join(brand, 'subbrands', 'handcad', 'mirror');
const files = {
  swift: [path.join(mirror, 'ios/HandCADKit/Sources/HandCADDesign/Tokens.swift'), path.join(brand, 'dist/handcad/Tokens.swift')],
  css: [path.join(mirror, 'studio/src/tokens.css'), path.join(brand, 'dist/handcad/tokens.css')],
};
const verbose = process.argv.includes('--verbose');

/** Swift: `<enum path>.<name>` → declaration right-hand side, for every `public static let`. */
function swiftDecls(text) {
  const out = new Map();
  const stack = [];
  for (const line of text.split('\n')) {
    const indent = line.match(/^ */)[0].length;
    while (stack.length && stack.at(-1).indent >= indent && /\S/.test(line)) stack.pop();
    const e = line.match(/^ *public (?:enum|struct|extension) ([A-Za-z0-9_.]+)/);
    if (e) {
      stack.push({ indent, name: e[1] });
      continue;
    }
    const d = line.match(/^ *public static let ([A-Za-z0-9_]+)(?:: [^=]+)? = (.*)$/);
    if (d) out.set([...stack.map((s) => s.name), d[1]].join('.'), d[2].trim());
  }
  return out;
}

/** CSS: `<selector chain> | --var` → value, for every custom property. */
function cssDecls(text) {
  const out = new Map();
  const stack = [];
  for (const raw of text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')) {
    const line = raw.trim();
    if (line.endsWith('{')) stack.push(line.slice(0, -1).trim());
    else if (line === '}') stack.pop();
    else {
      const m = line.match(/^(--[a-z0-9-]+)\s*:\s*(.*?);?$/);
      if (m) out.set(`${stack.join(' ')} | ${m[1]}`, m[2].trim());
    }
  }
  return out;
}

if (!fs.existsSync(path.join(mirror, 'SOURCE.json'))) {
  console.error('✗ Parity   handcad         no HandCAD mirror (brand/subbrands/handcad/mirror/SOURCE.json); run mirror-handcad.mjs.');
  process.exit(1);
}
const commit = JSON.parse(fs.readFileSync(path.join(mirror, 'SOURCE.json'), 'utf8')).commit.slice(0, 7);
let failed = false;
for (const [kind, [theirs, ours]] of Object.entries(files)) {
  const parse = kind === 'swift' ? swiftDecls : cssDecls;
  const a = parse(fs.readFileSync(theirs, 'utf8'));
  const b = parse(fs.readFileSync(ours, 'utf8'));
  const missing = [...a.keys()].filter((k) => !b.has(k));
  const differ = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k));
  const extra = [...b.keys()].filter((k) => !a.has(k));
  const bad = missing.length + differ.length;
  missing.forEach((k) => console.error(`✗ ${kind}: missing ${k} (HandCAD: ${a.get(k)})`));
  differ.forEach((k) => console.error(`✗ ${kind}: ${k} is ${b.get(k)}; HandCAD has ${a.get(k)}`));
  if (verbose) extra.forEach((k) => console.log(`  ${kind}: extra core ${k}`));
  console.log(
    `${bad ? '✗' : ' '} Parity   handcad         ${kind.padEnd(5)} ${a.size} HandCAD values (${commit}): ${bad ? `${missing.length} missing, ${differ.length} different` : 'all present and identical'} · ${extra.length} extra core`,
  );
  if (bad) failed = true;
}
process.exit(failed ? 1 : 0);
