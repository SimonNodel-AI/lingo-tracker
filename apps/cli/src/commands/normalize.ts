import { type NormalizeResult, normalize, ReadOnlyCollectionError } from '@simoncodes-ca/core';
import { CommandCancelledError, defineCommand } from '../runner/command-runner';
import { ALL_ITEMS_SENTINEL, aggregateNumericFields, ConsoleFormatter } from '../utils';

export interface NormalizeOptions {
  collection?: string;
  all?: boolean;
  dryRun?: boolean;
  json?: boolean;
}

interface CollectionNormalizeResult {
  collectionName: string;
  entriesProcessed: number;
  localesAdded: number;
  valuesConverted: number;
  tagsNormalized: number;
  filesCreated: number;
  filesUpdated: number;
  foldersRemoved: number;
  /** Folders normalize could not read and left as they are. */
  problems: NormalizeResult['problems'];
}

interface NormalizeCommandResult {
  collections: CollectionNormalizeResult[];
  totals: {
    collectionsProcessed: number;
    entriesProcessed: number;
    localesAdded: number;
    valuesConverted: number;
    tagsNormalized: number;
    filesCreated: number;
    filesUpdated: number;
    foldersRemoved: number;
  };
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
    let failed = false;
    const collectionResults: CollectionNormalizeResult[] = [];
    const all = answers.all === true || answers.collectionOrAll === ALL_ITEMS_SENTINEL;

    if (!all && collections[0]?.readOnly) {
      ConsoleFormatter.error(new ReadOnlyCollectionError(collections[0].name).message);
      printSummary(collectionResults, 0, answers);
      return { exitCode: 1 };
    }

    for (const collection of collections) {
      const { name } = collection;

      if (collection.readOnly) {
        ConsoleFormatter.warning(`Skipping read-only collection: ${name}`);
        continue;
      }

      if (!answers.json) {
        console.log('');
        ConsoleFormatter.progress(`Normalizing collection: ${name}`);
        if (answers.dryRun) {
          ConsoleFormatter.indent('(Dry run - no changes will be made)');
        }
      }

      try {
        const result = await normalize(collection, { dryRun: answers.dryRun ?? false });
        // stderr, so it is reported with --json too.
        for (const problem of result.problems) {
          ConsoleFormatter.warning(`Skipped unreadable folder: ${problem.message}`);
        }

        collectionResults.push({
          collectionName: name,
          entriesProcessed: result.entriesProcessed,
          localesAdded: result.localesAdded,
          valuesConverted: result.valuesConverted,
          tagsNormalized: result.tagsNormalized,
          filesCreated: result.filesCreated,
          filesUpdated: result.filesUpdated,
          foldersRemoved: result.foldersRemoved,
          problems: result.problems,
        });

        if (!answers.json) {
          ConsoleFormatter.indent(`✅ Entries processed: ${result.entriesProcessed}`);
          ConsoleFormatter.indent(`✅ Locales added: ${result.localesAdded}`);
          ConsoleFormatter.indent(`✅ Values converted to ICU: ${result.valuesConverted}`);
          if (result.tagsNormalized > 0) {
            ConsoleFormatter.indent(`✅ Tags normalized: ${result.tagsNormalized}`);
          }
          ConsoleFormatter.indent(`✅ Files created: ${result.filesCreated}`);
          ConsoleFormatter.indent(`✅ Files updated: ${result.filesUpdated}`);
          ConsoleFormatter.indent(`✅ Folders removed: ${result.foldersRemoved}`);
        }
      } catch (e: unknown) {
        failed = true;
        // stderr, so it is reported with --json too.
        ConsoleFormatter.error(
          `Failed to normalize collection "${name}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }

    printSummary(collectionResults, all ? Object.keys(config.collections ?? {}).length : collections.length, answers);
    return failed ? { exitCode: 1 } : undefined;
  },
});

function printSummary(
  collectionResults: CollectionNormalizeResult[],
  collectionCount: number,
  options: NormalizeOptions,
): void {
  const totals = () => ({
    ...aggregateNumericFields(collectionResults, [
      'entriesProcessed',
      'localesAdded',
      'valuesConverted',
      'tagsNormalized',
      'filesCreated',
      'filesUpdated',
      'foldersRemoved',
    ]),
    collectionsProcessed: collectionResults.length,
  });

  if (options.json) {
    const output: NormalizeCommandResult = { collections: collectionResults, totals: totals() };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  if (collectionCount > 1) {
    const summary = totals();
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
