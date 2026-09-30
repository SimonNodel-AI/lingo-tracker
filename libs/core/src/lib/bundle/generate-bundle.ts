/**
 * Bundle generation: writes a bundle's JSON file per locale (and the debug-keys file and the type
 * file when asked) from the Bundle Selection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type BundleDefinition,
  bundleOutputFile,
  findBundleDefinition,
  hasTypeDistConfigured,
  type TokenCasing,
} from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { BundleNotFoundError, InvalidBundleLocalesError } from '../errors';
import {
  type BundleSelection,
  resolveBundleCollections,
  selectBundleEntries,
  selectionValues,
} from './bundle-selection';
import { buildHierarchy } from './hierarchy-builder';
import { resolveBundleSettings } from './resolve-bundle-settings';
import { type BundleLocale, COLLECTION_BASE_LOCALE, type CollectionReadCache } from './resource-loader';
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
  readonly bundleKey: string;
  readonly filesGenerated: number;
  /** Every successfully written file, in write order, relative to `cwd` with `/` separators. An output outside `cwd` begins with `../`. */
  readonly writtenFiles: string[];
  readonly warnings: string[];
  readonly localesProcessed: string[];
  /** Number of keys written per processed locale (empty locales are omitted). */
  readonly keysPerLocale: Record<string, number>;
  readonly typeOutcome: BundleTypeOutcome;
}

export type BundleTypeOutcome =
  | { readonly status: 'written'; readonly path: string; readonly keysCount: number; readonly warning?: string }
  | { readonly status: 'skipped'; readonly reason: string; readonly warning?: string }
  | { readonly status: 'failed'; readonly reason: string; readonly warning?: string }
  | { readonly status: 'not-configured'; readonly warning?: string };

/** Checks a saved bundle request before a job is queued or any output is written. */
export function validateGenerateBundleRequest(
  params: Pick<GenerateBundleParams, 'bundleKey' | 'config' | 'locales'>,
): BundleDefinition {
  const definition = findBundleDefinition(params.config.bundles, params.bundleKey);
  if (!definition) throw new BundleNotFoundError(params.bundleKey);

  validateBundleLocales(params.locales, params.config);
  return definition;
}

/** Validates an optional project locale subset, including malformed API bodies. */
export function validateBundleLocales(locales: readonly string[] | undefined, config: LingoTrackerConfig): void {
  if (locales !== undefined) {
    if (!Array.isArray(locales) || locales.some((locale) => typeof locale !== 'string')) {
      throw new InvalidBundleLocalesError('locales must be an array of strings');
    }
    const unknown = locales.filter((locale) => !config.locales.includes(locale));
    if (unknown.length > 0) {
      throw new InvalidBundleLocalesError(
        `Unknown locale${unknown.length > 1 ? 's' : ''} ${unknown.map((locale) => `"${locale}"`).join(', ')}: must be defined in the project locales`,
      );
    }
  }
}

/**
 * Generates a bundle's files: one JSON file per locale (a locale with no entries is skipped with a
 * warning), the debug-keys file when `debugKeysLocale` is set, and the type file when the
 * definition configures one. Collections the config lacks, unreadable folders, ICU values that do
 * not carry to Transloco are reported in `warnings`; type generation has its own outcome.
 */
export async function generateBundle(params: GenerateBundleParams): Promise<GenerateBundleResult> {
  const bundleDefinition = validateGenerateBundleRequest(params);
  return generateValidatedBundle(params, bundleDefinition);
}

/** The run coordinator uses an already validated definition. */
export async function generateValidatedBundle(
  params: GenerateBundleParams,
  bundleDefinition: BundleDefinition,
): Promise<GenerateBundleResult> {
  const { bundleKey, config, debugKeysLocale, onProgress } = params;
  const cwd = params.cwd ?? process.cwd();

  const { tokenCasing, transformICUToTransloco } = resolveBundleSettings(config, bundleDefinition, params);

  const { collections, warnings: missing } = resolveBundleCollections(bundleDefinition, config, { cwd });
  const warnings = [...missing];
  const cache: CollectionReadCache = new Map();
  const select = (locale: BundleLocale, transform: boolean): BundleSelection => {
    const selection = selectBundleEntries(collections, locale, { transformICUToTransloco: transform, cache });
    warnings.push(...selection.warnings);
    return selection;
  };
  // Every collection's base keys, so a collection with its own base locale is not left out.
  let baseKeys: string[] | undefined;
  const selectBaseKeys = (): string[] => {
    baseKeys ??= Array.from(select(COLLECTION_BASE_LOCALE, false).entries.keys());
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

  const targetLocales = params.locales ?? config.locales;
  const total = targetLocales.length + (debugKeysLocale ? 1 : 0);
  const progress = (locale: string, index: number): void =>
    onProgress?.({ locale, index, total, file: bundleOutputFile(bundleDefinition, locale) });

  targetLocales.forEach((locale, index) => {
    progress(locale, index + 1);
    const selection = select(locale, transformICUToTransloco);
    if (selection.entries.size === 0) {
      warnings.push(`Bundle '${bundleKey}' for locale '${locale}' is empty`);
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
        { bundleKey, definition: bundleDefinition, tokenCasing, tokenConstantName: params.tokenConstantName, cwd },
        selectBaseKeys,
      )
    : { status: 'not-configured' as const };

  if (typeOutcome.status === 'written') writtenFiles.push(typeOutcome.path);

  return {
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
      warning: result.warning,
    };
  }
  if (result.errorReason) return { status: 'failed', reason: result.errorReason, warning: result.warning };
  if (result.skippedReason === 'empty-bundle')
    return { status: 'skipped', reason: 'bundle has no keys', warning: result.warning };
  return { status: 'not-configured', warning: result.warning };
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
