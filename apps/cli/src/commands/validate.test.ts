import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateCommand } from './validate';

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
    validateResources: vi.fn(),
    generateValidationSummary: vi.fn(),
    loadPreferredTerminology: vi.fn(() => ({
      rules: [],
      filePath: '/project/.lingo-tracker-preferred-terminology.json',
    })),
  };
});

import * as core from '@simoncodes-ca/core';

const mockValidateResources = vi.mocked(core.validateResources);
const mockGenerateValidationSummary = vi.mocked(core.generateValidationSummary);
const mockLoadPreferredTerminology = vi.mocked(core.loadPreferredTerminology);

describe('validateCommand', () => {
  const mockConfig = {
    exportFolder: 'dist/lingo-export',
    importFolder: 'dist/lingo-import',
    baseLocale: 'en',
    locales: ['en', 'fr', 'es', 'de'],
    collections: {
      common: {
        translationsFolder: 'translations/common',
      },
      admin: {
        translationsFolder: 'translations/admin',
      },
    },
  };

  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    console.error = vi.fn();
    console.warn = vi.fn();
    process.env.INIT_CWD = '/project';
    process.exitCode = undefined;

    vi.mocked(core.loadConfig).mockReturnValue(mockConfig);

    mockGenerateValidationSummary.mockReturnValue('Validation summary output');
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
    process.exitCode = undefined;
  });

  describe('configuration validation', () => {
    it('should error when config file is missing', async () => {
      vi.mocked(core.loadConfig).mockImplementation(() => {
        throw new core.ConfigNotFoundError('/project/.lingo-tracker.json');
      });

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      expect(console.error).toHaveBeenCalledWith('❌ Configuration file .lingo-tracker.json not found.');
      expect(console.error).toHaveBeenCalledWith('Run "lingo-tracker init" to initialize a project.');
    });

    it('should error when config file is malformed', async () => {
      vi.mocked(core.loadConfig).mockImplementation(() => {
        throw new core.ConfigParseError('/project/.lingo-tracker.json', 'Unexpected token i in JSON');
      });

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('❌ Failed to parse configuration file'));
    });

    it('should error when no collections are configured', async () => {
      const configWithoutCollections = {
        ...mockConfig,
        collections: {},
      };
      vi.mocked(core.loadConfig).mockReturnValue(configWithoutCollections);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      expect(console.error).toHaveBeenCalledWith('❌ No collections found in configuration.');
    });

    it('should error when no target locales are configured', async () => {
      const configWithoutTargetLocales = {
        ...mockConfig,
        locales: ['en'], // Only base locale
      };
      vi.mocked(core.loadConfig).mockReturnValue(configWithoutTargetLocales);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      expect(console.error).toHaveBeenCalledWith('❌ No target locales found in configuration.');
      expect(console.error).toHaveBeenCalledWith(
        "  Target locales are each collection's locales except its base locale.",
      );
    });
  });

  describe('successful validation', () => {
    it('should pass validation when all resources are verified', async () => {
      const successResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 0,
          translated: 0,
          stale: 0,
          verified: 6,
        },
        failures: [],
        warnings: [],
        successes: [
          {
            key: 'common.hello',
            locale: 'fr',
            collection: 'common',
            status: 'verified' as const,
          },
          {
            key: 'common.hello',
            locale: 'es',
            collection: 'common',
            status: 'verified' as const,
          },
          {
            key: 'common.hello',
            locale: 'de',
            collection: 'common',
            status: 'verified' as const,
          },
          {
            key: 'admin.title',
            locale: 'fr',
            collection: 'admin',
            status: 'verified' as const,
          },
          {
            key: 'admin.title',
            locale: 'es',
            collection: 'admin',
            status: 'verified' as const,
          },
          {
            key: 'admin.title',
            locale: 'de',
            collection: 'admin',
            status: 'verified' as const,
          },
        ],
        passed: true,
      };

      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({});

      expect(mockValidateResources).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            name: 'common',
            baseLocale: 'en',
            targetLocales: ['fr', 'es', 'de'],
          }),
          expect.objectContaining({
            name: 'admin',
            baseLocale: 'en',
            targetLocales: ['fr', 'es', 'de'],
          }),
        ],
        {
          allowTranslated: false,
          skippedLocales: [],
          icu: { compileValues: true, requirePortablePlurals: false },
          placeholders: true,
        },
      );

      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(successResult, {
        allowTranslated: false,
        skippedLocales: [],
        icu: { compileValues: true, requirePortablePlurals: false },
        placeholders: true,
      });
      expect(mockGenerateValidationSummary.mock.calls[0]?.[1]).toBe(mockValidateResources.mock.calls[0]?.[1]);

      expect(console.log).toHaveBeenCalledWith('Validation summary output');
      expect(process.exitCode).toBe(0);
    });

    it('should validate all collections from configuration', async () => {
      const successResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: { new: 0, translated: 0, stale: 0, verified: 6 },
        failures: [],
        warnings: [],
        successes: [],
        passed: true,
      };

      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({});

      const validateCall = mockValidateResources.mock.calls[0];
      const collections = validateCall[0];

      expect(collections).toHaveLength(2);
      expect(collections[0]).toMatchObject({ name: 'common' });
      expect(collections[1]).toMatchObject({ name: 'admin' });
    });

    it('should validate all target locales from configuration', async () => {
      const successResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: { new: 0, translated: 0, stale: 0, verified: 6 },
        failures: [],
        warnings: [],
        successes: [],
        passed: true,
      };

      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({});

      const validateCall = mockValidateResources.mock.calls[0];
      const collections = validateCall[0];

      expect(collections).toHaveLength(2);
      expect(collections[0]?.targetLocales).toEqual(['fr', 'es', 'de']);
      expect(collections[1]?.targetLocales).toEqual(['fr', 'es', 'de']);
      expect(collections[0]?.targetLocales).not.toContain('en'); // Base locale should be excluded
    });
  });

  describe('validation failures', () => {
    it('should fail validation with new resources', async () => {
      const failureResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 3,
          translated: 0,
          stale: 0,
          verified: 3,
        },
        failures: [
          {
            key: 'common.goodbye',
            locale: 'fr',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'common.goodbye',
            locale: 'es',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'common.goodbye',
            locale: 'de',
            collection: 'common',
            status: 'new' as const,
          },
        ],
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      expect(console.log).toHaveBeenCalledWith('Validation summary output');
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(failureResult, {
        allowTranslated: false,
        skippedLocales: [],
        icu: { compileValues: true, requirePortablePlurals: false },
        placeholders: true,
      });
    });

    it('should fail validation with stale resources', async () => {
      const failureResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 0,
          translated: 0,
          stale: 3,
          verified: 3,
        },
        failures: [
          {
            key: 'admin.subtitle',
            locale: 'fr',
            collection: 'admin',
            status: 'stale' as const,
          },
          {
            key: 'admin.subtitle',
            locale: 'es',
            collection: 'admin',
            status: 'stale' as const,
          },
          {
            key: 'admin.subtitle',
            locale: 'de',
            collection: 'admin',
            status: 'stale' as const,
          },
        ],
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      expect(console.log).toHaveBeenCalledWith('Validation summary output');
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(failureResult, {
        allowTranslated: false,
        skippedLocales: [],
        icu: { compileValues: true, requirePortablePlurals: false },
        placeholders: true,
      });
    });

    it('should fail validation with translated resources by default', async () => {
      const failureResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 0,
          translated: 3,
          stale: 0,
          verified: 3,
        },
        failures: [
          {
            key: 'common.welcome',
            locale: 'fr',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'common.welcome',
            locale: 'es',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'common.welcome',
            locale: 'de',
            collection: 'common',
            status: 'translated' as const,
          },
        ],
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      expect(mockValidateResources).toHaveBeenCalledWith(expect.any(Array), {
        allowTranslated: false,
        skippedLocales: [],
        icu: { compileValues: true, requirePortablePlurals: false },
        placeholders: true,
      });
    });

    it('should collect and report all failures from multiple locales', async () => {
      const failureResult = {
        totalResourcesValidated: 9,
        totalUniqueKeys: 3,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 6,
          translated: 0,
          stale: 3,
          verified: 0,
        },
        failures: [
          {
            key: 'common.hello',
            locale: 'fr',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'common.hello',
            locale: 'es',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'common.hello',
            locale: 'de',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'admin.title',
            locale: 'fr',
            collection: 'admin',
            status: 'new' as const,
          },
          {
            key: 'admin.title',
            locale: 'es',
            collection: 'admin',
            status: 'new' as const,
          },
          {
            key: 'admin.title',
            locale: 'de',
            collection: 'admin',
            status: 'new' as const,
          },
          {
            key: 'admin.subtitle',
            locale: 'fr',
            collection: 'admin',
            status: 'stale' as const,
          },
          {
            key: 'admin.subtitle',
            locale: 'es',
            collection: 'admin',
            status: 'stale' as const,
          },
          {
            key: 'admin.subtitle',
            locale: 'de',
            collection: 'admin',
            status: 'stale' as const,
          },
        ],
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      // Verify that all failures are passed to the summary generator
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          failures: expect.arrayContaining([
            expect.objectContaining({
              key: 'common.hello',
              locale: 'fr',
              status: 'new',
            }),
            expect.objectContaining({
              key: 'common.hello',
              locale: 'es',
              status: 'new',
            }),
            expect.objectContaining({
              key: 'common.hello',
              locale: 'de',
              status: 'new',
            }),
            expect.objectContaining({
              key: 'admin.title',
              locale: 'fr',
              status: 'new',
            }),
            expect.objectContaining({
              key: 'admin.title',
              locale: 'es',
              status: 'new',
            }),
            expect.objectContaining({
              key: 'admin.title',
              locale: 'de',
              status: 'new',
            }),
            expect.objectContaining({
              key: 'admin.subtitle',
              locale: 'fr',
              status: 'stale',
            }),
            expect.objectContaining({
              key: 'admin.subtitle',
              locale: 'es',
              status: 'stale',
            }),
            expect.objectContaining({
              key: 'admin.subtitle',
              locale: 'de',
              status: 'stale',
            }),
          ]),
        }),
        expect.any(Object),
      );
    });

    it('should collect and report all failures from multiple collections', async () => {
      const failureResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 6,
          translated: 0,
          stale: 0,
          verified: 0,
        },
        failures: [
          {
            key: 'common.button',
            locale: 'fr',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'common.button',
            locale: 'es',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'common.button',
            locale: 'de',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'admin.panel',
            locale: 'fr',
            collection: 'admin',
            status: 'new' as const,
          },
          {
            key: 'admin.panel',
            locale: 'es',
            collection: 'admin',
            status: 'new' as const,
          },
          {
            key: 'admin.panel',
            locale: 'de',
            collection: 'admin',
            status: 'new' as const,
          },
        ],
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      // Verify failures from both collections are included
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          failures: expect.arrayContaining([
            expect.objectContaining({ collection: 'common' }),
            expect.objectContaining({ collection: 'admin' }),
          ]),
        }),
        expect.any(Object),
      );
    });
  });

  describe('allowTranslated option', () => {
    it('should treat translated resources as warnings when allowTranslated is true', async () => {
      const warningResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 0,
          translated: 3,
          stale: 0,
          verified: 3,
        },
        failures: [],
        warnings: [
          {
            key: 'common.welcome',
            locale: 'fr',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'common.welcome',
            locale: 'es',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'common.welcome',
            locale: 'de',
            collection: 'common',
            status: 'translated' as const,
          },
        ],
        successes: [],
        passed: true,
      };

      mockValidateResources.mockReturnValue(warningResult);

      await validateCommand({ allowTranslated: true });

      expect(mockValidateResources).toHaveBeenCalledWith(expect.any(Array), {
        allowTranslated: true,
        skippedLocales: [],
        icu: { compileValues: true, requirePortablePlurals: false },
        placeholders: true,
      });

      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(warningResult, {
        allowTranslated: true,
        skippedLocales: [],
        icu: { compileValues: true, requirePortablePlurals: false },
        placeholders: true,
      });

      expect(console.log).toHaveBeenCalledWith('Validation summary output');
      expect(process.exitCode).toBe(0);
    });

    it('should pass validation with warnings when allowTranslated is true', async () => {
      const warningResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 0,
          translated: 6,
          stale: 0,
          verified: 0,
        },
        failures: [],
        warnings: [
          {
            key: 'common.hello',
            locale: 'fr',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'common.hello',
            locale: 'es',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'common.hello',
            locale: 'de',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'admin.title',
            locale: 'fr',
            collection: 'admin',
            status: 'translated' as const,
          },
          {
            key: 'admin.title',
            locale: 'es',
            collection: 'admin',
            status: 'translated' as const,
          },
          {
            key: 'admin.title',
            locale: 'de',
            collection: 'admin',
            status: 'translated' as const,
          },
        ],
        successes: [],
        passed: true,
      };

      mockValidateResources.mockReturnValue(warningResult);

      await validateCommand({ allowTranslated: true });

      expect(console.log).toHaveBeenCalledWith('Validation summary output');
      expect(process.exitCode).toBe(0);
    });

    it('should use allowTranslated: false by default', async () => {
      const successResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: { new: 0, translated: 0, stale: 0, verified: 6 },
        failures: [],
        warnings: [],
        successes: [],
        passed: true,
      };

      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({});

      expect(mockValidateResources).toHaveBeenCalledWith(expect.any(Array), {
        allowTranslated: false,
        skippedLocales: [],
        icu: { compileValues: true, requirePortablePlurals: false },
        placeholders: true,
      });
    });
  });

  describe('placeholder checking', () => {
    const successResult = {
      totalResourcesValidated: 6,
      totalUniqueKeys: 2,
      localesValidated: 3,
      collectionsValidated: 2,
      statusCounts: { new: 0, translated: 0, stale: 0, verified: 6 },
      failures: [],
      warnings: [],
      successes: [],
      passed: true,
    };

    it('should check placeholders against the base locale by default', async () => {
      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({});

      expect(mockValidateResources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ placeholders: true }),
      );
    });

    it('should skip the check when --skip-placeholders is given', async () => {
      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({ skipPlaceholders: true });

      expect(mockValidateResources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ placeholders: false }),
      );
    });

    it('should keep checking placeholders when ICU compilation is skipped', async () => {
      // The two passes answer different questions, so opting out of one must
      // not quietly opt out of the other.
      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({ skipIcu: true });

      expect(mockValidateResources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ placeholders: true }),
      );
    });
  });

  describe('comprehensive validation behavior', () => {
    it('prints the summary and exits 1 when validation fails', async () => {
      const failureResult = {
        totalResourcesValidated: 3,
        totalUniqueKeys: 1,
        localesValidated: 3,
        collectionsValidated: 1,
        statusCounts: {
          new: 3,
          translated: 0,
          stale: 0,
          verified: 0,
        },
        failures: [
          {
            key: 'test.key',
            locale: 'fr',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'test.key',
            locale: 'es',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'test.key',
            locale: 'de',
            collection: 'common',
            status: 'new' as const,
          },
        ],
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});

      expect(console.log).toHaveBeenCalledWith('Validation summary output');
      expect(process.exitCode).toBe(1);
    });

    it('passes every failure to the summary and exits 1', async () => {
      const failureResult = {
        totalResourcesValidated: 100,
        totalUniqueKeys: 100,
        localesValidated: 1,
        collectionsValidated: 1,
        statusCounts: {
          new: 100,
          translated: 0,
          stale: 0,
          verified: 0,
        },
        failures: Array.from({ length: 100 }, (_, i) => ({
          key: `resource.${i}`,
          locale: 'fr',
          collection: 'common',
          status: 'new' as const,
        })),
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      // Verify all 100 failures were passed to summary generator
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          failures: expect.arrayContaining([
            expect.objectContaining({ key: 'resource.0' }),
            expect.objectContaining({ key: 'resource.99' }),
          ]),
        }),
        expect.any(Object),
      );
      expect(mockGenerateValidationSummary.mock.calls[0][0].failures).toHaveLength(100);
    });

    it('should validate with mixed statuses and report comprehensively', async () => {
      const mixedResult = {
        totalResourcesValidated: 12,
        totalUniqueKeys: 4,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: {
          new: 3,
          translated: 3,
          stale: 3,
          verified: 3,
        },
        failures: [
          {
            key: 'res1',
            locale: 'fr',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'res1',
            locale: 'es',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'res1',
            locale: 'de',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'res2',
            locale: 'fr',
            collection: 'admin',
            status: 'stale' as const,
          },
          {
            key: 'res2',
            locale: 'es',
            collection: 'admin',
            status: 'stale' as const,
          },
          {
            key: 'res2',
            locale: 'de',
            collection: 'admin',
            status: 'stale' as const,
          },
          {
            key: 'res3',
            locale: 'fr',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'res3',
            locale: 'es',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'res3',
            locale: 'de',
            collection: 'common',
            status: 'translated' as const,
          },
        ],
        warnings: [],
        successes: [
          {
            key: 'res4',
            locale: 'fr',
            collection: 'admin',
            status: 'verified' as const,
          },
          {
            key: 'res4',
            locale: 'es',
            collection: 'admin',
            status: 'verified' as const,
          },
          {
            key: 'res4',
            locale: 'de',
            collection: 'admin',
            status: 'verified' as const,
          },
        ],
        passed: false,
      };

      mockValidateResources.mockReturnValue(mixedResult);

      await validateCommand({});
      expect(process.exitCode).toBe(1);

      // Verify comprehensive reporting of all statuses
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          failures: expect.arrayContaining([
            expect.objectContaining({ status: 'new' }),
            expect.objectContaining({ status: 'stale' }),
            expect.objectContaining({ status: 'translated' }),
          ]),
          successes: expect.arrayContaining([expect.objectContaining({ status: 'verified' })]),
        }),
        expect.any(Object),
      );
    });
  });

  describe('skipLocales option', () => {
    const successResult = {
      totalResourcesValidated: 4,
      totalUniqueKeys: 2,
      localesValidated: 2,
      collectionsValidated: 2,
      statusCounts: { new: 0, translated: 0, stale: 0, verified: 4 },
      failures: [],
      warnings: [],
      successes: [],
      passed: true,
    };

    it('should exclude a known locale from validation and report it as skipped', async () => {
      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({ skipLocales: ['fr'] });

      const validationOptions = mockValidateResources.mock.calls[0]?.[1];
      expect(validationOptions).toBeDefined();
      expect(validationOptions?.skippedLocales).toEqual(['fr']);

      const collections = mockValidateResources.mock.calls[0]?.[0];
      expect(collections?.[0]?.targetLocales).toEqual(['fr', 'es', 'de']);
      expect(collections?.[1]?.targetLocales).toEqual(['fr', 'es', 'de']);

      // skippedLocales is forwarded to generateValidationSummary
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ skippedLocales: ['fr'] }),
      );
    });

    it('should warn about unknown locales and not filter them', async () => {
      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({ skipLocales: ['xx'] });

      expect(console.error).toHaveBeenCalledWith("⚠️  Skipping unknown locale 'xx' — not in configured locales");

      expect(mockValidateResources.mock.calls[0]?.[1].skippedLocales).toEqual([]);

      // skippedLocales in summary is empty (unknown locale was not effectively skipped)
      expect(mockGenerateValidationSummary).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ skippedLocales: [] }),
      );
    });

    it('should silently ignore the base locale in skip list', async () => {
      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({ skipLocales: ['en'] });

      // No warning logged
      expect(console.error).not.toHaveBeenCalled();

      expect(mockValidateResources.mock.calls[0]?.[1].skippedLocales).toEqual([]);
    });

    it('should accept a locale from a collection override without an unknown-locale warning', async () => {
      vi.mocked(core.loadConfig).mockReturnValue({
        ...mockConfig,
        collections: {
          ...mockConfig.collections,
          admin: { translationsFolder: 'translations/admin', locales: ['en', 'ja'] },
        },
      });
      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({ skipLocales: ['ja'] });

      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining("Skipping unknown locale 'ja'"));
      expect(mockValidateResources).toHaveBeenCalledWith(
        [
          expect.objectContaining({ name: 'common', targetLocales: ['fr', 'es', 'de'] }),
          expect.objectContaining({ name: 'admin', targetLocales: ['ja'] }),
        ],
        expect.objectContaining({ skippedLocales: ['ja'] }),
      );
    });

    it('should exit with code 1 when all target locales are skipped', async () => {
      await validateCommand({ skipLocales: ['fr', 'es', 'de'] });
      expect(process.exitCode).toBe(1);

      expect(console.error).toHaveBeenCalledWith('❌ All target locales were skipped; nothing to validate.');
      expect(mockValidateResources).not.toHaveBeenCalled();
    });
  });

  describe('exit codes', () => {
    it('should exit with code 1 when validation fails', async () => {
      const failureResult = {
        totalResourcesValidated: 3,
        totalUniqueKeys: 1,
        localesValidated: 3,
        collectionsValidated: 1,
        statusCounts: { new: 3, translated: 0, stale: 0, verified: 0 },
        failures: [
          {
            key: 'test.key',
            locale: 'fr',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'test.key',
            locale: 'es',
            collection: 'common',
            status: 'new' as const,
          },
          {
            key: 'test.key',
            locale: 'de',
            collection: 'common',
            status: 'new' as const,
          },
        ],
        warnings: [],
        successes: [],
        passed: false,
      };

      mockValidateResources.mockReturnValue(failureResult);

      await validateCommand({});

      expect(process.exitCode).toBe(1);
    });

    it('should exit with code 0 when validation passes', async () => {
      const successResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: { new: 0, translated: 0, stale: 0, verified: 6 },
        failures: [],
        warnings: [],
        successes: [],
        passed: true,
      };

      mockValidateResources.mockReturnValue(successResult);

      await validateCommand({});

      expect(process.exitCode).toBe(0);
    });

    it('should exit with code 0 when validation passes with warnings', async () => {
      const warningResult = {
        totalResourcesValidated: 6,
        totalUniqueKeys: 2,
        localesValidated: 3,
        collectionsValidated: 2,
        statusCounts: { new: 0, translated: 3, stale: 0, verified: 3 },
        failures: [],
        warnings: [
          {
            key: 'test.key',
            locale: 'fr',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'test.key',
            locale: 'es',
            collection: 'common',
            status: 'translated' as const,
          },
          {
            key: 'test.key',
            locale: 'de',
            collection: 'common',
            status: 'translated' as const,
          },
        ],
        successes: [],
        passed: true,
      };

      mockValidateResources.mockReturnValue(warningResult);

      await validateCommand({ allowTranslated: true });

      expect(process.exitCode).toBe(0);
    });
  });

  describe('preferred terminology', () => {
    const filePath = '/project/.lingo-tracker-preferred-terminology.json';
    const rules = [{ discouraged: 'Expenditure', preferred: 'Investment' }];
    const passingResult = {
      totalResourcesValidated: 6,
      totalUniqueKeys: 2,
      localesValidated: 3,
      collectionsValidated: 2,
      statusCounts: { new: 0, translated: 0, stale: 0, verified: 6 },
      failures: [],
      warnings: [],
      successes: [],
      passed: true,
    };

    it('loads the rules and passes them with each collection base locale', async () => {
      vi.mocked(core.loadConfig).mockReturnValue({
        ...mockConfig,
        collections: {
          common: { translationsFolder: 'translations/common' },
          legacy: { translationsFolder: 'translations/legacy', baseLocale: 'en-GB' },
        },
      });
      mockLoadPreferredTerminology.mockReturnValueOnce({ rules, filePath });
      mockValidateResources.mockReturnValue(passingResult);

      await validateCommand({});

      expect(mockLoadPreferredTerminology).toHaveBeenCalledWith(
        expect.objectContaining({ baseLocale: 'en' }),
        expect.any(String),
      );
      expect(mockValidateResources).toHaveBeenCalledWith(
        [
          expect.objectContaining({ name: 'common', baseLocale: 'en' }),
          expect.objectContaining({ name: 'legacy', baseLocale: 'en-GB' }),
        ],
        expect.objectContaining({ terminology: { rules, loadError: undefined } }),
      );
    });

    it('does not fail when the only problems are terminology findings', async () => {
      mockLoadPreferredTerminology.mockReturnValueOnce({ rules, filePath });
      mockValidateResources.mockReturnValue({
        ...passingResult,
        terminology: {
          warnings: [
            {
              key: 'budget.title',
              collection: 'common',
              locale: 'en',
              discouraged: 'Expenditure',
              preferred: 'Investment',
              message: 'consider "Investment" instead of "Expenditure"',
            },
          ],
          valuesChecked: 2,
        },
      });

      await validateCommand({});

      expect(process.exitCode).toBe(0);
    });

    it('passes a load error through and exits 1 when validation reports it', async () => {
      mockLoadPreferredTerminology.mockReturnValueOnce({ rules: [], filePath, error: 'not valid JSON' });
      mockValidateResources.mockReturnValue({
        ...passingResult,
        passed: false,
        terminology: { warnings: [], configError: 'not valid JSON', valuesChecked: 0 },
      });

      await validateCommand({});

      expect(mockValidateResources).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          terminology: expect.objectContaining({ rules: [], loadError: 'not valid JSON' }),
        }),
      );
      expect(process.exitCode).toBe(1);
    });

    it('prints the missing-explicit-file warning and skips the check', async () => {
      mockLoadPreferredTerminology.mockReturnValueOnce({
        rules: [],
        filePath,
        warning: 'Preferred terminology file not found: /project/terms.json. Treating as an empty list.',
      });
      mockValidateResources.mockReturnValue(passingResult);

      await validateCommand({});

      expect(console.error).toHaveBeenCalledWith(
        '⚠️  Preferred terminology file not found: /project/terms.json. Treating as an empty list.',
      );
      expect(mockValidateResources.mock.calls[0]?.[1].terminology).toBeUndefined();
      expect(process.exitCode).toBe(0);
    });

    it('omits the check entirely when there are no rules', async () => {
      mockValidateResources.mockReturnValue(passingResult);

      await validateCommand({});

      expect(mockValidateResources.mock.calls[0]?.[1].terminology).toBeUndefined();
    });
  });
});
