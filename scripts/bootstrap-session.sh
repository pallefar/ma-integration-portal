#!/usr/bin/env bash
#
# Restore a session bundle on a NEW machine and prove the result works.
#
# Counterpart to scripts/export-session-state.sh. The repo half of the move is
# just `git clone` (node_modules/ is committed, and data/control.db ships the
# seeded demo accounts, so there is no npm install and no migration step). This
# script restores the half that git does not carry — the Claude Code memory
# files, CARL rules, and the GSD toolchain — and then verifies the machine
# actually runs the app rather than assuming it does.
#
# The memory directory name is derived from the project's ABSOLUTE PATH, so it
# differs per machine. This script computes it from wherever the clone actually
# lives; a different username or directory is handled automatically.
#
# Nothing is ever silently overwritten: anything already present is moved aside
# to <path>.pre-bootstrap-<timestamp> first, and a newer gsd-core is never
# downgraded.
#
# Usage:
#   scripts/bootstrap-session.sh <archive.tar.gz>
#   scripts/bootstrap-session.sh <archive.tar.gz> --dry-run
#   scripts/bootstrap-session.sh <archive.tar.gz> --repo-dir ~/code/M&A
#   scripts/bootstrap-session.sh <archive.tar.gz> --skip-proofs
#
# Honours $HOME and $CLAUDE_CONFIG_DIR, so it can be rehearsed against a
# throwaway HOME without touching the real one.

set -euo pipefail

# --- argument parsing --------------------------------------------------------

ARCHIVE=""
REPO_DIR=""
DRY_RUN=0
SKIP_PROOFS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)     DRY_RUN=1 ;;
    --skip-proofs) SKIP_PROOFS=1 ;;
    --repo-dir)    shift; REPO_DIR="${1:-}"; [ -n "$REPO_DIR" ] || { echo "ERROR: --repo-dir needs a path" >&2; exit 1; } ;;
    -h|--help)     sed -n '2,30p' "$0" | sed 's/^#//; s/^ //'; exit 0 ;;
    -*)            echo "ERROR: unknown flag '$1'" >&2; exit 1 ;;
    *)
      if [ -n "$ARCHIVE" ]; then echo "ERROR: archive given twice ('$ARCHIVE', '$1')" >&2; exit 1; fi
      ARCHIVE="$1"
      ;;
  esac
  shift
done

if [ -z "$ARCHIVE" ]; then
  echo "ERROR: no archive given." >&2
  echo "Usage: scripts/bootstrap-session.sh <archive.tar.gz> [--dry-run] [--repo-dir <path>] [--skip-proofs]" >&2
  exit 1
fi
[ -f "$ARCHIVE" ] || { echo "ERROR: archive not found: $ARCHIVE" >&2; exit 1; }
ARCHIVE=$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")

STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
step() { echo ""; echo "── $* ────────────────────────────────────────────" ; }
act()  { if [ "$DRY_RUN" -eq 1 ]; then echo "  [dry-run] $*"; else echo "  $*"; fi }
die()  { echo "" >&2; echo "FATAL: $*" >&2; exit 1; }

if [ "$DRY_RUN" -eq 1 ]; then
  echo ""
  echo "DRY RUN — no files will be written, no proofs will be run."
fi

# --- 1. preflight ------------------------------------------------------------

step "1/6  Preflight"

command -v git  >/dev/null 2>&1 || die "git is not installed."
command -v tar  >/dev/null 2>&1 || die "tar is not installed."
command -v node >/dev/null 2>&1 || die "node is not installed. This project needs Node >= 22."

NODE_RAW=$(node -v)                      # e.g. v22.18.0
NODE_MAJOR=$(printf '%s' "$NODE_RAW" | sed 's/^v//; s/\..*//')
case "$NODE_MAJOR" in
  ''|*[!0-9]*) die "could not parse the node version from '$NODE_RAW'." ;;
esac
[ "$NODE_MAJOR" -ge 22 ] || die "Node $NODE_RAW found, but package.json requires >= 22."
echo "  node $NODE_RAW (>= 22 required)         ok"
echo "  git  $(git --version | awk '{print $3}')                        ok"

command -v curl >/dev/null 2>&1 && HAVE_CURL=1 || HAVE_CURL=0
[ "$HAVE_CURL" -eq 1 ] || echo "  curl missing — the /healthz proof will use node instead"

# --- 2. read the bundle manifest --------------------------------------------

step "2/6  Reading bundle"

TMP=$(mktemp -d "${TMPDIR:-/tmp}/ma-session-restore-XXXXXX")
cleanup_tmp() { rm -rf "$TMP"; }
trap cleanup_tmp EXIT INT TERM

tar -xzf "$ARCHIVE" -C "$TMP" || die "could not extract '$ARCHIVE'."
SRC="$TMP/ma-session-state"
[ -d "$SRC" ] || die "'$ARCHIVE' is not a session bundle (no ma-session-state/ inside)."
[ -f "$SRC/MANIFEST.txt" ] || die "bundle is missing MANIFEST.txt — refusing to restore a partial archive."

BUNDLE_REMOTE=$(sed -n 's/^git remote: *//p' "$SRC/MANIFEST.txt" | head -1)
BUNDLE_COMMIT=$(sed -n 's/^git commit: *//p' "$SRC/MANIFEST.txt" | head -1)
BUNDLE_GSD=$(sed -n 's/^gsd-core: *//p' "$SRC/MANIFEST.txt" | head -1)

echo "  archive:   $ARCHIVE"
echo "  from:      $(sed -n 's/^source host: *//p' "$SRC/MANIFEST.txt" | head -1)"
echo "  created:   $(sed -n 's/^created: *//p' "$SRC/MANIFEST.txt" | head -1)"
echo "  gsd-core:  ${BUNDLE_GSD:-unknown}"
echo "  git commit:${BUNDLE_COMMIT:+ $BUNDLE_COMMIT}"

if [ -d "$SRC/deal-data" ]; then
  echo ""
  echo "  *** This bundle contains MNPI deal data. It will be restored into"
  echo "      data/. Delete the archive from both machines afterwards. ***"
fi

# --- 3. locate or clone the repo --------------------------------------------

step "3/6  Locating the repo"

if [ -z "$REPO_DIR" ]; then
  SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
  REPO_DIR=$(cd "$SCRIPT_DIR/.." && git rev-parse --show-toplevel 2>/dev/null || true)
fi

if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR/.git" ]; then
  if [ -z "$BUNDLE_REMOTE" ] || [ "$BUNDLE_REMOTE" = "none" ]; then
    die "no repo found and the bundle records no git remote. Clone manually, then re-run with --repo-dir."
  fi
  TARGET="${REPO_DIR:-$PWD/ma-integration-portal}"
  act "git clone $BUNDLE_REMOTE $TARGET"
  if [ "$DRY_RUN" -eq 0 ]; then
    git clone "$BUNDLE_REMOTE" "$TARGET" || die "clone failed."
    REPO_DIR="$TARGET"
  fi
fi

REPO_DIR=$(cd "$REPO_DIR" 2>/dev/null && pwd || echo "$REPO_DIR")
echo "  repo: $REPO_DIR"

if [ "$DRY_RUN" -eq 0 ] && [ -f "$REPO_DIR/package.json" ]; then
  grep -q '"te-ma-integration-portal"' "$REPO_DIR/package.json" \
    || die "'$REPO_DIR' does not look like the M&A portal (package.json name mismatch)."
fi

# --- 4. restore session state ------------------------------------------------

step "4/6  Restoring session state"

CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CARL_HOME="$HOME/.carl"

# Same derivation Claude Code uses: every character outside [a-zA-Z0-9.] becomes
# '-'. Computed from THIS machine's clone path, which is the whole point —
# a different username or directory resolves to a different, correct slug.
slugify_path() {
  printf '%s' "$1" | sed 's/[^a-zA-Z0-9.]/-/g'
}

PROJECT_SLUG=$(slugify_path "$REPO_DIR")
MEMORY_DEST="$CLAUDE_HOME/projects/$PROJECT_SLUG/memory"

echo "  HOME:         $HOME"
echo "  project slug: $PROJECT_SLUG"
echo "  memory ->     $MEMORY_DEST"
echo ""

# Move anything already there out of the way rather than merging into it — a
# half-overwritten memory directory is worse than either state on its own.
backup_if_present() {
  if [ -e "$1" ]; then
    act "backup: $1 -> $1.pre-bootstrap-$STAMP"
    # if/fi, NOT `[ ... ] && mv`: a false && list as a function's LAST command
    # makes the function return 1, and `set -e` then kills the caller. That is
    # exactly what silently truncated the first --dry-run at the first backup.
    if [ "$DRY_RUN" -eq 0 ]; then
      mv "$1" "$1.pre-bootstrap-$STAMP"
    fi
  fi
}

restore_dir() {
  # restore_dir <label> <src> <dest>
  if [ ! -d "$2" ]; then
    echo "  - $1 (not in bundle, skipped)"
    return 0
  fi
  backup_if_present "$3"
  act "restore $1 -> $3"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$(dirname "$3")"
    cp -R "$2" "$3"
  fi
}

restore_dir "memory"     "$SRC/memory" "$MEMORY_DEST"
restore_dir "CARL rules" "$SRC/carl"   "$CARL_HOME"

# Global CLAUDE.md: back up an existing one rather than clobbering it — it may
# carry config for other projects on this machine.
if [ -f "$SRC/claude-global/CLAUDE.md" ]; then
  DEST="$CLAUDE_HOME/CLAUDE.md"
  if [ -f "$DEST" ] && cmp -s "$SRC/claude-global/CLAUDE.md" "$DEST"; then
    echo "  = global CLAUDE.md already identical, left alone"
  else
    backup_if_present "$DEST"
    act "restore global CLAUDE.md -> $DEST"
    if [ "$DRY_RUN" -eq 0 ]; then
      mkdir -p "$CLAUDE_HOME"
      cp "$SRC/claude-global/CLAUDE.md" "$DEST"
    fi
  fi
else
  echo "  - global CLAUDE.md (not in bundle, skipped)"
fi

# gsd-core: never downgrade. If the new machine already has a same-or-newer
# install, leave it — GSD self-updates and the bundle is only a floor.
if [ -d "$SRC/gsd-core" ]; then
  DEST="$CLAUDE_HOME/gsd-core"
  BUNDLED_V=$(cat "$SRC/gsd-core/VERSION" 2>/dev/null || echo "0")
  if [ -d "$DEST" ]; then
    LOCAL_V=$(cat "$DEST/VERSION" 2>/dev/null || echo "0")
    NEWEST=$(printf '%s\n%s\n' "$LOCAL_V" "$BUNDLED_V" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)
    if [ "$NEWEST" = "$LOCAL_V" ] && [ "$LOCAL_V" != "$BUNDLED_V" ]; then
      echo "  = gsd-core $LOCAL_V already installed (newer than bundled $BUNDLED_V) — left alone"
    elif [ "$LOCAL_V" = "$BUNDLED_V" ]; then
      echo "  = gsd-core $LOCAL_V already installed (same version) — left alone"
    else
      backup_if_present "$DEST"
      act "restore gsd-core $BUNDLED_V -> $DEST"
      [ "$DRY_RUN" -eq 0 ] && cp -R "$SRC/gsd-core" "$DEST"
    fi
  else
    act "restore gsd-core $BUNDLED_V -> $DEST"
    if [ "$DRY_RUN" -eq 0 ]; then mkdir -p "$CLAUDE_HOME"; cp -R "$SRC/gsd-core" "$DEST"; fi
  fi
else
  echo "  - gsd-core (not in bundle, skipped)"
fi

# Agents and skills merge in by name — unlike memory, these are a flat namespace
# shared with other tools, so replacing the whole directory would delete
# unrelated agents/skills this machine already has.
if [ -d "$SRC/agents" ]; then
  act "merge gsd agents -> $CLAUDE_HOME/agents/"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$CLAUDE_HOME/agents"
    cp -R "$SRC/agents/." "$CLAUDE_HOME/agents/"
  fi
else
  echo "  - gsd agents (not in bundle, skipped)"
fi

if [ -d "$SRC/skills" ]; then
  act "merge gsd skills -> $CLAUDE_HOME/skills/"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$CLAUDE_HOME/skills"
    cp -R "$SRC/skills/." "$CLAUDE_HOME/skills/"
  fi
else
  echo "  - gsd skills (not in bundle, skipped)"
fi

if [ -d "$SRC/deal-data" ]; then
  act "restore MNPI deal data -> $REPO_DIR/data/"
  if [ "$DRY_RUN" -eq 0 ]; then
    mkdir -p "$REPO_DIR/data"
    cp -R "$SRC/deal-data/." "$REPO_DIR/data/"
  fi
fi

# --- 5. proofs ---------------------------------------------------------------

step "5/6  Proving it works"

if [ "$DRY_RUN" -eq 1 ] || [ "$SKIP_PROOFS" -eq 1 ]; then
  echo "  skipped ($([ "$DRY_RUN" -eq 1 ] && echo "--dry-run" || echo "--skip-proofs"))"
else
  cd "$REPO_DIR"

  # 5a. The native binary is the one thing that genuinely differs per platform.
  # better-sqlite3 vendors 8 prebuilds; round-trip a real table rather than just
  # require()-ing, so a loadable-but-broken binary cannot pass.
  printf "  better-sqlite3 native binary ... "
  node -e "
    const D = require('better-sqlite3');
    const d = new D(':memory:');
    d.exec('CREATE TABLE t (a INTEGER)');
    d.prepare('INSERT INTO t VALUES (?)').run(42);
    const got = d.prepare('SELECT a FROM t').get().a;
    d.close();
    if (got !== 42) { console.error('round-trip mismatch'); process.exit(1); }
    console.log('ok (' + process.platform + '-' + process.arch + ')');
  " || die "better-sqlite3 failed to load on this platform. No prebuild for $(node -p 'process.platform+"-"+process.arch')?"

  # 5b. Full suite.
  printf "  test suite ................... "
  TEST_LOG="$TMP/test.log"
  if npm test > "$TEST_LOG" 2>&1; then
    PASS=$(sed -n 's/^# pass  *//p' "$TEST_LOG" | head -1)
    FAIL=$(sed -n 's/^# fail  *//p' "$TEST_LOG" | head -1)
    echo "ok (${PASS:-?} pass, ${FAIL:-?} fail)"
  else
    echo "FAILED"
    tail -30 "$TEST_LOG" >&2
    die "the test suite did not pass on this machine. Full log: $TEST_LOG"
  fi

  # 5c. Real boot. /healthz calls readDb(), so a 200 proves the SQLite path is
  # live end to end, not just that the process started.
  printf "  server boot + /healthz ....... "
  PROBE_PORT=$(node -e "
    const net = require('net');
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { console.log(s.address().port); s.close(); });
  ")
  PORT="$PROBE_PORT" node server.js > "$TMP/server.log" 2>&1 &
  SERVER_PID=$!
  stop_server() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; }
  trap 'stop_server; cleanup_tmp' EXIT INT TERM

  HEALTH=""
  i=0
  while [ "$i" -lt 40 ]; do
    if [ "$HAVE_CURL" -eq 1 ]; then
      HEALTH=$(curl -fsS "http://127.0.0.1:$PROBE_PORT/healthz" 2>/dev/null || true)
    else
      HEALTH=$(node -e "
        fetch('http://127.0.0.1:$PROBE_PORT/healthz')
          .then(r => r.text()).then(t => console.log(t)).catch(() => process.exit(1));
      " 2>/dev/null || true)
    fi
    case "$HEALTH" in *'"ok"'*) break ;; esac
    HEALTH=""
    i=$((i + 1))
    sleep 0.25
  done

  stop_server
  trap cleanup_tmp EXIT INT TERM

  if [ -n "$HEALTH" ]; then
    echo "ok (port $PROBE_PORT) $HEALTH"
  else
    echo "FAILED"
    tail -30 "$TMP/server.log" >&2
    die "the server did not answer /healthz within 10s."
  fi
fi

# --- 6. where the work stands ------------------------------------------------

step "6/6  Where GSD left off"

STATE="$REPO_DIR/.planning/STATE.md"
if [ -f "$STATE" ]; then
  PHASE=$(sed -n 's/^current_phase: *//p' "$STATE" | head -1)
  PHASE_NAME=$(sed -n 's/^current_phase_name: *//p' "$STATE" | head -1)
  PH_STATUS=$(sed -n 's/^status: *//p' "$STATE" | head -1)
  STOPPED=$(sed -n 's/^stopped_at: *//p' "$STATE" | head -1)
  echo "  Phase:   ${PHASE:-?} — ${PHASE_NAME:-?}"
  echo "  Status:  ${PH_STATUS:-?}"
  echo "  Last:    ${STOPPED:-?}"
else
  echo "  (.planning/STATE.md not found — is this the right repo?)"
fi

CHECKPOINT=$(ls "$REPO_DIR"/.planning/phases/*/[0-9]*-DISCUSS-CHECKPOINT.json 2>/dev/null | tail -1 || true)
if [ -n "$CHECKPOINT" ]; then
  DECIDED=$(grep -c '"id"' "$CHECKPOINT" 2>/dev/null | tr -d ' ' || echo 0)
  echo ""
  echo "  Open discussion checkpoint: ${CHECKPOINT#$REPO_DIR/}"
  echo "    $DECIDED decision(s) already locked — the discuss step resumes from these,"
  echo "    it does not re-ask them."
fi

cat <<EOF

────────────────────────────────────────────────────────────
Session restored.

  cd "$REPO_DIR"
  claude

Then pick the work back up with:

  /gsd-progress          show state and the recommended next action
  /gsd-plan-phase 5      continue Phase 5 from the locked decisions

App:  npm start   ->  http://localhost:3000
Demo: admin / karen / pmo / employee-demo   (password TEdemo!2026)
────────────────────────────────────────────────────────────
EOF
