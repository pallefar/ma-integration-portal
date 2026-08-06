#!/usr/bin/env bash
#
# Export the working SESSION state that git does not carry, so a new machine can
# resume Phase-N work instead of restarting it.
#
# The repo itself is deliberately self-sufficient: node_modules/ is committed
# (zero-install) and data/control.db + data/demo.db ship the seeded demo
# accounts, so `git clone` already yields a runnable app. What a clone does NOT
# carry is everything under $HOME that Claude Code and GSD accumulate:
#
#   ~/.claude/projects/<slug>/memory/   the per-project memory files
#   ~/.claude/CLAUDE.md                 global instructions (declares CARL)
#   ~/.carl/                            the CARL rule set CLAUDE.md points at
#   ~/.claude/gsd-core/                 GSD workflows + gsd-tools.cjs
#   ~/.claude/agents/                   gsd-* subagent definitions
#   ~/.claude/skills/gsd-*              the /gsd-* commands themselves
#
# MNPI RULE (PROJECT.md — clean-room segregation is a legal control, not a
# feature): data/deals/, data/runtime.db* and data/audit.db* hold real deal
# material, session tokens and compliance history. They are EXCLUDED by default
# and require an explicit, confirmed opt-in. They also do not need to travel —
# db/dbFiles.js:80 mkdirSync's them and db/store.js:178 uses CREATE TABLE IF NOT
# EXISTS, so all three auto-create empty on first boot.
#
# Usage:
#   scripts/export-session-state.sh <output.tar.gz>
#   scripts/export-session-state.sh ~/session.tar.gz --force
#   scripts/export-session-state.sh ~/session.tar.gz --include-deal-data   (MNPI!)
#
# Restore on the far side with scripts/bootstrap-session.sh.

set -euo pipefail

# --- argument parsing --------------------------------------------------------

OUT=""
INCLUDE_DEAL_DATA=0
FORCE=0
ASSUME_YES=0

usage() {
  sed -n '2,30p' "$0" | sed 's/^#//; s/^ //'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --include-deal-data) INCLUDE_DEAL_DATA=1 ;;
    --force)             FORCE=1 ;;
    --yes|-y)            ASSUME_YES=1 ;;
    -h|--help)           usage 0 ;;
    -*)                  echo "ERROR: unknown flag '$1'" >&2; usage 1 ;;
    *)
      if [ -n "$OUT" ]; then echo "ERROR: output path given twice ('$OUT', '$1')" >&2; exit 1; fi
      OUT="$1"
      ;;
  esac
  shift
done

if [ -z "$OUT" ]; then
  echo "ERROR: no output path given." >&2
  echo "Usage: scripts/export-session-state.sh <output.tar.gz> [--include-deal-data] [--force] [--yes]" >&2
  exit 1
fi

case "$OUT" in
  *.tar.gz|*.tgz) ;;
  *) echo "ERROR: output must end in .tar.gz or .tgz (got '$OUT')" >&2; exit 1 ;;
esac

if [ -e "$OUT" ] && [ "$FORCE" -ne 1 ]; then
  echo "ERROR: '$OUT' already exists. Re-run with --force to replace it." >&2
  exit 1
fi

# --- locate the repo and the session directories -----------------------------

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/.." && git rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$REPO_ROOT" ]; then
  echo "ERROR: not inside a git repository — cannot determine the project root." >&2
  exit 1
fi

CLAUDE_HOME="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CARL_HOME="$HOME/.carl"

# Claude Code derives the per-project directory name from the project's absolute
# path by replacing every character outside [a-zA-Z0-9.] with '-'. Dots survive.
#   /Users/karstenhaldan/M&A  ->  -Users-karstenhaldan-M-A
# Computed, never hardcoded, so this works from any clone location.
slugify_path() {
  printf '%s' "$1" | sed 's/[^a-zA-Z0-9.]/-/g'
}

PROJECT_SLUG=$(slugify_path "$REPO_ROOT")
MEMORY_DIR="$CLAUDE_HOME/projects/$PROJECT_SLUG/memory"

# The memory directory is the entire point of this bundle. Its absence means we
# resolved the wrong path (or there is genuinely nothing to carry) — either way
# that is a hard stop, not a warning to scroll past.
if [ ! -d "$MEMORY_DIR" ]; then
  echo "ERROR: no memory directory at:" >&2
  echo "         $MEMORY_DIR" >&2
  echo "       Derived from repo root: $REPO_ROOT" >&2
  echo "       (project slug: $PROJECT_SLUG)" >&2
  echo "       Nothing to export — refusing to write a bundle without session memory." >&2
  exit 1
fi

# --- MNPI opt-in gate --------------------------------------------------------

DEAL_DATA_PATHS=""
if [ "$INCLUDE_DEAL_DATA" -eq 1 ]; then
  for p in "$REPO_ROOT/data/deals" "$REPO_ROOT/data/runtime.db" "$REPO_ROOT/data/audit.db"; do
    [ -e "$p" ] && DEAL_DATA_PATHS="$DEAL_DATA_PATHS $p"
  done

  echo ""
  echo "  ############################################################"
  echo "  #                  MNPI WARNING  --  READ                  #"
  echo "  ############################################################"
  echo ""
  echo "  --include-deal-data was passed. This bundle will contain LIVE"
  echo "  DEAL DATA that is gitignored precisely because it must not be"
  echo "  copied around casually:"
  echo ""
  echo "    data/deals/      real acquisition workspaces (target names,"
  echo "                     valuations, retention lists, org designs)"
  echo "    data/runtime.db  live session tokens and secret settings"
  echo "    data/audit.db    the append-only compliance history"
  echo ""
  if [ -n "$DEAL_DATA_PATHS" ]; then
    echo "  Present on this machine and about to be bundled:"
    for p in $DEAL_DATA_PATHS; do echo "    - ${p#$REPO_ROOT/}"; done
  else
    echo "  (none of these currently exist on this machine)"
  fi
  echo ""
  echo "  The resulting archive is UNENCRYPTED. Treat it as MNPI: move it"
  echo "  over an encrypted channel, put it on an encrypted volume, and"
  echo "  delete it from both machines once the restore is done."
  echo ""
  echo "  ############################################################"
  echo ""

  if [ "$ASSUME_YES" -ne 1 ]; then
    printf "  Type EXACTLY 'include mnpi' to proceed: "
    read -r CONFIRM || CONFIRM=""
    if [ "$CONFIRM" != "include mnpi" ]; then
      echo "  Aborted — deal data NOT exported." >&2
      exit 1
    fi
  fi
fi

# --- staging -----------------------------------------------------------------

STAGE=$(mktemp -d "${TMPDIR:-/tmp}/ma-session-export-XXXXXX")
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT INT TERM

BUNDLE="$STAGE/ma-session-state"
mkdir -p "$BUNDLE"

# Records what actually made it in, so MANIFEST.txt reflects reality rather than
# intent and the restore side can tell "absent" from "forgotten".
MANIFEST_LINES=""
note() { MANIFEST_LINES="${MANIFEST_LINES}$1
"; }

copy_dir() {
  # copy_dir <label> <src> <dest-name>
  if [ -d "$2" ]; then
    mkdir -p "$BUNDLE/$3"
    # -R keeps it portable across BSD (macOS) and GNU cp.
    cp -R "$2/." "$BUNDLE/$3/"
    _n=$(find "$BUNDLE/$3" -type f | wc -l | tr -d ' ')
    echo "  + $1 ($_n files)"
    note "$1: present ($_n files) <- $2"
  else
    echo "  - $1 (absent, skipped)"
    note "$1: ABSENT on source machine <- $2"
  fi
}

copy_file() {
  # copy_file <label> <src> <dest-name>
  if [ -f "$2" ]; then
    mkdir -p "$(dirname "$BUNDLE/$3")"
    cp "$2" "$BUNDLE/$3"
    echo "  + $1"
    note "$1: present <- $2"
  else
    echo "  - $1 (absent, skipped)"
    note "$1: ABSENT on source machine <- $2"
  fi
}

echo ""
echo "Exporting session state"
echo "  repo root:    $REPO_ROOT"
echo "  project slug: $PROJECT_SLUG"
echo ""

copy_dir  "memory"          "$MEMORY_DIR"                "memory"
copy_file "global CLAUDE.md" "$CLAUDE_HOME/CLAUDE.md"    "claude-global/CLAUDE.md"
copy_dir  "CARL rules"      "$CARL_HOME"                 "carl"
copy_dir  "gsd-core"        "$CLAUDE_HOME/gsd-core"      "gsd-core"
copy_dir  "gsd agents"      "$CLAUDE_HOME/agents"        "agents"

# Only the gsd-* skills — the rest of ~/.claude/skills belongs to unrelated
# plugins that the new machine will install on its own.
if [ -d "$CLAUDE_HOME/skills" ]; then
  mkdir -p "$BUNDLE/skills"
  _skill_count=0
  for d in "$CLAUDE_HOME"/skills/gsd-*; do
    [ -d "$d" ] || continue
    cp -R "$d" "$BUNDLE/skills/"
    _skill_count=$((_skill_count + 1))
  done
  echo "  + gsd skills ($_skill_count)"
  note "gsd skills: present ($_skill_count) <- $CLAUDE_HOME/skills/gsd-*"
else
  echo "  - gsd skills (absent, skipped)"
  note "gsd skills: ABSENT on source machine"
fi

if [ "$INCLUDE_DEAL_DATA" -eq 1 ] && [ -n "$DEAL_DATA_PATHS" ]; then
  mkdir -p "$BUNDLE/deal-data"
  for p in $DEAL_DATA_PATHS; do
    cp -R "$p" "$BUNDLE/deal-data/"
  done
  echo "  + deal data (MNPI — opted in)"
  note "deal data: INCLUDED (MNPI opt-in)"
else
  note "deal data: excluded (default — MNPI stays on the source machine)"
fi

# --- manifest ----------------------------------------------------------------

GSD_VERSION="unknown"
[ -f "$CLAUDE_HOME/gsd-core/VERSION" ] && GSD_VERSION=$(cat "$CLAUDE_HOME/gsd-core/VERSION")

GIT_REMOTE=$(git -C "$REPO_ROOT" config --get remote.origin.url 2>/dev/null || echo "none")
GIT_COMMIT=$(git -C "$REPO_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
GIT_DIRTY="clean"
[ -n "$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null)" ] && GIT_DIRTY="DIRTY (uncommitted changes not in this bundle)"

{
  echo "M&A Integration Portal — session state bundle"
  echo "============================================="
  echo ""
  echo "created:        $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "source host:    $(hostname)"
  echo "source repo:    $REPO_ROOT"
  echo "project slug:   $PROJECT_SLUG"
  echo "gsd-core:       $GSD_VERSION"
  echo ""
  echo "git remote:     $GIT_REMOTE"
  echo "git branch:     $GIT_BRANCH"
  echo "git commit:     $GIT_COMMIT"
  echo "git state:      $GIT_DIRTY"
  echo ""
  echo "contents"
  echo "--------"
  printf '%s' "$MANIFEST_LINES"
  echo ""
  echo "restore"
  echo "-------"
  echo "  scripts/bootstrap-session.sh <this-archive>"
  echo ""
  echo "The memory directory is restored to a path COMPUTED from the new"
  echo "machine's clone location, so a different username or directory is fine."
} > "$BUNDLE/MANIFEST.txt"

# --- archive -----------------------------------------------------------------

OUT_DIR=$(cd "$(dirname "$OUT")" 2>/dev/null && pwd || true)
if [ -z "$OUT_DIR" ]; then
  echo "ERROR: output directory '$(dirname "$OUT")' does not exist." >&2
  exit 1
fi
OUT_ABS="$OUT_DIR/$(basename "$OUT")"

# Write to a sibling temp then rename, so an interrupted run never leaves a
# half-written archive that looks complete. COPYFILE_DISABLE stops macOS bsdtar
# from injecting ._* AppleDouble entries.
TMP_OUT="$OUT_ABS.partial.$$"
COPYFILE_DISABLE=1 tar -czf "$TMP_OUT" -C "$STAGE" ma-session-state
mv "$TMP_OUT" "$OUT_ABS"

SIZE=$(du -h "$OUT_ABS" | cut -f1 | tr -d ' ')

echo ""
echo "Bundle written: $OUT_ABS ($SIZE)"
if [ "$INCLUDE_DEAL_DATA" -eq 1 ] && [ -n "$DEAL_DATA_PATHS" ]; then
  echo ""
  echo "  *** This archive contains MNPI. Encrypted transfer only; delete it"
  echo "      from both machines once the restore is confirmed. ***"
fi
echo ""
echo "On the new machine:"
echo "  git clone $GIT_REMOTE"
echo "  cd \"\$(basename \"$REPO_ROOT\")\" && scripts/bootstrap-session.sh <archive>"
echo ""
