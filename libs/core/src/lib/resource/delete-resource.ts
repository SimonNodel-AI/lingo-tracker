import { CoreOperationError, FolderNotFoundError, ResourceNotFoundError } from '../errors/lingo-tracker-error';
import { existsSync } from 'node:fs';
import { resolveResourcePaths } from './resource-file-paths';
import { openResourceFolder, type ResourceFolder } from './resource-folder';
import { removeMutation, type ResourceMutation } from './resource-mutation';
import { validateKey } from '@simoncodes-ca/domain';
import type { Collection } from '../config/open-collection';

export interface DeleteResourceParams {
  keys: string[];
}

export interface DeleteResourceResult {
  entriesDeleted: number;
  errors?: Array<{
    key: string;
    error: string;
  }>;
  /** One `remove` per deleted key. */
  mutations: ResourceMutation[];
}

/** Deletes entries from a collection. Per-key failures are reported in the result, not thrown. */
export function deleteResource(collection: Collection, params: DeleteResourceParams): DeleteResourceResult {
  const { translationsFolder, baseLocale } = collection;
  let entriesDeleted = 0;
  const errors: Array<{ key: string; error: string }> = [];
  const mutations: ResourceMutation[] = [];

  for (const key of params.keys) {
    try {
      const deletionSucceeded = deleteSingleResource(translationsFolder, baseLocale, key);
      if (deletionSucceeded) {
        entriesDeleted++;
        mutations.push(removeMutation(translationsFolder, key));
      }
    } catch (caughtError) {
      const message = (caughtError as { message?: string })?.message || 'Unknown error occurred';
      errors.push({
        key,
        error: message,
      });
    }
  }

  return {
    entriesDeleted,
    errors: errors.length > 0 ? errors : undefined,
    mutations,
  };
}

function deleteSingleResource(translationsFolder: string, baseLocale: string, key: string): boolean {
  validateKey(key);

  const paths = resolveResourcePaths({
    key,
    translationsFolder,
  });

  const folderAddress = paths.folderPathSegments.join('.') || '.';
  if (!existsSync(paths.folderPath)) {
    throw new FolderNotFoundError(folderAddress);
  }
  if (!existsSync(paths.resourceEntriesPath)) {
    throw new ResourceNotFoundError(paths.resolvedKey);
  }

  let folder: ResourceFolder;
  try {
    folder = openResourceFolder(paths.folderPath, { baseLocale });
  } catch (caughtError) {
    throw new CoreOperationError(
      `Failed to delete resource ${paths.resolvedKey}: folder ${folderAddress} has unreadable resource files`,
      { cause: caughtError },
    );
  }

  let removed: boolean;
  try {
    removed = folder.remove(paths.entryKey);
  } catch (caughtError) {
    throw new CoreOperationError(
      `Failed to delete resource ${paths.resolvedKey}: could not update folder ${folderAddress}`,
      {
        cause: caughtError,
      },
    );
  }
  if (!removed) {
    throw new ResourceNotFoundError(paths.resolvedKey);
  }

  try {
    // Removes both files when this was the folder's last entry.
    folder.save();
  } catch (caughtError) {
    throw new CoreOperationError(
      `Failed to delete resource ${paths.resolvedKey}: could not write folder ${folderAddress}`,
      {
        cause: caughtError,
      },
    );
  }

  return true;
}
