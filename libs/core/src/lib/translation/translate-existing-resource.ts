import { needsTranslation } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import type { ResourceTreeEntry } from '../resource/load-resource-tree';
import { AutoTranslationDisabledError, ResourceNotFoundError } from '../errors/lingo-tracker-error';
import { validateAndResolvePaths } from '../resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder } from '../resource/resource-folder';
import { type ResourceMutation, upsertMutation } from '../resource/resource-mutation';
import { type OpenTranslatorOptions, openTranslator } from './translator';

export interface TranslateExistingResourceResult {
  readonly translatedCount: number;
  /** Locales the Translator skipped (complex ICU, a lost placeholder, or a dropped protected term). */
  readonly skippedLocales: string[];
  readonly entry: ResourceTreeEntry;
  /** What changed on disk (empty when nothing was translated). */
  readonly mutations: ResourceMutation[];
}

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
export async function translateExistingResource(
  collection: Collection,
  key: string,
  options: OpenTranslatorOptions = {},
): Promise<TranslateExistingResourceResult> {
  const { baseLocale, translationsFolder } = collection;
  if (!collection.translationConfig?.enabled) {
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

  const { values, skipped } = await openTranslator(collection, options).translate(
    [{ key: paths.resolvedKey, source: entry.source }],
    targetLocales,
  );

  for (const { locale, value } of values) {
    folder.setTranslation(paths.entryKey, locale, value, 'translated');
  }

  if (values.length > 0) {
    folder.save();
  }

  const updatedEntry = requireTreeEntry(folder, paths.entryKey, paths.resolvedKey);

  return {
    translatedCount: values.length,
    skippedLocales: skipped.map(({ locale }) => locale),
    entry: updatedEntry,
    mutations: values.length > 0 ? [upsertMutation(translationsFolder, paths.resolvedKey, updatedEntry)] : [],
  };
}

function requireTreeEntry(folder: ResourceFolder, entryKey: string, resolvedKey: string): ResourceTreeEntry {
  const treeEntry = folder.treeEntry(entryKey);
  if (!treeEntry) {
    throw new ResourceNotFoundError(resolvedKey);
  }
  return treeEntry;
}
