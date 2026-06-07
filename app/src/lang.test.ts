import { describe, it, expect } from 'vitest';
import { toDisplayPerson, mergePersonUpdate, buildFormFields, formatDisplayName, lifeDates } from './lang';
import type { StoredPerson } from './types';

function person(names: StoredPerson['data']['names']): StoredPerson {
  return { id: 'p1', data: { names }, rels: { parents: [], spouses: [], children: [] } };
}

describe('toDisplayPerson (read adapter)', () => {
  it('maps English to given/family flat fields', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ada', last: 'Lovelace' } }), 'en');
    expect(d.data.first_name).toBe('Ada');
    expect(d.data.last_name).toBe('Lovelace');
  });

  it('exposes the single Chinese name', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ming', last: 'Yao' }, zh: { full: '姚明' } }), 'en');
    expect(d.data.cn_name).toBe('姚明');
  });

  it('reads a legacy zh-Hant/zh-Hans entry as the Chinese name', () => {
    expect(toDisplayPerson(person({ 'zh-Hant': { full: '姚明' } }), 'en').data.cn_name).toBe('姚明');
    expect(toDisplayPerson(person({ 'zh-Hans': { full: '姚明' } }), 'en').data.cn_name).toBe('姚明');
  });

  it('card display_name is given-first for English', () => {
    expect(toDisplayPerson(person({ en: { first: 'Ada', last: 'Lovelace' } }), 'en').data.display_name).toBe('Ada Lovelace');
  });

  it('card display_name shows the Chinese name as written under a Chinese view', () => {
    expect(toDisplayPerson(person({ en: { first: 'Ming', last: 'Yao' }, zh: { full: '姚明' } }), 'zh-Hant').data.display_name).toBe('姚明');
  });

  it('emits no per-script suffixed fields and no script selector', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ada', last: 'Lovelace' } }), 'en');
    expect(d.data['first_name__zh']).toBeUndefined();
    expect(d.data.cn_script).toBeUndefined();
  });
});

describe('formatDisplayName', () => {
  it('uses a single-unit name as-is', () => {
    expect(formatDisplayName({ full: '姚明' }, 'zh-Hant')).toBe('姚明');
  });
  it('orders given/family by script', () => {
    expect(formatDisplayName({ first: 'Ada', last: 'Lovelace' }, 'en')).toBe('Ada Lovelace');
    expect(formatDisplayName({ first: '明', last: '姚' }, 'zh-Hant')).toBe('姚明');
  });
});

describe('mergePersonUpdate (write adapter)', () => {
  const existing: StoredPerson = {
    id: 'p1',
    data: { names: { en: { first: 'Ming', last: 'Yao' } }, gender: 'M' },
    rels: { parents: [], spouses: [], children: [] }
  };

  it('writes English given/family into names.en', () => {
    expect(mergePersonUpdate(existing, { first_name: 'Ada', last_name: 'Lovelace' }, 'en').names.en)
      .toEqual({ first: 'Ada', last: 'Lovelace' });
  });

  it('stores the Chinese box as a single names.zh.full (any script accepted)', () => {
    const out = mergePersonUpdate(existing, { cn_name: '姚明' }, 'en');
    expect(out.names.zh).toEqual({ full: '姚明' });
  });

  it('replaces a legacy zh-Hant entry with the single zh entry', () => {
    const legacy: StoredPerson = { id: 'p1', data: { names: { 'zh-Hant': { full: '舊名' } } }, rels: { parents: [], spouses: [], children: [] } };
    const out = mergePersonUpdate(legacy, { cn_name: '姚明' }, 'en');
    expect(out.names.zh).toEqual({ full: '姚明' });
    expect(out.names['zh-Hant']).toBeUndefined();
  });

  it('clears the Chinese name when the box is emptied', () => {
    const withZh: StoredPerson = { id: 'p1', data: { names: { en: { first: 'Ming', last: 'Yao' }, zh: { full: '姚明' } } }, rels: { parents: [], spouses: [], children: [] } };
    const out = mergePersonUpdate(withZh, { cn_name: '' }, 'en');
    expect(out.names.zh).toBeUndefined();
    expect(out.names.en).toEqual({ first: 'Ming', last: 'Yao' });
  });

  it('does not leak flat form fields into stored data', () => {
    const out = mergePersonUpdate(existing, { first_name: 'Ada', last_name: 'Lovelace', cn_name: '姚明' }, 'en') as Record<string, unknown>;
    expect(out.first_name).toBeUndefined();
    expect(out.last_name).toBeUndefined();
    expect(out.cn_name).toBeUndefined();
  });

  it('keeps non-name fields (gender, birthday)', () => {
    const out = mergePersonUpdate(existing, { first_name: 'Ming', last_name: 'Yao', gender: 'M', birthday: '2000-01-01' }, 'en');
    expect(out.gender).toBe('M');
    expect(out.birthday).toBe('2000-01-01');
  });
});

describe('buildFormFields', () => {
  it('has English given/family + one Chinese box, no script select', () => {
    const fields = buildFormFields();
    const names = fields.map(f => f.name);
    expect(names).toContain('first_name');
    expect(names).toContain('last_name');
    expect(names).toContain('cn_name');
    expect(names).not.toContain('cn_script');
    expect(names.some(n => n.includes('__zh'))).toBe(false);
    expect(fields.every(f => f.type !== 'select')).toBe(true);
  });

  it('labels the English fields First/Last name', () => {
    const fields = buildFormFields();
    expect(fields.find(f => f.name === 'first_name')?.label).toMatch(/First name/);
    expect(fields.find(f => f.name === 'last_name')?.label).toMatch(/Last name/);
  });

  it('includes deceased, death_date, and all six contact fields with non-empty labels', () => {
    const fields = buildFormFields();
    const names = fields.map(f => f.name);
    expect(names).toContain('deceased');
    expect(names).toContain('death_date');
    expect(names).toContain('email');
    expect(names).toContain('phone');
    expect(names).toContain('wechat');
    expect(names).toContain('instagram');
    expect(names).toContain('facebook');
    expect(names).toContain('linkedin');
    // Every field must have a non-empty label
    for (const f of fields) {
      expect(f.label, `field ${f.name} must have a non-empty label`).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// lifeDates helper
// ---------------------------------------------------------------------------

describe('lifeDates', () => {
  it('living, birthday known → birth year only', () => {
    expect(lifeDates({ birthday: '1940-06-15', deceased: false })).toBe('1940');
  });

  it('living, no birthday → empty string', () => {
    expect(lifeDates({ deceased: false })).toBe('');
  });

  it('deceased, both known → "birth–death"', () => {
    expect(lifeDates({ birthday: '1940-06-15', deceased: true, death_date: '2012-03-01' })).toBe('1940–2012');
  });

  it('deceased, only death known → "–death"', () => {
    expect(lifeDates({ deceased: true, death_date: '2012-03-01' })).toBe('–2012');
  });

  it('deceased, only birth known → "birth–"', () => {
    expect(lifeDates({ deceased: true, birthday: '1940-06-15' })).toBe('1940–');
  });

  it('deceased, neither known → empty string', () => {
    expect(lifeDates({ deceased: true })).toBe('');
  });
});

// ---------------------------------------------------------------------------
// mergePersonUpdate: contact fields + deceased/death_date round-trip
// ---------------------------------------------------------------------------

describe('mergePersonUpdate — contact fields and deceased', () => {
  const base: StoredPerson = {
    id: 'p1',
    data: { names: { en: { first: 'Alice', last: 'Smith' } } },
    rels: { parents: [], spouses: [], children: [] }
  };

  it('stores contact fields, trims whitespace, drops empty strings', () => {
    const out = mergePersonUpdate(base, {
      first_name: 'Alice', last_name: 'Smith',
      email: '  alice@example.com  ',
      phone: '',
      wechat: 'alice_wechat',
      instagram: '',
      facebook: '',
      linkedin: 'alice-li'
    }, 'en') as Record<string, unknown>;
    expect(out.email).toBe('alice@example.com');
    expect(out.wechat).toBe('alice_wechat');
    expect(out.linkedin).toBe('alice-li');
    // Empty strings must not be stored
    expect(out.phone).toBeUndefined();
    expect(out.instagram).toBeUndefined();
    expect(out.facebook).toBeUndefined();
  });

  it('stores deceased as boolean true', () => {
    const out = mergePersonUpdate(base, { first_name: 'Alice', last_name: 'Smith', deceased: 'true' }, 'en') as Record<string, unknown>;
    expect(out.deceased).toBe(true);
  });

  it('stores deceased:true when form sends boolean true', () => {
    const out = mergePersonUpdate(base, { first_name: 'Alice', last_name: 'Smith', deceased: true }, 'en') as Record<string, unknown>;
    expect(out.deceased).toBe(true);
  });

  it('drops deceased key when false/absent', () => {
    const withDeceased: StoredPerson = {
      id: 'p1',
      data: { names: { en: { first: 'Alice', last: 'Smith' } }, deceased: true } as any,
      rels: { parents: [], spouses: [], children: [] }
    };
    const out = mergePersonUpdate(withDeceased, { first_name: 'Alice', last_name: 'Smith', deceased: false }, 'en') as Record<string, unknown>;
    expect(out.deceased).toBeUndefined();
  });

  it('stores death_date as trimmed string', () => {
    const out = mergePersonUpdate(base, { first_name: 'Alice', last_name: 'Smith', death_date: '2012-03-01' }, 'en') as Record<string, unknown>;
    expect(out.death_date).toBe('2012-03-01');
  });

  it('drops death_date when empty', () => {
    const out = mergePersonUpdate(base, { first_name: 'Alice', last_name: 'Smith', death_date: '' }, 'en') as Record<string, unknown>;
    expect(out.death_date).toBeUndefined();
  });

  it('toDisplayPerson passes through contact fields from StoredPerson', () => {
    const stored: StoredPerson = {
      id: 'p2',
      data: {
        names: { en: { first: 'Bob', last: 'Jones' } },
        email: 'bob@example.com',
        phone: '555-1234',
        deceased: true,
        death_date: '2020-05-10'
      } as any,
      rels: { parents: [], spouses: [], children: [] }
    };
    const d = toDisplayPerson(stored, 'en');
    expect(d.data.email).toBe('bob@example.com');
    expect(d.data.phone).toBe('555-1234');
    expect(d.data.deceased).toBe(true);
    expect(d.data.death_date).toBe('2020-05-10');
  });
});
