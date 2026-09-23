import {
  type Collection,
  CollectionNotFoundError,
  type LingoTrackerConfig,
  openCollection,
  ReadOnlyCollectionError,
} from '@simoncodes-ca/core';
import { ErrorMessages } from './error-messages';

/**
 * Opens a collection for a CLI command: core `openCollection` resolves it (effective base
 * locale, locales, translation config, absolute translations folder); this wrapper turns
 * a missing collection into CLI output.
 *
 * @param collectionName - Name of collection to resolve
 * @param config - LingoTracker configuration
 * @param baseDirectory - Directory the translations folder resolves against
 * @returns The resolved collection, or null (after printing an error) if not found
 *
 * @example
 * const collection = resolveCollection('main', config, cwd);
 * if (!collection) return;
 * // Use: collection.translationsFolder, collection.baseLocale, collection.locales
 */
export function resolveCollection(
  collectionName: string,
  config: LingoTrackerConfig,
  baseDirectory: string,
): Collection | null {
  return open(collectionName, config, baseDirectory, false);
}

/**
 * Resolves a collection for a mutating operation. Behaves like {@link resolveCollection},
 * but additionally refuses read-only collections: it prints an error, sets a non-zero exit
 * code (so the failure is detectable in CI), and returns null.
 *
 * Use this in commands that modify resources (add/edit/delete/move/normalize/import,
 * locale changes, auto-translate). Commands that only read, or that operate on the
 * collection's registration (delete-collection), should use {@link resolveCollection}.
 *
 * @example
 * const collection = resolveWritableCollection('main', config, cwd);
 * if (!collection) return;
 */
export function resolveWritableCollection(
  collectionName: string,
  config: LingoTrackerConfig,
  baseDirectory: string,
): Collection | null {
  return open(collectionName, config, baseDirectory, true);
}

function open(
  collectionName: string,
  config: LingoTrackerConfig,
  baseDirectory: string,
  writable: boolean,
): Collection | null {
  try {
    return openCollection(config, collectionName, { cwd: baseDirectory, writable });
  } catch (error) {
    if (error instanceof CollectionNotFoundError) {
      console.log(ErrorMessages.COLLECTION_NOT_FOUND(collectionName));
      return null;
    }
    if (error instanceof ReadOnlyCollectionError) {
      console.log(ErrorMessages.COLLECTION_READ_ONLY(collectionName));
      process.exitCode = 1;
      return null;
    }
    throw error;
  }
}
