'use strict';
// D-10-08b (Phase 10, plan 09): the credential lockdown serves ONLY
// LOCKDOWN_STATIC_ALLOWLIST. If login.html or change-password.html (or a
// stylesheet they link) starts referencing an asset that is not on that list,
// the locked host would answer it 403 and the remedy page would break exactly
// when it is needed. This test reads the SINGLE source list from
// lib/credentialLockdown.js (never a copy) and the shipped pages, so drift in
// either direction fails here. Files only, no server boot.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { LOCKDOWN_STATIC_ALLOWLIST } = require('../lib/credentialLockdown');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PAGES = ['login.html', 'change-password.html'];

function stripQueryAndHash(ref) {
  return ref.replace(/[?#].*$/, '');
}

// A reference is checked when it is root-relative and not an external, data:,
// protocol-relative or fragment-only URL.
function isCheckedRef(ref) {
  if (!ref) return false;
  if (!ref.startsWith('/')) return false;
  if (ref.startsWith('//')) return false;
  return true;
}

function htmlRefs(html) {
  const out = [];
  const re = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function cssUrls(css) {
  const out = [];
  const re = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
  let m;
  while ((m = re.exec(css)) !== null) out.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
  return out;
}

function stylesheetPaths(html) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) continue;
    const href = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (href) out.push(href[1] !== undefined ? href[1] : href[2]);
  }
  return out;
}

const allow = new Set(LOCKDOWN_STATIC_ALLOWLIST);

test('lockdown allowlist: imported from the single source and non-empty', () => {
  assert.ok(Array.isArray(LOCKDOWN_STATIC_ALLOWLIST) || LOCKDOWN_STATIC_ALLOWLIST.length > 0);
  assert.ok(LOCKDOWN_STATIC_ALLOWLIST.length > 0);
  for (const p of PAGES) assert.ok(allow.has('/' + p), `${p} itself must be on the allowlist`);
});

test('lockdown allowlist: every entry exists under public/ (no stale entry)', () => {
  for (const entry of LOCKDOWN_STATIC_ALLOWLIST) {
    assert.ok(entry.startsWith('/'), `allowlist entry must be root-relative: ${entry}`);
    const file = path.join(PUBLIC_DIR, entry);
    assert.ok(file.startsWith(PUBLIC_DIR + path.sep), `allowlist entry escapes public/: ${entry}`);
    assert.ok(fs.existsSync(file) && fs.statSync(file).isFile(), `allowlist entry missing on disk: ${entry}`);
  }
});

for (const page of PAGES) {
  test(`lockdown allowlist: every root-relative reference in ${page} is allowed and on disk`, () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, page), 'utf8');
    const refs = htmlRefs(html).filter(isCheckedRef).map(stripQueryAndHash);
    assert.ok(refs.length > 0, `${page}: expected at least one asset reference`);
    for (const ref of refs) {
      assert.ok(allow.has(ref), `${page} references ${ref}, which the locked host would refuse (add it to LOCKDOWN_STATIC_ALLOWLIST)`);
      assert.ok(fs.existsSync(path.join(PUBLIC_DIR, ref)), `${page} references ${ref}, which does not exist under public/`);
    }
  });

  test(`lockdown allowlist: root-relative url(...) in stylesheets linked by ${page} are allowed and on disk`, () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, page), 'utf8');
    const sheets = stylesheetPaths(html).filter(isCheckedRef).map(stripQueryAndHash);
    assert.ok(sheets.length > 0, `${page}: expected a linked stylesheet`);
    for (const sheet of sheets) {
      const css = fs.readFileSync(path.join(PUBLIC_DIR, sheet), 'utf8');
      for (const raw of cssUrls(css)) {
        const ref = raw.trim();
        if (!isCheckedRef(ref)) continue; // external https://, data:, relative-without-slash
        const clean = stripQueryAndHash(ref);
        assert.ok(allow.has(clean), `${sheet} (linked by ${page}) references ${clean}, which the locked host would refuse`);
        assert.ok(fs.existsSync(path.join(PUBLIC_DIR, clean)), `${sheet} references ${clean}, which does not exist`);
      }
    }
  });
}

test('lockdown allowlist: the scanners ignore external and data: references (self-check of the harness)', () => {
  const html = '<img src="https://example.com/a.png"><img src="data:image/png;base64,AAAA"><link href="//cdn/x.css">';
  assert.deepStrictEqual(htmlRefs(html).filter(isCheckedRef), []);
  assert.deepStrictEqual(cssUrls('a{background:url("data:image/svg+xml,%3Csvg")} @import url(\'https://f.g/x\');').filter(isCheckedRef), []);
  assert.deepStrictEqual(cssUrls('a{background:url(/te-logo.png?v=1)}').filter(isCheckedRef).map(stripQueryAndHash), ['/te-logo.png']);
});
