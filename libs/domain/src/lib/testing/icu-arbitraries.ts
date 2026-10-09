import * as fc from 'fast-check';

export const identifier = fc
  .array(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'), {
    minLength: 1,
    maxLength: 12,
  })
  .map((characters) => `p${characters.join('')}`);

export const messageText = fc
  .array(fc.constantFrom('hello ', ' world', "don't ", "l'objet ", '#', ' ', '\n', '日本語', '🙂'), { maxLength: 5 })
  .map((chunks) => chunks.join(''));

const argument = identifier.map((name) => `{${name}}`);
const leaf = fc.oneof(
  messageText,
  argument,
  fc.tuple(messageText, argument, messageText).map((parts) => parts.join('')),
);

function group(body: fc.Arbitrary<string>): fc.Arbitrary<string> {
  return fc.tuple(fc.constantFrom('plural', 'select', 'selectordinal'), body, body).map(([kind, first, other]) => {
    const name = kind === 'select' ? 'gender' : 'count';
    const selector = kind === 'select' ? 'chosen' : 'one';
    return `{${name}, ${kind}, ${selector} {${first}} other {${other}}}`;
  });
}

// Formatted arguments alone in branch bodies have no Transloco runtime encoding (see the scanner contract).
export const supportedMessage = fc
  .array(fc.oneof(leaf, group(fc.oneof(leaf, group(leaf)))), { minLength: 1, maxLength: 4 })
  .map((parts) => parts.join(' '));

export const literalText = fc
  .array(
    fc.constantFrom(
      { icu: 'hello ', text: 'hello ' },
      { icu: "'{'literal'}'", text: '{literal}' },
      { icu: "it''s ", text: "it's " },
      { icu: '#', text: '#' },
      { icu: "'#'", text: '#' },
    ),
    { maxLength: 6 },
  )
  // Separators prevent adjacent closing/opening quotes from becoming a literal apostrophe escape.
  .map((parts) => ({ icu: parts.map((part) => part.icu).join(' '), text: parts.map((part) => part.text).join(' ') }));

// fast-check 4 exposes Unicode generation through string's unit option rather than fullUnicodeString.
export const arbitraryMessage = fc.oneof(
  fc.string(),
  fc.string({ unit: 'grapheme' }),
  fc.string({ unit: fc.integer({ min: 0, max: 0xffff }).map((code) => String.fromCharCode(code)) }),
  fc
    .array(fc.constantFrom('{', '}', "'", '#', ',', ' ', 'name', 'plural', 'select', 'other'), { maxLength: 80 })
    .map((parts) => parts.join('')),
);
