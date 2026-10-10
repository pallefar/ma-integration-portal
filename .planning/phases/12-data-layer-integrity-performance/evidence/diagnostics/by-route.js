// by-route.js <cpuprofile> <server.js>: main-thread time per INNERMOST registered handler on each sample's stack
'use strict';
const fs = require('fs');
const p = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const serverSrc = fs.readFileSync(process.argv[3], 'utf8').split('\n');
const handlerLine = new Map();
serverSrc.forEach((l, i) => { const m = /^app\.(get|post|put|delete|use)\((.*?)(?:,|\))/.exec(l); if (m) handlerLine.set(i + 1, `app.${m[1]}(${m[2].slice(0, 40)})`); });
const byId = new Map(p.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of p.nodes) for (const c of n.children || []) parent.set(c, n.id);
const groups = new Map();
let total = 0;
for (let i = 0; i < p.samples.length; i++) {
  const dt = p.timeDeltas[i + 1] !== undefined ? p.timeDeltas[i + 1] : p.timeDeltas[i];
  total += dt;
  let cur = p.samples[i];
  let key = null;
  while (cur !== undefined) {
    const f = byId.get(cur).callFrame;
    if (/\/server\.js$/.test(f.url || '') && handlerLine.has(f.lineNumber + 1)) { key = `server.js:${f.lineNumber + 1} ${handlerLine.get(f.lineNumber + 1)}`; break; }
    cur = parent.get(cur);
  }
  if (!key) key = '(no registered handler on stack: ' + (byId.get(p.samples[i]).callFrame.functionName || 'native') + ')';
  groups.set(key, (groups.get(key) || 0) + dt);
}
console.log(`total ${(total / 1000).toFixed(0)} ms`);
for (const [k, us] of [...groups].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`${(us / 1000).toFixed(0).padStart(7)} ms ${((100 * us) / total).toFixed(1).padStart(5)}%  ${k}`);
}
