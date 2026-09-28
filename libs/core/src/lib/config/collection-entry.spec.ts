import { describe, expect, it } from 'vitest';
import type { LingoTrackerCollection } from '../../config/lingo-tracker-collection';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import {
  CollectionAlreadyExistsError,
  CollectionNotFoundError,
  InvalidCollectionError,
} from '../errors/lingo-tracker-error';
import { addCollectionEntry, replaceCollectionEntry, toCollectionEntry } from './collection-entry';

const GLOBAL: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  translation: { enabled: true, provider: 'google-translate', apiKeyEnv: 'KEY' },
  collections: {
    first: { translationsFolder: './first' },
    app: { translationsFolder: './i18n', locales: ['en', 'es'], tags: ['team-x'] },
    last: { translationsFolder: './last' },
  },
};

describe('toCollectionEntry', () => {
  it('stores translationsFolder (trimmed) and nothing else when every setting matches the global config', () => {
    const entry = toCollectionEntry(GLOBAL, {
      translationsFolder: '  ./src/i18n  ',
      exportFolder: 'dist/lingo-export',
      importFolder: 'dist/lingo-import',
      baseLocale: 'en',
      locales: ['en', 'fr'],
      readOnly: false,
      tags: [],
      protectedTermsFile: '  ',
    });

    expect(entry).toEqual({ translationsFolder: './src/i18n' });
  });

  it('keeps every setting that differs from the global config', () => {
    const collection: LingoTrackerCollection = {
      translationsFolder: './i18n',
      exportFolder: 'custom/export',
      importFolder: 'custom/import',
      baseLocale: 'fr',
      locales: ['fr', 'en'],
      translation: { enabled: false, provider: 'none', apiKeyEnv: 'X' },
      readOnly: true,
      tags: ['Team X', 'feature-a', 'Team X'],
      protectedTermsFile: ' i18n/terms.json ',
    };

    expect(toCollectionEntry(GLOBAL, collection)).toEqual({
      ...collection,
      tags: ['team-x', 'feature-a'],
      protectedTermsFile: 'i18n/terms.json',
    });
  });

  it('keeps the translation override even when it equals the global block', () => {
    const entry = toCollectionEntry(GLOBAL, { translationsFolder: './i18n', translation: GLOBAL.translation });

    expect(entry.translation).toEqual(GLOBAL.translation);
  });

  it('compares locales as ordered lists', () => {
    expect(toCollectionEntry(GLOBAL, { translationsFolder: './i18n', locales: ['fr', 'en'] }).locales).toEqual([
      'fr',
      'en',
    ]);
  });

  it('throws InvalidCollectionError for a missing or blank translationsFolder', () => {
    expect(() => toCollectionEntry(GLOBAL, { translationsFolder: '   ' })).toThrow(InvalidCollectionError);
    expect(() => toCollectionEntry(GLOBAL, {} as LingoTrackerCollection)).toThrow('translationsFolder is required');
  });
});

describe('addCollectionEntry', () => {
  it('registers the minimal record without touching the other collections', () => {
    const next = addCollectionEntry(GLOBAL, 'admin', { translationsFolder: './admin', baseLocale: 'en' });

    expect(next.collections['admin']).toEqual({ translationsFolder: './admin' });
    expect(next.collections['app']).toBe(GLOBAL.collections['app']);
    expect(GLOBAL.collections['admin']).toBeUndefined();
  });

  it('defaults a folder under node_modules to read-only unless the caller decides', () => {
    const vendored = 'node_modules/lib/i18n';

    expect(addCollectionEntry(GLOBAL, 'v', { translationsFolder: vendored }).collections['v'].readOnly).toBe(true);
    expect(
      addCollectionEntry(GLOBAL, 'v', { translationsFolder: vendored, readOnly: false }).collections['v'].readOnly,
    ).toBeUndefined();
    expect(addCollectionEntry(GLOBAL, 'v', { translationsFolder: './src' }).collections['v'].readOnly).toBeUndefined();
  });

  it('throws CollectionAlreadyExistsError for a taken name', () => {
    expect(() => addCollectionEntry(GLOBAL, 'app', { translationsFolder: './x' })).toThrow(
      CollectionAlreadyExistsError,
    );
  });
});

describe('replaceCollectionEntry', () => {
  it('rebuilds the record from the given collection (full replace)', () => {
    const next = replaceCollectionEntry(GLOBAL, 'app', { translationsFolder: './i18n', readOnly: true });

    expect(next.collections['app']).toEqual({ translationsFolder: './i18n', readOnly: true });
  });

  it('keeps a translation override that the caller carries over', () => {
    const translation = { enabled: false, provider: 'none', apiKeyEnv: 'X' };
    const config = { ...GLOBAL, collections: { app: { translationsFolder: './i18n', translation } } };

    const next = replaceCollectionEntry(config, 'app', { ...config.collections['app'], tags: ['new'] });

    expect(next.collections['app']).toEqual({ translationsFolder: './i18n', translation, tags: ['new'] });
  });

  it('renames in place, keeping the collection order', () => {
    const next = replaceCollectionEntry(GLOBAL, 'app', { translationsFolder: './i18n' }, 'renamed');

    expect(Object.keys(next.collections)).toEqual(['first', 'renamed', 'last']);
    expect(next.collections['renamed']).toEqual({ translationsFolder: './i18n' });
  });

  it('treats an empty new name as no rename', () => {
    const next = replaceCollectionEntry(GLOBAL, 'app', { translationsFolder: './i18n' }, '');

    expect(Object.keys(next.collections)).toEqual(['first', 'app', 'last']);
  });

  it('throws CollectionNotFoundError for an unknown collection', () => {
    expect(() => replaceCollectionEntry(GLOBAL, 'nope', { translationsFolder: './x' })).toThrow(
      CollectionNotFoundError,
    );
  });

  it('throws CollectionAlreadyExistsError when renaming onto a taken name', () => {
    expect(() => replaceCollectionEntry(GLOBAL, 'app', { translationsFolder: './x' }, 'last')).toThrow(
      CollectionAlreadyExistsError,
    );
  });
});
