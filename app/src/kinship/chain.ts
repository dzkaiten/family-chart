// Graph-walk that turns a (source, target) pair from the tree into a Chinese
// relationship chain — base words joined by 的 (e.g. 爸爸的哥哥) — which
// relationship.js then maps to an exact term. THIS is the part we own and test;
// the linguistics live in relationship.js (see index.ts).
//
// The chain is built from the source's point of view. Sibling links carry
// seniority (哥哥/弟弟/姐姐/妹妹) decided from birthdays — that's what lets the
// library distinguish 伯父 (father's elder brother) from 叔叔 (younger).

import type { StoredPerson } from '../types';

export type EdgeType = 'parent' | 'child' | 'spouse' | 'sibling';

interface PathEdge {
  type: EdgeType;
  from: string;
  to: string;
}

export interface ChainResult {
  chain: string;             // 的-joined chain; '' when source === target
  ambiguous: boolean;        // unknown gender or unknown sibling seniority on the path
  sourceBirthday?: string;   // for final seniority disambiguation (index.ts)
  targetBirthday?: string;
}

type PersonIndex = Map<string, StoredPerson>;

function buildIndex(people: StoredPerson[]): PersonIndex {
  const byId: PersonIndex = new Map();
  for (const p of people) byId.set(p.id, p);
  return byId;
}

function siblingsOf(p: StoredPerson, byId: PersonIndex): string[] {
  const sibs = new Set<string>();
  for (const parentId of p.rels.parents) {
    const parent = byId.get(parentId);
    if (!parent) continue;
    for (const childId of parent.rels.children) {
      if (childId !== p.id) sibs.add(childId);
    }
  }
  return [...sibs];
}

// Shortest path source → target over parent/child/spouse/sibling edges. Sibling
// edges keep uncle/aunt/cousin chains canonical (爸爸的哥哥, not 爸爸的爸爸的儿子).
function findPath(srcId: string, tgtId: string, byId: PersonIndex): PathEdge[] | null {
  const visited = new Set<string>([srcId]);
  const queue: { id: string; path: PathEdge[] }[] = [{ id: srcId, path: [] }];
  while (queue.length) {
    const { id, path } = queue.shift()!;
    const p = byId.get(id);
    if (!p) continue;
    const edges: PathEdge[] = [];
    for (const to of p.rels.parents) edges.push({ type: 'parent', from: id, to });
    for (const to of p.rels.children) edges.push({ type: 'child', from: id, to });
    for (const to of p.rels.spouses ?? []) edges.push({ type: 'spouse', from: id, to });
    for (const to of siblingsOf(p, byId)) edges.push({ type: 'sibling', from: id, to });
    for (const e of edges) {
      if (visited.has(e.to)) continue;
      const next = [...path, e];
      if (e.to === tgtId) return next;
      visited.add(e.to);
      queue.push({ id: e.to, path: next });
    }
  }
  return null;
}

function genderOf(id: string, byId: PersonIndex): 'M' | 'F' | null {
  const g = byId.get(id)?.data.gender;
  return g === 'M' ? 'M' : g === 'F' ? 'F' : null;
}

export function birthdayOf(id: string, byId: PersonIndex): string | undefined {
  const b = byId.get(id)?.data.birthday;
  return typeof b === 'string' && b ? b : undefined;
}

// Comparable number from an ISO-ish date (YYYY or YYYY-MM-DD). null when unknown.
function dateNum(s: string | undefined): number | null {
  if (typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!m) return null;
  return Number(m[1] + (m[2] ?? '00') + (m[3] ?? '00'));
}

// true if `a` is older (born earlier) than `b`; null when undeterminable.
export function isOlder(a: string | undefined, b: string | undefined): boolean | null {
  const an = dateNum(a);
  const bn = dateNum(b);
  if (an === null || bn === null || an === bn) return null;
  return an < bn;
}

// One edge → one Chinese base word (from the arrived-at person's POV).
function edgeWord(e: PathEdge, byId: PersonIndex): { word: string; ambiguous: boolean } {
  const g = genderOf(e.to, byId);
  switch (e.type) {
    case 'parent':
      if (g === 'M') return { word: '爸爸', ambiguous: false };
      if (g === 'F') return { word: '妈妈', ambiguous: false };
      return { word: '爸爸', ambiguous: true };
    case 'child':
      if (g === 'M') return { word: '儿子', ambiguous: false };
      if (g === 'F') return { word: '女儿', ambiguous: false };
      return { word: '儿子', ambiguous: true };
    case 'spouse':
      // 丈夫/妻子 resolve correctly for both source sexes (老公 alone does not).
      if (g === 'M') return { word: '丈夫', ambiguous: false };
      if (g === 'F') return { word: '妻子', ambiguous: false };
      return { word: '丈夫', ambiguous: true };
    case 'sibling': {
      const older = isOlder(birthdayOf(e.to, byId), birthdayOf(e.from, byId));
      if (older === null) {
        // Unknown seniority → neutral token (relationship.js returns the full
        // elder/younger candidate set, e.g. 爸爸的兄弟 → [伯父, 叔叔]).
        if (g === 'F') return { word: '姐妹', ambiguous: true };
        return { word: '兄弟', ambiguous: true };
      }
      if (g === 'M') return { word: older ? '哥哥' : '弟弟', ambiguous: false };
      if (g === 'F') return { word: older ? '姐姐' : '妹妹', ambiguous: false };
      return { word: older ? '哥哥' : '弟弟', ambiguous: true };
    }
  }
}

export function buildChain(srcId: string, tgtId: string, people: StoredPerson[]): ChainResult | null {
  const byId = buildIndex(people);
  if (!byId.has(srcId) || !byId.has(tgtId)) return null;
  if (srcId === tgtId) return { chain: '', ambiguous: false };

  const path = findPath(srcId, tgtId, byId);
  if (!path) return null;

  let ambiguous = false;
  const words = path.map(e => {
    const w = edgeWord(e, byId);
    if (w.ambiguous) ambiguous = true;
    return w.word;
  });

  return {
    chain: words.join('的'),
    ambiguous,
    sourceBirthday: birthdayOf(srcId, byId),
    targetBirthday: birthdayOf(tgtId, byId)
  };
}
