import * as fs from 'node:fs';
import * as core from '@simoncodes-ca/core';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isInteractiveTerminal } from '../runner/terminal';
import { addResourceCommand } from './add-resource';

// Mock prompts to avoid interactive input
vi.mock('prompts', () => ({
  default: vi.fn(),
}));
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// fs is mocked so the existing-entry check (openResourceFolder) reads what each test says.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, ...fsMocks, default: { ...actual.default, ...fsMocks } };
});
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, ...fsMocks, default: { ...actual.default, ...fsMocks } };
});
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    ...actual,
    loadConfig: vi.fn(),
    addResource: vi.fn().mockResolvedValue({ resolvedKey: 'test.key', created: true }),
    loadPreferredTerminology: vi.fn(() => ({ rules: [], filePath: '/test/.lingo-tracker-preferred-terminology.json' })),
  };
});

describe('addResourceCommand', () => {
  beforeEach(() => {
    process.env.INIT_CWD = '/test';
    process.exitCode = undefined;
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('File not found');
    });
    vi.mocked(prompts).mockResolvedValue({});
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    vi.mocked(core.loadConfig).mockImplementation(() => {
      throw new core.ConfigNotFoundError('/test/.lingo-tracker.json');
    });
  });

  afterEach(() => {
    delete process.env.INIT_CWD;
    process.exitCode = undefined;
  });

  it('should show error and exit 1 when config file does not exist', async () => {
    await addResourceCommand({
      collection: 'test-collection',
      key: 'buttons.ok',
      value: 'OK',
    });

    expect(core.loadConfig).toHaveBeenCalledWith({ cwd: '/test' });
    expect(console.error).toHaveBeenCalledWith('❌ Configuration file .lingo-tracker.json not found.');
    expect(core.addResource).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should print a core error (invalid key) and exit 1', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: { TestCollection: { translationsFolder: 'translations' } },
    });
    vi.mocked(core.addResource).mockRejectedValueOnce(
      new core.InvalidResourceKeyError('invalid key with spaces', 'Invalid resource key'),
    );

    await addResourceCommand({
      collection: 'TestCollection',
      key: 'invalid key with spaces',
      value: 'Test',
    });

    expect(console.log).toHaveBeenCalledWith('❌ Invalid resource key');
    expect(process.exitCode).toBe(1);
  });

  it('should show error when collection does not exist', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: {
        ExistingCollection: { translationsFolder: 'translations' },
      },
    });

    await addResourceCommand({
      collection: 'NonExistentCollection',
      key: 'buttons.ok',
      value: 'OK',
    });

    expect(console.log).toHaveBeenCalledWith('❌ Collection "NonExistentCollection" not found');
    expect(core.addResource).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should refuse a read-only collection with exit 1', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: { Vendor: { translationsFolder: 'node_modules/x', readOnly: true } },
    });

    await addResourceCommand({ collection: 'Vendor', key: 'buttons.ok', value: 'OK' });

    expect(core.addResource).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should exit 1 naming --key and --value when both are missing in non-interactive mode', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: { TestCollection: { translationsFolder: 'translations' } },
    });

    await addResourceCommand({ collection: 'TestCollection' });

    expect(console.log).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --key, --value');
    expect(core.addResource).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should pass the opened collection and supplied fields through to core', async () => {
    const config = {
      collections: {
        TestCollection: {
          translationsFolder: 'translations',
          baseLocale: 'en',
          locales: ['en', 'fr-ca', 'es'],
        },
      },
      baseLocale: 'en',
      locales: ['en', 'fr-ca', 'es'],
    };
    vi.mocked(core.loadConfig).mockReturnValue(config);

    await addResourceCommand({
      collection: 'TestCollection',
      key: 'buttons.ok',
      value: 'OK',
      comment: 'Primary confirmation action',
      tags: 'ui, buttons',
      targetFolder: 'common',
      translations: JSON.stringify([
        { locale: 'fr-ca', value: "D'accord", status: 'translated' },
        { locale: 'es', value: 'Aceptar', status: 'verified' },
      ]),
    });

    expect(core.addResource).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'TestCollection',
        translationsFolder: '/test/translations',
        baseLocale: 'en',
      }),
      {
        key: 'buttons.ok',
        baseValue: 'OK',
        comment: 'Primary confirmation action',
        tags: ['ui', 'buttons'],
        targetFolder: 'common',
        translations: [
          { locale: 'fr-ca', value: "D'accord", status: 'translated' },
          { locale: 'es', value: 'Aceptar', status: 'verified' },
        ],
      },
    );
    expect(process.exitCode).toBe(0);
  });

  it('should exit 1 with a clear message on malformed --translations JSON', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: { TestCollection: { translationsFolder: 'translations' } },
    });

    await addResourceCommand({ collection: 'TestCollection', key: 'a.b', value: 'OK', translations: '[{"locale":' });

    expect(console.log).toHaveBeenCalledWith(expect.stringMatching(/^❌ Invalid --translations JSON: /));
    expect(core.addResource).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should exit 1 when --translations is valid JSON of the wrong shape', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: { TestCollection: { translationsFolder: 'translations' } },
    });

    await addResourceCommand({
      collection: 'TestCollection',
      key: 'a.b',
      value: 'OK',
      translations: '[{"locale":"fr","value":"Oui","status":"done"}]',
    });

    expect(console.log).toHaveBeenCalledWith(
      '❌ Invalid --translations: expected a JSON array of { "locale", "value", "status" } with status one of new, translated, stale, verified',
    );
    expect(core.addResource).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('should prompt for overwrite confirmation when resource exists in interactive mode', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: {
        TestCollection: {
          translationsFolder: 'translations',
          baseLocale: 'en',
        },
      },
      baseLocale: 'en',
    });

    vi.mocked(fs.readFileSync).mockImplementation((path: fs.PathOrFileDescriptor) => {
      if (String(path).includes('resource_entries.json')) {
        return JSON.stringify({ ok: { source: 'OK' } });
      }
      throw new Error('File not found');
    });

    // Mock resource file exists and contains the entry
    vi.mocked(fs.existsSync).mockImplementation((path: fs.PathLike) => String(path).includes('resource_entries.json'));

    vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    // Optional fields are asked first; then the user declines the overwrite.
    vi.mocked(prompts).mockResolvedValueOnce({}).mockResolvedValueOnce({ value: false });

    await addResourceCommand({
      collection: 'TestCollection',
      key: 'buttons.ok',
      value: 'OK',
    });

    expect(prompts).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'confirm',
        message: expect.stringContaining('already exists'),
      }),
      expect.anything(),
    );
    expect(core.addResource).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('❌ Add resource cancelled.');
    expect(process.exitCode).toBe(0);
  });

  describe('preferred terminology', () => {
    const filePath = '/test/.lingo-tracker-preferred-terminology.json';
    const config = {
      collections: { TestCollection: { translationsFolder: 'translations', baseLocale: 'en', locales: ['en', 'fr'] } },
      baseLocale: 'en',
      locales: ['en', 'fr'],
    };
    let logSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.mocked(core.loadConfig).mockReturnValue(config);
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      logSpy.mockRestore();
    });

    const add = (value: string) => addResourceCommand({ collection: 'TestCollection', key: 'budget.title', value });

    it('warns once per matching rule after a successful add, with the reason on its own line', async () => {
      vi.mocked(core.loadPreferredTerminology).mockReturnValue({
        rules: [
          { discouraged: 'Expenditure', preferred: 'Investment', reason: 'Finance style guide' },
          { discouraged: 'e-mail', preferred: 'email' },
        ],
        filePath,
      });

      await add('Expenditure and more expenditure, by e-mail');

      expect(core.addResource).toHaveBeenCalled();
      expect(core.loadPreferredTerminology).toHaveBeenCalledWith(config, '/test');
      const lines = logSpy.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain('⚠️  Preferred terminology: consider "Investment" instead of "Expenditure"');
      expect(lines).toContain('  Finance style guide');
      expect(lines).toContain('⚠️  Preferred terminology: consider "email" instead of "e-mail"');
      expect(lines.filter((line) => line.includes('Preferred terminology:'))).toHaveLength(2);
      expect(process.exitCode).toBe(0);
    });

    it('prints nothing when the value uses no discouraged term', async () => {
      vi.mocked(core.loadPreferredTerminology).mockReturnValue({
        rules: [{ discouraged: 'Expenditure', preferred: 'Investment' }],
        filePath,
      });

      await add('Investment summary');

      expect(logSpy.mock.calls.some((call) => String(call[0]).includes('Preferred terminology'))).toBe(false);
    });

    it('prints one config warning and skips the check when the rule file is broken', async () => {
      vi.mocked(core.loadPreferredTerminology).mockReturnValue({ rules: [], filePath, error: 'not valid JSON' });

      await add('Expenditure');

      const lines = logSpy.mock.calls.map((call) => String(call[0]));
      expect(lines).toContain('⚠️  Preferred terminology checks skipped: not valid JSON');
      expect(lines.filter((line) => line.includes('Preferred terminology'))).toHaveLength(1);
    });

    it('prints the missing-explicit-file warning', async () => {
      vi.mocked(core.loadPreferredTerminology).mockReturnValue({
        rules: [],
        filePath,
        warning: 'Preferred terminology file not found: /test/terms.json. Treating as an empty list.',
      });

      await add('Expenditure');

      expect(logSpy).toHaveBeenCalledWith(
        '⚠️  Preferred terminology file not found: /test/terms.json. Treating as an empty list.',
      );
    });

    it('does not check when the add fails', async () => {
      vi.mocked(core.addResource).mockRejectedValueOnce(new Error('boom'));

      await add('Expenditure');

      expect(core.loadPreferredTerminology).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith('❌ boom');
      expect(process.exitCode).toBe(1);
    });
  });

  it('reports a cancelled prompt once and exits 0 without adding the resource', async () => {
    vi.mocked(core.loadConfig).mockReturnValue({
      collections: { TestCollection: { translationsFolder: 'translations', baseLocale: 'en' } },
      baseLocale: 'en',
    });
    vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const exit = vi.spyOn(process, 'exit');
    // The user presses Esc: prompts calls onCancel.
    vi.mocked(prompts).mockImplementation(async (questions, options) => {
      const [question] = Array.isArray(questions) ? questions : [questions];
      options?.onCancel?.(question, {});
      return {};
    });

    try {
      await expect(addResourceCommand({})).resolves.toBeUndefined();

      expect(log.mock.calls.filter(([line]) => String(line).includes('cancelled'))).toEqual([
        ['❌ Add resource cancelled.'],
      ]);
      expect(core.addResource).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    } finally {
      log.mockRestore();
      exit.mockRestore();
    }
  });
});
