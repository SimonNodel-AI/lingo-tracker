import { selectionPrompt } from '../utils/prompt-utils';
import type { PromptContext } from '../runner/command-runner';
import type { NormalizeOptions } from './normalize';
import { defineFlags, flagName, collectionFlag, yesFlag } from '../runner/flag-record';

const allFlag = { flags: '--all', description: 'Normalize all collections' };

export const NORMALIZE_FLAGS = defineFlags<NormalizeOptions, PromptContext<'many'>>()({
  collection: {
    ...collectionFlag(`Collection name (required unless ${flagName(allFlag)})`),
    prompt: (options, { config }) => {
      const collections = Object.keys(config.collections ?? {});
      if (options.collection || options.all || collections.length === 0) {
        return [];
      }
      return [
        selectionPrompt({
          mode: 'single',
          name: 'collectionOrAll',
          message: 'Select collection to normalize',
          choices: collections,
          allTitle: 'All collections',
        }),
      ];
    },
  },
  all: allFlag,
  dryRun: { flags: '--dry-run', description: 'Preview changes without applying them' },
  json: { flags: '--json', description: 'Output results as JSON' },
  yes: yesFlag,
});

export const NORMALIZE_REGISTRATION = {
  name: 'normalize',
  description: 'Normalize translation resources (fix checksums, add missing locales, clean up empty folders)',
  flags: NORMALIZE_FLAGS,
};
