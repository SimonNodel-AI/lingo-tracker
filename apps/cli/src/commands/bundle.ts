import type { LingoTrackerConfig } from '@simoncodes-ca/core';
import type { TokenCasing } from '@simoncodes-ca/domain';
import { generateBundle, hasTypeDistConfigured } from '@simoncodes-ca/core';
import { type Answers, type CommandResult, defineCommand } from '../runner/command-runner';
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

interface BundleGenerationResult {
  bundleKey: string;
  filesGenerated: number;
  warnings: string[];
  localesProcessed: string[];
  error?: string;
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
    ConsoleFormatter.error('No bundles configured in .lingo-tracker.json');
    ConsoleFormatter.indent('Add a "bundles" section to your configuration file.');
    return { exitCode: 1 };
  }

  const picked = typeof options.bundleOrAll === 'string' ? options.bundleOrAll : undefined;
  const names = options.name ? parseCommaSeparatedList(options.name) : undefined;
  const bundlesToProcess =
    names && names.length > 0
      ? names
      : picked && picked !== ALL_ITEMS_SENTINEL
        ? [picked]
        : Object.keys(config.bundles);

  // --token-constant-name is only valid for a single bundle
  if (options.tokenConstantName && bundlesToProcess.length > 1) {
    throw new Error('Cannot use --token-constant-name with multiple bundles. Please target a single bundle.');
  }

  // Parse locale filter if provided
  const locales = parseCommaSeparatedList(options.locale);
  const localeFilter = locales && locales.length > 0 ? locales : undefined;

  const debugKeysLocale = options.debugKeys === true ? DEFAULT_DEBUG_KEYS_LOCALE : options.debugKeys || undefined;

  // Process each bundle
  const bundleResults: BundleGenerationResult[] = [];

  for (const bundleKey of bundlesToProcess) {
    const bundleDefinition = config.bundles[bundleKey];

    if (!bundleDefinition) {
      ConsoleFormatter.error(`Bundle "${bundleKey}" not found.`);
      bundleResults.push({
        bundleKey,
        filesGenerated: 0,
        warnings: [],
        localesProcessed: [],
        error: `Bundle "${bundleKey}" not found in configuration`,
      });
      continue;
    }

    if (!options.quiet) {
      console.log('');
      ConsoleFormatter.progress(`Generating bundle: ${bundleKey}`);
    }
    if (!options.quiet && options.verbose && localeFilter) {
      ConsoleFormatter.indent(`Locales: ${localeFilter.join(', ')}`);
    }

    try {
      const result = await generateBundle({
        bundleKey,
        bundleDefinition,
        config,
        locales: localeFilter,
        tokenCasing: options.tokenCasing,
        tokenConstantName: options.tokenConstantName,
        transformICUToTransloco: options.transformICUToTransloco,
        debugKeysLocale,
        cwd,
      });

      bundleResults.push({
        bundleKey,
        filesGenerated: result.filesGenerated,
        warnings: result.warnings,
        localesProcessed: result.localesProcessed,
      });

      if (!options.quiet) {
        ConsoleFormatter.indent(`✅ Files generated: ${result.filesGenerated}`);
        ConsoleFormatter.indent(`✅ Locales: ${result.localesProcessed.join(', ')}`);
      }

      if (result.typeGenerationResult) {
        if (result.typeGenerationResult.fileGenerated) {
          if (!options.quiet) {
            ConsoleFormatter.indent(
              `└─ Types: ${result.typeGenerationResult.typeDistFile} (${result.typeGenerationResult.keysCount} keys)`,
            );
          }
        } else if (result.typeGenerationResult.errorReason) {
          ConsoleFormatter.indent(`└─ Types: Error (${result.typeGenerationResult.errorReason})`);
        } else if (result.typeGenerationResult.skippedReason) {
          if (!options.quiet) {
            const skippedReasonMessages: Record<string, string> = {
              'empty-bundle': 'bundle has no keys',
              'not-configured': 'no typeDistFile configured',
            };
            const skippedMessage =
              skippedReasonMessages[result.typeGenerationResult.skippedReason] ??
              result.typeGenerationResult.skippedReason;
            ConsoleFormatter.indent(`└─ Types: Skipped (${skippedMessage})`);
          }
        }
      } else if (hasTypeDistConfigured(bundleDefinition)) {
        // Should have result if configured, but just in case
        ConsoleFormatter.indent(`└─ Types: Failed (No result returned)`);
      } else if (!options.quiet) {
        ConsoleFormatter.indent(`└─ Types: Skipped (no typeDistFile configured)`);
      }

      if (result.warnings.length > 0) {
        ConsoleFormatter.indent(`⚠️  Warnings: ${result.warnings.length}`);
        if (options.verbose) {
          result.warnings.forEach((warning) => {
            ConsoleFormatter.indent(`   - ${warning}`, 2);
          });
        }
      }
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to generate bundle';
      bundleResults.push({
        bundleKey,
        filesGenerated: 0,
        warnings: [],
        localesProcessed: [],
        error: errorMessage,
      });

      ConsoleFormatter.indent(`❌ ${errorMessage}`);
    }
  }

  // Output results
  if (bundlesToProcess.length > 1) {
    // Show summary for multiple bundles
    const totals = bundleResults.reduce(
      (acc, result) => ({
        bundlesProcessed: acc.bundlesProcessed + (result.error ? 0 : 1),
        filesGenerated: acc.filesGenerated + result.filesGenerated,
        warningsCount: acc.warningsCount + result.warnings.length,
      }),
      {
        bundlesProcessed: 0,
        filesGenerated: 0,
        warningsCount: 0,
      },
    );

    if (!options.quiet) {
      ConsoleFormatter.section(`Summary (${totals.bundlesProcessed} bundles)`);
      ConsoleFormatter.keyValue('Total files generated', totals.filesGenerated);
    }

    if (totals.warningsCount > 0) {
      ConsoleFormatter.keyValue('Total warnings', totals.warningsCount);
      if (!options.verbose) {
        ConsoleFormatter.indent('Run with --verbose to see warning details');
      }
    }

    const errors = bundleResults.filter((r) => r.error);
    if (errors.length > 0) {
      if (!options.quiet) {
        console.log('');
      }
      ConsoleFormatter.warning(`${errors.length} bundle(s) failed to generate`);
    }
  }

  return bundleResults.some((r) => r.error) ? { exitCode: 1 } : undefined;
}
