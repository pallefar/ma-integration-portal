'use strict';
// Phase 11 (D-11-01): one-call real-deal fixture for the authorization suites.
//
// Creates a deal registry row (control.db) + its own deal database file, seeds
// one account per member (ensureUser — the gate re-reads the account every
// request, D-10-04), mints a session per member and binds it to the deal, so a
// suite can assert "role X, bound to a REAL deal, may/may not read route Y".
//
// `controlConn` / `runtimeConn` MUST be the connections of the SAME control.db /
// runtime.db the app under test opens (MA_* temp paths set before requiring
// server.js) — db/store.js getOrOpenConnection(dbFiles.CONTROL_DB_PATH, ...).
//
// All requires are lazy so this file is inert — and pins no MA_* path — when
// `node --test` executes it standalone.

let dealSeq = 1000;

/**
 * @param {object} o
 * @param {object} o.controlConn
 * @param {object} o.runtimeConn
 * @param {string} o.dealId
 * @param {{username:string, role:string, ddAreas?:string[]}[]} o.members
 * @returns {{ dealId:string, tokens:Object<string,string>, cookie:(u:string)=>string }}
 */
function createDealFixture({ controlConn, runtimeConn, dealId, members }) {
  const sessionsDb = require('../../db/sessions.js');
  const { createDealDatabase } = require('../../db/dealSeed.js');
  const { ensureUser } = require('./seed-identity.js');

  const memberGrants = {};
  for (const m of members) {
    if (Array.isArray(m.ddAreas)) memberGrants[m.username] = { ddAreas: m.ddAreas };
  }
  const deal = {
    id: dealId,
    name: dealId,
    targetCompany: dealId + ' Co',
    members: members.map((m) => m.username),
    memberGrants,
    status: 'active',
    createdBy: 'admin',
    createdAt: new Date().toISOString(),
  };
  controlConn.prepare('INSERT INTO deals (id, project_id, seq, status, data) VALUES (?, NULL, ?, ?, ?)')
    .run(deal.id, dealSeq++, 'active', JSON.stringify(deal));
  createDealDatabase(deal.id, { name: deal.name, targetCompany: deal.targetCompany });

  const tokens = {};
  for (const m of members) {
    ensureUser(controlConn, { username: m.username, role: m.role });
    const token = sessionsDb.createSession(runtimeConn, {
      username: m.username, role: m.role, ttlMs: 12 * 60 * 60 * 1000,
    });
    sessionsDb.bindSessionDeal(runtimeConn, token, deal.id);
    tokens[m.username] = token;
  }
  return {
    dealId: deal.id,
    tokens,
    cookie(username) {
      if (!tokens[username]) throw new Error(`createDealFixture: no member '${username}'`);
      return `ma_session=${tokens[username]}`;
    },
  };
}

/** An UNBOUND session (resolves to the demo store). Returns a cookie header value. */
function demoSession({ controlConn, runtimeConn, username, role }) {
  const sessionsDb = require('../../db/sessions.js');
  const { ensureUser } = require('./seed-identity.js');
  ensureUser(controlConn, { username, role });
  const token = sessionsDb.createSession(runtimeConn, { username, role, ttlMs: 12 * 60 * 60 * 1000 });
  return `ma_session=${token}`;
}

module.exports = { createDealFixture, demoSession };
