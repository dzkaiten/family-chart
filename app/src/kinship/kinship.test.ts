import { describe, it, expect } from 'vitest';
import type { StoredPerson } from '../types';
import { buildChain, isOlder } from './chain';
import { kinshipTerm } from './index';

// --- Fixture family (4 generations, paternal + maternal branches, spouses,
// in-laws, a same-surname 堂 cousin and a maternal 表/姨 cousin, plus one uncle
// with NO birthday to exercise unknown-seniority, and a disconnected stranger).

interface Spec {
  g?: 'M' | 'F';
  b?: string;            // birthday
  parents?: string[];
  spouses?: string[];
  children?: string[];
}

function person(id: string, s: Spec): StoredPerson {
  return {
    id,
    data: { names: {}, ...(s.g ? { gender: s.g } : {}), ...(s.b ? { birthday: s.b } : {}) },
    rels: { parents: s.parents ?? [], spouses: s.spouses ?? [], children: s.children ?? [] }
  };
}

const PGF_KIDS = ['father', 'uncleBo', 'uncleShu', 'auntGu', 'uncleX'];
const MGF_KIDS = ['mother', 'muncle', 'maunt'];

const people: StoredPerson[] = [
  person('pgf', { g: 'M', b: '1930', spouses: ['pgm'], children: PGF_KIDS }),
  person('pgm', { g: 'F', b: '1932', spouses: ['pgf'], children: PGF_KIDS }),
  person('mgf', { g: 'M', b: '1928', spouses: ['mgm'], children: MGF_KIDS }),
  person('mgm', { g: 'F', b: '1931', spouses: ['mgf'], children: MGF_KIDS }),

  person('father',  { g: 'M', b: '1955', parents: ['pgf', 'pgm'], spouses: ['mother'], children: ['self', 'bro', 'sis'] }),
  person('uncleBo', { g: 'M', b: '1952', parents: ['pgf', 'pgm'], spouses: ['boWife'], children: ['cousinTang'] }), // older than father
  person('uncleShu',{ g: 'M', b: '1958', parents: ['pgf', 'pgm'] }), // younger than father
  person('auntGu',  { g: 'F', b: '1960', parents: ['pgf', 'pgm'], spouses: ['guHusband'] }), // younger than father
  person('uncleX',  { g: 'M', parents: ['pgf', 'pgm'] }), // NO birthday → unknown seniority
  person('boWife',  { g: 'F', spouses: ['uncleBo'], children: ['cousinTang'] }),
  person('guHusband', { g: 'M', spouses: ['auntGu'] }),

  person('mother',  { g: 'F', b: '1957', parents: ['mgf', 'mgm'], spouses: ['father'], children: ['self', 'bro', 'sis'] }),
  person('muncle',  { g: 'M', b: '1953', parents: ['mgf', 'mgm'] }), // older than mother
  person('maunt',   { g: 'F', b: '1959', parents: ['mgf', 'mgm'], children: ['cousinBiao'] }), // younger than mother

  person('self',    { g: 'M', b: '1985', parents: ['father', 'mother'], spouses: ['wife'], children: ['son', 'daughter'] }),
  person('bro',     { g: 'M', b: '1982', parents: ['father', 'mother'], children: ['nephew'] }), // older than self
  person('sis',     { g: 'F', b: '1988', parents: ['father', 'mother'], children: ['sisSon'] }), // younger than self
  person('cousinTang', { g: 'M', b: '1980', parents: ['uncleBo', 'boWife'] }), // older than self
  person('cousinBiao', { g: 'F', b: '1990', parents: ['maunt'] }), // younger than self

  person('wife',    { g: 'F', parents: ['wifeFather', 'wifeMother'], spouses: ['self'] }),
  person('wifeFather', { g: 'M', children: ['wife'] }),
  person('wifeMother', { g: 'F', children: ['wife'] }),

  person('son',      { g: 'M', b: '2010', parents: ['self', 'wife'] }),
  person('daughter', { g: 'F', b: '2012', parents: ['self', 'wife'] }),
  person('nephew',   { g: 'M', parents: ['bro'] }),
  person('sisSon',   { g: 'M', parents: ['sis'] }),

  person('stranger', { g: 'M', b: '1990' }) // no relationship to anyone
];

// --- Chain builder (the part we own; independent of relationship.js) --------

describe('buildChain', () => {
  const chain = (a: string, b: string) => buildChain(a, b, people)?.chain;

  it('renders lineal and sibling links from the source POV', () => {
    expect(chain('self', 'father')).toBe('爸爸');
    expect(chain('self', 'pgf')).toBe('爸爸的爸爸');
    expect(chain('self', 'mgf')).toBe('妈妈的爸爸');
    expect(chain('self', 'son')).toBe('儿子');
    expect(chain('self', 'wife')).toBe('妻子');
  });

  it('picks sibling seniority from birthdays', () => {
    expect(chain('self', 'bro')).toBe('哥哥');   // 1982 < 1985 → older
    expect(chain('self', 'sis')).toBe('妹妹');   // 1988 > 1985 → younger
    expect(chain('self', 'uncleBo')).toBe('爸爸的哥哥'); // uncle older than father
    expect(chain('self', 'uncleShu')).toBe('爸爸的弟弟'); // uncle younger
    expect(chain('self', 'cousinTang')).toBe('爸爸的哥哥的儿子');
  });

  it('uses a neutral sibling token + ambiguous flag when a birthday is missing', () => {
    const r = buildChain('self', 'uncleX', people)!;
    expect(r.chain).toBe('爸爸的兄弟');
    expect(r.ambiguous).toBe(true);
  });

  it('returns empty chain for self and null for unrelated', () => {
    expect(buildChain('self', 'self', people)!.chain).toBe('');
    expect(buildChain('self', 'stranger', people)).toBeNull();
  });
});

describe('isOlder', () => {
  it('compares ISO-ish dates, null when undeterminable', () => {
    expect(isOlder('1980', '1985')).toBe(true);
    expect(isOlder('1990-05', '1990-01')).toBe(false);
    expect(isOlder(undefined, '1985')).toBeNull();
    expect(isOlder('1985', '1985')).toBeNull();
  });
});

// --- End-to-end terms (through relationship.js) -----------------------------

describe('kinshipTerm (source = self)', () => {
  const term = (target: string) => kinshipTerm('self', target, people).term;

  const cases: [string, string][] = [
    ['father', '爸爸'],
    ['mother', '妈妈'],
    ['pgf', '爷爷'],
    ['pgm', '奶奶'],
    ['mgf', '外公'],
    ['mgm', '外婆'],
    ['uncleBo', '伯父'],
    ['uncleShu', '叔叔'],
    ['auntGu', '小姑'],
    ['muncle', '大舅'],
    ['maunt', '小姨'],
    ['bro', '哥哥'],
    ['sis', '妹妹'],
    ['cousinTang', '堂哥'],   // older paternal cousin
    ['cousinBiao', '姨妹'],   // younger maternal-aunt's daughter
    ['wife', '老婆'],
    ['wifeFather', '岳父'],
    ['wifeMother', '岳母'],
    ['son', '儿子'],
    ['daughter', '女儿'],
    ['nephew', '侄子'],
    ['sisSon', '外甥'],
    ['boWife', '伯母'],
    ['guHusband', '小姑丈']
  ];

  for (const [target, expected] of cases) {
    it(`self → ${target} = ${expected}`, () => {
      expect(term(target)).toBe(expected);
    });
  }

  it('self → self is 本人', () => {
    expect(kinshipTerm('self', 'self', people)).toEqual({
      term: '本人', candidates: ['本人'], chain: '', ambiguous: false
    });
  });

  it('unknown-seniority uncle is ambiguous with both candidates', () => {
    const r = kinshipTerm('self', 'uncleX', people);
    expect(r.ambiguous).toBe(true);
    expect(r.candidates).toEqual(expect.arrayContaining(['伯父', '叔叔']));
  });

  it('unrelated person yields an empty term', () => {
    const r = kinshipTerm('self', 'stranger', people);
    expect(r.term).toBe('');
    expect(r.candidates).toEqual([]);
  });
});
