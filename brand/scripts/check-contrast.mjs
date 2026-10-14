#!/usr/bin/env node
// WCAG contrast for every semantic colour pair (brand/contrast-pairs.json + each sub-brand's own),
// in every mode, for core and every sub-brand. Also fails if a semantic colour is neither paired nor
// exempt with a reason.
//   node brand/scripts/check-contrast.mjs [--subbrand <name>] [--verbose]
import { config, resolveSelected, brandDir } from './lib/tokens.mjs';
import { evaluateContrast, loadPairSpec } from './lib/contrast.mjs';
import { argSubbrand } from './lib/subbrands.mjs';

const verbose = process.argv.includes('--verbose');
let failed = false;
for (const resolved of await resolveSelected(argSubbrand())) {
  const name = resolved.sb.name;
  const { rows, failures, lowest, uncovered } = evaluateContrast(resolved, loadPairSpec(brandDir, resolved.sb), config.coreRamps);
  for (const r of verbose ? rows : failures) {
    console.log(`${r.ok ? '  ok ' : '✗ FAIL'} ${name.padEnd(15)} ${r.mode.padEnd(19)} ${r.ratio.toFixed(2).padStart(5)}:1 (min ${r.min}) ${r.fg} on ${r.bg}`);
  }
  const worst = Object.values(lowest).sort((a, b) => a.ratio / a.min - b.ratio / b.min)[0];
  console.log(
    `${failures.length || uncovered.length ? '✗' : ' '} Contrast ${name.padEnd(15)} ${String(rows.length).padStart(4)} checks, ${failures.length} failing · tightest ${worst.ratio.toFixed(2)}:1 (min ${worst.min}) ${worst.fg} on ${worst.bg} [${worst.mode}]`,
  );
  if (uncovered.length) console.log(`✗ ${name}: semantic colours with no contrast pair and no exemption: ${uncovered.join(', ')}`);
  if (failures.length || uncovered.length) failed = true;
}
process.exit(failed ? 1 : 0);
