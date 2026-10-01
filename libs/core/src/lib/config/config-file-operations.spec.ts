import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import { ConfigChangedError } from '../errors/lingo-tracker-error';
import { createConfigFileOperations } from './config-file-operations';
import { loadConfig } from './load-config';

describe('ConfigFileOperations version check', () => {
  const tempDir = useTempDir('config-write-version-');
  const configPath = (): string => join(tempDir(), CONFIG_FILENAME);
  const config = (): LingoTrackerConfig => ({
    exportFolder: 'export',
    importFolder: 'import',
    baseLocale: 'en',
    locales: ['en'],
    collections: { app: { translationsFolder: './i18n' } },
  });

  it('refuses a change after read and keeps the other writer’s bytes', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    const handle = createConfigFileOperations({ cwd: tempDir() });
    const snapshot = handle.read();
    const external = JSON.stringify({ ...config(), exportFolder: 'external' });
    writeFileSync(configPath(), external);

    expect(() => handle.write({ ...snapshot, importFolder: 'ours' })).toThrow(ConfigChangedError);
    expect(readFileSync(configPath(), 'utf8')).toBe(external);
  });

  it('uses the version recorded by loadConfig before a later handle is created', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    const snapshot = loadConfig({ cwd: tempDir() });
    const external = JSON.stringify({ ...config(), exportFolder: 'external' });
    writeFileSync(configPath(), external);
    const handle = createConfigFileOperations({ cwd: tempDir(), snapshot });

    expect(() => handle.write({ ...snapshot, importFolder: 'ours' })).toThrow(ConfigChangedError);
    expect(readFileSync(configPath(), 'utf8')).toBe(external);
  });

  it('refuses a change during update and keeps the other writer’s bytes', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    const handle = createConfigFileOperations({ cwd: tempDir() });
    const external = JSON.stringify({ ...config(), exportFolder: 'external' });

    expect(() =>
      handle.update((snapshot) => {
        writeFileSync(configPath(), external);
        return { ...snapshot, importFolder: 'ours' };
      }),
    ).toThrow(ConfigChangedError);
    expect(readFileSync(configPath(), 'utf8')).toBe(external);
  });

  it('updates its baseline after a successful write', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    const handle = createConfigFileOperations({ cwd: tempDir() });
    const snapshot = handle.read();

    handle.write({ ...snapshot, exportFolder: 'first' });
    handle.write({ ...snapshot, exportFolder: 'second' });

    expect(JSON.parse(readFileSync(configPath(), 'utf8')).exportFolder).toBe('second');
  });
});
