import type { ResourceMutation } from '../resource/resource-mutation';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTempDir } from '../../testing/temp-dir.spec-helpers';
import type { Collection } from '../config/open-collection';
import { CollectionNotFoundError, ReadOnlyCollectionError } from '../errors/lingo-tracker-error';
import { addResource } from '../resource/add-resource';
import { openResourceFolder } from '../resource/resource-folder';
import { moveFolder } from './move-folder';

const collected: ResourceMutation[] = [];
const onMutation = (mutation: ResourceMutation): void => {
  collected.push(mutation);
};
beforeEach(() => {
  collected.length = 0;
});

function collection(translationsFolder: string): Collection {
  return {
    name: 'main',
    translationsFolder,
    baseLocale: 'en',
    locales: ['en'],
    targetLocales: [],
    translationConfig: undefined,
    tags: [],
    termFiles: {
      protectedTerms: { path: '/nonexistent/.lingo-tracker-protected-terms.json', explicit: false },
      preferredTerminology: { path: '/nonexistent/.lingo-tracker-preferred-terminology.json', explicit: false },
    },
    readOnly: false,
    config: { translationsFolder },
  };
}

/**
 * Regression: a folder that could not be read (malformed tracker_meta.json) was silently skipped
 * while enumerating keys, so moveFolder deleted the source tree with that folder's entries never copied.
 */
describe('moveFolder with an unreadable folder (real fs)', () => {
  let root: string;

  const entries = JSON.stringify({ ok: { source: 'OK' } });

  function writeFolder(meta: string, ...segments: string[]): void {
    const folder = join(root, ...segments);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'resource_entries.json'), entries);
    writeFileSync(join(folder, 'tracker_meta.json'), meta);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'move-folder-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('refuses a missing destination before a folder move writes', async () => {
    writeFolder('{}', 'apps');
    const config = { exportFolder: 'dist', importFolder: 'import', baseLocale: 'en', locales: ['en'], collections: {} };
    await expect(
      moveFolder(
        collection(root),
        { sourceFolderPath: 'apps', destinationFolderPath: 'shared', toCollection: 'missing' },
        { config, onMutation },
      ),
    ).rejects.toThrow(CollectionNotFoundError);
    expect(collected).toEqual([]);
    expect(existsSync(join(root, 'apps', 'resource_entries.json'))).toBe(true);
  });

  it('refuses a read-only destination before a folder move writes', async () => {
    writeFolder('{}', 'apps');
    const config = {
      exportFolder: 'dist',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en'],
      collections: { vendor: { translationsFolder: 'vendor', readOnly: true } },
    };
    await expect(
      moveFolder(
        collection(root),
        { sourceFolderPath: 'apps', destinationFolderPath: 'shared', toCollection: 'vendor' },
        { config, cwd: root, onMutation },
      ),
    ).rejects.toThrow(ReadOnlyCollectionError);
    expect(collected).toEqual([]);
    expect(existsSync(join(root, 'apps', 'resource_entries.json'))).toBe(true);
  });

  it('reports an error and moves or deletes nothing when one child folder has malformed metadata', async () => {
    writeFolder(JSON.stringify({ ok: { en: { checksum: 'x' } } }), 'apps', 'good');
    writeFolder('{ not json', 'apps', 'bad');

    const result = await moveFolder(
      collection(root),
      {
        sourceFolderPath: 'apps',
        destinationFolderPath: 'shared',
      },
      { onMutation },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('apps.bad');
    expect(result.movedCount).toBe(0);
    expect(result.foldersDeleted).toBe(0);
    expect(existsSync(join(root, 'shared'))).toBe(false);
    expect(readFileSync(join(root, 'apps', 'good', 'resource_entries.json'), 'utf8')).toBe(entries);
    expect(readFileSync(join(root, 'apps', 'bad', 'resource_entries.json'), 'utf8')).toBe(entries);
  });

  it('does not delete a source folder whose only resources are unreadable', async () => {
    writeFolder('{ not json', 'apps', 'bad');

    const result = await moveFolder(
      collection(root),
      {
        sourceFolderPath: 'apps.bad',
        destinationFolderPath: 'shared',
      },
      { onMutation },
    );

    expect(result.errors).toHaveLength(1);
    expect(result.foldersDeleted).toBe(0);
    expect(readFileSync(join(root, 'apps', 'bad', 'resource_entries.json'), 'utf8')).toBe(entries);
  });
});

describe('moveFolder to the root without nesting (real fs)', () => {
  const root = useTempDir('move-folder-root-depth-');

  it('treats a depth-one source as already at the root and moves nothing', async () => {
    const source = collection(root());
    await addResource(source, { key: 'apps.one', baseValue: 'One' });

    const result = await moveFolder(
      source,
      {
        sourceFolderPath: 'apps',
        destinationFolderPath: '',
        nestUnderDestination: false,
      },
      { onMutation },
    );

    expect(result.warnings).toEqual(['Folder is already at this location. No move performed.']);
    expect(result.errors).toEqual([]);
    expect(result.movedCount).toBe(0);
    expect(collected).toEqual([]);
    expect(openResourceFolder(join(root(), 'apps'), { baseLocale: 'en' }).get('one')?.entry.source).toBe('One');
  });

  it('nests a depth-two source under the root', async () => {
    const source = collection(root());
    await addResource(source, { key: 'apps.deep.one', baseValue: 'One' });

    const result = await moveFolder(
      source,
      {
        sourceFolderPath: 'apps.deep',
        destinationFolderPath: '',
        nestUnderDestination: false,
      },
      { onMutation },
    );

    expect(result.errors).toEqual([]);
    expect(result.movedCount).toBe(1);
    expect(openResourceFolder(join(root(), 'deep'), { baseLocale: 'en' }).get('one')?.entry.source).toBe('One');
    expect(existsSync(join(root(), 'apps', 'deep'))).toBe(false);
    expect(collected.map((mutation) => [mutation.kind, 'key' in mutation ? mutation.key : ''])).toEqual([
      ['remove', 'apps.deep.one'],
      ['upsert', 'deep.one'],
      ['remove-folder', ''],
    ]);
  });

  it('nests common.testdata at the root and prunes the source folder', async () => {
    const source = collection(root());
    await addResource(source, { key: 'common.testdata.foo', baseValue: 'Foo' });

    const result = await moveFolder(
      source,
      {
        sourceFolderPath: 'common.testdata',
        destinationFolderPath: '',
      },
      { onMutation },
    );

    expect(result.errors).toEqual([]);
    expect(result.movedCount).toBe(1);
    expect(result.foldersDeleted).toBe(1);
    expect(openResourceFolder(join(root(), 'testdata'), { baseLocale: 'en' }).get('foo')?.entry.source).toBe('Foo');
    expect(existsSync(join(root(), 'testdata', 'resource_entries.json'))).toBe(true);
    expect(existsSync(join(root(), 'common', 'testdata'))).toBe(false);
  });
});

/**
 * Regression: with override off, a destination collision skipped that resource, but the source
 * folder was still deleted because another resource moved, losing the skipped resource.
 */
describe('moveFolder with a destination collision (real fs)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'move-folder-collision-'));
    await addResource(collection(root), { key: 'src.a', baseValue: 'Source A' });
    await addResource(collection(root), { key: 'src.b', baseValue: 'Source B' });
    await addResource(collection(root), { key: 'dst.src.a', baseValue: 'Existing A' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('moves the other resources, keeps the source folder with the skipped one, and reports matching mutations', async () => {
    const result = await moveFolder(
      collection(root),
      {
        sourceFolderPath: 'src',
        destinationFolderPath: 'dst',
        override: false,
      },
      { onMutation },
    );

    expect(result.movedCount).toBe(1);
    expect(result.foldersDeleted).toBe(0);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('src.a')]));

    expect(existsSync(join(root, 'src'))).toBe(true);
    expect(openResourceFolder(join(root, 'src'), { baseLocale: 'en' }).keys()).toEqual(['a']);
    expect(openResourceFolder(join(root, 'dst', 'src'), { baseLocale: 'en' }).get('b')?.entry.source).toBe('Source B');
    expect(openResourceFolder(join(root, 'dst', 'src'), { baseLocale: 'en' }).get('a')?.entry.source).toBe(
      'Existing A',
    );

    expect(collected.some((mutation) => mutation.kind === 'remove-folder')).toBe(false);
    expect(collected.some((mutation) => mutation.kind === 'remove' && mutation.key === 'src.a')).toBe(false);
    expect(collected.map((mutation) => [mutation.kind, 'key' in mutation ? mutation.key : ''])).toEqual([
      ['remove', 'src.b'],
      ['upsert', 'dst.src.b'],
    ]);
  });
});

describe('moveFolder across collections and around content outside the collection (real fs)', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'move-folder-sweep-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('moves the collection entries of a tree, keeps what is not part of the collection and warns', async () => {
    const source = collection(join(root, 'main'));
    await addResource(source, { key: 'apps.one', baseValue: 'One' });
    await addResource(source, { key: 'apps.nested.two', baseValue: 'Two' });
    const hidden = join(source.translationsFolder, 'apps', '.backup');
    mkdirSync(hidden);
    writeFileSync(join(hidden, 'resource_entries.json'), JSON.stringify({ old: { source: 'Old' } }));

    const result = await moveFolder(
      source,
      { sourceFolderPath: 'apps', destinationFolderPath: 'shared' },
      { onMutation },
    );

    expect(result.errors).toEqual([]);
    expect(result.movedCount).toBe(2);
    expect(result.foldersDeleted).toBe(0);
    expect(result.warnings).toEqual([
      `Source folder kept: holds content that is not part of the collection: ${join('apps', '.backup')}`,
    ]);
    // The hidden folder is untouched; the emptied collection folders are gone.
    expect(JSON.parse(readFileSync(join(hidden, 'resource_entries.json'), 'utf8'))).toEqual({ old: { source: 'Old' } });
    expect(existsSync(join(source.translationsFolder, 'apps', 'resource_entries.json'))).toBe(false);
    expect(existsSync(join(source.translationsFolder, 'apps', 'nested'))).toBe(false);
    expect(
      openResourceFolder(join(source.translationsFolder, 'shared', 'apps', 'nested'), { baseLocale: 'en' }).keys(),
    ).toEqual(['two']);
    expect(collected.filter((mutation) => mutation.kind === 'remove-folder')).toEqual([
      { kind: 'remove-folder', translationsFolder: source.translationsFolder, path: 'apps.nested' },
    ]);
  });

  it('keeps an empty source folder that holds a stray file', async () => {
    const source = collection(join(root, 'main'));
    mkdirSync(join(source.translationsFolder, 'apps'), { recursive: true });
    writeFileSync(join(source.translationsFolder, 'apps', 'README.md'), 'notes');

    const result = await moveFolder(
      source,
      { sourceFolderPath: 'apps', destinationFolderPath: 'shared' },
      { onMutation },
    );

    expect(result.foldersDeleted).toBe(0);
    expect(collected).toEqual([]);
    expect(result.warnings).toContain(
      `Source folder kept: holds content that is not part of the collection: ${join('apps', 'README.md')}`,
    );
    expect(readFileSync(join(source.translationsFolder, 'apps', 'README.md'), 'utf8')).toBe('notes');
  });

  it('removes an empty source folder tree', async () => {
    const source = collection(join(root, 'main'));
    mkdirSync(join(source.translationsFolder, 'apps', 'deep'), { recursive: true });

    const result = await moveFolder(
      source,
      { sourceFolderPath: 'apps', destinationFolderPath: 'shared' },
      { onMutation },
    );

    expect(result.foldersDeleted).toBe(1);
    expect(collected).toEqual([
      { kind: 'remove-folder', translationsFolder: source.translationsFolder, path: 'apps.deep' },
      { kind: 'remove-folder', translationsFolder: source.translationsFolder, path: 'apps' },
    ]);
    expect(existsSync(join(source.translationsFolder, 'apps'))).toBe(false);
  });

  it('fits entries moved into another collection to its locales', async () => {
    const source: Collection = {
      ...collection(join(root, 'main')),
      locales: ['en', 'fr', 'es'],
      targetLocales: ['fr', 'es'],
    };
    const target: Collection = {
      ...collection(join(root, 'other')),
      name: 'other',
      locales: ['en', 'fr', 'de'],
      targetLocales: ['fr', 'de'],
    };
    await addResource(source, {
      key: 'apps.ok',
      baseValue: 'OK',
      translations: [
        { locale: 'fr', value: 'Bien', status: 'translated' },
        { locale: 'es', value: 'Vale', status: 'translated' },
      ],
    });

    const result = await moveFolder(
      source,
      {
        sourceFolderPath: 'apps',
        destinationFolderPath: '',
        toCollection: 'other',
      },
      {
        onMutation,
        config: {
          exportFolder: 'dist',
          importFolder: 'import',
          baseLocale: target.baseLocale,
          locales: [...target.locales],
          collections: { other: { translationsFolder: target.translationsFolder } },
        },
      },
    );

    expect(result.movedCount).toBe(1);
    const moved = openResourceFolder(join(target.translationsFolder, 'apps'), { baseLocale: 'en' }).get('ok');
    expect(moved?.entry).toEqual({ source: 'OK', fr: 'Bien', de: 'OK' });
    expect(moved?.meta?.['de']?.status).toBe('new');
    expect(moved?.meta?.['es']).toBeUndefined();
  });
});
