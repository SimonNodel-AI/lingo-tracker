import { NORMALIZE_FLAGS, NORMALIZE_SELECTION_ERROR } from './normalize-flags';
import {
  describeFolderProblem,
  emptyNormalizeCollectionsResult,
  type NormalizeCollectionsResult,
  normalizeCollections,
  ReadOnlyCollectionError,
} from '@simoncodes-ca/core';
import { cliErrorWording } from '../runner/cli-error-wording';
import { CommandOutput } from '../runner/command-output';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, confirmOrCancel, printRunReport } from '../utils';

export interface NormalizeOptions {
  collection?: string;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
}

export const normalizeCommand = defineCommand<NormalizeOptions>()({
  flags: NORMALIZE_FLAGS,
  name: 'Normalize',
  collection: 'many',
  many: {
    select: async (answers, { interactive, ask }, selections) => {
      const selection = selections.collection;
      // Normalize requires a name or an explicit all choice.
      if (!selection) throw new Error(NORMALIZE_SELECTION_ERROR);
      if (selection.kind === 'all') {
        await confirmOrCancel({
          ask,
          interactive,
          yes: answers.yes,
          message: 'Are you sure?',
          beforeAsk: () => ConsoleFormatter.warning('This will normalize ALL collections in your project.'),
        });
      }
      return selection;
    },
  },
  run: async ({ collections, selection, answers }) => {
    const all = selection.kind === 'all';
    let result: NormalizeCollectionsResult;
    try {
      result = await normalizeCollections(collections, {
        all,
        dryRun: answers.dryRun ?? false,
        onEvent: (event) => {
          switch (event.kind) {
            case 'start':
              if (!answers.json) {
                CommandOutput.log('');
                ConsoleFormatter.progress(`Normalizing collection: ${event.name}`);
                if (answers.dryRun) ConsoleFormatter.indent('(Dry run - no changes will be made)');
              }
              break;
            case 'result': {
              const item = event.result;
              if (!answers.json) {
                ConsoleFormatter.indent(`✅ Entries processed: ${item.entriesProcessed}`);
                ConsoleFormatter.indent(`✅ Locales added: ${item.localesAdded}`);
                ConsoleFormatter.indent(`✅ Values converted to ICU: ${item.valuesConverted}`);
                if (item.tagsNormalized > 0) ConsoleFormatter.indent(`✅ Tags normalized: ${item.tagsNormalized}`);
                ConsoleFormatter.indent(`✅ Files created: ${item.filesCreated}`);
                ConsoleFormatter.indent(`✅ Files updated: ${item.filesUpdated}`);
                ConsoleFormatter.indent(`✅ Folders removed: ${item.foldersRemoved}`);
              }
              break;
            }
          }
        },
      });
    } catch (error) {
      if (!(error instanceof ReadOnlyCollectionError)) throw error;
      return reportNormalize(
        emptyNormalizeCollectionsResult(),
        0,
        answers,
        [],
        [cliErrorWording(error)?.message ?? error.message],
        'failed',
      );
    }
    const warnings = collections.flatMap((collection) =>
      collection.readOnly && all
        ? [`Skipping read-only collection: ${collection.name}`]
        : (result.collections.find((item) => item.collectionName === collection.name)?.problems ?? []).map((problem) =>
            describeFolderProblem(problem, { collectionName: collection.name }),
          ),
    );
    const errors = result.errors.map(
      ({ name, error }) =>
        `Failed to normalize collection "${name}": ${error instanceof Error ? error.message : String(error)}`,
    );
    return reportNormalize(result, collections.length, answers, warnings, errors, result.outcome);
  },
});

function reportNormalize(
  result: NormalizeCollectionsResult,
  collectionCount: number,
  options: NormalizeOptions,
  warnings: readonly string[],
  errors: readonly string[],
  outcome: NormalizeCollectionsResult['outcome'],
) {
  const summary = result.totals;
  return printRunReport({
    presentation: options.json
      ? { kind: 'json', payload: { collections: result.collections, totals: result.totals } }
      : { kind: 'text' },
    section: collectionCount > 1 ? `Summary (${summary.collectionsProcessed} collections)` : undefined,
    counts:
      collectionCount > 1
        ? {
            'Total entries processed': summary.entriesProcessed,
            'Total locales added': summary.localesAdded,
            'Total values converted to ICU': summary.valuesConverted,
            ...(summary.tagsNormalized > 0 ? { 'Total tags normalized': summary.tagsNormalized } : {}),
            'Total files created': summary.filesCreated,
            'Total files updated': summary.filesUpdated,
            'Total folders removed': summary.foldersRemoved,
          }
        : undefined,
    notice: options.dryRun ? 'Dry run completed - no changes were made.' : undefined,
    warnings,
    errors,
    outcome,
    dryRun: options.dryRun,
  });
}
