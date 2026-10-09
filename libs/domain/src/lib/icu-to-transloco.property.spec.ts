import MessageFormat from '@messageformat/core';
import * as fc from 'fast-check';
import { icuToTransloco } from './icu-to-transloco';
import { literalText, supportedMessage } from './testing/icu-arbitraries';

function renderBothPasses(message: string, params: Record<string, string | number>): string {
  let interpolated = icuToTransloco(message);
  // As in transloco-runtime-round-trip.spec.ts, rescan after each substitution.
  // Generated parameter values contain no interpolation delimiters, so this loop converges.
  let match = /\{\{([^{}]*?)\}\}/.exec(interpolated);
  while (match !== null) {
    const name = match[1].trim();
    interpolated = interpolated.replace(match[0], () => String(params[name] ?? ''));
    match = /\{\{([^{}]*?)\}\}/.exec(interpolated);
  }
  return new MessageFormat('en').compile(interpolated)(params);
}

function parameters(message: string, count: number, gender: string): Record<string, string | number> {
  const params: Record<string, string | number> = { count, gender };
  for (const match of message.matchAll(/\{(p\w+)\}/g)) {
    params[match[1]] = 'VALUE';
  }
  return params;
}

describe('icuToTransloco properties', () => {
  it.fails('preserves quoted literal braces through both runtime passes', () => {
    // Minimal ICU "'{'literal'}'" exports as "{literal}", turning literal text into an ICU argument.
    // Expected rendered text: "{literal}"; actual: undefined with no parameters.
    // icuToTransloco is used by libs/core/src/lib/bundle/bundle-selection.ts; tracker uses transloco-messageformat.
    const message = "'{'literal'}'";
    const expected = new MessageFormat('en').compile(message)({});
    expect(renderBothPasses(message, {})).toBe(expected);
  });

  it('preserves rendered meaning through interpolation and ICU compilation for nested groups', () => {
    fc.assert(
      fc.property(
        supportedMessage,
        fc.integer({ min: 0, max: 10 }),
        fc.constantFrom('chosen', 'other'),
        (message, count, gender) => {
          const params = parameters(message, count, gender);
          expect(renderBothPasses(message, params)).toBe(new MessageFormat('en').compile(message)(params));
        },
      ),
    );
  });

  it('exports literal braces, apostrophes and hash characters as unescaped text without throwing', () => {
    fc.assert(
      fc.property(literalText, ({ icu, text }) => {
        expect(icuToTransloco(icu)).toBe(text);
      }),
    );
  });
});
