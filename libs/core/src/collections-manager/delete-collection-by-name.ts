import { updateConfig } from '../lib/config/config-file-operations';
import { CollectionNotFoundError } from '../lib/errors/lingo-tracker-error';

export interface DeleteCollectionOptions {
  cwd?: string;
}

export function deleteCollectionByName(
  collectionName: string,
  options: DeleteCollectionOptions = {},
): { message: string } {
  updateConfig((config) => {
    if (!config.collections || !config.collections[collectionName]) {
      throw new CollectionNotFoundError(collectionName);
    }

    delete config.collections[collectionName];

    return config;
  }, options.cwd);

  return { message: `Collection "${collectionName}" deleted successfully` };
}
