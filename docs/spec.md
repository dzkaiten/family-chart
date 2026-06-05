# Family Chart App — Product Spec

## Overview

A free, hosted web app that lets family members view and collaboratively edit a shared family tree. Changes made in the UI are persisted to a database and visible to all family members in real time.

---

## Hosting & Infrastructure

| Concern | Solution | Cost |
|---|---|---|
| Frontend hosting | GitHub Pages | Free |
| Database | Supabase (PostgreSQL) | Free tier |
| File storage | Supabase Storage (profile photos) | Free tier |
| Auth | Supabase magic link (email) | Free tier |
| Domain | `dzkaiten.github.io/family-chart` (or custom domain) | Free |

---

## Users & Roles

The tree is **fully private**. Nothing — not the tree, not photos, not names — is visible to anyone who isn't on the `allowed_emails` allowlist.

| Role | How they get access | Permissions |
|---|---|---|
| Unauthenticated | Anyone with the URL | See only the login / request-access screen. No tree data, no photos. |
| Editor | Owner approves their in-app request | View + edit the family tree |
| Owner | Pre-seeded in `allowed_emails` with `role='owner'` | All editor permissions + see and approve access requests |

---

## Authentication

- **Method:** Supabase magic link (passwordless email)
- **Session:** Persists in the browser (stays logged in across visits on the same device)
- **Access control:** Supabase Row Level Security (RLS) checks `allowed_emails` on every write

### Login flow

1. Unauthenticated visitor hits the URL → sees a login / request-access screen (no tree data)
2. Enters email → clicks "Send me a link"
3. Sees "Check your inbox" confirmation
4. Clicks link in email → redirected back to the app
5. **If email is in `allowed_emails`:** tree loads with view + edit access
6. **If email is not in `allowed_emails`:** sees "Access pending — the owner has been notified" (if a request exists) or is prompted to submit a request

### Access request flow (no email notifications)

1. Visitor clicks "Request Edit Access"
2. Enters their name + email → submits
3. Record inserted into `access_requests` table with status `pending`
4. When the **owner** logs in, a "Pending requests (N)" badge appears in the UI
5. Owner clicks → sees list of pending requests with name + email → clicks Approve or Deny
6. On **Approve:** email added to `allowed_emails`, request marked `approved`
7. On **Deny:** request marked `denied`
8. Approved user can now log in with a magic link and edit — no automatic notification sent to them (they can try logging in again)

> No external email service required. Owner checks the app for pending requests.

---

## Core Features

### 1. View family tree (allowlisted users only)
- Only users on `allowed_emails` can view the tree — there is no public view
- Uses the existing `family-chart` D3.js library for visualization
- Tree data is fetched only after a successful authenticated session is established

### 2. Edit family tree (editors and owners)
- Authenticated, allowlisted users can add, edit, and remove people and relationships
- Changes are saved to Supabase on every action with **optimistic concurrency control**: each `tree_data` row has a `version` integer; saves use `WHERE version = ?` and fail loudly if stale, prompting the user to refresh
- A snapshot of the previous state is written to `snapshots` before each successful save
- In-session undo/redo provided natively by the `family-chart` library

### 3. Profile photos (private)
- Photos live in a **private** Supabase Storage bucket — `<img src>` cannot send auth headers, so we use **signed URLs**
- The person's `avatar` field stores a **storage path** (e.g. `{tree_id}/{person_id}/{filename}`), not a URL
- At render time, the app generates a 1-hour signed URL for each path and populates the library's expected `avatar` field
- Signed URLs are regenerated when the session refreshes or every ~50 minutes
- Editors upload a photo via a file input in the edit form → uploaded to Supabase Storage → path stored on the person
- On photo replace or person delete, the old file is removed from storage to prevent orphans
- Falls back to a gender-specific icon if no photo is set (library default)

### 4. Multilingual names (extensible by language)
- Each person stores names as a **map keyed by BCP 47 language code** (e.g. `en`, `zh-Hant`, `zh-Hans`, `es`, `ja` — extensible to any language)
- v1 ships with three language options in the toggle: **English (`en`)**, **中文繁體 (`zh-Hant`)**, **中文简体 (`zh-Hans`)**
- The set of toggle languages is driven by a config constant — adding a new language is a config change + UI label, no schema change
- A language toggle in the UI header switches the displayed name across all cards
- The toggle is a display-only control — names are stored, not auto-translated
- **Fallback chain:** selected language → tree's `default_language` → first available name (no blank cards)
- English is required when creating a person; other languages are optional
- Selected language persists in the browser (localStorage)

#### Adapter layer (read + write)

The `family-chart` library expects flat `first_name` / `last_name` fields. We bridge the gap in both directions without forking the library:

- **On render:** before passing data to the library, map `data.names[activeLang]` → `data.first_name` / `data.last_name` (with fallback chain)
- **On edit form open:** show extra inputs for each configured language (e.g. 6 inputs total for 3 languages × first/last)
- **On form submit:** intercept the library's submit, read all language inputs, write back to `data.names.{lang}.{first|last}` and strip the library's flat fields before persisting

### 5. Login / logout
- Login prompt appears when an unauthenticated user clicks "Edit"
- Email input → magic link sent → redirected back to app
- Logout button visible when logged in

### 6. Access request & approval (in-app)
- Unauthenticated users can submit a request (name + email)
- Owner sees a "Pending (N)" badge when logged in
- Owner approves or denies from within the app
- Approval adds the email to `allowed_emails` — no restart or redeployment needed

### 7. Download tree (data and image)

Two export options, both available to editors and owners only:

#### 7a. Download tree structure (JSON)
- "Download tree (JSON)" button → browser download of a JSON file
- File contents:
  - All people with their `id`, `names` (every language stored), `gender`, `birthday`, and other text fields
  - All `rels` (relationship graph: parents, spouses, children)
  - **Excludes** `avatar` paths and any other photo references — relationships and names only
- Filename: `family-tree-{YYYY-MM-DD}.json`
- Uses the library's existing `formatDataForExport()` and post-processes to strip photo fields
- Purpose: portable backup, share without the app, future re-import

#### 7b. Download as image (PNG)
- "Download as image" button → browser download of a PNG of the rendered tree
- Captures the **full tree** (not just the visible viewport) at the tree's actual size
- Includes photos (this is a visual capture; the data export still excludes them)
- Uses [`html-to-image`](https://github.com/bubkoo/html-to-image) (~25 KB, free, MIT) — smaller and more modern than `html2canvas`
- Waits for all signed-URL avatar images to finish loading before capture, so photos aren't missing
- Filename: `family-tree-{YYYY-MM-DD}.png`
- Purpose: shareable visual snapshot, print, send to non-family members
- v1 ships PNG only; PDF (would require `jsPDF`) is deferred unless requested

### 8. Version snapshots (safety net)
- Before every save, the current tree state is written to `snapshots`
- Retention count is a config constant (default: 20). Older snapshots pruned automatically. Set to `null` for unlimited retention.
- No restore UI in v1 — owner restores directly via Supabase dashboard if needed
- Schema includes a `change_summary` field reserved for future use (e.g. diff descriptions, named saves)

---

## Future Considerations (out of scope for v1, but schema-ready)

These are intentionally enabled by the v1 data model — adding them later should not require migrations:

- **Filtering:** Toggle-able UI filters (maternal/paternal side, direct ancestors, generation depth). Frontend-only addition.
- **Multiple named trees:** Schema already scopes everything by `tree_id`. Adding a tree picker is a UI addition.
- **Additional roles** (viewer, admin): `allowed_emails.role` already exists.
- **More languages** (Spanish, Japanese, etc.): add a language code to the config — no schema change.
- **Extra person attributes** (notes, occupation, birthplace, multiple photos, life events): all stored inside the person's `data` JSONB.
- **Snapshot restore UI:** snapshots already persisted with `saved_by` and reserved `change_summary` field.
- **Audit history view:** `audit_log` table is populated from v1 even though no UI exposes it yet.
- **Notification emails on approval:** can be bolted on later via Supabase Edge Function + SMTP.

Out of scope and **not** designed for in v1:
- Real-time collaborative editing (two people editing simultaneously)
- Export to GEDCOM or PDF
- Per-person privacy controls (visibility settings on individuals)

---

## Data Model

### Extensibility principles

The schema is designed so common future additions don't require migrations:

- **Multiple trees:** every table has a `tree_id` from day one, even though v1 has a single tree
- **Roles:** `allowed_emails` has a `role` column, even though v1 only uses `editor` + `owner`
- **Languages:** names are stored as a language-keyed map in JSONB, not as fixed columns
- **Per-person extensions:** the `data` JSONB blob holds all person attributes — adding new fields (notes, occupation, birthplace, multiple photos, etc.) needs no schema change
- **Lifecycle states:** status enums use `text` (not Postgres enums) so new states can be added without ALTER TYPE
- **Config-driven UI:** language list, snapshot retention count, and similar are app config constants, not hardcoded literals

### Tables

```
table: trees
- id: uuid (primary key)
- name: text                       ← "Smith Family"
- default_language: text           ← BCP 47 code, e.g. 'en' (display fallback)
- created_at: timestamp
- created_by: uuid (references auth.users)

table: allowed_emails
- id: uuid (primary key)
- tree_id: uuid (references trees.id)
- email: text
- role: text                       ← 'owner' | 'editor' (room for 'viewer', 'admin' later)
- created_at: timestamp
- created_by: uuid (references auth.users)
- unique (tree_id, email)

table: access_requests
- id: uuid (primary key)
- tree_id: uuid (references trees.id)
- name: text
- email: text
- status: text                     ← 'pending' | 'approved' | 'denied' (extensible)
- requested_role: text             ← defaults to 'editor'
- requested_at: timestamp
- resolved_at: timestamp
- resolved_by: uuid (references auth.users)

table: tree_data
- id: uuid (primary key)
- tree_id: uuid (references trees.id, unique)
- data: jsonb                      ← array of person objects from family-chart library
- version: integer                 ← incremented on every save; used for optimistic locking
- data_version: integer            ← person-object schema version (1 for v1); enables future migrations
- updated_at: timestamp
- updated_by: uuid (references auth.users)

table: snapshots
- id: uuid (primary key)
- tree_id: uuid (references trees.id)
- data: jsonb                      ← copy of tree_data.data before the save that replaced it
- change_summary: text             ← optional short description (future use)
- saved_at: timestamp
- saved_by: uuid (references auth.users)

table: audit_log
- id: uuid (primary key)
- tree_id: uuid (references trees.id)
- actor: uuid (references auth.users)
- action: text                     ← 'approve_request' | 'deny_request' | 'revoke_access' | 'restore_snapshot' | ...
- target: jsonb                    ← flexible payload describing the action's subject
- created_at: timestamp

storage bucket: avatars (private)
- path: {tree_id}/{person_id}/{filename}
- private bucket — no public reads. Access via signed URLs only (1-hour expiry).
- read/write restricted to allowlisted users (editor or owner) for the matching tree_id
```

> Tree-scoping every table from the start means adding multi-tree support is a UI change, not a schema migration.

### Row Level Security (RLS) policies

All tables have RLS enabled. The tree is fully private — nothing exposed to anonymous users except the ability to submit an access request.

| Table | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `trees` | allowlisted (editor or owner) | seed only (manual) | owner | nobody |
| `allowed_emails` | owner only | owner | owner | owner |
| `access_requests` | owner only | **anyone** (anon — open request form) | owner | nobody |
| `tree_data` | allowlisted (editor or owner) | seed only (manual) | editor or owner | nobody |
| `snapshots` | owner only | server-side trigger on `tree_data` update | nobody | server-side prune |
| `audit_log` | owner only | server-side trigger | nobody | nobody |
| storage: `avatars` | allowlisted (editor or owner) | editor or owner | editor or owner | editor or owner |

> "Allowlisted" means the user's auth email exists in `allowed_emails` for the relevant `tree_id`. "Owner" additionally requires `role='owner'`.

> "Seed only" rows are inserted manually via the Supabase SQL editor during first-time setup; no application code inserts them.

### Person object (stored in `tree_data.data`)

```json
{
  "id": "person-1",
  "data": {
    "names": {
      "en":      { "first": "John",  "last": "Smith" },
      "zh-Hant": { "first": "約翰",  "last": "史密斯" },
      "zh-Hans": { "first": "约翰",  "last": "史密斯" }
    },
    "gender": "M",
    "birthday": "...",
    "avatar": "https://[supabase-url]/storage/v1/object/public/avatars/..."
  },
  "rels": { "father": "person-2", "mother": "person-3", "spouses": [], "children": [] }
}
```

- `names` is keyed by BCP 47 language code — any future language is a new key, not a schema change
- Each entry stores `first` and `last`; other parts (middle name, suffix, courtesy name) can be added as additional keys without breaking existing readers
- The `family-chart` library's expected flat `first_name`/`last_name` fields are populated at render time by an adapter that reads from the active language with English fallback
- Anything else useful per person (notes, life events, occupation, multiple photos) goes inside `data` without schema changes

---

## First-time setup (owner / admin)

A one-time manual process. Plan on ~30 minutes end-to-end. Each step below is a literal checklist — no code changes required, just dashboard clicks and SQL copy-paste.

### 1. Create a Supabase project
1. Go to [supabase.com](https://supabase.com) → sign up → **New project**
2. Pick any name, set a strong database password (save it), choose the closest region
3. Wait ~2 minutes for it to provision

### 2. Grab your API credentials
1. In your Supabase project → **Project Settings** → **API**
2. Copy the **Project URL** and the **anon public** key — you'll paste these into the app config later

### 3. Run the schema
1. In Supabase → **SQL Editor** → **New query**
2. Paste the contents of `supabase/schema.sql` (provided in the repo) → **Run**
3. This creates all tables, RLS policies, and triggers (snapshots, audit log, pruning)

### 4. Seed your tree and yourself as owner
In the SQL Editor, run:
```sql
-- Create your tree
INSERT INTO trees (name, default_language)
VALUES ('My Family', 'en')
RETURNING id;
-- 👉 copy the returned id

-- Add yourself as owner
INSERT INTO allowed_emails (tree_id, email, role)
VALUES ('<paste tree id>', 'you@example.com', 'owner');

-- Create an empty tree data row
INSERT INTO tree_data (tree_id, data, version, data_version)
VALUES ('<paste tree id>', '[]'::jsonb, 1, 1);
```

### 5. Configure Gmail SMTP for magic-link emails
Supabase's built-in email is throttled to ~2/hour. Use your Gmail (free, 500/day):
1. In Google: [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → create an app password for "Mail" (requires 2FA enabled)
2. In Supabase → **Authentication** → **Email Templates** → **SMTP Settings**:
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address
   - Password: the app password from step 1
   - Sender email: your Gmail address
   - Sender name: e.g. "Family Tree"
3. Save

### 6. Configure auth redirect URL
1. In Supabase → **Authentication** → **URL Configuration**
2. Set **Site URL** to `https://dzkaiten.github.io/family-chart/` (or your custom domain)
3. Add the same to **Redirect URLs**

### 7. Connect the app
1. In the repo, copy `.env.example` → `.env`
2. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from step 2
3. Add the same as GitHub Actions secrets: repo → **Settings** → **Secrets and variables** → **Actions** → add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

### 8. Deploy
1. Push to `main` → GitHub Actions builds and deploys to GitHub Pages
2. Visit `https://dzkaiten.github.io/family-chart/`
3. Enter your owner email → click magic link → you're in
4. Start adding family members. Send the URL to your dad.

---

## Build & Deploy

- **Frontend stack:** Vanilla TypeScript + Vite (matches the existing repo, no framework added)
- **Bundle:** Vite production build, static output to `dist/`
- **Hosting:** GitHub Pages on the `gh-pages` branch
- **CI/CD:** GitHub Actions workflow at `.github/workflows/deploy.yml` triggers on push to `main`:
  1. Install deps (`yarn install --frozen-lockfile`)
  2. Build with Vite, injecting `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from repo secrets
  3. Publish `dist/` to `gh-pages` branch via `peaceiris/actions-gh-pages`
- **Secrets management:** Supabase URL + anon key live in GitHub Actions secrets and a local `.env` (gitignored). No secrets in the repo.

---

## Out of Scope (v1)

- Mobile-native app (responsive web is enough)
- In-app snapshot restore UI (schema is ready — just no UI)
- Notification emails to requesters on approval (no SMTP/email-API dependency in v1)
- Advanced privacy controls per person
