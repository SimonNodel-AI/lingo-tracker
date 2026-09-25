import { chmodSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../../testing/temp-dir.spec-helpers';
import {
  filterResources,
  type LoadedResource,
  loadResources,
  validateBasePropertyName,
  validateOutputDirectory,
} from './export-common';

describe('export-common', () => {
  const root = useTempDir('export-common-');

  describe('validateOutputDirectory (real fs)', () => {
    it('should create directory if it does not exist', () => {
      const directory = join(root(), 'dist', 'export');

      validateOutputDirectory(directory);

      expect(statSync(directory).isDirectory()).toBe(true);
    });

    it('should throw error if directory cannot be created', () => {
      writeFileSync(join(root(), 'file'), '');

      expect(() => validateOutputDirectory(join(root(), 'file', 'export'))).toThrow(
        'Could not create output directory',
      );
    });

    it.skipIf(process.getuid?.() === 0)('should throw error if directory is not writable', () => {
      const directory = join(root(), 'read-only');
      validateOutputDirectory(directory);
      chmodSync(directory, 0o500);

      try {
        expect(() => validateOutputDirectory(directory)).toThrow('not writable');
      } finally {
        chmodSync(directory, 0o700);
      }
    });
  });

  describe('loadResources (real fs)', () => {
    it('flattens each entry with its collection, translations, status and tags', () => {
      const collection = testCollection(root(), { name: 'Core', tags: ['shared'] });
      seedResources(collection, {
        'button.ok': {
          source: 'OK',
          comment: 'Confirm',
          tags: ['ui'],
          translations: { es: { value: 'Vale', status: 'translated' } },
        },
      });

      const { resources, problems } = loadResources(collection, ['Acme']);

      expect(problems).toEqual([]);
      expect(resources).toEqual([
        {
          key: 'ok',
          fullKey: 'button.ok',
          source: 'OK',
          translations: { es: 'Vale' },
          tags: ['ui'],
          effectiveTags: ['shared', 'ui'],
          collectionProtectedTerms: ['Acme'],
          comment: 'Confirm',
          status: { es: 'translated' },
          collection: 'Core',
        },
      ]);
    });

    it('includes an entry without metadata, with no status', () => {
      writeFolderFiles(root(), '', { entries: { key: { source: 'val' } }, meta: {} });

      const { resources } = loadResources(testCollection(root()));

      expect(resources).toHaveLength(1);
      expect(resources[0]?.status).toEqual({});
    });

    it('returns unreadable folders as problems', () => {
      writeFolderFiles(root(), 'bad', { entries: '{ nope' });

      const { resources, problems } = loadResources(testCollection(root()));

      expect(resources).toEqual([]);
      expect(problems.map((problem) => problem.folderPath)).toEqual(['bad']);
    });

    it('reads nothing from a missing translations folder', () => {
      const missing = join(root(), 'missing');

      expect(loadResources(testCollection(missing))).toEqual({ resources: [], problems: [] });
      expect(existsSync(missing)).toBe(false);
    });
  });

  describe('filterResources', () => {
    const mockResources: LoadedResource[] = [
      {
        key: 'key1',
        fullKey: 'key1',
        source: 'Source 1',
        translations: { es: 'Val 1' },
        status: { es: 'translated' },
        collection: 'Core',
        tags: ['ui'],
        effectiveTags: ['ui'],
      },
      {
        key: 'key2',
        fullKey: 'key2',
        source: 'Source 2',
        translations: {}, // Missing translation
        status: { es: 'new' },
        collection: 'Core',
        tags: ['backend'],
        effectiveTags: ['backend'],
      },
      {
        key: 'key3',
        fullKey: 'key3',
        source: 'Source 3',
        translations: { es: 'Val 3' },
        status: { es: 'verified' },
        collection: 'App',
        effectiveTags: [],
      },
    ];

    it('should filter by status', () => {
      const result = filterResources(mockResources, 'es', ['translated'], undefined);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('key1');
    });

    it('should filter by tags', () => {
      const result = filterResources(mockResources, 'es', undefined, ['ui']);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('key1');
    });

    it('should combine status and tag filters', () => {
      const result = filterResources(mockResources, 'es', ['translated'], ['backend']);
      expect(result).toHaveLength(0);
    });

    it('should include untranslated resources if status filter allows new', () => {
      const result = filterResources(mockResources, 'es', ['new'], undefined);
      expect(result).toHaveLength(1);
      expect(result[0].key).toBe('key2');
    });

    it('computes protectedTermsFound from source for non-base locales', () => {
      const resources: LoadedResource[] = [
        {
          key: 'k1',
          fullKey: 'k1',
          source: 'Welcome to iPhone',
          translations: { es: 'Bienvenido' },
          status: { es: 'new' },
          collection: 'Core',
          effectiveTags: [],
          collectionProtectedTerms: ['iPhone'],
        },
      ];

      const result = filterResources(resources, 'es', undefined, undefined, {
        globalProtectedTerms: ['SimonCodes'],
        baseLocale: 'en',
      });

      expect(result[0].protectedTermsFound).toEqual(['iPhone']);
    });

    it('unions global and collection terms', () => {
      const resources: LoadedResource[] = [
        {
          key: 'k1',
          fullKey: 'k1',
          source: 'iPhone by SimonCodes',
          translations: { es: 'Bienvenido' },
          status: { es: 'new' },
          collection: 'Core',
          effectiveTags: [],
          collectionProtectedTerms: ['iPhone'],
        },
      ];

      const result = filterResources(resources, 'es', undefined, undefined, {
        globalProtectedTerms: ['SimonCodes'],
        baseLocale: 'en',
      });

      expect(result[0].protectedTermsFound).toEqual(['SimonCodes', 'iPhone']);
    });

    it('leaves protectedTermsFound undefined for the base locale', () => {
      const result = filterResources(mockResources, 'en', undefined, undefined, {
        baseLocale: 'en',
      });

      expect(result[0].protectedTermsFound).toBeUndefined();
    });

    it('leaves protectedTermsFound undefined when augmentation is disabled', () => {
      const resources: LoadedResource[] = [
        {
          key: 'k1',
          fullKey: 'k1',
          source: 'Welcome to iPhone',
          translations: { es: 'Bienvenido' },
          status: { es: 'new' },
          collection: 'Core',
          effectiveTags: [],
        },
      ];

      const result = filterResources(resources, 'es', undefined, undefined, {
        augmentProtectedTerms: false,
        baseLocale: 'en',
      });

      expect(result[0].protectedTermsFound).toBeUndefined();
    });
  });

  describe('validateBasePropertyName', () => {
    it('should accept valid custom names', () => {
      expect(() => validateBasePropertyName('original')).not.toThrow();
      expect(() => validateBasePropertyName('source')).not.toThrow();
      expect(() => validateBasePropertyName('base')).not.toThrow();
      expect(() => validateBasePropertyName('baseValue')).not.toThrow();
    });

    it('should throw for empty string', () => {
      expect(() => validateBasePropertyName('')).toThrow('basePropertyName cannot be empty');
    });

    it('should throw for reserved key: value', () => {
      expect(() => validateBasePropertyName('value')).toThrow('"value"');
    });

    it('should throw for reserved key: comment', () => {
      expect(() => validateBasePropertyName('comment')).toThrow('"comment"');
    });

    it('should throw for reserved key: status', () => {
      expect(() => validateBasePropertyName('status')).toThrow('"status"');
    });

    it('should throw for reserved key: tags', () => {
      expect(() => validateBasePropertyName('tags')).toThrow('"tags"');
    });
  });
});
