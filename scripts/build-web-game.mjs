// Build a Vite web game from its source checkout into <slug>/build/.
//
//   node scripts/build-web-game.mjs <slug> <source-dir>
//
// Works on sources that were written to run from the site root (e.g.
// fetch('/words/x.json')) without changing the source repo:
//   1. Drops platform-locked native packages (e.g. @rollup/rollup-win32-x64-msvc
//      listed as a direct devDependency) so `npm install` works on Linux CI.
//   2. Builds with a relative base (`--base ./`), skipping `tsc` type checks.
//   3. Rewrites root-absolute references to files in public/ ("/words/…",
//      "/fonts/…") into relative ones, so the build works from any subfolder.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [slug, srcArg] = process.argv.slice(2);
if (!slug || !srcArg) {
  console.error('usage: node scripts/build-web-game.mjs <slug> <source-dir>');
  process.exit(1);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const src  = path.resolve(srcArg);
const out  = path.join(root, slug, 'build');
const run  = cmd => execSync(cmd, { cwd: src, stdio: 'inherit' });

// 1. Strip platform-specific native packages from direct dependencies
const pkgPath = path.join(src, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const NATIVE = /^@(rollup\/rollup|esbuild|swc\/core|napi-rs\/[^/]+)-(win32|darwin|linux|android|freebsd|openbsd|sunos)-/;
for (const field of ['dependencies', 'devDependencies']) {
  for (const name of Object.keys(pkg[field] ?? {})) {
    if (NATIVE.test(name)) { delete pkg[field][name]; console.log(`- dropped ${name}`); }
  }
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

// 2. Install + build. The lockfile is dropped (in this build checkout only) so
//    npm resolves the right native optional packages for the current OS —
//    see https://github.com/npm/cli/issues/4828
fs.rmSync(path.join(src, 'package-lock.json'), { force: true });
fs.rmSync(path.join(src, 'node_modules'), { recursive: true, force: true });
run('npm install --no-audit --no-fund');

// Some npm versions still skip Rollup's native optional package — add it if missing
const rollupPkg = path.join(src, 'node_modules', 'rollup', 'package.json');
if (fs.existsSync(rollupPkg)) {
  const { version } = JSON.parse(fs.readFileSync(rollupPkg, 'utf8'));
  const suffix = { win32: '-msvc', linux: '-gnu' }[process.platform] ?? '';
  const native = `@rollup/rollup-${process.platform}-${process.arch}${suffix}`;
  if (!fs.existsSync(path.join(src, 'node_modules', ...native.split('/')))) {
    run(`npm install --no-save --no-audit --no-fund ${native}@${version}`);
  }
}
run(`npx vite build --base ./ --outDir "${out}" --emptyOutDir`);

// 3. Relativize "/<public-entry>/…" references in built HTML/JS
const publicDir = path.join(src, 'public');
const entries = fs.existsSync(publicDir) ? fs.readdirSync(publicDir) : [];
if (entries.length) {
  const names = entries.map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // preceded by a quote, backtick or "(" (url(/…)) → drop the leading slash
  const re = new RegExp(`(["'\`(])/(${names})(?=[/"'\`)?#])`, 'g');
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
  for (const file of walk(out).filter(f => /\.(html|js|css)$/.test(f))) {
    const text = fs.readFileSync(file, 'utf8');
    // CSS url() resolves relative to the stylesheet (assets/), not the page
    const prefix = file.endsWith('.css') ? '../' : '';
    const next = text.replace(re, (_, q, name) => `${q}${prefix}${name}`);
    if (next !== text) { fs.writeFileSync(file, next); console.log(`- relativized ${path.relative(root, file)}`); }
  }
}

console.log(`✓ built ${slug} → ${path.relative(root, out)}`);
