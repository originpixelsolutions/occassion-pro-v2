# OccasionPro Build Log Protocol

The file `build-log.jsonl` in this folder is the source of truth for
`build-dashboard.html`. It is JSON Lines format — one build entry per line,
append-only.

## How it flows

1. Claude finishes an OccasionPro build unit.
2. Before printing the STATUS BLOCK in chat, Claude appends one JSON line to
   `build-log.jsonl`.
3. The dashboard polls this file every ~4 seconds via the File System Access API
   (one-time browser permission grant).
4. The new entry shows up in Overview, Version History, Checklist, and Log views
   automatically.

You never paste anything. You never type a build entry. You just open
`build-dashboard.html`, click **Connect log file**, choose `build-log.jsonl`,
and from that moment forward every unit Claude finishes lands on your screen by
itself.

## Entry schema (one JSON object per line)

```json
{
  "id": "b_xxxxxxxx",
  "version": 1,
  "timestamp": "2026-05-23T10:00:00.000Z",
  "phase": 1,
  "unit": "tenants_table",
  "migration": { "status": "Done", "file": "0001_tenants.sql" },
  "tests": { "passed": 6, "total": 6 },
  "rlsTests": { "passed": 4, "total": 4 },
  "ui": "Done",
  "committed": true,
  "gitSha": "9f8a2b1c",
  "whatWentWell": "clean RLS pair, no edge issues",
  "whatWentWrong": "nothing",
  "blockedBy": "none",
  "nextUnit": "tenant_users",
  "checklist": [
    { "label": "Foreign keys present", "status": "pass" },
    { "label": "Money cols numeric", "status": "pass" }
  ]
}
```

Enums:

- `migration.status` — `Done | Failed | Pending | NA`
- `ui` — `Done | In Progress | NA | Pending`
- `checklist[].status` — `pass | fail`

## Rules

- **Append only.** Never overwrite the file. Each line is independently
  parseable.
- **Stable id.** `id` should be unique and stable across reads — the dashboard
  dedupes by it.
- **Version auto-increments.** Claude reads the current max version from the
  file and adds 1.
- **One line per unit.** No multi-line JSON. Use a JSON minifier mentally.
- **Backup is automatic.** This file lives in your project folder, so your
  normal git/iCloud/Drive backup covers it. The dashboard also writes to its own
  shared storage as a secondary cache.

## Bootstrap

This file starts empty. The first build Claude logs will be v1.

## If something breaks

- Dashboard says "Connect failed: permission denied" → re-click Connect.
- Dashboard not updating → check the dashboard's sync indicator. If it shows the
  file name and a green dot, polling is live. If not, click Connect again.
- A line is malformed → the dashboard skips it silently and logs the parse error
  to the browser console. Fix it manually in this file or delete the line.
