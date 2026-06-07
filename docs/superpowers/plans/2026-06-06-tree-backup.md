# Scheduled Tree Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained **private** GitHub repo whose scheduled workflow exports the family tree (`tree_data.data`) to git-committed JSON daily, with an owner-gated manual restore.

**Architecture:** Zero-dependency Node 20 scripts (built-in `fetch`) talk to the Supabase Auth + PostgREST HTTP APIs. A pure-function core (`stableStringify`, `sortPeople`, `buildArtifacts`) produces deterministic JSON so git diffs reflect real edits; thin CLI scripts (`backup-tree.mjs`, `restore-tree.mjs`) orchestrate it; a GitHub Actions workflow runs the backup on a daily cron and commits the result. Restore is manual and owner-credentialed.

**Tech Stack:** Node 20 (ESM `.mjs`, built-in `fetch`, `node:test`), GitHub Actions, Supabase Auth (password grant) + PostgREST.

**Spec:** `docs/superpowers/specs/2026-06-06-tree-backup-design.md`

---

## Important constraints (read first)

- **All implementation files live in a NEW repo at `~/dev/family-tree-backups`, OUTSIDE the public `family-chart` repo.** Never create `backups/tree-data.json` (real family data) inside `dzkaiten/family-chart` — it is public. Only this plan/spec (which contain no data and no secret *values*) live in the public repo.
- **Secrets are never written by the implementer.** The user runs the `gh secret set` commands in the final task; `FAMILY_PASSWORD` is entered interactively so it never appears in the plan, shell history, or this session.
- **Verification reality:** end-to-end backup/restore needs live Supabase creds and a real GitHub repo, so the deep coverage is on the pure functions (Task 1, real red-green TDD via `node:test`). The CLI/workflow glue is verified by `--dry-run` against the live tree and a manual `workflow_dispatch` run (Task 6).

## File structure (in `~/dev/family-tree-backups`)

| File | Responsibility |
|------|----------------|
| `package.json` | ESM + Node engine + convenience scripts; **no dependencies** |
| `.gitignore` | ignore `node_modules/`, `.env` |
| `scripts/lib/supabase.mjs` | pure: `stableStringify`, `sortPeople`, `buildArtifacts`; HTTP: `login`, `getTreeData`, `patchTreeData` |
| `scripts/selftest.mjs` | `node:test` cases for the pure functions |
| `scripts/backup-tree.mjs` | CLI: login (family) → GET tree_data → write `backups/*.json` (or print with `--dry-run`) |
| `scripts/restore-tree.mjs` | CLI: login (owner) → PATCH `tree_data.data` from a JSON file |
| `.github/workflows/backup.yml` | daily cron + manual dispatch; runs export, commits, pushes |
| `backups/tree-data.json` | generated — the people array only |
| `backups/meta.json` | generated — `{version, updated_at, backed_up_at}` (provenance + heartbeat) |
| `README.md` | runbook (setup, restore, rebuild-from-scratch) |

---

## Task 0: Scaffold the local repo skeleton

**Files:**
- Create: `~/dev/family-tree-backups/package.json`
- Create: `~/dev/family-tree-backups/.gitignore`
- Create: `~/dev/family-tree-backups/backups/.gitkeep`

- [ ] **Step 1: Create the directory and init git**

Run:
```bash
mkdir -p ~/dev/family-tree-backups/scripts/lib ~/dev/family-tree-backups/.github/workflows ~/dev/family-tree-backups/backups
cd ~/dev/family-tree-backups
git init -b main
```
Expected: `Initialized empty Git repository in /home/dzkaiten/dev/family-tree-backups/.git/`

- [ ] **Step 2: Create `package.json`**

Create `~/dev/family-tree-backups/package.json`:
```json
{
  "name": "family-tree-backups",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "selftest": "node scripts/selftest.mjs",
    "backup": "node scripts/backup-tree.mjs",
    "dry-run": "node scripts/backup-tree.mjs --dry-run",
    "restore": "node scripts/restore-tree.mjs"
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

Create `~/dev/family-tree-backups/.gitignore`:
```
node_modules/
.env
```

- [ ] **Step 4: Keep the backups dir tracked**

Create `~/dev/family-tree-backups/backups/.gitkeep` (empty file).

Run: `touch ~/dev/family-tree-backups/backups/.gitkeep`

- [ ] **Step 5: Commit**

```bash
cd ~/dev/family-tree-backups
git add -A
git commit -m "chore: scaffold backup repo skeleton"
```

---

## Task 1: Pure core (`scripts/lib/supabase.mjs`) — TDD

**Files:**
- Create: `~/dev/family-tree-backups/scripts/selftest.mjs`
- Create: `~/dev/family-tree-backups/scripts/lib/supabase.mjs`

- [ ] **Step 1: Write the failing tests**

Create `~/dev/family-tree-backups/scripts/selftest.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableStringify, sortPeople, buildArtifacts } from './lib/supabase.mjs';

test('stableStringify sorts object keys deeply and ends with newline', () => {
  const out = stableStringify({ b: 1, a: { d: 2, c: 3 } });
  assert.equal(out, '{\n  "a": {\n    "c": 3,\n    "d": 2\n  },\n  "b": 1\n}\n');
});

test('stableStringify preserves array order', () => {
  assert.equal(stableStringify([3, 1, 2]), '[\n  3,\n  1,\n  2\n]\n');
});

test('sortPeople orders by id without mutating input', () => {
  const input = [{ id: 'b' }, { id: 'a' }];
  const sorted = sortPeople(input);
  assert.deepEqual(sorted.map(p => p.id), ['a', 'b']);
  assert.deepEqual(input.map(p => p.id), ['b', 'a']);
});

test('buildArtifacts: id-sorted tree json + meta with backed_up_at', () => {
  const row = {
    data: [{ id: 'b', data: {} }, { id: 'a', data: {} }],
    version: 7,
    updated_at: '2026-06-06T00:00:00Z'
  };
  const { treeJson, meta, metaJson } = buildArtifacts(row, '2026-06-06T09:17:00Z');
  assert.deepEqual(JSON.parse(treeJson).map(p => p.id), ['a', 'b']);
  assert.deepEqual(meta, {
    version: 7,
    updated_at: '2026-06-06T00:00:00Z',
    backed_up_at: '2026-06-06T09:17:00Z'
  });
  assert.ok(metaJson.endsWith('\n'));
});

test('buildArtifacts tolerates null data as empty array', () => {
  const { treeJson } = buildArtifacts({ data: null, version: 1, updated_at: 'x' }, 'now');
  assert.equal(treeJson, '[]\n');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/dev/family-tree-backups && node scripts/selftest.mjs`
Expected: FAIL — `Cannot find module './lib/supabase.mjs'` (or import error). Confirms the test runs and the module is missing.

- [ ] **Step 3: Implement the library**

Create `~/dev/family-tree-backups/scripts/lib/supabase.mjs`:
```js
// Zero-dependency Supabase backup/restore helpers (Node 20+, built-in fetch).

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in scripts/selftest.mjs)
// ---------------------------------------------------------------------------

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep(value[key]);
    return out;
  }
  return value;
}

// Deterministic JSON: object keys sorted recursively, array order preserved,
// 2-space indent, trailing newline — so daily git diffs show only real changes.
export function stableStringify(value) {
  return JSON.stringify(sortDeep(value), null, 2) + '\n';
}

// Order the people array by id without mutating the input, so that array
// reordering by the app does not appear as a diff.
export function sortPeople(people) {
  return [...people].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// Turn a tree_data row into the two files we persist.
export function buildArtifacts(row, nowIso) {
  const people = sortPeople(row.data ?? []);
  const treeJson = stableStringify(people);
  const meta = {
    version: row.version,
    updated_at: row.updated_at,
    backed_up_at: nowIso
  };
  return { treeJson, meta, metaJson: stableStringify(meta) };
}

// ---------------------------------------------------------------------------
// HTTP (Supabase Auth password grant + PostgREST). Not unit-tested (network).
// ---------------------------------------------------------------------------

export async function login({ url, anonKey, email, password }) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Login response had no access_token');
  return json.access_token;
}

export async function getTreeData({ url, anonKey, treeId, token }) {
  const res = await fetch(
    `${url}/rest/v1/tree_data?tree_id=eq.${treeId}&select=data,version,updated_at`,
    { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Fetch tree_data failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`No tree_data row for tree_id=${treeId}`);
  }
  return rows[0];
}

export async function patchTreeData({ url, anonKey, treeId, token, people }) {
  const res = await fetch(`${url}/rest/v1/tree_data?tree_id=eq.${treeId}`, {
    method: 'PATCH',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify({ data: people })
  });
  if (!res.ok) throw new Error(`Restore PATCH failed: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows[0] : rows;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/dev/family-tree-backups && node scripts/selftest.mjs`
Expected: PASS — all 5 tests pass (`# pass 5`, `# fail 0`), exit code 0.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/family-tree-backups
git add scripts/lib/supabase.mjs scripts/selftest.mjs
git commit -m "feat: pure backup core + supabase http helpers (tested)"
```

---

## Task 2: Backup CLI (`scripts/backup-tree.mjs`)

**Files:**
- Create: `~/dev/family-tree-backups/scripts/backup-tree.mjs`

- [ ] **Step 1: Implement the backup script**

Create `~/dev/family-tree-backups/scripts/backup-tree.mjs`:
```js
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { login, getTreeData, buildArtifacts } from './lib/supabase.mjs';

const dryRun = process.argv.includes('--dry-run');
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const env = {
  url: requireEnv('SUPABASE_URL'),
  anonKey: requireEnv('SUPABASE_ANON_KEY'),
  treeId: requireEnv('TREE_ID'),
  email: requireEnv('FAMILY_EMAIL'),
  password: requireEnv('FAMILY_PASSWORD')
};

const token = await login(env);
const row = await getTreeData({ ...env, token });
const { treeJson, metaJson } = buildArtifacts(row, new Date().toISOString());

if (dryRun) {
  console.log('--- backups/tree-data.json ---');
  process.stdout.write(treeJson);
  console.log('--- backups/meta.json ---');
  process.stdout.write(metaJson);
} else {
  const dir = join(repoRoot, 'backups');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'tree-data.json'), treeJson);
  await writeFile(join(dir, 'meta.json'), metaJson);
  console.log(`Backed up tree version ${row.version} (updated_at ${row.updated_at}).`);
}
```

- [ ] **Step 2: Verify it loads without a syntax error**

Run: `cd ~/dev/family-tree-backups && node --check scripts/backup-tree.mjs`
Expected: no output (exit 0). (A full run needs live creds; that happens in Task 6.)

- [ ] **Step 3: Commit**

```bash
cd ~/dev/family-tree-backups
git add scripts/backup-tree.mjs
git commit -m "feat: backup-tree CLI with --dry-run"
```

---

## Task 3: Restore CLI (`scripts/restore-tree.mjs`)

**Files:**
- Create: `~/dev/family-tree-backups/scripts/restore-tree.mjs`

- [ ] **Step 1: Implement the restore script**

Create `~/dev/family-tree-backups/scripts/restore-tree.mjs`:
```js
import { readFile } from 'node:fs/promises';
import { login, patchTreeData } from './lib/supabase.mjs';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

const file = process.argv[2];
if (!file) {
  console.error(
    'Usage: OWNER_EMAIL=.. OWNER_PASSWORD=.. node scripts/restore-tree.mjs <path-to-tree-data.json>'
  );
  process.exit(1);
}

const env = {
  url: requireEnv('SUPABASE_URL'),
  anonKey: requireEnv('SUPABASE_ANON_KEY'),
  treeId: requireEnv('TREE_ID'),
  email: requireEnv('OWNER_EMAIL'),
  password: requireEnv('OWNER_PASSWORD')
};

const people = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(people)) {
  console.error('Backup file must contain a JSON array of people.');
  process.exit(1);
}

console.log(`Restoring ${people.length} people into tree ${env.treeId} ...`);
const token = await login(env);
const updated = await patchTreeData({ ...env, token, people });
console.log(`Restore complete. Tree is now version ${updated.version}.`);
```

- [ ] **Step 2: Verify syntax and the usage guard**

Run: `cd ~/dev/family-tree-backups && node --check scripts/restore-tree.mjs && node scripts/restore-tree.mjs`
Expected: `node --check` produces no output; running with no argument prints the `Usage:` line and exits non-zero (the env vars are not read before the arg check).

- [ ] **Step 3: Commit**

```bash
cd ~/dev/family-tree-backups
git add scripts/restore-tree.mjs
git commit -m "feat: owner-gated restore-tree CLI"
```

---

## Task 4: GitHub Actions workflow

**Files:**
- Create: `~/dev/family-tree-backups/.github/workflows/backup.yml`

- [ ] **Step 1: Create the workflow**

Create `~/dev/family-tree-backups/.github/workflows/backup.yml`:
```yaml
name: Backup family tree

on:
  schedule:
    # Daily ~09:17 UTC. Off the top of the hour: GitHub delays on-the-hour
    # scheduled runs the most under load.
    - cron: '17 9 * * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Export tree to JSON
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
          TREE_ID: ${{ secrets.TREE_ID }}
          FAMILY_EMAIL: ${{ secrets.FAMILY_EMAIL }}
          FAMILY_PASSWORD: ${{ secrets.FAMILY_PASSWORD }}
        run: node scripts/backup-tree.mjs

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          MSG="backup: tree v$(jq -r .version backups/meta.json) @ $(jq -r .updated_at backups/meta.json)"
          git commit -m "$MSG" || echo "Nothing to commit"
          git push
```

(`jq` is preinstalled on `ubuntu-latest`. `meta.json` changes every run via `backed_up_at`, so there is normally always something to commit — the `|| echo` is a safety net.)

- [ ] **Step 2: Validate YAML parses**

Run:
```bash
cd ~/dev/family-tree-backups
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/backup.yml')); print('yaml ok')"
```
Expected: `yaml ok`

- [ ] **Step 3: Commit**

```bash
cd ~/dev/family-tree-backups
git add .github/workflows/backup.yml
git commit -m "ci: daily backup workflow"
```

---

## Task 5: README runbook

**Files:**
- Create: `~/dev/family-tree-backups/README.md`

- [ ] **Step 1: Write the runbook**

Create `~/dev/family-tree-backups/README.md`:
````markdown
# Family Tree Backups

Off-site, version-controlled backups of the family tree stored in Supabase
(`tree_data.data`). A daily GitHub Actions workflow exports the tree to
`backups/tree-data.json`; git history is the backup history.

> This repository is **private** because `backups/tree-data.json` contains real
> family data. Do not make it public.

## How it works

- `.github/workflows/backup.yml` runs daily (~09:17 UTC) and on manual dispatch.
- It logs in as the shared **family** Supabase user (read-only allowlisted),
  reads `tree_data`, and writes:
  - `backups/tree-data.json` — the people array (changes only on real edits).
  - `backups/meta.json` — `{version, updated_at, backed_up_at}` (changes every
    run; this is the heartbeat that keeps the schedule from being disabled after
    60 days of inactivity).
- If the backup fails (e.g. project paused/unreachable), the workflow fails and
  GitHub emails you — a free liveness check.

## One-time setup

1. Create this as a **private** GitHub repo and push (see below).
2. Add repository secrets (Settings → Secrets and variables → Actions):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `TREE_ID`, `FAMILY_EMAIL`, `FAMILY_PASSWORD`.
3. Trigger once: Actions → "Backup family tree" → Run workflow. Confirm a commit
   appears under `backups/`.

## Restore a recent version

```bash
# 1. Find the version you want
git log --oneline backups/tree-data.json

# 2. Extract it
git show <commit>:backups/tree-data.json > restore.json

# 3. Apply it (OWNER credentials, run locally — never stored in CI)
export SUPABASE_URL=... SUPABASE_ANON_KEY=... TREE_ID=...
export OWNER_EMAIL=... OWNER_PASSWORD=...
node scripts/restore-tree.mjs restore.json
```

Restore is non-destructive: the PATCH fires Supabase's snapshot trigger, so the
current (pre-restore) state is captured before being overwritten.

## Rebuild from total loss

1. Create a new Supabase project; run `supabase/first-time-setup.sql` from the
   app repo (recreates tables, triggers, RLS).
2. Recreate the **family** and **owner** auth users; add their rows to
   `allowed_emails` (`editor` / `owner`).
3. Restore the latest content:
   ```bash
   node scripts/restore-tree.mjs backups/tree-data.json
   ```

## Local checks

```bash
npm run selftest   # pure-function tests
npm run dry-run    # print what would be backed up (needs the 5 backup env vars)
```
````

- [ ] **Step 2: Commit**

```bash
cd ~/dev/family-tree-backups
git add README.md
git commit -m "docs: backup/restore runbook"
```

---

## Task 6: Create the private repo, set secrets, verify end-to-end

**Files:** none (GitHub + live verification)

- [ ] **Step 1: Re-run the self-test (regression)**

Run: `cd ~/dev/family-tree-backups && npm run selftest`
Expected: `# pass 5`, `# fail 0`, exit 0.

- [ ] **Step 2: Local dry-run against live Supabase**

Provide the five backup env vars (values from the app's `app/.env`; `FAMILY_EMAIL`/`FAMILY_PASSWORD` are the shared family Supabase account):
```bash
cd ~/dev/family-tree-backups
export SUPABASE_URL=... SUPABASE_ANON_KEY=... TREE_ID=...
export FAMILY_EMAIL=... FAMILY_PASSWORD=...
npm run dry-run
```
Expected: prints `--- backups/tree-data.json ---` followed by the id-sorted people array, then `--- backups/meta.json ---` with `version`/`updated_at`/`backed_up_at`. A login or fetch error here means a credential/RLS problem to fix before going further.

- [ ] **Step 3: Create the private repo and push** (user runs)

```bash
cd ~/dev/family-tree-backups
gh repo create dzkaiten/family-tree-backups --private --source=. --remote=origin --push
```
Expected: repo created and `main` pushed. Confirm at `https://github.com/dzkaiten/family-tree-backups` that the repo is **Private**.

- [ ] **Step 4: Set the Actions secrets** (user runs; password entered interactively)

```bash
cd ~/dev/family-tree-backups
gh secret set SUPABASE_URL --body "https://rkcheyonentvrdlbpyoo.supabase.co"
gh secret set SUPABASE_ANON_KEY --body "<anon key from app/.env>"
gh secret set TREE_ID --body "<tree id from app/.env>"
gh secret set FAMILY_EMAIL --body "<shared family account email>"
gh secret set FAMILY_PASSWORD            # prompts for the value; not echoed
```
Expected: `✓ Set Actions secret ...` for each. Verify with `gh secret list` (5 secrets, no values shown).

- [ ] **Step 5: Trigger the workflow and confirm a commit**

```bash
cd ~/dev/family-tree-backups
gh workflow run "Backup family tree"
sleep 20 && gh run list --workflow="Backup family tree" --limit 1
gh run watch $(gh run list --workflow="Backup family tree" --limit 1 --json databaseId --jq '.[0].databaseId')
git pull
git log --oneline -2
ls backups/
```
Expected: the run succeeds; `git pull` brings down a `backup: tree v<N> @ <ts>` commit; `backups/tree-data.json` and `backups/meta.json` exist with real content.

- [ ] **Step 6: Round-trip the restore (safe, idempotent)**

Re-apply the just-captured backup. Content is identical, so this only bumps the version and creates one in-DB snapshot — proving restore works without changing data:
```bash
cd ~/dev/family-tree-backups
export SUPABASE_URL=... SUPABASE_ANON_KEY=... TREE_ID=...
export OWNER_EMAIL=... OWNER_PASSWORD=...   # OWNER account, not family
node scripts/restore-tree.mjs backups/tree-data.json
```
Expected: `Restore complete. Tree is now version <N+1>.` Confirm in the Supabase dashboard that `tree_data.version` incremented and a new `snapshots` row was created. (Open the app and confirm the tree is unchanged.)

- [ ] **Step 7: Report results**

Report the actual output of Steps 1, 2, 5, and 6. Do not claim success without the run succeeding and the commit/version-bump visible.

---

## Self-review

- **Spec coverage:** separate private repo (Task 0 + T6.S3) ✓; daily cron + manual dispatch (T4) ✓; family-user least-privilege read (T2 env) ✓; owner-gated manual restore, creds local not CI (T3, T6.S6) ✓; `tree-data.json` = people array only (`buildArtifacts`/`patchTreeData` use the array directly) ✓; `meta.json` provenance + heartbeat (T1 `buildArtifacts`, T4 always-commit) ✓; stable diffs via `sortPeople` + `stableStringify` (T1, tested) ✓; failed-run notification (T4 + README) ✓; HTTP contract — password grant, PostgREST select, PATCH with snapshot-on-update (T1 helpers, README restore note) ✓; secrets list (T6.S4) ✓; `--dry-run` + `selftest` verification (T6.S1–2) ✓; rebuild-from-loss runbook (T5) ✓; zero deps / Node 20 fetch (package.json, lib) ✓; nothing in the public repo except plan/spec ✓.
- **Placeholder scan:** none — every code/file step has complete content. Where a value is intentionally user-supplied (secret values, the anon key), it is a clearly-marked runtime input in a user-run command, not an unfilled code blank.
- **Type/name consistency:** `login`, `getTreeData`, `patchTreeData`, `buildArtifacts`, `sortPeople`, `stableStringify` are defined in Task 1 and imported with those exact names and argument shapes in Tasks 2–3 and the tests. The HTTP helpers all take a single options object `{ url, anonKey, treeId?, token?, email?, password?, people? }`; the CLIs build `env = { url, anonKey, treeId, email, password }` and spread it (plus `token`/`people`) into them — consistent. `buildArtifacts(row, nowIso)` returns `{ treeJson, meta, metaJson }`, matching both the test and `backup-tree.mjs`'s destructuring of `{ treeJson, metaJson }`.
- **Out-of-scope guards honored:** no app-repo code or schema changes; no automated restore; snapshots/audit/allowlist not exported; no in-app UI.
