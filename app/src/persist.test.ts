import { describe, it, expect } from 'vitest';
import { mapExportedToStored, buildOriginalIndex } from './persist';
import type { DisplayPerson, StoredPerson } from './types';

const original: StoredPerson = {
  id: 'p1',
  data: { names: { en: { first: 'John', last: 'Smith' } }, avatar: 'tree/p1/old.jpg' },
  rels: { parents: [], spouses: [], children: [] }
};

function exported(over: Partial<DisplayPerson['data']>, rels?: Partial<DisplayPerson['rels']>): DisplayPerson {
  return {
    id: 'p1',
    data: { first_name: 'John', last_name: 'Smith', ...over },
    rels: { parents: [], spouses: [], children: [], ...(rels ?? {}) }
  };
}

describe('mapExportedToStored', () => {
  const idx = buildOriginalIndex([original]);

  it('restores the original storage path when the library still holds a signed URL', () => {
    const paths = new Map([['p1', 'tree/p1/old.jpg']]);
    const out = mapExportedToStored(
      [exported({ avatar: 'https://signed.example/abc' })], idx, paths, 'en'
    );
    expect(out[0].data.avatar).toBe('tree/p1/old.jpg');
  });

  it('keeps a freshly-uploaded bare path', () => {
    const out = mapExportedToStored(
      [exported({ avatar: 'tree/p1/new.jpg' })], idx, new Map(), 'en'
    );
    expect(out[0].data.avatar).toBe('tree/p1/new.jpg');
  });

  it('clears the avatar when the field is emptied', () => {
    const out = mapExportedToStored([exported({ avatar: '' })], idx, new Map(), 'en');
    expect('avatar' in out[0].data).toBe(false);
  });

  it('rebuilds the names map and strips flat fields', () => {
    const out = mapExportedToStored([exported({})], idx, new Map(), 'en');
    expect(out[0].data.names.en).toEqual({ first: 'John', last: 'Smith' });
    expect((out[0].data as Record<string, unknown>).first_name).toBeUndefined();
  });

  it('defaults missing rels arrays to empty (export drops empties)', () => {
    const d = exported({});
    delete (d.rels as Record<string, unknown>).spouses; // formatDataForExport removes empty arrays
    const out = mapExportedToStored([d], idx, new Map(), 'en');
    expect(out[0].rels.spouses).toEqual([]);
  });
});
