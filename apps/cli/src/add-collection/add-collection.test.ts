import { addCollection, type LingoTrackerConfig, loadConfig } from '@simoncodes-ca/core';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInteractiveTerminal } from '../runner/terminal';
import { addCollectionCommand } from './add-collection';

vi.mock('prompts');
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return { ...actual, loadConfig: vi.fn(), addCollection: vi.fn() };
});

const CONFIG: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: { existing: { translationsFolder: 'src/i18n' } },
};

describe('addCollectionCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    vi.mocked(loadConfig).mockReturnValue(CONFIG);
    vi.mocked(addCollection).mockReturnValue({ message: 'Collection "admin" added' });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('adds the collection with the given flags and defaults for the rest', async () => {
    await addCollectionCommand({ collectionName: 'admin', translationsFolder: 'src/admin' });

    expect(addCollection).toHaveBeenCalledWith(
      'admin',
      {
        translationsFolder: 'src/admin',
        exportFolder: 'dist/lingo-export',
        importFolder: 'dist/lingo-import',
        baseLocale: 'en',
        locales: expect.any(Array),
      },
      { cwd: '/project' },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Collection "admin" added in .lingo-tracker.json');
    expect(process.exitCode).toBe(0);
  });

  it('marks a folder under node_modules read-only by default when non-interactive', async () => {
    await addCollectionCommand({ collectionName: 'vendor', translationsFolder: 'node_modules/lib/i18n' });

    expect(addCollection).toHaveBeenCalledWith('vendor', expect.objectContaining({ readOnly: true }), {
      cwd: '/project',
    });
  });

  it('lets --no-read-only override the node_modules detection', async () => {
    await addCollectionCommand({
      collectionName: 'vendor',
      translationsFolder: 'node_modules/lib/i18n',
      readOnly: false,
    });

    expect(addCollection).toHaveBeenCalledWith('vendor', expect.not.objectContaining({ readOnly: true }), {
      cwd: '/project',
    });
  });

  it('exits 1 naming the missing flags in non-interactive mode', async () => {
    await addCollectionCommand({ collectionName: 'admin' });

    expect(console.error).toHaveBeenCalledWith(
      '❌ Missing required options in non-interactive mode: --translations-folder',
    );
    expect(addCollection).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when the collection already exists', async () => {
    await addCollectionCommand({ collectionName: 'existing', translationsFolder: 'src/x' });

    expect(console.error).toHaveBeenCalledWith('❌ Collection "existing" already exists.');
    expect(addCollection).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 with the core message when core refuses', async () => {
    vi.mocked(addCollection).mockImplementation(() => {
      throw new Error('Invalid locale "xx_"');
    });

    await addCollectionCommand({ collectionName: 'admin', translationsFolder: 'src/admin' });

    expect(console.error).toHaveBeenCalledWith('❌ Invalid locale "xx_"');
    expect(process.exitCode).toBe(1);
  });

  describe('interactive', () => {
    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    });

    it('asks for missing values, then the read-only question', async () => {
      vi.mocked(prompts)
        .mockResolvedValueOnce({ collectionName: 'admin', translationsFolder: 'src/admin', locales: ['en', 'de'] })
        .mockResolvedValueOnce({ readOnly: true });

      await addCollectionCommand({});

      expect(addCollection).toHaveBeenCalledWith(
        'admin',
        expect.objectContaining({ translationsFolder: 'src/admin', locales: ['en', 'de'], readOnly: true }),
        { cwd: '/project' },
      );
    });

    it('cancelling prints one cancel line and exits 0', async () => {
      vi.mocked(prompts).mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'text', name: 'collectionName', message: 'Collection name' }, {});
        return {};
      });

      await addCollectionCommand({});

      expect(console.error).toHaveBeenCalledWith('❌ Add collection cancelled.');
      expect(addCollection).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });
});
