import {
  countIcuWork,
  type IcuError,
  type IcuRange,
  icuQuotedRuns,
  overlapsIcuRun,
  parseIcuMessage,
} from './icu-message';

/**
 * ICU Message Format Classification
 *
 * Classifies translation strings by their ICU content to determine the
 * appropriate translation strategy. The classification drives whether a
 * string can be sent directly to the provider, needs placeholder protection,
 * or must be skipped entirely.
 *
 * @module icu-classifier
 */

/**
 * Classification of a translation string's ICU content.
 *
 * - `'plain'`               - No ICU syntax at all; safe to send to the provider as-is.
 * - `'simple-placeholders'` - Contains only simple variable substitutions (`{name}`,
 *                             `{0}`). No commas inside the braces.
 *                             These can be translated using marker-based protection.
 * - `'complex-icu'`         - Contains plural, select, number, date, or time formatters,
 *                             or a mixture of simple and complex syntax. Must be
 *                             returned unchanged without calling the provider.
 */
export type ICUClassification = 'plain' | 'simple-placeholders' | 'complex-icu';

/**
 * Classifies the ICU content of a translation string.
 *
 * The Transloco double-brace format (`{{ name }}`) is normalised to a single
 * brace before classification so it is treated identically to `{name}`.
 *
 * A string is classified as `'complex-icu'` when it contains ANY of:
 * - A comma inside an ICU brace group (indicating plural/select/number/date/time)
 * - A mix of simple placeholders alongside complex ICU syntax
 *
 * A string is classified as `'simple-placeholders'` when every brace group
 * contains only an identifier or index with no comma.
 *
 * Each top-level brace group of the ICU Message tree is judged whole. Apostrophes
 * follow ICU quoting, so `it's {name}` holds a placeholder and `'{x}'` is text. An
 * unclosed or empty group is `'complex-icu'`, so the value is skipped.
 *
 * @param value - The translation string to classify.
 * @returns The ICU classification for the string.
 *
 * @example
 * ```typescript
 * classifyICUContent('Hello world');
 * // → 'plain'
 *
 * classifyICUContent('Hello {name}');
 * // → 'simple-placeholders'
 *
 * classifyICUContent('Hello {{ name }}');
 * // → 'simple-placeholders'
 *
 * classifyICUContent('{count, plural, one {# item} other {# items}}');
 * // → 'complex-icu'
 *
 * classifyICUContent('Hello {{ name }}, {count, plural, one {# item} other {# items}}');
 * // → 'complex-icu'  (mixed)
 * ```
 */
export function classifyICUContent(value: string): ICUClassification {
  const message = parseIcuMessage(value, { interpolation: true });
  const quoted = icuQuotedRuns(value);
  let foundSimple = false;
  let foundComplex = false;

  // Each top-level brace frame is judged whole, as the converter frames the value.
  for (const node of message.nodes) {
    switch (node.kind) {
      case 'literal':
      case 'pound':
        break;
      case 'argument':
        // `{\u00a0}` trims to an empty name, an empty group as far as protection goes.
        if (node.format === undefined && node.name) foundSimple = true;
        else foundComplex = true;
        break;
      case 'group':
        foundComplex = true;
        break;
      case 'error':
        if (isUnmatchedText(value, node)) break;
        if (isPlainBraceFrame(value, node, quoted)) foundSimple = true;
        else foundComplex = true;
        break;
    }
  }

  if (foundComplex) {
    return 'complex-icu';
  }
  return foundSimple ? 'simple-placeholders' : 'plain';
}

/** A stray `}` or a malformed quoted run: text, not a brace group. */
function isUnmatchedText(value: string, node: IcuError): boolean {
  return node.range.end > node.range.start && value[node.range.start] !== '{';
}

/**
 * A closed brace frame that is no argument but can be protected like a simple placeholder,
 * e.g. `{some text}` or `{a {{x}}}`. It must hold something, have no comma of its own,
 * contain no quoted run, and hold nothing but text, simple arguments and frames of the same
 * kind. Anything else — a formatter, a group, a malformed quote, an empty or unclosed frame
 * — leaves the value complex, so the translator skips it rather than send it unprotected.
 */
function isPlainBraceFrame(value: string, node: IcuError, quoted: readonly IcuRange[]): boolean {
  const { start, end } = node.range;
  if (end - start < 2 || value[end - 1] !== '}' || isBlank(value, start + 1, end - 1)) return false;
  if (overlapsIcuRun(quoted, start, end)) return false;
  // The frame's own text: everything inside its braces except nested constructs.
  let own = '';
  let position = start + 1;
  for (const child of node.nodes) {
    if (child.kind === 'literal') continue;
    const simpleArgument = child.kind === 'argument' && child.format === undefined && child.name !== '';
    if (!simpleArgument && !(child.kind === 'error' && isPlainBraceFrame(value, child, quoted))) return false;
    own += value.slice(position, child.range.start);
    position = child.range.end;
  }
  own += value.slice(position, end - 1);
  countIcuWork(own.length + node.nodes.length);
  return !own.includes(',');
}

const BLANK = /\s*/y;

/** Whether `[start, end)` of `value` is whitespace only; scans no further than its first non-space. */
function isBlank(value: string, start: number, end: number): boolean {
  BLANK.lastIndex = start;
  BLANK.exec(value);
  countIcuWork(BLANK.lastIndex - start + 1);
  return BLANK.lastIndex >= end;
}
