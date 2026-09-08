import { parse, type Token } from '@messageformat/parser';
import { normalizeTranslocoSyntax } from './normalize-transloco-syntax';

/**
 * The set of arguments a message interpolates.
 *
 * A translation has to interpolate the same arguments as the value it was
 * translated from. When it does not, nothing throws: ICU renders the message
 * with an empty string where the argument should have been, so the defect
 * reaches production looking like ordinary text.
 *
 * The failure this catches in practice is a machine translator translating the
 * argument name along with the prose — `Folder {name}` coming back as
 * `Carpeta {nombre}`, `フォルダ {名前}`, or, most easily missed of all,
 * `Ordner {Name}`. Argument names are case-sensitive identifiers, so the German
 * one is as broken as the Japanese one while looking entirely correct.
 *
 * @module icu-arguments
 */

/**
 * Collects the names of every argument a message interpolates.
 *
 * Counts plain arguments (`{name}`), formatted ones (`{count, number}`), and
 * the argument a `plural`, `selectordinal` or `select` switches on — each of
 * those is a name the caller must supply. Recurses into branch bodies, so an
 * argument used only inside one branch is still reported.
 *
 * Branch selectors (`one`, `=1`, `other`) are not arguments and are excluded:
 * they are ICU's own vocabulary and are expected to differ between locales,
 * which is the entire point of a plural rule. `#` is excluded for the same
 * reason — it refers to the enclosing plural's argument, which is already
 * counted.
 *
 * A set rather than a list, because repetition carries no obligation: a
 * translation may legitimately mention an argument more times than the base
 * value does, or fewer, provided it mentions the same ones.
 *
 * Values that do not parse yield an empty set. An unparseable value is the ICU
 * compile check's business, and reporting one defect as two helps nobody. Use
 * `compareIcuArguments` rather than comparing two of these sets by hand: it
 * tells an unparseable value apart from one that genuinely has no arguments.
 *
 * Accepts either syntax: Transloco's `{{ name }}` is normalized to `{name}`
 * first, so stored values and bundled values give the same answer.
 *
 * @param value - The translation string, in ICU or Transloco syntax.
 * @returns The distinct argument names the value interpolates.
 *
 * @example
 * ```typescript
 * findIcuArguments('Folder {name}');
 * // → Set { 'name' }
 *
 * findIcuArguments('Folder {{ name }}');
 * // → Set { 'name' } — same answer in either syntax
 *
 * findIcuArguments('{count, plural, one {1 file in {dir}} other {# files in {dir}}}');
 * // → Set { 'count', 'dir' }
 *
 * findIcuArguments('No placeholders here');
 * // → Set {}
 * ```
 */
export function findIcuArguments(value: string): ReadonlySet<string> {
  return parseArguments(value) ?? new Set();
}

/**
 * Collects a value's arguments, or reports that it could not be parsed.
 *
 * The distinction matters to `compareIcuArguments` and nowhere else: a value
 * that does not parse has no arguments to speak of, which is not the same as a
 * value that parses and interpolates none. Treating the two alike makes every
 * malformed translation look as though it had dropped every placeholder.
 *
 * @internal
 */
function parseArguments(value: string): Set<string> | null {
  let tokens: Token[];
  try {
    tokens = parse(normalizeTranslocoSyntax(value));
  } catch {
    return null;
  }

  const found = new Set<string>();
  collectArguments(tokens, found);
  return found;
}

/**
 * Walks a parsed token tree, adding the name of every argument it interpolates.
 *
 * @internal
 */
function collectArguments(tokens: readonly Token[], found: Set<string>): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'content':
      case 'octothorpe':
        break;

      case 'argument':
      case 'function':
        found.add(token.arg);
        break;

      // The argument a sub-message switches on is supplied by the caller like
      // any other, so it counts, and its branches can hold arguments of their own.
      default:
        found.add(token.arg);
        for (const branch of token.cases) {
          collectArguments(branch.tokens, found);
        }
        break;
    }
  }
}

/**
 * A mismatch between the arguments a translation interpolates and the ones its
 * base value does.
 */
export interface ArgumentMismatch {
  /** Arguments the base value interpolates that the translation does not. */
  readonly missing: readonly string[];

  /** Arguments the translation interpolates that the base value does not. */
  readonly unexpected: readonly string[];
}

/**
 * Compares the arguments of a translation against those of its base value.
 *
 * Reports both directions, because they fail differently and a reader needs to
 * tell them apart. A missing argument renders as nothing — the folder name
 * simply never appears. An unexpected one names a value no caller passes, so it
 * renders as nothing too, but the fix is different: usually the argument was
 * renamed rather than dropped, and the two lists read together name the rename.
 *
 * Both lists are sorted, so a report is stable between runs.
 *
 * Returns null when either value fails to parse. A malformed value would
 * otherwise read as having dropped every placeholder, which names the wrong
 * repair — the ICU compile pass reports the syntax error itself.
 *
 * @param baseValue - The base-locale value.
 * @param translatedValue - The value stored for a target locale.
 * @returns The mismatch, or null when both interpolate the same arguments.
 *
 * @example
 * ```typescript
 * compareIcuArguments('Folder {name}', 'Carpeta {nombre}');
 * // → { missing: ['name'], unexpected: ['nombre'] }
 *
 * compareIcuArguments('Folder {name}', 'Ordner {name}');
 * // → null
 *
 * compareIcuArguments('Folder {name}', 'Ordner {unbalanced');
 * // → null — a parse error, reported by the ICU pass rather than as a mismatch
 * ```
 */
export function compareIcuArguments(baseValue: string, translatedValue: string): ArgumentMismatch | null {
  const expected = parseArguments(baseValue);
  const actual = parseArguments(translatedValue);

  // A value that will not parse has no arguments to compare, which is not the
  // same as having none. Reporting it here would dress a syntax error up as a
  // set of dropped placeholders and point the reader at the wrong repair; the
  // ICU compile pass names the real defect.
  if (expected === null || actual === null) return null;

  const missing = [...expected].filter((arg) => !actual.has(arg)).sort();
  const unexpected = [...actual].filter((arg) => !expected.has(arg)).sort();

  return missing.length === 0 && unexpected.length === 0 ? null : { missing, unexpected };
}
