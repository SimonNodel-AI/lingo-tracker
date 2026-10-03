import {
  CollectionNotFoundError,
  type LingoTrackerConfig,
  loadConfig,
  moveResource,
  ReadOnlyCollectionError,
} from '@simoncodes-ca/core';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInteractiveTerminal } from '../runner/terminal';
import { moveResourceCommand } from './move';

vi.mock('prompts');
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return { ...actual, loadConfig: vi.fn(), moveResource: vi.fn() };
});

const CONFIG: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: {
    main: { translationsFolder: 'src/i18n' },
    admin: { translationsFolder: 'src/admin' },
    vendor: { translationsFolder: 'node_modules/x', readOnly: true },
  },
};

const collectionNamed = (name: string) => expect.objectContaining({ name });

describe('moveResourceCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    vi.mocked(loadConfig).mockReturnValue(CONFIG);
    vi.mocked(moveResource).mockResolvedValue({ outcome: 'succeeded', movedCount: 1, warnings: [], errors: [] });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('moves within the collection with the given flags', async () => {
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', override: true });

    expect(moveResource).toHaveBeenCalledWith(collectionNamed('main'), {
      source: 'a.ok',
      destination: 'b.ok',
      override: true,
    });
    expect(console.log).toHaveBeenCalledWith('✅ Moved 1 resource(s)');
    expect(process.exitCode).toBe(0);
  });

  it('moves into the collection named by --dest-collection', async () => {
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', destCollection: 'admin' });

    expect(moveResource).toHaveBeenCalledWith(
      collectionNamed('main'),
      { source: 'a.ok', destination: 'b.ok', override: undefined, toCollection: 'admin' },
      { config: CONFIG, cwd: '/project' },
    );
    expect(console.log).toHaveBeenCalledWith('✅ Moved 1 resource(s)');
    expect(process.exitCode).toBe(0);
  });

  it('exits 1 for an unknown destination collection', async () => {
    vi.mocked(moveResource).mockRejectedValue(new CollectionNotFoundError('missing', 'destination'));
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', destCollection: 'missing' });

    expect(moveResource).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ Destination collection "missing" not found');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 for a read-only destination collection', async () => {
    vi.mocked(moveResource).mockRejectedValue(new ReadOnlyCollectionError('vendor'));
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', destCollection: 'vendor' });

    expect(moveResource).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '❌ Collection "vendor" is read-only. Its resources cannot be modified.',
    );
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when the move reports errors', async () => {
    vi.mocked(moveResource).mockResolvedValue({
      outcome: 'failed',
      movedCount: 0,
      warnings: [],
      errors: ['b.ok already exists'],
    });

    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok' });

    expect(console.error).toHaveBeenCalledWith('⚠️  No resources were moved.');
    expect(console.error).toHaveBeenCalledWith('❌ Errors:');
    expect(console.error).toHaveBeenCalledWith('  - b.ok already exists');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 with the core message when core throws', async () => {
    vi.mocked(moveResource).mockRejectedValue(new Error('Resource not found: a.ok'));

    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok' });

    expect(console.error).toHaveBeenCalledWith('❌ Resource not found: a.ok');
    expect(process.exitCode).toBe(1);
  });

  it('prints moved resources and errors for a partial failure', async () => {
    vi.mocked(moveResource).mockResolvedValue({
      outcome: 'failed',
      movedCount: 1,
      warnings: ['Destination already exists'],
      errors: ['Source could not be read'],
    });

    await moveResourceCommand({ collection: 'main', source: 'a.*', dest: 'b' });

    expect(console.log).toHaveBeenCalledWith('✅ Moved 1 resource(s)');
    expect(console.error).toHaveBeenCalledWith('⚠️  Warnings:');
    expect(console.error).toHaveBeenCalledWith('  - Destination already exists');
    expect(console.error).toHaveBeenCalledWith('❌ Errors:');
    expect(console.error).toHaveBeenCalledWith('  - Source could not be read');
    expect(process.exitCode).toBe(1);
  });

  it('uses the core outcome for the exit code', async () => {
    vi.mocked(moveResource).mockResolvedValue({ outcome: 'failed', movedCount: 0, warnings: [], errors: [] });

    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok' });

    expect(console.error).toHaveBeenCalledWith('⚠️  No resources were moved.');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 naming the missing flags in non-interactive mode', async () => {
    await moveResourceCommand({ collection: 'main' });

    expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --source, --dest');
    expect(moveResource).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  describe('interactive', () => {
    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    });

    it('asks for source and destination', async () => {
      vi.mocked(prompts).mockResolvedValueOnce({ source: 'a.*', dest: 'b' });

      await moveResourceCommand({ collection: 'main' });

      expect(moveResource).toHaveBeenCalledWith(
        collectionNamed('main'),
        expect.objectContaining({ source: 'a.*', destination: 'b' }),
      );
    });

    it('cancelling prints one cancel line and exits 0', async () => {
      vi.mocked(prompts).mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'text', name: 'source', message: 'Source' }, {});
        return {};
      });

      await moveResourceCommand({ collection: 'main' });

      expect(console.error).toHaveBeenCalledWith('❌ Move resource cancelled.');
      expect(moveResource).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });
});
