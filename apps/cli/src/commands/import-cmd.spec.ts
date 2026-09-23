import * as fs from 'fs';
import * as path from 'path';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ImportCommandOptions, importCommand } from './import-cmd';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));
const pathMocks = vi.hoisted(() => ({
  join: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, ...fsMocks, default: { ...actual.default, ...fsMocks } };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, ...fsMocks, default: { ...actual.default, ...fsMocks } };
});
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return { ...actual, ...pathMocks, default: { ...actual.default, ...pathMocks } };
});
vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return { ...actual, ...pathMocks, default: { ...actual.default, ...pathMocks } };
});
vi.mock('prompts', () => ({
  default: vi.fn(),
}));

// Mock the core library imports
vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    // Config loading and collection resolution run for real against the mocked config.
    loadConfig: actual.loadConfig,
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

// Mock utilities
vi.mock('../utils', () => ({
  loadConfiguration: vi.fn(),
  isInteractiveTerminal: vi.fn(() => false),
  promptForCollection: vi.fn(),
  resolveWritableCollection: vi.fn(),
  buildSummaryPath: vi.fn(() => '/tmp/lingo-tracker-import-summary-test.md'),
  ConsoleFormatter: {
    error: vi.fn((message: string) => console.log(`[error] ${message}`)),
    success: vi.fn((message: string) => console.log(`[success] ${message}`)),
    warning: vi.fn((message: string) => console.log(`[warning] ${message}`)),
    info: vi.fn((message: string) => console.log(`[info] ${message}`)),
    progress: vi.fn((message: string) => console.log(`[progress] ${message}`)),
    section: vi.fn((title: string) => {
      console.log(`\n[section] ${title}`);
      console.log('─'.repeat(50));
    }),
    indent: vi.fn((message: string, level = 1) => {
      const spaces = '  '.repeat(level);
      console.log(`${spaces}${message}`);
    }),
    keyValue: vi.fn((key: string, value: string | number, indent = 1) => {
      const spaces = '  '.repeat(indent);
      console.log(`${spaces}${key}: ${value}`);
    }),
  },
  ErrorMessages: {
    OPERATION_CANCELLED: vi.fn((op: string) => `${op} cancelled.`),
    MISSING_OPTION: vi.fn((opt: string) => `Missing required option: --${opt}`),
  },
}));

// Import the mocked functions
import {
  type Collection,
  detectImportFormat,
  generateImportSummary,
  importResources,
  type LingoTrackerCollection,
  loadPreferredTerminology,
  openCollection,
  parseJsonImport,
  parseXliffImport,
} from '@simoncodes-ca/core';
import {
  ConsoleFormatter,
  isInteractiveTerminal,
  loadConfiguration,
  promptForCollection,
  resolveWritableCollection,
} from '../utils';

describe('import-cmd', () => {
  const baseConfig = {
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

  /** What `resolveWritableCollection` resolves for this collection entry under `baseConfig`. */
  const collectionOf = (name: string, entry: LingoTrackerCollection): Collection =>
    openCollection({ ...baseConfig, collections: { [name]: entry } }, name, { cwd: '/test/project' });

  const baseImportResult = {
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
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock path functions
    vi.mocked(path.join)
      .mockReset()
      .mockImplementation((...segments) => segments.join('/'));
    vi.mocked(path.resolve)
      .mockReset()
      .mockImplementation((...segments) => segments.join('/'));

    // Mock process.cwd
    vi.spyOn(process, 'cwd').mockReturnValue('/test/project');

    // Explicitly configure fs mocks so their behaviour is intentional, not accidental.
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    // Default configuration returned by loadConfiguration for all tests.
    vi.mocked(loadConfiguration).mockReturnValue({
      config: baseConfig,
      configPath: '/test/project/.lingo-tracker.json',
      cwd: '/test/project',
    });

    // Default collection mocks — most tests use a single 'default' collection
    vi.mocked(promptForCollection).mockResolvedValue('default');
    vi.mocked(resolveWritableCollection).mockReturnValue(
      collectionOf('default', { translationsFolder: 'src/translations' }),
    );
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

      expect(loadConfiguration).toHaveBeenCalledWith({ exitOnError: false });
    });

    it('should return early when loadConfiguration returns null', async () => {
      vi.mocked(loadConfiguration).mockReturnValue(null);

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await importCommand(options);

      expect(importResources).not.toHaveBeenCalled();
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

      expect(ConsoleFormatter.error).toHaveBeenCalledWith('Cannot auto-detect format from .txt extension');
      expect(importResources).not.toHaveBeenCalled();
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

      expect(ConsoleFormatter.error).toHaveBeenCalledWith('Import failed: Source file not found');
      expect(importResources).not.toHaveBeenCalled();
    });

    it('should return early with error if the import refuses to run', async () => {
      vi.mocked(importResources).mockImplementationOnce(() => {
        throw new Error('Cannot import into base locale "en" with strategy "translation-service".');
      });

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json' });

      expect(ConsoleFormatter.error).toHaveBeenCalledWith(
        'Import failed: Cannot import into base locale "en" with strategy "translation-service".',
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
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

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Warnings (2)'));
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
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exit: ${code}`);
      });

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await expect(importCommand(options)).rejects.toThrow('Process exit: 1');
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Errors (2)'));
    });

    it('should exit with code 1 when only errors array is non-empty', async () => {
      vi.mocked(importResources).mockReturnValue({
        ...baseImportResult,
        resourcesFailed: 0,
        errors: ['some error'],
      });
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(process, 'exit').mockImplementation((code) => {
        throw new Error(`Process exit: ${code}`);
      });

      const options: ImportCommandOptions = {
        source: '/test/import.json',
        locale: 'es',
        format: 'json',
      };

      await expect(importCommand(options)).rejects.toThrow('Process exit: 1');
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
      vi.mocked(loadConfiguration).mockReturnValue({
        config: {
          ...baseConfig,
          collections: {
            ...baseConfig.collections,
            admin: {
              translationsFolder: 'src/admin-translations',
            },
          },
        },
        configPath: '/test/project/.lingo-tracker.json',
        cwd: '/test/project',
      });
      vi.mocked(promptForCollection).mockResolvedValue('admin');
      vi.mocked(resolveWritableCollection).mockReturnValue(
        collectionOf('admin', { translationsFolder: 'src/admin-translations' }),
      );
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

    it('should propagate errors thrown by promptForCollection', async () => {
      vi.mocked(promptForCollection).mockRejectedValue(new Error('Missing required option: --collection'));

      await expect(importCommand({ source: '/test/import.json', locale: 'es', format: 'json' })).rejects.toThrow(
        'Missing required option: --collection',
      );
      expect(importResources).not.toHaveBeenCalled();
    });

    it('should return early without error when promptForCollection returns null', async () => {
      vi.mocked(promptForCollection).mockResolvedValue(null);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(importResources).not.toHaveBeenCalled();
    });

    it('should return early when resolveWritableCollection returns null', async () => {
      vi.mocked(resolveWritableCollection).mockReturnValue(null);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(importResources).not.toHaveBeenCalled();
    });
  });

  describe('Non-TTY missing required options', () => {
    it('should call ConsoleFormatter.error and not import when --source is missing in non-TTY mode', async () => {
      await importCommand({ locale: 'es', format: 'json' });

      expect(ConsoleFormatter.error).toHaveBeenCalledWith(
        'Source file is required. Use --source or run in interactive mode.',
      );
      expect(importResources).not.toHaveBeenCalled();
    });

    it('should call ConsoleFormatter.error and not import when --locale is missing in non-TTY mode', async () => {
      await importCommand({ source: '/test/import.json', format: 'json' });

      expect(ConsoleFormatter.error).toHaveBeenCalledWith(
        'Target locale is required. Use --locale or run in interactive mode.',
      );
      expect(importResources).not.toHaveBeenCalled();
    });
  });

  describe('Interactive locale prompt', () => {
    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
      vi.mocked(prompts).mockResolvedValue({ locale: 'de' });
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'de', warnings: [] } as never);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    });

    /** Choices of the target-locale prompt. */
    const offeredLocales = (): unknown => {
      const question = vi
        .mocked(prompts)
        .mock.calls.map(([asked]) => asked)
        .find((asked) => !Array.isArray(asked) && asked.name === 'locale');
      return question && !Array.isArray(question) ? question.choices : undefined;
    };

    it("offers the collection's own locales, minus its base locale", async () => {
      vi.mocked(promptForCollection).mockResolvedValue('docs');
      vi.mocked(resolveWritableCollection).mockReturnValue(
        collectionOf('docs', { translationsFolder: 'src/docs-translations', baseLocale: 'fr', locales: ['fr', 'de'] }),
      );

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
  });

  describe('Preferred terminology', () => {
    const filePath = '/test/project/.lingo-tracker-preferred-terminology.json';
    const rules = [{ discouraged: 'Expenditure', preferred: 'Investment' }];

    it('passes the loaded rules to the import', async () => {
      vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules, filePath });
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'en', warnings: [] } as never);
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
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'en', warnings: [] } as never);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'en', format: 'json', strategy: 'migration' });

      expect(importResources).toHaveBeenCalledWith(
        expect.any(Object),
        [],
        expect.objectContaining({ preferredTerminology: [] }),
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Warnings (1)'));
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Preferred terminology checks skipped: not valid JSON'),
      );
    });

    it('says nothing about a broken rule file on a target-locale import', async () => {
      vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules: [], filePath, error: 'not valid JSON' });
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'es', warnings: [] } as never);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);

      await importCommand({ source: '/test/import.json', locale: 'es', format: 'json' });

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Preferred terminology'));
    });

    it('passes the project base locale for a collection without its own', async () => {
      vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'es', warnings: [] } as never);
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
        vi.mocked(promptForCollection).mockResolvedValue('docs');
        vi.mocked(resolveWritableCollection).mockReturnValue(
          collectionOf('docs', { translationsFolder: 'src/docs-translations', baseLocale: 'fr' }),
        );
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
      });

      it("treats an import into the collection's base locale as a base-locale import", async () => {
        vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules, filePath });
        vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'fr', warnings: [] } as never);

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
        vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'fr', warnings: [] } as never);

        await importCommand({
          source: '/test/import.json',
          locale: 'fr',
          format: 'json',
          collection: 'docs',
          strategy: 'migration',
        });

        expect(console.log).toHaveBeenCalledWith(
          expect.stringContaining('Preferred terminology checks skipped: not valid JSON'),
        );
      });

      it('treats the project base locale as a target locale and adds no config warning', async () => {
        vi.mocked(loadPreferredTerminology).mockReturnValueOnce({ rules: [], filePath, error: 'not valid JSON' });
        vi.mocked(importResources).mockReturnValue({ ...baseImportResult, locale: 'en', warnings: [] } as never);

        await importCommand({ source: '/test/import.json', locale: 'en', format: 'json', collection: 'docs' });

        expect(importResources).toHaveBeenCalledWith(
          expect.objectContaining({ baseLocale: 'fr' }),
          [],
          expect.objectContaining({ locale: 'en' }),
        );
        expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('Preferred terminology'));
      });
    });
  });
});
