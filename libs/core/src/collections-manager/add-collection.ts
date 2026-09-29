import type { LingoTrackerCollection } from '../config/lingo-tracker-collection';
import { addCollectionEntry } from '../lib/config/collection-entry';
import { updateConfig } from '../lib/config/config-file-operations';

export interface AddCollectionOptions {
  cwd?: string;
}

/**
 * Registers a collection in the config. The stored record is the [Collection Entry]
 * (`lib/config/collection-entry.ts`): `translationsFolder` plus the settings that differ
 * from the global config; a folder under `node_modules` is read-only unless told otherwise.
 *
 * @throws {CollectionAlreadyExistsError} A collection with this name exists.
 * @throws {InvalidCollectionError} `translationsFolder` is missing or blank.
 */
export function addCollection(
  collectionName: string,
  collection: LingoTrackerCollection,
  options: AddCollectionOptions = {},
): { message: string } {
  updateConfig((config) => addCollectionEntry(config, collectionName, collection), options.cwd);

  return { message: `Collection "${collectionName}" added successfully` };
}
