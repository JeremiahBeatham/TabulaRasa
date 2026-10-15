#!/usr/bin/env node
// Prints the brand adoption board (the umbrella issue body) from brand/projects.json.
// Usage: node brand/scripts/board.mjs [--issues owner/repo#N,...]  (markdown to stdout)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { projects } = JSON.parse(fs.readFileSync(path.join(here, '..', 'projects.json'), 'utf8'));
const version = fs.readFileSync(path.join(here, '..', 'VERSION'), 'utf8').trim();

const rows = projects.filter((p) => p.wave).sort((a, b) => a.wave.localeCompare(b.wave) || a.repo.localeCompare(b.repo));
const out = [`## Brand adoption: all repos (brand ${version})`, '', '| Synced | Wave | Repo | Sub-brand | Effort | Branch | Rollout |', '|---|---|---|---|---|---|---|'];
for (const p of rows) {
  const adopted = p.rollout?.adopted ? 'yes' : 'no';
  out.push(`| [${p.rollout?.adopted ? 'x' : ' '}] | ${p.wave} | ${p.repo} | ${p.subbrand ?? p.decision} | ${p.effort} | \`${p.branch}\` | ${adopted} |`);
}
out.push('', 'Wave A: web and docs. Wave B: Apple apps (needs a Mac build). Wave C: re-syncs via `npm run brand:rollout`.', '', `Next step per repo: see \`next\` in brand/projects.json.`);
console.log(out.join('\n'));
