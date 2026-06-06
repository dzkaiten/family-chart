# Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase magic-link + email-allowlist auth with a shared-password login (`signInWithPassword`), keeping the owner's personal admin login intact and deleting the now-dead request-access flow and admin panel.

**Architecture:** Supabase still owns auth (sessions, token refresh, RLS) and all tree data. The only change is the *gate*: the login screen becomes an email + password form. The email is pre-filled from `VITE_FAMILY_EMAIL` (the shared family account); the owner clears it and signs in with their own credentials. Roles still come from the existing `allowed_emails` table via the unchanged `fetchMyRole`. No schema changes.

**Tech Stack:** TypeScript, Vite, `@supabase/supabase-js`, Vitest (node env — no DOM tests).

**Spec:** `docs/superpowers/specs/2026-06-05-password-auth-design.md`

---

## Verification strategy (read first)

This change is a Supabase-API swap (`signInWithOtp` → `signInWithPassword`), a DOM-form rewrite, and deletion of dead code. The Vitest env is `node` (see `vitest.setup.ts` / `environment: 'node'`), so the login view and auth call are **not** unit-testable here, and the existing suite is all pure functions (lang/persist/export/storage). The real safety net is therefore:

1. **`npm run typecheck`** — `tsc -p app/tsconfig.json --noEmit`. With every consumer/provider edited together (see task ordering), this catches any dangling import, removed symbol, or type mismatch. This is the primary gate after each task.
2. **`npm run test:unit`** — regression; must stay 19/19 green.
3. **Manual smoke** (final task) — log in with the shared password, then as owner.

Each task is ordered so the tree stays **typecheck-green and committable** at its end.

## Decisions resolved beyond the spec

- **`logAudit` (db.ts) and `setText` (ui.ts) become uncalled** after the request flow and admin panel are deleted. Both are generic, reusable helpers tied to existing infrastructure (the `audit_log` table; DOM text setting). `noUnusedLocals` is not enabled, so they do not break typecheck. **Keep both** — removing them is out of scope and they are plausible future infra. Do not add comments about it.
- **`session.role === null` branch** (main.ts) previously rendered the "awaiting approval" pending view. With `renderPendingView` deleted, a null role now means *authenticated against Supabase but not in `allowed_emails`* — i.e. a misconfiguration (e.g. the family email was never allowlisted). New behavior: show an error toast and `signOut()`, which bounces the user back to the login screen. This is the deliberate replacement, documented inline in code.

## File structure

| File | Change | Responsibility after change |
|------|--------|------------------------------|
| `app/src/config.ts` | Modify | Add `FAMILY_EMAIL` env export |
| `app/.env` | Modify | Add `VITE_FAMILY_EMAIL` (gitignored; local only) |
| `app/src/auth.ts` | Modify | `signInWithPassword` replaces `sendMagicLink` |
| `app/src/views.ts` | Rewrite | Single `renderLoginView` (email + password); request/pending views deleted |
| `app/src/main.ts` | Modify | Login wiring; null-role bounce; admin wiring removed |
| `app/src/admin.ts` | **Delete** | (gone) |
| `app/src/db.ts` | Modify | Request CRUD removed; `AccessRequest` import dropped |
| `app/src/types.ts` | Modify | `AccessRequest` interface removed |
| `app/index.html` | Modify | Admin button/badge removed |

Two implementation tasks (Task 1 = login swap, Task 2 = dead-code removal), then verification. They split this way because each is a self-contained slice that leaves typecheck green: Task 1 swaps the consumer-facing login path while the old request/admin code still compiles as unused exports; Task 2 removes that now-unreferenced backend plus the admin panel together (provider + its only consumer in one commit).

---

## Task 0: Create isolated branch

**Files:** none (git only)

- [ ] **Step 1: Branch off master**

The spec is already committed on `master` (commit `d7809b1`) — that's fine, it's documentation. Create the feature branch for implementation:

Run:
```bash
cd /home/dzkaiten/dev/family-chart
git checkout master
git checkout -b password-auth
```

Expected: `Switched to a new branch 'password-auth'`

(Worktree isolation is optional; if desired, the executor sets it up via the `superpowers:using-git-worktrees` skill instead of a plain branch.)

---

## Task 1: Swap login to email + password

**Files:**
- Modify: `app/src/config.ts` (add `FAMILY_EMAIL`)
- Modify: `app/.env` (add `VITE_FAMILY_EMAIL`)
- Modify: `app/src/auth.ts` (replace `sendMagicLink`)
- Rewrite: `app/src/views.ts`
- Modify: `app/src/main.ts` (login import + null-role branch)

- [ ] **Step 1: Add `FAMILY_EMAIL` to config**

In `app/src/config.ts`, after the `TREE_ID` line (currently line 7), add:

```ts
// Shared family Supabase account email, pre-filled on the login screen.
// Falls back to '' so the field renders empty (not "undefined") when unset.
export const FAMILY_EMAIL = (import.meta.env.VITE_FAMILY_EMAIL as string) ?? '';
```

Do **not** add `FAMILY_EMAIL` to the existing `if (!SUPABASE_URL || ...)` fatal check — an empty pre-fill is harmless, not fatal.

- [ ] **Step 2: Add the env var**

In `app/.env`, append:

```
# Shared family Supabase account email — pre-filled on the login screen.
# Family members type the shared password; the owner clears it and signs in
# with their own email + password for admin access.
VITE_FAMILY_EMAIL=family@yourname.com
```

(`app/.env` is gitignored, so this is not committed. The README/spec documents the requirement for other deployers.)

- [ ] **Step 3: Replace `sendMagicLink` with `signInWithPassword` in `auth.ts`**

In `app/src/auth.ts`, replace the entire `sendMagicLink` function:

```ts
export async function sendMagicLink(_email: string): Promise<void> {
  if (LOCAL_MODE) return;
  const { error } = await supabase.auth.signInWithOtp({
    email: _email,
    options: {
      emailRedirectTo: window.location.origin + window.location.pathname,
      shouldCreateUser: true
    }
  });
  if (error) throw error;
}
```

with:

```ts
export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (LOCAL_MODE) return;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}
```

Leave `getCurrentSession`, `signOut`, and `onAuthStateChange` unchanged.

- [ ] **Step 4: Rewrite `views.ts` as a single password login view**

Replace the **entire contents** of `app/src/views.ts` with:

```ts
// Login view. The tree itself renders into the same root via tree.ts.

import { signInWithPassword } from './auth';
import { FAMILY_EMAIL } from './config';
import { el, showToast } from './ui';

export function renderLoginView(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = el('div', { className: 'view-centered' });
  const card = el('div', { className: 'card' });

  card.appendChild(el('h2', {}, ['Sign in']));
  card.appendChild(el('p', {}, [
    'Enter the family password to view and edit the tree.'
  ]));

  const emailField = el('div', { className: 'field' });
  emailField.appendChild(el('label', { htmlFor: 'login-email' }, ['Email']));
  const emailInput = el('input', {
    id: 'login-email',
    type: 'email',
    value: FAMILY_EMAIL,
    required: true
  });
  emailField.appendChild(emailInput);
  card.appendChild(emailField);

  const pwField = el('div', { className: 'field' });
  pwField.appendChild(el('label', { htmlFor: 'login-password' }, ['Password']));
  const pwInput = el('input', {
    id: 'login-password',
    type: 'password',
    required: true
  });
  pwField.appendChild(pwInput);
  card.appendChild(pwField);

  const signIn = el('button', { className: 'btn', type: 'button' }, ['Sign in']);
  const btnRow = el('div', { className: 'btn-row' });
  btnRow.appendChild(signIn);
  card.appendChild(btnRow);

  async function submit(): Promise<void> {
    const email = emailInput.value.trim();
    const password = pwInput.value;
    if (!email || !password) {
      showToast('Enter email and password', 'error');
      return;
    }
    signIn.setAttribute('disabled', 'true');
    try {
      await signInWithPassword(email, password);
      // On success, onAuthStateChange (main.ts) re-mounts the tree.
    } catch (err) {
      showToast(`Sign in failed: ${(err as Error).message}`, 'error');
      signIn.removeAttribute('disabled');
    }
  }

  signIn.addEventListener('click', () => { void submit(); });
  pwInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') void submit();
  });

  wrap.appendChild(card);
  root.appendChild(wrap);
}
```

This deletes `renderRequestView` and `renderPendingView` (they no longer exist) and drops the `submitAccessRequest` import.

- [ ] **Step 5: Update `main.ts` login wiring**

In `app/src/main.ts`, change the views import (line 13):

```ts
import { renderLoginView, renderPendingView } from './views';
```
to:
```ts
import { renderLoginView } from './views';
```

Then replace the null-role branch inside `mount()`:

```ts
  if (session.role === null) {
    showHeaderForUnauthed();
    renderPendingView(viewRoot, session.email);
    return;
  }
```
with:
```ts
  if (session.role === null) {
    // Authenticated against Supabase but not in allowed_emails — the account
    // isn't authorized for this tree (e.g. the family email was never
    // allowlisted). Surface the error and bounce back to the login screen.
    showHeaderForUnauthed();
    showToast('This account is not authorized for this tree.', 'error');
    await signOut();
    return;
  }
```

(`showToast` and `signOut` are already imported in `main.ts`.) Leave the admin import, `initAdminBadge` call, `admin:exit` handler, and `showHeaderForUnauthed`'s admin lines untouched for now — they still compile and are removed in Task 2.

- [ ] **Step 6: Typecheck**

Run: `cd /home/dzkaiten/dev/family-chart && npm run typecheck`
Expected: no output (exit 0). Specifically: no "Cannot find name 'sendMagicLink'/'renderPendingView'/'renderRequestView'", no unused-symbol errors.

- [ ] **Step 7: Regression tests**

Run: `npm run test:unit`
Expected: `Test Files  4 passed (4)` / `Tests  19 passed (19)`.

- [ ] **Step 8: Commit**

```bash
git add app/src/config.ts app/src/auth.ts app/src/views.ts app/src/main.ts
git commit -m "feat(app): password login replaces magic-link auth

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

(`app/.env` is gitignored and intentionally not staged.)

---

## Task 2: Remove admin panel and access-request backend

**Files:**
- Delete: `app/src/admin.ts`
- Modify: `app/src/main.ts` (remove admin wiring)
- Modify: `app/src/db.ts` (remove request CRUD + `AccessRequest` import)
- Modify: `app/src/types.ts` (remove `AccessRequest`)
- Modify: `app/index.html` (remove admin button/badge)

- [ ] **Step 1: Delete `admin.ts`**

Run: `git rm app/src/admin.ts`
Expected: `rm 'app/src/admin.ts'`

- [ ] **Step 2: Remove admin wiring from `main.ts`**

Make these four edits in `app/src/main.ts`:

(a) Remove the admin import line:
```ts
import { initAdminBadge } from './admin';
```

(b) In `mountTree`, remove the trailing call:
```ts
  initAdminBadge(session.role === 'owner');
```
so the function ends after the `try/catch`.

(c) In `showHeaderForUnauthed`, remove these two lines:
```ts
  setHidden('admin-btn', true);
  setHidden('admin-badge', true);
```
(keep the `logout-btn`, `download-json-btn`, `download-png-btn` lines).

(d) Remove the admin-exit handler block:
```ts
document.addEventListener('admin:exit', async () => {
  if (currentSession?.role) await mountTree(currentSession);
});
```

- [ ] **Step 3: Remove request CRUD from `db.ts`**

In `app/src/db.ts`, delete the entire "Access requests" section — the four exported functions `submitAccessRequest`, `fetchPendingRequests`, `approveRequest`, and `denyRequest`, along with the `// Access requests` divider comment above them. Stop before the "Tree data" section; **keep** `fetchTreeData`, `saveTreeData`, and the `logAudit` definition at the bottom (logAudit stays — see Decisions).

Then drop the now-unused type import. Change:
```ts
import type {
  AccessRequest,
  AllowedEmail,
  StoredPerson,
  TreeDataRow,
  TreeMeta
} from './types';
```
to:
```ts
import type {
  AllowedEmail,
  StoredPerson,
  TreeDataRow,
  TreeMeta
} from './types';
```
(`AllowedEmail` is still used by `fetchAllowedEmails`; keep it.)

- [ ] **Step 4: Remove `AccessRequest` from `types.ts`**

In `app/src/types.ts`, delete the entire `AccessRequest` interface:
```ts
export interface AccessRequest {
  id: string;
  tree_id: string;
  name: string;
  email: string;
  status: 'pending' | 'approved' | 'denied';
  requested_role: string;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}
```

- [ ] **Step 5: Remove admin button/badge from `index.html`**

In `app/index.html`, delete:
```html
        <button id="admin-btn" class="btn btn-ghost hidden" type="button">
          Pending <span id="admin-badge" class="badge hidden">0</span>
        </button>
```
(leave the `lang-toggle`, download, and logout controls intact).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no output (exit 0). No "Cannot find module './admin'", no "Cannot find name 'AccessRequest'/'initAdminBadge'", no unresolved references.

- [ ] **Step 7: Regression tests**

Run: `npm run test:unit`
Expected: `Tests  19 passed (19)`.

- [ ] **Step 8: Commit**

```bash
git add app/src/main.ts app/src/db.ts app/src/types.ts app/index.html
git commit -m "refactor(app): remove access-request flow and admin panel

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck + tests + build**

Run:
```bash
npm run typecheck && npm run test:unit && npm run app:build
```
Expected: typecheck clean, 19/19 tests pass, Vite build completes with no errors.

- [ ] **Step 2: Confirm no dangling references**

Run:
```bash
grep -rn "sendMagicLink\|renderPendingView\|renderRequestView\|submitAccessRequest\|fetchPendingRequests\|approveRequest\|denyRequest\|initAdminBadge\|AccessRequest\|admin-btn\|admin-badge\|admin:exit\|from './admin'" app/src/ app/index.html
```
Expected: **no output** (every reference removed).

- [ ] **Step 3: Manual smoke — local bypass still works**

Run: `npm run dev`, open `http://localhost:5173/?local=true`.
Expected: boots straight to the tree as owner (login bypassed). Confirms local-mode untouched.

- [ ] **Step 4: Manual smoke — password login**

Open `http://localhost:5173/` (no `?local`). Precondition: the shared family user exists in Supabase (dashboard → Authentication → Users) and its email is in `allowed_emails` with `role='editor'`; `VITE_FAMILY_EMAIL` is set in `app/.env`.
Expected: login screen shows email pre-filled with the family address + a password field. Entering the shared password loads the tree (editor). Entering a wrong password shows a "Sign in failed" toast.

- [ ] **Step 5: Manual smoke — owner login**

On the login screen, clear the email, type the owner's personal email + password (must be in `allowed_emails` with `role='owner'`).
Expected: tree loads. (Admin panel is gone by design; owner role now only governs RLS-level privileges, not UI.)

- [ ] **Step 6: Report results**

Report the actual output of Steps 1–2 and the observed behavior of Steps 3–5. Do not claim success without the command output.

---

## Self-review

- **Spec coverage:** config `VITE_FAMILY_EMAIL` (T1.S1–2) ✓; `signInWithPassword` replaces `sendMagicLink` (T1.S3) ✓; pre-filled editable email + password UI (T1.S4) ✓; remove `renderRequestView`/`renderPendingView` (T1.S4–5) ✓; remove `submitAccessRequest`/`fetchPendingRequests`/`approveRequest`/`denyRequest` (T2.S3) ✓; delete `admin.ts` + button/badge (T2.S1,S2,S5) ✓; remove `AccessRequest` (T2.S4) ✓; `fetchMyRole`/`allowed_emails`/RLS unchanged ✓ (not touched by any task); local mode unchanged ✓ (not touched). All spec sections map to a task.
- **Placeholder scan:** none — every code step shows complete code; every command shows expected output.
- **Type/name consistency:** `signInWithPassword(email, password)` defined in T1.S3 and called with the same signature in T1.S4. `FAMILY_EMAIL` defined in T1.S1, imported in T1.S4. `el('input', { value })` is valid — `el<K>` returns `HTMLElementTagNameMap[K]` (i.e. `HTMLInputElement`), and `value`/`type` are valid `Partial<HTMLInputElement>` keys, so no casts needed and `.value`/`.setAttribute` resolve.
- **Green-at-commit ordering:** T1 leaves the old request/admin code as unused-but-compiling exports; T2 removes provider + sole consumer together. Both end on a passing typecheck + test gate.
