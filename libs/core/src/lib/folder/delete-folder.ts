import { existsSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { walkFolders } from '../normalize/iterative-folder-walker';
import { isValidSegment } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { FolderNotFoundError, InvalidFolderPathError } from '../errors/lingo-tracker-error';
import { openResourceFolder } from '../resource/resource-folder';
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
 * 3. Counts all resource entries in the folder tree
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

  const pathSegments = folderPath.split('.');
  for (const segment of pathSegments) {
    if (!isValidSegment(segment)) {
      throw new InvalidFolderPathError('folder path', segment);
    }
  }

  const absoluteFolderPath = resolve(join(translationsFolder, ...pathSegments));
  if (!existsSync(absoluteFolderPath) || !statSync(absoluteFolderPath).isDirectory()) {
    throw new FolderNotFoundError(folderPath);
  }

  const resourcesDeleted = countResourcesInFolder(absoluteFolderPath);
  rmSync(absoluteFolderPath, { recursive: true, force: true });

  return {
    folderPath,
    resourcesDeleted,
    mutations: [folderMutation('remove-folder', translationsFolder, folderPath)],
  };
}
/**
 * Counts all resource entries in a folder tree.
 *
 * @param folderPath - Absolute path to the folder
 * @returns Total number of resource entries
 */
function countResourcesInFolder(folderPath: string): number {
  let totalResources = 0;

  for (const visit of walkFolders(folderPath, { skipHidden: false })) {
    try {
      totalResources += openResourceFolder(visit.absolutePath).keys().length;
    } catch {
      // Malformed JSON or read error, skip counting
    }
  }

  return totalResources;
}
