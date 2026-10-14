#!/usr/bin/env node
// Derives the Beatham core OKLCH ramps from Jeremiah's colour inputs, and audits any ramp a
// sub-brand defines against the same rules.
//   in:  brand/inputs/brand-inputs.json      (his values, verbatim — never edited here)
//        brand/tokens/core/color.base.json    (Beatham neutrals = the lightness targets; Beatham brand ramp)
//   out: brand/tokens/core/color.ramps.json   (callout, negative, success, gold, brown, filament-grey, filament-orange)
//        brand/dist/core/ramps.json           (the guidelines' Colour page: shipped ramps beside his originals)
//   node brand/scripts/palettes.mjs [--check]
//
// Rules (docs/BRAND.md, from HandCAD ADR-0012):
//   - Lightness target per step = the OKLCH L of the Beatham neutral with the same number,
//     so the step-gap rule (40/50/60 apart => 3/4.5/7:1) holds for every generated ramp.
//   - Minimum correction: a step moves only when |dL| > TOLERANCE; hue and chroma are kept,
//     chroma is lowered only if the moved colour leaves sRGB. Every other step is verbatim.
//   - gold has no mid browns, so it is rebuilt: his swatches that land within TOLERANCE of a
//     neutral step are kept verbatim as anchors; the gaps are filled in OKLCH.
//   - brown: the Beatham brand ramp can't be one balanced ramp (10-50 sit within 0.14 L, then
//     0.15 L steps), so its dark end gets its own lightness-matched ramp, anchored on his darkest
//     values; it extends to 100 for the deepest gold swatch.
//   - filament-grey / filament-orange: his photo-sampled filaments sit on neutral steps already
//     (light gray 30, space gray 70, black 90; orange 40), so they anchor two ramps for showing
//     printed parts on screen.
//   - Every input colour is an exact step somewhere, or mapped to its nearest step with the reason
//     (written to ramps.json and shown on the guidelines' Colour page).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toOklch, fromOklch, maxChroma, analyseRamp } from './lib/oklch.mjs';
import { parseHex, contrast } from './lib/color.mjs';
import { listSubbrands, subbrandColourRamps } from './lib/subbrands.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => JSON.parse(fs.readFileSync(path.join(repo, rel), 'utf8'));
const OUT_RAMPS = 'brand/tokens/core/color.ramps.json';
const OUT_DATA = 'brand/dist/core/ramps.json';
const TOLERANCE = 0.025;
const STEPS = ['10', '20', '30', '40', '50', '60', '70', '80', '90'];

const inputs = read('brand/inputs/brand-inputs.json').color;
const base = read('brand/tokens/core/color.base.json').color;
const neutralHex = Object.fromEntries(Object.entries(base.neutral).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.$value]));
const brandHex = Object.fromEntries(Object.entries(base.brand).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.$value]));
const neutralL = Object.fromEntries(STEPS.map((s) => [s, toOklch(neutralHex[s]).L]));
const val = (group, step) => inputs[group][step].$value;
const lerp = (a, b, t) => a + (b - a) * t;
const r3 = (n) => Math.round(n * 1000) / 1000;
const r2 = (n) => Math.round(n * 100) / 100;

/** Moves only the steps whose lightness is off the neutral target by more than TOLERANCE. */
function correct(group) {
  const out = {};
  for (const s of STEPS) {
    const hex = val(group, s);
    const o = toOklch(hex);
    const off = o.L - neutralL[s];
    out[s] = Math.abs(off) > TOLERANCE ? fromOklch(neutralL[s], o.C, o.H) : hex.toUpperCase();
  }
  return out;
}

/**
 * Builds a 9-step ramp on the neutral lightness targets. `anchors` maps step → hex (kept
 * verbatim); other steps take hue from `hueAt(step)` and chroma from `chroma[step]`
 * (capped at the sRGB maximum for that L and h).
 */
function build(anchors, chroma, hueAt) {
  const out = {};
  for (const s of STEPS) {
    if (anchors[s]) {
      out[s] = anchors[s].toUpperCase();
      continue;
    }
    const L = neutralL[s];
    const H = hueAt(Number(s));
    out[s] = fromOklch(L, Math.min(chroma[s], maxChroma(L, H) * 0.98), H);
  }
  return out;
}

const assertNear = (name, anchors) => {
  for (const [s, hex] of Object.entries(anchors)) {
    if (!neutralL[s]) continue;
    const off = toOklch(hex).L - neutralL[s];
    if (Math.abs(off) > TOLERANCE) throw new Error(`${name} anchor ${hex} is ${off.toFixed(3)} off neutral/${s}`);
  }
};

// ---------- gold: his 1, 2 and 5 sit within TOLERANCE of neutral 10/20/30, his 6 of neutral 90 ----------
const gold = inputs.gold;
const goldAnchors = { 10: gold['1'].$value, 20: gold['2'].$value, 30: gold['5'].$value, 90: gold['6'].$value };
assertNear('gold', goldAnchors);
const h30 = toOklch(goldAnchors[30]).H;
const h90 = toOklch(goldAnchors[90]).H;
const goldOklch = build(goldAnchors, { 40: 0.14, 50: 0.128, 60: 0.112, 70: 0.094, 80: 0.072 }, (s) => lerp(h30, h90, (s - 30) / 60));

// ---------- brown: the dark end of the Beatham brand ramp, lightness-matched ----------
// brand/70 sits on neutral/60 and brand/90 on neutral/90 (both within TOLERANCE): exact anchors.
// brand/80 is 0.040 L off neutral/80, so brown/80 is its corrected twin (L moved, hue + chroma kept).
// gold/8 is darker than neutral/90: it is brown/100, the deepest ink (as neutral/100 is black).
const brownAnchors = { 60: brandHex['70'], 90: brandHex['90'] };
assertNear('brown', brownAnchors);
const b60 = toOklch(brownAnchors[60]);
const b80 = toOklch(brandHex['80']);
const b90 = toOklch(brownAnchors[90]);
const brownHue = (s) => (s <= 60 ? lerp(68, b60.H, (s - 10) / 50) : s <= 80 ? lerp(b60.H, b80.H, (s - 60) / 20) : lerp(b80.H, b90.H, (s - 80) / 10));
const brown = build(
  { ...brownAnchors, 80: fromOklch(neutralL['80'], b80.C, b80.H) },
  { 10: 0.018, 20: 0.036, 30: 0.056, 40: 0.076, 50: 0.096, 70: lerp(b60.C, b80.C, 0.5) },
  brownHue,
);
brown['100'] = gold['8'].$value.toUpperCase();

// ---------- filament-grey / filament-orange: his filaments as lightness-matched ramps ----------
const fil = inputs.filament;
const printAnchors = { 30: fil['light-gray'].$value, 70: fil['space-gray'].$value, 90: fil.black.$value };
assertNear('filament-grey', printAnchors);
const print = build(printAnchors, Object.fromEntries(STEPS.map((s) => [s, 0.006])), () => 262);
const orange = toOklch(fil.orange.$value);
const printOrange = build(
  { 40: fil.orange.$value },
  { 10: 0.016, 20: 0.05, 30: 0.095, 50: 0.142, 60: 0.128, 70: 0.106, 80: 0.08, 90: 0.05 },
  () => orange.H,
);

const group = (description, values) => ({
  $type: 'color',
  $description: description,
  ...Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { $value: v }])),
});

const callout = correct('callout');
const negative = Object.fromEntries(STEPS.map((s) => [s, val('negative', s).toUpperCase()]));
const success = correct('success');

// ---------- the shipped core ramps ----------
const rampsDoc = {
  $description:
    'GENERATED by brand/scripts/palettes.mjs from brand/inputs/brand-inputs.json + the Beatham ramps in color.base.json — do not edit (npm run brand:palettes). OKLCH, 9 steps, each step’s lightness matched to the Beatham neutral of the same number. Raw palette: products use semantic colours only.',
  color: {
    callout: group(
      'Callout (blue) — signal.info: still open, still free. Jeremiah’s Callout ramp, OKLCH-corrected (HandCAD decision #23): his 10–40 and 70–90 verbatim; 50 and 60 lifted onto the neutral lightness targets (hue and chroma kept).',
      callout,
    ),
    negative: group(
      'Negative (red) — signal.negative: broken (error, conflict, failed, destructive) and, one step lighter, signal.caution / warnings. Jeremiah’s Negative ramp exactly as drawn (HandCAD decision #24); it already sits within 0.016 L of every neutral step.',
      negative,
    ),
    success: group(
      'Success (green) — signal.positive: results that passed a check (✓), never “saved”. Jeremiah’s Success ramp, OKLCH-corrected (HandCAD decision #25): only 60 moves.',
      success,
    ),
    gold: group(
      'Gold → brown, rebuilt in OKLCH (HandCAD decision #26): his gold swatches 1, 2, 5 and 6 verbatim at 10, 20, 30 and 90; 40–80 are new mid browns on the neutral targets. His 3 and 4 map to brand/40 and brand/50 (same lightness), 7 to brown/90 and 8 is brown/100. Marketing, illustration, packaging and the Gilt palette — never a semantic role.',
      goldOklch,
    ),
    brown: group(
      'Brown — the dark end of the Beatham amber → brown ramp as its own lightness-matched ramp (HandCAD decisions #3, #26): brand/70 verbatim at 60, brand/90 verbatim at 90, brown/80 is brand/80 moved onto the neutral/80 lightness (hue and chroma kept), and his deepest gold swatch (#110602) is brown/100. Marketing, illustration, packaging and the Gilt palette — never a semantic role.',
      brown,
    ),
    'filament-grey': group(
      'Filament grey — his photo-sampled filaments as a cool grey ramp: light gray (30), space gray (70) and black (90) verbatim; the other steps are the same cool grey (C 0.006, h 262) on the neutral targets. For showing printed parts on screen and the physical roles (subbrand grants, scope physical).',
      print,
    ),
    'filament-orange': group(
      'Filament orange — his orange filament verbatim at 40; the other steps keep its hue on the neutral lightness targets. Physical roles only (the part you actuate).',
      printOrange,
    ),
  },
};

// ---------- ramps.data.json: shipped ramps beside his originals, every input accounted for ----------
const steps = (values) => Object.entries(values).map(([step, hex]) => ({ step, hex }));
const analysed = (values) => analyseRamp(steps(values).filter((s) => s.step !== '100'), neutralHex);
const shipped = { callout, negative, success, gold: goldOklch, brown, 'filament-grey': print, 'filament-orange': printOrange };

/** Where each original colour lives in the shipped ramps: exact, moved (corrected twin) or mapped. */
function locate(hex) {
  const H = hex.toUpperCase();
  const exact = [];
  for (const [id, values] of Object.entries({ brand: brandHex, ...shipped })) {
    for (const [step, v] of Object.entries(values)) if (v.toUpperCase() === H) exact.push(`${id}/${step}`);
  }
  return exact;
}
const ratio = (a, b) => r2(contrast(parseHex(a), parseHex(b)));
const dL = (a, b) => r3(toOklch(a).L - toOklch(b).L);

const originals = [];
const addOriginal = (source, label, hex, fallback) => {
  const exact = locate(hex);
  const o = toOklch(hex);
  originals.push({
    source,
    label,
    hex: hex.toUpperCase(),
    L: r3(o.L),
    C: r3(o.C),
    H: Math.round(o.H),
    status: exact.length ? 'exact' : fallback.status,
    at: exact.length ? exact : [fallback.at],
    reason: exact.length ? (fallback.exactNote ?? null) : fallback.reason,
  });
};
for (const s of STEPS) {
  addOriginal('brand', `brand/${s}`, brandHex[s], {});
}
originals.find((x) => x.label === 'brand/80').reason = `Exact in brand. In brown its lightness twin is brown/80 ${brown['80']}: brand/80 sits ${dL(brandHex['80'], neutralHex['80'])} L off neutral/80 (tolerance ±${TOLERANCE}), so the lightness-matched step keeps its hue and chroma at L ${r3(neutralL['80'])}.`;
for (const s of STEPS) {
  const moved = callout[s] !== val('callout', s).toUpperCase();
  addOriginal('callout', `Callout ${s}`, val('callout', s), {
    status: 'moved',
    at: `callout/${s}`,
    reason: moved ? `${dL(val('callout', s), neutralHex[s])} L off neutral/${s}: callout/${s} is the same hue and chroma at the neutral lightness (${callout[s]}).` : null,
  });
}
for (const s of STEPS) addOriginal('negative', `Negative ${s}`, val('negative', s), {});
for (const s of STEPS) {
  addOriginal('success', `Success ${s}`, val('success', s), {
    status: 'moved',
    at: `success/${s}`,
    reason: `${dL(val('success', s), neutralHex[s])} L off neutral/${s}: success/${s} is the same hue and chroma at the neutral lightness (${success[s]}).`,
  });
}
const goldMap = {
  3: { at: 'brand/40', other: brandHex['40'] },
  4: { at: 'brand/50', other: brandHex['50'] },
  7: { at: 'brown/90', other: brown['90'] },
};
for (const [k, v] of Object.entries(gold).filter(([k]) => !k.startsWith('$'))) {
  const m = goldMap[k];
  addOriginal('gold', `Gold ${k}`, v.$value, m
    ? {
        status: 'mapped',
        at: m.at,
        reason: `Falls between lightness-matched steps; nearest is ${m.at} ${m.other} (ΔL ${dL(v.$value, m.other)}, ${ratio(v.$value, m.other)}:1 — the same lightness).`,
      }
    : {});
}
for (const [k, v] of Object.entries(fil)) {
  if (k.startsWith('$')) continue;
  addOriginal('filament', `Filament ${k}`, v.$value, {
    status: 'palette',
    at: `palette.filament.${k}`,
    reason: 'Used verbatim as a named swatch in the filament palette; filaments are photo samples.',
  });
}
const unaccounted = originals.filter((o) => !o.at.length || (o.status !== 'exact' && !o.reason));
if (unaccounted.length) throw new Error(`Unaccounted input colours: ${unaccounted.map((o) => o.label).join(', ')}`);

const data = {
  generated: 'GENERATED by brand/scripts/palettes.mjs — do not edit. Regenerate: npm run brand:palettes',
  tolerance: TOLERANCE,
  neutral: Object.entries(neutralHex).map(([step, hex]) => ({ step, hex, L: r3(toOklch(hex).L) })),
  brand: { values: brandHex, analysis: analysed(brandHex) },
  ramps: Object.fromEntries(
    Object.entries(shipped).map(([id, values]) => [id, { values, analysis: analysed(values), description: rampsDoc.color[id].$description }]),
  ),
  originals: {
    callout: Object.fromEntries(STEPS.map((s) => [s, val('callout', s).toUpperCase()])),
    negative,
    success: Object.fromEntries(STEPS.map((s) => [s, val('success', s).toUpperCase()])),
    gold: Object.fromEntries(Object.entries(gold).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.$value.toUpperCase()])),
    filament: Object.fromEntries(Object.entries(fil).filter(([k]) => !k.startsWith('$')).map(([k, v]) => [k, v.$value.toUpperCase()])),
  },
  accounting: originals,
};

const outputs = {
  [OUT_RAMPS]: JSON.stringify(rampsDoc, null, 2) + '\n',
  [OUT_DATA]: JSON.stringify(data, null, 2) + '\n',
};
const check = process.argv.includes('--check');
let stale = false;
for (const [rel, text] of Object.entries(outputs)) {
  const abs = path.join(repo, rel);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (current === text) {
    console.log(`  up to date  ${rel}`);
  } else if (check) {
    console.error(`✗ stale       ${rel}`);
    stale = true;
  } else {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
    console.log(`  wrote       ${rel}`);
  }
}
if (stale) {
  console.error('Run: npm run brand:palettes (and commit the output).');
  process.exit(1);
}

// ---------- per sub-brand: any 9-step ramp a sub-brand defines meets the same rules ----------
const only = process.argv.includes('--subbrand') ? process.argv[process.argv.indexOf('--subbrand') + 1] : null;
let bad = false;
for (const sb of listSubbrands()) {
  if (only && sb.name !== only) continue;
  const own = subbrandColourRamps(sb);
  if (!own.length) {
    console.log(`  ${sb.name.padEnd(15)} no ramps of its own (uses the core ramps)`);
    continue;
  }
  for (const [name, values] of own) {
    const a = analyseRamp(Object.entries(values).map(([step, hex]) => ({ step, hex })), neutralHex);
    const gapOk = a.gapRule?.every((g) => g.ok);
    const dlOk = a.maxAbsDeltaL !== null && a.maxAbsDeltaL <= TOLERANCE;
    const ok = gapOk && dlOk && a.monotonic;
    if (!ok) bad = true;
    console.log(`${ok ? '  ok' : '✗ FAIL'} ${sb.name.padEnd(15)} color.${name}: max ΔL ${a.maxAbsDeltaL}, monotonic ${a.monotonic}, step-gap ${a.gapRule?.map((g) => `${g.worst.ratio}${g.ok ? '✓' : '✕'}`).join(' / ')}`);
  }
}
if (bad) {
  console.error('A sub-brand ramp is not lightness-matched to the neutrals (|ΔL| ≤ 0.025 per step) or breaks the step-gap rule.');
  process.exit(1);
}
