/**
 * Bundle generation: writes a bundle's JSON file per locale (and the debug-keys file and the type
 * file when asked) from the Bundle Selection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { bundleOutputFile, hasTypeDistConfigured, type TokenCasing } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import type { RunOutcome } from '../run-outcome';
import { type BundleSelection, selectBundleEntries, selectionValues } from './bundle-selection';
import { buildHierarchy } from './hierarchy-builder';
import { type PreparedBundleRun, prepareBundleRun, selectPreparedBundleLocale } from './prepare-bundle-run';
import { COLLECTION_BASE_LOCALE, type CollectionReadCache } from './resource-loader';
import {
  type GenerateBundleTypesParams,
  type GenerateTypesResult,
  generateBundleTypes,
} from './type-generation/generate-types';

export interface GenerateBundleParams {
  readonly bundleKey: string;
  readonly config: LingoTrackerConfig;
  readonly locales?: readonly string[];
  /** CLI-level override for token casing. Takes precedence over all config values. */
  readonly tokenCasing?: TokenCasing;
  /**
   * CLI-level override for the generated TypeScript constant name.
   * Takes precedence over `bundleDefinition.tokenConstantName`.
   * Must be a valid JavaScript identifier.
   */
  readonly tokenConstantName?: string;
  /**
   * CLI-level override for ICU to Transloco transformation.
   * Takes precedence over bundle config and global config.
   */
  readonly transformICUToTransloco?: boolean;
  /**
   * When set, emits an additional bundle file where every value equals its own
   * dot-delimited key. The value is the locale code used in the output filename
   * (e.g. `"99"` produces `main.99.json`). ICU transformation is intentionally
   * skipped for this bundle — the keys themselves have no ICU content.
   */
  readonly debugKeysLocale?: string;
  /**
   * Called at the start of each locale iteration (the debug-keys locale, when
   * requested, is included in `total` and emitted last).
   */
  readonly onProgress?: (event: BundleProgressEvent) => void;
  /**
   * The project directory (holding `.lingo-tracker.json`): translations folders, `dist` and
   * `typeDistFile` resolve against it. Default: `process.cwd()`.
   */
  readonly cwd?: string;
}

export interface BundleProgressEvent {
  /** Locale about to be processed (the debug-keys locale code for the debug file). */
  readonly locale: string;
  /** 1-based position of this locale in the run. */
  readonly index: number;
  /** Total number of files this run will attempt, including the debug-keys file. */
  readonly total: number;
  /** Output path of the file about to be written. */
  readonly file: string;
}

export interface GenerateBundleResult {
  readonly outcome: RunOutcome;
  readonly bundleKey: string;
  readonly filesGenerated: number;
  /** Every successfully written file, in write order, relative to `cwd` with `/` separators. An output outside `cwd` begins with `../`. */
  readonly writtenFiles: string[];
  /** Generation warnings in encounter order, followed by the prepared type warning. */
  readonly warnings: readonly string[];
  readonly localesProcessed: string[];
  /** Number of keys written per processed locale (empty locales are omitted). */
  readonly keysPerLocale: Record<string, number>;
  readonly typeOutcome: BundleTypeOutcome;
}

export type BundleTypeOutcome =
  | { readonly status: 'written'; readonly path: string; readonly keysCount: number }
  | { readonly status: 'skipped'; readonly reason: 'empty-bundle' }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'not-configured' };

/** Returns the outcome detail without status words, bundle key or output framing. */
export function bundleTypeOutcomeDetail(outcome: BundleTypeOutcome): string {
  switch (outcome.status) {
    case 'written':
      return `${outcome.path} (${outcome.keysCount} keys)`;
    case 'skipped': {
      const { reason } = outcome;
      switch (reason) {
        case 'empty-bundle':
          return 'bundle is empty';
        default: {
          const unhandledReason: never = reason;
          throw new Error(`Unknown bundle type skip reason: ${unhandledReason}`);
        }
      }
    }
    case 'not-configured':
      return 'no typeDistFile configured';
    case 'failed':
      return outcome.reason;
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unknown bundle type outcome: ${unhandled}`);
    }
  }
}

/** Presentation-free warning for a failed or skipped type result; successful results have none. */
export function describeTypeOutcome(bundleKey: string, outcome: BundleTypeOutcome): string | undefined {
  switch (outcome.status) {
    case 'failed':
    case 'skipped':
      return `Type generation ${outcome.status} for '${bundleKey}': ${bundleTypeOutcomeDetail(outcome)}`;
    case 'written':
    case 'not-configured':
      return undefined;
    default: {
      const unhandled: never = outcome;
      throw new Error(`Unknown bundle type outcome: ${unhandled}`);
    }
  }
}

/**
 * Generates a bundle's files: one JSON file per locale (a locale with no entries is skipped with a
 * warning), the debug-keys file when `debugKeysLocale` is set, and the type file when the
 * definition configures one. Collections the config lacks, unreadable folders, ICU values that do
 * not carry to Transloco are reported in `warnings`, followed by the prepared type warning.
 * Type generation has a separate structured outcome; `describeTypeOutcome` supplies its warning.
 */
export async function generateBundle(params: GenerateBundleParams): Promise<GenerateBundleResult> {
  const prepared = prepareBundleRun({ ...params, source: 'saved' });
  const { debugKeysLocale, onProgress } = params;
  return generatePreparedBundle(prepared, { debugKeysLocale, onProgress });
}

/** The job service and run coordinator use an already prepared run. */
export async function generatePreparedBundle(
  prepared: PreparedBundleRun,
  options: Pick<GenerateBundleParams, 'debugKeysLocale' | 'onProgress'> = {},
): Promise<GenerateBundleResult> {
  const { bundleKey, cwd } = prepared;
  const { debugKeysLocale, onProgress } = options;
  const bundleDefinition = prepared.definition;
  const { tokenCasing } = prepared.settings;
  const warnings = [...prepared.collections.warnings];
  const cache: CollectionReadCache = new Map();
  const selectBase = (): BundleSelection => {
    const selection = selectBundleEntries(prepared.collections.collections, COLLECTION_BASE_LOCALE, {
      transformICUToTransloco: false,
      cache,
    });
    warnings.push(...selection.warnings);
    return selection;
  };
  // Every collection's base keys, so a collection with its own base locale is not left out.
  let baseKeys: string[] | undefined;
  const selectBaseKeys = (): string[] => {
    baseKeys ??= Array.from(selectBase().entries.keys());
    return baseKeys;
  };

  const localesProcessed: string[] = [];
  const writtenFiles: string[] = [];
  const keysPerLocale: Record<string, number> = {};

  const write = (locale: string, data: Record<string, string>): void => {
    const outputFile = bundleOutputFile(bundleDefinition, locale);
    writeBundleFile(path.resolve(cwd, outputFile), buildHierarchy(data));
    writtenFiles.push(toProjectRelative(outputFile, cwd));
    localesProcessed.push(locale);
    keysPerLocale[locale] = Object.keys(data).length;
  };

  const targetLocales = prepared.locales;
  const total = targetLocales.length + (debugKeysLocale ? 1 : 0);
  const progress = (locale: string, index: number): void =>
    onProgress?.({ locale, index, total, file: bundleOutputFile(bundleDefinition, locale) });

  targetLocales.forEach((locale, index) => {
    progress(locale, index + 1);
    const selection = selectPreparedBundleLocale(prepared, locale, cache);
    warnings.push(...selection.warnings);
    if (selection.entries.size === 0) {
      return;
    }
    write(locale, selectionValues(selection));
  });

  if (debugKeysLocale) {
    progress(debugKeysLocale, total);
    const keys = selectBaseKeys();
    if (keys.length === 0) {
      warnings.push(`Bundle '${bundleKey}' debug bundle is empty`);
    } else {
      write(debugKeysLocale, Object.fromEntries(keys.map((key) => [key, key])));
    }
  }

  const typeOutcome = hasTypeDistConfigured(bundleDefinition)
    ? generateTypes(
        {
          bundleKey,
          definition: prepared.definition,
          tokenCasing,
          tokenConstantName: prepared.tokenConstantNameOverride,
          warning: prepared.typeWarning,
          cwd,
        },
        selectBaseKeys,
      )
    : { status: 'not-configured' as const };

  if (typeOutcome.status === 'written') writtenFiles.push(typeOutcome.path);

  if (prepared.typeWarning) warnings.push(prepared.typeWarning);

  return {
    outcome: typeOutcome.status === 'failed' ? 'failed' : 'succeeded',
    bundleKey,
    filesGenerated: localesProcessed.length,
    writtenFiles,
    warnings,
    localesProcessed,
    keysPerLocale,
    typeOutcome,
  };
}

/**
 * The keys are selected inside the `try`, so a failed read is reported like a failed write.
 */
function generateTypes(
  params: Omit<GenerateBundleTypesParams, 'keys'>,
  selectKeys: () => readonly string[],
): BundleTypeOutcome {
  try {
    const result = generateBundleTypes({ ...params, keys: selectKeys() });
    return typeOutcomeFromResult(result, params.cwd ?? process.cwd());
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}

function typeOutcomeFromResult(result: GenerateTypesResult, cwd: string): BundleTypeOutcome {
  if (result.fileGenerated && result.typeDistFile) {
    return {
      status: 'written',
      path: toProjectRelative(result.typeDistFile, cwd),
      keysCount: result.keysCount,
    };
  }
  if (result.errorReason) return { status: 'failed', reason: result.errorReason };
  if (result.skippedReason === 'empty-bundle') return { status: 'skipped', reason: 'empty-bundle' };
  return { status: 'not-configured' };
}

function toProjectRelative(filePath: string, cwd: string): string {
  const relative = path.relative(cwd, path.resolve(cwd, filePath));
  return relative.split(path.sep).join('/');
}

/**
 * Writes bundle data to file
 */
function writeBundleFile(outputPath: string, data: Record<string, unknown>): void {
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonContent = JSON.stringify(data, null, 2);
  fs.writeFileSync(outputPath, jsonContent, 'utf8');
}
