import { deleteResource } from '@simoncodes-ca/core';
import { type Ask, CommandCancelledError, defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, parseCommaSeparatedList } from '../utils';

export interface DeleteResourceOptions {
  collection?: string;
  key?: string;
  yes?: boolean;
}

export const deleteResourceCommand = defineCommand<DeleteResourceOptions>()({
  name: 'Delete resource',
  collection: 'writable',
  prompts: (options) =>
    options.key
      ? []
      : [
          {
            type: 'text',
            name: 'key',
            message: 'Resource key(s) (single key or comma-separated)',
            validate: (val: string) => (val && val.trim().length > 0 ? true : 'Required'),
          },
        ],
  required: ['key'],
  run: async ({ collection, answers, interactive, ask }) => {
    const keys = parseCommaSeparatedList(answers.key) ?? [];
    if (keys.length === 0) {
      throw new Error('No valid keys provided.');
    }

    // Confirm unless --yes, or non-interactive (nobody to ask).
    if (!answers.yes && interactive && !(await confirmDeletion(keys, ask))) {
      throw new CommandCancelledError();
    }

    const result = deleteResource(collection, { keys });

    if (result.entriesDeleted === 0) {
      ConsoleFormatter.warning('No resources were deleted.');
    } else {
      ConsoleFormatter.success(`Deleted ${result.entriesDeleted} resource(s)`);
    }

    if (result.errors && result.errors.length > 0) {
      ConsoleFormatter.warning(
        'Some operations failed:',
        result.errors.map((error) => `- ${error.key}: ${error.error}`),
      );
      return { exitCode: 1 };
    }
  },
});

async function confirmDeletion(keys: string[], ask: Ask): Promise<boolean> {
  console.log('\nYou are about to delete:');

  if (keys.length === 1) {
    console.log(`  ${keys[0]}`);
  } else {
    console.log(`  ${keys.length} resources:`);
    for (const key of keys) {
      console.log(`  - ${key}`);
    }
  }

  ConsoleFormatter.warning('This will remove translations for all locales.');

  const response = await ask({
    type: 'confirm',
    name: 'confirmed',
    message: 'Are you sure?',
    initial: false,
  });

  return response.confirmed === true;
}
