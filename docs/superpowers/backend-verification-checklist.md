# Backend verification checklist (run once against a live Supabase project)

Prereq: completed `app/README.md` first-time setup (schema run, tree + owner seeded,
SMTP configured, redirect URL set, `.env` filled, app deployed or `yarn app:dev`).

## Auth
- [ ] Visit the app unauthenticated → only the login / request-access screen shows; no tree, no names, no photos in the network tab.
- [ ] Enter the owner email → "Send magic link" → email arrives (via Gmail SMTP, not throttled).
- [ ] Click the link → redirected back → tree loads with edit controls. (Confirms PKCE `detectSessionInUrl` + redirect allowlist.)
- [ ] Log out → returns to login screen; refresh stays logged out.

## RLS (use a second, non-allowlisted email)
- [ ] Sign in with a non-allowlisted email → "Awaiting approval" screen, no tree data returned (check Network: `tree_data` returns `[]`).
- [ ] As that user, no tree write is possible and `allowed_emails` is unreadable.
- [ ] Submit an access request as the non-allowlisted (or anonymous) user → succeeds (anon INSERT allowed).
- [ ] As owner, see "Pending (1)" → Approve → the email lands in `allowed_emails` → that user can now sign in and edit.

## Editing + concurrency
- [ ] Add a person, add a relative, edit names in all three languages → each change persists (reload shows it).
- [ ] Open the app in two tabs as the owner. Edit + save in tab A. Then edit + save in tab B → tab B shows "Someone else updated the tree. Refreshing…" (optimistic-lock `version` conflict).
- [ ] In Supabase dashboard → `snapshots` table has a row per save (previous state), pruned to the latest 20.

## Photos (private storage + signed URLs)
- [ ] Edit a person → choose a photo file → save → the card shows the photo.
- [ ] In Network tab, the avatar `<img src>` is a **signed** URL (`?token=...`), not a public URL.
- [ ] Copy the storage path and try to fetch it without a token → denied (bucket is private).
- [ ] Replace the photo → old file removed from the `avatars` bucket (no orphan).
- [ ] Delete a person who had a photo → their avatar file is pruned.

## Exports
- [ ] "Download JSON" → file downloads; open it → contains `names` (all languages) + `rels`, and **no** `avatar` fields.
- [ ] "Download PNG" → file downloads; the image includes photos and the full tree (not just the viewport).

## Multilingual display
- [ ] Toggle the language selector → all card names switch language; missing names fall back (selected → English → first available), no blank cards.
- [ ] The edit form labels read e.g. "First name (English)" / "First name (中文 (繁體))", not raw ids.
- [ ] The selection persists across reloads (localStorage).
