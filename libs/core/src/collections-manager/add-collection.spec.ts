import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../constants';
import { CollectionAlreadyExistsError } from '../lib/errors/lingo-tracker-error';
import { useTempDir } from '../testing/temp-dir.spec-helpers';
import { addCollection } from './add-collection';

/** The write path only; what the record contains is specified in `lib/config/collection-entry.spec.ts`. */
describe('addCollection', () => {
  const tempDir = useTempDir();

  const config: LingoTrackerConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en'],
    collections: { existing: { translationsFolder: './existing' } },
  };

  const readConfig = (): LingoTrackerConfig => JSON.parse(readFileSync(join(tempDir(), CONFIG_FILENAME), 'utf8'));

  it('writes the minimal record next to the existing collections', () => {
    writeFileSync(join(tempDir(), CONFIG_FILENAME), JSON.stringify(config));

    const result = addCollection(
      'admin',
      { translationsFolder: '  ./admin  ', baseLocale: 'en', locales: ['en'], tags: ['Team X'] },
      { cwd: tempDir() },
    );

    expect(result.message).toBe('Collection "admin" added successfully');
    expect(readConfig()).toEqual({
      ...config,
      collections: {
        existing: { translationsFolder: './existing' },
        admin: { translationsFolder: './admin', tags: ['team-x'] },
      },
    });
  });

  it('leaves the file untouched when the name is taken', () => {
    const written = JSON.stringify(config);
    writeFileSync(join(tempDir(), CONFIG_FILENAME), written);

    expect(() => addCollection('existing', { translationsFolder: './new' }, { cwd: tempDir() })).toThrow(
      CollectionAlreadyExistsError,
    );
    expect(readFileSync(join(tempDir(), CONFIG_FILENAME), 'utf8')).toBe(written);
  });
});
