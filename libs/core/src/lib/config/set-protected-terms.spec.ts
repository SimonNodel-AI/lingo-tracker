import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import { CollectionNotFoundError } from '../errors/lingo-tracker-error';
import {
  readProtectedTermsTarget,
  type ProtectedTermsEdit,
  type ProtectedTermsEditResult,
  type ProtectedTermsView,
} from './set-protected-terms';
import { loadConfig } from './load-config';
import { updateProjectTerms } from './update-project-terms';

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
  const writeConfig = (config: LingoTrackerConfig = baseConfig) => writeFileSync(configPath(), JSON.stringify(config));
  const project = () => ({ projectRoot: tempDir(), sourceConfig: loadConfig({ cwd: tempDir() }) });
  const termResult = (result: ProtectedTermsEditResult | undefined): ProtectedTermsEditResult => {
    if (!result) throw new Error('Missing protected terms result');
    return result;
  };
  const replaceGlobalTerms = (terms: string[]) =>
    termResult(
      updateProjectTerms(project(), { protectedTerms: { target: {}, change: { kind: 'replace', replace: terms } } })
        .protectedTermsResult,
    );
  const replaceCollectionTerms = (collection: string, terms: string[]) =>
    termResult(
      updateProjectTerms(project(), {
        protectedTerms: { target: { collection }, change: { kind: 'edit', edit: { set: terms } } },
      }).protectedTermsResult,
    );
  const changeGlobalTermsPointer = (pointer: string | undefined) => {
    const result = updateProjectTerms(project(), {
      protectedTerms: { target: {}, change: { kind: 'view' }, file: pointer ?? '' },
    }).protectedTermsFileChange;
    if (!result) throw new Error('Missing pointer result');
    return result;
  };
  const changeCollectionTermsPointer = (collection: string, pointer: string | undefined) => {
    const result = updateProjectTerms(project(), {
      protectedTerms: { target: { collection }, change: { kind: 'view' }, file: pointer ?? '' },
    }).protectedTermsFileChange;
    if (!result) throw new Error('Missing pointer result');
    return result;
  };
  const applyTermsEdit = (target: { collection?: string }, _view: ProtectedTermsView, edit: ProtectedTermsEdit) =>
    termResult(
      updateProjectTerms(project(), { protectedTerms: { target, change: { kind: 'edit', edit } } })
        .protectedTermsResult,
    );

  beforeEach(() => {
    mkdirSync(join(tempDir(), 'i18n'));
    mkdirSync(join(tempDir(), 'config'));
    writeConfig();
  });

  describe('global list', () => {
    it('writes normalized, deduped, sorted terms to the default file', () => {
      const result = replaceGlobalTerms([' Node.js ', 'iPhone', 'iPhone']);
      expect(result.filePath).toBe(defaultPath());
      expect(readJson(defaultPath())).toEqual(['iPhone', 'Node.js']);
    });
    it('leaves the config unchanged', () => {
      const before = readFileSync(configPath(), 'utf8');
      replaceGlobalTerms(['iPhone']);
      expect(readFileSync(configPath(), 'utf8')).toBe(before);
    });
    it('writes an empty array when cleared', () => {
      writeFileSync(defaultPath(), '["iPhone"]');
      replaceGlobalTerms([]);
      expect(readJson(defaultPath())).toEqual([]);
      expect(existsSync(defaultPath())).toBe(true);
    });
    it('ends the file with a trailing newline', () => {
      replaceGlobalTerms(['iPhone']);
      expect(readFileSync(defaultPath(), 'utf8')).toBe('[\n  "iPhone"\n]\n');
    });
  });

  describe('collection list', () => {
    it('writes to the collection file when configured', () => {
      writeConfig({
        ...baseConfig,
        collections: { myApp: { ...baseConfig.collections['myApp'], protectedTermsFile: 'i18n/terms.json' } },
      });
      const result = replaceCollectionTerms('myApp', ['iPhone', ' Node.js ']);
      expect(result.filePath).toBe(join(tempDir(), 'i18n/terms.json'));
      expect(readJson(result.filePath ?? '')).toEqual(['iPhone', 'Node.js']);
    });
    it('rejects a collection with no terms file', () => {
      expect(() => replaceCollectionTerms('myApp', ['iPhone'])).toThrow('has no protected terms file');
    });
    it('rejects an unknown collection', () => {
      expect(() => replaceCollectionTerms('nope', ['iPhone'])).toThrow('Collection "nope" not found');
    });
  });

  describe('global pointer', () => {
    it('stores the pointer and carries terms into the new file', () => {
      writeFileSync(defaultPath(), '["iPhone"]');
      const result = changeGlobalTermsPointer('config/terms.json');
      expect(result.filePath).toBe(join(tempDir(), 'config/terms.json'));
      expect((readJson(configPath()) as LingoTrackerConfig).protectedTermsFile).toBe('config/terms.json');
      expect(readJson(result.filePath ?? '')).toEqual(['iPhone']);
    });
    it.each([undefined, '', '   '])('clears the pointer for %j', (pointer) => {
      changeGlobalTermsPointer(pointer);
      expect((readJson(configPath()) as LingoTrackerConfig).protectedTermsFile).toBeUndefined();
    });
    it('leaves config untouched for a missing target directory', () => {
      const before = readFileSync(configPath(), 'utf8');
      expect(() => changeGlobalTermsPointer('nope/terms.json')).toThrow('directory does not exist');
      expect(readFileSync(configPath(), 'utf8')).toBe(before);
    });
  });

  describe('collection pointer', () => {
    it('stores the pointer and creates the file', () => {
      const result = changeCollectionTermsPointer('myApp', 'i18n/terms.json');
      expect(result.filePath).toBe(join(tempDir(), 'i18n/terms.json'));
      expect((readJson(configPath()) as LingoTrackerConfig).collections['myApp'].protectedTermsFile).toBe(
        'i18n/terms.json',
      );
      expect(readJson(result.filePath ?? '')).toEqual([]);
    });
    it.each([undefined, '', '   '])('clears the pointer for %j', (pointer) => {
      const result = changeCollectionTermsPointer('myApp', pointer);
      expect(result.filePath).toBeUndefined();
      expect(result.message).toBe('Collection "myApp" protected terms file cleared');
      expect((readJson(configPath()) as LingoTrackerConfig).collections['myApp'].protectedTermsFile).toBeUndefined();
    });
    it('preserves a translation override and the rest of the record', () => {
      const translation = { enabled: false, provider: 'none' as const, apiKeyEnv: 'NONE' };
      writeConfig({ ...baseConfig, collections: { myApp: { ...baseConfig.collections['myApp'], translation } } });
      changeCollectionTermsPointer('myApp', 'i18n/terms.json');
      expect((readJson(configPath()) as LingoTrackerConfig).collections['myApp']).toEqual({
        translationsFolder: './i18n',
        tags: ['feature-a'],
        translation,
        protectedTermsFile: 'i18n/terms.json',
      });
    });
    it('rejects an unknown collection', () => {
      expect(() => changeCollectionTermsPointer('nope', 'terms.json')).toThrow('Collection "nope" not found');
    });
    it('leaves config untouched for a missing target directory', () => {
      const before = readFileSync(configPath(), 'utf8');
      expect(() => changeCollectionTermsPointer('myApp', 'nope/terms.json')).toThrow('directory does not exist');
      expect(readFileSync(configPath(), 'utf8')).toBe(before);
    });
  });

  it('adds, removes, and replaces terms through one edit interface', () => {
    writeFileSync(defaultPath(), '["iPhone"]');
    expect(applyTermsEdit({}, readProtectedTermsTarget(project(), {}), { add: [' Node.js ', 'iPhone'] }).terms).toEqual(
      ['iPhone', 'Node.js'],
    );
    expect(applyTermsEdit({}, readProtectedTermsTarget(project(), {}), { remove: ['iPhone'] }).terms).toEqual([
      'Node.js',
    ]);
    expect(applyTermsEdit({}, readProtectedTermsTarget(project(), {}), { set: [' C++', ' C++ '] }).terms).toEqual([
      'C++',
    ]);
    expect(readJson(defaultPath())).toEqual(['C++']);
  });

  it('changes a pointer before adding to the new file and reports the list before the edit', () => {
    writeFileSync(defaultPath(), '["iPhone"]');
    changeGlobalTermsPointer('config/terms.json');
    const view = readProtectedTermsTarget(project(), {});
    const result = applyTermsEdit({}, view, { add: ['Pixel'] });
    expect(view.globalTerms).toEqual(['iPhone']);
    expect(result.terms).toEqual(['iPhone', 'Pixel']);
    expect(result.filePath).toBe(join(tempDir(), 'config/terms.json'));
    expect(readJson(result.filePath ?? '')).toEqual(['iPhone', 'Pixel']);
  });

  it('does not overwrite a malformed list during an edit', () => {
    writeFileSync(defaultPath(), '{broken');
    expect(() => readProtectedTermsTarget(project(), {})).toThrow('not valid JSON');
    expect(readFileSync(defaultPath(), 'utf8')).toBe('{broken');
  });

  it('rejects an unknown collection with CollectionNotFoundError', () => {
    expect(() => readProtectedTermsTarget(project(), { collection: 'missing' })).toThrow(CollectionNotFoundError);
  });

  it('returns warnings, stored lists, and the effective union before an edit', () => {
    writeConfig({
      ...baseConfig,
      protectedTermsFile: 'missing.json',
      collections: { myApp: { ...baseConfig.collections['myApp'], protectedTermsFile: 'i18n/own.json' } },
    });
    writeFileSync(join(tempDir(), 'i18n/own.json'), '["Pixel"]');
    const view = readProtectedTermsTarget(project(), { collection: 'myApp' });
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
    const populated = readProtectedTermsTarget(project(), { collection: 'myApp' });
    expect(populated.warnings).toEqual([]);
    expect(populated.effectiveTerms).toEqual(['iPhone', 'Pixel']);
  });

  it('rejects a non-string list before writing a term file', () => {
    const before = readFileSync(configPath(), 'utf8');
    expect(() => replaceGlobalTerms(['iPhone', 42] as never)).toThrow('protectedTerms must be an array of strings');
    expect(existsSync(defaultPath())).toBe(false);
    expect(readFileSync(configPath(), 'utf8')).toBe(before);
  });
});
