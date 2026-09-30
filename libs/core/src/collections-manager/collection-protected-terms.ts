import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import {
  resolveWritableCollectionProtectedTermsPath,
  writeProtectedTermsFile,
} from '../lib/config/protected-terms-file';
import { assertProtectedTerms } from '../lib/config/set-protected-terms';
import { CollectionNotFoundError } from '../lib/errors/lingo-tracker-error';

/** Check the resulting entry and destination before a collection lifecycle write begins. */
export function prepareCollectionProtectedTerms(
  config: LingoTrackerConfig,
  collectionName: string,
  terms: string[] | undefined,
  cwd: string,
): (() => void) | undefined {
  if (terms === undefined) return undefined;
  assertProtectedTerms(terms);
  const collection = config.collections[collectionName];
  if (!collection) throw new CollectionNotFoundError(collectionName);
  const filePath = resolveWritableCollectionProtectedTermsPath(collectionName, collection, cwd);
  return () => writeProtectedTermsFile(filePath, terms);
}
