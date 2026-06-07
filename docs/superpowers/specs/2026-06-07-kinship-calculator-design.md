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

## 2. Why an engine, not the library's calc

The library's `src/features/kinships/calculate-kinships.ts` produces **Western**
terms (uncle, 1st cousin) and collapses distinctions Chinese requires: 伯/叔/舅/
姑父 are all "uncle". Chinese terms depend on dimensions the Western calc discards,
so we build our own over the same `rels` graph.

## 3. The four dimensions a Chinese term encodes

1. **Generation distance** (辈分) — how many generations up/down from source.
2. **Branch / side at each split** — paternal vs maternal, and whether the link is
   through a male or female relative (drives 外, 堂 vs 表, 姑/舅/姨).
3. **Gender** of the target (and of connecting relatives).
4. **Seniority** (长幼) — older/younger than the connecting sibling (伯 vs 叔,
   哥 vs 弟, 姐 vs 妹). Needs birthdays.

## 4. Algorithm

`kinshipTerm(sourceId, targetId, people) → KinshipResult`

```ts
interface KinshipResult {
  term: string;       // Chinese term, e.g. "二舅" or a composed descriptive fallback
  pinyin?: string;    // e.g. "èr jiù"
  ambiguous?: boolean;// true when seniority unknown or no crisp common term
}
```

Steps:

1. **Spouse/in-law normalization.** If the only connection to the target runs
   through a spouse edge, resolve the target's **blood** relationship to the
   relevant blood relative, then apply the in-law transformation (e.g. father's
   sister's husband → 姑父; spouse's father → 岳父/公公 by source gender).
2. **Common-ancestor split.** Build both ancestor chains; find the nearest common
   ancestor. The generation depth of source and target below that ancestor, plus
   the **gender of the two children of the common ancestor** that each side
   descends through, classify the relationship (same-line vs collateral, paternal
   vs maternal, 堂 vs 表).
3. **Direct lineal** (one is the other's ancestor/descendant): use the classical
   named sequences (§5) by generation distance and side (外 prefix on the maternal
   line).
4. **Collateral**: compose from generation distance + side + gender + seniority by
   rule (§6).
5. **Seniority**: when the relationship needs older/younger, compare birthdays of
   the relevant siblings. Missing birthday ⇒ emit the seniority-neutral term and
   set `ambiguous: true`.
6. **No crisp term**: for genuinely term-less distant collaterals, return a
   **composed descriptive term** (e.g. 高祖父的堂弟) with `ambiguous: true` rather
   than throwing or returning empty.

There is **no generation cap.** Lineal lines extend to arbitrary depth via §5;
collaterals generate by rule; only term-less distant cases degrade to descriptive.

## 5. Lineal named sequences (no cap)

**Ancestors (paternal; prefix 外 for the maternal line):**
父 → 祖父 → 曾祖父 → 高祖父 → 天祖父 → 烈祖父 → 太祖父 → 远祖父 → 鼻祖父.
Female counterparts 母/祖母/曾祖母/… Beyond 鼻祖 (9th), fall back to **`{n}世祖`**
(e.g. 十世祖) with `ambiguous: true`.

**Descendants:**
子 → 孙 → 曾孙 → 玄孙 → 来孙 → 晜孙 → 仍孙 → 云孙 → 耳孙. Beyond 耳孙, fall back to
**`{n}世孙`**. Daughter-line descendants of a daughter take 外 (外孙/外孙女).

(Implement the named entries as a table keyed by generation distance + gender +
maternal flag; the n世 fallback covers the tail.)

## 6. Collateral construction rules (representative, not exhaustive)

- **Parent's siblings:** father's older brother 伯父 / younger brother 叔父;
  father's sister 姑母; mother's brother 舅父; mother's sister 姨母. Their spouses:
  伯母/婶母/姑父/舅母/姨父.
- **Numbering:** where multiple same-type relatives exist and birth order is known,
  prefix the ordinal (大伯, 二舅, 三姨). Unknown order ⇒ no number, `ambiguous`.
- **Siblings:** 哥/弟/姐/妹 by gender + seniority. Half-siblings note in `ambiguous`
  if desired (v1 may treat as full siblings — implementer's call, documented).
- **Cousins:** same-surname paternal-male line → 堂兄/堂弟/堂姐/堂妹; otherwise
  (through a female link, or maternal) → 表兄/表弟/表姐/表妹.
- **Nephews/nieces:** brother's child 侄/侄女; sister's child 外甥/外甥女.
- **In-laws (§4.1):** 丈夫/妻子; 公公/婆婆 (husband's parents) vs 岳父/岳母 (wife's
  parents); 嫂/弟妹/姐夫/妹夫; 媳妇/女婿.

These compose with generation prefixes for the grand- tiers (堂 → … , 侄孙, 姑婆,
舅公, etc.); generate by rule and let the descriptive fallback catch the rest.

## 7. Testing (the heart of this worktree)

`app/src/kinship/kinship.test.ts` (Vitest), built TDD (red → green):

- A **fixture family** in `StoredPerson[]` shape spanning ≥4 generations with both
  paternal and maternal branches, some birthdays present and some **deliberately
  missing**, at least one spouse/in-law, and same- vs cross-gender cousin links.
- A **table of cases** `(sourceId, targetId) → expected { term, ambiguous? }`
  covering at minimum: father/mother, paternal vs maternal grandparents
  (爷爷/奶奶 vs 外公/外婆), great- and great-great- grandparents, a `{n}世祖`
  tail case, 哥/弟/姐/妹, 伯/叔/姑/舅/姨 + their spouses, ordinal numbering (二舅),
  堂 vs 表 cousins, 侄/侄女/外甥/外甥女, 孙/孙女/外孙, 儿子/女儿, spouse, in-law
  parents (公婆/岳父母), a seniority-unknown case (asserts neutral term +
  `ambiguous: true`), and a term-less distant collateral (asserts a non-empty
  descriptive term + `ambiguous: true`).
- Pinyin assertions on a representative subset.

## 8. UI wiring — POST-MERGE INTEGRATION (not this worktree)

Deferred to a sequential pass after Worktrees A and B merge, because it edits the
**same** `tree.ts`/popup code Worktree A rewrites (race-condition avoidance). For
reference, the planned UI:

- A **"set as kinship source"** toggle on each person (in the card popup A adds).
- Selected source persisted in **localStorage** (per-viewer, not in shared tree
  data).
- When a source is set, every card shows the target's term relative to the source
  (extra card line or badge), recomputed on source change; a header chip shows the
  current source with a clear (✕) control.
- Kinship **UI chrome** strings (button, chip, clear) added to `i18n.ts` during
  this pass. The engine's output terms are data (Chinese strings + pinyin), not
  i18n keys.

## 9. Files touched (this worktree)

- `app/src/kinship/index.ts` — `kinshipTerm` entry point + `KinshipResult`.
- `app/src/kinship/path.ts` — graph walk: common ancestor, generation distances,
  branch/side classification, spouse/in-law normalization.
- `app/src/kinship/terms.ts` — lineal sequences + collateral construction +
  pinyin + descriptive fallback.
- `app/src/kinship/kinship.test.ts` — fixture + case table.
- `docs/spec.md` / `docs/roadmap.md` — append this feature (own section / entries).

**Not touched here:** `types.ts`, `lang.ts`, `i18n.ts`, `tree.ts`, `styles.css`
(all in Worktree A or the integration pass) — so the only cross-worktree overlap
is the two docs.

## 10. Out of scope / non-goals

- No UI in this worktree (see §8).
- No regional/dialect variants beyond standard Mandarin terms.
- Half-/step- relationship nuance beyond what §6 notes (documented if simplified).
