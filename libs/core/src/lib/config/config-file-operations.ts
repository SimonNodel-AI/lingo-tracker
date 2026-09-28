import { resolve } from 'node:path';
import { normalizeTags } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { InvalidConfigError, LingoTrackerError } from '../errors/lingo-tracker-error';
import { writeJsonFile } from '../file-io/json-file-operations';
import { loadConfig } from './load-config';

export interface ConfigFileOperations {
  /** Read the configuration file */
  read(): LingoTrackerConfig;
  /** Write the configuration file */
  write(config: LingoTrackerConfig): void;
  /** Update configuration with a partial modification */
  update(updater: (config: LingoTrackerConfig) => LingoTrackerConfig): LingoTrackerConfig;
}

export interface ConfigFileParams {
  /** Current working directory (default: process.cwd()) */
  readonly cwd?: string;
  /** Validate config after reading (default: true) */
  readonly validate?: boolean;
}

/**
 * Creates a configuration file operations object.
 * Provides a clean interface for reading and writing config files.
 *
 * Every failure is a typed error: `loadConfig`'s own `ConfigNotFoundError` and
 * `ConfigParseError` pass through, and everything else (an unreadable or unwritable file,
 * a required field missing or of the wrong shape) is an `InvalidConfigError` whose message
 * says what is wrong with `.lingo-tracker.json`.
 */
export function createConfigFileOperations(params: ConfigFileParams = {}): ConfigFileOperations {
  const cwd = params.cwd ?? process.cwd();
  const validate = params.validate ?? true;
  const configPath = resolve(cwd, CONFIG_FILENAME);

  return {
    read(): LingoTrackerConfig {
      let config: LingoTrackerConfig;

      try {
        config = loadConfig({ cwd });
      } catch (error) {
        if (error instanceof LingoTrackerError) throw error;
        throw new InvalidConfigError(`Failed to read ${CONFIG_FILENAME}: ${reasonOf(error)}`);
      }

      if (validate) {
        validateConfig(config);
      }

      normalizeCollectionTags(config);
      return config;
    },

    write(config: LingoTrackerConfig): void {
      if (validate) {
        validateConfig(config);
      }

      try {
        writeJsonFile({
          filePath: configPath,
          data: config,
          pretty: true,
        });
      } catch (error) {
        throw new InvalidConfigError(`Failed to write ${CONFIG_FILENAME}: ${reasonOf(error)}`);
      }
    },

    update(updater: (config: LingoTrackerConfig) => LingoTrackerConfig): LingoTrackerConfig {
      const currentConfig = this.read();
      const updatedConfig = updater(currentConfig);
      this.write(updatedConfig);
      return updatedConfig;
    },
  };
}

/**
 * Validates a LingoTrackerConfig structure.
 * Throws `InvalidConfigError` naming the field when the config is invalid.
 */
function validateConfig(config: LingoTrackerConfig): void {
  if (!config.baseLocale) {
    throw new InvalidConfigError(`${CONFIG_FILENAME} is missing the required field "baseLocale"`);
  }

  if (!Array.isArray(config.locales)) {
    throw new InvalidConfigError(`"locales" in ${CONFIG_FILENAME} must be an array`);
  }

  if (!config.collections || typeof config.collections !== 'object') {
    throw new InvalidConfigError(`"collections" in ${CONFIG_FILENAME} must be an object`);
  }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeCollectionTags(config: LingoTrackerConfig): void {
  if (!config.collections) return;
  for (const collection of Object.values(config.collections)) {
    if (collection.tags !== undefined) {
      collection.tags = normalizeTags(collection.tags);
      if (collection.tags.length === 0) {
        delete collection.tags;
      }
    }
  }
}

/**
 * Helper function for atomic config updates.
 */
export function updateConfig(
  updater: (config: LingoTrackerConfig) => LingoTrackerConfig,
  cwd?: string,
): LingoTrackerConfig {
  return createConfigFileOperations({ cwd }).update(updater);
}
