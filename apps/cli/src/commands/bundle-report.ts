import { bundleFindings, type GenerateBundlesOptions, type GenerateBundlesResult } from '@simoncodes-ca/core';
import { printCliError } from '../runner/cli-error-wording';
import { CommandOutput } from '../runner/command-output';
import { flagName } from '../runner/flag-record';
import { ConsoleFormatter } from '../utils/console-formatter';
import { BUNDLE_FLAGS } from './bundle-flags';

interface BundlePresentationOptions {
  readonly quiet?: boolean;
  readonly verbose?: boolean;
  readonly localeFilter?: readonly string[];
}

type BundleEvent = Parameters<NonNullable<GenerateBundlesOptions['onEvent']>>[0];

/** Bundle's event presentation preserves its established streams, including quiet and verbose modes. */
export function printBundleEvent(event: BundleEvent, options: BundlePresentationOptions): void {
  if (event.kind === 'start') {
    if (!options.quiet) {
      CommandOutput.log('');
      ConsoleFormatter.progress(`Generating bundle: ${event.name}`);
      if (options.verbose && options.localeFilter)
        ConsoleFormatter.indent(`Locales: ${options.localeFilter.join(', ')}`);
    }
    return;
  }
  const { outcome } = event;
  const findings = bundleFindings(outcome.result ? outcome.result : { warnings: outcome.warnings });
  for (const message of findings.byOrigin.config) CommandOutput.warn(message);
  if ('warnings' in outcome) {
    printCliError(outcome.error, { fallbackMessage: 'Failed to generate bundle' });
    return;
  }
  const result = outcome.result;
  if (!options.quiet) {
    ConsoleFormatter.indent(`✅ Files generated: ${result.filesGenerated}`);
    ConsoleFormatter.indent(`✅ Locales: ${result.localesProcessed.join(', ')}`);
  }
  const { types } = findings;
  if (types.failure !== undefined) {
    ConsoleFormatter.error(`Type generation failed: ${types.failure}`);
  } else if (!options.quiet) {
    if (types.written) {
      ConsoleFormatter.indent(`└─ Types: ${types.written.path} (${types.written.keysCount} keys)`);
    } else if (types.skipped !== undefined) {
      ConsoleFormatter.indent(`└─ Types: Skipped (${types.skipped})`);
    }
  }
  // Type warnings are represented by the type tree/failure above. Only generation
  // findings belong in the legacy warning count and verbose detail list.
  const warnings = findings.byOrigin.generation;
  if (warnings.length > 0)
    ConsoleFormatter.warning(
      `Warnings: ${warnings.length}`,
      options.verbose ? warnings.map((warning) => `- ${warning}`) : [],
    );
}

/** Derive legacy summary totals from completed outcomes; configuration/type diagnostics stay separate. */
export function printBundleSummary(run: GenerateBundlesResult, options: BundlePresentationOptions): void {
  if (run.outcomes.length <= 1) return;
  if (!options.quiet) {
    ConsoleFormatter.section(`Summary (${run.totals.bundlesProcessed} bundles)`);
    ConsoleFormatter.keyValue('Total files generated', run.totals.filesGenerated);
  }
  const warnings = run.outcomes.flatMap((item) => (item.result ? bundleFindings(item.result).byOrigin.generation : []));
  if (warnings.length > 0) {
    ConsoleFormatter.keyValue('Total warnings', warnings.length);
    if (!options.verbose) ConsoleFormatter.indent(`Run with ${flagName(BUNDLE_FLAGS.verbose)} to see warning details`);
  }
  const failures = run.outcomes.filter((item) => 'error' in item).length;
  if (failures > 0) ConsoleFormatter.warning(`${failures} bundle(s) failed to generate`);
}
