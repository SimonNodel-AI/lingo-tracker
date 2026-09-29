import { readdirSync, rmdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Collection } from '../config/open-collection';
import { FolderMoveIntoDescendantError, FolderNotFoundError } from '../errors/lingo-tracker-error';
import { mergeRelocation } from '../resource/move-resource';
import { relocateEntries } from '../resource/relocate-entries';
import { inspectFolderAddress, validateFolderAddress } from '../resource/folder-address';
import { sweepKeys } from '../resource/collection-sweep';
import { folderMutation, type ResourceMutation } from '../resource/resource-mutation';

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
   * The root destination (`''`) has no name, so it always nests, whatever this says.
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
  /** A `remove` per moved key, an `upsert` per moved key, then a `remove-folder` if every key moved and the folder was deleted. */
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
 * 5. Once every resource in it was moved, removes the source folder where it is empty. Content
 *    outside the collection (hidden folders, stray files) is never deleted: its folders are kept with a warning
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
  const sameCollection = resolve(destinationCollection.translationsFolder) === resolve(collection.translationsFolder);

  const result: MoveFolderResult = {
    movedCount: 0,
    foldersDeleted: 0,
    warnings: [],
    errors: [],
    mutations: [],
  };

  // Validate folder path segments and split for later use
  const sourceFolderSegments = validateFolderAddress(sourceFolderPath, 'source folder path', false);

  // The root is a valid destination.
  const destinationFolderSegments = validateFolderAddress(destinationFolderPath, 'destination folder path');

  // Check for same-folder move (no-op)
  if (sourceFolderPath === destinationFolderPath && sameCollection) {
    result.warnings.push('Source and destination are the same. No move performed.');
    return result;
  }

  // Prevent moving a folder into its own descendant
  if (destinationFolderPath.startsWith(`${sourceFolderPath}.`) && sameCollection) {
    throw new FolderMoveIntoDescendantError(sourceFolderPath, destinationFolderPath);
  }

  // The root has no name to rename to, so a move there always nests.
  const nest = nestUnderDestination || destinationFolderPath === '';

  // When nesting, check if destination is the source's parent (would be a no-op)
  if (nest && sameCollection) {
    const sourceParentPath = sourceFolderSegments.slice(0, -1).join('.');
    if (sourceParentPath === destinationFolderPath) {
      result.warnings.push('Folder is already at this location. No move performed.');
      return result;
    }
  }

  const { absolutePath: absoluteSourcePath, isDirectory } = inspectFolderAddress(
    collection.translationsFolder,
    sourceFolderPath,
  );
  if (!isDirectory) {
    throw new FolderNotFoundError(sourceFolderPath);
  }

  // Extract all resource keys from the source folder tree
  const { keys: resourceKeys, problems } = sweepKeys(collection, { startPath: sourceFolderPath });
  const enumerationErrors = problems.map(
    (problem) => `Failed to read resources in "${problem.folderPath || '.'}": ${problem.message}`,
  );

  // An unreadable folder would be deleted without its entries being copied; stop before any move/delete.
  if (enumerationErrors.length > 0) {
    result.errors.push(...enumerationErrors);
    return result;
  }

  if (resourceKeys.length === 0) {
    result.warnings.push('No resources found in source folder. Nothing to move.');
    // Still remove the empty folder
    try {
      removeEmptySource(collection, sourceFolderPath, absoluteSourcePath, result);
    } catch (error) {
      result.errors.push(`Failed to delete empty source folder: ${errorMessage(error)}`);
    }
    return result;
  }

  // Calculate depth once for all resources
  const sourceDepth = sourceFolderSegments.length;
  const destDepth = destinationFolderSegments.length;
  const lastSourceSegment = sourceFolderSegments[sourceFolderSegments.length - 1];

  const relocations = resourceKeys.map((sourceKey) => {
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
    if (nest) {
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
    return { from: sourceKey, to: destinationKey };
  });

  // One Entry Relocation for the whole tree: each folder is read and written once.
  const relocation = relocateEntries(collection, destinationCollection, relocations, { override });
  mergeRelocation(result, relocation);

  // Keys that stayed in the source (collision without override, or an error); the source folder must be kept.
  const movedKeys = new Set(relocation.moved.map(({ from }) => from));
  const keptKeys = resourceKeys.filter((key) => !movedKeys.has(key));

  if (keptKeys.length > 0) {
    result.warnings.push(`Source folder kept; resources not moved: ${keptKeys.join(', ')}`);
  }

  // Only remove the source folder when every resource in it was moved
  if (keptKeys.length === 0 && result.errors.length === 0) {
    try {
      removeEmptySource(collection, sourceFolderPath, absoluteSourcePath, result);
    } catch (error) {
      result.warnings.push(`Resources moved but failed to delete source folder: ${errorMessage(error)}`);
    }
  }

  return result;
}

/**
 * Removes the source folder tree, deepest first, where it is empty now: the relocation's saves
 * already deleted the resource files of every emptied folder. Anything else (a hidden folder, a
 * stray file) is not part of the collection and is never deleted; the folders that hold it are
 * kept with a warning. A `remove-folder` is added for the source folder when it is gone, else for
 * each removed subfolder whose parent is kept.
 */
function removeEmptySource(
  collection: Collection,
  sourceFolderPath: string,
  absoluteSourcePath: string,
  result: MoveFolderResult,
): void {
  const { translationsFolder } = collection;
  const leftovers: string[] = [];
  const prune = (folder: string): boolean => {
    let empty = true;
    const removed: string[] = [];
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const child = join(folder, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        if (prune(child)) removed.push(child);
        else empty = false;
      } else {
        leftovers.push(relative(translationsFolder, child));
        empty = false;
      }
    }
    if (empty) {
      rmdirSync(folder);
    } else {
      // The folder stays, so the index must drop the emptied subfolders it lost.
      for (const child of removed) {
        const path = relative(translationsFolder, child).split(sep).join('.');
        result.mutations.push(folderMutation('remove-folder', translationsFolder, path));
      }
    }
    return empty;
  };

  if (prune(absoluteSourcePath)) {
    result.mutations.push(folderMutation('remove-folder', translationsFolder, sourceFolderPath));
    result.foldersDeleted++;
  } else {
    result.warnings.push(
      `Source folder kept: holds content that is not part of the collection: ${leftovers.join(', ')}`,
    );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
