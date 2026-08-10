---
status: testing
phase: 1-schema-migration
source: [01-VERIFICATION.md]
started: 2026-07-24T03:52:00Z
updated: 2026-08-10T08:40:00Z
---

## Current Test

number: 1
name: Windows release-zip bundle boots on SQLite
expected: |
  Unzip the Windows release bundle on a Windows host, run start.bat. The server starts,
  serves a page, and reads/writes through SQLite (data/ma-portal.db) with the correct
  better-sqlite3 win32 native binary — no db.json fallback, no missing-binary/node-gyp error.
awaiting: user confirmation at release cut (only remaining item; static evidence recorded below)

## Tests

### 1. Windows release-zip bundle boots on SQLite
expected: Unzip Windows bundle on a Windows host, run start.bat → server starts, serves a page, SQLite active (win32 prebuilt binary), no db.json fallback, no node-gyp/missing-binary error.
result: [pending — live boot needs a Windows host; STATIC VERIFICATION DONE 2026-08-10: better-sqlite3 prebuilds win32-x64.node (1,988,096 B) + win32-arm64.node (1,896,448 B) present; @napi-rs/canvas-win32-x64-msvc skia binding + icudtl.dat present; start.bat prefers bundled .\node\node.exe with system-Node fallback and install-guard. Bundle into the release-cut confirmation — run start.bat on a Windows machine against the v2.1.0 zip, or accept static evidence.]

### 2. Linux any-OS bundle boots on SQLite
expected: Unzip the any-OS bundle on a Linux host, run node server.js (or the start.command-equivalent) → server starts, serves a page, SQLite active (linux prebuilt binary), no db.json fallback.
result: PASSED 2026-08-10 (source: automated — Docker, evidence in session log + scratchpad/linux-boot-test2.sh). node:22-trixie linux/amd64 (Debian 13, glibc 2.41): server up ~2s, /healthz 200, /api/employees 200 with 5 rows served from SQLite (linux-x64 prebuild loaded), /api/projects 200, DEMO_OPEN [security] warning printed, graceful SIGTERM shutdown. ADDITIONAL: linux/arm64 boot also verified post-fix c5d0573 — server boots, all surfaces 200, PDF pack degrades to 503 JSON with one [portability] log line (skia binding not vendored for that platform; deliberate). CONSTRAINT DISCOVERED: better-sqlite3@13.0.1 linux prebuilds require glibc >= 2.38 — Debian 12/Ubuntu 22.04 fail to load; supported envelope is Ubuntu 24.04+/Debian 13+ glibc or musl. Must be stated in release notes.

## Summary

total: 2
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps

(none — item 1 is the sole remaining pre-approved deferred check, folded into the
release-cut confirmation. Item 2 closed with automated Docker evidence, including
the glibc >= 2.38 support-envelope constraint that must appear in release notes,
and the linux-arm64 graceful-degrade proof after fix c5d0573.)
