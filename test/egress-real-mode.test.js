'use strict';
// SAFE-06 / D-13-05 (plan 13-02): real-deal mode defaults - NO third-party
// origin in any CSP directive, until an admin switches a channel on. The server
// runs as a MA_MODE=real child on a temp MA_DATA_DIR (never data/real).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, parseCsp } = require('./helpers/egress-server');

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-egress-real-'));
test.after(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch (e) { /* ignore */ } });

function cspOf(res) { return parseCsp(res.headers.get('content-security-policy')); }

test('real mode, nothing stored: the page CSP carries no https: origin at all; admin can opt a channel in', async () => {
  const s = await startServer({ dir: DIR, mode: 'real' });
  try {
    const page = await s.request('/login.html');
    assert.strictEqual(page.status, 200);
    const raw = page.headers.get('content-security-policy');
    assert.ok(raw, 'a CSP header is present');
    assert.ok(!/https?:/.test(raw), `real-mode CSP must list no http(s) origin: ${raw}`);
    assert.ok(!/googleapis|gstatic|youtube|huggingface/.test(raw));

    const snap = await s.request('/api/admin/egress', { token: 'admin' });
    assert.strictEqual(snap.status, 200);
    assert.strictEqual(snap.body.mode, 'real');
    assert.deepStrictEqual(snap.body.defaults, { gemini: false, huggingface: false, youtube: false });
    assert.deepStrictEqual(snap.body.effective, { gemini: false, huggingface: false, youtube: false });

    // explicit admin decision turns exactly one channel on
    const on = await s.request('/api/admin/egress', { method: 'POST', body: { youtube: true }, token: 'admin' });
    assert.strictEqual(on.status, 200);
    const c = cspOf(await s.request('/login.html'));
    assert.ok(c['frame-src'].includes('https://www.youtube.com'));
    assert.deepStrictEqual(c['connect-src'], ["'self'"], 'huggingface stays off');
    assert.ok(!c['script-src'].some((t) => /^https:/.test(t)));
  } finally {
    await s.stop();
  }
});
