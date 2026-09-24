import { deleteCollectionByName } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';

export interface DeleteCollectionOptions {
  collectionName?: string;
}

/** Removes a collection's registration, so a read-only collection may be deleted too. */
export const deleteCollectionCommand = defineCommand<DeleteCollectionOptions>()({
  name: 'Delete collection',
  collection: 'read',
  collectionOption: 'collectionName',
  run: ({ collection, cwd }) => {
    const result = deleteCollectionByName(collection.name, { cwd });
    console.log(result.message);
  },
});
