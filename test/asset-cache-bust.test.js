// R5-03 / GD-11 (Phase 9 gap closure 09-15): cache-bust regression guard.
//
// server.js serves /js and /css with `Cache-Control: public, max-age=2592000`
// (30 days), so a changed client asset only reaches a browser that already
// holds the old copy through a CHANGED `?v=` stamp on the URL that references
// it. Phases 8 and 9 changed client assets without bumping the stamps, so
// every browser that had loaded v2.1.0 would have kept the pre-gap-closure
// client (no version precondition, no conflict dialog) for up to 30 days and
// then met the server's 400 `versionRequired` refusal (T-09-57 / T-09-41).
//
// This test is the guard for that class of mistake. For each asset in the
// FROZEN table below it collects every `/<asset>?v=<stamp>` reference across
// public/**/*.html and public/js/**/*.js (excluding vendored code) and asserts:
//   1. at least one reference exists;
//   2. every reference carries the SAME stamp (a missed page fails, naming it);
//   3. that stamp is numeric and strictly greater than every frozen value for
//      the asset — its stamp at tag v2.1.0 and its stamp just before the
//      gap-closure bump — so a bump can never be silently reverted.
// It also fails on an HTML tag that references a tracked asset with NO stamp.
//
// Phase-10 assets that did not exist at v2.1.0 live in NEW_ASSETS (no floor).
//
// Content-hash automation (stamp derived from file content) is Phase 12
// QUAL-01 and is deliberately NOT built here; this table is replaced by it.
//
// Reads files only and needs no git, so it also runs from a release zip.
// When a new commit changes one of these assets again, bump its stamp on
// every page and raise `before` here to the stamp you are replacing.
//
// node:test — run via `node --test test/asset-cache-bust.test.js`.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');

// asset -> frozen pre-gap-closure stamps. `v21` = value(s) at tag v2.1.0,
// `before` = value(s) in the tree just before the 09-15 bump.
const FROZEN = {
  // login.html carried its own older style.css stamp (1784500010) at v2.1.0.
  '/css/style.css': { v21: [1784600001, 1784500010], before: [1784600001, 1784500010] },
  // 1791628622 = the stamp on all 18 pages before Phase 10 changed transitions.js
  // (10-06: 403 mustChangePassword branch, handshake redirect, account-menu loader).
  '/js/transitions.js': { v21: [1784900002], before: [1784900002, 1791628622] },
  '/js/execution.js': { v21: [1786250900], before: [1786433369] },
  '/js/org.js': { v21: [1784900011], before: [1786433369] },
  '/js/due-diligence.js': { v21: [1784800006], before: [1786427686] },
};

// Phase 10 (accounts & identity) assets. They did not exist at v2.1.0, so they
// have no frozen floor to compare against (the FROZEN table above requires
// non-empty v21/before arrays, and an empty array would make the floor
// -Infinity). They are still held to rules 1-2 and the no-unstamped-HTML-
// reference check: referenced at least once, one consistent numeric stamp.
// account-menu.js / account.css / admin-users.* are referenced from a JS string
// or an HTML tag; the collector scans both public/**/*.html and public/js/**.
// If one of these changes again, bump its stamp everywhere it is referenced;
// when the Phase 12 content-hash automation lands this list goes with FROZEN.
const NEW_ASSETS = [
  '/js/login.js',
  '/js/change-password.js',
  '/js/account-menu.js',
  '/css/account.css',
  '/js/admin-users.js',
  '/css/admin-users.css',
];

function walk(dir, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'vendor' || ent.name === 'node_modules') return;
      walk(full, out);
    } else if (ent.isFile()) {
      out.push(full);
    }
  });
  return out;
}

// public/**/*.html + public/js/**/*.js, vendored code excluded.
const FILES = walk(PUBLIC, []).filter((f) => {
  const rel = path.relative(PUBLIC, f);
  if (f.endsWith('.html')) return true;
  return f.endsWith('.js') && rel.split(path.sep)[0] === 'js';
});

function rel(f) { return path.relative(ROOT, f).split(path.sep).join('/'); }

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function collect(asset) {
  const stamped = new RegExp(escapeRe(asset) + '\\?v=([^"\'\\s>&)]*)', 'g');
  const refs = [];
  FILES.forEach((f) => {
    const src = fs.readFileSync(f, 'utf8');
    let m;
    stamped.lastIndex = 0;
    while ((m = stamped.exec(src)) !== null) refs.push({ file: rel(f), stamp: m[1] });
  });
  return refs;
}

// An HTML src/href that names the asset without any `?v=` stamp.
function unstampedHtmlRefs(asset) {
  const re = new RegExp('(?:src|href)\\s*=\\s*["\']' + escapeRe(asset) + '["\']', 'g');
  const out = [];
  FILES.filter((f) => f.endsWith('.html')).forEach((f) => {
    if (re.test(fs.readFileSync(f, 'utf8'))) out.push(rel(f));
    re.lastIndex = 0;
  });
  return out;
}

Object.keys(FROZEN).forEach((asset) => {
  const frozen = FROZEN[asset];
  const ceiling = Math.max.apply(null, frozen.v21.concat(frozen.before));

  test(`${asset}: referenced, with one consistent stamp strictly newer than its frozen values`, () => {
    const refs = collect(asset);
    assert.ok(refs.length > 0, `no reference to ${asset}?v=<stamp> found under public/`);

    const stamps = Array.from(new Set(refs.map((r) => r.stamp)));
    if (stamps.length !== 1) {
      const by = {};
      refs.forEach((r) => { (by[r.stamp] = by[r.stamp] || []).push(r.file); });
      assert.fail(`${asset} is referenced with ${stamps.length} different stamps — every page must carry the same one:\n` +
        Object.keys(by).map((s) => `  ?v=${s}: ${by[s].join(', ')}`).join('\n'));
    }

    const stamp = stamps[0];
    assert.match(stamp, /^[0-9]+$/, `${asset} stamp "${stamp}" is not numeric (referenced in ${refs.map((r) => r.file).join(', ')})`);
    assert.ok(Number(stamp) > ceiling,
      `${asset} stamp ${stamp} is not strictly greater than its frozen pre-gap-closure value ${ceiling} ` +
      `(v2.1.0: ${frozen.v21.join('/')}, before bump: ${frozen.before.join('/')}) — ` +
      `a browser holding the old copy would not refetch it. Pages: ${refs.map((r) => r.file).join(', ')}`);
  });

  test(`${asset}: no HTML tag references it without a ?v= stamp`, () => {
    const bare = unstampedHtmlRefs(asset);
    assert.deepStrictEqual(bare, [], `${asset} referenced without a ?v= stamp in: ${bare.join(', ')}`);
  });
});

NEW_ASSETS.forEach((asset) => {
  test(`${asset} (phase-10 asset): referenced, with one consistent numeric stamp`, () => {
    const refs = collect(asset);
    assert.ok(refs.length > 0, `no reference to ${asset}?v=<stamp> found under public/`);
    const stamps = Array.from(new Set(refs.map((r) => r.stamp)));
    if (stamps.length !== 1) {
      const by = {};
      refs.forEach((r) => { (by[r.stamp] = by[r.stamp] || []).push(r.file); });
      assert.fail(`${asset} is referenced with ${stamps.length} different stamps — every reference must carry the same one:\n` +
        Object.keys(by).map((st) => `  ?v=${st}: ${by[st].join(', ')}`).join('\n'));
    }
    assert.match(stamps[0], /^[0-9]+$/, `${asset} stamp "${stamps[0]}" is not numeric (referenced in ${refs.map((r) => r.file).join(', ')})`);
  });

  test(`${asset} (phase-10 asset): no HTML tag references it without a ?v= stamp`, () => {
    const bare = unstampedHtmlRefs(asset);
    assert.deepStrictEqual(bare, [], `${asset} referenced without a ?v= stamp in: ${bare.join(', ')}`);
  });
});

test('the frozen table is non-empty and every entry has both pre-bump values', () => {
  const keys = Object.keys(FROZEN);
  assert.ok(keys.length > 0);
  keys.forEach((k) => {
    assert.ok(FROZEN[k].v21.length > 0 && FROZEN[k].before.length > 0, `${k} missing frozen values`);
  });
});
