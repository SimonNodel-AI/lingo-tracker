/**
 * Bulk locale translation.
 *
 * Translates every resource of a collection that needs work for one target locale (the Staleness
 * rule: status `new` or `stale`, or no metadata for the locale) through the Translator. Resources
 * are sent in batches so that the number of provider calls is bounded regardless of how many
 * resources exist.
 *
 * Resources the Translator skips (complex ICU, a lost placeholder, a dropped protected term) are
 * reported in `skippedKeys` and left as they are.
 *
 * @module translate-locale
 */

import { needsTranslation } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { readCollection } from '../resource/read-collection';
import { resolveResourcePaths } from '../resource/resource-file-paths';
import { openResourceFolder } from '../resource/resource-folder';
import { type OpenTranslatorOptions, openTranslator, type TranslatedValue } from './translator';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TranslateLocaleParams extends OpenTranslatorOptions {
  /** One of the collection's target locales. */
  readonly targetLocale: string;
  readonly onProgress?: (progress: TranslateLocaleProgress) => void;
}

export interface TranslateLocaleProgress {
  /**
   * Number of resources eligible for translation (status `new`, `stale`, or missing metadata
   * for the target locale). Does NOT represent the total collection size.
   * Returns 0 when no resources needed translation.
   */
  readonly totalResources: number;
  readonly translatedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly currentBatch: number;
  readonly totalBatches: number;
}

export interface TranslateLocaleResult {
  /**
   * Number of resources eligible for translation (status `new`, `stale`, or missing metadata
   * for the target locale). Does NOT represent the total collection size.
   * Returns 0 when no resources needed translation.
   */
  readonly totalResources: number;
  readonly translatedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
  readonly failures: ReadonlyArray<{ key: string; error: string }>;
  readonly skippedKeys: string[];
  /** One line per folder the Collection Reader could not read (its resources were not translated). */
  readonly warnings: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Opens a folder once, stores every translated value for it, and saves once.
 * Values whose entry is no longer on disk are not written.
 */
function writeTranslatedValues(
  folderPath: string,
  values: readonly { readonly entryKey: string; readonly value: TranslatedValue }[],
  baseLocale: string,
): { writtenKeys: string[]; skippedKeys: string[] } {
  const folder = openResourceFolder(folderPath, { baseLocale });
  const writtenKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const { entryKey, value } of values) {
    if (!folder.has(entryKey)) {
      skippedKeys.push(value.key);
      continue;
    }
    folder.setTranslation(entryKey, value.locale, value.value, 'translated');
    writtenKeys.push(value.key);
  }

  if (writtenKeys.length > 0) {
    folder.save();
  }

  return { writtenKeys, skippedKeys };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Translates every resource of `collection` that needs work for `targetLocale`, writing the
 * results back to disk with status `translated` (values ICU-normalised by the Translator).
 *
 * Resources are read with the Collection Reader (a folder it cannot read is not translated and is
 * reported in `warnings`) and
 * processed in batches of `translationConfig.batchSize` (default 5). A configurable delay
 * (`translationConfig.delayMs`, default 1000 ms) is inserted between batches to avoid hitting
 * provider rate limits.
 *
 * When nothing needs translation, returns zeros without opening the Translator (so without
 * needing an API key). Skipped resources are listed in `skippedKeys`. A provider error marks
 * every resource in the failing batch as failed but does not abort the run.
 *
 * @param collection - The opened collection.
 * @param params - The target locale, an optional progress callback, and optional `provider` /
 *   `protectedTerms` to use instead of the collection's (see {@link openTranslator}).
 * @returns A summary of how many resources were translated, skipped, or failed.
 * @throws {AutoTranslationDisabledError} There is work and the collection has no enabled translation config.
 * @throws {TranslationError} There is work, no provider was injected, and the API key env var is unset
 *   (`MISSING_API_KEY`).
 * @throws {ProtectedTermsFileError} There is work and a protected-terms file is malformed.
 */
export async function translateLocale(
  collection: Collection,
  params: TranslateLocaleParams,
): Promise<TranslateLocaleResult> {
  const { targetLocale, onProgress } = params;
  const { baseLocale, translationsFolder } = collection;

  const { resources, problems } = readCollection(collection);
  const warnings = problems.map(
    ({ folderPath, message }) => `Folder '${folderPath || '(root)'}' was not translated: ${message}`,
  );
  const resourcesToTranslate = resources.filter((resource) => needsTranslation(resource.entry.metadata[targetLocale]));

  if (resourcesToTranslate.length === 0) {
    return {
      totalResources: 0,
      translatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      failures: [],
      skippedKeys: [],
      warnings,
    };
  }

  const translator = openTranslator(collection, params);

  const batchSize = collection.translationConfig?.batchSize ?? 5;
  const delayMs = collection.translationConfig?.delayMs ?? 1000;

  const totalResources = resourcesToTranslate.length;
  const totalBatches = Math.ceil(totalResources / batchSize);

  let translatedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const failures: Array<{ key: string; error: string }> = [];
  const skippedKeys: string[] = [];

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batch = resourcesToTranslate.slice(batchStart, batchStart + batchSize);

    try {
      const { values, skipped } = await translator.translate(
        batch.map((resource) => ({ key: resource.fullKey, source: resource.entry.source })),
        [targetLocale],
      );

      for (const { key } of skipped) {
        skippedKeys.push(key);
        skippedCount++;
      }

      // Group by folder so each folder's files are read and written only once per batch.
      const byFolder = new Map<string, { entryKey: string; value: TranslatedValue }[]>();
      for (const value of values) {
        const { folderPath, entryKey } = resolveResourcePaths({ key: value.key, translationsFolder });
        const folderValues = byFolder.get(folderPath) ?? [];
        folderValues.push({ entryKey, value });
        byFolder.set(folderPath, folderValues);
      }

      for (const [folderPath, folderValues] of byFolder) {
        const written = writeTranslatedValues(folderPath, folderValues, baseLocale);
        translatedCount += written.writtenKeys.length;
        skippedCount += written.skippedKeys.length;
        skippedKeys.push(...written.skippedKeys);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      for (const resource of batch) {
        failures.push({ key: resource.fullKey, error: errorMessage });
        failedCount++;
      }
    }

    onProgress?.({
      totalResources,
      translatedCount,
      failedCount,
      skippedCount,
      currentBatch: batchIndex + 1,
      totalBatches,
    });

    // Pause between batches (skip after the last one).
    if (batchIndex < totalBatches - 1) {
      await sleep(delayMs);
    }
  }

  return { totalResources, translatedCount, failedCount, skippedCount, failures, skippedKeys, warnings };
}
