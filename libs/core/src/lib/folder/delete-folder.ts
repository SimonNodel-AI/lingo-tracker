import { existsSync, rmSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { walkFolders } from '../normalize/iterative-folder-walker';
import { isValidSegment } from '@simoncodes-ca/domain';
import { InvalidFolderPathError } from '../errors/lingo-tracker-error';
import { openResourceFolder } from '../resource/resource-folder';
import { folderMutation, type ResourceMutation } from '../resource/resource-mutation';

export interface DeleteFolderParams {
  /** The folder path to delete (dot-delimited path like "apps.common.buttons") */
  readonly folderPath: string;
}

export interface DeleteFolderResult {
  /** The dot-delimited folder path that was deleted */
  readonly folderPath: string;
  /** Whether the folder was successfully deleted */
  readonly deleted: boolean;
  /** Number of resource entries that were deleted */
  readonly resourcesDeleted: number;
  /** Error message if deletion failed */
  readonly error?: string;
  /** A `remove-folder` when the folder was deleted, otherwise empty. */
  readonly mutations: ResourceMutation[];
}

/**
 * Deletes a folder and all its contents from the translations directory structure.
 *
 * This function:
 * 1. Validates the folder path segments
 * 2. Converts dot-delimited path to filesystem path
 * 3. Counts all resource entries in the folder tree
 * 4. Recursively deletes the folder and all its contents
 *
 * @param translationsFolder - Root translations folder path
 * @param params - Folder deletion parameters
 * @returns Object containing deletion status and resource count
 *
 * @example
 * ```typescript
 * // Delete a folder
 * const result = deleteFolder('/app/translations', {
 *   folderPath: 'apps.common.buttons'
 * });
 * // Result: { folderPath: 'apps.common.buttons', deleted: true, resourcesDeleted: 5 }
 *
 * // Attempt to delete non-existent folder
 * const result = deleteFolder('/app/translations', {
 *   folderPath: 'apps.nonexistent'
 * });
 * // Result: { folderPath: 'apps.nonexistent', deleted: false, resourcesDeleted: 0, error: '...' }
 * ```
 */
export function deleteFolder(translationsFolder: string, params: DeleteFolderParams): DeleteFolderResult {
  const { folderPath } = params;

  try {
    // Validate folder path segments
    const pathSegments = folderPath.split('.');
    for (const segment of pathSegments) {
      if (!isValidSegment(segment)) {
        throw new InvalidFolderPathError('folder path', segment);
      }
    }

    // Convert dot-delimited path to filesystem path
    const relativeFolderPath = pathSegments.length ? join(translationsFolder, ...pathSegments) : translationsFolder;

    // Resolve to absolute path
    const absoluteFolderPath = resolve(relativeFolderPath);

    // Check if folder exists
    if (!existsSync(absoluteFolderPath)) {
      return {
        folderPath,
        deleted: false,
        resourcesDeleted: 0,
        mutations: [],
        error: `Folder not found: ${absoluteFolderPath}`,
      };
    }

    // Verify it's a directory
    const stats = statSync(absoluteFolderPath);
    if (!stats.isDirectory()) {
      return {
        folderPath,
        deleted: false,
        resourcesDeleted: 0,
        mutations: [],
        error: `Path is not a directory: ${absoluteFolderPath}`,
      };
    }

    // Count resources before deletion
    const resourcesDeleted = countResourcesInFolder(absoluteFolderPath);

    // Delete the folder recursively
    rmSync(absoluteFolderPath, { recursive: true, force: true });

    return {
      folderPath,
      deleted: true,
      resourcesDeleted,
      mutations: [folderMutation('remove-folder', translationsFolder, folderPath)],
    };
  } catch (error) {
    return {
      folderPath,
      deleted: false,
      resourcesDeleted: 0,
      mutations: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
