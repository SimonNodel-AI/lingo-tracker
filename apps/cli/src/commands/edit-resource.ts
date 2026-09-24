import { type EditResourceChanges, editResource } from '@simoncodes-ca/core';
import { translocoToICU } from '@simoncodes-ca/domain';
import { defineCommand } from '../runner/command-runner';
import { ConsoleFormatter, parseCommaSeparatedList, warnAboutPreferredTerminology } from '../utils';

export interface EditResourceOptions {
  collection?: string;
  key?: string;
  targetFolder?: string;
  baseValue?: string;
  comment?: string;
  tags?: string; // Comma separated
  locale?: string;
  localeValue?: string;
}

export const editResourceCommand = defineCommand<EditResourceOptions>()({
  name: 'Edit resource',
  collection: 'writable',
  prompts: (options) => [
    ...(options.key
      ? []
      : [
          {
            type: 'text' as const,
            name: 'key',
            message: 'Resource key',
            validate: (val: string) => (val && val.trim().length > 0 ? true : 'Required'),
          },
        ]),
    ...(options.baseValue
      ? []
      : [{ type: 'text' as const, name: 'baseValue', message: 'New base value (leave empty to keep current)' }]),
  ],
  required: ['key'],
  run: async ({ collection, config, cwd, answers }) => {
    const translations =
      answers.locale && answers.localeValue ? { [answers.locale]: { value: answers.localeValue } } : undefined;
    if (!translations && (answers.locale || answers.localeValue)) {
      ConsoleFormatter.warning('Both --locale and --localeValue must be provided to update a translation.');
    }

    const changes: EditResourceChanges = {
      baseValue: answers.baseValue || undefined,
      comment: answers.comment || undefined,
      tags: answers.tags ? parseCommaSeparatedList(answers.tags) : undefined,
      translations,
      // `--target-folder` names the folder the entry moves to ('' for the collection root).
      moveTo: answers.targetFolder,
    };

    const result = await editResource(collection, answers.key, changes);

    if (result.updated) {
      ConsoleFormatter.success(`Resource "${result.resolvedKey}" updated successfully.`);
      // Only a base value supplied in this invocation is checked; editing a comment
      // or a translation should not re-raise advice about untouched wording.
      if (changes.baseValue !== undefined) {
        warnAboutPreferredTerminology(config, cwd, translocoToICU(changes.baseValue));
      }
    } else {
      ConsoleFormatter.info(result.message || 'No changes detected');
    }
  },
});
