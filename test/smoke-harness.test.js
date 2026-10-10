// QUAL-02 / D-12-08 (Phase 12, plan 07): static guard for the browser smoke
// harness (scripts/smoke/). It NEVER launches a browser or a server — the live
// run is `npm run smoke`, executed outside `node --test`.
//
// Proves: the page registry covers the first Integration-Lead pages at both
// widths, the harness is export-ignored (never in release zips), neither
// Playwright nor axe-core became a repo dependency, tool resolution works from
// outside the repo, and a missing tool exits 2 with the documented fix.
//
// node:test — Node's built-in runner, zero new dependency.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const SMOKE_DIR = path.join(REPO_ROOT, 'scripts', 'smoke');
const RUNNER = path.join(SMOKE_DIR, 'run.js');
const pages = require(path.join(SMOKE_DIR, 'pages.js'));
const { resolveTool } = require(RUNNER);

function mkTmp(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-test-' + tag + '-'));
}

function fakePackage(dir, name, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: version || '9.9.9' }));
}

test('page registry: the first IL pages + admin Users, each at 1440 and 390', () => {
  const byName = Object.fromEntries(pages.map((p) => [p.name, p]));
  ['login', 'dashboard', 'execution', 'due-diligence', 'org', 'admin-users'].forEach((n) => {
    assert.ok(byName[n], 'registry must contain ' + n);
    assert.deepStrictEqual(byName[n].widths, [1440, 390], n + ' must be visited at 1440 and 390');
    assert.match(byName[n].path, /^\/[a-z-]+\.html$/, n + ' path');
    assert.ok(['anonymous', 'il', 'admin'].includes(byName[n].as), n + ' as');
  });
  assert.strictEqual(byName.login.as, 'anonymous');
  assert.strictEqual(byName['admin-users'].as, 'admin');
  assert.strictEqual(typeof byName['admin-users'].afterLoad, 'function', 'admin-users opens the Users tab via afterLoad');
  ['dashboard', 'execution', 'due-diligence', 'org'].forEach((n) => assert.strictEqual(byName[n].as, 'il', n + ' runs as the IL'));
  assert.strictEqual(new Set(pages.map((p) => p.name)).size, pages.length, 'page names are unique');
});

test('release exclusion: .gitattributes export-ignores scripts/smoke/', () => {
  const attrs = fs.readFileSync(path.join(REPO_ROOT, '.gitattributes'), 'utf8');
  assert.match(attrs, /^scripts\/smoke\/\s+export-ignore\s*$/m);
  // Ask git itself (reads the working-tree .gitattributes); skip if git is absent.
  const r = spawnSync('git', ['check-attr', 'export-ignore', '--', 'scripts/smoke/'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.error || r.status !== 0) return;
  assert.match(r.stdout, /export-ignore: set/, 'git must resolve export-ignore for scripts/smoke/: ' + r.stdout);
  // ...and prove the effect: an archive of scripts/ (what a release zip is built
  // from) carries none of scripts/smoke/. --worktree-attributes so the check is
  // about THIS tree's .gitattributes even before it is committed.
  const ar = spawnSync('git', ['archive', '--worktree-attributes', '--format=tar', 'HEAD', 'scripts'],
    { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  if (ar.error || ar.status !== 0) return;
  const names = tarNames(ar.stdout);
  assert.ok(names.some((n) => n.indexOf('scripts/') === 0), 'archive of scripts/ is non-empty');
  assert.deepStrictEqual(names.filter((n) => n.indexOf('scripts/smoke') === 0), [], 'scripts/smoke/ must not be in a release archive');
});

// Minimal ustar name reader (512-byte headers): enough to list entry names
// without shelling out to `tar` (portable to the CI image and Windows).
function tarNames(buf) {
  const names = [];
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const end = header.indexOf(0);
    let name = header.subarray(0, end > 0 && end < 100 ? end : 100).toString('utf8');
    const prefixEnd = header.subarray(345, 500).indexOf(0);
    const prefix = header.subarray(345, 345 + (prefixEnd === -1 ? 155 : prefixEnd)).toString('utf8');
    if (prefix) name = prefix + '/' + name;
    const type = String.fromCharCode(header[156]);
    if (type !== 'x' && type !== 'g') names.push(name);
    const size = parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim() || '0', 8);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

test('zero-install: neither Playwright nor axe-core is a repo dependency', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const declared = Object.keys(Object.assign({}, pkg.dependencies, pkg.devDependencies, pkg.optionalDependencies, pkg.peerDependencies));
  ['playwright', 'playwright-core', '@playwright/test', 'axe-core', '@axe-core/playwright', 'puppeteer'].forEach((n) => {
    assert.ok(!declared.includes(n), n + ' must not be a repo dependency (resolved from the host instead)');
  });
  ['playwright', 'playwright-core', 'axe-core'].forEach((n) => {
    assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'node_modules', n)), 'node_modules/' + n + ' must not exist');
  });
  assert.strictEqual(pkg.scripts.smoke, 'node scripts/smoke/run.js');
});

test('resolveTool: env path wins, then the npx cache, then null', () => {
  const home = mkTmp('home');
  const elsewhere = mkTmp('env');
  try {
    // 1) env var path wins over an npx-cache copy
    const envDir = path.join(elsewhere, 'axe-core');
    fakePackage(envDir, 'axe-core', '1.2.3');
    fakePackage(path.join(home, '.npm', '_npx', 'abc123', 'node_modules', 'axe-core'), 'axe-core', '4.4.4');
    const viaEnv = resolveTool('axe-core', { env: { AXE_CORE_PATH: envDir }, home, globalRoot: null });
    assert.strictEqual(viaEnv.dir, envDir);
    assert.strictEqual(viaEnv.version, '1.2.3');
    assert.strictEqual(viaEnv.source, 'AXE_CORE_PATH');

    // 2) no env var: the npx-cache directory scan finds the fake package
    const viaNpx = resolveTool('axe-core', { env: {}, home, globalRoot: null });
    assert.strictEqual(viaNpx.dir, path.join(home, '.npm', '_npx', 'abc123', 'node_modules', 'axe-core'));
    assert.strictEqual(viaNpx.version, '4.4.4');
    assert.strictEqual(viaNpx.source, 'npx cache');

    // 3) an env path that is not the right package is skipped (falls through)
    const wrong = path.join(elsewhere, 'not-axe');
    fakePackage(wrong, 'something-else');
    const skipped = resolveTool('axe-core', { env: { AXE_CORE_PATH: wrong }, home, globalRoot: null });
    assert.strictEqual(skipped.source, 'npx cache');

    // 3b) a package-named dir that fails verify() (a half-installed npx-cache
    // entry) is skipped, reported through onSkip, and the next candidate wins
    fakePackage(path.join(home, '.npm', '_npx', 'aaa000', 'node_modules', 'axe-core'), 'axe-core', '0.0.1'); // sorts first
    const skippedDirs = [];
    const verified = resolveTool('axe-core', {
      env: {}, home, globalRoot: null,
      verify: (dir) => dir.indexOf('aaa000') === -1,
      onSkip: (dir) => skippedDirs.push(dir),
    });
    assert.strictEqual(verified.version, '4.4.4');
    assert.strictEqual(skippedDirs.length, 1);

    // 4) nothing anywhere -> null
    assert.strictEqual(resolveTool('playwright', { env: {}, home, globalRoot: null }), null);
    const emptyHome = mkTmp('empty');
    try { assert.strictEqual(resolveTool('axe-core', { env: {}, home: emptyHome, globalRoot: null }), null); }
    finally { fs.rmSync(emptyHome, { recursive: true, force: true }); }
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('missing tool: the CLI exits 2 and prints the documented fix (no server, no browser)', () => {
  const home = mkTmp('nohome');
  const emptyPath = mkTmp('nopath'); // no `npm` -> the global-root lookup finds nothing
  try {
    const env = { PATH: emptyPath, HOME: home, USERPROFILE: home, TMPDIR: os.tmpdir() };
    const r = spawnSync(process.execPath, [RUNNER], { cwd: REPO_ROOT, encoding: 'utf8', env, timeout: 30000 });
    assert.strictEqual(r.status, 2, 'exit code: ' + r.status + ' stderr=' + r.stderr);
    assert.match(r.stderr, /PLAYWRIGHT_PATH/);
    assert.match(r.stderr, /AXE_CORE_PATH/);
    assert.match(r.stderr, /README\.md/);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(emptyPath, { recursive: true, force: true });
  }
});

test('README documents the host-local AXE_CORE_PATH and the informational axe counts', () => {
  const readme = fs.readFileSync(path.join(SMOKE_DIR, 'README.md'), 'utf8');
  assert.match(readme, /AXE_CORE_PATH/);
  assert.match(readme, /host-local/i);
  assert.match(readme, /informational/i);
  assert.match(readme, /pages\.js/);
});
