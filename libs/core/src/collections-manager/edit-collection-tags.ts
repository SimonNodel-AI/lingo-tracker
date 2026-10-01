import { listEditProblem, mergeListEdit, normalizeTags } from '@simoncodes-ca/domain';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { type ConfigFileOperations, prepareConfigSnapshot } from '../lib/config/config-file-operations';
import type { OpenedCollection } from '../lib/config/open-collection';
import { ErrorMessages } from '../lib/errors/error-messages';
import { InvalidCollectionError } from '../lib/errors/lingo-tracker-error';

export interface CollectionTagEdit {
  readonly add?: string[];
  readonly remove?: string[];
  readonly set?: string;
}

/** Edits the registration's inherited tags, including flag rules and normalization. */
export function editCollectionTags(
  collection: OpenedCollection,
  configFile: Pick<ConfigFileOperations, 'write'>,
  edit: CollectionTagEdit,
): string[] {
  const problem = listEditProblem(edit);
  if (problem === 'conflict') {
    throw new InvalidCollectionError(ErrorMessages.collectionTagEditConflict());
  }
  if (problem === 'missing') {
    throw new InvalidCollectionError(ErrorMessages.collectionTagEditMissing());
  }

  const { sourceConfig: config, name } = collection;
  prepareConfigSnapshot(config);
  const storedTags = normalizeTags(collection.config.tags ?? []);
  const tags = mergeListEdit(storedTags, edit, normalizeTags);
  configFile.write(patchCollectionEntry(config, name, { tags }));
  return tags;
}
