import * as path from 'path';
import { CONFIG_FILENAME, deleteCollectionByName } from '@simoncodes-ca/core';
import { CommandCancelledError, defineCommand } from '../runner/command-runner';

export interface DeleteCollectionOptions {
  collectionName?: string;
  /** Skip the confirmation prompt. */
  yes?: boolean;
}

/**
 * Removes a collection's registration, so a read-only collection may be deleted too.
 * Interactive, it asks first unless `--yes`: the runner may have auto-selected the only
 * collection. Non-interactive, the flags are the consent.
 */
export const deleteCollectionCommand = defineCommand<DeleteCollectionOptions>()({
  name: 'Delete collection',
  collection: 'read',
  collectionOption: 'collectionName',
  run: async ({ collection, cwd, answers, interactive, ask }) => {
    if (!answers.yes && interactive) {
      const folder = path.relative(cwd, collection.translationsFolder) || '.';
      const { confirmed } = await ask({
        type: 'confirm',
        name: 'confirmed',
        message: `Delete collection "${collection.name}" (translations folder: ${folder})? It is removed from ${CONFIG_FILENAME}; its files are kept.`,
        initial: false,
      });
      if (confirmed !== true) {
        throw new CommandCancelledError();
      }
    }

    const result = deleteCollectionByName(collection.name, { cwd });
    console.log(result.message);
  },
});
