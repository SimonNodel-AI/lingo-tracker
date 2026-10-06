import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Collection, openCollection } from '../config/open-collection';
import { InvalidResourceKeyError } from '../errors/lingo-tracker-error';
import { commitAdd, locateEntry, removeEntry } from './resource-entry';
import * as resourceFolder from './resource-folder';
import type { ResourceMutation } from './resource-mutation';

describe('locateEntry', () => {
  let root: string;
  let collection: Collection;
  let mutations: ResourceMutation[];
  const onMutation = (mutation: ResourceMutation): void => {
    mutations.push(mutation);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'resource-entry-'));
    collection = openCollection(
      {
        exportFolder: 'dist',
        importFolder: 'import',
        baseLocale: 'fr',
        locales: ['fr', 'en'],
        collections: { main: { translationsFolder: root } },
      },
      'main',
    );
    mutations = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects an invalid key with a typed error before opening files', () => {
    expect(() => locateEntry(collection, 'invalid key')).toThrow(InvalidResourceKeyError);
  });

  it('rejects an invalid target folder with a typed error', () => {
    expect(() => locateEntry(collection, 'ok', { targetFolder: '../outside' })).toThrow(InvalidResourceKeyError);
  });

  it('resolves a target folder and reports a missing entry without creating files', () => {
    const resource = locateEntry(collection, 'buttons.ok', { targetFolder: 'apps.common' });
    expect(resource.resolvedKey).toBe('apps.common.buttons.ok');
    expect(resource.entryKey).toBe('ok');
    expect(resource.folder.folderPath).toBe(join(root, 'apps', 'common', 'buttons'));
    expect(resource.folder.has(resource.entryKey)).toBe(false);
    expect(resource.folder.get(resource.entryKey)).toBeUndefined();
    expect(existsSync(resource.folder.folderPath)).toBe(false);
  });

  it('saves both files with the collection base locale and reports the saved upsert', () => {
    commitAdd(
      collection,
      'apps.ok',
      { baseValue: 'Bonjour', translations: [{ locale: 'en', value: 'Hello' }] },
      'fail',
      onMutation,
    );

    const reopened = locateEntry(collection, 'apps.ok');
    expect(reopened.folder.has(reopened.entryKey)).toBe(true);
    expect(reopened.folder.get(reopened.entryKey)?.entry).toEqual({ source: 'Bonjour', en: 'Hello' });
    expect(reopened.folder.get(reopened.entryKey)?.meta?.['fr']?.checksum).toBeDefined();
    expect(reopened.folder.get(reopened.entryKey)?.meta?.['en']?.status).toBe('translated');
    expect(mutations).toEqual([
      { kind: 'upsert', translationsFolder: root, key: 'apps.ok', entry: reopened.folder.treeEntry('ok') },
    ]);
    expect(JSON.parse(readFileSync(join(root, 'apps', 'resource_entries.json'), 'utf8'))).toEqual({
      ok: { source: 'Bonjour', en: 'Hello' },
    });
  });

  it('saves without a mutation sink', () => {
    commitAdd(collection, 'ok', { baseValue: 'Bonjour' }, 'fail');
    expect(locateEntry(collection, 'ok').folder.has('ok')).toBe(true);
  });

  it('recognizes an entry without metadata', () => {
    writeFileSync(join(root, 'resource_entries.json'), JSON.stringify({ ok: { source: 'Bonjour' } }));
    const resource = locateEntry(collection, 'ok');
    expect(resource.folder.has(resource.entryKey)).toBe(true);
    expect(resource.folder.get(resource.entryKey)).toEqual({ entry: { source: 'Bonjour' }, meta: undefined });
    expect(resource.folder.treeEntry(resource.entryKey)?.metadata).toEqual({});
    expect(resource.folder.treeEntry(resource.entryKey, { requireMetadata: true })).toBeUndefined();
  });

  it('reports reindex and rethrows the same failed save', () => {
    const resource = locateEntry(collection, 'ok');
    const error = new Error('second file failed');
    vi.spyOn(resource.folder, 'save').mockImplementation(() => {
      throw error;
    });
    vi.spyOn(resourceFolder, 'openResourceFolder').mockReturnValue(resource.folder);
    expect(() => commitAdd(collection, 'ok', { baseValue: 'Bonjour' }, 'fail', onMutation)).toThrow(error);
    expect(mutations).toEqual([{ kind: 'reindex', translationsFolder: root }]);
  });

  it('removes the entry, deletes the last pair of files and reports remove after saving', () => {
    commitAdd(collection, 'ok', { baseValue: 'Bonjour' }, 'fail');
    const opened = locateEntry(collection, 'ok');
    expect(opened.folder.has(opened.entryKey)).toBe(true);
    removeEntry(collection, 'ok', {
      onMutation: (mutation) => {
        expect(existsSync(join(root, 'resource_entries.json'))).toBe(false);
        expect(existsSync(join(root, 'tracker_meta.json'))).toBe(false);
        onMutation(mutation);
      },
    });
    expect(locateEntry(collection, 'ok').folder.has('ok')).toBe(false);
    expect(mutations).toEqual([{ kind: 'remove', translationsFolder: root, key: 'ok' }]);
  });
});
