import { type EditResourceChanges, editResource, type LingoTrackerConfig } from '@simoncodes-ca/core';
import { translocoToICU } from '@simoncodes-ca/domain';
import type prompts from 'prompts';
import {
  ConsoleFormatter,
  executePromptsWithFallback,
  loadConfiguration,
  parseCommaSeparatedList,
  promptForCollection,
  resolveWritableCollection,
  warnAboutPreferredTerminology,
} from '../utils';

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

export async function editResourceCommand(options: EditResourceOptions): Promise<void> {
  const loaded = loadConfiguration({ exitOnError: false });
  if (!loaded) return;
  const { config, cwd } = loaded;

  const collectionName = await promptForCollection(config, options.collection);
  if (!collectionName) return;

  const collection = resolveWritableCollection(collectionName, config, cwd);
  if (!collection) return;

  const answers = await promptForMissing(options, config, collectionName);

  const translations =
    options.locale && options.localeValue ? { [options.locale]: { value: options.localeValue } } : undefined;
  if (!translations && (options.locale || options.localeValue)) {
    ConsoleFormatter.warning('Both --locale and --localeValue must be provided to update a translation.');
  }

  const changes: EditResourceChanges = {
    baseValue: answers.baseValue || undefined,
    comment: options.comment || undefined,
    tags: options.tags ? parseCommaSeparatedList(options.tags) : undefined,
    translations,
    // `--target-folder` names the folder the entry moves to ('' for the collection root).
    moveTo: options.targetFolder,
  };

  try {
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
  } catch (e: unknown) {
    ConsoleFormatter.error(e instanceof Error ? e.message : 'Failed to update resource');
  }
}

async function promptForMissing(
  options: EditResourceOptions,
  _config: LingoTrackerConfig,
  _collectionName: string,
): Promise<{
  key: string;
  baseValue?: string;
}> {
  const questions: prompts.PromptObject[] = [];

  if (!options.key) {
    questions.push({
      type: 'text',
      name: 'key',
      message: 'Resource key',
      validate: (val: string) => (val && val.trim().length > 0 ? true : 'Required'),
    });
  }

  if (!options.baseValue) {
    questions.push({
      type: 'text',
      name: 'baseValue',
      message: 'New base value (leave empty to keep current)',
    });
  }

  const result = await executePromptsWithFallback({
    questions,
    currentValues: options,
    requiredFields: ['key'],
    operationName: 'Edit resource',
  });

  return {
    key: result.key as string,
    baseValue: result.baseValue as string | undefined,
  };
}
