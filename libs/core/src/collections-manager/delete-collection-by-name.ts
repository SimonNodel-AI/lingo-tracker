import { resolve } from 'node:path';
import { updateConfig } from '../lib/config/config-file-operations';
import { CollectionNotFoundError } from '../lib/errors/lingo-tracker-error';
import { reindexMutation, type ResourceMutation } from '../lib/resource/resource-mutation';
import { removeBundleCollectionReferences } from './bundle-collection-references';

export interface DeleteCollectionOptions {
  cwd?: string;
}

/**
 * Unregister a collection and remove its explicit bundle references in one config write.
 * Translation files are kept. A refused deletion changes neither config nor files.
 *
 * @throws {CollectionNotFoundError} No collection named `collectionName`.
 * @throws {CollectionRequiredByBundleError} A bundle would have no collections after removal.
 */
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

    removeBundleCollectionReferences(config, collectionName);
    delete config.collections[collectionName];

    return config;
  }, options.cwd);

  return {
    message: `Collection "${collectionName}" deleted successfully`,
    mutations: translationsFolder === undefined ? [] : [reindexMutation(translationsFolder)],
  };
}
