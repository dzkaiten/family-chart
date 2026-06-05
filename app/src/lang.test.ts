import { describe, it, expect } from 'vitest';
import { toDisplayPerson, mergePersonUpdate, buildFormFields } from './lang';
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

  it('does not fabricate an active-language name from the display fallback', () => {
    // Active language zh-Hant, person has only an English name. The unsuffixed
    // (active) field shows the English fallback; saving must NOT create a
    // zh-Hant entry equal to the English name.
    const enOnly: StoredPerson = {
      id: 'p1',
      data: { names: { en: { first: 'John', last: 'Smith' } } },
      rels: { parents: [], spouses: [], children: [] }
    };
    const out = mergePersonUpdate(enOnly, {
      first_name: 'John', last_name: 'Smith',
      'first_name__en': 'John', 'last_name__en': 'Smith'
    }, 'zh-Hant');
    expect(out.names['zh-Hant']).toBeUndefined();
    expect(out.names.en).toEqual({ first: 'John', last: 'Smith' });
  });

  it('persists a real active-language name the user actually typed', () => {
    const enOnly: StoredPerson = {
      id: 'p1',
      data: { names: { en: { first: 'John', last: 'Smith' } } },
      rels: { parents: [], spouses: [], children: [] }
    };
    const out = mergePersonUpdate(enOnly, {
      first_name: '約翰', last_name: '史密斯',
      'first_name__en': 'John', 'last_name__en': 'Smith'
    }, 'zh-Hant');
    expect(out.names['zh-Hant']).toEqual({ first: '約翰', last: '史密斯' });
  });
});

describe('buildFormFields (form labels)', () => {
  it('produces human-readable labels per language', () => {
    // module default language is 'en'; no setLanguage() (it touches localStorage)
    const fields = buildFormFields();
    const enFirst = fields.find(f => f.name === 'first_name');
    const zhFirst = fields.find(f => f.name === 'first_name__zh-Hant');
    expect(enFirst?.label).toMatch(/English/);
    expect(zhFirst?.label).toMatch(/繁體/);
  });
});
