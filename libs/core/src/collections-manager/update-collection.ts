import type { LingoTrackerCollection } from '../config/lingo-tracker-collection';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { createConfigFileOperations } from '../lib/config/config-file-operations';
import { type Collection, openCollection } from '../lib/config/open-collection';
import { ReadOnlyCollectionError } from '../lib/errors/lingo-tracker-error';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { dropLocaleFiles, openLocaleFolders, seedLocaleFiles } from './locale-files';

export interface UpdateCollectionOptions {
  cwd?: string;
}

/**
 * Changes (and optionally renames) a collection's config entry.
 *
 * **Patch** semantics, through the Collection Entry (`lib/config/collection-entry.ts`): a
 * field `patch` sets replaces the stored value, and a field left out (or `undefined`) keeps
 * it. So `{ tags: [] }` clears the tags, `{ readOnly: false }` clears the flag,
 * `{ locales: [] }` returns to the global locales, `''` clears `exportFolder`, `importFolder`,
 * `baseLocale` or `protectedTermsFile` (the collection inherits), and a patch that does not mention `translation`, `exportFolder` or `importFolder`
 * leaves them as they are. The stored record is then re-minimized: a value equal to the
 * global one is stored as inherited.
 *
 * The translation files follow the collection's effective locales (its own list, else the
 * global one): every locale the update adds is seeded, every locale it removes is purged,
 * and a base locale (old or new) is never seeded or purged. The files are those of the
 * collection as it will be after the update, so a patch that also changes
 * `translationsFolder` or `baseLocale` seeds and purges the new folder with the new base
 * locale. The order is: validate everything (existence, rename collision, read-only, locale
 * format), read every folder of the collection (an unreadable one throws, with nothing written),
 * seed the added locales, purge the removed ones, then write the config once. A
 * seeding failure therefore never costs a removed locale its data.
 *
 * A changed collection record reindexes both its old and new translations folders.
 *
 * @throws {CollectionNotFoundError} No collection named `collectionName`.
 * @throws {CollectionAlreadyExistsError} A collection named `newCollectionName` exists.
 * @throws {InvalidCollectionError} The resulting `translationsFolder` is missing or blank, or a field is `null`.
 * @throws {ReadOnlyCollectionError} The locales change and the collection is read-only.
 * @throws {InvalidLocaleError} An added locale is malformed.
 */
export async function updateCollection(
  collectionName: string,
  newCollectionName: string | undefined,
  patch: Partial<LingoTrackerCollection>,
  options: UpdateCollectionOptions = {},
): Promise<{ message: string; mutations: ResourceMutation[] }> {
  const result = await changeCollection(collectionName, newCollectionName, patch, options);
  return { message: result.message, mutations: result.mutations };
}

interface CollectionChangeResult {
  readonly message: string;
  readonly mutations: ResourceMutation[];
  readonly entriesAdded: number;
  readonly entriesRemoved: number;
  readonly filesUpdated: number;
}

/** The shared validation, folder rewrite and single config write for every locale change. */
export async function changeCollection(
  collectionName: string,
  newCollectionName: string | undefined,
  patch: Partial<LingoTrackerCollection>,
  options: UpdateCollectionOptions = {},
  targetLocales?: (current: Collection) => string[],
): Promise<CollectionChangeResult> {
  const { cwd } = options;
  const configFile = createConfigFileOperations({ cwd });
  const config = configFile.read();

  // Sugar calls check writability and their locale-specific errors before building the patch.
  const sugarCurrent = targetLocales ? openCollection(config, collectionName, { cwd, writable: true }) : undefined;
  const effectivePatch = targetLocales && sugarCurrent ? { ...patch, locales: targetLocales(sugarCurrent) } : patch;
  const nextConfig = patchCollectionEntry(config, collectionName, effectivePatch, newCollectionName);
  const targetName = newCollectionName || collectionName;
  const current = sugarCurrent ?? openCollection(config, collectionName, { cwd });
  const next = openCollection(nextConfig, targetName, { cwd });
  const { added, removed } = diffLocales(current, next);

  let entriesAdded = 0;
  let entriesRemoved = 0;
  let filesUpdated = 0;
  if (added.length > 0 || removed.length > 0) {
    if (current.readOnly) {
      throw new ReadOnlyCollectionError(collectionName);
    }
    for (const locale of added) {
      assertValidLocale(locale);
    }
    // Every folder is read before anything is written: an unreadable one fails the update with nothing written.
    const folders = openLocaleFolders(next);
    // Additive work first, so a failure here leaves every removed locale's data on disk.
    for (const locale of added) {
      const result = seedLocaleFiles(folders, locale);
      entriesAdded += result.entries;
      filesUpdated += result.filesUpdated;
    }
    for (const locale of removed) {
      const result = dropLocaleFiles(folders, locale);
      entriesRemoved += result.entries;
      filesUpdated += result.filesUpdated;
    }
  }

  configFile.write(nextConfig);
  const recordChanged =
    targetName !== collectionName ||
    JSON.stringify(config.collections[collectionName]) !== JSON.stringify(nextConfig.collections[targetName]);
  const mutations = recordChanged
    ? [...new Set([current.translationsFolder, next.translationsFolder])].map(reindexMutation)
    : [];

  const message =
    targetName === collectionName
      ? `Collection "${collectionName}" updated successfully`
      : `Collection "${collectionName}" renamed to "${targetName}" and updated successfully`;
  return { message, mutations, entriesAdded, entriesRemoved, filesUpdated };
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
