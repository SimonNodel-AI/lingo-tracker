/**
 * Bundle generation: writes a bundle's JSON file per locale (and the debug-keys file and the type
 * file when asked) from the Bundle Selection.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type BundleDefinition,
  bundleOutputFile,
  hasTypeDistConfigured,
  type TokenCasing,
} from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  type BundleSelection,
  resolveBundleCollections,
  selectBundleEntries,
  selectionValues,
} from './bundle-selection';
import { buildHierarchy } from './hierarchy-builder';
import { type BundleLocale, COLLECTION_BASE_LOCALE, type CollectionReadCache } from './resource-loader';
import {
  type GenerateBundleTypesParams,
  type GenerateTypesResult,
  generateBundleTypes,
} from './type-generation/generate-types';

export interface GenerateBundleParams {
  readonly bundleKey: string;
  readonly bundleDefinition: BundleDefinition;
  readonly config: LingoTrackerConfig;
  readonly locales?: string[];
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
  readonly warnings: string[];
  readonly localesProcessed: string[];
  /** Number of keys written per processed locale (empty locales are omitted). */
  readonly keysPerLocale: Record<string, number>;
  readonly typeGenerationResult?: GenerateTypesResult;
}

/**
 * Generates a bundle's files: one JSON file per locale (a locale with no entries is skipped with a
 * warning), the debug-keys file when `debugKeysLocale` is set, and the type file when the
 * definition configures one. Collections the config lacks, unreadable folders, ICU values that do
 * not carry to Transloco, and type generation failures are reported in `warnings`.
 */
export async function generateBundle(params: GenerateBundleParams): Promise<GenerateBundleResult> {
  const { bundleKey, bundleDefinition, config, debugKeysLocale, onProgress } = params;
  const cwd = params.cwd ?? process.cwd();

  // CLI override → bundle config → global config → default
  const tokenCasing: TokenCasing =
    params.tokenCasing ?? bundleDefinition.tokenCasing ?? config.tokenCasing ?? 'upperCase';
  const transformICUToTransloco: boolean =
    params.transformICUToTransloco ??
    bundleDefinition.transformICUToTransloco ??
    config.transformICUToTransloco ??
    true;

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
  const keysPerLocale: Record<string, number> = {};

  const write = (locale: string, data: Record<string, string>): void => {
    writeBundleFile(path.resolve(cwd, bundleOutputFile(bundleDefinition, locale)), buildHierarchy(data));
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

  const typeGenerationResult = hasTypeDistConfigured(bundleDefinition)
    ? generateTypes(
        { bundleKey, definition: bundleDefinition, tokenCasing, tokenConstantName: params.tokenConstantName, cwd },
        selectBaseKeys,
        warnings,
      )
    : undefined;

  return {
    bundleKey,
    filesGenerated: localesProcessed.length,
    warnings,
    localesProcessed,
    keysPerLocale,
    typeGenerationResult,
  };
}

/**
 * Runs type generation, reporting a skipped (empty) or failed run in `warnings`. The keys are selected
 * inside the `try`, so a failed read is reported the same way as a failed write.
 */
function generateTypes(
  params: Omit<GenerateBundleTypesParams, 'keys'>,
  selectKeys: () => readonly string[],
  warnings: string[],
): GenerateTypesResult | undefined {
  try {
    const result = generateBundleTypes({ ...params, keys: selectKeys() });
    if (result.skippedReason === 'empty-bundle') {
      warnings.push(`Type generation skipped for '${params.bundleKey}': Bundle is empty`);
    }
    return result;
  } catch (error) {
    warnings.push(
      `Type generation failed for '${params.bundleKey}': ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
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
