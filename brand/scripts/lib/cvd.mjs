// Color-vision-deficiency simulation and perceptual distance for the analysis ramps (Pop P5).
//
// Simulation: Machado, Oliveira & Fernandes, "A Physiologically-based Model for Simulation of Color
// Vision Deficiency", IEEE TVCG 15(6), 2009 — the severity-1.0 (dichromacy) matrices, applied to
// linear-light sRGB. Distance: Euclidean ΔE in OKLab (Ottosson 2020), where ≈ 0.02 is a just
// noticeable difference. Also the OKLab interpolation the shader and the SwiftUI legend use, so the
// check measures the ramp the user actually sees and not only its nine stops.
import { parseHex } from './color.mjs';

export const KINDS = ['normal', 'protan', 'deutan', 'tritan'];

const MATRIX = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritan: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** '#RRGGBB' → linear-light [r, g, b] in 0–1. */
export function linearRgb(hex) {
  const { r, g, b } = parseHex(hex);
  return [r, g, b].map((c) => toLinear(c / 255));
}

/** Linear-light [r, g, b] → '#RRGGBB'. */
export function toHex(rgb) {
  return `#${rgb
    .map((c) => Math.round(clamp01(fromLinear(clamp01(c))) * 255))
    .map((n) => n.toString(16).toUpperCase().padStart(2, '0'))
    .join('')}`;
}

/** Linear-light [r, g, b] → OKLab [L, a, b]. */
export function oklabOfLinear([R, G, B]) {
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab [L, a, b] → linear-light [r, g, b] (unclamped). */
export function linearOfOklab([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

/** Linear-light color as seen with the given deficiency. */
export function simulateLinear(rgb, kind) {
  const m = MATRIX[kind];
  return m.map((row) => clamp01(row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]));
}

/** '#RRGGBB' → '#RRGGBB' as seen with the given deficiency. */
export function simulate(hex, kind) {
  return toHex(simulateLinear(linearRgb(hex), kind));
}

/** OKLab of a hex color as seen with the given deficiency. */
export const labOf = (hex, kind = 'normal') => oklabOfLinear(simulateLinear(linearRgb(hex), kind));

export const deltaE = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

/** OKLab lightness of a hex color (what a grayscale print or a monochrome display keeps). */
export const lightness = (hex) => labOf(hex)[0];

/** Greyscale '#RRGGBB' with the color's OKLab lightness. */
export function gray(hex) {
  const L = lightness(hex);
  return toHex(linearOfOklab([L, 0, 0]));
}

/**
 * The ramp as drawn: piecewise-linear in OKLab between the stops (the interpolation the legend, the
 * shader LUT and HCCurvatureRamp use), sampled at `n` points. Returns hex colors.
 */
export function sampleRamp(stops, n) {
  const labs = stops.map((h) => labOf(h));
  return Array.from({ length: n }, (_, i) => {
    const x = (i / (n - 1)) * (labs.length - 1);
    const k = Math.min(Math.floor(x), labs.length - 2);
    const f = x - k;
    const lab = labs[k].map((v, j) => v + (labs[k + 1][j] - v) * f);
    return toHex(linearOfOklab(lab));
  });
}
