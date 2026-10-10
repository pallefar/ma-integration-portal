// Evidence helper for 12-14 (verify.log): builds a SYNTHETIC store-driven deal in an os.tmpdir() scratch tree
// (never the developer's real audit file), archives it, seals it through scripts/audit-admin.js, exports it, and
// verifies the whole tree with scripts/audit-verify.js --all and the export with --jsonl.
//
//   node verify-scratch-deal.js <repo-root>
//
// Exit 0 only when every step behaves as the Phase 12 contract says (seal exit 0, `sealed-sha=match`, export verifies,
// purge refused retention-never). Absolute paths are replaced by <repo> / <scratch> in everything printed.
'use strict';
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(process.argv[2] || process.cwd());
process.chdir(ROOT);
const { createScratch } = require(path.join(ROOT, 'scripts/perf/lib/scratch-deal.js'));
const scratch = createScratch({ prefix: 'gsd-12-14-verify-' });
process.once('SIGINT', () => { scratch.cleanup().finally(() => process.exit(130)); });
process.once('SIGTERM', () => { scratch.cleanup().finally(() => process.exit(143)); });

function clean(s) {
  let out = String(s || '');
  if (scratch.tmpDir) out = out.split(scratch.tmpDir).join('<scratch>');
  return out.split(ROOT).join('<repo>');
}
const say = (s) => console.log(clean(s));

(async () => {
  let failed = 0;
  const check = (label, ok, extra) => { say(`${ok ? 'PASS' : 'FAIL'} - ${label}${extra ? ' :: ' + extra : ''}`); if (!ok) failed += 1; };
  try {
    const setup = await scratch.setup({ username: 'verify-il', role: 'hrbp' });
    const dealId = setup.dealId;
    const store = require(path.join(ROOT, 'db/store.js'));
    const resolver = require(path.join(ROOT, 'db/resolver.js'));
    const controlStore = require(path.join(ROOT, 'db/controlStore.js'));
    const auditHook = require(path.join(ROOT, 'db/auditHook.js'));

    // Audited writes through the real store (the same path a request takes).
    const fakeReq = { baseUrl: '/api', path: '/whatever', portalUser: { username: 'verify-il', role: 'hrbp', dealId, sessionId: 'sess_verify' } };
    const WRITES = 12;
    for (let i = 0; i < WRITES; i += 1) {
      const resolved = resolver.resolveDatabase(fakeReq);
      const conn = store.getOrOpenConnection(resolved.dbPath, resolved.schemaPath);
      const actor = { username: 'verify-il', role: 'hrbp', sessionId: 'sess_verify' };
      store.runWithDb({ conn, kind: resolved.kind, dealId: resolved.dealId, dbPath: resolved.dbPath, actor, request: { method: 'TEST', path: '/whatever', ip: null } }, () => {
        const db = store.readDb();
        db.alerts = db.alerts.concat([{ id: `alert_verify_${i}`, title: `synthetic evidence alert ${i}`, severity: 'low' }]);
        store.writeDb(db);
      });
    }
    say(`scratch deal ${dealId}: ${WRITES} audited writes through db/store.js`);
    controlStore.archiveDeal(dealId);
    say('deal archived (control plane)');
    try { auditHook.closeAuditConnection(); } catch (e) { /* ignore */ }

    const env = Object.assign({}, process.env, { MA_MODE: 'real' });
    const run = (script, args) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script)].concat(args), { env, encoding: 'utf8', cwd: ROOT });

    const refused = run('audit-admin.js', ['seal', dealId, '--confirm', 'deal_wrong']);
    check('seal with a mismatched --confirm is a usage error (exit 2)', refused.status === 2, `exit ${refused.status}`);

    const sealed = run('audit-admin.js', ['seal', dealId, '--confirm', dealId]);
    say(`$ audit-admin.js seal <deal> --confirm <deal>\n${sealed.stdout.trim()}${sealed.stderr ? '\n' + sealed.stderr.trim() : ''}\nexit=${sealed.status}`);
    check('audit-admin seal exit 0 with a sha256', sealed.status === 0 && /sha256=[0-9a-f]{64}/.test(sealed.stdout), `exit ${sealed.status}`);

    const verifyDeal = run('audit-verify.js', ['--deal', dealId]);
    say(`$ audit-verify.js --deal <deal>\n${verifyDeal.stdout.trim()}${verifyDeal.stderr ? '\n' + verifyDeal.stderr.trim() : ''}\nexit=${verifyDeal.status}`);
    check('audit-verify --deal exit 0 and sealed-sha=match', verifyDeal.status === 0 && /sealed-sha=match/.test(verifyDeal.stdout), `exit ${verifyDeal.status}`);

    const verifyAll = run('audit-verify.js', ['--all']);
    say(`$ audit-verify.js --all\n${verifyAll.stdout.trim()}${verifyAll.stderr ? '\n' + verifyAll.stderr.trim() : ''}\nexit=${verifyAll.status}`);
    check('audit-verify --all exit 0 (control log + partition)', verifyAll.status === 0, `exit ${verifyAll.status}`);
    check('audit-verify --all reports sealed-sha=match for the sealed partition', /sealed-sha=match/.test(verifyAll.stdout));

    const out = path.join(scratch.tmpDir, 'export.jsonl');
    const exp = run('audit-admin.js', ['export', dealId, '--out', out]);
    say(`$ audit-admin.js export <deal> --out <file>\n${exp.stdout.trim()}${exp.stderr ? '\n' + exp.stderr.trim() : ''}\nexit=${exp.status}`);
    check('audit-admin export exit 0', exp.status === 0, `exit ${exp.status}`);
    const verifyJsonl = run('audit-verify.js', ['--jsonl', out]);
    say(`$ audit-verify.js --jsonl <file>\n${verifyJsonl.stdout.trim()}${verifyJsonl.stderr ? '\n' + verifyJsonl.stderr.trim() : ''}\nexit=${verifyJsonl.status}`);
    check('audit-verify --jsonl of the export exit 0', verifyJsonl.status === 0, `exit ${verifyJsonl.status}`);

    const purge = run('audit-admin.js', ['purge', dealId, '--confirm', dealId]);
    say(`$ audit-admin.js purge <deal> --confirm <deal>\n${purge.stdout.trim()}${purge.stderr ? '\n' + purge.stderr.trim() : ''}\nexit=${purge.status}`);
    check('purge is refused (retention never elapses by default): exit 1, retention-never', purge.status === 1 && /retention-never/.test(purge.stderr + purge.stdout), `exit ${purge.status}`);
    check('the sealed partition file still exists after the refusal', fs.existsSync(path.join(path.dirname(process.env.MA_AUDIT_DB_PATH), 'audit', dealId + '.db')));

    // Tamper evidence on a COPY: flip one byte inside the exported JSONL's first data row and verify must fail.
    const raw = fs.readFileSync(out, 'utf8').split('\n');
    const idx = raw.findIndex((l, i) => i > 0 && l.indexOf('synthetic evidence alert') !== -1);
    if (idx > 0) {
      raw[idx] = raw[idx].replace('synthetic evidence alert', 'synthetic evidence alerT');
      const tampered = path.join(scratch.tmpDir, 'export-tampered.jsonl');
      fs.writeFileSync(tampered, raw.join('\n'), { mode: 0o600 });
      const bad = run('audit-verify.js', ['--jsonl', tampered]);
      say(`$ audit-verify.js --jsonl <tampered copy>\n${bad.stdout.trim()}${bad.stderr ? '\n' + bad.stderr.trim() : ''}\nexit=${bad.status}`);
      check('a one-byte edit of an exported row fails verification (exit 1)', bad.status === 1, `exit ${bad.status}`);
    } else {
      check('export contains a row to tamper with', false);
    }
  } catch (e) {
    failed += 1;
    say('FAIL - harness error: ' + (e && e.stack || e));
  } finally {
    await scratch.cleanup();
  }
  say(failed ? `VERIFY FAIL (${failed})` : 'VERIFY PASS');
  process.exit(failed ? 1 : 0);
})();
