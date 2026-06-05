import { describe, it, expect } from 'vitest';
import { stripAvatars } from './export';
import type { StoredPerson } from './types';

describe('stripAvatars', () => {
  it('removes avatar but keeps names and rels', () => {
    const people: StoredPerson[] = [{
      id: 'p1',
      data: { names: { en: { first: 'A', last: 'B' } }, avatar: 'tree/p1/x.jpg', birthday: '2000' },
      rels: { parents: ['p2'], spouses: [], children: [] }
    }];
    const out = stripAvatars(people);
    expect('avatar' in out[0].data).toBe(false);
    expect(out[0].data.names.en).toEqual({ first: 'A', last: 'B' });
    expect(out[0].rels.parents).toEqual(['p2']);
  });
});
