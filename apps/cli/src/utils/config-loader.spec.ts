import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfiguration } from './config-loader';

describe('config-loader', () => {
  const mockConfig = {
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

  let projectDir: string;

  function writeConfig(content: string, dir = projectDir): void {
    writeFileSync(join(dir, '.lingo-tracker.json'), content, 'utf8');
  }

  beforeEach(() => {
    vi.clearAllMocks();
    projectDir = mkdtempSync(join(tmpdir(), 'lingo-config-loader-'));
    vi.spyOn(process, 'cwd').mockReturnValue(projectDir);

    // Mock console methods
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Reset environment variables
    delete process.env.INIT_CWD;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projectDir, { recursive: true, force: true });
  });

  function mockExit(): void {
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Error(`Process exit: ${code}`);
    });
  }

  describe('Happy Path', () => {
    it('should successfully load valid configuration', () => {
      writeConfig(JSON.stringify(mockConfig));

      const result = loadConfiguration();

      expect(result).not.toBeNull();
      expect(result?.config).toEqual(mockConfig);
      expect(result?.configPath).toBe(join(projectDir, '.lingo-tracker.json'));
      expect(result?.cwd).toBe(projectDir);
    });

    it('should parse complex configuration with bundles', () => {
      const complexConfig = {
        ...mockConfig,
        bundles: {
          'admin-bundle': {
            collections: ['admin', 'shared'],
            outputFormat: 'single-file',
          },
        },
      };
      writeConfig(JSON.stringify(complexConfig));

      const result = loadConfiguration();

      expect(result?.config).toEqual(complexConfig);
      expect(result?.config.bundles).toBeDefined();
    });
  });

  describe('File Not Found', () => {
    it('should exit with code 1 when config file not found (exitOnError: true)', () => {
      mockExit();

      expect(() => loadConfiguration()).toThrow('Process exit: 1');
      expect(console.error).toHaveBeenCalledWith('❌ Configuration file .lingo-tracker.json not found.');
      expect(console.error).toHaveBeenCalledWith('Run "lingo-tracker init" to initialize a project.');
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should return null when config file not found (exitOnError: false)', () => {
      mockExit();

      const result = loadConfiguration({ exitOnError: false });

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith('❌ Configuration file .lingo-tracker.json not found.');
      expect(console.error).toHaveBeenCalledWith('Run "lingo-tracker init" to initialize a project.');
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('Invalid JSON', () => {
    it('should exit with code 1 when config file has invalid JSON (exitOnError: true)', () => {
      writeConfig('{ invalid json');
      mockExit();

      expect(() => loadConfiguration()).toThrow('Process exit: 1');
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^❌ Failed to parse configuration file:/));
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should return null when config file has invalid JSON (exitOnError: false)', () => {
      writeConfig('{ invalid json');
      mockExit();

      const result = loadConfiguration({ exitOnError: false });

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/^❌ Failed to parse configuration file:/));
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should include specific parse error message', () => {
      writeConfig('{ invalid json');

      const result = loadConfiguration({ exitOnError: false });

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Failed to parse configuration file:'));
      // Verify the error message contains some parsing error detail
      const errorCall = vi.mocked(console.error).mock.calls.find((call) => String(call[0]).includes('Failed to parse'));
      expect(errorCall?.[0]).toMatch(/Expected|Unexpected|position|JSON/i);
    });
  });

  describe('INIT_CWD Handling', () => {
    it('should use INIT_CWD environment variable when set (pnpm compatibility)', () => {
      const pnpmDir = mkdtempSync(join(tmpdir(), 'lingo-config-loader-init-cwd-'));
      try {
        writeConfig(JSON.stringify(mockConfig), pnpmDir);
        process.env.INIT_CWD = pnpmDir;

        const result = loadConfiguration();

        expect(result).not.toBeNull();
        expect(result?.cwd).toBe(pnpmDir);
        expect(result?.configPath).toBe(join(pnpmDir, '.lingo-tracker.json'));
      } finally {
        rmSync(pnpmDir, { recursive: true, force: true });
      }
    });

    it('should fall back to process.cwd() when INIT_CWD not set', () => {
      writeConfig(JSON.stringify(mockConfig));

      const result = loadConfiguration();

      expect(result).not.toBeNull();
      expect(result?.cwd).toBe(projectDir);
      expect(result?.configPath).toBe(join(projectDir, '.lingo-tracker.json'));
    });
  });

  describe('Error Messages', () => {
    it('should display exact error message for file not found', () => {
      loadConfiguration({ exitOnError: false });

      expect(console.error).toHaveBeenCalledWith('❌ Configuration file .lingo-tracker.json not found.');
      expect(console.error).toHaveBeenCalledWith('Run "lingo-tracker init" to initialize a project.');
      expect(console.error).toHaveBeenCalledTimes(2);
    });

    it('should display exact error message format for parse failure', () => {
      writeConfig('{ invalid json');

      loadConfiguration({ exitOnError: false });

      const errorCalls = vi.mocked(console.error).mock.calls;
      expect(errorCalls.length).toBe(1);
      expect(errorCalls[0][0]).toMatch(/^❌ Failed to parse configuration file: /);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty configuration file', () => {
      writeConfig('{}');

      const result = loadConfiguration();

      expect(result).not.toBeNull();
      expect(result?.config).toEqual({});
    });

    it('should handle configuration with minimal properties', () => {
      const minimalConfig = {
        baseLocale: 'en',
        locales: ['en'],
        collections: {},
      };
      writeConfig(JSON.stringify(minimalConfig));

      const result = loadConfiguration();

      expect(result).not.toBeNull();
      expect(result?.config).toEqual(minimalConfig);
    });

    it('should handle file read errors other than not found', () => {
      // A directory in place of the file: it exists, but reading it fails (EISDIR).
      mkdirSync(join(projectDir, '.lingo-tracker.json'));

      const result = loadConfiguration({ exitOnError: false });

      expect(result).toBeNull();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringMatching(/^❌ Failed to parse configuration file: .*EISDIR/),
      );
    });
  });
});
