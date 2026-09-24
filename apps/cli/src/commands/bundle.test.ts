import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bundleCommand } from './bundle';
import prompts from 'prompts';
import { isInteractiveTerminal } from '../runner/terminal';

vi.mock('prompts');
vi.mock('../runner/terminal', () => ({ isInteractiveTerminal: vi.fn(() => false) }));

vi.mock('@simoncodes-ca/core', async () => {
  const actual = await vi.importActual<typeof import('@simoncodes-ca/core')>('@simoncodes-ca/core');
  return {
    ...actual,
    loadConfig: vi.fn(),
    generateBundle: vi.fn(),
  };
});

import * as core from '@simoncodes-ca/core';
const mockGenerateBundle = core.generateBundle as ReturnType<typeof vi.fn>;

describe('bundleCommand', () => {
  const mockConfig = {
    exportFolder: 'dist/export',
    importFolder: 'dist/import',
    baseLocale: 'en',
    locales: ['en', 'fr', 'es'],
    collections: {
      common: {
        translationsFolder: 'translations/common',
      },
    },
    bundles: {
      core: {
        bundleName: '{locale}',
        dist: './dist/i18n',
        collections: 'All' as const,
      },
      admin: {
        bundleName: 'admin-{locale}',
        dist: './dist/admin-i18n',
        collections: 'All' as const,
      },
    },
  };

  const originalLog = console.log;

  beforeEach(() => {
    vi.clearAllMocks();
    console.log = vi.fn();
    process.env.INIT_CWD = '/test';
    process.exitCode = undefined;
    vi.mocked(isInteractiveTerminal).mockReturnValue(false);
    vi.mocked(core.loadConfig).mockReturnValue(mockConfig);

    mockGenerateBundle.mockReturnValue({
      bundleKey: 'core',
      filesGenerated: 3,
      warnings: [],
      localesProcessed: ['en', 'fr', 'es'],
    });
  });

  afterEach(() => {
    console.log = originalLog;
    process.exitCode = undefined;
  });

  describe('configuration validation', () => {
    it('should error when config file is missing', async () => {
      vi.mocked(core.loadConfig).mockImplementation(() => {
        throw new core.ConfigNotFoundError('/test/.lingo-tracker.json');
      });

      await bundleCommand({});

      expect(core.loadConfig).toHaveBeenCalledWith({ cwd: '/test' });
      expect(mockGenerateBundle).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should error when no bundles are configured', async () => {
      const configWithoutBundles = { ...mockConfig, bundles: {} };
      vi.mocked(core.loadConfig).mockReturnValue(configWithoutBundles);

      await bundleCommand({});

      expect(console.log).toHaveBeenCalledWith('❌ No bundles configured in .lingo-tracker.json');
      expect(process.exitCode).toBe(1);
    });

    it('should error when bundles property is missing', async () => {
      const configWithoutBundles = { ...mockConfig };
      delete (configWithoutBundles as { bundles?: unknown }).bundles;
      vi.mocked(core.loadConfig).mockReturnValue(configWithoutBundles);

      await bundleCommand({});

      expect(console.log).toHaveBeenCalledWith('❌ No bundles configured in .lingo-tracker.json');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('bundle selection', () => {
    it('should process all bundles by default in non-TTY mode', async () => {
      await bundleCommand({});

      expect(process.exitCode).toBe(0);
      expect(mockGenerateBundle).toHaveBeenCalledTimes(2);
      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleKey: 'core',
        }),
      );
      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleKey: 'admin',
        }),
      );
    });

    it('should process single bundle when --name is provided', async () => {
      await bundleCommand({ name: 'core' });

      expect(mockGenerateBundle).toHaveBeenCalledTimes(1);
      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleKey: 'core',
        }),
      );
    });

    it('should process multiple bundles when comma-separated names are provided', async () => {
      await bundleCommand({ name: 'core,admin' });

      expect(mockGenerateBundle).toHaveBeenCalledTimes(2);
      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleKey: 'core',
        }),
      );
      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleKey: 'admin',
        }),
      );
    });

    it('should handle bundle names with spaces after comma', async () => {
      await bundleCommand({ name: 'core, admin' });

      expect(mockGenerateBundle).toHaveBeenCalledTimes(2);
    });

    it('should show error for non-existent bundle', async () => {
      await bundleCommand({ name: 'nonexistent' });

      expect(console.log).toHaveBeenCalledWith('❌ Bundle "nonexistent" not found.');
      expect(mockGenerateBundle).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('project directory', () => {
    it('passes the directory the config was loaded from to generateBundle', async () => {
      await bundleCommand({ name: 'core' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/test' }));
    });
  });

  describe('locale filtering', () => {
    it('should pass single locale filter to generateBundle', async () => {
      await bundleCommand({ name: 'core', locale: 'en' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          locales: ['en'],
        }),
      );
    });

    it('should pass multiple locales filter to generateBundle', async () => {
      await bundleCommand({ name: 'core', locale: 'en,fr' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          locales: ['en', 'fr'],
        }),
      );
    });

    it('should handle locale filter with spaces', async () => {
      await bundleCommand({ name: 'core', locale: 'en, fr, es' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          locales: ['en', 'fr', 'es'],
        }),
      );
    });

    it('should not pass locales when no filter is provided', async () => {
      await bundleCommand({ name: 'core' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          locales: undefined,
        }),
      );
    });
  });

  describe('output modes', () => {
    it('should display normal output for single bundle', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: [],
        localesProcessed: ['en', 'fr', 'es'],
      });

      await bundleCommand({ name: 'core' });

      expect(console.log).toHaveBeenCalledWith('🔄 Generating bundle: core');
      expect(console.log).toHaveBeenCalledWith('  ✅ Files generated: 3');
      expect(console.log).toHaveBeenCalledWith('  ✅ Locales: en, fr, es');
    });

    it('should suppress progress and success output in quiet mode', async () => {
      await bundleCommand({ name: 'core', quiet: true });

      expect(console.log).not.toHaveBeenCalled();
    });

    it('should display warnings in quiet mode', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: ['Warning 1'],
        localesProcessed: ['en', 'fr'],
      });

      await bundleCommand({ name: 'core', quiet: true });

      expect(console.log).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith('  ⚠️  Warnings: 1');
      expect(console.log).not.toHaveBeenCalledWith('       - Warning 1');
    });

    it('should display errors in quiet mode', async () => {
      mockGenerateBundle.mockImplementation(() => {
        throw new Error('Bundle generation failed');
      });

      await bundleCommand({ name: 'core', quiet: true });

      expect(console.log).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith('  ❌ Bundle generation failed');
    });

    it('should display type generation errors in quiet mode', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: [],
        localesProcessed: ['en'],
        typeGenerationResult: {
          bundleKey: 'core',
          typeDistFile: 'src/generated/core-tokens.ts',
          keysCount: 0,
          fileGenerated: false,
          errorReason: 'Unable to write type file',
        },
      });

      await bundleCommand({ name: 'core', quiet: true });

      expect(console.log).toHaveBeenCalledTimes(1);
      expect(console.log).toHaveBeenCalledWith('  └─ Types: Error (Unable to write type file)');
    });

    it('should display warnings count when warnings exist', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: ['Warning 1', 'Warning 2'],
        localesProcessed: ['en', 'fr'],
      });

      await bundleCommand({ name: 'core' });

      expect(console.log).toHaveBeenCalledWith('  ⚠️  Warnings: 2');
    });

    it('should display warning details in verbose mode', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: ['Warning 1', 'Warning 2'],
        localesProcessed: ['en', 'fr'],
      });

      await bundleCommand({ name: 'core', verbose: true });

      expect(console.log).toHaveBeenCalledWith('       - Warning 1');
      expect(console.log).toHaveBeenCalledWith('       - Warning 2');
    });

    it('should display locale filter in verbose mode', async () => {
      await bundleCommand({ name: 'core', locale: 'en,fr', verbose: true });

      expect(console.log).toHaveBeenCalledWith('  Locales: en, fr');
    });

    it('should display summary for multiple bundles', async () => {
      mockGenerateBundle
        .mockReturnValueOnce({
          bundleKey: 'core',
          filesGenerated: 3,
          warnings: [],
          localesProcessed: ['en', 'fr', 'es'],
        })
        .mockReturnValueOnce({
          bundleKey: 'admin',
          filesGenerated: 2,
          warnings: ['Warning 1'],
          localesProcessed: ['en', 'fr'],
        });

      await bundleCommand({ name: 'core,admin' });

      expect(console.log).toHaveBeenCalledWith('\n📊 Summary (2 bundles)');
      expect(console.log).toHaveBeenCalledWith('─'.repeat(50));
      expect(console.log).toHaveBeenCalledWith('  Total files generated: 5');
      expect(console.log).toHaveBeenCalledWith('  Total warnings: 1');
    });

    it('should display warning totals in quiet mode for multiple bundles', async () => {
      mockGenerateBundle
        .mockReturnValueOnce({
          bundleKey: 'core',
          filesGenerated: 3,
          warnings: [],
          localesProcessed: ['en', 'fr', 'es'],
        })
        .mockReturnValueOnce({
          bundleKey: 'admin',
          filesGenerated: 2,
          warnings: ['Warning 1'],
          localesProcessed: ['en', 'fr'],
        });

      await bundleCommand({ name: 'core,admin', quiet: true });

      expect(console.log).not.toHaveBeenCalledWith('\n📊 Summary (2 bundles)');
      expect(console.log).not.toHaveBeenCalledWith('  Total files generated: 5');
      expect(console.log).toHaveBeenCalledWith('  Total warnings: 1');
      expect(console.log).toHaveBeenCalledWith('  Run with --verbose to see warning details');
      expect(console.log).toHaveBeenCalledWith('  ⚠️  Warnings: 1');
      expect(console.log).not.toHaveBeenCalledWith('       - Warning 1');
    });

    it('should display type generation success', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: [],
        localesProcessed: ['en'],
        typeGenerationResult: {
          bundleKey: 'core',
          typeDistFile: 'src/generated/core-tokens.ts',
          keysCount: 100,
          fileGenerated: true,
        },
      });

      await bundleCommand({ name: 'core' });

      expect(console.log).toHaveBeenCalledWith('  └─ Types: src/generated/core-tokens.ts (100 keys)');
    });

    it('should display type generation skipped (empty)', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: [],
        localesProcessed: ['en'],
        typeGenerationResult: {
          bundleKey: 'core',
          typeDistFile: undefined,
          keysCount: 0,
          fileGenerated: false,
          skippedReason: 'empty-bundle',
        },
      });

      await bundleCommand({ name: 'core' });

      expect(console.log).toHaveBeenCalledWith('  └─ Types: Skipped (bundle has no keys)');
    });

    it('should display type generation skipped (not-configured reason from result)', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: [],
        localesProcessed: ['en'],
        typeGenerationResult: {
          bundleKey: 'core',
          typeDistFile: undefined,
          keysCount: 0,
          fileGenerated: false,
          skippedReason: 'not-configured',
        },
      });

      await bundleCommand({ name: 'core' });

      expect(console.log).toHaveBeenCalledWith('  └─ Types: Skipped (no typeDistFile configured)');
    });

    it('should display type generation skipped (no config)', async () => {
      mockGenerateBundle.mockReturnValue({
        bundleKey: 'core',
        filesGenerated: 3,
        warnings: [],
        localesProcessed: ['en'],
        // No typeGenerationResult
      });

      await bundleCommand({ name: 'core' });

      expect(console.log).toHaveBeenCalledWith('  └─ Types: Skipped (no typeDistFile configured)');
    });
  });

  describe('--token-constant-name option', () => {
    it('should pass tokenConstantName to generateBundle when --token-constant-name is provided', async () => {
      await bundleCommand({ name: 'core', tokenConstantName: 'MY_CUSTOM_TOKENS' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleKey: 'core',
          tokenConstantName: 'MY_CUSTOM_TOKENS',
        }),
      );
    });

    it('should error when --token-constant-name is used with multiple bundles via --name', async () => {
      await bundleCommand({ name: 'core,admin', tokenConstantName: 'MY_CUSTOM_TOKENS' });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Cannot use --token-constant-name with multiple bundles'),
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Please target a single bundle'));
      expect(mockGenerateBundle).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('should error when --token-constant-name is used in non-TTY mode (all bundles)', async () => {
      // In non-TTY mode with no --name, all bundles are processed
      await bundleCommand({ tokenConstantName: 'MY_CUSTOM_TOKENS' });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Cannot use --token-constant-name with multiple bundles'),
      );
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Please target a single bundle'));
      expect(mockGenerateBundle).not.toHaveBeenCalled();
    });

    it('should not pass tokenConstantName when not provided', async () => {
      await bundleCommand({ name: 'core' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenConstantName: undefined,
        }),
      );
    });
  });

  describe('--debug-keys option', () => {
    it('passes debugKeysLocale as "99" when --debug-keys flag is set (boolean true)', async () => {
      await bundleCommand({ name: 'core', debugKeys: true });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          debugKeysLocale: '99',
        }),
      );
    });

    it('passes debugKeysLocale with custom locale when --debug-keys <locale> is provided', async () => {
      await bundleCommand({ name: 'core', debugKeys: 'keys' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          debugKeysLocale: 'keys',
        }),
      );
    });

    it('passes undefined debugKeysLocale when --debug-keys is not set', async () => {
      await bundleCommand({ name: 'core' });

      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          debugKeysLocale: undefined,
        }),
      );
    });
  });

  describe('error handling', () => {
    it('should handle generateBundle errors and continue', async () => {
      mockGenerateBundle
        .mockImplementationOnce(() => {
          throw new Error('Bundle generation failed');
        })
        .mockReturnValueOnce({
          bundleKey: 'admin',
          filesGenerated: 2,
          warnings: [],
          localesProcessed: ['en', 'fr'],
        });

      await bundleCommand({ name: 'core,admin' });

      expect(console.log).toHaveBeenCalledWith('  ❌ Bundle generation failed');
      expect(console.log).toHaveBeenCalledWith('🔄 Generating bundle: admin');
      expect(mockGenerateBundle).toHaveBeenCalledTimes(2);
      expect(process.exitCode).toBe(1);
    });

    it('should show error count in summary', async () => {
      mockGenerateBundle
        .mockImplementationOnce(() => {
          throw new Error('Failed');
        })
        .mockReturnValueOnce({
          bundleKey: 'admin',
          filesGenerated: 2,
          warnings: [],
          localesProcessed: ['en', 'fr'],
        });

      await bundleCommand({ name: 'core,admin' });

      expect(console.log).toHaveBeenCalledWith('⚠️  1 bundle(s) failed to generate');
    });
  });

  describe('interactive mode (TTY)', () => {
    beforeEach(() => {
      vi.mocked(isInteractiveTerminal).mockReturnValue(true);
    });

    it('should prompt for bundle selection when no --name provided', async () => {
      vi.mocked(prompts).mockResolvedValue({
        bundleOrAll: 'core',
      });

      await bundleCommand({});

      expect(prompts).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'bundleOrAll',
            message: 'Select bundle to generate',
          }),
        ]),
        expect.any(Object),
      );
    });

    it('should process all bundles when "All bundles" is selected', async () => {
      vi.mocked(prompts).mockResolvedValue({
        bundleOrAll: '__ALL__',
      });

      await bundleCommand({});

      expect(mockGenerateBundle).toHaveBeenCalledTimes(2);
    });

    it('should process single bundle when specific bundle is selected', async () => {
      vi.mocked(prompts).mockResolvedValue({
        bundleOrAll: 'core',
      });

      await bundleCommand({});

      expect(mockGenerateBundle).toHaveBeenCalledTimes(1);
      expect(mockGenerateBundle).toHaveBeenCalledWith(
        expect.objectContaining({
          bundleKey: 'core',
        }),
      );
    });

    it('should error when "All bundles" is selected and --token-constant-name is set', async () => {
      vi.mocked(prompts).mockResolvedValue({
        bundleOrAll: '__ALL__',
      });

      await bundleCommand({ tokenConstantName: 'MY_CUSTOM_TOKENS' });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Cannot use --token-constant-name with multiple bundles'),
      );
      expect(mockGenerateBundle).not.toHaveBeenCalled();
    });

    it('should report prompt cancellation and return without exiting or generating', async () => {
      const exit = vi.spyOn(process, 'exit');
      // The user presses Esc: prompts calls onCancel.
      vi.mocked(prompts).mockImplementation(async (questions, options) => {
        const [question] = Array.isArray(questions) ? questions : [questions];
        options?.onCancel?.(question, {});
        return {};
      });

      await expect(bundleCommand({})).resolves.toBeUndefined();

      expect(console.log).toHaveBeenCalledWith('❌ Bundle generation cancelled.');
      expect(mockGenerateBundle).not.toHaveBeenCalled();
      expect(exit).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(0);
      exit.mockRestore();
    });
  });
});
