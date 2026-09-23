import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { ConfigNotFoundError, ConfigParseError, type LingoTrackerConfig, loadConfig } from '@simoncodes-ca/core';

@Injectable()
export class ConfigService {
  /**
   * Reads `.lingo-tracker.json` from the server's working directory on every call (the
   * file can change between requests), via core `loadConfig`, and maps its failures to
   * HTTP errors.
   */
  getConfig(): LingoTrackerConfig {
    try {
      return loadConfig({ cwd: process.cwd() });
    } catch (error: unknown) {
      if (error instanceof ConfigNotFoundError) {
        throw new NotFoundException('Configuration file not found');
      }
      if (error instanceof ConfigParseError) {
        throw new InternalServerErrorException('Invalid configuration file format');
      }
      throw new InternalServerErrorException('Failed to read configuration file');
    }
  }
}
