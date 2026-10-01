import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../config/lingo-tracker-config';
import type { TranslationConfig } from '../config/translation-config';
import { CONFIG_FILENAME, RESOURCE_ENTRIES_FILENAME, TRACKER_META_FILENAME } from '../constants';
import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  CollectionRenameBundleConflictError,
  CollectionRequiredByBundleError,
  InvalidLocaleError,
  ReadOnlyCollectionError,
} from '../lib/errors/lingo-tracker-error';
import type { ResourceEntries } from '../lib/resource/resource-entry';
import type { TrackerMetadata } from '../lib/resource/tracker-metadata';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../testing/temp-dir.spec-helpers';
import { updateCollection } from './update-collection';
import { deleteCollectionByName } from './delete-collection-by-name';

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
      myApp: {
        translationsFolder: './i18n',
        exportFolder: 'custom/export',
        importFolder: 'custom/import',
        locales: ['en', 'es', 'fr-ca'],
        translation: TRANSLATION,
      },
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

  it('keeps the translation override when only the tags change, whether the caller carries the record over (CLI) or not', async () => {
    const stored = config().collections['myApp'];

    const result = await updateCollection('myApp', undefined, { ...stored, tags: ['Team X'] }, { cwd: cwd() });
    expect(result).toEqual({
      message: 'Collection "myApp" updated successfully',
      mutations: [{ kind: 'reindex', translationsFolder: i18n() }],
    });
    expect(readConfig().collections['myApp']).toEqual({ ...stored, tags: ['team-x'] });

    await updateCollection('myApp', undefined, { tags: ['Team Y'] }, { cwd: cwd() });
    expect(readConfig().collections['myApp']).toEqual({ ...stored, tags: ['team-y'] });
  });

  it('keeps translation, exportFolder and importFolder through the Tracker form payload, which never sends them', async () => {
    // The shape CollectionFormDialog#buildResult sends on PUT /collections/:name.
    const trackerPayload = {
      translationsFolder: './i18n',
      locales: ['en', 'es', 'fr-ca'],
      readOnly: false,
      tags: ['Team X'],
    };

    await updateCollection('myApp', undefined, trackerPayload, { cwd: cwd() });

    expect(readConfig().collections['myApp']).toEqual({ ...config().collections['myApp'], tags: ['team-x'] });
  });

  it('clears a setting with its empty value (tags: [], readOnly: false, protectedTermsFile: "")', async () => {
    const stored = { ...config().collections['myApp'], readOnly: true, tags: ['a'], protectedTermsFile: 'terms.json' };
    writeConfig({ ...config(), collections: { ...config().collections, myApp: stored } });

    await updateCollection('myApp', undefined, { tags: [], readOnly: false, protectedTermsFile: '' }, { cwd: cwd() });

    expect(readConfig().collections['myApp']).toEqual(config().collections['myApp']);
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
    expect(readConfig().collections['myApp']).toEqual({
      ...config().collections['myApp'],
      locales: ['en', 'es', 'de'],
    });
  });

  it('never removes the base locale, and touches no files when the locales are unchanged or left out', async () => {
    for (const locales of [['es', 'fr-ca'], ['en', 'es', 'fr-ca'], undefined]) {
      const result = await updateCollection(
        'myApp',
        undefined,
        { translationsFolder: './i18n', locales },
        { cwd: cwd() },
      );

      expect(result.mutations).toEqual(locales ? [{ kind: 'reindex', translationsFolder: i18n() }] : []);
      expect(readFolder('apps').entries['ok']).toEqual({ source: 'OK', es: 'Vale', 'fr-ca': 'OK' });
    }
  });

  it('stores an empty locales list as inherit, and the files follow the global locales', async () => {
    writeConfig({ ...config(), locales: ['en', 'es'] });

    await updateCollection('myApp', undefined, { locales: [] }, { cwd: cwd() });

    expect(readConfig().collections['myApp']).not.toHaveProperty('locales');
    expect(readFolder('apps').entries['ok']).toEqual({ source: 'OK', es: 'Vale' });
  });

  it('reads every folder before writing, so an unreadable one fails the update with nothing changed', async () => {
    writeFolderFiles(i18n(), 'broken', { entries: '{ not json' });

    await expect(updateCollection('myApp', undefined, { locales: ['en', 'es', 'de'] }, { cwd: cwd() })).rejects.toThrow(
      RESOURCE_ENTRIES_FILENAME,
    );

    expect(readFolder('apps').entries['ok']).toEqual({ source: 'OK', es: 'Vale', 'fr-ca': 'OK' });
    expect(readConfig()).toEqual(config());
  });

  it('applies the locale changes to the new translations folder when the folder changes in the same update', async () => {
    const moved = join(tempDir(), 'moved');
    seedResources(testCollection(moved, { locales: ['en', 'es', 'fr-ca'] }), {
      'apps.ok': { source: 'OK', translations: { es: 'Vale', 'fr-ca': 'OK' } },
    });

    const result = await updateCollection(
      'myApp',
      'renamed',
      { translationsFolder: './moved', locales: ['en', 'es', 'de'] },
      { cwd: cwd() },
    );

    expect(result.mutations).toEqual([
      { kind: 'reindex', translationsFolder: i18n() },
      { kind: 'reindex', translationsFolder: moved },
    ]);
    const movedEntries: ResourceEntries = JSON.parse(
      readFileSync(join(moved, 'apps', RESOURCE_ENTRIES_FILENAME), 'utf8'),
    );
    expect(movedEntries['ok']).toEqual({ source: 'OK', es: 'Vale', de: 'OK' });
    expect(readFolder('apps').entries['ok']).toEqual({ source: 'OK', es: 'Vale', 'fr-ca': 'OK' });
    expect(readConfig().collections['renamed']?.translationsFolder).toBe('./moved');
  });

  it('never seeds or purges a base locale, old or new, when the base locale changes in the same update', async () => {
    await updateCollection('myApp', undefined, { baseLocale: 'de', locales: ['de', 'es'] }, { cwd: cwd() });

    // de is the new base (not seeded as a translation), en the old one (not purged), fr-ca is gone.
    expect(readFolder('apps').entries['ok']).toEqual({ source: 'OK', es: 'Vale' });
    expect(readConfig().collections['myApp']).toEqual({
      ...config().collections['myApp'],
      baseLocale: 'de',
      locales: ['de', 'es'],
    });
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
    expect(result.mutations).toEqual([{ kind: 'reindex', translationsFolder: i18n() }]);
    expect(Object.keys(readConfig().collections)).toEqual(['renamed', 'other']);
  });

  it('renames every explicit bundle reference and preserves prefixes, rules and order', async () => {
    const original = config();
    original.bundles = {
      main: {
        bundleName: 'main.{locale}',
        dist: 'dist',
        collections: [
          { name: 'myApp', bundledKeyPrefix: 'first', entriesSelectionRules: 'All' },
          { name: 'other', entriesSelectionRules: 'All' },
          { name: 'myApp', bundledKeyPrefix: 'second', entriesSelectionRules: [{ matchingPattern: 'apps.*' }] },
        ],
      },
      all: { bundleName: 'all.{locale}', dist: 'dist', collections: 'All' },
    };
    writeConfig(original);

    await updateCollection('myApp', 'renamed', {}, { cwd: cwd() });

    expect(readConfig().bundles).toEqual({
      main: {
        ...original.bundles['main'],
        collections: [
          { name: 'renamed', bundledKeyPrefix: 'first', entriesSelectionRules: 'All' },
          { name: 'other', entriesSelectionRules: 'All' },
          { name: 'renamed', bundledKeyPrefix: 'second', entriesSelectionRules: [{ matchingPattern: 'apps.*' }] },
        ],
      },
      all: original.bundles['all'],
    });
  });

  it('refuses a rename onto dangling bundle references before changing config or locale files', async () => {
    const original = config();
    original.bundles = {
      first: {
        bundleName: 'first.{locale}',
        dist: 'dist',
        collections: [
          { name: 'myApp', entriesSelectionRules: 'All' },
          { name: 'legacy', entriesSelectionRules: 'All' },
        ],
      },
      second: {
        bundleName: 'second.{locale}',
        dist: 'dist',
        collections: [{ name: 'legacy', bundledKeyPrefix: 'old', entriesSelectionRules: 'All' }],
      },
    };
    writeConfig(original);
    const configBytes = readFileSync(join(cwd(), CONFIG_FILENAME));
    const entriesBytes = readFileSync(join(i18n(), 'apps', RESOURCE_ENTRIES_FILENAME));

    await expect(updateCollection('myApp', 'legacy', { locales: ['en', 'de'] }, { cwd: cwd() })).rejects.toThrow(
      CollectionRenameBundleConflictError,
    );
    await expect(updateCollection('myApp', 'legacy', {}, { cwd: cwd() })).rejects.toThrow(
      'Cannot rename collection "myApp" to "legacy": bundle(s) "first", "second" already reference "legacy". Remove those references first.',
    );
    expect(readFileSync(join(cwd(), CONFIG_FILENAME))).toEqual(configBytes);
    expect(readFileSync(join(i18n(), 'apps', RESOURCE_ENTRIES_FILENAME))).toEqual(entriesBytes);
  });

  it('skips malformed bundle collection lists and tolerates null entries on rename and delete', async () => {
    const malformed = {
      missing: { bundleName: 'missing.{locale}', dist: 'dist' },
      wrong: { bundleName: 'wrong.{locale}', dist: 'dist', collections: 42 },
      mixed: {
        bundleName: 'mixed.{locale}',
        dist: 'dist',
        collections: [
          null,
          { name: 'myApp', entriesSelectionRules: 'All' },
          { name: 'other', entriesSelectionRules: 'All' },
        ],
      },
    };
    writeConfig({ ...config(), bundles: malformed as unknown as LingoTrackerConfig['bundles'] });

    await updateCollection('myApp', 'renamed', {}, { cwd: cwd() });

    expect(readConfig().bundles).toEqual({
      ...malformed,
      mixed: {
        ...malformed.mixed,
        collections: [
          null,
          { name: 'renamed', entriesSelectionRules: 'All' },
          { name: 'other', entriesSelectionRules: 'All' },
        ],
      },
    });

    writeConfig({ ...config(), bundles: malformed as unknown as LingoTrackerConfig['bundles'] });
    deleteCollectionByName('myApp', { cwd: cwd() });

    expect(readConfig().bundles).toEqual({
      ...malformed,
      mixed: {
        ...malformed.mixed,
        collections: [null, { name: 'other', entriesSelectionRules: 'All' }],
      },
    });
  });

  it('removes every reference from multi-collection bundles on delete', () => {
    const original = config();
    original.bundles = {
      main: {
        bundleName: 'main.{locale}',
        dist: 'dist',
        collections: [
          { name: 'myApp', bundledKeyPrefix: 'a', entriesSelectionRules: 'All' },
          { name: 'other', entriesSelectionRules: 'All' },
          { name: 'myApp', bundledKeyPrefix: 'b', entriesSelectionRules: 'All' },
        ],
      },
      all: { bundleName: 'all.{locale}', dist: 'dist', collections: 'All' },
    };
    writeConfig(original);

    deleteCollectionByName('myApp', { cwd: cwd() });

    expect(readConfig().bundles?.['main']?.collections).toEqual([{ name: 'other', entriesSelectionRules: 'All' }]);
    expect(readConfig().bundles?.['all']).toEqual(original.bundles['all']);
  });

  it('refuses delete when any bundle would be empty and changes no config or translation bytes', () => {
    const original = config();
    original.bundles = {
      first: {
        bundleName: 'first.{locale}',
        dist: 'dist',
        collections: [{ name: 'myApp', entriesSelectionRules: 'All' }],
      },
      second: {
        bundleName: 'second.{locale}',
        dist: 'dist',
        collections: [
          { name: 'myApp', bundledKeyPrefix: 'a', entriesSelectionRules: 'All' },
          { name: 'myApp', bundledKeyPrefix: 'b', entriesSelectionRules: 'All' },
        ],
      },
      safe: {
        bundleName: 'safe.{locale}',
        dist: 'dist',
        collections: [
          { name: 'myApp', entriesSelectionRules: 'All' },
          { name: 'other', entriesSelectionRules: 'All' },
        ],
      },
    };
    writeConfig(original);
    const configBytes = readFileSync(join(cwd(), CONFIG_FILENAME));
    const entriesBytes = readFileSync(join(i18n(), 'apps', RESOURCE_ENTRIES_FILENAME));
    const metaBytes = readFileSync(join(i18n(), 'apps', TRACKER_META_FILENAME));

    expect(() => deleteCollectionByName('myApp', { cwd: cwd() })).toThrow(CollectionRequiredByBundleError);
    expect(() => deleteCollectionByName('myApp', { cwd: cwd() })).toThrow(
      'Collection "myApp" is the only collection of bundle(s) "first", "second". Remove it from those bundles or delete them first.',
    );
    expect(readFileSync(join(cwd(), CONFIG_FILENAME))).toEqual(configBytes);
    expect(readFileSync(join(i18n(), 'apps', RESOURCE_ENTRIES_FILENAME))).toEqual(entriesBytes);
    expect(readFileSync(join(i18n(), 'apps', TRACKER_META_FILENAME))).toEqual(metaBytes);
  });

  it('deletes an unreferenced collection without changing bundle definitions', () => {
    const original = config();
    original.bundles = {
      other: {
        bundleName: 'other.{locale}',
        dist: 'dist',
        collections: [{ name: 'other', entriesSelectionRules: 'All' }],
      },
    };
    writeConfig(original);

    deleteCollectionByName('myApp', { cwd: cwd() });

    expect(readConfig().bundles).toEqual(original.bundles);
  });

  it('returns the deleted collection folder for reindexing', () => {
    const result = deleteCollectionByName('myApp', { cwd: cwd() });

    expect(result.mutations).toEqual([{ kind: 'reindex', translationsFolder: i18n() }]);
    expect(readConfig().collections).not.toHaveProperty('myApp');
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
