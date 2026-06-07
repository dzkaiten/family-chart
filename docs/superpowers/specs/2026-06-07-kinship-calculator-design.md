# Chinese Kinship Calculator — Design

> **Status:** approved design, pre-implementation.
> **Date:** 2026-06-07
> **Worktree:** B (`feat/kinship-engine`) — engine + tests only. UI wiring is a
> separate post-merge integration pass (see §8).
> Architecture reference: [`docs/spec.md`](../../spec.md) §7 (data model: `rels`).

---

## 1. Goal

Given a **source** person and any **target** person in the tree, compute the
precise **Chinese kinship term** the target is to the source — e.g. 父亲, 外婆,
二舅, 表姐, 堂弟, 侄女, 曾孙, 高祖父. This is the signature feature for a Chinese
family tree, where the terms are dense, exact, and hard for people to remember.

This worktree delivers a **pure, heavily-tested engine** (`app/src/kinship/`) with
no DOM and no edits to shared rendering code. The UI (a per-person "source"
toggle that recomputes the whole tree's terms) is wired in afterward — see §8.

## 2. Approach: own the graph-walk, delegate the linguistics

We do **not** hand-author Chinese term tables. We depend on **`relationship.js`**
(npm `relationship.js`, **MIT**, © 2016 Haole Zheng; ships ESM + CJS) — the
established, widely-used Chinese kinship calculator. It owns the hard, error-prone
linguistics: 堂/表, 伯/叔 seniority, 外 (maternal) prefixes, ordinals (二舅), deep
generations, and regional variants.

**The seam:**
- **We own** (testable, about *our* data): walking the `rels` graph from source to
  target and rendering the connection as a Chinese **relationship chain** —
  base words joined by `的` (e.g. `爸爸的哥哥的儿子`). Crucially, **we choose the
  seniority word** at each sibling hop (哥哥/弟弟/姐姐/妹妹) from birthdays.
- **relationship.js owns**: chain → exact term(s).

`relationship.js` API (verified):
`relationship({ text, target, sex, type, reverse, mode })`
- `text`: the target's chain from the source (words joined by `的`).
- `target`: source's own chain (empty string = self) — we pass `''`.
- `sex`: source sex (0 female, 1 male) — affects in-law terms (公公 vs 岳父).
- `type: 'default'` → returns a **`string[]`** of candidate 称谓.
- `mode`: `'default'` | built-in regional (`guangdong`, `north`) | custom via the
  library's `setMode` (see §6 — this is the "modifiable" answer).

## 3. The dimensions our chain must capture

The term is determined by these, all of which the chain (or `sex`) encodes:

1. **Generation distance** — number of parent/child hops.
2. **Branch / side** — paternal vs maternal, male vs female links (the library
   derives 外 / 堂 / 表 from the chain's father/mother words).
3. **Gender** of each hop's person (爸爸 vs 妈妈, 儿子 vs 女儿, 哥 vs 姐).
4. **Seniority** (长幼) — **the part we must decide**: at a sibling hop, elder vs
   younger by birthday (哥哥/姐姐 vs 弟弟/妹妹). Missing birthday → neutral token +
   `ambiguous` (see §4.5).

## 4. Algorithm (`app/src/kinship/`)

`kinshipTerm(sourceId, targetId, people, opts?) → KinshipResult`

```ts
interface KinshipResult {
  term: string;        // first/best candidate, or composed descriptive fallback
  candidates: string[];// all candidates relationship.js returned ([] if none)
  chain: string;       // the 的-joined chain we built (for debugging/UI tooltip)
  ambiguous: boolean;  // true when seniority unknown, >1 candidate, or fallback used
}
```

1. **Find the connecting path** between source and target over `rels`
   (parents/children/spouses). Use a nearest-common-ancestor walk: ascend from
   source and target to find the nearest shared ancestor, giving an up-segment
   (source→ancestor) and a down-segment (ancestor→target); handle the direct
   lineal case (one is the other's ancestor/descendant) and the spouse/in-law case
   (a `spouses` edge somewhere on the path).
2. **Render the chain** as base Chinese words joined by `的`, from the source's POV:
   - parent hop → `爸爸` / `妈妈` (by that parent's gender)
   - child hop → `儿子` / `女儿` (by that child's gender)
   - spouse hop → `丈夫` / `妻子` (by that spouse's gender)
   - **sibling hop** → `哥哥`/`弟弟`/`姐姐`/`妹妹` by the sibling's gender **and**
     elder/younger vs the person we arrived through (birthday compare, §4.5).
     Prefer emitting an explicit sibling token (not `爸爸的儿子`) so seniority
     survives into the term.
3. **Call `relationship.js`** with `{ text: chain, sex: sourceSex, type: 'default',
   mode }`.
4. **Map the result:**
   - exactly 1 candidate → `term` = it, `ambiguous` reflects only §4.5.
   - >1 candidates → `term` = first, `ambiguous: true`, all in `candidates`.
   - 0 candidates → **descriptive fallback**: return the readable chain itself
     (e.g. `高祖父的堂弟`) as `term`, `ambiguous: true`. Never throw, never empty.
5. **Seniority unknown:** when a sibling hop lacks a birthday on either side, emit
   the **neutral** token (`兄弟`/`姐妹` — accepted by the library) and set
   `ambiguous: true`. (This typically yields a candidate set spanning the
   elder/younger terms, e.g. 伯父/叔父.)

No generation cap — depth falls out of the path length and `relationship.js`
covers deep lineal terms; only genuinely term-less cases hit the §4.4 fallback.

## 5. Testing (the heart of this worktree)

`app/src/kinship/kinship.test.ts` (Vitest), built TDD (red → green):

- A **fixture family** in `StoredPerson[]` shape spanning ≥4 generations with both
  paternal and maternal branches, some birthdays present and some **deliberately
  missing**, ≥1 spouse/in-law, and same- vs cross-gender cousin links.
- **Chain-builder unit tests** (our owned logic): assert the `的`-chain produced for
  representative `(source, target)` pairs — including correct elder/younger sibling
  tokens from birthdays, and the neutral token when a birthday is missing. This is
  where our correctness lives; it does not depend on the library.
- **End-to-end tests** through `relationship.js`: `(sourceId, targetId) → term`
  covering at minimum father/mother, paternal vs maternal grandparents
  (爷爷/奶奶 vs 外公/外婆), great-grandparents, 哥/弟/姐/妹, 伯/叔/姑/舅/姨,
  二舅-style ordinal, 堂 vs 表 cousins, 侄/侄女/外甥/外甥女, 孙/外孙, 儿子/女儿,
  spouse, in-law parents (公婆 vs 岳父母 driven by source `sex`), a deep lineal
  case, a seniority-unknown case (asserts `ambiguous: true`), and a term-less
  distant collateral (asserts non-empty descriptive `term` + `ambiguous: true`).

## 6. Trust & modifiability (answers the open questions)

- **Trust** = the library's wide real-world use **plus** our test table. Our owned
  risk is confined to the chain-builder, which the unit tests pin precisely.
- **Modifiable** = `relationship.js` is data-driven with built-in regional modes
  (`guangdong`, `north`) and a `setMode(key, data)` API for custom term sets. We
  expose `opts.mode` through `kinshipTerm`; family-specific overrides can be added
  later via `setMode` without forking the library.

## 7. Dependency & build notes

- Add `relationship.js` to `app/`'s dependencies (**npm**, not yarn — this repo
  uses npm; `package-lock.json` is gitignored). Import the ESM build.
- If the package ships no TypeScript types, add a minimal ambient declaration
  (`app/src/kinship/relationship.d.ts`: `declare module 'relationship.js'`) so
  `npm run typecheck` stays green.
- Engine is pure (no DOM); tests run under the existing Vitest setup.

## 8. UI wiring — POST-MERGE INTEGRATION (not this worktree)

Deferred to a sequential pass after Worktrees A and B merge, because it edits the
**same** `tree.ts`/popup code Worktree A rewrites (race-condition avoidance). For
reference, the planned UI:

- A **"set as kinship source"** toggle on each person (in the card popup A adds).
- Selected source persisted in **localStorage** (per-viewer, not shared tree data).
- When a source is set, every card shows the target's term relative to the source
  (extra card line or badge), recomputed on source change; a header chip shows the
  current source with a clear (✕) control.
- Kinship **UI chrome** strings (button, chip, clear) added to `i18n.ts` during
  this pass. The engine's output terms are data (Chinese strings), not i18n keys.

## 9. Files touched (this worktree)

- `app/src/kinship/index.ts` — `kinshipTerm` entry point + `KinshipResult`; calls
  `relationship.js`; result mapping + descriptive fallback (§4.4).
- `app/src/kinship/chain.ts` — the owned graph-walk: path-find + render the
  `的`-joined chain incl. birthday-driven seniority (§4.1–4.2, §4.5).
- `app/src/kinship/relationship.d.ts` — ambient type for the dep if needed.
- `app/src/kinship/kinship.test.ts` — fixture + chain-builder + end-to-end tables.
- `app/package.json` — add `relationship.js` dependency.
- `docs/spec.md` / `docs/roadmap.md` — append this feature (own section / entries).

**Not touched here:** `types.ts`, `lang.ts`, `i18n.ts`, `tree.ts`, `styles.css`
(all in Worktree A or the integration pass) — so the only cross-worktree overlap
is the two docs.

## 10. Out of scope / non-goals

- No UI in this worktree (see §8).
- **Pinyin** output deferred (would need a pinyin dep); `KinshipResult` omits it
  for v1.
- Regional mode defaults to `'default'`; custom family overrides are a later add.
- Half-/step- relationship nuance beyond what the chain naturally expresses.
