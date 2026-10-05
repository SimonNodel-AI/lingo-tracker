import type { BundleTypeOutcome, LingoTrackerConfig } from '@simoncodes-ca/core';
import type { TokenCasing } from '@simoncodes-ca/domain';
import { generateBundles } from '@simoncodes-ca/core';
import { printCliError } from '../runner/cli-error-wording';
import { CommandOutput } from '../runner/command-output';
import { type Answers, type CommandResult, defineCommand } from '../runner/command-runner';
import { exitForRunOutcome } from '../runner/run-outcome';
import { ConsoleFormatter, parseListSelection, parseNameSelection, selectionNames, selectionPrompt } from '../utils';

export interface BundleOptions {
  name?: string[];
  locale?: string[];
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
      selectionPrompt({
        mode: 'single',
        name: 'bundleOrAll',
        message: 'Select bundle to generate',
        choices: bundleKeys,
        allTitle: 'All bundles',
      }),
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

  // An empty bundle flag falls back to the single-name prompt answer.
  const selectedNames = selectionNames(
    parseListSelection(options.name) ?? parseNameSelection(undefined, options.bundleOrAll),
  );

  // Parse locale filter if provided
  const localeFilter = selectionNames(parseListSelection(options.locale));

  const debugKeysLocale = options.debugKeys === true ? DEFAULT_DEBUG_KEYS_LOCALE : options.debugKeys || undefined;

  let warningsCount = 0;
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
          CommandOutput.log('');
          ConsoleFormatter.progress(`Generating bundle: ${event.name}`);
          if (options.verbose && localeFilter) ConsoleFormatter.indent(`Locales: ${localeFilter.join(', ')}`);
        }
        return;
      }
      const { outcome } = event;
      if (outcome.configWarning) CommandOutput.warn(outcome.configWarning);
      if (outcome.error !== undefined) {
        printCliError(outcome.error, { fallbackMessage: 'Failed to generate bundle' });
        return;
      }
      const result = outcome.result;
      if (!options.quiet) {
        ConsoleFormatter.indent(`✅ Files generated: ${result.filesGenerated}`);
        ConsoleFormatter.indent(`✅ Locales: ${result.localesProcessed.join(', ')}`);
      }
      printTypeOutcome(result.typeOutcome, options.quiet ?? false);
      const warnings = result.warnings;
      warningsCount += warnings.length;
      if (warnings.length > 0) {
        ConsoleFormatter.warning(
          `Warnings: ${warnings.length}`,
          options.verbose ? warnings.map((warning) => `- ${warning}`) : [],
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
    if (warningsCount > 0) {
      ConsoleFormatter.keyValue('Total warnings', warningsCount);
      if (!options.verbose) ConsoleFormatter.indent('Run with --verbose to see warning details');
    }
    const failures = runResult.outcomes.filter((outcome) => outcome.error !== undefined).length;
    if (failures > 0) ConsoleFormatter.warning(`${failures} bundle(s) failed to generate`);
  }

  return exitForRunOutcome(runResult.outcome);
}

/** Tree lines and error framing belong to the command, not the core warning contract. */
function printTypeOutcome(outcome: BundleTypeOutcome, quiet: boolean): void {
  switch (outcome.status) {
    case 'failed':
      ConsoleFormatter.error(`Type generation failed: ${outcome.reason}`);
      return;
    case 'written':
      if (!quiet) ConsoleFormatter.indent(`└─ Types: ${outcome.path} (${outcome.keysCount} keys)`);
      return;
    case 'skipped':
      if (!quiet) ConsoleFormatter.indent('└─ Types: Skipped (bundle is empty)');
      return;
    case 'not-configured':
      if (!quiet) ConsoleFormatter.indent('└─ Types: Skipped (no typeDistFile configured)');
      return;
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unknown bundle type outcome: ${unhandled}`);
    }
  }
}
