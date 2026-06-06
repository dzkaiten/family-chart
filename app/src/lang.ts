import {
  LANGUAGES,
  DEFAULT_LANGUAGE,
  type LanguageCode,
  type LanguageOption
} from './config';
import type {
  DisplayPerson,
  NameEntry,
  NamesMap,
  PersonData,
  StoredPerson
} from './types';

const STORAGE_KEY = 'family-chart:lang';

let currentLanguage: LanguageCode = DEFAULT_LANGUAGE;

export function initLanguage(treeDefault: string | null | undefined): LanguageCode {
  const stored = localStorage.getItem(STORAGE_KEY) as LanguageCode | null;
  const fallback = (treeDefault as LanguageCode) || DEFAULT_LANGUAGE;
  currentLanguage = stored && LANGUAGES.some(l => l.code === stored) ? stored : fallback;
  return currentLanguage;
}

export function getLanguage(): LanguageCode {
  return currentLanguage;
}

export function setLanguage(code: LanguageCode): void {
  currentLanguage = code;
  localStorage.setItem(STORAGE_KEY, code);
}

export function getLanguageOptions(): LanguageOption[] {
  return LANGUAGES;
}

// ---------------------------------------------------------------------------
// Read adapter: stored shape -> library-facing shape (flat first/last fields)
// ---------------------------------------------------------------------------

// Cultures that write the family name first (and, for CJK, with no separator):
// Chinese, Japanese, Korean. Used to order the single display name per script.
function isFamilyNameFirst(lang: LanguageCode | null): boolean {
  return !!lang && /^(zh|ja|ko)(-|$)/.test(lang);
}

// Resolve the best name for `lang`, returning BOTH the entry and the language
// code it actually came from — so display ordering follows the name's own
// script, not just the selected UI language (an English fallback stays
// given-first even while the UI is set to Chinese).
function resolveNameWithCode(
  names: NamesMap,
  lang: LanguageCode
): { entry: NameEntry; code: LanguageCode | null } {
  const direct = names[lang];
  if (direct && (direct.first || direct.last)) return { entry: direct, code: lang };

  const en = names.en;
  if (en && (en.first || en.last)) return { entry: en, code: 'en' };

  for (const code of Object.keys(names)) {
    const entry = names[code];
    if (entry && (entry.first || entry.last)) return { entry, code: code as LanguageCode };
  }
  return { entry: {}, code: null };
}

function resolveName(names: NamesMap, lang: LanguageCode): NameEntry {
  return resolveNameWithCode(names, lang).entry;
}

// Order given/family into one display string per the resolved script:
//   Chinese/Japanese/Korean -> family+given, no space (毛泽东)
//   everyone else            -> given family (Ada Lovelace)
export function formatDisplayName(first: string, last: string, code: LanguageCode | null): string {
  if (isFamilyNameFirst(code)) return `${last}${first}`;
  return [first, last].filter(Boolean).join(' ');
}

export function toDisplayPerson(person: StoredPerson, lang: LanguageCode = currentLanguage): DisplayPerson {
  const names = person.data.names ?? {};
  const { entry: activeName, code: activeCode } = resolveNameWithCode(names, lang);
  const first = activeName.first ?? '';
  const last = activeName.last ?? '';

  // Drop the names map; the library reads flat fields instead.
  const { names: _drop, ...rest } = person.data;
  const out: DisplayPerson['data'] = {
    ...rest,
    first_name: first,
    last_name: last,
    // Single, culturally-ordered string used for the CARD label. The edit form
    // still edits given/family separately; this only governs how the name is
    // shown on the card (family-first, no separator, for CJK).
    display_name: formatDisplayName(first, last, activeCode)
  };

  // Expose other-language fields with suffixed keys so the edit form can
  // show inputs for them. Empty strings keep the form predictable.
  for (const { code } of LANGUAGES) {
    if (code === lang) continue;
    const entry = names[code];
    out[`first_name__${code}`] = entry?.first ?? '';
    out[`last_name__${code}`] = entry?.last ?? '';
  }

  return {
    id: person.id,
    data: out,
    rels: person.rels
  };
}

export function toDisplayPeople(people: StoredPerson[], lang: LanguageCode = currentLanguage): DisplayPerson[] {
  return people.map(p => toDisplayPerson(p, lang));
}

// ---------------------------------------------------------------------------
// Write adapter: library form payload -> stored shape
// ---------------------------------------------------------------------------

// The library's form serializes name fields per-language as
// `first_name__<lang>` / `last_name__<lang>`. The default `first_name` /
// `last_name` correspond to the active language. We use the suffixed
// variants when present, falling back to the unsuffixed (active) field.
export function mergePersonUpdate(
  existing: StoredPerson | null,
  formData: Record<string, unknown>,
  activeLanguage: LanguageCode = currentLanguage
): PersonData {
  const baseNames: NamesMap = existing?.data.names ? { ...existing.data.names } : {};

  // For every configured language, extract the first/last fields from the form.
  // A field that is present but empty is an explicit clear: drop that language
  // entry rather than keeping a stale value. A field that is absent is left
  // untouched (so partial form payloads don't wipe other languages).
  const originalNames: NamesMap = existing?.data.names ?? {};
  for (const { code } of LANGUAGES) {
    const firstKey = code === activeLanguage ? 'first_name' : `first_name__${code}`;
    const lastKey = code === activeLanguage ? 'last_name' : `last_name__${code}`;
    const firstPresent = firstKey in formData;
    const lastPresent = lastKey in formData;
    if (!firstPresent && !lastPresent) continue;
    const first = readString(formData[firstKey]);
    const last = readString(formData[lastKey]);

    // The active language uses the unsuffixed first_name/last_name, which
    // toDisplayPerson fills from the display fallback chain when the active
    // language has no name of its own. If this language never had an entry and
    // the submitted value is exactly that fallback, it isn't a real name in
    // this language — don't fabricate one (otherwise the first save after a
    // language switch copies e.g. the English name into the zh-Hant slot).
    if (code === activeLanguage) {
      const hadActive = !!(originalNames[code]?.first || originalNames[code]?.last);
      if (!hadActive) {
        const fallback = resolveName(originalNames, activeLanguage);
        if (first === (fallback.first ?? '') && last === (fallback.last ?? '')) continue;
      }
    }

    if (first || last) baseNames[code] = { first, last };
    else delete baseNames[code];
  }

  // Strip name-related keys from the form before merging the rest
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formData)) {
    if (key === 'first_name' || key === 'last_name') continue;
    if (key.startsWith('first_name__') || key.startsWith('last_name__')) continue;
    if (key === 'names' || key === 'display_name') continue;
    rest[key] = value;
  }

  return {
    ...(existing?.data ?? {}),
    ...rest,
    names: baseNames
  };
}

function readString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  return '';
}

// Returns the form field configuration the family-chart library should
// render. The library accepts an array of {type, label, name} entries.
export function buildFormFields(): { type: string; label: string; name: string }[] {
  const fields: { type: string; label: string; name: string }[] = [];
  // For each language, add first/last name inputs. The active language's
  // fields are unsuffixed so the library's default rendering shows them
  // first as `first_name` / `last_name`.
  for (const { code, label } of LANGUAGES) {
    const isDefault = code === currentLanguage;
    const firstName = isDefault ? 'first_name' : `first_name__${code}`;
    const lastName = isDefault ? 'last_name' : `last_name__${code}`;
    fields.push({ type: 'text', label: `Given name (${label})`, name: firstName });
    fields.push({ type: 'text', label: `Family name (${label})`, name: lastName });
  }
  fields.push({ type: 'text', label: 'Birthday', name: 'birthday' });
  fields.push({ type: 'text', label: 'Profile photo', name: 'avatar' });
  return fields;
}
