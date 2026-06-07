# Scheduled Tree Backup Design

**Date:** 2026-06-06
**Status:** Approved

## Problem

The family tree's entire content lives in a single `tree_data.data` JSONB blob in Supabase. The on-change `snapshot_tree_data` trigger keeps only the last 20 in-database snapshots (`supabase/schema.sql`), and the Supabase **free tier has no automatic database backups** and **pauses projects after ~1 week of inactivity**. So a careless or malicious family member making 20+ edits — or a lost/paused project — could destroy the tree with no recovery path. We need a free, off-site, versioned backup with a documented restore.

## Approach

A dedicated **private** GitHub repo runs a scheduled GitHub Actions workflow that logs into Supabase as the shared family user, exports `tree_data.data` to JSON, and commits it. Git history becomes the backup history: unlimited retention, off-site, human-readable diffs, free. Restore is a manual, owner-gated script that writes a chosen JSON revision back into `tree_data.data`.

### Why a separate private repo

`dzkaiten/family-chart` is **public** (verified: `gh repo view` → `"visibility":"PUBLIC"`). Committing real names, birthdays, and photo paths there would expose private family data. The backup repo is private, holds the Supabase secrets, and is the only place the data JSON lives. The public app repo is never touched by this feature. The workflow runs *inside* the backup repo and pulls from Supabase, so no cross-repo push tokens are needed.

## Repository layout (new private repo, e.g. `family-tree-backups`)

```
.github/workflows/backup.yml   # daily cron + manual dispatch
scripts/lib/supabase.mjs       # shared: login, getTreeData, patchTreeData, stableStringify, sortPeople
scripts/backup-tree.mjs        # export: login -> GET tree_data -> write files
scripts/restore-tree.mjs       # restore: owner login -> PATCH tree_data.data from a JSON file
scripts/selftest.mjs           # pure-function tests (stableStringify, sortPeople)
backups/tree-data.json         # generated: the people array only (clean diffs)
backups/meta.json              # generated: { version, updated_at, backed_up_at } (provenance + heartbeat)
README.md                      # runbook
.gitignore                     # .env (local owner creds), node_modules
```

No npm dependencies — Node 20+ built-in `fetch` only.

## Secrets (set in the backup repo: Settings → Secrets and variables → Actions)

| Secret | Purpose |
|--------|---------|
| `SUPABASE_URL` | Project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon/publishable key (sent as `apikey`) |
| `TREE_ID` | The tree's UUID |
| `FAMILY_EMAIL` | Shared family account email (read-only is_allowlisted access) |
| `FAMILY_PASSWORD` | Shared family account password |

The owner credentials used for **restore** are NOT stored in CI. They are supplied at runtime via local env vars (`OWNER_EMAIL`, `OWNER_PASSWORD`) when the operator runs `restore-tree.mjs` by hand. The user sets all secrets themselves; no password passes through the implementing session.

## Supabase HTTP contract (no SDK)

**Login (password grant):**
```
POST {SUPABASE_URL}/auth/v1/token?grant_type=password
Headers: apikey: {ANON_KEY}; Content-Type: application/json
Body:    { "email": ..., "password": ... }
-> 200 { "access_token": "...", ... }   (non-200 => throw, exit non-zero)
```

**Read tree data (PostgREST):**
```
GET {SUPABASE_URL}/rest/v1/tree_data?tree_id=eq.{TREE_ID}&select=data,version,updated_at
Headers: apikey: {ANON_KEY}; Authorization: Bearer {access_token}
-> 200 [ { data: [...people], version: N, updated_at: "..." } ]
```
The family user passes `is_allowlisted` RLS, so this read succeeds. Empty array => throw (the tree row must exist).

**Restore (PATCH):**
```
PATCH {SUPABASE_URL}/rest/v1/tree_data?tree_id=eq.{TREE_ID}
Headers: apikey: {ANON_KEY}; Authorization: Bearer {owner_access_token};
         Content-Type: application/json; Prefer: return=representation
Body:    { "data": [...people] }
-> 200 [ { ...updated row } ]
```
The `before update` triggers fire on this PATCH, so the current (bad) state is snapshotted before being overwritten — restore is non-destructive and itself reversible. Restore is gated to owner creds and manual execution by convention (an editor token technically also satisfies `tree_data_update`, but we do not use it) to prevent accidental or automated overwrites of the live tree.

## Data format & clean diffs

- `backups/tree-data.json` contains **only the people array** (the exact value of `tree_data.data`), so restore is a direct `PATCH { data: <file contents> }` and diffs show pure content changes.
- Serialization is deterministic so daily diffs reflect real edits, not noise:
  - `sortPeople(people)` — sort the top-level array by `id` (stable identity ordering; array reordering by the app no longer shows as a diff).
  - `stableStringify(value)` — recursively sort object keys, 2-space indent, trailing newline.
- `backups/meta.json` = `{ version, updated_at, backed_up_at }`. `backed_up_at` changes every run, so meta.json always produces a commit. This doubles as the **heartbeat** that keeps GitHub from disabling the schedule after 60 days of inactivity, and records provenance. `tree-data.json` only changes when the tree actually changed, keeping its `git log` a true edit history.

## Workflow (`.github/workflows/backup.yml`)

- Triggers: `schedule: cron: '17 9 * * *'` (daily ~09:17 UTC; off the top of the hour per GitHub's guidance that on-the-hour schedules are most delayed) **and** `workflow_dispatch` (manual button for testing/ad-hoc).
- `permissions: contents: write` (lets the default `GITHUB_TOKEN` push).
- Steps: `actions/checkout` → `actions/setup-node` (Node 20) → run `node scripts/backup-tree.mjs` (env from secrets) → configure the github-actions bot git identity → `git add -A` → commit with message `backup: tree v{version} @ {updated_at}` → `git push`.
- A non-zero exit from the script fails the run; GitHub emails the owner on workflow failure — so a broken backup (or unreachable/paused project) is itself a notification.

## Restore granularity & recovery

- **Recent bad edit:** `git log backups/tree-data.json` lists every change; `git show <commit>:backups/tree-data.json > restore.json`; run `OWNER_EMAIL=... OWNER_PASSWORD=... node scripts/restore-tree.mjs restore.json`.
- **Total loss (project deleted/paused beyond recovery):**
  1. New Supabase project → run `supabase/first-time-setup.sql` (recreates tables, triggers, RLS).
  2. Recreate the family and owner auth users; re-add their rows to `allowed_emails` (owner/editor).
  3. `node scripts/restore-tree.mjs backups/tree-data.json` writes the latest backed-up content into `tree_data.data`.

## Testing / verification

This is CI glue plus Supabase HTTP calls — not meaningfully unit-testable end to end. The pure functions are:
- `scripts/selftest.mjs` asserts `stableStringify` (key ordering, indentation) and `sortPeople` (orders by id, does not mutate input). Run with `node scripts/selftest.mjs`.
- `backup-tree.mjs --dry-run` prints the JSON it would write to stdout without writing files or committing — used to verify the live Supabase read locally.
- End-to-end verification = trigger the workflow via `workflow_dispatch` and confirm a commit appears with correct `tree-data.json`/`meta.json`; then round-trip `restore-tree.mjs` against a scratch value and confirm the tree updates and a new in-DB snapshot is created.

## What is NOT in scope

- No changes to the public app repo's code or the Supabase schema.
- No automated restore (manual + owner-gated by design).
- Snapshots/audit_log/allowed_emails are not exported (owner-only tables; out of scope — tree content is the irreplaceable data). Capturing them later would require owner or service-role creds in CI.
- No in-app "History/Restore" UI (separate future feature; this spec covers the off-site backup floor only).
