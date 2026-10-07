import { needsTranslation } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { groupByFolder } from './folder-batch';
import type { ResourceTreeEntry } from './resource-tree-types';
import { type MutationSinkOptions, resolveMutationSink, upsertMutation } from './resource-mutation';
import { snapshotTranslation, type TranslationSnapshot, writeBackTranslations } from './translation-write-back';
import type { Translator, TranslationOutcome } from '../machine-translation/translator';

export interface TranslationBatchRow {
  readonly key: string;
  readonly source: string;
  /** One snapshot for each requested target locale, taken before translation. */
  readonly snapshots: Readonly<Record<string, TranslationSnapshot>>;
}

export type TranslationBatchOutcome = { readonly key: string; readonly locale: string } & (
  | { readonly status: 'written'; readonly entry: ResourceTreeEntry | undefined }
  | { readonly status: 'skipped'; readonly entry: ResourceTreeEntry | undefined }
  | {
      readonly status: 'failed';
      readonly stage: 'provider' | 'write';
      /** The original error, shared by callers that report it or rethrow it. */
      readonly error: unknown;
    }
);

/** Select eligible targets and snapshot them before translation. */
export function selectTranslationRow(key: string, entry: ResourceTreeEntry, locales: readonly string[]) {
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

function pairKey(key: string, locale: string): string {
  return `${key}\0${locale}`;
}

/**
 * One Translator call followed by one write-back per folder; failures stay at their own stage.
 * The caller passes its resolved mutation sink. Rows have unique full keys and snapshots for every requested, non-base target locale.
 * Translator guarantees exactly one value or skip per entry x non-base locale; an invalid
 * provider response throws INVALID_RESPONSE. The counting invariant relies on this contract.
 * Provider skips are returned first, preserving the single-resource caller's skip ordering.
 * Successful saves report upsert once per written entry; saveReporting reindexes failed saves.
 */
export async function translationBatch(
  collection: Collection,
  rows: readonly TranslationBatchRow[],
  locales: readonly string[],
  translator: Translator,
  options: MutationSinkOptions = {},
): Promise<TranslationBatchOutcome[]> {
  const onMutation = 'onMutation' in options ? options.onMutation : resolveMutationSink(collection, options);
  const failed = (
    key: string,
    locale: string,
    stage: 'provider' | 'write',
    error: unknown,
  ): TranslationBatchOutcome => ({
    key,
    locale,
    status: 'failed',
    stage,
    error,
  });
  let translated: TranslationOutcome;
  try {
    translated = await translator.translate(
      rows.map(({ key, source }) => ({ key, source })),
      locales,
    );
  } catch (error) {
    return rows.flatMap(({ key }) => locales.map((locale) => failed(key, locale, 'provider', error)));
  }

  const values = new Map(translated.values.map((value) => [pairKey(value.key, value.locale), value]));
  const skips = new Map(translated.skipped.map((skip) => [pairKey(skip.key, skip.locale), skip]));
  const providerSkips: TranslationBatchOutcome[] = [];
  const outcomes: TranslationBatchOutcome[] = [];
  for (const { folderPath, members } of groupByFolder(collection, rows, (row) => row.key)) {
    const pending = members.flatMap(({ key, entryKey, item }) =>
      locales.flatMap((locale) => {
        const value = values.get(pairKey(key, locale));
        return value ? [{ entryKey, locale, value: value.value, snapshot: item.snapshots[locale] }] : [];
      }),
    );
    try {
      const result = writeBackTranslations(collection, folderPath, pending, {
        onMutation,
        saved: (folder, written) => {
          const writtenKeys = new Set(written.map(({ entryKey }) => entryKey));
          return members
            .filter(({ entryKey }) => writtenKeys.has(entryKey))
            .map(({ key, entryKey }) => upsertMutation(collection.translationsFolder, key, folder.treeEntry(entryKey)));
        },
      });
      const written = new Set(result.written.map(({ entryKey, locale }) => pairKey(entryKey, locale)));
      for (const { key, entryKey } of members) {
        const entry = result.folder.treeEntry(entryKey);
        for (const locale of locales) {
          const outcome: TranslationBatchOutcome = {
            key,
            locale,
            entry,
            status: written.has(pairKey(entryKey, locale)) ? 'written' : 'skipped',
          };
          if (skips.has(pairKey(key, locale))) providerSkips.push(outcome);
          else outcomes.push(outcome);
        }
      }
    } catch (error) {
      for (const { key } of members) {
        for (const locale of locales) {
          outcomes.push(failed(key, locale, 'write', error));
        }
      }
    }
  }
  return [...providerSkips, ...outcomes];
}
