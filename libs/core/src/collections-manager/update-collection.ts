import type { LingoTrackerCollection } from '../config/lingo-tracker-collection';
import { replaceCollectionEntry } from '../lib/config/collection-entry';
import { createConfigFileOperations } from '../lib/config/config-file-operations';
import { openCollection } from '../lib/config/open-collection';
import { ReadOnlyCollectionError } from '../lib/errors/lingo-tracker-error';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { dropLocaleFiles, seedLocaleFiles } from './locale-files';

export interface UpdateCollectionOptions {
  cwd?: string;
}

/**
 * Replaces (and optionally renames) a collection's config entry.
 *
 * **Full-replace** semantics: the stored record is rebuilt from `collection` by the
 * Collection Entry (`lib/config/collection-entry.ts`), keeping only what differs from the
 * global config. Any optional field left out of `collection` (`readOnly`, `translation`,
 * `locales`, ...) is dropped from the entry, so a partial update must send the whole
 * desired collection, not just the changed fields.
 *
 * When `collection.locales` is a non-empty list that differs from the collection's current
 * locales, the translation files are seeded for each added locale and purged of each
 * removed one (never the base locale). An empty or absent list means "inherit from global"
 * and touches no files. The order is: validate everything (existence, rename collision,
 * read-only, locale format), change the translation files, then write the config once.
 *
 * `mutations` holds what the locale changes (if any) wrote to the translation files. The
 * config change itself is not a resource mutation; callers that cache a collection's tree
 * must also drop it for the old and new translations folders.
 *
 * @throws {CollectionNotFoundError} No collection named `collectionName`.
 * @throws {CollectionAlreadyExistsError} A collection named `newCollectionName` exists.
 * @throws {InvalidCollectionError} `translationsFolder` is missing or blank.
 * @throws {ReadOnlyCollectionError} The locales change and the collection is read-only.
 * @throws {InvalidLocaleError} An added locale is malformed.
 */
export async function updateCollection(
  collectionName: string,
  newCollectionName: string | undefined,
  collection: LingoTrackerCollection,
  options: UpdateCollectionOptions = {},
): Promise<{ message: string; mutations: ResourceMutation[] }> {
  const { cwd } = options;
  const configFile = createConfigFileOperations({ cwd });
  const config = configFile.read();

  // Validate and build the new config before anything is written.
  const nextConfig = replaceCollectionEntry(config, collectionName, collection, newCollectionName);
  const current = openCollection(config, collectionName, { cwd });
  const { added, removed } = diffLocales(current, collection.locales);

  const mutations: ResourceMutation[] = [];
  if (added.length > 0 || removed.length > 0) {
    if (current.readOnly) {
      throw new ReadOnlyCollectionError(collectionName);
    }
    for (const locale of added) {
      assertValidLocale(locale);
    }
    for (const locale of removed) {
      dropLocaleFiles(current, locale);
    }
    for (const locale of added) {
      seedLocaleFiles(current, locale);
    }
    mutations.push(reindexMutation(current.translationsFolder));
  }

  configFile.write(nextConfig);

  const targetName = newCollectionName || collectionName;
  const message =
    targetName === collectionName
      ? `Collection "${collectionName}" updated successfully`
      : `Collection "${collectionName}" renamed to "${targetName}" and updated successfully`;
  return { message, mutations };
}

/** Which locales an explicit, non-empty new list adds to and removes from the collection's current ones. */
function diffLocales(
  current: { readonly locales: readonly string[]; readonly baseLocale: string },
  newLocales: readonly string[] | undefined,
): { added: string[]; removed: string[] } {
  if (newLocales === undefined || newLocales.length === 0) {
    return { added: [], removed: [] };
  }
  // The base locale is always present: it is never seeded or purged, and can only be set at create time.
  const { locales, baseLocale } = current;
  return {
    added: newLocales.filter((locale) => !locales.includes(locale) && locale !== baseLocale),
    removed: locales.filter((locale) => !newLocales.includes(locale) && locale !== baseLocale),
  };
}
