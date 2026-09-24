import { type Collection, moveResource, openCollection } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';

export interface MoveResourceOptions {
  collection?: string;
  source?: string;
  dest?: string;
  destCollection?: string;
  override?: boolean;
  verbose?: boolean;
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
      console.log(`✅ Moved ${result.movedCount} resource(s)`);
    } else {
      console.log('⚠️  No resources were moved.');
    }

    if (result.warnings && result.warnings.length > 0) {
      console.log('\n⚠️  Warnings:');
      for (const warning of result.warnings) {
        console.log(`   - ${warning}`);
      }
    }

    if (result.errors && result.errors.length > 0) {
      console.log('\n❌ Errors:');
      for (const error of result.errors) {
        console.log(`   - ${error}`);
      }
      return { exitCode: 1 };
    }
  },
});
