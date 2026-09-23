/**
 * Core bundle generation logic
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { hasUnbundlableBranchBody, icuToTransloco, type TokenCasing, validateICUSyntax } from '@simoncodes-ca/domain';
import {
  type BundleDefinition,
  type CollectionBundleDefinition,
  type EntrySelectionRule,
  hasTypeDistConfigured,
} from '../../config/bundle-definition';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { type Collection, openCollection } from '../config/open-collection';
import { buildHierarchy } from './hierarchy-builder';
import { matchesPattern } from './pattern-matcher';
import {
  type BundleLocale,
  COLLECTION_BASE_LOCALE,
  type CollectionReadCache,
  type FlatResource,
  loadCollectionResources,
} from './resource-loader';
import { matchesTags } from './tag-filter';
import { type GenerateTypesResult, generateBundleTypes } from './type-generation/generate-types';

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
 * Optional trace collected while merging collections into a bundle.
 * Used by the dry-run planner to report key conflicts and winning origins.
 */
export interface BundleKeyTrace {
  /** Final (prefixed) keys that were defined by more than one resource. */
  readonly conflicts: Set<string>;
  /** Winning origin per final key. */
  readonly origins: Map<string, BundleKeyOrigin>;
}

export interface BundleKeyOrigin {
  readonly collectionName: string;
  readonly sourceKey: string;
}

/**
 * Generates translation bundle files for specified bundle configuration
 *
 * @param params - Bundle generation parameters
 * @returns Result with count of files generated and any warnings
 */
export async function generateBundle(params: GenerateBundleParams): Promise<GenerateBundleResult> {
  const {
    bundleKey,
    bundleDefinition,
    config,
    locales,
    tokenCasing: tokenCasingOverride,
    tokenConstantName,
    transformICUToTransloco: transformICUToTranslocoOverride,
    debugKeysLocale,
    onProgress,
  } = params;
  const warnings: string[] = [];
  const localesProcessed: string[] = [];
  const keysPerLocale: Record<string, number> = {};

  // Resolve token casing: CLI override → bundle config → global config → default
  const resolvedTokenCasing: TokenCasing =
    tokenCasingOverride ?? bundleDefinition.tokenCasing ?? config.tokenCasing ?? 'upperCase';

  // Resolve ICU transformation: CLI override → bundle config → global config → default (true)
  const resolvedTransformICUToTransloco: boolean =
    transformICUToTranslocoOverride ??
    bundleDefinition.transformICUToTransloco ??
    config.transformICUToTransloco ??
    true;

  const targetLocales = locales ?? config.locales;
  let filesGenerated = 0;
  const resourceCache: CollectionReadCache = new Map();
  const totalFiles = targetLocales.length + (debugKeysLocale ? 1 : 0);
  let progressIndex = 0;

  for (const locale of targetLocales) {
    progressIndex++;
    onProgress?.({
      locale,
      index: progressIndex,
      total: totalFiles,
      file: getBundleOutputPath(bundleDefinition, locale),
    });

    const bundleData = collectBundleData(
      bundleDefinition,
      config,
      locale,
      warnings,
      resolvedTransformICUToTransloco,
      resourceCache,
    );

    if (Object.keys(bundleData).length === 0) {
      warnings.push(`Bundle '${bundleKey}' for locale '${locale}' is empty`);
      continue;
    }

    const hierarchicalData = buildHierarchy(bundleData);

    const outputPath = getBundleOutputPath(bundleDefinition, locale);
    writeBundleFile(outputPath, hierarchicalData);

    filesGenerated++;
    localesProcessed.push(locale);
    keysPerLocale[locale] = Object.keys(bundleData).length;
  }

  if (debugKeysLocale) {
    progressIndex++;
    onProgress?.({
      locale: debugKeysLocale,
      index: progressIndex,
      total: totalFiles,
      file: getBundleOutputPath(bundleDefinition, debugKeysLocale),
    });

    // Every collection's base values, so a collection with its own base locale is not left out.
    const debugBaseData = collectBundleData(
      bundleDefinition,
      config,
      COLLECTION_BASE_LOCALE,
      warnings,
      false,
      resourceCache,
    );

    const debugData: Record<string, string> = {};
    for (const key of Object.keys(debugBaseData)) {
      debugData[key] = key;
    }

    if (Object.keys(debugData).length === 0) {
      warnings.push(`Bundle '${bundleKey}' debug bundle is empty`);
    } else {
      const hierarchicalData = buildHierarchy(debugData);
      const outputPath = getBundleOutputPath(bundleDefinition, debugKeysLocale);
      writeBundleFile(outputPath, hierarchicalData);
      filesGenerated++;
      localesProcessed.push(debugKeysLocale);
      keysPerLocale[debugKeysLocale] = Object.keys(debugData).length;
    }
  }

  // Generate types if configured
  let typeGenerationResult: GenerateTypesResult | undefined;
  if (hasTypeDistConfigured(bundleDefinition)) {
    try {
      typeGenerationResult = await generateBundleTypes(
        bundleKey,
        config,
        resolvedTokenCasing,
        tokenConstantName,
        bundleDefinition,
      );
      if (typeGenerationResult.fileGenerated) {
        // We don't increment filesGenerated here as it tracks bundle JSON files
        // But we could add a note to warnings or a new field if needed
      } else if (typeGenerationResult.skippedReason === 'empty-bundle') {
        warnings.push(`Type generation skipped for '${bundleKey}': Bundle is empty`);
      }
    } catch (error) {
      warnings.push(
        `Type generation failed for '${bundleKey}': ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    bundleKey,
    filesGenerated,
    warnings,
    localesProcessed,
    keysPerLocale,
    typeGenerationResult,
  };
}

/**
 * Collects all bundle data for a locale by processing collections.
 *
 * When a `trace` is supplied, key conflicts and the winning origin of each
 * final key are recorded so callers (e.g. the dry-run planner) can report them.
 */
export function collectBundleData(
  bundleDefinition: BundleDefinition,
  config: LingoTrackerConfig,
  locale: BundleLocale,
  warnings: string[],
  transformICUToTransloco: boolean,
  cache: CollectionReadCache,
  trace?: BundleKeyTrace,
): Record<string, string> {
  const bundleData: Record<string, string> = {};

  if (bundleDefinition.collections === 'All') {
    for (const collectionName of Object.keys(config.collections)) {
      const collectionBundleDef: CollectionBundleDefinition = {
        name: collectionName,
        entriesSelectionRules: 'All',
      };
      processCollection(
        collectionBundleDef,
        openCollection(config, collectionName),
        locale,
        bundleData,
        transformICUToTransloco,
        warnings,
        cache,
        trace,
      );
    }
  } else {
    for (const collectionBundleDef of bundleDefinition.collections) {
      if (!Object.keys(config.collections).includes(collectionBundleDef.name)) {
        warnings.push(`Collection '${collectionBundleDef.name}' not found in config`);
        continue;
      }

      processCollection(
        collectionBundleDef,
        openCollection(config, collectionBundleDef.name),
        locale,
        bundleData,
        transformICUToTransloco,
        warnings,
        cache,
        trace,
      );
    }
  }

  return bundleData;
}

/**
 * Processes a single collection and adds its entries to bundle data.
 * The collection's own base locale decides whether `locale` reads the base value or a translation.
 */
function processCollection(
  collectionDef: CollectionBundleDefinition,
  collection: Collection,
  locale: BundleLocale,
  bundleData: Record<string, string>,
  transformICUToTransloco: boolean,
  warnings: string[],
  cache: CollectionReadCache,
  trace?: BundleKeyTrace,
): void {
  const resources = loadCollectionResources(collection, locale, cache, warnings);
  const filteredResources = filterResources(resources, collectionDef);
  const mergeStrategy = collectionDef.mergeStrategy ?? 'merge';

  for (const resource of filteredResources) {
    const finalKey = collectionDef.bundledKeyPrefix
      ? `${collectionDef.bundledKeyPrefix}.${resource.key}`
      : resource.key;

    let finalValue = resource.value;
    if (transformICUToTransloco) {
      if (resource.value.includes('{') && !validateICUSyntax(resource.value)) {
        warnings.push(`Key '${resource.key}': value has malformed ICU syntax and was included as-is`);
      }
      if (hasUnbundlableBranchBody(resource.value)) {
        warnings.push(
          `Key '${resource.key}': a branch body cannot be carried to a Transloco runtime, so the bundled ` +
            'value does not render as written. A branch body survives only as a plain parameter name — ' +
            'not an argument carrying a format, and not a run that is no parameter name. Give the branch ' +
            'body text beside the argument, or move the format out of the branch:\n' +
            '  {count, plural, =1 {{n, number} item} other {# items}}\n' +
            `  value: ${resource.value}`,
        );
      }
      finalValue = icuToTransloco(resource.value);
    }

    if (finalKey in bundleData) {
      trace?.conflicts.add(finalKey);
      if (mergeStrategy === 'override') {
        bundleData[finalKey] = finalValue;
        trace?.origins.set(finalKey, { collectionName: collectionDef.name, sourceKey: resource.key });
      }
      // merge (default) - keep existing (first wins)
      // Skip to next resource since key already exists
    } else {
      // New key - add it
      bundleData[finalKey] = finalValue;
      trace?.origins.set(finalKey, { collectionName: collectionDef.name, sourceKey: resource.key });
    }
  }
}

/**
 * Filters resources based on entry selection rules
 */
function filterResources(resources: FlatResource[], collectionDef: CollectionBundleDefinition): FlatResource[] {
  if (collectionDef.entriesSelectionRules === 'All') {
    return resources;
  }

  // Apply selection rules (TypeScript knows it's EntrySelectionRule[] here)
  const rules = collectionDef.entriesSelectionRules;
  return resources.filter((resource) => matchesAnyRule(resource, rules));
}

/**
 * Checks if resource matches any of the selection rules
 */
function matchesAnyRule(resource: FlatResource, rules: EntrySelectionRule[]): boolean {
  const tags = resource.tags;
  return rules.some((rule) => {
    const patternMatch = matchesPattern(resource.key, rule.matchingPattern);
    const tagMatch = matchesTags(
      tags && tags.length > 0 ? tags : undefined,
      rule.matchingTags,
      rule.matchingTagOperator,
    );
    return patternMatch && tagMatch;
  });
}

/**
 * Determines output file path for bundle
 */
export function getBundleOutputPath(bundleDefinition: BundleDefinition, locale: string): string {
  const fileName = bundleDefinition.bundleName.replace('{locale}', locale);
  return path.join(bundleDefinition.dist, `${fileName}.json`);
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
