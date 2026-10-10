// D-10-05 (Phase 10): the single password-hashing module — login,
// change-password, the first-admin CLI and set-admin-password all verify and
// hash through here, so there is exactly one place that knows the hash format.
//
// [security] Hash format. New hashes are SELF-DESCRIBING:
//
//     scrypt$n=131072,r=8,p=1$<32-hex salt>$<64-hex derived key>
//
// Cost parameters travel WITH the hash, so the cost can be raised later without
// a flag day: verify reads the parameters from the stored string, and
// `needsRehash` tells the caller (plan 10-05's lazy-rehash on successful login)
// that the stored cost is below CURRENT_PARAMS. N=131072 (2^17) is the
// OWASP-recommended scrypt floor; it needs 128 MiB of memory, which is more
// than Node's default 32 MiB `maxmem` — every derivation here passes an
// explicit 256 MiB ceiling.
//
// Legacy accounts (the committed demo accounts, anything created before Phase
// 10) store a bare 64-hex `scryptSync(pw, saltHex, 32)` hash (Node default
// N=16384) next to a separate 32-hex `salt` field. They still verify — always
// reporting needsRehash:true — so existing dev/demo logins keep working.
//
// Untrusted-parameter bound (T-10-07): a stored hash is parsed STRICTLY. N must
// be a power of two <= 2^20, r <= 32, p <= 16, and the derivation must fit the
// 256 MiB ceiling, otherwise verify returns not-ok rather than attempting a
// derivation an attacker-supplied row could make arbitrarily expensive.
//
// Timing (T-10-08): callers run dummyVerify() for an unknown or disabled
// account so a login attempt costs one CURRENT_PARAMS derivation either way.
// Residual, accepted: a LEGACY-hash account verifies faster than a new-format
// one — that only exists in dev/demo; real mode only ever creates new-format
// hashes.

const crypto = require('crypto');

const CURRENT_PARAMS = Object.freeze({ N: 131072, r: 8, p: 1, keyLen: 32 });
const MAXMEM = 256 * 1024 * 1024;
const MAX_PASSWORD_LENGTH = 500;
// Anything longer than this is not a plausible password; refuse before hashing
// so an oversized login body can never be used to burn CPU.
const MAX_VERIFY_LENGTH = 1024;

const HASH_RE = /^scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([0-9a-f]{32})\$([0-9a-f]{64})$/;
const LEGACY_HASH_RE = /^[0-9a-f]{64}$/;
const SALT_HEX_RE = /^[0-9a-f]{32}$/;
const LEGACY_N = 16384;

// The published demo password (scripts/set-admin-password.js's former
// DEMO_PASSWORD). A real host must never accept it as a new password.
const KNOWN_DEMO_PASSWORDS = Object.freeze(['TEdemo!2026']);

function isPowerOfTwo(n) {
  return Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
}

function boundsOk(n, r, p) {
  return isPowerOfTwo(n) && n <= 1048576 &&
    Number.isInteger(r) && r >= 1 && r <= 32 &&
    Number.isInteger(p) && p >= 1 && p <= 16 &&
    128 * n * r <= MAXMEM;
}

// Internal strict parse — includes salt/key. Returns null for anything that is
// not a well-formed, in-bounds new-format hash.
function parseNewFormat(hash) {
  if (typeof hash !== 'string') return null;
  const m = HASH_RE.exec(hash);
  if (!m) return null;
  const n = Number(m[1]);
  const r = Number(m[2]);
  const p = Number(m[3]);
  if (!boundsOk(n, r, p)) return null;
  return { n, r, p, saltHex: m[4], keyHex: m[5] };
}

/**
 * Parameters of a stored hash, or null when it is not a recognised/in-bounds
 * hash. `format` is 'scrypt' (self-describing) or 'legacy' (bare 64-hex).
 */
function parseHashParams(hash) {
  const parsed = parseNewFormat(hash);
  if (parsed) return { format: 'scrypt', n: parsed.n, r: parsed.r, p: parsed.p };
  if (typeof hash === 'string' && LEGACY_HASH_RE.test(hash)) {
    return { format: 'legacy', n: LEGACY_N, r: 8, p: 1 };
  }
  return null;
}

function scryptAsync(password, salt, keyLen, opts) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

function equalKeys(a, b) {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// [security] WR-02 (Phase 10 review): the lazy rehash is an UPGRADE path only.
// A stored hash is rewritten at CURRENT_PARAMS only when it is weaker in at
// least one cost dimension (N, r or p below current) AND stronger in none — a
// hash produced by a later cost bump that was then rolled back, or hand-tuned
// on a host (N=262144), must never be silently downgraded on the next sign-in.
// A mixed hash (one dimension above, one below) is left as it is: rewriting it
// would lower at least one dimension, and "never downgrade" wins over "match
// the current format". Legacy bare-hex hashes (N=16384, see header) always
// rehash. Timing note: until that first successful sign-in a legacy account
// verifies ~8x faster than dummyVerify(), so its existence is timing-
// distinguishable — accepted for dev/demo only; real mode never creates
// legacy hashes and locks down any copied demo account (D-10-08b).
function isWeakerThanCurrent({ n, r, p }) {
  const below = n < CURRENT_PARAMS.N || r < CURRENT_PARAMS.r || p < CURRENT_PARAMS.p;
  const above = n > CURRENT_PARAMS.N || r > CURRENT_PARAMS.r || p > CURRENT_PARAMS.p;
  return below && !above;
}

// Resolve what kind of stored credential `account` carries, and the derivation
// to run. Returns null when the account cannot be verified at all.
function planVerify(account) {
  if (!account || typeof account.hash !== 'string') return null;
  const parsed = parseNewFormat(account.hash);
  if (parsed) {
    const needsRehash = isWeakerThanCurrent(parsed);
    return {
      salt: Buffer.from(parsed.saltHex, 'hex'),
      expected: Buffer.from(parsed.keyHex, 'hex'),
      opts: { N: parsed.n, r: parsed.r, p: parsed.p, maxmem: MAXMEM },
      needsRehash,
    };
  }
  if (LEGACY_HASH_RE.test(account.hash) && typeof account.salt === 'string' && SALT_HEX_RE.test(account.salt)) {
    return {
      salt: Buffer.from(account.salt, 'hex'),
      expected: Buffer.from(account.hash, 'hex'),
      opts: { maxmem: MAXMEM }, // Node defaults N=16384, r=8, p=1
      needsRehash: true,
    };
  }
  return null;
}

const NOT_OK = Object.freeze({ ok: false, needsRehash: false });

/** Async verify. Never throws; malformed/oversized/out-of-bounds input is not-ok. */
async function verifyPassword(password, account) {
  try {
    const plan = planVerify(account);
    const pw = String(password === undefined || password === null ? '' : password);
    if (!plan || pw.length > MAX_VERIFY_LENGTH) return NOT_OK;
    const derived = await scryptAsync(pw, plan.salt, plan.expected.length, plan.opts);
    return equalKeys(derived, plan.expected) ? { ok: true, needsRehash: plan.needsRehash } : NOT_OK;
  } catch (e) {
    return NOT_OK;
  }
}

/** Synchronous twin of verifyPassword() for CLIs and tests. Never throws. */
function verifyPasswordSync(password, account) {
  try {
    const plan = planVerify(account);
    const pw = String(password === undefined || password === null ? '' : password);
    if (!plan || pw.length > MAX_VERIFY_LENGTH) return NOT_OK;
    const derived = crypto.scryptSync(pw, plan.salt, plan.expected.length, plan.opts);
    return equalKeys(derived, plan.expected) ? { ok: true, needsRehash: plan.needsRehash } : NOT_OK;
  } catch (e) {
    return NOT_OK;
  }
}

/** Hash `password` at CURRENT_PARAMS into the self-describing format. */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(password), salt, CURRENT_PARAMS.keyLen, {
    N: CURRENT_PARAMS.N, r: CURRENT_PARAMS.r, p: CURRENT_PARAMS.p, maxmem: MAXMEM,
  });
  return `scrypt$n=${CURRENT_PARAMS.N},r=${CURRENT_PARAMS.r},p=${CURRENT_PARAMS.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

const DUMMY_SALT = crypto.randomBytes(16);

/** One CURRENT_PARAMS derivation, result discarded — timing equalisation for
 * unknown / disabled accounts so they cost the same as a real verify. */
async function dummyVerify(password) {
  try {
    await scryptAsync(String(password === undefined || password === null ? '' : password).slice(0, MAX_VERIFY_LENGTH),
      DUMMY_SALT, CURRENT_PARAMS.keyLen,
      { N: CURRENT_PARAMS.N, r: CURRENT_PARAMS.r, p: CURRENT_PARAMS.p, maxmem: MAXMEM });
  } catch (e) { /* timing equaliser only */ }
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest();
}

/** Constant-time (per entry; no early exit) membership test against the
 * published demo password list. */
function isKnownDemoPassword(password) {
  const candidate = sha256(password === undefined || password === null ? '' : password);
  let hit = false;
  for (const known of KNOWN_DEMO_PASSWORDS) {
    if (crypto.timingSafeEqual(candidate, sha256(known))) hit = true;
  }
  return hit;
}

/**
 * Policy check for a NEW password. Returns an English error string, or null
 * when acceptable. Minimum length is 12 in real-deal mode (8 elsewhere, the
 * pre-Phase-10 rule), and a published demo password is refused in real mode.
 */
function checkNewPassword(password, { realMode } = {}) {
  if (typeof password !== 'string') return 'Password must be a string.';
  // Checked first so the published demo password gets its explicit message
  // even though it is also shorter than the real-mode minimum.
  if (realMode && isKnownDemoPassword(password)) {
    return 'That is a published demo password and cannot be used on a real-deal host.';
  }
  const min = realMode ? 12 : 8;
  if (password.length < min) return `New password must be at least ${min} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `New password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

// 54 characters, no 0/O/1/l/I and also none of S/Z/B (look-alikes of 5/2/8).
const TEMP_ALPHABET = 'ACDEFGHJKLMNPQRTUVWXYabcdefghijkmnopqrstuvwxyz23456789';

/** One-time temporary password: 20 characters from an unambiguous alphabet. */
function generateTempPassword() {
  let out = '';
  for (let i = 0; i < 20; i++) out += TEMP_ALPHABET[crypto.randomInt(TEMP_ALPHABET.length)];
  return out;
}

module.exports = {
  CURRENT_PARAMS,
  isWeakerThanCurrent,
  KNOWN_DEMO_PASSWORDS,
  TEMP_ALPHABET,
  hashPassword,
  verifyPassword,
  verifyPasswordSync,
  dummyVerify,
  isKnownDemoPassword,
  checkNewPassword,
  generateTempPassword,
  parseHashParams,
};
