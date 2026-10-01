import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { MultipleBundleConstantNameError } from '../errors';
import { type GenerateBundleParams, type GenerateBundleResult, generatePreparedBundle } from './generate-bundle';
import { type PreparedBundleRun, prepareBundleRun } from './prepare-bundle-run';

export interface GenerateBundlesOptions {
  readonly names?: readonly string[];
  readonly locales?: readonly string[];
  readonly overrides?: Pick<
    GenerateBundleParams,
    'tokenCasing' | 'tokenConstantName' | 'transformICUToTransloco' | 'debugKeysLocale'
  >;
  readonly cwd?: string;
  /** Called after validation and before writing, then after each attempt. */
  readonly onEvent?: (
    event:
      | { kind: 'start'; name: string }
      | { kind: 'type-warning'; warning: string }
      | { kind: 'result'; outcome: BundleRunOutcome },
  ) => void;
}

export type BundleRunOutcome =
  | { readonly name: string; readonly result: GenerateBundleResult; readonly error?: never }
  | { readonly name: string; readonly error: unknown; readonly result?: never };

export interface GenerateBundlesResult {
  readonly outcomes: BundleRunOutcome[];
  readonly totals: { bundlesProcessed: number; filesGenerated: number; warningsCount: number };
}

/** Runs every selected saved bundle, continuing after an individual failure. */
export async function generateBundles(
  config: LingoTrackerConfig,
  { names, locales, overrides, cwd, onEvent }: GenerateBundlesOptions,
): Promise<GenerateBundlesResult> {
  const selected = names ?? Object.keys(config.bundles ?? {});
  if (overrides?.tokenConstantName && selected.length > 1) throw new MultipleBundleConstantNameError();

  const outcomes: BundleRunOutcome[] = [];
  const totals = { bundlesProcessed: 0, filesGenerated: 0, warningsCount: 0 };
  for (const name of selected) {
    let outcome: BundleRunOutcome;
    let prepared: PreparedBundleRun;
    try {
      prepared = prepareBundleRun({ source: 'saved', bundleKey: name, config, locales, cwd, ...overrides });
    } catch (error) {
      outcome = { name, error };
      outcomes.push(outcome);
      onEvent?.({ kind: 'result', outcome });
      continue;
    }
    onEvent?.({ kind: 'start', name });
    try {
      const result = await generatePreparedBundle(prepared, { debugKeysLocale: overrides?.debugKeysLocale });
      outcome = { name, result };
      totals.bundlesProcessed++;
      totals.filesGenerated += result.filesGenerated;
      totals.warningsCount += result.warnings.length;
    } catch (error) {
      outcome = { name, error };
    }
    const typeWarning = outcome.result?.typeOutcome.warning ?? prepared.typeWarning;
    if (typeWarning) onEvent?.({ kind: 'type-warning', warning: typeWarning });
    outcomes.push(outcome);
    onEvent?.({ kind: 'result', outcome });
  }
  return { outcomes, totals };
}
