import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { seedResources, testCollection, useTempDir, writeFolderFiles } from '../../testing/temp-dir.spec-helpers';
import { deleteResource } from './delete-resource';
import { editResource } from './edit-resource';
import { executeMove, executeMoves } from './execute-move';
import { pruneEmptiedFolders } from './folder-pruning';
import { openResourceFolder } from './resource-folder';
import type { ResourceMutation } from './resource-mutation';
import { ResourceTreeIndex } from './resource-tree-index';

describe('writes prune emptied folders (real fs)', () => {
  const root = useTempDir('delete-resource-');
  const collection = () => testCollection(root());
  const seed = () => seedResources(collection(), { 'a.b.c.ok': { source: 'OK' } });

  it('deletes the emptied chain after the entry mutation and patches the index without ghost folders', () => {
    seed();
    const index = new ResourceTreeIndex(collection());
    index.load();
    const mutations: ResourceMutation[] = [];
    const source = testCollection(root(), {
      onMutation: (mutation) => {
        mutations.push(mutation);
        expect(index.apply(mutation).kind).toBe('patched');
      },
    });
    expect(deleteResource(source, { keys: ['a.b.c.ok'] })).toMatchObject({ entriesDeleted: 1, outcome: 'succeeded' });
    expect(existsSync(join(root(), 'a'))).toBe(false);
    expect(existsSync(root())).toBe(true);
    expect(index.subtree()?.children).toEqual([]);
    expect(mutations).toEqual([
      { kind: 'remove', translationsFolder: root(), key: 'a.b.c.ok' },
      ...['a.b.c', 'a.b', 'a'].map((path) => ({ kind: 'remove-folder', translationsFolder: root(), path })),
    ]);
  });

  it('keeps an emptied folder with a subfolder containing entries', () => {
    seed();
    seedResources(collection(), { 'a.b.c.child.keep': { source: 'Keep' } });
    deleteResource(collection(), { keys: ['a.b.c.ok'] });
    expect(existsSync(join(root(), 'a', 'b', 'c'))).toBe(true);
    expect(openResourceFolder(join(root(), 'a', 'b', 'c', 'child'), collection()).has('keep')).toBe(true);
  });

  it('keeps an ancestor with a sibling subfolder containing entries', () => {
    seed();
    seedResources(collection(), { 'a.b.sibling.keep': { source: 'Keep' } });
    deleteResource(collection(), { keys: ['a.b.c.ok'] });
    expect(existsSync(join(root(), 'a', 'b', 'c'))).toBe(false);
    expect(existsSync(join(root(), 'a', 'b', 'sibling'))).toBe(true);
  });

  it('keeps unknown files and their ancestor directories', () => {
    seed();
    const file = join(root(), 'a', 'b', 'c', 'notes.txt');
    writeFileSync(file, 'keep me');
    deleteResource(collection(), { keys: ['a.b.c.ok'] });
    expect(readFileSync(file, 'utf8')).toBe('keep me');
    expect(existsSync(join(root(), 'a'))).toBe(true);
  });

  it('prunes a key move source through the explicit sink instead of the default sink', () => {
    seed();
    const mutations: ResourceMutation[] = [];
    const defaultMutations: ResourceMutation[] = [];
    const result = executeMove(
      testCollection(root(), { onMutation: (mutation) => defaultMutations.push(mutation) }),
      { source: 'a.b.c.ok', destination: 'shared.ok' },
      { onMutation: (mutation) => mutations.push(mutation) },
    );
    expect(result.movedCount).toBe(1);
    expect(existsSync(join(root(), 'a'))).toBe(false);
    expect(defaultMutations).toEqual([]);
    expect(mutations.map((mutation) => mutation.kind)).toEqual([
      'remove',
      'upsert',
      'remove-folder',
      'remove-folder',
      'remove-folder',
    ]);
  });

  it('prunes a pattern move source without removing unrelated empty folders', () => {
    seed();
    seedResources(collection(), { 'a.b.c.cancel': { source: 'Cancel' } });
    writeFolderFiles(root(), 'unrelated', { entries: {} });
    expect(executeMove(collection(), { source: 'a.b.c.*', destination: 'shared' }).movedCount).toBe(2);
    expect(existsSync(join(root(), 'a'))).toBe(false);
    expect(existsSync(join(root(), 'unrelated'))).toBe(true);
  });

  it('prunes edit moveTo sources', async () => {
    seed();
    const mutations: ResourceMutation[] = [];
    await editResource(
      collection(),
      'a.b.c.ok',
      { moveTo: 'shared' },
      { onMutation: (mutation) => mutations.push(mutation) },
    );
    expect(existsSync(join(root(), 'a'))).toBe(false);
    expect(mutations.filter((mutation) => mutation.kind === 'remove-folder').map((mutation) => mutation.path)).toEqual([
      'a.b.c',
      'a.b',
      'a',
    ]);
  });

  it('prunes cross-collection sources and attributes removals to the source root', () => {
    seed();
    const destination = join(root(), 'other');
    const mutations: ResourceMutation[] = [];
    const result = executeMove(
      collection(),
      { source: 'a.b.c.ok', destination: 'shared.ok', toCollection: 'other' },
      {
        config: {
          baseLocale: 'en',
          locales: ['en'],
          exportFolder: 'export',
          importFolder: 'import',
          collections: { other: { translationsFolder: destination } },
        },
        onMutation: (mutation) => mutations.push(mutation),
      },
    );
    expect(result.movedCount).toBe(1);
    expect(existsSync(join(root(), 'a'))).toBe(false);
    expect(mutations.filter((mutation) => mutation.kind === 'remove-folder')).toEqual(
      ['a.b.c', 'a.b', 'a'].map((path) => ({ kind: 'remove-folder', translationsFolder: root(), path })),
    );
    expect(openResourceFolder(join(destination, 'shared'), collection()).has('ok')).toBe(true);
  });

  it('reports an emptied folder without pruning and lets the helper remove known junk in ancestors', () => {
    seed();
    writeFolderFiles(root(), 'a.b', { entries: {}, meta: {} });
    writeFileSync(join(root(), 'a', '.DS_Store'), 'junk');
    const mutations: ResourceMutation[] = [];
    const folder = openResourceFolder(
      join(root(), 'a', 'b', 'c'),
      testCollection(root(), {
        onMutation: (mutation) => mutations.push(mutation),
      }),
    );
    folder.remove('ok');
    expect(folder.save().emptied).toBe(true);
    expect(existsSync(folder.folderPath)).toBe(true);
    expect(mutations).toEqual([]);
    pruneEmptiedFolders(collection(), [folder.folderPath], { onMutation: (mutation) => mutations.push(mutation) });
    expect(existsSync(join(root(), 'a'))).toBe(false);
    expect(mutations).toEqual(
      ['a.b.c', 'a.b', 'a'].map((path) => ({
        kind: 'remove-folder',
        translationsFolder: root(),
        path,
      })),
    );
  });

  it('retains missing-key diagnostics in a folder emptied earlier in the delete batch', () => {
    seed();
    const result = deleteResource(collection(), { keys: ['a.b.c.ok', 'a.b.c.missing'] });
    expect(result).toMatchObject({
      entriesDeleted: 1,
      outcome: 'failed',
      errors: [{ key: 'a.b.c.missing', error: 'Resource not found: a.b.c.missing' }],
    });
    expect(existsSync(join(root(), 'a'))).toBe(false);
  });

  it('reports duplicate delete keys as missing resources and prunes each folder only once', () => {
    seed();
    const mutations: ResourceMutation[] = [];
    const result = deleteResource(
      collection(),
      { keys: ['a.b.c.ok', 'a.b.c.ok'] },
      {
        onMutation: (mutation) => mutations.push(mutation),
      },
    );
    expect(result.errors).toEqual([{ key: 'a.b.c.ok', error: 'Resource not found: a.b.c.ok' }]);
    expect(mutations.map((mutation) => mutation.kind)).toEqual([
      'remove',
      'remove-folder',
      'remove-folder',
      'remove-folder',
    ]);
  });

  it('defers pruning until a key move and a subsequent folder move have both executed', () => {
    seedResources(collection(), { 'a.x': { source: 'X' } });
    const mutations: ResourceMutation[] = [];
    const result = executeMoves(
      collection(),
      [
        { source: 'a.x', destination: 'b.x' },
        { kind: 'folder', source: 'a', destination: 'c' },
      ],
      { onMutation: (mutation) => mutations.push(mutation) },
    );
    expect(result).toMatchObject({ outcome: 'succeeded', movedCount: 1, foldersDeleted: 1, errors: [] });
    expect(result.warnings).toEqual(['No resources found in source folder. Nothing to move.']);
    expect(existsSync(join(root(), 'a'))).toBe(false);
    expect(mutations.map((mutation) => mutation.kind)).toEqual(['remove', 'upsert', 'remove-folder']);
  });

  it('returns pruning problems as warnings without failing successful entry deletion', () => {
    seed();
    writeFolderFiles(root(), 'a.b', { meta: '{ malformed' });
    const result = deleteResource(collection(), { keys: ['a.b.c.ok'] });
    expect(result).toMatchObject({ entriesDeleted: 1, outcome: 'succeeded' });
    expect(result.errors).toBeUndefined();
    expect(result.warnings).toEqual([expect.stringContaining("Skipped unreadable folder 'a.b'")]);
    expect(existsSync(join(root(), 'a', 'b', 'c'))).toBe(false);
    expect(existsSync(join(root(), 'a', 'b'))).toBe(true);
  });

  it('surfaces ancestor pruning problems in the Move Report after moving entries', () => {
    seed();
    writeFolderFiles(root(), 'a.b', { meta: '{ malformed' });
    const result = executeMove(collection(), { source: 'a.b.c.ok', destination: 'shared.ok' });
    expect(result).toMatchObject({ movedCount: 1, outcome: 'succeeded', errors: [] });
    expect(result.warnings).toEqual([expect.stringContaining("Skipped unreadable folder 'a.b'")]);
  });

  it('preserves pruning warnings on edit moveTo results', async () => {
    seed();
    writeFolderFiles(root(), 'a.b', { meta: '{ malformed' });
    const result = await editResource(collection(), 'a.b.c.ok', { moveTo: 'shared' });
    expect(result.updated).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining("Skipped unreadable folder 'a.b'")]);
  });

  it('emits each folder removal once after all entry mutations for a folder move', () => {
    seed();
    seedResources(collection(), { 'a.b.sibling.keep': { source: 'Keep' } });
    writeFolderFiles(root(), 'a.b.empty', { entries: {} });
    const mutations: ResourceMutation[] = [];
    const result = executeMove(
      collection(),
      { kind: 'folder', source: 'a.b', destination: 'shared' },
      {
        onMutation: (mutation) => mutations.push(mutation),
      },
    );
    expect(result).toMatchObject({ movedCount: 2, foldersDeleted: 1, outcome: 'succeeded' });
    const removals = mutations.filter((mutation) => mutation.kind === 'remove-folder');
    expect(removals.map((mutation) => mutation.path)).toEqual(['a.b.c', 'a.b.empty', 'a.b.sibling', 'a.b', 'a']);
    expect(mutations.slice(0, 4).map((mutation) => mutation.kind)).toEqual(['remove', 'remove', 'upsert', 'upsert']);
  });

  it('deduplicates dry-run pruning plans and leaves every directory and file unchanged', () => {
    const path = writeFolderFiles(root(), 'a.b.c', { entries: {}, meta: {} });
    const mutations: ResourceMutation[] = [];
    const result = pruneEmptiedFolders(collection(), [path, path, join(root(), 'a', 'b')], {
      dryRun: true,
      onMutation: (mutation) => mutations.push(mutation),
    });
    expect(result.removed).toEqual(['a.b.c', 'a.b', 'a']);
    expect(existsSync(join(path, 'resource_entries.json'))).toBe(true);
    expect(existsSync(join(path, 'tracker_meta.json'))).toBe(true);
    expect(mutations).toEqual([]);
  });

  it('does not save, prune, or emit mutations during a dry run', () => {
    seed();
    const path = join(root(), 'a', 'b', 'c');
    const entries = readFileSync(join(path, 'resource_entries.json'), 'utf8');
    const metadata = readFileSync(join(path, 'tracker_meta.json'), 'utf8');
    const mutations: ResourceMutation[] = [];
    const folder = openResourceFolder(
      path,
      testCollection(root(), { onMutation: (mutation) => mutations.push(mutation) }),
    );
    folder.remove('ok');
    folder.save({ dryRun: true });
    expect(readFileSync(join(path, 'resource_entries.json'), 'utf8')).toBe(entries);
    expect(readFileSync(join(path, 'tracker_meta.json'), 'utf8')).toBe(metadata);
    expect(mutations).toEqual([]);
  });
});
