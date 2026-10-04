import type { Collection } from '../config/open-collection';
import { ResourceNotFoundError } from '../errors/lingo-tracker-error';
import type { ResourceTreeEntry } from '../resource/load-resource-tree';
import { openResourceEntry } from '../resource/resource-entry';
import type { ResourceFolder } from '../resource/resource-folder';

import { executeTranslationRun, selectTranslationRow, type TranslationRunOptions } from './translation-run';
import { assertAutoTranslationEnabled } from './translator';

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
export interface TranslateExistingResourceOptions extends Omit<TranslationRunOptions, 'delay'> {}

export async function translateExistingResource(
  collection: Collection,
  key: string,
  options: TranslateExistingResourceOptions = {},
): Promise<TranslateExistingResourceResult> {
  const translationConfig = assertAutoTranslationEnabled(collection);

  const resource = openResourceEntry(collection, key);
  const { folder } = resource;
  const current = resource.get();

  if (!current?.meta) {
    throw new ResourceNotFoundError(resource.resolvedKey);
  }

  const treeEntry = requireTreeEntry(folder, resource.entryKey, resource.resolvedKey);
  const { row, locales: targetLocales } = selectTranslationRow(
    resource.resolvedKey,
    treeEntry,
    collection.targetLocales,
  );

  if (targetLocales.length === 0) {
    return {
      translatedCount: 0,
      skippedLocales: [],
      entry: requireTreeEntry(folder, resource.entryKey, resource.resolvedKey),
      warnings: [],
    };
  }

  const { tally, warnings } = await executeTranslationRun({
    ...options,
    collection,
    translationConfig,
    rows: [row],
    locales: targetLocales,
    mutations: 'per-write',
  });
  const failure = tally.failures[0];
  if (failure) throw failure.error;
  if (!tally.entry) throw new ResourceNotFoundError(resource.resolvedKey);
  return {
    translatedCount: tally.translatedCount,
    skippedLocales: tally.skipped.map(({ locale }) => locale),
    entry: tally.entry,
    warnings,
  };
}

function requireTreeEntry(folder: ResourceFolder, entryKey: string, resolvedKey: string): ResourceTreeEntry {
  const treeEntry = folder.treeEntry(entryKey);
  if (!treeEntry) {
    throw new ResourceNotFoundError(resolvedKey);
  }
  return treeEntry;
}
