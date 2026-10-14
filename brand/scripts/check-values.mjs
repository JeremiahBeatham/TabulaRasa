#!/usr/bin/env node
// Tokens are the only source of visual values. Fails if hand-written source in the template
// starter (src/) or the guidelines site (brand/site/src/) hard-codes a colour, a px length, a font
// stack or a shadow instead of a --bt-* custom property. rem/em/%/ch/vw/fr are allowed for page
// layout; px only inside @media queries; a line marked `allow-literal` is skipped (say why).
// Generated files are exempt.
//   node brand/scripts/check-values.mjs [dir …]
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib/subbrands.mjs';

const dirs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const roots = (dirs.length ? dirs : ['src', 'brand/site/src']).map((d) => path.resolve(repoRoot, d)).filter((d) => fs.existsSync(d));
const rules = [
  [/#[0-9a-fA-F]{3,8}\b(?![-\w])/, 'hex colour'],
  [/\b(rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/, 'colour function'],
  [/(?<![\w-])\d*\.?\d+px\b/, 'px length'],
  [/font-family\s*:(?!\s*(var\(|inherit))/, 'font stack'],
  [/fontFamily\s*:\s*['"](?!var\()/, 'font stack'],
  [/box-shadow\s*:(?![^;]*var\()(?!\s*none)/, 'shadow'],
];

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'generated' && e.name !== 'node_modules') walk(p);
    } else if (/\.(css|jsx?|tsx?|html)$/.test(e.name)) files.push(p);
  }
};
roots.forEach(walk);

const problems = [];
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*@media/.test(line) || /allow-literal/.test(line)) return;
    const code = line.replace(/\/\/.*$|\/\*.*?\*\//g, '');
    for (const [re, what] of rules) {
      if (re.test(code)) problems.push(`${path.relative(repoRoot, file)}:${i + 1}  ${what}: ${line.trim()}`);
    }
  });
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n✗ ${problems.length} hard-coded visual value(s). Use a --bt-* token (brand/tokens) instead.`);
  process.exit(1);
}
console.log(`  Values   ${files.length} source files in ${roots.map((r) => path.relative(repoRoot, r)).join(', ')} use tokens only.`);
