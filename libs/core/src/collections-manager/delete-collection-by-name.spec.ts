import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deleteCollectionByName } from './delete-collection-by-name';
import { ConfigParseError, InvalidConfigError } from '../lib/errors/lingo-tracker-error';
import type { ResourceMutation } from '../lib/resource/resource-mutation';
import * as fs from 'node:fs';
import { resolve } from 'node:path';

vi.mock('node:fs');

describe('deleteCollectionByName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
  });

  it('should delete a collection from the config', () => {
    const config = {
      baseLocale: 'en',
      locales: ['en', 'es', 'fr'],
      collections: {
        english: { path: './locales/en' },
        spanish: { path: './locales/es' },
        french: { path: './locales/fr' },
      },
    };

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config, null, 2));

    const collected: ResourceMutation[] = [];
    const result = deleteCollectionByName('spanish', {
      cwd: '/test',
      onMutation: (mutation) => {
        collected.push(mutation);
      },
    });

    expect(result.message).toBe('Collection "spanish" deleted successfully');
    expect(collected).toEqual([]);

    // Check that writeFileSync was called with the updated config
    const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
    const writtenConfig = JSON.parse(writeCall[1] as string);
    expect(writtenConfig.collections).toEqual({
      english: { path: './locales/en' },
      french: { path: './locales/fr' },
    });
    expect(writtenConfig.collections.spanish).toBeUndefined();
  });

  it('delivers a reindex after unregistering a collection with a translations folder', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({
        baseLocale: 'en',
        locales: ['en'],
        collections: { main: { translationsFolder: 'translations/main' } },
      }),
    );
    const collected: ResourceMutation[] = [];
    deleteCollectionByName('main', {
      cwd: '/project',
      onMutation: (mutation) => {
        collected.push(mutation);
      },
    });
    expect(collected).toEqual([{ kind: 'reindex', translationsFolder: resolve('/project/translations/main') }]);
  });

  it('should throw a typed error with a fixed message if the config file cannot be read', () => {
    const ioError = new Error("EACCES: permission denied, open '/secret/place/.lingo-tracker.json'");
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw ioError;
    });

    const thrown = captureError(() => deleteCollectionByName('any', { cwd: '/secret/place' }));

    expect(thrown).toBeInstanceOf(InvalidConfigError);
    expect(thrown?.message).toBe('Could not read .lingo-tracker.json');
    expect(thrown?.cause).toBe(ioError);
  });

  it('should throw a typed error with a fixed message if the config file cannot be written', () => {
    const config = { baseLocale: 'en', locales: ['en'], collections: { english: { path: './locales/en' } } };
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config));
    const ioError = new Error("ENOSPC: no space left on device, write '/secret/place/.lingo-tracker.json'");
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => {
      throw ioError;
    });

    const thrown = captureError(() => deleteCollectionByName('english', { cwd: '/secret/place' }));

    expect(thrown).toBeInstanceOf(InvalidConfigError);
    expect(thrown?.message).toBe('Could not write .lingo-tracker.json');
    // writeJsonFile wraps the fs error; the wrapper is kept whole as the cause.
    expect(thrown?.cause).toEqual(expect.objectContaining({ message: expect.stringContaining('ENOSPC') }));
  });

  it('should throw an error if collection does not exist', () => {
    const config = {
      baseLocale: 'en',
      locales: ['en'],
      collections: {
        english: { path: './locales/en' },
      },
    };

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config, null, 2));

    expect(() => deleteCollectionByName('nonexistent', { cwd: '/test' })).toThrow('Collection "nonexistent" not found');
  });

  it('should throw an error if config file is invalid JSON', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('invalid json {');

    expect(() => deleteCollectionByName('any', { cwd: '/test' })).toThrow(ConfigParseError);
  });

  it('should preserve other collections when deleting multiple', () => {
    const initialConfig = {
      baseLocale: 'en',
      locales: ['en', 'es', 'fr', 'de'],
      collections: {
        en: { path: './en' },
        es: { path: './es' },
        fr: { path: './fr' },
        de: { path: './de' },
      },
    };

    let currentConfig = initialConfig;

    vi.mocked(fs.readFileSync).mockImplementation(() => JSON.stringify(currentConfig, null, 2));

    vi.mocked(fs.writeFileSync).mockImplementation((_path, data) => {
      currentConfig = JSON.parse(data as string);
    });

    deleteCollectionByName('es', { cwd: '/test' });
    deleteCollectionByName('de', { cwd: '/test' });

    expect(currentConfig.collections).toEqual({
      en: { path: './en' },
      fr: { path: './fr' },
    });
  });

  it('should use default cwd if not provided', () => {
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/default-cwd');

    const config = {
      baseLocale: 'en',
      locales: ['en'],
      collections: {
        english: { path: './locales/en' },
      },
    };

    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(config, null, 2));

    const result = deleteCollectionByName('english');

    expect(result.message).toBe('Collection "english" deleted successfully');
    expect(cwdSpy).toHaveBeenCalled();

    cwdSpy.mockRestore();
  });
});

function captureError(action: () => unknown): InvalidConfigError | undefined {
  try {
    action();
  } catch (error) {
    return error instanceof InvalidConfigError ? error : undefined;
  }
  return undefined;
}
