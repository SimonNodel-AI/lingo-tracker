import {
  emptyNormalizeCollectionsResult,
  type NormalizeCollectionsResult,
  normalizeCollections,
  ReadOnlyCollectionError,
} from '@simoncodes-ca/core';
import { CommandCancelledError, defineCommand } from '../runner/command-runner';
import { ALL_ITEMS_SENTINEL, ConsoleFormatter } from '../utils';

export interface NormalizeOptions {
  collection?: string;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

export const normalizeCommand = defineCommand<NormalizeOptions>()({
  name: 'Normalize',
  collection: 'many',
  many: {
    select: async (answers, { interactive, ask }) => {
      const selected = typeof answers.collectionOrAll === 'string' ? answers.collectionOrAll : undefined;
      const all = answers.all === true || selected === ALL_ITEMS_SENTINEL;
      const collectionName = answers.collection ?? (selected !== ALL_ITEMS_SENTINEL ? selected : undefined);
      if (!all) {
        if (!collectionName) throw new Error('Missing required option in non-interactive mode: --collection or --all');
        return [collectionName];
      }
      if (all && interactive) {
        ConsoleFormatter.warning('This will normalize ALL collections in your project.');
        const confirmed = await ask({ type: 'confirm', name: 'confirmed', message: 'Are you sure?', initial: false });
        if (confirmed.confirmed !== true) throw new CommandCancelledError();
      }
      return 'all';
    },
  },
  prompts: (options, { config }) => {
    const collections = Object.keys(config.collections ?? {});
    if (options.collection || options.all || collections.length === 0) {
      return [];
    }
    return [
      {
        type: 'select',
        name: 'collectionOrAll',
        message: 'Select collection to normalize',
        choices: [
          ...collections.map((c) => ({ title: c, value: c })),
          { title: 'All collections', value: ALL_ITEMS_SENTINEL },
        ],
      },
    ];
  },
  run: async ({ config, collections, answers }) => {
    const all = answers.all === true || answers.collectionOrAll === ALL_ITEMS_SENTINEL;
    let result: NormalizeCollectionsResult;
    try {
      result = await normalizeCollections(collections, {
        all,
        dryRun: answers.dryRun ?? false,
        onEvent: (event) => {
          switch (event.kind) {
            case 'skip':
              ConsoleFormatter.warning(`Skipping read-only collection: ${event.name}`);
              break;
            case 'start':
              if (!answers.json) {
                console.log('');
                ConsoleFormatter.progress(`Normalizing collection: ${event.name}`);
                if (answers.dryRun) ConsoleFormatter.indent('(Dry run - no changes will be made)');
              }
              break;
            case 'result': {
              const item = event.result;
              for (const problem of item.problems) {
                ConsoleFormatter.warning(`Folder problem: ${problem.message}`);
              }
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
            case 'error':
              ConsoleFormatter.error(
                `Failed to normalize collection "${event.name}": ${event.error instanceof Error ? event.error.message : String(event.error)}`,
              );
              break;
          }
        },
      });
    } catch (error) {
      if (!(error instanceof ReadOnlyCollectionError)) throw error;
      ConsoleFormatter.error(error.message);
      result = emptyNormalizeCollectionsResult();
      printSummary(result, 0, answers);
      return { exitCode: 1 };
    }
    printSummary(result, all ? Object.keys(config.collections ?? {}).length : collections.length, answers);
    return result.errors.length > 0 ? { exitCode: 1 } : undefined;
  },
});

function printSummary(result: NormalizeCollectionsResult, collectionCount: number, options: NormalizeOptions): void {
  if (options.json) {
    console.log(JSON.stringify({ collections: result.collections, totals: result.totals }, null, 2));
    return;
  }

  if (collectionCount > 1) {
    const summary = result.totals;
    ConsoleFormatter.section(`Summary (${summary.collectionsProcessed} collections)`);
    ConsoleFormatter.keyValue('Total entries processed', summary.entriesProcessed);
    ConsoleFormatter.keyValue('Total locales added', summary.localesAdded);
    ConsoleFormatter.keyValue('Total values converted to ICU', summary.valuesConverted);
    if (summary.tagsNormalized > 0) {
      ConsoleFormatter.keyValue('Total tags normalized', summary.tagsNormalized);
    }
    ConsoleFormatter.keyValue('Total files created', summary.filesCreated);
    ConsoleFormatter.keyValue('Total files updated', summary.filesUpdated);
    ConsoleFormatter.keyValue('Total folders removed', summary.foldersRemoved);
  }

  if (options.dryRun) {
    ConsoleFormatter.warning('Dry run completed - no changes were made.');
  }
}
