import { type Collection, moveResource, openCollection } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export interface MoveResourceOptions {
  collection?: string;
  source?: string;
  dest?: string;
  destCollection?: string;
  override?: boolean;
}

const required = (val: string) => (val && val.trim().length > 0 ? true : 'Required');

export const moveResourceCommand = defineCommand<MoveResourceOptions>()({
  name: 'Move resource',
  collection: 'writable',
  prompts: (options) => [
    ...(options.source
      ? []
      : [
          {
            type: 'text' as const,
            name: 'source',
            message: 'Source key or pattern (e.g. common.buttons.ok or common.buttons.*)',
            validate: required,
          },
        ]),
    ...(options.dest
      ? []
      : [
          {
            type: 'text' as const,
            name: 'dest',
            message: 'Destination key (e.g. common.actions.ok)',
            validate: required,
          },
        ]),
  ],
  required: ['source', 'dest'],
  run: async ({ collection, config, cwd, answers }) => {
    const destinationCollection: Collection | undefined = answers.destCollection
      ? openCollection(config, answers.destCollection, { cwd, writable: true })
      : undefined;

    const result = await moveResource(collection, {
      source: answers.source,
      destination: answers.dest,
      override: answers.override,
      destinationCollection,
    });

    if (result.movedCount > 0) {
      ConsoleFormatter.success(`Moved ${result.movedCount} resource(s)`);
    } else {
      ConsoleFormatter.warning('No resources were moved.');
    }

    if (result.warnings && result.warnings.length > 0) {
      ConsoleFormatter.warning(
        'Warnings:',
        result.warnings.map((warning) => `- ${warning}`),
      );
    }

    if (result.errors && result.errors.length > 0) {
      ConsoleFormatter.error(
        'Errors:',
        result.errors.map((error) => `- ${error}`),
      );
      return { exitCode: 1 };
    }
  },
});
