'use strict';
// D-10-01 / D-10-02 / D-10-06 / D-10-10 (Phase 10, plan 08): the mode contract is
// only real if the SHIPPED launcher sets it, and operators can only run it if the
// documents name the contract items the server actually implements. Static,
// no server boot: these are launcher scripts and prose.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Lines that are not comments in the respective shell dialect.
function codeLines(src, commentPrefixes) {
  return src.split(/\r?\n/).filter((l) => {
    const t = l.trim();
    return t && !commentPrefixes.some((p) => t.toLowerCase().startsWith(p));
  });
}

test('launchers: start-real-deal.command exports MA_MODE=real before exec and points at bootstrap-admin', () => {
  const src = read('start-real-deal.command');
  const lines = codeLines(src, ['#']);
  const exportIdx = lines.findIndex((l) => /^export\s+MA_MODE=real\s*$/.test(l.trim()));
  const execIdx = lines.findIndex((l) => /^exec\s+.*server\.js/.test(l.trim()));
  assert.ok(exportIdx >= 0, 'export MA_MODE=real must be an executable line');
  assert.ok(execIdx > exportIdx, 'MA_MODE=real must be exported before exec node server.js');
  assert.ok(/scripts\/bootstrap-admin\.js/.test(src), 'banner must point first-run operators at bootstrap-admin');
  assert.ok(!/set-admin-password/.test(src), 'a zero-account host must not be told to run set-admin-password');
  assert.ok(!lines.some((l) => /DEMO_OPEN\s*=\s*1/.test(l)), 'real-deal launcher must not set DEMO_OPEN');
  assert.ok(!/MA_BOOTSTRAP_PASSWORD=\S/.test(src), 'no password value may be embedded in the launcher');
  // IN-C01: an inherited DEMO_OPEN is cleared after MA_MODE=real, before the server starts.
  const unsetIdx = lines.findIndex((l) => /^unset\s+DEMO_OPEN\s*$/.test(l.trim()));
  assert.ok(unsetIdx > exportIdx && unsetIdx < execIdx, 'unset DEMO_OPEN must sit between export MA_MODE=real and exec');
});

test('DEPLOYMENT.md (IN-C02): Self-service wording matches account-menu.js dev/demo gating', () => {
  const doc = read('DEPLOYMENT.md');
  const menu = read(path.join('public', 'js', 'account-menu.js'));
  assert.ok(!/Both are\s+disabled/.test(doc), 'the doc must not claim My sessions is disabled');
  assert.match(doc, /\*\*Change password\*\*\s+is\s+disabled with an explanatory note/);
  assert.match(doc, /\*\*My sessions\*\* still lists your sessions but\s+offers no \*\*End session\*\*/);
  // the code behaviour the sentence documents
  assert.match(menu, /if \(state\.writable\) \{\s*var end = el\('button', 'btn btn-secondary am-session-end', 'End session'\)/);
  assert.match(menu, /if \(!state\.writable\) wrap\.appendChild\(el\('p', 'am-note', READ_ONLY_NOTE\)\)/);
});

test('launchers (IN-C01): start-real-deal.command really clears an inherited DEMO_OPEN', () => {
  const { spawnSync } = require('child_process');
  const src = read('start-real-deal.command');
  const lines = codeLines(src, ['#']);
  const start = lines.findIndex((l) => /^export\s+MA_MODE=real\s*$/.test(l.trim()));
  const unset = lines.findIndex((l) => /^unset\s+DEMO_OPEN\s*$/.test(l.trim()));
  const snippet = lines.slice(start, unset + 1).join('\n') + '\nprintf "%s|%s" "$MA_MODE" "${DEMO_OPEN-UNSET}"';
  const out = spawnSync('/bin/sh', ['-c', snippet], { env: { PATH: process.env.PATH, DEMO_OPEN: '1' }, encoding: 'utf8' });
  assert.strictEqual(out.stdout, 'real|UNSET');
});

test('launchers: start-real-deal.bat sets MA_MODE=real before node and points at bootstrap-admin', () => {
  const src = read('start-real-deal.bat');
  const lines = codeLines(src, ['rem ', '::']);
  const setIdx = lines.findIndex((l) => /^set\s+"MA_MODE=real"\s*$/i.test(l.trim()));
  const runIdx = lines.findIndex((l) => /^"%NODE_CMD%"\s+server\.js\s*$/i.test(l.trim()));
  assert.ok(setIdx >= 0, 'set "MA_MODE=real" must be an executable line');
  assert.ok(runIdx > setIdx, 'MA_MODE=real must be set before node server.js runs');
  assert.ok(/scripts\\bootstrap-admin\.js/.test(src), 'banner must point first-run operators at bootstrap-admin');
  assert.ok(!/set-admin-password/.test(src), 'a zero-account host must not be told to run set-admin-password');
  // IN-C01: the only DEMO_OPEN line allowed is the one that CLEARS it.
  assert.ok(!lines.some((l) => /set\s+"?DEMO_OPEN=[^"\s]/i.test(l)), 'real-deal launcher must not set DEMO_OPEN to a value');
  const clearIdx = lines.findIndex((l) => /^set\s+"DEMO_OPEN="\s*$/i.test(l.trim()));
  assert.ok(clearIdx > setIdx && clearIdx < runIdx, 'set "DEMO_OPEN=" must sit between set "MA_MODE=real" and node server.js');
});

test('launchers: the demo launchers are unchanged — they never mention MA_MODE', () => {
  for (const f of ['start.command', 'start.bat']) {
    const src = read(f);
    assert.ok(!/MA_MODE/.test(src), `${f} must not mention MA_MODE`);
    assert.ok(/DEMO_OPEN/.test(src), `${f} remains the DEMO_OPEN=1 launcher`);
  }
});

test('DEPLOYMENT.md names every operator contract item the server implements', () => {
  const doc = read('DEPLOYMENT.md');
  for (const needle of [
    'MA_MODE=real', 'MA_DATA_DIR', 'bootstrap-admin', '--force-reset-admin',
    'TRUST_PROXY', 'PUBLIC_BASE_URL', 'ENABLE_HSTS', 'HSTS_INCLUDE_SUBDOMAINS',
    '0600', 'Users', 'restart', 'accountsWritable', 'ADMIN_TOKEN', 'MA_BOOTSTRAP_PASSWORD',
    'credentialLockdown', 'set-admin-password.js', 'DEMO_OPEN',
  ]) {
    assert.ok(doc.includes(needle), `DEPLOYMENT.md must mention ${needle}`);
  }
  // First-run section names bootstrap-admin before set-admin-password.
  assert.ok(doc.indexOf('bootstrap-admin') < doc.indexOf('set-admin-password.js'),
    'the first-run section must name bootstrap-admin before set-admin-password');
  // The stale one-mode-pair framing and the old first-run advice are gone.
  assert.ok(!/Rotate the admin password before the first login/i.test(doc));
  // ADMIN_TOKEN is presented as discouraged break-glass, never as the way in.
  assert.ok(/ADMIN_TOKEN[\s\S]{0,400}discouraged|discouraged[\s\S]{0,400}ADMIN_TOKEN/i.test(doc));
  // TRUST_PROXY guidance: integer hop count, no subnet.
  assert.ok(/integer hop count/i.test(doc));
});

test('DEPLOYMENT.md operator values agree with the code (env names, flags, limits)', () => {
  const doc = read('DEPLOYMENT.md');
  const server = read('server.js');
  const boot = read('scripts/bootstrap-admin.js');
  const setPw = read('scripts/set-admin-password.js');
  const dbFiles = read('db/dbFiles.js');
  for (const env of ['TRUST_PROXY', 'PUBLIC_BASE_URL', 'ENABLE_HSTS', 'HSTS_INCLUDE_SUBDOMAINS', 'ADMIN_TOKEN']) {
    assert.ok(server.includes(`process.env.${env}`), `server.js reads ${env}`);
  }
  assert.ok(dbFiles.includes('MA_DATA_DIR'));
  assert.ok(boot.includes('MA_BOOTSTRAP_PASSWORD') && boot.includes("'--force-reset-admin'"));
  assert.ok(setPw.includes('process.env.ADMIN_PASSWORD'), 'the doc names ADMIN_PASSWORD for set-admin-password');
  assert.ok(doc.includes('ADMIN_PASSWORD'));
  assert.ok(doc.includes('X-Admin-Token') && server.includes("'X-Admin-Token'"));
});

test('README.md states all three modes and points at DEPLOYMENT.md', () => {
  const doc = read('README.md');
  assert.ok(/\*\*demo\*\*/i.test(doc), 'README names demo mode');
  assert.ok(/\*\*dev\*\*/i.test(doc), 'README names dev mode');
  assert.ok(/\*\*real-deal\*\*/i.test(doc), 'README names real-deal mode');
  assert.ok(doc.includes('DEPLOYMENT.md'));
  assert.ok(doc.includes('bootstrap-admin'));
  assert.ok(!/db\.json/.test(doc), 'stale db.json storage note removed');
});
