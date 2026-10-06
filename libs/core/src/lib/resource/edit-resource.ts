import type { Collection } from '../config/open-collection';
import {
  type EditResourceChanges,
  type EditResourceResult,
  type EntryWriteOptions,
  writeEntry,
} from './resource-entry';

export type { EditResourceChanges, EditResourceResult } from './resource-entry';
export interface EditResourceOptions extends EntryWriteOptions {}

/**
 * Edits an existing resource entry of a collection.
 *
 * When the base value changes, the Staleness rule updates every translation's status, then
 * Locale seeding ({@link seedLocales}) fills the locales that need work and were not supplied
 * in `changes.translations`: auto-translated when the collection has it enabled, else a copy
 * of the new base value as `new` for a locale that has no value or held an untranslated copy
 * of the old base value. A real translation is kept (and is `stale`).
 *
 * The edit is saved before auto-translation runs, so it is kept even if the provider fails.
 * With `moveTo`, the edited entry then moves to the destination folder: the destination is
 * written before the source entry is removed. `moveTo` is validated, and the destination
 * checked for a collision, before anything is written. The destination is read again just
 * before the move (auto-translation may have taken a while), and a collision found then
 * throws `ResourceAlreadyExistsError` with the edit already saved in the source folder.
 *
 * @param key - The entry's full, existing key.
 * @param options - `provider` / `protectedTerms`: used instead of the collection's (see `openTranslator`).
 * @throws {InvalidResourceKeyError} `key` or `moveTo` is malformed.
 * @throws {ResourceNotFoundError} No entry exists at `key`.
 * @throws {ResourceAlreadyExistsError} The destination folder already has an entry with this entry key
 *   (checked before the edit, and again, on fresh disk state, just before the move).
 * @throws {LocaleNotFoundError} A translation names a locale the collection does not have.
 * @throws {TranslationError} The translation provider failed (the edit itself is saved).
 * @throws {ProtectedTermsFileError} Auto-translation runs and a protected-terms file is malformed.
 */
export async function editResource(
  collection: Collection,
  key: string,
  changes: EditResourceChanges,
  options: EditResourceOptions = {},
): Promise<EditResourceResult> {
  const outcome = await writeEntry(collection, key, { kind: 'edit', changes }, options);
  const result = outcome.result;
  if (!result.updated) {
    return { resolvedKey: result.resolvedKey, updated: false, message: result.message };
  }
  return result;
}
