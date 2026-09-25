import { removeLocaleFromCollection } from '@simoncodes-ca/core';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export interface RemoveLocaleOptions {
  collection?: string;
  locale?: string;
}

export const removeLocaleCommand = defineCommand<RemoveLocaleOptions>()({
  name: 'Remove locale',
  collection: 'writable',
  prompts: (options, { collection }) => {
    if (options.locale) {
      return [];
    }
    // Called before `required` is checked, so this reason wins over "missing --locale".
    if (collection.targetLocales.length === 0) {
      throw new Error(`No removable locales in collection "${collection.name}".`);
    }
    return [
      {
        type: 'select',
        name: 'locale',
        message: 'Select locale to remove',
        choices: collection.targetLocales.map((locale) => ({ title: locale, value: locale })),
      },
    ];
  },
  required: ['locale'],
  run: async ({ collection, cwd, answers }) => {
    const result = await removeLocaleFromCollection(collection.name, answers.locale, { cwd });
    ConsoleFormatter.success(result.message);
    ConsoleFormatter.keyValue('Entries purged', result.entriesPurged);
    ConsoleFormatter.keyValue('Files updated', result.filesUpdated);
  },
});
