import {
  assertAutoTranslationEnabled,
  assertCanTranslateLocale,
  AutoTranslationDisabledError,
  translateLocale,
} from '@simoncodes-ca/core';
import { CommandOutput } from '../runner/command-output';
import { defineCommand } from '../runner/command-runner';
import { exitForRunOutcome } from '../runner/run-outcome';
import { ConsoleFormatter } from '../utils';

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
export const translateLocaleCommand = defineCommand<TranslateLocaleOptions>()({
  name: 'Translate locale',
  collection: 'writable',
  formatError: (error, duringRun) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AutoTranslationDisabledError) {
      return `${message}. Set translation.enabled = true in your configuration`;
    }
    return duringRun ? `Translation failed: ${message}` : undefined;
  },
  preflight: ({ options, collection }) => {
    assertAutoTranslationEnabled(collection);
    if (collection.targetLocales.length === 0) {
      throw new Error(
        `No target locales configured. Add locales other than the base locale "${collection.baseLocale}".`,
      );
    }
    if (options.locale) {
      assertCanTranslateLocale(collection, options.locale);
    }
  },
  prompts: (options, { collection }) => {
    return options.locale
      ? []
      : [
          {
            type: 'select',
            name: 'locale',
            message: 'Select target locale to translate',
            choices: collection.targetLocales.map((locale) => ({ title: locale, value: locale })),
          },
        ];
  },
  required: ['locale'],
  run: async ({ collection, answers }) => {
    const { name: collectionName } = collection;
    const targetLocale = answers.locale;

    CommandOutput.log('');
    ConsoleFormatter.progress(`Translating locale '${targetLocale}' in collection '${collectionName}'...`);

    const result = await translateLocale(collection, {
      targetLocale,
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

    if (result.warnings.length > 0) {
      CommandOutput.log('');
      for (const warning of result.warnings) {
        ConsoleFormatter.warning(warning);
      }
    }

    if (result.failures.length > 0) {
      CommandOutput.log('');
      ConsoleFormatter.section('Failures');
      for (const failure of result.failures) {
        ConsoleFormatter.indent(`${failure.key}: ${failure.error}`);
      }
    }

    return exitForRunOutcome(result.outcome);
  },
});
