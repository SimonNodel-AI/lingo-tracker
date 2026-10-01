import * as path from 'node:path';
import { type BundleDefinition, checkBundleDefinition, findBundleDefinition } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { BundleNotFoundError, InvalidBundleDefinitionError, InvalidBundleLocalesError } from '../errors';
import {
  type BundleSelection,
  type ResolvedBundleCollections,
  resolveBundleCollections,
  selectBundleEntries,
} from './bundle-selection';
import { type BundleSettings, type BundleSettingsOverrides, resolveBundleSettings } from './resolve-bundle-settings';
import type { CollectionReadCache } from './resource-loader';
import { legacyTypeDistWarning } from './type-generation/generate-types';

interface BundleRunOptions extends BundleSettingsOverrides {
  readonly bundleKey: string;
  readonly config: LingoTrackerConfig;
  readonly locales?: readonly string[];
  readonly cwd?: string;
}

export type PrepareBundleRunParams =
  | (BundleRunOptions & { readonly source: 'saved' })
  | (BundleRunOptions & {
      readonly source: 'supplied';
      readonly bundleDefinition: BundleDefinition | null | undefined;
    });

export interface PreparedBundleRun {
  readonly bundleKey: string;
  readonly cwd: string;
  readonly definition: BundleDefinition;
  readonly settings: BundleSettings;
  readonly locales: readonly string[];
  readonly collections: ResolvedBundleCollections;
  readonly typeWarning?: string;
  readonly tokenConstantNameOverride?: string;
}

/** Resolves a saved run or fully validates a supplied dry-run definition. */
export function prepareBundleRun(params: PrepareBundleRunParams): PreparedBundleRun {
  const cwd = path.resolve(params.cwd ?? process.cwd());
  let definition: BundleDefinition;
  if (params.source === 'saved') {
    const saved = findBundleDefinition(params.config.bundles, params.bundleKey);
    if (!saved) throw new BundleNotFoundError(params.bundleKey);
    definition = saved;
  } else {
    const supplied = params.bundleDefinition;
    if (supplied === null || typeof supplied !== 'object' || Array.isArray(supplied)) {
      throw new InvalidBundleDefinitionError(['bundle definition is required.']);
    }
    const checked = checkBundleDefinition(supplied, Object.keys(params.config.collections ?? {}), params.bundleKey);
    if (checked.errors.length > 0) throw new InvalidBundleDefinitionError(checked.errors);
    definition = checked.definition;
  }

  validateBundleLocales(params.locales, params.config);
  let collections: ResolvedBundleCollections | undefined;
  return {
    bundleKey: params.bundleKey,
    cwd,
    definition,
    settings: resolveBundleSettings(params.bundleKey, params.config, definition, params),
    locales: [...(params.locales ?? params.config.locales)],
    get collections() {
      collections ??= resolveBundleCollections(definition, params.config, { cwd });
      return collections;
    },
    typeWarning: legacyTypeDistWarning(params.bundleKey, definition),
    tokenConstantNameOverride: params.tokenConstantName,
  };
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

/** Selects one output locale and appends the shared empty-bundle warning. */
export function selectPreparedBundleLocale(
  prepared: PreparedBundleRun,
  locale: string,
  cache: CollectionReadCache,
): BundleSelection {
  const selection = selectBundleEntries(prepared.collections.collections, locale, {
    transformICUToTransloco: prepared.settings.transformICUToTransloco,
    cache,
  });
  if (selection.entries.size > 0) return selection;
  return {
    ...selection,
    warnings: [...selection.warnings, `Bundle '${prepared.bundleKey}' for locale '${locale}' is empty`],
  };
}
