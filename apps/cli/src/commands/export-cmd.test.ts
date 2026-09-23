import * as fs from 'node:fs';
import { join } from 'node:path';
import prompts from 'prompts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exportCommand } from './export-cmd';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    ...fsMocks,
    default: { ...actual.default, ...fsMocks },
  };
});
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    ...fsMocks,
    default: { ...actual.default, ...fsMocks },
  };
});
vi.mock('prompts');

vi.mock('@simoncodes-ca/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@simoncodes-ca/core')>();
  return {
    // Config loading and collection resolution run for real against the mocked config.
    loadConfig: actual.loadConfig,
    openCollection: actual.openCollection,
    exportTargetLocales: actual.exportTargetLocales,
    ConfigNotFoundError: actual.ConfigNotFoundError,
    ConfigParseError: actual.ConfigParseError,
    CollectionNotFoundError: actual.CollectionNotFoundError,
    ReadOnlyCollectionError: actual.ReadOnlyCollectionError,
    CONFIG_FILENAME: '.lingo-tracker.json',
    runExport: vi.fn(),
    validateOutputDirectory: vi.fn(),
    validateBasePropertyName: vi.fn(),
    readGlobalProtectedTerms: vi.fn(() => ['Acme']),
    readCollectionProtectedTerms: vi.fn(() => []),
  };
});

import type { ExportRunResult } from '@simoncodes-ca/core';
import * as core from '@simoncodes-ca/core';

const mockRunExport = vi.mocked(core.runExport);
const mockValidateOutputDirectory = vi.mocked(core.validateOutputDirectory);
const mockValidateBasePropertyName = vi.mocked(core.validateBasePropertyName);

/** A run that exported fr and es; override any field. */
const runResult = (overrides: Partial<ExportRunResult> = {}): ExportRunResult => ({
  format: 'json',
  filesCreated: ['fr.json', 'es.json'],
  resourcesExported: 10,
  warnings: [],
  errors: [],
  collections: ['common', 'admin'],
  locales: ['fr', 'es'],
  outputDirectory: '/out',
  omittedResources: [],
  malformedFiles: [],
  hierarchicalConflicts: [],
  localeResults: [
    { locale: 'fr', outcome: 'exported', resourcesExported: 5, filesCreated: ['fr.json'] },
    { locale: 'es', outcome: 'exported', resourcesExported: 5, filesCreated: ['es.json'] },
  ],
  summary: '# Export Summary',
  ...overrides,
});

/** Names of the collections passed to runExport. */
const exportedCollections = (): string[] | undefined => mockRunExport.mock.calls[0]?.[0].map((c) => c.name);

describe('exportCommand', () => {
  const mockConfig = {
    exportFolder: 'dist/export',
    baseLocale: 'en',
    locales: ['en', 'fr', 'es'],
    collections: {
      common: {
        translationsFolder: 'translations/common',
      },
      admin: {
        translationsFolder: 'translations/admin',
      },
    },
  };

  const originalStdout = process.stdout.isTTY;
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalExit = process.exit;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();
    process.exit = vi.fn() as unknown as (code?: number | string | null | undefined) => never;
    process.exitCode = 0;

    // Set to non-TTY by default to avoid prompts
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      writable: true,
      configurable: true,
    });

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockConfig));
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

    mockValidateOutputDirectory.mockReturnValue(undefined);
    mockRunExport.mockResolvedValue(runResult());
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: originalStdout,
      writable: true,
      configurable: true,
    });
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.exit = originalExit;
    process.exitCode = originalExitCode;
  });

  describe('configuration validation', () => {
    it('should error when config file is missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      // Make process.exit actually throw to prevent further execution
      vi.mocked(process.exit).mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with code ${code}`);
      });

      await expect(exportCommand({ format: 'json' })).rejects.toThrow('process.exit called with code 1');

      expect(console.error).toHaveBeenCalledWith('❌ Configuration file .lingo-tracker.json not found.');
    });

    it('should error when config file is malformed', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');
      // Make process.exit actually throw to prevent further execution
      vi.mocked(process.exit).mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with code ${code}`);
      });

      await expect(exportCommand({ format: 'json' })).rejects.toThrow('process.exit called with code 1');

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to parse configuration file'));
    });

    it('should error when format is missing in non-TTY mode', async () => {
      // In non-TTY mode without format, promptForMissing throws an error directly
      await expect(exportCommand({})).rejects.toThrow('❌ Missing required option: --format');
    });

    it('should handle validateOutputDirectory errors', async () => {
      mockValidateOutputDirectory.mockImplementation(() => {
        throw new Error('Invalid output directory');
      });
      // Make process.exit actually throw to prevent further execution
      vi.mocked(process.exit).mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with code ${code}`);
      });

      await expect(exportCommand({ format: 'json' })).rejects.toThrow('process.exit called with code 1');

      expect(console.log).toHaveBeenCalledWith('❌ Invalid output directory');
    });
  });

  describe('non-interactive mode', () => {
    it('should export the chosen collection and locale to JSON', async () => {
      await exportCommand({
        format: 'json',
        collection: 'common',
        locale: 'fr',
        status: 'new,stale',
      });

      expect(exportedCollections()).toEqual(['common']);
      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          format: 'json',
          locales: ['fr'],
          status: ['new', 'stale'],
          augmentProtectedTerms: true,
          protectedTerms: { global: ['Acme'], collections: { common: [] } },
        }),
      );
    });

    it('should export to XLIFF with all required options', async () => {
      await exportCommand({
        format: 'xliff',
        collection: 'common',
        locale: 'fr',
        status: 'new,stale',
      });

      expect(mockRunExport).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ format: 'xliff' }));
    });

    it('should export all collections when none specified', async () => {
      await exportCommand({
        format: 'json',
      });

      expect(exportedCollections()).toEqual(['common', 'admin']);
    });

    it('should export all target locales (never the base locale) when none specified', async () => {
      await exportCommand({
        format: 'json',
      });

      expect(mockRunExport).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ locales: ['fr', 'es'] }));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Locales: fr, es'));
    });

    it('should not filter by status when not provided', async () => {
      await exportCommand({
        format: 'json',
      });

      expect(mockRunExport).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ status: undefined }));
    });

    it('should handle dry run mode', async () => {
      await exportCommand({
        format: 'json',
        dryRun: true,
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[DRY RUN]'));
      expect(mockRunExport).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ dryRun: true }));
      // In dry run mode, summary is not written to file
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should use custom output directory when provided', async () => {
      await exportCommand({
        format: 'json',
        output: 'custom/output',
      });

      expect(mockValidateOutputDirectory).toHaveBeenCalledWith(expect.stringContaining(join('custom', 'output')));
      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ outputDirectory: expect.stringContaining(join('custom', 'output')) }),
      );
    });

    it('should filter by tags when provided', async () => {
      await exportCommand({
        format: 'json',
        tags: 'ui,buttons',
      });

      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ tags: ['ui', 'buttons'] }),
      );
    });

    it('should disable augmentation when --no-protect-notes is used', async () => {
      await exportCommand({
        format: 'json',
        protectNotes: false,
      });

      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ augmentProtectedTerms: false }),
      );
    });

    it('should print progress messages indented in verbose mode', async () => {
      mockRunExport.mockImplementation(async (_collections, options) => {
        options.onProgress?.('Skipping fr: No matching resources.');
        return runResult();
      });

      await exportCommand({
        format: 'json',
        verbose: true,
      });

      expect(console.log).toHaveBeenCalledWith('   Skipping fr: No matching resources.');
    });

    it('should warn when no collections found', async () => {
      await exportCommand({
        format: 'json',
        collection: 'nonexistent',
      });

      expect(console.log).toHaveBeenCalledWith('⚠️  No matching collections found.');
      expect(mockRunExport).not.toHaveBeenCalled();
    });

    it('should warn when no target locales selected', async () => {
      await exportCommand({
        format: 'json',
        locale: 'en', // base locale is filtered out
      });

      expect(console.log).toHaveBeenCalledWith('⚠️  No target locales selected.');
      expect(mockRunExport).not.toHaveBeenCalled();
    });
  });

  describe('interactive mode', () => {
    beforeEach(() => {
      Object.defineProperty(process.stdout, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });
    });

    it('should prompt for format when not provided', async () => {
      vi.mocked(prompts).mockResolvedValue({
        format: 'json',
        collections: ['__ALL__'],
        locales: ['__ALL__'],
        statusFilter: ['new', 'stale'],
        tags: '',
        output: 'dist/export',
        structure: 'hierarchical',
        rich: false,
        includeBase: false,
        includeStatus: false,
        includeComment: true,
        includeTags: false,
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({});

      expect(prompts).toHaveBeenCalled();
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const questions = Array.isArray(promptCall) ? promptCall : [promptCall];
      expect(questions).toContainEqual(expect.objectContaining({ name: 'format' }));
    });

    it('should handle user cancellation gracefully', async () => {
      vi.mocked(prompts).mockImplementation(() => {
        throw new Error('Export cancelled');
      });

      await exportCommand({});

      expect(console.log).toHaveBeenCalledWith('❌ ❌ Export cancelled.');
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should prompt for collections when not provided', async () => {
      vi.mocked(prompts).mockResolvedValue({
        format: 'json',
        collections: ['common'],
        locales: ['__ALL__'],
        statusFilter: ['new'],
        tags: '',
        output: 'dist/export',
        structure: 'hierarchical',
        rich: false,
        includeBase: false,
        includeStatus: false,
        includeComment: true,
        includeTags: false,
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({});

      expect(prompts).toHaveBeenCalled();
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const questions = Array.isArray(promptCall) ? promptCall : [promptCall];
      expect(questions).toContainEqual(expect.objectContaining({ name: 'collections' }));
    });

    it('should handle "All Collections" selection', async () => {
      vi.mocked(prompts).mockResolvedValue({
        format: 'json',
        collections: ['__ALL__'],
        locales: ['__ALL__'],
        statusFilter: [],
        tags: '',
        output: 'dist/export',
        structure: 'hierarchical',
        rich: false,
        includeBase: false,
        includeStatus: false,
        includeComment: true,
        includeTags: false,
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({});

      expect(exportedCollections()).toEqual(['common', 'admin']);
    });

    it('should handle specific collection selection', async () => {
      vi.mocked(prompts).mockResolvedValue({
        format: 'json',
        collections: ['common'],
        locales: ['__ALL__'],
        statusFilter: [],
        tags: '',
        output: 'dist/export',
        structure: 'hierarchical',
        rich: false,
        includeBase: false,
        includeStatus: false,
        includeComment: true,
        includeTags: false,
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({});

      expect(exportedCollections()).toEqual(['common']);
    });

    it('should prompt for JSON-specific options when JSON format is selected', async () => {
      vi.mocked(prompts).mockResolvedValue({
        format: 'json',
        collections: ['common'],
        locales: ['fr'],
        statusFilter: ['new'],
        tags: '',
        output: 'dist/export',
        structure: 'flat',
        rich: true,
        includeBase: true,
        includeStatus: true,
        includeComment: true,
        includeTags: true,
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({});

      expect(prompts).toHaveBeenCalled();
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const questions = Array.isArray(promptCall) ? promptCall : [promptCall];

      // Should include JSON-specific prompts with correct type functions
      const structureQuestion = questions.find((q) => q.name === 'structure');
      const richQuestion = questions.find((q) => q.name === 'rich');

      expect(structureQuestion).toBeDefined();
      expect(richQuestion).toBeDefined();

      // Type functions should return proper types for JSON format
      if (structureQuestion && typeof structureQuestion.type === 'function') {
        expect(structureQuestion.type(null, { format: 'json' })).toBe('select');
      }
      if (richQuestion && typeof richQuestion.type === 'function') {
        expect(richQuestion.type(null, { format: 'json' })).toBe('toggle');
      }
    });

    it('should not prompt for rich object options when rich is false', async () => {
      vi.mocked(prompts).mockResolvedValue({
        format: 'json',
        collections: ['__ALL__'],
        locales: ['__ALL__'],
        statusFilter: [],
        tags: '',
        output: 'dist/export',
        structure: 'hierarchical',
        rich: false,
        includeBase: false,
        includeStatus: false,
        includeComment: true,
        includeTags: false,
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({});

      expect(mockRunExport).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ richJson: false }));
    });

    it('should not prompt for already provided options', async () => {
      vi.mocked(prompts).mockResolvedValue({
        collections: ['__ALL__'],
        locales: ['__ALL__'],
        statusFilter: ['new', 'stale'],
        tags: '',
        output: 'dist/export',
        structure: 'hierarchical',
        rich: false,
        includeBase: false,
        includeStatus: false,
        includeComment: true,
        includeTags: false,
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({
        format: 'json',
      });

      // Verify prompts was called but format was not prompted for
      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const questions = Array.isArray(promptCall) ? promptCall : [promptCall];
      expect(questions).not.toContainEqual(expect.objectContaining({ name: 'format' }));
    });

    it('should conditionally show JSON-specific prompts based on format', async () => {
      vi.mocked(prompts).mockResolvedValue({
        format: 'xliff',
        collections: ['__ALL__'],
        locales: ['__ALL__'],
        statusFilter: [],
        tags: '',
        output: 'dist/export',
        filename: '',
        dryRun: false,
        verbose: false,
      });

      await exportCommand({});

      const promptCall = vi.mocked(prompts).mock.calls[0][0];
      const questions = Array.isArray(promptCall) ? promptCall : [promptCall];

      // JSON-specific questions exist but have conditional type functions
      const structureQuestion = questions.find((q) => q.name === 'structure');
      const richQuestion = questions.find((q) => q.name === 'rich');

      // These questions should have type functions that return null for XLIFF
      if (structureQuestion && typeof structureQuestion.type === 'function') {
        expect(structureQuestion.type(null, { format: 'xliff' })).toBeNull();
      }
      if (richQuestion && typeof richQuestion.type === 'function') {
        expect(richQuestion.type(null, { format: 'xliff' })).toBeNull();
      }
    });
  });

  describe('rendering the run', () => {
    it('should write the summary returned by the run', async () => {
      await exportCommand({
        format: 'json',
      });

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('lingo-tracker-export-summary'),
        '# Export Summary',
      );
    });

    it('should print the summary instead of writing it in dry run mode', async () => {
      await exportCommand({
        format: 'json',
        dryRun: true,
      });

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Summary (Dry Run)'));
      expect(console.log).toHaveBeenCalledWith('# Export Summary');
    });

    it('should set exit code when errors occur', async () => {
      mockRunExport.mockResolvedValue(runResult({ errors: ['Export failed'] }));

      await exportCommand({
        format: 'json',
      });

      expect(process.exitCode).toBe(1);
    });

    it('should not set exit code in dry run mode even with errors', async () => {
      mockRunExport.mockResolvedValue(runResult({ errors: ['Export failed'] }));

      await exportCommand({
        format: 'json',
        dryRun: true,
      });

      expect(process.exitCode).toBe(0);
    });

    it('should display warnings when present', async () => {
      mockRunExport.mockResolvedValue(runResult({ warnings: ['Warning 1', 'Warning 2'] }));

      await exportCommand({
        format: 'json',
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Warnings (2)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Warning 1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Warning 2'));
    });

    it('should display errors when present', async () => {
      mockRunExport.mockResolvedValue(runResult({ errors: ['Error 1', 'Error 2'] }));

      await exportCommand({
        format: 'json',
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Errors (2)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Error 1'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Error 2'));
    });

    it('should handle hierarchical conflicts as errors', async () => {
      mockRunExport.mockResolvedValue(runResult({ hierarchicalConflicts: ['[fr] Conflict at key.path'] }));

      await exportCommand({
        format: 'json',
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Errors (1)'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Conflict at key.path'));
      expect(process.exitCode).toBe(1);
    });

    it('should display a locale whose export threw', async () => {
      mockRunExport.mockResolvedValue(
        runResult({
          localeResults: [
            { locale: 'fr', outcome: 'failed', resourcesExported: 0, filesCreated: [], error: 'Export failed for fr' },
            { locale: 'es', outcome: 'exported', resourcesExported: 5, filesCreated: ['es.json'] },
          ],
        }),
      );

      await exportCommand({
        format: 'json',
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('fr: Export failed - Export failed for fr'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('es: Exported 5 resources to es.json'));
    });

    it('should pass verbose and a progress callback to the run', async () => {
      await exportCommand({
        format: 'json',
        verbose: true,
      });

      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ verbose: true, onProgress: expect.any(Function) }),
      );
    });

    it('should display success message for each exported locale', async () => {
      await exportCommand({
        format: 'json',
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('fr: Exported 5 resources to fr.json'));
    });

    it('should display failure message when a locale created no file', async () => {
      mockRunExport.mockResolvedValue(
        runResult({ localeResults: [{ locale: 'fr', outcome: 'failed', resourcesExported: 0, filesCreated: [] }] }),
      );

      await exportCommand({
        format: 'json',
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('fr: Failed'));
    });

    it('should say nothing per locale for a skipped locale', async () => {
      mockRunExport.mockResolvedValue(
        runResult({ localeResults: [{ locale: 'fr', outcome: 'skipped', resourcesExported: 0, filesCreated: [] }] }),
      );

      await exportCommand({
        format: 'json',
      });

      expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining('fr:'));
    });

    it('should pass the JSON options to the run', async () => {
      await exportCommand({
        format: 'json',
        structure: 'flat',
        rich: true,
        includeBase: true,
        includeStatus: true,
        includeComment: false,
        includeTags: true,
        filename: 'custom-{locale}.json',
      });

      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          format: 'json',
          jsonStructure: 'flat',
          richJson: true,
          includeBase: true,
          includeStatus: true,
          includeComment: false,
          includeTags: true,
          filenamePattern: 'custom-{locale}.json',
        }),
      );
    });

    it('should pass the XLIFF options to the run', async () => {
      await exportCommand({
        format: 'xliff',
        filename: 'custom-{locale}.xliff',
      });

      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          format: 'xliff',
          filenamePattern: 'custom-{locale}.xliff',
        }),
      );
    });

    it('should display total files and resources in summary', async () => {
      mockRunExport.mockResolvedValue(runResult({ filesCreated: ['fr.json', 'es.json'], resourcesExported: 25 }));

      await exportCommand({
        format: 'json',
      });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Export Summary'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Files Created: 2'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Resources Exported: 25'));
    });

    it('should report a run that cannot start and exit with an error', async () => {
      mockRunExport.mockRejectedValue(new Error('Cannot export collections with different base locales together'));
      vi.mocked(process.exit).mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with code ${code}`);
      });

      await expect(exportCommand({ format: 'json' })).rejects.toThrow('process.exit called with code 1');

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Cannot export collections with different base locales together'),
      );
    });
  });

  describe('--base-property-name option', () => {
    it('should warn when --base-property-name is set without --include-base', async () => {
      await exportCommand({
        format: 'json',
        locale: 'fr',
        basePropertyName: 'original',
        includeBase: false,
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('--base-property-name has no effect without --include-base'),
      );
    });

    it('should exit with error when --base-property-name validation fails', async () => {
      mockValidateBasePropertyName.mockImplementation(() => {
        throw new Error('basePropertyName "value" is a reserved key');
      });
      vi.mocked(process.exit).mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit called with code ${code}`);
      });

      await expect(
        exportCommand({
          format: 'json',
          locale: 'fr',
          basePropertyName: 'value',
          includeBase: true,
        }),
      ).rejects.toThrow('process.exit called with code 1');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('basePropertyName "value" is a reserved key'));
    });

    it('should pass basePropertyName through to the run', async () => {
      await exportCommand({
        format: 'json',
        locale: 'fr',
        basePropertyName: 'original',
        includeBase: true,
      });

      expect(mockRunExport).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ basePropertyName: 'original' }),
      );
    });
  });
});
