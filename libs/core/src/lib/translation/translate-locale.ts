import type { Collection } from '../config/open-collection';
import { executeTranslateLocale, prepareTranslateLocale } from './translation-run';
import type { TranslationRunOptions } from './translation-run';
import type { RunOutcome } from '../run-outcome';

export interface TranslateLocaleParams extends TranslationRunOptions {
  /** One of the collection's target locales. */
  readonly targetLocale: string;
  readonly onProgress?: (progress: TranslateLocaleProgress) => void;
}

export interface TranslateLocaleCounts {
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

/** Select a locale, prepare its run, and execute it. */
export async function translateLocale(
  collection: Collection,
  params: TranslateLocaleParams,
): Promise<TranslateLocaleResult> {
  return executeTranslateLocale(prepareTranslateLocale(collection, params.targetLocale), params);
}
