import { rmSync } from 'node:fs';
import type { Collection } from '../config/open-collection';
import { FolderNotFoundError } from '../errors/lingo-tracker-error';
import { sweepCollection } from '../resource/collection-sweep';
import { inspectFolderAddress, validateFolderAddress } from '../resource/folder-address';
import { folderMutation, type ResourceMutation } from '../resource/resource-mutation';

export interface DeleteFolderParams {
  /** The folder path to delete (dot-delimited path like "apps.common.buttons") */
  readonly folderPath: string;
}

export interface DeleteFolderResult {
  /** The dot-delimited folder path that was deleted */
  readonly folderPath: string;
  /** Number of resource entries that were deleted */
  readonly resourcesDeleted: number;
  /** The `remove-folder` for the deleted folder. */
  readonly mutations: ResourceMutation[];
}

/**
 * Deletes a folder and all its contents from a collection's translations folder.
 *
 * This function:
 * 1. Validates the folder path segments
 * 2. Converts dot-delimited path to filesystem path
 * 3. Counts the resource entries in the folder tree (its Collection Sweep: hidden folders and
 *    unreadable folders are not counted, though they are deleted with the rest)
 * 4. Recursively deletes the folder and all its contents
 *
 * @param collection - The collection to delete the folder from
 * @param params - Folder deletion parameters
 * @returns The deleted folder and how many resource entries went with it
 * @throws {InvalidFolderPathError} The folder path has a malformed segment.
 * @throws {FolderNotFoundError} No folder exists at the path.
 *
 * @example
 * ```typescript
 * const result = deleteFolder(collection, { folderPath: 'apps.common.buttons' });
 * // Result: { folderPath: 'apps.common.buttons', resourcesDeleted: 5, mutations: [...] }
 * ```
 */
export function deleteFolder(collection: Collection, params: DeleteFolderParams): DeleteFolderResult {
  const { folderPath } = params;
  const { translationsFolder } = collection;

  validateFolderAddress(folderPath, 'folder path', false);

  const { absolutePath: absoluteFolderPath, isDirectory } = inspectFolderAddress(translationsFolder, folderPath);
  if (!isDirectory) {
    throw new FolderNotFoundError(folderPath);
  }

  const resourcesDeleted = countResources(collection, folderPath);
  rmSync(absoluteFolderPath, { recursive: true, force: true });

  return {
    folderPath,
    resourcesDeleted,
    mutations: [folderMutation('remove-folder', translationsFolder, folderPath)],
  };
}

/** Counts the resource entries the Collection Sweep finds under `folderPath`. */
function countResources(collection: Collection, folderPath: string): number {
  let totalResources = 0;
  for (const { folder } of sweepCollection(collection, { startPath: folderPath })) {
    totalResources += folder?.keys().length ?? 0;
  }
  return totalResources;
}
