import { resolve } from 'node:path';
import type { LingoTrackerCollection } from '../config/lingo-tracker-collection';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { guardedConfigWrite } from '../lib/config/config-file-operations';
import { resolveRenameTarget } from '../lib/config/entry-name';
import { type Collection, type OpenedCollection, openCollection } from '../lib/config/open-collection';
import { assertProtectedTerms } from '../lib/config/set-protected-terms';
import { ReadOnlyCollectionError } from '../lib/errors/lingo-tracker-error';
import { type MutationSinkOptions, reindexMutation } from '../lib/resource/resource-mutation';
import { assertValidLocale } from './assert-valid-locale';
import { renameBundleCollectionReferences } from './bundle-collection-references';
import { prepareCollectionProtectedTerms } from './collection-protected-terms';
import { dropLocaleFiles, openLocaleFolders, seedLocaleFiles } from './locale-files';

export interface UpdateCollectionOptions extends MutationSinkOptions {
  protectedTerms?: string[];
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
 * A rename also rewrites every explicit bundle reference in the same config write. If a bundle
 * already references the new name, the rename is refused before locale or config files change.
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
 * All collection and terms preconditions are checked before writing. After any locale
 * file changes, the write order is config, then terms. If the terms write itself fails,
 * the config entry remains written.
 *
 * A changed collection record reindexes both its old and new translations folders.
 *
 * @throws {CollectionNotFoundError} No collection named `collectionName`.
 * @throws {CollectionAlreadyExistsError} A collection named `newCollectionName` exists.
 * @throws {InvalidNameError} The supplied new name is blank after trimming.
 * @throws {CollectionRenameBundleConflictError} A bundle already references `newCollectionName`.
 * @throws {InvalidCollectionError} The resulting `translationsFolder` is missing or blank, or a field is `null`.
 * @throws {ReadOnlyCollectionError} The locales change and the collection is read-only.
 * @throws {InvalidLocaleError} An added locale is malformed.
 * @throws {InvalidCollectionError} Protected terms are not an array of strings.
 * @throws {ProtectedTermsFileNotSetError} Terms were supplied without a resulting file pointer.
 * @throws {ParentDirectoryMissingError} The terms file's parent directory is missing.
 */
export async function updateCollection(
  current: OpenedCollection,
  newCollectionName: string | undefined,
  patch: Partial<LingoTrackerCollection>,
  options: UpdateCollectionOptions = {},
): Promise<{ message: string }> {
  if (options.protectedTerms !== undefined) assertProtectedTerms(options.protectedTerms);
  const result = await changeCollection(current, { newName: newCollectionName, patch }, options);
  return { message: result.message };
}

interface CollectionChangeResult {
  readonly message: string;
  readonly entriesAdded: number;
  readonly entriesRemoved: number;
  readonly filesUpdated: number;
}

export interface CollectionChange {
  readonly newName?: string;
  readonly patch: Partial<LingoTrackerCollection>;
  readonly targetLocales?: (current: Collection) => string[];
}

/** The shared validation, folder rewrite and single config write for every locale change. */
export async function changeCollection(
  current: OpenedCollection,
  change: CollectionChange,
  options: UpdateCollectionOptions = {},
): Promise<CollectionChangeResult> {
  const { sourceConfig: config, projectRoot: cwd, name: collectionName } = current;
  const configWrite = guardedConfigWrite(current);
  const { newName: newCollectionName, patch, targetLocales } = change;
  // Locale sugar refuses read-only collections before its locale-specific checks.
  if (targetLocales && current.readOnly) throw new ReadOnlyCollectionError(collectionName);
  const effectivePatch = targetLocales ? { ...patch, locales: targetLocales(current) } : patch;
  const renameTarget = resolveRenameTarget(collectionName, newCollectionName);
  const targetName = renameTarget.target;
  const nextConfig = patchCollectionEntry(
    config,
    collectionName,
    effectivePatch,
    renameTarget.isRename ? renameTarget.target : undefined,
  );
  renameBundleCollectionReferences(nextConfig, collectionName, targetName);
  const next = openCollection(nextConfig, targetName, { cwd });
  const reported = new Set<string>();
  const report = (folder: string): void => {
    const key = resolve(folder);
    if (reported.has(key)) return;
    reported.add(key);
    options.onMutation?.(reindexMutation(folder));
  };
  const { added, removed } = diffLocales(current, next);
  const writeTerms = prepareCollectionProtectedTerms(nextConfig, targetName, options.protectedTerms, cwd);

  // Refuse a stale snapshot before locale files are seeded or purged. `write` checks again.
  configWrite.assertUnchanged();

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
      const result = seedLocaleFiles(folders, locale, () => report(next.translationsFolder));
      entriesAdded += result.entries;
      filesUpdated += result.filesUpdated;
    }
    for (const locale of removed) {
      const result = dropLocaleFiles(folders, locale, () => report(next.translationsFolder));
      entriesRemoved += result.entries;
      filesUpdated += result.filesUpdated;
    }
  }

  const recordChanged =
    targetName !== collectionName ||
    JSON.stringify(config.collections[collectionName]) !== JSON.stringify(nextConfig.collections[targetName]);
  try {
    configWrite.write(nextConfig);
  } catch (error) {
    if (recordChanged) {
      report(current.translationsFolder);
      report(next.translationsFolder);
    }
    throw error;
  }
  if (recordChanged) {
    report(current.translationsFolder);
    report(next.translationsFolder);
  }
  writeTerms?.();

  const message =
    targetName === collectionName
      ? `Collection "${collectionName}" updated successfully`
      : `Collection "${collectionName}" renamed to "${targetName}" and updated successfully`;
  return { message, entriesAdded, entriesRemoved, filesUpdated };
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
