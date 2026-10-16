import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import { removeBundleCollectionReferences } from '../lib/bundle/bundle-definition-operations';
import { guardedConfigWrite } from '../lib/config/config-file-operations';
import type { OpenedCollection } from '../lib/config/open-collection';
import { type MutationSinkOptions, reindexMutation, resolveMutationSink } from '../lib/resource/resource-mutation';

/** Unregister a collection and its explicit bundle references in one guarded config write. */
export function deleteCollection(collection: OpenedCollection, options: MutationSinkOptions = {}): { message: string } {
  const { sourceConfig: config, name } = collection;
  const configWrite = guardedConfigWrite(collection);
  const next: LingoTrackerConfig = { ...config, collections: { ...config.collections } };
  removeBundleCollectionReferences(next, name);
  delete next.collections[name];
  configWrite.write(next);
  if (typeof collection.config.translationsFolder === 'string') {
    resolveMutationSink(collection, options)?.(reindexMutation(collection.translationsFolder));
  }
  return { message: `Collection "${name}" deleted successfully` };
}
