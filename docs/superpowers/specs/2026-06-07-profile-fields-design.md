# Profile Fields — Contact + Deceased/Dates — Design

> **Status:** approved design, pre-implementation.
> **Date:** 2026-06-07
> **Worktree:** A (`feat/profile-fields`)
> Architecture reference: [`docs/spec.md`](../../spec.md) §7 (data model), §8 (name adapter & card display).

---

## 1. Goal

Add per-person **contact** info (email, phone, WeChat, Instagram, Facebook,
LinkedIn — **no Twitter/X**) and **deceased** status (a flag + death date). Contact
info is entered in the edit form and viewed via a click-to-open popup on the card.
Deceased people get a dimmed card and a life-date range line.

No database migration — every new field rides in the existing `tree_data.data`
JSONB. The write adapter (`mergePersonUpdate`) already passes arbitrary non-name
keys through, and the read adapter (`toDisplayPerson`) spreads them onto the
display shape, so persistence is largely free; the work is form fields, card
rendering, the popup, and tests.

## 2. Data model (additions to `PersonData`, `app/src/types.ts`)

All optional. Stored flat under `data` (siblings of `gender`, `birthday`, `avatar`):

| Field | Type | Notes |
|---|---|---|
| `email` | `string` | |
| `phone` | `string` | free text (no format enforcement) |
| `wechat` | `string` | WeChat ID |
| `instagram` | `string` | handle or URL, stored as entered |
| `facebook` | `string` | |
| `linkedin` | `string` | |
| `deceased` | `boolean` | true ⇒ dimmed card + dates treated as life range |
| `death_date` | `string` | ISO `YYYY-MM-DD`, like `birthday` |

`DisplayPerson.data` already has an index signature, so these flow through the
read adapter without per-field code.

## 3. Form (`buildFormFields()` in `app/src/lang.ts`)

Field order: first name, last name, Chinese name, birthday, **deceased**,
**death date**, **contact block** (email, phone, wechat, instagram, facebook,
linkedin), profile photo.

- All new labels come from `i18n.ts` via `t(...)` (see §6).
- `death_date` is declared as a `text` field and **upgraded to a native date
  picker** in the existing form MutationObserver in `tree.ts` (same treatment
  `birthday` already gets; `max = today`).
- `deceased` is declared as a field and **rendered as a checkbox** in the form
  hook. Persisted as a real boolean by `mergePersonUpdate` (coerce the form
  value: checked ⇒ `true`; absent/empty ⇒ delete the key).
- The six contact inputs are grouped under a collapsible **"Contact info"**
  fieldset (reuse the existing `.lang-fields` styling) so the form isn't a wall
  of mostly-empty inputs. Collapsed by default when the person has no contact
  values; expanded when any are set.

## 4. Write adapter (`mergePersonUpdate`)

- Contact strings: already pass through into `rest`. Add explicit handling only
  to **trim** and **delete empty** keys (don't persist `""`), matching how names
  are handled.
- `deceased`: coerce to boolean; delete when false/empty.
- `death_date`: trim; delete when empty.

## 5. Card rendering (`app/src/tree.ts`, `app/src/lang.ts`, `app/src/styles.css`)

### Life-dates line
Replace the current card line 3 (`birthday`) with a `lifeDates(data)` helper in
`lang.ts`:

- Living, birthday known → birth year (e.g. `1940`). (Full date felt noisy on the
  card; year is the genealogy convention. Keep it to the year.)
- Deceased, both known → `1940–2012`.
- Deceased, only death known → `–2012`.
- Deceased, only birth known → `1940–`.
- Neither → empty string.

Uses the year parsed from the ISO date. Unit-tested in `lang.test.ts`.

### Dimming
In `setOnCardUpdate` (`tree.ts`), toggle a `card-deceased` class on the card when
`d.data.deceased`. `styles.css` dims it (e.g. reduced opacity + slight
desaturation) **without** hiding the photo or making text unreadable. Exact
values at implementer's discretion; must remain legible in both genders' card
colors.

## 6. i18n (`app/src/i18n.ts`)

Add keys (en / zh-Hans / zh-Hant): `email`, `phone`, `wechat`, `instagram`,
`facebook`, `linkedin`, `deceased`, `deathDate`, `contactInfo` (fieldset legend),
`noContactInfo` (popup empty state), `contactPopupTitle`. `I18nKey` stays the
type guard, so a missing translation is a typecheck error.

## 7. Click-to-view contact popup

A small app-level popup (modeled on the existing `openImageLightbox` in
`tree.ts` — no library changes):

- An **info button** (ⓘ) is injected onto a card in `setOnCardUpdate` **only when
  the person has ≥1 contact value**. Clicking it `stopPropagation()`s (so it does
  not also open the edit form) and opens the popup.
- The popup lists present contact fields as labeled rows (icon/label + value);
  email/links are anchors (`mailto:`, `https://`), phone is `tel:`. Absent fields
  are omitted. Title from `t('contactPopupTitle')`; if somehow empty, show
  `t('noContactInfo')`.
- Dismiss on overlay click or `Escape` (reuse the lightbox pattern).
- Works in both editor and view-only modes (it's independent of card click).

## 8. Testing

Extend `app/src/lang.test.ts` (Vitest):

- `lifeDates`: all five branches in §5.
- Round-trip: a person with contact fields + `deceased`/`death_date` survives
  `mergePersonUpdate` → stored → `toDisplayPerson`; empty values are dropped, not
  stored as `""`; `deceased` stays a real boolean.
- `buildFormFields()` includes the new fields with non-empty labels.

Build TDD: write each test red first, then implement (per
`superpowers:test-driven-development`).

## 9. Files touched

- `app/src/types.ts` — extend `PersonData`.
- `app/src/lang.ts` — `buildFormFields`, `mergePersonUpdate`, new `lifeDates`.
- `app/src/i18n.ts` — new keys (append in a clearly-commented block to ease the
  cross-worktree merge).
- `app/src/tree.ts` — card line 3 → `lifeDates`; `card-deceased` class; date-picker
  upgrade for `death_date`; deceased checkbox; contact fieldset; info button +
  contact popup.
- `app/src/styles.css` — `.card-deceased` dimming; popup + info-button styles;
  contact fieldset.
- `app/src/lang.test.ts` — new tests.
- `docs/spec.md` / `docs/roadmap.md` — append this feature (own section / entries).

## 10. Out of scope / non-goals

- No card-face display of contact values (popup only).
- No phone/email format validation.
- No kinship logic (Worktree B; UI wiring is a post-merge integration pass).
