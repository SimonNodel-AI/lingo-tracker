import type { LingoTrackerConfigDto } from '@simoncodes-ca/data-transfer';

/**
 * A collection's effective settings: the collection's own value where it has one, otherwise
 * the global value, otherwise the default. The Tracker's counterpart of core's `openCollection`;
 * `resolveCollectionSettings` is the only place that applies the fallback rules.
 */
export interface CollectionSettings {
  readonly name: string;
  readonly translationsFolder: string;
  /** Collection `baseLocale`, else global `baseLocale`, else `'en'`. */
  readonly baseLocale: string;
  /** Collection `locales`, else global `locales`, else `[]`. May include the base locale. */
  readonly locales: readonly string[];
  /** `enabled` of the collection `translation` config, else of the global one. The two are not merged. */
  readonly translationEnabled: boolean;
  readonly readOnly: boolean;
}

/**
 * Resolves a collection's effective settings from the config, with the same rules as core's
 * `openCollection`. A name the config does not know resolves to the global settings alone (an
 * empty `translationsFolder`, not read-only), so the API can answer the open with its
 * not-found error instead of the Tracker guessing.
 */
export function resolveCollectionSettings(config: LingoTrackerConfigDto, name: string): CollectionSettings {
  const collections = config.collections ?? {};
  // Own keys only: a name like 'constructor' must not resolve to an Object.prototype member.
  const raw = Object.keys(collections).includes(name) ? collections[name] : undefined;

  return {
    name,
    translationsFolder: raw?.translationsFolder ?? '',
    baseLocale: raw?.baseLocale || config.baseLocale || 'en',
    locales: raw?.locales ?? config.locales ?? [],
    translationEnabled: (raw?.translation ?? config.translation)?.enabled === true,
    readOnly: raw?.readOnly === true,
  };
}
