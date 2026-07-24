---
status: testing
phase: 1-schema-migration
source: [01-VERIFICATION.md]
started: 2026-07-24T03:52:00Z
updated: 2026-07-24T03:52:00Z
---

## Current Test

number: 1
name: Windows release-zip bundle boots on SQLite
expected: |
  Unzip the Windows release bundle on a Windows host, run start.bat. The server starts,
  serves a page, and reads/writes through SQLite (data/ma-portal.db) with the correct
  better-sqlite3 win32 native binary — no db.json fallback, no missing-binary/node-gyp error.
awaiting: user response

## Tests

### 1. Windows release-zip bundle boots on SQLite
expected: Unzip Windows bundle on a Windows host, run start.bat → server starts, serves a page, SQLite active (win32 prebuilt binary), no db.json fallback, no node-gyp/missing-binary error.
result: [pending]

### 2. Linux any-OS bundle boots on SQLite
expected: Unzip the any-OS bundle on a Linux host, run node server.js (or the start.command-equivalent) → server starts, serves a page, SQLite active (linux prebuilt binary), no db.json fallback.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps

(none — both items are pre-approved deferred cross-platform boot checks; no code/test gaps found by verification. Do before the next release-zip cut.)
