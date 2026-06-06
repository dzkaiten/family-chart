import { describe, it, expect } from 'vitest';
import { toDisplayPerson, mergePersonUpdate, buildFormFields, formatDisplayName } from './lang';
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

  it('exposes the single Chinese name + its script for the form', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ming', last: 'Yao' }, 'zh-Hant': { full: '姚明' } }), 'en');
    expect(d.data.cn_name).toBe('姚明');
    expect(d.data.cn_script).toBe('zh-Hant');
  });

  it('reads a Simplified Chinese name and reports its script', () => {
    const d = toDisplayPerson(person({ 'zh-Hans': { full: '姚明' } }), 'en');
    expect(d.data.cn_name).toBe('姚明');
    expect(d.data.cn_script).toBe('zh-Hans');
  });

  it('defaults the script to Traditional when there is no Chinese name', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ada', last: 'Lovelace' } }), 'en');
    expect(d.data.cn_name).toBe('');
    expect(d.data.cn_script).toBe('zh-Hant');
  });

  it('card display_name is given-first for English', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ada', last: 'Lovelace' } }), 'en');
    expect(d.data.display_name).toBe('Ada Lovelace');
  });

  it('card display_name uses the Chinese name as written under a Chinese view', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ming', last: 'Yao' }, 'zh-Hant': { full: '姚明' } }), 'zh-Hant');
    expect(d.data.display_name).toBe('姚明');
  });

  it('a Chinese view shows the stored Chinese name even if its script differs', () => {
    const d = toDisplayPerson(person({ 'zh-Hant': { full: '姚明' } }), 'zh-Hans');
    expect(d.data.display_name).toBe('姚明');
  });

  it('does not emit the old per-language suffixed fields', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ada', last: 'Lovelace' } }), 'en');
    expect(d.data['first_name__zh-Hant']).toBeUndefined();
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
    const out = mergePersonUpdate(existing, { first_name: 'Ada', last_name: 'Lovelace' }, 'en');
    expect(out.names.en).toEqual({ first: 'Ada', last: 'Lovelace' });
  });

  it('stores the single Chinese name under the selected script', () => {
    const out = mergePersonUpdate(existing, { cn_name: '姚明', cn_script: 'zh-Hant' }, 'en');
    expect(out.names['zh-Hant']).toEqual({ full: '姚明' });
    expect(out.names['zh-Hans']).toBeUndefined();
  });

  it('switching the script consolidates to one Chinese form', () => {
    const withHant: StoredPerson = {
      id: 'p1',
      data: { names: { 'zh-Hant': { full: '姚明' } } },
      rels: { parents: [], spouses: [], children: [] }
    };
    const out = mergePersonUpdate(withHant, { cn_name: '姚明', cn_script: 'zh-Hans' }, 'en');
    expect(out.names['zh-Hans']).toEqual({ full: '姚明' });
    expect(out.names['zh-Hant']).toBeUndefined();
  });

  it('clears the Chinese name when the box is emptied', () => {
    const withHant: StoredPerson = {
      id: 'p1',
      data: { names: { en: { first: 'Ming', last: 'Yao' }, 'zh-Hant': { full: '姚明' } } },
      rels: { parents: [], spouses: [], children: [] }
    };
    const out = mergePersonUpdate(withHant, { cn_name: '', cn_script: 'zh-Hant' }, 'en');
    expect(out.names['zh-Hant']).toBeUndefined();
    expect(out.names.en).toEqual({ first: 'Ming', last: 'Yao' });
  });

  it('does not leak flat form fields into stored data', () => {
    const out = mergePersonUpdate(existing, {
      first_name: 'Ada', last_name: 'Lovelace', cn_name: '姚明', cn_script: 'zh-Hant'
    }, 'en') as Record<string, unknown>;
    expect(out.first_name).toBeUndefined();
    expect(out.last_name).toBeUndefined();
    expect(out.cn_name).toBeUndefined();
    expect(out.cn_script).toBeUndefined();
  });

  it('keeps non-name fields (gender, birthday)', () => {
    const out = mergePersonUpdate(existing, {
      first_name: 'Ming', last_name: 'Yao', gender: 'M', birthday: '2000-01-01'
    }, 'en');
    expect(out.gender).toBe('M');
    expect(out.birthday).toBe('2000-01-01');
  });
});

describe('buildFormFields', () => {
  it('has English given/family, one Chinese box, and a script select', () => {
    const fields = buildFormFields();
    const names = fields.map(f => f.name);
    expect(names).toContain('first_name');
    expect(names).toContain('last_name');
    expect(names).toContain('cn_name');
    expect(names).toContain('cn_script');
    // no per-script given/family fields anymore
    expect(names.some(n => n.includes('__zh'))).toBe(false);
  });

  it('the script field is a select with Traditional + Simplified options', () => {
    const script = buildFormFields().find(f => f.name === 'cn_script');
    expect(script?.type).toBe('select');
    expect(script?.options?.map(o => o.value)).toEqual(['zh-Hant', 'zh-Hans']);
  });

  it('labels the English fields as Given/Family', () => {
    const fields = buildFormFields();
    expect(fields.find(f => f.name === 'first_name')?.label).toMatch(/Given/);
    expect(fields.find(f => f.name === 'last_name')?.label).toMatch(/Family/);
  });
});
