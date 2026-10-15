// Renders brand/dist/<name>/figma-variables.json: the sub-brand's colours as Tokens Studio sets
// (one set per mode, plus the mode-independent palettes), which Tokens Studio or a Figma
// variables import turns into variables. Only for a sub-brand whose manifest sets
// "figmaVariables": true (a project that lives in Figma: the portfolio, the WAGS plugin).
// Colours only: a variable in Figma is a value, and every value here is already resolved.
const setPath = (node, parts, token) => {
  let at = node;
  for (const p of parts.slice(0, -1)) at = at[p] ??= {};
  at[parts[parts.length - 1]] = token;
};

export function renderFigma(resolved, config) {
  const { sb, modeNames, tokens } = resolved;
  const colours = tokens.filter((t) => t.type === 'color');
  const sets = {};
  for (const mode of modeNames) {
    const set = (sets[mode] = {});
    for (const t of colours) {
      if (t.path[0] === 'palette' || !t.modeDependent && mode !== config.referenceMode) continue;
      const value = String(t.raw[mode] ?? t.raw[config.referenceMode]);
      setPath(set, t.path, { value, type: 'color', description: t.description ?? '' });
    }
  }
  sets.palettes = {};
  for (const t of colours.filter((x) => x.path[0] === 'palette')) {
    setPath(sets.palettes, t.path.slice(1), { value: String(t.raw[config.referenceMode]), type: 'color', description: t.description ?? '' });
  }
  const out = {
    $metadata: { tokenSetOrder: [...modeNames, 'palettes'] },
    $themes: modeNames.map((m) => ({ id: `${sb.name}-${m}`, name: `${sb.manifest.label} · ${config.modes[m].label}`, selectedTokenSets: { [m]: 'enabled', palettes: 'enabled' } })),
    ...sets,
  };
  return JSON.stringify(out, null, 2) + '\n';
}
