import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ConfigNotFoundError,
  ConfigParseError,
  InvalidResourceKeyError,
  type LingoTrackerConfig,
  loadConfig,
} from '@simoncodes-ca/core';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type CollectionNeed, CommandCancelledError, type CommandSpec, defineCommand } from './command-runner';
import { isInteractiveTerminal } from './terminal';

vi.mock('prompts');
vi.mock('./terminal', () => ({ isInteractiveTerminal: vi.fn(() => false), hasPipedStdin: vi.fn(() => true) }));
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return { ...actual, loadConfig: vi.fn() };
});

const mockPrompts = vi.mocked(prompts);
const mockLoadConfig = vi.mocked(loadConfig);
const mockInteractive = vi.mocked(isInteractiveTerminal);

const twoCollections: LingoTrackerConfig = {
  exportFolder: 'dist/lingo-export',
  importFolder: 'dist/lingo-import',
  baseLocale: 'en',
  locales: ['en', 'fr'],
  collections: {
    main: { translationsFolder: 'src/i18n' },
    vendor: { translationsFolder: 'node_modules/x/i18n', readOnly: true },
  },
};

interface Options {
  collection?: string;
  key?: string;
  targetFolder?: string;
}

type Spec = CommandSpec<Options, CollectionNeed, true, keyof Options & string>;

function command(overrides: Partial<Spec> = {}) {
  const run = vi.fn();
  const spec: Spec = { name: 'Do thing', collection: 'read', run, ...overrides };
  return { invoke: defineCommand<Options>()(spec), run };
}

describe('defineCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;
    mockLoadConfig.mockReturnValue(twoCollections);
    mockInteractive.mockReturnValue(false);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  describe('interactive rule', () => {
    it('reads the terminal once and hands the result to run', async () => {
      mockInteractive.mockReturnValue(true);
      const { invoke, run } = command({ collection: 'none' });

      await invoke({});

      expect(mockInteractive).toHaveBeenCalledTimes(1);
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ interactive: true, cwd: '/project' }));
    });

    it('checks both stdin and stdout', async () => {
      const actual = await vi.importActual<typeof import('./terminal')>('./terminal');
      const stdin = process.stdin.isTTY;
      const stdout = process.stdout.isTTY;
      try {
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
        expect(actual.isInteractiveTerminal()).toBe(false);
        expect(actual.hasPipedStdin()).toBe(false);

        Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        expect(actual.isInteractiveTerminal()).toBe(false);
        expect(actual.hasPipedStdin()).toBe(true);

        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        expect(actual.isInteractiveTerminal()).toBe(true);
      } finally {
        Object.defineProperty(process.stdin, 'isTTY', { value: stdin, configurable: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: stdout, configurable: true });
      }
    });
  });

  describe('config', () => {
    it('reads the config from INIT_CWD and passes it with its path', async () => {
      const { invoke, run } = command({ collection: 'none' });

      await invoke({});

      expect(mockLoadConfig).toHaveBeenCalledWith({ cwd: '/project' });
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ config: twoCollections, configPath: resolve('/project', '.lingo-tracker.json') }),
      );
      expect(process.exitCode).toBe(0);
    });

    it('a missing config exits 1 with the init hint', async () => {
      mockLoadConfig.mockImplementation(() => {
        throw new ConfigNotFoundError('/project/.lingo-tracker.json');
      });
      const { invoke, run } = command();

      await invoke({});

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Configuration file .lingo-tracker.json not found.');
      expect(console.error).toHaveBeenCalledWith('Run "lingo-tracker init" to initialize a project.');
      expect(process.exitCode).toBe(1);
    });

    it('an unparsable config exits 1 with the reason', async () => {
      mockLoadConfig.mockImplementation(() => {
        throw new ConfigParseError('/project/.lingo-tracker.json', 'Unexpected token');
      });
      const { invoke } = command();

      await invoke({});

      expect(console.error).toHaveBeenCalledWith('❌ Failed to parse configuration file: Unexpected token');
      expect(process.exitCode).toBe(1);
    });

    it('falls back to process.cwd() when INIT_CWD is unset', async () => {
      delete process.env.INIT_CWD;
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue('/elsewhere');
      const { invoke, run } = command({ collection: 'none' });

      await invoke({});

      expect(mockLoadConfig).toHaveBeenCalledWith({ cwd: '/elsewhere' });
      expect(run).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/elsewhere' }));
      cwd.mockRestore();
    });

    describe('through the real loadConfig', () => {
      let dir: string;

      beforeEach(async () => {
        const actual = await vi.importActual<typeof import('@simoncodes-ca/core')>('@simoncodes-ca/core');
        mockLoadConfig.mockImplementation(actual.loadConfig);
        dir = mkdtempSync(join(tmpdir(), 'lingo-runner-'));
        process.env.INIT_CWD = dir;
      });

      afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
      });

      it('reports a file that is not JSON as a parse failure', async () => {
        writeFileSync(join(dir, '.lingo-tracker.json'), '{ not json');
        const { invoke, run } = command();

        await invoke({});

        expect(run).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^❌ Failed to parse configuration file: /));
        expect(process.exitCode).toBe(1);
      });

      it('reports another I/O error (EISDIR) as a parse failure too', async () => {
        mkdirSync(join(dir, '.lingo-tracker.json'));
        const { invoke, run } = command();

        await invoke({});

        expect(run).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
          expect.stringMatching(/^❌ Failed to parse configuration file: EISDIR/),
        );
        expect(process.exitCode).toBe(1);
      });
    });

    it('config: false skips loading', async () => {
      const run = vi.fn();
      await defineCommand<Options>()({ name: 'Init', collection: 'none', config: false, run })({});

      expect(mockLoadConfig).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledWith(expect.not.objectContaining({ config: expect.anything() }));
    });
  });

  describe('collection resolution', () => {
    it('opens the collection named by --collection', async () => {
      const { invoke, run } = command();

      await invoke({ collection: 'main' });

      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({
          collection: expect.objectContaining({ name: 'main', translationsFolder: resolve('/project', 'src/i18n') }),
        }),
      );
    });

    it('fails with exit 1 when no collection is configured', async () => {
      mockLoadConfig.mockReturnValue({ ...twoCollections, collections: {} });
      const { invoke, run } = command();

      await invoke({});

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ No collections found. Run `lingo-tracker add-collection` first.');
      expect(process.exitCode).toBe(1);
    });

    it('auto-selects the only collection', async () => {
      mockLoadConfig.mockReturnValue({ ...twoCollections, collections: { main: { translationsFolder: 'src/i18n' } } });
      const { invoke, run } = command();

      await invoke({});

      expect(mockPrompts).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ collection: expect.objectContaining({ name: 'main' }) }),
      );
    });

    it('prompts for one of several collections when interactive', async () => {
      mockInteractive.mockReturnValue(true);
      mockPrompts.mockResolvedValueOnce({ collection: 'vendor' });
      const { invoke, run } = command();

      await invoke({});

      expect(mockPrompts).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'select', choices: [expect.anything(), expect.anything()] }),
        expect.anything(),
      );
      expect(run).toHaveBeenCalledWith(
        expect.objectContaining({ collection: expect.objectContaining({ name: 'vendor' }) }),
      );
    });

    it('fails with exit 1 on several collections when non-interactive', async () => {
      const { invoke, run } = command();

      await invoke({});

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Missing required option: --collection');
      expect(process.exitCode).toBe(1);
    });

    it('names a custom collection option in kebab case', async () => {
      const run = vi.fn();
      await defineCommand<{ collectionName?: string }>()({
        name: 'Delete collection',
        collection: 'read',
        collectionOption: 'collectionName',
        run,
      })({});

      expect(console.error).toHaveBeenCalledWith('❌ Missing required option: --collection-name');
    });

    it("treats --collection '' as not given", async () => {
      const { invoke, run } = command();

      await invoke({ collection: '' });

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Missing required option: --collection');
      expect(process.exitCode).toBe(1);
    });

    it('cancelling the collection select is a cancel (exit 0)', async () => {
      mockInteractive.mockReturnValue(true);
      mockPrompts.mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'select', name: 'collection', message: 'Select collection' }, {});
        return {};
      });
      const { invoke, run } = command();

      await invoke({});

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Do thing cancelled.');
      expect(process.exitCode).toBe(0);
    });

    it('an unknown collection exits 1', async () => {
      const { invoke, run } = command();

      await invoke({ collection: 'nope' });

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Collection "nope" not found');
      expect(process.exitCode).toBe(1);
    });

    it("'writable' refuses a read-only collection with exit 1", async () => {
      const { invoke, run } = command({ collection: 'writable' });

      await invoke({ collection: 'vendor' });

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        '❌ Collection "vendor" is read-only. Its resources cannot be modified.',
      );
      expect(process.exitCode).toBe(1);
    });

    it("'read' opens a read-only collection", async () => {
      const { invoke, run } = command();

      await invoke({ collection: 'vendor' });

      expect(run).toHaveBeenCalled();
    });

    it("'none' opens no collection", async () => {
      const { invoke, run } = command({ collection: 'none' });

      await invoke({});

      expect(run).toHaveBeenCalledWith(expect.not.objectContaining({ collection: expect.anything() }));
      expect(process.exitCode).toBe(0);
    });
  });

  describe('prompts and required options', () => {
    const keyQuestion = (options: Options): prompts.PromptObject[] =>
      options.key ? [] : [{ type: 'text', name: 'key', message: 'Key' }];

    it('asks the questions when interactive and merges the answers over the flags', async () => {
      mockInteractive.mockReturnValue(true);
      mockPrompts.mockResolvedValueOnce({ key: 'a.b' });
      const { invoke, run } = command({ prompts: keyQuestion, required: ['key'] });

      await invoke({ collection: 'main' });

      expect(run).toHaveBeenCalledWith(expect.objectContaining({ answers: { collection: 'main', key: 'a.b' } }));
    });

    it('passes the opened collection to the question builder', async () => {
      const builder = vi.fn(() => []);
      const { invoke } = command({ prompts: builder });

      await invoke({ collection: 'main' });

      expect(builder).toHaveBeenCalledWith(
        { collection: 'main' },
        expect.objectContaining({ collection: expect.objectContaining({ name: 'main' }) }),
      );
    });

    it('fails with exit 1 naming every missing required flag when non-interactive', async () => {
      const { invoke, run } = command({
        prompts: () => [{ type: 'text', name: 'key', message: 'Key' }],
        required: ['key', 'targetFolder'],
      });

      await invoke({ collection: 'main' });

      expect(mockPrompts).not.toHaveBeenCalled();
      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(
        '❌ Missing required options in non-interactive mode: --key, --target-folder',
      );
      expect(process.exitCode).toBe(1);
    });

    it('checks required options even when there are no questions', async () => {
      const { invoke, run } = command({ prompts: () => [], required: ['key'] });

      await invoke({ collection: 'main' });

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --key');
      expect(process.exitCode).toBe(1);
    });

    it("counts '' as missing", async () => {
      const { invoke, run } = command({ required: ['key'] });

      await invoke({ collection: 'main', key: '' });

      expect(run).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('checks required options after prompting: an empty interactive answer exits 1', async () => {
      mockInteractive.mockReturnValue(true);
      mockPrompts.mockResolvedValueOnce({ key: '' });
      const { invoke, run } = command({ prompts: keyQuestion, required: ['key'] });

      await invoke({ collection: 'main' });

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Missing required options: --key');
      expect(process.exitCode).toBe(1);
    });

    it('lets the question builder fail before required options are checked', async () => {
      const { invoke, run } = command({
        prompts: () => {
          throw new Error('Nothing to choose from');
        },
        required: ['key'],
      });

      await invoke({ collection: 'main' });

      expect(run).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Nothing to choose from');
      expect(process.exitCode).toBe(1);
    });

    it('a cancelled prompt prints one cancel line and exits 0', async () => {
      mockInteractive.mockReturnValue(true);
      mockPrompts.mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'text', name: 'key', message: 'Key' }, {});
        return {};
      });
      const { invoke, run } = command({ prompts: keyQuestion });

      await invoke({ collection: 'main' });

      expect(run).not.toHaveBeenCalled();
      const cancelLines = vi.mocked(console.error).mock.calls.filter(([line]) => String(line).includes('cancelled'));
      expect(cancelLines).toEqual([['❌ Do thing cancelled.']]);
      expect(process.exitCode).toBe(0);
    });

    it('ask() inside run follows the same cancel rule', async () => {
      mockPrompts.mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'confirm', name: 'ok', message: 'Sure?' }, {});
        return {};
      });
      const after = vi.fn();
      const { invoke } = command({
        collection: 'none',
        run: async ({ ask }) => {
          await ask({ type: 'confirm', name: 'ok', message: 'Sure?' });
          after();
        },
      });

      await invoke({});

      expect(after).not.toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith('❌ Do thing cancelled.');
      expect(process.exitCode).toBe(0);
    });
  });

  describe('outcome', () => {
    it('a thrown LingoTrackerError prints its message and exits 1', async () => {
      const { invoke } = command({
        collection: 'none',
        run: () => {
          throw new InvalidResourceKeyError('bad..key', 'Invalid key "bad..key"');
        },
      });

      await invoke({});

      expect(console.error).toHaveBeenCalledWith('❌ Invalid key "bad..key"');
      expect(process.exitCode).toBe(1);
    });

    it('CommandCancelledError thrown by run is a cancel (exit 0)', async () => {
      const { invoke } = command({
        collection: 'none',
        run: () => {
          throw new CommandCancelledError();
        },
      });

      await invoke({});

      expect(console.error).toHaveBeenCalledWith('❌ Do thing cancelled.');
      expect(process.exitCode).toBe(0);
    });

    it('{ exitCode: 1 } from run propagates', async () => {
      const { invoke } = command({ collection: 'none', run: async () => ({ exitCode: 1 }) });

      await invoke({});

      expect(process.exitCode).toBe(1);
    });

    it('never calls process.exit', async () => {
      const exit = vi.spyOn(process, 'exit');
      mockLoadConfig.mockImplementation(() => {
        throw new ConfigNotFoundError('/project/.lingo-tracker.json');
      });

      await command().invoke({});

      expect(exit).not.toHaveBeenCalled();
      exit.mockRestore();
    });
  });
});
