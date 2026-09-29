import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { writeJsonFile } from '../lib/file-io/json-file-operations';
import { readCollection } from '../lib/resource/read-collection';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../testing/temp-dir.spec-helpers';
import { calculateChecksum } from './checksum';
import { relocateEntries } from './relocate-entries';

vi.mock('../lib/file-io/json-file-operations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/file-io/json-file-operations')>();
  return { ...actual, writeJsonFile: vi.fn(actual.writeJsonFile) };
});

const md5 = calculateChecksum;

describe('relocateEntries (real fs)', () => {
  const root = useTempDir('relocate-entries-');
  const main = () => testCollection(join(root(), 'main'));
  const keysOf = (translationsFolder: string, collection = main()) =>
    readCollection({ ...collection, translationsFolder }).resources.map((resource) => resource.fullKey);

  it('moves a batch with one save per folder, whatever the number of entries', () => {
    seedResources(main(), {
      'common.a': { source: 'A' },
      'common.b': { source: 'B' },
      'common.c': { source: 'C' },
      'common.stays': { source: 'Stays' },
    });
    vi.mocked(writeJsonFile).mockClear();

    const result = relocateEntries(main(), main(), [
      { from: 'common.a', to: 'shared.a' },
      { from: 'common.b', to: 'shared.b' },
      { from: 'common.c', to: 'shared.c' },
    ]);

    expect(result.errors).toEqual([]);
    expect(result.moved.map(({ from, to }) => [from, to])).toEqual([
      ['common.a', 'shared.a'],
      ['common.b', 'shared.b'],
      ['common.c', 'shared.c'],
    ]);
    // Two folders, two files each: written once.
    expect(vi.mocked(writeJsonFile)).toHaveBeenCalledTimes(4);
    expect(keysOf(main().translationsFolder).sort()).toEqual(['common.stays', 'shared.a', 'shared.b', 'shared.c']);
    expect(result.mutations.map((mutation) => [mutation.kind, 'key' in mutation ? mutation.key : ''])).toEqual([
      ['remove', 'common.a'],
      ['remove', 'common.b'],
      ['remove', 'common.c'],
      ['upsert', 'shared.a'],
      ['upsert', 'shared.b'],
      ['upsert', 'shared.c'],
    ]);
  });

  it('carries values and metadata as they are within a collection', () => {
    seedResources(main(), {
      'common.ok': {
        source: 'OK',
        comment: 'Button',
        tags: ['ui'],
        translations: { fr: { value: 'Bien', status: 'verified' } },
      },
    });

    const [moved] = relocateEntries(main(), main(), [{ from: 'common.ok', to: 'shared.ok' }]).moved;

    expect(moved?.entry).toMatchObject({ source: 'OK', comment: 'Button', tags: ['ui'], translations: { fr: 'Bien' } });
    expect(moved?.entry.metadata['fr']?.status).toBe('verified');
    // Same collection: a missing target locale (es) is not seeded; that is normalize's job.
    expect(moved?.entry.translations['es']).toBeUndefined();
    expect(existsSync(join(main().translationsFolder, 'common', 'resource_entries.json'))).toBe(false);
  });

  it('treats a taken destination as a collision, or replaces it with override', () => {
    seedResources(main(), { 'common.ok': { source: 'OK' }, 'shared.ok': { source: 'Taken' } });

    const refused = relocateEntries(main(), main(), [{ from: 'common.ok', to: 'shared.ok' }]);
    expect(refused.moved).toEqual([]);
    expect(refused.collisions).toEqual([{ from: 'common.ok', to: 'shared.ok' }]);
    expect(refused.mutations).toEqual([]);
    expect(keysOf(main().translationsFolder).sort()).toEqual(['common.ok', 'shared.ok']);

    const replaced = relocateEntries(main(), main(), [{ from: 'common.ok', to: 'shared.ok' }], { override: true });
    expect(replaced.collisions).toEqual([]);
    expect(replaced.moved[0]?.entry.source).toBe('OK');
    expect(keysOf(main().translationsFolder)).toEqual(['shared.ok']);
  });

  it('counts a key the batch moves away from as free, and never moves two entries to one key', () => {
    seedResources(main(), { 'a.k': { source: 'Outer' }, 'a.b.k': { source: 'Inner' }, 'x.dup': { source: 'Dup' } });

    const result = relocateEntries(main(), main(), [
      { from: 'a.k', to: 'a.b.k' },
      { from: 'a.b.k', to: 'a.b.b.k' },
      { from: 'x.dup', to: 'a.b.b.k' },
    ]);

    expect(result.moved.map(({ from }) => from)).toEqual(['a.k', 'a.b.k']);
    expect(result.collisions).toEqual([{ from: 'x.dup', to: 'a.b.b.k' }]);
    const entries = readCollection(main()).resources.map((resource) => [resource.fullKey, resource.entry.source]);
    expect(entries.sort()).toEqual([
      ['a.b.b.k', 'Inner'],
      ['a.b.k', 'Outer'],
      ['x.dup', 'Dup'],
    ]);
  });

  it('keeps an entry whose destination stays taken because another relocation collided', () => {
    seedResources(main(), { 'p.one': { source: 'One' }, 'q.one': { source: 'Two' }, 'r.one': { source: 'Taken' } });

    // q.one cannot move to r.one, so p.one cannot take q.one's place.
    const result = relocateEntries(main(), main(), [
      { from: 'p.one', to: 'q.one' },
      { from: 'q.one', to: 'r.one' },
    ]);

    expect(result.moved).toEqual([]);
    expect(result.collisions.map(({ from }) => from)).toEqual(['p.one', 'q.one']);
  });

  it('fits an entry moved into another collection to its locales', () => {
    const source = testCollection(join(root(), 'main'), { locales: ['en', 'fr', 'es'] });
    const target = testCollection(join(root(), 'other'), { name: 'other', locales: ['en', 'fr', 'de'] });
    seedResources(source, {
      'common.ok': { source: 'OK', translations: { fr: { value: 'Bien', status: 'verified' }, es: 'Vale' } },
    });

    const result = relocateEntries(source, target, [{ from: 'common.ok', to: 'common.ok' }]);

    const entry = result.moved[0]?.entry;
    expect(entry?.translations).toEqual({ fr: 'Bien', de: 'OK' });
    expect(entry?.metadata).toEqual({
      en: { checksum: md5('OK') },
      fr: { checksum: md5('Bien'), baseChecksum: md5('OK'), status: 'verified' },
      de: { checksum: md5('OK'), baseChecksum: md5('OK'), status: 'new' },
    });
    expect(result.mutations).toEqual([
      { kind: 'remove', translationsFolder: source.translationsFolder, key: 'common.ok' },
      expect.objectContaining({ kind: 'upsert', translationsFolder: target.translationsFolder, key: 'common.ok' }),
    ]);
    expect(keysOf(source.translationsFolder, source)).toEqual([]);
  });

  it('refuses to move between collections with different base locales', () => {
    seedResources(main(), { 'common.ok': { source: 'OK' } });
    const french = testCollection(join(root(), 'fr'), { name: 'fr', baseLocale: 'fr', locales: ['fr', 'en'] });

    const result = relocateEntries(main(), french, [{ from: 'common.ok', to: 'common.ok' }]);

    expect(result.moved).toEqual([]);
    expect(result.errors[0]).toContain('base locale');
    expect(keysOf(main().translationsFolder)).toEqual(['common.ok']);
  });

  it('reports bad keys, missing entries, unreadable folders and a move onto itself, and moves the rest', () => {
    seedResources(main(), { 'common.ok': { source: 'OK' }, 'common.fine': { source: 'Fine' } });
    writeFolderFiles(main().translationsFolder, 'broken', { entries: '{ not json' });

    const result = relocateEntries(main(), main(), [
      { from: 'common..bad', to: 'shared.bad' },
      { from: 'common.missing', to: 'shared.missing' },
      { from: 'common.ok', to: 'broken.ok' },
      { from: 'common.fine', to: 'common.fine' },
      { from: 'common.ok', to: 'shared.ok' },
    ]);

    expect(result.errors).toHaveLength(4);
    expect(result.errors[1]).toBe('Source key not found: common.missing');
    expect(result.errors[2]).toContain('Failed to read destination file for key: broken.ok');
    expect(result.errors[3]).toBe('Source and destination are the same key: common.fine');
    expect(result.moved.map(({ to }) => to)).toEqual(['shared.ok']);
  });
});
