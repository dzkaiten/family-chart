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
    expect(toDisplayPerson(person({ en: { first: 'Ming', last: 'Yao' }, zh: { full: '姚明' } }), 'zh').data.display_name).toBe('姚明');
  });

  it('emits no per-script suffixed fields and no script selector', () => {
    const d = toDisplayPerson(person({ en: { first: 'Ada', last: 'Lovelace' } }), 'en');
    expect(d.data['first_name__zh']).toBeUndefined();
    expect(d.data.cn_script).toBeUndefined();
  });
});

describe('formatDisplayName', () => {
  it('uses a single-unit name as-is', () => {
    expect(formatDisplayName({ full: '姚明' }, 'zh')).toBe('姚明');
  });
  it('orders given/family by script', () => {
    expect(formatDisplayName({ first: 'Ada', last: 'Lovelace' }, 'en')).toBe('Ada Lovelace');
    expect(formatDisplayName({ first: '明', last: '姚' }, 'zh')).toBe('姚明');
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

  it('labels the English fields Given/Family', () => {
    const fields = buildFormFields();
    expect(fields.find(f => f.name === 'first_name')?.label).toMatch(/Given/);
    expect(fields.find(f => f.name === 'last_name')?.label).toMatch(/Family/);
  });
});
