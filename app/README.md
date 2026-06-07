# Family Chart App

A private, free-to-host family chart web app built on the [`family-chart`](../README.md) library. Auth via Supabase magic link, data and photos in Supabase, deployed to GitHub Pages via GitHub Actions.

## Features

- Fully private — only allowlisted emails can view the tree or photos
- Add, edit, and remove people and relationships
- Profile photos (private Supabase Storage bucket, signed URLs)
- Multilingual names (English + Traditional and Simplified Chinese, extensible)
- In-app access request and approval (no email service needed)
- Optimistic concurrency control — stale saves prompt a refresh
- Automatic snapshots before every save (last 20 retained)
- Download tree as JSON (structure + names) or PNG (visual)

## First-time setup

A one-time process. Roughly 30 minutes end-to-end.

### 1. Create a Supabase project
1. Go to [supabase.com](https://supabase.com) → sign up → **New project**
2. Choose any name, set a strong database password, pick the closest region
3. Wait ~2 minutes for provisioning

### 2. Run the schema
1. In Supabase → **SQL Editor** → **New query**
2. Paste the contents of [`supabase/schema.sql`](../supabase/schema.sql) → **Run**
3. This creates all tables, RLS policies, triggers, and the avatars storage bucket

### 3. Seed your tree and add yourself as owner
In the SQL Editor, run:
```sql
-- 1) Create your tree (copy the returned id)
insert into trees (name, default_language)
values ('My Family', 'en')
returning id;

-- 2) Add yourself as owner (paste the tree id from step 1)
insert into allowed_emails (tree_id, email, role)
values ('<paste-tree-id>', 'you@example.com', 'owner');

-- 3) Create an empty tree data row
insert into tree_data (tree_id, data, version, data_version)
values ('<paste-tree-id>', '[]'::jsonb, 1, 1);
```

### 4. Configure custom SMTP for magic-link emails
Supabase's built-in email is throttled to ~2/hour. Use Gmail (free, 500/day):

1. In Google → [App passwords](https://myaccount.google.com/apppasswords), create one named "Family Tree" (requires 2FA enabled on your account)
2. In Supabase → **Authentication** → **Email Templates** → **SMTP Settings**:
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address
   - Password: the app password from step 1
   - Sender email: your Gmail address
   - Sender name: e.g. "Family Tree"
3. Save

### 5. Configure auth redirect URL
1. In Supabase → **Authentication** → **URL Configuration**
2. **Site URL:** `https://<your-username>.github.io/<repo-name>/`
3. **Redirect URLs:** add the same

### 6. Wire up the app
1. Copy `.env.example` → `.env` in the repo root
2. Fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_TREE_ID` (the id you got in step 3)
3. Add the same three values as **GitHub Actions secrets**: repo → **Settings** → **Secrets and variables** → **Actions**

### 7. Deploy
1. In repo settings, enable **GitHub Pages** with source set to "GitHub Actions"
2. Push to `main` (or `master`) → the workflow at `.github/workflows/deploy.yml` builds and deploys automatically
3. Open `https://<your-username>.github.io/<repo-name>/`
4. Click **Send magic link** with your owner email → check your inbox → click → you're in

### 8. Adding family members
- Share the URL with anyone you want to invite. They click **Request access**, fill name + email, submit.
- When you log in (as owner) you'll see a **Pending (N)** badge in the header → click → Approve or Deny.
- Approved users can then sign in with the same email and edit.

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

## Architecture notes

- Frontend: vanilla TypeScript + Vite, no framework
- Tree rendering: uses the existing `family-chart` library, unforked, via an adapter for multilingual names and signed photo URLs
- Database: Supabase Postgres with strict RLS — every table requires an allowlist match
- Storage: private Supabase Storage bucket, photos served via 1-hour signed URLs
- Concurrency: `tree_data.version` integer; saves use `WHERE version = ?` and fail loudly on conflict
- Snapshots: a Postgres trigger captures `tree_data.data` before every update; oldest pruned past 20

See `supabase/schema.sql` for the full data model and RLS policies.
