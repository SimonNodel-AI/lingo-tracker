import * as fs from 'fs';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ImportCommandOptions, importCommand } from './import-cmd';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, ...fsMocks, default: { ...actual, ...fsMocks } };
});
vi.mock('prompts', () => ({
  default: vi.fn(),
}));

// Mock the core library imports
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    // Collection resolution runs for real against the mocked config.
    loadConfig: vi.fn(),
    openCollection: actual.openCollection,
    ConfigNotFoundError: actual.ConfigNotFoundError,
    ConfigParseError: actual.ConfigParseError,
    CollectionNotFoundError: actual.CollectionNotFoundError,
    ReadOnlyCollectionError: actual.ReadOnlyCollectionError,
    CONFIG_FILENAME: '.lingo-tracker.json',
    runImport: vi.fn(),
    detectImportFormat: actual.detectImportFormat,
    getStrategyDefaults: actual.getStrategyDefaults,
    ImportSourceError: actual.ImportSourceError,
  };
});

vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));

// Import the mocked functions
import {
  ConfigNotFoundError,
  detectImportFormat,
  type ImportResult,
  ImportSourceError,
  type LingoTrackerCollection,
  type LingoTrackerConfig,
  loadConfig,
  runImport,
} from '@simoncodes-ca/core';
import { isInteractiveTerminal } from '../runner/terminal';

describe('import-cmd', () => {
  const baseConfig: LingoTrackerConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en', 'es', 'fr'],
    collections: {
      default: {
        translationsFolder: 'src/translations',
      },
    },
  };

  /** Configures `baseConfig` with this one collection, so the runner auto-selects it. */
  const onlyCollection = (name: string, entry: LingoTrackerCollection): void => {
    vi.mocked(loadConfig).mockReturnValue({ ...baseConfig, collections: { [name]: entry } });
  };

  const baseImportResult: ImportResult = {
    strategy: 'update',
    locale: 'fr',
    collection: 'default',
    resourcesImported: 10,
    resourcesCreated: 0,
    resourcesUpdated: 10,
    resourcesSkipped: 0,
    resourcesFailed: 0,
    statusTransitions: [],
    filesModified: [],
    warnings: [],
    errors: [],
    changes: [],
    icuAutoFixes: [],
    icuAutoFixErrors: [],
    dryRun: false,
  };

  const mockRun = (result: ImportResult): void => {
    vi.mocked(runImport).mockImplementation(async (_collection, options) => {
      const format = options.format ?? detectImportFormat(options.source);
      options.onStart?.(format);
      return { format, result, summary: () => '# Import Summary\n\nTest summary' };
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue('/test/project');

    // Explicitly configure fs mocks so their behaviour is intentional, not accidental.
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    mockRun(baseImportResult);

    // Default configuration for all tests: a single 'default' collection, auto-selected.
    process.env.INIT_CWD = '/test/project';
    process.exitCode = undefined;
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    vi.mocked(loadConfig).mockReturnValue(baseConfig);
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  describe('Configuration Loading', () => {
    it('should load configuration from .lingo-tracker.json', async () => {
      mockRun(baseImportResult);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(loadConfig).toHaveBeenCalledWith({ cwd: '/test/project' });
      expect(process.exitCode).toBe(0);
    });

    it('should exit 1 without importing when the configuration is missing', async () => {
      vi.mocked(loadConfig).mockImplementation(() => {
        throw new ConfigNotFoundError('/test/project/.lingo-tracker.json');
      });

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(runImport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Format Auto-Detection', () => {
    it('prints the detected format in verbose mode', async () => {
      mockRun(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.xliff', locale: 'es', verbose: true });

      expect(runImport).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ format: undefined }));
      expect(console.log).toHaveBeenCalledWith('Detected format: xliff');
    });

    it('should return early with error if format detection fails', async () => {
      const message = 'Cannot auto-detect format from .txt extension';
      vi.mocked(runImport).mockRejectedValueOnce(
        new ImportSourceError(message, { cause: new Error(message), stage: 'format' }),
      );

      const options: ImportCommandOptions = {
        source: '/test/import.txt',
        locale: 'es',
      };

      await importCommand(options);

      expect(vi.mocked(console.error).mock.calls).toEqual([['❌ Cannot auto-detect format from .txt extension']]);
      expect(runImport).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Import Execution', () => {
    it('should write the summary with the file format and source', async () => {
      mockRun(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('lingo-tracker-import-summary'),
        '# Import Summary\n\nTest summary',
        'utf8',
      );
    });

    it('reports a summary-generation failure after displaying the imported result', async () => {
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.mocked(runImport).mockImplementationOnce(async (_collection, options) => {
        options.onStart?.('json');
        return {
          format: 'json',
          result: baseImportResult,
          summary: () => {
            throw new Error('summary failed');
          },
        };
      });

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Import completed successfully!'));
      expect(console.error).toHaveBeenCalledWith('⚠️  Failed to write summary file: summary failed');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });

    it('does not build a summary for a dry run', async () => {
      vi.mocked(runImport).mockImplementationOnce(async (_collection, options) => {
        options.onStart?.('json');
        return {
          format: 'json',
          result: baseImportResult,
          summary: () => {
            throw new Error('summary called');
          },
        };
      });

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json', dryRun: true });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });

    it('should resolve a relative --source against the project root', async () => {
      process.env.INIT_CWD = '/test/root';
      mockRun(baseImportResult);

      await importCommand({ source: 'imports/fr.json', locale: 'es', format: 'json' });

      expect(runImport).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ cwd: '/test/root', source: 'imports/fr.json' }),
      );
    });

    it('should return early with error if parsing fails', async () => {
      const message = 'Source file not found';
      vi.mocked(runImport).mockRejectedValueOnce(new ImportSourceError(message, { cause: new Error(message) }));

      const options: ImportCommandOptions = {
        source: '/test/missing.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(vi.mocked(console.error).mock.calls).toEqual([['❌ Import failed: Source file not found']]);
      expect(runImport).toHaveBeenCalledOnce();
      expect(process.exitCode).toBe(1);
    });

    it('should return early with error if the import refuses to run', async () => {
      vi.mocked(runImport).mockImplementationOnce(() => {
        throw new Error('Cannot import into base locale "en" with strategy "translation-service".');
      });

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json' });

      expect(console.error).toHaveBeenCalledWith(
        '❌ Import failed: Cannot import into base locale "en" with strategy "translation-service".',
      );
      expect(console.error).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Result Display', () => {
    it('prints a large-source warning before the run header', async () => {
      const output: string[] = [];
      vi.spyOn(console, 'error').mockImplementation((message: string) => {
        output.push(message);
      });
      vi.spyOn(console, 'log').mockImplementation((message: string) => {
        output.push(message);
      });
      vi.mocked(runImport).mockImplementation(async (_collection, options) => {
        options.onWarning?.({
          message: 'Large import file detected: 5.00 MB',
          details: ['Import may take longer than usual.'],
        });
        options.onStart?.('json');
        return { format: 'json', result: baseImportResult, summary: () => '# Import Summary' };
      });

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(output.indexOf('⚠️  Large import file detected: 5.00 MB')).toBeLessThan(
        output.indexOf('🔄 Starting import...'),
      );
      expect(output).toContain('  Import may take longer than usual.');
    });

    it('should display success message for successful import', async () => {
      mockRun({
        ...baseImportResult,
        filesModified: ['file1.json', 'file2.json'],
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Import completed successfully!'));
      expect(process.exitCode).toBe(0);
    });

    it('should display warnings for import with warnings', async () => {
      mockRun({
        ...baseImportResult,
        warnings: ['Warning 1', 'Warning 2'],
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Warnings (2)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Import completed with warnings'));
    });

    it('should exit with code 1 for import with errors', async () => {
      mockRun({
        ...baseImportResult,
        resourcesUpdated: 8,
        resourcesFailed: 2,
        errors: ['Error 1', 'Error 2'],
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);
      expect(process.exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Errors (2)'));
    });

    it('should exit with code 1 when only errors array is non-empty', async () => {
      mockRun({
        ...baseImportResult,
        resourcesFailed: 0,
        errors: ['some error'],
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);
      expect(process.exitCode).toBe(1);
    });

    it('should display dry-run message', async () => {
      mockRun(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
        dryRun: true,
      };

      await importCommand(options);

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Mode: DRY RUN (no changes will be made)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Dry run complete. No changes were made.'));
    });
  });

  describe('Collection Handling', () => {
    it('should use collection-specific translations folder', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        ...baseConfig,
        collections: {
          ...baseConfig.collections,
          admin: {
            translationsFolder: 'src/admin-translations',
          },
        },
      });
      mockRun(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
        collection: 'admin',
      };

      await importCommand(options);

      expect(runImport).toHaveBeenCalledWith(
        expect.objectContaining({ translationsFolder: '/test/project/src/admin-translations' }),
        expect.any(Object),
      );
    });

    it('should use the auto-selected collection translations folder when no collection option is given', async () => {
      mockRun(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(runImport).toHaveBeenCalledWith(
        expect.objectContaining({ translationsFolder: '/test/project/src/translations' }),
        expect.any(Object),
      );
    });

    it('should exit 1 when several collections exist and --collection is missing', async () => {
      vi.mocked(loadConfig).mockReturnValue({
        ...baseConfig,
        collections: { ...baseConfig.collections, admin: { translationsFolder: 'src/admin-translations' } },
      });

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(console.error).toHaveBeenCalledWith('❌ Missing required option: --collection');
      expect(runImport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should exit 1 when the collection does not exist', async () => {
      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json', collection: 'nope' });

      expect(console.error).toHaveBeenCalledWith('❌ Collection "nope" not found');
      expect(runImport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should exit 1 when the collection is read-only', async () => {
      onlyCollection('vendor', { translationsFolder: 'node_modules/x', readOnly: true });

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(runImport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Non-TTY missing required options', () => {
    it('should exit 1 and not import when --source is missing in non-TTY mode', async () => {
      await importCommand({ locale: 'es', format: 'json' });

      expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --source');
      expect(runImport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should exit 1 and not import when --locale is missing in non-TTY mode', async () => {
      await importCommand({ source: '/test/import.json', format: 'json' });

      expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --locale');
      expect(runImport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should name both flags when --source and --locale are missing', async () => {
      await importCommand({ format: 'json' });

      expect(console.error).toHaveBeenCalledWith(
        '❌ Missing required options in non-interactive mode: --source, --locale',
      );
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Interactive locale prompt', () => {
    const registered = (options: ImportCommandOptions): ImportCommandOptions => ({
      dryRun: false,
      verbose: false,
      ...options,
    });

    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
      vi.mocked(prompts).mockResolvedValue({ locale: 'de' });
      mockRun({ ...baseImportResult, locale: 'de', warnings: [] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    /** Choices of the target-locale question, evaluated as prompts would (after no earlier answers). */
    const offeredLocales = (values: Record<string, unknown> = {}): unknown => {
      const [asked] = vi.mocked(prompts).mock.calls[0] ?? [];
      const question = (Array.isArray(asked) ? asked : [asked]).find((q) => q?.name === 'locale');
      const choices = question?.choices;
      return typeof choices === 'function' ? choices(undefined, values, question) : choices;
    };

    it('asks every missing value in one prompts call', async () => {
      await importCommand(
        registered({
          source: '/test/import.json',
          format: 'json',
        }),
      );

      expect(prompts).toHaveBeenCalledTimes(1);
      const [asked] = vi.mocked(prompts).mock.calls[0] ?? [];
      expect((Array.isArray(asked) ? asked : [asked]).map((question) => question?.name)).toContain('strategy');
      expect(process.exitCode).toBe(0);
    });

    it("offers the collection's own locales, minus its base locale", async () => {
      onlyCollection('docs', {
        translationsFolder: 'src/docs-translations',
        baseLocale: 'fr',
        locales: ['fr', 'de'],
      });

      await importCommand(
        registered({
          source: '/test/import.json',
          format: 'json',
          strategy: 'translation-service',
        }),
      );

      expect(offeredLocales()).toEqual([{ title: 'de', value: 'de' }]);
      expect(runImport).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ locale: 'de' }));
    });

    it('offers the project locales for a collection without its own', async () => {
      await importCommand(
        registered({
          source: '/test/import.json',
          format: 'json',
          strategy: 'translation-service',
        }),
      );

      expect(offeredLocales()).toEqual([
        { title: 'es', value: 'es' },
        { title: 'fr', value: 'fr' },
      ]);
    });

    it('offers the base locale too when the chosen strategy is migration', async () => {
      await importCommand(registered({ source: '/test/import.json', format: 'json' }));

      expect(offeredLocales({ strategy: 'migration' })).toEqual([
        { title: 'en (base locale)', value: 'en' },
        { title: 'es', value: 'es' },
        { title: 'fr', value: 'fr' },
      ]);
    });

    it('asks migration switches left unset by registration', async () => {
      await importCommand(
        registered({
          source: '/test/import.json',
          format: 'json',
          strategy: 'migration',
        }),
      );

      const [asked] = vi.mocked(prompts).mock.calls[0] ?? [];
      const questions = Array.isArray(asked) ? asked : [asked];
      expect(
        questions
          .filter(
            (question) =>
              typeof question?.name === 'string' &&
              ['updateComments', 'updateTags', 'createMissing'].includes(question.name),
          )
          .map((question) => question?.initial),
      ).toEqual([true, true, true]);
    });

    it('a cancelled prompt prints one cancel line and exits 0', async () => {
      vi.mocked(prompts).mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'text', name: 'source', message: 'Source' }, {});
        return {};
      });

      await importCommand(registered({}));

      expect(console.error).toHaveBeenCalledWith('❌ Import cancelled.');
      expect(runImport).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });

  describe('Project Terms', () => {
    it('passes no terms: the run reads them from the collection', async () => {
      mockRun({ ...baseImportResult, locale: 'en', warnings: [] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json', strategy: 'migration' });

      const options = vi.mocked(runImport).mock.calls[0]?.[1];
      expect(options).not.toHaveProperty('protectedTerms');
      expect(options).not.toHaveProperty('preferredTerminology');
    });

    it("renders a rule-file problem the run reported in the result's warnings", async () => {
      mockRun({
        ...baseImportResult,
        locale: 'en',
        warnings: ['Preferred terminology checks skipped: not valid JSON'],
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json', strategy: 'migration' });

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Warnings (1)'));
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Preferred terminology checks skipped: not valid JSON'),
      );
    });

    it('passes the project base locale for a collection without its own', async () => {
      mockRun({ ...baseImportResult, locale: 'es', warnings: [] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(runImport).toHaveBeenCalledWith(expect.objectContaining({ baseLocale: 'en' }), expect.any(Object));
    });

    it('opens a collection with its own base locale, so the run sees it', async () => {
      onlyCollection('docs', { translationsFolder: 'src/docs-translations', baseLocale: 'fr' });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      mockRun({ ...baseImportResult, locale: 'fr', warnings: [] });

      await importCommand({
        source: '/test/import.json',
        locale: 'fr',
        format: 'json',
        collection: 'docs',
        strategy: 'migration',
      });

      expect(runImport).toHaveBeenCalledWith(
        expect.objectContaining({ translationsFolder: '/test/project/src/docs-translations', baseLocale: 'fr' }),
        expect.objectContaining({ locale: 'fr' }),
      );
    });
  });
});
