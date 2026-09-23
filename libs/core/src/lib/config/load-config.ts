import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LingoTrackerConfig } from '../../config/lingo-tracker-config';
import { CONFIG_FILENAME } from '../../constants';
import { ConfigNotFoundError, ConfigParseError } from '../errors/lingo-tracker-error';

export interface LoadConfigOptions {
  /** Directory that holds `.lingo-tracker.json`. Default: `process.cwd()`. */
  readonly cwd?: string;
}

/**
 * Reads and parses `.lingo-tracker.json`. This is the only config reader: the CLI, the
 * API, and core's own config writers all go through it.
 *
 * The result is the file as written. It is not validated and no fallbacks are applied;
 * call {@link openCollection} to get a collection's effective settings.
 *
 * @throws {ConfigNotFoundError} The file does not exist.
 * @throws {ConfigParseError} The file is not valid JSON, or not a JSON object.
 * Other I/O failures (for example, permission denied) propagate unchanged.
 */
export function loadConfig(options: LoadConfigOptions = {}): LingoTrackerConfig {
  const configPath = resolve(options.cwd ?? process.cwd(), CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    throw new ConfigNotFoundError(configPath);
  }

  let content: string;
  try {
    content = readFileSync(configPath, 'utf8');
  } catch (error) {
    // The file vanished between the two calls.
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ConfigNotFoundError(configPath);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new ConfigParseError(configPath, error instanceof Error ? error.message : String(error));
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ConfigParseError(configPath, 'the configuration must be a JSON object');
  }

  return parsed as LingoTrackerConfig;
}
