// ma-fetch-wrapper:begin
// [security] CONC-02 gap closure (Phase 9, plan 09-08, R7 F-1): the shared
// client half of the version precondition. A never-edited record carries no
// `version` field and is version 0 on the server (D-09), so a client that
// holds one must send 0 — omitting it means the first co-edit of that record
// cannot be caught and silently clobbers the other writer. Every write/delete
// call site sends `window.maVersionOf(heldRecord)` unconditionally; the server
// refuses a missing precondition in a real deal. Defined inside this region so
// the node:vm harnesses that extract it can exercise it directly.
(function () {
  window.maVersionOf = function (rec) {
    var v = rec && rec.version;
    // WR-04: the same rule as db/collections.js comparableVersion().
    return (Number.isSafeInteger(v) && v >= 0) ? v : 0;
  };
})();

// Admin API auth bridge: when the server requires an admin token (production, i.e.
// ADMIN_TOKEN is set), attach it to same-origin /api requests and prompt for it once
// on a 401 write. Completely inert in the demo — the server leaves the API open when
// ADMIN_TOKEN is unset, so no token is stored, no header is added, and writes never 401.
//
// This wrapper also handles the fail-closed session gate (Plan 01): any /api 401
// carrying { authRequired: true } means the session is missing or expired — a
// distinct failure mode from the admin-token write-401 (different cause, different
// remedy) — so it redirects to /login.html deterministically on ANY method (GET
// reads included), rather than racing the best-effort /api/auth/me probe further
// below. Checked first, falling through to the write-only token prompt only when
// the 401 is NOT an authRequired session gate.
//
// D-07/CONC-01 (Phase 8 Plan 04): this same wrapper also owns the client half of
// write-contention handling. A same-origin /api write that comes back 503 here is
// transient SQLite write contention (server.js's central busy-retry middleware,
// Phase 8 Plan 01) — a DIFFERENT signal from the 409 stale-write conflict Phase 9
// introduces for a real, resolved edit conflict; the two stay distinct and are
// handled by different code paths. The retry below is capped and jittered: without
// the jitter, every browser tab blocked by the same contended write would retry at
// the same instant and amplify the very contention it is trying to recover from —
// a self-inflicted thundering herd (retry-storm avoidance).
(function () {
  if (window.__adminAuthWrapped || !window.fetch) return;
  window.__adminAuthWrapped = true;
  const KEY = 'admin_token';
  const origFetch = window.fetch.bind(window);
  const isApi = (url) => {
    try { const u = new URL(url, location.href); return u.origin === location.origin && u.pathname.startsWith('/api/'); }
    catch (e) { return false; }
  };
  const withToken = (init, tok) => {
    const h = new Headers((init && init.headers) || {});
    h.set('X-Admin-Token', tok);
    return Object.assign({}, init, { headers: h });
  };
  const onLoginPage = () => window.location.pathname.includes('login.html');
  const onChangePasswordPage = () => window.location.pathname.includes('change-password.html');
  const maybePromptForToken = (res, input, init, method) => {
    if (method === 'GET' || typeof input !== 'string') return res;
    const entered = window.prompt('Admin token required to save changes:');
    if (entered && entered.trim()) {
      localStorage.setItem(KEY, entered.trim());
      return origFetch(input, withToken(init, entered.trim()));
    }
    return res;
  };

  // D-08: the give-up surface when contention outlasts the retry budget below.
  // Built fresh here rather than reused: public/js/banners.js is a CMS-driven,
  // server-fetched page-banner system (the wrong mechanism entirely), and
  // dashboard.js's showToast() is defined inside that page's own IIFE and is
  // not reachable from any other page (08-RESEARCH.md Pitfall 6). This is the
  // one JS file loaded on every page, so the toast lives here instead. The
  // message is a fixed literal set via textContent — never markup assignment —
  // so this stays covered by test/client-xss-sinks.test.js.
  const BUSY_GIVE_UP_MESSAGE = 'Server is busy — your change was not saved. Please try again.';
  // IN-02 (Phase 8 review fix): if two different in-flight writes both
  // exhaust their retry budget around the same time (plausible under
  // sustained contention — exactly the scenario this phase targets), a
  // second call must not append a second toast stacked on top of the first.
  // Module-scoped so it survives across calls within this one IIFE closure.
  let activeGiveUpToast = null;
  let activeGiveUpToastTimer = null;
  const showBusyGiveUpToast = () => {
    if (activeGiveUpToast) {
      // A toast is already visible: refresh its 5s lifetime instead of
      // appending a second element — the same fixed message already covers
      // "your change was not saved" for whichever write just gave up.
      clearTimeout(activeGiveUpToastTimer);
      const toast = activeGiveUpToast;
      activeGiveUpToastTimer = setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        if (activeGiveUpToast === toast) activeGiveUpToast = null;
        activeGiveUpToastTimer = null;
      }, 5000);
      return;
    }
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '2rem';
    toast.style.right = '2rem';
    toast.style.padding = '1rem 1.5rem';
    toast.style.backgroundColor = '#DC2626';
    toast.style.color = '#FFFFFF';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';
    toast.style.zIndex = '9999';
    toast.style.fontWeight = '600';
    toast.style.fontSize = '0.9rem';
    toast.textContent = BUSY_GIVE_UP_MESSAGE;
    document.body.appendChild(toast);
    activeGiveUpToast = toast;
    activeGiveUpToastTimer = setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (activeGiveUpToast === toast) activeGiveUpToast = null;
      activeGiveUpToastTimer = null;
    }, 5000);
  };

  // CONC-02/D-03/D-04/D-05 (Phase 9): the shared conflict-recovery dialog —
  // rendered from THIS wrapper (D-05: one shared component, wrapper-
  // detected — no per-page wiring, mirroring showBusyGiveUpToast() above)
  // on any same-origin /api write whose 409 body carries `conflict: true`
  // (server.js's conflictBody()/central 409 middleware). Native DOM
  // construction, textContent-only — no markup assignment anywhere in this
  // component, so it stays covered by test/client-xss-sinks.test.js. This
  // branch NEVER auto-retries (D-05/Pitfall 11): the only re-fire path is
  // the user clicking the dialog's own apply action below.
  const CONFLICT_TITLE_EDIT = 'Someone else updated this';
  const CONFLICT_INTRO_EDIT = 'Your changes are still here. Review what changed below, then decide how to proceed.';
  const CONFLICT_ATTRIBUTION_FALLBACK = 'This record changed since you loaded it.';
  const CONFLICT_APPLY_LABEL = 'Apply my changes anyway';
  const CONFLICT_DISCARD_LABEL = 'Discard mine, keep theirs';
  const CONFLICT_APPLYING_LABEL = 'Applying…';
  // R7 F-3 / GD-6: a record whose version moved while no payload field maps
  // to a record field (a `{}` confirm-current, a convert, a re-baseline, a
  // cost-entry add) used to render a sentence asserting the change was
  // irrelevant to the user's edit — a claim the client cannot know. The neutral
  // panel says only what is true and reuses the ONE fallback sentence
  // (CONFLICT_ATTRIBUTION_FALLBACK) so it is a single constant.
  // E2-error (Plan 03): the reapply-failure banner. One fixed prefix/suffix
  // pair with a swapped-in reason — never a separate string per failure
  // mode, so the copy stays exactly on the Copywriting Contract's sentence.
  const CONFLICT_ERROR_PREFIX = "That didn't go through — ";
  const CONFLICT_ERROR_SUFFIX = '. Your edits are still here; review the fresh values below and try again.';
  const CONFLICT_ERROR_REASON_CONFLICT = 'the record changed again';
  const CONFLICT_ERROR_REASON_NETWORK = 'a network error occurred';
  const CONFLICT_ERROR_REASON_SERVER = 'the server reported an error';
  // IN-05 (09-REVIEW round 2) / UI-SPEC A11: a reapply whose Phase-8 busy
  // retries ran out (503) — said in the dialog banner instead of the toast.
  const CONFLICT_ERROR_REASON_BUSY = 'the server is busy';
  const conflictErrorMessage = (reason) => CONFLICT_ERROR_PREFIX + reason + CONFLICT_ERROR_SUFFIX;
  // FA-2 (09-01-PLAN.md): a deliberate extension beyond the signed-off
  // 09-UI-SPEC.md Copywriting Contract — three literals for PD-4's "an
  // UPDATE arrived for a record someone else already deleted" surface,
  // which the approved UI-SPEC table did not itself enumerate (it only
  // covered the edit-conflict and D-08 stale-delete variants). Resolved by
  // plan 09-13: 09-UI-SPEC.md's "Amendments (2026-10-10" section A1 now lists
  // these three literals in its Copywriting Contract. GD-10 / R7 F-7: the
  // title names the actor-less truth ("deleted"), and this variant renders no
  // attribution line — a deleted row carries no actor/time to attribute.
  const CONFLICT_TITLE_DELETED = 'Someone else deleted this';
  const CONFLICT_DELETED_INTRO = 'Someone else deleted this record before your change could be saved. There is nothing left to apply — closing this leaves your form exactly as it was.';
  const CONFLICT_CLOSE_LABEL = 'Close';
  // R7 F-4 / GD-7 (SC6): the server withholds `currentRecord` (null) when the
  // record is outside the caller's clearance (CR-01). Rendering that as an
  // empty diff with an "Apply" action was misleading and the follow-up 403
  // was reported as a network error. The honest variant states the one thing
  // known, offers no action that cannot succeed, and shows no field value.
  const CONFLICT_WITHHELD_TEXT = 'This record is no longer within your clearance; your change cannot be applied.';
  // Reason used when a refused reapply (a 4xx other than a marker 409) carries
  // no readable `error` text of its own.
  const CONFLICT_ERROR_REASON_REFUSED = 'the server refused the change';
  const CONFLICT_ERROR_REASON_MAX_CHARS = 200;

  // D-08 (Phase 9, Plan 06): the stale-delete confirmation variant, taken
  // when the intercepted request's method is DELETE — distinct from
  // CONFLICT_TITLE_DELETED above (PD-4's "my EDIT landed on an
  // already-deleted record"), which describes the opposite direction and can
  // never arise for a DELETE request itself (db/store.js's versioned-delete
  // branch either succeeds, throws a version conflict, or silently no-ops
  // when the row is already gone — never a conflictKind:'deleted' throw).
  // The server's 409 body shape is otherwise identical to an edit conflict
  // (conflictKind: 'version') — selecting the copy from the request method
  // the wrapper already holds means no new server field is needed and the
  // two surfaces stay one component.
  const CONFLICT_TITLE_DELETE = 'Someone else updated this — still delete it?';
  const CONFLICT_DELETE_LABEL = 'Delete anyway';
  const CONFLICT_DELETING_LABEL = 'Deleting…';
  const CONFLICT_CANCEL_LABEL = 'Cancel';
  // R7 F-6 / GD-9 (09-14): the in-app delete confirm's primary action. The
  // 09-UI-SPEC's "Destructive confirmation" row promised ONE surface for a
  // stale delete; the page's browser-native confirm stacked a second prompt
  // in front of it. window.maConfirmDelete (below) replaces that native
  // confirm with a 'confirm' state of this same dialog shell.
  const CONFIRM_DELETE_LABEL = 'Delete';
  // Reapply-failure reason for the one outcome unique to the delete variant:
  // resubmitting "Delete anyway" lands on a record someone else already
  // finished deleting (the route's own not-found response). Plugged into the
  // SAME conflictErrorMessage()/CONFLICT_ERROR_* mechanism plan 03 built —
  // no new banner component, per the plan's own instruction to reuse it.
  const CONFLICT_ERROR_REASON_ALREADY_DELETED = 'someone else already deleted this record';

  // R7 F-2 / GD-4 (Phase 9 gap closure, plan 09-11): a conflict SESSION.
  // D-05 means no page wires the dialog itself — the wrapper owns it — which
  // means no page could ever learn what the user decided: the original fetch
  // promise used to settle with the 409 the instant the dialog opened, so a
  // page's own success handler never ran after "Apply my changes anyway" (the
  // row kept its stale version and false-conflicted on the next click) and
  // DD's unconditional refresh re-rendered underneath the open dialog. The
  // fix lives here, at the root: the caller's promise is HELD while the
  // dialog is open and settles exactly once, with the response that
  // represents the user's decision —
  //   Apply / Delete anyway succeeded -> that reapplied 2xx Response, so the
  //                                      page's existing `res.success` handler
  //                                      applies the server's resulting state;
  //   Discard / Escape / overlay / Close / Cancel -> the ORIGINAL 409
  //                                      Response, body still readable.
  // A session only ever resolves with a response to ITS OWN request or its own
  // reapply (T-09-47), and the wrapper still never re-fires a 409 by itself —
  // the only re-fire path is an explicit click on the session's own button
  // (D-05/Pitfall 11, T-09-48).
  //
  // activeConflictSession is the single-instance guard: the one SHOWN.
  const CONFLICT_REAPPLY_CONTEXT = { reapply: true };
  let activeConflictSession = null;

  // The one place every dialog exit goes through. A no-op once settled: a
  // stale or repeated click, or a reapply response that lands after the user
  // already left, can never resolve a promise twice or hand it a foreign
  // response.
  //
  // 09-14: `failure` ({ error }) rejects the held promise instead — used only
  // by the in-app delete confirm when its own DELETE fails at the network
  // level, so the page's existing network-failure branch keeps working.
  function settleConflictSession(session, response, failure) {
    if (session.settled) return;
    session.settled = true;
    session.inFlight = false;
    if (activeConflictSession === session) {
      if (session.overlay && session.overlay.parentNode) {
        session.overlay.parentNode.removeChild(session.overlay);
      }
      document.removeEventListener('keydown', session.onKeydown);
      activeConflictSession = null;
      // IN-04 / A10: hand keyboard focus back to whatever had it before the
      // dialog opened (best-effort — the element may have been re-rendered).
      if (session.returnFocus && session.returnFocus !== session.modal) focusConflictElement(session.returnFocus);
    }
    if (failure && session.reject) session.reject(failure.error);
    else session.resolve(response);
    // The shown session just ended: bring up the next queued conflict (a
    // function declaration below — hoisted — so ordering in this IIFE is free).
    // IN-02 (09-REVIEW round 2): this runs synchronously, BEFORE the settled
    // page's own `.then` handlers (microtasks) — so a page's post-conflict
    // re-read may render underneath the NEXT queued dialog. The contract is
    // "after ITS OWN dialog closed", not "while no dialog is open"; the queued
    // session renders only from its own request/409 bodies, so it is unaffected.
    openNextQueuedConflict();
  }

  // Minute/hour/day granularity relative-time formatter for the attribution
  // line ("Changed by karen, 2 min ago"). Returns null for an unparseable
  // timestamp so the caller can fall through to the attribution fallback
  // copy rather than rendering a bogus "NaN min ago".
  const relativeTime = (iso) => {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return null;
    const diffMin = Math.round((Date.now() - then) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return diffMin + ' min ago';
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hour ago' : ' hours ago');
    const diffDay = Math.round(diffHr / 24);
    return diffDay + (diffDay === 1 ? ' day ago' : ' days ago');
  };

  // UI-SPEC E4: with both actor and time present render "Changed by {name},
  // {relative time}"; with either missing render the fallback sentence —
  // never a blank line, never a line containing the word "undefined".
  // Returns true when the real "Changed by" line was rendered, false when the
  // fallback sentence was (so a caller that is already showing that same
  // sentence elsewhere can omit this element instead of repeating it — A7).
  function renderConflictAttribution(el, body) {
    const name = body && body.changedBy;
    const time = (body && body.changedAt) ? relativeTime(body.changedAt) : null;
    if (name && time) {
      el.textContent = '';
      el.appendChild(document.createTextNode('Changed by '));
      const strong = document.createElement('strong');
      strong.textContent = name;
      el.appendChild(strong);
      el.appendChild(document.createTextNode(', ' + time));
      return true;
    }
    el.textContent = CONFLICT_ATTRIBUTION_FALLBACK;
    return false;
  }

  // UI-SPEC E1-partial: a changed field whose value (mine or theirs) is
  // empty/null renders an explicit italic "(empty)" placeholder — never
  // blank whitespace, which would read as a rendering bug. A non-string
  // value (array, nested object) is stringified to its JSON form — still
  // set with textContent, never markup — so the user sees the real
  // competing value rather than "[object Object]".
  function setConflictDiffValue(el, val) {
    if (val === undefined || val === null || val === '') {
      el.classList.add('conflict-diff-value-empty');
      el.textContent = '(empty)';
    } else if (typeof val === 'object') {
      el.textContent = JSON.stringify(val);
    } else {
      el.textContent = String(val);
    }
  }

  // R7 F-3 / GD-6 / D-03 / Pitfall 12: the diff compares what the user EDITED
  // (the payload's keys — their intent) with what the server holds now. Most
  // routes name their payload keys exactly like the record's fields, so
  // payload-keys-that-exist-on-the-record is the right default. A few routes
  // do not: the stage route sends `targetStage` for the record's `stage`, the
  // per-month phasing route sends a bare `targetM`/`realizedM` that means ONE
  // cell of `phasing[]` (not the record's total of the same name), and some
  // routes send action parameters that are not record fields at all. This
  // declarative per-route table says which is which, so a route is described
  // in one place instead of by an if-chain in the renderer. An entry has a
  // method, a pathname pattern and any of:
  //   aliases  payload key -> record field it stands for;
  //   cell     { array, key, fields } compare each of `fields` that the payload
  //            carries against the element of record[array] whose `key` equals
  //            the pattern's first capture (the label gets ' · ' + the capture);
  //   ignore   payload keys that are parameters, not edited fields.
  // A request no entry matches uses the default; a request whose rows come out
  // empty renders the neutral panel — never a claim about what changed.
  const CONFLICT_FIELD_MAP = [
    { method: 'POST', path: /^\/api\/synergies\/[^/]+\/stage$/, aliases: { targetStage: 'stage' }, ignore: ['reason'] },
    { method: 'POST', path: /^\/api\/synergies\/[^/]+\/rebaseline$/, ignore: ['reason'] },
    { method: 'POST', path: /^\/api\/synergies\/[^/]+\/cost-entries$/, ignore: ['date', 'amountM', 'note'] },
    { method: 'POST', path: /^\/api\/synergies\/[^/]+\/phasing\/([^/]+)$/, cell: { array: 'phasing', key: 'month', fields: ['targetM', 'realizedM'] } },
    { method: 'POST', path: /^\/api\/dd\/findings\/[^/]+\/convert$/, ignore: ['toTask', 'toRaid'] },
    { method: 'POST', path: /^\/api\/org\/flight-risk\/[^/]+\/convert$/, ignore: ['toTask', 'toRaid'] },
  ];

  // Display labels (R7 F-5 / GD-8): authored, so the CSS no longer
  // case-transforms them. Looked up by hasOwnProperty — a payload key is
  // user-supplied JSON ('constructor' must not resolve to a function).
  const CONFLICT_FIELD_LABELS = {
    status: 'Status', title: 'Title', text: 'Request', notes: 'Notes', owner: 'Owner',
    due: 'Due date', dueDate: 'Due date', severity: 'Severity', probability: 'Probability',
    type: 'Type', phase: 'Phase', workstreamId: 'Workstream', stage: 'Stage',
    realizedM: 'Realized (M)', targetM: 'Target (M)', runRateM: 'Run-rate (M)',
    startMonth: 'Start month', curveShape: 'Curve shape',
    costPlannedM: 'Planned cost (M)', costExpectedMonth: 'Expected cost month',
    category: 'Category', level: 'Level', reportsToId: 'Reports to', employeeId: 'Person',
    riskLevel: 'Risk level', mitigation: 'Mitigation', blocked: 'Blocked',
    vdrLink: 'Data room link', area: 'Area', description: 'Description', name: 'Name',
  };

  // Fallback for a key the table does not know: drop a trailing 'Id' that
  // follows a lowercase letter, split camelCase / underscores / hyphens into
  // words, lower-case them, capitalise the first, and render a final
  // standalone 'M' word as '(M)' — neutral, no currency symbol (GD-8).
  function humaniseConflictKey(key) {
    const raw = String(key);
    const words = raw.replace(/([a-z])Id$/, '$1')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .split(/\s+/).filter(Boolean);
    if (words.length === 0) return raw;
    const out = words.map((w, i) => ((i === words.length - 1 && i > 0 && w === 'M') ? '(M)' : w.toLowerCase()));
    out[0] = out[0].charAt(0).toUpperCase() + out[0].slice(1);
    return out.join(' ');
  }

  function conflictRequestPath(url) {
    try {
      return new URL(url, (typeof location !== 'undefined' && location.href) || undefined).pathname;
    } catch (e) {
      return String(url || '').split('?')[0];
    }
  }

  function findConflictFieldMapEntry(method, url) {
    const path = conflictRequestPath(url);
    for (let i = 0; i < CONFLICT_FIELD_MAP.length; i++) {
      const entry = CONFLICT_FIELD_MAP[i];
      if (entry.method !== method) continue;
      const m = entry.path.exec(path);
      if (m) return { entry, match: m };
    }
    return null;
  }

  function conflictFieldLabel(field) {
    return Object.prototype.hasOwnProperty.call(CONFLICT_FIELD_LABELS, field)
      ? CONFLICT_FIELD_LABELS[field] : humaniseConflictKey(field);
  }

  // Builds the diff rows [{ label, mine, theirs }] for one session render.
  // `mine` always comes from the ORIGINAL payload, `theirs` from the latest
  // conflict body's currentRecord — which the server already clearance-filtered
  // (T-09-53: this reads only what was sent; it requests and invents nothing).
  function buildConflictRows(session, payload, currentRecord) {
    const found = findConflictFieldMapEntry(session.method, session.url);
    const entry = found ? found.entry : {};
    const aliases = entry.aliases || {};
    const ignore = entry.ignore || [];
    const cell = entry.cell || null;
    const rows = [];
    Object.keys(payload).forEach((key) => {
      if (key === 'id' || key === 'version' || ignore.indexOf(key) >= 0) return;
      if (cell) {
        // One month cell: the server's value for the SAME month, or nothing
        // ('(empty)') when the month row does not exist there. Never the
        // record's total of the same name.
        if (cell.fields.indexOf(key) < 0) return;
        const month = found.match[1];
        const arr = Array.isArray(currentRecord[cell.array]) ? currentRecord[cell.array] : [];
        const theirCell = arr.find((el) => el && el[cell.key] === month);
        rows.push({
          label: conflictFieldLabel(key) + ' · ' + month,
          mine: payload[key],
          theirs: theirCell ? theirCell[key] : undefined,
        });
        return;
      }
      const field = Object.prototype.hasOwnProperty.call(aliases, key) ? aliases[key] : key;
      if (!Object.prototype.hasOwnProperty.call(currentRecord, field)) return;
      rows.push({ label: conflictFieldLabel(field), mine: payload[key], theirs: currentRecord[field] });
    });
    return rows;
  }

  // D-03: "Apply my changes anyway" is a genuine REAPPLY against fresh
  // state, not a forced write carrying the stale value. Two shapes of
  // version precondition exist across routes: the common case carries
  // `version` inside the JSON body (rewritten below); a query-parameter
  // route instead carries it as `?expectedVersion=` in the URL itself —
  // detected structurally from the request URL, not from the HTTP method,
  // so this works for any verb a future route uses (Plan 06's RAID DELETE
  // is the first such route). Returns a NEW { input, init } pair; never
  // mutates the caller's own `init`. A query-parameter route's body is left
  // byte-identical UNLESS it also carries its own `version` key — IN-03
  // (09-REVIEW round 2): then both channels are rewritten to the same fresh
  // value, because server.js parseExpectedVersion() refuses a request whose
  // two channels disagree (it used to let the body silently win, which would
  // have looped this reapply on "the record changed again" forever).
  function withFreshVersion(input, init, url, method, freshVersion) {
    const newInit = Object.assign({}, init);
    try {
      const u = new URL(url, (typeof location !== 'undefined' && location.href) || undefined);
      if (u.searchParams.has('expectedVersion')) {
        u.searchParams.set('expectedVersion', freshVersion);
        const rewrittenUrl = u.pathname + u.search + u.hash;
        const newInput = (typeof input === 'string') ? rewrittenUrl : input;
        try {
          const parsedBody = (init && typeof init.body === 'string') ? JSON.parse(init.body) : null;
          if (parsedBody && typeof parsedBody === 'object' && Object.prototype.hasOwnProperty.call(parsedBody, 'version')) {
            parsedBody.version = freshVersion;
            newInit.body = JSON.stringify(parsedBody);
          }
        } catch (e) {
          // Not a JSON body — nothing version-bearing to keep in step.
        }
        return { input: newInput, init: newInit };
      }
    } catch (e) {
      // Malformed/unparseable URL — fall through to the body-rewrite path.
    }
    try {
      const parsed = JSON.parse((init && init.body) || '{}');
      parsed.version = freshVersion;
      newInit.body = JSON.stringify(parsed);
    } catch (e) {
      // Body wasn't JSON (shouldn't happen for a route that emitted a
      // versioned conflict) — nothing safe to rewrite; leave it untouched.
    }
    return { input: input, init: newInit };
  }

  // [security] T-09-52: the reason for a refused reapply is the server's own
  // `error` string to THIS caller (no new data), but it lands in the dialog, so
  // it is normalised before use — trimmed, one trailing period removed (the
  // banner's suffix supplies the sentence break), capped at
  // CONFLICT_ERROR_REASON_MAX_CHARS — and only ever set via textContent.
  // Anything that is not a non-empty string falls back to the fixed reason.
  function conflictServerReason(body) {
    const raw = body && typeof body.error === 'string' ? body.error.trim() : '';
    const text = raw.replace(/\.$/, '').slice(0, CONFLICT_ERROR_REASON_MAX_CHARS).trim();
    return text || CONFLICT_ERROR_REASON_REFUSED;
  }

  // The user's own click on "Apply my changes anyway" / "Delete anyway":
  // reapply the session's ORIGINAL request carrying the fresh version, through
  // the internal attemptFetch with the reapply context (NOT window.fetch — a
  // fresh 409 returns to THIS handler and re-renders the session in place
  // instead of opening a second held session). Outcomes:
  //   2xx            -> settle the held promise with this Response (unconsumed)
  //   marker 409     -> adopt the fresh body, re-render in place + banner
  //   404 (delete)   -> "someone else already deleted this record"
  //   5xx            -> "the server reported an error"
  //   other 4xx / marker-less 409 -> the server's own `error` text (R7 F-4),
  //                     else "the server refused the change"
  //   network failure -> "a network error occurred"
  //   (each a banner; the session stays pending so the user can try again or
  //   leave.)
  // inFlight is the double-click guard (HP8): a second click sends nothing.
  // WR-03 (09-REVIEW round 2) / UI-SPEC A9: inFlight is ALSO the exit lock.
  // The reapply is irrevocable once sent, so while it is on the wire the
  // session's exit control (`exitBtn` — Discard / Cancel) is disabled and
  // Escape / overlay clicks are ignored (activateConflictSession). Before
  // this, an exit mid-flight settled the page with the stale 409; the page
  // re-read at once and could render "theirs" BEFORE the reapply committed
  // "mine" — page and server silently diverged. Now the page always learns
  // how the reapply ended: a 2xx settles with that Response; any failure
  // re-renders the dialog with every control enabled again (rerender).
  function runConflictReapply(session, btn, inFlightLabel, exitBtn) {
    if (session.settled || session.inFlight) return;
    session.inFlight = true;
    btn.disabled = true;
    btn.textContent = inFlightLabel;
    if (exitBtn) exitBtn.disabled = true;
    const fresh = withFreshVersion(session.input, session.init, session.url, session.method,
      session.body && session.body.currentVersion);
    const freshUrl = (typeof fresh.input === 'string') ? fresh.input : session.url;
    // A response/failure that lands after the session settled (the user left
    // mid-flight) is dropped here — it is never handed to any other promise.
    const rerender = (reason) => {
      if (session.settled) return;
      session.inFlight = false;
      renderConflictSession(session, reason);
    };
    attemptFetch(fresh.input, fresh.init, freshUrl, session.method, 0, CONFLICT_REAPPLY_CONTEXT).then((res) => {
      if (session.settled) return undefined;
      if (res && res.ok) {
        settleConflictSession(session, res);
        return undefined;
      }
      if (res && res.status === 409) {
        return res.clone().json().then((b) => {
          if (b && b.conflict === true) {
            // A third writer: adopt the fresh body (new `theirs`, new version
            // for the NEXT reapply) — `mine` still comes from session.init.
            session.body = b;
            rerender(CONFLICT_ERROR_REASON_CONFLICT);
          } else {
            // A marker-less 409 (a business-rule refusal such as an
            // unrecognized stage): the server's own words, not "network".
            rerender(conflictServerReason(b));
          }
        }, () => rerender(CONFLICT_ERROR_REASON_REFUSED));
      }
      if (res && res.status === 404 && session.method === 'DELETE') {
        rerender(CONFLICT_ERROR_REASON_ALREADY_DELETED);
        return undefined;
      }
      if (res && res.status === 503) {
        // IN-05 / A11: busy retries exhausted — the dialog's banner is the
        // ONE surface (attemptFetch skipped the give-up toast for a reapply).
        rerender(CONFLICT_ERROR_REASON_BUSY);
        return undefined;
      }
      if (res && res.status >= 500) {
        rerender(CONFLICT_ERROR_REASON_SERVER);
        return undefined;
      }
      if (res && res.status >= 400) {
        // R7 F-4: any other 4xx (a 403 for a clearance change, a 400 for a
        // validation refusal) is the server REFUSING — never "a network
        // error". It tells the caller why, in its own `error` field.
        return res.clone().json().then((b) => rerender(conflictServerReason(b)),
          () => rerender(CONFLICT_ERROR_REASON_REFUSED));
      }
      rerender(CONFLICT_ERROR_REASON_NETWORK);
      return undefined;
    }).catch(() => rerender(CONFLICT_ERROR_REASON_NETWORK));
  }

  // R7 F-6 / GD-9 (09-14): the user's click on the in-app confirm's "Delete".
  // Sends the page's DELETE through the internal attemptFetch with a context
  // naming THIS session (reapply:true => a marker 409 comes back raw instead
  // of opening a second held session). Outcomes:
  //   2xx             -> settle with that Response
  //   marker 409      -> the SAME session re-renders in place as the
  //                      stale-delete variant (no banner: it is the first
  //                      conflict, not "changed again"); from then on the
  //                      existing stale-delete semantics apply unchanged
  //   marker-less 409 / other 4xx / 5xx -> settle with that Response so the
  //                      page shows its own error (e.g. the org
  //                      "Has 2 direct reports." refusal)
  //   network failure -> the held promise REJECTS (the page's catch branch)
  // While the first DELETE is on the wire the dialog can no longer be
  // cancelled — the request is irrevocable, and the page must learn how it
  // ended — see the guards in the Cancel handler and activateConflictSession.
  function runConfirmDelete(session, btn, cancelBtn) {
    if (session.settled || session.inFlight) return;
    session.inFlight = true;
    btn.disabled = true;
    btn.textContent = CONFLICT_DELETING_LABEL;
    if (cancelBtn) cancelBtn.disabled = true;
    attemptFetch(session.input, session.init, session.url, 'DELETE', 0,
      { reapply: true, confirmSession: session }).then((res) => {
      if (session.settled) return undefined;
      if (res && res.status === 409) {
        return res.clone().json().then((b) => {
          if (session.settled) return;
          if (b && b.conflict === true) {
            session.body = b;
            session.originalRes = res;
            session.confirmState = false;
            session.inFlight = false;
            renderConflictSession(session, undefined);
          } else {
            settleConflictSession(session, res);
          }
        }, () => settleConflictSession(session, res));
      }
      settleConflictSession(session, res);
      return undefined;
    }, (err) => {
      settleConflictSession(session, null, { error: err });
    });
  }

  // T-09-14/T-09-16: (re)renders a session's contents into ITS OWN overlay/
  // modal in place — a second conflict (or a failed reapply) never closes and
  // recreates the overlay, and never stacks a second one. `errorReason`, when
  // present, means this is a re-render after a failed reapply (a third-writer
  // conflict, a network failure, or a 5xx) — it renders the inline
  // `.conflict-modal-error` banner above the actions per the Copywriting
  // Contract; a fresh first-time render passes no reason and gets no banner.
  // Every value comes from `session` — `mine` from the ORIGINAL request body,
  // `theirs` from the latest conflict body.
  function renderConflictSession(session, errorReason) {
    const body = session.body;
    const method = session.method;
    const init = session.init;
    const modal = session.modal;
    modal.textContent = ''; // clears all prior children — full rebuild below

    const head = document.createElement('div');
    head.className = 'conflict-modal-head';
    const title = document.createElement('h3');
    title.className = 'conflict-modal-title';
    const attribution = document.createElement('p');
    attribution.className = 'conflict-modal-attribution';
    head.appendChild(title);
    // The attribution element joins the head per variant below: the deleted
    // variant has nothing true to say (GD-10) and the neutral panel must not
    // repeat the fallback sentence it already shows (A7).
    modal.appendChild(head);

    const intro = document.createElement('p');
    intro.className = 'conflict-modal-intro';

    const actions = document.createElement('div');
    actions.className = 'conflict-modal-actions';

    // D-08: selected purely from the intercepted request's method — this
    // MUST be checked before conflictKind, since a DELETE request's own
    // conflictKind is always 'version' (see the constant's own doc comment
    // above for why 'deleted' can never arise here).
    const isDelete = method === 'DELETE';
    const isDeleted = !isDelete && body && body.conflictKind === 'deleted';
    // GD-7: a version conflict whose record the server withheld (clearance).
    // Strictly `=== null` — an absent field is not the server's withheld
    // signal. Checked BEFORE the delete/edit variants: for a withheld record
    // neither "Delete anyway" nor "Apply my changes anyway" can succeed, so
    // neither may be offered (T-09-51).
    const isWithheld = !!body && body.conflictKind !== 'deleted' && body.currentRecord === null;

    if (session.confirmState) {
      // R7 F-6 / GD-9: the in-app delete confirm — title is the page's own
      // question (textContent only, T-09-54), no intro, no attribution (there
      // is nothing to attribute yet). Cancel/Escape/overlay settle with null
      // and send nothing (T-09-55); "Delete" is the one destructive action.
      title.textContent = session.message;

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary conflict-btn-discard';
      cancelBtn.textContent = CONFLICT_CANCEL_LABEL;
      cancelBtn.addEventListener('click', () => {
        if (session.inFlight) return;
        settleConflictSession(session, null);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger conflict-btn-delete';
      deleteBtn.textContent = CONFIRM_DELETE_LABEL;
      deleteBtn.addEventListener('click', () => runConfirmDelete(session, deleteBtn, cancelBtn));

      actions.appendChild(cancelBtn);
      actions.appendChild(deleteBtn);
    } else if (isWithheld) {
      modal.appendChild(intro);
      title.textContent = CONFLICT_TITLE_EDIT;
      intro.textContent = CONFLICT_WITHHELD_TEXT;
      // Who/when still shows (T-09-17 accepted in 09-REVIEW IN-01): never what.
      renderConflictAttribution(attribution, body);
      head.appendChild(attribution);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary conflict-btn-discard';
      closeBtn.textContent = CONFLICT_CLOSE_LABEL;
      // Close settles the held promise with the original 409; the page's
      // re-read (09-12) then drops the record through the clearance-filtered GET.
      closeBtn.addEventListener('click', () => settleConflictSession(session, session.originalRes));
      actions.appendChild(closeBtn);
    } else if (isDelete) {
      // UI-SPEC E3: "No collection inside this variant — content is title +
      // attribution + actions, all static or covered by E4 rules." No intro
      // paragraph, no diff list — the title question IS the confirmation.
      title.textContent = CONFLICT_TITLE_DELETE;
      renderConflictAttribution(attribution, body);
      head.appendChild(attribution);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary conflict-btn-discard';
      cancelBtn.textContent = CONFLICT_CANCEL_LABEL;
      // Cancel: the record is kept, nothing is sent — the held promise
      // settles with the original 409 (the page then re-reads, GD-5).
      // WR-03 / A9: ignored while "Delete anyway" is on the wire.
      cancelBtn.addEventListener('click', () => {
        if (session.inFlight) return;
        settleConflictSession(session, session.originalRes);
      });

      // E3-loading (amended A9): "Delete anyway" enters a disabled "Deleting…"
      // state during the resubmit and "Cancel" is disabled with it — the
      // resubmit is irrevocable, so the page must learn its outcome. This dialog
      // itself IS the destructive confirmation — no window.confirm() is ever
      // stacked on top of it (D-08, asserted by the grep gate in the test).
      // E3-error (404 / network / 5xx) and a third-writer 409 are all handled
      // by runConflictReapply: never a silent success or a silent failure.
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger conflict-btn-delete';
      deleteBtn.textContent = CONFLICT_DELETE_LABEL;
      deleteBtn.addEventListener('click', () => runConflictReapply(session, deleteBtn, CONFLICT_DELETING_LABEL, cancelBtn));

      actions.appendChild(cancelBtn);
      actions.appendChild(deleteBtn);

      if (errorReason) {
        const errorBanner = document.createElement('p');
        errorBanner.className = 'conflict-modal-error';
        errorBanner.textContent = conflictErrorMessage(errorReason);
        modal.appendChild(errorBanner);
      }
    } else if (isDeleted) {
      modal.appendChild(intro);
      title.textContent = CONFLICT_TITLE_DELETED;
      intro.textContent = CONFLICT_DELETED_INTRO;
      // No attribution line (GD-10 / R7 F-7): the deleted row has no actor or
      // time to attribute, and the fallback sentence would contradict the title.

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary conflict-btn-discard';
      closeBtn.textContent = CONFLICT_CLOSE_LABEL;
      closeBtn.addEventListener('click', () => settleConflictSession(session, session.originalRes));
      actions.appendChild(closeBtn);
    } else {
      modal.appendChild(intro);
      title.textContent = CONFLICT_TITLE_EDIT;
      intro.textContent = CONFLICT_INTRO_EDIT;
      const realAttribution = renderConflictAttribution(attribution, body);

      const diffList = document.createElement('div');
      diffList.className = 'conflict-diff-list';

      let payload = {};
      try { payload = JSON.parse((init && init.body) || '{}'); } catch (e) { payload = {}; }
      const currentRecord = (body && body.currentRecord) || {};
      // Pitfall 12 / R7 F-3: the rows come from the per-route field map — the
      // payload's keys are the user's edited intent, translated to the record
      // field they stand for, and only fields the server's record has.
      const rows = buildConflictRows(session, payload, currentRecord);

      if (rows.length === 0) {
        // GD-6: the neutral panel — only the one true thing (the record's
        // version moved), via the single fallback constant. When the head's
        // attribution would repeat that very sentence it is omitted (A7).
        const neutral = document.createElement('p');
        neutral.className = 'conflict-diff-empty';
        neutral.textContent = CONFLICT_ATTRIBUTION_FALLBACK;
        diffList.appendChild(neutral);
        if (realAttribution) head.appendChild(attribution);
      } else {
        head.appendChild(attribution);
        rows.forEach((r) => {
          const row = document.createElement('div');
          row.className = 'conflict-diff-row';
          const label = document.createElement('div');
          label.className = 'conflict-diff-label';
          label.textContent = r.label;
          row.appendChild(label);

          const values = document.createElement('div');
          values.className = 'conflict-diff-values';

          const mine = document.createElement('div');
          mine.className = 'conflict-diff-mine';
          setConflictDiffValue(mine, r.mine);
          values.appendChild(mine);

          const theirs = document.createElement('div');
          theirs.className = 'conflict-diff-theirs';
          setConflictDiffValue(theirs, r.theirs);
          values.appendChild(theirs);

          row.appendChild(values);
          diffList.appendChild(row);
        });
      }
      modal.appendChild(diffList);

      const discardBtn = document.createElement('button');
      discardBtn.type = 'button';
      discardBtn.className = 'btn btn-secondary conflict-btn-discard';
      discardBtn.textContent = CONFLICT_DISCARD_LABEL;
      // Discard: nothing is sent — the held promise settles with the original
      // 409 and the page keeps/re-reads the server's ("theirs") state.
      // WR-03 / A9: ignored while the reapply is on the wire.
      discardBtn.addEventListener('click', () => {
        if (session.inFlight) return;
        settleConflictSession(session, session.originalRes);
      });

      // E2-loading (amended A9 — WR-03): clicking APPLY disables it, swaps its
      // label, and disables DISCARD alongside it for the duration of the
      // request. An exit mid-flight used to settle the page with the stale 409
      // while the irrevocable reapply was still committing. Both controls are
      // re-enabled by the re-render after any failure. The reapply (and every failure/third-
      // writer outcome, E2-error) lives in runConflictReapply — the "mine"
      // column is provably untouched, only the banner + button state change.
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.className = 'btn btn-primary conflict-btn-apply';
      applyBtn.textContent = CONFLICT_APPLY_LABEL;
      applyBtn.addEventListener('click', () => runConflictReapply(session, applyBtn, CONFLICT_APPLYING_LABEL, discardBtn));

      actions.appendChild(discardBtn);
      actions.appendChild(applyBtn);

      // E2-error: the inline banner sits above the action footer, inside
      // the dialog — never a separate toast, never a second overlay.
      if (errorReason) {
        const errorBanner = document.createElement('p');
        errorBanner.className = 'conflict-modal-error';
        errorBanner.textContent = conflictErrorMessage(errorReason);
        modal.appendChild(errorBanner);
      }
    }

    modal.appendChild(actions);
    // IN-04 (09-REVIEW round 2) / UI-SPEC A10: the focus trap cycles through
    // exactly these controls. A re-render (failed reapply, third writer)
    // rebuilt them, so focus moves to the new safe control when shown.
    session.actionButtons = Array.prototype.slice.call(actions.children);
    if (session.overlay && session.overlay.parentNode) focusConflictSession(session);
  }

  // IN-04 (09-REVIEW round 2) / UI-SPEC A10: keyboard focus belongs to the
  // dialog while it is shown. `aria-modal` alone does not trap focus, so Tab
  // could reach a page control behind the overlay (a second delete button,
  // whose maConfirmDelete then refused silently). Focus moves to the FIRST
  // enabled action — always the safe one (Discard / Cancel / Close) — or to
  // the modal itself when every action is disabled mid-flight.
  function focusConflictElement(el) {
    if (el && typeof el.focus === 'function') {
      try { el.focus(); } catch (e) { /* focus is best-effort, never fatal */ }
    }
  }
  function enabledConflictButtons(session) {
    return (session.actionButtons || []).filter((b) => b && !b.disabled);
  }
  function focusConflictSession(session) {
    const btns = enabledConflictButtons(session);
    focusConflictElement(btns.length ? btns[0] : session.modal);
  }
  // Tab / Shift+Tab wrap inside the dialog's enabled actions; focus that is
  // anywhere else (the page behind, the modal shell) is pulled back in.
  function trapConflictTab(session, e) {
    const btns = enabledConflictButtons(session);
    const prevent = () => { if (typeof e.preventDefault === 'function') e.preventDefault(); };
    if (!btns.length) { prevent(); focusConflictElement(session.modal); return; }
    const idx = btns.indexOf(document.activeElement);
    if (e.shiftKey) {
      if (idx <= 0) { prevent(); focusConflictElement(btns[btns.length - 1]); }
    } else if (idx === -1 || idx === btns.length - 1) {
      prevent();
      focusConflictElement(btns[0]);
    }
  }

  // Builds a session's overlay and shows it. Close on overlay-background
  // click and on Escape, plus each variant's own action — EVERY exit path
  // goes through settleConflictSession with the original 409 (or, for a
  // successful reapply, the reapplied response). Nothing on the page is
  // touched: no field cleared, no form reset, no navigation, no reload.
  function activateConflictSession(session) {
    const overlay = document.createElement('div');
    overlay.className = 'conflict-modal-overlay';
    const modal = document.createElement('div');
    modal.className = 'conflict-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    overlay.appendChild(modal);
    session.overlay = overlay;
    session.modal = modal;
    // 09-14: while the in-app confirm's first DELETE is on the wire it cannot
    // be cancelled (the request is already sent; the page must learn the
    // outcome) — Escape and an overlay click are ignored until it answers.
    // WR-03 (09-REVIEW round 2) / UI-SPEC A9: the same rule now holds for
    // EVERY variant — an Apply / Delete anyway reapply is just as irrevocable,
    // so any in-flight request of the session locks every exit.
    const exitLocked = () => session.inFlight;
    // IN-04 / A10: the modal itself is focusable (programmatically only) so
    // focus has somewhere to rest while every action is disabled mid-flight.
    modal.tabIndex = -1;
    session.returnFocus = (typeof document !== 'undefined') ? document.activeElement : null;
    session.onKeydown = (e) => {
      if (e.key === 'Escape' && !exitLocked()) settleConflictSession(session, session.originalRes);
      else if (e.key === 'Tab') trapConflictTab(session, e);
    };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && !exitLocked()) settleConflictSession(session, session.originalRes);
    });
    activeConflictSession = session;
    try {
      renderConflictSession(session, undefined);
      document.addEventListener('keydown', session.onKeydown);
      document.body.appendChild(overlay);
      focusConflictSession(session);
    } catch (e) {
      // A page's write promise must never hang forever on a rendering
      // failure: fall back to exactly what the wrapper did before sessions
      // existed — hand the caller the original 409.
      document.removeEventListener('keydown', session.onKeydown);
      settleConflictSession(session, session.originalRes);
    }
  }

  // Called from the 409 branch of attemptFetch for a marker 409 that is NOT a
  // dialog reapply. Returns the promise handed back to the caller: it stays
  // pending until the session settles.
  //
  // Ordering: a conflict arriving while another dialog is shown is queued
  // FIFO — never rendered over the shown one and never mislabelled "the record
  // changed again" — and opens as a FRESH render (no banner) when the shown
  // one settles. T-09-46 (DoS bound): the queue holds at most
  // CONFLICT_QUEUE_CAP sessions; a conflict beyond the cap resolves
  // immediately with its OWN 409 and opens nothing, so a flood of conflicting
  // writes can never pin unbounded promises and DOM.
  const CONFLICT_QUEUE_CAP = 20;
  const conflictQueue = [];

  function openNextQueuedConflict() {
    if (activeConflictSession) return;
    let next = conflictQueue.shift();
    while (next && next.settled) next = conflictQueue.shift();
    if (next) activateConflictSession(next);
  }

  function holdConflict(body, input, init, url, method, res) {
    if (activeConflictSession && conflictQueue.length >= CONFLICT_QUEUE_CAP) return res;
    return new Promise((resolve) => {
      const session = {
        body, input, init, url, method,
        originalRes: res, resolve,
        settled: false, inFlight: false,
        overlay: null, modal: null, onKeydown: null,
      };
      if (activeConflictSession) conflictQueue.push(session);
      else activateConflictSession(session);
    });
  }

  // D-07: bounded, jittered silent retry for transient write contention (503).
  const BUSY_RETRY_MAX_RETRIES = 2; // 2 retries = 3 total attempts
  const BUSY_RETRY_FALLBACK_WAIT_MS = 1000; // used when Retry-After is absent/unparseable
  const BUSY_RETRY_JITTER_MAX_MS = 300; // retry-storm avoidance: desynchronizes tabs
  // [security] T-08-12: an absurd server-sent Retry-After (finite but huge) must
  // never park the retry timer for hours — clamp to a 60s ceiling.
  const BUSY_RETRY_MAX_WAIT_SECONDS = 60;

  const parseRetryAfterMs = (res) => {
    const raw = res.headers && typeof res.headers.get === 'function' ? res.headers.get('Retry-After') : null;
    const seconds = parseInt(raw, 10);
    return Number.isFinite(seconds) && seconds >= 0
      ? Math.min(seconds, BUSY_RETRY_MAX_WAIT_SECONDS) * 1000
      : BUSY_RETRY_FALLBACK_WAIT_MS;
  };

  // A stream body, or an already-consumed Request object's body, can't be
  // safely replayed on a retry — only absent or string bodies are re-sendable.
  // WR-05 (Phase 8 review fix): every current caller in this codebase passes
  // `body` via the `init` object as a JSON.stringify(...) string, so
  // inspecting only `init.body` was correct for everything that exists
  // today. But a caller that instead does
  // `window.fetch(new Request(url, { method, body }))` would arrive here
  // with `init` empty/undefined while `input` is the pre-built Request whose
  // body is a stream ALREADY consumed by the first origFetch() call above —
  // this check would wrongly judge that retry "safe". `input` is inspected
  // for a `Request` instance FIRST (never retryable, regardless of `init`),
  // falling through to the existing init.body check otherwise.
  const isRetryableBody = (input, init) => {
    if (typeof Request !== 'undefined' && input instanceof Request) return false;
    return init.body === undefined || init.body === null || typeof init.body === 'string';
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // `ctx` (09-11): CONFLICT_REAPPLY_CONTEXT when this request is a conflict
  // dialog's own reapply — passed through the 503 retry recursion so the
  // reapply keeps its identity across a busy retry.
  // D-12-05 / R1 minor (Phase 12, plan 12-04): a 503 whose JSON body carries
  // `retryable: false` is a PERMANENT condition (e.g. the steerco-pack renderer
  // is unavailable on this host platform), not write contention — retrying it
  // is pointless and the give-up toast's "your change was not saved" is wrong
  // for a read. Keyed on the BODY MARKER, never the status alone (the same
  // discipline as the 409 `conflict` marker below). Only inspected when the
  // response is clonable and its body parses as JSON; anything else is treated
  // as plain contention, so the Phase 8 behaviour is unchanged.
  const isPermanentUnavailable = (res) => {
    if (typeof res.clone !== 'function') return Promise.resolve(false);
    try {
      return res.clone().json().then((body) => !!(body && body.retryable === false), () => false);
    } catch (e) {
      return Promise.resolve(false);
    }
  };

  const attemptFetch = (input, init, url, method, attempt, ctx) => origFetch(input, init).then((res) => {
    if (res.status === 503 && isApi(url)) {
      return isPermanentUnavailable(res).then((permanent) => {
        if (permanent) return res; // one fetch, no retry, no busy toast
        if (attempt < BUSY_RETRY_MAX_RETRIES && isRetryableBody(input, init)) {
          const wait = parseRetryAfterMs(res) + Math.floor(Math.random() * BUSY_RETRY_JITTER_MAX_MS);
          return delay(wait).then(() => attemptFetch(input, init, url, method, attempt + 1, ctx));
        }
        // Retries exhausted (or the body can't be safely re-sent): tell the user
        // plainly and leave the page/form exactly as it is so they can just save
        // again — nothing is discarded, cleared, or re-navigated (D-08).
        // IN-05 (09-REVIEW round 2) / UI-SPEC A11: a conflict dialog's own
        // reapply ("Apply my changes anyway" / "Delete anyway") gets NO toast —
        // the dialog stays open and says so in its own banner ("the server is
        // busy", runConflictReapply), so the user sees one message pointing at
        // one control. The in-app delete confirm's first DELETE (ctx carries
        // confirmSession) closes the dialog on a 503, so it keeps the toast.
        if (!(ctx && ctx.reapply && !ctx.confirmSession)) showBusyGiveUpToast();
        return res;
      });
    }
    // CONC-02/D-05/Pitfall 1 (Phase 9): a same-origin /api 409 is checked
    // for the `conflict: true` body marker, never the status code alone —
    // two unrelated 409s already exist elsewhere in this codebase (the
    // empty-deal steerco-pack refusal, the unrecognized synergy-stage
    // refusal). res.clone().json() mirrors the 401 branch's own pattern
    // below — the ORIGINAL response must still be returned to the caller.
    // This branch never calls delay() and never re-enters attemptFetch();
    // the ONLY re-fire path is the dialog's own action (runConflictReapply).
    // GD-4: a marker 409 that is NOT a dialog's own reapply opens a session
    // and returns the HELD promise (see the session comment above); a reapply
    // (ctx) gets its raw 409 Response back so that session re-renders in place.
    if (res.status === 409 && isApi(url)) {
      return res.clone().json().then((body) => {
        if (body && body.conflict === true && !(ctx && ctx.reapply)) {
          return holdConflict(body, input, init, url, method, res);
        }
        return res;
      }).catch(() => res);
    }
    // D-10-05 (Phase 10, client half): a 403 whose body carries
    // `mustChangePassword: true` is the server's forced-rotation gate (plan
    // 10-05) — the account must set a new password before any other API call
    // works. Keyed on the BODY MARKER, never the status alone (a role-denied
    // 403 is a different thing). The redirect is a UX convenience; the server
    // gate is the control. The ORIGINAL response is always returned.
    if (res.status === 403 && isApi(url)) {
      return res.clone().json().then((body) => {
        if (body && body.mustChangePassword === true && !onLoginPage() && !onChangePasswordPage()) {
          window.location.href = '/change-password.html';
        }
        return res;
      }).catch(() => res);
    }
    if (res.status !== 401 || !isApi(url)) return res;
    return res.clone().json().then((body) => {
      if (body && body.authRequired) {
        if (!onLoginPage()) window.location.href = '/login.html';
        return res;
      }
      return maybePromptForToken(res, input, init, method);
    }).catch(() => maybePromptForToken(res, input, init, method));
  });

  window.fetch = function (input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = (init.method || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
    const tok = localStorage.getItem(KEY);
    if (tok && isApi(url)) init = withToken(init, tok);
    return attemptFetch(input, init, url, method, 0);
  };

  // R7 F-6 / GD-9 / D-08 (09-14): the in-app delete confirm. The 09-UI-SPEC's
  // "Destructive confirmation" row promised ONE surface; the pages' browser
  // confirm stacked a second prompt in front of the stale-delete dialog.
  // `maConfirmDelete(message, url)` opens a conflict session in a 'confirm'
  // state of the same `.conflict-modal` shell; "Delete" sends the DELETE and,
  // on a marker 409, the SAME overlay becomes the stale-delete variant.
  // Resolves null when nothing was sent (Cancel/Escape/overlay, or another
  // dialog already open — it refuses rather than stack), the final Response
  // otherwise (2xx; the original 409 after a stale-state Cancel; a
  // non-conflict error so the page shows its own), and REJECTS on a network
  // failure — exactly what a plain window.fetch(url, {method:'DELETE'})
  // would have handed the page, so its existing branches keep working (D-05).
  window.maConfirmDelete = function (message, url) {
    if (activeConflictSession) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
      let init = { method: 'DELETE' };
      const tok = localStorage.getItem(KEY);
      if (tok && isApi(url)) init = withToken(init, tok);
      const session = {
        body: null, input: url, init, url, method: 'DELETE',
        originalRes: null, resolve, reject,
        settled: false, inFlight: false,
        overlay: null, modal: null, onKeydown: null,
        confirmState: true, message: String(message),
      };
      activateConflictSession(session);
    });
  };
})();
// ma-fetch-wrapper:end

// Playbook slide viewer: any element with data-playbook-slide="N" (or a call to
// window.openPlaybookSlide(N)) opens the HR M&A Guidebook PDF at that slide in a modal.
// Slide number == PDF page number (1:1 from the pptx conversion).
(function () {
  const PDF = '/playbook/hr-ma-guidebook.pdf';
  function openPlaybookSlide(n, label) {
    n = parseInt(n, 10) || 1;
    const existing = document.getElementById('playbook-modal-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'playbook-modal-overlay';
    overlay.className = 'playbook-modal-overlay';
    overlay.innerHTML =
      '<div class="playbook-modal" role="dialog" aria-modal="true">' +
        '<div class="playbook-modal-head">' +
          '<span class="playbook-modal-title">📘 HR M&amp;A Guidebook' + (label ? ' — ' + label : ' — Slide ' + n) + '</span>' +
          '<div class="playbook-modal-actions">' +
            '<a href="' + PDF + '#page=' + n + '" target="_blank" rel="noopener" class="playbook-modal-open">Open full deck ↗</a>' +
            '<button type="button" class="playbook-modal-x" aria-label="Close">✕</button>' +
          '</div>' +
        '</div>' +
        '<iframe class="playbook-modal-frame" src="' + PDF + '#page=' + n + '&view=FitH" title="HR M&amp;A Guidebook slide ' + n + '"></iframe>' +
      '</div>';
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.playbook-modal-x').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }
  window.openPlaybookSlide = openPlaybookSlide;
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-playbook-slide]');
    if (t) { e.preventDefault(); openPlaybookSlide(t.getAttribute('data-playbook-slide'), t.getAttribute('data-playbook-label')); }
  });

  // Generic HTML-slide overlay: an admin-provided HTML slide (pasted link or uploaded
  // file) is shown full-screen over the app; closing (✕ / Esc) returns to the page.
  function openHtmlSlide(url, label) {
    if (!url) return;
    const existing = document.getElementById('html-slide-overlay');
    if (existing) existing.remove();
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // Only allow http(s) / same-origin URLs — encodeURI does NOT neutralise a
    // 'javascript:' (or data:/vbscript:) scheme, so validate the protocol instead.
    let safeUrl = '#';
    try {
      const u = new URL(url, window.location.origin);
      if (u.protocol === 'http:' || u.protocol === 'https:') safeUrl = u.href;
    } catch (_) { safeUrl = '#'; }
    const overlay = document.createElement('div');
    overlay.id = 'html-slide-overlay';
    overlay.className = 'slide-overlay';
    overlay.innerHTML =
      '<div class="slide-overlay-bar">' +
        '<span class="slide-overlay-title">\u{1F5A5}️ ' + esc(label || 'Slide') + '</span>' +
        '<div class="slide-overlay-actions">' +
          '<a href="' + safeUrl + '" target="_blank" rel="noopener" class="slide-overlay-open">Open in new tab ↗</a>' +
          '<button type="button" class="slide-overlay-x" aria-label="Close">✕ Close</button>' +
        '</div>' +
      '</div>' +
      '<iframe class="slide-overlay-frame" src="' + safeUrl + '" title="' + esc(label || 'Slide') + '"></iframe>';
    document.body.appendChild(overlay);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    overlay.querySelector('.slide-overlay-x').addEventListener('click', close);
    document.addEventListener('keydown', onKey);
  }
  window.openHtmlSlide = openHtmlSlide;
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-html-slide]');
    if (t) { e.preventDefault(); openHtmlSlide(t.getAttribute('data-html-slide'), t.getAttribute('data-html-slide-label')); }
  });
})();

// Access Control redirection check
(function() {
  const path = window.location.pathname;
  let activeRole = localStorage.getItem('active_demo_role') || 'admin';

  // [security] WR-C01 (Phase 11 review): deriving the role from the PATH below
  // is a demo-persona convenience (open admin.html and you "are" the admin). On
  // a login deployment it made this page check a tautology for admin.html,
  // pmo.html, dashboard.html, supporting.html and employee.html — any role could
  // open them, and their staff loaders fired requests the server refuses. The
  // real-login handshake below records that this browser is talking to a
  // login-enforcing server ('ma_auth_role_verified') and stores the SERVER-VERIFIED role in
  // active_demo_role; once that flag is set the path no longer overrides it, so
  // this synchronous check runs against the verified role before any page
  // loader fires. The handshake re-checks with the verified role on every load
  // (the authoritative client check — a first-ever visit has no stored role
  // yet), and the server gate remains the control either way. Demo-open (auth
  // off) clears the flag, so the showcase keeps its path-derived personas.
  const authVerified = localStorage.getItem('ma_auth_role_verified') === '1';
  if (!authVerified) {
    // Detect role from path to update localStorage automatically
    if (path.includes('admin.html')) activeRole = 'admin';
    else if (path.includes('pmo.html')) activeRole = 'pmo';
    else if (path.includes('dashboard.html')) activeRole = 'hrbp';
    else if (path.includes('supporting.html')) activeRole = 'supporting';
    else if (path.includes('employee.html')) activeRole = 'employee';

    localStorage.setItem('active_demo_role', activeRole);
  }

  // Define allowed roles for each page
  const pageAccess = {
    // D-02 (Phase 3): hrbp (Integration Lead) must also reach the admin
    // console — it is the only place the real-deal create-deal form and
    // Deals tab live (public/js/admin.js). This is a coarse, page-level
    // allowance (not a capability grant) — every actual write the console
    // makes is independently re-checked server-side by ROLE_WRITE_POLICY, so
    // an hrbp session visiting this page still gets 403'd by the server on
    // any action outside what D-02 actually allows it to do.
    'admin.html': ['admin', 'hrbp'],
    'pmo.html': ['admin', 'pmo'],
    'dashboard.html': ['admin', 'pmo', 'hrbp'],
    'supporting.html': ['admin', 'pmo', 'supporting'],
    'employee.html': ['admin', 'pmo', 'employee'],
    'survey.html': ['admin', 'pmo', 'hrbp'],
    'assessments.html': ['admin', 'pmo', 'hrbp'],
    'execution.html': ['admin', 'pmo', 'hrbp'],
    'playbook.html': ['admin', 'pmo', 'hrbp', 'supporting'],
    // WIZ-01 (Phase 4 Plan 07): the new-deal setup wizard supersedes the
    // Phase-3 minimal create-deal modal (D-06) — same admin+hrbp (Integration
    // Lead) audience D-02 already gives deal creation. A client-side
    // convenience gate only — every write route the wizard calls is
    // independently role-checked server-side regardless of this map.
    'deal-wizard.html': ['admin', 'hrbp']
    // 'due-diligence.html' and 'org.html' have NO role entry here — their gate
    // is a CAPABILITY, not a role (pageCapability below). History: IN-02
    // (04-REVIEW.md, 06-REVIEW.md) left them ungated because DD-area / `hr`
    // clearance is per deal member, so "a pmo/employee member granted an area
    // must reach the page". Since Phase 11 (D-11-01) the read policy refuses
    // `employee` every /api/dd and /api/org route regardless of grants, so that
    // reason only still holds for pmo — WR-C04 (Phase 11 review). The handshake
    // now redirects when the server's access map says `dd` / `org` is refused
    // (an employee), and keeps the page for every role it allows (pmo with or
    // without clearance: the server filters per area, so an uncleared member
    // sees an empty workspace, never another area's content).
  };
  // [security] WR-C04: pages gated on a server-computed capability key
  // (window.maCan) instead of a role list.
  const pageCapability = { 'due-diligence.html': 'dd', 'org.html': 'org' };

  function roleAllowedOnPage(p, role) {
    for (const [page, roles] of Object.entries(pageAccess)) {
      if (p.includes(page) && !roles.includes(role)) return false;
    }
    return true;
  }
  function denyPage(role) {
    sessionStorage.setItem('access_denied_message', `🔒 Access Denied: The requested page is restricted for your selected role (${String(role || '').toUpperCase()}).`);
    window.location.href = '/';
  }
  // [security] WR-C01/WR-C04: the handshake below calls these with the
  // SERVER-VERIFIED role once /api/auth/me has answered (explicit globals —
  // they carry no role table of their own beyond this page map).
  window.maPageAllowed = function (role) {
    const p = window.location.pathname;
    if (!roleAllowedOnPage(p, role)) return false;
    for (const [page, key] of Object.entries(pageCapability)) {
      if (p.includes(page) && typeof window.maCan === 'function' && !window.maCan(key)) return false;
    }
    return true;
  };
  window.maDenyPage = denyPage;

  if (!roleAllowedOnPage(path, activeRole)) denyPage(activeRole);
})();

// Real-login handshake (only active on PORTAL_AUTH=1 deployments; the open demo
// gets { authEnabled:false } and nothing changes). The server-verified role
// overrides the client-side demo role, and a logout link joins the sidebar.
(function () {
  // [security] D-11-01/D-11-02 (Phase 11, plan 11-07): the client half of the
  // read/write policy. The server computes an `access` map (booleans only) on
  // GET /api/auth/me from lib/readPolicy.js and ROLE_WRITE_POLICY — this file
  // carries NO copy of the role table. `window.maCan(key)` is false ONLY when
  // the map says `false` for that key, so an absent map (demo-open, the demo
  // store, a failed probe, a page that never ran the handshake) shows every
  // control exactly as the showcase always has. `window.maAccessReady` settles
  // once the probe has been processed (also on failure and when auth is off), so
  // a page waits on it before deciding to hide a control or skip a request that
  // would only 403. Hiding is advisory UX; the server gate remains the control.
  window.__portalAccess = null;
  window.maCan = function (key) {
    var a = window.__portalAccess;
    return !a || a[key] !== false;
  };
  // Convenience for call sites: resolves to maCan(key) once the probe settled.
  window.maCanReady = function (key) {
    return window.maAccessReady.then(function () { return window.maCan(key); });
  };
  // Hide `el` (hidden + display:none, never merely disabled) once the probe
  // settled, when the map refuses `key`. Absent map => untouched.
  window.maHideUnless = function (key, el) {
    return window.maCanReady(key).then(function (ok) {
      if (ok || !el) return;
      el.hidden = true;
      el.style.display = 'none';
    });
  };
  if (window.location.pathname.includes('login.html')) {
    window.maAccessReady = Promise.resolve();
    return;
  }
  // WR-C01: 'ma_auth_role_verified' tells the synchronous page check above that
  // active_demo_role holds a server-verified role (see its comment). Cleared
  // whenever the server says auth is off or there is no session.
  const AUTH_FLAG = 'ma_auth_role_verified';
  const forgetVerifiedRole = function () {
    try { localStorage.removeItem(AUTH_FLAG); } catch (e) { /* storage unavailable */ }
  };
  // WR-C07: the deal this session is bound to (null on the demo store / demo-open).
  window.__portalDealId = null;
  window.maAccessReady = fetch('/api/auth/me').then(r => r.json()).then(me => {
    if (!me || !me.authEnabled) { forgetVerifiedRole(); return; }
    if (!me.user) { forgetVerifiedRole(); window.location.href = '/login.html'; return; }
    window.__portalUser = me.user;
    window.__portalAccess = (me.access && typeof me.access === 'object') ? me.access : null;
    window.__portalDealId = me.dealId || null; // WR-C07: bound to a real deal?
    if (me.user.role) {
      localStorage.setItem('active_demo_role', me.user.role);
      localStorage.setItem(AUTH_FLAG, '1');
    }
    // D-10-05 (client half): an account that must rotate its password cannot
    // use any other page — send it to the standalone change screen and stop
    // (no header menu, no logout link here). UX only; the server gate is the
    // control.
    if (me.user.mustChangePassword === true && !window.location.pathname.includes('change-password.html')) {
      window.location.href = '/change-password.html';
      return;
    }
    // [security] WR-C01 / WR-C04 (Phase 11 review): the page gate, now with the
    // SERVER-VERIFIED role and the server's capability map — never the
    // path-derived demo persona. A role this page is not for (employee on
    // admin.html / pmo.html, pmo on admin.html) or a refused capability
    // (employee on due-diligence.html / org.html) is sent home with the usual
    // access-denied toast. The page loaders wait on maAccessReady before their
    // first request, so a redirected page sends none. UX only: every route
    // stays refused server-side whatever this decides.
    if (me.user.role && typeof window.maPageAllowed === 'function' && !window.maPageAllowed(me.user.role)) {
      if (typeof window.maDenyPage === 'function') window.maDenyPage(me.user.role);
      return;
    }
    // D-10-07: header-menu "Change password" / "My sessions" (any role). Loaded
    // once, the same id-guarded way deal-switcher.js is.
    if (!document.getElementById('account-menu-js')) {
      const amScript = document.createElement('script');
      amScript.id = 'account-menu-js';
      amScript.src = '/js/account-menu.js?v=1791700102';
      document.body.appendChild(amScript);
    }
    // [security] SAFE-07 / D-13-06: client storage hygiene (logout clearing +
    // the one-time legacy clean-up). Same id-guarded dynamic loader; the
    // logout handler below uses window.MAClientStorage when it has loaded and
    // otherwise still performs the server logout (PD-34 degraded path).
    if (!document.getElementById('client-storage-js')) {
      const csScript = document.createElement('script');
      csScript.id = 'client-storage-js';
      csScript.src = '/js/client-storage.js?v=1';
      document.body.appendChild(csScript);
    }
    let tries = 0;
    const addLogout = () => {
      const foot = document.querySelector('.sidebar-footer');
      if (!foot) { if (tries++ < 40) setTimeout(addLogout, 250); return; }
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = '⎋ ' + (me.user.name || me.user.username) + ' — Logout';
      a.style.cssText = 'display:block;margin-top:0.4rem;font-size:0.72rem;color:inherit;text-decoration:underline;cursor:pointer;';
      a.addEventListener('click', (ev) => {
        ev.preventDefault();
        forgetVerifiedRole();
        const goLogin = () => { window.location.href = '/login.html'; };
        // [security] SAFE-07 (T-13-31): the server logout runs INSIDE
        // clearOnLogout (after the language-key snapshot); a failed request
        // still clears this browser and navigates.
        if (window.MAClientStorage && typeof window.MAClientStorage.clearOnLogout === 'function') {
          window.MAClientStorage.clearOnLogout().then(goLogin, goLogin);
        } else {
          fetch('/api/auth/logout', { method: 'POST' }).then(goLogin, goLogin);
        }
      });
      foot.appendChild(a);
    };
    addLogout();
  }).catch(() => { /* auth probe is best-effort */ });

  // WR-C07 (Phase 11 review; the employee "own messages" projection is deferred
  // to Phase 22): D-11-01 refuses an employee every /api/communications read in
  // a real deal, so a message addressed to employees there is logged but never
  // seen in-app. One honest sender-side line under a composer's recipient
  // picker, shown only for a session bound to a real deal (never on the demo
  // store or in demo-open). textContent only; `data-i18n` lets a translation
  // replace the English fallback.
  window.maAddEmployeeInboxNote = function (anchor) {
    if (!anchor || !anchor.parentNode) return Promise.resolve();
    return window.maAccessReady.then(function () {
      if (!window.__portalDealId) return;
      if (anchor.parentNode.querySelector('.ma-employee-inbox-note')) return;
      var note = document.createElement('p');
      note.className = 'ma-employee-inbox-note';
      note.setAttribute('data-i18n', 'comms.employee_inapp_unavailable');
      note.textContent = "Employees can't read in-app messages yet.";
      note.style.cssText = 'margin:0.35rem 0 0;font-size:0.75rem;color:var(--text-secondary);font-style:italic;';
      anchor.parentNode.insertBefore(note, anchor.nextSibling);
      if (typeof window.applyPortalI18n === 'function') window.applyPortalI18n();
    });
  };
})();

/**
 * TE Connectivity M&A Integration Portal - Transitions Manager
 * Intercepts document navigation to apply highly premium slide-out, slide-in,
 * and top slim loading bar transitions for an ultra-premium, modern SPA feel.
 */

// Shared global Animated SVG Yellow Rubber Duck helper
function getTeodorDuckSvg(size = '100%', extraClasses = '') {
  return `
    <svg class="teodor-duck-svg ${extraClasses}" style="width: ${size}; height: ${size};" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <g class="duck-bounce">
        <!-- Duck Body & Wing (Yellow #FBBF24) -->
        <path d="M20,60 C20,80 80,80 85,55 C90,45 80,35 60,35 C55,25 45,15 35,25 C25,35 30,50 20,60 Z" fill="#FBBF24" stroke="#D97706" stroke-width="2.5" class="duck-body" />
        <!-- Wing detail -->
        <path d="M45,48 C35,48 35,63 48,63 C58,63 60,53 50,48 Z" fill="#F59E0B" stroke="#D97706" stroke-width="1.5" class="duck-wing" />
        <!-- Head -->
        <circle cx="38" cy="32" r="16" fill="#FBBF24" stroke="#D97706" stroke-width="2.5" class="duck-head" />
        <!-- Eye -->
        <g class="duck-eye-group">
          <circle cx="44" cy="28" r="2.5" fill="#1E293B" class="duck-eye" />
          <circle cx="45" cy="27" r="0.75" fill="#FFFFFF" class="duck-pupil" />
        </g>
        <!-- Orange Beak -->
        <path d="M52,30 C58,30 60,34 52,36 C48,36 48,30 52,30 Z" fill="#F97316" stroke="#C2410C" stroke-width="1.5" class="duck-beak" />
        <!-- Tiny TE Branding Tie -->
        <rect x="33" y="45" width="10" height="4" rx="1" fill="#E98300" class="duck-tie" />
      </g>
    </svg>
  `;
}

// Make it available globally for other scripts (e.g. dashboard.js, pmo.js)
window.getTeodorDuckSvg = getTeodorDuckSvg;

// Splash is demo theatre hidden per 2026-08-01 request; implementation below is
// deliberately kept intact — flip this to false to restore it.
const SPLASH_SCREEN_DISABLED = true;
// --- Post-Merger Splash Screen Injection ---
function triggerPostMergerSplashScreen() {
  if (SPLASH_SCREEN_DISABLED) {
    return;
  }

  const path = window.location.pathname;
  const isPmoPage = path === '/' || path.endsWith('/index.html') || path.endsWith('/pmo.html');
  if (!isPmoPage) {
    return;
  }

  const overlay = document.createElement('div');
  overlay.id = 'pmi-splash-overlay';
  overlay.className = 'pmi-splash-screen';
  overlay.innerHTML = `
    <div class="pmi-splash-card">
      <button type="button" class="pmi-splash-skip-btn" id="pmi-splash-skip-btn">Skip ⏭️</button>
      <div class="pmi-splash-glow"></div>
      <div class="pmi-splash-header">
        <span class="pmi-splash-badge">PMI SYSTEM ACTIVE</span>
        <h2>POST-MERGER INTEGRATION</h2>
        <div class="pmi-splash-subtitle">TE Connectivity &times; NextGen Sensors</div>
      </div>
      
      <div class="pmi-splash-logos-row">
        <!-- TE Logo SVG -->
        <div class="pmi-logo-wrapper te-logo">
          <svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="40" fill="#244C5A" rx="4"/>
            <text x="50" y="26" font-family="'Outfit', 'Inter', sans-serif" font-size="18" font-weight="900" fill="#ffffff" text-anchor="middle">TE</text>
          </svg>
        </div>

        <!-- Dynamic integration sparks -->
        <div class="pmi-sparks-bridge">
          <div class="spark-dot"></div>
          <div class="spark-line"></div>
          <div class="spark-dot"></div>
        </div>

        <!-- NextGen Logo SVG -->
        <div class="pmi-logo-wrapper nextgen-logo">
          <svg viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
            <rect width="100" height="40" fill="#E98300" rx="4"/>
            <text x="50" y="25" font-family="'Outfit', 'Inter', sans-serif" font-size="12" font-weight="700" fill="#ffffff" text-anchor="middle">NEXTGEN</text>
          </svg>
        </div>
      </div>

      <div class="pmi-splash-ticker" id="pmi-splash-ticker">
        Initializing Merger Protocols...
      </div>

      <div class="pmi-splash-progress-container">
        <div class="pmi-splash-progress-bar" id="pmi-splash-progress-bar"></div>
      </div>
      
      <div class="pmi-splash-footer">
        Day 1 - 100 Post-Merger Onboarding System
      </div>
    </div>
  `;

  const style = document.createElement('style');
  style.id = 'pmi-splash-styles';
  style.textContent = `
    .pmi-splash-screen {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 99999;
      background: radial-gradient(circle at center, #0f242e 0%, #050a0e 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: 'Outfit', 'Inter', sans-serif;
      transition: opacity 0.5s ease, filter 0.5s ease;
    }
    .pmi-splash-card {
      position: relative;
      width: 440px;
      max-width: 90%;
      background: rgba(16, 32, 41, 0.7);
      border: 1px solid rgba(233, 131, 0, 0.25);
      border-radius: 12px;
      padding: 2.25rem 2rem;
      text-align: center;
      box-shadow: 0 0 40px rgba(0, 0, 0, 0.65), 0 0 20px rgba(233, 131, 0, 0.15);
      backdrop-filter: blur(16px);
      overflow: hidden;
    }
    .pmi-splash-skip-btn {
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.6);
      font-size: 0.7rem;
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      font-family: monospace;
      transition: all 0.2s;
      z-index: 10;
    }
    .pmi-splash-skip-btn:hover {
      background: rgba(233, 131, 0, 0.15);
      border-color: #E98300;
      color: #ffffff;
    }
    .pmi-splash-glow {
      position: absolute;
      top: -50%;
      left: -50%;
      width: 200%;
      height: 200%;
      background: radial-gradient(circle, rgba(233, 131, 0, 0.05) 0%, rgba(0,0,0,0) 60%);
      pointer-events: none;
    }
    .pmi-splash-badge {
      display: inline-block;
      background: rgba(233, 131, 0, 0.12);
      color: #E98300;
      border: 1px solid rgba(233, 131, 0, 0.3);
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.1rem;
      padding: 0.2rem 0.6rem;
      border-radius: 20px;
      margin-bottom: 0.85rem;
      box-shadow: 0 0 8px rgba(233, 131, 0, 0.25);
    }
    .pmi-splash-header h2 {
      color: #ffffff;
      margin: 0;
      font-size: 1.4rem;
      font-weight: 800;
      letter-spacing: 0.05rem;
      font-family: 'Outfit', sans-serif;
    }
    .pmi-splash-subtitle {
      color: rgba(255, 255, 255, 0.45);
      font-size: 0.8rem;
      margin-top: 0.25rem;
      font-weight: 600;
    }
    .pmi-splash-logos-row {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 1.5rem;
      margin: 2rem 0;
    }
    .pmi-logo-wrapper {
      width: 105px;
      height: 42px;
      border-radius: 4px;
      overflow: hidden;
      box-shadow: 0 4px 10px rgba(0,0,0,0.3);
      transition: transform 0.3s;
    }
    .pmi-logo-wrapper.te-logo {
      animation: logoMergeLeft 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
    .pmi-logo-wrapper.nextgen-logo {
      animation: logoMergeRight 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
    }
    @keyframes logoMergeLeft {
      0% { transform: translateX(-40px) scale(0.85); opacity: 0; }
      100% { transform: translateX(0) scale(1); opacity: 1; }
    }
    @keyframes logoMergeRight {
      0% { transform: translateX(40px) scale(0.85); opacity: 0; }
      100% { transform: translateX(0) scale(1); opacity: 1; }
    }
    .pmi-sparks-bridge {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .spark-line {
      width: 40px;
      height: 2px;
      background: linear-gradient(to right, #244C5A, #E98300);
      position: relative;
      overflow: hidden;
    }
    .spark-line::after {
      content: '';
      position: absolute;
      width: 10px;
      height: 100%;
      background: #ffffff;
      box-shadow: 0 0 6px #ffffff;
      animation: sparkSweep 1.2s infinite linear;
    }
    @keyframes sparkSweep {
      0% { left: -10px; }
      100% { left: 40px; }
    }
    .spark-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #E98300;
      box-shadow: 0 0 6px #E98300;
    }
    .pmi-splash-ticker {
      color: #60A5FA;
      font-family: monospace;
      font-size: 0.75rem;
      min-height: 16px;
      margin-bottom: 0.85rem;
      text-shadow: 0 0 4px rgba(96, 165, 250, 0.25);
    }
    .pmi-splash-progress-container {
      width: 100%;
      height: 5px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 1.25rem;
    }
    .pmi-splash-progress-bar {
      width: 0%;
      height: 100%;
      background: linear-gradient(to right, #244C5A 0%, #E98300 100%);
      box-shadow: 0 0 8px rgba(233, 131, 0, 0.5);
      border-radius: 10px;
      transition: width 0.1s linear;
    }
    .pmi-splash-footer {
      color: rgba(255, 255, 255, 0.3);
      font-size: 0.65rem;
      font-weight: 500;
      letter-spacing: 0.05rem;
      text-transform: uppercase;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const bar = document.getElementById('pmi-splash-progress-bar');
  const ticker = document.getElementById('pmi-splash-ticker');
  const skipBtn = document.getElementById('pmi-splash-skip-btn');

  let percent = 0;
  const tickerStates = [
    { p: 15, text: "● HR Database Synchronized [100%]" },
    { p: 40, text: "● SSO Cyber-Vault Integrity [Harmonized]" },
    { p: 70, text: "● Synergy Progress Tracker [Cap: 100%]" },
    { p: 90, text: "● Welcome Kits Apparel customizer [Active]" },
    { p: 100, text: "● Merger complete! Welcome to TE Connectivity!" }
  ];

  let currentTick = 0;
  const interval = setInterval(() => {
    percent += Math.floor(Math.random() * 4) + 1;
    if (percent >= 100) {
      percent = 100;
      clearInterval(interval);
      
      ticker.textContent = tickerStates[tickerStates.length - 1].text;
      ticker.style.color = "#34D399";
      ticker.style.textShadow = "0 0 6px rgba(52, 211, 153, 0.4)";
      bar.style.width = "100%";
      
      if (typeof window.triggerConfetti === 'function') {
        window.triggerConfetti();
      }

      setTimeout(dismissSplash, 900);
    } else {
      bar.style.width = `${percent}%`;
      
      if (currentTick < tickerStates.length - 1 && percent >= tickerStates[currentTick].p) {
        ticker.textContent = tickerStates[currentTick].text;
        currentTick++;
        
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          try {
            const actx = new AudioContextClass();
            const osc = actx.createOscillator();
            const gain = actx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600 + currentTick * 100, actx.currentTime);
            gain.gain.setValueAtTime(0.03, actx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.1);
            osc.connect(gain);
            gain.connect(actx.destination);
            osc.start();
            osc.stop(actx.currentTime + 0.1);
          } catch (e) {}
        }
      }
    }
  }, 35);

  function dismissSplash() {
    clearInterval(interval);
    overlay.style.opacity = '0';
    overlay.style.filter = 'blur(10px)';
    
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      try {
        const actx = new AudioContextClass();
        const osc1 = actx.createOscillator();
        const osc2 = actx.createOscillator();
        const gain = actx.createGain();
        osc1.type = 'triangle';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(523.25, actx.currentTime); // C5
        osc2.frequency.setValueAtTime(659.25, actx.currentTime + 0.08); // E5
        gain.gain.setValueAtTime(0.06, actx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.35);
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(actx.destination);
        osc1.start();
        osc1.stop(actx.currentTime + 0.3);
        osc2.start(actx.currentTime + 0.08);
        osc2.stop(actx.currentTime + 0.35);
      } catch (e) {}
    }

    setTimeout(() => {
      overlay.remove();
      style.remove();
    }, 500);
  }

  skipBtn.addEventListener('click', dismissSplash);
}

document.addEventListener('DOMContentLoaded', () => {
  // Show access denied toast if it exists
  const accessDeniedMsg = sessionStorage.getItem('access_denied_message');
  if (accessDeniedMsg) {
    sessionStorage.removeItem('access_denied_message');
    setTimeout(() => {
      const toast = document.createElement('div');
      toast.style.cssText = `
        position: fixed;
        top: 85px;
        left: 50%;
        transform: translateX(-50%) translateY(-20px);
        background: rgba(185, 28, 28, 0.95);
        border: 1.5px solid var(--te-orange);
        color: white;
        padding: 0.85rem 1.75rem;
        border-radius: 30px;
        font-size: 0.85rem;
        font-weight: bold;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        z-index: 99999;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        opacity: 0;
      `;
      toast.innerText = accessDeniedMsg;
      document.body.appendChild(toast);
      
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
      });

      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => toast.remove(), 350);
      }, 4000);
    }, 400);
  }

  // Fire splash screen only when visiting the PMO integration console
  const path = window.location.pathname;
  if (path === '/' || path === '/index.html' || path.endsWith('/pmo.html')) {
    triggerPostMergerSplashScreen();
  }

  // Inject Role Guidance & Action Timeline Banner Card
  injectRoleGuidanceBanner();
  // [security] SAFE-07 / D-13-06 (c) / T-13-32 (R5-15): this page-init block
  // used to unregister every service worker and DELETE EVERY Cache Storage
  // entry on every page load — which also threw away the downloaded
  // Transformers model each navigation. That unconditional wipe is gone. The
  // only clean-up left is MAClientStorage.runLegacyCleanupOnce(): once per
  // browser, /sw.js registrations and previously shipped legacy cache names
  // only, never the model cache. client-storage.js also runs it on load, so the
  // order of the two scripts never matters.
  if (window.MAClientStorage && typeof window.MAClientStorage.runLegacyCleanupOnce === 'function') {
    window.MAClientStorage.runLegacyCleanupOnce();
  }

  // Apply edit mode body class immediately on load if enabled
  if (localStorage.getItem('adminEditMode') === 'true') {
    document.body.classList.add('admin-edit-active');
  }

  // 1. Inject and animate the top thin progress bar on load
  const progressBar = document.createElement('div');
  progressBar.className = 'transition-progress-bar';
  document.body.appendChild(progressBar);

  // Trigger rapid loading progress simulation
  requestAnimationFrame(() => {
    progressBar.style.width = '30%';
    progressBar.style.opacity = '1';
    
    setTimeout(() => {
      progressBar.style.width = '100%';
      setTimeout(() => {
        progressBar.style.opacity = '0';
        setTimeout(() => {
          progressBar.style.width = '0%';
        }, 300);
      }, 200);
    }, 50);
  });

  // 2. Trigger the smooth slide-in entry after document load
  setTimeout(() => {
    document.body.classList.add('page-loaded');
  }, 50);

  // 3. Intercept local link navigations to run the elegant exit transition
  document.addEventListener('click', (e) => {
    // Traverse up to find if clicked element is an <a> tag
    let target = e.target;
    while (target && target.tagName !== 'A') {
      target = target.parentElement;
    }

    if (target && target.href && target.getAttribute('target') !== '_blank') {
      const url = new URL(target.href);
      const isSameHost = url.hostname === window.location.hostname;
      const isInternal = isSameHost && !target.hash; // Skip normal anchor-links (#)
      
      // If it's a valid local page navigation
      if (isInternal) {
        e.preventDefault();
        const destination = target.href;
        
        // Show progress bar and animate to 100%
        progressBar.style.opacity = '1';
        progressBar.style.width = '0%';
        
        setTimeout(() => {
          progressBar.style.width = '100%';
        }, 10);
        
        // Add the exit transition class
        document.body.classList.remove('page-loaded');
        document.body.classList.add('page-exiting');
        
        // Wait for the exit animation to complete, then route
        setTimeout(() => {
          window.location.href = destination;
        }, 280);
      }
    }
  });

  // 4. Overhaul Brand Wrapper and Restructure Header to Two-Row Layout
  const mainHeader = document.querySelector('.main-header');
  if (mainHeader && !document.querySelector('.header-module-row')) {
    const brandWrapper = mainHeader.querySelector('.brand-wrapper');
    
    // Create module and top rows
    const moduleRow = document.createElement('div');
    moduleRow.className = 'header-module-row';

    const topRow = document.createElement('div');
    topRow.className = 'header-top-row';

    // Move or overhaul brandWrapper (preserving page-specific header controls, e.g. the Admin mode pills)
    if (brandWrapper) {
      const preservedControls = Array.from(brandWrapper.querySelectorAll('#demo-mode-switcher-container, #edit-mode-switcher-container'));
      brandWrapper.innerHTML = `
        <a href="/" class="brand-logo-link" style="text-decoration: none; display: flex; align-items: center; gap: 1.25rem; transition: transform 0.2s;">
          <div class="brand-logo-container">
            <img class="brand-logo-svg" src="/te-logo.png" alt="TE Connectivity" style="height:36px;width:auto;display:block;">
          </div>
          <div class="brand-divider"></div>
          <div class="brand-title">
            <span class="portal-badge">M&A Integration</span>
          </div>
        </a>
      `;
      if (preservedControls.length) {
        // Admin mode pills live on the left side of the module-tabs row
        const pillsWrapper = document.createElement('div');
        pillsWrapper.className = 'header-admin-pills';
        preservedControls.forEach(c => pillsWrapper.appendChild(c));
        moduleRow.appendChild(pillsWrapper);
      }
      const logoLink = brandWrapper.querySelector('.brand-logo-link');
      if (logoLink) {
        logoLink.addEventListener('mouseenter', () => logoLink.style.transform = 'scale(1.025)');
        logoLink.addEventListener('mouseleave', () => logoLink.style.transform = 'scale(1)');
      }
      topRow.appendChild(brandWrapper);
    }

    // Create new navigation-bar and append to topRow
    const navBar = document.createElement('nav');
    navBar.className = 'navigation-bar';
    topRow.appendChild(navBar);

    // Inject Header Module Switcher inside moduleRow
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'header-module-tabs';
    tabsContainer.innerHTML = `
      <button type="button" class="header-module-tab active" id="header-mod-hr">
        🧬 HR Module
      </button>
      <button type="button" class="header-module-tab disabled" id="header-mod-finance" title="🔒 Finance Integration Module (Locked)">
        🔒 Finance Module
      </button>
      <button type="button" class="header-module-tab disabled" id="header-mod-sales" title="🔒 Sales Integration Module (Locked)">
        🔒 Sales Module
      </button>
    `;
    moduleRow.appendChild(tabsContainer);

    // Empty main header, then append rows: module tabs strip on top, main bar below
    mainHeader.innerHTML = '';
    mainHeader.appendChild(moduleRow);
    mainHeader.appendChild(topRow);

    // Helper for floating glass header toast
    function showGlobalHeaderToast(message) {
      let toast = document.getElementById('global-header-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'global-header-toast';
        toast.style.cssText = `
          position: fixed;
          top: 90px;
          left: 50%;
          transform: translateX(-50%) translateY(-20px);
          background: rgba(36, 76, 90, 0.95);
          border: 1px solid var(--te-orange);
          color: white;
          padding: 0.75rem 1.5rem;
          border-radius: 30px;
          font-size: 0.82rem;
          font-weight: bold;
          box-shadow: 0 8px 32px rgba(0,0,0,0.15);
          z-index: 99999;
          opacity: 0;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          pointer-events: none;
        `;
        document.body.appendChild(toast);
      }
      toast.innerText = message;
      requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
      });
      clearTimeout(window.globalHeaderToastTimeout);
      window.globalHeaderToastTimeout = setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
      }, 3000);
    }

    // Bind warning clicks
    tabsContainer.addEventListener('click', (e) => {
      const button = e.target.closest('.header-module-tab');
      if (!button) return;
      if (button.id === 'header-mod-hr') {
        showGlobalHeaderToast("🧬 HR Module is currently active and fully operational.");
      } else if (button.classList.contains('disabled')) {
        showGlobalHeaderToast("🔒 Module Locked: Complete the HR Integration phase first to unlock Finance & Sales.");
      }
    });
  }

  // 5. Inject Premium Context-Aware Navigation & User Profile Widget
  const navBar = document.querySelector('.navigation-bar');
  if (navBar) {
    const path = window.location.pathname;
    const activeRole = localStorage.getItem('active_demo_role') || 'admin';

    // --- Collapsible Sidebar Navigation (replaces the old header link row) ---
    const portalCatalog = {
      employee: { href: '/employee.html?name=Alex&role=R%26D%20Specialist&dept=R%26D', icon: '\u{1F464}', title: 'Employee Portal', desc: 'Onboarding Academy & Tasks', match: 'employee.html' },
      leaders: { href: '/leaders.html', icon: '\u{1F451}', title: 'Leaders Portal', desc: 'Acquired HR & Site Leaders Workspace', match: 'leaders.html' },
      pmo: { href: '/pmo.html', icon: '\u{1F3E2}', title: 'PMO Console', desc: 'Cross-Functional Integration Control Desk', match: 'pmo.html' },
      dashboard: { href: '/dashboard.html', icon: '\u{1F4CA}', title: 'Leader Dashboard', desc: 'Integration Leader Metrics & Sentiment', match: 'dashboard.html' },
      supporting: { href: '/supporting.html', icon: '\u{1F465}', title: 'Supporting Teams', desc: 'HRSS, Regional HR, Legal, Rewards Hub', match: 'supporting.html' },
      admin: { href: '/admin.html', icon: '\u2699\uFE0F', title: 'Admin Console', desc: 'Configurations & AI Settings', match: 'admin.html' }
    };
    const portalItemsByRole = {
      admin: ['employee', 'leaders', 'pmo', 'dashboard', 'supporting', 'admin'],
      pmo: ['employee', 'leaders', 'pmo', 'dashboard', 'supporting'],
      hrbp: ['dashboard'],
      supporting: ['supporting'],
      employee: ['employee']
    };
    const portalItems = (portalItemsByRole[activeRole] || []).map(k => portalCatalog[k]);
    const resourceItems = (activeRole === 'admin' || activeRole === 'pmo' || activeRole === 'hrbp' || activeRole === 'supporting') ? [
      { href: '/capability-hub.html', icon: '\u{1F9E0}', title: 'Capability Hub', desc: 'Assessment & Development Tools', match: 'capability-hub.html' },
      { href: '/integration-excellence.html', icon: '\u{1F31F}', title: 'Integration Excellence', desc: 'Onboarding Journey & Identity', match: 'integration-excellence.html' },
      { href: '/playbook.html', icon: '\u{1F4D6}', title: 'Integration Playbook', desc: 'Legal & HR Integration Steps', match: 'playbook-main' },
      { href: '/playbook.html#lessons-learned', icon: '\u{1F4A1}', title: 'Lessons Learned', desc: 'Past M&A Case Studies & Guides', match: 'lessons-learned' }
    ] : [];

    const isLinkActive = (item) => {
      if (item.match === 'playbook-main') return path.includes('playbook.html') && !window.location.hash.includes('lessons-learned');
      if (item.match === 'lessons-learned') return path.includes('playbook.html') && window.location.hash.includes('lessons-learned');
      return path.includes(item.match);
    };

    const renderSideLink = (item) => `
      <a href="${item.href}" class="sidebar-link sidebar-sub-link ${isLinkActive(item) ? 'active' : ''}" title="${item.title} \u2014 ${item.desc}">
        <span class="sidebar-link-icon">${item.icon}</span>
        <span class="sidebar-link-label">${item.title}</span>
      </a>`;

    const renderSideGroup = (key, icon, label, items) => {
      if (!items.length) return '';
      return `
      <div class="sidebar-group open" data-group="${key}">
        <button type="button" class="sidebar-group-btn" title="${label}">
          <span class="sidebar-link-icon">${icon}</span>
          <span class="sidebar-link-label">${label}</span>
          <svg class="sidebar-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
        </button>
        <div class="sidebar-group-items">${items.map(renderSideLink).join('')}</div>
      </div>`;
    };

    const sidebar = document.createElement('aside');
    sidebar.className = 'demo-sidebar';
    sidebar.id = 'demo-sidebar';
    sidebar.innerHTML = `
      <div class="sidebar-top">
        <span class="sidebar-title">Navigation</span>
        <button type="button" class="sidebar-toggle-btn" id="sidebar-toggle-btn" title="Collapse / expand menu">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
      </div>
      <nav class="sidebar-nav">
        <a href="/" class="sidebar-link ${path === '/' || path === '' ? 'active' : ''}" title="Overview — M&A HR Integration Enablement">
          <span class="sidebar-link-icon">\u{1F3E0}</span>
          <span class="sidebar-link-label">Overview</span>
        </a>
        <a href="/index.html" class="sidebar-link ${path.includes('index.html') ? 'active' : ''}" title="Role Showcase — enter the portal by role">
          <span class="sidebar-link-icon">\u{1F6AA}</span>
          <span class="sidebar-link-label">Role Showcase</span>
        </a>
        <a href="/insights.html" class="sidebar-link ${path.includes('insights.html') ? 'active' : ''}" title="M&A Insights — current target + acquisition radar">
          <span class="sidebar-link-icon">\u{1F4C8}</span>
          <span class="sidebar-link-label">M&A Insights</span>
        </a>
        ${(activeRole === 'admin' || activeRole === 'pmo' || activeRole === 'hrbp') ? `
        <a href="/assessments.html" class="sidebar-link ${path.includes('assessments.html') ? 'active' : ''}" title="Readiness Assessments — company & Integration Leader readiness">
          <span class="sidebar-link-icon">\u{1F3AF}</span>
          <span class="sidebar-link-label">Assessments</span>
        </a>
        <a href="/execution.html" class="sidebar-link ${path.includes('execution.html') ? 'active' : ''}" title="Execution Hub — Day-1 checklist & workstream tasks">
          <span class="sidebar-link-icon">\u{2705}</span>
          <span class="sidebar-link-label">Execution Hub</span>
        </a>` : ''}
        ${(activeRole === 'admin' || activeRole === 'pmo' || activeRole === 'hrbp') ? `
        <a href="javascript:void(0)" class="sidebar-link" id="sidebar-survey-link" title="Survey Scorecard">
          <span class="sidebar-link-icon">\u{1F4CB}</span>
          <span class="sidebar-link-label">Survey</span>
        </a>` : ''}
        ${renderSideGroup('portals', '\u{1F9ED}', 'Portals', portalItems)}
        ${renderSideGroup('resources', '\u{1F4DA}', 'Resources', resourceItems)}
      </nav>
      <a href="/admin.html" class="sidebar-link sidebar-admin-link${path.includes('admin.html') ? ' active' : ''}" title="Admin Console">
        <span class="sidebar-link-icon">\u{2699}️</span>
        <span class="sidebar-link-label">Admin Console</span>
      </a>
      <a href="javascript:void(0)" class="sidebar-link sidebar-egg" data-html-slide="/overview-deck/easter-egg.html" data-html-slide-label="Simply The Best" title="You're simply the best ✨" style="opacity:.55;">
        <span class="sidebar-link-icon">⭐</span>
        <span class="sidebar-link-label">The Best</span>
      </a>
      <div class="sidebar-footer">TE M&A Integration Demo</div>
    `;
    document.body.appendChild(sidebar);
    document.body.classList.add('has-demo-sidebar');
    if (localStorage.getItem('demo_sidebar_collapsed') === '1') {
      document.body.classList.add('sidebar-collapsed');
    }
    // Enable collapse/expand animations only after the first paint
    requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.add('sidebar-anim-ready')));

    // Scrim behind the off-canvas sidebar on small screens
    const sidebarScrim = document.createElement('div');
    sidebarScrim.className = 'sidebar-scrim';
    document.body.appendChild(sidebarScrim);
    sidebarScrim.addEventListener('click', () => document.body.classList.remove('sidebar-open-mobile'));

    // Collapse / expand toggle (persisted)
    sidebar.querySelector('#sidebar-toggle-btn').addEventListener('click', () => {
      const collapsed = document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem('demo_sidebar_collapsed', collapsed ? '1' : '0');
    });

    // Survey scorecard modal trigger
    const sidebarSurveyLink = sidebar.querySelector('#sidebar-survey-link');
    if (sidebarSurveyLink) {
      sidebarSurveyLink.addEventListener('click', () => {
        if (typeof window.showSurveyModal === 'function') window.showSurveyModal();
        document.body.classList.remove('sidebar-open-mobile');
      });
    }

    // Submenu accordion behavior (persisted per group); clicking a group on the
    // collapsed rail expands the sidebar first.
    const groupStateKey = 'demo_sidebar_groups';
    let sidebarGroupState = {};
    try { sidebarGroupState = JSON.parse(localStorage.getItem(groupStateKey) || '{}'); } catch (e) { sidebarGroupState = {}; }
    sidebar.querySelectorAll('.sidebar-group').forEach(group => {
      const key = group.getAttribute('data-group');
      if (sidebarGroupState[key] === false) group.classList.remove('open');
      group.querySelector('.sidebar-group-btn').addEventListener('click', () => {
        if (document.body.classList.contains('sidebar-collapsed')) {
          document.body.classList.remove('sidebar-collapsed');
          localStorage.setItem('demo_sidebar_collapsed', '0');
          group.classList.add('open');
        } else {
          group.classList.toggle('open');
        }
        sidebarGroupState[key] = group.classList.contains('open');
        localStorage.setItem(groupStateKey, JSON.stringify(sidebarGroupState));
      });
    });

    // --- In-app notifications: bell + panel, computed by /api/notifications ---
    if (activeRole === 'admin' || activeRole === 'pmo' || activeRole === 'hrbp') {
      fetch('/api/notifications').then(r => r.json()).then(n => {
        if (!n || !n.success) return;
        const items = n.items || [];
        const top = sidebar.querySelector('.sidebar-top');
        if (!top) return;
        const bell = document.createElement('button');
        bell.type = 'button';
        bell.className = 'sidebar-toggle-btn sidebar-bell';
        bell.title = 'Notifications';
        bell.style.cssText = 'position:relative;margin-right:0.25rem;';
        bell.innerHTML = '🔔' + (items.length
          ? '<span style="position:absolute;top:-4px;right:-4px;background:#C0392B;color:#fff;border-radius:50%;min-width:16px;height:16px;font-size:0.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;padding:0 3px;">' + items.length + '</span>'
          : '');
        top.insertBefore(bell, top.querySelector('#sidebar-toggle-btn'));

        const escN = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const SEV_ICON = { high: '⚠️', medium: '⏰', low: 'ℹ️' };
        const itemHtml = (it) => {
          let label;
          if (it.type === 'assessment_pending') {
            label = '<span data-i18n="' + escN(it.titleKey) + '">' + escN(it.title) + '</span> — <span data-i18n="notif.assessment_pending">required assessment not completed</span>';
          } else if (it.count != null) {
            label = '<strong>' + it.count + '</strong> <span data-i18n="notif.' + escN(it.type) + '">' + escN(it.type) + '</span>';
          } else {
            label = '<span data-i18n="notif.' + escN(it.type) + '">' + escN(it.type) + '</span>';
          }
          return '<a href="' + escN(it.href) + '" style="display:flex;gap:0.6rem;align-items:flex-start;padding:0.6rem 0.8rem;border-radius:8px;text-decoration:none;color:var(--text-primary,#1c2b33);font-size:0.82rem;line-height:1.45;" onmouseover="this.style.background=\'rgba(233,131,0,0.08)\'" onmouseout="this.style.background=\'none\'">'
            + '<span style="flex:none;">' + (SEV_ICON[it.severity] || 'ℹ️') + '</span><span>' + label + '</span></a>';
        };
        const panel = document.createElement('div');
        panel.className = 'sidebar-notif-panel';
        panel.style.cssText = 'display:none;position:fixed;z-index:5000;width:320px;max-height:60vh;overflow-y:auto;background:var(--card-bg,#fff);border:1px solid var(--border-color,#dde3e6);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,0.25);padding:0.6rem;';
        panel.innerHTML = '<div style="font-weight:800;color:var(--te-dark-teal,#244C5A);font-size:0.85rem;padding:0.4rem 0.8rem;" data-i18n="notif.title">Notifications</div>'
          + (items.length ? items.map(itemHtml).join('') : '<div style="padding:0.6rem 0.8rem;font-size:0.82rem;color:var(--text-dim,#7a848a);" data-i18n="notif.none">All clear — nothing needs attention.</div>');
        document.body.appendChild(panel);
        bell.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = panel.style.display === 'none';
          if (open) {
            const rect = bell.getBoundingClientRect();
            panel.style.top = Math.min(rect.bottom + 8, window.innerHeight - 200) + 'px';
            panel.style.left = Math.min(rect.left, window.innerWidth - 336) + 'px';
          }
          panel.style.display = open ? 'block' : 'none';
        });
        document.addEventListener('click', (e) => {
          if (panel.style.display !== 'none' && !panel.contains(e.target) && e.target !== bell) panel.style.display = 'none';
        });
        if (window.applyPortalI18n) window.applyPortalI18n();
      }).catch(() => { /* notifications are best-effort */ });
    }

    // Hamburger: toggles the sidebar (fully hidden <-> shown); overlay mode on small screens
    const hamburgerBtn = document.createElement('button');
    hamburgerBtn.type = 'button';
    hamburgerBtn.className = 'sidebar-hamburger-btn';
    hamburgerBtn.title = 'Toggle navigation menu';
    hamburgerBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>';
    hamburgerBtn.addEventListener('click', () => {
      if (window.matchMedia('(max-width: 900px)').matches) {
        document.body.classList.toggle('sidebar-open-mobile');
      } else {
        const collapsed = document.body.classList.toggle('sidebar-collapsed');
        localStorage.setItem('demo_sidebar_collapsed', collapsed ? '1' : '0');
      }
    });
    const headerTopRowEl = document.querySelector('.header-top-row');
    if (headerTopRowEl) headerTopRowEl.insertBefore(hamburgerBtn, headerTopRowEl.firstChild);

    // Navigating from the mobile overlay closes it
    sidebar.querySelectorAll('a.sidebar-link[href^="/"]').forEach(a => {
      a.addEventListener('click', () => document.body.classList.remove('sidebar-open-mobile'));
    });


    // Inject Time Machine menu container
    const timeMachineContainer = document.createElement('div');
    timeMachineContainer.className = 'time-machine-menu';
    timeMachineContainer.innerHTML = `
      <button class="time-travel-btn" id="time-machine-trigger" type="button" title="PMI Integration Time Machine">
        <svg class="clock-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>
        <span class="active-day-badge" id="active-day-badge-text">Day 30</span>
      </button>
      <div class="time-travel-dropdown-card" id="time-travel-dropdown">
        <div class="time-dropdown-header">
          <h4>PMI Integration State</h4>
          <p>Select Day to simulate integration maturity progress</p>
        </div>
        <div class="time-dropdown-list">
          <button type="button" class="time-item-btn" data-day="1">
            <span class="time-day-label">Day 1</span>
            <span class="time-day-desc">Announcement (Baseline / 0% XP)</span>
          </button>
          <button type="button" class="time-item-btn" data-day="30">
            <span class="time-day-label">Day 30</span>
            <span class="time-day-desc">Onboarding Sync (22% Avg XP)</span>
          </button>
          <button type="button" class="time-item-btn" data-day="60">
            <span class="time-day-label">Day 60</span>
            <span class="time-day-desc">Systems Midterm (44% Avg XP)</span>
          </button>
          <button type="button" class="time-item-btn" data-day="90">
            <span class="time-day-label">Day 90</span>
            <span class="time-day-desc">Academy Pioneers (78% Avg XP)</span>
          </button>
          <button type="button" class="time-item-btn" data-day="100">
            <span class="time-day-label">Day 100+</span>
            <span class="time-day-desc">Full Synergy (100% Certified)</span>
          </button>
        </div>
      </div>
    `;

    const roleProfiles = {
      admin: { name: "IMO Administrator", role: "System Admin", email: "admin@te.com", initials: "AD" },
      pmo: { name: "Marcus Aurelius", role: "PMO Lead", email: "maurelius@te.com", initials: "MA" },
      hrbp: { name: "Karen Peterson", role: "Integration Leader", email: "karen.peterson@te.com", initials: "KP" },
      supporting: { name: "Jane Doe", role: "Supporting Function Lead", email: "jdoe@te.com", initials: "JD" },
      employee: { name: "Alex", role: "Legacy Acquired Cohort", email: "alex@te-legacy.com", initials: "AL" }
    };
    const prof = roleProfiles[activeRole] || roleProfiles.admin;

    // Inject User Profile Menu container
    const profileContainer = document.createElement('div');
    profileContainer.className = 'user-profile-menu';
    profileContainer.innerHTML = `
      <button class="profile-trigger-btn" id="profile-menu-trigger" type="button">
        <div class="profile-avatar" id="header-profile-avatar">${prof.initials}</div>
        <div class="profile-meta-text">
          <span class="profile-name" id="header-profile-name">${prof.name.split(' ')[0]}</span>
          <span class="profile-role" id="header-profile-role">${prof.role}</span>
        </div>
        <svg class="dropdown-chevron-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
      </button>
      <div class="profile-dropdown-card" id="profile-dropdown-card">
        <div class="dropdown-header">
          <div class="dropdown-avatar" id="dropdown-profile-avatar">${prof.initials}</div>
          <div class="dropdown-user-details">
            <h4 id="dropdown-profile-name">${prof.name}</h4>
            <p id="dropdown-profile-email">${prof.email}</p>
          </div>
        </div>
        <div class="dropdown-body">
          <div class="dropdown-item">
            <span class="item-label">Assigned Tracks:</span>
            <span class="item-value" id="dropdown-profile-tracks">${activeRole === 'admin' ? 'All Integration Tracks' : activeRole === 'pmo' ? 'Timeline & Steering' : activeRole === 'supporting' ? 'Divisional Operations' : activeRole === 'employee' ? 'R&D Specialization' : 'Culture & Talent'}</span>
          </div>
          <div class="dropdown-item">
            <span class="item-label">Scope Target:</span>
            <span class="item-value" id="dropdown-profile-target">NextGen Sensors Ltd.</span>
          </div>
          <div class="dropdown-item">
            <span class="item-label">Scope Sector:</span>
            <span class="item-value" id="dropdown-profile-sector">Sensors & Controls</span>
          </div>
          <div class="dropdown-item" style="border-top: 1px solid var(--border-color); padding-top: 0.75rem; margin-top: 0.25rem;">
            <span class="item-label">Access Clearance:</span>
            <span class="item-value security-badge"><span class="pulse-dot-active"></span> ${activeRole.toUpperCase()}</span>
          </div>
          ${activeRole === 'hrbp' ? `
          <button type="button" id="switch-user-btn" style="width: 100%; margin-top: 0.6rem; padding: 0.5rem 0.75rem; background: var(--te-dark-teal); color: #fff; border: none; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; font-family: inherit;">&#8644; Switch Operational Profile</button>
          ` : ''}
      </div>
    `;
    const topRow = document.querySelector('.header-top-row');

    // Unified Header Tools: Time Machine + Role Switcher + Device Previewer
    const headerToolsContainer = document.createElement('div');
    headerToolsContainer.className = 'header-tools-container';
    headerToolsContainer.style.display = 'flex';
    headerToolsContainer.style.alignItems = 'center';
    headerToolsContainer.style.gap = '0.6rem';

    headerToolsContainer.innerHTML = `
      <div class="role-switcher-wrapper" style="display: flex; align-items: center; gap: 0.5rem;">
        <span style="font-size: 0.8rem; color: var(--text-dim); font-weight: 600;">Role:</span>
        <select id="role-switcher-select" style="padding: 0.4rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-family: inherit; font-size: 0.85rem; outline: none; cursor: pointer;">
          <option value="admin" ${activeRole === 'admin' ? 'selected' : ''}>IMO Admin Console</option>
          <option value="pmo" ${activeRole === 'pmo' ? 'selected' : ''}>PMO Coordinator</option>
          <option value="hrbp" ${activeRole === 'hrbp' ? 'selected' : ''}>Integration Leader</option>
          <option value="supporting" ${activeRole === 'supporting' ? 'selected' : ''}>Supporting Functions</option>
          <option value="employee" ${activeRole === 'employee' ? 'selected' : ''}>Acquired Employee</option>
        </select>
      </div>
      <div class="lang-switcher-wrapper" style="display: flex; align-items: center; gap: 0.35rem; border-left: 1px solid var(--border-color); padding-left: 0.6rem;">
        <span style="font-size: 0.9rem;">🌐</span>
        <select id="portal-lang-select" title="Language" style="padding: 0.35rem; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); font-family: inherit; font-size: 0.85rem; outline: none; cursor: pointer;"></select>
      </div>
      <div class="device-preview-controls" style="display: flex; gap: 0.4rem; border-left: 1px solid var(--border-color); padding-left: 0.6rem; border-right: none; margin-right: 0;">
        <button class="device-preview-btn active" id="btn-preview-desktop" title="Desktop View">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
        </button>
        <button class="device-preview-btn" id="btn-preview-tablet" title="Tablet View">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
        </button>
        <button class="device-preview-btn" id="btn-preview-mobile" title="Mobile View">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
        </button>
      </div>
    `;

    // Phase 6: app-wide "Edit Content" toggle for the admin operator (content pages
    // have no admin EDIT MODE pill). Reuses the adminEditMode flag + editModeChanged.
    if (!document.getElementById('edit-mode-switcher-container')) {
      const editWrap = document.createElement('div');
      editWrap.style.cssText = 'display:flex;align-items:center;border-left:1px solid var(--border-color);padding-left:0.6rem;';
      const editToggle = document.createElement('button');
      editToggle.id = 'inline-edit-toggle';
      editToggle.type = 'button';
      editToggle.style.cssText = 'padding:0.4rem 0.75rem;border-radius:20px;border:1.2px dashed var(--te-dark-teal);font-family:inherit;font-size:0.75rem;font-weight:700;cursor:pointer;white-space:nowrap;transition:all 0.2s;';
      const syncToggle = () => {
        const on = localStorage.getItem('adminEditMode') === 'true';
        editToggle.textContent = on ? '✏️ Editing: ON' : '✏️ Edit Content';
        editToggle.style.background = on ? 'var(--te-orange)' : 'transparent';
        editToggle.style.color = on ? '#fff' : 'var(--te-dark-teal)';
        editToggle.style.borderStyle = on ? 'solid' : 'dashed';
        editToggle.style.borderColor = on ? 'var(--te-orange)' : 'var(--te-dark-teal)';
      };
      syncToggle();
      editToggle.addEventListener('click', () => {
        const next = localStorage.getItem('adminEditMode') !== 'true';
        localStorage.setItem('adminEditMode', next ? 'true' : 'false');
        document.body.classList.toggle('admin-edit-active', next);
        document.dispatchEvent(new CustomEvent('editModeChanged'));
        syncToggle();
      });
      document.addEventListener('editModeChanged', syncToggle);
      editWrap.appendChild(editToggle);
      headerToolsContainer.appendChild(editWrap);
      // [security] D-11-02 (plan 11-07): inline editing saves through POST
      // /api/i18n and POST /api/pages (admin-only). The toggle is not offered to
      // a role the server's access map says cannot write configuration/content.
      window.maCanReady('configWrite').then(function (ok) {
        if (ok) return;
        editWrap.style.display = 'none';
        if (localStorage.getItem('adminEditMode') === 'true') {
          localStorage.setItem('adminEditMode', 'false');
          document.body.classList.remove('admin-edit-active');
        }
      });
    }

    // Time machine (Day pill) leads the tools cluster
    headerToolsContainer.insertBefore(timeMachineContainer, headerToolsContainer.firstElementChild);
    // [security] IN-C01 (Phase 11 review): the Day pill posts to the demo-only
    // POST /api/settings/time-travel, which the server refuses in a real-deal
    // session (and for a role the write table does not list). The pill is not
    // offered when the server's access map says `timeTravel` is false; with no
    // map (demo-open) it stays exactly as before.
    window.maHideUnless('timeTravel', timeMachineContainer);

    // Phase 6: load the inline content editor once (app-wide)
    if (!document.getElementById('inline-edit-js')) {
      const ieScript = document.createElement('script');
      ieScript.id = 'inline-edit-js';
      ieScript.src = '/js/inline-edit.js?v=1791800001';
      document.body.appendChild(ieScript);
    }

    // Notification/alert banners: load the per-page banner renderer once (app-wide)
    if (!document.getElementById('banners-js')) {
      const bScript = document.createElement('script');
      bScript.id = 'banners-js';
      bScript.src = '/js/banners.js?v=1783577700';
      document.body.appendChild(bScript);
    }

    // D-04 (Phase 3): the real-deal header switcher — loaded once, app-wide,
    // the SAME way inline-edit.js/banners.js are above. Deliberately loaded
    // AFTER headerToolsContainer/topRow are appended below (this code block
    // runs synchronously before the browser yields to fetch/execute the
    // newly-inserted <script>), so deal-switcher.js's own
    // document.querySelector('.header-tools-container') lookup always finds
    // its target already in the DOM.
    if (!document.getElementById('deal-switcher-js')) {
      const dsScript = document.createElement('script');
      dsScript.id = 'deal-switcher-js';
      dsScript.src = '/js/deal-switcher.js?v=1791700101';
      document.body.appendChild(dsScript);
    }

    if (topRow) {
      topRow.appendChild(headerToolsContainer);
      topRow.appendChild(profileContainer);
    } else {
      navBar.appendChild(headerToolsContainer);
      navBar.appendChild(profileContainer);
    }

    // Bind Resize Preview Logic
    const bindPreviewEvents = () => {
      const btnDesk = document.getElementById('btn-preview-desktop');
      const btnTab = document.getElementById('btn-preview-tablet');
      const btnMob = document.getElementById('btn-preview-mobile');

      if (!btnDesk || !btnTab || !btnMob) return;

      // Floating indicator so it's obvious you're inside a device-preview frame — the
      // shrunk mobile/tablet frame otherwise looks like the site "broke". Click to exit.
      const ensurePill = () => {
        let pill = document.getElementById('device-preview-indicator');
        if (!pill) {
          pill = document.createElement('button');
          pill.id = 'device-preview-indicator';
          pill.type = 'button';
          pill.title = 'Exit device preview (back to desktop)';
          pill.addEventListener('click', () => setView('desktop'));
          document.body.appendChild(pill);
        }
        return pill;
      };
      const updatePill = (mode) => {
        if (mode === 'tablet' || mode === 'mobile') {
          const pill = ensurePill();
          pill.textContent = (mode === 'mobile' ? '📱 Mobile preview' : '🔲 Tablet preview') + ' — exit ✕';
          pill.style.display = 'flex';
        } else {
          const pill = document.getElementById('device-preview-indicator');
          if (pill) pill.style.display = 'none';
        }
      };

      const setView = (mode) => {
        document.body.classList.remove('preview-tablet', 'preview-mobile');
        btnDesk.classList.remove('active');
        btnTab.classList.remove('active');
        btnMob.classList.remove('active');

        if (mode === 'tablet') {
          document.body.classList.add('preview-tablet');
          btnTab.classList.add('active');
        } else if (mode === 'mobile') {
          document.body.classList.add('preview-mobile');
          btnMob.classList.add('active');
        } else {
          mode = 'desktop';
          btnDesk.classList.add('active');
        }
        // Persist the choice so a reload keeps the intended view instead of silently
        // snapping back to desktop (which made the toggle feel broken).
        try { localStorage.setItem('preview_device', mode); } catch (e) {}
        updatePill(mode);
      };

      btnDesk.addEventListener('click', () => setView('desktop'));
      btnTab.addEventListener('click', () => setView('tablet'));
      btnMob.addEventListener('click', () => setView('mobile'));

      // Restore the last-selected device preview on load (desktop = no-op default).
      let saved = 'desktop';
      try { saved = localStorage.getItem('preview_device') || 'desktop'; } catch (e) {}
      if (saved === 'tablet' || saved === 'mobile') setView(saved);
    };
    // Need to bind slightly after DOM paint
    setTimeout(bindPreviewEvents, 100);

    // Bind Role Switcher Logic: persist the demo role and jump to that role's home page
    setTimeout(() => {
      const roleSelect = document.getElementById('role-switcher-select');
      if (roleSelect) {
        roleSelect.addEventListener('change', (e) => {
          const newRole = e.target.value;
          localStorage.setItem('active_demo_role', newRole);
          const roleHomePages = {
            admin: '/admin.html',
            pmo: '/pmo.html',
            hrbp: '/dashboard.html',
            supporting: '/supporting.html',
            employee: '/employee.html?name=Alex&role=R%26D%20Specialist&dept=R%26D'
          };
          window.location.href = roleHomePages[newRole] || '/';
        });
      }
    }, 100);

    // Floating quick-nav: jump to ANY app section (admin-controlled via settings.floatingMenuEnabled)
    const buildQuickNav = () => {
      const host = document.getElementById('unified-nav-groups');
      if (!host || host.dataset.filled) return;
      const allResources = [
        { href: '/capability-hub.html', icon: '\u{1F9E0}', title: 'Capability Hub', match: 'capability-hub.html' },
        { href: '/integration-excellence.html', icon: '\u{1F31F}', title: 'Integration Excellence', match: 'integration-excellence.html' },
        { href: '/playbook.html', icon: '\u{1F4D6}', title: 'Integration Playbook', match: 'playbook-main' },
        { href: '/playbook.html#lessons-learned', icon: '\u{1F4A1}', title: 'Lessons Learned', match: 'lessons-learned' }
      ];
      const generalItems = [
        { href: '/', icon: '\u{1F3E0}', title: 'Demo Home', match: 'index-home' },
        { href: '/survey.html', icon: '\u{1F4CB}', title: 'Integration Survey', match: 'survey.html' },
        { href: '/signage.html', icon: '\u{1F4FA}', title: 'Lobby Signage', match: 'signage.html' }
      ];
      const quickActive = (item) => {
        if (item.match === 'index-home') return path === '/' || path === '' || path.includes('index.html');
        return isLinkActive(item);
      };
      // [security] T-ERM-03 (260810-erm): a LOCAL escapeHtml — the one
      // defined inside initGlobalTeodorChatbot() (below) is scoped to that
      // function alone and unreachable here; function declarations hoist
      // only within their own containing function, never across sibling
      // functions, so this must be its own copy rather than a reach-across
      // reference.
      function escapeHtml(unsafe) {
        return String(unsafe == null ? '' : unsafe)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      }
      // [security] T-ERM-03 (260810-erm): escaping alone does NOT stop a
      // `javascript:`/`data:` scheme URL from executing when clicked —
      // only a scheme ALLOWLIST does. Bookmark hrefs originate from
      // GET /api/menus (write ACL admin/hrbp/pmo) and render in EVERY
      // user's chrome on EVERY page, so an attacker-authored bookmark href
      // is neutralized here regardless of write-side validation. Accepts a
      // relative path, a `#`-anchor, or an http(s) absolute URL; anything
      // else (javascript:, data:, vbscript:, etc.) degrades to '#'.
      const safeUrl = (u) => {
        const s = String(u == null ? '' : u).trim();
        if (!s) return '#';
        if (s.charAt(0) === '/' || s.charAt(0) === '#' || s.charAt(0) === '?') return s;
        if (/^https?:\/\//i.test(s)) return s;
        return '#';
      };
      const renderQuickLink = (item) => `
        <a href="${escapeHtml(safeUrl(item.href))}" class="quicknav-link ${quickActive(item) ? 'active' : ''}">
          <span>${escapeHtml(item.icon)}</span><span>${escapeHtml(item.title)}</span>
        </a>`;
      const renderQuickGroup = (label, items) => `
        <div class="quicknav-group">
          <h5>${escapeHtml(label)}</h5>
          ${items.map(renderQuickLink).join('')}
        </div>`;

      // Selecting a destination closes the unified window.
      const bindQuickClicks = () => {
        host.querySelectorAll('.quicknav-link').forEach(a => {
          if (a.dataset.bound) return;
          a.dataset.bound = '1';
          a.addEventListener('click', () => document.getElementById('unified-panel')?.classList.remove('open'));
        });
      };

      // Fill the Navigation tab pane of the unified assistant window.
      const staticHtml =
        renderQuickGroup('Portals', Object.values(portalCatalog)) +
        renderQuickGroup('Resources', allResources) +
        renderQuickGroup('General', generalItems);
      host.innerHTML = staticHtml;
      host.dataset.filled = '1';
      bindQuickClicks();

      // Admin-authored Quick-Nav bookmarks (page + section) → prepend a Bookmarks group.
      fetch('/api/menus').then(r => r.json()).then(menus => {
        const bms = (menus && menus.bookmarks) || [];
        if (!bms.length) return;
        const items = bms.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map(b => ({
          href: (b.page || '') + (b.section ? '#' + b.section : ''),
          icon: b.icon || '\u{1F516}',
          title: b.label || b.page || 'Bookmark',
          match: '__bookmark__'
        }));
        host.innerHTML = renderQuickGroup('Bookmarks', items) + staticHtml;
        bindQuickClicks();
      }).catch(() => {});
    };

    // Menu store overrides: apply admin-authored labels, icons, order, visibility & custom links
    function applyMenuOverrides() {
      const sb = document.getElementById('demo-sidebar');
      if (!sb) return;
      const lang = localStorage.getItem('employeeLanguage') || 'en';
      const lbl = (v) => (v && typeof v === 'object') ? (v[lang] || v.en || Object.values(v).find(Boolean) || '') : (v || '');
      const tokenOf = (href, el) => {
        if (el && el.id === 'sidebar-survey-link') return 'survey';
        if (!href) return '';
        if (href.indexOf('survey') > -1) return 'survey';
        if (href === '/' || href === '') return '/';
        if (href.indexOf('javascript:') === 0) return '';
        const a = document.createElement('a'); a.href = href;
        return a.pathname + (a.hash || '');
      };
      const groupContainer = (g) => sb.querySelector(`.sidebar-group[data-group="${g}"] .sidebar-group-items`);
      fetch('/api/menus').then(r => r.json()).then(menus => {
        const items = (menus && menus.sidebar) || [];
        if (!items.length) return;
        const built = {};
        sb.querySelectorAll('a.sidebar-link').forEach(a => {
          // The pinned Admin Console link is a fixed sidebar affordance, not a
          // role-scoped menu item — exclude it so menu overrides never remove it.
          if (a.classList.contains('sidebar-admin-link')) return;
          const t = tokenOf(a.getAttribute('href'), a);
          if (t && !(t in built)) built[t] = a;
        });
        items.slice().sort((x, y) => (x.order || 0) - (y.order || 0)).forEach(it => {
          const t = tokenOf(it.href);
          const scopeOk = !it.roleScope || it.roleScope === 'all' || it.roleScope.split(',').map(s => s.trim()).indexOf(activeRole) > -1;
          const hidden = it.visible === false || !scopeOk;
          const a = built[t];
          if (a) {
            if (hidden) { a.remove(); return; }
            const labelEl = a.querySelector('.sidebar-link-label');
            const iconEl = a.querySelector('.sidebar-link-icon');
            const text = lbl(it.label);
            if (labelEl && text) labelEl.textContent = text;
            if (iconEl && it.icon) iconEl.textContent = it.icon;
            if (text) a.title = text;
            if (it.group === 'portals' || it.group === 'resources') {
              const gc = groupContainer(it.group);
              if (gc && a.parentElement === gc) gc.appendChild(a);
            }
          } else if (it.custom && !hidden && it.href && t && t !== 'survey') {
            const link = document.createElement('a');
            link.href = it.href;
            link.className = 'sidebar-link sidebar-sub-link';
            const text = lbl(it.label) || it.href;
            link.title = text;
            const ic = document.createElement('span'); ic.className = 'sidebar-link-icon'; ic.textContent = it.icon || '\u{1F517}';
            const lb = document.createElement('span'); lb.className = 'sidebar-link-label'; lb.textContent = text;
            link.appendChild(ic); link.appendChild(lb);
            const gc = groupContainer(it.group);
            if (gc) { gc.appendChild(link); }
            else {
              const nav = sb.querySelector('.sidebar-nav');
              const firstGroup = nav && nav.querySelector('.sidebar-group');
              if (nav) { if (firstGroup) nav.insertBefore(link, firstGroup); else nav.appendChild(link); }
            }
          }
        });
        // Re-evaluate empty groups (hide emptied, reveal groups that gained a custom link)
        sb.querySelectorAll('.sidebar-group').forEach(group => {
          group.style.display = group.querySelector('.sidebar-group-items a') ? '' : 'none';
        });
      }).catch(() => {});
    }

    // Inject a "Slides" sidebar group of admin-authored HTML-slide launchers scoped to
    // this page. Clicking a launcher opens that slide as a full-screen overlay.
    function renderSlideLaunchers() {
      const sb = document.getElementById('demo-sidebar');
      if (!sb) return;
      const nav = sb.querySelector('.sidebar-nav');
      if (!nav || nav.querySelector('.sidebar-group[data-group="slides"]')) return;
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      // Build the "Slides" group up-front so the two fixed leadership Asks always
      // appear even before (or if) the admin-authored slides load.
      const group = document.createElement('div');
      group.className = 'sidebar-group open';
      group.setAttribute('data-group', 'slides');
      group.innerHTML =
        '<button type="button" class="sidebar-group-btn" title="Slides">' +
          '<span class="sidebar-link-icon">\u{1F5A5}️</span>' +
          '<span class="sidebar-link-label">Slides</span>' +
          '<svg class="sidebar-group-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>' +
        '</button>' +
        '<div class="sidebar-group-items"></div>';
      const items = group.querySelector('.sidebar-group-items');
      const addSlide = (icon, label, title, url) => {
        const a = document.createElement('a');
        a.href = 'javascript:void(0)';
        a.className = 'sidebar-link';
        a.title = title || label;
        a.innerHTML = '<span class="sidebar-link-icon">' + esc(icon || '\u{1F5A5}️') + '</span><span class="sidebar-link-label">' + esc(label || 'Slide') + '</span>';
        a.addEventListener('click', () => window.openHtmlSlide(url, title || label));
        items.appendChild(a);
      };
      // Fixed app slides — the two leadership "Our Ask" decks, shown full-screen.
      addSlide('\u{1F64B}', 'Ask 1', 'Ask 1 — SR HRLT & CHRO Approval', '/overview-deck/slide5.html');
      addSlide('\u{1F64B}', 'Ask 2', 'Ask 2 — Prove It on the Next Integration', '/overview-deck/slide6.html');
      group.querySelector('.sidebar-group-btn').addEventListener('click', () => group.classList.toggle('open'));
      nav.appendChild(group);
      // Append any admin-authored HTML slides scoped to this page, after the Asks.
      fetch('/api/slides').then(r => r.json()).then(slides => {
        const here = window.location.pathname;
        (slides || []).filter(s => {
          const pg = (s.pages || 'all').trim();
          if (!pg || pg === 'all' || pg === '*') return true;
          return pg.split(',').map(x => x.trim()).filter(Boolean).some(p => p === here || here.endsWith(p));
        }).forEach(s => addSlide(s.icon, s.label || 'Slide', s.label || 'Slide', s.url));
      }).catch(() => {});
    }

    // Demo Role Visibility: hide portal links & switcher roles disabled from the Admin console
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        // Fill the unified assistant's Navigation tab; the admin "Floating Quick-Nav"
        // toggle now controls whether the Navigation TAB is offered (chat stays available).
        buildQuickNav();
        if (settings.floatingMenuEnabled === false) {
          const navTab = document.querySelector('.unified-tab[data-tab="nav"]');
          if (navTab) navTab.style.display = 'none';
          document.querySelector('.unified-tab[data-tab="chat"]')?.click();
        }
        const rv = settings.roleVisibility || {};
        const rolePages = { pmo: 'pmo.html', hrbp: 'dashboard.html', supporting: 'supporting.html', employee: 'employee.html', admin: 'admin.html', leaders: 'leaders.html' };
        Object.keys(rolePages).forEach(roleKey => {
          if (rv[roleKey] === false) {
            document.querySelectorAll(`#demo-sidebar a.sidebar-sub-link[href*="${rolePages[roleKey]}"]`).forEach(a => a.remove());
            const opt = document.querySelector(`#role-switcher-select option[value="${roleKey}"]`);
            if (opt && !opt.selected) opt.remove();
          }
        });
        // Hide any sidebar group that lost all of its links
        document.querySelectorAll('#demo-sidebar .sidebar-group').forEach(group => {
          if (!group.querySelector('.sidebar-group-items a')) group.style.display = 'none';
        });
        // Layer admin-authored menu overrides on top of the role-filtered sidebar
        applyMenuOverrides();
        // Inject admin-authored HTML-slide launchers for this page
        renderSlideLaunchers();
        // Guarantee the Admin Console link sits at the bottom of the sidebar (it is a
        // top-level pinned link, not a role-scoped sub-link, so it always shows).
        if (!document.querySelector('#demo-sidebar .sidebar-admin-link')) {
          const sbEl = document.getElementById('demo-sidebar');
          const footEl = sbEl && sbEl.querySelector('.sidebar-footer');
          if (sbEl && footEl) {
            const al = document.createElement('a');
            al.href = '/admin.html';
            al.className = 'sidebar-link sidebar-admin-link' + (window.location.pathname.includes('admin.html') ? ' active' : '');
            al.title = 'Admin Console';
            al.innerHTML = '<span class="sidebar-link-icon">⚙️</span><span class="sidebar-link-label">Admin Console</span>';
            sbEl.insertBefore(al, footEl);
          }
        }
        // If the persisted demo role is hidden (and no page URL pins a role), fall back to the first visible role.
        // A server-verified login role is exempt: the auth handshake rewrites active_demo_role on every
        // load, so falling back here would reload forever. The sessionStorage latch caps the fallback at
        // one reload per tab as a backstop for the race where this resolves before /api/auth/me does.
        const isRolePage = /(admin|pmo|dashboard|supporting|employee)\.html/.test(window.location.pathname);
        const persistedRole = localStorage.getItem('active_demo_role') || 'admin';
        const serverRole = window.__portalUser && window.__portalUser.role;
        if (!isRolePage && rv[persistedRole] === false && serverRole !== persistedRole) {
          const fallback = ['hrbp', 'employee', 'pmo', 'supporting', 'admin'].find(r => rv[r] !== false);
          if (fallback && fallback !== persistedRole && !sessionStorage.getItem('role_visibility_fallback_done')) {
            sessionStorage.setItem('role_visibility_fallback_done', '1');
            localStorage.setItem('active_demo_role', fallback);
            window.location.reload();
          }
        }
      })
      .catch(err => console.error('Error applying role visibility:', err));


    // Profile Trigger Logic
    const trigger = profileContainer.querySelector('#profile-menu-trigger');
    const dropdown = profileContainer.querySelector('#profile-dropdown-card');

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      profileContainer.classList.toggle('open');
      dropdown.classList.toggle('show');
      timeMachineContainer.classList.remove('open');
      timeDropdown.classList.remove('show');
    });

    // Time Travel Trigger Logic
    const timeTrigger = timeMachineContainer.querySelector('#time-machine-trigger');
    const timeDropdown = timeMachineContainer.querySelector('#time-travel-dropdown');

    timeTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      timeMachineContainer.classList.toggle('open');
      timeDropdown.classList.toggle('show');
      profileContainer.classList.remove('open');
      dropdown.classList.remove('show');
    });

    document.addEventListener('click', (e) => {
      if (!profileContainer.contains(e.target)) {
        profileContainer.classList.remove('open');
        dropdown.classList.remove('show');
      }
      if (!timeMachineContainer.contains(e.target)) {
        timeMachineContainer.classList.remove('open');
        timeDropdown.classList.remove('show');
      }
    });

    // Handle Time Travel button clicks
    const dayButtons = timeMachineContainer.querySelectorAll('.time-item-btn');
    dayButtons.forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!window.maCan('timeTravel')) return; // IN-C01: demo-only POST, refused here
        const day = parseInt(btn.getAttribute('data-day'));
        timeMachineContainer.classList.remove('open');
        timeDropdown.classList.remove('show');
        triggerWormhole(day);
      });
    });

    // Fetch and highlight active day
    fetch('/api/settings')
      .then(res => res.json())
      .then(settings => {
        const activeDay = settings.timeTravelDay || 30;
        const textLabel = activeDay >= 100 ? "Day 100+" : `Day ${activeDay}`;
        const badgeText = document.getElementById('active-day-badge-text');
        if (badgeText) badgeText.textContent = textLabel;
        
        // Highlight active button in dropdown
        const activeBtn = timeMachineContainer.querySelector(`.time-item-btn[data-day="${activeDay >= 100 ? 100 : activeDay}"]`);
        if (activeBtn) activeBtn.classList.add('active');
      })
      .catch(err => console.error("Error loading active day:", err));

    function triggerWormhole(targetDay) {
      const overlay = document.createElement('div');
      overlay.className = 'time-travel-overlay';
      
      const targetLabel = targetDay >= 100 ? "DAY 100+" : `DAY ${targetDay}`;
      
      overlay.innerHTML = `
        <div class="delorean-scene">
          <div class="starry-sky"></div>
          <div class="lightning-flash"></div>
          <div class="neon-grid-highway"></div>
          
          <div class="delorean-container">
            <div class="fire-tracks">
              <div class="track track-left"></div>
              <div class="track track-right"></div>
            </div>
            
            <div class="delorean-car">
              <div class="car-body">
                <div class="flux-vents">
                  <div class="vent vent-l"></div>
                  <div class="vent vent-r"></div>
                </div>
                <div class="car-top"></div>
                <div class="rear-windshield"></div>
                <div class="rear-grille">
                  <div class="tail-light light-l"></div>
                  <div class="license-plate">OUTATIME</div>
                  <div class="tail-light light-r"></div>
                </div>
                <div class="bumper"></div>
              </div>
              <div class="car-wheels">
                <div class="wheel wheel-l"></div>
                <div class="wheel wheel-r"></div>
              </div>
              <div class="plasma-sparks">
                <div class="spark spark-1"></div>
                <div class="spark spark-2"></div>
                <div class="spark spark-3"></div>
                <div class="spark spark-4"></div>
              </div>
            </div>
          </div>

          <div class="time-hud">
            <div class="hud-panel temporal-destination">
              <div class="hud-label">DESTINATION TIME</div>
              <div class="hud-readout" id="hud-destination">${targetLabel}</div>
            </div>
            
            <div class="hud-panel speed-gauge">
              <div class="hud-label">SPEED</div>
              <div class="hud-readout speedometer"><span id="speed-digits">00</span><span class="hud-unit">MPH</span></div>
            </div>
          </div>
          <div class="blinding-flash-screen"></div>
        </div>
      `;
      document.body.appendChild(overlay);
      overlay.style.pointerEvents = 'auto';
      
      // Animate entry
      setTimeout(() => {
        overlay.classList.add('active');
      }, 50);
      
      const speedDigits = overlay.querySelector('#speed-digits');
      const lightning = overlay.querySelector('.lightning-flash');
      const car = overlay.querySelector('.delorean-car');
      const tracks = overlay.querySelectorAll('.track');
      const flash = overlay.querySelector('.blinding-flash-screen');
      
      let speed = 0;
      let accelerationInterval = setInterval(() => {
        // Accelerate car
        if (speed < 40) {
          speed += Math.floor(Math.random() * 4) + 1;
        } else if (speed < 75) {
          speed += Math.floor(Math.random() * 6) + 2;
        } else {
          speed += Math.floor(Math.random() * 8) + 3;
        }
        
        if (speed >= 88) {
          speed = 88;
          clearInterval(accelerationInterval);
          triggerWarp();
        }
        
        // Render current digits padded
        speedDigits.textContent = String(Math.floor(speed)).padStart(2, '0');
        
        // Random lightning strike strikes
        if (Math.random() < 0.15 && speed < 85) {
          lightning.classList.add('strike');
          setTimeout(() => {
            lightning.classList.remove('strike');
          }, 400);
        }
      }, 75);
      
      function triggerWarp() {
        // Activate lightning strikes rapidly
        lightning.classList.add('strike');
        
        // Render glowing flame tracks
        tracks.forEach(track => track.classList.add('active'));
        
        // Drive away at warp speed
        setTimeout(() => {
          car.classList.add('warp-speed');
        }, 150);
        
        // Bright blinding screen flash
        setTimeout(() => {
          flash.classList.add('flash');
        }, 600);
        
        // Post Day update and reload page
        fetch('/api/settings/time-travel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ day: targetDay })
        })
        .then(res => res.json())
        .then(data => {
          setTimeout(() => {
            overlay.classList.remove('active');
            setTimeout(() => {
              overlay.remove();
              window.location.reload();
            }, 300);
          }, 1100);
        })
        .catch(err => {
          console.error("Time travel synchronization failed:", err);
          overlay.remove();
        });
      }
    }

    // Populate active Integration Leader details dynamically
    function loadActiveHRBP() {
      let targetCompany = "NextGen Sensors Ltd.";
      let targetSector = "Sensors & Controls";
      
      fetch('/api/settings')
        .then(res => res.json())
        .then(settings => {
          if (settings.targetCompany) targetCompany = settings.targetCompany;
          if (settings.sector) targetSector = settings.sector;
          
          const targetEl = document.getElementById('dropdown-profile-target');
          if (targetEl) targetEl.textContent = targetCompany;
          
          const sectorEl = document.getElementById('dropdown-profile-sector');
          if (sectorEl) sectorEl.textContent = targetSector;
        })
        .catch(err => console.error("Error fetching settings in profile:", err));

      // [security] D-11-01/D-11-06 (plan 11-07): the Integration Leader directory
      // is readable by admin + hrbp only in a real deal — a role refused it is not
      // sent the request at all (it would only 403, and this lookup acts solely
      // for the hrbp profile anyway).
      window.maCanReady('hrbps').then(ok => ok ? fetch('/api/hrbps') : null)
        .then(res => (res ? res.json() : null))
        .then(hrbps => {
          if (!hrbps) return;
          const activeRole = localStorage.getItem('active_demo_role') || 'admin';
          if (activeRole !== 'hrbp') return;
          if (!hrbps || hrbps.length === 0) return;

          let activeIndex = parseInt(localStorage.getItem('activeHRBPIndex') || '0');
          if (activeIndex >= hrbps.length) {
            activeIndex = 0;
            localStorage.setItem('activeHRBPIndex', '0');
          }

          const hrbp = hrbps[activeIndex];
          const initials = hbpInitials(hrbp.name);

          // Update header
          const headAvatar = document.getElementById('header-profile-avatar');
          if (headAvatar) headAvatar.textContent = initials;
          const headName = document.getElementById('header-profile-name');
          if (headName) headName.textContent = hrbp.name.split(' ')[0];
          
          // Update dropdown
          const dropAvatar = document.getElementById('dropdown-profile-avatar');
          if (dropAvatar) dropAvatar.textContent = initials;
          const dropName = document.getElementById('dropdown-profile-name');
          if (dropName) dropName.textContent = hrbp.name;
          const dropEmail = document.getElementById('dropdown-profile-email');
          if (dropEmail) dropEmail.textContent = hrbp.email;
          
          const dropTracks = document.getElementById('dropdown-profile-tracks');
          if (dropTracks) {
            dropTracks.textContent = hrbp.assignedTracks.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' & ');
          }

          const switchBtn = document.getElementById('switch-user-btn');
          if (switchBtn) {
            switchBtn.onclick = (e) => {
              e.stopPropagation();
              const nextIndex = (activeIndex + 1) % hrbps.length;
              localStorage.setItem('activeHRBPIndex', nextIndex.toString());
              
              const banner = document.createElement('div');
              banner.className = 'announcement-banner';
              banner.style.cssText = 'position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%) translateY(-20px); opacity: 0; background: var(--te-dark-teal); color: var(--text-light); border-left: 4px solid var(--te-orange); padding: 0.75rem 1.5rem; border-radius: var(--radius-md); box-shadow: var(--shadow-lg); font-weight: 600; font-size: 0.9rem; z-index: 100000; transition: all 0.3s ease;';
              banner.textContent = `Switched operational Integration Leader profile to ${hrbps[nextIndex].name}`;
              document.body.appendChild(banner);
              
              requestAnimationFrame(() => {
                banner.style.opacity = '1';
                banner.style.transform = 'translateX(-50%) translateY(0)';
              });

              setTimeout(() => {
                banner.style.opacity = '0';
                banner.style.transform = 'translateX(-50%) translateY(-20px)';
                setTimeout(() => {
                  banner.remove();
                  window.location.reload();
                }, 300);
              }, 1800);
            };
          }
        })
        .catch(err => console.error("Error loading Integration Leaders in profile:", err));
    }

    function hbpInitials(name) {
      if (!name) return "HR";
      const parts = name.split(' ');
      if (parts.length >= 2) {
        return parts[0][0] + parts[1][0];
      }
      return name.slice(0, 2).toUpperCase();
    }

    loadActiveHRBP();

    // --- AI Insight LLM Download Modal ---
    function checkAndShowAiInsightModal() {
      // Only show on main index page or dashboard page to avoid spamming subpages
      const path = window.location.pathname;
      const isMainPage = path.includes('index.html') || path.includes('dashboard.html') || path === '/' || path === '';
      if (!isMainPage) return;

      // If already downloaded in this browser session/state, skip
      if (localStorage.getItem('ai-insight_downloaded') === 'true') {
        return;
      }

      // Check if dismissed recently (session-based skip to avoid annoyance)
      if (sessionStorage.getItem('ai-insight_modal_dismissed') === 'true') {
        return;
      }

      // [security] D-11-02 (plan 11-07): activating the browser model POSTs
      // `{browserModel}` to /api/settings, which is admin-only. A role that cannot
      // write configuration is never prompted for a setup it could only fail.
      window.maCanReady('configWrite').then(ok => (ok ? fetch('/api/settings') : null))
        .then(res => (res ? res.json() : null))
        .then(settings => {
          if (!settings) return;
          // If a model is already configured, we consider it active/downloaded
          if (settings.browserModel && settings.browserModel !== 'none') {
            localStorage.setItem('ai-insight_downloaded', 'true');
            return;
          }

          // Show the gorgeous prompt modal
          setTimeout(injectAiInsightModal, 800); // slight delay for loading aesthetic entry
        })
        .catch(err => console.error("Error checking AI Insight settings:", err));
    }

    function injectAiInsightModal() {
      // Avoid duplicate modals
      if (document.getElementById('ai-insight-modal')) return;

      const overlay = document.createElement('div');
      overlay.className = 'ai-insight-modal-overlay';
      overlay.id = 'ai-insight-modal';
      
      overlay.innerHTML = `
        <div class="ai-insight-modal-card">
          <div class="ai-insight-modal-header">
            <span class="ai-insight-modal-icon">🧠</span>
            <h3 class="ai-insight-modal-title">Activate AI Insight AI Brain</h3>
          </div>
          <p class="ai-insight-modal-desc">
            To unlock post-merger integration coaching, activate the client-side <strong>AI Insight LLM</strong>. This allows <strong>TEodor the Duck Coach</strong> to analyze playbook data and converse with you directly inside your browser.
          </p>
          
          <div class="ai-insight-model-options" id="modal-options-container">
            <div class="ai-insight-model-option active" data-model="simulated-duck">
              <input type="radio" name="modal-model-select" class="ai-insight-option-radio" checked>
              <div class="ai-insight-option-info">
                <h4>TEodor Neural Duck Engine (Local Heuristic Simulation)</h4>
                <p>Fast heuristics-driven AI. Instantly available without heavy network downloads.</p>
              </div>
            </div>
            
            <div class="ai-insight-model-option" data-model="lamini-78m">
              <input type="radio" name="modal-model-select" class="ai-insight-option-radio">
              <div class="ai-insight-option-info">
                <h4>Xenova/LaMini-Flan-T5-78M (Lightweight LLM)</h4>
                <p>Runs fully client-side. Size: ~250 MB. Fast browser-native execution.</p>
              </div>
            </div>

            <div class="ai-insight-model-option" data-model="qwen-0.5b">
              <input type="radio" name="modal-model-select" class="ai-insight-option-radio">
              <div class="ai-insight-option-info">
                <h4>Xenova/Qwen1.5-0.5B-Chat (High Quality LLM)</h4>
                <p>Advanced client-side model. Size: ~940 MB. Higher reasoning precision.</p>
              </div>
            </div>
          </div>

          <!-- Progress Panel -->
          <div class="ai-insight-download-progress-container" id="modal-progress-container">
            <div class="ai-insight-progress-header">
              <span id="modal-progress-label" style="color: var(--te-dark-teal); font-weight:700;">Initiating Download...</span>
              <span id="modal-progress-pct" style="color: var(--te-orange); font-weight:800;">0%</span>
            </div>
            <div class="ai-insight-progress-bar-bg">
              <div class="ai-insight-progress-bar-fill" id="modal-progress-fill"></div>
            </div>
            <span class="ai-insight-progress-status" id="modal-progress-status">Preparing models...</span>
          </div>

          <div class="ai-insight-modal-actions" id="modal-actions-container">
            <button class="btn btn-secondary" id="btn-modal-cancel" type="button">Dismiss</button>
            <button class="btn btn-primary" id="btn-modal-download" type="button" style="background: var(--te-orange); border-color: var(--te-orange);">Activate AI Insight</button>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      // Event Listeners for options
      const options = overlay.querySelectorAll('.ai-insight-model-option');
      let selectedModel = 'simulated-duck';

      options.forEach(opt => {
        opt.addEventListener('click', () => {
          options.forEach(o => o.classList.remove('active'));
          options.forEach(o => o.querySelector('.ai-insight-option-radio').checked = false);
          opt.classList.add('active');
          opt.querySelector('.ai-insight-option-radio').checked = true;
          selectedModel = opt.getAttribute('data-model');
        });
      });

      // Cancel button
      overlay.querySelector('#btn-modal-cancel').addEventListener('click', () => {
        sessionStorage.setItem('ai-insight_modal_dismissed', 'true');
        fadeOutModal(overlay);
      });

      // Download/Start button
      overlay.querySelector('#btn-modal-download').addEventListener('click', () => {
        // Hide options & actions
        overlay.querySelector('#modal-options-container').style.display = 'none';
        overlay.querySelector('#modal-actions-container').style.display = 'none';
        
        // Show progress panel
        const progressContainer = overlay.querySelector('#modal-progress-container');
        progressContainer.style.display = 'block';

        const progressFill = overlay.querySelector('#modal-progress-fill');
        const progressPct = overlay.querySelector('#modal-progress-pct');
        const progressLabel = overlay.querySelector('#modal-progress-label');
        const progressStatus = overlay.querySelector('#modal-progress-status');

        if (selectedModel === 'simulated-duck') {
          // Simulated Fast Download
          let pct = 0;
          const phrases = [
            "Contacting TE Connectivity CDN node...",
            "Downloading TEodor neural heuristics matrices...",
            "Compiling prompt reasoning pipelines...",
            "Warm booting TEodor interactive coaching core...",
            "Active and ready to quack!"
          ];

          const interval = setInterval(() => {
            pct += Math.floor(Math.random() * 12) + 8;
            if (pct >= 100) {
              pct = 100;
              clearInterval(interval);

              progressFill.style.width = '100%';
              progressPct.textContent = '100%';
              progressLabel.textContent = 'Activation Complete!';
              progressStatus.textContent = phrases[4];

              // Save to backend and local storage
              saveSettingsAndComplete(selectedModel, overlay);
            } else {
              progressFill.style.width = `${pct}%`;
              progressPct.textContent = `${pct}%`;
              const phraseIndex = Math.min(Math.floor(pct / 25), 3);
              progressLabel.textContent = `Downloading ${selectedModel}...`;
              progressStatus.textContent = phrases[phraseIndex];
            }
          }, 250);
        } else {
          // Real Transformers.js Download
          runRealTransformersDownload(selectedModel, overlay, progressFill, progressPct, progressLabel, progressStatus);
        }
      });
    }

    function runRealTransformersDownload(model, overlay, fill, pctEl, labelEl, statusEl) {
      const modelName = model === 'lamini-78m' ? 'Xenova/LaMini-Flan-T5-78M' : 'Xenova/Qwen1.5-0.5B-Chat';
      labelEl.textContent = "Importing client-side Deep Learning library...";
      statusEl.textContent = "Connecting to Hugging Face Hub...";

      import('/vendor/transformers/transformers.min.js')
        .then(async (transformers) => {
          transformers.env.allowLocalModels = false;
          transformers.env.backends.onnx.wasm.wasmPaths = '/vendor/transformers/';
          labelEl.textContent = `Downloading AI Brain weights (${model})...`;
          
          try {
            await transformers.pipeline('text2text-generation', modelName, {
              progress_callback: (data) => {
                if (data.status === 'progress') {
                  const pct = Math.floor(data.progress || 0);
                  fill.style.width = `${pct}%`;
                  pctEl.textContent = `${pct}%`;
                  statusEl.textContent = `File: ${data.file || 'model weights'} (${pct}%)`;
                } else if (data.status === 'ready') {
                  labelEl.textContent = "Compiling neural graph parameters...";
                  statusEl.textContent = "Verifying integrity & booting coach...";
                }
              }
            });

            fill.style.width = '100%';
            pctEl.textContent = '100%';
            labelEl.textContent = "Activation Complete!";
            statusEl.textContent = "AI Insight local LLM initialized successfully.";
            
            saveSettingsAndComplete(model, overlay);
          } catch (err) {
            console.error("Transformers.js download error inside modal, falling back:", err);
            statusEl.textContent = "⚠️ Network timeout. Falling back to Neural Simulation...";
            setTimeout(() => {
              saveSettingsAndComplete('simulated-duck', overlay);
            }, 1500);
          }
        })
        .catch(err => {
          console.error("Dynamic import error, fallback to simulated:", err);
          statusEl.textContent = "⚠️ Dynamic library load failed. Falling back to Neural Simulation...";
          setTimeout(() => {
            saveSettingsAndComplete('simulated-duck', overlay);
          }, 1500);
        });
    }

    function saveSettingsAndComplete(model, overlay) {
      // [security] D-11-02 (plan 11-07): belt and braces — the modal is not shown
      // to a role without configWrite, and the POST below is never sent for one.
      if (!window.maCan('configWrite')) {
        localStorage.setItem('ai-insight_downloaded', 'true');
        fadeOutModal(overlay);
        return;
      }
      // POST to backend settings
      fetch('/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ browserModel: model })
      })
      .then(res => res.json())
      .then(data => {
        localStorage.setItem('ai-insight_downloaded', 'true');
        
        // Show success alert inside card
        const card = overlay.querySelector('.ai-insight-modal-card');
        const headerIcon = overlay.querySelector('.ai-insight-modal-icon');
        if (headerIcon) headerIcon.textContent = '🎉';
        
        // Confetti!
        triggerConfettiBlast();

        setTimeout(() => {
          fadeOutModal(overlay);
          // Reload if on dashboard page to activate duck chatbot immediately
          if (window.location.pathname.includes('dashboard.html')) {
            window.location.reload();
          }
        }, 1500);
      })
      .catch(err => {
        console.error("Failed to save model settings to server:", err);
        localStorage.setItem('ai-insight_downloaded', 'true');
        setTimeout(() => fadeOutModal(overlay), 1000);
      });
    }

    function fadeOutModal(overlay) {
      overlay.style.transition = 'opacity 0.3s ease';
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }

    function triggerConfettiBlast() {
      for (let i = 0; i < 40; i++) {
        const conf = document.createElement('div');
        conf.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          width: ${Math.random() * 8 + 6}px;
          height: ${Math.random() * 12 + 6}px;
          background-color: ${['#E98300', '#244C5A', '#FFA834', '#1A3843', '#00C853'][Math.floor(Math.random() * 5)]};
          transform: translate(-50%, -50%) rotate(${Math.random() * 360}deg);
          z-index: 3000;
          pointer-events: none;
          border-radius: 2px;
          transition: all 1.2s cubic-bezier(0.1, 0.8, 0.1, 1);
        `;
        document.body.appendChild(conf);

        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 250 + 100;
        const tx = Math.cos(angle) * speed;
        const ty = Math.sin(angle) * speed + 100;

        requestAnimationFrame(() => {
          conf.style.transform = `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) rotate(${Math.random() * 720}deg)`;
          conf.style.opacity = '0';
        });

        setTimeout(() => conf.remove(), 1200);
      }
    }

    checkAndShowAiInsightModal();

    // Initialize the global floating TEodor AI Chatbot on all pages
    initGlobalTeodorChatbot();

    // --- Global Floating TEodor AI Chatbot Integration ---
    function initGlobalTeodorChatbot() {
      if (document.getElementById('teodor-global-widget')) return;

      const widgetContainer = document.createElement('div');
      widgetContainer.id = 'teodor-global-widget';
      widgetContainer.className = 'global-teodor-widget';
      
      widgetContainer.innerHTML = `
        <div class="unified-panel" id="unified-panel">
          <div class="unified-tabbar">
            <div class="unified-tabs">
              <button type="button" class="unified-tab active" data-tab="nav"><span>🧭</span><span>Navigation</span></button>
              <button type="button" class="unified-tab" data-tab="chat"><span class="unified-tab-duck">${getTeodorDuckSvg('20px')}</span><span>Ask TEodor</span></button>
            </div>
            <button type="button" class="unified-close" id="unified-close" title="Close">&times;</button>
          </div>

          <!-- Tab pane: Quick Navigation -->
          <div class="unified-pane unified-pane-nav" id="unified-nav-pane" data-pane="nav">
            <div class="quicknav-groups" id="unified-nav-groups"></div>
          </div>

          <!-- Tab pane: TEodor AI chat (same element IDs the chat logic binds to) -->
          <div class="unified-pane unified-pane-chat" id="unified-chat-pane" data-pane="chat" style="display:none;">
            <div class="teodor-chat-subhead">
              <div class="teodor-chat-avatar">${getTeodorDuckSvg('24px')}</div>
              <div>
                <h4>TEodor Duck Coach</h4>
                <span class="teodor-chat-status"><span class="teodor-status-dot"></span> Active AI Insight</span>
              </div>
              <button type="button" class="teodor-chat-clear-btn" id="teodor-global-clear" title="Clear Chat History">🧹 Clear</button>
            </div>
            <div class="teodor-chat-body" id="teodor-global-history"></div>
            <div class="teodor-global-reasoning-logs" id="teodor-global-logs-container" style="display: none;">
              <div class="teodor-logs-header">
                <span>⚙️ SMOLAGENT REASONING LOGS:</span>
                <span class="pulse-text">● RUNNING TOOL</span>
              </div>
              <div class="teodor-logs-content" id="teodor-global-logs-content"></div>
            </div>
            <div class="teodor-global-suggestions" id="teodor-global-suggestions-container"></div>
            <form class="teodor-chat-input-form" id="teodor-global-form">
              <input type="text" id="teodor-global-input" placeholder="Ask TEodor anything..." required autocomplete="off">
              <button type="submit">Send</button>
            </form>
          </div>
        </div>
        <button type="button" class="unified-fab" id="unified-fab" title="Navigate & Ask TEodor">
          <span class="active-pulse-dot"></span>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"></rect><rect x="14" y="3" width="7" height="7" rx="1.5"></rect><rect x="3" y="14" width="7" height="7" rx="1.5"></rect><rect x="14" y="14" width="7" height="7" rx="1.5"></rect></svg>
        </button>
      `;

      document.body.appendChild(widgetContainer);

      const fab = document.getElementById('unified-fab');
      const unifiedPanel = document.getElementById('unified-panel');
      const closeBtn = document.getElementById('unified-close');
      const tabButtons = widgetContainer.querySelectorAll('.unified-tab');
      const paneEls = { nav: document.getElementById('unified-nav-pane'), chat: document.getElementById('unified-chat-pane') };
      const chatHistory = document.getElementById('teodor-global-history');
      const logsContainer = document.getElementById('teodor-global-logs-container');
      const logsContent = document.getElementById('teodor-global-logs-content');
      const suggestionsContainer = document.getElementById('teodor-global-suggestions-container');
      const chatForm = document.getElementById('teodor-global-form');
      const chatInput = document.getElementById('teodor-global-input');

      // Page-Aware Context Logic
      const pagePath = window.location.pathname;
      let greetingText = "Quack! I am **TEodor**, your yellow rubber duck PMI coach! How can I assist you with the integration today?";
      let currentSuggestions = [];

      if (pagePath.includes('employee.html')) {
        greetingText = "Quack! Welcome to the Academy! Let's get you set up with your lessons, points, and milestones. Ask me about training courses, welcome kit merch, or how to submit your first checklist!";
        currentSuggestions = [
          { label: "💬 How do I earn XP?", query: "How do I earn XP and badges in the onboarding academy?" },
          { label: "💬 Welcome kit merch?", query: "Where do I pick up the welcome kit and what is inside?" },
          { label: "💬 Core modules?", query: "What are the core modules in the onboarding training?" }
        ];
      } else if (pagePath.includes('dashboard.html')) {
        greetingText = "Quack! Welcome to the Integration Leader cockpit. I can analyze employee sentiment, calculate integration alignment scores, or fetch official retention guidelines.";
        currentSuggestions = [
          { label: "💬 Handle process anxiety", query: "How do we handle middle management anxiety about process changes?" },
          { label: "💬 Retain R&D engineers", query: "What should we do if key R&D engineers are reluctant to transition?" },
          { label: "💬 Show roadmap goals", query: "Show me the integration roadmap timeline goals" }
        ];
      } else if (pagePath.includes('admin.html')) {
        greetingText = "Quack! Admin Console online. I can assist with configuring the AI model, uploading RAG guidelines, sending alerts, or viewing settings.";
        currentSuggestions = [
          { label: "💬 Switch AI Insight model", query: "How to configure or switch the AI Insight AI model?" },
          { label: "💬 Add RAG guidelines", query: "How do I upload and search post-merger integration RAG documents?" },
          { label: "💬 Broadcast active alerts", query: "How do I broadcast active alerts to employee timelines?" }
        ];
      } else if (pagePath.includes('playbook.html')) {
        greetingText = "Quack! This is the PMI master playbook. I can extract policies, summarize Chapters (Culture, Talent, Value Synergies), or find legal guidelines.";
        currentSuggestions = [
          { label: "💬 Culture Integration", query: "Explain the Culture Integration chapter of the playbook" },
          { label: "💬 Talent & Benefits", query: "Explain the Talent & Benefits guidelines" },
          { label: "💬 Commercial Synergies", query: "Summarize the Commercial Synergy steps" }
        ];
      } else {
        // index.html / survey
        greetingText = "Quack! Welcome to the integration survey. Your feedback directly shapes our roadmap. I can explain the different parts of the survey or how your response helps!";
        currentSuggestions = [
          { label: "💬 Feedback anonymity", query: "Why is my feedback anonymous?" },
          { label: "💬 How is data used?", query: "How is this pulse survey data used by the IMO?" },
          { label: "💬 Need immediate support", query: "What if I have issues or need immediate HR support?" }
        ];
      }

      // Add initial greeting bubble
      addMessageBubble(greetingText, 'assistant');

      // Populate suggestions dynamically
      renderSuggestions(currentSuggestions);

      // Unified tab switching (Navigation <-> Chat). Each pane sizes its own content,
      // so swapping tabs dynamically resizes the window (nav = compact, chat = tall).
      let activeTab = 'nav';
      function switchUnifiedTab(tab) {
        if (!paneEls[tab]) return;
        activeTab = tab;
        tabButtons.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === tab));
        Object.keys(paneEls).forEach(k => { if (paneEls[k]) paneEls[k].style.display = (k === tab) ? '' : 'none'; });
        unifiedPanel.setAttribute('data-active', tab);
        if (tab === 'chat') {
          chatInput.focus();
          chatHistory.scrollTop = chatHistory.scrollHeight;
          const chatAvatar = unifiedPanel.querySelector('.teodor-chat-avatar .teodor-duck-svg');
          if (chatAvatar) { chatAvatar.classList.remove('duck-pop-jump'); void chatAvatar.offsetWidth; chatAvatar.classList.add('duck-pop-jump'); }
        }
      }
      tabButtons.forEach(t => t.addEventListener('click', (e) => { e.stopPropagation(); switchUnifiedTab(t.getAttribute('data-tab')); }));

      // FAB opens/closes the single unified window
      function openUnified(tab) { unifiedPanel.classList.add('open'); switchUnifiedTab(tab || activeTab); }
      function closeUnified() { unifiedPanel.classList.remove('open'); }
      fab.addEventListener('click', (e) => {
        e.stopPropagation();
        if (unifiedPanel.classList.contains('open')) closeUnified(); else openUnified();
      });
      closeBtn.addEventListener('click', (e) => { e.stopPropagation(); closeUnified(); });
      unifiedPanel.addEventListener('click', (e) => e.stopPropagation());
      document.addEventListener('click', (e) => { if (!widgetContainer.contains(e.target)) closeUnified(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeUnified(); });

      // Clear Chat Handler
      const clearBtn = document.getElementById('teodor-global-clear');
      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (confirm("Are you sure you want to clear your conversation with TEodor?")) {
            chatHistory.innerHTML = '';
            addMessageBubble(greetingText, 'assistant');
          }
        });
      }

      // Helper to render suggestion chips
      function renderSuggestions(suggs) {
        suggestionsContainer.innerHTML = '';
        if (suggs.length === 0) {
          suggestionsContainer.style.display = 'none';
          return;
        }
        suggestionsContainer.style.display = 'flex';
        suggs.forEach(sug => {
          const chip = document.createElement('span');
          chip.className = 'teodor-suggest-tag';
          chip.textContent = sug.label;
          chip.addEventListener('click', (e) => {
            e.stopPropagation();
            submitUserQuery(sug.query);
          });
          suggestionsContainer.appendChild(chip);
        });
      }

      // Helper to add chat bubble
      function addMessageBubble(text, sender) {
        const bubble = document.createElement('div');
        bubble.className = `teodor-bubble ${sender}`;
        
        // Parse simple markdown links [text](url) and bold text **text**
        let htmlContent = escapeHtml(text)
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
        
        bubble.innerHTML = htmlContent;
        chatHistory.appendChild(bubble);
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }

      function escapeHtml(unsafe) {
        return unsafe
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      // Submit user query
      async function submitUserQuery(text) {
        if (!text || text.trim() === "") return;
        
        // Add User Bubble
        addMessageBubble(text, 'user');
        chatInput.value = '';

        // Trigger dynamic beak quacking state on all active yellow duck wrappers
        const triggers = document.querySelectorAll('.teodor-floating-btn, .teodor-chat-avatar, .teodor-svg-wrapper');
        triggers.forEach(t => t.classList.add('quacking'));

        // Clear and show live logs
        logsContent.innerHTML = '';
        logsContainer.style.display = 'block';

        // Initialize Global AI Insight
        const aiInsight = new GlobalAiInsight((logStep) => {
          if (logStep.type === 'thought') {
            logsContent.innerHTML += `<div style="color: #38BDF8; margin-bottom: 0.35rem; font-family: monospace;">💭 <strong>[THOUGHT]:</strong> ${escapeHtml(logStep.text)}</div>`;
          } else if (logStep.type === 'action') {
            logsContent.innerHTML += `<div style="color: #FBBF24; margin-bottom: 0.35rem; font-family: monospace;">⚡ <strong>[CALL TOOL]:</strong> ${escapeHtml(logStep.text)}</div>`;
          } else if (logStep.type === 'observation') {
            logsContent.innerHTML += `<div style="color: #10B981; margin-bottom: 0.35rem; font-family: monospace;">🔍 <strong>[OBSERVATION]:</strong> ${escapeHtml(logStep.text)}</div>`;
          } else if (logStep.type === 'final') {
            logsContent.innerHTML += `<div style="color: #E98300; margin-bottom: 0.35rem; font-family: monospace; border-top: 1px dashed #334155; padding-top: 0.35rem; margin-top: 0.35rem; display: flex; align-items: center; gap: 0.3rem;"><span style="display:inline-block; width:16px; height:16px; flex-shrink:0;">${getTeodorDuckSvg('100%')}</span> <strong>[FINAL ANSWER]:</strong> ${escapeHtml(logStep.text)}</div>`;
          }
          logsContent.scrollTop = logsContent.scrollHeight;
        });

        // Run agent execution cycle
        const answer = await aiInsight.run(text);

        // Turn off quacking upon completing speech
        triggers.forEach(t => t.classList.remove('quacking'));

        // Hide logs shortly after completion to clean up the screen
        setTimeout(() => {
          logsContainer.style.display = 'none';
        }, 3000);

        // Add Assistant Bubble
        addMessageBubble(answer, 'assistant');
      }

      // Input Form Listener
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        submitUserQuery(chatInput.value);
      });
    }

    // --- Global AI Insight Definition ---
    class GlobalAiInsight {
      constructor(loggerCallback) {
        this.logger = loggerCallback;
        this.tools = {
          getDiagnosticsScore: async (dimension) => {
            try {
              const res = await fetch('/api/assessment/latest');
              const data = await res.json();
              if (data.success && data.assessment) {
                const score = data.assessment.scores[dimension];
                return `Diagnostics check: ${dimension.toUpperCase()} score is ${score || 'unknown'}/5.0.`;
              }
              return `Diagnostics check: No assessment score found for ${dimension}.`;
            } catch (e) {
              return `Error checking scores: ${e.message}`;
            }
          },
          searchPlaybook: async (query) => {
            try {
              // [security] D-11-01 (plan 11-07): GET /api/rag/search is staff-only
              // in a real deal. For a role refused it the chat still answers — it
              // just has no uploaded-document snippets to quote, and no request is sent.
              if (!(await window.maCanReady('rag'))) {
                return 'RAG search check: playbook snippet search is not available for your role.';
              }
              const res = await fetch(`/api/rag/search?q=${encodeURIComponent(query)}`);
              const data = await res.json();
              if (data.success && data.results && data.results.length > 0) {
                const snippets = data.results.map((r, idx) => `[Rule #${idx+1}] [${r.chapter}] ${r.title}: "${r.text}"`).join('\n');
                return `Retrieved ${data.results.length} playbook rules from RAG index:\n${snippets}`;
              }
              return `RAG search check: No playbook rules found for query keyword "${query}".`;
            } catch (e) {
              return `Error querying RAG search index: ${e.message}`;
            }
          },
          getPlaybookLink: async (dimension) => {
            const links = {
              culture: "/playbook.html#culture",
              talent: "/playbook.html#talent",
              value: "/playbook.html#value"
            };
            return `Coordinate link: Chapter target is ${links[dimension] || '/playbook.html'}.`;
          },
          getAcquisitionProgress: async () => {
            try {
              // [security] D-11-01 (plan 11-07): the named roster is staff-only in a
              // real deal. A role refused it gets a neutral line — never "Roster is
              // empty", which would be false — and no request is sent.
              if (!(await window.maCanReady('roster'))) {
                return 'Acquisition Analytics: workforce analytics are not available for your role.';
              }
              const res = await fetch('/api/employees');
              const employees = await res.json();
              if (employees && employees.length > 0) {
                const totalXp = employees.reduce((sum, e) => sum + (e.points || 0), 0);
                const avgLessons = employees.reduce((sum, e) => sum + (e.completedLessons ? e.completedLessons.length : 0), 0) / employees.length;
                const certified = employees.filter(e => e.points >= 120).length;
                return `Acquisition Analytics: Roster has ${employees.length} employees, total XP is ${totalXp}, average lessons completed is ${avgLessons.toFixed(1)}/9, and ${certified} certified.`;
              }
              return `Acquisition Analytics: Roster is empty.`;
            } catch (e) {
              return `Error loading workforce: ${e.message}`;
            }
          }
        };
      }

      async run(userInput) {
        const query = userInput.toLowerCase();
        const actions = [];
        
        if (query.includes('culture') || query.includes('values') || query.includes('anxiety') || query.includes('resist')) {
          actions.push({
            thought: "Query focuses on cultural values and transition anxiety. Running getDiagnosticsScore to evaluate overall culture gap alignment.",
            tool: "getDiagnosticsScore",
            arg: "culture",
            nextThought: "Culture diagnostics processed. Now searching the RAG index for employee communication and town hall policies."
          });
          actions.push({
            tool: "searchPlaybook",
            arg: "culture values communication resistance town hall",
            nextThought: "Playbook rules parsed. Fetching target playbook chapter anchor link for user reference."
          });
          actions.push({
            tool: "getPlaybookLink",
            arg: "culture",
            nextThought: "Playbook coordinate links loaded. Compiling responsive Post-Merger Integration advice."
          });
        } else if (query.includes('talent') || query.includes('retention') || query.includes('engineer') || query.includes('sso') || query.includes('access') || query.includes('systems')) {
          actions.push({
            thought: "Query focuses on systems access, security onboarding, or R&D talent retention. Checking active Talent score.",
            tool: "getDiagnosticsScore",
            arg: "talent",
            nextThought: "Talent score processed. Searching RAG index for SSO setup and engineer retention guidelines."
          });
          actions.push({
            tool: "searchPlaybook",
            arg: "talent retention R&D cyber security SSO credentials",
            nextThought: "RAG guidelines parsed. Retrieving playbook coordinates for the Talent Mapping chapter."
          });
          actions.push({
            tool: "getPlaybookLink",
            arg: "talent",
            nextThought: "Talent playbook links loaded. Formulating final recommendation."
          });
        } else if (query.includes('value') || query.includes('synergy') || query.includes('sales') || query.includes('pricing') || query.includes('patent')) {
          actions.push({
            thought: "Query targets sales pipelines, supply chains, or IP technology transfers. Evaluating Value & Synergies score.",
            tool: "getDiagnosticsScore",
            arg: "value",
            nextThought: "Value score loaded. Searching the RAG index for pricing, patent R&D, and sales synergy rules."
          });
          actions.push({
            tool: "searchPlaybook",
            arg: "synergy pricing sales distribution technology transfer patent",
            nextThought: "RAG snippets retrieved. Compiling coordination links for Value Synergy Playbook."
          });
          actions.push({
            tool: "getPlaybookLink",
            arg: "value",
            nextThought: "All assets are ready. Synthesizing final synergy response."
          });
        } else if (query.includes('progress') || query.includes('employee') || query.includes('xp') || query.includes('roster') || query.includes('certified') || query.includes('academy')) {
          actions.push({
            thought: "User requests a status report on Employee Academy onboarding checkpoints. Querying getAcquisitionProgress.",
            tool: "getAcquisitionProgress",
            arg: null,
            nextThought: "Academy metrics loaded. Finalizing onboarding progress analytics report."
          });
        } else {
          actions.push({
            thought: `General post-merger integration query received. Querying RAG index for keyword search matching: "${userInput}".`,
            tool: "searchPlaybook",
            arg: userInput,
            nextThought: "Playbook rules fetched. Running getAcquisitionProgress to overlay current employee context."
          });
          actions.push({
            tool: "getAcquisitionProgress",
            arg: null,
            nextThought: "Context established. Formulating AI Integration response."
          });
        }

        // Execute action logs
        for (let act of actions) {
          if (act.thought) {
            this.logger({ type: 'thought', text: act.thought });
            await new Promise(r => setTimeout(r, 600));
          }
          
          this.logger({ type: 'action', text: `run ${act.tool}(${act.arg ? `'${act.arg}'` : ''})` });
          await new Promise(r => setTimeout(r, 500));
          
          const observation = await this.tools[act.tool](act.arg);
          this.logger({ type: 'observation', text: observation });
          await new Promise(r => setTimeout(r, 700));
          
          if (act.nextThought) {
            this.logger({ type: 'thought', text: act.nextThought });
            await new Promise(r => setTimeout(r, 500));
          }
        }

        this.logger({ type: 'thought', text: "Synthesizing advice with TEodor quacking style..." });
        await new Promise(r => setTimeout(r, 400));

        const finalAnswer = this.getFallbackAnswer(query);
        this.logger({ type: 'final', text: finalAnswer });
        return finalAnswer;
      }

      getFallbackAnswer(query) {
        if (query.includes('culture') || query.includes('values') || query.includes('anxiety') || query.includes('resist')) {
          return "Quack! Middle management anxiety is best handled via early values workshops and localized town halls. Since our diagnostics showed a Culture & Values score of 3.67 (Moderate Gap), prioritize communication cadences. Ensure you open our comprehensive [Culture and Values Playbook](/playbook.html#culture) to schedule the TE Values Synergy Workshops.";
        }
        if (query.includes('talent') || query.includes('retention') || query.includes('engineer') || query.includes('sso') || query.includes('access') || query.includes('systems')) {
          return "Quack! Our Talent & Systems alignment is highly positive at 4.67. To safeguard this, make sure SSO logins are fully distributed and cyber training completed in the first 30 days. Read the [Talent Mapping & Retention Guide](/playbook.html#talent) for key retention incentive models.";
        }
        if (query.includes('value') || query.includes('synergy') || query.includes('sales') || query.includes('pricing') || query.includes('patent')) {
          return "Quack! Commercial synergy capture is rated at 5.0 (Strong Alignment). Secure this target by catalog alignment and pipeline integration. Check out the [Value Synergy Playbook](/playbook.html#value) to coordinate direct supply-chain handoffs.";
        }
        if (query.includes('progress') || query.includes('employee') || query.includes('xp') || query.includes('roster') || query.includes('certified') || query.includes('academy')) {
          return "Quack! Our Academy Roster currently tracks 3 pre-seeded integration leads. Emma Watson is leading with 160 XP (Synergy Scout badge tier), followed by Sarah Jenkins at 110 XP (Systems Scholar badge tier). Keep awarding Merit Points (+50 XP) to integration champions to unlock milestone bonuses!";
        }
        return "Quack! I am TEodor, your post-merger integration coach! Ask me about culture gaps, engineer retention incentives, product synergies, or the employee training progress dashboard!";
      }
    }
  }


  // ==========================================
  // SMOLAGENT DYNAMIC RAG PORTAL INSIGHTS PANEL
  // ==========================================
  function initializeAiInsightInsight() {
    const path = window.location.pathname;
    let portal = '';
    
    if (path === '/' || path.endsWith('/index.html') || path.endsWith('/pmo.html')) {
      portal = 'pmo';
    } else if (path.endsWith('/dashboard.html')) {
      portal = 'hrbp';
    }
    // Admin is a SaaS backend, not a portal — no AI insight card there.

    if (!portal) return; // Only run on PMO and Integration Leader

    // [security] D-11-01 (plan 11-07): the card is fed by GET /api/ai/insight, a
    // staff-only read in a real deal that also sends portal data to the AI
    // provider. A role the read policy refuses (an employee landing on '/') gets
    // no card and no request — it would only render "Failed to connect".
    window.maCanReady('ai').then(function (ok) { if (ok) renderAiInsightCard(portal); });
  }

  function renderAiInsightCard(portal) {
    // index.html's landing uses <main class="demo-showcase-container">, not .main-content —
    // fall back to <main> so the AI-insight card injects there too (matches the role-guidance banner).
    const mainContainer = document.querySelector('.main-content') || document.querySelector('main');
    if (!mainContainer) return;

    // Check if it's already injected
    if (document.getElementById('smol-agent-insight-card')) return;
    if (sessionStorage.getItem('aiinsight_dismissed') === 'true') return;

    // Create the card container element
    const card = document.createElement('div');
    card.id = 'smol-agent-insight-card';
    card.className = 'card card-glass';
    card.style.cssText = `
      margin-bottom: 1.5rem;
      border: 1.5px solid transparent;
      background: linear-gradient(135deg, rgba(233, 131, 0, 0.05) 0%, rgba(36, 76, 90, 0.05) 100%);
      position: relative;
      border-radius: 8px;
      box-shadow: 0 0 15px rgba(233, 131, 0, 0.08);
      overflow: hidden;
      transition: all 0.3s ease;
    `;

    // Inner HTML markup with premium styling, animated glowing border, and dynamic layout
    card.innerHTML = `
      <!-- Glowing dynamic border container -->
      <div class="smol-glow-border" style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 8px; border: 1.5px solid transparent; pointer-events: none; opacity: 0.8;"></div>
      
      <div style="padding: 1rem; display: flex; align-items: flex-start; gap: 0.85rem; position: relative; z-index: 2;">
        <!-- Glowing active AI Icon -->
        <div style="background: linear-gradient(135deg, var(--te-orange), var(--te-dark-teal)); border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
          🤖
        </div>
        
        <div style="flex-grow: 1;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.35rem;">
            <h4 style="margin: 0; font-size: 0.82rem; font-weight: 800; color: var(--te-dark-teal); letter-spacing: 0.5px; text-transform: uppercase; display: flex; align-items: center; gap: 0.35rem; font-family: var(--font-family-display);">
              <span>AI Insight Dynamic PMI Insight</span> 
              <span style="background: rgba(233, 131, 0, 0.12); color: var(--te-orange); font-size: 0.65rem; font-weight: 700; padding: 0.1rem 0.4rem; border-radius: 4px; display: inline-block;">RAG Core</span>
            </h4>
            <span style="font-size: 0.7rem; color: var(--text-secondary); cursor: pointer; user-select: none; display: flex; align-items: center; gap: 0.25rem; font-weight: 700;" id="btn-refresh-smol-insight" title="Recalculate AI Insight">🔄 Recalculate</span>
          </div>
          
          <!-- Skeleton Lazy Loader & Content Box -->
          <div id="smol-insight-content" style="font-size: 0.82rem; line-height: 1.45; color: var(--text-main); font-weight: 500;">
            <!-- Skeleton Lazy Loader markup (shown by default) -->
            <div class="smol-skeleton" style="display: flex; flex-direction: column; gap: 0.45rem; margin-top: 0.35rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; font-weight: 700; color: var(--te-orange);">
                <div class="smol-spinner" style="width: 12px; height: 12px; border: 2px solid var(--te-orange); border-top-color: transparent; border-radius: 50%; animation: smol-spin 0.8s linear infinite;"></div>
                <span>Insight incoming... AI Insight is thinking...</span>
              </div>
              <div class="skeleton-line" style="height: 10px; width: 95%; background: rgba(0,0,0,0.06); border-radius: 5px; animation: smol-pulse 1.5s infinite ease-in-out;"></div>
              <div class="skeleton-line" style="height: 10px; width: 80%; background: rgba(0,0,0,0.06); border-radius: 5px; animation: smol-pulse 1.5s infinite ease-in-out; animation-delay: 0.2s;"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Append keyframe animations to the document if not already loaded
    if (!document.getElementById('smol-agent-insight-styles')) {
      const style = document.createElement('style');
      style.id = 'smol-agent-insight-styles';
      style.textContent = `
        #smol-agent-insight-card {
          animation: smol-shadow-glow 4s infinite alternate;
        }
        .smol-glow-border {
          background: linear-gradient(135deg, var(--te-orange), var(--te-dark-teal)) border-box;
          -webkit-mask: linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor;
          mask-composite: exclude;
        }
        @keyframes smol-shadow-glow {
          0% { box-shadow: 0 0 8px rgba(233,131,0,0.08), 0 0 2px rgba(36,76,90,0.05); border-color: rgba(233,131,0,0.15); }
          100% { box-shadow: 0 0 20px rgba(233,131,0,0.22), 0 0 8px rgba(36,76,90,0.15); border-color: rgba(36,76,90,0.3); }
        }
        @keyframes smol-pulse {
          0% { opacity: 0.3; background: rgba(0,0,0,0.04); }
          50% { opacity: 0.7; background: rgba(0,0,0,0.08); }
          100% { opacity: 0.3; background: rgba(0,0,0,0.04); }
        }
        @keyframes smol-spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }

    // Inject at the absolute top of .main-content
    mainContainer.insertBefore(card, mainContainer.firstChild);
    makeBannerDismissible(card, 'aiinsight_dismissed');

    // Trigger RAG insight query
    fetchSmolInsight(portal);

    // Refresh handler
    const refreshBtn = card.querySelector('#btn-refresh-smol-insight');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        // Re-trigger skeleton lazy load loader
        const contentArea = card.querySelector('#smol-insight-content');
        if (contentArea) {
          contentArea.innerHTML = `
            <div class="smol-skeleton" style="display: flex; flex-direction: column; gap: 0.45rem; margin-top: 0.35rem;">
              <div style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.78rem; font-weight: 700; color: var(--te-orange);">
                <div class="smol-spinner" style="width: 12px; height: 12px; border: 2px solid var(--te-orange); border-top-color: transparent; border-radius: 50%; animation: smol-spin 0.8s linear infinite;"></div>
                <span>Insight incoming... AI Insight is thinking...</span>
              </div>
              <div class="skeleton-line" style="height: 10px; width: 95%; background: rgba(0,0,0,0.06); border-radius: 5px; animation: smol-pulse 1.5s infinite ease-in-out;"></div>
              <div class="skeleton-line" style="height: 10px; width: 80%; background: rgba(0,0,0,0.06); border-radius: 5px; animation: smol-pulse 1.5s infinite ease-in-out; animation-delay: 0.2s;"></div>
            </div>
          `;
        }
        fetchSmolInsight(portal);
      });
    }
  }

  function fetchSmolInsight(portal) {
    const contentArea = document.querySelector('#smol-insight-content');
    if (!contentArea) return;

    fetch(`/api/ai/insight?portal=${portal}`)
      .then(res => {
        if (!res.ok) throw new Error('Dynamic insight generation failed.');
        return res.json();
      })
      .then(data => {
        if (data.success && data.insight) {
          contentArea.style.opacity = '0';
          contentArea.style.transition = 'opacity 0.3s ease';
          setTimeout(() => {
            contentArea.innerHTML = `<span style="display: inline-block; padding: 0.25rem 0;">${data.insight}</span>`;
            contentArea.style.opacity = '1';
          }, 100);
        } else {
          contentArea.innerHTML = `<span style="color: #ef4444;">⚠️ Failed to load expert insight. Please try again.</span>`;
        }
      })
      .catch(err => {
        console.error('Error fetching AI Insight RAG insight:', err);
        contentArea.innerHTML = `<span style="color: #ef4444;">⚠️ Failed to connect to AI Insight PMI Service.</span>`;
      });
  }

  // --- Role Guidance & Action Timeline Banner Injection ---
  // Shared: add a dismiss (X) button to an injected top-of-page notification banner.
  // Dismissal persists for the session (sessionStorage) so it reappears on a fresh demo.
  function makeBannerDismissible(el, storageKey, store) {
    if (el.querySelector('.banner-dismiss-btn')) return;
    el.style.paddingRight = '2.4rem';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'banner-dismiss-btn';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.title = 'Dismiss';
    btn.innerHTML = '&times;';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(function () { el.remove(); }, 190);
      try { (store === 'local' ? localStorage : sessionStorage).setItem(storageKey, 'true'); } catch (_) {}
    });
    el.appendChild(btn);
  }
  window.makeBannerDismissible = makeBannerDismissible;

  function injectRoleGuidanceBanner() {
    const path = window.location.pathname;
    const activeRole = localStorage.getItem('active_demo_role') || 'admin';
    const mainContainer = document.querySelector('.main-content') || document.querySelector('main');
    if (!mainContainer) return;

    if (document.getElementById('role-guidance-banner-card')) return;
    if (sessionStorage.getItem('rgbanner_dismissed') === 'true') return;

    // Map roles to basic properties
    const roleProps = {
      admin: { icon: "⚙️", roleName: "System Administrator", color: "#374151" },
      pmo: { icon: "🏢", roleName: "PMO Coordinator", color: "var(--te-orange)" },
      hrbp: { icon: "📊", roleName: "Integration Leader", color: "var(--te-dark-teal)" },
      supporting: { icon: "👥", roleName: "Supporting Teams Lead", color: "#8B5CF6" },
      employee: { icon: "👤", roleName: "Legacy Acquired Employee", color: "#10B981" }
    };

    const currentRole = roleProps[activeRole] || roleProps.admin;

    // Define all context content
    const pageGuidance = {
      pmo: {
        admin: {
          mission: "Configure PMO integration workflow rules, reset step locks, and verify background database tables.",
          actionTime: "Audit project steering permissions",
          deadline: "Continuous",
          status: "Active"
        },
        pmo: {
          mission: "Govern stage timeline gates, align functional synergy tracks, and coordinate steering gate approvals.",
          actionTime: "Day 30 Steering Calibration Sync",
          deadline: "Due in 2 days",
          status: "Active Tracking"
        },
        hrbp: {
          mission: "Monitor PMO steering progress and consult on HR workstream timeline delays.",
          actionTime: "Review Integration Leader track alignment feedback",
          deadline: "Due in 3 days",
          status: "Reviewing"
        },
        supporting: {
          mission: "Observe PMO milestones and check dependency items for supporting teams compliance.",
          actionTime: "Sync supporting tracks with master PMO calendar",
          deadline: "Due in 4 days",
          status: "In Progress"
        },
        employee: {
          mission: "View corporate integration timeline and broad track stages.",
          actionTime: "Read-only timeline inspection",
          deadline: "FYI Only",
          status: "Online"
        }
      },
      dashboard: {
        admin: {
          mission: "Manage HR database queries, audit bulk cohort upload scripts, and check sentiment AI parameters.",
          actionTime: "Optimize Integration Leader telemetry sync queries",
          deadline: "Standby",
          status: "Active"
        },
        pmo: {
          mission: "Evaluate Integration Leader sentiment metrics, track cohort integration rates, and coordinate alignment reports.",
          actionTime: "Sync sentiment indexes with corporate steering gate",
          deadline: "Due in 1 day",
          status: "In Progress"
        },
        hrbp: {
          mission: "Manage employee sentiment, run bulk database cohort mappings, and dispatch workforce broadcast communications.",
          actionTime: "Bulk legacy cohort database roster migration",
          deadline: "Due in 4 days",
          status: "Pending Upload"
        },
        supporting: {
          mission: "Analyze aggregate division metrics to adjust payroll mapping and benefits provisioning.",
          actionTime: "Verify regional reward mappings match dashboard indicators",
          deadline: "Due in 5 days",
          status: "Task Pending"
        },
        employee: {
          mission: "Check general sentiment feedback statistics and system status.",
          actionTime: "View anonymous culture pulse ratings",
          deadline: "Read-only",
          status: "Online"
        }
      },
      supporting: {
        admin: {
          mission: "Oversee data pipeline connections for HRSS, regional payroll, legal, and benefits tables.",
          actionTime: "Check cross-database integration connectors",
          deadline: "Standby",
          status: "Operational"
        },
        pmo: {
          mission: "Supervise operational compliance targets, review legal bottlenecks, and track regional benefits schedules.",
          actionTime: "Verify HRSS and legal milestone checklists",
          deadline: "Due in 2 days",
          status: "Steering Review"
        },
        hrbp: {
          mission: "Collaborate with supporting groups to process regional titles, grade matches, and contract migrations.",
          actionTime: "Cross-reference Integration Leader profiles with payroll rosters",
          deadline: "Due in 3 days",
          status: "In Progress"
        },
        supporting: {
          mission: "Coordinate operational compliance checks and payroll integrations across HRSS, Regional HR, Legal, and Total Rewards.",
          actionTime: "Q2 divisional integration compliance checklist sign-off",
          deadline: "Due in 5 days",
          status: "In Progress"
        },
        employee: {
          mission: "Submit support requests, look up regional contact points, and check payroll details.",
          actionTime: "Read benefit enrollment FAQs",
          deadline: "Helpdesk Online",
          status: "Active"
        }
      },
      employee: {
        admin: {
          mission: "Troubleshoot employee user sessions, adjust training XP coefficients, and verify lessons database records.",
          actionTime: "Inspect SSO access logging",
          deadline: "Immediate",
          status: "Active"
        },
        pmo: {
          mission: "Monitor employee onboarding progress, view average lessons completion rates, and verify XP metrics.",
          actionTime: "Track cohort training success rates",
          deadline: "Due in 3 days",
          status: "Reviewing"
        },
        hrbp: {
          mission: "Observe training roadblocks, trace low-completion cohorts, and resolve title migration issues.",
          actionTime: "Address R&D Specialist lesson delays",
          deadline: "Due today",
          status: "Urgent Sync"
        },
        supporting: {
          mission: "Confirm that payroll and regulatory compliance training modules are loaded for all acquired staff.",
          actionTime: "Verify InfoSec course completion report",
          deadline: "Due in 2 days",
          status: "Checking"
        },
        employee: {
          mission: "Navigate your personalized 100-day integration journey, finish academy lessons, earn XP, and unlock TE rewards.",
          actionTime: "SSO credentials registration & Cybersecurity course completion",
          deadline: "Due today ⏳",
          status: "Action Required"
        }
      },
      admin: {
        admin: {
          mission: "Manage global configurations, run relational database migrations (SQL / Supabase), and audit RAG AI engine settings.",
          actionTime: "Export finalized integration SQL schemas to Microsoft Azure",
          deadline: "Ready to Execute",
          status: "Standby"
        },
        pmo: {
          mission: "Observe system diagnostics, review AI steering prompts, and inspect settings logs.",
          actionTime: "Review AI configuration parameters",
          deadline: "Audit phase",
          status: "Reviewing"
        },
        hrbp: {
          mission: "Inspect configuration rules and AI sentiment thresholds.",
          actionTime: "Review AI parameters",
          deadline: "Read-only",
          status: "Viewing"
        },
        supporting: {
          mission: "Review system data mapping setups.",
          actionTime: "Inspect data configurations",
          deadline: "Read-only",
          status: "Viewing"
        },
        employee: {
          mission: "Standard user access view.",
          actionTime: "Inspect configuration",
          deadline: "Restricted",
          status: "Limited"
        }
      },
      survey: {
        admin: {
          mission: "View global integration survey responses, export pulse metrics to CSV, and calibrate sentiment thresholds.",
          actionTime: "Review real-time feedback database integrity",
          deadline: "Continuous audit",
          status: "Online"
        },
        pmo: {
          mission: "Oversee the sentiment pulse checklist, track employee response rates, and brief steering committees.",
          actionTime: "Review anonymous comments and synergy alignment",
          deadline: "Due in 2 days",
          status: "Active Tracking"
        },
        hrbp: {
          mission: "Evaluate post-merger culture friction, identify high-risk flight hazards, and formulate mitigation plans.",
          actionTime: "Address critical red flags from R&D cohort feedback",
          deadline: "Review ASAP",
          status: "Critical Attention"
        },
        supporting: {
          mission: "Observe general survey participation rate to coordinate team outreach.",
          actionTime: "Track department participation rate",
          deadline: "FYI Only",
          status: "Reviewing"
        },
        employee: {
          mission: "Provide honest integration pulse feedback and submit local comments.",
          actionTime: "Complete anonymous Day 30 pulse survey",
          deadline: "Due tomorrow",
          status: "Action Pending"
        }
      },
      playbook: {
        admin: {
          mission: "Maintain configuration steps, configure documentation links, and index lessons learned database.",
          actionTime: "Verify playbook document source pathways",
          deadline: "Ready to Execute",
          status: "Standby"
        },
        pmo: {
          mission: "Validate playbooks, track milestones completion, and confirm that target operational procedures align.",
          actionTime: "Review functional integration milestone templates",
          deadline: "Due in 1 week",
          status: "Planning Phase"
        },
        hrbp: {
          mission: "Execute HR workstream milestones: verify leadership structure, align title grades, and implement policies.",
          actionTime: "Cross-reference HR playbooks with legal guidelines",
          deadline: "Due in 4 days",
          status: "In Progress"
        },
        supporting: {
          mission: "Review compliance, legal clearances, rewards structures, and payroll integration guides in the playbook.",
          actionTime: "Sign-off on regional payroll and benefits mapping steps",
          deadline: "Due in 5 days",
          status: "Task Pending"
        },
        employee: {
          mission: "Review the employee integration guide and checklist steps.",
          actionTime: "Read corporate values and policies playbook chapter",
          deadline: "Recommended",
          status: "Active"
        }
      },
      leaders: {
        admin: {
          mission: "Support site leaders with tools access, database synchronization, and check localized settings.",
          actionTime: "Confirm leadership system role permissions",
          deadline: "Immediate",
          status: "Active"
        },
        pmo: {
          mission: "Align acquired site leaders, monitor team completion rates, and verify cultural onboarding metrics.",
          actionTime: "Host sync meeting with plant and local managers",
          deadline: "Due in 3 days",
          status: "In Progress"
        },
        hrbp: {
          mission: "Advise site managers on title alignment, localized benefits structures, and culture transitions.",
          actionTime: "Discuss team grading calibrations with site heads",
          deadline: "Due in 2 days",
          status: "Scheduled"
        },
        supporting: {
          mission: "Address regional payroll, compliance audits, and legal queries escalated by acquired plant leaders.",
          actionTime: "Resolve legal reporting structure discrepancy",
          deadline: "Due in 4 days",
          status: "Escalated"
        },
        employee: {
          mission: "Observe team achievements, leaderboard standings, and manager notices.",
          actionTime: "Review local team shout-out bulletin",
          deadline: "Read-only",
          status: "Viewing"
        }
      }
    };

    // Determine the page key matching the current file
    let pageKey = "";
    if (path.includes('pmo.html')) pageKey = 'pmo';
    else if (path.includes('dashboard.html')) pageKey = 'dashboard';
    else if (path.includes('supporting.html')) pageKey = 'supporting';
    else if (path.includes('employee.html')) pageKey = 'employee';
    else if (path.includes('admin.html')) return; // Admin backend has its own header, no role-guidance banner
    else if (path.includes('survey.html')) pageKey = 'survey';
    else if (path.includes('playbook.html')) pageKey = 'playbook';
    else if (path.includes('leaders.html')) pageKey = 'leaders';

    if (!pageKey) return;

    const data = pageGuidance[pageKey][activeRole] || pageGuidance[pageKey].admin;
    const effRole = pageGuidance[pageKey][activeRole] ? activeRole : 'admin';

    const banner = document.createElement('div');
    banner.id = 'role-guidance-banner-card';
    banner.className = 'card card-glass';
    banner.style.cssText = `
      margin-bottom: 1.5rem;
      border-left: 5px solid ${currentRole.color};
      background: linear-gradient(90deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%);
      padding: 1rem 1.25rem;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 15px rgba(0,0,0,0.05);
      border-radius: var(--radius-md, 8px);
    `;

    banner.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div style="display: flex; align-items: center; gap: 1rem; flex: 1; min-width: 280px;">
          <div style="background: ${currentRole.color}; color: white; width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.15);">
            ${currentRole.icon}
          </div>
          <div>
            <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.15rem;">
              <span data-i18n="banner.portraying_role" style="font-family: var(--font-family-display); font-size: 0.72rem; font-weight: 800; color: ${currentRole.color}; letter-spacing: 0.5px; text-transform: uppercase;">PORTRAYING ROLE</span>
              <span class="badge" style="background: rgba(36,76,90,0.08); color: var(--te-dark-teal); font-size: 0.8rem; font-weight: 700; padding: 0.1rem 0.5rem; border-radius: 20px;">${currentRole.roleName}</span>
            </div>
            <p style="margin: 0; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.4; font-weight: 500;">
              <strong data-i18n="banner.active_mission_label">Active Mission:</strong> <span data-i18n="banner.${pageKey}_${effRole}_mission">${data.mission}</span>
            </p>
          </div>
        </div>
        
        <div style="background: rgba(36,76,90,0.03); border: 1.2px dashed rgba(36,76,90,0.15); border-radius: 6px; padding: 0.5rem 0.85rem; font-size: 0.76rem; display: flex; flex-direction: column; gap: 0.15rem; min-width: 240px; box-shadow: inset 0 1px 3px rgba(0,0,0,0.02);">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
            <span data-i18n="banner.next_action_time" style="color: var(--text-dim); font-weight: 600; text-transform: uppercase; font-size: 0.65rem; letter-spacing: 0.5px;">⚡ NEXT ACTION TIME</span>
            <span data-i18n="banner.${pageKey}_${effRole}_status" style="color: ${currentRole.color}; font-weight: 800; font-size: 0.65rem; text-transform: uppercase; padding: 0.05rem 0.35rem; border-radius: 4px; background: rgba(255,255,255,0.7); box-shadow: var(--shadow-sm);">${data.status}</span>
          </div>
          <strong data-i18n="banner.${pageKey}_${effRole}_actionTime" style="color: var(--te-dark-teal); font-size: 0.78rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;" title="${data.actionTime}">${data.actionTime}</strong>
          <span style="color: var(--text-secondary); font-size: 0.72rem; font-weight: 600; display: flex; align-items: center; gap: 0.25rem;">
            <span>🗓️</span> <span data-i18n="banner.${pageKey}_${effRole}_deadline">${data.deadline}</span>
          </span>
        </div>
      </div>
    `;

    mainContainer.insertBefore(banner, mainContainer.firstChild);
    makeBannerDismissible(banner, 'rgbanner_dismissed');
  }

  // ==========================================
  // Survey Modal Implementation
  // ==========================================
  window.showSurveyModal = function() {
    // Check if modal already exists
    if (document.getElementById('survey-scores-modal')) {
      document.getElementById('survey-scores-modal').style.display = 'flex';
      return;
    }

    const modalHTML = `
      <div id="survey-scores-modal" class="ai-insight-modal-overlay" style="display: flex;">
        <div class="ai-insight-modal" style="max-width: 850px; background: #ffffff; color: #333333;">
          <div class="ai-insight-modal-header" style="border-bottom: 1px solid #e5e7eb; padding-bottom: 1rem; margin-bottom: 1.5rem;">
            <h3 class="ai-insight-modal-title" style="margin: 0; font-family: var(--font-family-display); font-size: 1.5rem; color: var(--te-dark-teal);">M&A Integration Diagnostic | <span style="color: var(--te-orange); font-weight: 300;">Integration Scorecard</span></h3>
            <button class="ai-insight-modal-close" onclick="document.getElementById('survey-scores-modal').style.display='none'">✕</button>
          </div>
          <div class="ai-insight-modal-body">
            
            <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.75rem 1rem; background: var(--te-dark-teal); color: white; font-weight: bold; font-size: 0.85rem; border-radius: 4px 4px 0 0;">
              <div>Integration lever</div>
              <div style="text-align: center;">Score</div>
              <div>Status</div>
            </div>

            <div style="display: flex; flex-direction: column; font-size: 0.85rem; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 4px 4px;">
              <!-- Row 1 -->
              <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.85rem 1rem; border-bottom: 1px solid #e5e7eb; align-items: center;">
                <div style="font-weight: 600; color: #111827;">Strategic rationale</div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="flex-grow: 1; height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: 86%; background: #10B981;"></div>
                  </div>
                  <span style="font-weight: bold; color: #10B981; width: 25px;">4.3</span>
                </div>
                <div style="color: #10B981; font-weight: 600;">Strength</div>
              </div>
              
              <!-- Row 2 -->
              <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.85rem 1rem; border-bottom: 1px solid #e5e7eb; align-items: center; background: rgba(0,0,0,0.02);">
                <div style="font-weight: 600; color: #111827;">Manager support</div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="flex-grow: 1; height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: 70%; background: var(--te-orange);"></div>
                  </div>
                  <span style="font-weight: bold; color: var(--te-orange); width: 25px;">3.5</span>
                </div>
                <div style="color: var(--te-orange); font-weight: 600;">Partial buffer</div>
              </div>

              <!-- Row 3 -->
              <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.85rem 1rem; border-bottom: 1px solid #e5e7eb; align-items: center;">
                <div style="font-weight: 600; color: #111827;">Overall integration experience</div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="flex-grow: 1; height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: 60%; background: var(--te-orange);"></div>
                  </div>
                  <span style="font-weight: bold; color: var(--te-orange); width: 25px;">3.0</span>
                </div>
                <div style="color: var(--te-orange); font-weight: 600;">Functional, not repeatable</div>
              </div>

              <!-- Row 4 -->
              <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.85rem 1rem; border-bottom: 1px solid #e5e7eb; align-items: center; background: rgba(0,0,0,0.02);">
                <div style="font-weight: 600; color: #111827;">Communication architecture</div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="flex-grow: 1; height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: 58%; background: #EF4444;"></div>
                  </div>
                  <span style="font-weight: bold; color: #EF4444; width: 25px;">2.9</span>
                </div>
                <div style="color: #EF4444; font-weight: 600;">Control gap</div>
              </div>

              <!-- Row 5 -->
              <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.85rem 1rem; border-bottom: 1px solid #e5e7eb; align-items: center;">
                <div style="font-weight: 600; color: #111827;">Role and task clarity</div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="flex-grow: 1; height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: 58%; background: #EF4444;"></div>
                  </div>
                  <span style="font-weight: bold; color: #EF4444; width: 25px;">2.9</span>
                </div>
                <div style="color: #EF4444; font-weight: 600;">Operating-model gap</div>
              </div>

              <!-- Row 6 -->
              <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.85rem 1rem; border-bottom: 1px solid #e5e7eb; align-items: center; background: rgba(0,0,0,0.02);">
                <div style="font-weight: 600; color: #111827;">Culture and ways of working</div>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                  <div style="flex-grow: 1; height: 8px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden;">
                    <div style="height: 100%; width: 54%; background: #EF4444;"></div>
                  </div>
                  <span style="font-weight: bold; color: #EF4444; width: 25px;">2.7</span>
                </div>
                <div style="color: #EF4444; font-weight: 600;">Critical weakness</div>
              </div>

              <!-- Row 7 -->
              <div style="display: grid; grid-template-columns: 2.5fr 3fr 2fr; gap: 1rem; padding: 0.85rem 1rem; align-items: center;">
                <div style="font-weight: 600; color: #111827;">Future integration capability</div>
                <div style="display: flex; align-items: center; justify-content: center; font-weight: bold; color: #6b7280; font-size: 0.75rem; text-transform: uppercase;">
                  Priority
                </div>
                <div style="color: #4b5563; font-weight: 600;">Build required</div>
              </div>
            </div>
            
            <div style="margin-top: 1rem; font-size: 0.7rem; color: #6b7280;">
              Scores on a 1–5 scale. <span style="color: #10B981; font-weight: bold;">Strength</span> <span style="color: var(--te-orange); font-weight: bold;">Watch</span> <span style="color: #EF4444; font-weight: bold;">Weakness</span>
            </div>

            <div style="margin-top: 1.5rem; padding: 1.25rem; background: rgba(36, 76, 90, 0.03); border: 1px solid #e5e7eb; border-radius: 6px;">
              <h4 style="margin: 0 0 0.75rem 0; color: var(--te-dark-teal); font-size: 0.9rem;">Executive implications & signals</h4>
              <ul style="margin: 0; padding-left: 1.2rem; color: #4b5563; font-size: 0.8rem; line-height: 1.5;">
                <li style="margin-bottom: 0.4rem;"><strong>What the data tells leadership:</strong> Strategy landed — translate the "why" earlier into role, process and operating-model implications.</li>
                <li style="margin-bottom: 0.4rem;">Define RACI, decision rights and process ownership before major integration milestones.</li>
                <li style="margin-bottom: 0.4rem;"><strong>Directional signal:</strong> High-touch contact valued — meetings, site visits, Q&A and weekly updates.</li>
                <li>Watch-outs: benefits-onboarding guidance, safety readiness and slower cross-department flow.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
  };

  // Trigger Setup
  initializeAiInsightInsight();
});

// ===================================================================
// APP-WIDE i18n ENGINE (Phase 4) — translates [data-i18n] on every page
// ===================================================================
(function () {
  const LANG_KEY = 'employeeLanguage'; // shared with the employee page so both stay in sync
  let dict = null;
  const getLang = () => localStorage.getItem(LANG_KEY) || 'en';
  function t(key, lang) {
    if (!dict) return null;
    const s = dict.strings || {};
    return (s[lang] && s[lang][key]) || (s.en && s.en[key]) || null;
  }
  window.applyPortalI18n = function (lang) {
    lang = lang || getLang();
    if (!dict) return;
    // Lightweight markdown bold: **text** -> <strong>text</strong>.
    // For plain [data-i18n] we HTML-escape first (stays XSS-safe); for
    // [data-i18n-html] we keep the intentional markup and only bold on top.
    const escHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const mdBold = (s) => s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // [data-i18n-html] values legitimately contain rich markup (<span>/<strong>/
    // <input>…), so we can't blanket-escape them. Instead strip the dangerous bits
    // before innerHTML: script/iframe/object/embed tags, inline on*= handlers, and
    // javascript:/vbscript: URL schemes. (Defence-in-depth alongside the CSP.)
    // The leading class covers both whitespace AND the forward slash as a valid
    // HTML attribute separator (e.g. <img/onerror=...>) — a whitespace-only
    // class lets that shape pass through untouched.
    const stripDangerousHtml = (s) => String(s == null ? '' : s)
      .replace(/<\/?(?:script|iframe|object|embed|form|meta|base|link)\b[^>]*>/gi, '')
      .replace(/[\s/]on\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/[\s/]on\w+\s*=\s*'[^']*'/gi, '')
      .replace(/[\s/]on\w+\s*=\s*[^\s>]+/gi, '')
      .replace(/(=\s*["']?\s*)(?:javascript|vbscript)\s*:/gi, '$1');
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const v = t(el.getAttribute('data-i18n'), lang);
      if (v == null) return;
      if (v.indexOf('**') !== -1) el.innerHTML = mdBold(escHtml(v));
      else el.textContent = v;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
      const v = t(el.getAttribute('data-i18n-ph'), lang);
      if (v != null) el.setAttribute('placeholder', v);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const v = t(el.getAttribute('data-i18n-html'), lang);
      if (v != null) el.innerHTML = mdBold(stripDangerousHtml(v));
    });
    document.documentElement.setAttribute('lang', lang);
  };
  // Keep the cached dictionary fresh after an inline edit so applyPortalI18n
  // (which reads the cache) won't revert a just-saved string.
  window.setPortalI18nEntry = function (lang, key, value) {
    if (!dict) return;
    dict.strings = dict.strings || {};
    dict.strings[lang] = dict.strings[lang] || {};
    dict.strings[lang][key] = value;
  };
  function buildSelector() {
    const sel = document.getElementById('portal-lang-select');
    if (!sel || !dict) return false;
    const langs = (dict.languages || []).filter(l => l.enabled !== false);
    if (!langs.length) langs.push({ code: 'en', label: 'English', flag: '🇬🇧' });
    const cur = getLang();
    sel.innerHTML = langs.map(l => `<option value="${l.code}" ${l.code === cur ? 'selected' : ''}>${l.flag || ''} ${l.label || l.code}</option>`).join('');
    sel.addEventListener('change', () => {
      const lang = sel.value;
      localStorage.setItem(LANG_KEY, lang);
      window.applyPortalI18n(lang);
      document.dispatchEvent(new CustomEvent('portalLanguageChanged', { detail: lang }));
    });
    return true;
  }
  function init() {
    fetch('/api/i18n').then(r => r.json()).then(d => {
      dict = d;
      // The header selector is injected by the main handler; poll briefly for it.
      let tries = 0;
      const wire = () => { if (buildSelector() || tries++ > 40) return; setTimeout(wire, 50); };
      wire();
      window.applyPortalI18n(getLang());
    }).catch(e => console.error('i18n load failed', e));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
