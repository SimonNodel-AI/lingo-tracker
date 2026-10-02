import {
  CoreOperationError,
  InvalidCollectionFolderError,
  FolderNotFoundError,
  ResourceNotFoundError,
} from '../errors/lingo-tracker-error';
import { existsSync } from 'node:fs';
import { resolveResourcePaths } from './resource-file-paths';
import { openResourceFolder, type ResourceFolder } from './resource-folder';
import { removeMutation, saveReporting, type MutationSink, type MutationSinkOptions } from './resource-mutation';
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
}

/** Deletes entries after checking every key's folder. Folder-policy refusals throw; other per-key failures are reported. */
export function deleteResource(
  collection: Collection,
  params: DeleteResourceParams,
  options: MutationSinkOptions = {},
): DeleteResourceResult {
  const { translationsFolder, baseLocale } = collection;
  let entriesDeleted = 0;
  const errors: Array<{ key: string; error: string }> = [];

  // Refuse the whole request before writes or mutations if any key targets an inaccessible folder.
  for (const key of params.keys) {
    try {
      validateKey(key);
      resolveResourcePaths({ key, translationsFolder });
    } catch (error) {
      if (error instanceof InvalidCollectionFolderError) throw error;
      // Ordinary key errors are collected by the delete loop below.
    }
  }

  for (const key of params.keys) {
    try {
      const deletionSucceeded = deleteSingleResource(translationsFolder, baseLocale, key, options.onMutation);
      if (deletionSucceeded) {
        entriesDeleted++;
      }
    } catch (caughtError) {
      if (caughtError instanceof InvalidCollectionFolderError) throw caughtError;
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
  };
}

function deleteSingleResource(
  translationsFolder: string,
  baseLocale: string,
  key: string,
  onMutation?: MutationSink,
): boolean {
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
    folder = openResourceFolder(paths.folderPath, { baseLocale, translationsFolder });
  } catch (caughtError) {
    if (caughtError instanceof InvalidCollectionFolderError) throw caughtError;
    throw new CoreOperationError(
      `Failed to delete resource ${paths.resolvedKey}: folder ${folderAddress} has unreadable resource files`,
      { cause: caughtError },
    );
  }

  let removed: boolean;
  try {
    removed = folder.remove(paths.entryKey);
  } catch (caughtError) {
    if (caughtError instanceof InvalidCollectionFolderError) throw caughtError;
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
    saveReporting(folder, translationsFolder, onMutation, () => [removeMutation(translationsFolder, key)]);
  } catch (caughtError) {
    if (caughtError instanceof InvalidCollectionFolderError) throw caughtError;
    throw new CoreOperationError(
      `Failed to delete resource ${paths.resolvedKey}: could not write folder ${folderAddress}`,
      {
        cause: caughtError,
      },
    );
  }

  return true;
}
