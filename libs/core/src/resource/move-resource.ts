import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { walkFolders } from '../lib/normalize/iterative-folder-walker';
import { deleteResource } from './delete-resource';
import { validateKey } from '@simoncodes-ca/domain';
import { resolveResourcePaths } from '../lib/resource/resource-file-paths';
import { openResourceFolder, type ResourceFolder } from '../lib/resource/resource-folder';
import { type ResourceMutation, upsertMutation } from '../lib/resource/resource-mutation';
import { RESOURCE_ENTRIES_FILENAME } from '../constants';
import type { Collection } from '../lib/config/open-collection';

export interface MoveResourceParams {
  /** Full source key, or a prefix pattern ending with `*` (`common.buttons.*`). */
  readonly source: string;
  /** Full destination key; for a pattern, the prefix the matched keys move under. */
  readonly destination: string;
  /** Replace an existing destination entry. Default: false (the key is skipped with a warning). */
  readonly override?: boolean;
  /** Destination collection for a cross-collection move. Default: the source collection. */
  readonly destinationCollection?: Collection;
}

export interface MoveResourceResult {
  movedCount: number;
  warnings: string[];
  errors: string[];
  /** Per moved key: an `upsert` in the destination folder and a `remove` from the source. */
  mutations: ResourceMutation[];
}

/**
 * Moves resources from source to destination, within a collection or into another one.
 * Supports single key move and wildcard pattern move (ending with *).
 * Per-key failures are reported in the result, not thrown.
 */
export async function moveResource(collection: Collection, params: MoveResourceParams): Promise<MoveResourceResult> {
  const { source, destination, override = false, destinationCollection = collection } = params;

  if (source.endsWith('*')) {
    return moveResourcesByPattern(collection, source, destination, override, destinationCollection);
  } else {
    return moveSingleResource(collection, source, destination, override, destinationCollection);
  }
}

async function moveSingleResource(
  sourceCollection: Collection,
  sourceKey: string,
  destinationKey: string,
  override: boolean,
  destinationCollection: Collection,
): Promise<MoveResourceResult> {
  const sourceTranslationsFolder = sourceCollection.translationsFolder;
  const destinationTranslationsFolder = destinationCollection.translationsFolder;
  const result: MoveResourceResult = {
    movedCount: 0,
    warnings: [],
    errors: [],
    mutations: [],
  };

  try {
    validateKey(sourceKey);
    validateKey(destinationKey);
  } catch (error) {
    result.errors.push((error as Error).message);
    return result;
  }

  // 1. Check if source exists
  const sourcePaths = resolveResourcePaths({ key: sourceKey, translationsFolder: sourceTranslationsFolder });

  if (!existsSync(sourcePaths.resourceEntriesPath)) {
    result.errors.push(`Source resource file not found for key: ${sourceKey}`);
    return result;
  }

  let sourceFolder: ResourceFolder;
  try {
    sourceFolder = openResourceFolder(sourcePaths.folderPath, { baseLocale: sourceCollection.baseLocale });
  } catch {
    result.errors.push(`Failed to read source file for key: ${sourceKey}`);
    return result;
  }

  const sourceData = sourceFolder.get(sourcePaths.entryKey);
  if (!sourceData) {
    result.errors.push(`Source key not found: ${sourceKey}`);
    return result;
  }

  // 2. Check if destination exists (Collision Check)
  const destinationPaths = resolveResourcePaths({
    key: destinationKey,
    translationsFolder: destinationTranslationsFolder,
  });

  // 3. Perform Move — a lossless copy: values, comment, tags, checksums, and statuses
  // (including 'verified' and 'stale') are carried as they are. No auto-translation.
  try {
    const destinationFolder = openResourceFolder(destinationPaths.folderPath, {
      baseLocale: destinationCollection.baseLocale,
    });
    if (destinationFolder.has(destinationPaths.entryKey) && !override) {
      result.warnings.push(`Destination key already exists: ${destinationKey}. Use override option to force move.`);
      return result;
    }

    destinationFolder.setEntry(destinationPaths.entryKey, sourceData.entry, sourceData.meta ?? {});
    destinationFolder.save();
    result.mutations.push(
      upsertMutation(
        destinationTranslationsFolder,
        destinationKey,
        destinationFolder.treeEntry(destinationPaths.entryKey),
      ),
    );
  } catch (error) {
    result.errors.push(`Failed to create destination resource: ${(error as Error).message}`);
    return result;
  }

  // Delete from source
  try {
    result.mutations.push(...deleteResource(sourceCollection, { keys: [sourceKey] }).mutations);
  } catch (error) {
    result.warnings.push(
      `Resource moved to ${destinationKey} but failed to delete source ${sourceKey}: ${(error as Error).message}`,
    );
    // Even if delete failed, we count it as moved (or partially moved)
    result.movedCount++;
    return result;
  }

  result.movedCount++;
  return result;
}

async function moveResourcesByPattern(
  sourceCollection: Collection,
  pattern: string,
  destinationKey: string,
  override: boolean,
  destinationCollection: Collection,
): Promise<MoveResourceResult> {
  const sourceTranslationsFolder = sourceCollection.translationsFolder;
  const result: MoveResourceResult = {
    movedCount: 0,
    warnings: [],
    errors: [],
    mutations: [],
  };

  const prefix = pattern.slice(0, -1); // remove '*'
  const cleanPrefix = prefix.endsWith('.') ? prefix.slice(0, -1) : prefix;

  const keysToMove: string[] = [];

  const rootFolderParts = cleanPrefix.split('.');
  const rootFolderPath = join(sourceTranslationsFolder, ...rootFolderParts);

  if (cleanPrefix.length > 0) {
    try {
      validateKey(cleanPrefix);
    } catch (error) {
      result.errors.push((error as Error).message);
      return result;
    }
  }

  if (existsSync(rootFolderPath)) {
    for (const visit of walkFolders(rootFolderPath, { skipHidden: false })) {
      const currentKeyPrefix = [cleanPrefix, visit.keyPrefix].filter(Boolean).join('.');

      try {
        for (const key of openResourceFolder(visit.absolutePath).keys()) {
          const fullKey = currentKeyPrefix ? `${currentKeyPrefix}.${key}` : key;
          keysToMove.push(fullKey);
        }
      } catch {
        result.errors.push(`Failed to read file at ${join(visit.absolutePath, RESOURCE_ENTRIES_FILENAME)}`);
      }
    }
  } else {
    result.warnings.push(`No folder found for prefix ${cleanPrefix}. Nothing moved.`);
    return result;
  }

  // Move each key sequentially so errors are captured per-key
  for (const sourceKey of keysToMove) {
    const suffix = sourceKey.slice(cleanPrefix.length + 1); // +1 for dot
    const newKey = `${destinationKey}.${suffix}`;

    const singleResult = await moveSingleResource(sourceCollection, sourceKey, newKey, override, destinationCollection);

    result.movedCount += singleResult.movedCount;
    result.warnings.push(...singleResult.warnings);
    result.errors.push(...singleResult.errors);
    result.mutations.push(...singleResult.mutations);
  }

  return result;
}
