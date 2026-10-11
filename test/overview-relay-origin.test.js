// [security] WR-B03 (Phase 13 review, Part B): the overview.html message relay
// (public/js/pages/overview-1.js) acts only on messages from this origin AND
// from the #deckframe window, and `open-slide` only for a first-party
// /overview-deck/*.html path. The REAL relay script runs under node:vm with a
// stub window/document; simulated message events with the wrong origin, the
// wrong source or an off-portal URL are ignored.
//
// node:test — run via `node --test test/overview-relay-origin.test.js`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pages', 'overview-1.js'), 'utf8');
const ORIGIN = 'https://portal.test';

function boot() {
  const listeners = [];
  const classes = new Set();
  const opened = [];
  const deckWindow = { name: 'deck' };
  const ctx = {
    document: {
      getElementById: (id) => (id === 'deckframe' ? { contentWindow: deckWindow } : null),
      body: { classList: { toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); } } },
    },
  };
  ctx.window = ctx;
  ctx.location = { origin: ORIGIN };
  ctx.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  ctx.openHtmlSlide = (url, label) => opened.push({ url, label });
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'overview-1.js' });
  assert.strictEqual(listeners.length, 1, 'one message listener is registered');
  const post = (data, { origin = ORIGIN, source = deckWindow } = {}) => listeners[0]({ data, origin, source });
  return { post, classes, opened, deckWindow };
}

test('relay: the first-party deck frame still drives the overlay and opens deck slides', () => {
  const r = boot();
  r.post({ type: 'deck-overlay', open: true });
  assert.ok(r.classes.has('deck-fullscreen'));
  r.post({ type: 'deck-overlay', open: false });
  assert.ok(!r.classes.has('deck-fullscreen'));
  r.post({ type: 'open-slide', url: '/overview-deck/agenda.html', label: 'Agenda' });
  assert.deepStrictEqual(r.opened, [{ url: '/overview-deck/agenda.html', label: 'Agenda' }]);
});

test('relay: a message from another origin is ignored (cross-origin opener / foreign frame)', () => {
  const r = boot();
  r.post({ type: 'deck-overlay', open: true }, { origin: 'https://attacker.example' });
  r.post({ type: 'open-slide', url: '/overview-deck/agenda.html' }, { origin: 'https://attacker.example' });
  r.post({ type: 'open-slide', url: '/overview-deck/agenda.html' }, { origin: 'null' }); // sandboxed opaque-origin slide
  assert.strictEqual(r.classes.size, 0);
  assert.deepStrictEqual(r.opened, []);
});

test('relay: a same-origin message from any window other than #deckframe is ignored', () => {
  const r = boot();
  const otherFrame = { name: 'slide-overlay-frame' };
  r.post({ type: 'deck-overlay', open: true }, { source: otherFrame });
  r.post({ type: 'open-slide', url: '/overview-deck/agenda.html' }, { source: otherFrame });
  r.post({ type: 'open-slide', url: '/overview-deck/agenda.html' }, { source: null });
  assert.strictEqual(r.classes.size, 0);
  assert.deepStrictEqual(r.opened, []);
});

test('relay: open-slide only accepts a first-party /overview-deck/*.html path, even from the deck', () => {
  const r = boot();
  for (const url of [
    'https://attacker.example/reset-password',
    '//attacker.example/x.html',
    'javascript:alert(1)',
    '/uploads/slides/evil.html',
    '/overview-deck/../uploads/slides/evil.html',
    '/overview-deck/agenda.html?x=1',
    '/overview-deck/sub/agenda.html',
    ['/overview-deck/agenda.html'],
    { toString: () => '/overview-deck/agenda.html' },
  ]) r.post({ type: 'open-slide', url, label: 'Session expired' });
  assert.deepStrictEqual(r.opened, []);
  // A non-string label falls back to the default, never stringified objects.
  r.post({ type: 'open-slide', url: '/overview-deck/slide5.html', label: { x: 1 } });
  assert.deepStrictEqual(r.opened, [{ url: '/overview-deck/slide5.html', label: 'Slide' }]);
});
