// Loads the core tokens and a sub-brand's overlay, resolves every mode with Style Dictionary,
// and renders the generated outputs in memory. Used by build.mjs (write / --check) and the
// checks. Config: brand/brand.config.js.
//
// Layer order for sub-brand S in mode M:
//   core base layers → S.layers (may add tokens and remap core roles; may not redefine core ramps
//   or palettes) → core mode layers for M (override only) → S.modes[M] (override only).
import fs from 'node:fs';
import path from 'node:path';
import StyleDictionary from 'style-dictionary';
import { brandDir, repoRoot, readSubbrandLayer, selectSubbrands } from './subbrands.mjs';

export { repoRoot, brandDir };
export const tokensDir = path.join(brandDir, 'tokens');
const config = await import(path.join(brandDir, 'brand.config.js'));
export { config };

export const isToken = (node) => node && typeof node === 'object' && '$value' in node;
const isGroup = (node) => node && typeof node === 'object' && !Array.isArray(node) && !isToken(node);

/** Reads a core layer (relative to brand/tokens). */
export function readCoreLayer(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(tokensDir, rel), 'utf8'));
  } catch (err) {
    throw new Error(`brand/tokens/${rel}: ${err.message}`);
  }
}

const isCoreRampPath = (trail) => trail[0] === 'color' && config.coreRamps.includes(trail[1]);
const isPalettePath = (trail) => config.paletteGroups.includes(trail[0]);

/**
 * Deep-merges `layer` into `target`.
 *   strict:    a token in the layer must override an existing token (mode files may not invent
 *              tokens), except for the paths in `allowNew`.
 *   protect:   sub-brand layers may not redefine a core ramp step or an existing palette swatch.
 */
function mergeLayer(target, layer, { strict, file, allowNew = [], protect = false }, trail = []) {
  for (const [key, value] of Object.entries(layer)) {
    const here = [...trail, key];
    if (key.startsWith('$')) {
      if (!(key in target)) target[key] = structuredClone(value);
      continue;
    }
    if (isToken(value)) {
      const existing = target[key];
      if (strict && !isToken(existing) && !allowNew.includes(here.join('.'))) {
        throw new Error(`${file}: overrides ${here.join('.')}, which no core or sub-brand layer defines`);
      }
      if (protect && isToken(existing) && (isCoreRampPath(here) || isPalettePath(here))) {
        throw new Error(`${file}: redefines ${here.join('.')} — core ramps and palettes are Jeremiah's anchors; add a new ramp or palette instead`);
      }
      // Keep the semantic description/type; the overriding layer supplies the value.
      target[key] = isToken(existing) ? { ...existing, ...structuredClone(value) } : structuredClone(value);
    } else if (isGroup(value)) {
      if (target[key] !== undefined && !isGroup(target[key])) {
        throw new Error(`${file}: ${here.join('.')} is a group here but a token elsewhere`);
      }
      target[key] ??= {};
      mergeLayer(target[key], value, { strict, file, allowNew, protect }, here);
    } else {
      throw new Error(`${file}: ${here.join('.')} is neither a token nor a group`);
    }
  }
  return target;
}

const sbFile = (sb, rel) => `brand/subbrands/${sb.name}/${rel}`;
const sbLayers = (sb) => (sb.manifest.layers ?? []).map((rel) => [sbFile(sb, rel), readSubbrandLayer(sb, rel)]);
/** A sub-brand's mode layers for one mode: those of the mode it inherits first, then its own. */
const sbModeLayers = (sb, mode) => {
  const chain = [config.modes[mode].inherits, mode].filter(Boolean);
  return chain.flatMap((m) => (sb.manifest.modes?.[m] ?? []).map((rel) => [sbFile(sb, rel), readSubbrandLayer(sb, rel)]));
};

/** Merges the layers for one mode of one sub-brand. */
export function loadModeTokens(sb, mode) {
  const tokens = {};
  for (const rel of config.baseLayers) mergeLayer(tokens, readCoreLayer(rel), { strict: false, file: `brand/tokens/${rel}` });
  for (const [file, layer] of sbLayers(sb)) mergeLayer(tokens, layer, { strict: false, file, protect: true });
  for (const rel of config.modes[mode].layers) {
    mergeLayer(tokens, readCoreLayer(rel), { strict: true, file: `brand/tokens/${rel}`, allowNew: ['color-scheme'] });
  }
  for (const [file, layer] of sbModeLayers(sb, mode)) mergeLayer(tokens, layer, { strict: true, file });
  return tokens;
}

/** Colour token keys a layer sets. */
function colourKeys(node, trail = [], out = new Set()) {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue;
    if (isToken(v)) {
      if (trail[0] === 'color') out.add([...trail, k].join('.'));
    } else if (isGroup(v)) colourKeys(v, [...trail, k], out);
  }
  return out;
}

/**
 * A sub-brand that remaps a core colour role in its base (dark) layer must restate it in every
 * mode where a core mode file overrides that role — otherwise the core's light / high-contrast
 * value would silently leak into the sub-brand.
 */
function checkLeaks(sb) {
  const changed = new Set();
  for (const [, layer] of sbLayers(sb)) colourKeys(layer, [], changed);
  const leaks = [];
  for (const [mode, m] of Object.entries(config.modes)) {
    const coreTouched = new Set();
    for (const rel of m.layers) colourKeys(readCoreLayer(rel), [], coreTouched);
    const ownTouched = new Set();
    for (const [, layer] of sbModeLayers(sb, mode)) colourKeys(layer, [], ownTouched);
    for (const key of changed) if (coreTouched.has(key) && !ownTouched.has(key)) leaks.push(`${key} (${mode})`);
  }
  if (leaks.length) {
    throw new Error(`sub-brand "${sb.name}" remaps colours whose core mode values would leak in — restate them in its mode files: ${leaks.join(', ')}`);
  }
}

/** Every semantic colour (core and sub-brand) must have a light value too (dark is the reference). */
function checkModeCompleteness(sb) {
  const semantic = readCoreLayer('semantic/color.semantic.json');
  const light = readCoreLayer('mode/light.json');
  for (const [file, layer] of sbLayers(sb)) if (layer.color) mergeLayer(semantic, { color: layer.color }, { strict: false, file });
  for (const [file, layer] of sbModeLayers(sb, 'light')) mergeLayer(light, layer, { strict: false, file });
  const independent = sb.manifest.modeIndependent ?? [];
  const missing = [];
  const walk = (node, trail, other) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) continue;
      const o = other?.[k];
      if (isToken(v)) {
        // A role that points at another role (not a ramp step) follows that role through every mode.
        const ref = typeof v.$value === 'string' && v.$value.match(/^\{color\.([\w-]+)\./);
        const followsRole = ref && !config.coreRamps.includes(ref[1]);
        if (!isToken(o) && !followsRole && !independent.includes(trail.join('.'))) missing.push([...trail, k].join('.'));
      } else if (!(trail.length === 1 && trail[0] === 'color' && config.coreRamps.includes(k))) {
        walk(v, [...trail, k], o);
      }
    }
  };
  walk({ color: semantic.color }, [], { color: light.color });
  if (missing.length) {
    const where = sb.isCore ? 'brand/tokens/mode/light.json' : `brand/tokens/mode/light.json or brand/subbrands/${sb.name}/modes/light.json`;
    throw new Error(`${where} is missing light values for: ${missing.join(', ')} (or list the group in modeIndependent)`);
  }
}

async function resolveMode(sb, mode) {
  const sd = new StyleDictionary({
    tokens: loadModeTokens(sb, mode),
    platforms: config.platforms,
    log: { verbosity: 'silent', warnings: 'error', errors: { brokenReferences: 'throw' } },
  });
  const [css, raw] = await Promise.all([sd.getPlatformTokens('css'), sd.getPlatformTokens('raw')]);
  const byPath = (list) => new Map(list.allTokens.map((t) => [t.path.join('.'), t]));
  return { css: byPath(css), raw: byPath(raw) };
}

/** The output prefixes for a sub-brand. */
export function prefixesFor(sb) {
  return { ...config.defaultPrefix, ...(sb.manifest.outputs?.prefix ?? {}) };
}

/**
 * Resolves all modes of one sub-brand. Returns { sb, modeNames, tokens } where `tokens` is a flat
 * list in source order with per-mode values.
 */
export async function resolveSubbrand(sb) {
  checkModeCompleteness(sb);
  if (!sb.isCore) checkLeaks(sb);
  const modeNames = Object.keys(config.modes);
  const resolved = Object.fromEntries(await Promise.all(modeNames.map(async (m) => [m, await resolveMode(sb, m)])));
  const ref = resolved[config.referenceMode];
  const tokens = [...ref.raw.values()].map((t) => {
    const key = t.path.join('.');
    // Core ramps are raw values: identical in every mode, so they live on :root once.
    const modeDependent = config.modeGroups.includes(t.path[0]) && !(t.path[0] === 'color' && config.coreRamps.includes(t.path[1]));
    return {
      path: t.path,
      key,
      type: t.$type,
      description: t.$description ?? '',
      original: t.original.$value,
      extensions: t.original.$extensions,
      name: ref.css.get(key).name,
      modeDependent,
      raw: Object.fromEntries(modeNames.map((m) => [m, resolved[m].raw.get(key).$value])),
      css: Object.fromEntries(modeNames.map((m) => [m, resolved[m].css.get(key).$value])),
    };
  });
  for (const t of tokens.filter((x) => !x.modeDependent)) {
    const values = new Set(modeNames.map((m) => JSON.stringify(t.raw[m])));
    if (values.size > 1) throw new Error(`${sb.name}: ${t.key} changes between modes but is not in a mode-dependent group`);
  }
  return { sb, modeNames, tokens };
}

/** Resolves core and every sub-brand (or one). */
export async function resolveSelected(only) {
  const out = [];
  for (const sb of selectSubbrands(only)) out.push(await resolveSubbrand(sb));
  return out;
}
