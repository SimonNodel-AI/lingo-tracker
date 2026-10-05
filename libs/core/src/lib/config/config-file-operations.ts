import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeTags } from '@simoncodes-ca/domain';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { ErrorMessages } from '../errors/error-messages';
import { ConfigChangedError, InvalidConfigError, LingoTrackerError } from '../errors/lingo-tracker-error';
import { hasFsErrorCode } from '../file-io/fs-error';
import { writeJsonFile } from '../file-io/json-file-operations';
import type { OpenedProject } from './open-collection';
import { configContentHash, configReadVersion, loadConfig } from './load-config';
import {
  type CompanionFileWrite,
  type ConfigWriteOutcome,
  runConfigWriteTransaction,
} from './config-write-transaction';

export interface ConfigFileOperations {
  /** Read the configuration file */
  read(): LingoTrackerConfig;
  /** Write the configuration file */
  write(config: LingoTrackerConfig): void;
  /** Write config and companions; observe the explicit restore outcome, then throw the original failure. */
  transaction(
    config: LingoTrackerConfig | undefined,
    companions: readonly CompanionFileWrite[],
    onOutcome?: (outcome: ConfigWriteOutcome) => void,
  ): void;
  /** Refuse a write based on a config snapshot if the file has changed since that read. */
  assertUnchanged(): void;
  /** Create the file only if absent, using the same validation and serialization as write. */
  create(config: LingoTrackerConfig): void;
  /** Update configuration with a partial modification */
  update(updater: (config: LingoTrackerConfig) => LingoTrackerConfig): LingoTrackerConfig;
}

export interface ConfigFileParams {
  /** Current working directory (default: process.cwd()) */
  readonly cwd?: string;
  /** Validate config after reading (default: true) */
  readonly validate?: boolean;
  /** A config returned by `loadConfig`; its original file hash becomes this handle's baseline. */
  readonly snapshot?: LingoTrackerConfig;
}

/**
 * Creates a configuration file operations object.
 * Provides a clean interface for reading and writing config files.
 *
 * Every failure is a typed error: `loadConfig`'s own `ConfigNotFoundError` and
 * `ConfigParseError` pass through, and everything else is an `InvalidConfigError` with a fixed
 * message: `Could not read .lingo-tracker.json` or `Could not write .lingo-tracker.json` for an
 * I/O failure (the fs error is its `cause`), or the field at fault for a required field that is
 * missing or of the wrong shape.
 */
export function createConfigFileOperations(params: ConfigFileParams = {}): ConfigFileOperations {
  const cwd = params.cwd ?? process.cwd();
  const validate = params.validate ?? true;
  const configPath = resolve(cwd, CONFIG_FILENAME);
  let expectedVersion = params.snapshot === undefined ? undefined : configReadVersion(params.snapshot);

  const assertUnchanged = (): void => {
    if (expectedVersion === undefined) return;
    let currentContent: string;
    try {
      currentContent = readFileSync(configPath, 'utf8');
    } catch (error) {
      if (hasFsErrorCode(error, 'ENOENT')) {
        throw new ConfigChangedError();
      }
      throw new InvalidConfigError(`Could not read ${CONFIG_FILENAME}`, { cause: error });
    }
    if (configContentHash(currentContent) !== expectedVersion) throw new ConfigChangedError();
  };

  const writeConfig = (config: LingoTrackerConfig, createOnly: boolean, onWriteStarted?: () => void): void => {
    if (validate) validateConfig(config);
    assertUnchanged();
    try {
      onWriteStarted?.();
      writeJsonFile({ filePath: configPath, data: config, pretty: true, createOnly });
    } catch (error) {
      if (createOnly && hasFsErrorCode(error, 'EEXIST')) {
        throw new InvalidConfigError(ErrorMessages.configAlreadyExists());
      }
      throw new InvalidConfigError(`Could not write ${CONFIG_FILENAME}`, { cause: error });
    }
    expectedVersion = configContentHash(JSON.stringify(config, null, 2));
  };

  return {
    read(): LingoTrackerConfig {
      let config: LingoTrackerConfig;

      try {
        config = loadConfig({ cwd });
      } catch (error) {
        if (error instanceof LingoTrackerError) throw error;
        throw new InvalidConfigError(`Could not read ${CONFIG_FILENAME}`, { cause: error });
      }

      expectedVersion = configReadVersion(config);

      if (validate) {
        prepareConfigSnapshot(config);
      } else {
        normalizeCollectionTags(config);
      }
      return config;
    },

    write(config: LingoTrackerConfig): void {
      writeConfig(config, false);
    },

    transaction(config, companions, onOutcome): void {
      assertUnchanged();
      const previousVersion = expectedVersion;
      let configWriteStarted = false;
      let configWritten = false;
      try {
        const outcome = runConfigWriteTransaction(
          [
            ...(config === undefined
              ? []
              : [
                  {
                    path: configPath,
                    write: () => {
                      writeConfig(config, false, () => {
                        configWriteStarted = true;
                      });
                      configWritten = true;
                    },
                  },
                ]),
            ...companions,
          ],
          (path) => {
            // Do not overwrite another writer's config while restoring our transaction.
            if (path === configPath) {
              if (!configWriteStarted) return false;
              // Failed writes can leave partial bytes that differ from the baseline.
              // Check for concurrent edits only after our write completed successfully.
              if (configWritten) assertUnchanged();
            }
            return true;
          },
        );
        onOutcome?.(outcome);
        if (outcome.status === 'failed') throw outcome.error;
      } catch (error) {
        expectedVersion = previousVersion;
        throw error;
      }
    },

    assertUnchanged,

    create(config: LingoTrackerConfig): void {
      writeConfig(config, true);
    },

    update(updater: (config: LingoTrackerConfig) => LingoTrackerConfig): LingoTrackerConfig {
      const currentConfig = this.read();
      const updatedConfig = updater(currentConfig);
      this.write(updatedConfig);
      return updatedConfig;
    },
  };
}

/** Apply the same preflight checks and tag normalization as a config-file read, without another read. */
export function prepareConfigSnapshot(config: LingoTrackerConfig): void {
  validateConfig(config);
  normalizeCollectionTags(config);
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

/** The guarded write handle of an opened project or collection. */
export function guardedConfigWrite(source: OpenedProject): ConfigFileOperations {
  prepareConfigSnapshot(source.sourceConfig);
  return createConfigFileOperations({ cwd: source.projectRoot, snapshot: source.sourceConfig });
}
