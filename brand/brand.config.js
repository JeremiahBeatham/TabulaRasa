// Beatham brand tokens → Style Dictionary.
//
// Source of truth: brand/tokens/** (the core, W3C DTCG JSON) plus brand/subbrands/<name>/**
// (each sub-brand's overlay). This file says how the layers combine into modes and how Style
// Dictionary transforms each platform. The runner is brand/scripts/build.mjs; this file must
// not import npm packages.
//
//   npm run brand:build                          regenerate every output (core + every sub-brand)
//   npm run brand:build -- --subbrand handcad    regenerate one sub-brand
//   npm run brand:check                          fail on stale output, contrast, roles, palettes, values

/** Core layers every sub-brand starts from, in order (relative to brand/tokens). */
export const baseLayers = [
  'core/color.base.json',
  'core/color.extended.json',
  'core/color.ramps.json',
  'core/color.palettes.json',
  'core/size.json',
  'core/type.json',
  'core/motion.json',
  'core/haptics.json',
  'core/atoms.json',
  'semantic/color.semantic.json',
  'semantic/typography.semantic.json',
  'semantic/layout.semantic.json',
  'semantic/motion.semantic.json',
  'semantic/haptics.semantic.json',
];

/**
 * Modes. Dark is the reference (dark-first): the semantic layer holds dark values. Mode layers may
 * only override tokens that already exist (checked by the runner), except `color-scheme`, which
 * each mode file declares. A sub-brand's own mode files (subbrands/<name>/modes/<mode>.json) layer
 * on top, override only; a high-contrast mode first takes the sub-brand's files for the mode it
 * `inherits` (so a sub-brand's light values carry into light high contrast).
 */
export const modes = {
  dark: { label: 'Dark', layers: ['mode/dark.json'], css: ':root,\n[data-theme="dark"]', site: '[data-theme="dark"]' },
  'high-contrast-dark': {
    label: 'Dark · High contrast',
    layers: ['mode/dark.json', 'mode/high-contrast-dark.json'],
    inherits: 'dark',
    css: '[data-theme="dark"][data-contrast="more"]',
    site: '[data-theme="dark"][data-contrast="more"]',
  },
  light: { label: 'Light', layers: ['mode/light.json'], css: '[data-theme="light"]', site: '[data-theme="light"]' },
  'high-contrast-light': {
    label: 'Light · High contrast',
    layers: ['mode/light.json', 'mode/high-contrast-light.json'],
    inherits: 'light',
    css: '[data-theme="light"][data-contrast="more"]',
    site: '[data-theme="light"][data-contrast="more"]',
  },
};

export const referenceMode = 'dark';

/** Top-level groups whose values change per mode (everything else is mode-independent). */
export const modeGroups = ['color', 'color-scheme'];

/**
 * Core colour ramps under `color.*`: raw values, identical in every mode, never referenced by a
 * product directly (products use semantic roles). Sub-brands may not redefine them — Jeremiah's
 * colours are anchors. Which roles each ramp may fill: brand/rules.json.
 */
export const coreRamps = [
  'neutral',
  'brand',
  'brown',
  'gold',
  'callout',
  'negative',
  'success',
  'violet',
  'teal',
  'orange',
  'filament-grey',
  'filament-orange',
];

/** Palette groups (top-level `palette.*`): colour only, mode-independent, never a semantic role, never in Swift. */
export const paletteGroups = ['palette'];

/** Output naming. A sub-brand may override the prefix (subbrand.json → outputs.prefix) for legacy compatibility. */
export const defaultPrefix = { css: 'bt', swift: 'BT' };

/** Where generated files go, relative to the repo root. All are generated — never edit by hand. */
export const outputs = {
  /** brand/dist/<core|sub-brand>/ — tokens.css, tokens.json, Tokens.swift, sheet.md, print/ */
  dist: 'brand/dist',
  /** The guidelines site's scoped stylesheet (every sub-brand, every mode). */
  siteCss: 'brand/site/src/generated/brand.css',
  /** The guidelines site's index of sub-brands (manifests + check summaries). */
  siteIndex: 'brand/site/src/generated/subbrands.json',
};

/** Platforms → which files a sub-brand gets. json and sheet.md are always written. */
export const platformOutputs = {
  web: ['css'],
  ios: ['swift'],
  macos: ['swift'],
  watchos: ['swift'],
  print: ['print'],
};

/** Style Dictionary platform configs, used once per mode. Names get their prefix in the formatters. */
export const platforms = {
  css: {
    transforms: ['name/kebab', 'color/css', 'cubicBezier/css', 'fontFamily/css', 'shadow/css/shorthand'],
  },
  // Raw resolved values (references followed, nothing converted) for Swift, data and print.
  raw: {
    transforms: ['name/camel'],
  },
};
