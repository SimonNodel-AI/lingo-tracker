import type { LingoTrackerCollection } from '../config/lingo-tracker-collection';
import { addCollectionEntry } from '../lib/config/collection-entry';
import { createConfigFileOperations } from '../lib/config/config-file-operations';
import { assertProtectedTerms } from '../lib/config/set-protected-terms';
import { prepareCollectionProtectedTerms } from './collection-protected-terms';

export interface AddCollectionOptions {
  cwd?: string;
  protectedTerms?: string[];
}

/**
 * Registers a collection in the config. The stored record is the [Collection Entry]
 * (`lib/config/collection-entry.ts`): `translationsFolder` plus the settings that differ
 * from the global config; a folder under `node_modules` is read-only unless told otherwise.
 * All preconditions are checked before writing. The write order is config, then terms.
 * If the terms write itself fails, the new config entry remains written.
 *
 * @throws {CollectionAlreadyExistsError} A collection with this name exists.
 * @throws {InvalidCollectionError} `translationsFolder` is missing or blank.
 * @throws {InvalidCollectionError} Protected terms are not an array of strings.
 * @throws {ProtectedTermsFileNotSetError} Terms were supplied without a file pointer.
 * @throws {ParentDirectoryMissingError} The terms file's parent directory is missing.
 */
export function addCollection(
  collectionName: string,
  collection: LingoTrackerCollection,
  options: AddCollectionOptions = {},
): { message: string } {
  if (options.protectedTerms !== undefined) assertProtectedTerms(options.protectedTerms);
  const cwd = options.cwd ?? process.cwd();
  const configFile = createConfigFileOperations({ cwd });
  const nextConfig = addCollectionEntry(configFile.read(), collectionName, collection);
  const writeTerms = prepareCollectionProtectedTerms(nextConfig, collectionName, options.protectedTerms, cwd);
  configFile.write(nextConfig);
  writeTerms?.();

  return { message: `Collection "${collectionName}" added successfully` };
}
