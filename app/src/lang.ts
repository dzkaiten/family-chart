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
// Name model
// ---------------------------------------------------------------------------
// A person's `names` map holds one entry per script, language-tagged
// (GEDCOM-X style). English is a structured given/family name; Chinese is a
// single-unit name stored in `full` under ONE script key (zh-Hant or zh-Hans).

// Cultures that write the family name first (and, for CJK, with no separator).
function isFamilyNameFirst(lang: LanguageCode | null): boolean {
  return !!lang && /^(zh|ja|ko)(-|$)/.test(lang);
}

function isChinese(lang: LanguageCode | null): boolean {
  return !!lang && /^zh(-|$)/.test(lang);
}

function hasName(e: NameEntry | undefined): boolean {
  return !!e && !!(e.first || e.last || e.full);
}

// Resolve the best name for `lang`, returning the entry AND the code it came
// from (so display follows the name's own script). For a Chinese view we prefer
// the other Chinese script before falling back to English.
function resolveNameWithCode(
  names: NamesMap,
  lang: LanguageCode
): { entry: NameEntry; code: LanguageCode | null } {
  if (hasName(names[lang])) return { entry: names[lang]!, code: lang };

  if (isChinese(lang)) {
    const other: LanguageCode = lang === 'zh-Hant' ? 'zh-Hans' : 'zh-Hant';
    if (hasName(names[other])) return { entry: names[other]!, code: other };
  }

  if (hasName(names.en)) return { entry: names.en!, code: 'en' };

  for (const code of Object.keys(names)) {
    if (hasName(names[code])) return { entry: names[code]!, code: code as LanguageCode };
  }
  return { entry: {}, code: null };
}

// Compose one display string for a name entry:
//   - a Chinese single-unit name uses `full` as written (姚明)
//   - otherwise order given/family by script (family-first, no space, for CJK)
export function formatDisplayName(entry: NameEntry, code: LanguageCode | null): string {
  if (entry.full) return entry.full;
  const first = entry.first ?? '';
  const last = entry.last ?? '';
  if (isFamilyNameFirst(code)) return `${last}${first}`;
  return [first, last].filter(Boolean).join(' ');
}

// We keep a single Chinese form per person; prefer Traditional when both exist.
function pickChineseCode(names: NamesMap): LanguageCode | null {
  if (hasName(names['zh-Hant'])) return 'zh-Hant';
  if (hasName(names['zh-Hans'])) return 'zh-Hans';
  return null;
}

// Read a Chinese entry as one string (supports legacy given/family Chinese data).
function chineseNameString(e: NameEntry | undefined): string {
  if (!e) return '';
  if (e.full) return e.full;
  return `${e.last ?? ''}${e.first ?? ''}`;
}

// ---------------------------------------------------------------------------
// Read adapter: stored shape -> library-facing shape (flat fields)
// ---------------------------------------------------------------------------

export function toDisplayPerson(person: StoredPerson, lang: LanguageCode = currentLanguage): DisplayPerson {
  const names = person.data.names ?? {};
  const en = names.en ?? {};
  const cnCode = pickChineseCode(names);

  // Name shown on the CARD, in the current VIEW language (with fallback).
  const { entry: activeName, code: activeCode } = resolveNameWithCode(names, lang);

  // Drop the names map; the library reads flat fields instead.
  const { names: _drop, ...rest } = person.data;
  const out: DisplayPerson['data'] = {
    ...rest,
    // English structured name (edited as given/family).
    first_name: en.first ?? '',
    last_name: en.last ?? '',
    // Single Chinese name + the script it's written in (for the edit form).
    cn_name: chineseNameString(cnCode ? names[cnCode] : undefined),
    cn_script: cnCode ?? 'zh-Hant',
    // Culturally-ordered label for the card.
    display_name: formatDisplayName(activeName, activeCode)
  };

  return { id: person.id, data: out, rels: person.rels };
}

export function toDisplayPeople(people: StoredPerson[], lang: LanguageCode = currentLanguage): DisplayPerson[] {
  return people.map(p => toDisplayPerson(p, lang));
}

// ---------------------------------------------------------------------------
// Write adapter: library form payload -> stored shape
// ---------------------------------------------------------------------------

export function mergePersonUpdate(
  existing: StoredPerson | null,
  formData: Record<string, unknown>,
  _activeLanguage: LanguageCode = currentLanguage
): PersonData {
  const baseNames: NamesMap = existing?.data.names ? { ...existing.data.names } : {};

  // English structured name.
  if ('first_name' in formData || 'last_name' in formData) {
    const first = readString(formData.first_name);
    const last = readString(formData.last_name);
    if (first || last) baseNames.en = { first, last };
    else delete baseNames.en;
  }

  // Single Chinese name -> stored under the selected script; the OTHER script is
  // cleared so each person keeps exactly one Chinese form.
  if ('cn_name' in formData || 'cn_script' in formData) {
    const cnName = readString(formData.cn_name);
    const script: LanguageCode = readString(formData.cn_script) === 'zh-Hans' ? 'zh-Hans' : 'zh-Hant';
    delete baseNames['zh-Hant'];
    delete baseNames['zh-Hans'];
    if (cnName) baseNames[script] = { full: cnName };
  }

  // Keep non-name fields (gender, birthday, avatar, …); drop name + form-only keys.
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formData)) {
    if (key === 'first_name' || key === 'last_name') continue;
    if (key === 'cn_name' || key === 'cn_script') continue;
    if (key.startsWith('first_name__') || key.startsWith('last_name__')) continue; // legacy
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

// ---------------------------------------------------------------------------
// Form fields the family-chart library renders ({type, label, name[, options]})
// ---------------------------------------------------------------------------

export interface FormFieldConfig {
  type: string;
  label: string;
  name: string;
  options?: { value: string; label: string }[];
}

export function buildFormFields(): FormFieldConfig[] {
  return [
    // English (Latin) name: structured given + family.
    { type: 'text', label: 'Given name', name: 'first_name' },
    { type: 'text', label: 'Family name', name: 'last_name' },
    // Chinese name: one optional box (written as a single unit) + its script.
    { type: 'text', label: 'Chinese name (optional)', name: 'cn_name' },
    {
      type: 'select',
      label: 'Chinese script',
      name: 'cn_script',
      options: [
        { value: 'zh-Hant', label: 'Traditional (繁體)' },
        { value: 'zh-Hans', label: 'Simplified (简体)' }
      ]
    },
    { type: 'text', label: 'Birthday', name: 'birthday' },
    { type: 'text', label: 'Profile photo', name: 'avatar' }
  ];
}
