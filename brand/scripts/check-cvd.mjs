#!/usr/bin/env node
// Color-blind safety, for every sub-brand whose manifest declares a `cvd` block (ported from HandCAD's studio check,
// Pop P5). WCAG contrast cannot say whether a ramp survives protanopia, deuteranopia or tritanopia, or a grayscale
// screen; this does, from the generated tokens (brand/dist/<name>/tokens.json):
//   ramps   kind "diverging" | "sequential": neighbors stay apart (ΔE OKLab ≥ adjacent) in every vision; a diverging
//           ramp's two sides stay apart (neg-k vs pos-k ≥ polarity); lightness is monotonic (rises, or rises to the
//           center and falls away), on the stops and on the ramp as drawn (OKLab interpolation, lutSlack)
//   levels  label-backed steps (e.g. G0–G3): neighbors ≥ adjacent and lightness moving one way, in each listed mode
//   pairs   two colors that must stay apart (≥ min) in each listed mode
//   backed  pairs color alone may not separate: reported with the non-color channel that carries them, never failed
// Simulation: Machado et al. 2009, severity 1.0; distance: OKLab ΔE (brand/scripts/lib/cvd.mjs).
//   node brand/scripts/check-cvd.mjs [--subbrand <name>] [--verbose]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectSubbrands, argSubbrand } from './lib/subbrands.mjs';
import { KINDS, deltaE, labOf, lightness, sampleRamp } from './lib/cvd.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const verbose = process.argv.includes('--verbose');
const r3 = (x) => Math.round(x * 1000) / 1000;

function monotoneStep(L, dir) {
  let min = Infinity;
  for (let i = 1; i < L.length; i++) min = Math.min(min, dir * (L[i] - L[i - 1]));
  return min;
}
function lutMonotone(hexes, dir) {
  const lut = sampleRamp(hexes, 64).map(lightness);
  return monotoneStep(lut, dir);
}
const worstOver = (fn) => Math.min(...KINDS.map(fn));

let failed = false;
let checked = 0;
for (const sb of selectSubbrands(argSubbrand())) {
  const cfg = sb.manifest.cvd;
  if (!cfg) continue;
  checked += 1;
  const data = JSON.parse(fs.readFileSync(path.join(here, '..', 'dist', sb.name, 'tokens.json'), 'utf8'));
  const modes = data.modes.map((m) => m.id);
  const byKey = new Map(data.tokens.map((t) => [t.key, t]));
  const hexOf = (key, mode) => {
    const t = byKey.get(key);
    if (!t) throw new Error(`cvd (${sb.name}): unknown token ${key}`);
    return (t.values[mode] ?? t.values.all).toUpperCase();
  };
  const modesOf = (m) => (m === 'all' || !m ? modes : m);
  const results = [];
  const hard = (id, label, value, min) => results.push({ id, label, value: r3(value), min, ok: value >= min });

  for (const r of cfg.ramps ?? []) {
    for (const mode of modesOf(r.modes ?? ['dark'])) {
      const hex = r.tokens.map((k) => hexOf(k, mode));
      const labs = (kind) => hex.map((h) => labOf(h, kind));
      const at = `${r.id}${modesOf(r.modes ?? ['dark']).length > 1 ? ` [${mode}]` : ''}`;
      hard(`${at}.adjacent`, `${at}: smallest ΔE between neighboring steps, any vision`, worstOver((k) => Math.min(...labs(k).slice(1).map((l, i) => deltaE(l, labs(k)[i])))), r.adjacent);
      if (r.kind === 'diverging') {
        const mid = (hex.length - 1) / 2;
        hard(`${at}.polarity`, `${at}: smallest ΔE between the two sides, any vision`, worstOver((k) => Math.min(...Array.from({ length: mid }, (_, i) => deltaE(labs(k)[i], labs(k)[hex.length - 1 - i])))), r.polarity);
        const L = (k) => labs(k).map((l) => l[0]);
        hard(`${at}.lightness-rise`, `${at}: smallest lightness rise to the center, any vision`, worstOver((k) => monotoneStep(L(k).slice(0, mid + 1), 1)), r.lightness);
        hard(`${at}.lightness-fall`, `${at}: smallest lightness fall from the center, any vision`, worstOver((k) => monotoneStep(L(k).slice(mid), -1)), r.lightness);
        hard(`${at}.lut`, `${at}: the ramp as drawn keeps lightness monotonic each side`, Math.min(lutMonotone(hex.slice(0, mid + 1), 1), lutMonotone(hex.slice(mid), -1)), -(r.lutSlack ?? 0.004));
      } else {
        hard(`${at}.lightness`, `${at}: smallest lightness rise per step, any vision`, worstOver((k) => monotoneStep(labs(k).map((l) => l[0]), 1)), r.lightness);
        hard(`${at}.lut`, `${at}: the ramp as drawn keeps lightness rising`, lutMonotone(hex, 1), -(r.lutSlack ?? 0.004));
      }
    }
  }
  for (const lv of cfg.levels ?? []) {
    for (const mode of modesOf(lv.modes)) {
      const hex = lv.tokens.map((k) => hexOf(k, mode));
      const L = hex.map(lightness);
      const dir = L.at(-1) > L[0] ? 1 : -1;
      hard(`${lv.id}.${mode}.adjacent`, `${lv.id} ${mode}: smallest ΔE between levels, any vision`, worstOver((k) => Math.min(...hex.slice(1).map((h, i) => deltaE(labOf(h, k), labOf(hex[i], k))))), lv.adjacent);
      hard(`${lv.id}.${mode}.lightness`, `${lv.id} ${mode}: lightness moves one way, smallest step`, monotoneStep(L, dir), lv.lightness);
    }
  }
  for (const p of cfg.pairs ?? []) {
    for (const mode of modesOf(p.modes)) {
      hard(`${p.id}.${mode}`, `${p.id} in ${mode}: smallest ΔE, any vision`, worstOver((k) => deltaE(labOf(hexOf(p.a, mode), k), labOf(hexOf(p.b, mode), k))), p.min);
    }
  }
  const bad = results.filter((c) => !c.ok);
  if (verbose) results.forEach((c) => console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${String(c.value).padStart(6)} (min ${c.min}) ${c.label}`));
  bad.forEach((c) => console.error(`✗ ${sb.name}: ${c.label} = ${c.value} (min ${c.min})`));
  console.log(`${bad.length ? '✗' : ' '} CVD      ${sb.name.padEnd(15)} ${results.length} color-blind and lightness checks (protan, deutan, tritan, grayscale), ${bad.length} failing`);
  for (const b of cfg.backed ?? []) {
    const min = worstOver((k) => deltaE(labOf(hexOf(b.a, 'dark'), k), labOf(hexOf(b.b, 'dark'), k)));
    console.log(`           ${b.id.padEnd(24)} color alone ΔE ${r3(min).toFixed(3)} → carried by: ${b.channel}`);
  }
  if (bad.length) failed = true;
}
if (!checked) console.log('  CVD      no sub-brand declares a cvd block.');
process.exit(failed ? 1 : 0);
