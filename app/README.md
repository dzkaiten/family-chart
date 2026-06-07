# Family Chart App

A private, free-to-host family chart web app built on the [`family-chart`](../README.md) library. Auth via a **shared Supabase password** (plus the owner's own login), data and photos in Supabase, deployed to GitHub Pages via GitHub Actions.

## Features

- Fully private — only allowlisted accounts can view the tree or photos
- One **shared family password** to sign in — no per-member accounts, no email service
- Add, edit, and remove people and relationships
- Profile photos (private Supabase Storage bucket, signed URLs)
- Multilingual names (English + Traditional and Simplified Chinese, extensible)
- Per-person contact fields (email/phone/wechat/instagram/facebook/linkedin) and deceased/date metadata
- Optimistic concurrency control — stale saves prompt a refresh
- Automatic snapshots before every save (last 20 retained) + off-site encrypted backups
- Download tree as JSON (structure + names) or PNG (visual)

## First-time setup

A one-time process, roughly 20 minutes. The app uses **password auth**
(`signInWithPassword`) — no SMTP, magic-link, or redirect-URL config is required
to log in.

### 1. Create a Supabase project
1. Go to [supabase.com](https://supabase.com) → sign up → **New project**
2. Choose any name, set a strong database password, pick the closest region
3. Wait ~2 minutes, then copy the **Project URL** and the **anon** key
   (Project Settings → API / API Keys)

### 2. Run the schema
1. In Supabase → **SQL Editor** → **New query**
2. Paste [`supabase/schema.sql`](../supabase/schema.sql) → **Run** (or paste
   [`supabase/first-time-setup.sql`](../supabase/first-time-setup.sql) to do
   schema **and** seed in one paste, then skip to step 4)
3. This creates all tables, RLS policies, triggers, and the avatars storage bucket

### 3. Seed your tree and allowlist the owner
In the SQL Editor, run:
```sql
-- 1) Create your tree (copy the returned id)
insert into trees (name, default_language)
values ('My Family', 'en')
returning id;

-- 2) Allowlist yourself as owner (paste the tree id from step 1)
insert into allowed_emails (tree_id, email, role)
values ('<paste-tree-id>', 'you@example.com', 'owner');

-- 3) Create an empty tree data row
insert into tree_data (tree_id, data, version, data_version)
values ('<paste-tree-id>', '[]'::jsonb, 1, 1);
```
> `allowed_emails` controls the **role** (owner/editor) enforced by RLS — it is
> **not** a login credential. The matching password is set on the Auth user next.

### 4. Create the auth users (with passwords)
Supabase dashboard → **Authentication → Users → Add user** (enable auto-confirm),
and **set a password** for each:
- **Owner** — your personal email (the one allowlisted as `owner` above). This
  password is your admin login.
- **Family** — the shared family email; give it the strong shared password you
  hand out, then allowlist it as an editor:
  ```sql
  insert into allowed_emails (tree_id, email, role)
  values ('<paste-tree-id>', 'family@example.com', 'editor');
  ```

> **Migrating from the old magic-link setup?** A magic-link account has **no
> password**, so `signInWithPassword` fails with `invalid_credentials` until you
> set one (dashboard "reset password", or the service_role admin API). The backup
> repo ships `scripts/set-owner-password.sh` for exactly this — see its README,
> "Troubleshooting: owner login fails".

### 5. Wire up the app
1. Copy `.env.example` → `.env` in the repo root
2. Fill `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_TREE_ID` (from step 3),
   and `VITE_FAMILY_EMAIL` (the shared account email — pre-fills the login form)
3. Add the same values as **GitHub Actions secrets**: repo → **Settings** →
   **Secrets and variables** → **Actions**

### 6. Deploy
1. In repo settings, enable **GitHub Pages** with source set to "GitHub Actions"
2. Push to `main` (or `master`) → `.github/workflows/deploy.yml` builds and deploys
3. Open `https://<your-username>.github.io/<repo-name>/`
4. **Sign in:** family members type the shared password (email is pre-filled); the
   owner clears the email field and types their own email + password.

### 7. Adding family members
- Share the URL and the shared family password — that's it. There is no per-user
  signup or approval flow; everyone edits via the one shared editor account.
- To give someone their own login, create an Auth user (with a password) and add
  an `allowed_emails` row with the desired role.

### (Optional) Password recovery / Site URL
The app has **no in-app password reset** — change passwords from the dashboard (or
the admin API). If you want Supabase's recovery emails to work, set
**Authentication → URL Configuration → Site URL** (and Redirect URLs) to your
deployed app URL; the default is `localhost:3000`, so recovery/magic links 404.

## Development

```bash
# Install dependencies
yarn install

# Run the app dev server
yarn app:dev

# Build the app for production
yarn app:build
```

The app expects a `.env` file at the repo root with the Vite env vars listed above.
For local work without Supabase, use `?local=true` (dev builds) or `VITE_LOCAL_MODE=true`.

## Architecture notes

- Frontend: vanilla TypeScript + Vite, no framework
- Tree rendering: uses the existing `family-chart` library, unforked, via an adapter for multilingual names and signed photo URLs
- Auth: Supabase `signInWithPassword` — one shared family (editor) account + the owner's personal account; authorization is RLS over `allowed_emails`, not the client
- Database: Supabase Postgres with strict RLS — every table requires an allowlist match
- Storage: private Supabase Storage bucket, photos served via 1-hour signed URLs
- Concurrency: `tree_data.version` integer; saves use `WHERE version = ?` and fail loudly on conflict
- Snapshots: a Postgres trigger captures `tree_data.data` before every update; oldest pruned past 20

See `supabase/schema.sql` for the full data model and RLS policies, and the private
`family-chart-data` repo for off-site encrypted backups + restore tooling.
