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
import { t } from './i18n';

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
// `names` holds one entry per language. English is a structured given/family
// name; Chinese is a single-unit name in `full` under the `zh` key (script-
// agnostic — we accept Traditional or Simplified and don't distinguish them).

function isFamilyNameFirst(code: LanguageCode | null): boolean {
  return !!code && /^(zh|ja|ko)/.test(code);
}

function isChinese(code: LanguageCode | null): boolean {
  return !!code && /^zh/.test(code);
}

function hasName(e: NameEntry | undefined): boolean {
  return !!e && !!(e.first || e.last || e.full);
}

// The Chinese name entry, accepting the canonical `zh` key or any legacy
// `zh-*` key from earlier data.
function chineseEntry(names: NamesMap): NameEntry | undefined {
  if (hasName(names.zh)) return names.zh;
  for (const code of Object.keys(names)) {
    if (/^zh/.test(code) && hasName(names[code])) return names[code];
  }
  return undefined;
}

function chineseString(e: NameEntry | undefined): string {
  if (!e) return '';
  if (e.full) return e.full;
  return `${e.last ?? ''}${e.first ?? ''}`; // legacy given/family Chinese data
}

// Resolve the name to show for `lang`, with its source code (for ordering).
function resolveNameWithCode(
  names: NamesMap,
  lang: LanguageCode
): { entry: NameEntry; code: LanguageCode | null } {
  if (isChinese(lang)) {
    const cn = chineseEntry(names);
    if (cn) return { entry: cn, code: lang };
  } else if (hasName(names[lang])) {
    return { entry: names[lang]!, code: lang };
  }
  if (hasName(names.en)) return { entry: names.en!, code: 'en' };
  const cn = chineseEntry(names);
  if (cn) return { entry: cn, code: 'zh-Hant' };
  for (const code of Object.keys(names)) {
    if (hasName(names[code])) return { entry: names[code]!, code: code as LanguageCode };
  }
  return { entry: {}, code: null };
}

// Compose one display string:
//   - a single-unit name uses `full` as written (姚明)
//   - otherwise order given/family by script (family-first, no space, for CJK)
export function formatDisplayName(entry: NameEntry, code: LanguageCode | null): string {
  if (entry.full) return entry.full;
  const first = entry.first ?? '';
  const last = entry.last ?? '';
  if (isFamilyNameFirst(code)) return `${last}${first}`;
  return [first, last].filter(Boolean).join(' ');
}

// Card name lines, computed from the FLAT fields (first_name/last_name/cn_name)
// that exist for BOTH loaded and just-added people. The read adapter's
// display_name only exists on loaded data, so newly-added cards lacked it and
// previously showed only the birthday — computing from the flat fields fixes that.
export function cardPrimaryName(data: Record<string, unknown>, _lang: LanguageCode = currentLanguage): string {
  const cn = readString(data.cn_name);
  if (cn) return cn;
  return formatDisplayName({ first: readString(data.first_name), last: readString(data.last_name) }, 'en');
}

export function cardSecondaryName(data: Record<string, unknown>, lang: LanguageCode = currentLanguage): string {
  const primary = cardPrimaryName(data, lang);
  const en = formatDisplayName({ first: readString(data.first_name), last: readString(data.last_name) }, 'en');
  const cn = readString(data.cn_name);
  const other = primary === cn ? en : cn;
  return other && other !== primary ? other : '';
}

// ---------------------------------------------------------------------------
// Read adapter: stored shape -> library-facing shape (flat fields)
// ---------------------------------------------------------------------------

export function toDisplayPerson(person: StoredPerson, lang: LanguageCode = currentLanguage): DisplayPerson {
  const names = person.data.names ?? {};
  const en = names.en ?? {};

  // Primary name shown on the CARD, in the current VIEW language (with fallback).
  const { entry: activeName, code: activeCode } = resolveNameWithCode(names, lang);
  const display_name = formatDisplayName(activeName, activeCode);

  const enStr = (en.first || en.last) ? formatDisplayName(en, 'en') : '';
  const cnStr = chineseString(chineseEntry(names));
  // Secondary line: the OTHER name (so we never repeat the primary). e.g. in an
  // English view this is the Chinese name, and vice versa.
  const altCandidate = display_name === cnStr ? enStr : cnStr;
  const alt_name = altCandidate && altCandidate !== display_name ? altCandidate : '';

  // Drop the names map; the library reads flat fields instead.
  const { names: _drop, ...rest } = person.data;
  const out: DisplayPerson['data'] = {
    ...rest,
    first_name: en.first ?? '',
    last_name: en.last ?? '',
    cn_name: cnStr,
    display_name,
    alt_name
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

  // Single, script-agnostic Chinese name under `zh` (drops any legacy zh-* keys).
  if ('cn_name' in formData) {
    const cnName = readString(formData.cn_name);
    for (const code of Object.keys(baseNames)) {
      if (/^zh/.test(code)) delete baseNames[code];
    }
    if (cnName) baseNames.zh = { full: cnName };
  }

  // Keep non-name fields (gender, birthday, avatar, …); drop name + form-only keys.
  // Contact strings: trim and drop empty values (don't persist "").
  // deceased: coerce to boolean; delete when false/empty.
  // death_date: trim; delete when empty.
  const CONTACT_KEYS = new Set(['email', 'phone', 'wechat', 'instagram', 'facebook', 'linkedin']);
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(formData)) {
    if (key === 'first_name' || key === 'last_name' || key === 'cn_name') continue;
    if (key === 'cn_script') continue; // legacy from the script-dropdown version
    if (key.startsWith('first_name__') || key.startsWith('last_name__')) continue; // legacy
    if (key === 'names' || key === 'display_name' || key === 'alt_name') continue;

    if (key === 'deceased') {
      const boolVal = value === true || value === 'true';
      if (boolVal) rest[key] = true;
      // else: omit (delete key)
      continue;
    }

    if (key === 'death_date') {
      const s = readString(value);
      if (s) rest[key] = s;
      // else: omit
      continue;
    }

    if (CONTACT_KEYS.has(key)) {
      const s = readString(value);
      if (s) rest[key] = s;
      // else: omit — don't persist empty strings
      continue;
    }

    rest[key] = value;
  }

  const merged: PersonData = {
    ...(existing?.data ?? {}),
    ...rest,
    names: baseNames
  };

  // Explicitly remove keys that were cleared by the form (omitted from rest).
  // The spread of existing?.data above would otherwise preserve the old value.
  if ('deceased' in formData && !rest.deceased) delete merged.deceased;
  if ('death_date' in formData && !rest.death_date) delete merged.death_date;
  for (const key of CONTACT_KEYS) {
    if (key in formData && !rest[key]) delete (merged as Record<string, unknown>)[key];
  }

  return merged;
}

function readString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  return '';
}

// ---------------------------------------------------------------------------
// Form fields the family-chart library renders ({type, label, name})
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Life-dates helper (card line 3)
// ---------------------------------------------------------------------------

/**
 * Return a life-date string for card display.
 * Living with birthday → birth year ("1940").
 * Deceased with both → "1940–2012".
 * Deceased, only death → "–2012".
 * Deceased, only birth → "1940–".
 * Otherwise → "".
 */
export function lifeDates(data: Record<string, unknown>): string {
  const birthYear = yearFrom(data.birthday);
  const deathYear = yearFrom(data.death_date);
  const deceased = !!data.deceased;

  if (!deceased) {
    return birthYear ?? '';
  }
  // Deceased branch
  if (birthYear && deathYear) return `${birthYear}–${deathYear}`;
  if (deathYear) return `–${deathYear}`;
  if (birthYear) return `${birthYear}–`;
  return '';
}

function yearFrom(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  const m = v.match(/^(\d{4})/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Form fields the family-chart library renders ({type, label, name})
// ---------------------------------------------------------------------------

export interface FormFieldConfig {
  type: string;
  label: string;
  name: string;
  options?: { value: string; label: string }[];
}

export function buildFormFields(): FormFieldConfig[] {
  return [
    { type: 'text',     label: t('firstName'),  name: 'first_name' },
    { type: 'text',     label: t('lastName'),   name: 'last_name' },
    // One optional Chinese name; accepts Traditional or Simplified, stored as-is.
    { type: 'text',     label: t('chineseName'), name: 'cn_name' },
    { type: 'text',     label: t('birthday'),   name: 'birthday' },
    // Deceased flag + death date (upgraded to date picker by tree.ts MutationObserver)
    { type: 'text',     label: t('deceased'),   name: 'deceased' },
    { type: 'text',     label: t('deathDate'),  name: 'death_date' },
    // Contact info block
    { type: 'text',     label: t('email'),       name: 'email' },
    { type: 'text',     label: t('phone'),       name: 'phone' },
    { type: 'text',     label: t('wechat'),      name: 'wechat' },
    { type: 'text',     label: t('instagram'),   name: 'instagram' },
    { type: 'text',     label: t('facebook'),    name: 'facebook' },
    { type: 'text',     label: t('linkedin'),    name: 'linkedin' },
    { type: 'text',     label: t('profilePhoto'), name: 'avatar' }
  ];
}
