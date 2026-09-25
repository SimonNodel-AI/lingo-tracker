import { type Collection, translateLocale } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
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
  // Called in both modes before `required` is checked, so a collection that cannot be
  // translated is reported as such rather than as a missing --locale.
  prompts: (options, { collection }) => {
    assertTranslatable(collection);
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
    const { name: collectionName, baseLocale, locales: allLocales } = collection;
    const targetLocale = answers.locale;

    if (targetLocale === baseLocale) {
      throw new Error(`Cannot translate to the base locale "${baseLocale}".`);
    }

    if (!allLocales.includes(targetLocale)) {
      throw new Error(`Locale "${targetLocale}" is not configured. Available locales: ${allLocales.join(', ')}`);
    }

    console.log('');
    ConsoleFormatter.progress(`Translating locale '${targetLocale}' in collection '${collectionName}'...`);

    let result: Awaited<ReturnType<typeof translateLocale>>;
    try {
      result = await translateLocale(collection, {
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
    } catch (error) {
      throw new Error(`Translation failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    console.log('');
    ConsoleFormatter.success(`Translated locale '${targetLocale}' in collection '${collectionName}'`);
    ConsoleFormatter.keyValue('Translated', result.translatedCount);
    ConsoleFormatter.keyValue('Skipped (needs human translation)', result.skippedCount);
    ConsoleFormatter.keyValue('Failed', result.failedCount);

    if (result.warnings.length > 0) {
      console.log('');
      for (const warning of result.warnings) {
        ConsoleFormatter.warning(warning);
      }
    }

    if (result.failures.length > 0) {
      console.log('');
      ConsoleFormatter.section('Failures');
      for (const failure of result.failures) {
        ConsoleFormatter.indent(`${failure.key}: ${failure.error}`);
      }
    }

    return result.failedCount > 0 ? { exitCode: 1 } : undefined;
  },
});

/** Auto-translation must be enabled, and there must be a locale other than the base locale. */
function assertTranslatable(collection: Collection): void {
  if (!collection.translationConfig?.enabled) {
    throw new Error(
      `Auto-translation is not enabled for collection "${collection.name}". ` +
        `Set translation.enabled = true in your configuration.`,
    );
  }
  if (collection.targetLocales.length === 0) {
    throw new Error(`No target locales configured. Add locales other than the base locale "${collection.baseLocale}".`);
  }
}
