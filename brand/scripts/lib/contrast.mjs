// WCAG contrast evaluation shared by check-contrast.mjs and the build (each sub-brand's
// tokens.json carries its summary). No imports from tokens.mjs, so formatters can use it.
import fs from 'node:fs';
import path from 'node:path';
import { parseHex, over, contrast } from './color.mjs';

/** The core pairs plus a sub-brand's own (subbrand.json → pairs). */
export function loadPairSpec(brandDir, sb) {
  const read = (abs) => JSON.parse(fs.readFileSync(abs, 'utf8'));
  const spec = read(path.join(brandDir, 'contrast-pairs.json'));
  const extraFiles = sb && !sb.isCore && sb.manifest.pairs ? [path.join(sb.dir, sb.manifest.pairs)] : [];
  for (const abs of extraFiles) {
    const extra = read(abs);
    spec.pairs = [...spec.pairs, ...(extra.pairs ?? [])];
    spec.exempt = { ...spec.exempt, ...(extra.exempt ?? {}) };
  }
  return spec;
}

/** Checks every pair in every mode of one resolved token set. */
export function evaluateContrast({ modeNames, tokens }, spec, coreRamps) {
  const byKey = new Map(tokens.map((t) => [t.key, t]));
  const get = (key, mode) => {
    const t = byKey.get(key);
    if (!t) throw new Error(`contrast pairs reference unknown token ${key}`);
    return parseHex(t.raw[mode]);
  };

  const exemptRules = Object.keys(spec.exempt).map((p) => new RegExp(`^${p.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`));
  const paired = new Set(spec.pairs.flatMap((p) => [...p.fg, ...p.bg]));
  const uncovered = tokens
    .filter((t) => t.path[0] === 'color' && !coreRamps.includes(t.path[1]))
    .filter((t) => !paired.has(t.key) && !exemptRules.some((r) => r.test(t.key)))
    .map((t) => t.key);

  const rows = [];
  const lowest = {};
  for (const mode of modeNames) {
    const level = mode.startsWith('high-contrast') ? 'high-contrast' : 'standard';
    for (const pair of spec.pairs) {
      // A pair may name the modes it applies to (e.g. physical parts have no high-contrast mode); it must say why.
      if (pair.modes) {
        if (!pair.modesReason) throw new Error(`contrast pair "${pair.usage}" limits its modes without a modesReason`);
        if (!pair.modes.includes(mode)) continue;
      }
      const min = spec.thresholds[level][pair.kind];
      for (const bgKey of pair.bg) {
        const bg = get(bgKey, mode);
        if (bg.a !== 1) throw new Error(`${bgKey} is translucent in ${mode}; backgrounds must be opaque`);
        for (const fgKey of pair.fg) {
          const ratio = contrast(over(get(fgKey, mode), bg), bg);
          const row = { mode, fg: fgKey, bg: bgKey, ratio, min, kind: pair.kind, ok: ratio >= min };
          rows.push(row);
          if (!lowest[mode] || ratio / min < lowest[mode].ratio / lowest[mode].min) lowest[mode] = row;
        }
      }
    }
  }
  return { rows, failures: rows.filter((r) => !r.ok), lowest, uncovered };
}

/** A compact summary for tokens.json and the guidelines site. */
export function contrastSummary({ rows, failures, lowest, uncovered }) {
  const r2 = (n) => Math.round(n * 100) / 100;
  return {
    checks: rows.length,
    failing: failures.length,
    uncovered,
    tightest: Object.fromEntries(Object.entries(lowest).map(([m, r]) => [m, { fg: r.fg, bg: r.bg, ratio: r2(r.ratio), min: r.min }])),
  };
}
