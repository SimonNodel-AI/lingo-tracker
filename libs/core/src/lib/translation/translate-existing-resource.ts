import type { Collection } from '../config/open-collection';
import { type TranslateExistingResourceResult, writeEntry } from '../resource/resource-entry';

import type { TranslationRunOptions } from './translation-run';

export type { TranslateExistingResourceResult } from '../resource/resource-entry';

/**
 * Auto-translates an existing resource entry of a collection through the Translator, for every
 * target locale that needs translation by the Staleness rule (no metadata, or status `new` or
 * `stale`). Translated values are stored ICU-normalised with status `translated`; skipped locales
 * are left as they are.
 *
 * Returns early with `translatedCount: 0` when no locales require translation, without opening the
 * Translator (so without needing an API key).
 *
 * @param key - The entry's full key.
 * @param options - `provider` / `protectedTerms`: used instead of the collection's (see {@link openTranslator}).
 * @throws {AutoTranslationDisabledError} The collection has no enabled translation config.
 * @throws {InvalidResourceKeyError} The key is malformed.
 * @throws {ResourceNotFoundError} No entry exists at the key.
 * @throws {TranslationError} Some locale needs work and the API key is not set, or the provider failed.
 * @throws {ProtectedTermsFileError} Some locale needs work and a protected-terms file is malformed.
 */
export interface TranslateExistingResourceOptions extends Omit<TranslationRunOptions, 'delay'> {}

export async function translateExistingResource(
  collection: Collection,
  key: string,
  options: TranslateExistingResourceOptions = {},
): Promise<TranslateExistingResourceResult> {
  const outcome = await writeEntry(collection, key, { kind: 'translate' }, options);
  return outcome.result;
}
