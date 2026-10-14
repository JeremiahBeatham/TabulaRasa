// OKLab / OKLCH maths (Björn Ottosson, 2020) for the Pop P1b2 ramp analysis and the
// OKLCH-corrected palettes in design/proposals/_palettes. sRGB only; out-of-gamut
// colours are brought in by lowering chroma at fixed L and h (the CSS Color 4 approach,
// without the JND shortcut).
import { parseHex, contrast } from './color.mjs';

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const delin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** #RRGGBB → { L, C, H } (L 0–1, C ≈ 0–0.4, H degrees 0–360). */
export function toOklch(hex) {
  const { r, g, b } = parseHex(hex);
  const [R, G, B] = [r, g, b].map((v) => lin(v / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let H = (Math.atan2(bb, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return { L, C: Math.hypot(a, bb), H };
}

function linearRgb(L, C, H) {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (L, C, H) => linearRgb(L, C, H).every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** OKLCH → #RRGGBB, lowering chroma (binary search) until the colour fits sRGB. */
export function fromOklch(L, C, H) {
  let c = C;
  if (!inGamut(L, c, H)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(L, mid, H)) lo = mid;
      else hi = mid;
    }
    c = lo;
  }
  const hex = linearRgb(L, c, H)
    .map((v) => Math.round(Math.min(1, Math.max(0, delin(v))) * 255))
    .map((n) => n.toString(16).toUpperCase().padStart(2, '0'))
    .join('');
  return `#${hex}`;
}

/** Largest in-gamut chroma at this L and H. */
export function maxChroma(L, H) {
  let lo = 0;
  let hi = 0.4;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, mid, H)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Measures one ramp against the Beatham neutrals.
 *   steps:   [{ step: '10', hex }]  — step names are numbers (10–90) or swatch indices (1–8)
 *   neutral: { '0': hex, '10': hex, …, '100': hex }
 * Returns per-step OKLCH, ΔL to the same-numbered neutral, monotonicity, evenness,
 * chroma peak, hue drift (over steps with C ≥ 0.03, where hue is visible), sRGB headroom,
 * and the P1b step-gap rule (gap 40/50/60 ⇒ 3/4.5/7:1) against neutral/10–90 and itself
 * (the rule is defined on steps 10–90; neutral/0 and /100 sit outside it).
 */
export function analyseRamp(steps, neutral) {
  const rows = steps.map(({ step, hex }) => {
    const o = toOklch(hex);
    const n = neutral[step];
    const nL = n ? toOklch(n).L : null;
    const { r, g, b } = parseHex(hex);
    const edge = [r, g, b].some((v) => v === 0 || v === 255) && o.C > 0.05;
    return {
      step,
      hex: hex.toUpperCase(),
      L: r3(o.L),
      C: r3(o.C),
      H: r1(o.H),
      dL: nL === null ? null : r3(o.L - nL),
      edge,
      onLight: r2(contrast(parseHex(hex), parseHex(neutral['10']))),
      onDark: r2(contrast(parseHex(hex), parseHex(neutral['90']))),
    };
  });
  const dLs = rows.slice(1).map((row, i) => r3(rows[i].L - row.L));
  const monotonic = dLs.every((d) => d > 0);
  const chromatic = rows.filter((x) => x.C >= 0.03);
  let drift = 0;
  for (const a of chromatic) for (const b of chromatic) drift = Math.max(drift, hueGap(a.H, b.H));
  const peak = rows.reduce((p, x) => (x.C > p.C ? x : p), rows[0]);
  const numbered = rows.every((x) => /^\d0$/.test(x.step));

  let gapRule = null;
  if (numbered) {
    gapRule = [
      [40, 3],
      [50, 4.5],
      [60, 7],
    ].map(([gap, need]) => {
      let worst = null;
      const consider = (aHex, aStep, bHex, bStep, against) => {
        if (Math.abs(Number(aStep) - Number(bStep)) < gap) return;
        const ratio = contrast(parseHex(aHex), parseHex(bHex));
        if (!worst || ratio < worst.ratio) worst = { ratio: r2(ratio), a: aStep, b: bStep, against };
      };
      for (const x of rows) {
        for (const [ns, nh] of Object.entries(neutral).filter(([k]) => /^\d0$/.test(k))) consider(x.hex, x.step, nh, ns, 'neutral');
        for (const y of rows) consider(x.hex, x.step, y.hex, y.step, 'self');
      }
      return { gap, need, worst, ok: !worst || worst.ratio >= need };
    });
  }
  return {
    rows,
    stepDeltaL: dLs,
    monotonic,
    evenness: dLs.length ? { min: Math.min(...dLs), max: Math.max(...dLs) } : null,
    maxAbsDeltaL: numbered ? Math.max(...rows.map((x) => Math.abs(x.dL ?? 0))) : null,
    chromaPeak: { step: peak.step, C: peak.C },
    hueDrift: r1(drift),
    atGamutEdge: rows.filter((x) => x.edge).map((x) => x.step),
    gapRule,
  };
}
