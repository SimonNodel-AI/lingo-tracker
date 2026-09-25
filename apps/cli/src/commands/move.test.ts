import { type LingoTrackerConfig, loadConfig, moveResource } from '@simoncodes-ca/core';
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
    vi.mocked(moveResource).mockResolvedValue({ movedCount: 1, warnings: [], errors: [], mutations: [] });
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
      destinationCollection: undefined,
    });
    expect(console.log).toHaveBeenCalledWith('✅ Moved 1 resource(s)');
    expect(process.exitCode).toBe(0);
  });

  it('moves into the collection named by --dest-collection', async () => {
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', destCollection: 'admin' });

    expect(moveResource).toHaveBeenCalledWith(collectionNamed('main'), {
      source: 'a.ok',
      destination: 'b.ok',
      override: undefined,
      destinationCollection: expect.objectContaining({
        name: 'admin',
        translationsFolder: '/project/src/admin',
        readOnly: false,
      }),
    });
    expect(console.log).toHaveBeenCalledWith('✅ Moved 1 resource(s)');
    expect(process.exitCode).toBe(0);
  });

  it('exits 1 for an unknown destination collection', async () => {
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', destCollection: 'missing' });

    expect(moveResource).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith('❌ Collection "missing" not found');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 for a read-only destination collection', async () => {
    await moveResourceCommand({ collection: 'main', source: 'a.ok', dest: 'b.ok', destCollection: 'vendor' });

    expect(moveResource).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      '❌ Collection "vendor" is read-only. Its resources cannot be modified.',
    );
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when the move reports errors', async () => {
    vi.mocked(moveResource).mockResolvedValue({
      movedCount: 0,
      warnings: [],
      errors: ['b.ok already exists'],
      mutations: [],
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
