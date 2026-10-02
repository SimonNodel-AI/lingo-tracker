import type { ResourceMutation } from './resource-mutation';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addResource } from './add-resource';
import { deleteResource } from './delete-resource';
import { editResource } from './edit-resource';
import { moveResource } from './move-resource';
import type { Collection } from '../config/open-collection';
import { FolderNotFoundError } from '../errors/lingo-tracker-error';
import { createFolder } from '../folder/create-folder';
import { deleteFolder } from '../folder/delete-folder';
import { moveFolder } from '../folder/move-folder';
import { openResourceFolder } from './resource-folder';

const collected: ResourceMutation[] = [];
const onMutation = (mutation: ResourceMutation): void => {
  collected.push(mutation);
};
beforeEach(() => {
  collected.length = 0;
});

/** Core writes report what they changed, so an in-memory index can follow without re-reading disk. */
describe('mutations delivered by core writes (real fs)', () => {
  let root: string;

  const collection = (translationsFolder = root, name = 'main'): Collection => ({
    name,
    translationsFolder,
    baseLocale: 'en',
    locales: ['en', 'fr'],
    targetLocales: ['fr'],
    translationConfig: undefined,
    tags: [],
    termFiles: {
      protectedTerms: { path: '/nonexistent/.lingo-tracker-protected-terms.json', explicit: false },
      preferredTerminology: { path: '/nonexistent/.lingo-tracker-preferred-terminology.json', explicit: false },
    },
    readOnly: false,
    config: { translationsFolder },
  });

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'resource-mutation-'));
    await addResource(collection(), { key: 'common.ok', baseValue: 'OK' }, { onMutation });
    await addResource(collection(), { key: 'common.cancel', baseValue: 'Cancel' }, { onMutation });
    collected.length = 0;
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('addResource delivers the stored entry, as the tree loader would read it', async () => {
    await addResource(
      collection(),
      {
        key: 'apps.greeting',
        baseValue: 'Hello {{ name }}',
        comment: 'Shown on login',
        tags: ['ui'],
        translations: [{ locale: 'fr', value: 'Bonjour {{ name }}', status: 'translated' }],
      },
      { onMutation },
    );

    expect(collected).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'apps.greeting',
        entry: openResourceFolder(join(root, 'apps'), { baseLocale: 'en' }).treeEntry('greeting'),
      },
    ]);
    // The entry holds the stored (ICU) form, not the Transloco input.
    expect(collected[0]).toMatchObject({
      entry: { source: 'Hello {name}', translations: { fr: 'Bonjour {name}' } },
    });
  });

  it('addResource on an existing key returns one upsert with the replaced entry', async () => {
    const result = await addResource(
      collection(),
      { key: 'common.ok', baseValue: 'Okay' },
      { onMutation, onExisting: 'replace' },
    );

    expect(result.created).toBe(false);
    expect(collected).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'common.ok',
        entry: openResourceFolder(join(root, 'common'), { baseLocale: 'en' }).treeEntry('ok'),
      },
    ]);
    expect(collected[0]).toMatchObject({ entry: { source: 'Okay' } });
  });

  it('editResource delivers the updated entry, and nothing when nothing changed', async () => {
    await editResource(collection(), 'common.ok', { baseValue: 'Okay' }, { onMutation });
    expect(collected).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'common.ok',
        entry: expect.objectContaining({ source: 'Okay' }),
      },
      expect.objectContaining({ kind: 'upsert', key: 'common.ok' }),
    ]);

    const unchanged = await editResource(collection(), 'common.ok', { baseValue: 'Okay' }, { onMutation });
    expect(unchanged.updated).toBe(false);
    expect(collected).toHaveLength(2);
  });

  it('editResource with moveTo delivers a removal and an upsert keyed by their fully resolved keys', async () => {
    await editResource(collection(), 'common.ok', { moveTo: 'shared', baseValue: 'Okay' }, { onMutation });

    expect(collected).toEqual([
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'common.ok',
        entry: expect.objectContaining({ source: 'Okay' }),
      },
      expect.objectContaining({ kind: 'upsert', key: 'common.ok' }),
      { kind: 'remove', translationsFolder: root, key: 'common.ok' },
      {
        kind: 'upsert',
        translationsFolder: root,
        key: 'shared.ok',
        entry: expect.objectContaining({ source: 'Okay' }),
      },
    ]);
  });

  it('deleteResource delivers a remove for each deleted key only', () => {
    deleteResource(collection(), { keys: ['common.ok', 'common.missing'] }, { onMutation });

    expect(collected).toEqual([{ kind: 'remove', translationsFolder: root, key: 'common.ok' }]);
  });

  it('moveResource by pattern delivers a remove and an upsert per moved key, removes first', async () => {
    await moveResource(collection(), { source: 'common.*', destination: 'shared' }, { onMutation });

    const kinds = collected.map((mutation) => mutation.kind);
    expect(kinds).toEqual(['remove', 'remove', 'upsert', 'upsert']);
    expect(collected.map((mutation) => [mutation.kind, 'key' in mutation ? mutation.key : ''])).toEqual(
      expect.arrayContaining([
        ['upsert', 'shared.ok'],
        ['remove', 'common.ok'],
        ['upsert', 'shared.cancel'],
        ['remove', 'common.cancel'],
      ]),
    );
  });

  it('moveResource to another translations folder puts the upsert there', async () => {
    const other = mkdtempSync(join(tmpdir(), 'resource-mutation-other-'));
    try {
      await moveResource(
        collection(),
        {
          source: 'common.ok',
          destination: 'imported.ok',
          toCollection: 'other',
        },
        {
          onMutation,
          config: {
            exportFolder: 'dist',
            importFolder: 'import',
            baseLocale: 'en',
            locales: ['en', 'fr'],
            collections: { other: { translationsFolder: other } },
          },
        },
      );

      expect(collected).toEqual([
        { kind: 'remove', translationsFolder: root, key: 'common.ok' },
        {
          kind: 'upsert',
          translationsFolder: other,
          key: 'imported.ok',
          entry: expect.objectContaining({ key: 'ok' }),
        },
      ]);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('moveFolder delivers the per-key moves, then the removal of the source folder', async () => {
    await moveFolder(collection(), { sourceFolderPath: 'common', destinationFolderPath: 'apps' }, { onMutation });

    expect(collected).toHaveLength(5);
    expect(collected[collected.length - 1]).toEqual({
      kind: 'remove-folder',
      translationsFolder: root,
      path: 'common',
    });
    expect(collected.filter((mutation) => mutation.kind === 'upsert').map((mutation) => mutation.key)).toEqual(
      expect.arrayContaining(['apps.common.ok', 'apps.common.cancel']),
    );
  });

  it('createFolder and deleteFolder deliver the folder change', () => {
    createFolder(collection(), { folderName: 'empty', parentPath: 'apps' }, { onMutation });
    expect(collected).toEqual([{ kind: 'add-folder', translationsFolder: root, path: 'apps.empty' }]);
    collected.length = 0;
    deleteFolder(collection(), { folderPath: 'apps.empty' }, { onMutation });
    expect(collected).toEqual([{ kind: 'remove-folder', translationsFolder: root, path: 'apps.empty' }]);
    expect(() => deleteFolder(collection(), { folderPath: 'apps.empty' }, { onMutation })).toThrow(FolderNotFoundError);
  });

  it('createFolder on an existing folder returns created: false and no mutations', () => {
    const result = createFolder(collection(), { folderName: 'common' }, { onMutation });

    expect(result.created).toBe(false);
    expect(collected).toEqual([]);
  });
});
