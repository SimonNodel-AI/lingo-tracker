import { type ListEdit, listEditProblem, mergeListEdit, normalizeTags } from '@simoncodes-ca/domain';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { createConfigFileOperations } from '../lib/config/config-file-operations';
import { ErrorMessages } from '../lib/errors/error-messages';
import { InvalidCollectionError } from '../lib/errors/lingo-tracker-error';

export type CollectionTagEdit = ListEdit;

/** Edits the registration's inherited tags and normalizes the result. */
export function editCollectionTags(name: string, edit: CollectionTagEdit, options: { cwd?: string } = {}): string[] {
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

  let tags: string[] = [];
  createConfigFileOperations(options).update((config) => {
    const current = config.collections[name];
    // patchCollectionEntry supplies the typed not-found error.
    const storedTags = normalizeTags(current?.tags ?? []);
    tags = mergeListEdit(storedTags, edit, normalizeTags);
    return patchCollectionEntry(config, name, { tags });
  });
  return tags;
}
