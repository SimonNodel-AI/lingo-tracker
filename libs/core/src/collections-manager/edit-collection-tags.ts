import { listEditProblem, mergeListEdit, normalizeTags } from '@simoncodes-ca/domain';
import { patchCollectionEntry } from '../lib/config/collection-entry';
import { createConfigFileOperations } from '../lib/config/config-file-operations';
import { InvalidCollectionError } from '../lib/errors/lingo-tracker-error';
import { ErrorMessages } from '../lib/errors/error-messages';

export interface CollectionTagEdit {
  readonly add?: string[];
  readonly remove?: string[];
  readonly set?: string;
}

/** Edits the registration's inherited tags, including flag rules and normalization. */
export function editCollectionTags(name: string, edit: CollectionTagEdit, options: { cwd?: string } = {}): string[] {
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
