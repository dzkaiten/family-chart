# Family Chart App — System Architecture

> **Living document.** This is the cross-session source of truth for *how the app
> works today*. Update it when architecture changes. For what is built vs. planned
> see [`docs/roadmap.md`](roadmap.md).
>
> **Last updated:** 2026-06-07

---

## 1. What this is

A private, free-to-host family chart web app. Family members open one URL, sign in
with a single shared password, and collaboratively view and edit a shared chart.
Edits persist to Supabase and are visible to everyone. Names are multilingual
(English + Chinese), people can have profile photos, and the whole tree is private
(nothing is visible without signing in).

This repo (`dzkaiten/family-chart`) is a **public** fork of the upstream
[`family-chart`](https://github.com/donatso/family-chart) D3 library. The library
lives in `src/` (unforked, used as-is). Our application is a separate Vite app in
`app/` that consumes the library through a `@lib` alias.

---

## 2. Two repositories

| Repo | Visibility | Holds | Role |
|---|---|---|---|
| `dzkaiten/family-chart` (this repo) | **Public** | Library (`src/`), app (`app/`), schema (`supabase/`), docs | The app + its build/deploy |
| `family-chart-data` (separate) | **Private** | GitHub Actions cron + zero-dep Node scripts + committed **encrypted** JSON | Off-site daily backup of `tree_data.data` (AES-256-GCM at rest) |

The public repo must **never** contain real family data (names, birthdays, photos,
secrets). All private data lives in Supabase; the only off-site copy is the private
backups repo. See §10 and the backup design at
[`docs/superpowers/specs/2026-06-06-tree-backup-design.md`](superpowers/specs/2026-06-06-tree-backup-design.md).

---

## 3. Tech stack

- **Frontend:** Vanilla TypeScript + Vite. No framework.
- **Tree rendering:** the `family-chart` D3 library (`src/`), consumed unforked.
- **Backend:** Supabase — Postgres (PostgREST), Auth (password grant), Storage.
- **Hosting:** GitHub Pages, built and deployed by GitHub Actions.
- **Backups:** a separate private repo (GitHub Actions cron, Node 20 built-in `fetch`, no deps).

---

## 4. Directory & module map

### Library (`src/`) — upstream, unforked
The D3 family-chart engine: `core/` (chart, edit), `renderers/` (incl.
`card-html.ts` — card text is injected via `innerHTML`), `layout/`, `handlers/`,
`store/`, `styles/family-chart.css` (all styles scoped under `.f3`). We do not edit
library source; we adapt around it.

### App (`app/`)
- `index.html` — static shell: header (title, language `<select>`, Download JSON/PNG,
  Log out buttons — all `hidden` until authed), `#view-root` (login or tree mount),
  `#toast-root`. Loads `app/src/styles.css` via `<link>`; library CSS is imported
  through the module graph (see note in `main.ts`).
- `vite.config.ts` — `root: app/`, `base: VITE_BASE_PATH || '/'`, alias `@lib → ../src`.

**`app/src/`**

| File | Responsibility |
|---|---|
| `main.ts` | Boot + orchestration. Resolves session, mounts login vs. tree, wires header controls (language toggle, downloads, logout), subscribes to auth changes. |
| `config.ts` | Env-var config (`SUPABASE_*`, `TREE_ID`, `FAMILY_EMAIL`), language list, avatar constants. |
| `auth.ts` | `getCurrentSession`, `signInWithPassword`, `signOut`, `onAuthStateChange`. Honors local mode. |
| `db.ts` | Supabase client + data layer: `fetchTreeMeta`, `fetchMyRole`, `fetchTreeData`, `saveTreeData` (optimistic lock), `logAudit`. |
| `local-mode.ts` | Dev-only `?local=true` bypass: in-memory/localStorage tree, fake owner session. |
| `views.ts` | Renders the single password login view. |
| `tree.ts` | The heart of the UI: builds the chart, card display, edit form, save loop, photo upload hook, tooltips, form translation. |
| `lang.ts` | Active language state + the name **read/write adapter** + card name computation. |
| `i18n.ts` | UI chrome string table `t(key)` over `en`/`zh-Hans`/`zh-Hant`. |
| `persist.ts` | Pure mapping: library export shape → stored `StoredPerson[]` (`mapExportedToStored`, `buildOriginalIndex`). |
| `storage.ts` | Avatar storage: `resolveAvatarUrls` (path → signed URL), `uploadAvatar`, `pruneOrphanedAvatars`. |
| `export.ts` | `downloadJSON` (structure+names, no photos), `downloadPNG` (full-tree image via `html-to-image`). |
| `ui.ts` | DOM helpers: `el`, `showToast`, `setHidden`. |
| `types.ts` | Shared types: `PersonData`, `StoredPerson`, `DisplayPerson`, `TreeDataRow`, `Session`, etc. |
| `*.test.ts` | Vitest unit tests for `lang`, `persist`, `storage`, `export`. |

### Other
- `supabase/schema.sql` — full schema, RLS, triggers, storage bucket (run once).
- `supabase/first-time-setup.sql` — schema + seed in one paste.
- `.github/workflows/deploy.yml` — build + deploy to Pages.

---

## 5. Runtime data flow

**Boot (`main.ts` → `boot()`):**
1. `initLanguage()` from localStorage / tree default; set the toggle + translate chrome.
2. `getCurrentSession()` → mount.
3. Subscribe via `onAuthStateChange` so sign-in/out re-mounts.

**Mount decision (`mount()`):**
- No session → header hidden, render login view.
- Session but `role === null` (authed but not allowlisted) → toast "not authorized", sign out.
- Session with role → `mountTree()`.

**Tree render (`tree.ts` → `initTree` → `render`):**
1. `fetchTreeData()` → `TreeDataRow`.
2. Container gets `class="tree-root f3"` (the `.f3` scope is **required** — the
   library never adds it and without it nothing styles).
3. Empty tree → seed one starter person and auto-open its form.
4. `toDisplayPeople()` maps stored people → flat library shape; `resolveAvatarUrls()`
   swaps avatar **paths** for 1-hour **signed URLs**.
5. `f3.createChart(...).setCard(CardHtml).setCardDisplay([...])` with 3 lines:
   primary name, secondary (other-language) name, birthday.
6. If editable: build the edit form fields, `setEditFirst(true)`, `setOnChange(scheduleSave)`,
   install the photo-upload + form-translation MutationObserver.

**Edit → save (`scheduleSave` → `persistCurrent`):**
1. `editTree.exportData()` → library shape.
2. `mapExportedToStored()` → `StoredPerson[]` (restores avatar paths, folds flat names back into `names` map).
3. `saveTreeData(stored, version)` — optimistic lock (see §8).
4. On success: update local row + avatar map, prune orphaned avatars.
5. On `StaleVersionError`: toast + `refreshTree()`. Other errors: toast.

---

## 6. Authentication & authorization (current)

**Auth = single shared password.** Magic-link email and the in-app
access-request/approval flow were **removed** (the schema still defines those
artifacts — see §7 note). Today:

- One shared **family account** (`VITE_FAMILY_EMAIL`, pre-filled on the login form)
  with a shared password. `auth.ts.signInWithPassword(email, password)` →
  `supabase.auth.signInWithPassword`. Session persists (PKCE, autorefresh).
- The **owner** signs in with their own personal email + password (a second auth
  user), which is row `role='owner'` in `allowed_emails`.
- Authorization is enforced by Supabase **RLS** against `allowed_emails`, not by the
  client. `fetchMyRole()` returns `owner` | `editor` | `null`:
  - reads its own `allowed_emails` row (owners can; editors can't under RLS),
  - else probes `tree_data` — a returned row means allowlisted editor,
  - else `null` → treated as unauthorized, signed out.

There are no per-person view/edit roles in the app: anyone who can sign in can edit.
Recovery from bad edits is via snapshots/backups (§10), which is why finer roles were
deemed unnecessary.

### RLS model (`supabase/schema.sql`)
Helper SQL functions over the JWT email claim:
- `current_user_email()` — lowercased `auth.jwt() ->> 'email'`.
- `is_allowlisted(tree_id)` — email present in `allowed_emails` for the tree.
- `is_owner(tree_id)` — present **and** `role='owner'`.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `trees` | allowlisted | — (seed) | owner | — |
| `allowed_emails` | owner | owner | owner | owner |
| `tree_data` | allowlisted | — (seed) | allowlisted | — |
| `snapshots` | owner | trigger (definer) | — | trigger prune |
| `audit_log` | owner | allowlisted | — | — |
| storage `avatars` | allowlisted | allowlisted | allowlisted | allowlisted |

Storage objects are namespaced `{tree_id}/{person_id}/{filename}`; the policy
extracts `tree_id` from the first path segment.

---

## 7. Data model

`tree_data` holds the **entire tree** as one JSONB array (`data`) — the list of
people. Schema highlights:

- `trees` — id, name, `default_language`.
- `allowed_emails` — (tree_id, email, role) unique; the allowlist RLS reads.
- `tree_data` — one row per tree: `data jsonb`, `version int` (optimistic lock),
  `data_version int` (person-schema version), `updated_by`.
- `snapshots` — pre-update copies of `data` (trigger-written, last-20 retained).
- `audit_log` — actor/action/target (written by `logAudit`; no UI surfaces it yet).

> **Vestigial in schema, unused by app:** the `access_requests` table and its RLS
> policies remain in `schema.sql` from the original magic-link/request design. The
> current app never reads or writes them. Candidate for removal — see ROADMAP.

### Person object (one element of `tree_data.data`)
```json
{
  "id": "uuid",
  "data": {
    "names": {
      "en": { "first": "John", "last": "Smith" },
      "zh": { "full": "张文俊" }
    },
    "gender": "M",
    "birthday": "1980-01-01",
    "avatar": "{tree_id}/{person_id}/file.jpg",
    "deceased": true,
    "death_date": "2012-03-04",
    "email": "", "phone": "", "wechat": "",
    "instagram": "", "facebook": "", "linkedin": ""
  },
  "rels": { "parents": [], "spouses": [], "children": [] }
}
```

The contact fields and `deceased`/`death_date` are all optional, flat in `data`,
and added without a migration (see §13). Empty values are not persisted.

`names` is a language-keyed map. **English** is structured `{first, last}`.
**Chinese** is a single-unit `{full}` under the `zh` key (script-agnostic — we accept
Traditional or Simplified and store as written; legacy `zh-*` keys are still read).
`avatar` stores a **storage path**, never a URL.

---

## 8. Key mechanisms

### Name adapter & card display (`lang.ts`)
The library expects flat `first_name`/`last_name`. We bridge both directions:
- **Read** (`toDisplayPerson`): `names` → flat `first_name`, `last_name`, `cn_name`,
  plus precomputed `display_name` / `alt_name`. Drops the `names` map.
- **Card lines** (`cardPrimaryName`/`cardSecondaryName`): computed from the **flat**
  fields so freshly-added cards (which lack the precomputed `display_name`) still show
  a name. `cardPrimaryName` returns the **Chinese name when present** (English only as
  fallback) — independent of the UI-language toggle, which controls chrome only. The
  secondary line is the other-language name. CJK names render family-name-first, no space.
- **Write** (`mergePersonUpdate`, via `persist.ts`): reads the form's flat fields back
  into the `names` map; English → `names.en`, the one `cn_name` field → `names.zh.full`;
  strips form-only/legacy keys.
- The edit form's Chinese field uses `name: 'cn_name'` — the same key the card reads.

### i18n (`i18n.ts`)
`t(key)` indexes a `T` dict across `en` / `zh-Hans` / `zh-Hant`. `I18nKey = keyof typeof T`
so removing a key is caught at typecheck. Library-rendered form controls
(Submit/Cancel/Delete, gender labels) are re-translated by a MutationObserver in `tree.ts`.

### Photos (`storage.ts`)
Private Supabase Storage bucket. `<img>` can't send auth headers, so paths are swapped
for 1-hour **signed URLs** at render time. Upload happens via a custom file input
injected into the edit form (the raw `avatar` text field is hidden). Replaced/deleted
avatars are pruned to avoid orphans. Cards support click-to-expand lightbox.

### Concurrency (`db.ts` + trigger)
Optimistic locking: `saveTreeData` does `UPDATE ... WHERE version = expectedVersion`
and sets `version+1`. No row updated → `StaleVersionError` → toast + refresh. A DB
trigger also bumps `version` and `updated_at` defensively.

### Local dev mode (`local-mode.ts`)
`?local=true` **in dev builds only** (`import.meta.env.DEV`, tree-shaken out of prod),
or `VITE_LOCAL_MODE=true`. Fakes an owner session and stores the tree in
`localStorage` — runs the whole UI with no Supabase. Not a production auth bypass.

---

## 9. Build & deploy

- Scripts (`package.json`): `app:dev` (vite app), `app:build` (vite build app),
  `typecheck` (`tsc -p app/tsconfig.json`), `test:unit` (vitest run).
- `.github/workflows/deploy.yml` on push to `main`/`master`:
  checkout → setup-node 20 → `npm install` → `npm run typecheck` + `test:unit` →
  `npm run app:build` (with `VITE_*` build secrets + `VITE_BASE_PATH=/<repo>/`) →
  upload `app/dist` → deploy to Pages.
  > Uses **npm** not yarn (yarn-classic hits a vite/vitest nested-link bug on this
  > dep set). `package-lock.json` is gitignored, so `npm install` (not `npm ci`).
- Live URL: `https://dzkaiten.github.io/family-chart/`.

### Environment variables (Vite `VITE_*`)
| Var | Used by | Notes |
|---|---|---|
| `VITE_SUPABASE_URL` | app | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | app | Anon/publishable key |
| `VITE_TREE_ID` | app | The tree UUID |
| `VITE_FAMILY_EMAIL` | app | Shared account email, pre-fills login |
| `VITE_BASE_PATH` | build | `/family-chart/` for Pages; `/` locally |
| `VITE_LOCAL_MODE` | app | `true` forces local mode |

Local: `app/.env`. CI: GitHub Actions secrets (same names).

### First-time setup (operator)

One-time, ~20 min. Current **password-auth** flow — no SMTP / magic-link / redirect-URL
config is needed.

1. **Create a Supabase project** → copy the Project URL and the anon/publishable key.
2. **Schema + seed:** SQL Editor → paste `supabase/first-time-setup.sql` (set `OWNER_EMAIL`
   to your own login email) → Run → copy the printed `VITE_TREE_ID` from the result grid.
3. **Create the two auth users** (Authentication → Users → Add user, auto-confirm, set a password):
   - **Owner** = your `OWNER_EMAIL` (the seed already allowlisted it as `owner`).
   - **Family** = the shared account email; then allowlist it as an editor —
     `insert into allowed_emails (tree_id, email, role) values ('<VITE_TREE_ID>', 'family@example.com', 'editor');`
     Give it the strong shared password you hand to the family.
4. **Configure env:** `app/.env` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_TREE_ID`, `VITE_FAMILY_EMAIL` (the shared account). Add the same as GitHub Actions secrets.
5. **Deploy:** enable Pages (source: GitHub Actions), push to `master` → `deploy.yml` builds + deploys.
6. **Backups:** stand up the private `family-chart-data` repo (its own README runbook + secrets, incl. `BACKUP_ENC_KEY`).

---

## 10. Backups & recovery

Three layers, weakest to strongest:
1. **In-session undo/redo** — native to the library.
2. **In-DB snapshots** — trigger captures `tree_data.data` before every change,
   **last 20 only** (free tier, no auto DB backups, project pauses after ~1 week idle).
3. **Off-site daily backup** (`family-chart-data`, private) — GitHub Actions cron
   (`17 9 * * *`) logs in as the family user, exports `tree_data.data`, and commits it
   **encrypted** (`backups/tree-data.json.enc`, AES-256-GCM). Git history = unlimited
   retention. `backups/meta.json` stays plaintext (no PII) as the heartbeat + change
   signal. Restore is a manual, **owner-gated** script (`restore-tree.mjs`) that
   decrypts a chosen revision and PATCHes it back (non-destructive — the bad state is
   snapshotted first).

Encryption key lives only in the `BACKUP_ENC_KEY` Actions secret + local `.env`, never
in the repo. Design:
[`docs/superpowers/specs/2026-06-06-tree-backup-design.md`](superpowers/specs/2026-06-06-tree-backup-design.md).

---

## 11. Known issues & gotchas

- **CJK glyphs on cards (FIXED):** Chinese names showed in the edit form but rendered
  as tofu/blank on cards. Root cause: `.f3 { font-family: 'Roboto', sans-serif }`
  (library CSS) locks card text to a font with no CJK fallback; `<input>` doesn't
  inherit it so the form looked fine. Fix: `app/src/styles.css` overrides the card
  text font (`.f3 .card-inner, .f3 .card-label` — specificity 0,2,0, beats `.f3`'s
  0,1,0 regardless of load order) with a cross-platform CJK fallback stack. Cards now
  always show the Chinese name as the primary line; `cardPrimaryName` returns the
  Chinese name when present and no longer keys off the UI-language toggle (the toggle
  controls chrome only).
- **`.f3` class is mandatory** on the tree container or nothing styles (the library
  never adds it).
- **Library CSS must be imported via the module graph** (`@lib` alias in `main.ts`),
  not `<link href="../src/...">` (Vite serves that as the SPA fallback — 200 but empty).
- **Stale docs:** `app/README.md` still describes the removed magic-link +
  access-request setup, and `schema.sql` keeps the unused `access_requests` table.
  See ROADMAP.

---

## 12. Reference docs

- Roadmap / status: [`docs/roadmap.md`](roadmap.md)
- Specs: [`docs/superpowers/specs/`](superpowers/specs/) — password-auth (2026-06-05),
  tree-backup (2026-06-06), profile-fields (2026-06-07), kinship-calculator (2026-06-07)
- Plans: [`docs/superpowers/plans/`](superpowers/plans/)
- Data format: [`docs/data-format.md`](data-format.md)

---

## 13. Profile fields & kinship calculator

Two feature areas added 2026-06-07. Both ride in the existing `tree_data.data`
JSONB (no schema migration).

### Contact + deceased/dates (`lang.ts`, `tree.ts`, `styles.css`)
- New optional flat fields on a person: `email`, `phone`, `wechat`, `instagram`,
  `facebook`, `linkedin`, `deceased` (boolean), `death_date` (ISO). `mergePersonUpdate`
  trims them, drops empties (never persists `""`), coerces `deceased` to a real
  boolean, and clears removed keys; `toDisplayPerson` passes them through.
- **Form:** the library renders each as a text field; the form MutationObserver
  upgrades `death_date` to a date picker, renders `deceased` as a checkbox (writing
  into the hidden field the library persists), and groups the six contact inputs in a
  collapsible `<details>` fieldset (open only when a value exists).
- **Card:** line 3 is `lifeDates()` — birth year for the living, `1940–2012` for the
  deceased; deceased cards get a `card-deceased` dim. A ⓘ button (present only when
  contact data exists) opens an app-side popup listing contacts as `mailto:`/`tel:`/
  social links.

### Chinese kinship calculator (`app/src/kinship/`)
- **Engine (pure, unit-tested):** `kinshipTerm(sourceId, targetId, people)` →
  `{ term, candidates, chain, ambiguous }`. `chain.ts` walks the `rels` graph
  (parent/child/spouse/sibling edges) and renders the connection as a Chinese
  relationship chain (e.g. `爸爸的哥哥`), choosing elder/younger sibling words from
  birthdays. `index.ts` feeds the chain to **`relationship.js`** (MIT npm dep) for the
  exact term, disambiguates elder/younger multi-candidate results (堂哥/堂弟) by
  birthday, and falls back to the readable chain (`ambiguous`) when no standard term
  exists. No generation cap — the library covers deep lineal terms.
- **UI (`tree.ts`):** a 称 button per card sets/clears that person as the **source**
  (persisted per-viewer in `localStorage`, key `family-chart:kinship-source`). The
  source card gets an accent ring; a header chip names it with a ✕ clear; card line 4
  shows each person's term relative to the source (ambiguous terms get a trailing `?`).
  Toggling re-runs `chart.updateTree()` (no full rebuild, so pan/zoom is kept).
