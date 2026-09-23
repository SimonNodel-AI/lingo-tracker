/**
 * Dry-run planner for bundle generation.
 *
 * `planBundle` computes everything `generateBundle` would do — which files it
 * would write, how many keys each locale gets, which keys collide between
 * collections — without touching the filesystem. It never calls type
 * generation; the types file is only described.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectHierarchicalConflicts, type TokenCasing } from '@simoncodes-ca/domain';
import { type BundleDefinition, hasTypeDistConfigured } from '../../config/bundle-definition';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { type BundleKeyTrace, collectBundleData, getBundleOutputPath } from './generate-bundle';
import { COLLECTION_BASE_LOCALE, type CollectionReadCache } from './resource-loader';
import {
  bundleKeyToConstantName,
  segmentToPropertyName,
  splitKeyIntoSegments,
} from './type-generation/key-transformer';

export interface PlanBundleParams {
  readonly bundleKey: string;
  readonly bundleDefinition: BundleDefinition;
  readonly config: LingoTrackerConfig;
  /** Subset of locales to plan for (defaults to `config.locales`). */
  readonly locales?: string[];
  /** Override for token casing; same precedence as `generateBundle`. */
  readonly tokenCasing?: TokenCasing;
  /** Override for the generated constant name; same precedence as `generateBundle`. */
  readonly tokenConstantName?: string;
  /** Override for ICU → Transloco transformation; same precedence as `generateBundle`. */
  readonly transformICUToTransloco?: boolean;
  /** Base directory used to resolve relative paths for `exists` checks (default: `process.cwd()`). */
  readonly cwd?: string;
}

export interface BundlePlanFile {
  /** Path as configured (relative or absolute), exactly what generation would use. */
  readonly path: string;
  /** Path resolved against `cwd`. */
  readonly absolutePath: string;
  readonly kind: 'bundle' | 'types';
  /** Present for `bundle` files only. */
  readonly locale?: string;
  /** Whether a file already exists at `absolutePath`. */
  readonly exists: boolean;
  /** Keys the file would contain. For the types file this is the base-locale key count. */
  readonly keysCount: number;
}

export interface BundlePlanExampleKey {
  readonly collectionName: string;
  readonly sourceKey: string;
  /** Key as it appears in the bundle output (after `bundledKeyPrefix`). */
  readonly bundledKey: string;
  /** Property path in the generated types constant; only when types are configured. */
  readonly tokenPath?: string;
}

export interface BundlePlan {
  readonly bundleKey: string;
  readonly locales: string[];
  readonly files: BundlePlanFile[];
  readonly keysPerLocale: Record<string, number>;
  /** Number of keys defined by more than one collection. */
  readonly conflictsCount: number;
  /** Keys defined by more than one collection. */
  readonly conflictKeys: string[];
  /**
   * Base-locale keys that are both a leaf and a parent, e.g. `buttons.ok`
   * alongside `buttons.ok.label`. Generation cannot build a hierarchy from
   * these, so a plan that reports any of them describes a bundle that would
   * fail. Each one is also echoed in `warnings`.
   */
  readonly hierarchicalConflicts: string[];
  readonly exampleKey?: BundlePlanExampleKey;
  readonly warnings: string[];
}

/**
 * Plans a bundle run without writing anything.
 */
export function planBundle(params: PlanBundleParams): BundlePlan {
  const {
    bundleKey,
    bundleDefinition,
    config,
    locales,
    tokenCasing: tokenCasingOverride,
    tokenConstantName: tokenConstantNameOverride,
    transformICUToTransloco: transformICUToTranslocoOverride,
  } = params;
  const cwd = params.cwd ?? process.cwd();

  const resolvedTokenCasing: TokenCasing =
    tokenCasingOverride ?? bundleDefinition.tokenCasing ?? config.tokenCasing ?? 'upperCase';
  const resolvedTransformICUToTransloco: boolean =
    transformICUToTranslocoOverride ??
    bundleDefinition.transformICUToTransloco ??
    config.transformICUToTransloco ??
    true;
  const resolvedConstantName =
    tokenConstantNameOverride ?? bundleDefinition.tokenConstantName ?? bundleKeyToConstantName(bundleKey);

  const targetLocales = locales ?? config.locales;
  const warnings: string[] = [];
  const keysPerLocale: Record<string, number> = {};
  const files: BundlePlanFile[] = [];
  const resourceCache: CollectionReadCache = new Map();

  for (const locale of targetLocales) {
    const bundleData = collectBundleData(
      bundleDefinition,
      config,
      locale,
      warnings,
      resolvedTransformICUToTransloco,
      resourceCache,
    );

    const keysCount = Object.keys(bundleData).length;
    keysPerLocale[locale] = keysCount;

    if (keysCount === 0) {
      warnings.push(`Bundle '${bundleKey}' for locale '${locale}' is empty`);
    }

    const outputPath = getBundleOutputPath(bundleDefinition, locale);
    files.push(describeFile(outputPath, 'bundle', keysCount, cwd, locale));
  }

  // The key set drives conflict detection, the example key and the types count. It is read
  // once, from every collection's own base values (a collection may override the base locale),
  // and traced only here: conflicts are a property of the key set, not of a locale. Its
  // warnings were already reported by the locale passes, so they are dropped unless there were none.
  const trace: BundleKeyTrace = { conflicts: new Set(), origins: new Map() };
  const baseLocaleData = collectBundleData(
    bundleDefinition,
    config,
    COLLECTION_BASE_LOCALE,
    targetLocales.length > 0 ? [] : warnings,
    resolvedTransformICUToTransloco,
    resourceCache,
    trace,
  );

  const typesConfigured = hasTypeDistConfigured(bundleDefinition);
  const baseKeysCount = Object.keys(baseLocaleData).length;

  if (typesConfigured && bundleDefinition.typeDistFile) {
    files.push(describeFile(bundleDefinition.typeDistFile, 'types', baseKeysCount, cwd));
  }

  const conflictKeys = Array.from(trace.conflicts).sort();

  // A key that is both a leaf and a parent makes `buildHierarchy` throw during
  // generation, so surface it in the plan rather than letting the run explode.
  const hierarchicalConflicts = detectHierarchicalConflicts(Object.keys(baseLocaleData)).sort();
  for (const key of hierarchicalConflicts) {
    warnings.push(
      `Hierarchical conflict: bundled key '${key}' has a value and child keys; generation would fail. ` +
        `Remove the entry or its children from bundle '${bundleKey}'.`,
    );
  }

  const exampleKey = pickExampleKey(baseLocaleData, trace, typesConfigured, resolvedConstantName, resolvedTokenCasing);

  return {
    bundleKey,
    locales: [...targetLocales],
    files,
    keysPerLocale,
    conflictsCount: conflictKeys.length,
    conflictKeys,
    hierarchicalConflicts,
    exampleKey,
    warnings,
  };
}

function describeFile(
  filePath: string,
  kind: BundlePlanFile['kind'],
  keysCount: number,
  cwd: string,
  locale?: string,
): BundlePlanFile {
  const absolutePath = path.resolve(cwd, filePath);
  const file: BundlePlanFile = {
    path: filePath,
    absolutePath,
    kind,
    exists: fs.existsSync(absolutePath),
    keysCount,
  };
  return locale === undefined ? file : { ...file, locale };
}

function pickExampleKey(
  baseLocaleData: Record<string, string>,
  trace: BundleKeyTrace,
  typesConfigured: boolean,
  constantName: string,
  tokenCasing: TokenCasing,
): BundlePlanExampleKey | undefined {
  const [firstKey] = Object.keys(baseLocaleData);
  if (firstKey === undefined) {
    return undefined;
  }

  const origin = trace.origins.get(firstKey);
  if (!origin) {
    return undefined;
  }

  const example: BundlePlanExampleKey = {
    collectionName: origin.collectionName,
    sourceKey: origin.sourceKey,
    bundledKey: firstKey,
  };

  if (!typesConfigured) {
    return example;
  }

  const segments = splitKeyIntoSegments(firstKey).map((segment) => segmentToPropertyName(segment, tokenCasing));
  return { ...example, tokenPath: [constantName, ...segments].join('.') };
}
