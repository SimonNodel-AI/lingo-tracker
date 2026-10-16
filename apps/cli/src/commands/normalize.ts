import { type NormalizeCollectionsResult, normalizeCollections } from '@simoncodes-ca/core';
import { CommandOutput } from '../runner/command-output';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, confirmOrCancel, reportRun } from '../utils';
import { NORMALIZE_FLAGS, NORMALIZE_SELECTION_ERROR } from './normalize-flags';

export interface NormalizeOptions {
  collection?: string;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
  yes?: boolean;
}

const COUNT_FIELDS = [
  ['entriesProcessed', 'Entries processed'],
  ['localesAdded', 'Locales added'],
  ['valuesConverted', 'Values converted to ICU'],
  ['tagsNormalized', 'Tags normalized'],
  ['filesCreated', 'Files created'],
  ['filesUpdated', 'Files updated'],
  ['foldersRemoved', 'Folders removed'],
] as const;

function normalizeCounts(
  counts: NormalizeCollectionsResult['totals'] | NormalizeCollectionsResult['collections'][number],
) {
  return COUNT_FIELDS.filter(([field]) => field !== 'tagsNormalized' || counts[field] > 0).map(([field, label]) => ({
    label,
    value: counts[field],
  }));
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
    const result = await normalizeCollections(collections, {
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
              for (const { label, value } of normalizeCounts(item)) ConsoleFormatter.indent(`✅ ${label}: ${value}`);
              for (const { key, locale, detail } of item.findings)
                ConsoleFormatter.warning(`${key} (${locale}): ${detail}`);
            }
            break;
          }
        }
      },
    });
    const summary = result.totals;
    const showSummary = result.status === 'complete' && collections.length > 1;
    return reportRun({
      presentation: answers.json
        ? { kind: 'json', payload: { collections: result.collections, totals: result.totals } }
        : { kind: 'text' },
      section: showSummary ? `Summary (${summary.collectionsProcessed} collections)` : undefined,
      counts: showSummary
        ? Object.fromEntries(
            normalizeCounts(summary).map(({ label, value }) => [
              `Total ${label[0]?.toLowerCase()}${label.slice(1)}`,
              value,
            ]),
          )
        : undefined,
      notice: answers.dryRun ? 'Dry run completed - no changes were made.' : undefined,
      warnings: result.warnings,
      errors: result.errors,
      outcome: result.outcome,
      dryRun: answers.dryRun,
    });
  },
});
