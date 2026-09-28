import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import type { TranslationConfig } from '../config/translation-config';
import { CONFIG_FILENAME, RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../constants';
import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  InvalidLocaleError,
  ReadOnlyCollectionError,
} from '../lib/errors/lingo-tracker-error';
import type { ResourceEntries } from '../resource/resource-entry';
import type { TrackerMetadata } from '../resource/tracker-metadata';
import { seedResources, testCollection, useTempDir } from '../testing/temp-dir.spec-helpers';
import { updateCollection } from './update-collection';

const TRANSLATION: TranslationConfig = { enabled: false, provider: 'none', apiKeyEnv: 'NONE' };

describe('updateCollection', () => {
  const tempDir = useTempDir();
  const cwd = (): string => tempDir();
  const i18n = (): string => join(tempDir(), 'i18n');

  const config = (): LingoTrackerConfig => ({
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en'],
    collections: {
      myApp: { translationsFolder: './i18n', locales: ['en', 'es', 'fr-ca'], translation: TRANSLATION },
      other: { translationsFolder: './other' },
    },
  });

  const writeConfig = (value: LingoTrackerConfig = config()): void =>
    writeFileSync(join(tempDir(), CONFIG_FILENAME), JSON.stringify(value));
  const readConfig = (): LingoTrackerConfig => JSON.parse(readFileSync(join(tempDir(), CONFIG_FILENAME), 'utf8'));
  const readFolder = (folder: string): { entries: ResourceEntries; meta: TrackerMetadata } => ({
    entries: JSON.parse(readFileSync(join(i18n(), folder, RESOURCE_ENTRIES_FILENAME), 'utf8')),
    meta: JSON.parse(readFileSync(join(i18n(), folder, TRACKER_META_FILENAME), 'utf8')),
  });

  beforeEach(() => {
    writeConfig();
    seedResources(testCollection(i18n(), { locales: ['en', 'es', 'fr-ca'] }), {
      'apps.ok': { source: 'OK', translations: { es: 'Vale', 'fr-ca': 'OK' } },
    });
  });

  it('keeps the translation override when only the tags change (regression)', async () => {
    const stored = config().collections['myApp'];

    const result = await updateCollection('myApp', undefined, { ...stored, tags: ['Team X'] }, { cwd: cwd() });

    expect(result).toEqual({ message: 'Collection "myApp" updated successfully', mutations: [] });
    expect(readConfig().collections['myApp']).toEqual({ ...stored, tags: ['team-x'] });
  });

  it('seeds the files for an added locale and purges a removed one, then writes the config once', async () => {
    const result = await updateCollection(
      'myApp',
      undefined,
      { translationsFolder: './i18n', locales: ['en', 'es', 'de'] },
      { cwd: cwd() },
    );

    expect(result.mutations).toEqual([{ kind: 'reindex', translationsFolder: i18n() }]);
    const { entries, meta } = readFolder('apps');
    expect(entries['ok']).toEqual({ source: 'OK', es: 'Vale', de: 'OK' });
    expect(meta['ok']?.['de']?.status).toBe('new');
    expect(meta['ok']?.['fr-ca']).toBeUndefined();
    expect(readConfig().collections['myApp']).toEqual({ translationsFolder: './i18n', locales: ['en', 'es', 'de'] });
  });

  it('never removes the base locale, and touches no files when the locales are unchanged or inherited', async () => {
    for (const locales of [['es', 'fr-ca'], ['en', 'es', 'fr-ca'], [], undefined]) {
      const result = await updateCollection(
        'myApp',
        undefined,
        { translationsFolder: './i18n', locales },
        { cwd: cwd() },
      );

      expect(result.mutations).toEqual([]);
      expect(readFolder('apps').entries['ok']).toEqual({ source: 'OK', es: 'Vale', 'fr-ca': 'OK' });
    }
  });

  it('diffs against the global locales when the collection inherits them', async () => {
    writeConfig({
      ...config(),
      locales: ['en', 'es', 'fr-ca'],
      collections: { myApp: { translationsFolder: './i18n' } },
    });

    await updateCollection(
      'myApp',
      undefined,
      { translationsFolder: './i18n', locales: ['en', 'es', 'fr-ca', 'de'] },
      {
        cwd: cwd(),
      },
    );

    expect(readFolder('apps').entries['ok']?.['de']).toBe('OK');
  });

  it('renames the collection', async () => {
    const result = await updateCollection('myApp', 'renamed', { translationsFolder: './i18n' }, { cwd: cwd() });

    expect(result.message).toBe('Collection "myApp" renamed to "renamed" and updated successfully');
    expect(Object.keys(readConfig().collections)).toEqual(['renamed', 'other']);
  });

  it('throws on a rename collision before any locale file changes', async () => {
    await expect(
      updateCollection('myApp', 'other', { translationsFolder: './i18n', locales: ['en', 'de'] }, { cwd: cwd() }),
    ).rejects.toThrow(CollectionAlreadyExistsError);

    expect(readFolder('apps').entries['ok']).toEqual({ source: 'OK', es: 'Vale', 'fr-ca': 'OK' });
    expect(readConfig()).toEqual(config());
  });

  it.each([
    ['an unknown collection', 'nope', { translationsFolder: './i18n' }, CollectionNotFoundError],
    ['a blank translationsFolder', 'myApp', { translationsFolder: '  ' }, Error],
    ['a malformed added locale', 'myApp', { translationsFolder: './i18n', locales: ['en', 'x!'] }, InvalidLocaleError],
  ])('rejects %s and writes nothing', async (_label, name, collection, error) => {
    await expect(updateCollection(name, undefined, collection, { cwd: cwd() })).rejects.toThrow(error);

    expect(readConfig()).toEqual(config());
  });

  it('refuses a locale change on a read-only collection', async () => {
    const readOnly = config();
    readOnly.collections['myApp'].readOnly = true;
    writeConfig(readOnly);

    await expect(
      updateCollection('myApp', undefined, { translationsFolder: './i18n', locales: ['en', 'de'] }, { cwd: cwd() }),
    ).rejects.toThrow(ReadOnlyCollectionError);
    expect(readConfig()).toEqual(readOnly);
  });
});
