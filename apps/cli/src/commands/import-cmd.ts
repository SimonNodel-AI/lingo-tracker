import {
  detectImportFormat,
  generateImportSummary,
  type ImportFormat,
  type ImportResult,
  type ImportRunOptions,
  importResources,
  loadPreferredTerminology,
  parseJsonImport,
  parseXliffImport,
  readEffectiveProtectedTerms,
} from '@simoncodes-ca/core';
import type { ImportStrategy } from '@simoncodes-ca/domain';
import * as fs from 'fs';
import * as path from 'path';
import type prompts from 'prompts';
import { defineCommand } from '../runner/command-runner';
import { buildSummaryPath, ConsoleFormatter } from '../utils';

export const LARGE_FILE_SIZE_THRESHOLD = 5;

export interface ImportCommandOptions {
  format?: ImportFormat;
  source?: string;
  locale?: string;
  collection?: string;
  strategy?: ImportStrategy;
  updateComments?: boolean;
  updateTags?: boolean;
  preserveStatus?: boolean;
  createMissing?: boolean;
  validateBase?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
}

export const importCommand = defineCommand<ImportCommandOptions>()({
  name: 'Import',
  collection: 'writable',
  prompts: (options, { collection, cwd }) => buildQuestions(options, collection.locales, collection.baseLocale, cwd),
  required: ['source', 'locale'],
  run: async ({ config, cwd, collection, answers }) => {
    // The collection's own base locale decides which import writes `source` values.
    const { baseLocale } = collection;
    const { source } = answers;
    // A relative --source is relative to the project root, like --output on export.
    const sourcePath = path.resolve(cwd, source);

    // Check file size and warn if large
    try {
      if (fs.existsSync(sourcePath)) {
        const stats = fs.statSync(sourcePath);
        const fileSizeMB = stats.size / (1024 * 1024);

        if (fileSizeMB > LARGE_FILE_SIZE_THRESHOLD) {
          ConsoleFormatter.warning(`Large import file detected: ${fileSizeMB.toFixed(2)} MB`);
          ConsoleFormatter.indent('Import may take longer than usual.');
        }
      }
    } catch (_error) {
      // File size check is non-critical, continue with import
    }

    const preferredTerminology = loadPreferredTerminology(config, cwd);
    const runOptions: ImportRunOptions = {
      locale: answers.locale,
      strategy: answers.strategy || 'translation-service',
      updateComments: answers.updateComments,
      updateTags: answers.updateTags,
      preserveStatus: answers.preserveStatus,
      createMissing: answers.createMissing,
      validateBase: answers.validateBase !== false, // Default true
      dryRun: answers.dryRun || false,
      verbose: answers.verbose || false,
      protectedTerms: readEffectiveProtectedTerms(config, collection.config, cwd),
      // Only consulted on base-locale imports. A broken file yields no rules, so the
      // check is skipped and a config warning is added once the import has run.
      preferredTerminology: preferredTerminology.rules,
      onProgress: answers.verbose ? (msg: string) => console.log(`  ${msg}`) : undefined,
    };

    // Auto-detect format if not specified
    let format = answers.format;
    if (!format) {
      format = detectImportFormat(source);
      if (runOptions.verbose) {
        console.log(`Detected format: ${format}`);
      }
    }

    // Display import summary
    console.log('');
    ConsoleFormatter.progress('Starting import...');
    ConsoleFormatter.indent(`Format: ${format}`);
    ConsoleFormatter.indent(`Source: ${source}`);
    ConsoleFormatter.indent(`Locale: ${runOptions.locale}`);
    ConsoleFormatter.indent(`Strategy: ${runOptions.strategy}`);
    ConsoleFormatter.indent(`Collection: ${collection.name}`);
    if (runOptions.dryRun) {
      ConsoleFormatter.indent('Mode: DRY RUN (no changes will be made)');
    }
    console.log('');

    // Performance logging for verbose mode
    const startTime = runOptions.verbose ? Date.now() : 0;
    if (runOptions.verbose) {
      console.log(`Started at: ${new Date(startTime).toLocaleTimeString()}`);
    }

    let result: ImportResult;
    try {
      const parseOptions = { onProgress: runOptions.onProgress };
      const resources =
        format === 'json'
          ? parseJsonImport(sourcePath, parseOptions)
          : await parseXliffImport(sourcePath, parseOptions);
      result = importResources(collection, resources, runOptions);
    } catch (error) {
      throw new Error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Terminology is only checked when importing into the base locale, so a rule file
    // problem only matters then. Surfaced through the result so it reaches the summary.
    const terminologyConfigWarning = preferredTerminology.error
      ? `Preferred terminology checks skipped: ${preferredTerminology.error}`
      : preferredTerminology.warning;
    if (terminologyConfigWarning && result.locale === baseLocale) {
      result = { ...result, warnings: [terminologyConfigWarning, ...result.warnings] };
    }

    // Log elapsed time in verbose mode
    if (runOptions.verbose) {
      const endTime = Date.now();
      const elapsedMilliseconds = endTime - startTime;
      const elapsedSeconds = (elapsedMilliseconds / 1000).toFixed(2);
      console.log(`\nCompleted at: ${new Date(endTime).toLocaleTimeString()}`);
      console.log(`Elapsed time: ${elapsedSeconds}s (${elapsedMilliseconds}ms)`);
    }

    // Display results
    displayResults(result, runOptions);

    // Generate and write summary
    const summaryPath = buildSummaryPath('import');
    if (!runOptions.dryRun) {
      try {
        const summary = generateImportSummary(result, { ...runOptions, format, source });
        fs.writeFileSync(summaryPath, summary, 'utf8');
        console.log('');
        console.log(`Import summary written to: ${summaryPath}`);
      } catch (error) {
        ConsoleFormatter.warning(`Failed to write summary file: ${(error as Error).message}`);
      }
    } else {
      console.log('');
      console.log(`Import summary would be written to: ${summaryPath}`);
    }

    // Exit with appropriate code
    return result.resourcesFailed > 0 || result.errors.length > 0 ? { exitCode: 1 } : undefined;
  },
});

/**
 * The questions for what the flags left out. Later questions depend on earlier answers
 * (the format is only asked when the source's extension does not tell it; the locale
 * choices and the migration flags depend on the strategy), through prompts' function-valued
 * `type` and `choices`.
 */
function buildQuestions(
  options: ImportCommandOptions,
  configuredLocales: readonly string[],
  baseLocale: string,
  cwd: string,
): prompts.PromptObject[] {
  const questions: prompts.PromptObject[] = [];
  const strategyOf = (values: Record<string, unknown>): ImportStrategy =>
    options.strategy ?? (values.strategy as ImportStrategy | undefined) ?? 'translation-service';
  const localesFor = (strategy: ImportStrategy): readonly string[] =>
    // For migration, the base locale is a valid target too.
    strategy === 'migration' ? configuredLocales : configuredLocales.filter((loc) => loc !== baseLocale);

  if (!options.source) {
    questions.push({
      type: 'text',
      name: 'source',
      message: 'Enter path to import file:',
      validate: (value: string) => {
        if (!value || value.trim() === '') {
          return 'Source file is required';
        }
        if (!fs.existsSync(path.resolve(cwd, value))) {
          return `File not found: ${value}`;
        }
        return true;
      },
    });
  }

  if (!options.format) {
    questions.push({
      // Skipped when the source's extension gives the format; `run` detects it again.
      type: (_prev: unknown, values: Record<string, unknown>) => {
        const source = options.source ?? (typeof values.source === 'string' ? values.source : '');
        try {
          detectImportFormat(source);
          return null;
        } catch {
          return 'select';
        }
      },
      name: 'format',
      message: 'Select import format:',
      choices: [
        { title: 'JSON', value: 'json', description: 'JSON format (flat or hierarchical)' },
        { title: 'XLIFF 1.2', value: 'xliff', description: 'XLIFF format for professional translation services' },
      ],
    });
  }

  if (!options.strategy) {
    questions.push({
      type: 'select',
      name: 'strategy',
      message: 'Select import strategy:',
      choices: [
        {
          title: 'Translation Service',
          value: 'translation-service',
          description: 'Import from professional translation services (default)',
        },
        { title: 'Verification', value: 'verification', description: 'Language expert verification workflow' },
        { title: 'Migration', value: 'migration', description: 'Migrate from another translation system' },
        { title: 'Update', value: 'update', description: 'Bulk update existing translations' },
      ],
    });
  }

  if (!options.locale) {
    // `validate` is not given the earlier answers, so the `type` callback records the strategy for it.
    let strategy: ImportStrategy = options.strategy ?? 'translation-service';
    questions.push({
      type: (_prev: unknown, values: Record<string, unknown>) => {
        strategy = strategyOf(values);
        return localesFor(strategy).length > 0 ? 'select' : 'text';
      },
      name: 'locale',
      message: 'Select target locale for import:',
      choices: (_prev: unknown, values: Record<string, unknown>) =>
        localesFor(strategyOf(values)).map((loc) => ({
          title: loc === baseLocale ? `${loc} (base locale)` : loc,
          value: loc,
        })),
      validate: (value: string) => {
        if (localesFor(strategy).length > 0) {
          return true;
        }
        if (!value || value.trim() === '') {
          return 'Locale is required';
        }
        if (value === baseLocale && strategy !== 'migration') {
          return `Cannot import into base locale "${baseLocale}" with strategy "${strategy}"`;
        }
        return true;
      },
    });
  }

  const migrationFlag = (name: 'updateComments' | 'updateTags' | 'createMissing', message: string) => {
    if (options[name] === undefined) {
      questions.push({
        type: (_prev: unknown, values: Record<string, unknown>) =>
          strategyOf(values) === 'migration' ? 'confirm' : null,
        name,
        message,
        initial: true,
      });
    }
  };
  migrationFlag('updateComments', 'Update comments from import data?');
  migrationFlag('updateTags', 'Update tags from import data?');
  migrationFlag('createMissing', 'Create missing resources?');

  return questions;
}

function displayResults(result: ImportResult, options: ImportRunOptions): void {
  ConsoleFormatter.section('Import Results');

  if (options.dryRun) {
    ConsoleFormatter.indent('Mode: DRY RUN (no changes were made)');
  }

  ConsoleFormatter.keyValue('Resources Imported', result.resourcesImported);
  ConsoleFormatter.keyValue('Resources Created', result.resourcesCreated);
  ConsoleFormatter.keyValue('Resources Updated', result.resourcesUpdated);

  if (result.resourcesSkipped > 0) {
    ConsoleFormatter.keyValue('Resources Skipped', result.resourcesSkipped);
  }

  if (result.resourcesFailed > 0) {
    ConsoleFormatter.keyValue('Resources Failed', result.resourcesFailed);
  }

  // Display status transitions
  if (result.statusTransitions && result.statusTransitions.length > 0) {
    console.log('');
    ConsoleFormatter.indent('Status Transitions:');
    for (const transition of result.statusTransitions) {
      const from = transition.from || 'none';
      const to = transition.to;
      ConsoleFormatter.indent(`${from} → ${to}: ${transition.count}`, 2);
    }
  }

  // Display files modified
  if (!options.dryRun && result.filesModified.length > 0) {
    console.log('');
    ConsoleFormatter.keyValue('Files Modified', result.filesModified.length);
    if (options.verbose) {
      result.filesModified.forEach((file) => {
        ConsoleFormatter.indent(file, 2);
      });
    }
  }

  // Display warnings
  if (result.warnings.length > 0) {
    console.log('');
    ConsoleFormatter.warning(`Warnings (${result.warnings.length}):`);
    result.warnings.slice(0, 10).forEach((warning) => {
      ConsoleFormatter.indent(warning);
    });
    if (result.warnings.length > 10) {
      ConsoleFormatter.indent(`... and ${result.warnings.length - 10} more warnings`);
    }
  }

  // Display errors
  if (result.errors.length > 0) {
    console.log('');
    ConsoleFormatter.error(`Errors (${result.errors.length}):`);
    result.errors.slice(0, 10).forEach((error) => {
      ConsoleFormatter.indent(error);
    });
    if (result.errors.length > 10) {
      ConsoleFormatter.indent(`... and ${result.errors.length - 10} more errors`);
    }
  }

  console.log('─'.repeat(50));

  // Summary message
  console.log('');
  if (options.dryRun) {
    ConsoleFormatter.success('Dry run complete. No changes were made.');
  } else if (result.resourcesFailed > 0 || result.errors.length > 0) {
    ConsoleFormatter.warning('Import completed with errors.');
  } else if (result.warnings.length > 0) {
    ConsoleFormatter.success('Import completed with warnings.');
  } else {
    ConsoleFormatter.success('Import completed successfully!');
  }
}
