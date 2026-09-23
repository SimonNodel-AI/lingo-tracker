import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addResource } from '../../resource/add-resource';
import { deleteResource } from '../../resource/delete-resource';
import { editResource } from '../../resource/edit-resource';
import { moveResource } from '../../resource/move-resource';
import type { Collection } from '../config/open-collection';
import { FolderNotFoundError } from '../errors/lingo-tracker-error';
import { createFolder } from '../folder/create-folder';
import { deleteFolder } from '../folder/delete-folder';
import { moveFolder } from '../folder/move-folder';
import { openResourceFolder } from './resource-folder';

/** Core writes report what they changed, so an in-memory index can follow without re-reading disk. */
describe('mutations returned by core writes (real fs)', () => {
  let root: string;

  const collection = (translationsFolder = root, name = 'main'): Collection => ({
    name,
    translationsFolder,
    baseLocale: 'en',
    locales: ['en', 'fr'],
    targetLocales: ['fr'],
    translationConfig: undefined,
    tags: [],
    readOnly: false,
    config: { translationsFolder },
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'resource-mutation-'));
    await addResource(collection(), { key: 'common.ok', baseValue: 'OK' });
    await addResource(collection(), { key: 'common.cancel', baseValue: 'Cancel' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('addResource returns the stored entry, as the tree loader would read it', async () => {
    const result = await addResource(collection(), {
      key: 'apps.greeting',
      baseValue: 'Hello {{ name }}',
      comment: 'Shown on login',
      tags: ['ui'],
      translations: [{ locale: 'fr', value: 'Bonjour {{ name }}', status: 'translated' }],
    });

    expect(result.mutations).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'apps.greeting',
        entry: openResourceFolder(join(root, 'apps')).treeEntry('greeting'),
      },
    ]);
    // The entry holds the stored (ICU) form, not the Transloco input.
    expect(result.mutations[0]).toMatchObject({
      entry: { source: 'Hello {name}', translations: { fr: 'Bonjour {name}' } },
    });
  });

  it('addResource on an existing key returns one upsert with the replaced entry', async () => {
    const result = await addResource(collection(), { key: 'common.ok', baseValue: 'Okay' });

    expect(result.created).toBe(false);
    expect(result.mutations).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'common.ok',
        entry: openResourceFolder(join(root, 'common')).treeEntry('ok'),
      },
    ]);
    expect(result.mutations[0]).toMatchObject({ entry: { source: 'Okay' } });
  });

  it('editResource returns the updated entry, and nothing when nothing changed', async () => {
    const edited = await editResource(collection(), 'common.ok', { baseValue: 'Okay' });
    expect(edited.mutations).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'common.ok',
        entry: expect.objectContaining({ source: 'Okay' }),
      },
    ]);

    const unchanged = await editResource(collection(), 'common.ok', { baseValue: 'Okay' });
    expect(unchanged.mutations).toEqual([]);
  });

  it('editResource with moveTo returns an upsert and removal keyed by their fully resolved keys', async () => {
    const result = await editResource(collection(), 'common.ok', { moveTo: 'shared', baseValue: 'Okay' });

    expect(result.mutations).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'shared.ok',
        entry: expect.objectContaining({ source: 'Okay' }),
      },
      { kind: 'remove', translationsFolder: root, key: 'common.ok' },
    ]);
  });

  it('deleteResource returns a remove for each deleted key only', () => {
    const result = deleteResource(collection(), { keys: ['common.ok', 'common.missing'] });

    expect(result.mutations).toEqual([{ kind: 'remove', translationsFolder: root, key: 'common.ok' }]);
  });

  it('moveResource by pattern returns an upsert and a remove per moved key', async () => {
    const result = await moveResource(collection(), { source: 'common.*', destination: 'shared' });

    expect(result.mutations.map((mutation) => [mutation.kind, 'key' in mutation ? mutation.key : ''])).toEqual(
      expect.arrayContaining([
        ['upsert', 'shared.ok'],
        ['remove', 'common.ok'],
        ['upsert', 'shared.cancel'],
        ['remove', 'common.cancel'],
      ]),
    );
    expect(result.mutations).toHaveLength(4);
  });

  it('moveResource to another translations folder puts the upsert there', async () => {
    const other = mkdtempSync(join(tmpdir(), 'resource-mutation-other-'));
    try {
      const result = await moveResource(collection(), {
        source: 'common.ok',
        destination: 'imported.ok',
        destinationCollection: collection(other, 'other'),
      });

      expect(result.mutations).toEqual([
        {
          kind: 'upsert',
          translationsFolder: other,
          key: 'imported.ok',
          entry: expect.objectContaining({ key: 'ok' }),
        },
        { kind: 'remove', translationsFolder: root, key: 'common.ok' },
      ]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('moveFolder returns the per-key moves, then the removal of the source folder', async () => {
    const result = await moveFolder(collection(), { sourceFolderPath: 'common', destinationFolderPath: 'apps' });

    expect(result.mutations).toHaveLength(5);
    expect(result.mutations[result.mutations.length - 1]).toEqual({
      kind: 'remove-folder',
      translationsFolder: root,
      path: 'common',
    });
    expect(result.mutations.filter((mutation) => mutation.kind === 'upsert').map((mutation) => mutation.key)).toEqual(
      expect.arrayContaining(['apps.common.ok', 'apps.common.cancel']),
    );
  });

  it('createFolder and deleteFolder return the folder change', () => {
    expect(createFolder(collection(), { folderName: 'empty', parentPath: 'apps' }).mutations).toEqual([
      { kind: 'add-folder', translationsFolder: root, path: 'apps.empty' },
    ]);
    expect(deleteFolder(collection(), { folderPath: 'apps.empty' }).mutations).toEqual([
      { kind: 'remove-folder', translationsFolder: root, path: 'apps.empty' },
    ]);
    expect(() => deleteFolder(collection(), { folderPath: 'apps.empty' })).toThrow(FolderNotFoundError);
  });

  it('createFolder on an existing folder returns created: false and no mutations', () => {
    const result = createFolder(collection(), { folderName: 'common' });

    expect(result.created).toBe(false);
    expect(result.mutations).toEqual([]);
  });
});
