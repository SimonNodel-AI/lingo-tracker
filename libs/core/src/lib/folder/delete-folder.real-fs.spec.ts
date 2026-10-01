import type { ResourceMutation } from '../resource/resource-mutation';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { testCollection, useTempDir, writeFolderFiles } from '../../testing/temp-dir.spec-helpers';
import { FolderNotFoundError, InvalidFolderPathError } from '../errors/lingo-tracker-error';
import { deleteFolder } from './delete-folder';

const collected: ResourceMutation[] = [];
const onMutation = (mutation: ResourceMutation): void => {
  collected.push(mutation);
};
beforeEach(() => {
  collected.length = 0;
});

describe('deleteFolder (real fs)', () => {
  const root = useTempDir('delete-folder-');

  it('deletes a folder tree, counts its entries, and returns one folder mutation', () => {
    const collection = testCollection(root());
    writeFolderFiles(root(), 'apps', { entries: { one: { source: 'One' } } });
    writeFolderFiles(root(), 'apps.nested', { entries: { two: { source: 'Two' }, three: { source: 'Three' } } });

    expect(deleteFolder(collection, { folderPath: 'apps' }, { onMutation })).toEqual({
      folderPath: 'apps',
      resourcesDeleted: 3,
    });
    expect(collected).toEqual([{ kind: 'remove-folder', translationsFolder: root(), path: 'apps' }]);
    expect(existsSync(join(root(), 'apps'))).toBe(false);
  });

  it('reports a missing folder', () => {
    expect(() => deleteFolder(testCollection(root()), { folderPath: 'missing' }, { onMutation })).toThrow(
      new FolderNotFoundError('missing'),
    );
  });

  it('rejects malformed address segments before deleting anything', () => {
    mkdirSync(join(root(), 'apps'));
    expect(() => deleteFolder(testCollection(root()), { folderPath: 'apps.bad name' }, { onMutation })).toThrow(
      new InvalidFolderPathError('folder path', 'bad name'),
    );
    expect(existsSync(join(root(), 'apps'))).toBe(true);
  });

  it('refuses the root address', () => {
    expect(() => deleteFolder(testCollection(root()), { folderPath: '' }, { onMutation })).toThrow(
      new InvalidFolderPathError('folder path', ''),
    );
    expect(existsSync(root())).toBe(true);
  });

  it('treats a file at the address as a missing folder', () => {
    writeFileSync(join(root(), 'file'), 'content');
    expect(() => deleteFolder(testCollection(root()), { folderPath: 'file' }, { onMutation })).toThrow(
      new FolderNotFoundError('file'),
    );
    expect(existsSync(join(root(), 'file'))).toBe(true);
  });

  it('deletes hidden and stray content while counting only readable collection entries', () => {
    const collection = testCollection(root());
    writeFolderFiles(root(), 'apps', { entries: { one: { source: 'One' } } });
    mkdirSync(join(root(), 'apps', '.hidden'));
    writeFileSync(
      join(root(), 'apps', '.hidden', 'resource_entries.json'),
      JSON.stringify({ ignored: { source: 'Hidden' } }),
    );
    writeFileSync(join(root(), 'apps', 'notes.txt'), 'notes');
    const result = deleteFolder(collection, { folderPath: 'apps' }, { onMutation });
    expect(result.resourcesDeleted).toBe(1);
    expect(collected).toEqual([{ kind: 'remove-folder', translationsFolder: root(), path: 'apps' }]);
    expect(existsSync(join(root(), 'apps'))).toBe(false);
  });
});
