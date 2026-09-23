import { existsSync } from 'node:fs';
import { resolveResourcePaths } from '../lib/resource/resource-file-paths';
import { openResourceFolder } from '../lib/resource/resource-folder';
import { validateKey } from '@simoncodes-ca/domain';

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

export function deleteResource(translationsFolder: string, params: DeleteResourceParams): DeleteResourceResult {
  let entriesDeleted = 0;
  const errors: Array<{ key: string; error: string }> = [];

  for (const key of params.keys) {
    try {
      const deletionSucceeded = deleteSingleResource(translationsFolder, key);
      if (deletionSucceeded) {
        entriesDeleted++;
      }
    } catch (caughtError) {
      errors.push({
        key,
        error: (caughtError as { message?: string })?.message || 'Unknown error occurred',
      });
    }
  }

  return {
    entriesDeleted,
    errors: errors.length > 0 ? errors : undefined,
  };
}

function deleteSingleResource(translationsFolder: string, key: string): boolean {
  validateKey(key);

  const paths = resolveResourcePaths({
    key,
    translationsFolder,
  });

  if (!existsSync(paths.folderPath)) {
    throw new Error(`Folder not found: ${paths.folderPath}`);
  }

  if (!existsSync(paths.resourceEntriesPath)) {
    throw new Error(`Resource file not found: ${paths.resourceEntriesPath}`);
  }

  const folder = openResourceFolder(paths.folderPath);

  if (!folder.remove(paths.entryKey)) {
    throw new Error(`Resource entry not found: ${key}`);
  }

  // Removes both files when this was the folder's last entry.
  folder.save();

  return true;
}
