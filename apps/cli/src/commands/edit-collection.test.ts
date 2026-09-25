import { loadConfig, updateCollection } from '@simoncodes-ca/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editCollectionCommand } from './edit-collection';

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    updateCollection: vi.fn().mockResolvedValue({ message: 'updated' }),
  };
});

const mockUpdateCollection = vi.mocked(updateCollection);

describe('editCollectionCommand', () => {
  const mockConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en', 'fr'],
    collections: {
      myApp: {
        translationsFolder: './src/i18n',
        tags: ['existing-tag'],
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INIT_CWD = '/test/project';
    process.exitCode = undefined;
    vi.mocked(loadConfig).mockReturnValue(mockConfig);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('passes the stored collection with the new tags and the project root', async () => {
    await editCollectionCommand('myApp', { addTag: ['new-feature'] });

    expect(mockUpdateCollection).toHaveBeenCalledWith(
      'myApp',
      undefined,
      { translationsFolder: './src/i18n', tags: ['existing-tag', 'new-feature'] },
      { cwd: '/test/project' },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags updated: existing-tag, new-feature');
    expect(process.exitCode).toBe(0);
  });

  it('adds a new tag to the collection', async () => {
    await editCollectionCommand('myApp', { addTag: ['new-feature'] });

    expect(mockUpdateCollection).toHaveBeenCalledOnce();
    const [, , collectionArg] = mockUpdateCollection.mock.calls[0];
    expect(collectionArg.tags).toContain('existing-tag');
    expect(collectionArg.tags).toContain('new-feature');
  });

  it('normalizes tags on add', async () => {
    await editCollectionCommand('myApp', { addTag: ['New Feature'] });

    const [, , collectionArg] = mockUpdateCollection.mock.calls[0];
    expect(collectionArg.tags).toContain('new-feature');
    expect(collectionArg.tags).not.toContain('New Feature');
  });

  it('does not duplicate an already-existing tag', async () => {
    await editCollectionCommand('myApp', { addTag: ['existing-tag'] });

    const [, , collectionArg] = mockUpdateCollection.mock.calls[0];
    const count = (collectionArg.tags ?? []).filter((t: string) => t === 'existing-tag').length;
    expect(count).toBe(1);
  });

  it('removes a tag from the collection', async () => {
    await editCollectionCommand('myApp', { removeTag: ['existing-tag'] });

    const [, , collectionArg] = mockUpdateCollection.mock.calls[0];
    expect(collectionArg.tags).not.toContain('existing-tag');
  });

  it('replaces all tags with --set-tags', async () => {
    await editCollectionCommand('myApp', { setTags: 'alpha, beta' });

    const [, , collectionArg] = mockUpdateCollection.mock.calls[0];
    expect(collectionArg.tags).toEqual(['alpha', 'beta']);
  });

  it('clears all tags when --set-tags is empty string', async () => {
    await editCollectionCommand('myApp', { setTags: '' });

    const [, , collectionArg] = mockUpdateCollection.mock.calls[0];
    expect(collectionArg.tags).toEqual([]);
  });

  it('exits 1 when --set-tags is combined with --add-tag', async () => {
    await editCollectionCommand('myApp', { setTags: 'foo', addTag: ['bar'] });
    expect(mockUpdateCollection).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ --set-tags cannot be combined with --add-tag or --remove-tag');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when --set-tags is combined with --remove-tag', async () => {
    await editCollectionCommand('myApp', { setTags: 'foo', removeTag: ['existing-tag'] });
    expect(mockUpdateCollection).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ --set-tags cannot be combined with --add-tag or --remove-tag');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when no options provided', async () => {
    await editCollectionCommand('myApp', {});
    expect(mockUpdateCollection).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ Provide at least one of --add-tag, --remove-tag, or --set-tags');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when collection is not found', async () => {
    await editCollectionCommand('nonexistent', { addTag: ['foo'] });
    expect(mockUpdateCollection).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ Collection "nonexistent" not found');
    expect(process.exitCode).toBe(1);
  });
});
