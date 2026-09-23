import { ErrorMessages } from './error-messages';

/**
 * Base class for errors LingoTracker raises on purpose. Adapters (CLI, API) can test
 * `instanceof` on a subclass to choose an exit code or HTTP status, instead of matching
 * message text.
 */
export class LingoTrackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** `.lingo-tracker.json` does not exist in the directory that was searched. */
export class ConfigNotFoundError extends LingoTrackerError {
  readonly configPath: string;

  constructor(configPath: string) {
    super(`${ErrorMessages.configNotFound()}: ${configPath}`);
    this.configPath = configPath;
  }
}

/** `.lingo-tracker.json` exists but is not a JSON object. `reason` is the parser's message. */
export class ConfigParseError extends LingoTrackerError {
  readonly configPath: string;
  readonly reason: string;

  constructor(configPath: string, reason: string) {
    super(ErrorMessages.jsonParseFailed(configPath, reason));
    this.configPath = configPath;
    this.reason = reason;
  }
}

/** The config has no collection with this name. */
export class CollectionNotFoundError extends LingoTrackerError {
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionNotFound(collectionName));
    this.collectionName = collectionName;
  }
}

/** A mutating operation was asked of a collection flagged `readOnly`. */
export class ReadOnlyCollectionError extends LingoTrackerError {
  readonly collectionName: string;

  constructor(collectionName: string) {
    super(ErrorMessages.collectionReadOnly(collectionName));
    this.collectionName = collectionName;
  }
}
