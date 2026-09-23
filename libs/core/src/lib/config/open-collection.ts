import { resolve } from 'node:path';
import { normalizeTags } from '@simoncodes-ca/domain';
import type { LingoTrackerCollection } from '../../config/lingo-tracker-collection';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import type { TranslationConfig } from '../../config/translation-config';
import { DEFAULT_CONFIG } from '../../constants';
import { CollectionNotFoundError, ReadOnlyCollectionError } from '../errors/lingo-tracker-error';

/**
 * A collection with every setting resolved: the collection's own value where it has one,
 * otherwise the global value, otherwise the default. Get one from {@link openCollection};
 * nothing else applies the fallback rules.
 */
export interface Collection {
  readonly name: string;
  /** Absolute path of the collection's translations folder. */
  readonly translationsFolder: string;
  /** Collection `baseLocale`, else global `baseLocale`, else `'en'`. */
  readonly baseLocale: string;
  /** Collection `locales`, else global `locales`, else `[]`. May include the base locale. */
  readonly locales: readonly string[];
  /** {@link locales} without the base locale. */
  readonly targetLocales: readonly string[];
  /** Collection `translation`, else global `translation`. The two are not merged. */
  readonly translationConfig: TranslationConfig | undefined;
  /** Collection-level tags (normalized), inherited by every resource in the collection. */
  readonly tags: readonly string[];
  readonly readOnly: boolean;
  /** The collection's raw config entry, for settings not modelled here. */
  readonly config: LingoTrackerCollection;
}

export interface OpenCollectionOptions {
  /** Directory a relative `translationsFolder` resolves against. Default: `process.cwd()`. */
  readonly cwd?: string;
  /** Refuse a read-only collection. Set this for operations that change resources. */
  readonly writable?: boolean;
}

/**
 * Resolves a collection's effective settings from the config.
 *
 * @throws {CollectionNotFoundError} The config has no collection with this name.
 * @throws {ReadOnlyCollectionError} `writable` is set and the collection is read-only.
 */
export function openCollection(
  config: LingoTrackerConfig,
  name: string,
  options: OpenCollectionOptions = {},
): Collection {
  const collections = config.collections ?? {};
  // Own keys only: a name like 'constructor' must not resolve to an Object.prototype member.
  const raw = Object.keys(collections).includes(name) ? collections[name] : undefined;
  if (!raw) {
    throw new CollectionNotFoundError(name);
  }

  const readOnly = raw.readOnly === true;
  if (options.writable && readOnly) {
    throw new ReadOnlyCollectionError(name);
  }

  const baseLocale = raw.baseLocale || config.baseLocale || DEFAULT_CONFIG.baseLocale;
  const locales = raw.locales ?? config.locales ?? [];

  return {
    name,
    translationsFolder: resolve(options.cwd ?? process.cwd(), raw.translationsFolder),
    baseLocale,
    locales,
    targetLocales: locales.filter((locale) => locale !== baseLocale),
    translationConfig: raw.translation ?? config.translation,
    tags: normalizeTags(raw.tags ?? []),
    readOnly,
    config: raw,
  };
}
