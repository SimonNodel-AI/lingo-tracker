import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { isValidSegment } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';
import { InvalidFolderPathError } from '../errors/lingo-tracker-error';
import { ensureDirectoryExists } from '../file-io/directory-operations';
import { folderMutation, type ResourceMutation } from '../resource/resource-mutation';

export interface CreateFolderParams {
  /** The folder name to create (dot-delimited path segments) */
  readonly folderName: string;
  /** Optional parent path (dot-delimited) to nest the folder under */
  readonly parentPath?: string;
}

export interface CreateFolderResult {
  /** Absolute path to the created folder */
  readonly folderPath: string;
  /** Whether the folder was newly created (true) or already existed (false) */
  readonly created: boolean;
  /** An `add-folder` when the folder was created; empty when it already existed. */
  readonly mutations: ResourceMutation[];
}

/**
 * Creates a folder in a collection's translations folder.
 *
 * This function:
 * 1. Validates the folder name segments using the same rules as resource keys
 * 2. Combines parentPath with folderName if provided
 * 3. Converts dot-delimited path to filesystem path
 * 4. Creates the directory (and any parent directories) if needed
 * 5. Returns whether the folder was newly created
 *
 * @param collection - The collection to create the folder in
 * @param params - Folder creation parameters
 * @returns Object containing the folder path and creation status
 * @throws {InvalidFolderPathError} The folder name or parent path has a malformed segment.
 *
 * @example
 * ```typescript
 * // Create a top-level folder
 * const result = createFolder(collection, {
 *   folderName: 'apps'
 * });
 * // Result: { folderPath: '<translationsFolder>/apps', created: true }
 *
 * // Create a nested folder
 * const result = createFolder(collection, {
 *   folderName: 'buttons',
 *   parentPath: 'apps.common'
 * });
 * // Result: { folderPath: '<translationsFolder>/apps/common/buttons', created: true }
 *
 * // Create a multi-segment folder
 * const result = createFolder(collection, {
 *   folderName: 'apps.common.buttons'
 * });
 * // Result: { folderPath: '<translationsFolder>/apps/common/buttons', created: true }
 * ```
 */
export function createFolder(collection: Collection, params: CreateFolderParams): CreateFolderResult {
  const { folderName, parentPath } = params;
  const { translationsFolder } = collection;

  // Validate folderName segments
  const folderSegments = folderName.split('.');
  for (const segment of folderSegments) {
    if (!isValidSegment(segment)) {
      throw new InvalidFolderPathError('folder name', segment);
    }
  }

  // Validate parentPath segments if provided
  if (parentPath && parentPath.trim() !== '') {
    const parentSegments = parentPath.split('.');
    for (const segment of parentSegments) {
      if (!isValidSegment(segment)) {
        throw new InvalidFolderPathError('parent path', segment);
      }
    }
  }

  // Combine parent path and folder name
  const fullDotPath = parentPath && parentPath.trim() !== '' ? `${parentPath}.${folderName}` : folderName;

  // Convert dot-delimited path to filesystem path
  const pathSegments = fullDotPath.split('.');
  const relativeFolderPath = pathSegments.length ? join(translationsFolder, ...pathSegments) : translationsFolder;

  // Resolve to absolute path
  const absoluteFolderPath = resolve(relativeFolderPath);

  // Check if folder already exists
  const alreadyExists = existsSync(absoluteFolderPath);

  // Create the directory (idempotent operation)
  ensureDirectoryExists({
    directoryPath: absoluteFolderPath,
    errorContext: 'Creating folder',
    checkWritable: true,
  });

  return {
    folderPath: absoluteFolderPath,
    created: !alreadyExists,
    mutations: alreadyExists ? [] : [folderMutation('add-folder', translationsFolder, fullDotPath)],
  };
}
