import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { describeBracedPlaceholder, findBracedPlaceholders } from './braced-placeholders';
import { parseIcuMessage } from './icu-message';
import { icuToTransloco } from './icu-to-transloco';
import {
  arbitraryMessage,
  gluedSelectorMessage,
  icuishCompilationMessage,
  icuishMessage,
  knownValidRuntimeMessage,
  literalText,
  quoteStressMessage,
  supportedMessage,
  unicodeSpacedMessage,
} from './testing/icu-arbitraries';
import { translocoToICU } from './transloco-to-icu';

const everyArbitrary = fc.oneof(
  supportedMessage,
  knownValidRuntimeMessage,
  literalText.map((value) => value.icu),
  arbitraryMessage,
  icuishMessage,
  quoteStressMessage,
  icuishCompilationMessage,
  unicodeSpacedMessage,
  gluedSelectorMessage,
);

describe('findBracedPlaceholders', () => {
  for (const [value, name, start, end] of [
    ['{{{a}}}', 'a', 0, 7],
    ['{{{ a }}}', 'a', 0, 9],
    ['a {{{a}}} b', 'a', 2, 9],
    ['{{{a}}}{{b}}', 'a', 0, 7],
    ['{n, plural, other {x {{{a}}} y}}', 'a', 21, 28],
    ['{n, plural, other {{{{a}}}}}', 'a', 19, 26],
    ['{n, plural, other‏{{{x}}}}', 'x', 18, 25],
    ['{n, number, {{{a}}}}', 'a', 12, 19],
  ] as const) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(findBracedPlaceholders(value)).toEqual([{ name, range: { start, end } }]);
    });
  }

  for (const value of [
    '{n, plural, other {{{a}}}}',
    '{n, plural, =1 {{{a}}} other {x}}',
    '{ {{a}} }',
    '{{{a}} }',
    '{ {{a}}}',
    "'{'{{a}}'}'",
    '{{a}}',
    'no braces',
  ]) {
    it(`accepts ${JSON.stringify(value)}`, () => {
      expect(findBracedPlaceholders(value)).toEqual([]);
    });
  }

  // The spec's accepted row `=1 {{{a}}}` is read as a case body inside a group; at the top
  // level there is no case, so the braces are literal and the value is rejected.
  it('rejects =1 {{{a}}} at the top level, where it is no case body', () => {
    expect(findBracedPlaceholders('=1 {{{a}}}')).toEqual([{ name: 'a', range: { start: 3, end: 10 } }]);
  });

  it('accepts =1 {{{a}}} as a case body inside a group', () => {
    expect(findBracedPlaceholders('{n, plural, =1 {{{a}}} other {b}}')).toEqual([]);
  });

  it('reports every braced placeholder in source order', () => {
    expect(findBracedPlaceholders('{{{a}}} and {{{b}}}').map((found) => found.name)).toEqual(['a', 'b']);
  });
});

describe('describeBracedPlaceholder', () => {
  it('explains the braces and how to quote them', () => {
    const [found] = findBracedPlaceholders('{{{name}}}');
    expect(found).toBeDefined();
    expect(found && describeBracedPlaceholder(found)).toBe(
      'Placeholder {{name}} at position 0 is inside literal braces. LingoTracker reads "{{{name}}}" as a ' +
        'placeholder and removes the braces when it saves the value. To show a brace next to a placeholder, ' +
        "quote the brace: '{'{{name}}'}'. A case body that is only a placeholder, such as other {{{name}}}, is correct.",
    );
  });
});

describe('braced placeholder properties', () => {
  // P3.2: every value a second conversion changes holds a braced placeholder.
  it('finds a braced placeholder in every value that converts differently the second time', () => {
    fc.assert(
      fc.property(everyArbitrary, (value) => {
        const once = translocoToICU(value);
        if (translocoToICU(once) !== once) expect(findBracedPlaceholders(value).length).toBeGreaterThan(0);
      }),
      { numRuns: 5000 },
    );
  });

  // P3.3: the bundler never emits a rejected shape for a valid stored value.
  it('finds none in the bundled form of a valid stored value', () => {
    fc.assert(
      fc.property(everyArbitrary, (value) => {
        if (parseIcuMessage(value).ok) expect(findBracedPlaceholders(icuToTransloco(value))).toEqual([]);
      }),
      { numRuns: 5000 },
    );
  });
});
