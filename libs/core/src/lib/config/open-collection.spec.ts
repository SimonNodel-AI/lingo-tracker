import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { CollectionNotFoundError, ReadOnlyCollectionError } from '../errors/lingo-tracker-error';
import { loadConfig } from './load-config';
import { openCollection } from './open-collection';
import { DEFAULT_PROTECTED_TERMS_FILENAME } from './protected-terms-file';

const globalTranslation = { enabled: true, provider: 'google-translate', apiKeyEnv: 'GLOBAL_KEY' };
const collectionTranslation = { enabled: false, provider: 'google-translate', apiKeyEnv: 'OWN_KEY' };

const fixture: LingoTrackerConfig = {
  exportFolder: 'dist/export',
  importFolder: 'dist/import',
  baseLocale: 'en',
  locales: ['en', 'fr', 'de'],
  translation: globalTranslation,
  collections: {
    inherits: { translationsFolder: 'src/i18n' },
    overrides: {
      translationsFolder: '/abs/i18n',
      baseLocale: 'fr',
      locales: ['fr', 'es'],
      translation: collectionTranslation,
      tags: ['Shared', ' shared ', 'UI'],
    },
    vendor: { translationsFolder: 'node_modules/lib/i18n', readOnly: true },
    emptyLocales: { translationsFolder: 'x', locales: [] },
    blankBase: { translationsFolder: 'x', baseLocale: '' },
  },
};

describe('openCollection', () => {
  let dir: string;
  let config: LingoTrackerConfig;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lingo-open-collection-'));
    writeFileSync(join(dir, CONFIG_FILENAME), JSON.stringify(fixture), 'utf8');
    config = loadConfig({ cwd: dir });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to the global settings when the collection has none', () => {
    const collection = openCollection(config, 'inherits', { cwd: dir });

    expect(collection).toEqual({
      name: 'inherits',
      translationsFolder: resolve(dir, 'src/i18n'),
      baseLocale: 'en',
      locales: ['en', 'fr', 'de'],
      targetLocales: ['fr', 'de'],
      translationConfig: globalTranslation,
      tags: [],
      protectedTermsFiles: { global: join(dir, DEFAULT_PROTECTED_TERMS_FILENAME), globalExplicit: false },
      readOnly: false,
      config: { translationsFolder: 'src/i18n' },
    });
  });

  it("prefers the collection's own settings and does not merge translation config", () => {
    const collection = openCollection(config, 'overrides', { cwd: dir });

    expect(collection.baseLocale).toBe('fr');
    expect(collection.locales).toEqual(['fr', 'es']);
    expect(collection.translationConfig).toEqual(collectionTranslation);
    expect(collection.tags).toEqual(['shared', 'ui']);
  });

  it('excludes the base locale from target locales', () => {
    expect(openCollection(config, 'overrides', { cwd: dir }).targetLocales).toEqual(['es']);
    expect(openCollection(config, 'inherits', { cwd: dir }).targetLocales).not.toContain('en');
  });

  it('keeps an explicitly empty locale list instead of inheriting', () => {
    const collection = openCollection(config, 'emptyLocales', { cwd: dir });

    expect(collection.locales).toEqual([]);
    expect(collection.targetLocales).toEqual([]);
  });

  it('treats an empty baseLocale as unset', () => {
    expect(openCollection(config, 'blankBase', { cwd: dir }).baseLocale).toBe('en');
  });

  it("defaults to 'en' and no locales when neither the collection nor the config sets them", () => {
    const bare = { collections: { app: { translationsFolder: 'i18n' } } } as unknown as LingoTrackerConfig;

    const collection = openCollection(bare, 'app', { cwd: dir });

    expect(collection.baseLocale).toBe('en');
    expect(collection.locales).toEqual([]);
    expect(collection.translationConfig).toBeUndefined();
  });

  it('resolves a relative translations folder against cwd and keeps an absolute one', () => {
    expect(openCollection(config, 'inherits', { cwd: dir }).translationsFolder).toBe(join(dir, 'src', 'i18n'));
    expect(openCollection(config, 'overrides', { cwd: dir }).translationsFolder).toBe(resolve('/abs/i18n'));
  });

  it('resolves against process.cwd() by default', () => {
    vi.spyOn(process, 'cwd').mockReturnValue(dir);

    expect(openCollection(config, 'inherits').translationsFolder).toBe(resolve(dir, 'src/i18n'));
  });

  it('resolves the protected-terms file paths against cwd without reading them', () => {
    const withTerms: LingoTrackerConfig = {
      ...config,
      protectedTermsFile: 'terms/global.json',
      collections: { own: { translationsFolder: 'x', protectedTermsFile: '/abs/own-terms.json' } },
    };

    expect(openCollection(withTerms, 'own', { cwd: dir }).protectedTermsFiles).toEqual({
      global: join(dir, 'terms', 'global.json'),
      globalExplicit: true,
      collection: resolve('/abs/own-terms.json'),
    });
  });

  it('opens a collection whose protected-terms file is malformed', () => {
    writeFileSync(join(dir, DEFAULT_PROTECTED_TERMS_FILENAME), '["iPhone",', 'utf8');

    expect(openCollection(config, 'inherits', { cwd: dir }).baseLocale).toBe('en');
  });

  it('opens a read-only collection for reading and reports readOnly', () => {
    const collection = openCollection(config, 'vendor', { cwd: dir });

    expect(collection.readOnly).toBe(true);
  });

  it('refuses a read-only collection when writable is requested', () => {
    expect(() => openCollection(config, 'vendor', { cwd: dir, writable: true })).toThrow(ReadOnlyCollectionError);
    expect(() => openCollection(config, 'vendor', { writable: true })).toThrow(
      'Collection "vendor" is read-only. Its resources cannot be modified.',
    );
  });

  it('opens a writable collection when writable is requested', () => {
    expect(openCollection(config, 'inherits', { cwd: dir, writable: true }).readOnly).toBe(false);
  });

  it('throws CollectionNotFoundError for an unknown name', () => {
    expect(() => openCollection(config, 'missing', { cwd: dir })).toThrow(CollectionNotFoundError);
    expect(() => openCollection(config, 'missing', { cwd: dir })).toThrow('Collection "missing" not found');
  });

  it('checks existence before read-only status', () => {
    expect(() => openCollection(config, 'missing', { writable: true })).toThrow(CollectionNotFoundError);
  });

  it('does not treat inherited object properties as collections', () => {
    expect(() => openCollection(config, 'constructor')).toThrow(CollectionNotFoundError);
    expect(() => openCollection(config, 'toString')).toThrow(CollectionNotFoundError);
  });

  it('throws CollectionNotFoundError when the config has no collections at all', () => {
    const noCollections = { baseLocale: 'en', locales: [] } as unknown as LingoTrackerConfig;

    expect(() => openCollection(noCollections, 'app')).toThrow(CollectionNotFoundError);
  });

  it('exposes the raw collection entry and does not modify the config', () => {
    const before = JSON.stringify(config);

    const collection = openCollection(config, 'overrides', { cwd: dir });

    expect(collection.config).toBe(config.collections.overrides);
    expect(JSON.stringify(config)).toBe(before);
  });
});
