import type { LingoTrackerCollection } from '../config/lingo-tracker-collection';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { createConfigFileOperations } from '../lib/config/config-file-operations';
import { type Collection, openCollection } from '../lib/config/open-collection';
import { ReadOnlyCollectionError } from '../lib/errors/lingo-tracker-error';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { dropLocaleFiles, seedLocaleFiles } from './locale-files';

export interface UpdateCollectionOptions {
  cwd?: string;
}

/**
 * Changes (and optionally renames) a collection's config entry.
 *
 * **Patch** semantics, through the Collection Entry (`lib/config/collection-entry.ts`): a
 * field `patch` sets replaces the stored value, and a field left out (or `undefined`) keeps
 * it. So `{ tags: [] }` clears the tags, `{ readOnly: false }` clears the flag,
 * `{ locales: [] }` returns to the global locales, `{ protectedTermsFile: '' }` drops the
 * pointer, and a patch that does not mention `translation`, `exportFolder` or `importFolder`
 * leaves them as they are. The stored record is then re-minimized: a value equal to the
 * global one is stored as inherited.
 *
 * The translation files follow the collection's effective locales (its own list, else the
 * global one): every locale the update adds is seeded, every locale it removes is purged,
 * and a base locale (old or new) is never seeded or purged. The files are those of the
 * collection as it will be after the update, so a patch that also changes
 * `translationsFolder` or `baseLocale` seeds and purges the new folder with the new base
 * locale. The order is: validate everything (existence, rename collision, read-only, locale
 * format), seed the added locales, purge the removed ones, then write the config once. A
 * seeding failure therefore never costs a removed locale its data.
 *
 * `mutations` holds what the locale changes (if any) wrote to the translation files. The
 * config change itself is not a resource mutation; callers that cache a collection's tree
 * must also drop it for the old and new translations folders.
 *
 * @throws {CollectionNotFoundError} No collection named `collectionName`.
 * @throws {CollectionAlreadyExistsError} A collection named `newCollectionName` exists.
 * @throws {InvalidCollectionError} The resulting `translationsFolder` is missing or blank.
 * @throws {ReadOnlyCollectionError} The locales change and the collection is read-only.
 * @throws {InvalidLocaleError} An added locale is malformed.
 */
export async function updateCollection(
  collectionName: string,
  newCollectionName: string | undefined,
  patch: Partial<LingoTrackerCollection>,
  options: UpdateCollectionOptions = {},
): Promise<{ message: string; mutations: ResourceMutation[] }> {
  const { cwd } = options;
  const configFile = createConfigFileOperations({ cwd });
  const config = configFile.read();

  // Validate and build the new config before anything is written.
  const nextConfig = patchCollectionEntry(config, collectionName, patch, newCollectionName);
  const targetName = newCollectionName || collectionName;
  const current = openCollection(config, collectionName, { cwd });
  const next = openCollection(nextConfig, targetName, { cwd });
  const { added, removed } = diffLocales(current, next);

  const mutations: ResourceMutation[] = [];
  if (added.length > 0 || removed.length > 0) {
    if (current.readOnly) {
      throw new ReadOnlyCollectionError(collectionName);
    }
    for (const locale of added) {
      assertValidLocale(locale);
    }
    // Additive work first, so a failure here leaves every removed locale's data on disk.
    for (const locale of added) {
      seedLocaleFiles(next, locale);
    }
    for (const locale of removed) {
      dropLocaleFiles(next, locale);
    }
    mutations.push(reindexMutation(next.translationsFolder));
  }

  configFile.write(nextConfig);

  const message =
    targetName === collectionName
      ? `Collection "${collectionName}" updated successfully`
      : `Collection "${collectionName}" renamed to "${targetName}" and updated successfully`;
  return { message, mutations };
}

/** Which effective locales `next` adds to and removes from `current`. A base locale is never in either list. */
function diffLocales(
  current: Pick<Collection, 'locales' | 'baseLocale'>,
  next: Pick<Collection, 'locales' | 'baseLocale'>,
): { added: string[]; removed: string[] } {
  // A base locale is always present: it is never seeded or purged. The old base locale is protected
  // too, because purging it would destroy the source values.
  const isBase = (locale: string): boolean => locale === current.baseLocale || locale === next.baseLocale;
  return {
    added: next.locales.filter((locale) => !current.locales.includes(locale) && !isBase(locale)),
    removed: current.locales.filter((locale) => !next.locales.includes(locale) && !isBase(locale)),
  };
}
