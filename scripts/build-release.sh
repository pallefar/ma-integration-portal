#!/usr/bin/env bash
#
# Reproducible release build for the TE Connectivity M&A Integration Portal.
#
#   scripts/build-release.sh <version> [--commit <sha>] [--node-from-release <tag>]
#                            [--out <dir>] [--prune-superseded]
#
#   <version>               semver, no leading "v" (e.g. 3.0.0-rc.1). MUST equal
#                           package.json "version" (the version is single-sourced).
#   --commit <sha>          must resolve to HEAD (the build refuses anything else:
#                           it archives the commit but runs checks against the tree).
#   --node-from-release T   GitHub release tag to take the portable Node binaries from
#                           (they are NOT in git). Default: the latest published
#                           non-draft, non-prerelease release.
#   --out <dir>             output directory, must be OUTSIDE the repository.
#                           Default: $HOME/ma-release/v<version>/
#   --prune-superseded      after a successful build also delete sibling v* build
#                           directories under the output's parent that contain only
#                           this tool's artifacts (zips / SHA256SUMS / MANIFEST.txt).
#
# What it produces (in --out):
#   ma-integration-portal-v<version>.zip          any OS (needs a system Node >= 22)
#   ma-integration-portal-v<version>-macos.zip    + node/bin/node (darwin-arm64, +x)
#   ma-integration-portal-v<version>-windows.zip  + node/node.exe (win-x64); .bat = CRLF
#   SHA256SUMS      sha256 of the three zips and MANIFEST.txt
#   MANIFEST.txt    commit, version, node versions + sha256, per-zip size / file
#                   count / sha256, the exclusion list, every check result
#
# How: `git archive` of the commit (tracked files only; node_modules/ is
# intentionally committed so `node server.js` needs no `npm install`) into a fresh,
# empty staging directory; remove what must not ship to operators; add the portable
# Node; zip deterministically (sorted names, normalised mtimes, no extra attrs).
# The bundled Node binaries are verified byte-for-byte against the official
# nodejs.org release (SHASUMS256.txt + the official archives). Staging and scratch
# directories are deleted on exit, success or failure; on any FAIL the artifacts
# written by this run are removed too.
#
# Requires: bash, git, zip, unzip, tar, curl, node (host, for PE inspection), gh
# (only to fetch the portable Node binaries), shasum or sha256sum.
# This script never runs `npm install`, never touches the network except GitHub
# (release assets) and nodejs.org (verification), and never writes inside the repo.

set -euo pipefail
export LC_ALL=C
export TZ=UTC
umask 022

# ---------------------------------------------------------------- reporting
PASS_N=0
FAIL_N=0
RESULTS=""          # newline-joined "PASS|FAIL  name  detail", written to MANIFEST
OUT_CREATED=""      # space-free list of artifacts written by THIS run (for cleanup)

pass() { PASS_N=$((PASS_N + 1)); printf 'PASS  %s\n' "$*"; RESULTS="${RESULTS}PASS  $*
"; }
fail() { FAIL_N=$((FAIL_N + 1)); printf 'FAIL  %s\n' "$*" >&2; RESULTS="${RESULTS}FAIL  $*
"; }
info() { printf 'INFO  %s\n' "$*"; RESULTS="${RESULTS}INFO  $*
"; }
die()  { printf 'FATAL %s\n' "$*" >&2; exit 2; }

usage() {
  sed -n '3,22p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-2}"
}

# ---------------------------------------------------------------- arguments
VERSION=""
COMMIT=""
NODE_TAG=""
OUT=""
PRUNE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --commit)             [ $# -ge 2 ] || usage; COMMIT="$2"; shift 2 ;;
    --node-from-release)  [ $# -ge 2 ] || usage; NODE_TAG="$2"; shift 2 ;;
    --out)                [ $# -ge 2 ] || usage; OUT="$2"; shift 2 ;;
    --prune-superseded)   PRUNE=1; shift ;;
    -h|--help)            usage 0 ;;
    -*)                   echo "unknown option: $1" >&2; usage ;;
    *)                    [ -z "$VERSION" ] || usage; VERSION="$1"; shift ;;
  esac
done
[ -n "$VERSION" ] || usage

case "$VERSION" in
  v*) die "version must not start with 'v' (got '$VERSION'); the tag is derived as v<version>" ;;
esac
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  die "version '$VERSION' is not semver (expected e.g. 3.0.0 or 3.0.0-rc.1)"
fi
TAG="v${VERSION}"

# ---------------------------------------------------------------- helpers
sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else sha256sum "$1" | awk '{print $1}'; fi
}
size_of() { wc -c < "$1" | tr -d ' '; }
count_files() { find "$1" \( -type f -o -type l \) | wc -l | tr -d ' '; }
touch_stamp() { # epoch -> [[CC]YY]MMDDhhmm[.SS] in UTC
  date -u -r "$1" +%Y%m%d%H%M.%S 2>/dev/null || date -u -d "@$1" +%Y%m%d%H%M.%S
}
need() { command -v "$1" >/dev/null 2>&1 || die "required tool not found on PATH: $1"; }

for t in git zip unzip tar curl node awk sed find sort; do need "$t"; done
{ command -v shasum >/dev/null 2>&1 || command -v sha256sum >/dev/null 2>&1; } || die "need shasum or sha256sum"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd -P)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
[ -n "$REPO_ROOT" ] || die "not inside a git work tree"
REPO_ROOT="$(cd "$REPO_ROOT" && pwd -P)"

# ---------------------------------------------------------------- preconditions
echo "== preconditions"

HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
if [ -n "$COMMIT" ]; then
  REQ_SHA="$(git -C "$REPO_ROOT" rev-parse --verify "${COMMIT}^{commit}" 2>/dev/null)" \
    || die "--commit '$COMMIT' is not a commit in this repository"
  [ "$REQ_SHA" = "$HEAD_SHA" ] || die "--commit $REQ_SHA is not HEAD ($HEAD_SHA); check it out first — the build refuses to archive a commit it did not check"
  COMMIT_SHA="$REQ_SHA"
else
  COMMIT_SHA="$HEAD_SHA"
fi
pass "commit is HEAD: $COMMIT_SHA"

DIRTY="$(git -C "$REPO_ROOT" status --porcelain)"
if [ -n "$DIRTY" ]; then
  printf '%s\n' "$DIRTY" | head -20 >&2
  die "working tree is dirty (modified or untracked files above) — a release is built from a clean, committed tree"
fi
pass "working tree clean"

PKG_VERSION="$(cd "$REPO_ROOT" && node -e 'process.stdout.write(String(require("./package.json").version))')"
if [ "$PKG_VERSION" != "$VERSION" ]; then
  die "package.json version is '$PKG_VERSION' but the build was asked for '$VERSION' (version is single-sourced in package.json)"
fi
pass "package.json version == $VERSION"

if [ -z "$OUT" ]; then OUT="${HOME}/ma-release/${TAG}"; fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd -P)"
case "$OUT/" in
  "$REPO_ROOT"/*) die "output directory $OUT is inside the repository — pick a path outside it" ;;
esac
pass "output directory is outside the repository"
echo "      $OUT"

ZIP_ANY="ma-integration-portal-${TAG}.zip"
ZIP_MAC="ma-integration-portal-${TAG}-macos.zip"
ZIP_WIN="ma-integration-portal-${TAG}-windows.zip"

# Superseded outputs of THIS version are removed first (REL-01: old builds must
# not linger). Staging below starts from an empty directory.
for f in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN" SHA256SUMS MANIFEST.txt; do
  if [ -e "$OUT/$f" ]; then rm -f "$OUT/$f"; echo "removed superseded $f from a previous build"; fi
done
rm -rf "$OUT"/.build-work.* 2>/dev/null || true

WORK="$(mktemp -d "$OUT/.build-work.XXXXXX")"
cleanup() {
  rc=$?
  rm -rf "$WORK"
  if [ "$rc" -ne 0 ] || [ "$FAIL_N" -gt 0 ]; then
    for f in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN" SHA256SUMS MANIFEST.txt; do rm -f "$OUT/$f"; done
    echo "build FAILED — partial artifacts removed from $OUT" >&2
  fi
}
trap cleanup EXIT

STAGE="$WORK/stage"     # fresh, empty staging root; deleted on exit
SCRATCH="$WORK/scratch" # downloads
mkdir -p "$STAGE" "$SCRATCH"
TREE="$STAGE/ma-integration-portal"

# ---------------------------------------------------------------- portable Node
echo "== portable Node binaries"
need gh
if [ -z "$NODE_TAG" ]; then
  NODE_TAG="$(cd "$REPO_ROOT" && gh release list --exclude-drafts --exclude-pre-releases --limit 1 --json tagName --jq '.[0].tagName')"
  [ -n "$NODE_TAG" ] || die "could not determine the latest release to take Node from; pass --node-from-release <tag>"
fi
info "taking portable Node binaries from release $NODE_TAG"

REL_DIR="$SCRATCH/release-assets"
mkdir -p "$REL_DIR"
(cd "$REPO_ROOT" && gh release download "$NODE_TAG" --pattern '*-macos.zip' --pattern '*-windows.zip' --dir "$REL_DIR") \
  || die "gh release download $NODE_TAG failed"

SRC_MAC_ZIP="$(find "$REL_DIR" -name '*-macos.zip' | head -1)"
SRC_WIN_ZIP="$(find "$REL_DIR" -name '*-windows.zip' | head -1)"
[ -n "$SRC_MAC_ZIP" ] && [ -n "$SRC_WIN_ZIP" ] || die "release $NODE_TAG has no macos/windows zip assets"

NODE_MAC="$SCRATCH/node-mac"; NODE_WIN="$SCRATCH/node-win"
mkdir -p "$NODE_MAC" "$NODE_WIN"
MAC_MEMBER="$(unzip -Z1 "$SRC_MAC_ZIP" | grep -E '/node/bin/node$' | head -1)"
WIN_MEMBER="$(unzip -Z1 "$SRC_WIN_ZIP" | grep -E '/node/node\.exe$' | head -1)"
[ -n "$MAC_MEMBER" ] || die "no node/bin/node inside $(basename "$SRC_MAC_ZIP")"
[ -n "$WIN_MEMBER" ] || die "no node/node.exe inside $(basename "$SRC_WIN_ZIP")"
unzip -p "$SRC_MAC_ZIP" "$MAC_MEMBER" > "$NODE_MAC/node"
unzip -p "$SRC_WIN_ZIP" "$WIN_MEMBER" > "$NODE_WIN/node.exe"
chmod 755 "$NODE_MAC/node"; chmod 644 "$NODE_WIN/node.exe"
rm -f "$SRC_MAC_ZIP" "$SRC_WIN_ZIP"   # free ~290 MB immediately

MAC_SHA="$(sha256_of "$NODE_MAC/node")"
WIN_SHA="$(sha256_of "$NODE_WIN/node.exe")"

# Container-format sanity: Mach-O arm64 / PE x64.
MAC_HDR="$(od -An -tx1 -N8 "$NODE_MAC/node" | tr -d ' \n')"
if [ "$MAC_HDR" = "cffaedfe0c000001" ]; then pass "macOS node is a 64-bit Mach-O arm64 binary"
else fail "macOS node header is $MAC_HDR (expected cffaedfe0c000001 = Mach-O arm64)"; fi

PE_PROBE="$SCRATCH/pe-probe.js"
cat > "$PE_PROBE" <<'EOF'
'use strict';
// Prints "<machine-hex> <FileVersion>" for a PE file; exit 1 when it is not a PE.
const fs = require('fs');
const b = fs.readFileSync(process.argv[2]);
if (b.length < 0x40 || b.toString('latin1', 0, 2) !== 'MZ') process.exit(1);
const pe = b.readUInt32LE(0x3c);
if (b.toString('latin1', pe, pe + 4) !== 'PE\u0000\u0000') process.exit(1);
const machine = b.readUInt16LE(pe + 4).toString(16);
const needle = Buffer.from('FileVersion', 'utf16le');
let version = '';
let i = b.indexOf(needle);
while (i !== -1 && !version) {
  let j = i + needle.length;
  while (j + 1 < b.length && b[j] === 0 && b[j + 1] === 0) j += 2;
  let k = j;
  while (k + 1 < b.length && !(b[k] === 0 && b[k + 1] === 0)) k += 2;
  const v = b.toString('utf16le', j, k);
  if (/^\d+\.\d+\.\d+/.test(v)) version = v;
  i = b.indexOf(needle, i + 1);
}
process.stdout.write(machine + ' ' + version);
EOF
PE_OUT="$(node "$PE_PROBE" "$NODE_WIN/node.exe" 2>/dev/null || true)"
PE_MACHINE="${PE_OUT%% *}"
WIN_VER_RAW="${PE_OUT#* }"
if [ "$PE_MACHINE" = "8664" ]; then pass "Windows node.exe is a PE x64 binary (MZ header, machine 0x8664)"
else fail "Windows node.exe is not a PE x64 binary (probe said '$PE_OUT')"; fi

MAC_VER=""
if MAC_VER_RAW="$("$NODE_MAC/node" --version 2>/dev/null)"; then MAC_VER="${MAC_VER_RAW#v}"; fi
WIN_VER="$WIN_VER_RAW"
[ -n "$WIN_VER" ] || WIN_VER="$MAC_VER"
[ -n "$MAC_VER" ] || MAC_VER="$WIN_VER"     # builder host cannot execute the darwin binary
[ -n "$MAC_VER" ] || die "could not determine the bundled Node version"
info "bundled Node: macOS v$MAC_VER (sha256 $MAC_SHA), Windows v$WIN_VER (sha256 $WIN_SHA)"

# Verify against nodejs.org: SHASUMS256.txt -> official archives -> extracted
# binaries must be byte-identical to the ones taken from the previous release.
verify_against_nodejs_org() { # label version archive-name member-in-archive bundled-binary bundled-sha kind
  label="$1"; ver="$2"; archive="$3"; member="$4"; bundled="$5"; bundled_sha="$6"; kind="$7"
  d="$SCRATCH/nodejs-org-$label"
  mkdir -p "$d"
  base="https://nodejs.org/dist/v${ver}"
  if ! curl -fsSL --retry 3 -o "$d/SHASUMS256.txt" "$base/SHASUMS256.txt"; then
    fail "nodejs.org SHASUMS256.txt for v$ver ($label) could not be downloaded"; return 0
  fi
  want="$(awk -v n="$archive" '$2==n {print $1}' "$d/SHASUMS256.txt")"
  if [ -z "$want" ]; then fail "SHASUMS256.txt for v$ver lists no $archive"; return 0; fi
  if ! curl -fsSL --retry 3 -o "$d/$archive" "$base/$archive"; then
    fail "official $archive could not be downloaded"; return 0
  fi
  got="$(sha256_of "$d/$archive")"
  if [ "$got" = "$want" ]; then pass "official $archive matches SHASUMS256.txt ($got)"
  else fail "official $archive sha256 $got != SHASUMS256.txt $want"; return 0; fi
  case "$kind" in
    tgz) tar -xzf "$d/$archive" -C "$d" "$member" ;;
    zip) unzip -q -o "$d/$archive" "$member" -d "$d" ;;
  esac
  official="$(sha256_of "$d/$member")"
  if [ "$official" = "$bundled_sha" ]; then
    pass "bundled $label node (v$ver) is byte-identical to the official nodejs.org binary ($bundled_sha)"
  else
    fail "bundled $label node sha256 $bundled_sha != official nodejs.org $official (v$ver) — STOP: do not ship"
  fi
  # Keep the official license text for the bundle (Node's license requires it).
  if [ "$label" = "macos" ]; then
    tar -xzf "$d/$archive" -C "$d" "node-v${ver}-darwin-arm64/LICENSE" 2>/dev/null \
      && cp "$d/node-v${ver}-darwin-arm64/LICENSE" "$SCRATCH/NODE-LICENSE" || true
  fi
  rm -f "$d/$archive"
}
verify_against_nodejs_org macos "$MAC_VER" "node-v${MAC_VER}-darwin-arm64.tar.gz" \
  "node-v${MAC_VER}-darwin-arm64/bin/node" "$NODE_MAC/node" "$MAC_SHA" tgz
verify_against_nodejs_org windows "$WIN_VER" "node-v${WIN_VER}-win-x64.zip" \
  "node-v${WIN_VER}-win-x64/node.exe" "$NODE_WIN/node.exe" "$WIN_SHA" zip
if [ "$FAIL_N" -gt 0 ]; then die "Node binary verification failed — see FAIL lines above"; fi

# ---------------------------------------------------------------- stage
echo "== staging (git archive of $COMMIT_SHA into an empty directory)"
[ -z "$(ls -A "$STAGE")" ] || die "staging directory is not empty"
git -C "$REPO_ROOT" archive --format=tar --prefix=ma-integration-portal/ "$COMMIT_SHA" | tar -x -C "$STAGE"
[ -d "$TREE" ] || die "git archive produced no ma-integration-portal/ tree"
ARCHIVE_FILES="$(count_files "$TREE")"
pass "git archive extracted ($ARCHIVE_FILES files incl. node_modules, before exclusions)"

# What must NOT ship to operators. Dirs end in "/". The list is written into
# MANIFEST.txt exactly as below.
EXCLUDE_PATHS="
.planning/
.claude/
.gsd/
.github/
.githooks/
.gitattributes
.gitignore
test/
scripts/uat/
scripts/perf/
scripts/smoke/
scripts/soak.js
scripts/test-gate.js
scripts/list-unvalidated-routes.js
scripts/bootstrap-session.sh
scripts/export-session-state.sh
scripts/build-release.sh
scripts/migrate-db-json-to-sqlite.js
scripts/split-db-into-control-demo-deals.js
db.json
data/ma-portal.db
"
# Why the two legacy databases go: grep of every runtime module shows the server
# opens only the explicit paths in db/dbFiles.js (demo.db / control.db / runtime.db
# / audit/* / deals/*). db/store.js keeps DEFAULT_DB_PATH = data/ma-portal.db as a
# no-argument fallback of initDb() that server.js never uses; db.json is read only
# by ragService.js behind an existsSync guard (its ragUploads is empty). Both are
# pre-Phase-1 frozen archives. The two scripts that need them as input go with them.
EXCLUDE_GLOBS_DESC="*.DS_Store, *.log, *.orig, *.rej, *.swp, *~ (files) and evidence/, walk-evidence/, screenshots/, __MACOSX/ (directories) anywhere outside node_modules/"

EXCLUSION_REPORT=""
for p in $EXCLUDE_PATHS; do
  target="$TREE/${p%/}"
  if [ -e "$target" ] || [ -L "$target" ]; then
    n="$(count_files "$target")"; [ -d "$target" ] || n=1
    rm -rf "$target"
    EXCLUSION_REPORT="${EXCLUSION_REPORT}  ${p}  (removed, ${n} files)
"
  else
    EXCLUSION_REPORT="${EXCLUSION_REPORT}  ${p}  (not in the archive: untracked or already export-ignored by .gitattributes)
"
  fi
done

GLOB_HITS="$SCRATCH/glob-hits.txt"
find "$TREE" -path "$TREE/node_modules" -prune -o \
  \( \( -type f \( -name .DS_Store -o -name '*.log' -o -name '*.orig' -o -name '*.rej' -o -name '*.swp' -o -name '*~' \) \) \
  -o \( -type d \( -name evidence -o -name walk-evidence -o -name screenshots -o -name __MACOSX \) \) \) -print > "$GLOB_HITS"
GLOB_N=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  rm -rf "$line"; GLOB_N=$((GLOB_N + 1))
  EXCLUSION_REPORT="${EXCLUSION_REPORT}  ${line#"$TREE"/}  (removed by pattern)
"
done < "$GLOB_HITS"
[ "$GLOB_N" -gt 0 ] || EXCLUSION_REPORT="${EXCLUSION_REPORT}  (pattern sweep: no matches)
"

LEFT=""
for p in $EXCLUDE_PATHS; do
  [ -e "$TREE/${p%/}" ] && LEFT="$LEFT $p"
done
if [ -z "$LEFT" ]; then pass "exclusion list applied; none of the excluded paths remain in the staging tree"
else fail "excluded paths still present:$LEFT"; fi

REQUIRED="server.js package.json package-lock.json start.command start.bat start-real-deal.command start-real-deal.bat
README.md DEPLOYMENT.md DEMO-RUNBOOK.md data/demo.db data/control.db public/index.html
public/sent_emails/comm_1783454326531.html scripts/bootstrap-admin.js scripts/set-admin-password.js
scripts/audit-verify.js scripts/audit-admin.js scripts/wal-checkpoint.js
node_modules/better-sqlite3/prebuilds/darwin-arm64.node node_modules/better-sqlite3/prebuilds/win32-x64.node
node_modules/express/package.json node_modules/sanitize-html/package.json"
MISSING=""
for p in $REQUIRED; do [ -e "$TREE/$p" ] || MISSING="$MISSING $p"; done
if [ -z "$MISSING" ]; then pass "required runtime files present"
else fail "required files missing from the staging tree:$MISSING"; fi

# Normalise: launchers executable, deterministic mtimes (commit time).
chmod 755 "$TREE/start.command" "$TREE/start-real-deal.command"
[ -f "$TREE/scripts/wal-checkpoint.js" ] && chmod 755 "$TREE/scripts/wal-checkpoint.js"
COMMIT_EPOCH="$(git -C "$REPO_ROOT" log -1 --format=%ct "$COMMIT_SHA")"
COMMIT_ISO="$(git -C "$REPO_ROOT" log -1 --format=%cI "$COMMIT_SHA")"
STAMP="$(touch_stamp "$COMMIT_EPOCH")"

# Windows batch files are shipped CRLF in every bundle (git stores them LF).
BAT_N=0
find "$TREE" -path "$TREE/node_modules" -prune -o -type f -name '*.bat' -print > "$SCRATCH/bat-files.txt"
while IFS= read -r bf; do
  [ -n "$bf" ] || continue
  awk '{ sub(/\r$/, ""); printf "%s\r\n", $0 }' "$bf" > "$bf.crlf" && mv "$bf.crlf" "$bf"
  BAT_N=$((BAT_N + 1))
done < "$SCRATCH/bat-files.txt"
info "converted $BAT_N .bat file(s) to CRLF in all bundles"

find "$TREE" -exec touch -h -t "$STAMP" {} +

# ---------------------------------------------------------------- zip
echo "== zipping (deterministic: sorted names, mtime=$COMMIT_ISO, zip -X)"
make_zip() { # zip-file
  zf="$OUT/$1"
  rm -f "$zf"
  (cd "$STAGE" && find ma-integration-portal \( -type f -o -type l \) -print | LC_ALL=C sort | zip -X -D -y -q -6 "$zf" -@)
  [ -s "$zf" ] || die "zip $1 was not produced"
}

make_zip "$ZIP_ANY"

mkdir -p "$TREE/node/bin"
cp "$NODE_MAC/node" "$TREE/node/bin/node"; chmod 755 "$TREE/node/bin/node"
[ -f "$SCRATCH/NODE-LICENSE" ] && cp "$SCRATCH/NODE-LICENSE" "$TREE/node/LICENSE"
find "$TREE/node" -exec touch -h -t "$STAMP" {} +
make_zip "$ZIP_MAC"
rm -rf "$TREE/node"

mkdir -p "$TREE/node"
cp "$NODE_WIN/node.exe" "$TREE/node/node.exe"; chmod 644 "$TREE/node/node.exe"
[ -f "$SCRATCH/NODE-LICENSE" ] && cp "$SCRATCH/NODE-LICENSE" "$TREE/node/LICENSE"
find "$TREE/node" -exec touch -h -t "$STAMP" {} +
make_zip "$ZIP_WIN"
rm -rf "$TREE/node"

# ---------------------------------------------------------------- verify the zips
echo "== verifying the zips"
for z in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN"; do
  if unzip -tq "$OUT/$z" >/dev/null 2>&1; then pass "$z passes unzip -t"
  else fail "$z fails unzip -t"; fi
done

# NB: no `grep -q` on the right of a pipe — under `set -o pipefail` an early grep
# exit SIGPIPEs unzip and the pipeline reports failure for a present member.
zip_has() { unzip -Z1 "$OUT/$1" | grep -Fx -e "$2" >/dev/null; }
zip_grep() { unzip -p "$OUT/$1" "$2" | grep -e "$3" >/dev/null; } # zip member pattern
zip_mode() { unzip -Z "$OUT/$1" "$2" 2>/dev/null | awk 'NR==1 {print $1}'; }

if zip_has "$ZIP_MAC" ma-integration-portal/node/bin/node; then
  m="$(zip_mode "$ZIP_MAC" ma-integration-portal/node/bin/node)"
  case "$m" in -rwx*) pass "macOS zip: node/bin/node present, exec bit preserved ($m)" ;; *) fail "macOS zip: node/bin/node mode is '$m'" ;; esac
  m="$(zip_mode "$ZIP_MAC" ma-integration-portal/start.command)"
  case "$m" in -rwx*) pass "macOS zip: start.command is executable ($m)" ;; *) fail "macOS zip: start.command mode is '$m'" ;; esac
  m="$(zip_mode "$ZIP_MAC" ma-integration-portal/start-real-deal.command)"
  case "$m" in -rwx*) pass "macOS zip: start-real-deal.command is executable ($m)" ;; *) fail "macOS zip: start-real-deal.command mode is '$m'" ;; esac
else fail "macOS zip has no node/bin/node"; fi

if zip_has "$ZIP_WIN" ma-integration-portal/node/node.exe; then pass "Windows zip: node/node.exe present"
else fail "Windows zip has no node/node.exe"; fi
if zip_has "$ZIP_ANY" ma-integration-portal/node/node.exe || zip_has "$ZIP_ANY" ma-integration-portal/node/bin/node; then
  fail "any-OS zip unexpectedly contains a bundled Node"
else pass "any-OS zip contains no bundled Node (uses the system Node)"; fi
if zip_has "$ZIP_MAC" ma-integration-portal/node/node.exe || zip_has "$ZIP_WIN" ma-integration-portal/node/bin/node; then
  fail "a platform zip carries the other platform's Node"
else pass "each platform zip carries only its own Node"; fi

# Every zip: launcher intent is intact (demo-open vs fail-closed real-deal).
for z in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN"; do
  if zip_grep "$z" ma-integration-portal/start.command '^export DEMO_OPEN=1' \
     && zip_grep "$z" ma-integration-portal/start-real-deal.command '^export MA_MODE=real' \
     && zip_grep "$z" ma-integration-portal/start-real-deal.command '^unset DEMO_OPEN'; then
    pass "$z: demo launcher sets DEMO_OPEN=1; real-deal launcher sets MA_MODE=real and clears DEMO_OPEN"
  else fail "$z: launcher environment lines are not as expected"; fi
done

# Windows static checks.
WIN_NODE_SIZE="$(unzip -Zl "$OUT/$ZIP_WIN" ma-integration-portal/node/node.exe | awk 'NR==1 {print $4}')"
if [ "${WIN_NODE_SIZE:-0}" -gt 50000000 ] && [ "${WIN_NODE_SIZE:-0}" -lt 200000000 ]; then
  pass "Windows zip: node.exe size plausible (${WIN_NODE_SIZE} bytes)"
else fail "Windows zip: node.exe size implausible (${WIN_NODE_SIZE:-?} bytes)"; fi
if [ "$(unzip -p "$OUT/$ZIP_WIN" ma-integration-portal/node/node.exe | head -c 2)" = "MZ" ]; then
  pass "Windows zip: node.exe starts with MZ"
else fail "Windows zip: node.exe does not start with MZ"; fi
for member in ma-integration-portal/node_modules/better-sqlite3/prebuilds/win32-x64.node \
              ma-integration-portal/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node; do
  if zip_has "$ZIP_WIN" "$member"; then
    if [ "$(unzip -p "$OUT/$ZIP_WIN" "$member" | head -c 2)" = "MZ" ]; then pass "Windows zip: ${member#ma-integration-portal/} present (PE)"
    else fail "Windows zip: ${member#ma-integration-portal/} is not a PE file"; fi
  else fail "Windows zip: ${member#ma-integration-portal/} missing"; fi
done
for bat in start.bat start-real-deal.bat; do
  if unzip -p "$OUT/$ZIP_WIN" "ma-integration-portal/$bat" \
     | awk 'BEGIN{n=0;c=0} {n++; if ($0 ~ /\r$/) c++} END{exit !(n>0 && n==c)}'; then
    pass "Windows zip: $bat is CRLF on every line"
  else fail "Windows zip: $bat is not CRLF throughout"; fi
done
if zip_grep "$ZIP_WIN" ma-integration-portal/start.bat 'if not exist "%~dp0node_modules"' \
   && zip_grep "$ZIP_WIN" ma-integration-portal/start.bat 'npm install --omit=dev' \
   && zip_grep "$ZIP_WIN" ma-integration-portal/start.bat 'node\\node.exe'; then
  pass "Windows zip: start.bat install-guard and bundled-node lookup intact"
else fail "Windows zip: start.bat install-guard / bundled-node lookup not found"; fi

# Longest path once extracted on a default Windows layout (MAX_PATH = 260 incl. NUL).
WIN_PREFIX_LEN=$(printf '%s' "C:\\Users\\XXXXXXXXXXXXXXXXXXXX\\Downloads\\ma-integration-portal-${TAG}-windows\\" | wc -c | tr -d ' ')
LONGEST="$(unzip -Z1 "$OUT/$ZIP_WIN" | awk '{ if (length($0) > m) { m = length($0); p = $0 } } END { print m "|" p }')"
LONGEST_LEN="${LONGEST%%|*}"
LONGEST_PATH="${LONGEST#*|}"
TOTAL_LEN=$((WIN_PREFIX_LEN + LONGEST_LEN))
if [ "$TOTAL_LEN" -lt 260 ]; then
  pass "Windows zip: longest extracted path is $TOTAL_LEN chars (< 260): ${LONGEST_PATH#ma-integration-portal/}"
else fail "Windows zip: longest extracted path is $TOTAL_LEN chars (>= 260): $LONGEST_PATH"; fi

# Largest single file (GitHub release assets are fine; repo/transport sanity).
BIG="$(unzip -Zl "$OUT/$ZIP_WIN" | awk '$1 ~ /^[-l]/ { if ($4 + 0 > m + 0) { m = $4; n = $NF } } END { print m "|" n }')"
BIG_SZ="${BIG%%|*}"; BIG_NAME="${BIG#*|}"
if [ "${BIG_SZ:-0}" -lt 104857600 ]; then pass "Windows zip: largest file is ${BIG_SZ} bytes (< 100 MB): ${BIG_NAME#ma-integration-portal/}"
else fail "Windows zip: ${BIG_NAME} is ${BIG_SZ} bytes (>= 100 MB)"; fi

# Hygiene: names that must never ship. node_modules hits are reported as INFO
# (vendored third-party fixtures), everything else is a FAIL.
HYG="$SCRATCH/hygiene"
mkdir -p "$HYG"
for z in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN"; do
  unzip -Z1 "$OUT/$z" > "$HYG/names.txt"
  hits="$(grep -E -i '^ma-integration-portal/(\.planning|\.claude|\.gsd|\.github|test)(/|$)|(^|/)\.env($|\.)|\.pem$|(^|/)id_rsa|(^|/)db\.json|-wal$|-shm$|\.sqlite3?$' "$HYG/names.txt" || true)"
  dbs="$(grep -E '\.db$' "$HYG/names.txt" | grep -v -E '^ma-integration-portal/data/(demo|control)\.db$' || true)"
  mails="$(grep -E '^ma-integration-portal/public/sent_emails/.' "$HYG/names.txt" | grep -v -F 'ma-integration-portal/public/sent_emails/comm_1783454326531.html' || true)"
  hits="$(printf '%s\n%s\n%s\n' "$hits" "$dbs" "$mails" | sed '/^$/d')"
  outside="$(printf '%s\n' "$hits" | grep -v '/node_modules/' | sed '/^$/d' || true)"
  inside="$(printf '%s\n' "$hits" | grep '/node_modules/' | sed '/^$/d' || true)"
  if [ -z "$outside" ]; then pass "$z: no secret/planning/legacy-database names outside node_modules"
  else fail "$z: forbidden names present: $(printf '%s' "$outside" | tr '\n' ' ')"; fi
  if [ -n "$inside" ]; then
    info "$z: $(printf '%s\n' "$inside" | wc -l | tr -d ' ') third-party name match(es) inside node_modules (vendored fixtures): $(printf '%s' "$inside" | head -5 | tr '\n' ' ')"
  fi
done

# Content scan of the staged (non-node_modules) text files.
if grep -rIl -E -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' --exclude-dir=node_modules "$TREE" >/dev/null 2>&1; then
  fail "a private-key header is present in a shipped, non-vendored file"
else pass "no private-key header in shipped, non-vendored files"; fi
HOME_HITS="$(grep -rIl -F -e "$HOME" --exclude-dir=node_modules "$TREE" 2>/dev/null | sed "s#^$TREE/##" | head -10 | tr '\n' ' ' || true)"
if [ -z "$HOME_HITS" ]; then pass "builder home path not found in shipped, non-vendored files"
else info "builder home path appears in: $HOME_HITS"; fi

# ---------------------------------------------------------------- manifest + sums
echo "== writing MANIFEST.txt and SHA256SUMS"
{
  echo "TE Connectivity M&A Integration Portal - release manifest"
  echo "========================================================="
  echo "version        : $VERSION   (tag $TAG, package.json $PKG_VERSION)"
  echo "commit         : $COMMIT_SHA"
  echo "commit date    : $COMMIT_ISO"
  echo "built from     : git archive --format=tar --prefix=ma-integration-portal/ (tracked files only)"
  echo "zip            : zip -X -D -y -6 over a byte-sorted file list; mtimes = commit time (reproducible)"
  echo "node source    : release $NODE_TAG (assets), verified against nodejs.org"
  echo
  echo "Bundled Node"
  echo "------------"
  echo "macOS    node/bin/node  v$MAC_VER  darwin-arm64  sha256 $MAC_SHA"
  echo "Windows  node/node.exe  v$WIN_VER  win-x64        sha256 $WIN_SHA"
  echo "Both are byte-identical to the official nodejs.org binaries (see checks below)."
  echo
  echo "Zips"
  echo "----"
  for z in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN"; do
    printf '%-52s %12s bytes  %6s files  sha256 %s\n' "$z" "$(size_of "$OUT/$z")" "$(unzip -Z1 "$OUT/$z" | wc -l | tr -d ' ')" "$(sha256_of "$OUT/$z")"
  done
  echo
  echo "Files in the git archive before exclusions: $ARCHIVE_FILES"
  echo
  echo "Exclusion list (removed from every bundle; not shipped to operators)"
  echo "---------------------------------------------------------------------"
  printf '%s' "$EXCLUSION_REPORT"
  echo "  pattern sweep: $EXCLUDE_GLOBS_DESC"
  echo
  echo "Normalisation: start.command / start-real-deal.command mode 755; *.bat converted LF -> CRLF."
  echo
  echo "Checks"
  echo "------"
  printf '%s' "$RESULTS"
  echo
  echo "Verify a download:  shasum -a 256 -c SHA256SUMS   (or: sha256sum -c SHA256SUMS)"
} > "$OUT/MANIFEST.txt"

(cd "$OUT" && for f in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN" MANIFEST.txt; do printf '%s  %s\n' "$(sha256_of "$f")" "$f"; done | LC_ALL=C sort -k2 > SHA256SUMS)
if (cd "$OUT" && { shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 || sha256sum -c SHA256SUMS >/dev/null 2>&1; }); then
  pass "SHA256SUMS verifies against the written artifacts"
else fail "SHA256SUMS does not verify"; fi

# ---------------------------------------------------------------- optional prune
if [ "$PRUNE" -eq 1 ]; then
  PARENT="$(dirname "$OUT")"
  for d in "$PARENT"/v[0-9]*; do
    [ -d "$d" ] || continue
    [ "$(cd "$d" && pwd -P)" = "$OUT" ] && continue
    other="$(find "$d" -mindepth 1 -maxdepth 1 ! -name 'ma-integration-portal-v*.zip' ! -name SHA256SUMS ! -name MANIFEST.txt | head -1)"
    if [ -n "$other" ]; then info "not pruning $d (contains files this tool did not write)"
    else rm -rf "$d"; info "pruned superseded build directory $d"; fi
  done
fi

# ---------------------------------------------------------------- summary
echo
echo "== summary"
for z in "$ZIP_ANY" "$ZIP_MAC" "$ZIP_WIN"; do
  printf '  %s  %s bytes  sha256 %s\n' "$OUT/$z" "$(size_of "$OUT/$z")" "$(sha256_of "$OUT/$z")"
done
echo "  $OUT/SHA256SUMS"
echo "  $OUT/MANIFEST.txt"
echo "staging and scratch directories are removed on exit."
if [ "$FAIL_N" -eq 0 ]; then
  echo "RESULT: PASS ($PASS_N checks passed)"
else
  echo "RESULT: FAIL ($FAIL_N failed, $PASS_N passed)" >&2
  exit 1
fi
