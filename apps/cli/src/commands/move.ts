import { MOVE_FLAGS } from './move-flags';
import { moveResource } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, printRunReport } from '../utils';

export interface MoveResourceOptions {
  collection?: string;
  source?: string;
  dest?: string;
  destCollection?: string;
  override?: boolean;
}

export const moveResourceCommand = defineCommand<MoveResourceOptions>()({
  flags: MOVE_FLAGS,
  name: 'Move resource',
  collection: 'writable',

  required: ['source', 'dest'],
  run: async ({ collection, config, cwd, answers }) => {
    const params = { source: answers.source, destination: answers.dest, override: answers.override };
    const result = answers.destCollection
      ? await moveResource(collection, { ...params, toCollection: answers.destCollection }, { config, cwd })
      : await moveResource(collection, params);

    if (result.movedCount > 0) {
      ConsoleFormatter.success(`Moved ${result.movedCount} resource(s)`);
    } else {
      ConsoleFormatter.warning('No resources were moved.');
    }

    return printRunReport(result);
  },
});
