// analyze-prof.js <file.cpuprofile> [topN]: self-time by function, with idle/program/gc and an inclusive time for chosen frames.
'use strict';
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const top = Number(process.argv[3] || 28);
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const self = new Map(); // nodeId -> us
let total = 0;
for (let i = 0; i < p.samples.length; i++) {
  const dt = p.timeDeltas[i + 1] !== undefined ? p.timeDeltas[i + 1] : p.timeDeltas[i];
  self.set(p.samples[i], (self.get(p.samples[i]) || 0) + dt);
  total += dt;
}
const keyOf = (n) => {
  const f = n.callFrame;
  const url = (f.url || '').replace(/^file:\/\//, '').replace(/.*\/(M&A|agent-[^/]+)\//, '<repo>/');
  return `${f.functionName || '(anonymous)'}  ${url}${f.lineNumber >= 0 && url ? ':' + (f.lineNumber + 1) : ''}`;
};
const agg = new Map();
for (const [id, us] of self) {
  const k = keyOf(byId.get(id));
  agg.set(k, (agg.get(k) || 0) + us);
}
const ms = (us) => (us / 1000).toFixed(0).padStart(7);
const pct = (us) => ((100 * us) / total).toFixed(1).padStart(5) + '%';
console.log(`profile: ${(total / 1e6).toFixed(1)} s sampled`);
const special = ['(idle)', '(program)', '(garbage collector)', '(root)'];
for (const s of special) {
  const us = [...agg].filter(([k]) => k.startsWith(s)).reduce((a, [, v]) => a + v, 0);
  console.log(`${ms(us)} ms ${pct(us)}  ${s}`);
}
console.log('--- top self time (excluding idle) ---');
[...agg].filter(([k]) => !k.startsWith('(idle)')).sort((a, b) => b[1] - a[1]).slice(0, top).forEach(([k, us]) => console.log(`${ms(us)} ms ${pct(us)}  ${k}`));
// inclusive time of selected frames
function inclusive(match) {
  let sum = 0;
  for (const [id, us] of self) {
    let cur = id; let hit = false;
    while (cur !== undefined) { if (match(byId.get(cur))) { hit = true; break; } cur = parent.get(cur); }
    if (hit) sum += us;
  }
  return sum;
}
console.log('--- inclusive (frames anywhere on the stack) ---');
for (const [label, m] of [
  ['route GET /api/raid handler (anonymous in server.js, via listQuery/sendList)', (n) => /listQuery\.js/.test(n.callFrame.url)],
  ['db/store.js (readProjection/readCollections/writeDb/readDb)', (n) => /db\/store\.js/.test(n.callFrame.url)],
  ['db/auditChain.js + auditHook.js', (n) => /db\/audit(Chain|Hook)\.js/.test(n.callFrame.url)],
  ['compression middleware', (n) => /node_modules\/compression/.test(n.callFrame.url)],
  ['zlib', (n) => /zlib|node:zlib/.test(n.callFrame.url) || /^(Gzip|Zlib)/.test(n.callFrame.functionName)],
  ['server.js', (n) => /\/server\.js$/.test(n.callFrame.url)],
  ['JSON.parse', (n) => n.callFrame.functionName === 'parse' && /^$/.test(n.callFrame.url)],
  ['JSON.stringify', (n) => n.callFrame.functionName === 'stringify' && /^$/.test(n.callFrame.url)],
  ['express (router/layer/response)', (n) => /node_modules\/express/.test(n.callFrame.url)],
  ['node:internal/streams + net write', (n) => /node:internal\/(streams|stream_base_commons)|node:net|node:_http_outgoing/.test(n.callFrame.url)],
]) { const us = inclusive(m); console.log(`${ms(us)} ms ${pct(us)}  ${label}`); }
