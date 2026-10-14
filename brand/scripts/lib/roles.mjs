// Colour-role guard: the hue budget and the accent rule are rules, not conventions.
// For one sub-brand, every semantic colour in every mode may only draw on the ramps its role is
// allowed to use (brand/rules.json + the sub-brand's grants). References between roles are
// followed to the ramp they land on; literal colours are judged by their RGB.
import fs from 'node:fs';
import path from 'node:path';
import { isToken, loadModeTokens, readCoreLayer, config } from './tokens.mjs';
import { brandDir } from './subbrands.mjs';

export const rules = JSON.parse(fs.readFileSync(path.join(brandDir, 'rules.json'), 'utf8'));

const glob = (pattern) => new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`);
const matches = (patterns, key) => patterns.some((p) => p === '*' || glob(p).test(key));

function flatten(node, trail = [], out = new Map()) {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('$')) continue;
    if (isToken(v)) out.set([...trail, k].join('.'), v.$value);
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, [...trail, k], out);
  }
  return out;
}

/** Core semantic colour keys (the "chrome" roles every sub-brand inherits). */
function coreRoleKeys() {
  const out = new Set();
  for (const k of flatten(readCoreLayer('semantic/color.semantic.json')).keys()) out.add(k);
  return out;
}

export function evaluateRoles(sb) {
  const accent = sb.manifest.palettes?.accent ?? rules.accent.default;
  const grants = sb.manifest.rules?.grants ?? [];
  const problems = [];
  const coreKeys = coreRoleKeys();

  // Grants are checked first: they may never loosen the core rules.
  for (const g of grants) {
    const where = `${sb.name}: grant ${g.ramp} → ${g.roles?.join(', ')}`;
    if (!g.reason) problems.push(`${where} has no reason`);
    if (!rules.hueBudget.scopes.includes(g.scope)) problems.push(`${where} has scope "${g.scope}" (use ${rules.hueBudget.scopes.join(', ')})`);
    if (g.ramp === accent && accent !== 'neutral') problems.push(`${where}: the accent ramp marks only what you act on — it can't be granted to other roles`);
    if (rules.never.ramps.includes(g.ramp) || rules.never.groups.includes(g.ramp)) problems.push(`${where}: ${g.ramp} never fills a semantic role`);
    if ((g.roles ?? []).some((r) => matches(rules.accent.roles, r))) problems.push(`${where}: accent roles take only the accent ramp or neutral`);
    if ((g.roles ?? []).some((r) => coreKeys.has(r) || [...coreKeys].some((k) => glob(r).test(k)))) {
      if (g.scope !== 'chrome') problems.push(`${where}: a grant on a core role must have scope "chrome"`);
    }
  }

  const allowed = (ramp, key) => {
    if (ramp === 'neutral') return true;
    const isAccentRole = matches(rules.accent.roles, key);
    if (isAccentRole) return ramp === accent;
    if (ramp === accent && accent !== 'neutral') return false; // the accent rule
    if (rules.never.ramps.includes(ramp) || rules.never.groups.includes(ramp)) return false;
    if (matches(rules.ramps[ramp] ?? [], key)) return true;
    return grants.some((g) => g.ramp === ramp && matches(g.roles, key));
  };

  const chromeHues = new Set();
  const scopedHues = {};
  let checked = 0;
  const allRamps = new Set(config.coreRamps);
  for (const mode of Object.keys(config.modes)) {
    const tree = loadModeTokens(sb, mode);
    const flat = flatten(tree);
    // byHex over every ramp in this tree (core ramps + any ramp a sub-brand adds under color.*).
    const rampNames = new Set(allRamps);
    for (const [name, group] of Object.entries(tree.color ?? {})) {
      if (!name.startsWith('$') && group && !isToken(group) && Object.keys(group).some((k) => /^\d+$/.test(k))) rampNames.add(name);
    }
    const byHex = new Map();
    for (const name of rampNames) {
      for (const [step, t] of Object.entries(tree.color?.[name] ?? {})) {
        if (step.startsWith('$') || !isToken(t) || String(t.$value).startsWith('{')) continue;
        const hex = String(t.$value).slice(0, 7).toUpperCase();
        byHex.set(hex, [...(byHex.get(hex) ?? []), name]);
      }
    }
    const rampsOf = (value, seen = new Set()) => {
      const ref = typeof value === 'string' && value.match(/^\{([\w.-]+)\}$/);
      if (ref) {
        const parts = ref[1].split('.');
        if (config.paletteGroups.includes(parts[0])) return ['palette'];
        if (parts[0] === 'color' && rampNames.has(parts[1])) return [parts[1]];
        if (seen.has(ref[1]) || !flat.has(ref[1])) return ['(unresolved)'];
        seen.add(ref[1]);
        return rampsOf(flat.get(ref[1]), seen);
      }
      if (typeof value === 'string' && value.startsWith('#')) return byHex.get(value.slice(0, 7).toUpperCase()) ?? ['(literal)'];
      return ['(unknown)'];
    };
    for (const [key, value] of flat) {
      const p = key.split('.');
      if (p[0] !== 'color' || rampNames.has(p[1])) continue; // raw ramps aren't roles
      checked++;
      const from = rampsOf(value);
      if (!from.some((r) => allowed(r, key))) {
        const why = matches(rules.accent.roles, key)
          ? `accent roles take only ${accent} or neutral`
          : from.includes(accent)
            ? `the accent (${accent}) marks only what you act on`
            : `${from.join('/')} is not allowed in this role`;
        problems.push(`${sb.name} [${mode}]: ${key} = ${value} — ${why}`);
        continue;
      }
      const ramp = from.find((r) => allowed(r, key));
      if (ramp === 'neutral' || ramp === accent) continue;
      const grant = grants.find((g) => g.ramp === ramp && matches(g.roles, key));
      const scope = coreKeys.has(key) ? 'chrome' : grant?.scope ?? 'chrome';
      if (scope === 'chrome') chromeHues.add(ramp);
      else (scopedHues[scope] ??= new Set()).add(ramp);
    }
  }
  if (chromeHues.size > rules.hueBudget.chrome) {
    problems.push(`${sb.name}: ${chromeHues.size} hues in the chrome (${[...chromeHues].join(', ')}) — the budget is ${rules.hueBudget.chrome}`);
  }

  // Proportion swatches must name real colour tokens.
  const known = flatten(loadModeTokens(sb, config.referenceMode));
  for (const system of [sb.manifest.proportion, ...(sb.manifest.proportion.alternates ?? [])]) {
    for (const part of system.parts) {
      for (const key of [part.color].flat()) if (!known.has(key)) problems.push(`${sb.name}: proportion "${system.name}" names unknown colour ${key}`);
    }
  }

  return {
    checked,
    accent,
    chromeHues: [...chromeHues].sort(),
    scopedHues: Object.fromEntries(Object.entries(scopedHues).map(([k, v]) => [k, [...v].sort()])),
    budget: rules.hueBudget.chrome,
    problems,
  };
}
