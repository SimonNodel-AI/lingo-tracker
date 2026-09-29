import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import { CONFIG_FILENAME, RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../constants';
import {
  BaseLocaleImmutableError,
  CollectionNotFoundError,
  InvalidLocaleError,
  LocaleAlreadyExistsError,
  ReadOnlyCollectionError,
} from '../lib/errors/lingo-tracker-error';
import type { ResourceEntries } from '../lib/resource/resource-entry';
import type { TrackerMetadata } from '../lib/resource/tracker-metadata';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../testing/temp-dir.spec-helpers';
import { addLocaleToCollection } from './add-locale-to-collection';

describe('addLocaleToCollection', () => {
  const tempDir = useTempDir('add-locale-');
  const folder = (): string => join(tempDir(), 'src/i18n');
  const config = (): LingoTrackerConfig => ({
    exportFolder: 'export',
    importFolder: 'import',
    baseLocale: 'en',
    locales: ['en', 'fr'],
    collections: { main: { translationsFolder: 'src/i18n' } },
  });
  const writeConfig = (value: LingoTrackerConfig = config()): void =>
    writeFileSync(join(tempDir(), CONFIG_FILENAME), JSON.stringify(value));
  const readConfig = (): LingoTrackerConfig => JSON.parse(readFileSync(join(tempDir(), CONFIG_FILENAME), 'utf8'));
  const entries = (): ResourceEntries => JSON.parse(readFileSync(join(folder(), RESOURCE_ENTRIES_FILENAME), 'utf8'));
  const meta = (): TrackerMetadata => JSON.parse(readFileSync(join(folder(), TRACKER_META_FILENAME), 'utf8'));
  const add = (name = 'main', locale = 'de') => addLocaleToCollection(name, locale, { cwd: tempDir() });

  beforeEach(() => writeConfig());

  it('adds locale to config and backfills resource entries', async () => {
    seedResources(testCollection(folder()), { ok: { source: 'OK', translations: { fr: 'OK' } } });
    const result = await add();
    expect(result).toEqual({
      message: 'Locale "de" added to collection "main" successfully',
      entriesBackfilled: 1,
      filesUpdated: 1,
      mutations: [{ kind: 'reindex', translationsFolder: folder() }],
    });
    expect(readConfig().collections['main'].locales).toEqual(['en', 'fr', 'de']);
    expect(entries()['ok']?.['de']).toBe('OK');
    expect(meta()['ok']?.['de']).toMatchObject({ status: 'new' });
  });

  it('copies global locales into collection when collection has no locales override', async () => {
    await add();
    expect(readConfig().collections['main'].locales).toEqual(['en', 'fr', 'de']);
  });

  it('does not copy global locales when collection already has explicit locales', async () => {
    writeConfig({ ...config(), collections: { main: { translationsFolder: 'src/i18n', locales: ['en', 'fr'] } } });
    await add();
    expect(readConfig().collections['main'].locales).toEqual(['en', 'fr', 'de']);
  });

  it('handles empty translations folder gracefully (no resource files)', async () => {
    writeFolderFiles(folder(), '', {});
    const result = await add();
    expect(result.entriesBackfilled).toBe(0);
    expect(result.filesUpdated).toBe(0);
  });

  it('fails before writing anything on a folder the Collection Sweep cannot read, even one with only a tracker_meta.json', async () => {
    seedResources(testCollection(folder()), { ok: { source: 'OK', translations: { fr: 'Oui' } } });
    writeFolderFiles(folder(), 'broken', { meta: '{ not json' });
    const beforeEntries = entries();
    const beforeMeta = meta();
    await expect(add()).rejects.toThrow('tracker_meta.json');
    expect(readConfig()).toEqual(config());
    expect(entries()).toEqual(beforeEntries);
    expect(meta()).toEqual(beforeMeta);
  });

  it('handles non-existent translations folder gracefully', async () => {
    const result = await add();
    expect(result.entriesBackfilled).toBe(0);
    expect(result.filesUpdated).toBe(0);
  });

  it('throws when locale already exists in collection', async () => {
    await expect(add('main', 'fr')).rejects.toThrow(LocaleAlreadyExistsError);
  });

  it('throws when trying to add the base locale', async () => {
    await expect(add('main', 'en')).rejects.toThrow(BaseLocaleImmutableError);
  });

  it('throws when collection does not exist', async () => {
    await expect(add('nonexistent')).rejects.toThrow(CollectionNotFoundError);
  });

  it('throws ReadOnlyCollectionError and writes nothing for a read-only collection', async () => {
    const readOnly = { ...config(), collections: { main: { translationsFolder: 'src/i18n', readOnly: true } } };
    writeConfig(readOnly);
    await expect(add()).rejects.toThrow(ReadOnlyCollectionError);
    expect(readConfig()).toEqual(readOnly);
  });

  it('throws when locale format is invalid', async () => {
    await expect(add('main', 'not-valid-123')).rejects.toThrow(InvalidLocaleError);
  });

  it('uses collection-level baseLocale when blocking base locale add', async () => {
    writeConfig({ ...config(), collections: { main: { translationsFolder: 'src/i18n', baseLocale: 'fr' } } });
    await expect(add('main', 'fr')).rejects.toThrow(BaseLocaleImmutableError);
  });

  it('stores a locale list equal to the global list as inherited', async () => {
    writeConfig({
      ...config(),
      locales: ['en', 'fr', 'de'],
      collections: { main: { translationsFolder: 'src/i18n', locales: ['en', 'fr'] } },
    });
    await add();
    expect(readConfig().collections['main']).toEqual({ translationsFolder: 'src/i18n' });
  });

  it('validates the locale before looking up a missing collection', async () => {
    await expect(add('missing', 'not-valid-123')).rejects.toThrow(InvalidLocaleError);
  });
});
