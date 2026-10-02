/**
 * Bulk locale translation.
 *
 * Translates every resource of a collection that needs work for one target locale (the Staleness
 * rule: status `new` or `stale`, or no metadata for the locale) through the Translator. Resources
 * are sent in batches so that the number of provider calls is bounded regardless of how many
 * resources exist.
 *
 * Resources the Translator skips (complex ICU, a lost placeholder, a dropped protected term),
 * and resources whose base or target locale changes before the write, are reported in `skippedKeys` and left as they are.
 *
 * @module translate-locale
 */

import { type LocaleMetadata, needsTranslation } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { CannotTranslateBaseLocaleError, TranslationLocaleNotConfiguredError } from '../errors/lingo-tracker-error';
import { calculateChecksum } from '../resource/checksum';
import { readCollection } from '../resource/read-collection';
import { resolveResourcePaths } from '../resource/resource-file-paths';
import { openResourceFolder } from '../resource/resource-folder';
import { reindexMutation, type MutationSinkOptions } from '../resource/resource-mutation';
import type { RunOutcome } from '../run-outcome';
import {
  assertAutoTranslationEnabled,
  type OpenTranslatorOptions,
  openTranslator,
  type TranslatedValue,
} from './translator';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface TranslateLocaleParams extends OpenTranslatorOptions, MutationSinkOptions {
  /** One of the collection's target locales. */
  readonly targetLocale: string;
  readonly onProgress?: (progress: TranslateLocaleProgress) => void;
}

interface TranslateLocaleCounts {
  /**
   * Number of resources eligible for translation (status `new`, `stale`, or missing metadata
   * for the target locale). Does NOT represent the total collection size.
   * Returns 0 when no resources needed translation.
   */
  readonly totalResources: number;
  readonly translatedCount: number;
  readonly failedCount: number;
  readonly skippedCount: number;
}

export interface TranslateLocaleProgress extends TranslateLocaleCounts {
  readonly currentBatch: number;
  readonly totalBatches: number;
}

export interface TranslateLocaleResult extends TranslateLocaleCounts {
  readonly outcome: RunOutcome;
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

interface TranslationSnapshot {
  readonly baseChecksum: string;
  readonly targetChecksum: string | undefined;
  readonly targetStatus: LocaleMetadata['status'];
}

/**
 * Opens a folder once, stores every translated value for it, and saves once.
 * Values whose entry, base value, or target locale changed during translation are not written.
 */
function writeTranslatedValues(
  translationsFolder: string,
  folderPath: string,
  values: readonly {
    readonly entryKey: string;
    readonly value: TranslatedValue;
    readonly snapshot?: TranslationSnapshot;
  }[],
  baseLocale: string,
  onSave: () => void,
): { writtenKeys: string[]; skippedKeys: string[] } {
  const folder = openResourceFolder(folderPath, { baseLocale, translationsFolder });
  const writtenKeys: string[] = [];
  const skippedKeys: string[] = [];

  for (const { entryKey, value, snapshot } of values) {
    const current = folder.get(entryKey);
    const currentTarget = current?.meta?.[value.locale];
    if (
      !current ||
      !snapshot ||
      calculateChecksum(current.entry.source) !== snapshot.baseChecksum ||
      currentTarget?.checksum !== snapshot.targetChecksum ||
      currentTarget?.status !== snapshot.targetStatus ||
      !needsTranslation(currentTarget)
    ) {
      skippedKeys.push(value.key);
      continue;
    }
    folder.setTranslation(entryKey, value.locale, value.value, 'translated');
    writtenKeys.push(value.key);
  }

  if (writtenKeys.length > 0) {
    try {
      folder.save();
    } finally {
      // The first JSON file may have been written even if the second failed.
      onSave();
    }
  }

  return { writtenKeys, skippedKeys };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/** Checks whether a collection can start a job to translate this target locale. */
export function assertCanTranslateLocale(collection: Collection, locale: string): void {
  assertAutoTranslationEnabled(collection);
  if (locale === collection.baseLocale) {
    throw new CannotTranslateBaseLocaleError(locale);
  }
  if (!collection.locales.includes(locale)) {
    throw new TranslationLocaleNotConfiguredError(locale, collection.locales);
  }
}

/**
 * Translates every resource of `collection` that needs work for `targetLocale`, writing the
 * results back to disk with status `translated` (values ICU-normalised by the Translator).
 *
 * Resources are read with the Collection Reader (a folder it cannot read is not translated and is
 * reported in `warnings`, as is a named protected-terms file that does not exist) and
 * processed in batches of `translationConfig.batchSize` (default 5). A configurable delay
 * (`translationConfig.delayMs`, default 1000 ms) is inserted between batches to avoid hitting
 * provider rate limits.
 *
 * A collection without an enabled translation config is refused first, even when nothing needs
 * translation. When nothing needs translation, returns zeros without opening the Translator (so
 * without needing an API key). Skipped resources are listed in `skippedKeys`. A provider error
 * marks every resource in the failing batch as failed and continues with later batches.
 *
 * @param collection - The opened collection.
 * @param params - The target locale, an optional progress callback, and optional `provider` /
 *   `protectedTerms` to use instead of the collection's (see {@link openTranslator}).
 * @returns A summary of how many resources were translated, skipped, or failed.
 * @throws {AutoTranslationDisabledError} The collection has no enabled translation config (checked first).
 * @throws {CannotTranslateBaseLocaleError} The target is the collection's base locale.
 * @throws {TranslationLocaleNotConfiguredError} The target is not configured for the collection.
 * @throws {TranslationError} There is work, no provider was injected, and the API key env var is unset
 *   (`MISSING_API_KEY`).
 * @throws {ProtectedTermsFileError} There is work and a protected-terms file is malformed.
 */
export async function translateLocale(
  collection: Collection,
  params: TranslateLocaleParams,
): Promise<TranslateLocaleResult> {
  const { targetLocale, onProgress, onMutation } = params;
  const { baseLocale, translationsFolder } = collection;
  assertCanTranslateLocale(collection, targetLocale);

  const { resources, problems } = readCollection(collection);
  const warnings = problems.map(
    ({ folderPath, message }) => `Folder '${folderPath || '(root)'}' was not translated: ${message}`,
  );
  const resourcesToTranslate = resources.filter((resource) => needsTranslation(resource.entry.metadata[targetLocale]));

  if (resourcesToTranslate.length === 0) {
    return {
      outcome: 'succeeded',
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
  warnings.push(...translator.problems);

  const batchSize = collection.translationConfig?.batchSize ?? 5;
  const delayMs = collection.translationConfig?.delayMs ?? 1000;

  const totalResources = resourcesToTranslate.length;
  const totalBatches = Math.ceil(totalResources / batchSize);

  let translatedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  const failures: Array<{ key: string; error: string }> = [];
  const skippedKeys: string[] = [];
  const reportWrite = (): void => {
    onMutation?.(reindexMutation(translationsFolder));
  };

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * batchSize;
    const batch = resourcesToTranslate.slice(batchStart, batchStart + batchSize);
    const snapshots = new Map<string, TranslationSnapshot>(
      batch.map((resource) => [
        resource.fullKey,
        {
          baseChecksum: calculateChecksum(resource.entry.source),
          targetChecksum: resource.entry.metadata[targetLocale]?.checksum,
          targetStatus: resource.entry.metadata[targetLocale]?.status,
        },
      ]),
    );

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
      const byFolder = new Map<
        string,
        { entryKey: string; value: TranslatedValue; snapshot?: TranslationSnapshot }[]
      >();
      for (const value of values) {
        const { folderPath, entryKey } = resolveResourcePaths({ key: value.key, translationsFolder });
        const folderValues = byFolder.get(folderPath) ?? [];
        folderValues.push({ entryKey, value, snapshot: snapshots.get(value.key) });
        byFolder.set(folderPath, folderValues);
      }

      for (const [folderPath, folderValues] of byFolder) {
        const written = writeTranslatedValues(translationsFolder, folderPath, folderValues, baseLocale, reportWrite);
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

  return {
    outcome: failedCount > 0 ? 'failed' : 'succeeded',
    totalResources,
    translatedCount,
    failedCount,
    skippedCount,
    failures,
    skippedKeys,
    warnings,
  };
}
