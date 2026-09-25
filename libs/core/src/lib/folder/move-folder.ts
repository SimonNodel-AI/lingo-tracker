import { existsSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { walkFolders } from '../normalize/iterative-folder-walker';
import { isValidSegment } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import {
  FolderMoveIntoDescendantError,
  FolderNotFoundError,
  InvalidFolderPathError,
} from '../errors/lingo-tracker-error';
import { moveResource, type MoveResourceResult } from '../../resource/move-resource';
import { deleteFolder } from './delete-folder';
import { openResourceFolder } from '../resource/resource-folder';
import type { ResourceMutation } from '../resource/resource-mutation';

export interface MoveFolderParams {
  /** The source folder path to move (dot-delimited like "apps.common.buttons") */
  readonly sourceFolderPath: string;
  /** The destination folder path to move to (dot-delimited like "apps.shared") */
  readonly destinationFolderPath: string;
  /** If true, override existing resources at destination */
  readonly override?: boolean;
  /** Destination collection for a cross-collection move. Default: the source collection. */
  readonly destinationCollection?: Collection;
  /**
   * When true, the source folder is nested under the destination as a child folder.
   * When false, uses depth-based rename/nest heuristic (legacy behavior).
   * Default: true
   */
  readonly nestUnderDestination?: boolean;
}

export interface MoveFolderResult {
  /** Number of resources moved */
  movedCount: number;
  /** Number of folders deleted after move */
  foldersDeleted: number;
  /** Warning messages */
  warnings: string[];
  /** Error messages */
  errors: string[];
  /** Per moved key an `upsert` and a `remove`, then a `remove-folder` if every key moved and the folder was deleted. */
  mutations: ResourceMutation[];
}

/**
 * Moves an entire folder (and all its resources) from source to destination.
 *
 * This function:
 * 1. Validates the source and destination folder paths
 * 2. Prevents circular dependencies (moving folder into its own descendant)
 * 3. Extracts all resources in the source folder tree recursively
 * 4. Moves each resource to the corresponding destination path
 * 5. Deletes the source folder once every resource in it was moved (otherwise keeps it and warns)
 *
 * Bad input throws; failures of individual resources are reported in the result.
 *
 * @param collection - The collection the source folder is in
 * @param params - Folder move parameters
 * @returns Object containing move statistics and any warnings/errors
 * @throws {InvalidFolderPathError} A folder path has a malformed segment.
 * @throws {FolderMoveIntoDescendantError} The destination is inside the source folder (same collection).
 * @throws {FolderNotFoundError} The source folder does not exist.
 *
 * @example
 * ```typescript
 * // Move a folder with all its contents
 * const result = await moveFolder(collection, {
 *   sourceFolderPath: 'apps.common.buttons',
 *   destinationFolderPath: 'apps.shared'
 * });
 * // Result: { movedCount: 5, foldersDeleted: 1, warnings: [], errors: [] }
 * // Resources like 'apps.common.buttons.ok' become 'apps.shared.buttons.ok'
 * ```
 */
export async function moveFolder(collection: Collection, params: MoveFolderParams): Promise<MoveFolderResult> {
  const { sourceFolderPath, destinationFolderPath, override = false, nestUnderDestination = true } = params;
  const destinationCollection = params.destinationCollection ?? collection;
  const sameCollection = destinationCollection.translationsFolder === collection.translationsFolder;

  const result: MoveFolderResult = {
    movedCount: 0,
    foldersDeleted: 0,
    warnings: [],
    errors: [],
    mutations: [],
  };

  // Validate folder path segments and split for later use
  const sourceFolderSegments = sourceFolderPath.split('.');
  const destinationFolderSegments = destinationFolderPath.split('.');

  for (const segment of sourceFolderSegments) {
    if (!isValidSegment(segment)) {
      throw new InvalidFolderPathError('source folder path', segment);
    }
  }

  // Skip validation if destination is empty (root-level move)
  if (destinationFolderPath !== '') {
    for (const segment of destinationFolderSegments) {
      if (!isValidSegment(segment)) {
        throw new InvalidFolderPathError('destination folder path', segment);
      }
    }
  }

  // Check for same-folder move (no-op)
  if (sourceFolderPath === destinationFolderPath && sameCollection) {
    result.warnings.push('Source and destination are the same. No move performed.');
    return result;
  }

  // Prevent moving a folder into its own descendant
  if (destinationFolderPath.startsWith(`${sourceFolderPath}.`) && sameCollection) {
    throw new FolderMoveIntoDescendantError(sourceFolderPath, destinationFolderPath);
  }

  // When nesting, check if destination is the source's parent (would be a no-op)
  if (nestUnderDestination && sameCollection) {
    const sourceParentPath = sourceFolderSegments.slice(0, -1).join('.');
    if (sourceParentPath === destinationFolderPath) {
      result.warnings.push('Folder is already at this location. No move performed.');
      return result;
    }
  }

  const absoluteSourcePath = resolve(join(collection.translationsFolder, ...sourceFolderSegments));
  if (!existsSync(absoluteSourcePath) || !statSync(absoluteSourcePath).isDirectory()) {
    throw new FolderNotFoundError(sourceFolderPath);
  }

  // Extract all resource keys from the source folder tree
  const { keys: resourceKeys, errors: enumerationErrors } = extractAllResourceKeysFromFolder(
    absoluteSourcePath,
    sourceFolderPath,
  );

  // An unreadable folder would be deleted without its entries being copied; stop before any move/delete.
  if (enumerationErrors.length > 0) {
    result.errors.push(...enumerationErrors);
    return result;
  }

  if (resourceKeys.length === 0) {
    result.warnings.push('No resources found in source folder. Nothing to move.');
    // Still delete the empty folder
    try {
      result.mutations.push(...deleteFolder(collection, { folderPath: sourceFolderPath }).mutations);
      result.foldersDeleted++;
    } catch (error) {
      result.errors.push(`Failed to delete empty source folder: ${errorMessage(error)}`);
    }
    return result;
  }

  // Calculate depth once for all resources
  const sourceDepth = sourceFolderSegments.length;
  const destDepth = destinationFolderSegments.length;
  const lastSourceSegment = sourceFolderSegments[sourceFolderSegments.length - 1];
  // Keys that stayed in the source (collision without override, or an error); the source folder must be kept.
  const keptKeys: string[] = [];

  for (const sourceKey of resourceKeys) {
    // Calculate destination key by replacing source folder prefix with destination folder prefix
    //
    // When nestUnderDestination is true (default):
    // - ALWAYS append source folder name to destination
    // - testdata.foo.bar + common => common.testdata.foo.bar
    // - data.testdata.foo + common => common.testdata.foo
    // - testdata.foo + "" (root) => testdata.foo

    // Extract the relative suffix after the source folder
    const suffix = sourceKey.slice(sourceFolderPath.length);
    // If sourceKey === sourceFolderPath exactly, suffix will be empty
    // Otherwise suffix will start with '.'

    let destinationKey: string;
    if (nestUnderDestination) {
      // always nest the source folder under destination
      const sourceFolderName = lastSourceSegment;
      if (destinationFolderPath) {
        destinationKey = suffix
          ? `${destinationFolderPath}.${sourceFolderName}${suffix}`
          : `${destinationFolderPath}.${sourceFolderName}`;
      } else {
        // Root-level move: just use source folder name + suffix
        destinationKey = suffix ? `${sourceFolderName}${suffix}` : sourceFolderName;
      }
    } else if (destDepth === sourceDepth) {
      // Same depth: RENAME - replace entire source path with destination
      // apps.buttons.ok -> apps.actions becomes apps.actions.ok
      destinationKey = suffix ? `${destinationFolderPath}${suffix}` : destinationFolderPath;
    } else {
      // Different depth: NEST - append last segment of source to destination
      // apps.common.buttons.ok -> apps.shared becomes apps.shared.buttons.ok
      destinationKey = suffix
        ? `${destinationFolderPath}.${lastSourceSegment}${suffix}`
        : `${destinationFolderPath}.${lastSourceSegment}`;
    }

    const moveResult: MoveResourceResult = await moveResource(collection, {
      source: sourceKey,
      destination: destinationKey,
      override,
      destinationCollection,
    });

    result.movedCount += moveResult.movedCount;
    result.warnings.push(...moveResult.warnings);
    result.errors.push(...moveResult.errors);
    result.mutations.push(...moveResult.mutations);
    if (moveResult.movedCount === 0) {
      keptKeys.push(sourceKey);
    }
  }

  if (keptKeys.length > 0) {
    result.warnings.push(`Source folder kept; resources not moved: ${keptKeys.join(', ')}`);
  }

  // Only delete the source folder when every resource in it was moved
  if (keptKeys.length === 0 && result.errors.length === 0) {
    try {
      result.mutations.push(...deleteFolder(collection, { folderPath: sourceFolderPath }).mutations);
      result.foldersDeleted++;
    } catch (error) {
      result.warnings.push(`Resources moved but failed to delete source folder: ${errorMessage(error)}`);
    }
  }

  return result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Extracts all resource keys from a folder and its subfolders.
 *
 * @param absoluteFolderPath - Absolute filesystem path to the folder
 * @param folderKeyPrefix - Dot-delimited key prefix for this folder
 * @returns Full resource keys found in the folder tree, and one error per folder that could not be read
 */
function extractAllResourceKeysFromFolder(
  absoluteFolderPath: string,
  folderKeyPrefix: string,
): { keys: string[]; errors: string[] } {
  const keys: string[] = [];
  const errors: string[] = [];

  for (const visit of walkFolders(absoluteFolderPath, { skipHidden: false })) {
    const currentKeyPrefix = visit.keyPrefix
      ? folderKeyPrefix
        ? `${folderKeyPrefix}.${visit.keyPrefix}`
        : visit.keyPrefix
      : folderKeyPrefix;

    try {
      for (const entryKey of openResourceFolder(visit.absolutePath).keys()) {
        keys.push(currentKeyPrefix ? `${currentKeyPrefix}.${entryKey}` : entryKey);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      errors.push(`Failed to read resources in "${currentKeyPrefix || '.'}": ${reason}`);
    }
  }

  return { keys, errors };
}
