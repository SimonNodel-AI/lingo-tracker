import {
  prepareTranslationRun,
  type Collection,
  type TranslationRun,
  type TranslationRunOptions,
  AutoTranslationDisabledError,
} from '@simoncodes-ca/core';
import { CommandOutput } from '../runner/command-output';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, printRunReport } from '../utils';

export interface TranslateLocaleOptions {
  collection?: string;
  locale?: string;
  verbose?: boolean;
}

/**
 * CLI command that auto-translates all `new` and `stale` resources for a
 * single target locale within a collection.
 *
 * When interactive, a missing `locale` is prompted for (the runner prompts for the
 * collection). When non-interactive, `--locale` is required, and `--collection` too
 * when several collections are configured.
 */
export function createTranslateLocaleCommand(options: TranslationRunOptions = {}) {
  const preparedRuns = new WeakMap<Collection, TranslationRun>();

  return defineCommand<TranslateLocaleOptions>()({
    name: 'Translate locale',
    collection: 'writable',
    formatError: (error, duringRun) => {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof AutoTranslationDisabledError) {
        return `${message}. Set translation.enabled = true in your configuration`;
      }
      return duringRun ? `Translation failed: ${message}` : undefined;
    },
    preflight: ({ options: flags, collection }) => {
      const run = prepareTranslationRun(collection, options);
      if (flags.locale) run.forLocale(flags.locale);
      preparedRuns.set(collection, run);
    },
    prompts: (options, { collection }) => {
      const prepared = preparedRuns.get(collection);
      if (!prepared) throw new Error('Translation run was not prepared');
      return options.locale
        ? []
        : [
            {
              type: 'select',
              name: 'locale',
              message: 'Select target locale to translate',
              choices: prepared.targetLocales.map((locale) => ({ title: locale, value: locale })),
            },
          ];
    },
    required: ['locale'],
    run: async ({ collection, answers }) => {
      const { name: collectionName } = collection;
      const targetLocale = answers.locale;

      CommandOutput.log('');
      ConsoleFormatter.progress(`Translating locale '${targetLocale}' in collection '${collectionName}'...`);

      const prepared = preparedRuns.get(collection);
      if (!prepared) throw new Error('Translation run was not prepared');
      const result = await prepared.forLocale(targetLocale).execute({
        onProgress: answers.verbose
          ? (progress) => {
              ConsoleFormatter.indent(
                `[batch ${progress.currentBatch}/${progress.totalBatches}] ` +
                  `translated: ${progress.translatedCount}, skipped: ${progress.skippedCount}, failed: ${progress.failedCount}`,
              );
            }
          : undefined,
      });

      CommandOutput.log('');
      ConsoleFormatter.success(`Translated locale '${targetLocale}' in collection '${collectionName}'`);
      ConsoleFormatter.keyValue('Translated', result.translatedCount);
      ConsoleFormatter.keyValue('Skipped (needs human translation)', result.skippedCount);
      ConsoleFormatter.keyValue('Failed', result.failedCount);

      return printRunReport({
        warnings: result.warnings,
        errors: result.failures.map((failure) => `${failure.key}: ${failure.error}`),
        outcome: result.outcome,
      });
    },
  });
}

export const translateLocaleCommand = createTranslateLocaleCommand();
