import { compareIcuArguments } from '@simoncodes-ca/domain';
import type { LoadedResource } from '../export/export-common';
import type { PlaceholderValidationDetail, PlaceholderValidationResult } from './types';

/**
 * Checks that every translation interpolates the same arguments as its base value.
 *
 * This asks a third question, distinct from the other two passes. Status
 * validation asks whether a human approved the wording. ICU validation asks
 * whether the value compiles. Neither notices a translation that compiles
 * perfectly, reads perfectly, and interpolates the wrong name.
 *
 * That defect is silent by construction: ICU renders a missing argument as an
 * empty string, so `Folder {name}` translated as `Carpeta {nombre}` renders as
 * "Carpeta " and throws nothing. It survives review because the prose is
 * correct — only the identifier inside the braces is wrong. Machine translation
 * produces it routinely, translating the argument name along with the sentence.
 *
 * The case that most needs a machine to catch it is the one that looks
 * harmless: `Ordner {Name}`, where German capitalisation of a noun is also a
 * rename, because ICU argument names are case-sensitive.
 *
 * Every value is checked; the pass never stops at the first failure.
 *
 * @param resources - Resources already loaded from the collections under validation.
 * @param targetLocales - Target locales to check translations for.
 * @param baseLocale - The locale whose value defines the expected arguments.
 * @returns One failure per translation whose arguments disagree with the base value.
 */
export function validatePlaceholders(
  resources: readonly LoadedResource[],
  targetLocales: readonly string[],
  baseLocale: string,
): PlaceholderValidationResult {
  const failures: PlaceholderValidationDetail[] = [];
  let valuesChecked = 0;

  // The base locale defines the contract; comparing it against itself proves nothing.
  const localesToCheck = targetLocales.filter((locale) => locale !== baseLocale);

  for (const resource of resources) {
    const baseValue = resource.translations[baseLocale] ?? resource.source;
    if (baseValue === undefined) continue;

    for (const locale of localesToCheck) {
      const translatedValue = resource.translations[locale];

      // An absent translation is the status pass's business. There is no value
      // here to disagree with the base one, and reporting one gap twice helps nobody.
      if (translatedValue === undefined) continue;

      valuesChecked++;

      const mismatch = compareIcuArguments(baseValue, translatedValue);
      if (!mismatch) continue;

      failures.push({
        key: resource.fullKey,
        locale,
        collection: resource.collection,
        missing: mismatch.missing,
        unexpected: mismatch.unexpected,
        message: describeMismatch(mismatch.missing, mismatch.unexpected),
      });
    }
  }

  return { failures, valuesChecked };
}

/**
 * Renders a mismatch as one line a CI log can be read from.
 *
 * When each list holds exactly one name, the two together are almost always a
 * rename, so the message says so rather than making the reader infer it from
 * two lists.
 *
 * @internal
 */
function describeMismatch(missing: readonly string[], unexpected: readonly string[]): string {
  if (missing.length === 1 && unexpected.length === 1) {
    return `Placeholder '{${missing[0]}}' was renamed to '{${unexpected[0]}}'; it renders as empty text`;
  }

  const parts: string[] = [];
  if (missing.length > 0) {
    parts.push(`missing ${quoteAll(missing)}`);
  }
  if (unexpected.length > 0) {
    parts.push(`unexpected ${quoteAll(unexpected)}`);
  }

  return `Placeholders disagree with the base value: ${parts.join(', ')}`;
}

/** Renders argument names as they appear in a value, for a log line. @internal */
function quoteAll(args: readonly string[]): string {
  return args.map((arg) => `'{${arg}}'`).join(', ');
}
