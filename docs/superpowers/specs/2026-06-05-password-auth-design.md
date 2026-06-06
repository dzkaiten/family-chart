# Password Auth Design

**Date:** 2026-06-05
**Status:** Approved

## Problem

The current auth flow (magic-link email → email allowlist → access requests → pending approval) is overkill for a private family chart shared among a small, trusted group. The goal is to replace it with a simple shared password while keeping the owner's personal admin login intact.

## Approach

Single shared Supabase account for family members (`VITE_FAMILY_EMAIL` + a shared password), plus the owner's existing personal Supabase account. Both use `signInWithPassword` — no magic links, no allowlist management UI, no access requests.

## Config

Add one new env var to `app/.env`:

```
VITE_FAMILY_EMAIL=family@yourname.com
```

The shared password is never stored in config or code. Users type it at the login screen; it is passed directly to Supabase.

One-time Supabase setup (owner does this once):
1. Supabase dashboard → Authentication → Users → Add user
2. Email: `VITE_FAMILY_EMAIL`, set a shared password
3. Add that email to `allowed_emails` table with `role = 'editor'`
4. Owner's personal email must already be in `allowed_emails` with `role = 'owner'`

## Auth layer (`auth.ts`)

- Replace `sendMagicLink(email)` with `signInWithPassword(email, password)` using `supabase.auth.signInWithPassword({ email, password })`
- Delete `sendMagicLink` entirely
- `getCurrentSession`, `signOut`, `onAuthStateChange` — unchanged

## Login UI (`views.ts`)

Replace the magic-link form with:
- Email field — pre-filled with `VITE_FAMILY_EMAIL`, editable (owner clears it and types their own)
- Password field
- "Sign in" button

Remove entirely:
- `renderRequestView` — no more request-access flow
- `renderPendingView` — no more pending state (password auth is immediate)

## Data layer (`db.ts`)

Remove:
- `submitAccessRequest`
- `fetchPendingRequests`
- `approveRequest`
- `denyRequest`

`fetchMyRole` — unchanged. Owner's account returns `'owner'`, shared family account returns `'editor'` via the existing `allowed_emails` table.

## Admin panel (`admin.ts`)

The entire admin panel is request management. With requests gone, nothing remains — delete `admin.ts` entirely.

Also remove:
- `admin-btn` and `admin-badge` elements from `app/index.html`
- `initAdminBadge` import and call in `main.ts`
- `showHeaderForAuthed` / `showHeaderForUnauthed` calls to `setHidden('admin-btn', ...)` and `setHidden('admin-badge', ...)` in `main.ts`

## Types (`types.ts`)

Remove `AccessRequest` interface — no longer referenced anywhere.

## Local mode (`local-mode.ts`)

No changes. `LOCAL_SESSION` already returns `{ email: 'dev@local', role: 'owner' }` and the `?local=true` dev bypass is unaffected.

## What is NOT changing

- RLS policies — no schema changes needed
- `allowed_emails` table — stays, still drives `fetchMyRole`
- `fetchMyRole` logic — unchanged
- Session persistence, token refresh, `onAuthStateChange` — unchanged
- Admin badge visibility (owner-only) — unchanged
