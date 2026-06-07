# Family Tree App — Roadmap

> Working checklist of implementation items. Check items off (`- [x]`) as they land.
> Architecture reference: [`docs/spec.md`](spec.md).
>
> **Last updated:** 2026-06-07

---

## Done

- [x] **Contact fields + deceased/dates** — per-person email, phone, WeChat, Instagram,
      Facebook, LinkedIn (stored in `data` JSONB; no migration). Contact info shows in a
      click-to-view popup (ⓘ on the card); the edit form groups it in a collapsible
      fieldset. Deceased flag + death date: deceased cards are dimmed and card line 3
      shows life dates ("1940–2012"). *(see spec.md §13)*
- [x] **Chinese kinship calculator** — set any person as the "source" (称 button on the
      card) and every card shows the exact Chinese term relative to them (父亲 / 外婆 /
      二舅 / 表妹 …). Engine `app/src/kinship/` walks the `rels` graph → Chinese relation
      chain (birthday-driven 哥/弟 seniority) → `relationship.js` (MIT) for the term;
      source persisted per-viewer in localStorage. *(see spec.md §13)*

- [x] **CJK glyphs on cards** — Chinese card text rendered as tofu/blank because the
      library CSS locked `.f3` to `'Roboto'` (no CJK glyphs). Fixed with a
      higher-specificity card-text font override carrying a cross-platform CJK
      fallback stack in `app/src/styles.css`. Cards now always show the Chinese
      name as the primary line (`cardPrimaryName` no longer keys off the UI toggle).
      *(see spec.md §11)*

- [x] Vite app scaffold consuming the `family-chart` library via `@lib` alias
- [x] Supabase data layer (`tree_data` JSONB, optimistic version lock, snapshots trigger)
- [x] Private RLS model (`is_allowlisted` / `is_owner` over JWT email)
- [x] Multilingual name model + read/write adapter (English `{first,last}` + Chinese `{full}`)
- [x] Full UI i18n — English / 简体中文 / 繁體中文 toggle
- [x] Profile photos: private bucket, signed URLs, custom translatable photo picker, click-to-expand
- [x] Birthday upgraded to native date picker (no future dates)
- [x] Download tree as JSON (structure + names, no photos) and PNG (full tree)
- [x] Local dev mode — `?local=true` (dev builds only) / `VITE_LOCAL_MODE`, no Supabase needed
- [x] **Auth: shared family password** replaces magic-link; removed in-app access-request/admin flow
- [x] Deploy to GitHub Pages — `deploy.yml` (npm, typecheck + unit tests, `VITE_*` secrets, base path)
- [x] Live verification: shared-password login renders the tree on the deployed site
- [x] Off-site daily backup repo (`family-chart-data`, private) — cron export of `tree_data.data` + owner-gated restore script
- [x] **Backups encrypted at rest** — committed as AES-256-GCM `tree-data.json.enc` (key in `BACKUP_ENC_KEY` secret); migrated to a fresh repo (`family-chart-data`) so no plaintext remains in history; old `family-tree-backups` repo deleted

---

## In progress / open

_(nothing currently in progress)_

---

## Cleanup / tech debt

- [ ] Remove the unused `access_requests` table + RLS policies from `supabase/schema.sql`
      (leftover from the magic-link/request design; app no longer touches it)
- [ ] Update `app/README.md` to the current password-auth design (still describes magic-link setup)
- [ ] Revisit snapshot retention (currently 20). Off-site backup now covers catastrophic
      loss; decide whether to raise/parametrize the in-DB retention count.

---

## Backlog / deferred (schema-ready, no UI yet)

- [ ] In-app snapshot / history / restore UI
- [ ] Audit-log viewer (`audit_log` is populated but unsurfaced)
- [ ] Additional languages (config + label only, no schema change)
- [ ] Per-person extra attributes (notes, occupation, birthplace) — all fit in `data` JSONB
- [ ] Tree filters (maternal/paternal, generation depth) — frontend-only
- [ ] Multiple named trees (everything is already `tree_id`-scoped)
