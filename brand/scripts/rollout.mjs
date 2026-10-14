#!/usr/bin/env node
// brand:rollout — brings every adopted project up to the latest brand release, one PR each.
//
//   npm run brand:rollout                       status board (--plan, the default): who is behind the latest tag
//   npm run brand:rollout -- --apply            for each repo that is behind: pruned brand:sync, its checks,
//                                               push brand/sync-<version>, open a PR with a token diff
//   npm run brand:rollout -- --apply --dry-run  do everything except push and open PRs (shows the diff size)
//   flags:  --tag brand-vX.Y.Z   release to roll out (default: the latest brand-v* tag of this checkout)
//           --ref <branch>       roll out a branch instead of a tag (testing)
//           --only A,B           limit to these repos
//           --local <dir>        use clones at <dir>/<Repo> instead of GitHub (testing, no `gh` needed, no push)
//           --no-write           don't update brand/rollout-status.json
//           --verbose            print each PR's title and body (with --apply --dry-run)
//
// Which repos: brand/projects.json entries with rollout.adopted = true. Each names its sub-brand
// (project.subbrand, or rollout.subbrand to override), base branch (rollout.base, default main) and
// check commands (rollout.checks). Needs `git` and the GitHub CLI `gh` (logged in) unless --local.
// It only touches brand/, docs/BRAND.md and the brand:* scripts + one devDependency in package.json.
// It never edits product code and never merges.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const brandRoot = path.resolve(here, '..');
const baseRepo = path.resolve(brandRoot, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : null;
};
const OWNER = 'JeremiahBeatham';
const apply = flag('apply');
const dry = flag('dry-run') || !apply;
const local = opt('local');
const only = opt('only')?.split(',').map((s) => s.trim().toLowerCase());

const run = (cmd, args, cwd = baseRepo, input) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input }).trim();
const sh = (cmd, cwd) => spawnSync(cmd, { cwd, shell: true, encoding: 'utf8' });
const die = (m) => {
  console.error(`✗ brand:rollout: ${m}`);
  process.exit(1);
};

// ---------- which release ----------
function latestTag() {
  const tags = run('git', ['tag', '--list', 'brand-v*']).split('\n').filter(Boolean);
  const v = (t) => t.replace('brand-v', '').split('.').map(Number);
  tags.sort((a, b) => {
    const [x, y] = [v(a), v(b)];
    for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  });
  return tags.at(-1) ?? null;
}
const ref = opt('ref') ?? opt('tag') ?? latestTag();
if (!ref) die('no brand-v* tag in this checkout. Fetch tags (git fetch --tags) or pass --ref <branch>.');
try {
  run('git', ['rev-parse', '--verify', `${ref}^{commit}`]);
} catch {
  die(`${ref} isn't in this checkout. git fetch --tags, or pass --ref <branch>.`);
}
const commit = run('git', ['rev-parse', `${ref}^{commit}`]);
const version = run('git', ['show', `${ref}:brand/VERSION`]).trim();

// ---------- which repos ----------
const projects = JSON.parse(fs.readFileSync(path.join(brandRoot, 'projects.json'), 'utf8')).projects;
const targets = projects
  .filter((p) => p.repo && p.rollout?.adopted && (!only || only.includes(p.repo.toLowerCase())))
  .map((p) => ({
    repo: p.repo,
    label: p.label,
    sub: p.rollout.subbrand ?? p.subbrand ?? 'core',
    base: p.rollout.base ?? 'main',
    checks: p.rollout.checks ?? [],
  }));
if (!targets.length) {
  console.log('No adopted repos in brand/projects.json (rollout.adopted = true). Nothing to do.');
  process.exit(0);
}

// ---------- what each repo has ----------
function sourceOf(t) {
  try {
    if (local) {
      const f = path.join(local, t.repo, 'brand/SOURCE.json');
      return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
    }
    const raw = run('gh', ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${OWNER}/${t.repo}/contents/brand/SOURCE.json?ref=${t.base}`]);
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

const workdirs = [];
/** Clone the repo, branch off its base and run the pruned sync. Returns the work dir and what changed (SOURCE.json aside). */
function prepare(t) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `rollout-${t.repo}-`));
  workdirs.push(work);
  if (local) run('git', ['clone', '--quiet', path.join(local, t.repo), work], os.tmpdir());
  else run('gh', ['repo', 'clone', `${OWNER}/${t.repo}`, work, '--', '--quiet', '--branch', t.base], os.tmpdir());
  run('git', ['checkout', '--quiet', '-B', `brand/sync-${version}`, local ? 'HEAD' : `origin/${t.base}`], work);
  const out = sh(`node "${path.join(here, 'sync.mjs')}" --from "${baseRepo}" --ref "${ref}" --subbrand ${t.sub} --prune`, work);
  if (out.status !== 0) throw new Error(out.stderr.trim() || out.stdout.trim());
  const changed = run('git', ['status', '--porcelain'], work)
    .split('\n')
    .filter((l) => l && !/brand\/SOURCE\.json$/.test(l));
  return { work, changed };
}

const status = targets.map((t) => {
  const src = sourceOf(t);
  const row = { ...t, has: src?.ref ?? null, hasVersion: src?.version ?? null, work: null, error: null };
  if (src && src.commit === commit) return { ...row, state: 'current' };
  if (!src) return { ...row, state: 'not-vendored' };
  try {
    const prep = prepare(t);
    if (flag('verbose') && prep.changed.length) console.log(`  ${t.repo} changed:\n${prep.changed.map((l) => `    ${l}`).join('\n')}`);
    return { ...row, state: prep.changed.length ? 'behind' : 'unaffected', work: prep.work };
  } catch (err) {
    return { ...row, state: 'error', error: String(err.message).split('\n')[0] };
  }
});

const pad = (s, n) => String(s).padEnd(n);
const wide = Math.max(8, ...status.map((s) => String(s.has ?? '—').length)) + 2;
console.log(`\nBrand release: ${ref} (${version}, ${commit.slice(0, 7)})\n`);
console.log(`${pad('Repo', 22)}${pad('Sub-brand', 16)}${pad('Has', wide)}Status`);
const WORDS = { current: 'current', behind: 'BEHIND (has changes for it)', unaffected: 'unaffected (release changes nothing for it)', 'not-vendored': 'NOT VENDORED', error: 'ERROR' };
for (const s of status) console.log(`${pad(s.repo, 22)}${pad(s.sub, 16)}${pad(s.has ?? '—', wide)}${WORDS[s.state]}${s.error ? `: ${s.error}` : ''}`);

if (!flag('no-write') && !only) {
  fs.writeFileSync(
    path.join(brandRoot, 'rollout-status.json'),
    JSON.stringify({ $description: 'Written by brand:rollout: which release each adopted repo has. Do not edit.', checkedAt: new Date().toISOString().slice(0, 10), latest: { ref, version, commit }, repos: status.map(({ repo, sub, has, hasVersion, state }) => ({ repo, subbrand: sub, ref: has, version: hasVersion, state })) }, null, 2) + '\n',
  );
}
const cleanup = () => workdirs.forEach((w) => fs.rmSync(w, { recursive: true, force: true }));
if (!apply) {
  cleanup();
  console.log('\n(plan only: --apply opens a PR in each repo that is BEHIND or NOT VENDORED)');
  process.exit(0);
}

// ---------- apply ----------
/** What changed in this sub-brand's tokens, for the PR body: reads dist/<sub>/tokens.json before and after. */
function tokenDiff(dir, sub) {
  const rel = `brand/dist/${sub}/tokens.json`;
  let before = {};
  try {
    for (const t of JSON.parse(run('git', ['show', `HEAD:${rel}`], dir)).tokens) before[t.key] = JSON.stringify(t.values);
  } catch {
    before = null;
  }
  const after = {};
  const f = path.join(dir, rel);
  if (fs.existsSync(f)) for (const t of JSON.parse(fs.readFileSync(f, 'utf8')).tokens) after[t.key] = JSON.stringify(t.values);
  if (!before) return { added: Object.keys(after), changed: [], removed: [], first: true };
  return {
    added: Object.keys(after).filter((k) => !(k in before)),
    changed: Object.keys(after).filter((k) => k in before && before[k] !== after[k]),
    removed: Object.keys(before).filter((k) => !(k in after)),
    first: false,
  };
}
const list = (a) => (a.length ? a.slice(0, 25).map((k) => `- \`${k}\``).join('\n') + (a.length > 25 ? `\n- … and ${a.length - 25} more` : '') : '_none_');

let opened = 0;
const problems = status.filter((x) => x.state === 'error').map((x) => `${x.repo}: ${x.error}`);
for (const s of status.filter((x) => x.state === 'behind' || x.state === 'not-vendored')) {
  console.log(`\n▸ ${s.repo} (${s.sub})`);
  try {
    const work = s.work ?? prepare(s).work;
    if (!run('git', ['status', '--porcelain'], work)) {
      console.log('  nothing changed for this sub-brand: no PR.');
      continue;
    }
    const diff = tokenDiff(work, s.sub);
    const hasPkg = fs.existsSync(path.join(work, 'package.json'));
    const checks = s.checks.length ? s.checks : hasPkg ? ['npm install --no-audit --no-fund', 'npm run brand:check'] : [];
    for (const c of checks) {
      const r = sh(c, work);
      if (r.status !== 0) throw new Error(`check failed: ${c}\n${(r.stdout + r.stderr).split('\n').slice(-12).join('\n')}`);
    }
    // npm install may have rewritten the lockfile: that is part of the update, keep it
    const breaking = diff.removed.length > 0;
    const title = `Brand ${version}: sync ${s.sub}${breaking ? ' (breaking)' : ''}`;
    const body = `Brand release \`${ref}\` (${version}, \`${commit.slice(0, 7)}\`) for sub-brand **${s.sub}**. Vendored with \`brand:sync --prune\`: only \`brand/\`, \`docs/BRAND.md\` and the \`brand:*\` scripts changed. No product code is touched.\n\n${diff.first ? "**First sync of this sub-brand's outputs.**\n\n" : ''}**Tokens added**\n${list(diff.added)}\n\n**Tokens changed**\n${list(diff.changed)}\n\n**Tokens removed or renamed**${breaking ? ' (**breaking**: search this repo for them)' : ''}\n${list(diff.removed)}\n\nReview and merge. Generated by \`npm run brand:rollout\` in BeathamBase.`;
    run('git', ['add', '-A'], work);
    run('git', ['commit', '--quiet', '-m', `chore: brand ${version} (${s.sub})\n\nGenerated by brand:rollout from ${ref} (${commit.slice(0, 7)}).`], work);
    const stat = run('git', ['diff', '--shortstat', 'HEAD~1', 'HEAD'], work);
    if (dry || local) {
      if (flag('verbose')) console.log(`\n  PR title: ${title}\n  ----\n${body.split('\n').map((l) => `  ${l}`).join('\n')}\n  ----`);
      console.log(`  ${dry ? 'dry run' : 'local'}: ${stat} · +${diff.added.length} ~${diff.changed.length} -${diff.removed.length} tokens${breaking ? ' · BREAKING' : ''} · not pushed`);
      continue;
    }
    run('git', ['push', '--quiet', '-u', 'origin', `brand/sync-${version}`], work);
    if (breaking) sh(`gh label create brand-breaking --force --color B60205 --repo ${OWNER}/${s.repo}`, work);
    const url = run('gh', ['pr', 'create', '--repo', `${OWNER}/${s.repo}`, '--base', s.base, '--head', `brand/sync-${version}`, '--title', title, '--body-file', '-', ...(breaking ? ['--label', 'brand-breaking'] : [])], work, body);
    console.log(`  opened ${url}`);
    opened++;
  } catch (err) {
    problems.push(`${s.repo}: ${String(err.message).split('\n')[0]}`);
    console.error(`  ✗ ${String(err.message).split('\n').slice(0, 14).join('\n    ')}`);
  }
}
cleanup();
console.log(`\nDone: ${opened} PR${opened === 1 ? '' : 's'} opened${problems.length ? `, ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n  ${problems.join('\n  ')}` : '.'}`);
process.exit(problems.length ? 1 : 0);
