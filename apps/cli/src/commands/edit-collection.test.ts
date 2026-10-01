import { editCollectionTags, InvalidCollectionError, loadConfig } from '@simoncodes-ca/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editCollectionCommand } from './edit-collection';

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    editCollectionTags: vi.fn(),
  };
});

const mockEditCollectionTags = vi.mocked(editCollectionTags);

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
    mockEditCollectionTags.mockReturnValue(['existing-tag', 'new-feature']);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('passes the stored collection with the new tags and the project root', async () => {
    await editCollectionCommand('myApp', { addTag: ['new-feature'] });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: ['new-feature'], remove: undefined, set: undefined },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags updated: existing-tag, new-feature');
    expect(process.exitCode).toBe(0);
  });

  it('adds a new tag to the collection', async () => {
    await editCollectionCommand('myApp', { addTag: ['new-feature'] });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: ['new-feature'], remove: undefined, set: undefined },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags updated: existing-tag, new-feature');
  });

  it('passes a raw tag to core and prints the tags core returns', async () => {
    await editCollectionCommand('myApp', { addTag: ['New Feature'] });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: ['New Feature'], remove: undefined, set: undefined },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags updated: existing-tag, new-feature');
  });

  it('does not duplicate an already-existing tag', async () => {
    mockEditCollectionTags.mockReturnValueOnce(['existing-tag']);
    await editCollectionCommand('myApp', { addTag: ['existing-tag'] });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: ['existing-tag'], remove: undefined, set: undefined },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags updated: existing-tag');
  });

  it('removes a tag from the collection', async () => {
    mockEditCollectionTags.mockReturnValueOnce([]);
    await editCollectionCommand('myApp', { removeTag: ['existing-tag'] });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: undefined, remove: ['existing-tag'], set: undefined },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags cleared');
  });

  it('replaces all tags with --set-tags', async () => {
    mockEditCollectionTags.mockReturnValueOnce(['alpha', 'beta']);
    await editCollectionCommand('myApp', { setTags: 'alpha, beta' });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: undefined, remove: undefined, set: ['alpha', ' beta'] },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags updated: alpha, beta');
  });

  it('clears all tags when --set-tags is empty string', async () => {
    mockEditCollectionTags.mockReturnValueOnce([]);
    await editCollectionCommand('myApp', { setTags: '' });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: undefined, remove: undefined, set: [''] },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "myApp" tags cleared');
  });

  it('exits 1 when --set-tags is combined with --add-tag', async () => {
    await editCollectionCommand('myApp', { setTags: 'foo', addTag: ['bar'] });
    expect(mockEditCollectionTags).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ --set-tags cannot be combined with --add-tag or --remove-tag');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when --set-tags is combined with --remove-tag', async () => {
    await editCollectionCommand('myApp', { setTags: 'foo', removeTag: ['existing-tag'] });
    expect(mockEditCollectionTags).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ --set-tags cannot be combined with --add-tag or --remove-tag');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when no options provided', async () => {
    await editCollectionCommand('myApp', {});
    expect(mockEditCollectionTags).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ Provide at least one of --add-tag, --remove-tag, or --set-tags');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when collection is not found', async () => {
    await editCollectionCommand('nonexistent', { addTag: ['foo'] });
    expect(mockEditCollectionTags).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ Collection "nonexistent" not found');
    expect(process.exitCode).toBe(1);
  });

  it('prints a typed core tag error and exits 1', async () => {
    mockEditCollectionTags.mockImplementationOnce(() => {
      throw new InvalidCollectionError('A tag edit needs a replacement, addition, or removal');
    });

    await editCollectionCommand('myApp', { addTag: ['beta'] });

    expect(mockEditCollectionTags).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'myApp', sourceConfig: mockConfig, projectRoot: '/test/project' }),
      expect.objectContaining({ write: expect.any(Function) }),
      { add: ['beta'], remove: undefined, set: undefined },
    );
    expect(console.error).toHaveBeenCalledWith('❌ A tag edit needs a replacement, addition, or removal');
    expect(process.exitCode).toBe(1);
  });
});
