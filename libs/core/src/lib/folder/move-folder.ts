import type { Collection } from '../config/open-collection';
import { FolderNotFoundError, InvalidCollectionFolderError } from '../errors/lingo-tracker-error';
import { sweepKeys } from '../resource/collection-sweep';
import { inspectFolderAddress, resolveFolderAddress, validateFolderAddress } from '../resource/folder-address';
import { pruneEmptyFolders } from '../resource/folder-pruning';
import { type MoveOptions, type MoveOptionsWithConfig, resolveMoveDestination } from '../resource/move-destination';
import { MoveReport, type MoveResult } from '../resource/move-report';
import { planMove } from '../resource/move-plan';
import { relocateEntries } from '../resource/relocate-entries';
import { resolveMutationSink } from '../resource/resource-mutation';

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

export interface MoveFolderResult extends MoveResult {
  /** Number of source folders deleted after move (zero or one). */
  foldersDeleted: number;
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
 * // Result: { outcome: 'succeeded', movedCount: 5, foldersDeleted: 1, warnings: [], errors: [] }
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

  const report = new MoveReport();

  // Validate folder path segments before planning or touching disk.
  validateFolderAddress(sourceFolderPath, 'source folder path', false);

  // The root is a valid destination.
  validateFolderAddress(destinationFolderPath, 'destination folder path');

  const plan = planMove({
    source: collection,
    destination: destinationCollection,
    selection: { kind: 'folder', path: sourceFolderPath, nestUnderDestination },
    destinationPath: destinationFolderPath,
  });
  if (plan.kind === 'refused') {
    report.warn(plan.warning());
    return report.finish(true);
  }

  let isDirectory: boolean;
  try {
    isDirectory = inspectFolderAddress(collection.translationsFolder, sourceFolderPath).isDirectory;
    resolveFolderAddress(destinationCollection.translationsFolder, destinationFolderPath);
  } catch (error) {
    if (error instanceof InvalidCollectionFolderError) {
      throw new InvalidCollectionFolderError(error.problem, 'move', sourceFolderPath);
    }
    throw error;
  }
  if (!isDirectory) {
    throw new FolderNotFoundError(sourceFolderPath);
  }

  // Extract all resource keys from the source folder tree
  const { keys: resourceKeys, problems } = sweepKeys(collection, { startPath: sourceFolderPath });
  const enumerationErrors = problems.map(
    (problem) => new InvalidCollectionFolderError(problem, 'move', sourceFolderPath).message,
  );

  // An unreadable folder would be deleted without its entries being copied; stop before any move/delete.
  if (enumerationErrors.length > 0) {
    for (const error of enumerationErrors) report.fail(error);
    return report.finish(true);
  }

  const empty = resourceKeys.length === 0;
  if (empty) report.warn('No resources found in source folder. Nothing to move.');

  // One Entry Relocation for the whole tree: each folder is read and written once.
  const relocation = empty
    ? { moved: [], collisions: [], errors: [] }
    : relocateEntries(plan.forKeys(resourceKeys), {
        override,
        onMutation: resolveMutationSink(collection, options),
      });
  report.merge(relocation);

  // Keys that stayed in the source (collision without override, or an error); the source folder must be kept.
  const movedKeys = new Set(relocation.moved.map(({ from }) => from));
  const keptKeys = resourceKeys.filter((key) => !movedKeys.has(key));

  if (keptKeys.length > 0) {
    report.warn(`Source folder kept; resources not moved: ${keptKeys.join(', ')}`);
  }

  // Only remove the source folder when every resource in it was moved
  if (keptKeys.length === 0 && report.hasErrors === false) {
    try {
      report.prune(
        sourceFolderPath,
        pruneEmptyFolders(collection, {
          startPath: sourceFolderPath,
          onMutation: resolveMutationSink(collection, options),
        }),
        empty,
      );
    } catch (error) {
      report.pruningFailed(error, empty);
    }
  }

  return report.finish(true);
}
