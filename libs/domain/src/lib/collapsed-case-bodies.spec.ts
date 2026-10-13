import { describe, expect, it } from 'vitest';
import { findCollapsedCaseBodies } from './collapsed-case-bodies';

describe('findCollapsedCaseBodies', () => {
  it('reports a literal body behind an unspaced offset', () => {
    expect(findCollapsedCaseBodies('{p, plural, offset:2other{x}}')).toEqual([
      { selector: 'other', body: 'x', bodyRange: { start: 26, end: 27 } },
    ]);
  });

  it('reports a literal body behind a non-ASCII select key, a documented false positive', () => {
    expect(findCollapsedCaseBodies('{g, select, männlich {Herr} other {y}}')).toEqual([
      { selector: 'männlich', body: 'Herr', bodyRange: { start: 22, end: 26 } },
    ]);
  });

  it('reports a dotted literal body', () => {
    expect(findCollapsedCaseBodies('{g, select, 日本 {a.b} other {y}}').map((found) => found.body)).toEqual(['a.b']);
  });

  it('reports a body in a nested group', () => {
    expect(findCollapsedCaseBodies('{n, plural, other {{g, select, é {x} other {y}}}}')).toHaveLength(1);
  });

  for (const value of [
    '{p, plural, offset:2 other{x}}',
    '{g, select, a {x} other {y}}',
    '{p, plural, offset:2other{x y}}',
    '{p, plural, offset:2other{{x}}}',
    '{g, select, männlich {x',
    'plain text',
  ]) {
    it(`reports nothing for ${JSON.stringify(value)}`, () => {
      expect(findCollapsedCaseBodies(value)).toEqual([]);
    });
  }
});
