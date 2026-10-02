import { needsTranslation } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import type { ResourceTreeEntry } from '../resource/load-resource-tree';
import { ResourceNotFoundError } from '../errors/lingo-tracker-error';
import { validateAndResolvePaths } from '../resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder } from '../resource/resource-folder';
import { type MutationSinkOptions, upsertMutation } from '../resource/resource-mutation';
import { snapshotTranslation, writeBackTranslations } from './translation-write-back';
import { assertAutoTranslationEnabled, type OpenTranslatorOptions, openTranslator } from './translator';

export interface TranslateExistingResourceResult {
  readonly translatedCount: number;
  /** Locales the Translator skipped, or whose value changed on disk during the provider call. */
  readonly skippedLocales: string[];
  readonly entry: ResourceTreeEntry;
  /** Problems that did not stop the Translator (a named protected-terms file that does not exist). */
  readonly warnings: string[];
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
export interface TranslateExistingResourceOptions extends OpenTranslatorOptions, MutationSinkOptions {}

export async function translateExistingResource(
  collection: Collection,
  key: string,
  options: TranslateExistingResourceOptions = {},
): Promise<TranslateExistingResourceResult> {
  const { baseLocale, translationsFolder } = collection;
  assertAutoTranslationEnabled(collection);

  const paths = validateAndResolvePaths({ key, translationsFolder });

  const folder = openResourceFolder(paths.folderPath, { baseLocale, translationsFolder });
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
      warnings: [],
    };
  }

  const snapshots = new Map(targetLocales.map((locale) => [locale, snapshotTranslation(entry.source, meta[locale])]));
  const translator = openTranslator(collection, options);
  const { values, skipped } = await translator.translate(
    [{ key: paths.resolvedKey, source: entry.source }],
    targetLocales,
  );

  const pending = values.flatMap(({ locale, value }) => {
    const snapshot = snapshots.get(locale);
    return snapshot ? [{ entryKey: paths.entryKey, locale, value, snapshot }] : [];
  });
  const writeBack = writeBackTranslations(collection, paths.folderPath, pending, {
    onMutation: options.onMutation,
    saved: (freshFolder) => [
      upsertMutation(
        translationsFolder,
        paths.resolvedKey,
        requireTreeEntry(freshFolder, paths.entryKey, paths.resolvedKey),
      ),
    ],
  });
  const updatedEntry = requireTreeEntry(writeBack.folder, paths.entryKey, paths.resolvedKey);

  return {
    translatedCount: writeBack.written.length,
    skippedLocales: [...skipped.map(({ locale }) => locale), ...writeBack.skipped.map(({ locale }) => locale)],
    entry: updatedEntry,
    warnings: [...translator.problems],
  };
}

function requireTreeEntry(folder: ResourceFolder, entryKey: string, resolvedKey: string): ResourceTreeEntry {
  const treeEntry = folder.treeEntry(entryKey);
  if (!treeEntry) {
    throw new ResourceNotFoundError(resolvedKey);
  }
  return treeEntry;
}
