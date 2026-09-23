import { needsTranslation } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import type { ResourceTreeEntry } from '../resource/load-resource-tree';
import { AutoTranslationDisabledError, ResourceNotFoundError } from '../errors/lingo-tracker-error';
import { validateAndResolvePaths } from '../resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder } from '../resource/resource-folder';
import { type ResourceMutation, upsertMutation } from '../resource/resource-mutation';
import { autoTranslateResource } from './auto-translate-resources';

export interface TranslateExistingResourceResult {
  readonly translatedCount: number;
  readonly skippedLocales: string[];
  readonly entry: ResourceTreeEntry;
  /** What changed on disk (empty when nothing was translated). */
  readonly mutations: ResourceMutation[];
}

/**
 * Auto-translates an existing resource entry of a collection, for every target locale
 * that needs translation (no metadata, or status `new` or `stale`).
 *
 * Returns early with `translatedCount: 0` when no locales require translation.
 *
 * @param key - The entry's full key.
 * @throws {AutoTranslationDisabledError} The collection has no enabled translation config.
 * @throws {InvalidResourceKeyError} The key is malformed.
 * @throws {ResourceNotFoundError} No entry exists at the key.
 * @throws {TranslationError} The translation provider failed.
 */
export async function translateExistingResource(
  collection: Collection,
  key: string,
): Promise<TranslateExistingResourceResult> {
  const { translationConfig, baseLocale, translationsFolder } = collection;
  if (!translationConfig?.enabled) {
    throw new AutoTranslationDisabledError(collection.name);
  }

  const paths = validateAndResolvePaths({ key, translationsFolder });

  const folder = openResourceFolder(paths.folderPath, { baseLocale });
  const current = folder.get(paths.entryKey);

  if (!current?.meta) {
    throw new ResourceNotFoundError(paths.resolvedKey);
  }

  const { entry, meta } = current;
  const targetLocales = collection.targetLocales.filter((locale) => needsTranslation(meta[locale]));

  if (targetLocales.length === 0) {
    return {
      translatedCount: 0,
      skippedLocales: [],
      entry: requireTreeEntry(folder, paths.entryKey, paths.resolvedKey),
      mutations: [],
    };
  }

  const { translations: translatedEntries, skippedLocales } = await autoTranslateResource({
    baseValue: entry.source,
    baseLocale,
    targetLocales,
    translationConfig,
  });

  for (const { locale, value } of translatedEntries) {
    folder.setTranslation(paths.entryKey, locale, value, 'translated');
  }

  if (translatedEntries.length > 0) {
    folder.save();
  }

  const updatedEntry = requireTreeEntry(folder, paths.entryKey, paths.resolvedKey);

  return {
    translatedCount: translatedEntries.length,
    skippedLocales,
    entry: updatedEntry,
    mutations:
      translatedEntries.length > 0 ? [upsertMutation(translationsFolder, paths.resolvedKey, updatedEntry)] : [],
  };
}

function requireTreeEntry(folder: ResourceFolder, entryKey: string, resolvedKey: string): ResourceTreeEntry {
  const treeEntry = folder.treeEntry(entryKey);
  if (!treeEntry) {
    throw new ResourceNotFoundError(resolvedKey);
  }
  return treeEntry;
}
