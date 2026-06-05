import { describe, it, expect } from 'vitest';
import { isStoragePath } from './storage';

describe('isStoragePath', () => {
  it('treats a bare path as a storage path', () => {
    expect(isStoragePath('tree/p1/x.jpg')).toBe(true);
  });
  it('treats http(s) URLs as not-a-path (pass-through)', () => {
    expect(isStoragePath('https://x/y')).toBe(false);
    expect(isStoragePath('http://x/y')).toBe(false);
  });
  it('treats empty as not-a-path', () => {
    expect(isStoragePath('')).toBe(false);
  });
});
