import { editCollectionTags } from '@simoncodes-ca/core';
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
    if (answers.setTags !== undefined && ((answers.addTag ?? []).length > 0 || (answers.removeTag ?? []).length > 0)) {
      throw new Error('--set-tags cannot be combined with --add-tag or --remove-tag');
    }
    if (
      answers.setTags === undefined &&
      (answers.addTag ?? []).length === 0 &&
      (answers.removeTag ?? []).length === 0
    ) {
      throw new Error('Provide at least one of --add-tag, --remove-tag, or --set-tags');
    }
    const currentTags = editCollectionTags(
      collection.name,
      { add: answers.addTag, remove: answers.removeTag, set: answers.setTags?.split(',') },
      { cwd },
    );

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
