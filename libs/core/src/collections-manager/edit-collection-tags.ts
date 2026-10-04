import { type ListEdit, validateListEdit, mergeListEdit, normalizeTags } from '@simoncodes-ca/domain';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { guardedConfigWrite } from '../lib/config/config-file-operations';
import type { OpenedCollection } from '../lib/config/open-collection';
import { ErrorMessages } from '../lib/errors/error-messages';
import { InvalidCollectionError } from '../lib/errors/lingo-tracker-error';

export type CollectionTagEdit = ListEdit;

/** Edits the opened registration's inherited tags and normalizes the result. */
export function editCollectionTags(collection: OpenedCollection, edit: CollectionTagEdit): string[] {
  validateListEdit(edit, {
    shape: () => new InvalidCollectionError('Tag edit lists must be arrays of strings'),
    conflict: () => new InvalidCollectionError(ErrorMessages.collectionTagEditConflict(), { problem: 'tag-conflict' }),
    missing: () => new InvalidCollectionError(ErrorMessages.collectionTagEditMissing(), { problem: 'tag-missing' }),
  });

  const { sourceConfig: config, name } = collection;

  const storedTags = normalizeTags(collection.config.tags ?? []);
  const tags = mergeListEdit(storedTags, edit, normalizeTags);
  guardedConfigWrite(collection).write(patchCollectionEntry(config, name, { tags }));
  return tags;
}
