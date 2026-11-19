#!/usr/bin/env node
// SwiftUI snippets (ported from HandCAD's studio check): for every sub-brand with a mirrored snippet file
// (brand/subbrands/<name>/mirror/design/snippets/*.swift, between `// MARK: snippet <id>` and `// MARK: end`) and pages
// that show them (brand/site/vendor/<name>/):
//   1. every snippet a page shows exists, every snippet in the file is shown, ids are unique;
//   2. the file type-checks against BeathamBase's generated brand/dist/<name>/Tokens.swift (swiftc -typecheck, Swift 6,
//      iOS 17 on the installed iOS SDK), so the brand's Swift serves the product's real code.
// Step 2 needs Xcode; without it (CI, Linux, Workers Builds) it is skipped with a notice, and --strict fails instead.
//   node brand/scripts/check-snippets.mjs [--subbrand <name>] [--strict]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { selectSubbrands, argSubbrand } from './lib/subbrands.mjs';

const strict = process.argv.includes('--strict');
const here = path.dirname(fileURLToPath(import.meta.url));
const brand = path.join(here, '..');

const parse = (source) => {
  const out = {};
  for (const m of source.matchAll(/^\/\/ MARK: snippet (\S+)\n([\s\S]*?)^\/\/ MARK: end$/gm)) out[m[1]] = m[2];
  return out;
};
function usedIn(dir) {
  const used = new Set();
  if (!fs.existsSync(dir)) return used;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!e.isFile() || !/\.jsx?$/.test(e.name)) continue;
    const text = fs.readFileSync(path.join(e.parentPath ?? e.path, e.name), 'utf8');
    for (const m of text.matchAll(/\bswift=\{\[([^\]]*)\]\}/g)) for (const q of m[1].matchAll(/['"]([\w-]+)['"]/g)) used.add(q[1]);
    for (const m of text.matchAll(/(?:\bsnippet=|<SwiftSnippet[^>]*\bid=)"([\w-]+)"/g)) used.add(m[1]);
  }
  return used;
}
let sdk;
function iosSdk() {
  if (sdk !== undefined) return sdk;
  sdk = null;
  if (process.platform === 'darwin') {
    try {
      sdk = execFileSync('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      sdk = null;
    }
  }
  return sdk;
}

let failed = false;
let any = false;
for (const sb of selectSubbrands(argSubbrand())) {
  const dir = path.join(brand, 'subbrands', sb.name, 'mirror', 'design', 'snippets');
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.swift'))) {
    any = true;
    const swiftFile = path.join(dir, file);
    const source = fs.readFileSync(swiftFile, 'utf8');
    const ids = [...source.matchAll(/^\/\/ MARK: snippet (\S+)$/gm)].map((m) => m[1]);
    const snippets = parse(source);
    const used = usedIn(path.join(brand, 'site', 'vendor', sb.name));
    const problems = [];
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) problems.push(`duplicate snippet ids: ${dupes.join(', ')}`);
    if (Object.keys(snippets).length !== ids.length) problems.push('a snippet is missing its `// MARK: end`');
    for (const id of used) if (!snippets[id]) problems.push(`a page shows snippet "${id}", which is not in ${file}`);
    for (const id of ids) if (!used.has(id)) problems.push(`snippet "${id}" is never shown on the brand site`);
    problems.forEach((p) => console.error(`✗ ${sb.name}: ${p}`));
    if (problems.length) {
      failed = true;
      continue;
    }
    const tokens = path.join(brand, 'dist', sb.name, 'Tokens.swift');
    const s = iosSdk();
    if (!s) {
      const msg = `  Snippets ${sb.name.padEnd(15)} ${ids.length} snippets, all shown; swiftc type-check skipped (needs Xcode with the iOS SDK).`;
      if (strict) {
        console.error(`✗${msg.slice(1)}`);
        failed = true;
      } else console.log(msg);
      continue;
    }
    const run = spawnSync('xcrun', ['swiftc', '-typecheck', '-swift-version', '6', '-sdk', s, '-target', 'arm64-apple-ios17.0', tokens, swiftFile], { encoding: 'utf8' });
    const out = `${run.stdout}${run.stderr}`.trim();
    if (run.status !== 0) {
      console.error(out);
      console.error(`✗ Snippets ${sb.name}: ${file} does not type-check against brand/dist/${sb.name}/Tokens.swift (iOS 17, Swift 6).`);
      failed = true;
      continue;
    }
    const warnings = (out.match(/warning:/g) ?? []).length;
    console.log(`  Snippets ${sb.name.padEnd(15)} ${ids.length} snippets, all shown; type-check passed against brand/dist/${sb.name}/Tokens.swift (Swift 6, iOS 17, ${path.basename(s)}, ${warnings} warning(s)).`);
  }
}
if (!any) console.log('  Snippets no sub-brand has mirrored Swift snippets.');
process.exit(failed ? 1 : 0);
