import { ConfigNotFoundError, ConfigParseError } from '@simoncodes-ca/core';

/** ConfigService's read path keeps the API's existing missing-file response. */
export class ConfigReadNotFoundError extends ConfigNotFoundError {
  constructor(error: ConfigNotFoundError) {
    super(error.configPath);
  }
}

/** ConfigService's read path keeps the API's existing parse-error response. */
export class ConfigReadParseError extends ConfigParseError {
  constructor(error: ConfigParseError) {
    super(error.configPath, error.reason);
  }
}
