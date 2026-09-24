import * as core from '@simoncodes-ca/core';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInteractiveTerminal } from '../runner/terminal';
import { deleteCollectionCommand } from './delete-collection';

vi.mock('prompts');
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    deleteCollectionByName: vi.fn(),
  };
});

describe('deleteCollectionCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INIT_CWD = '/test/project';
    process.exitCode = undefined;
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  const mockConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en', 'fr'],
    collections: {
      Collection1: {
        translationsFolder: 'src/i18n/collection1',
      },
      Collection2: {
        translationsFolder: 'src/i18n/collection2',
        baseLocale: 'fr',
      },
    },
  };

  it('should delete specified collection from config', async () => {
    vi.mocked(core.loadConfig).mockReturnValue(mockConfig);
    vi.mocked(core.deleteCollectionByName).mockReturnValue({
      message: 'Collection "Collection1" deleted successfully',
    });

    const options = {
      collectionName: 'Collection1',
    };

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).toHaveBeenCalledWith('Collection1', {
      cwd: '/test/project',
    });
    expect(process.exitCode).toBe(0);
  });

  it('should handle deletion of last remaining collection', async () => {
    const singleCollectionConfig = {
      ...mockConfig,
      collections: {
        OnlyCollection: {
          translationsFolder: 'src/i18n',
        },
      },
    };

    vi.mocked(core.loadConfig).mockReturnValue(singleCollectionConfig);
    vi.mocked(core.deleteCollectionByName).mockReturnValue({
      message: 'Collection "OnlyCollection" deleted successfully',
    });

    const options = {
      collectionName: 'OnlyCollection',
    };

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).toHaveBeenCalledWith('OnlyCollection', {
      cwd: '/test/project',
    });
    expect(process.exitCode).toBe(0);
  });

  it('should not write file if config does not exist', async () => {
    vi.mocked(core.loadConfig).mockImplementation(() => {
      throw new core.ConfigNotFoundError('/test/project/.lingo-tracker.json');
    });

    const options = {
      collectionName: 'Collection1',
    };

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should not write file if config is invalid JSON', async () => {
    vi.mocked(core.loadConfig).mockImplementation(() => {
      throw new core.ConfigParseError('/test/project/.lingo-tracker.json', 'Unexpected token');
    });

    const options = {
      collectionName: 'Collection1',
    };

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should not write file if no collections exist', async () => {
    const emptyCollectionsConfig = {
      ...mockConfig,
      collections: {},
    };

    vi.mocked(core.loadConfig).mockReturnValue(emptyCollectionsConfig);

    const options = {
      collectionName: 'Collection1',
    };

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should not write file if collections property is missing', async () => {
    const noCollectionsConfig = {
      exportFolder: 'dist/lingo-export',
      importFolder: 'dist/lingo-import',
      baseLocale: 'en',
      locales: ['en', 'fr'],
    };

    vi.mocked(core.loadConfig).mockReturnValue(noCollectionsConfig);

    const options = {
      collectionName: 'Collection1',
    };

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should not write file if specified collection does not exist', async () => {
    vi.mocked(core.loadConfig).mockReturnValue(mockConfig);

    const options = {
      collectionName: 'NonExistentCollection',
    };

    await deleteCollectionCommand(options);

    expect(console.log).toHaveBeenCalledWith('❌ Collection "NonExistentCollection" not found');
    expect(core.deleteCollectionByName).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should handle single collection when no collection name provided', async () => {
    const singleCollectionConfig = {
      ...mockConfig,
      collections: {
        OnlyCollection: {
          translationsFolder: 'src/i18n',
        },
      },
    };

    vi.mocked(core.loadConfig).mockReturnValue(singleCollectionConfig);
    vi.mocked(core.deleteCollectionByName).mockReturnValue({
      message: 'Collection "OnlyCollection" deleted successfully',
    });

    const options = {};

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).toHaveBeenCalledWith('OnlyCollection', {
      cwd: '/test/project',
    });
    expect(process.exitCode).toBe(0);
  });

  it('should preserve other config properties when deleting collection', async () => {
    const configWithExtraProps = {
      ...mockConfig,
      customProperty: 'customValue',
      anotherProperty: 42,
    };

    vi.mocked(core.loadConfig).mockReturnValue(configWithExtraProps);
    vi.mocked(core.deleteCollectionByName).mockReturnValue({
      message: 'Collection "Collection1" deleted successfully',
    });

    const options = {
      collectionName: 'Collection1',
    };

    await deleteCollectionCommand(options);

    expect(core.deleteCollectionByName).toHaveBeenCalledWith('Collection1', {
      cwd: '/test/project',
    });
    expect(process.exitCode).toBe(0);
  });

  it('exits 1 when core refuses the deletion', async () => {
    vi.mocked(core.loadConfig).mockReturnValue(mockConfig);
    vi.mocked(core.deleteCollectionByName).mockImplementation(() => {
      throw new Error('Cannot delete');
    });

    await deleteCollectionCommand({ collectionName: 'Collection1' });

    expect(console.log).toHaveBeenCalledWith('❌ Cannot delete');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 naming --collection-name when several collections exist and none is given', async () => {
    vi.mocked(core.loadConfig).mockReturnValue(mockConfig);

    await deleteCollectionCommand({});

    expect(core.deleteCollectionByName).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('❌ Missing required option: --collection-name');
    expect(process.exitCode).toBe(1);
  });

  it('prompts for one of several collections when interactive', async () => {
    vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    vi.mocked(core.loadConfig).mockReturnValue(mockConfig);
    vi.mocked(prompts).mockResolvedValueOnce({ collection: 'Collection2' });
    vi.mocked(core.deleteCollectionByName).mockReturnValue({ message: 'deleted' });

    await deleteCollectionCommand({});

    expect(core.deleteCollectionByName).toHaveBeenCalledWith('Collection2', { cwd: '/test/project' });
  });
});
