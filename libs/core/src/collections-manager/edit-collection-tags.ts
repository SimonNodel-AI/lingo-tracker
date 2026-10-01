import { type ListEdit, listEditProblem, mergeListEdit, normalizeTags } from '@simoncodes-ca/domain';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { type ConfigFileOperations, prepareConfigSnapshot } from '../lib/config/config-file-operations';
import type { OpenedCollection } from '../lib/config/open-collection';
import { ErrorMessages } from '../lib/errors/error-messages';
import { InvalidCollectionError } from '../lib/errors/lingo-tracker-error';

export type CollectionTagEdit = ListEdit;

/** Edits the opened registration's inherited tags and normalizes the result. */
export function editCollectionTags(
  collection: OpenedCollection,
  configFile: Pick<ConfigFileOperations, 'write'>,
  edit: CollectionTagEdit,
): string[] {
  for (const values of [edit.add, edit.remove, edit.set]) {
    if (values !== undefined && (!Array.isArray(values) || values.some((value) => typeof value !== 'string'))) {
      throw new InvalidCollectionError('Tag edit lists must be arrays of strings');
    }
  }
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
