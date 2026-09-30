import { normalizeTags } from '@simoncodes-ca/domain';
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
  const hasAdd = (edit.add ?? []).length > 0;
  const hasRemove = (edit.remove ?? []).length > 0;
  if (edit.set !== undefined && (hasAdd || hasRemove)) {
    throw new InvalidCollectionError(ErrorMessages.collectionTagEditConflict());
  }
  if (edit.set === undefined && !hasAdd && !hasRemove) {
    throw new InvalidCollectionError(ErrorMessages.collectionTagEditMissing());
  }

  let tags: string[] = [];
  createConfigFileOperations(options).update((config) => {
    const current = config.collections[name];
    // patchCollectionEntry supplies the typed not-found error.
    const storedTags = normalizeTags(current?.tags ?? []);
    if (edit.set !== undefined) {
      tags = normalizeTags(
        edit.set
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
      );
    } else {
      tags = [...storedTags];
      for (const tag of normalizeTags(edit.add ?? [])) {
        if (!tags.includes(tag)) tags.push(tag);
      }
      const removed = normalizeTags(edit.remove ?? []);
      tags = tags.filter((tag) => !removed.includes(tag));
    }
    return patchCollectionEntry(config, name, { tags });
  });
  return tags;
}
