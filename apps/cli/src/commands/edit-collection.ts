import { updateCollection } from '@simoncodes-ca/core';
import { normalizeTags } from '@simoncodes-ca/domain';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export interface EditCollectionOptions {
  addTag?: string[];
  removeTag?: string[];
  setTags?: string;
}

const run = defineCommand<EditCollectionOptions & { name: string }>()({
  name: 'Edit collection',
  // Edits the collection's registration (tags), not its resources, so a read-only collection is allowed.
  collection: 'read',
  collectionOption: 'name',
  run: async ({ collection, cwd, answers }) => {
    const hasAdd = (answers.addTag ?? []).length > 0;
    const hasRemove = (answers.removeTag ?? []).length > 0;
    const hasSet = answers.setTags !== undefined;

    if (hasSet && (hasAdd || hasRemove)) {
      throw new Error('--set-tags cannot be combined with --add-tag or --remove-tag');
    }

    if (!hasAdd && !hasRemove && !hasSet) {
      throw new Error('Provide at least one of --add-tag, --remove-tag, or --set-tags');
    }

    const stored = collection.config;
    let currentTags = [...(stored.tags ?? [])];

    if (hasSet) {
      currentTags = normalizeTags(
        (answers.setTags ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      );
    } else {
      for (const tag of normalizeTags(answers.addTag ?? [])) {
        if (!currentTags.includes(tag)) {
          currentTags.push(tag);
        }
      }
      const toRemove = normalizeTags(answers.removeTag ?? []);
      currentTags = currentTags.filter((t) => !toRemove.includes(t));
    }

    await updateCollection(collection.name, undefined, { ...stored, tags: currentTags }, { cwd });

    if (currentTags.length === 0) {
      ConsoleFormatter.success(`Collection "${collection.name}" tags cleared`);
    } else {
      ConsoleFormatter.success(`Collection "${collection.name}" tags updated: ${currentTags.join(', ')}`);
    }
  },
});

/** `edit-collection <name>`: the collection is the positional argument. */
export function editCollectionCommand(collectionName: string, options: EditCollectionOptions): Promise<void> {
  return run({ ...options, name: collectionName });
}
