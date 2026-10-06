import { INIT_FLAGS } from './init-flags';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONFIG_FILENAME, initProject } from '@simoncodes-ca/core';
import { CommandOutput } from '../runner/command-output';
import { type Answers, defineCommand, requireOptions } from '../runner/command-runner';
import type { InitOptions } from '../types/init-options.js';
import { ConsoleFormatter } from '../utils';

export const initCommand = defineCommand<InitCommandOptions>()({
  flags: INIT_FLAGS,
  name: 'Initialization',
  // Writes `.lingo-tracker.json`, so there is none to load yet.
  collection: 'none',
  config: false,
  // No `required`: the name and folder are only needed when there is a config to write.
  run: ({ cwd, answers, interactive }) => writeConfig(cwd, answers, interactive),
});

function writeConfig(cwd: string, result: Answers<InitCommandOptions>, interactive: boolean): void {
  const configPath = resolve(cwd, CONFIG_FILENAME);

  if (existsSync(configPath)) {
    ConsoleFormatter.info('Lingo Tracker is already initialized in this folder. Nothing to do.');
    return;
  }

  requireOptions(result, ['collectionName', 'translationsFolder'], interactive, INIT_FLAGS);
  initProject(cwd, result);
  CommandOutput.log(`Created ${CONFIG_FILENAME} in ${cwd}`);
}

export type InitCommandOptions = Omit<InitOptions, 'readOnly'>;
