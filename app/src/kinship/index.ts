// Chinese kinship calculator. Given a source and target person from the tree,
// returns the precise Chinese term the target is to the source.
//
// We own the graph-walk (chain.ts) that renders the connection as a Chinese
// relationship chain; relationship.js (MIT) maps that chain to the term(s),
// owning the hard linguistics (堂/表, 伯/叔, 外, ordinals, deep generations).

import relationship from 'relationship.js';
import type { StoredPerson } from '../types';
import { buildChain, isOlder } from './chain';

export interface KinshipResult {
  term: string;          // best/first candidate, or the chain as a descriptive fallback
  candidates: string[];  // all candidates relationship.js returned ([] if none)
  chain: string;         // the 的-joined chain we built (debug / tooltip)
  ambiguous: boolean;    // unknown seniority, undisambiguated multi-candidate, or fallback
}

export interface KinshipOptions {
  mode?: string;         // relationship.js regional mode ('default' | 'guangdong' | ...)
}

function sexOf(id: string, people: StoredPerson[]): number {
  const g = people.find(p => p.id === id)?.data.gender;
  return g === 'F' ? 0 : 1; // relationship.js: 0 female, 1 male (default male)
}

// From an elder/younger candidate set, pick by whether the target is older.
function pickBySeniority(candidates: string[], targetOlder: boolean): string | null {
  const elder = candidates.find(c => /[哥姐兄]/.test(c));
  const younger = candidates.find(c => /[弟妹]/.test(c));
  return targetOlder ? (elder ?? null) : (younger ?? null);
}

export function kinshipTerm(
  sourceId: string,
  targetId: string,
  people: StoredPerson[],
  opts: KinshipOptions = {}
): KinshipResult {
  if (sourceId === targetId) {
    return { term: '本人', candidates: ['本人'], chain: '', ambiguous: false };
  }

  const built = buildChain(sourceId, targetId, people);
  if (!built) {
    // No path between them (or unknown ids).
    return { term: '', candidates: [], chain: '', ambiguous: true };
  }

  const { chain, ambiguous, sourceBirthday, targetBirthday } = built;
  let candidates: string[] = [];
  try {
    candidates = relationship({
      text: chain,
      target: '',
      sex: sexOf(sourceId, people),
      type: 'default',
      mode: opts.mode
    }) ?? [];
  } catch {
    candidates = [];
  }

  // No standard term → descriptive fallback: the readable chain itself.
  if (candidates.length === 0) {
    return { term: chain, candidates: [], chain, ambiguous: true };
  }

  if (candidates.length === 1) {
    return { term: candidates[0], candidates, chain, ambiguous };
  }

  // Multiple candidates usually differ only by the target's seniority vs the
  // source (e.g. 堂哥/堂弟). Disambiguate by birthday when we can.
  const targetOlder = isOlder(targetBirthday, sourceBirthday);
  if (targetOlder !== null) {
    const picked = pickBySeniority(candidates, targetOlder);
    if (picked) return { term: picked, candidates, chain, ambiguous };
  }
  return { term: candidates[0], candidates, chain, ambiguous: true };
}
