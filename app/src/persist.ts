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
