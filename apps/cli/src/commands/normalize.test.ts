import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import prompts from 'prompts';
import { normalizeCommand } from './normalize';
import { type LingoTrackerConfig, loadConfig, type NormalizeResult, normalize } from '@simoncodes-ca/core';
import { isInteractiveTerminal } from '../runner/terminal';

vi.mock('prompts', () => ({
  default: vi.fn(),
}));
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  // Collection resolution runs for real against the mocked config.
  return { ...actual, loadConfig: vi.fn(), normalize: vi.fn() };
});

const CONFIG: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: {
    App: { translationsFolder: 'path/App' },
    Lib: { translationsFolder: 'path/Lib', readOnly: true },
  },
};

const logged = () => vi.mocked(console.log).mock.calls.map(([line]) => String(line));
const errored = () => vi.mocked(console.error).mock.calls.map(([line]) => String(line));

describe('normalizeCommand', () => {
  // Most calls here are real runs; the dry-run test overrides dryRun.
  const NORMALIZE_RESULT: NormalizeResult = {
    entriesProcessed: 0,
    localesAdded: 0,
    valuesConverted: 0,
    tagsNormalized: 0,
    filesCreated: 0,
    filesUpdated: 0,
    foldersRemoved: 0,
    dryRun: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INIT_CWD = '/p';
    process.exitCode = undefined;
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    vi.mocked(loadConfig).mockReturnValue(CONFIG);
    vi.mocked(normalize).mockResolvedValue(NORMALIZE_RESULT);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('normalizes the named collection with its opened settings', async () => {
    vi.mocked(normalize).mockResolvedValueOnce({ ...NORMALIZE_RESULT, dryRun: true });
    await normalizeCommand({ collection: 'App', dryRun: true });

    expect(normalize).toHaveBeenCalledWith({
      translationsFolder: '/p/path/App',
      baseLocale: 'en',
      locales: ['en', 'fr'],
      dryRun: true,
    });
    expect(process.exitCode).toBe(0);
  });

  it('exits 1 without --collection or --all in non-interactive mode', async () => {
    await normalizeCommand({});

    expect(normalize).not.toHaveBeenCalled();
    expect(errored()).toContain('❌ Missing required option in non-interactive mode: --collection or --all');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 for an unknown collection', async () => {
    await normalizeCommand({ collection: 'Nope' });

    expect(normalize).not.toHaveBeenCalled();
    expect(errored()).toContain('❌ Collection "Nope" not found');
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when no collections are configured', async () => {
    vi.mocked(loadConfig).mockReturnValue({ ...CONFIG, collections: {} });

    await normalizeCommand({ all: true });

    expect(normalize).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('exits 1 when normalizing a collection fails', async () => {
    vi.mocked(normalize).mockRejectedValue(new Error('disk full'));

    await normalizeCommand({ collection: 'App' });

    expect(errored()).toContain('❌ Failed to normalize collection "App": disk full');
    expect(process.exitCode).toBe(1);
  });

  it('with --json, reports a failed collection on stderr and keeps stdout to the JSON', async () => {
    vi.mocked(normalize).mockRejectedValue(new Error('disk full'));

    await normalizeCommand({ collection: 'App', json: true });

    expect(errored()).toEqual(['❌ Failed to normalize collection "App": disk full']);
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ collections: [], totals: { collectionsProcessed: 0 } });
    expect(process.exitCode).toBe(1);
  });

  it('with --json, reports a read-only collection on stderr and keeps stdout to the JSON', async () => {
    await normalizeCommand({ collection: 'Lib', json: true });

    expect(errored()).toEqual(['❌ Collection "Lib" is read-only. Its resources cannot be modified.']);
    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ collections: [] });
    expect(process.exitCode).toBe(1);
  });

  it('prints only JSON with --json', async () => {
    await normalizeCommand({ collection: 'App', json: true });

    const lines = logged();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      collections: [{ collectionName: 'App' }],
      totals: { collectionsProcessed: 1 },
    });
  });

  describe('read-only collections', () => {
    it('fails (exit 1) and skips normalize when an explicitly named collection is read-only', async () => {
      await normalizeCommand({ collection: 'Lib', json: false });

      expect(normalize).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(errored()).toContain('❌ Collection "Lib" is read-only. Its resources cannot be modified.');
      expect(logged()).not.toContain('ℹ️  Skipping read-only collection: Lib');
    });

    it('skips read-only collections during --all WITHOUT failing the run', async () => {
      await normalizeCommand({ all: true, json: false });

      // App (writable) is normalized; Lib (read-only) is skipped, not failed.
      expect(normalize).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(0);
      expect(logged()).toContain('ℹ️  Skipping read-only collection: Lib');
    });
  });

  describe('interactive', () => {
    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    });

    it('offers each collection and "All collections"', async () => {
      vi.mocked(prompts).mockResolvedValueOnce({ collectionOrAll: 'App' });

      await normalizeCommand({});

      expect(prompts).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            name: 'collectionOrAll',
            choices: [
              { title: 'App', value: 'App' },
              { title: 'Lib', value: 'Lib' },
              { title: 'All collections', value: '__ALL__' },
            ],
          }),
        ],
        expect.anything(),
      );
      expect(normalize).toHaveBeenCalledTimes(1);
    });

    it('confirms --all, and declining cancels with exit 0', async () => {
      vi.mocked(prompts).mockResolvedValueOnce({ confirmed: false });

      await normalizeCommand({ all: true });

      expect(normalize).not.toHaveBeenCalled();
      expect(errored()).toContain('❌ Normalize cancelled.');
      expect(process.exitCode).toBe(0);
    });

    it('choosing "All collections" asks for confirmation, then normalizes the writable ones', async () => {
      vi.mocked(prompts)
        .mockResolvedValueOnce({ collectionOrAll: '__ALL__' })
        .mockResolvedValueOnce({ confirmed: true });

      await normalizeCommand({});

      expect(prompts).toHaveBeenCalledTimes(2);
      expect(normalize).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(0);
    });

    it('reports a cancelled prompt once and returns without exiting or normalizing', async () => {
      const exit = vi.spyOn(process, 'exit');
      // The user presses Esc: prompts calls onCancel.
      vi.mocked(prompts).mockImplementation(async (questions, options) => {
        const [question] = Array.isArray(questions) ? questions : [questions];
        options?.onCancel?.(question, {});
        return {};
      });

      await expect(normalizeCommand({})).resolves.toBeUndefined();

      expect(errored().filter((line) => line.includes('cancelled'))).toEqual(['❌ Normalize cancelled.']);
      expect(normalize).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
      exit.mockRestore();
    });
  });
});
