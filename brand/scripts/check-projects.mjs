#!/usr/bin/env node
// brand/projects.json: one entry per project, each sub-brand folder referenced exactly once,
// every referenced sub-brand real, decisions from a fixed set. The Sub-brands page reads this file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const brand = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(fs.readFileSync(path.join(brand, 'projects.json'), 'utf8'));
const DECISIONS = ['home', 'sub-brand', 'core', 'undecided', 'out'];
const folders = fs.readdirSync(path.join(brand, 'subbrands'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const errors = [];
const seen = new Set();
const used = new Set();
for (const p of data.projects) {
  const id = p.repo ?? p.label;
  if (seen.has(id)) errors.push(`${id}: listed twice`);
  seen.add(id);
  if (!DECISIONS.includes(p.decision)) errors.push(`${id}: decision must be one of ${DECISIONS.join(', ')}`);
  for (const k of ['label', 'kind', 'summary', 'next', 'adoption']) if (!p[k]) errors.push(`${id}: missing ${k}`);
  if (p.rollout) {
    if (!p.repo) errors.push(`${id}: rollout needs a repo`);
    if (typeof p.rollout.adopted !== 'boolean') errors.push(`${id}: rollout.adopted must be true or false`);
    if (p.rollout.checks && !Array.isArray(p.rollout.checks)) errors.push(`${id}: rollout.checks must be a list of commands`);
    if (p.rollout.package && typeof p.rollout.package !== 'string') errors.push(`${id}: rollout.package must be a path`);
    const track = p.rollout.subbrand ?? p.subbrand ?? 'core';
    if (track !== 'core' && !folders.includes(track)) errors.push(`${id}: rollout sub-brand "${track}" has no folder in brand/subbrands`);
  }
  if (p.decision === 'sub-brand') {
    if (!p.subbrand || !folders.includes(p.subbrand)) errors.push(`${id}: sub-brand "${p.subbrand}" has no folder in brand/subbrands`);
    else used.add(p.subbrand); // several projects may share one sub-brand (e.g. the portfolio site and VirtualVitrine)
  } else if (p.subbrand) errors.push(`${id}: only a sub-brand decision may name a sub-brand`);
}
for (const f of folders) if (!used.has(f)) errors.push(`sub-brand "${f}" is not on any project (add it to brand/projects.json)`);
if (errors.length) {
  console.error(errors.map((e) => `✗ ${e}`).join('\n'));
  process.exit(1);
}
const count = (d) => data.projects.filter((p) => p.decision === d).length;
console.log(`Projects ${data.projects.length} listed · ${count('sub-brand')} sub-brand, ${count('core')} core, ${count('undecided')} undecided, ${count('out')} out of scope, ${count('home')} home.`);
