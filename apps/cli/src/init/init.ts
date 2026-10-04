import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CONFIG_FILENAME,
  DEFAULT_BUNDLE_DIST,
  DEFAULT_BUNDLE_NAME,
  DEFAULT_TYPE_DIST_FILE,
  initProject,
} from '@simoncodes-ca/core';
import type prompts from 'prompts';
import { CommandOutput } from '../runner/command-output';
import { type Answers, defineCommand, requireOptions } from '../runner/command-runner';
import type { InitOptions } from '../types/init-options.js';
import { ConsoleFormatter, collectionSetupQuestions, requiredText } from '../utils';

export const initCommand = defineCommand<InitOptions>()({
  name: 'Initialization',
  // Writes `.lingo-tracker.json`, so there is none to load yet.
  collection: 'none',
  config: false,
  // Nothing to ask in an initialized folder: `run` reports it.
  prompts: (options, { cwd }) => (existsSync(resolve(cwd, CONFIG_FILENAME)) ? [] : buildQuestions(options)),
  // No `required`: the name and folder are only needed when there is a config to write.
  run: ({ cwd, answers, interactive }) => writeConfig(cwd, answers, interactive),
});

function writeConfig(cwd: string, result: Answers<InitOptions>, interactive: boolean): void {
  const configPath = resolve(cwd, CONFIG_FILENAME);

  if (existsSync(configPath)) {
    ConsoleFormatter.info('Lingo Tracker is already initialized in this folder. Nothing to do.');
    return;
  }

  requireOptions(result, ['collectionName', 'translationsFolder'], interactive);
  initProject(cwd, result);
  CommandOutput.log(`Created ${CONFIG_FILENAME} in ${cwd}`);
}

function buildQuestions(options: InitOptions): prompts.PromptObject[] {
  const questions = collectionSetupQuestions(options, { collectionName: 'Main' });

  if (options.setupBundle === undefined) {
    questions.push({
      type: 'confirm',
      name: 'setupBundle',
      message: 'Would you like to customize the bundle configuration?',
      initial: true,
    });
  }

  if (!options.bundleDist) {
    questions.push({
      /**
       * Bundle sub-prompts must appear AFTER the `setupBundle` confirm prompt in the questions
       * array, because the `type` function only receives values accumulated so far.
       */
      type: (_, values) => (resolveSetupBundle(values, options) ? 'text' : null),
      name: 'bundleDist',
      message: 'Bundle output directory',
      initial: DEFAULT_BUNDLE_DIST,
    });
  }

  if (!options.bundleName) {
    questions.push({
      type: (_, values) => (resolveSetupBundle(values, options) ? 'text' : null),
      name: 'bundleName',
      message: 'Bundle name pattern',
      initial: DEFAULT_BUNDLE_NAME,
    });
  }

  if (!options.tokenCasing) {
    questions.push({
      type: (_, values) => (resolveSetupBundle(values, options) ? 'select' : null),
      name: 'tokenCasing',
      message: 'Token casing style',
      choices: [
        { title: 'upperCase (e.g. FILE_UPLOAD)', value: 'upperCase' },
        { title: 'camelCase (e.g. fileUpload)', value: 'camelCase' },
      ],
      initial: 0,
    });
  }

  if (!options.typeDistFile) {
    questions.push({
      type: (_, values) => (resolveSetupBundle(values, options) ? 'text' : null),
      name: 'typeDistFile',
      message: 'Type definition file path',
      initial: DEFAULT_TYPE_DIST_FILE,
    });
  }

  if (!options.tokenConstantName) {
    questions.push({
      type: (_, values) => (resolveSetupBundle(values, options) ? 'text' : null),
      name: 'tokenConstantName',
      message: 'Token constant name (leave empty to auto-derive)',
      initial: '',
    });
  }

  if (options.enableAutoTranslation === undefined) {
    questions.push({
      type: 'confirm',
      name: 'enableAutoTranslation',
      message: 'Would you like to enable auto-translation?',
      initial: false,
    });
  }

  // The provider and API key questions are conditional on either the in-flight confirm answer
  // or the pre-existing CLI option. prompts supports dynamic `type` — returning falsy skips the question.
  if (!options.translationProvider) {
    questions.push({
      type: (_, values) => ((values.enableAutoTranslation ?? options.enableAutoTranslation) ? 'text' : null),
      name: 'translationProvider',
      message: 'Translation provider',
      initial: 'google-translate',
      validate: requiredText,
    });
  }

  if (!options.translationApiKeyEnv) {
    questions.push({
      type: (_, values) => ((values.enableAutoTranslation ?? options.enableAutoTranslation) ? 'text' : null),
      name: 'translationApiKeyEnv',
      message: 'Environment variable name for the API key',
      initial: 'GOOGLE_TRANSLATE_API_KEY',
      validate: requiredText,
    });
  }

  return questions;
}

/**
 * Determines whether bundle setup is active, checking both in-flight prompt values
 * and the pre-existing CLI option. Used by conditional prompt `type` functions.
 *
 * IMPORTANT: Bundle sub-prompts must be placed AFTER the `setupBundle` confirm prompt
 * in the questions array. The `type` function only receives values accumulated so far,
 * so if `setupBundle` hasn't been answered yet, `promptValues` won't contain it and
 * the function will fall back to `options.setupBundle`.
 */
function resolveSetupBundle(promptValues: Record<string, unknown>, options: InitOptions): boolean {
  if ('setupBundle' in promptValues) {
    return Boolean(promptValues.setupBundle);
  }
  return Boolean(options.setupBundle);
}
