import { addLocaleToCollection } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export interface AddLocaleOptions {
  collection?: string;
  locale?: string;
}

export const addLocaleCommand = defineCommand<AddLocaleOptions>()({
  name: 'Add locale',
  collection: 'writable',
  prompts: (options) =>
    options.locale ? [] : [{ type: 'text', name: 'locale', message: 'Enter locale to add (e.g. fr-ca, de, es)' }],
  required: ['locale'],
  run: async ({ collection, cwd, answers }) => {
    const result = await addLocaleToCollection(collection.name, answers.locale, { cwd });
    ConsoleFormatter.success(result.message);
    ConsoleFormatter.keyValue('Entries backfilled', result.entriesBackfilled);
    ConsoleFormatter.keyValue('Files updated', result.filesUpdated);
  },
});
