import { resolve } from 'node:path';
import { updateConfig } from '../lib/config/config-file-operations';
import { CollectionNotFoundError } from '../lib/errors/lingo-tracker-error';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';

export interface DeleteCollectionOptions {
  cwd?: string;
}

export function deleteCollectionByName(
  collectionName: string,
  options: DeleteCollectionOptions = {},
): { message: string; mutations: ResourceMutation[] } {
  let translationsFolder: string | undefined;
  updateConfig((config) => {
    if (!config.collections || !config.collections[collectionName]) {
      throw new CollectionNotFoundError(collectionName);
    }

    const folder = config.collections[collectionName].translationsFolder;
    translationsFolder = typeof folder === 'string' ? resolve(options.cwd ?? process.cwd(), folder) : undefined;

    delete config.collections[collectionName];

    return config;
  }, options.cwd);

  return {
    message: `Collection "${collectionName}" deleted successfully`,
    mutations: translationsFolder === undefined ? [] : [reindexMutation(translationsFolder)],
  };
}
