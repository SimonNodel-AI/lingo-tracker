import { executeMove } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, missingTextQuestions, printRunReport } from '../utils';

export interface MoveResourceOptions {
  collection?: string;
  source?: string;
  dest?: string;
  destCollection?: string;
  override?: boolean;
}

export const moveResourceCommand = defineCommand<MoveResourceOptions>()({
  name: 'Move resource',
  collection: 'writable',
  prompts: (options) =>
    missingTextQuestions(options, [
      { name: 'source', message: 'Source key or pattern (e.g. common.buttons.ok or common.buttons.*)', required: true },
      { name: 'dest', message: 'Destination key (e.g. common.actions.ok)', required: true },
    ]),
  required: ['source', 'dest'],
  run: ({ collection, config, cwd, answers }) => {
    const result = executeMove(
      collection,
      {
        source: answers.source,
        destination: answers.dest,
        override: answers.override,
        toCollection: answers.destCollection,
      },
      { config, cwd },
    );
    if (result.movedCount > 0) {
      ConsoleFormatter.success(`Moved ${result.movedCount} resource(s)`);
    } else {
      ConsoleFormatter.warning('No resources were moved.');
    }

    return printRunReport(result);
  },
});
