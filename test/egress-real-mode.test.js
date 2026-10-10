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

test('real mode: POST /api/rag/upload is 404 for every caller (unauthenticated, hrbp, admin), spelling variants included', async () => {
  const s = await startServer({ dir: fs.mkdtempSync(path.join(DIR, 'rag-')), mode: 'real' });
  try {
    const body = { fileName: 'x.pdf', fileData: 'data:application/pdf;base64,JVBERi0=' };
    for (const token of [undefined, 'hrbp', 'admin']) {
      const res = await s.request('/api/rag/upload', { method: 'POST', body, token });
      assert.strictEqual(res.status, 404, `caller ${token || 'anonymous'}`);
      assert.deepStrictEqual(res.body, { error: 'Not found' });
    }
    const slash = await s.request('/api/rag/upload/', { method: 'POST', body, token: 'hrbp' });
    assert.strictEqual(slash.status, 404);
    const dbl = await s.request('/api//rag/upload', { method: 'POST', body, token: 'admin' });
    assert.strictEqual(dbl.status, 404);
  } finally {
    await s.stop();
  }
});
