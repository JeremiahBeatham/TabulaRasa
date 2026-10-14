#!/usr/bin/env node
// The hue budget and the accent rule (brand/rules.json), for core and every sub-brand: every
// semantic colour in every mode may only draw on the ramps its role is allowed (core table plus
// the sub-brand's grants, each with a scope and a reason); chrome hues stay within budget; the
// accent ramp marks only what you act on; gold, brown and palettes never fill a role.
//   node brand/scripts/check-roles.mjs [--subbrand <name>]
import { selectSubbrands, argSubbrand } from './lib/subbrands.mjs';
import { evaluateRoles } from './lib/roles.mjs';

let failed = false;
for (const sb of selectSubbrands(argSubbrand())) {
  const r = evaluateRoles(sb);
  r.problems.forEach((p) => console.error(`✗ ${p}`));
  const scoped = Object.entries(r.scopedHues).map(([s, h]) => `${s}: ${h.join(', ')}`).join(' · ');
  console.log(
    `${r.problems.length ? '✗' : ' '} Roles    ${sb.name.padEnd(15)} ${String(r.checked).padStart(4)} values · accent ${r.accent} · chrome hues ${r.chromeHues.length}/${r.budget} (${r.chromeHues.join(', ') || 'none'})${scoped ? ` · scoped ${scoped}` : ''}`,
  );
  if (r.problems.length) failed = true;
}
process.exit(failed ? 1 : 0);
