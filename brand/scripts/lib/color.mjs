// Colour maths shared by the Swift formatter and the WCAG contrast check.

/** Parses #RGB, #RRGGBB or #RRGGBBAA into 0–255 channels, 0–1 alpha and 0–255 alpha. */
export function parseHex(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  const n = (i) => parseInt(full.slice(i, i + 2), 16);
  const a8 = full.length === 8 ? n(6) : 255;
  return { r: n(0), g: n(2), b: n(4), a: a8 / 255, a8 };
}

/** Composites a (possibly translucent) colour over an opaque background. */
export function over(fg, bg) {
  const mix = (f, b) => Math.round(f * fg.a + b * (1 - fg.a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b), a: 1, a8: 255 };
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB hex → CIELAB (D50, the print / colorimeter reference white), via XYZ D65 and Bradford. */
export function toLabD50(hex) {
  const { r, g, b } = parseHex(hex);
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const X65 = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y65 = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z65 = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
  const X = 1.0478112 * X65 + 0.0228866 * Y65 - 0.050127 * Z65;
  const Y = 0.0295424 * X65 + 0.9904844 * Y65 - 0.0170491 * Z65;
  const Z = -0.0092345 * X65 + 0.0150436 * Y65 + 0.7521316 * Z65;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [f(X / 0.96422), f(Y / 1), f(Z / 0.82521)];
  const r1 = (n) => Math.round(n * 10) / 10 || 0;
  return { L: r1(116 * fy - 16), a: r1(500 * (fx - fy)), b: r1(200 * (fy - fz)) };
}
