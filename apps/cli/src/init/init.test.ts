import { CONFIG_FILENAME, loadConfig } from '@simoncodes-ca/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CommandCancelledError } from '../runner/command-runner';
import { createCommandProject, type CommandProject } from '../testing/command-project';
import { initCommand } from './init';

describe('initCommand', () => {
  let project: CommandProject;
  beforeEach(() => {
    project = createCommandProject();
    project.remove(CONFIG_FILENAME);
  });
  afterEach(() => project.cleanup());

  it('exits 1 naming the missing flags in non-interactive mode', async () => {
    const result = await project.run(initCommand, {});
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('--collection-name, --translations-folder');
    expect(project.exists(CONFIG_FILENAME)).toBe(false);
  });

  it('asks nothing and exits 0 in an initialized folder, even without flags', async () => {
    project.configure(project.config);
    const before = project.read(CONFIG_FILENAME);
    const result = await project.run(
      initCommand,
      {},
      {
        interactive: true,
        ask: async () => {
          throw new Error('Unexpected prompt');
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Lingo Tracker is already initialized in this folder. Nothing to do.');
    expect(project.read(CONFIG_FILENAME)).toBe(before);
  });

  it('prompts for missing values when interactive and writes the answers', async () => {
    const result = await project.run(
      initCommand,
      {},
      {
        interactive: true,
        ask: async (questions) => {
          expect(Array.isArray(questions)).toBe(true);
          return { collectionName: 'Main', translationsFolder: 'src/i18n', baseLocale: 'fr', setupBundle: false };
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(loadConfig({ cwd: project.cwd }).baseLocale).toBe('fr');
    expect(result.stdout).toContain(`Created ${CONFIG_FILENAME} in ${project.cwd}`);
  });

  it('reports an existing config if another writer creates it after the prompt check', async () => {
    const result = await project.run(
      initCommand,
      {},
      {
        interactive: true,
        ask: async () => {
          project.configure(project.config);
          return { collectionName: 'Main', translationsFolder: 'src/i18n' };
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Lingo Tracker is already initialized');
    expect(loadConfig({ cwd: project.cwd }).collections).toEqual(project.config.collections);
  });

  it('passes supplied flags to core and prints the created path', async () => {
    const result = await project.run(initCommand, {
      collectionName: 'Flagged',
      translationsFolder: 'src/flags',
      bundleDist: './custom',
      enableAutoTranslation: true,
    });
    expect(result.exitCode).toBe(0);
    expect(loadConfig({ cwd: project.cwd }).collections?.Flagged).toEqual({ translationsFolder: 'src/flags' });
    expect(result.stdout).toBe(`Created ${CONFIG_FILENAME} in ${project.cwd}\n`);
  });

  it('cancels without creating a config', async () => {
    const result = await project.run(
      initCommand,
      {},
      {
        interactive: true,
        ask: async () => {
          throw new CommandCancelledError();
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Initialization cancelled.');
    expect(project.exists(CONFIG_FILENAME)).toBe(false);
  });
});
