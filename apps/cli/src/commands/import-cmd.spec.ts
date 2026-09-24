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
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
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
    parseJsonImport: vi.fn(() => []),
    parseXliffImport: vi.fn(async () => []),
    importResources: vi.fn(),
    detectImportFormat: vi.fn(),
    generateImportSummary: vi.fn(() => '# Import Summary\n\nTest summary'),
    readEffectiveProtectedTerms: vi.fn(() => []),
    loadPreferredTerminology: vi.fn(() => ({
      rules: [],
      filePath: '/test/project/.lingo-tracker-preferred-terminology.json',
    })),
  };
});

// Real utilities, except a fixed summary path.
vi.mock('../utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils')>()),
  buildSummaryPath: vi.fn(() => '/tmp/lingo-tracker-import-summary-test.md'),
}));
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));

// Import the mocked functions
import {
  ConfigNotFoundError,
  detectImportFormat,
  generateImportSummary,
  type ImportResult,
  importResources,
  type LingoTrackerCollection,
  type LingoTrackerConfig,
  loadConfig,
  loadPreferredTerminology,
  parseJsonImport,
  parseXliffImport,
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

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue('/test/project');

    // Explicitly configure fs mocks so their behaviour is intentional, not accidental.
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

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
      vi.mocked(importResources).mockReturnValue(baseImportResult);

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

      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Format Auto-Detection', () => {
    it('should auto-detect XLIFF format from .xliff extension', async () => {
      vi.mocked(detectImportFormat).mockReturnValue('xliff');
      vi.mocked(importResources).mockReturnValue({
        ...baseImportResult,
        resourcesImported: 5,
        resourcesUpdated: 5,
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.xliff',
        locale: 'es',
        verbose: true,
      };

      await importCommand(options);

      expect(detectImportFormat).toHaveBeenCalledWith('/test/import.xliff');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Detected format: xliff'));
    });

    it('should auto-detect JSON format from .json extension', async () => {
      vi.mocked(detectImportFormat).mockReturnValue('json');
      vi.mocked(importResources).mockReturnValue({
        ...baseImportResult,
        resourcesImported: 5,
        resourcesUpdated: 5,
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        verbose: true,
      };

      await importCommand(options);

      expect(detectImportFormat).toHaveBeenCalledWith('/test/import.json');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Detected format: json'));
    });

    it('should return early with error if format detection fails', async () => {
      vi.mocked(detectImportFormat).mockImplementation(() => {
        throw new Error('Cannot auto-detect format from .txt extension');
      });

      const options: ImportCommandOptions = {
        source: '/test/import.txt',
        locale: 'es',
      };

      await importCommand(options);

      expect(console.error).toHaveBeenCalledWith('❌ Cannot auto-detect format from .txt extension');
      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Import Execution', () => {
    it('should parse a JSON file and import its resources', async () => {
      vi.mocked(importResources).mockReturnValue(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(parseJsonImport).toHaveBeenCalledWith('/test/import.json', expect.any(Object));
      expect(parseXliffImport).not.toHaveBeenCalled();
      expect(importResources).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'default', translationsFolder: '/test/project/src/translations' }),
        [],
        expect.objectContaining({ locale: 'es', strategy: 'translation-service', validateBase: true }),
      );
    });

    it('should write the summary with the file format and source', async () => {
      vi.mocked(importResources).mockReturnValue(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(generateImportSummary).toHaveBeenCalledWith(
        baseImportResult,
        expect.objectContaining({ format: 'json', source: '/test/import.json', locale: 'es' }),
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/tmp/lingo-tracker-import-summary-test.md',
        '# Import Summary\n\nTest summary',
        'utf8',
      );
    });

    it('should resolve a relative --source against the project root', async () => {
      process.env.INIT_CWD = '/test/root';
      vi.mocked(importResources).mockReturnValue(baseImportResult);

      await importCommand({ source: 'imports/fr.json', locale: 'es', format: 'json' });

      expect(parseJsonImport).toHaveBeenCalledWith('/test/root/imports/fr.json', expect.any(Object));
    });

    it('should parse an XLIFF file and import its resources', async () => {
      vi.mocked(importResources).mockReturnValue(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.xliff',
        locale: 'es',
        format: 'xliff',
      };

      await importCommand(options);

      expect(parseXliffImport).toHaveBeenCalledWith('/test/import.xliff', expect.any(Object));
      expect(importResources).toHaveBeenCalledWith(
        expect.objectContaining({ translationsFolder: '/test/project/src/translations' }),
        [],
        expect.objectContaining({ locale: 'es' }),
      );
    });

    it('should return early with error if parsing fails', async () => {
      vi.mocked(parseJsonImport).mockImplementationOnce(() => {
        throw new Error('Source file not found');
      });

      const options: ImportCommandOptions = {
        source: '/test/missing.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(console.error).toHaveBeenCalledWith('❌ Import failed: Source file not found');
      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should return early with error if the import refuses to run', async () => {
      vi.mocked(importResources).mockImplementationOnce(() => {
        throw new Error('Cannot import into base locale "en" with strategy "translation-service".');
      });

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json' });

      expect(console.error).toHaveBeenCalledWith(
        '❌ Import failed: Cannot import into base locale "en" with strategy "translation-service".',
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Result Display', () => {
    it('should display success message for successful import', async () => {
      vi.mocked(importResources).mockReturnValue({
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
      vi.mocked(importResources).mockReturnValue({
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
      vi.mocked(importResources).mockReturnValue({
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
      vi.mocked(importResources).mockReturnValue({
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
      vi.mocked(importResources).mockReturnValue(baseImportResult);
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
      vi.mocked(importResources).mockReturnValue(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
        collection: 'admin',
      };

      await importCommand(options);

      expect(importResources).toHaveBeenCalledWith(
        expect.objectContaining({ translationsFolder: '/test/project/src/admin-translations' }),
        [],
        expect.any(Object),
      );
    });

    it('should use the auto-selected collection translations folder when no collection option is given', async () => {
      vi.mocked(importResources).mockReturnValue(baseImportResult);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(importResources).toHaveBeenCalledWith(
        expect.objectContaining({ translationsFolder: '/test/project/src/translations' }),
        [],
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
      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should exit 1 when the collection does not exist', async () => {
      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json', collection: 'nope' });

      expect(console.error).toHaveBeenCalledWith('❌ Collection "nope" not found');
      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should exit 1 when the collection is read-only', async () => {
      onlyCollection('vendor', { translationsFolder: 'node_modules/x', readOnly: true });

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('Non-TTY missing required options', () => {
    it('should exit 1 and not import when --source is missing in non-TTY mode', async () => {
      await importCommand({ locale: 'es', format: 'json' });

      expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --source');
      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should exit 1 and not import when --locale is missing in non-TTY mode', async () => {
      await importCommand({ source: '/test/import.json', format: 'json' });

      expect(console.error).toHaveBeenCalledWith('❌ Missing required options in non-interactive mode: --locale');
      expect(importResources).not.toHaveBeenCalled();
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
    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
      vi.mocked(prompts).mockResolvedValue({ locale: 'de' });
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'de', warnings: [] });
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
      await importCommand({ source: '/test/import.json', format: 'json', strategy: 'translation-service' });

      expect(prompts).toHaveBeenCalledTimes(1);
      expect(process.exitCode).toBe(0);
    });

    it("offers the collection's own locales, minus its base locale", async () => {
      onlyCollection('docs', { translationsFolder: 'src/docs-translations', baseLocale: 'fr', locales: ['fr', 'de'] });

      await importCommand({ source: '/test/import.json', format: 'json', strategy: 'translation-service' });

      expect(offeredLocales()).toEqual([{ title: 'de', value: 'de' }]);
      expect(importResources).toHaveBeenCalledWith(expect.any(Object), [], expect.objectContaining({ locale: 'de' }));
    });

    it('offers the project locales for a collection without its own', async () => {
      await importCommand({ source: '/test/import.json', format: 'json', strategy: 'translation-service' });

      expect(offeredLocales()).toEqual([
        { title: 'es', value: 'es' },
        { title: 'fr', value: 'fr' },
      ]);
    });

    it('offers the base locale too when the chosen strategy is migration', async () => {
      await importCommand({ source: '/test/import.json', format: 'json' });

      expect(offeredLocales({ strategy: 'migration' })).toEqual([
        { title: 'en (base locale)', value: 'en' },
        { title: 'es', value: 'es' },
        { title: 'fr', value: 'fr' },
      ]);
    });

    it('a cancelled prompt prints one cancel line and exits 0', async () => {
      vi.mocked(prompts).mockImplementationOnce(async (_questions, options) => {
        options?.onCancel?.({ type: 'text', name: 'source', message: 'Source' }, {});
        return {};
      });

      await importCommand({});

      expect(console.error).toHaveBeenCalledWith('❌ Import cancelled.');
      expect(importResources).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
    });
  });

  describe('Preferred terminology', () => {
    const filePath = '/test/project/.lingo-tracker-preferred-terminology.json';
    const rules = [{ discouraged: 'Expenditure', preferred: 'Investment' }];

    it('passes the loaded rules to the import', async () => {
      vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules, filePath });
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'en', warnings: [] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json', strategy: 'migration' });

      expect(loadPreferredTerminology).toHaveBeenCalledWith(baseConfig, '/test/project');
      expect(importResources).toHaveBeenCalledWith(
        expect.any(Object),
        [],
        expect.objectContaining({ preferredTerminology: rules }),
      );
    });

    it('adds one config warning on a base-locale import when the rule file is broken', async () => {
      vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules: [], filePath, error: 'not valid JSON' });
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'en', warnings: [] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json', strategy: 'migration' });

      expect(importResources).toHaveBeenCalledWith(
        expect.any(Object),
        [],
        expect.objectContaining({ preferredTerminology: [] }),
      );
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Warnings (1)'));
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Preferred terminology checks skipped: not valid JSON'),
      );
    });

    it('says nothing about a broken rule file on a target-locale import', async () => {
      vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules: [], filePath, error: 'not valid JSON' });
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'es', warnings: [] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Preferred terminology'));
    });

    it('passes the project base locale for a collection without its own', async () => {
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'es', warnings: [] });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(importResources).toHaveBeenCalledWith(
        expect.objectContaining({ baseLocale: 'en' }),
        [],
        expect.any(Object),
      );
    });

    describe('collection with its own base locale', () => {
      beforeEach(() => {
        onlyCollection('docs', { translationsFolder: 'src/docs-translations', baseLocale: 'fr' });
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
      });

      it("treats an import into the collection's base locale as a base-locale import", async () => {
        vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules, filePath });
        vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'fr', warnings: [] });

        await importCommand({
          source: '/test/import.json',
          locale: 'fr',
          format: 'json',
          collection: 'docs',
          strategy: 'migration',
        });

        expect(importResources).toHaveBeenCalledWith(
          expect.objectContaining({ translationsFolder: '/test/project/src/docs-translations', baseLocale: 'fr' }),
          [],
          expect.objectContaining({ locale: 'fr', preferredTerminology: rules }),
        );
      });

      it("adds the config warning on an import into the collection's base locale", async () => {
        vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules: [], filePath, error: 'not valid JSON' });
        vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'fr', warnings: [] });

        await importCommand({
          source: '/test/import.json',
          locale: 'fr',
          format: 'json',
          collection: 'docs',
          strategy: 'migration',
        });

        expect(console.error).toHaveBeenCalledWith(
          expect.stringContaining('Preferred terminology checks skipped: not valid JSON'),
        );
      });

      it('treats the project base locale as a target locale and adds no config warning', async () => {
        vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules: [], filePath, error: 'not valid JSON' });
        vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'en', warnings: [] });

        await importCommand({ source: '/test/import.json', locale: 'en', format: 'json', collection: 'docs' });

        expect(importResources).toHaveBeenCalledWith(
          expect.objectContaining({ baseLocale: 'fr' }),
          [],
          expect.objectContaining({ locale: 'en' }),
        );
        expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('Preferred terminology'));
      });
    });
  });
});
