import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import type { TokenCasing } from '@simoncodes-ca/domain';
import {
  BundleNotFoundError,
  type BundleTypeOutcome,
  bundleTypeOutcomeDetail,
  generateBundles,
} from '@simoncodes-ca/core';
import { type Answers, type CommandResult, defineCommand } from '../runner/command-runner';
import { exitForRunOutcome } from '../runner/run-outcome';
import { ALL_ITEMS_SENTINEL, parseCommaSeparatedList, ConsoleFormatter } from '../utils';

export interface BundleOptions {
  name?: string;
  locale?: string;
  quiet?: boolean;
  verbose?: boolean;
  /** CLI-level override for token casing. Takes precedence over all config file values. */
  tokenCasing?: TokenCasing;
  /**
   * CLI-level override for the generated TypeScript constant name.
   * Takes precedence over `tokenConstantName` in the bundle config.
   * Only valid when a single bundle is targeted.
   */
  tokenConstantName?: string;
  /** CLI-level override for ICU to Transloco transformation. */
  transformICUToTransloco?: boolean;
  /**
   * When set, also emits a debug bundle where every value equals its own dot-delimited key.
   * `true` means flag was present without a value — default locale `99` is used.
   * A string value is used as the locale code directly.
   */
  debugKeys?: string | boolean;
}

const DEFAULT_DEBUG_KEYS_LOCALE = '99';

export const bundleCommand = defineCommand<BundleOptions>()({
  name: 'Bundle generation',
  collection: 'none',
  // Interactive without --name: pick one bundle or all. Non-interactive without --name: all bundles.
  prompts: (options, { config }) => {
    const bundleKeys = Object.keys(config.bundles ?? {});
    if (options.name || bundleKeys.length === 0) {
      return [];
    }
    return [
      {
        type: 'select',
        name: 'bundleOrAll',
        message: 'Select bundle to generate',
        choices: [
          ...bundleKeys.map((key) => ({ title: key, value: key })),
          { title: 'All bundles', value: ALL_ITEMS_SENTINEL },
        ],
      },
    ];
  },
  run: ({ config, cwd, answers }) => run(config, cwd, answers),
});

async function run(config: LingoTrackerConfig, cwd: string, options: Answers<BundleOptions>): Promise<CommandResult> {
  // Check if bundles are configured
  if (!config.bundles || Object.keys(config.bundles).length === 0) {
    ConsoleFormatter.error('No bundles configured in .lingo-tracker.json', [
      'Add a "bundles" section to your configuration file.',
    ]);
    return { exitCode: 1 };
  }

  const picked = typeof options.bundleOrAll === 'string' ? options.bundleOrAll : undefined;
  const names = options.name ? parseCommaSeparatedList(options.name) : undefined;
  const selectedNames =
    names && names.length > 0 ? names : picked && picked !== ALL_ITEMS_SENTINEL ? [picked] : undefined;

  // Parse locale filter if provided
  const locales = parseCommaSeparatedList(options.locale);
  const localeFilter = locales && locales.length > 0 ? locales : undefined;

  const debugKeysLocale = options.debugKeys === true ? DEFAULT_DEBUG_KEYS_LOCALE : options.debugKeys || undefined;

  const runResult = await generateBundles(config, {
    names: selectedNames,
    locales: localeFilter,
    overrides: {
      tokenCasing: options.tokenCasing,
      tokenConstantName: options.tokenConstantName,
      transformICUToTransloco: options.transformICUToTransloco,
      debugKeysLocale,
    },
    cwd,
    onEvent: (event) => {
      if (event.kind === 'start') {
        if (!options.quiet) {
          console.log('');
          ConsoleFormatter.progress(`Generating bundle: ${event.name}`);
          if (options.verbose && localeFilter) ConsoleFormatter.indent(`Locales: ${localeFilter.join(', ')}`);
        }
        return;
      }
      if (event.kind === 'type-warning') {
        console.warn(event.warning);
        return;
      }
      const { outcome } = event;
      if (outcome.error !== undefined) {
        const errorMessage =
          outcome.error instanceof BundleNotFoundError
            ? `Bundle "${outcome.name}" not found.`
            : outcome.error instanceof Error
              ? outcome.error.message
              : 'Failed to generate bundle';
        ConsoleFormatter.error(errorMessage);
        return;
      }
      const result = outcome.result;
      if (!options.quiet) {
        ConsoleFormatter.indent(`✅ Files generated: ${result.filesGenerated}`);
        ConsoleFormatter.indent(`✅ Locales: ${result.localesProcessed.join(', ')}`);
      }
      printTypeOutcome(result.typeOutcome, options.quiet ?? false);
      if (result.warnings.length > 0) {
        ConsoleFormatter.warning(
          `Warnings: ${result.warnings.length}`,
          options.verbose ? result.warnings.map((warning) => `- ${warning}`) : [],
        );
      }
    },
  });

  if (runResult.outcomes.length > 1) {
    const { totals } = runResult;
    if (!options.quiet) {
      ConsoleFormatter.section(`Summary (${totals.bundlesProcessed} bundles)`);
      ConsoleFormatter.keyValue('Total files generated', totals.filesGenerated);
    }
    if (totals.warningsCount > 0) {
      ConsoleFormatter.keyValue('Total warnings', totals.warningsCount);
      if (!options.verbose) ConsoleFormatter.indent('Run with --verbose to see warning details');
    }
    const failures = runResult.outcomes.filter((outcome) => outcome.error !== undefined).length;
    if (failures > 0) ConsoleFormatter.warning(`${failures} bundle(s) failed to generate`);
  }

  return exitForRunOutcome(runResult.outcome);
}

function printTypeOutcome(outcome: BundleTypeOutcome, quiet: boolean): void {
  const detail = bundleTypeOutcomeDetail(outcome);
  if (outcome.status === 'failed') {
    ConsoleFormatter.error(`Type generation failed: ${detail}`);
    return;
  }
  if (!quiet) {
    const line = outcome.status === 'written' ? `└─ Types: ${detail}` : `└─ Types: Skipped (${detail})`;
    ConsoleFormatter.indent(line);
  }
}
