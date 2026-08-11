---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-08-11T07:32:53.360Z
---

# Broken Windows Ledger

> Cross-phase defect register. With `workflow.windows_enforce` enabled, `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 9 | unrun-verify | public/execution.html |  | Manual two-tab browser walk on execution.html and org.html (delete flows) not performed in this browser-less autonomous run | open |  | 2026-08-11T07:32:44.436Z |  |
| 2 | 9 | deviation | public/js/org.js |  | Org flight-risk entries and both DD collections (request-items, findings) have no client-side delete UI in this codebase — server-side D-08 protection complete for all 7 routes, but only 4 of 7 client call sites exist to thread expectedVersion through | open |  | 2026-08-11T07:32:53.360Z |  |

````json
[
  {
    "id": 1,
    "kind": "unrun-verify",
    "phase": "9",
    "file": "public/execution.html",
    "line": null,
    "description": "Manual two-tab browser walk on execution.html and org.html (delete flows) not performed in this browser-less autonomous run",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-11T07:32:44.436Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "9",
    "file": "public/js/org.js",
    "line": null,
    "description": "Org flight-risk entries and both DD collections (request-items, findings) have no client-side delete UI in this codebase — server-side D-08 protection complete for all 7 routes, but only 4 of 7 client call sites exist to thread expectedVersion through",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-11T07:32:53.360Z",
    "resolved_at": null
  }
]
````
