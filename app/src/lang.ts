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

function resolveName(names: NamesMap, lang: LanguageCode): NameEntry {
  const direct = names[lang];
  if (direct && (direct.first || direct.last)) return direct;

  const en = names.en;
  if (en && (en.first || en.last)) return en;

  for (const code of Object.keys(names)) {
    const entry = names[code];
    if (entry && (entry.first || entry.last)) return entry;
  }
  return {};
}

export function toDisplayPerson(person: StoredPerson, lang: LanguageCode = currentLanguage): DisplayPerson {
  const names = person.data.names ?? {};
  const activeName = resolveName(names, lang);

  // Drop the names map; the library reads flat fields instead.
  const { names: _drop, ...rest } = person.data;
  const out: DisplayPerson['data'] = {
    ...rest,
    first_name: activeName.first ?? '',
    last_name: activeName.last ?? ''
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

  // Strip name-related keys from the form before merging the rest
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formData)) {
    if (key === 'first_name' || key === 'last_name') continue;
    if (key.startsWith('first_name__') || key.startsWith('last_name__')) continue;
    if (key === 'names') continue;
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
    fields.push({ type: 'text', label: `First name (${label})`, name: firstName });
    fields.push({ type: 'text', label: `Last name (${label})`, name: lastName });
  }
  fields.push({ type: 'text', label: 'Birthday', name: 'birthday' });
  fields.push({ type: 'text', label: 'Avatar', name: 'avatar' });
  return fields;
}
