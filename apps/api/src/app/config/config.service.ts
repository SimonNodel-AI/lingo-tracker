import { Injectable } from '@nestjs/common';
import {
  ConfigNotFoundError,
  ConfigParseError,
  InvalidConfigError,
  type LingoTrackerConfig,
  loadConfig,
} from '@simoncodes-ca/core';
import { ConfigReadNotFoundError, ConfigReadParseError } from '../errors/config-read.errors';

@Injectable()
export class ConfigService {
  /** Reads `.lingo-tracker.json` once per call; the exception filter maps typed failures. */
  getConfig(): LingoTrackerConfig {
    try {
      return loadConfig({ cwd: process.cwd() });
    } catch (error) {
      if (error instanceof ConfigNotFoundError) throw new ConfigReadNotFoundError(error);
      if (error instanceof ConfigParseError) throw new ConfigReadParseError(error);
      throw new InvalidConfigError('Failed to read configuration file', { cause: error });
    }
  }
}
