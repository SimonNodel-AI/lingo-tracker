import { isUnderNodeModules, normalizeTags } from '@simoncodes-ca/domain';
import type { LingoTrackerCollection } from '../../config/lingo-tracker-collection';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  InvalidCollectionError,
} from '../errors/lingo-tracker-error';

/**
 * Collection Entry: the one place that decides what a collection's record in
 * `.lingo-tracker.json` contains. Every writer of a collection record (`addCollection`,
 * `updateCollection`, `setCollectionProtectedTermsFile`) builds the new config through
 * these pure functions and then writes it once.
 *
 * The stored record is minimal: `translationsFolder` plus only the settings that differ
 * from the global config, so a collection inherits by omission. `STORE` holds the rule for
 * every field, keyed by the type, so a field added to `LingoTrackerCollection` does not
 * compile until its rule is written here.
 */

/** What to store for one field, or `undefined` to leave it out of the record. */
type StoreRule<K extends keyof LingoTrackerCollection> = (
  value: LingoTrackerCollection[K],
  config: LingoTrackerConfig,
) => LingoTrackerCollection[K] | undefined;

/** Keep the value only when it is set and differs from the global one. */
function unlessGlobal<K extends 'exportFolder' | 'importFolder' | 'baseLocale'>(key: K): StoreRule<K> {
  return (value, config) => (value !== undefined && value !== config[key] ? value : undefined);
}

function sameLocales(a: readonly string[], b: readonly string[] | undefined): boolean {
  return b !== undefined && a.length === b.length && a.every((locale, i) => locale === b[i]);
}

const STORE: { [K in keyof Required<LingoTrackerCollection>]: StoreRule<K> } = {
  translationsFolder: (value) => value.trim(),
  exportFolder: unlessGlobal('exportFolder'),
  importFolder: unlessGlobal('importFolder'),
  baseLocale: unlessGlobal('baseLocale'),
  // Order matters to callers (the first locale is the default), so lists are compared as sequences.
  locales: (value, config) => (value !== undefined && !sameLocales(value, config.locales) ? value : undefined),
  // A per-collection override replaces the global block; it is never merged with or diffed against it.
  translation: (value) => value,
  // Stored only when set, so writable collections stay clean.
  readOnly: (value) => (value ? true : undefined),
  tags: (value) => {
    const normalized = normalizeTags(value ?? []);
    return normalized.length > 0 ? normalized : undefined;
  },
  protectedTermsFile: (value) => value?.trim() || undefined,
};

/**
 * The record to store for `collection`: `translationsFolder` (trimmed) plus every field
 * whose rule keeps it. Pure.
 *
 * @throws {InvalidCollectionError} `translationsFolder` is missing or blank.
 */
export function toCollectionEntry(
  config: LingoTrackerConfig,
  collection: LingoTrackerCollection,
): LingoTrackerCollection {
  const translationsFolder = collection.translationsFolder?.trim();
  if (!translationsFolder) {
    throw new InvalidCollectionError('translationsFolder is required');
  }

  const entry: LingoTrackerCollection = { translationsFolder };
  const keep = <K extends keyof LingoTrackerCollection>(key: K): void => {
    const stored = STORE[key](collection[key], config);
    if (stored !== undefined) {
      entry[key] = stored;
    }
  };
  for (const key of Object.keys(STORE) as Array<keyof LingoTrackerCollection>) {
    keep(key);
  }
  return entry;
}

/**
 * The config with `collection` registered under `name`. A collection whose folder is under
 * `node_modules` is read-only unless the caller says otherwise. Pure.
 *
 * @throws {CollectionAlreadyExistsError} A collection named `name` exists.
 * @throws {InvalidCollectionError} `translationsFolder` is missing or blank.
 */
export function addCollectionEntry(
  config: LingoTrackerConfig,
  name: string,
  collection: LingoTrackerCollection,
): LingoTrackerConfig {
  if (hasCollection(config, name)) {
    throw new CollectionAlreadyExistsError(name);
  }

  const readOnly = collection.readOnly ?? isUnderNodeModules(collection.translationsFolder ?? '');
  const entry = toCollectionEntry(config, { ...collection, readOnly });
  return { ...config, collections: { ...config.collections, [name]: entry } };
}

/**
 * The config with the collection `name` replaced by `collection`, and moved to `newName`
 * when that is given and differs. Full-replace semantics: a field the caller leaves out
 * (`readOnly`, `translation`, `locales`, ...) is dropped from the record. Pure.
 *
 * @throws {CollectionNotFoundError} No collection named `name`.
 * @throws {CollectionAlreadyExistsError} A collection named `newName` exists.
 * @throws {InvalidCollectionError} `translationsFolder` is missing or blank.
 */
export function replaceCollectionEntry(
  config: LingoTrackerConfig,
  name: string,
  collection: LingoTrackerCollection,
  newName?: string,
): LingoTrackerConfig {
  if (!hasCollection(config, name)) {
    throw new CollectionNotFoundError(name);
  }

  const targetName = newName || name;
  if (targetName !== name && hasCollection(config, targetName)) {
    throw new CollectionAlreadyExistsError(targetName);
  }

  const entry = toCollectionEntry(config, collection);
  // Rebuild in the same order, so a rename keeps the collection's place in the file.
  const collections = Object.fromEntries(
    Object.entries(config.collections ?? {}).map(([key, value]) => (key === name ? [targetName, entry] : [key, value])),
  );
  return { ...config, collections };
}

function hasCollection(config: LingoTrackerConfig, name: string): boolean {
  // Own keys only: a name like 'constructor' must not resolve to an Object.prototype member.
  return Object.keys(config.collections ?? {}).includes(name);
}
