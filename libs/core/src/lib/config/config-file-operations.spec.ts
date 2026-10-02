import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import { ConfigChangedError, InvalidConfigError } from '../errors/lingo-tracker-error';
import { writeJsonFile } from '../file-io/json-file-operations';
import { createConfigFileOperations, guardedConfigWrite } from './config-file-operations';
import { loadConfig } from './load-config';

vi.mock('../file-io/json-file-operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../file-io/json-file-operations')>();
  return { ...actual, writeJsonFile: vi.fn(actual.writeJsonFile) };
});

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

  it('refuses a stale opened project and keeps the other writer’s bytes', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    const sourceConfig = loadConfig({ cwd: tempDir() });
    const other = `${JSON.stringify(config())}\n`;
    writeFileSync(configPath(), other);
    expect(() => guardedConfigWrite({ projectRoot: tempDir(), sourceConfig }).write(sourceConfig)).toThrow(
      ConfigChangedError,
    );
    expect(readFileSync(configPath(), 'utf8')).toBe(other);
  });

  it('writes from a fresh opened project', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    const sourceConfig = loadConfig({ cwd: tempDir() });
    guardedConfigWrite({ projectRoot: tempDir(), sourceConfig }).write({ ...sourceConfig, exportFolder: 'ours' });
    expect(JSON.parse(readFileSync(configPath(), 'utf8')).exportFolder).toBe('ours');
  });

  it('accepts an unversioned in-memory snapshot', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    guardedConfigWrite({ projectRoot: tempDir(), sourceConfig: config() }).write({ ...config(), exportFolder: 'ours' });
    expect(JSON.parse(readFileSync(configPath(), 'utf8')).exportFolder).toBe('ours');
  });

  it('rejects a malformed snapshot before reading the file', () => {
    const sourceConfig = { ...config(), locales: undefined } as unknown as LingoTrackerConfig;
    expect(() => guardedConfigWrite({ projectRoot: tempDir(), sourceConfig })).toThrow(InvalidConfigError);
  });

  it('wraps a guarded write failure and leaves the file untouched', () => {
    writeFileSync(configPath(), JSON.stringify(config()));
    const sourceConfig = loadConfig({ cwd: tempDir() });
    const before = readFileSync(configPath(), 'utf8');
    const ioError = new Error('ENOSPC');
    vi.mocked(writeJsonFile).mockImplementationOnce(() => {
      throw ioError;
    });
    expect(() => guardedConfigWrite({ projectRoot: tempDir(), sourceConfig }).write(sourceConfig)).toThrow(
      InvalidConfigError,
    );
    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });
});
