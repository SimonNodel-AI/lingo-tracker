import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import { CollectionNotFoundError } from '../errors/lingo-tracker-error';
import {
  editProtectedTerms,
  readProtectedTermsTarget,
  setCollectionProtectedTerms,
  setCollectionProtectedTermsFile,
  setGlobalProtectedTerms,
  setGlobalProtectedTermsFile,
} from './set-protected-terms';

const baseConfig: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'es'],
  collections: { myApp: { translationsFolder: './i18n', locales: ['en', 'es'], tags: ['feature-a'] } },
};

describe('protected terms edits', () => {
  const tempDir = useTempDir('protected-terms-edit-');
  const configPath = () => join(tempDir(), CONFIG_FILENAME);
  const defaultPath = () => join(tempDir(), '.lingo-tracker-protected-terms.json');
  const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));
  const readConfig = (): LingoTrackerConfig => readJson(configPath()) as LingoTrackerConfig;
  const writeConfig = (config: LingoTrackerConfig = baseConfig) => writeFileSync(configPath(), JSON.stringify(config));

  beforeEach(() => {
    mkdirSync(join(tempDir(), 'i18n'));
    mkdirSync(join(tempDir(), 'config'));
    writeConfig();
  });

  describe('global list', () => {
    it('writes normalized, deduped, sorted terms to the default file', () => {
      const result = setGlobalProtectedTerms([' Node.js ', 'iPhone', 'iPhone'], { cwd: tempDir() });
      expect(result.filePath).toBe(defaultPath());
      expect(readJson(defaultPath())).toEqual(['iPhone', 'Node.js']);
    });
    it('leaves the config unchanged', () => {
      const before = readFileSync(configPath(), 'utf8');
      setGlobalProtectedTerms(['iPhone'], { cwd: tempDir() });
      expect(readFileSync(configPath(), 'utf8')).toBe(before);
    });
    it('writes an empty array when cleared', () => {
      writeFileSync(defaultPath(), '["iPhone"]');
      setGlobalProtectedTerms([], { cwd: tempDir() });
      expect(readJson(defaultPath())).toEqual([]);
      expect(existsSync(defaultPath())).toBe(true);
    });
    it('ends the file with a trailing newline', () => {
      setGlobalProtectedTerms(['iPhone'], { cwd: tempDir() });
      expect(readFileSync(defaultPath(), 'utf8')).toBe('[\n  "iPhone"\n]\n');
    });
  });

  describe('collection list', () => {
    it('writes to the collection file when configured', () => {
      writeConfig({
        ...baseConfig,
        collections: { myApp: { ...baseConfig.collections['myApp'], protectedTermsFile: 'i18n/terms.json' } },
      });
      const result = setCollectionProtectedTerms('myApp', ['iPhone', ' Node.js '], { cwd: tempDir() });
      expect(result.filePath).toBe(join(tempDir(), 'i18n/terms.json'));
      expect(readJson(result.filePath)).toEqual(['iPhone', 'Node.js']);
    });
    it('rejects a collection with no terms file', () => {
      expect(() => setCollectionProtectedTerms('myApp', ['iPhone'], { cwd: tempDir() })).toThrow(
        'has no protected terms file',
      );
    });
    it('rejects an unknown collection', () => {
      expect(() => setCollectionProtectedTerms('nope', ['iPhone'], { cwd: tempDir() })).toThrow(
        'Collection "nope" not found',
      );
    });
  });

  describe('global pointer', () => {
    it('stores the pointer and carries terms into the new file', () => {
      writeFileSync(defaultPath(), '["iPhone"]');
      const result = setGlobalProtectedTermsFile('config/terms.json', { cwd: tempDir() });
      expect(result.filePath).toBe(join(tempDir(), 'config/terms.json'));
      expect((readJson(configPath()) as LingoTrackerConfig).protectedTermsFile).toBe('config/terms.json');
      expect(readJson(result.filePath)).toEqual(['iPhone']);
    });
    it.each([undefined, '', '   '])('clears the pointer for %j', (pointer) => {
      setGlobalProtectedTermsFile(pointer, { cwd: tempDir() });
      expect((readJson(configPath()) as LingoTrackerConfig).protectedTermsFile).toBeUndefined();
    });
    it('leaves config untouched for a missing target directory', () => {
      const before = readFileSync(configPath(), 'utf8');
      expect(() => setGlobalProtectedTermsFile('nope/terms.json', { cwd: tempDir() })).toThrow(
        'directory does not exist',
      );
      expect(readFileSync(configPath(), 'utf8')).toBe(before);
    });
  });

  describe('collection pointer', () => {
    it('stores the pointer and creates the file', () => {
      const result = setCollectionProtectedTermsFile('myApp', 'i18n/terms.json', { cwd: tempDir() });
      expect(result.filePath).toBe(join(tempDir(), 'i18n/terms.json'));
      expect((readJson(configPath()) as LingoTrackerConfig).collections['myApp'].protectedTermsFile).toBe(
        'i18n/terms.json',
      );
      expect(readJson(result.filePath ?? '')).toEqual([]);
    });
    it.each([undefined, '', '   '])('clears the pointer for %j', (pointer) => {
      const result = setCollectionProtectedTermsFile('myApp', pointer, { cwd: tempDir() });
      expect(result.filePath).toBeUndefined();
      expect(result.message).toBe('Collection "myApp" protected terms file cleared');
      expect((readJson(configPath()) as LingoTrackerConfig).collections['myApp'].protectedTermsFile).toBeUndefined();
    });
    it('preserves a translation override and the rest of the record', () => {
      const translation = { enabled: false, provider: 'none' as const, apiKeyEnv: 'NONE' };
      writeConfig({ ...baseConfig, collections: { myApp: { ...baseConfig.collections['myApp'], translation } } });
      setCollectionProtectedTermsFile('myApp', 'i18n/terms.json', { cwd: tempDir() });
      expect((readJson(configPath()) as LingoTrackerConfig).collections['myApp']).toEqual({
        translationsFolder: './i18n',
        tags: ['feature-a'],
        translation,
        protectedTermsFile: 'i18n/terms.json',
      });
    });
    it('rejects an unknown collection', () => {
      expect(() => setCollectionProtectedTermsFile('nope', 'terms.json', { cwd: tempDir() })).toThrow(
        'Collection "nope" not found',
      );
    });
    it('leaves config untouched for a missing target directory', () => {
      const before = readFileSync(configPath(), 'utf8');
      expect(() => setCollectionProtectedTermsFile('myApp', 'nope/terms.json', { cwd: tempDir() })).toThrow(
        'directory does not exist',
      );
      expect(readFileSync(configPath(), 'utf8')).toBe(before);
    });
  });

  it('adds, removes, and replaces terms through one edit interface', () => {
    writeFileSync(defaultPath(), '["iPhone"]');
    expect(
      editProtectedTerms(
        {},
        readProtectedTermsTarget(readConfig(), {}, tempDir()),
        { add: [' Node.js ', 'iPhone'] },
        { cwd: tempDir() },
      ).terms,
    ).toEqual(['iPhone', 'Node.js']);
    expect(
      editProtectedTerms(
        {},
        readProtectedTermsTarget(readConfig(), {}, tempDir()),
        { remove: ['iPhone'] },
        { cwd: tempDir() },
      ).terms,
    ).toEqual(['Node.js']);
    expect(
      editProtectedTerms(
        {},
        readProtectedTermsTarget(readConfig(), {}, tempDir()),
        { set: ' C++, C++ ' },
        { cwd: tempDir() },
      ).terms,
    ).toEqual(['C++']);
    expect(readJson(defaultPath())).toEqual(['C++']);
  });

  it('changes a pointer before adding to the new file and reports the list before the edit', () => {
    writeFileSync(defaultPath(), '["iPhone"]');
    setGlobalProtectedTermsFile('config/terms.json', { cwd: tempDir() });
    const view = readProtectedTermsTarget(readConfig(), {}, tempDir());
    const result = editProtectedTerms({}, view, { add: ['Pixel'] }, { cwd: tempDir() });
    expect(view.globalTerms).toEqual(['iPhone']);
    expect(result.terms).toEqual(['iPhone', 'Pixel']);
    expect(result.filePath).toBe(join(tempDir(), 'config/terms.json'));
    expect(readJson(result.filePath)).toEqual(['iPhone', 'Pixel']);
  });

  it('does not overwrite a malformed list during an edit', () => {
    writeFileSync(defaultPath(), '{broken');
    expect(() => readProtectedTermsTarget(readConfig(), {}, tempDir())).toThrow('not valid JSON');
    expect(readFileSync(defaultPath(), 'utf8')).toBe('{broken');
  });

  it('rejects an unknown collection with CollectionNotFoundError', () => {
    expect(() => readProtectedTermsTarget(readConfig(), { collection: 'missing' }, tempDir())).toThrow(
      CollectionNotFoundError,
    );
  });

  it('returns warnings, stored lists, and the effective union before an edit', () => {
    writeConfig({
      ...baseConfig,
      protectedTermsFile: 'missing.json',
      collections: { myApp: { ...baseConfig.collections['myApp'], protectedTermsFile: 'i18n/own.json' } },
    });
    writeFileSync(join(tempDir(), 'i18n/own.json'), '["Pixel"]');
    const view = readProtectedTermsTarget(readConfig(), { collection: 'myApp' }, tempDir());
    expect(view.warnings).toEqual([
      `Protected terms file not found: ${join(tempDir(), 'missing.json')}. Treating as an empty list.`,
    ]);
    expect(view.globalTerms).toEqual([]);
    expect(view.collectionTerms).toEqual(['Pixel']);
    expect(view.storedTerms).toEqual(['Pixel']);
    expect(view.effectiveTerms).toEqual(['Pixel']);
    expect(view.globalFilePath).toBe(join(tempDir(), 'missing.json'));
    expect(view.collectionFilePath).toBe(join(tempDir(), 'i18n/own.json'));
    writeFileSync(join(tempDir(), 'missing.json'), '["iPhone"]');
    const populated = readProtectedTermsTarget(readConfig(), { collection: 'myApp' }, tempDir());
    expect(populated.warnings).toEqual([]);
    expect(populated.effectiveTerms).toEqual(['iPhone', 'Pixel']);
  });

  it('rejects a non-string list before writing a term file', () => {
    const before = readFileSync(configPath(), 'utf8');
    expect(() => setGlobalProtectedTerms(['iPhone', 42] as never, { cwd: tempDir() })).toThrow(
      'protectedTerms must be an array of strings',
    );
    expect(existsSync(defaultPath())).toBe(false);
    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });
});
