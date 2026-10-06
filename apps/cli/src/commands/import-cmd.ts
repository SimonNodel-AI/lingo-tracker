import { IMPORT_FLAGS } from './import-cmd-flags';
import { type ImportResult, type ImportRunOptions, type RunOutcome, runImport } from '@simoncodes-ca/core';
import * as fs from 'fs';
import * as path from 'path';
import { cliErrorWording } from '../runner/cli-error-wording';
import { CommandOutput } from '../runner/command-output';
import { type CommandResult, defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, printRunReport, saveRunSummary } from '../utils';
import { type ImportCommandOptions, importQuestions, resolveImportOptions } from './import-options';

export type { ImportCommandOptions } from './import-options';

export const importCommand = defineCommand<ImportCommandOptions>()({
  flags: IMPORT_FLAGS,
  name: 'Import',
  collection: 'writable',
  prompts: (options, { collection, cwd }) =>
    importQuestions(options, {
      configuredLocales: collection.locales,
      baseLocale: collection.baseLocale,
      sourceExists: (source) => fs.existsSync(path.resolve(cwd, source)),
    }),
  required: ['source', 'locale'],
  run: async ({ cwd, collection, answers, summaryDirectory }) => {
    const options = resolveImportOptions(answers);
    const { source, locale } = answers;
    const runOptions: ImportRunOptions = {
      ...options,
      locale,
      onProgress: options.verbose ? (msg: string) => CommandOutput.log(`  ${msg}`) : undefined,
    };

    let startTime = 0;
    let run: Awaited<ReturnType<typeof runImport>>;
    try {
      run = await runImport(collection, {
        ...runOptions,
        source,
        cwd,
        format: options.format,
        onWarning: ({ message, details }) => ConsoleFormatter.warning(message, details),
        onStart: (format) => {
          if (!answers.format && runOptions.verbose) CommandOutput.log(`Detected format: ${format}`);
          CommandOutput.log('');
          ConsoleFormatter.progress('Starting import...');
          ConsoleFormatter.indent(`Format: ${format}`);
          ConsoleFormatter.indent(`Source: ${source}`);
          ConsoleFormatter.indent(`Locale: ${runOptions.locale}`);
          ConsoleFormatter.indent(`Strategy: ${runOptions.strategy}`);
          ConsoleFormatter.indent(`Collection: ${collection.name}`);
          if (runOptions.dryRun) ConsoleFormatter.indent('Mode: DRY RUN (no changes will be made)');
          CommandOutput.log('');
          startTime = runOptions.verbose ? Date.now() : 0;
          if (runOptions.verbose) CommandOutput.log(`Started at: ${new Date(startTime).toLocaleTimeString()}`);
        },
      });
    } catch (error) {
      // Typed failures use the shared wording. Only untyped import execution failures
      // keep this command-specific prefix; later reporting failures use the runner unchanged.
      if (cliErrorWording(error) !== undefined) throw error;
      ConsoleFormatter.error(`Import failed: ${error instanceof Error ? error.message : String(error)}`);
      return { exitCode: 1 };
    }
    const { result } = run;

    // Log elapsed time in verbose mode
    if (runOptions.verbose) {
      const endTime = Date.now();
      const elapsedMilliseconds = endTime - startTime;
      const elapsedSeconds = (elapsedMilliseconds / 1000).toFixed(2);
      CommandOutput.log(`\nCompleted at: ${new Date(endTime).toLocaleTimeString()}`);
      CommandOutput.log(`Elapsed time: ${elapsedSeconds}s (${elapsedMilliseconds}ms)`);
    }

    const dryRun = Boolean(runOptions.dryRun);
    const summary = saveRunSummary('import', run.summary, { dryRun, directory: summaryDirectory });
    const exit = displayResults(run.outcome, result, runOptions, summary.path);
    summary.announce();
    return exit;
  },
});

function displayResults(
  outcome: RunOutcome,
  result: ImportResult,
  options: ImportRunOptions,
  summaryPath: string | undefined,
): CommandResult {
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
    CommandOutput.log('');
    ConsoleFormatter.indent('Status Transitions:');
    for (const transition of result.statusTransitions) {
      const from = transition.from || 'none';
      const to = transition.to;
      ConsoleFormatter.indent(`${from} → ${to}: ${transition.count}`, 2);
    }
  }

  // Display files modified
  if (!options.dryRun && result.filesModified.length > 0) {
    CommandOutput.log('');
    ConsoleFormatter.keyValue('Files Modified', result.filesModified.length);
    if (options.verbose) {
      result.filesModified.forEach((file) => {
        ConsoleFormatter.indent(file, 2);
      });
    }
  }

  const exit = printRunReport({
    warnings: result.warnings,
    errors: result.errors,
    outcome,
    dryRun: options.dryRun,
    summaryPath,
  });

  CommandOutput.log('─'.repeat(50));

  // Summary message
  CommandOutput.log('');
  if (options.dryRun) {
    ConsoleFormatter.success('Dry run complete. No changes were made.');
  } else if (result.resourcesFailed > 0 || result.errors.length > 0) {
    ConsoleFormatter.warning('Import completed with errors.');
  } else if (result.warnings.length > 0) {
    ConsoleFormatter.success('Import completed with warnings.');
  } else {
    ConsoleFormatter.success('Import completed successfully!');
  }
  return exit;
}
