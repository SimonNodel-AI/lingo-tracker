import type prompts from 'prompts';
import { CONFIG_FILENAME, addCollection, DEFAULT_CONFIG } from '@simoncodes-ca/core';
import { isUnderNodeModules } from '@simoncodes-ca/domain';
import type { InitOptions } from '../types/init-options.js';
import { type Ask, defineCommand } from '../runner/command-runner';
import { ConsoleFormatter } from '../utils';

export const addCollectionCommand = defineCommand<InitOptions>()({
  name: 'Add collection',
  collection: 'none',
  prompts: (options) => {
    const questions: prompts.PromptObject[] = [];

    if (!options.collectionName) {
      questions.push({
        type: 'text',
        name: 'collectionName',
        message: 'Collection name',
        validate: (val: string) => (val && val.trim().length > 0 ? true : 'Required'),
      });
    }

    if (!options.translationsFolder) {
      questions.push({
        type: 'text',
        name: 'translationsFolder',
        message: 'Path to translations folder',
        validate: (val: string) => (val && val.trim().length > 0 ? true : 'Required'),
      });
    }

    if (!options.exportFolder) {
      questions.push({
        type: 'text',
        name: 'exportFolder',
        message: 'Export folder',
        initial: DEFAULT_CONFIG.exportFolder,
      });
    }

    if (!options.importFolder) {
      questions.push({
        type: 'text',
        name: 'importFolder',
        message: 'Import folder',
        initial: DEFAULT_CONFIG.importFolder,
      });
    }

    if (!options.baseLocale) {
      questions.push({
        type: 'text',
        name: 'baseLocale',
        message: 'Base locale',
        initial: DEFAULT_CONFIG.baseLocale,
        validate: (val) => (val && val.trim().length > 0 ? true : 'Required'),
      });
    }

    if (!options.locales) {
      questions.push({
        type: 'list',
        name: 'locales',
        message: 'Supported locales (comma-separated)',
        initial: 'en,fr-ca,es,de',
        separator: ',',
      });
    }

    return questions;
  },
  required: ['collectionName', 'translationsFolder'],
  // Core refuses a duplicate name (CollectionAlreadyExistsError) and defaults a folder under
  // node_modules to read-only when the flag is left unset.
  run: async ({ project, answers, interactive, ask }) => {
    const { collectionName, translationsFolder } = answers;

    const readOnly = await resolveReadOnly(answers.readOnly, translationsFolder, interactive, ask);

    const newCollection = {
      translationsFolder,
      exportFolder: answers.exportFolder ?? DEFAULT_CONFIG.exportFolder,
      importFolder: answers.importFolder ?? DEFAULT_CONFIG.importFolder,
      baseLocale: answers.baseLocale ?? DEFAULT_CONFIG.baseLocale,
      locales: answers.locales ?? DEFAULT_CONFIG.locales,
      readOnly,
    };

    const result = addCollection(project, collectionName, newCollection);
    ConsoleFormatter.success(`${result.message} in ${CONFIG_FILENAME}`);
  },
});

/**
 * Resolves the collection's read-only flag. An explicit --read-only/--no-read-only flag
 * always wins. Otherwise, in an interactive terminal the user is asked (pre-filled from
 * node_modules detection); in non-interactive mode the flag is left to core's default.
 */
async function resolveReadOnly(
  flag: boolean | undefined,
  translationsFolder: string,
  interactive: boolean,
  ask: Ask,
): Promise<boolean | undefined> {
  if (typeof flag === 'boolean' || !interactive) {
    return flag;
  }

  const nodeModulesDefault = isUnderNodeModules(translationsFolder);
  const result = await ask({
    type: 'confirm',
    name: 'readOnly',
    message: nodeModulesDefault
      ? 'This folder is under node_modules. Mark the collection as read-only?'
      : 'Mark the collection as read-only? (its resources cannot be modified)',
    initial: nodeModulesDefault,
  });

  return Boolean(result.readOnly);
}
