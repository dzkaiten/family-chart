# Family Tree App — Verify & Harden Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-built family-tree app (`app/`) correct, tested, type-safe, and deployable by fixing a critical save bug, restoring multilingual form labels, adding unit tests for the adapter logic, and producing verification checklists for the parts that need a live Supabase.

**Architecture:** The app is vanilla TypeScript + Vite living in `app/`, importing the `family-chart` D3 library directly from source (`../../src/index`). Data + auth + photos are in Supabase (schema in `supabase/schema.sql`), deployed to GitHub Pages via `.github/workflows/deploy.yml`. This plan does **not** rewrite the app — it repairs concrete defects found by reading the code against the real library API, and adds the missing test/typecheck safety net.

**Tech Stack:** TypeScript, Vite 6, `@supabase/supabase-js` v2, `html-to-image`, the in-repo `family-chart` library, Cypress (existing e2e), Vitest (added by this plan).

**Why this plan exists (context for the implementer):** A prior commit ("Add private family tree web app") implemented essentially the whole spec. Reading it against the library source surfaced a critical bug: `app/src/tree.ts` calls `chart.getStore()`, but the library's `Chart` class (`src/core/chart.ts`) has **no `getStore()` method** — it exposes a public `store` property and a `getMainDatum()` method, and the documented way to read edited data is `editTree().exportData()` (see `src/core/edit.ts:501` and `examples/htmls/v2/18-edit-tree-get-data-on-change.html`). Because `TreeState.chart` is typed `any`, the compiler never caught it. Net effect: **every save throws a `TypeError` at runtime**. This plan fixes that and hardens around it.

---

## File Structure

Files this plan creates or modifies:

- **Create** `vitest.config.ts` — Vitest config (node env, scoped to `app/src`).
- **Create** `app/src/persist.ts` — pure mapping from the library's exported data → the persisted `StoredPerson[]` shape (extracted from `tree.ts` so it is unit-testable).
- **Create** `app/src/lang.test.ts` — unit tests for the multilingual adapter (fallback chain, round-trip, form-field labels).
- **Create** `app/src/persist.test.ts` — unit tests for the save mapping (avatar path preservation, name stripping, rels defaults).
- **Create** `app/src/storage.test.ts` — unit test for `isStoragePath`.
- **Create** `app/src/export.test.ts` — unit test for `stripAvatars`.
- **Create** `cypress/e2e/app-smoke.cy.js` — e2e smoke that stubs Supabase and proves the save path works end-to-end (catches the `getStore` class of bug behaviorally).
- **Create** `docs/superpowers/backend-verification-checklist.md` — manual checklist for the live-Supabase behaviors that can't be unit-tested locally.
- **Modify** `app/src/tree.ts` — fix the critical save bug, type `TreeState`, use `editTree().exportData()`, fix the form-label regression, delegate mapping to `persist.ts`, fix `readPersonIdFromForm`.
- **Modify** `app/src/lang.ts` — allow clearing a non-active-language name; keep exports stable.
- **Modify** `app/src/storage.ts` — `export` `isStoragePath` for testing (no behavior change).
- **Modify** `app/src/export.ts` — `export` `stripAvatars` for testing (no behavior change).
- **Modify** `package.json` — add `vitest` (+ `jsdom`) devDeps and `test:unit` / `typecheck` scripts.
- **Modify** `.github/workflows/deploy.yml` — run `typecheck` and `test:unit` before building.
- **Modify** `supabase/schema.sql` — fix the stale `.claude/SPEC.md` comment.
- **Modify** `app/README.md` — drop the unnecessary "build the library first" step.

Conventions to follow (match the existing code): 2-space indentation, single quotes, no semicolon-free style (the app uses semicolons), `type`-only imports where possible, small focused modules.

---

## Task 0: Test & typecheck tooling

**Files:**
- Modify: `package.json` (devDependencies + scripts)
- Create: `vitest.config.ts`

- [ ] **Step 1: Add Vitest + jsdom as dev dependencies**

Run:
```bash
cd /home/dzkaiten/dev/family-chart
yarn add -D vitest@^2 jsdom@^25
```
Expected: both packages added to `devDependencies` in `package.json`, `yarn.lock` updated, exit 0.

- [ ] **Step 2: Add `test:unit` and `typecheck` scripts**

In `package.json`, add to the `"scripts"` block (after `"test-run"`):
```json
    "test:unit": "vitest run",
    "test:unit:watch": "vitest",
    "typecheck": "tsc -p app/tsconfig.json --noEmit",
```

- [ ] **Step 3: Create the Vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

// Unit tests cover the app's pure logic (adapters, mapping). They run in the
// node environment; nothing here needs a DOM. The @lib alias mirrors
// app/vite.config.ts so test imports resolve the same way the app does.
export default defineConfig({
  resolve: {
    alias: {
      '@lib': resolve(__dirname, 'src')
    }
  },
  test: {
    environment: 'node',
    include: ['app/src/**/*.test.ts'],
    globals: false
  }
});
```

- [ ] **Step 4: Add a throwaway smoke test to prove the runner works**

Create `app/src/_smoke.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('vitest runner', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: Run the test runner**

Run: `cd /home/dzkaiten/dev/family-chart && yarn test:unit`
Expected: PASS — `1 passed`. If `yarn install` was never run, run `yarn install` first.

- [ ] **Step 6: Run the typecheck and record the baseline**

Run: `cd /home/dzkaiten/dev/family-chart && yarn typecheck`
Expected: either exit 0, OR a list of errors. **If errors come only from `../src` (the library), not `app/src`:** narrow the app typecheck so it can catch app regressions without being blocked by pre-existing library issues — change `app/tsconfig.json` `"include"` from `["src", "../src"]` to `["src"]` (the app still imports `../../src/...`, which tsc follows for the symbols it uses, but stops whole-library inclusion). Re-run until the only remaining errors, if any, are real app bugs this plan fixes (notably the `getStore` fix in Task 3 should *remove* errors, never add them).

- [ ] **Step 7: Delete the smoke test and commit tooling**

```bash
cd /home/dzkaiten/dev/family-chart
rm app/src/_smoke.test.ts
git add package.json yarn.lock vitest.config.ts app/tsconfig.json
git commit -m "chore: add vitest + typecheck tooling for the app"
```

---

## Task 1: Unit-test and verify the language adapter (`lang.ts`)

These tests encode the spec's multilingual requirements (fallback chain: selected → `en` → first available; English-only stored; round-trip without forking the library). The adapter already exists; the tests lock in its behavior and surface the one real gap (clearing a non-active-language name).

**Files:**
- Test: `app/src/lang.test.ts`
- Modify: `app/src/lang.ts`

- [ ] **Step 1: Write failing/characterization tests for the read adapter**

Create `app/src/lang.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { toDisplayPerson, mergePersonUpdate, buildFormFields } from './lang';
import { setLanguage } from './lang';
import type { StoredPerson } from './types';

function person(names: StoredPerson['data']['names']): StoredPerson {
  return { id: 'p1', data: { names }, rels: { parents: [], spouses: [], children: [] } };
}

describe('toDisplayPerson (read adapter)', () => {
  it('uses the selected language when present', () => {
    const d = toDisplayPerson(person({
      en: { first: 'John', last: 'Smith' },
      'zh-Hant': { first: '約翰', last: '史密斯' }
    }), 'zh-Hant');
    expect(d.data.first_name).toBe('約翰');
    expect(d.data.last_name).toBe('史密斯');
  });

  it('falls back to English when the selected language is missing', () => {
    const d = toDisplayPerson(person({ en: { first: 'John', last: 'Smith' } }), 'zh-Hant');
    expect(d.data.first_name).toBe('John');
  });

  it('falls back to the first available name when neither selected nor English exist', () => {
    const d = toDisplayPerson(person({ 'zh-Hans': { first: '约翰', last: '史密斯' } }), 'en');
    expect(d.data.first_name).toBe('约翰');
  });

  it('exposes non-active languages as suffixed fields for the edit form', () => {
    const d = toDisplayPerson(person({
      en: { first: 'John', last: 'Smith' },
      'zh-Hant': { first: '約翰', last: '史密斯' }
    }), 'en');
    expect(d.data['first_name__zh-Hant']).toBe('約翰');
    expect(d.data['last_name__zh-Hant']).toBe('史密斯');
    expect(d.data['first_name__zh-Hans']).toBe('');
  });
});
```

- [ ] **Step 2: Run them**

Run: `cd /home/dzkaiten/dev/family-chart && yarn test:unit app/src/lang.test.ts`
Expected: PASS (these characterize existing correct behavior). If any fail, the read adapter has a bug — fix `resolveName`/`toDisplayPerson` in `lang.ts` to satisfy the spec fallback chain before moving on.

- [ ] **Step 3: Write the round-trip (write adapter) tests, including the clear-name gap**

Append to `app/src/lang.test.ts`:
```typescript
describe('mergePersonUpdate (write adapter)', () => {
  const existing: StoredPerson = {
    id: 'p1',
    data: { names: { en: { first: 'John', last: 'Smith' } }, gender: 'M' },
    rels: { parents: [], spouses: [], children: [] }
  };

  it('round-trips all configured languages back into the names map', () => {
    const out = mergePersonUpdate(existing, {
      first_name: 'Johnny', last_name: 'Smith',
      'first_name__zh-Hant': '強尼', 'last_name__zh-Hant': '史',
      'first_name__zh-Hans': '', 'last_name__zh-Hans': '',
      gender: 'M', birthday: '2000-01-01', avatar: 'tree/p1/x.jpg'
    }, 'en');

    expect(out.names.en).toEqual({ first: 'Johnny', last: 'Smith' });
    expect(out.names['zh-Hant']).toEqual({ first: '強尼', last: '史' });
    expect(out.names['zh-Hans']).toBeUndefined();
    expect(out.gender).toBe('M');
    expect(out.birthday).toBe('2000-01-01');
  });

  it('does not leak the library flat name fields into stored data', () => {
    const out = mergePersonUpdate(existing, {
      first_name: 'Johnny', last_name: 'Smith'
    }, 'en') as Record<string, unknown>;
    expect(out.first_name).toBeUndefined();
    expect(out.last_name).toBeUndefined();
    expect(out['first_name__zh-Hant']).toBeUndefined();
  });

  it('clears a previously-set non-active language name when the field is emptied', () => {
    const withZh: StoredPerson = {
      id: 'p1',
      data: { names: { en: { first: 'John', last: 'Smith' }, 'zh-Hant': { first: '約翰', last: '史密斯' } } },
      rels: { parents: [], spouses: [], children: [] }
    };
    const out = mergePersonUpdate(withZh, {
      first_name: 'John', last_name: 'Smith',
      'first_name__zh-Hant': '', 'last_name__zh-Hant': ''
    }, 'en');
    expect(out.names['zh-Hant']).toBeUndefined();
  });
});

describe('buildFormFields (form labels)', () => {
  it('produces human-readable labels per language', () => {
    setLanguage('en');
    const fields = buildFormFields();
    const enFirst = fields.find(f => f.name === 'first_name');
    const zhFirst = fields.find(f => f.name === 'first_name__zh-Hant');
    expect(enFirst?.label).toMatch(/English/);
    expect(zhFirst?.label).toMatch(/繁體/);
  });
});
```

- [ ] **Step 4: Run; expect the clear-name test to FAIL**

Run: `cd /home/dzkaiten/dev/family-chart && yarn test:unit app/src/lang.test.ts`
Expected: the "clears a previously-set non-active language name" test FAILS. Current `mergePersonUpdate` only writes a language entry when `first || last` is truthy, so emptying the inputs leaves the stale entry from `existing`. Everything else PASSES.

- [ ] **Step 5: Fix `mergePersonUpdate` to honor explicit clears**

In `app/src/lang.ts`, replace the per-language loop inside `mergePersonUpdate`:
```typescript
  // For every configured language, extract the first/last fields from the form
  for (const { code } of LANGUAGES) {
    const firstKey = code === activeLanguage ? 'first_name' : `first_name__${code}`;
    const lastKey = code === activeLanguage ? 'last_name' : `last_name__${code}`;
    const first = readString(formData[firstKey]);
    const last = readString(formData[lastKey]);
    if (first || last) {
      baseNames[code] = { first, last };
    }
  }
```
with:
```typescript
  // For every configured language, extract the first/last fields from the form.
  // A field that is present but empty is an explicit clear: drop that language
  // entry rather than keeping a stale value. A field that is absent is left
  // untouched (so partial form payloads don't wipe other languages).
  for (const { code } of LANGUAGES) {
    const firstKey = code === activeLanguage ? 'first_name' : `first_name__${code}`;
    const lastKey = code === activeLanguage ? 'last_name' : `last_name__${code}`;
    const firstPresent = firstKey in formData;
    const lastPresent = lastKey in formData;
    if (!firstPresent && !lastPresent) continue;
    const first = readString(formData[firstKey]);
    const last = readString(formData[lastKey]);
    if (first || last) baseNames[code] = { first, last };
    else delete baseNames[code];
  }
```

- [ ] **Step 6: Run; expect all green**

Run: `cd /home/dzkaiten/dev/family-chart && yarn test:unit app/src/lang.test.ts`
Expected: PASS (all). 

- [ ] **Step 7: Commit**

```bash
cd /home/dzkaiten/dev/family-chart
git add app/src/lang.ts app/src/lang.test.ts
git commit -m "test: cover multilingual adapter; allow clearing non-active language names"
```

---

## Task 2: Extract a pure save-mapping module and test it

`displayToStored` in `tree.ts` reads module-level `state`, so it can't be tested and forces the whole save path through the DOM. Extract the pure mapping into `app/src/persist.ts` so the avatar-path and name logic is unit-testable, then have `tree.ts` call it (wired in Task 3).

**Files:**
- Create: `app/src/persist.ts`
- Test: `app/src/persist.test.ts`

- [ ] **Step 1: Create the pure mapping module**

Create `app/src/persist.ts`:
```typescript
import { mergePersonUpdate } from './lang';
import type { LanguageCode } from './config';
import type { DisplayPerson, StoredPerson } from './types';

// Pure mapping from the library's exported data (flat name fields + signed-URL
// avatars) back into the persisted StoredPerson shape (language-keyed names +
// storage-path avatars). Kept free of module state so it is unit-testable.
//
// Avatar resolution rules (matching the read adapter in storage.ts):
//   - empty / missing            -> no avatar
//   - an http(s) URL (a signed   -> restore the original storage path we last
//     URL the library still has)     knew for this person (the library only
//                                     ever sees signed URLs, never paths)
//   - a bare path (freshly        -> use it as-is
//     uploaded via the form)
export function mapExportedToStored(
  exported: DisplayPerson[],
  originalById: Map<string, StoredPerson>,
  avatarPaths: Map<string, string>,
  activeLanguage: LanguageCode
): StoredPerson[] {
  return exported.map(d => {
    const original = originalById.get(d.id) ?? null;

    const a = d.data.avatar;
    let avatarPath: string | undefined;
    if (typeof a !== 'string' || a === '') avatarPath = undefined;
    else if (a.startsWith('http://') || a.startsWith('https://')) avatarPath = avatarPaths.get(d.id);
    else avatarPath = a;

    const newData = mergePersonUpdate(original, d.data, activeLanguage);
    if (avatarPath) newData.avatar = avatarPath;
    else delete (newData as Record<string, unknown>).avatar;

    return {
      id: d.id,
      data: newData,
      rels: {
        parents: Array.isArray(d.rels?.parents) ? (d.rels.parents as string[]) : [],
        spouses: Array.isArray(d.rels?.spouses) ? (d.rels.spouses as string[]) : [],
        children: Array.isArray(d.rels?.children) ? (d.rels.children as string[]) : []
      }
    };
  });
}

export function buildOriginalIndex(people: StoredPerson[]): Map<string, StoredPerson> {
  const m = new Map<string, StoredPerson>();
  for (const p of people) m.set(p.id, p);
  return m;
}
```

- [ ] **Step 2: Write the tests**

Create `app/src/persist.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { mapExportedToStored, buildOriginalIndex } from './persist';
import type { DisplayPerson, StoredPerson } from './types';

const original: StoredPerson = {
  id: 'p1',
  data: { names: { en: { first: 'John', last: 'Smith' } }, avatar: 'tree/p1/old.jpg' },
  rels: { parents: [], spouses: [], children: [] }
};

function exported(over: Partial<DisplayPerson['data']>, rels?: Partial<DisplayPerson['rels']>): DisplayPerson {
  return {
    id: 'p1',
    data: { first_name: 'John', last_name: 'Smith', ...over },
    rels: { parents: [], spouses: [], children: [], ...(rels ?? {}) }
  };
}

describe('mapExportedToStored', () => {
  const idx = buildOriginalIndex([original]);

  it('restores the original storage path when the library still holds a signed URL', () => {
    const paths = new Map([['p1', 'tree/p1/old.jpg']]);
    const out = mapExportedToStored(
      [exported({ avatar: 'https://signed.example/abc' })], idx, paths, 'en'
    );
    expect(out[0].data.avatar).toBe('tree/p1/old.jpg');
  });

  it('keeps a freshly-uploaded bare path', () => {
    const out = mapExportedToStored(
      [exported({ avatar: 'tree/p1/new.jpg' })], idx, new Map(), 'en'
    );
    expect(out[0].data.avatar).toBe('tree/p1/new.jpg');
  });

  it('clears the avatar when the field is emptied', () => {
    const out = mapExportedToStored([exported({ avatar: '' })], idx, new Map(), 'en');
    expect('avatar' in out[0].data).toBe(false);
  });

  it('rebuilds the names map and strips flat fields', () => {
    const out = mapExportedToStored([exported({})], idx, new Map(), 'en');
    expect(out[0].data.names.en).toEqual({ first: 'John', last: 'Smith' });
    expect((out[0].data as Record<string, unknown>).first_name).toBeUndefined();
  });

  it('defaults missing rels arrays to empty (export drops empties)', () => {
    const d = exported({});
    delete (d.rels as Record<string, unknown>).spouses; // formatDataForExport removes empty arrays
    const out = mapExportedToStored([d], idx, new Map(), 'en');
    expect(out[0].rels.spouses).toEqual([]);
  });
});
```

- [ ] **Step 3: Run**

Run: `cd /home/dzkaiten/dev/family-chart && yarn test:unit app/src/persist.test.ts`
Expected: PASS (all 5).

- [ ] **Step 4: Commit**

```bash
cd /home/dzkaiten/dev/family-chart
git add app/src/persist.ts app/src/persist.test.ts
git commit -m "refactor: extract pure save-mapping (persist.ts) with unit tests"
```

---

## Task 3: Fix the critical save bug and type `TreeState`

Replace the non-existent `chart.getStore().getData()` with the documented `editTree().exportData()`, capture the `EditTree` instance, type `TreeState` so the compiler can catch this class of bug, and delegate mapping to `persist.ts`.

**Files:**
- Modify: `app/src/tree.ts`

- [ ] **Step 1: Add typed imports and type the state**

In `app/src/tree.ts`, add after the existing imports:
```typescript
import type { Chart } from '../../src/core/chart';
import type { EditTree } from '../../src/core/edit';
import { mapExportedToStored, buildOriginalIndex } from './persist';
```
Then replace the `TreeState` interface:
```typescript
interface TreeState {
  row: TreeDataRow;
  avatarPaths: Map<string, string>; // person id -> last known storage path
  chart: any;
  container: HTMLElement;
  canEdit: boolean;
}
```
with:
```typescript
interface TreeState {
  row: TreeDataRow;
  avatarPaths: Map<string, string>; // person id -> last known storage path
  chart: Chart | null;
  editTree: EditTree | null;
  container: HTMLElement;
  canEdit: boolean;
}
```
And update the two `state = { ... }` initializers (in `initTree`) to include `editTree: null` (and keep `chart: null`).

- [ ] **Step 2: Capture the chart + editTree instances in `render()`**

In `render()`, change the chart construction so the instances are typed and stored. Replace:
```typescript
  const f3Chart = (f3 as any).createChart(treeEl, withSigned)
    .setTransitionTime(800)
    .setCardXSpacing(250)
    .setCardYSpacing(150);

  const f3Card = f3Chart.setCard((f3 as any).CardHtml)
    .setCardDisplay([['first_name', 'last_name'], ['birthday']])
    .setMiniTree(true);

  if (state.canEdit) {
    const fields = buildFormFields().map(f => f.name);
    f3Chart.editTree()
      .setFields(fields)
      .setEditFirst(true)
      .setCardClickOpen(f3Card)
      .setOnChange(() => {
        scheduleSave();
      });
    // Inject a photo upload button into the form when it opens
    installPhotoUploadHook(state.container);
  } else {
    f3Card.setOnCardClick((_e: any, d: any) => f3Chart.updateMainId(d.data.id));
  }

  state.chart = f3Chart;
  f3Chart.updateTree({ initial: true });
```
with:
```typescript
  const f3Chart = (f3 as any).createChart(treeEl, withSigned)
    .setTransitionTime(800)
    .setCardXSpacing(250)
    .setCardYSpacing(150) as Chart;

  const f3Card = (f3Chart as any).setCard((f3 as any).CardHtml)
    .setCardDisplay([['first_name', 'last_name'], ['birthday']])
    .setMiniTree(true);

  if (state.canEdit) {
    // Pass field objects (not bare names) so the form shows readable,
    // per-language labels instead of raw ids like "first_name__zh-Hant".
    const fields = buildFormFields().map(f => ({ type: f.type, label: f.label, id: f.name }));
    const f3EditTree = f3Chart.editTree();
    f3EditTree
      .setFields(fields)
      .setEditFirst(true)
      .setCardClickOpen(f3Card)
      .setOnChange(() => { scheduleSave(); });
    state.editTree = f3EditTree;
    // Inject a photo upload button into the form when it opens
    installPhotoUploadHook(state.container);
  } else {
    state.editTree = null;
    f3Card.setOnCardClick((_e: any, d: any) => f3Chart.updateMainId(d.data.id));
  }

  state.chart = f3Chart;
  f3Chart.updateTree({ initial: true });
```

- [ ] **Step 3: Fix `persistCurrent()` to use `exportData()` + the pure mapper**

Replace the body of `persistCurrent()`:
```typescript
async function persistCurrent(): Promise<void> {
  if (!state || !state.chart) return;
  const libData = state.chart.getStore().getData() as DisplayPerson[];
  const beforePeople = state.row.data;
  const stored: StoredPerson[] = libData.map(d => displayToStored(d));

  try {
    const updated = await saveTreeData(stored, state.row.version);
    state.row = updated;
    state.avatarPaths = buildAvatarMap(updated.data);
    // Clean up any avatar files that are no longer referenced
    pruneOrphanedAvatars(beforePeople, updated.data).catch(() => undefined);
  } catch (err) {
    if (err instanceof StaleVersionError) {
      showToast('Someone else updated the tree. Refreshing…', 'error');
      await refreshTree();
    } else {
      console.error('Save failed', err);
      showToast(`Save failed: ${(err as Error).message}`, 'error');
    }
  }
}
```
with:
```typescript
async function persistCurrent(): Promise<void> {
  if (!state || !state.editTree) return;
  // exportData() is the library's supported way to read edited data
  // (src/core/edit.ts). It deep-clones and cleans internal/temp fields.
  const libData = state.editTree.exportData() as unknown as DisplayPerson[];
  const beforePeople = state.row.data;
  const stored = mapExportedToStored(
    libData,
    buildOriginalIndex(beforePeople),
    state.avatarPaths,
    getLanguage()
  );

  try {
    const updated = await saveTreeData(stored, state.row.version);
    state.row = updated;
    state.avatarPaths = buildAvatarMap(updated.data);
    // Clean up any avatar files that are no longer referenced
    pruneOrphanedAvatars(beforePeople, updated.data).catch(() => undefined);
  } catch (err) {
    if (err instanceof StaleVersionError) {
      showToast('Someone else updated the tree. Refreshing…', 'error');
      await refreshTree();
    } else {
      console.error('Save failed', err);
      showToast(`Save failed: ${(err as Error).message}`, 'error');
    }
  }
}
```

- [ ] **Step 4: Delete the now-unused `displayToStored` and fix `readPersonIdFromForm`**

Delete the entire `displayToStored` function (its logic now lives in `persist.ts`). Then in `readPersonIdFromForm`, replace the fallback line:
```typescript
    return (state?.chart?.getStore?.()?.getMainDatum?.()?.id as string) ?? null;
```
with:
```typescript
    return (state?.chart?.getMainDatum?.()?.id as string) ?? null;
```
Also remove now-unused imports (`getLanguage` is still used; remove `mergePersonUpdate` from the `./lang` import if it is no longer referenced in `tree.ts`, and remove the `DisplayPerson`/`StoredPerson` imports only if unused — let the typecheck in Step 5 tell you).

- [ ] **Step 5: Typecheck — the compiler must now be clean**

Run: `cd /home/dzkaiten/dev/family-chart && yarn typecheck`
Expected: exit 0. Crucially, `chart.getStore()` no longer exists in the source, and `state.editTree.exportData()` resolves against the real `EditTree` type. If tsc reports an unused import, delete it. If it reports a type mismatch on `setCardClickOpen(f3Card)`, cast `f3Card as any` at that call (the card union typing is loose in the library).

- [ ] **Step 6: Re-run unit tests (no regressions)**

Run: `cd /home/dzkaiten/dev/family-chart && yarn test:unit`
Expected: PASS (all from Tasks 1–2).

- [ ] **Step 7: Commit**

```bash
cd /home/dzkaiten/dev/family-chart
git add app/src/tree.ts
git commit -m "fix: use editTree.exportData() for saves (chart.getStore did not exist); type TreeState; restore form labels"
```

---

## Task 4: Export internal helpers for testing (no behavior change)

**Files:**
- Modify: `app/src/storage.ts`, `app/src/export.ts`
- Test: `app/src/storage.test.ts`, `app/src/export.test.ts`

- [ ] **Step 1: Export `isStoragePath`**

In `app/src/storage.ts`, change `function isStoragePath(` to `export function isStoragePath(`. No other change.

- [ ] **Step 2: Test it**

Create `app/src/storage.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { isStoragePath } from './storage';

describe('isStoragePath', () => {
  it('treats a bare path as a storage path', () => {
    expect(isStoragePath('tree/p1/x.jpg')).toBe(true);
  });
  it('treats http(s) URLs as not-a-path (pass-through)', () => {
    expect(isStoragePath('https://x/y')).toBe(false);
    expect(isStoragePath('http://x/y')).toBe(false);
  });
  it('treats empty as not-a-path', () => {
    expect(isStoragePath('')).toBe(false);
  });
});
```

- [ ] **Step 3: Export `stripAvatars`**

In `app/src/export.ts`, change `function stripAvatars(` to `export function stripAvatars(`. No other change.

- [ ] **Step 4: Test it**

Create `app/src/export.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { stripAvatars } from './export';
import type { StoredPerson } from './types';

describe('stripAvatars', () => {
  it('removes avatar but keeps names and rels', () => {
    const people: StoredPerson[] = [{
      id: 'p1',
      data: { names: { en: { first: 'A', last: 'B' } }, avatar: 'tree/p1/x.jpg', birthday: '2000' },
      rels: { parents: ['p2'], spouses: [], children: [] }
    }];
    const out = stripAvatars(people);
    expect('avatar' in out[0].data).toBe(false);
    expect(out[0].data.names.en).toEqual({ first: 'A', last: 'B' });
    expect(out[0].rels.parents).toEqual(['p2']);
  });
});
```

- [ ] **Step 5: Run all unit tests + typecheck**

Run: `cd /home/dzkaiten/dev/family-chart && yarn test:unit && yarn typecheck`
Expected: PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
cd /home/dzkaiten/dev/family-chart
git add app/src/storage.ts app/src/storage.test.ts app/src/export.ts app/src/export.test.ts
git commit -m "test: cover storage-path detection and JSON-export avatar stripping"
```

---

## Task 5: Documentation & CI hygiene

**Files:**
- Modify: `supabase/schema.sql`, `app/README.md`, `.github/workflows/deploy.yml`

- [ ] **Step 1: Fix the stale spec reference in the schema**

In `supabase/schema.sql`, replace line 3:
```sql
-- See .claude/SPEC.md (private) or the README for the full setup checklist.
```
with:
```sql
-- See docs/spec.md or app/README.md for the full setup checklist.
```

- [ ] **Step 2: Drop the unnecessary library-build step from the README**

In `app/README.md`, in the Development section, remove these lines (the app imports the library from `../../src` source via Vite, so a separate `yarn build` is not required to run or build the app):
```bash
# Build the library (once)
yarn build

```

- [ ] **Step 3: Add typecheck + unit tests to the deploy workflow**

In `.github/workflows/deploy.yml`, insert a step between "Install dependencies" and "Build app":
```yaml
      - name: Typecheck and unit test
        run: |
          yarn typecheck
          yarn test:unit
```

- [ ] **Step 4: Commit**

```bash
cd /home/dzkaiten/dev/family-chart
git add supabase/schema.sql app/README.md .github/workflows/deploy.yml
git commit -m "docs/ci: fix stale spec path, drop needless build step, gate deploy on typecheck+tests"
```

---

## Task 6: End-to-end smoke test with a stubbed Supabase

A behavioral safety net that proves the full edit→save path works against the *real* library (the layer the unit tests don't exercise). This is what would have caught the `getStore` bug. Supabase is stubbed at the network layer so no live project is needed.

**Files:**
- Create: `cypress/e2e/app-smoke.cy.js`

**Note:** Cypress visits a running dev server. Use `yarn app:dev` (Vite, port 5173) in one terminal and `cypress run --spec cypress/e2e/app-smoke.cy.js` in another, or wire `start-server-and-test`. The app reads Supabase env at build/runtime; for the smoke test, provide a `.env` with placeholder `VITE_SUPABASE_URL=https://stub.supabase.co`, `VITE_SUPABASE_ANON_KEY=stub`, `VITE_TREE_ID=00000000-0000-0000-0000-000000000000`.

- [ ] **Step 1: Write the smoke test**

Create `cypress/e2e/app-smoke.cy.js`:
```javascript
// Stubs Supabase REST/Auth so we can drive the real UI + family-chart library
// without a live backend. Proves: tree renders, the edit form shows readable
// multilingual labels, and a save POSTs the correctly-shaped payload (this is
// the path the chart.getStore() bug used to crash).
const TREE_ID = '00000000-0000-0000-0000-000000000000';

function stubSupabase() {
  // Authenticated user
  cy.intercept('GET', '**/auth/v1/user*', {
    statusCode: 200,
    body: { id: 'u1', email: 'owner@example.com' }
  });
  // Role probe: owner row
  cy.intercept('GET', '**/rest/v1/allowed_emails*', {
    statusCode: 200, body: [{ role: 'owner' }]
  });
  cy.intercept('GET', '**/rest/v1/trees*', {
    statusCode: 200, body: { id: TREE_ID, name: 'Test', default_language: 'en' }
  });
  // Tree data: one person
  cy.intercept('GET', '**/rest/v1/tree_data*', {
    statusCode: 200,
    body: {
      id: 't1', tree_id: TREE_ID, version: 1, data_version: 1,
      updated_at: new Date().toISOString(), updated_by: null,
      data: [{ id: 'p1', data: { names: { en: { first: 'Root', last: 'Person' } } },
               rels: { parents: [], spouses: [], children: [] } }]
    }
  });
  cy.intercept('GET', '**/rest/v1/access_requests*', { statusCode: 200, body: [] });
  // Capture the save
  cy.intercept('PATCH', '**/rest/v1/tree_data*', (req) => {
    req.alias = 'saveTree';
    req.reply({ statusCode: 200, body: { ...req.body, id: 't1', tree_id: TREE_ID, version: 2 } });
  }).as('saveTree');
}

describe('app smoke', () => {
  beforeEach(() => {
    // Pre-seed a fake persisted session so getUser() short-circuits if needed.
    stubSupabase();
  });

  it('renders the tree and shows labeled multilingual fields', () => {
    cy.visit('/');
    // The root person's card should appear
    cy.contains('Root').should('exist');
    // Open the edit form on the main card
    cy.get('.card_cont, .card').first().click();
    // Readable labels (Task 3 fix), not raw ids
    cy.contains('First name (English)').should('exist');
    cy.contains(/繁體/).should('exist');
    cy.get('[name="first_name__zh-Hant"]').should('exist');
  });

  it('saves an edit with the correctly-shaped payload', () => {
    cy.visit('/');
    cy.get('.card_cont, .card').first().click();
    cy.get('[name="first_name__zh-Hant"]').clear().type('根');
    cy.get('form#familyForm button[type="submit"]').click();
    cy.wait('@saveTree').then(({ request }) => {
      const body = request.body;
      const people = Array.isArray(body) ? body : body.data;
      const p1 = people.find((p) => p.id === 'p1');
      expect(p1.data.names['zh-Hant'].first).to.eq('根'); // round-tripped into names map
      expect(p1.data).to.not.have.property('first_name');  // flat fields stripped
      expect(body.version).to.eq(2);                       // optimistic bump
    });
  });
});
```

- [ ] **Step 2: Run it**

Run:
```bash
cd /home/dzkaiten/dev/family-chart
# terminal A:
yarn app:dev
# terminal B (or via start-server-and-test):
yarn cypress run --spec cypress/e2e/app-smoke.cy.js
```
Expected: both specs PASS. **If they fail**, the failure is real — most likely surfacing another library-integration assumption (e.g. the exact card selector, or the photo-upload hook). Treat with superpowers:systematic-debugging: read the actual rendered DOM, adjust selectors, and if a genuine app bug appears, fix it under TDD before continuing. Selectors `.card_cont` and `form#familyForm` come from `src/renderers/card-html.ts` and `src/renderers/create-form-html.ts` respectively — verify against the live DOM if needed.

- [ ] **Step 3: Commit**

```bash
cd /home/dzkaiten/dev/family-chart
git add cypress/e2e/app-smoke.cy.js
git commit -m "test: e2e smoke for edit->save path with stubbed Supabase"
```

---

## Task 7: Manual backend verification checklist

The auth (magic-link + PKCE redirect), RLS enforcement, private storage signed URLs, the snapshot trigger, and the optimistic-lock conflict path can only be truly verified against a live Supabase project. Capture the steps so the owner can run them once during first-time setup.

**Files:**
- Create: `docs/superpowers/backend-verification-checklist.md`

- [ ] **Step 1: Write the checklist**

Create `docs/superpowers/backend-verification-checklist.md`:
```markdown
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
- [ ] As that user, attempt nothing else is possible (no allowed_emails read, no tree write).
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
- [ ] The selection persists across reloads (localStorage).
```

- [ ] **Step 2: Commit**

```bash
cd /home/dzkaiten/dev/family-chart
git add docs/superpowers/backend-verification-checklist.md
git commit -m "docs: backend verification checklist for live Supabase"
```

---

## Task 8: Final verification gate

- [ ] **Step 1: Full local verification**

Run:
```bash
cd /home/dzkaiten/dev/family-chart
yarn typecheck
yarn test:unit
VITE_SUPABASE_URL=https://stub.supabase.co VITE_SUPABASE_ANON_KEY=stub VITE_TREE_ID=00000000-0000-0000-0000-000000000000 yarn app:build
ls app/dist/index.html
```
Expected: typecheck exit 0; all unit tests pass; `app:build` completes; `app/dist/index.html` exists.

- [ ] **Step 2: Confirm the production CSS path resolves**

After `app:build`, confirm the bundled output references the family-chart stylesheet (the dev `index.html` links `../src/styles/family-chart.css`). Run:
```bash
grep -r "family-chart" app/dist/assets/*.css | head -1 || grep -rl "card_cont\|f3-form" app/dist
```
Expected: the library CSS is present in the build output. If the `../src/styles/...` link did not get bundled, switch `app/index.html` to import the CSS from `main.ts` (`import '@lib/styles/family-chart.css'`) and rebuild.

- [ ] **Step 3: REQUIRED — use superpowers:verification-before-completion before claiming done.** Run the manual backend checklist (Task 7) against a live project, or explicitly note it as the remaining owner-run step. Do not claim the app "works end-to-end" without either the e2e smoke (Task 6) passing or the live checklist completed.

- [ ] **Step 4: Finish the branch** — REQUIRED SUB-SKILL: superpowers:finishing-a-development-branch to decide merge/PR/cleanup.

---

## Self-Review

**1. Spec coverage** (each `docs/spec.md` feature → where it lives + any task):

| Spec feature | Implemented in | Verified by |
|---|---|---|
| View tree (allowlisted only) | `tree.ts`, RLS `tree_data_select` | Task 6 smoke, Task 7 RLS |
| Edit tree + optimistic locking | `tree.ts` persist, `db.ts saveTreeData`, schema `version` + trigger | **Task 3 (critical fix)**, Task 6, Task 7 concurrency |
| Snapshots before save | schema `snapshot_tree_data` trigger | Task 7 |
| Private photos + signed URLs | `storage.ts`, schema storage policies | Task 4 (`isStoragePath`), Task 7 photos |
| Multilingual names + adapter | `lang.ts`, `persist.ts` | **Tasks 1–2**, Task 6 labels |
| Login / logout (magic link) | `auth.ts`, `views.ts` | Task 7 auth |
| Access request + approval | `views.ts`, `admin.ts`, `db.ts`, RLS | Task 6 stubs, Task 7 RLS |
| Download JSON (no photos) | `export.ts stripAvatars` | Task 4, Task 7 exports |
| Download PNG (full tree) | `export.ts downloadPNG` | Task 7 exports |
| Config-driven languages / retention | `config.ts`, schema `retention_count` | Tasks 1–2 |
| Deploy (Pages + Actions) | `.github/workflows/deploy.yml`, `vite.config.ts base` | Task 5, Task 8 build |

No spec feature is unimplemented; this plan's job is correctness + tests, so every row maps to a verification task. The form-label regression (raw ids) is fixed in Task 3; the save-crash in Task 3; the missing test net in Tasks 0–4, 6.

**2. Placeholder scan:** No `TODO`/`TBD`/"add error handling" placeholders. Every code step shows the actual code or exact diff.

**3. Type consistency:** `mapExportedToStored(exported, originalById, avatarPaths, activeLanguage)` and `buildOriginalIndex(people)` are used with matching signatures in `persist.ts`, `persist.test.ts`, and `tree.ts`. `TreeState` gains `editTree: EditTree | null` and is initialized in `initTree`. `exportData()` (real method on `EditTree`, `src/core/edit.ts:501`) replaces the non-existent `getStore()`. `setFields` receives `{type,label,id}` objects, which the library supports (`src/core/edit.ts:386-398`).

**Known edge cases (acceptable for v1, noted, not fixed here):**
- Deleting a person who still bridges relatives turns them into an "unknown" node (library behavior); their stored `names` are preserved by `mergePersonUpdate`'s base-merge. Harmless display/storage mismatch.
- `boot()` calls `fetchTreeMeta()` pre-auth (one wasted, RLS-blocked round trip). Harmless; left as-is.
- New-person photo upload resolves `personId` via the chart's main datum; for a brand-new relative the main id is updated to that person before the form opens, so this holds in the common path.
