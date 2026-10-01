import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../../testing/temp-dir.spec-helpers';
import { CollectionBaseLocaleMismatchError } from '../errors/lingo-tracker-error';
import { collectionResourceStatus, readCollectionSet } from './collection-set';

describe('Collection Set', () => {
  const root = useTempDir('collection-set-');

  describe('readCollectionSet (real fs)', () => {
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

      const { resources, readProblems } = readCollectionSet([collection]);

      expect(readProblems).toEqual([]);
      expect(resources).toEqual([
        {
          key: 'ok',
          fullKey: 'button.ok',
          source: 'OK',
          translations: { es: 'Vale' },
          tags: ['ui'],
          effectiveTags: ['shared', 'ui'],
          comment: 'Confirm',
          status: { es: 'translated' },
          collection: 'Core',
          targetLocales: ['fr', 'es'],
        },
      ]);
    });

    it('includes an entry without metadata, with no status', () => {
      writeFolderFiles(root(), '', { entries: { key: { source: 'val' } }, meta: {} });

      const { resources } = readCollectionSet([testCollection(root())]);

      expect(resources).toHaveLength(1);
      expect(resources[0]?.status).toEqual({});
      const resource = resources[0];
      if (resource) expect(collectionResourceStatus(resource, 'fr')).toBe('new');
    });

    it('returns unreadable folders as problems', () => {
      writeFolderFiles(root(), 'bad', { entries: '{ nope' });

      const { resources, readProblems } = readCollectionSet([testCollection(root(), { name: 'main' })]);

      expect(resources).toEqual([]);
      expect(readProblems).toEqual([
        expect.objectContaining({ collection: 'main', folderPath: 'bad', message: expect.any(String) }),
      ]);
    });

    it('reads nothing from a missing translations folder', () => {
      const missing = join(root(), 'missing');

      expect(readCollectionSet([testCollection(missing)])).toEqual({
        baseLocale: 'en',
        targetLocales: ['fr', 'es'],
        resources: [],
        readProblems: [],
      });
      expect(existsSync(missing)).toBe(false);
    });
  });

  it('requires one base locale when resources will be combined', () => {
    const english = testCollection(join(root(), 'english'), { name: 'english' });
    const french = testCollection(join(root(), 'french'), { name: 'french', baseLocale: 'fr' });

    let error: unknown;
    try {
      readCollectionSet([english, french]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CollectionBaseLocaleMismatchError);
    expect(error).toMatchObject({
      kind: 'invalid',
      code: 'COLLECTION_BASE_LOCALE_MISMATCH',
      collections: [
        { name: 'english', baseLocale: 'en' },
        { name: 'french', baseLocale: 'fr' },
      ],
    });
  });

  it('scopes the ordered target union and preserves each resource collection targets', () => {
    const first = testCollection(join(root(), 'first'), { name: 'first', locales: ['en', 'fr', 'es'] });
    const second = testCollection(join(root(), 'second'), { name: 'second', locales: ['en', 'de', 'fr'] });
    seedResources(first, { one: { source: 'One', translations: { fr: 'Un' } } });
    seedResources(second, { two: { source: 'Two', translations: { de: 'Zwei' } } });

    const set = readCollectionSet([first, second], { locales: ['de', 'fr'] });

    expect(set.targetLocales).toEqual(['fr', 'de']);
    expect(set.resources.map(({ fullKey, targetLocales }) => ({ fullKey, targetLocales }))).toEqual([
      { fullKey: 'one', targetLocales: ['fr', 'es'] },
      { fullKey: 'two', targetLocales: ['de', 'fr'] },
    ]);
  });

  it('allows per-collection validation with different base locales', () => {
    const english = testCollection(join(root(), 'english'), { name: 'english' });
    const french = testCollection(join(root(), 'french'), { name: 'french', baseLocale: 'fr' });
    const set = readCollectionSet([english, french], { allowDifferentBaseLocales: true });
    expect(set.baseLocale).toBe('en');
    expect(set.targetLocales).toEqual(['fr', 'es']);
  });
});
