import { needsTranslation } from '@simoncodes-ca/domain';
import type { TranslationConfig } from '../../config/translation-config';
import type { Collection } from '../config/open-collection';
import {
  CannotTranslateBaseLocaleError,
  NoTranslationTargetLocalesError,
  TranslationLocaleNotConfiguredError,
} from '../errors/lingo-tracker-error';
import { readCollection } from '../resource/read-collection';
import { type MutationSinkOptions, reindexMutation, resolveMutationSink } from '../resource/resource-mutation';
import type { ResourceTreeEntry } from '../resource/resource-tree-types';
import type { RunOutcome } from '../run-outcome';
import { type TranslationBatchOutcome, type TranslationBatchRow, translationBatch } from './translation-batch';
import { snapshotTranslation } from './translation-write-back';
import { assertAutoTranslationEnabled, type OpenTranslatorOptions, openPreparedTranslator } from './translator';

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

export interface TranslationRun {
  readonly targetLocales: readonly string[];
  forLocale(locale: string): LocaleTranslationRun;
}

export interface LocaleTranslationRun {
  readonly collectionName: string;
  readonly targetLocale: string;
  execute(options?: TranslationRunExecutionOptions): Promise<TranslateLocaleResult>;
}

export interface TranslationRunExecutionOptions {
  readonly onProgress?: (progress: TranslateLocaleProgress) => void;
}

/** Check availability before prompting; binding a locale checks its validity before queueing. */
export function prepareTranslationRun(collection: Collection, options: TranslationRunOptions = {}): TranslationRun {
  const translationConfig = assertAutoTranslationEnabled(collection);
  if (collection.targetLocales.length === 0) throw new NoTranslationTargetLocalesError(collection.baseLocale);
  const targetLocales = [...collection.targetLocales];
  return {
    targetLocales,
    forLocale(locale) {
      if (locale === collection.baseLocale) throw new CannotTranslateBaseLocaleError(locale);
      if (!targetLocales.includes(locale)) throw new TranslationLocaleNotConfiguredError(locale, collection.locales);
      return {
        collectionName: collection.name,
        targetLocale: locale,
        execute: (execution = {}) => executeLocale(collection, locale, translationConfig, { ...options, ...execution }),
      };
    },
  };
}

export interface TranslationRunOptions extends OpenTranslatorOptions, MutationSinkOptions {
  readonly delay?: (ms: number) => Promise<void>;
}

interface TranslationRunTally {
  translatedCount: number;
  skippedCount: number;
  failedCount: number;
  readonly skipped: Array<Extract<TranslationBatchOutcome, { status: 'skipped' }>>;
  readonly failures: Array<Extract<TranslationBatchOutcome, { status: 'failed' }>>;
}

/** Select eligible targets and snapshot them before translation. */
function selectTranslationRow(key: string, entry: ResourceTreeEntry, locales: readonly string[]) {
  const targets = locales.filter((locale) => needsTranslation(entry.metadata[locale]));
  const row: TranslationBatchRow = {
    key,
    source: entry.source,
    snapshots: Object.fromEntries(
      targets.map((locale) => [locale, snapshotTranslation(entry.source, entry.metadata[locale])]),
    ),
  };
  return { row, locales: targets };
}

interface ExecuteTranslationRunOptions extends TranslationRunOptions {
  readonly collection: Collection;
  readonly translationConfig: TranslationConfig;
  readonly rows: readonly TranslationBatchRow[];
  readonly locales: readonly string[];
  readonly onProgress?: (progress: TranslateLocaleProgress) => void;
}

/** Execute selected work; each key/locale outcome contributes exactly once. */
async function executeTranslationRun(
  options: ExecuteTranslationRunOptions,
): Promise<{ tally: TranslationRunTally; warnings: string[] }> {
  const { collection, translationConfig, rows, locales } = options;
  const tally: TranslationRunTally = {
    translatedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    skipped: [],
    failures: [],
  };
  if (rows.length === 0 || locales.length === 0) return { tally, warnings: [] };
  const translator = openPreparedTranslator(collection, translationConfig, options);
  const sink = resolveMutationSink(collection, options);
  const batchSize = translationConfig.batchSize ?? 5;
  const totalBatches = Math.ceil(rows.length / batchSize);
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let index = 0; index < totalBatches; index++) {
    let mutated = false;
    let outcomes: TranslationBatchOutcome[];
    try {
      outcomes = await translationBatch(
        collection,
        rows.slice(index * batchSize, (index + 1) * batchSize),
        locales,
        translator,
        {
          onMutation: () => {
            mutated = true;
          },
        },
      );
    } catch (error) {
      // Report partial writes before rethrowing; a secondary sink error cannot replace this error.
      try {
        if (mutated) sink?.(reindexMutation(collection.translationsFolder));
      } catch {
        // The original execution error takes precedence over mutation delivery.
      }
      throw error;
    }
    if (mutated) sink?.(reindexMutation(collection.translationsFolder));
    for (const outcome of outcomes) {
      if (outcome.status === 'failed') {
        tally.failedCount++;
        tally.failures.push(outcome);
      } else {
        if (outcome.status === 'written') tally.translatedCount++;
        else {
          tally.skippedCount++;
          tally.skipped.push(outcome);
        }
      }
    }
    options.onProgress?.({
      totalResources: rows.length,
      translatedCount: tally.translatedCount,
      skippedCount: tally.skippedCount,
      failedCount: tally.failedCount,
      currentBatch: index + 1,
      totalBatches,
    });
    if (index < totalBatches - 1) await delay(translationConfig.delayMs ?? 1000);
  }
  return { tally, warnings: [...translator.problems] };
}

/** Execute a bound locale without checking its preconditions again. */
async function executeLocale(
  collection: Collection,
  targetLocale: string,
  translationConfig: TranslationConfig,
  options: TranslationRunOptions & TranslationRunExecutionOptions,
): Promise<TranslateLocaleResult> {
  const { resources, problems } = readCollection(collection);
  const rows = resources
    .map(({ fullKey, entry }) => selectTranslationRow(fullKey, entry, [targetLocale]))
    .filter(({ locales }) => locales.length > 0)
    .map(({ row }) => row);
  const { tally, warnings } = await executeTranslationRun({
    ...options,
    collection,
    translationConfig,
    rows,
    locales: [targetLocale],
  });
  return {
    outcome: tally.failedCount > 0 ? 'failed' : 'succeeded',
    totalResources: rows.length,
    translatedCount: tally.translatedCount,
    skippedCount: tally.skippedCount,
    failedCount: tally.failedCount,
    skippedKeys: tally.skipped.map(({ key }) => key),
    failures: tally.failures.map(({ key, error }) => ({
      key,
      error: error instanceof Error ? error.message : String(error),
    })),
    warnings: [
      ...problems.map(({ folderPath, message }) => `Folder '${folderPath || '(root)'}' was not translated: ${message}`),
      ...warnings,
    ],
  };
}
