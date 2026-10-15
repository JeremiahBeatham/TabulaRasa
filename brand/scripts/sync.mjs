#!/usr/bin/env node
// brand:sync — brings a project's copy of the Beatham brand up to a tagged BeathamBase release
// (ADR-0003). The brand is vendored: brand/ is copied into the project and committed there, so a
// project builds offline, on Netlify and in Xcode with no access to BeathamBase.
//
//   npm run brand:sync                          latest brand-v* tag of BeathamBase (else main)
//   npm run brand:sync -- --ref brand-v1.2.0    a specific tag (or branch)
//   npm run brand:sync -- --from ../BeathamBase a local checkout (offline; uses its committed --ref)
//   npm run brand:sync -- --check               exit 1 if brand/ differs from the ref (CI / repo-setup)
//   npm run brand:sync -- --package web/package.json    the project's package.json is in a subfolder
//   npm run brand:sync -- --subbrand handcad    also set package.json beatham.subbrand, and vendor ONLY core + that
//                                               sub-brand (pruned: no site, no other sub-brands, no projects.json),
//                                               so another sub-brand's release is a zero diff here. --full copies all.
//   flags: --full (don't prune), --no-site (skip the guidelines site), --no-docs (skip docs/BRAND.md), --force (overwrite
//          local edits to brand/), --dry-run (show what would change)
//
// What it touches: brand/ (replaced wholesale, minus node_modules and build output),
// brand/SOURCE.json (where it came from), docs/BRAND.md, and package.json (brand:* scripts, the
// style-dictionary devDependency, beatham.subbrand). Projects never edit brand/ — changes go to
// BeathamBase and come back through a sync.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_REPO = 'https://github.com/JeremiahBeatham/BeathamBase.git';
const SKIP = new Set(['node_modules', 'SOURCE.json']);
const SKIP_PATHS = ['site/dist', 'site/node_modules'];
const SCRIPTS = {
  'brand:build': 'node brand/scripts/build.mjs',
  'brand:check': 'node brand/scripts/check.mjs',
  'brand:palettes': 'node brand/scripts/palettes.mjs',
  'brand:sync': 'node brand/scripts/sync.mjs',
  'brand:site': 'npm --prefix brand/site run dev',
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : null;
};

const project = process.cwd();
const git = (args, cwd = project) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const log = (s) => console.log(s);

function fail(msg) {
  console.error(`✗ brand:sync: ${msg}`);
  process.exit(1);
}

// ---------- where from ----------
const from = opt('from');
const source = from ? (fs.existsSync(from) ? `file://${path.resolve(from)}` : from) : DEFAULT_REPO;

function latestTag() {
  try {
    const out = git(['ls-remote', '--tags', '--refs', source, 'brand-v*']);
    const tags = out.split('\n').filter(Boolean).map((l) => l.split('refs/tags/')[1]);
    const v = (t) => t.replace('brand-v', '').split('.').map(Number);
    tags.sort((a, b) => {
      const [x, y] = [v(a), v(b)];
      for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
      return 0;
    });
    return tags.at(-1) ?? null;
  } catch {
    return null;
  }
}
const ref = opt('ref') ?? latestTag() ?? 'main';

// Refuse to run inside BeathamBase itself: it is the source.
if (fs.existsSync(path.join(project, 'brand/core.json')) && !fs.existsSync(path.join(project, 'brand/SOURCE.json'))) {
  try {
    if (/BeathamBase(\.git)?$/.test(git(['remote', 'get-url', 'origin']))) fail('this is BeathamBase — the source of the brand, not a copy. Run it in a project.');
  } catch {
    // no git remote: fall through (a fresh copy of the template)
  }
}

// ---------- fetch the ref ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-sync-'));
try {
  git(['clone', '--quiet', '--depth', '1', '--branch', ref, source, tmp], os.tmpdir());
} catch (err) {
  fail(`couldn't fetch ${ref} from ${source}: ${err.stderr || err.message}`);
}
const commit = git(['rev-parse', 'HEAD'], tmp);
const srcBrand = path.join(tmp, 'brand');
if (!fs.existsSync(path.join(srcBrand, 'core.json'))) fail(`${source}@${ref} has no brand/ folder`);
const version = fs.existsSync(path.join(srcBrand, 'VERSION')) ? fs.readFileSync(path.join(srcBrand, 'VERSION'), 'utf8').trim() : ref;

// ---------- which sub-brand, and what to leave out ----------
const readJson = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const sub =
  opt('subbrand') ?? readJson(path.join(project, opt('package') ?? 'package.json'))?.beatham?.subbrand ?? readJson(path.join(project, 'brand/SOURCE.json'))?.subbrand ?? null;
const prune = !flag('full') && (flag('prune') || Boolean(sub));
if (flag('prune') && !sub) fail('--prune needs a sub-brand: pass --subbrand <name> (use core for none).');
if (prune && sub !== 'core' && !fs.existsSync(path.join(srcBrand, 'subbrands', sub))) fail(`${ref} has no sub-brand "${sub}" (brand/subbrands/${sub}).`);
const keepsSub = (name) => name === sub;
/** Files a pruned copy leaves out: the site, other sub-brands' manifests and outputs, BeathamBase-only data. */
const pruned = (rel) => {
  if (!prune) return false;
  if (rel === 'site' || rel.startsWith('site/')) return true;
  if (rel === 'projects.json' || rel === 'rollout-status.json') return true;
  const m = /^(subbrands|dist)\/([^/]+)(\/|$)/.exec(rel);
  if (!m) return false;
  return m[1] === 'dist' ? !(m[2] === 'core' || keepsSub(m[2])) : !keepsSub(m[2]);
};

// ---------- compare / copy ----------
const noSite = flag('no-site');
const skip = (rel) => SKIP.has(path.basename(rel)) || SKIP_PATHS.some((p) => rel === p || rel.startsWith(`${p}/`)) || (noSite && (rel === 'site' || rel.startsWith('site/')));

function listFiles(root, base = root, out = new Map(), drop = () => false) {
  if (!fs.existsSync(root)) return out;
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    const abs = path.join(root, e.name);
    const rel = path.relative(base, abs);
    if (skip(rel) || drop(rel)) continue;
    if (e.isDirectory()) listFiles(abs, base, out, drop);
    else out.set(rel, abs);
  }
  return out;
}

const destBrand = path.join(project, 'brand');
const want = listFiles(srcBrand, srcBrand, new Map(), pruned);
const have = listFiles(destBrand);
const same = (a, b) => fs.readFileSync(a).equals(fs.readFileSync(b));
const added = [...want.keys()].filter((k) => !have.has(k));
const changed = [...want.keys()].filter((k) => have.has(k) && !same(want.get(k), have.get(k)));
const removed = [...have.keys()].filter((k) => !want.has(k));
const docSrc = path.join(tmp, 'docs/BRAND.md');
const docDest = path.join(project, 'docs/BRAND.md');
const docChanged = !flag('no-docs') && fs.existsSync(docSrc) && (!fs.existsSync(docDest) || !same(docSrc, docDest));

const summary = `${added.length} added, ${changed.length} changed, ${removed.length} removed${docChanged ? ', docs/BRAND.md updated' : ''}`;
if (flag('check') || flag('dry-run')) {
  const current = fs.existsSync(path.join(destBrand, 'SOURCE.json')) ? JSON.parse(fs.readFileSync(path.join(destBrand, 'SOURCE.json'), 'utf8')) : null;
  log(`brand/ here: ${current ? `${current.ref} (${current.commit.slice(0, 7)})` : 'not synced'} · ${ref}: ${commit.slice(0, 7)} (${version})`);
  for (const [label, list] of [['+', added], ['~', changed], ['-', removed]]) list.slice(0, 40).forEach((f) => log(`  ${label} brand/${f}`));
  if (docChanged) log('  ~ docs/BRAND.md');
  log(summary);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(flag('check') && (added.length || changed.length || removed.length || docChanged) ? 1 : 0);
}

// Local edits to brand/ would be lost: refuse unless --force.
try {
  const dirty = git(['status', '--porcelain', '--', 'brand', 'docs/BRAND.md']);
  if (dirty && !flag('force')) fail(`brand/ has uncommitted changes — commit or discard them first (or --force):\n${dirty}`);
} catch {
  // not a git repo: nothing to protect
}

for (const rel of removed) {
  fs.rmSync(path.join(destBrand, rel));
  for (let dir = path.dirname(path.join(destBrand, rel)); dir !== destBrand && fs.existsSync(dir) && fs.readdirSync(dir).length === 0; dir = path.dirname(dir)) fs.rmdirSync(dir);
}
for (const rel of [...added, ...changed]) {
  const dest = path.join(destBrand, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(want.get(rel), dest);
}
fs.writeFileSync(
  path.join(destBrand, 'SOURCE.json'),
  JSON.stringify({ $description: 'Written by brand:sync — where this copy of the Beatham brand came from. Do not edit brand/ here; change BeathamBase and sync.', repo: source.startsWith('file://') ? DEFAULT_REPO : source, ref, commit, version, subbrand: sub ?? null, pruned: prune, syncedAt: new Date().toISOString().slice(0, 10) }, null, 2) + '\n',
);
if (docChanged) {
  fs.mkdirSync(path.dirname(docDest), { recursive: true });
  fs.copyFileSync(docSrc, docDest);
}

// ---------- package.json ----------
// --package web/package.json: the project's package.json is not at the repo root (HandStack web/,
// Confident confident-web/). The scripts then reach brand/ through a relative path.
const pkgPath = path.join(project, opt('package') ?? 'package.json');
const up = path.relative(path.dirname(pkgPath), project);
const through = (cmd) => (up ? cmd.replace(/brand\//g, `${up}/brand/`) : cmd);
if (fs.existsSync(pkgPath)) {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const srcPkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
  pkg.scripts = { ...(pkg.scripts ?? {}) };
  for (const [k, v] of Object.entries(SCRIPTS)) pkg.scripts[k] ??= through(v);
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), 'style-dictionary': srcPkg.devDependencies['style-dictionary'] };
  pkg.beatham = { ...(pkg.beatham ?? {}), subbrand: sub ?? 'core' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
} else {
  log('  (no package.json: this project consumes brand/dist directly — add brand/dist/<sub-brand>/Tokens.swift and brand/fonts to the Xcode target; or pass --package <path> if its package.json is in a subfolder)');
}
fs.rmSync(tmp, { recursive: true, force: true });

log(`✓ brand synced to ${ref} (${commit.slice(0, 7)}, ${version}): ${summary}.`);
log('  Next: npm install && npm run brand:check, then commit brand/ (and package.json).');
