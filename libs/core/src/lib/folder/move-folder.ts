import { readdirSync, rmdirSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { Collection } from '../config/open-collection';
import { FolderMoveIntoDescendantError, FolderNotFoundError } from '../errors/lingo-tracker-error';
import { sweepKeys } from '../resource/collection-sweep';
import { inspectFolderAddress, validateFolderAddress } from '../resource/folder-address';
import { planMove } from '../resource/move-plan';
import { type MoveOptions, type MoveOptionsWithConfig, resolveMoveDestination } from '../resource/move-destination';
import { mergeRelocation } from '../resource/move-resource';
import { relocateEntries } from '../resource/relocate-entries';
import { folderMutation, type MutationSink } from '../resource/resource-mutation';

export interface MoveFolderParams {
  /** The source folder path to move (dot-delimited like "apps.common.buttons") */
  readonly sourceFolderPath: string;
  /** The destination folder path to move to (dot-delimited like "apps.shared") */
  readonly destinationFolderPath: string;
  /** If true, override existing resources at destination */
  readonly override?: boolean;
  /** Plain destination collection name. Default: the source collection. */
  readonly toCollection?: string;
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
export function moveFolder(
  collection: Collection,
  params: MoveFolderParams,
  options: MoveOptionsWithConfig,
): Promise<MoveFolderResult>;
export function moveFolder(
  collection: Collection,
  params: MoveFolderParams & { readonly toCollection?: undefined },
  options?: MoveOptions,
): Promise<MoveFolderResult>;
export async function moveFolder(
  collection: Collection,
  params: MoveFolderParams,
  options: MoveOptions = {},
): Promise<MoveFolderResult> {
  const { sourceFolderPath, destinationFolderPath, override = false, nestUnderDestination = true } = params;
  const destinationCollection = resolveMoveDestination(collection, params.toCollection, options);
  const sameCollection = resolve(destinationCollection.translationsFolder) === resolve(collection.translationsFolder);

  const result: MoveFolderResult = {
    movedCount: 0,
    foldersDeleted: 0,
    warnings: [],
    errors: [],
  };

  // Validate folder path segments before planning or touching disk.
  validateFolderAddress(sourceFolderPath, 'source folder path', false);

  // The root is a valid destination.
  validateFolderAddress(destinationFolderPath, 'destination folder path');

  // Prevent moving a folder into its own descendant
  if (destinationFolderPath.startsWith(`${sourceFolderPath}.`) && sameCollection) {
    throw new FolderMoveIntoDescendantError(sourceFolderPath, destinationFolderPath);
  }

  const selection = { kind: 'folder' as const, path: sourceFolderPath, nestUnderDestination, sameCollection };
  const noOp = planMove({ ...selection, keys: [] }, destinationFolderPath);
  if (noOp.warnings.length > 0) {
    result.warnings.push(...noOp.warnings);
    return result;
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
      removeEmptySource(collection, absoluteSourcePath, result, options.onMutation);
    } catch (error) {
      result.errors.push(`Failed to delete empty source folder: ${errorMessage(error)}`);
    }
    return result;
  }

  const { relocations } = planMove({ ...selection, keys: resourceKeys }, destinationFolderPath);

  // One Entry Relocation for the whole tree: each folder is read and written once.
  const relocation = relocateEntries(collection, destinationCollection, relocations, {
    override,
    onMutation: options.onMutation,
  });
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
      removeEmptySource(collection, absoluteSourcePath, result, options.onMutation);
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
 * kept with a warning. Each removed folder is reported immediately after its removal.
 */
function removeEmptySource(
  collection: Collection,
  absoluteSourcePath: string,
  result: MoveFolderResult,
  onMutation?: MutationSink,
): void {
  const { translationsFolder } = collection;
  const leftovers: string[] = [];
  const prune = (folder: string): boolean => {
    let empty = true;
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const child = join(folder, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        if (!prune(child)) empty = false;
      } else {
        leftovers.push(relative(translationsFolder, child));
        empty = false;
      }
    }
    if (empty) {
      rmdirSync(folder);
      const path = relative(translationsFolder, folder).split(sep).join('.');
      onMutation?.(folderMutation('remove-folder', translationsFolder, path));
    }
    return empty;
  };

  if (prune(absoluteSourcePath)) {
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
