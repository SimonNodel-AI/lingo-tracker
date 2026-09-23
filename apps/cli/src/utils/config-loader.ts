import * as path from 'path';
import {
  CONFIG_FILENAME,
  ConfigNotFoundError,
  ConfigParseError,
  type LingoTrackerConfig,
  loadConfig,
} from '@simoncodes-ca/core';

/**
 * Gets the current working directory, respecting INIT_CWD for pnpm compatibility.
 *
 * This utility centralizes the directory resolution logic used across CLI commands.
 * The INIT_CWD environment variable is set by pnpm and contains the directory where
 * the command was originally invoked, before pnpm changed to the package directory.
 *
 * @returns Absolute path to the current working directory
 *
 * @example
 * ```typescript
 * const cwd = getCwd();
 * const configPath = path.join(cwd, '.lingo-tracker.json');
 * ```
 */
export function getCwd(): string {
  return process.env.INIT_CWD || process.cwd();
}

/**
 * Result returned from successful configuration loading.
 */
export interface ConfigLoadResult {
  /**
   * The parsed LingoTracker configuration object.
   */
  config: LingoTrackerConfig;

  /**
   * Absolute path to the configuration file.
   */
  configPath: string;

  /**
   * Current working directory where configuration was loaded from.
   * Respects INIT_CWD environment variable for pnpm compatibility.
   */
  cwd: string;
}

/**
 * Options for configuration loading behavior.
 */
export interface ConfigLoadOptions {
  /**
   * When true (default), exits the process with code 1 on errors.
   * When false, returns null on errors instead of exiting.
   */
  exitOnError?: boolean;
}

/**
 * Loads the LingoTracker configuration file (.lingo-tracker.json) for a CLI command.
 *
 * Reading and parsing is done by core `loadConfig`, the single config reader. This
 * wrapper only picks the directory and turns failures into CLI output.
 *
 * **Directory Resolution:**
 * - Respects INIT_CWD environment variable (pnpm compatibility)
 * - Falls back to process.cwd() if INIT_CWD not set
 *
 * **Error Handling:**
 * - File not found: Displays helpful message suggesting to run `lingo-tracker init`
 * - Parse or read errors: Shows the specific error message
 * - Behavior controlled by `exitOnError` option (default: exit process)
 *
 * @param options - Configuration loading options
 * @returns Configuration result on success, null on error (when exitOnError is false)
 *
 * @example
 * ```typescript
 * // Default behavior - exits on error
 * const loaded = loadConfiguration();
 * if (!loaded) return; // TypeScript guard (never reached in practice)
 * const { config, cwd } = loaded;
 * ```
 *
 * @example
 * ```typescript
 * // Custom error handling - returns null on error
 * const loaded = loadConfiguration({ exitOnError: false });
 * if (!loaded) {
 *   // Handle error gracefully
 *   return;
 * }
 * const { config, cwd } = loaded;
 * ```
 */
export function loadConfiguration(options?: ConfigLoadOptions): ConfigLoadResult | null {
  const exitOnError = options?.exitOnError ?? true;
  const cwd = getCwd();

  try {
    return { config: loadConfig({ cwd }), configPath: path.join(cwd, CONFIG_FILENAME), cwd };
  } catch (error) {
    if (error instanceof ConfigNotFoundError) {
      console.error(`❌ Configuration file ${CONFIG_FILENAME} not found.`);
      console.error('Run "lingo-tracker init" to initialize a project.');
    } else {
      const reason =
        error instanceof ConfigParseError ? error.reason : error instanceof Error ? error.message : String(error);
      console.error(`❌ Failed to parse configuration file: ${reason}`);
    }

    if (exitOnError) {
      process.exit(1);
    }
    return null;
  }
}
