import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import {
  addLocaleToCollection,
  addResource,
  type Collection,
  createFolder,
  deleteFolder,
  deleteResource,
  editResource,
  type FolderChild,
  type LingoTrackerConfig,
  loadResourceTree,
  moveFolder,
  moveResource,
  openCollection,
  openResourceFolder,
  type ResourceTreeNode,
} from '@simoncodes-ca/core';
import { CollectionIndex, type TreeRead } from './collection-index.service';

describe('CollectionIndex', () => {
  let root: string;
  let index: CollectionIndex;

  function config(...names: string[]): LingoTrackerConfig {
    return {
      exportFolder: 'export',
      importFolder: 'import',
      baseLocale: 'en',
      locales: ['en', 'fr'],
      collections: Object.fromEntries(names.map((name) => [name, { translationsFolder: path.join(root, name) }])),
    };
  }

  function collection(name = 'main'): Collection {
    return openCollection(config(name), name, { cwd: root });
  }

  /** Writes one entry (with metadata) the way core stores it. */
  function writeEntry(collectionName: string, key: string, value: string): void {
    const segments = key.split('.');
    const folder = openResourceFolder(path.join(root, collectionName, ...segments.slice(0, -1)));
    folder.setBase(segments[segments.length - 1], value);
    folder.save();
  }

  /** Reads the tree; indexes first when needed (indexing runs within the triggering read). */
  function readyTree(target: Collection = collection(), treePath = ''): ResourceTreeNode | null {
    let read: TreeRead = index.tree(target, treePath);
    if (read.status !== 'ready') read = index.tree(target, treePath);
    if (read.status !== 'ready') throw new Error(`index is ${read.status}`);
    return read.tree;
  }

  /** Children and resources sorted, so an index tree compares equal to a fresh load of the disk. */
  function normalized(node: ResourceTreeNode | null): unknown {
    if (!node) return node;
    return {
      folderPathSegments: node.folderPathSegments,
      resources: [...node.resources].sort((a, b) => a.key.localeCompare(b.key)),
      children: [...node.children]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((child: FolderChild) => ({ ...child, tree: normalized(child.tree ?? null) })),
    };
  }

  function expectIndexMatchesDisk(target: Collection = collection()): void {
    const fromDisk = loadResourceTree({
      translationsFolder: target.translationsFolder,
      baseLocale: target.baseLocale,
      depth: Number.POSITIVE_INFINITY,
    });
    expect(normalized(readyTree(target))).toEqual(normalized(fromDisk));
  }

  function keysOf(node: ResourceTreeNode | null): string[] {
    return (node?.resources.map((resource) => resource.key) ?? []).sort();
  }

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingo-index-'));
    // Tests that are not about the throttle need every read to check the disk.
    process.env.LINGO_TRACKER_REVALIDATE_INTERVAL_MS = '0';
    index = new CollectionIndex();
    writeEntry('main', 'common.ok', 'OK');
    writeEntry('main', 'common.cancel', 'Cancel');
    writeEntry('main', 'apps.title', 'Title');
  });

  afterEach(() => {
    delete process.env.LINGO_TRACKER_REVALIDATE_INTERVAL_MS;
    delete process.env.LINGO_TRACKER_MAX_CACHED_COLLECTIONS;
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  describe('reading', () => {
    it('starts indexing on the first read and serves the tree after that', () => {
      expect(index.tree(collection())).toEqual({ status: 'not-started' });

      expectIndexMatchesDisk();
    });

    it('returns the subtree at a path, and null for a path that does not exist', () => {
      expect(keysOf(readyTree(collection(), 'common'))).toEqual(['cancel', 'ok']);
      expect(readyTree(collection(), 'missing.path')).toBeNull();
    });

    it('reports status for the cache-status endpoint', () => {
      expect(index.status(collection())).toEqual({ status: 'not-started', collectionName: 'main' });

      const ready = index.status(collection());
      expect(ready).toEqual({
        status: 'ready',
        collectionName: 'main',
        indexedAt: expect.any(String),
        stats: { totalKeys: 3, localeCount: 2 },
      });
    });

    it('reports an indexing failure and retries it on the next tree read', () => {
      // A file where the translations folder should be cannot be read as a folder.
      fs.writeFileSync(path.join(root, 'broken'), 'not a folder');
      const broken = openCollection(config('broken'), 'broken', { cwd: root });

      expect(index.tree(broken)).toEqual({ status: 'not-started' });
      expect(index.status(broken)).toEqual(expect.objectContaining({ status: 'error', error: expect.any(String) }));

      fs.rmSync(path.join(root, 'broken'));
      writeEntry('broken', 'fixed', 'Fixed');

      expect(index.tree(broken)).toEqual({ status: 'error' });
      expect(keysOf(readyTree(broken))).toEqual(['fixed']);
    });

    it('searches the disk before indexing, without starting it, and the index after', () => {
      expect(index.search(collection(), 'cancel', 10).map((result) => result.key)).toEqual(['common.cancel']);
      expect(index.tree(collection())).toEqual({ status: 'not-started' });

      expect(index.search(collection(), 'cancel', 10).map((result) => result.key)).toEqual(['common.cancel']);
    });
  });

  describe('applying core mutations', () => {
    beforeEach(() => {
      readyTree();
    });

    it('adds a resource, creating its folders', async () => {
      const result = await addResource(collection(), {
        key: 'apps.dialogs.confirm.yes',
        baseValue: 'Yes',
      });
      index.apply(result.mutations);

      expect(keysOf(readyTree(collection(), 'apps.dialogs.confirm'))).toEqual(['yes']);
      expectIndexMatchesDisk();
    });

    it('replaces an edited resource in place', async () => {
      const result = await editResource(collection(), 'common.ok', { baseValue: 'Okay' });
      index.apply(result.mutations);

      expect(readyTree(collection(), 'common')?.resources.find((r) => r.key === 'ok')?.source).toBe('Okay');
      expectIndexMatchesDisk();
    });

    it('removes deleted resources', () => {
      index.apply(deleteResource(collection(), { keys: ['common.ok', 'apps.title'] }).mutations);

      expect(keysOf(readyTree(collection(), 'common'))).toEqual(['cancel']);
      expectIndexMatchesDisk();
    });

    it('moves resources by pattern', async () => {
      const result = await moveResource(collection(), { source: 'common.*', destination: 'shared' });
      index.apply(result.mutations);

      expect(keysOf(readyTree(collection(), 'shared'))).toEqual(['cancel', 'ok']);
      expect(keysOf(readyTree(collection(), 'common'))).toEqual([]);
      expectIndexMatchesDisk();
    });

    it('moves a resource to another collection and updates both', async () => {
      writeEntry('other', 'existing', 'Existing');
      const other = openCollection(config('other'), 'other', { cwd: root });
      readyTree(other);

      const result = await moveResource(collection(), {
        source: 'common.ok',
        destination: 'imported.ok',
        destinationCollection: other,
      });
      index.apply(result.mutations);

      expect(keysOf(readyTree(collection(), 'common'))).toEqual(['cancel']);
      expect(keysOf(readyTree(other, 'imported'))).toEqual(['ok']);
      expectIndexMatchesDisk();
      expectIndexMatchesDisk(other);
    });

    it('creates, moves and deletes folders', async () => {
      index.apply(createFolder(collection(), { folderName: 'empty', parentPath: 'apps' }).mutations);
      expect(readyTree(collection(), 'apps.empty')).not.toBeNull();

      const moved = await moveFolder(collection(), {
        sourceFolderPath: 'common',
        destinationFolderPath: 'apps',
      });
      index.apply(moved.mutations);
      expect(keysOf(readyTree(collection(), 'apps.common'))).toEqual(['cancel', 'ok']);
      expect(readyTree(collection(), 'common')).toBeNull();

      index.apply(deleteFolder(collection(), { folderPath: 'apps.empty' }).mutations);
      expect(readyTree(collection(), 'apps.empty')).toBeNull();

      expectIndexMatchesDisk();
    });

    it('re-indexes a collection whose locales changed', async () => {
      const configPath = path.join(root, '.lingo-tracker.json');
      fs.writeFileSync(configPath, JSON.stringify(config('main')));

      const result = await addLocaleToCollection('main', 'de', { cwd: root });
      index.apply(result.mutations);

      expect(index.tree(collection())).toEqual({ status: 'not-started' });
      expect(readyTree(collection(), 'common')?.resources.every((r) => r.translations.de !== undefined)).toBe(true);
    });

    it('re-indexes when a mutation does not match the indexed tree', () => {
      index.apply([{ kind: 'remove', translationsFolder: collection().translationsFolder, key: 'common.unknown' }]);

      expect(index.tree(collection())).toEqual({ status: 'not-started' });
      expectIndexMatchesDisk();
    });

    it('ignores mutations for collections that are not indexed', async () => {
      const result = await addResource(collection('elsewhere'), { key: 'ok', baseValue: 'OK' });
      index.apply(result.mutations);

      expect(index.tree(collection()).status).toBe('ready');
    });
  });

  describe('revalidation against the disk', () => {
    beforeEach(() => {
      readyTree();
    });

    it('keeps the index when nothing changed on disk', () => {
      expect(index.tree(collection()).status).toBe('ready');
    });

    it('drops the index when a resource file changed outside the process', () => {
      writeEntry('main', 'common.later', 'Later');

      expect(index.tree(collection())).toEqual({ status: 'not-started' });
      expect(keysOf(readyTree(collection(), 'common'))).toEqual(['cancel', 'later', 'ok']);
    });

    it('drops the index when a resource folder is removed outside the process', () => {
      fs.rmSync(path.join(root, 'main', 'common'), { recursive: true, force: true });

      expect(index.tree(collection())).toEqual({ status: 'not-started' });
      expect(readyTree(collection(), 'common')).toBeNull();
    });

    it('does not read its own write as an outside change', async () => {
      index.apply((await addResource(collection(), { key: 'common.yes', baseValue: 'Yes' })).mutations);

      expect(index.tree(collection()).status).toBe('ready');
    });

    it('detects an outside change made after its own write settled', async () => {
      index.apply((await addResource(collection(), { key: 'common.yes', baseValue: 'Yes' })).mutations);
      // Let the deferred fingerprint refresh run.
      await new Promise((resolve) => setTimeout(resolve, 5));

      writeEntry('main', 'common.later', 'Later');

      expect(index.tree(collection())).toEqual({ status: 'not-started' });
    });

    it('checks the disk at most once per revalidation interval', () => {
      process.env.LINGO_TRACKER_REVALIDATE_INTERVAL_MS = '60000';
      const throttled = new CollectionIndex();
      readyTreeOf(throttled);

      writeEntry('main', 'common.later', 'Later');

      // Indexing takes a fingerprint, so the change falls inside the interval that follows.
      expect(throttled.tree(collection()).status).toBe('ready');
    });

    function readyTreeOf(target: CollectionIndex): void {
      target.tree(collection());
      expect(target.tree(collection()).status).toBe('ready');
    }
  });

  describe('memory cap', () => {
    it('evicts the least recently used collection once the cap is reached', () => {
      process.env.LINGO_TRACKER_MAX_CACHED_COLLECTIONS = '2';
      const capped = new CollectionIndex();
      const [first, second, third] = ['first', 'second', 'third'].map((name) => {
        writeEntry(name, 'ok', 'OK');
        return openCollection(config(name), name, { cwd: root });
      });

      capped.tree(first);
      capped.tree(second);
      // Reading first makes second the least recently used entry.
      expect(capped.tree(first).status).toBe('ready');

      capped.tree(third);

      expect(capped.tree(first).status).toBe('ready');
      expect(capped.tree(third).status).toBe('ready');
      expect(capped.tree(second)).toEqual({ status: 'not-started' });
    });
  });
});
